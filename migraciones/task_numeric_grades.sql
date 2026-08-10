-- ── Nota numérica (0-100) en tareas + integración con calificaciones ──
-- 1) score_v2 en task_evidences: la nota numérica de la tarea que aparece
--    en la sección Calificaciones (además de letra/estrellas).
ALTER TABLE public.task_evidences
  ADD COLUMN IF NOT EXISTS score_v2 numeric(5,2) CHECK (score_v2 >= 0 AND score_v2 <= 100);

CREATE INDEX IF NOT EXISTS idx_task_evidences_score
  ON public.task_evidences (task_id, student_id) WHERE score_v2 IS NOT NULL;

-- 2) close_period: incluir las notas de tareas (task_evidences.score_v2)
--    en el promedio por materia y en report_cards (misma lógica de mejores 5).
CREATE OR REPLACE FUNCTION public.close_period(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period        periods%ROWTYPE;
  v_ap_period     academic_periods%ROWTYPE;
  v_user_id       uuid; v_role text;
  v_student       record; v_config record;
  v_subject_avg   numeric(5,2); v_method text;
  v_total_avg     numeric(5,2); v_subject_count int;
  v_cards_created int := 0; v_level text;
  v_next_period   record;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora','admin') THEN
    RETURN jsonb_build_object('error','Solo la directora puede cerrar períodos');
  END IF;

  -- Determinar si es academic_period o legacy period
  SELECT * INTO v_ap_period FROM public.academic_periods WHERE id = p_period_id;
  IF FOUND THEN
    IF v_ap_period.status = 'closed' THEN RETURN jsonb_build_object('error','El período ya está cerrado'); END IF;
    UPDATE public.academic_periods SET status='closed', is_active=false WHERE id = p_period_id;
    SELECT * INTO v_next_period FROM public.academic_periods
    WHERE school_year_id = v_ap_period.school_year_id AND order_index = v_ap_period.order_index + 1;
  ELSE
    SELECT * INTO v_period FROM public.periods WHERE id = p_period_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','Período no encontrado'); END IF;
    IF v_period.status = 'closed' THEN RETURN jsonb_build_object('error','El período ya está cerrado'); END IF;
    UPDATE public.periods SET status='closed', is_active=false WHERE id = p_period_id;
  END IF;

  -- Calcular calificaciones por materia V2 (actividades + tareas con área)
  FOR v_student IN
    SELECT s.id AS student_id, s.classroom_id
    FROM public.students s
    WHERE s.classroom_id = COALESCE(v_period.classroom_id, v_ap_period.id) AND s.is_active = true
  LOOP
    v_total_avg := 0; v_subject_count := 0;
    FOR v_config IN
      SELECT pc.id AS config_id, pc.subject_id, s.name AS subject_name
      FROM public.period_config pc JOIN public.subjects s ON s.id = pc.subject_id
      WHERE pc.period_id = p_period_id
    LOOP
      SELECT (COALESCE(a_cnt,0) + COALESCE(t_cnt,0))::text INTO v_method
      FROM (
        SELECT COUNT(*) AS a_cnt FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
        WHERE a.config_id = v_config.config_id AND g.student_id = v_student.student_id AND g.score_v2 IS NOT NULL
      ) a, (
        SELECT COUNT(*) AS t_cnt FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
        WHERE t.config_id = v_config.config_id AND te.student_id = v_student.student_id AND te.score_v2 IS NOT NULL
      ) b;
      IF v_method::int >= 5 THEN v_method := 'best_5'; ELSE v_method := 'all'; END IF;
      IF v_method = 'best_5' THEN
        SELECT ROUND(AVG(sv),2) INTO v_subject_avg FROM (
          SELECT g.score_v2 AS sv FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
          WHERE a.config_id = v_config.config_id AND g.student_id = v_student.student_id AND g.score_v2 IS NOT NULL
          UNION ALL
          SELECT te.score_v2 AS sv FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
          WHERE t.config_id = v_config.config_id AND te.student_id = v_student.student_id AND te.score_v2 IS NOT NULL
          ORDER BY sv DESC LIMIT 5) best;
      ELSE
        SELECT ROUND(AVG(sv),2) INTO v_subject_avg FROM (
          SELECT g.score_v2 AS sv FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
          WHERE a.config_id = v_config.config_id AND g.student_id = v_student.student_id AND g.score_v2 IS NOT NULL
          UNION ALL
          SELECT te.score_v2 AS sv FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
          WHERE t.config_id = v_config.config_id AND te.student_id = v_student.student_id AND te.score_v2 IS NOT NULL
        ) allscores;
      END IF;
      IF v_subject_avg IS NOT NULL THEN
        INSERT INTO public.subject_averages (student_id, period_id, subject_id, average, graded_count, method)
        VALUES (v_student.student_id, p_period_id, v_config.subject_id, v_subject_avg, v_method::int,
          CASE WHEN v_method='best_5' THEN 'best_5' ELSE 'all' END)
        ON CONFLICT (student_id, period_id, subject_id) DO UPDATE SET
          average=EXCLUDED.average, graded_count=EXCLUDED.graded_count, method=EXCLUDED.method;
        v_total_avg := v_total_avg + v_subject_avg; v_subject_count := v_subject_count + 1;
      END IF;
    END LOOP;
    IF v_subject_count > 0 THEN v_total_avg := ROUND(v_total_avg / v_subject_count,2); ELSE v_total_avg := NULL; END IF;
    v_level := CASE WHEN v_total_avg IS NULL THEN 'Sin calificar'
                    WHEN v_total_avg >= 90 THEN 'Excelente'
                    WHEN v_total_avg >= 80 THEN 'Bueno'
                    WHEN v_total_avg >= 70 THEN 'En proceso'
                    ELSE 'Requiere apoyo' END;
    INSERT INTO public.report_cards (student_id, classroom_id, period_id, task_avg, formal_avg, final_score, level, generated_at)
    VALUES (v_student.student_id, v_student.classroom_id, p_period_id, v_total_avg, v_total_avg, v_total_avg, v_level, now())
    ON CONFLICT (student_id, period_id) DO UPDATE SET
      task_avg=EXCLUDED.task_avg, formal_avg=EXCLUDED.formal_avg, final_score=EXCLUDED.final_score,
      level=EXCLUDED.level, generated_at=now();
    v_cards_created := v_cards_created + 1;
  END LOOP;

  -- Avanzar al siguiente período o cerrar año
  IF v_next_period.id IS NOT NULL THEN
    UPDATE public.academic_periods SET status='open', is_active=true WHERE id = v_next_period.id;
    RETURN jsonb_build_object('success',true,'message','Período cerrado. Abierto: '||v_next_period.name,
      'closed_period',COALESCE(v_ap_period.name,v_period.name),'opened_period',v_next_period.name,
      'next_period_id',v_next_period.id,'cards_generated',v_cards_created);
  ELSE
    IF v_ap_period.school_year_id IS NOT NULL THEN
      UPDATE public.school_years SET status='closed', updated_at=now() WHERE id = v_ap_period.school_year_id;
    END IF;
    RETURN jsonb_build_object('success',true,'message','Último período cerrado. Año escolar cerrado.',
      'closed_period',COALESCE(v_ap_period.name,v_period.name),'year_closed',true,'cards_generated',v_cards_created);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.close_period(bigint) TO authenticated;

-- 3) get_student_grades_v2: incluir tareas con nota numérica en el detalle
CREATE OR REPLACE FUNCTION public.get_student_grades_v2(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row ORDER BY subject_name, activity_number),'[]')
  FROM (
    SELECT g.activity_id, g.score_v2 AS score, s.name AS subject_name, a.title AS activity_title,
           a.activity_number, g.notes AS comment, false AS is_task
    FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
    JOIN public.period_config pc ON pc.id = a.config_id JOIN public.subjects s ON s.id = pc.subject_id
    WHERE g.student_id = p_student_id AND pc.period_id = public.resolve_period_id(p_period_id) AND g.score_v2 IS NOT NULL
    UNION ALL
    SELECT NULL::bigint AS activity_id, te.score_v2 AS score, s.name AS subject_name, t.title AS activity_title,
           999::int AS activity_number, te.comment AS comment, true AS is_task
    FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
    JOIN public.period_config pc ON pc.id = t.config_id JOIN public.subjects s ON s.id = pc.subject_id
    WHERE te.student_id = p_student_id AND pc.period_id = public.resolve_period_id(p_period_id) AND te.score_v2 IS NOT NULL
  ) row;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_grades_v2(bigint, bigint) TO authenticated;
