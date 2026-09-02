-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · MIGRACIÓN 13 — DESCUENTO DE HERMANOS Y AJUSTE FLEXIBLE DE MONTOS
-- ═══════════════════════════════════════════════════════════════════════════
-- Objetivos (informe pagos.md · Secciones 1A y 2):
--   1. Sistema de descuento por hermanos en el ciclo de facturación:
--        - 1er hijo ......... 100% de la tarifa regular
--        - 2do hijo ......... 10% de descuento
--        - 3er hijo o más ... 15% de descuento
--      Agrupación por parent_id O p1_email (familias multi-estudiante),
--      ordenando por start_date (nulls last) y luego id.
--   2. Ajuste flexible del monto de una mensualidad por la Directora/Asistente
--      incluso en pagos ya aprobados (con auditoría y motivo), vía la RPC
--      update_payment_amount.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Permite a directora/asistente/admin ajustar SOLO el monto de pagos
--    aprobados. El resto de modificaciones/eliminaciones sigue bloqueado.
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

-- ───────────────────────────────────────────────────────────────────────────
-- 2. RPC segura para actualizar el monto de un pago (con auditoría).
--    Solo directora/asistente/admin. Aplica a pendientes, vencidos, en
--    revisión y aprobados.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_payment_amount(p_payment_id bigint, p_amount numeric, p_reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role    text;
  v_before  numeric;
  v_month   text;
  v_concept text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden ajustar montos';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 999999 THEN
    RAISE EXCEPTION 'Monto inválido (0 - 999999)';
  END IF;

  SELECT amount, month_paid, concept INTO v_before, v_month, v_concept
  FROM public.payments WHERE id = p_payment_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pago no encontrado'; END IF;

  IF v_before = p_amount THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'amount', p_amount);
  END IF;

  UPDATE public.payments
  SET amount    = p_amount,
      notes     = COALESCE(NULLIF(notes,'') || ' | ', '') ||
                  'Monto ajustado: ' || v_before::numeric::text || ' -> ' || p_amount::numeric::text ||
                  CASE WHEN coalesce(p_reason,'') <> '' THEN ' (' || p_reason || ')' ELSE '' END,
      updated_at = now()
  WHERE id = p_payment_id;

  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (auth.uid(), 'payment.amount_updated',
    jsonb_build_object(
      'payment_id', p_payment_id,
      'old_amount', v_before,
      'new_amount', p_amount,
      'month_paid', v_month,
      'concept',    v_concept,
      'reason',     p_reason
    ), now())
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'changed', true, 'old_amount', v_before, 'amount', p_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_payment_amount(bigint, numeric, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Helper: rango del estudiante dentro de su familia (hermanos activos).
--    Familia = comparte parent_id O p1_email. Rango 1 = hermano mayor.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_student_family_rank(p_student_id bigint)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent uuid;
  v_email  text;
  v_rank   int;
BEGIN
  SELECT parent_id, lower(trim(p1_email)) INTO v_parent, v_email
  FROM public.students WHERE id = p_student_id;

  IF v_parent IS NULL AND (v_email IS NULL OR v_email = '') THEN
    RETURN 1;
  END IF;

  WITH family AS (
    SELECT s.id
    FROM public.students s
    WHERE s.is_active = TRUE
      AND s.deleted_at IS NULL
      AND (
        (v_parent IS NOT NULL AND s.parent_id = v_parent)
        OR (v_email IS NOT NULL AND v_email <> '' AND lower(trim(s.p1_email)) = v_email)
      )
  ),
  ranked AS (
    SELECT f.id,
           ROW_NUMBER() OVER (
             ORDER BY (SELECT s.start_date FROM public.students s WHERE s.id = f.id) NULLS LAST,
                      f.id
           ) AS rn
    FROM family f
  )
  SELECT rn INTO v_rank FROM ranked WHERE id = p_student_id;

  RETURN COALESCE(v_rank, 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_family_rank(bigint) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Ciclo de pagos con descuento por hermanos.
--    Regla progresiva: 1er hijo 100% · 2do 10% · 3ro+ 15% sobre monthly_fee.
--    Se aplica SOLO al concepto 'Mensualidad' (el día prolongado se cobra al
--    100%). El monto se redondea a 2 decimales.
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
  v_generated     int := 0;
  v_expired       int := 0;
  v_student       record;
  v_start_day     int;
  v_first_billing text;
  v_first_m       int;
  v_first_y       int;
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

  FOR v_student IN
    SELECT s.id, s.monthly_fee, s.prolongado_fee, s.start_date
    FROM public.students s
    WHERE s.is_active = true AND s.monthly_fee > 0 AND s.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id AND p.month_paid = v_target_month AND p.concept = 'Mensualidad' AND p.deleted_at IS NULL
      )
  LOOP
    IF v_student.start_date IS NOT NULL THEN
      v_start_day := EXTRACT(DAY FROM v_student.start_date)::int;
      IF v_start_day < v_gen_day THEN
        v_first_m := EXTRACT(MONTH FROM v_student.start_date)::int;
        v_first_y := EXTRACT(YEAR FROM v_student.start_date)::int;
        IF v_first_m = 12 THEN v_first_m := 1; v_first_y := v_first_y + 1;
        ELSE v_first_m := v_first_m + 1; END IF;
      ELSE
        v_first_m := EXTRACT(MONTH FROM v_student.start_date)::int + 2;
        v_first_y := EXTRACT(YEAR FROM v_student.start_date)::int;
        IF v_first_m > 12 THEN v_first_m := v_first_m - 12; v_first_y := v_first_y + 1; END IF;
      END IF;
      v_first_billing := v_first_y || '-' || LPAD(v_first_m::text, 2, '0');
      IF v_target_month < v_first_billing THEN CONTINUE; END IF;
    END IF;

    -- Descuento por hermanos (regla progresiva)
    v_rank := public.get_student_family_rank(v_student.id);
    IF v_rank >= 3 THEN     v_discount := 0.15;
    ELSIF v_rank = 2 THEN   v_discount := 0.10;
    ELSE                    v_discount := 0; END IF;
    v_amount := round((v_student.monthly_fee * (1 - v_discount))::numeric, 2);

    INSERT INTO public.payments (student_id, amount, status, due_date, month_paid, concept, created_at)
    VALUES (v_student.id, v_amount, 'pending', v_due_date, v_target_month, 'Mensualidad', now())
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
-- 5. Vista previa del ciclo con el descuento por hermanos aplicado al
--    total estimado, para que coincida con la ejecución real.
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
    SELECT s.id, s.monthly_fee, s.prolongado_fee
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
           public.get_student_family_rank(t.id) AS family_rank
    FROM to_bill t
  ),
  with_amount AS (
    SELECT round((monthly_fee * (1 - CASE WHEN family_rank >= 3 THEN 0.15
                                        WHEN family_rank = 2 THEN 0.10
                                        ELSE 0 END))::numeric, 2) + coalesce(prolongado_fee, 0) AS bill
    FROM ranked
  )
  SELECT count(*), coalesce(sum(bill), 0) INTO v_gen_count, v_total_amount FROM with_amount;

  SELECT count(DISTINCT student_id) INTO v_existing_count
  FROM public.payments WHERE month_paid = v_target_month AND deleted_at IS NULL;

  RETURN jsonb_build_object('target_month', v_target_month, 'count', v_gen_count,
    'total_amount', v_total_amount, 'existing_count', v_existing_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.preview_payment_cycle() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN MIGRACIÓN 13
-- ═══════════════════════════════════════════════════════════════════════════