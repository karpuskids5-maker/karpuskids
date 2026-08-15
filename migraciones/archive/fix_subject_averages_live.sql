-- ── Promedios por materia EN TIEMPO REAL (fix panel padres/directora) ──
-- El Tablero de Progreso mostraba "Promedio — / Sin calificar / Materias 0"
-- durante períodos "En curso" porque get_student_subject_averages leía la
-- tabla subject_averages, que solo se llena al CERRAR el período.
-- Ahora calcula en vivo desde grades + task_evidences con la misma lógica
-- del boletín (mejores 5 si hay 5+ notas). Formato de respuesta idéntico.
CREATE OR REPLACE FUNCTION public.get_student_subject_averages(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period_id bigint;
  v_area      record;
  v_count     int;
  v_avg       numeric(5,2);
  v_result    jsonb := '[]'::jsonb;
BEGIN
  v_period_id := public.resolve_period_id(p_period_id);

  FOR v_area IN
    SELECT pc.subject_id, s.name AS subject_name
    FROM public.period_config pc
    JOIN public.subjects s ON s.id = pc.subject_id
    WHERE pc.period_id = v_period_id
    ORDER BY s.name
  LOOP
    SELECT (COALESCE(a_cnt,0) + COALESCE(t_cnt,0)) INTO v_count
    FROM (
      SELECT COUNT(*) AS a_cnt
      FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
      JOIN public.period_config pc ON pc.id = a.config_id
      WHERE pc.period_id = v_period_id AND pc.subject_id = v_area.subject_id
        AND g.student_id = p_student_id AND g.score_v2 IS NOT NULL
    ) a, (
      SELECT COUNT(*) AS t_cnt
      FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
      JOIN public.period_config pc ON pc.id = t.config_id
      WHERE pc.period_id = v_period_id AND pc.subject_id = v_area.subject_id
        AND te.student_id = p_student_id AND te.score_v2 IS NOT NULL
    ) b;

    IF v_count = 0 THEN CONTINUE; END IF;

    IF v_count >= 5 THEN
      SELECT ROUND(AVG(sv),2) INTO v_avg FROM (
        SELECT g.score_v2 AS sv
        FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
        JOIN public.period_config pc ON pc.id = a.config_id
        WHERE pc.period_id = v_period_id AND pc.subject_id = v_area.subject_id
          AND g.student_id = p_student_id AND g.score_v2 IS NOT NULL
        UNION ALL
        SELECT te.score_v2 AS sv
        FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
        JOIN public.period_config pc ON pc.id = t.config_id
        WHERE pc.period_id = v_period_id AND pc.subject_id = v_area.subject_id
          AND te.student_id = p_student_id AND te.score_v2 IS NOT NULL
        ORDER BY sv DESC
        LIMIT 5
      ) best_scores;
    ELSE
      SELECT ROUND(AVG(sv),2) INTO v_avg FROM (
        SELECT g.score_v2 AS sv
        FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
        JOIN public.period_config pc ON pc.id = a.config_id
        WHERE pc.period_id = v_period_id AND pc.subject_id = v_area.subject_id
          AND g.student_id = p_student_id AND g.score_v2 IS NOT NULL
        UNION ALL
        SELECT te.score_v2 AS sv
        FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
        JOIN public.period_config pc ON pc.id = t.config_id
        WHERE pc.period_id = v_period_id AND pc.subject_id = v_area.subject_id
          AND te.student_id = p_student_id AND te.score_v2 IS NOT NULL
      ) all_scores;
    END IF;

    v_result := v_result || jsonb_build_object(
      'subject_name', v_area.subject_name,
      'average',      v_avg,
      'graded_count', v_count,
      'method',       CASE WHEN v_count >= 5 THEN 'best_5' ELSE 'all' END
    );
  END LOOP;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_subject_averages(bigint, bigint) TO authenticated;
