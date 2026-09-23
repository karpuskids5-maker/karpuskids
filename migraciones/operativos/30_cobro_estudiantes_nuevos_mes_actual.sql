-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 30: Los estudiantes NUEVOS ya no se cobran el año completo
-- ─────────────────────────────────────────────────────────────────────────
-- PROBLEMA (reportado por la directora):
--   Al admitir a un estudiante nuevo (12/9/2026) se le generaban de golpe:
--     · Inscripción vencida el 5/9 (antes de su matrícula)  → nacía con MORA
--     · Las 10 mensualidades (sept 2026 – jun 2027) pre-generadas
--   El padre entonces veía 10 pagos pendientes + recargo de mora cuando lo
--   correcto es: SOLO se cobra el mes del ciclo y el cobro aparece a partir
--   del día de generación (25).
--
-- REGLA DE NEGOCIO (nuevos estudiantes):
--   1. Inscripción              → se genera al admitir, vence el día 25 del mes.
--   2. Mensualidad del mes en curso → se genera SOLO cuando hoy ya es el día
--      de generación (25) o posterior. Antes del 25 el padre NO ve ningún cobro.
--   3. Mensualidades siguientes  → las genera el ciclo automático
--      (auto-payment-cycle / run_payment_cycle) cada día 25. NUNCA se crean
--      meses futuros al admitir.
--
-- CAMBIOS:
--   A. generate_student_charges  → deja de adelantar el plan completo.
--   B. Trigger sync_current_month_payment → ya no crea "el próximo mes"
--      antes del 25 (era la causa de que reaparecieran meses futuros).
--   C. run_payment_cycle         → no genera cobros antes del día 25.
--   D. Cron de pg_cron           → corre diario (sin force) para que la
--      generación arranque naturalmente el día 25.
--   E. Limpieza de datos         → estudiantes con start_date en 2026-09:
--      queda ÚNICAMENTE la mensualidad de septiembre (vence 25/9).
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- A. generate_student_charges (admisión de nuevos)
-- ═══════════════════════════════════════════════════════════════
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
  v_gen_day        int;
  v_due_day        int;
  v_curr           date    := current_date;
  v_start_date     date;
  v_first_due      date;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden generar cargos';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'El estudiante no existe';
  END IF;

  SELECT COALESCE(generation_day, 25), COALESCE(due_day, 5)
    INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  v_start_month := COALESCE(p_start_month, to_char(v_curr, 'YYYY-MM'));
  v_discount    := GREATEST(0, LEAST(COALESCE(p_discount_pct, 0), 100));
  v_month_net   := round(COALESCE(p_monthly_amount, 0) * (1 - v_discount / 100), 2);
  v_prolong_net := round(COALESCE(p_prolongado_fee, 0) * (1 - v_discount / 100), 2);

  v_start_date := to_date(v_start_month || '-01', 'YYYY-MM-DD');
  -- Inscripción y 1ª mensualidad vencen el día de generación del mes de inicio
  v_first_due  := (v_start_date + (v_gen_day - 1) * interval '1 day')::date;
  -- Si la admisión ocurre DESPUÉS del día de generación (ej.: el 28), se iguala
  -- a hoy para que ningún cobro "nazca vencido" con mora.
  IF v_first_due < v_curr THEN v_first_due := v_curr; END IF;

  -- ── Inscripción (siempre se genera, vence el día 25 del mes de inicio) ──
  IF COALESCE(p_inscription_amount, 0) > 0 THEN
    v_insc_net := round(p_inscription_amount * (1 - v_discount / 100), 2);

    INSERT INTO public.student_charges
      (student_id, concept, type, amount, discount_pct, amount_net, due_date, status, created_by)
    VALUES (p_student_id, 'Inscripción', 'inscripcion',
            p_inscription_amount, v_discount, v_insc_net, v_first_due, 'pending', auth.uid())
    ON CONFLICT DO NOTHING;

    INSERT INTO public.payments
      (student_id, amount, concept, status, due_date, created_at)
    VALUES (p_student_id, v_insc_net, 'Inscripción', 'pending', v_first_due, now())
    ON CONFLICT DO NOTHING;

    v_charges  := v_charges + 1;
    v_payments := v_payments + 1;
  END IF;

  -- ── Planes que el padre paga por adelantado (cuota única / dos semestres) ──
  IF p_plan = 'unico' THEN
    v_tot_net := v_month_net * GREATEST(p_months, 1);
    v_due     := v_first_due;

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

    v_charges  := v_charges + 1;
    v_payments := v_payments + 1;

  ELSIF p_plan = 'doble' THEN
    v_half := floor(GREATEST(p_months, 1) / 2.0)::int;
    FOR v_i IN 0..1 LOOP
      v_sem_mes := to_char(v_start_date + (v_i * v_half) * interval '1 month', 'YYYY-MM');
      v_tot_net := v_month_net * (GREATEST(p_months, 1) - v_i * v_half);
      IF v_i = 0 THEN
        v_due := v_first_due;
      ELSE
        v_due := (to_date(v_sem_mes || '-01', 'YYYY-MM-DD')
                  + (v_due_day - 1) * interval '1 day')::date;
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

      v_charges  := v_charges + 1;
      v_payments := v_payments + 1;
    END LOOP;

  ELSE
    -- ── Plan mensual: NUNCA se adelanta el año completo. ──
    -- Se genera SOLO el mes actual si hoy ya pasó el día de generación (25).
    -- Antes del 25: el padre no ve ningún cobro (lo genera el ciclo el día 25).
    -- Los meses siguientes los crea auto-payment-cycle / run_payment_cycle
    -- cada día 25 del mes correspondiente.
    IF EXTRACT(DAY FROM v_curr)::int >= v_gen_day
       AND to_char(v_curr, 'YYYY-MM') >= v_start_month
    THEN
      v_month := to_char(v_curr, 'YYYY-MM');

      IF v_month = v_start_month THEN
        -- 1ª mensualidad → vence el día de generación del mes de inicio
        v_due := v_first_due;
      ELSE
        v_due := (to_date(v_month || '-01', 'YYYY-MM-DD')
                  + (v_due_day - 1) * interval '1 day')::date;
      END IF;

      -- Evitar que un cobro creado "tarde" en el mes (tras el 25) nazca
      -- ya vencido con mora. Si el vencimiento cayó antes de hoy, se difiere.
      IF v_due < v_curr THEN v_due := v_curr; END IF;

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

      v_charges  := v_charges + 1;
      v_payments := v_payments + 1;

      IF v_prolong_net > 0 THEN
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

        v_charges  := v_charges + 1;
        v_payments := v_payments + 1;
      END IF;
    END IF;
  END IF;

  UPDATE public.students
     SET monthly_fee    = COALESCE(p_monthly_amount,   monthly_fee),
         prolongado_fee = COALESCE(p_prolongado_fee,   prolongado_fee),
         due_day        = COALESCE(p_due_day,           due_day),
         discount_pct   = v_discount,
         payment_plan   = p_plan
   WHERE id = p_student_id;

  RETURN jsonb_build_object('charges', v_charges, 'payments', v_payments,
                             'plan', p_plan, 'start_month', v_start_month,
                             'first_due', v_first_due::text);
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_student_charges(bigint,text,numeric,numeric,numeric,numeric,int,int,text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- B. Trigger sync_current_month_payment
--    Antes: si faltaban días para el 25, generaba el cobro del MES SIGUIENTE
--    (octubre cuando un niño se matriculaba el 12/9) en CADA actualización
--    del estudiante → por eso reaparecían meses futuros tras cada limpieza.
--    Ahora: solo genera el mes ACTUAL cuando ya pasó el día de generación.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.sync_current_month_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gen_day int;
  v_due_day int;
  v_now     date := current_date;
  v_tm      text;
  v_due     date;
  v_last_day date;
  v_rank    int;
  v_disc    numeric;
  v_amount  numeric;
BEGIN
  IF (NEW.is_active IS NOT FALSE) AND COALESCE(NEW.monthly_fee, 0) > 0 AND NEW.deleted_at IS NULL THEN
    SELECT COALESCE(generation_day, 25), COALESCE(due_day, 5)
      INTO v_gen_day, v_due_day
    FROM public.school_settings WHERE id = 1;

    -- Regla del 25: antes del día de generación no se cobra a nadie.
    IF EXTRACT(DAY FROM v_now)::int < v_gen_day THEN
      RETURN NEW;
    END IF;

    -- Mes en facturación: el actual (ya pasó el día de generación)
    v_tm       := to_char(v_now, 'YYYY-MM');
    v_last_day := (date_trunc('month', v_now) + interval '1 month - 1 day')::date;

    -- No cobrar a estudiantes que aún no inician (mes futuro)
    IF NEW.start_date IS NOT NULL AND NEW.start_date > v_last_day THEN
      RETURN NEW;
    END IF;

    -- Vencimiento: día 5 del mes siguiente (igual que el ciclo normal)
    v_due := (date_trunc('month', v_now + interval '1 month')
              + (v_due_day - 1) * interval '1 day')::date;

    IF NOT EXISTS (
      SELECT 1 FROM public.payments
      WHERE student_id = NEW.id AND concept = 'Mensualidad'
        AND month_paid = v_tm AND deleted_at IS NULL
    ) THEN
      v_rank := public.get_student_family_rank(NEW.id);
      IF v_rank >= 3 THEN     v_disc := 0.15;
      ELSIF v_rank = 2 THEN   v_disc := 0.10;
      ELSE                    v_disc := 0; END IF;
      v_amount := round((NEW.monthly_fee * (1 - v_disc))::numeric, 2);

      INSERT INTO public.payments
        (student_id, amount, status, due_date, month_paid, concept, created_at)
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

-- ═══════════════════════════════════════════════════════════════
-- C. run_payment_cycle — respeta el día de generación (25)
--    Antes del 25 NO genera cobros nuevos (solo marca vencidos).
-- ═══════════════════════════════════════════════════════════════
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

  -- Regla del 25: antes de esa fecha el padre no ve cobros nuevos.
  IF EXTRACT(DAY FROM v_now)::int < v_gen_day THEN
    UPDATE public.payments SET status = 'overdue', updated_at = now()
    WHERE status = 'pending' AND due_date < v_now AND deleted_at IS NULL;
    GET DIAGNOSTICS v_expired = ROW_COUNT;
    RETURN jsonb_build_object('generated', 0, 'expired', v_expired,
                              'month', to_char(v_now, 'YYYY-MM'),
                              'skipped', 'antes del día de generación (' || v_gen_day || ')');
  END IF;

  v_target_month := to_char(v_now, 'YYYY-MM');
  v_due_date     := (date_trunc('month', v_now + interval '1 month')
                     + (v_due_day - 1) * interval '1 day')::date;
  v_last_day     := (date_trunc('month', v_now) + interval '1 month - 1 day')::date;

  FOR v_student IN
    SELECT s.id, s.monthly_fee, s.prolongado_fee, s.start_date,
           COALESCE(s.discount_pct,0) AS discount_pct
    FROM public.students s
    WHERE s.is_active = true AND s.monthly_fee > 0 AND s.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id AND p.month_paid = v_target_month
          AND p.concept = 'Mensualidad' AND p.deleted_at IS NULL
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

  RETURN jsonb_build_object('generated', v_generated, 'expired', v_expired,
                            'month', v_target_month, 'due_date', v_due_date::text);
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_payment_cycle() TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- D. Cron de pg_cron — ciclo diario SIN force
--    Así la generación arranca de forma natural el día 25 (la función
--    auto-payment-cycle tiene su propio candado con generation_day).
--    Reemplaza el cron anterior que forzaba el cobro el día 1 del mes.
-- ═══════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_fx_url      text := 'https://TU_REF.supabase.co/functions/v1/auto-payment-cycle';
  v_service_key text := 'SERVICE_ROLE_KEY';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Quitar SIEMPRE el cron viejo (forzaba el cobro el día 1 del mes)
    BEGIN PERFORM cron.unschedule('karpus-payment-cycle'); EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Solo re-agendar el ciclo diario si los placeholders ya fueron reemplazados
    IF position('TU_REF' in v_fx_url) = 0 THEN
      PERFORM cron.schedule('karpus-payment-cycle','0 10 * * *',
        format($c$SELECT net.http_post(url:='%s',headers:='{"Content-Type":"application/json","Authorization":"Bearer %s"}'::jsonb,body:='{}'::jsonb);$c$,
               v_fx_url, v_service_key));
      RAISE NOTICE 'Cron karpus-payment-cycle reprogramado a diario (genera desde el día 25).';
    ELSE
      RAISE NOTICE 'Cron NO reprogramado: reemplaza TU_REF y SERVICE_ROLE_KEY en la Parte D. Entre tanto, el ciclo se puede correr a mano con run_payment_cycle() desde el día 25.';
    END IF;
  ELSE
    RAISE NOTICE 'pg_cron no instalado. Activar en Dashboard → Database → Extensions';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- E. LIMPIEZA DE DATOS — estudiantes nuevos con start_date en 2026-09
--    Sigue el criterio de las migraciones 28/29:
--      · Archivar todos sus pagos pendientes/vencidos actuales (incl. la
--        inscripción que nació vencida el 5/9 y las mensualidades futuras).
--      · Eliminar sus student_charges pendientes/vencidos.
--      · Crear UN SOLO cobro: Mensualidad 2026-09, monto = monthly_fee real,
--        vence el día de generación (25/9/2026), status = pending.
--    Los meses siguientes (oct 2026 en adelante) los generará el ciclo
--    automático cada día 25.
-- ═══════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_student       RECORD;
  v_gen_day       int := 25;
  v_first_due     date := '2026-09-25';
  v_target_month  text := '2026-09';
  v_fixed_count   int := 0;
BEGIN
  SELECT COALESCE(generation_day, 25) INTO v_gen_day
  FROM public.school_settings WHERE id = 1;
  v_first_due := make_date(2026, 9, v_gen_day);

  -- Deshabilitar trigger mientras limpiamos (evita re-generar al actualizar)
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_month_payment'
      AND tgrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students DISABLE TRIGGER trg_sync_month_payment;
  END IF;

  -- Todos los estudiantes activos con start_date en septiembre 2026 y que
  -- tengan cobros problemáticos (inscripción vencida o meses futuros).
  -- Solo se tocan pagos CREADOS en el mismo mes de la matrícula (sept 2026):
  -- así un cobro legítimo de octubre (generado el 25/10) jamás se archiva.
  FOR v_student IN
    SELECT s.id, s.name, s.last_name, s.monthly_fee
    FROM public.students s
    WHERE s.is_active = true
      AND s.deleted_at IS NULL
      AND to_char(s.start_date, 'YYYY-MM') = v_target_month
      AND EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id
          AND p.deleted_at IS NULL
          AND p.status IN ('pending', 'overdue')
          AND p.created_at >= '2026-09-01' AND p.created_at < '2026-10-01'
          AND (
            (p.concept = 'Inscripción' AND p.due_date < v_first_due)
            OR
            (p.concept = 'Mensualidad' AND p.month_paid > v_target_month)
          )
      )
  LOOP
    RAISE NOTICE 'Corrigiendo estudiante: % % (id=%)', v_student.name, v_student.last_name, v_student.id;

    -- 1. Archivar TODO pago pendiente/vencido creado en el mes de la matrícula
    UPDATE public.payments
       SET deleted_at = now(), updated_at = now()
     WHERE student_id = v_student.id
       AND deleted_at IS NULL
       AND status IN ('pending', 'overdue')
       AND created_at >= '2026-09-01' AND created_at < '2026-10-01';

    -- 2. Eliminar student_charges erróneos creados en el mes de la matrícula
    DELETE FROM public.student_charges
     WHERE student_id = v_student.id
       AND status IN ('pending', 'overdue')
       AND created_at >= '2026-09-01' AND created_at < '2026-10-01';

    -- 3. Crear el ÚNICO cobro correcto: Mensualidad septiembre, vence 25/9.
    --    Monto = monthly_fee real; si fuera 0, se recupera del pago de sept
    --    recién archivado; fallback 1500.
    INSERT INTO public.payments
      (student_id, amount, concept, status, due_date, month_paid, created_at)
    SELECT
      v_student.id,
      COALESCE(
        NULLIF(v_student.monthly_fee, 0),
        (SELECT amount FROM public.payments
         WHERE student_id = v_student.id
           AND concept = 'Mensualidad'
           AND month_paid = v_target_month
           AND deleted_at IS NOT NULL
         ORDER BY deleted_at DESC LIMIT 1),
        1500
      ),
      'Mensualidad', 'pending', v_first_due, v_target_month, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.payments
      WHERE student_id = v_student.id
        AND concept = 'Mensualidad'
        AND month_paid = v_target_month
        AND deleted_at IS NULL
    );

    -- 4. Cargo equivalente en student_charges
    INSERT INTO public.student_charges
      (student_id, concept, type, amount, discount_pct, amount_net,
       month_paid, due_date, status, created_by)
    SELECT
      v_student.id, 'Mensualidad', 'mensualidad',
      COALESCE(NULLIF(v_student.monthly_fee, 0),
        (SELECT amount FROM public.payments
         WHERE student_id = v_student.id
           AND concept = 'Mensualidad'
           AND month_paid = v_target_month
           AND deleted_at IS NULL
         LIMIT 1), 1500),
      0,
      COALESCE(NULLIF(v_student.monthly_fee, 0),
        (SELECT amount FROM public.payments
         WHERE student_id = v_student.id
           AND concept = 'Mensualidad'
           AND month_paid = v_target_month
           AND deleted_at IS NULL
         LIMIT 1), 1500),
      v_target_month, v_first_due, 'pending',
      (SELECT id FROM public.profiles WHERE role = 'directora' LIMIT 1)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.student_charges
      WHERE student_id = v_student.id
        AND type = 'mensualidad'
        AND month_paid = v_target_month
    );

    v_fixed_count := v_fixed_count + 1;
  END LOOP;

  -- Reactivar trigger
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_month_payment'
      AND tgrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students ENABLE TRIGGER trg_sync_month_payment;
  END IF;

  RAISE NOTICE 'Total de estudiantes corregidos: %', v_fixed_count;

  -- Verificación final por estudiante (pagos activos)
  RAISE NOTICE '═ Resultado final (pagos activos de nuevos sept-2026) ═';
  FOR v_student IN
    SELECT s.id, s.name, s.last_name,
           count(p.id) AS activos
    FROM public.students s
    LEFT JOIN public.payments p
           ON p.student_id = s.id AND p.deleted_at IS NULL
    WHERE s.is_active = true AND s.deleted_at IS NULL
      AND to_char(s.start_date, 'YYYY-MM') = '2026-09'
    GROUP BY s.id, s.name, s.last_name
    ORDER BY s.name
  LOOP
    RAISE NOTICE '  % % → % pago(s) activo(s)', v_student.name, v_student.last_name, v_student.activos;
  END LOOP;
END;
$$;