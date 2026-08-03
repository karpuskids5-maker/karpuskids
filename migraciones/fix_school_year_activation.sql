-- ═══════════════════════════════════════════════════════════════
-- FIX: Activación de Año Escolar + Sincronización de Períodos
-- ═══════════════════════════════════════════════════════════════
-- Este script:
-- 1. Activa el año escolar si existe pero está en draft
-- 2. Crea un año escolar si no existe (desde academic_periods)
-- 3. Sincroniza la tabla legacy `periods` → `academic_periods`
-- 4. Unifica get_active_period() para ambos sistemas
-- 5. Unifica close_period() para ambos sistemas
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_year_id bigint;
  v_year_record record;
  v_period record;
  v_count int;
  v_next_order int;
  v_sy_start date;
  v_sy_end date;
  v_today date := CURRENT_DATE;
BEGIN
  -- ── PASO 1: Buscar año escolar existente ────────────────────
  SELECT * INTO v_year_record
  FROM public.school_years
  WHERE status IN ('draft', 'enrollment', 'reenrollment', 'active')
  ORDER BY id DESC
  LIMIT 1;

  IF FOUND THEN
    -- Activar si está en draft
    IF v_year_record.status = 'draft' THEN
      UPDATE public.school_years
      SET status = 'active', updated_at = now()
      WHERE id = v_year_record.id;
      v_year_id := v_year_record.id;
      RAISE NOTICE 'Año escolar % activado (de draft a active)', v_year_record.name;
    ELSE
      v_year_id := v_year_record.id;
      RAISE NOTICE 'Año escolar % ya activo (status=%)', v_year_record.name, v_year_record.status;
    END IF;
  ELSE
    -- ── PASO 2: No hay año escolar → crearlo desde academic_periods ──
    SELECT MIN(start_date), MAX(end_date)
    INTO v_sy_start, v_sy_end
    FROM public.academic_periods;

    IF v_sy_start IS NULL THEN
      RAISE NOTICE 'No hay datos en academic_periods. Usando fechas por defecto.';
      v_sy_start := v_today;
      v_sy_end := v_today + interval '1 year';
    END IF;

    INSERT INTO public.school_years (name, start_date, end_date, status, created_at, updated_at)
    VALUES (
      EXTRACT(YEAR FROM v_sy_start)::text || '-' || (EXTRACT(YEAR FROM v_sy_start) + 1)::text,
      v_sy_start,
      v_sy_end,
      'active',
      now(), now()
    )
    RETURNING id INTO v_year_id;

    RAISE NOTICE 'Año escolar creado y activado (id=%)', v_year_id;
  END IF;

  -- ── PASO 3: Asegurar que academic_periods tenga school_year_id correcto ──
  UPDATE public.academic_periods
  SET school_year_id = v_year_id
  WHERE school_year_id IS NULL
     OR school_year_id NOT IN (SELECT id FROM public.school_years);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    RAISE NOTICE 'Actualizados % academic_periods con school_year_id=%', v_count, v_year_id;
  END IF;

  -- ── PASO 4: Sincronizar legacy periods → academic_periods ──
  FOR v_period IN
    SELECT p.*
    FROM public.periods p
    WHERE p.id NOT IN (
      SELECT ap.id::bigint FROM public.academic_periods ap
      WHERE ap.school_year_id = v_year_id
        AND ap.name = p.name
    )
  LOOP
    SELECT COALESCE(MAX(order_index), 0) + 1 INTO v_next_order
    FROM public.academic_periods
    WHERE school_year_id = v_year_id;

    INSERT INTO public.academic_periods
      (school_year_id, name, start_date, end_date, order_index, status, is_active, created_at)
    VALUES (
      v_year_id,
      v_period.name,
      v_period.start_date,
      v_period.end_date,
      v_next_order,
      v_period.status,
      v_period.is_active,
      COALESCE(v_period.created_at, now())
    )
    ON CONFLICT (school_year_id, order_index) DO NOTHING;

    RAISE NOTICE 'Sincronizado período legacy: %', v_period.name;
  END LOOP;

  -- ── PASO 5: Si no hay academic_periods, crear uno por defecto ──
  SELECT COUNT(*) INTO v_count FROM public.academic_periods WHERE school_year_id = v_year_id;

  IF v_count = 0 THEN
    INSERT INTO public.academic_periods
      (school_year_id, name, start_date, end_date, order_index, status, is_active, created_at)
    VALUES (
      v_year_id, 'Periodo 1', v_today, v_today + interval '6 months',
      1, 'open', true, now()
    );
    RAISE NOTICE 'Creado período por defecto (no había períodos)';
  END IF;

  -- ── PASO 6: Asegurar que exactamente UN academic_period esté activo ──
  IF NOT EXISTS (
    SELECT 1 FROM public.academic_periods
    WHERE school_year_id = v_year_id AND is_active = true AND status = 'open'
  ) THEN
    -- Activar el primer período pendiente
    UPDATE public.academic_periods
    SET is_active = true, status = 'open'
    WHERE id = (
      SELECT id FROM public.academic_periods
      WHERE school_year_id = v_year_id
      ORDER BY order_index
      LIMIT 1
    );
    RAISE NOTICE 'Primer período activado automáticamente';
  END IF;

  RAISE NOTICE '✅ Sincronización completada. Año escolar ID=% activo.', v_year_id;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- UNIFICAR: get_active_period — busca en academic_periods PRIMERO
