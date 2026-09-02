-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · MIGRACIÓN 16 — DESCUENTOS EN LA MENSUALIDAD (ASISTENTE/DIRECTORA)
-- Y FIX DE APROBACIÓN DE PAGOS
-- ═══════════════════════════════════════════════════════════════════════════
-- Objetivos:
--   1. FIX: no se podían aprobar pagos pendientes con método NULL (los pagos
--      generados por el ciclo no guardan `method`). La condición
--      `method IS DISTINCT FROM 'efectivo'` evalúa TRUE para NULL, así que
--      cualquier aprobación de un pago sin comprobante devolvía
--      "No se puede aprobar una transferencia sin comprobante cargado".
--   2. DESCUENTO EN LA MENSUALIDAD: el Asistente y la Directora pueden aplicar
--      un descuento (% o monto fijo) a cualquier mensualidad, y aplica por
--      igual a pagos en efectivo y por transferencia. Se registra con auditoría
--      y queda visible en la tabla (monto original tachado + badge %).
--   3. El ciclo de facturación respeta el descuento personal del estudiante
--      (students.discount_pct) además del descuento por hermanos, y guarda el
--      desglose (original_amount / discount_pct / discount_amount) en la fila.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Columnas de descuento en payments
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS original_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_pct    numeric(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason text;

-- Backfill: para pagos existentes el "original" es el monto actual.
UPDATE public.payments
SET original_amount = amount
WHERE original_amount IS NULL AND amount IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. FIX approve_payment — método NULL se trata como efectivo
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_payment(p_payment_id bigint, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text; v_payment record; has_proof boolean;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error','No tienes permisos para aprobar pagos');
  END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','El pago no existe'); END IF;
  IF v_payment.status = 'paid' THEN RETURN jsonb_build_object('error','El pago ya fue aprobado'); END IF;
  has_proof := (v_payment.proof_url IS NOT NULL AND v_payment.proof_url <> '') OR
               (v_payment.evidence_url IS NOT NULL AND v_payment.evidence_url <> '');
  IF NOT has_proof AND (COALESCE(v_payment.method,'efectivo') <> 'efectivo') THEN
    RETURN jsonb_build_object('error','No se puede aprobar una transferencia sin comprobante cargado');
  END IF;
  UPDATE public.payments
  SET status='paid', paid_date=now(), validated_by=auth.uid(), notes=COALESCE(p_notes,notes,'Aprobado vía sistema')
  WHERE id = p_payment_id;
  RETURN jsonb_build_object('success',true,'payment_id',p_payment_id,'approved_by',auth.uid(),'approved_at',now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_payment(bigint, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. RPC apply_payment_discount — descuento sobre una mensualidad
--    (aplica por igual a efectivo y transferencia · con auditoría)
--    p_fixed (opcional): si se envía > 0 se usa como monto fijo descontado.
--    p_pct: 0 a 100 (% sobre original). Enviar 0 y sin p_fixed quita el descuento.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_payment_discount(
  p_payment_id bigint,
  p_pct        numeric DEFAULT 0,
  p_reason     text DEFAULT '',
  p_fixed      numeric DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role        text;
  v_original    numeric;
  v_cur_amount  numeric;
  v_pct_eff     numeric;
  v_disc_amount numeric;
  v_new_amount  numeric;
  v_month       text;
  v_concept     text;
  v_student     bigint;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error','No tienes permisos para aplicar descuentos');
  END IF;

  SELECT amount, month_paid, concept, student_id, COALESCE(original_amount, amount) AS orig
    INTO v_cur_amount, v_month, v_concept, v_student, v_original
  FROM public.payments WHERE id = p_payment_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Pago no encontrado'); END IF;

  IF p_fixed IS NOT NULL AND p_fixed > 0 THEN
    v_disc_amount := round(GREATEST(0, LEAST(p_fixed, v_original))::numeric, 2);
  ELSE
    v_disc_amount := round((v_original * GREATEST(0, LEAST(COALESCE(p_pct,0), 100)) / 100)::numeric, 2);
  END IF;
  v_pct_eff := CASE WHEN v_original > 0 THEN round((v_disc_amount / v_original * 100)::numeric, 2) ELSE 0 END;
  v_new_amount := round((v_original - v_disc_amount)::numeric, 2);

  UPDATE public.payments
  SET amount          = v_new_amount,
      original_amount = v_original,
      discount_pct    = v_pct_eff,
      discount_amount = v_disc_amount,
      discount_reason = CASE WHEN v_pct_eff > 0 THEN COALESCE(NULLIF(trim(p_reason),''), discount_reason, 'Descuento')
                             ELSE NULL END,
      notes           = CASE WHEN v_pct_eff > 0
                             THEN COALESCE(NULLIF(notes,'') || ' | ', '') ||
                                  'Descuento ' || v_pct_eff::text || '% (RD$' || v_disc_amount::text || ')' ||
                                  CASE WHEN coalesce(p_reason,'') <> '' THEN ' — ' || p_reason ELSE '' END
                             ELSE COALESCE(notes,'') END,
      updated_at      = now()
  WHERE id = p_payment_id;

  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (auth.uid(), 'payment.discount_applied',
    jsonb_build_object('payment_id', p_payment_id, 'student_id', v_student,
      'old_amount', v_cur_amount, 'new_amount', v_new_amount, 'original_amount', v_original,
      'discount_pct', v_pct_eff, 'discount_amount', v_disc_amount,
      'month_paid', v_month, 'concept', v_concept, 'reason', p_reason), now())
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'payment_id', p_payment_id,
    'old_amount', v_cur_amount, 'original_amount', v_original, 'amount', v_new_amount,
    'discount_pct', v_pct_eff, 'discount_amount', v_disc_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_payment_discount(bigint, numeric, text, numeric) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. run_payment_cycle — respeta el descuento personal del estudiante
--    (students.discount_pct) además del descuento por hermanos, y guarda
--    el desglose del descuento en la mensualidad generada.
--    Base: migración "auto_cobro_mes_actual" (cobra el mes actual salvo que
--    el estudiante inicie en un mes futuro).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_payment_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role          text;
  v_gen_day       int;
  v_due_day       int;
  v_now           date := current_date;
  v_target_month  text;
  v_due_date      date;
  v_last_day      date;
  v_generated     int := 0;
  v_expired       int := 0;
  v_student       record;
  v_rank          int;
  v_discount      numeric;
  v_amount        numeric;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden ejecutar el ciclo de pagos';
  END IF;

  SELECT COALESCE(generation_day,25), COALESCE(due_day,5) INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  v_target_month := to_char(v_now, 'YYYY-MM');
  v_due_date     := (date_trunc('month', v_now + interval '1 month') + (v_due_day - 1) * interval '1 day')::date;
  v_last_day     := (date_trunc('month', v_now) + interval '1 month - 1 day')::date;

  FOR v_student IN
    SELECT s.id, s.monthly_fee, s.prolongado_fee, s.start_date, COALESCE(s.discount_pct,0) AS discount_pct
    FROM public.students s
    WHERE s.is_active = true AND s.monthly_fee > 0 AND s.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id AND p.month_paid = v_target_month AND p.concept = 'Mensualidad' AND p.deleted_at IS NULL
      )
  LOOP
    -- Omitir solo a estudiantes que empiezan en un MES FUTURO (aún no inscritos)
    IF v_student.start_date IS NOT NULL AND v_student.start_date > v_last_day THEN
      CONTINUE;
    END IF;

    -- Descuento por hermanos (regla progresiva) + descuento personal
    v_rank := public.get_student_family_rank(v_student.id);
    IF v_rank >= 3 THEN     v_discount := 0.15;
    ELSIF v_rank = 2 THEN   v_discount := 0.10;
    ELSE                    v_discount := 0; END IF;
    v_discount := GREATEST(v_discount, LEAST(v_student.discount_pct, 100) / 100);
    v_amount := round((v_student.monthly_fee * (1 - v_discount))::numeric, 2);

    INSERT INTO public.payments
      (student_id, amount, original_amount, discount_pct, discount_amount,
       status, due_date, month_paid, concept, created_at)
    VALUES (v_student.id, v_amount, v_student.monthly_fee, round(v_discount * 100, 2),
            round((v_student.monthly_fee - v_amount)::numeric, 2),
            'pending', v_due_date, v_target_month, 'Mensualidad', now())
    ON CONFLICT DO NOTHING;
    v_generated := v_generated + 1;

    IF v_student.prolongado_fee > 0 THEN
      INSERT INTO public.payments (student_id, amount, status, due_date, month_paid, concept, created_at)
      VALUES (v_student.id, v_student.prolongado_fee, 'pending', v_due_date, v_target_month, 'Día Prolongado', now())
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  UPDATE public.payments SET status = 'overdue', updated_at = now()
  WHERE status = 'pending' AND due_date < v_now AND deleted_at IS NULL;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object('generated', v_generated, 'expired', v_expired, 'month', v_target_month, 'due_date', v_due_date::text);
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_payment_cycle() TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. preview_payment_cycle — vista previa coherente con el nuevo cálculo.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.preview_payment_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gen_day int; v_today int := extract(day from current_date)::int;
  v_target_month text; v_gen_count int := 0; v_total_amount numeric := 0;
  v_grace_count int := 0; v_existing_count int := 0;
BEGIN
  SELECT COALESCE(generation_day,25) INTO v_gen_day FROM public.school_settings WHERE id = 1;
  v_target_month := to_char(current_date, 'YYYY-MM');
  WITH to_bill AS (
    SELECT s.id, s.monthly_fee, s.prolongado_fee, COALESCE(s.discount_pct,0) AS discount_pct
    FROM public.students s
    WHERE s.is_active = true AND s.monthly_fee > 0 AND s.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id AND p.month_paid = v_target_month AND p.deleted_at IS NULL
      )
  ),
  ranked AS (
    SELECT t.id,
           t.monthly_fee,
           t.prolongado_fee,
           t.discount_pct,
           public.get_student_family_rank(t.id) AS family_rank
    FROM to_bill t
  ),
  with_amount AS (
    SELECT round((monthly_fee * (1 - eff.disc))::numeric, 2) + coalesce(prolongado_fee, 0) AS bill
    FROM ranked,
    LATERAL (
      SELECT GREATEST(
        CASE WHEN family_rank >= 3 THEN 0.15
             WHEN family_rank = 2 THEN 0.10
             ELSE 0 END,
        LEAST(discount_pct, 100) / 100
      ) AS disc
    ) eff
  )
  SELECT count(*), coalesce(sum(bill), 0) INTO v_gen_count, v_total_amount FROM with_amount;

  SELECT count(DISTINCT student_id) INTO v_existing_count
  FROM public.payments WHERE month_paid = v_target_month AND deleted_at IS NULL;

  RETURN jsonb_build_object('target_month', v_target_month, 'count', v_gen_count,
    'total_amount', v_total_amount, 'existing_count', v_existing_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.preview_payment_cycle() TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Trigger sync_current_month_payment — al asignar/actualizar la cuota de
--    un estudiante activo se genera el cobro del mes visible respetando el
--    descuento personal y guardando el desglose del descuento.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_current_month_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gen_day int; v_due_day int;
  v_now date := current_date;
  v_tm text; v_due date; v_last_day date;
  v_rank int; v_disc numeric; v_amount numeric;
BEGIN
  IF (NEW.is_active IS NOT FALSE) AND COALESCE(NEW.monthly_fee, 0) > 0 AND NEW.deleted_at IS NULL THEN
    SELECT COALESCE(generation_day,25), COALESCE(due_day,5) INTO v_gen_day, v_due_day
    FROM public.school_settings WHERE id = 1;

    -- Mes visible: el actual si ya pasó el día de generación, si no el próximo
    IF EXTRACT(DAY FROM v_now)::int < v_gen_day THEN
      v_tm := to_char(v_now + interval '1 month', 'YYYY-MM');
      v_last_day := (date_trunc('month', v_now + interval '1 month') + interval '1 month - 1 day')::date;
    ELSE
      v_tm := to_char(v_now, 'YYYY-MM');
      v_last_day := (date_trunc('month', v_now) + interval '1 month - 1 day')::date;
    END IF;

    -- No cobrar a estudiantes que aún no inician (mes futuro)
    IF NEW.start_date IS NOT NULL AND NEW.start_date > v_last_day THEN
      RETURN NEW;
    END IF;

    v_due := (date_trunc('month', (v_tm || '-15')::date + interval '1 month') + (v_due_day - 1) * interval '1 day')::date;

    IF NOT EXISTS (
      SELECT 1 FROM public.payments
      WHERE student_id = NEW.id AND concept = 'Mensualidad' AND month_paid = v_tm AND deleted_at IS NULL
    ) THEN
      v_rank := public.get_student_family_rank(NEW.id);
      IF v_rank >= 3 THEN v_disc := 0.15;
      ELSIF v_rank = 2 THEN v_disc := 0.10;
      ELSE v_disc := 0; END IF;
      v_disc := GREATEST(v_disc, LEAST(COALESCE(NEW.discount_pct, 0), 100) / 100);
      v_amount := round((NEW.monthly_fee * (1 - v_disc))::numeric, 2);

      INSERT INTO public.payments
        (student_id, amount, original_amount, discount_pct, discount_amount,
         status, due_date, month_paid, concept, created_at)
      VALUES (NEW.id, v_amount, NEW.monthly_fee, round(v_disc * 100, 2),
              round((NEW.monthly_fee - v_amount)::numeric, 2),
              'pending', v_due, v_tm, 'Mensualidad', now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_month_payment ON public.students;
CREATE TRIGGER trg_sync_month_payment
AFTER INSERT OR UPDATE ON public.students
FOR EACH ROW EXECUTE FUNCTION public.sync_current_month_payment();

-- ───────────────────────────────────────────────────────────────────────────
-- 7. RECREAR v_payments_with_mora — la vista almacena la lista de columnas
--    expandida al momento de crearse, así que `ALTER TABLE ... ADD COLUMN` no
--    le agrega las columnas nuevas. Al recrearla, `p.*` vuelve a expandirse e
--    incluye original_amount / discount_pct / discount_amount / discount_reason.
-- ───────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_payments_with_mora;
CREATE VIEW public.v_payments_with_mora AS
SELECT
  p.*,
  public.calculate_mora_v2(p.amount, p.due_date, p.status) AS mora_amount,
  public.calculate_mora_v2(p.amount, p.due_date, p.status) AS calculated_mora,
  (p.amount + public.calculate_mora_v2(p.amount, p.due_date, p.status)) AS total_due,
  (CURRENT_DATE - p.due_date)::int AS days_late,
  s.name          AS student_name,
  s.p1_name       AS parent_name,
  s.p1_email      AS parent_email,
  s.p1_phone      AS parent_phone,
  s.p2_name       AS parent2_name,
  s.p2_email      AS parent2_email,
  s.p2_phone      AS parent2_phone,
  c.name          AS classroom_name,
  ap.name         AS approved_by_name
FROM public.payments p
LEFT JOIN public.students  s  ON s.id = p.student_id
LEFT JOIN public.classrooms c ON c.id = s.classroom_id
LEFT JOIN public.profiles  ap ON ap.id = p.validated_by
WHERE p.deleted_at IS NULL;
GRANT SELECT ON public.v_payments_with_mora TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. FIX CRÍTICO fn_protect_paid_records — el camino de pagos NO aprobados
--    terminaba en `RETURN OLD`, que en un trigger BEFORE UPDATE descarta el
--    UPDATE completo SIN error. Resultado: ningún pago pendiente podía
--    aprobarse (markPaid/approve_payment) ni cambiar de estado ni monto.
--    Ahora los pagos no aprobados se actualizan normal (RETURN NEW) y solo se
--    bloquean las modificaciones/eliminaciones de pagos `paid`.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_protect_paid_records()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_role text;
BEGIN
  IF OLD.status = 'paid' THEN
    SELECT COALESCE(role, '') INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IN ('directora','asistente','admin') AND TG_OP = 'UPDATE' AND NEW.amount IS DISTINCT FROM OLD.amount THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'No se puede modificar o eliminar un pago ya validado y aprobado.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_paid_records ON public.payments;
CREATE TRIGGER trg_protect_paid_records BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_paid_records();

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN MIGRACIÓN 16
-- ═══════════════════════════════════════════════════════════════════════════