-- ============================================================
-- 🛡️ REGLAS DE SEGURIDAD Y VALIDACIÓN DE PAGOS 2026
-- ============================================================

-- 1. Reforzar approve_payment: Impedir aprobación sin comprobante (excepto efectivo)
CREATE OR REPLACE FUNCTION public.approve_payment(p_payment_id bigint, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_payment record;
BEGIN
  -- Verificar rol
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error','No tienes permisos para aprobar pagos');
  END IF;

  -- Obtener datos del pago
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','El pago no existe');
  END IF;

  -- REGLA: No se puede aprobar si no hay comprobante Y no es efectivo
  IF (v_payment.proof_url IS NULL OR v_payment.proof_url = '') AND (v_payment.method IS DISTINCT FROM 'efectivo') THEN
    RETURN jsonb_build_object('error','No se puede aprobar un pago por transferencia sin comprobante visual cargado');
  END IF;

  -- Proceder con la aprobación
  UPDATE public.payments
  SET
    status='paid',
    paid_date=now(),
    validated_by=auth.uid(),
    notes=COALESCE(p_notes, notes, 'Aprobado vía sistema')
  WHERE id = p_payment_id;

  RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id);
END;
$$;

-- 2. Trigger para pasar a "review" automáticamente cuando se sube evidencia
CREATE OR REPLACE FUNCTION public.fn_on_payment_evidence_uploaded()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Si el estado era 'pending' o 'overdue' y se sube un proof_url, pasar a 'review'
  IF (NEW.proof_url IS NOT NULL AND NEW.proof_url <> '') AND (OLD.proof_url IS NULL OR OLD.proof_url = '') THEN
    IF NEW.status IN ('pending', 'overdue') THEN
      NEW.status := 'review';
      NEW.notes := COALESCE(NEW.notes || ' | ', '') || 'Comprobante subido por usuario - Pendiente de validación';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_evidence_uploaded ON public.payments;
CREATE TRIGGER trg_on_evidence_uploaded
  BEFORE UPDATE OF proof_url ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_on_payment_evidence_uploaded();

-- 3. Regla de Integridad: Impedir borrar pagos ya aprobados
CREATE OR REPLACE FUNCTION public.fn_protect_paid_records()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'paid' AND (SELECT role FROM public.profiles WHERE id = auth.uid()) NOT IN ('admin') THEN
    RAISE EXCEPTION 'No se puede modificar o eliminar un registro de pago que ya ha sido validado y aprobado por la dirección.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_paid_records ON public.payments;
CREATE TRIGGER trg_protect_paid_records
  BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_paid_records();

-- 4. Nueva lógica de Mora (Centralizada)
-- Regla:
-- - 1er día de atraso: Recargo fijo de RD$200 (Gastos administrativos)
-- - A partir del día 2: RD$50 diario (Interés por mora)
CREATE OR REPLACE FUNCTION public.calculate_mora_v2(
  p_amount numeric,
  p_due_date date,
  p_status text
)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_days_late int;
  v_mora numeric := 0;
BEGIN
  IF p_status = 'paid' OR p_status = 'rejected' OR p_due_date >= CURRENT_DATE THEN
    RETURN 0;
  END IF;

  v_days_late := (CURRENT_DATE - p_due_date)::int;

  -- Recargo fijo inicial
  v_mora := 200;

  -- Recargo diario
  IF v_days_late > 1 THEN
    v_mora := v_mora + ((v_days_late - 1) * 50);
  END IF;

  RETURN v_mora;
END;
$$;

-- 5. Actualizar vista para usar la nueva mora
DROP VIEW IF EXISTS public.v_payments_with_mora;
CREATE VIEW public.v_payments_with_mora AS
SELECT
  p.*,
  public.calculate_mora_v2(p.amount, p.due_date, p.status) as calculated_mora,
  (p.amount + public.calculate_mora_v2(p.amount, p.due_date, p.status)) as total_due,
  s.name as student_name,
  c.name as classroom_name
FROM public.payments p
LEFT JOIN public.students s ON s.id = p.student_id
LEFT JOIN public.classrooms c ON c.id = s.classroom_id
WHERE p.deleted_at IS NULL;

-- 6. Índice de unicidad reforzado (Concepto + Estudiante + Mes)
DROP INDEX IF EXISTS public.idx_payments_unique_student_month;
CREATE UNIQUE INDEX idx_payments_unique_student_month_concept
  ON public.payments(student_id, month_paid, concept)
  WHERE month_paid IS NOT NULL AND deleted_at IS NULL;