-- y fallback a periods (legacy)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_active_period(p_classroom_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_result jsonb;
  v_ap record;
  v_p record;
BEGIN
  -- 1. Buscar en academic_periods (nuevo sistema)
  SELECT ap.*, sy.name AS school_year_name
  INTO v_ap
  FROM public.academic_periods ap
  JOIN public.school_years sy ON sy.id = ap.school_year_id
  WHERE ap.is_active = true AND ap.status = 'open'
    AND sy.status IN ('active', 'enrollment', 'reenrollment')
  ORDER BY ap.order_index
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'found', true,
      'id', v_ap.id,
      'name', v_ap.name,
      'start_date', v_ap.start_date,
      'end_date', v_ap.end_date,
      'status', v_ap.status,
      'is_active', v_ap.is_active,
      'school_year_id', v_ap.school_year_id,
      'school_year_name', v_ap.school_year_name,
      'order_index', v_ap.order_index,
      'source', 'academic_periods'
    );
  END IF;

  -- 2. Fallback: buscar en periods (legacy, por classroom)
  IF p_classroom_id IS NOT NULL THEN
    SELECT * INTO v_p
    FROM public.periods
    WHERE classroom_id = p_classroom_id
      AND status = 'open'
      AND is_active = true
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT * INTO v_p
      FROM public.periods
      WHERE classroom_id = p_classroom_id
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'found', true,
        'id', v_p.id,
        'name', v_p.name,
        'start_date', v_p.start_date,
        'end_date', v_p.end_date,
        'status', v_p.status,
        'is_active', v_p.is_active,
        'classroom_id', v_p.classroom_id,
        'source', 'periods'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('found', false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_active_period(bigint) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- UNIFICAR: close_period — cierra en academic_periods + periods
-- y ejecuta el cálculo de calificaciones V2 (de fix_grades_v2)
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.close_period(bigint);
CREATE OR REPLACE FUNCTION public.close_period(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ap_period      record;
  v_legacy_period  record;
  v_user_id        uuid;
  v_role           text;
  v_student        record;
  v_config         record;
  v_subject_avg    numeric(5,2);
  v_method         text;
  v_total_avg      numeric(5,2);
  v_subject_count  int;
  v_cards_created  int := 0;
  v_level          text;
  v_is_academic    boolean := false;
  v_next_period    record;
  v_legacy_ids     bigint[];
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora', 'admin') THEN
    RETURN jsonb_build_object('error', 'Solo la directora puede cerrar periodos');
  END IF;

  -- ── 1. Determinar si es academic_period o legacy period ─────────
  SELECT * INTO v_ap_period FROM public.academic_periods WHERE id = p_period_id;

  IF FOUND THEN
    v_is_academic := true;

    IF v_ap_period.status = 'closed' THEN
      RETURN jsonb_build_object('error', 'El período académico ya está cerrado');
    END IF;

    -- Cerrar en academic_periods
    UPDATE public.academic_periods
    SET status = 'closed', is_active = false
    WHERE id = p_period_id;

    -- Buscar academic_periods legacy vinculados (mismo nombre y fechas)
    SELECT array_agg(p.id) INTO v_legacy_ids
    FROM public.periods p
    WHERE p.name = v_ap_period.name
      AND p.start_date = v_ap_period.start_date
      AND p.end_date = v_ap_period.end_date;

    -- Buscar siguiente período
    SELECT * INTO v_next_period
    FROM public.academic_periods
    WHERE school_year_id = v_ap_period.school_year_id
      AND order_index = v_ap_period.order_index + 1;
  ELSE
    -- Es un legacy period
    SELECT * INTO v_legacy_period FROM public.periods WHERE id = p_period_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Periodo no encontrado');
    END IF;

    IF v_legacy_period.status = 'closed' THEN
      RETURN jsonb_build_object('error', 'El periodo ya está cerrado');
    END IF;

    -- Cerrar legacy
    UPDATE public.periods
    SET status = 'closed', is_active = false
    WHERE id = p_period_id;

    -- Buscar academic_periods que coincida
    SELECT * INTO v_ap_period
    FROM public.academic_periods
    WHERE name = v_legacy_period.name
      AND start_date = v_legacy_period.start_date
      AND end_date = v_legacy_period.end_date
    LIMIT 1;

    IF FOUND THEN
      UPDATE public.academic_periods
      SET status = 'closed', is_active = false
      WHERE id = v_ap_period.id;

      SELECT * INTO v_next_period
      FROM public.academic_periods
      WHERE school_year_id = v_ap_period.school_year_id
        AND order_index = v_ap_period.order_index + 1;
    END IF;
  END IF;

  -- ── 2. Cálculo de calificaciones V2 (sobre legacy periods) ──────
  -- Usar el legacy period_id para las tablas que aún FK a periods
  FOREACH v_config IN ARRAY COALESCE(v_legacy_ids, ARRAY[p_period_id])
  LOOP
    FOR v_student IN
      SELECT s.id AS student_id, s.name AS student_name, s.classroom_id
      FROM public.students s
      JOIN public.periods p ON p.id = v_config
      WHERE (p.classroom_id IS NULL OR s.classroom_id = p.classroom_id)
        AND s.is_active = true
    LOOP
      v_total_avg := 0;
      v_subject_count := 0;

      FOR v_config IN
        SELECT pc.id AS config_id, pc.subject_id, pc.activity_count, s.name AS subject_name
        FROM public.period_config pc
        JOIN public.subjects s ON s.id = pc.subject_id
        WHERE pc.period_id = v_config
      LOOP
        SELECT COUNT(*) INTO v_method
        FROM public.grades g
        JOIN public.activities a ON a.id = g.activity_id
        WHERE a.config_id = v_config.config_id
          AND g.student_id = v_student.student_id
          AND g.score_v2 IS NOT NULL;

        IF v_method::int >= 5 THEN
          v_method := 'best_5';
        ELSE
          v_method := 'all';
        END IF;

        IF v_method = 'best_5' THEN
          SELECT ROUND(AVG(score_v2), 2) INTO v_subject_avg
          FROM (
            SELECT g.score_v2
            FROM public.grades g
            JOIN public.activities a ON a.id = g.activity_id
            WHERE a.config_id = v_config.config_id
              AND g.student_id = v_student.student_id
              AND g.score_v2 IS NOT NULL
            ORDER BY g.score_v2 DESC
            LIMIT 5
          ) best_scores;
        ELSE
          SELECT ROUND(AVG(g.score_v2), 2) INTO v_subject_avg
          FROM public.grades g
          JOIN public.activities a ON a.id = g.activity_id
          WHERE a.config_id = v_config.config_id
            AND g.student_id = v_student.student_id
            AND g.score_v2 IS NOT NULL;
        END IF;

        IF v_subject_avg IS NOT NULL THEN
          INSERT INTO public.subject_averages (student_id, period_id, subject_id, average, graded_count, method)
          VALUES (
            v_student.student_id, v_config, v_config.subject_id,
            v_subject_avg, v_method::int,
            CASE WHEN v_method = 'best_5' THEN 'best_5' ELSE 'all' END
          )
          ON CONFLICT (student_id, period_id, subject_id) DO UPDATE SET
            average      = EXCLUDED.average,
            graded_count = EXCLUDED.graded_count,
            method       = EXCLUDED.method;

          v_total_avg := v_total_avg + v_subject_avg;
          v_subject_count := v_subject_count + 1;
        END IF;
      END LOOP;

      IF v_subject_count > 0 THEN
        v_total_avg := ROUND(v_total_avg / v_subject_count, 2);
      ELSE
        v_total_avg := NULL;
      END IF;

      v_level := CASE
        WHEN v_total_avg IS NULL THEN 'Sin calificar'
        WHEN v_total_avg >= 90   THEN 'Excelente'
        WHEN v_total_avg >= 80   THEN 'Bueno'
        WHEN v_total_avg >= 70   THEN 'En proceso'
        ELSE                          'Requiere apoyo'
      END;

      INSERT INTO public.report_cards (
        student_id, classroom_id, period_id,
        task_avg, formal_avg, final_score, level, generated_at
      )
      VALUES (
        v_student.student_id, v_student.classroom_id, v_config,
        v_total_avg, v_total_avg, v_total_avg, v_level, now()
      )
      ON CONFLICT (student_id, period_id) DO UPDATE SET
        task_avg     = EXCLUDED.task_avg,
        formal_avg   = EXCLUDED.formal_avg,
        final_score  = EXCLUDED.final_score,
        level        = EXCLUDED.level,
        generated_at = now();

      v_cards_created := v_cards_created + 1;
    END LOOP;
  END LOOP;

  -- ── 3. Avanzar al siguiente período o cerrar año ────────────────
  IF v_next_period.id IS NOT NULL THEN
    UPDATE public.academic_periods
    SET status = 'open', is_active = true
    WHERE id = v_next_period.id;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Período cerrado. Abierto: ' || v_next_period.name,
      'closed_period', COALESCE(v_ap_period.name, v_legacy_period.name),
      'opened_period', v_next_period.name,
      'next_period_id', v_next_period.id,
      'cards_generated', v_cards_created
    );
  ELSE
    -- No hay más períodos: cerrar el año escolar
    IF v_ap_period.school_year_id IS NOT NULL THEN
      UPDATE public.school_years
      SET status = 'closed', updated_at = now()
      WHERE id = v_ap_period.school_year_id;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Último período cerrado. Año escolar cerrado.',
      'closed_period', COALESCE(v_ap_period.name, v_legacy_period.name),
      'year_closed', true,
      'cards_generated', v_cards_created
    );
  END IF;

  -- Auditoría
  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (v_user_id, 'period.closed', jsonb_build_object(
    'period_id', p_period_id,
    'period_name', COALESCE(v_ap_period.name, v_legacy_period.name),
    'cards_generated', v_cards_created,
    'source', CASE WHEN v_is_academic THEN 'academic_periods' ELSE 'periods' END
  ), now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.close_period(bigint) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- MEJORAR: get_school_year_status — ahora también busca
-- academic_periods como fallback si no hay año activo
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_school_year_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_year record;
  v_today date := CURRENT_DATE;
  v_result jsonb;
  v_enrollment_open boolean := false;
  v_reenrollment_open boolean := false;
  v_active_period jsonb;
  v_days_remaining integer;
  v_ap_count int;
BEGIN
  -- 1. Buscar año activo normal
  SELECT * INTO v_year
  FROM public.school_years
  WHERE status IN ('active', 'enrollment', 'reenrollment')
  LIMIT 1;

  -- 2. Si no hay, buscar año en draft y activarlo
  IF NOT FOUND THEN
    SELECT * INTO v_year
    FROM public.school_years
    WHERE status = 'draft'
    ORDER BY id DESC
    LIMIT 1;

    IF FOUND THEN
      UPDATE public.school_years SET status = 'active', updated_at = now() WHERE id = v_year.id;
    END IF;
  END IF;

  -- 3. Si aún no hay, buscar academic_periods huérfanos
  IF NOT FOUND THEN
    SELECT COUNT(*) INTO v_ap_count FROM public.academic_periods;
    IF v_ap_count > 0 THEN
      RETURN jsonb_build_object(
        'has_active_year', false,
        'status', 'orphan_periods',
        'message', 'Existen períodos sin año escolar activo. Ejecuta la migración fix_school_year_activation.sql',
        'orphan_count', v_ap_count
      );
    END IF;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'has_active_year', false,
      'status', 'none',
      'message', 'No hay año escolar configurado'
    );
  END IF;

  -- 4. Verificar ventanas
  IF v_year.enrollment_start IS NOT NULL AND v_year.enrollment_end IS NOT NULL THEN
    v_enrollment_open := v_today BETWEEN v_year.enrollment_start AND v_year.enrollment_end;
  END IF;
  IF v_year.reenrollment_start IS NOT NULL AND v_year.reenrollment_end IS NOT NULL THEN
    v_reenrollment_open := v_today BETWEEN v_year.reenrollment_start AND v_year.reenrollment_end;
  END IF;

  -- 5. Período activo
  v_active_period := public.get_active_period();

  -- 6. Días restantes
  v_days_remaining := GREATEST(0, (v_year.end_date - v_today)::int);

  v_result := jsonb_build_object(
    'has_active_year', true,
    'school_year_id', v_year.id,
    'school_year_name', v_year.name,
    'status', v_year.status,
    'start_date', v_year.start_date,
    'end_date', v_year.end_date,
    'enrollment_open', v_enrollment_open,
    'enrollment_window', jsonb_build_object('start', v_year.enrollment_start, 'end', v_year.enrollment_end),
    'reenrollment_open', v_reenrollment_open,
    'reenrollment_window', jsonb_build_object('start', v_year.reenrollment_start, 'end', v_year.reenrollment_end),
    'active_period', v_active_period,
    'days_remaining', v_days_remaining,
    'is_school_time', v_year.status = 'active' AND v_today BETWEEN v_year.start_date AND v_year.end_date
  );

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_school_year_status() TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- NUEVO: get_legacy_periods_for_sync — obtiene períodos legacy
-- para que el frontend los muestre mientras migra
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_legacy_periods_for_sync()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'start_date', p.start_date,
      'end_date', p.end_date,
      'status', p.status,
      'is_active', p.is_active,
      'classroom_id', p.classroom_id,
      'classroom_name', c.name
    ) ORDER BY p.start_date DESC
  ) INTO v_result
  FROM public.periods p
  LEFT JOIN public.classrooms c ON c.id = p.classroom_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_legacy_periods_for_sync() TO authenticated;
