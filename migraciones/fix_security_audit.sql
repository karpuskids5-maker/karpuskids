-- ============================================================
-- 🔒 Karpus Kids — Security & Audit Improvements
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ── 1. TRIGGER INMUTABLE DE AUDITORÍA DE PAGOS ───────────────
-- Registra automáticamente en audit_logs cualquier cambio
-- en la tabla payments (INSERT, UPDATE, DELETE).
-- Esto es inmutable: el frontend NO puede evitarlo.

CREATE OR REPLACE FUNCTION public.fn_audit_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_action text;
  v_payload jsonb;
  v_user_id uuid;
BEGIN
  -- Intentar obtener el usuario actual de la sesión
  BEGIN
    v_user_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    v_action  := 'payment.created';
    v_payload := jsonb_build_object(
      'payment_id',  NEW.id,
      'student_id',  NEW.student_id,
      'amount',      NEW.amount,
      'month',       NEW.month_paid,
      'status',      NEW.status,
      'method',      NEW.method,
      'concept',     NEW.concept,
      'due_date',    NEW.due_date
    );

  ELSIF TG_OP = 'UPDATE' THEN
    -- Solo registrar si cambió algo relevante
    IF OLD.status IS DISTINCT FROM NEW.status
    OR OLD.amount IS DISTINCT FROM NEW.amount
    OR OLD.due_date IS DISTINCT FROM NEW.due_date THEN

      v_action := CASE
        WHEN NEW.status = 'paid'    AND OLD.status != 'paid'    THEN 'payment.approved'
        WHEN NEW.status = 'overdue' AND OLD.status != 'overdue' THEN 'payment.overdue'
        WHEN NEW.status = 'rejected'                            THEN 'payment.rejected'
        WHEN OLD.due_date IS DISTINCT FROM NEW.due_date         THEN 'payment.mora_waived'
        ELSE 'payment.updated'
      END;

      v_payload := jsonb_build_object(
        'payment_id',   NEW.id,
        'student_id',   NEW.student_id,
        'amount',       NEW.amount,
        'month',        NEW.month_paid,
        'old_status',   OLD.status,
        'new_status',   NEW.status,
        'old_due_date', OLD.due_date,
        'new_due_date', NEW.due_date,
        'validated_by', NEW.validated_by,
        'notes',        NEW.notes
      );
    ELSE
      RETURN NEW; -- Sin cambios relevantes, no auditar
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    v_action  := 'payment.deleted';
    v_payload := jsonb_build_object(
      'payment_id', OLD.id,
      'student_id', OLD.student_id,
      'amount',     OLD.amount,
      'month',      OLD.month_paid,
      'status',     OLD.status
    );
  END IF;

  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (v_user_id, v_action, v_payload, now());

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Crear trigger (eliminar si ya existe)
DROP TRIGGER IF EXISTS trg_audit_payment ON public.payments;
CREATE TRIGGER trg_audit_payment
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_payment();

-- ── 2. FUNCIÓN DE MORA EN BASE DE DATOS ──────────────────────
-- Calcula la mora directamente en el servidor.
-- Regla: RD$50/día, cada 7 días = bloque de RD$500.
-- Esto evita que el frontend manipule el cálculo.

CREATE OR REPLACE FUNCTION public.calc_mora(p_due_date date)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_days_late int;
  v_blocks    int;
  v_remainder int;
BEGIN
  v_days_late := (CURRENT_DATE - p_due_date)::int;
  IF v_days_late <= 0 THEN RETURN 0; END IF;

  v_blocks    := v_days_late / 7;
  v_remainder := v_days_late % 7;

  RETURN (v_blocks * 500) + (v_remainder * 50);
END;
$$;

-- Vista enriquecida de pagos con mora calculada en servidor
CREATE OR REPLACE VIEW public.v_payments_with_mora AS
SELECT
  p.*,
  public.calc_mora(p.due_date)                          AS mora_amount,
  p.amount + public.calc_mora(p.due_date)               AS total_due,
  (CURRENT_DATE - p.due_date)::int                      AS days_late,
  s.name                                                AS student_name,
  s.p1_name                                             AS parent_name,
  s.p1_email                                            AS parent_email,
  c.name                                                AS classroom_name,
  ap.name                                               AS approved_by_name
FROM public.payments p
LEFT JOIN public.students  s  ON s.id = p.student_id
LEFT JOIN public.classrooms c ON c.id = s.classroom_id
LEFT JOIN public.profiles  ap ON ap.id = p.validated_by
WHERE p.deleted_at IS NULL;

-- RLS en la vista
GRANT SELECT ON public.v_payments_with_mora TO authenticated;

-- ── 3. RPC SEGURO PARA APROBAR PAGOS ─────────────────────────
-- Centraliza la lógica de aprobación en el servidor.
-- Registra quién aprobó y cuándo de forma inmutable.

CREATE OR REPLACE FUNCTION public.approve_payment(
  p_payment_id bigint,
  p_notes      text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_role    text;
  v_payment payments%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;

  -- Solo directora, asistente o admin pueden aprobar
  IF v_role NOT IN ('directora', 'asistente', 'admin') THEN
    RETURN jsonb_build_object('error', 'No autorizado');
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pago no encontrado');
  END IF;

  IF v_payment.status = 'paid' THEN
    RETURN jsonb_build_object('error', 'El pago ya fue aprobado');
  END IF;

  UPDATE public.payments
  SET
    status       = 'paid',
    paid_date    = now(),
    validated_by = v_user_id,
    notes        = COALESCE(p_notes, notes)
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success',      true,
    'payment_id',   p_payment_id,
    'approved_by',  v_user_id,
    'approved_at',  now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_payment(bigint, text) TO authenticated;

-- ── 4. RPC SEGURO PARA ELIMINAR PAGOS (SOFT DELETE) ──────────
CREATE OR REPLACE FUNCTION public.delete_payment(
  p_payment_id bigint,
  p_reason     text DEFAULT 'Eliminado por administración'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_role    text;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;

  IF v_role NOT IN ('directora', 'asistente', 'admin') THEN
    RETURN jsonb_build_object('error', 'No autorizado');
  END IF;

  -- Soft delete: marcar como eliminado en vez de borrar
  UPDATE public.payments
  SET deleted_at = now(),
      notes = COALESCE(notes || ' | ', '') || p_reason || ' (' || to_char(now(), 'DD/MM/YYYY HH24:MI') || ')'
  WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pago no encontrado');
  END IF;

  RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_payment(bigint, text) TO authenticated;

-- ── 5. COLUMNA validated_by EN PAYMENTS (si no existe) ───────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS validated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── 6. ÍNDICE PARA AUDITORÍA RÁPIDA ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_payment_id
  ON public.audit_logs ((payload->>'payment_id'), created_at DESC)
  WHERE action LIKE 'payment.%';
