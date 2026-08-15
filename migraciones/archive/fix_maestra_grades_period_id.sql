-- ═══════════════════════════════════════════════════════════════
-- FIX: "Sin materias configuradas" en Calificaciones (panel maestra)
-- 
-- Causa raíz: get_active_period devolvía el id de academic_periods
-- (School Engine), pero period_config / activities / grades están
-- ligados al id de la tabla legacy "periods". Además, si el id de un
-- academic_period coincidía con un id legacy (colisión de identidad),
-- resolve_period_id devolvía el período legacy equivocado.
--
-- Solución (idempotente, se puede aplicar varias veces):
--   1. resolve_period_id revisa academic_periods PRIMERO (a prueba de
--      colisiones) y resuelve el id legacy por nombre + fechas.
--   2. get_active_period devuelve SIEMPRE el id legacy (el mismo que
--      usa get_grade_periods para configurar materias).
--   3. get_period_config / get_activities_with_grades /
--      get_student_grades_v2 / get_student_subject_averages resuelven
--      el id vía resolve_period_id (patrón de get_student_boletin).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Helper resolve_period_id (academic_periods primero) ───
DROP FUNCTION IF EXISTS public.resolve_period_id(bigint);
CREATE OR REPLACE FUNCTION public.resolve_period_id(p_period_id bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_legacy bigint;
  v_ap     record;
BEGIN
  -- Si el id pertenece a academic_periods, mapear SIEMPRE por nombre + fechas
  SELECT * INTO v_ap FROM public.academic_periods WHERE id = p_period_id;
  IF FOUND THEN
    SELECT p.id INTO v_legacy
    FROM public.periods p
    WHERE p.name = v_ap.name
      AND p.start_date = v_ap.start_date
      AND p.end_date = v_ap.end_date
    ORDER BY p.id
    LIMIT 1;

    IF v_legacy IS NULL THEN
      INSERT INTO public.periods (name, start_date, end_date, status, is_active)
      VALUES (
        v_ap.name, v_ap.start_date, v_ap.end_date,
        CASE WHEN v_ap.status IN ('open','closed') THEN v_ap.status ELSE 'open' END,
        v_ap.is_active
      )
      RETURNING id INTO v_legacy;
    END IF;

    RETURN v_legacy;
  END IF;

  -- No es academic_period: devolver el id tal cual (legacy periods)
  RETURN p_period_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_period_id(bigint) TO authenticated;

-- ── 1b. get_active_period — devuelve el id legacy ────────────
DROP FUNCTION IF EXISTS public.get_active_period(bigint);
CREATE OR REPLACE FUNCTION public.get_active_period(p_classroom_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_ap record; v_p record; v_legacy bigint;
BEGIN
  SELECT ap.*, sy.name AS school_year_name INTO v_ap
  FROM public.academic_periods ap
  JOIN public.school_years sy ON sy.id = ap.school_year_id
  WHERE ap.is_active = true AND ap.status = 'open'
    AND sy.status IN ('active','enrollment','reenrollment')
  ORDER BY ap.order_index LIMIT 1;
  IF FOUND THEN
    v_legacy := public.resolve_period_id(v_ap.id);
    RETURN jsonb_build_object('found',true,'id',v_legacy,'academic_period_id',v_ap.id,
      'name',v_ap.name,'start_date',v_ap.start_date,'end_date',v_ap.end_date,
      'status',v_ap.status,'is_active',v_ap.is_active,
      'school_year_id',v_ap.school_year_id,'school_year_name',v_ap.school_year_name,
      'order_index',v_ap.order_index,'source','academic_periods');
  END IF;
  IF p_classroom_id IS NOT NULL THEN
    SELECT * INTO v_p FROM public.periods
    WHERE classroom_id = p_classroom_id AND status = 'open' AND is_active = true ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
      SELECT * INTO v_p FROM public.periods WHERE classroom_id = p_classroom_id AND status = 'open' ORDER BY created_at DESC LIMIT 1;
    END IF;
    IF FOUND THEN
      RETURN jsonb_build_object('found',true,'id',v_p.id,'name',v_p.name,'start_date',v_p.start_date,
        'end_date',v_p.end_date,'status',v_p.status,'is_active',v_p.is_active,'classroom_id',v_p.classroom_id,'source','periods');
    END IF;
  END IF;
  RETURN jsonb_build_object('found',false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_active_period(bigint) TO authenticated;

-- ── 2. get_period_config id-agnóstico ───────────────────────
DROP FUNCTION IF EXISTS public.get_period_config(bigint);
CREATE OR REPLACE FUNCTION public.get_period_config(p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',pc.id,'subject_id',pc.subject_id,'subject_name',s.name,
    'education_level',s.education_level,'activity_count',pc.activity_count) ORDER BY s.name),'[]')
  FROM public.period_config pc JOIN public.subjects s ON s.id = pc.subject_id
  WHERE pc.period_id = public.resolve_period_id(p_period_id);
$$;
GRANT EXECUTE ON FUNCTION public.get_period_config(bigint) TO authenticated;

-- ── 3. get_activities_with_grades id-agnóstico ──────────────
DROP FUNCTION IF EXISTS public.get_activities_with_grades(bigint);
CREATE OR REPLACE FUNCTION public.get_activities_with_grades(p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',             a.id,
        'title',          a.title,
        'description',    a.description,
        'max_score',      a.max_score,
        'activity_number',a.activity_number,
        'is_mandatory',   a.is_mandatory,
        'config_id',      a.config_id,
        'subject_id',     pc.subject_id,
        'subject_name',   s.name,
        'grade_count',    COALESCE(g.grade_count, 0),
        'graded_count',   COALESCE(g.graded_count, 0)
      )
      ORDER BY s.name, a.activity_number
    ),
    '[]'::jsonb
  )
  FROM public.activities a
  JOIN public.period_config pc ON pc.id = a.config_id
  JOIN public.subjects s ON s.id = pc.subject_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS grade_count,
      COUNT(g.score_v2)::int AS graded_count
    FROM public.grades g
    WHERE g.activity_id = a.id
  ) g ON true
  WHERE pc.period_id = public.resolve_period_id(p_period_id);
