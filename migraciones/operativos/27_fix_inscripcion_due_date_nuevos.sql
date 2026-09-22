-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 27: Corrección de due_date para estudiantes nuevos
-- ─────────────────────────────────────────────────────────────────────────
-- PROBLEMA:
--   generate_student_charges fijaba due_date = día 5 del mes actual para la
--   inscripción y la primera mensualidad, aunque el estudiante se inscribiera
--   después del día 5 → cobro nacía ya vencido.
--
-- REGLA CORRECTA (estudiantes nuevos):
--   · Inscripción            → vence el día `generation_day` (25) del mes de inicio
--   · 1ª mensualidad (sept)  → vence el día `generation_day` (25) del mes de inicio
--   · Mensualidades 2..N     → vencen el día `due_day` (5) del mes correspondiente
--     (igual que el ciclo normal run_payment_cycle)
--
-- CORRECCIÓN DE DATOS EXISTENTES:
--   Actualiza los pagos de Kyliam (y cualquier estudiante nuevo con due_date
--   ya vencido en el mismo mes de su start_date) al vencimiento correcto.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Reemplazar generate_student_charges con la lógica corregida
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_student_charges(
  p_student_id          bigint,
  p_plan                text    DEFAULT 'mensual',
  p_inscription_amount  numeric DEFAULT 0,
  p_monthly_amount      numeric DEFAULT 0,
  p_prolongado_fee      numeric DEFAULT 0,
  p_discount_pct        numeric DEFAULT 0,
  p_due_day             int     DEFAULT 5,
  p_months              int     DEFAULT 10,
  p_start_month         text    DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role           text;
  v_start_month    text;
  v_discount       numeric;
  v_month_net      numeric;
  v_prolong_net    numeric;
  v_tot_net        numeric;
  v_charges        int     := 0;
  v_payments       int     := 0;
  v_i              int;
  v_month          text;
  v_due            date;
  v_half           int;
  v_sem_mes        text;
  v_insc_net       numeric;
  v_gen_day        int;       -- día de generación del ciclo (25 por defecto)
  v_start_date     date;      -- primer día del mes de inicio
  v_first_due      date;      -- vencimiento para inscripción y 1ª mensualidad
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden generar cargos';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'El estudiante no existe';
  END IF;

  -- Leer generation_day desde school_settings (default 25)
  SELECT COALESCE(generation_day, 25) INTO v_gen_day
  FROM public.school_settings WHERE id = 1;

  v_start_month := COALESCE(p_start_month, to_char(current_date, 'YYYY-MM'));
  v_discount    := GREATEST(0, LEAST(COALESCE(p_discount_pct, 0), 100));
  v_month_net   := round(COALESCE(p_monthly_amount, 0) * (1 - v_discount / 100), 2);
  v_prolong_net := round(COALESCE(p_prolongado_fee, 0) * (1 - v_discount / 100), 2);

  -- Primer día del mes de inicio como date
  v_start_date := to_date(v_start_month || '-01', 'YYYY-MM-DD');

  -- Vencimiento especial para inscripción y 1ª mensualidad:
  -- día generation_day del mes de inicio (ej. 25 de septiembre)
  v_first_due := (v_start_date + (v_gen_day - 1) * interval '1 day')::date;

  -- ── Inscripción ──────────────────────────────────────────────────────────
  IF COALESCE(p_inscription_amount, 0) > 0 THEN
    v_insc_net := round(p_inscription_amount * (1 - v_discount / 100), 2);

    INSERT INTO public.student_charges
      (student_id, concept, type, amount, discount_pct, amount_net, due_date, status, created_by)
    VALUES (p_student_id, 'Inscripción', 'inscripcion',
            p_inscription_amount, v_discount, v_insc_net,
            v_first_due, 'pending', auth.uid())
    ON CONFLICT DO NOTHING;

    INSERT INTO public.payments
      (student_id, amount, concept, status, due_date, created_at)
    VALUES (p_student_id, v_insc_net, 'Inscripción', 'pending', v_first_due, now())
    ON CONFLICT DO NOTHING;

    v_charges  := v_charges  + 1;
    v_payments := v_payments + 1;
  END IF;

  -- ── Plan de mensualidades ─────────────────────────────────────────────────
  IF p_plan = 'unico' THEN
    v_tot_net := v_month_net * GREATEST(p_months, 1);
    -- Cuota única: vence el día generation_day del mes de inicio
    v_due := v_first_due;
    INSERT INTO public.student_charges
      (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
    VALUES (p_student_id, 'Cuota Única Anual', 'mensualidad',
            round(COALESCE(p_monthly_amount, 0) * GREATEST(p_months, 1), 2),
            v_discount, v_tot_net, v_start_month, v_due, 'pending', auth.uid())
    ON CONFLICT DO NOTHING;
    INSERT INTO public.payments
      (student_id, amount, concept, status, due_date, created_at)
    VALUES (p_student_id, v_tot_net, 'Cuota Única Anual', 'pending', v_due, now())
    ON CONFLICT DO NOTHING;
    v_charges  := v_charges  + 1;
    v_payments := v_payments + 1;

  ELSIF p_plan = 'doble' THEN
    v_half := floor(GREATEST(p_months, 1) / 2.0)::int;
    FOR v_i IN 0..1 LOOP
      v_sem_mes := to_char(v_start_date + (v_i * v_half) * interval '1 month', 'YYYY-MM');
      v_tot_net := v_month_net * (GREATEST(p_months, 1) - v_i * v_half);
      -- Primer semestre: generation_day del mes de inicio
      -- Segundo semestre: due_day del mes correspondiente (normal)
      IF v_i = 0 THEN
        v_due := v_first_due;
      ELSE
        v_due := (to_date(v_sem_mes || '-01', 'YYYY-MM-DD') + (p_due_day - 1) * interval '1 day')::date;
      END IF;
      INSERT INTO public.student_charges
        (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
      VALUES (p_student_id, CASE WHEN v_i = 0 THEN 'Semestre I' ELSE 'Semestre II' END,
              'mensualidad',
              round(COALESCE(p_monthly_amount, 0) * (GREATEST(p_months, 1) - v_i * v_half), 2),
              v_discount, v_tot_net, v_sem_mes, v_due, 'pending', auth.uid())
      ON CONFLICT DO NOTHING;
      INSERT INTO public.payments
        (student_id, amount, concept, status, due_date, created_at)
      VALUES (p_student_id, v_tot_net,
              CASE WHEN v_i = 0 THEN 'Semestre I' ELSE 'Semestre II' END,
              'pending', v_due, now())
      ON CONFLICT DO NOTHING;
      v_charges  := v_charges  + 1;
      v_payments := v_payments + 1;
    END LOOP;

  ELSE
    -- Plan mensual: mes 0 (inicio) vence el día generation_day,
    -- meses 1..N-1 vencen el día due_day del mes correspondiente
    FOR v_i IN 0 .. GREATEST(p_months, 1) - 1 LOOP
      v_month := to_char(v_start_date + v_i * interval '1 month', 'YYYY-MM');
      IF v_i = 0 THEN
        v_due := v_first_due;   -- septiembre → día 25
      ELSE
        v_due := (to_date(v_month || '-01', 'YYYY-MM-DD') + (p_due_day - 1) * interval '1 day')::date;
      END IF;
      INSERT INTO public.student_charges
        (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
      VALUES (p_student_id, 'Mensualidad', 'mensualidad',
              COALESCE(p_monthly_amount, 0), v_discount, v_month_net,
              v_month, v_due, 'pending', auth.uid())
      ON CONFLICT DO NOTHING;
      INSERT INTO public.payments
        (student_id, amount, concept, status, due_date, month_paid, created_at)
      VALUES (p_student_id, v_month_net, 'Mensualidad', 'pending', v_due, v_month, now())
      ON CONFLICT DO NOTHING;
      v_charges  := v_charges  + 1;
      v_payments := v_payments + 1;
    END LOOP;
  END IF;

  -- ── Día prolongado (mismas reglas de vencimiento que mensualidades) ────────
  IF v_prolong_net > 0 THEN
    FOR v_i IN 0 .. GREATEST(p_months, 1) - 1 LOOP
      v_month := to_char(v_start_date + v_i * interval '1 month', 'YYYY-MM');
      IF v_i = 0 THEN
        v_due := v_first_due;
      ELSE
        v_due := (to_date(v_month || '-01', 'YYYY-MM-DD') + (p_due_day - 1) * interval '1 day')::date;
      END IF;
      INSERT INTO public.student_charges
        (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
      VALUES (p_student_id, 'Día Prolongado', 'prolongado',
              COALESCE(p_prolongado_fee, 0), v_discount, v_prolong_net,
              v_month, v_due, 'pending', auth.uid())
      ON CONFLICT DO NOTHING;
      INSERT INTO public.payments
        (student_id, amount, concept, status, due_date, month_paid, created_at)
      VALUES (p_student_id, v_prolong_net, 'Día Prolongado', 'pending', v_due, v_month, now())
      ON CONFLICT DO NOTHING;
      v_charges  := v_charges  + 1;
      v_payments := v_payments + 1;
    END LOOP;
  END IF;

  UPDATE public.students
     SET monthly_fee    = COALESCE(p_monthly_amount,   monthly_fee),
         prolongado_fee = COALESCE(p_prolongado_fee,   prolongado_fee),
         due_day        = COALESCE(p_due_day,           due_day),
         discount_pct   = v_discount,
         payment_plan   = p_plan
   WHERE id = p_student_id;

  RETURN jsonb_build_object('charges', v_charges, 'payments', v_payments,
                             'start_month', v_start_month, 'first_due', v_first_due::text);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Corrección de datos existentes
--    Aplica a pagos pendientes/vencidos donde due_date ya pasó dentro del
--    mismo mes de start_date del estudiante (cobros creados antes de este fix).
--    Los reajusta al día generation_day de ese mes.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_gen_day int;
  v_fixed   int := 0;
BEGIN
  SELECT COALESCE(generation_day, 25) INTO v_gen_day
  FROM public.school_settings WHERE id = 1;

  -- Corregir inscripción y primera mensualidad con due_date vencido en el mes de inicio
  UPDATE public.payments p
  SET
    due_date   = (date_trunc('month', s.start_date) + (v_gen_day - 1) * interval '1 day')::date,
    status     = 'pending',
    updated_at = now()
  FROM public.students s
  WHERE p.student_id = s.id
    AND s.start_date IS NOT NULL
    AND p.deleted_at IS NULL
    AND p.status IN ('pending', 'overdue')
    -- El pago fue generado en el mismo mes que el inicio del estudiante
    AND to_char(p.due_date, 'YYYY-MM') = to_char(s.start_date, 'YYYY-MM')
    -- El due_date original es el día due_day (5), menor que generation_day (25)
    AND EXTRACT(DAY FROM p.due_date)::int < v_gen_day
    -- El estudiante se inscribió después del due_day original
    AND EXTRACT(DAY FROM s.start_date)::int > EXTRACT(DAY FROM p.due_date)::int;

  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  -- También corregir en student_charges
  -- NOTA: student_charges NO tiene las columnas deleted_at ni updated_at,
  -- por eso aquí solo se reasigna due_date/status.
  UPDATE public.student_charges sc
  SET
    due_date = (date_trunc('month', s.start_date) + (v_gen_day - 1) * interval '1 day')::date,
    status   = 'pending'
  FROM public.students s
  WHERE sc.student_id = s.id
    AND s.start_date IS NOT NULL
    AND sc.status IN ('pending', 'overdue')
    AND to_char(sc.due_date, 'YYYY-MM') = to_char(s.start_date, 'YYYY-MM')
    AND EXTRACT(DAY FROM sc.due_date)::int < v_gen_day
    AND EXTRACT(DAY FROM s.start_date)::int > EXTRACT(DAY FROM sc.due_date)::int;

  RAISE NOTICE 'Cobros corregidos en payments: %', v_fixed;
END;
$$;
