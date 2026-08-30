-- ═══════════════════════════════════════════════════════════════════
-- 15_auto_cobro_mes_actual
-- Objetivo:
--   1. El ciclo de pagos factura a TODOS los estudiantes activos con
--      cuota real (>0) del mes actual (sin diferir a quienes ya estaban
--      inscritos dentro del mes). Solo se omiten estudiantes cuya
--      fecha de inicio (start_date) es en un MES FUTURO.
--   2. Trigger: cuando la directora asigna la cuota real a un estudiante
--      activo, se genera automáticamente el cobro del mes visible, para
--      que aparezca de inmediato en el control de cobro de la directora
--      y en la sección de pago del padre.
--   3. Backfill: genera ahora los cobros del mes actual que estén
--      faltando (estudiantes activos con cuota real que no tienen cobro).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Reescritura de run_payment_cycle ────────────────────────────
-- Reemplaza la regla "si entró antes del día 25 no se le cobra el mes"
-- por: se le cobra el mes actual siempre que ya estuviera inscrito a más
-- tardar el último día del mes objetivo (evita cobrar a futuros).
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
  v_last_day     := (date_trunc('month', v_now) + interval '1 month - 1 day')::date; -- último día del mes objetivo

  FOR v_student IN
    SELECT s.id, s.monthly_fee, s.prolongado_fee, s.start_date
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

-- ── 2. Trigger: cobro automático del mes visible al asignar cuota ──
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
      v_amount := round((NEW.monthly_fee * (1 - v_disc))::numeric, 2);

      INSERT INTO public.payments (student_id, amount, status, due_date, month_paid, concept, created_at)
      VALUES (NEW.id, v_amount, 'pending', v_due, v_tm, 'Mensualidad', now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_month_payment ON public.students;
CREATE TRIGGER trg_sync_month_payment
AFTER INSERT OR UPDATE ON public.students
FOR EACH ROW EXECUTE FUNCTION public.sync_current_month_payment();

-- ── 3. Backfill: generar ahora los cobros del mes actual faltantes ──
DO $$
DECLARE
  v_gen_day int; v_due_day int;
  v_now date := current_date;
  v_tm text; v_due date; v_last_day date;
  v_student record;
  v_rank int; v_disc numeric; v_amount numeric;
  v_count int := 0;
BEGIN
  SELECT COALESCE(generation_day,25), COALESCE(due_day,5) INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;
  IF EXTRACT(DAY FROM v_now)::int < v_gen_day THEN
    v_tm := to_char(v_now + interval '1 month', 'YYYY-MM');
    v_last_day := (date_trunc('month', v_now + interval '1 month') + interval '1 month - 1 day')::date;
  ELSE
    v_tm := to_char(v_now, 'YYYY-MM');
    v_last_day := (date_trunc('month', v_now) + interval '1 month - 1 day')::date;
  END IF;
  v_due := (date_trunc('month', (v_tm || '-15')::date + interval '1 month') + (v_due_day - 1) * interval '1 day')::date;

  FOR v_student IN
    SELECT s.id, s.monthly_fee
    FROM public.students s
    WHERE s.is_active = true AND s.monthly_fee > 0 AND s.deleted_at IS NULL
      AND (s.start_date IS NULL OR s.start_date <= v_last_day)
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id AND p.concept = 'Mensualidad' AND p.month_paid = v_tm AND p.deleted_at IS NULL
      )
  LOOP
    v_rank := public.get_student_family_rank(v_student.id);
    IF v_rank >= 3 THEN v_disc := 0.15;
    ELSIF v_rank = 2 THEN v_disc := 0.10;
    ELSE v_disc := 0; END IF;
    v_amount := round((v_student.monthly_fee * (1 - v_disc))::numeric, 2);

    INSERT INTO public.payments (student_id, amount, status, due_date, month_paid, concept, created_at)
    VALUES (v_student.id, v_amount, 'pending', v_due, v_tm, 'Mensualidad', now());
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Backfill %: % cobros generados', v_tm, v_count;
END;
$$;