$$;
GRANT EXECUTE ON FUNCTION public.get_activities_with_grades(bigint) TO authenticated;

-- ── 4. get_student_grades_v2 id-agnóstico ───────────────────
DROP FUNCTION IF EXISTS public.get_student_grades_v2(bigint, bigint);
CREATE OR REPLACE FUNCTION public.get_student_grades_v2(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('activity_id',g.activity_id,'score',g.score_v2,
    'subject_name',s.name,'activity_title',a.title,'activity_number',a.activity_number,'comment',g.notes)
    ORDER BY s.name, a.activity_number),'[]')
  FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
  JOIN public.period_config pc ON pc.id = a.config_id JOIN public.subjects s ON s.id = pc.subject_id
  WHERE g.student_id = p_student_id AND pc.period_id = public.resolve_period_id(p_period_id) AND g.score_v2 IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_grades_v2(bigint, bigint) TO authenticated;

-- ── 5. get_student_subject_averages id-agnóstico ────────────
DROP FUNCTION IF EXISTS public.get_student_subject_averages(bigint, bigint);
CREATE OR REPLACE FUNCTION public.get_student_subject_averages(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('subject_name',s.name,'average',sa.average,
    'graded_count',sa.graded_count,'method',sa.method) ORDER BY s.name),'[]')
  FROM public.subject_averages sa JOIN public.subjects s ON s.id = sa.subject_id
  WHERE sa.student_id = p_student_id AND sa.period_id = public.resolve_period_id(p_period_id);
$$;
GRANT EXECUTE ON FUNCTION public.get_student_subject_averages(bigint, bigint) TO authenticated;
