-- KARPUS KIDS / MIGRACION CONSOLIDADA 14/14 - ESTADO "EXCUSA" EN ASISTENCIA
--
-- El panel de Maestra (item #2 de mejoras.md) ofrece 4 estados:
-- presente · tarde · ausente · EXCUSA (justificada).
-- El CHECK original de public.attendance solo permitia 4 valores distintos
-- ('present','absent','late','retirado'), por lo que registrar una excusa
-- fallaba con violacion de constraint. Esta migracion:
--   1. Reemplaza el CHECK para admitir 'excused' (y el alias local 'excusa').
--   2. Ajusta los agregados para que la excusa cuente como dia asistido.
--
-- Es idempotente: se puede ejecutar mas de una vez.
-- Requiere haber aplicado 08_funciones_vistas_triggers_storage.sql.

-- ----------------------------------------------------------------------------
-- 1. Ampliar el dominio de estados
-- ----------------------------------------------------------------------------
ALTER TABLE public.attendance
  DROP CONSTRAINT IF EXISTS attendance_status_check;

ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('present','absent','late','retirado','excused','excusa'));

-- Indice parcial util para el tablero de la clase (solo los estados "buenos").
CREATE INDEX IF NOT EXISTS idx_attendance_present_states
  ON public.attendance (classroom_id, date)
  WHERE status IN ('present','late','excused','excusa');

-- ----------------------------------------------------------------------------
-- 2. attendance_last_7_days(): la excusa cuenta como dia asistido
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_last_7_days()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_result jsonb := '{}';
  v_date   date;
  v_count  int;
begin
  for i in 0..6 loop
    v_date  := current_date - i;
    v_count := (select count(*)::int
                from public.attendance
                where date = v_date
                  and status in ('present','late','excused','excusa'));
    v_result := v_result || jsonb_build_object(v_date::text, v_count);
  end loop;
  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. get_period_stats(): exponer excused en el resumen del periodo y sumarlo
--    al porcentaje de asistencia (antes solo contaba 'present').
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_period_stats(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_result jsonb;
  v_attendance record;
  v_grades record;
  v_tasks record;
BEGIN
  SELECT
    count(*) as total_records,
    count(*) FILTER (WHERE status = 'present') as present_count,
    count(*) FILTER (WHERE status = 'absent') as absent_count,
    count(*) FILTER (WHERE status = 'late') as late_count,
    count(*) FILTER (WHERE status IN ('excused','excusa')) as excused_count,
    count(*) FILTER (WHERE status IN ('present','late','excused','excusa')) as attended_count
  INTO v_attendance
  FROM public.attendance
  WHERE academic_period_id = p_period_id;

  SELECT
    count(*) as total_grades,
    COALESCE(avg(score), 0) as avg_score
  INTO v_grades
  FROM public.grades
  WHERE period_id = p_period_id;

  SELECT count(*) as total_tasks
  INTO v_tasks
  FROM public.tasks
  WHERE period_id = p_period_id;

  v_result := jsonb_build_object(
    'attendance', jsonb_build_object(
      'total', v_attendance.total_records,
      'present', v_attendance.present_count,
      'absent', v_attendance.absent_count,
      'late', v_attendance.late_count,
      'excused', v_attendance.excused_count,
      'pct', CASE WHEN v_attendance.total_records > 0
        THEN round((v_attendance.attended_count::numeric / v_attendance.total_records * 100), 1)
        ELSE 0 END
    ),
    'grades', jsonb_build_object(
      'total', v_grades.total_grades,
      'average', round(v_grades.avg_score, 1)
    ),
    'tasks', jsonb_build_object(
      'total', v_tasks.total_tasks
    )
  );

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. get_student_boletin(): la excusa cuenta como asistencia y se expone el
--    desglose 'excusas'. Resto del cuerpo identico a la version 08.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_boletin(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_user_id    uuid;
  v_role       text;
  v_student    record;
  v_period     record;
  v_area       record;
  v_count      int;
  v_avg        numeric(5,2);
  v_total      numeric(5,2) := 0;
  v_area_count int := 0;
  v_level      text;
  v_areas      jsonb := '[]'::jsonb;
  v_acts       jsonb;
  v_report     record;
  v_att        record;
  v_pct        numeric(5,2);
  v_directora  text;
  v_year       text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora','asistente','maestra','admin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.students
      WHERE id = p_student_id AND parent_id = v_user_id
    ) THEN
      RETURN jsonb_build_object('error', 'Acceso denegado');
    END IF;
  END IF;

  SELECT s.id, s.name, s.matricula, s.age, s.age_type, s.avatar_url,
         s.birth_date,
         s.classroom_id, c.name AS classroom_name, c.level AS classroom_level,
         t.name AS teacher_name
  INTO v_student
  FROM public.students s
  LEFT JOIN public.classrooms c ON c.id = s.classroom_id
  LEFT JOIN public.profiles t ON t.id = c.teacher_id
  WHERE s.id = p_student_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Estudiante no encontrado');
  END IF;

  -- Acepta id de academic_periods o de legacy periods
  p_period_id := public.resolve_period_id(p_period_id);

  SELECT * INTO v_period FROM public.periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Periodo no encontrado');
  END IF;

  SELECT name INTO v_directora
  FROM public.profiles
  WHERE role = 'directora'
  ORDER BY created_at
  LIMIT 1;

  SELECT name INTO v_year
  FROM public.school_years
  WHERE status IN ('active','enrollment','reenrollment')
  ORDER BY created_at DESC
  LIMIT 1;

  -- Areas configuradas en el periodo con promedio en tiempo real
  FOR v_area IN
    SELECT pc.subject_id, s.name AS subject_name, pc.activity_count
    FROM public.period_config pc
    JOIN public.subjects s ON s.id = pc.subject_id
    WHERE pc.period_id = p_period_id
    ORDER BY s.name
  LOOP
    SELECT (COALESCE(a_cnt,0) + COALESCE(t_cnt,0)) INTO v_count
    FROM (
      SELECT COUNT(*) AS a_cnt
      FROM public.grades g
      JOIN public.activities a ON a.id = g.activity_id
      JOIN public.period_config pc ON pc.id = a.config_id
      WHERE pc.period_id = p_period_id
        AND pc.subject_id = v_area.subject_id
        AND g.student_id = p_student_id
        AND g.score_v2 IS NOT NULL
    ) a, (
      SELECT COUNT(*) AS t_cnt
      FROM public.task_evidences te
      JOIN public.tasks t ON t.id = te.task_id
      JOIN public.period_config pc ON pc.id = t.config_id
      WHERE pc.period_id = p_period_id
        AND pc.subject_id = v_area.subject_id
        AND te.student_id = p_student_id
        AND te.score_v2 IS NOT NULL
    ) b;

    IF v_count >= 5 THEN
      SELECT ROUND(AVG(score_v2), 2) INTO v_avg
      FROM (
        SELECT g.score_v2
        FROM public.grades g
        JOIN public.activities a ON a.id = g.activity_id
        JOIN public.period_config pc ON pc.id = a.config_id
        WHERE pc.period_id = p_period_id
          AND pc.subject_id = v_area.subject_id
          AND g.student_id = p_student_id
          AND g.score_v2 IS NOT NULL
        UNION ALL
        SELECT te.score_v2
        FROM public.task_evidences te
        JOIN public.tasks t ON t.id = te.task_id
        JOIN public.period_config pc ON pc.id = t.config_id
        WHERE pc.period_id = p_period_id
          AND pc.subject_id = v_area.subject_id
          AND te.student_id = p_student_id
          AND te.score_v2 IS NOT NULL
        ORDER BY score_v2 DESC
        LIMIT 5
      ) best_scores;
    ELSE
      SELECT ROUND(AVG(score_v2), 2) INTO v_avg
      FROM (
        SELECT g.score_v2
        FROM public.grades g
        JOIN public.activities a ON a.id = g.activity_id
        JOIN public.period_config pc ON pc.id = a.config_id
        WHERE pc.period_id = p_period_id
          AND pc.subject_id = v_area.subject_id
          AND g.student_id = p_student_id
          AND g.score_v2 IS NOT NULL
        UNION ALL
        SELECT te.score_v2
        FROM public.task_evidences te
        JOIN public.tasks t ON t.id = te.task_id
        JOIN public.period_config pc ON pc.id = t.config_id
        WHERE pc.period_id = p_period_id
          AND pc.subject_id = v_area.subject_id
          AND te.student_id = p_student_id
          AND te.score_v2 IS NOT NULL
      ) all_scores;
    END IF;

    IF v_avg IS NOT NULL THEN
      v_total := v_total + v_avg;
      v_area_count := v_area_count + 1;
    END IF;

    v_areas := v_areas || jsonb_build_object(
      'subject_id',     v_area.subject_id,
      'subject_name',   v_area.subject_name,
      'activity_count', v_area.activity_count,
      'graded_count',   v_count,
      'average',        v_avg,
      'method',         CASE WHEN v_count >= 5 THEN 'best_5' ELSE 'all' END
    );
  END LOOP;

  -- Detalle de actividades y tareas calificadas del estudiante
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'subject_id',      x.subject_id,
        'subject_name',    x.subject_name,
        'activity_id',     x.activity_id,
        'activity_title',  x.activity_title,
        'activity_number', x.activity_number,
        'score',           x.score,
        'comment',         x.comment,
        'is_task',         x.is_task
      )
      ORDER BY x.subject_name, x.activity_number
    ),
    '[]'::jsonb
  ) INTO v_acts
  FROM (
    SELECT pc.subject_id, s.name AS subject_name, a.id AS activity_id, a.title AS activity_title,
           a.activity_number, g.score_v2 AS score, g.notes AS comment, false AS is_task
    FROM public.grades g
    JOIN public.activities a ON a.id = g.activity_id
    JOIN public.period_config pc ON pc.id = a.config_id
    JOIN public.subjects s ON s.id = pc.subject_id
    WHERE g.student_id = p_student_id
      AND pc.period_id = p_period_id
      AND g.score_v2 IS NOT NULL
    UNION ALL
    SELECT pc.subject_id, s.name AS subject_name, NULL::bigint AS activity_id, t.title AS activity_title,
           999::int AS activity_number, te.score_v2 AS score, te.comment AS comment, true AS is_task
    FROM public.task_evidences te
    JOIN public.tasks t ON t.id = te.task_id
    JOIN public.period_config pc ON pc.id = t.config_id
    JOIN public.subjects s ON s.id = pc.subject_id
    WHERE te.student_id = p_student_id
      AND pc.period_id = p_period_id
      AND te.score_v2 IS NOT NULL
  ) x;

  IF v_area_count > 0 THEN
    v_total := ROUND(v_total / v_area_count, 2);
  ELSE
    v_total := NULL;
  END IF;

  v_level := CASE
    WHEN v_total IS NULL THEN 'Sin calificar'
    WHEN v_total >= 90   THEN 'Excelente'
    WHEN v_total >= 80   THEN 'Bueno'
    WHEN v_total >= 70   THEN 'En proceso'
    ELSE                      'Requiere apoyo'
  END;

  SELECT * INTO v_report
  FROM public.report_cards
  WHERE student_id = p_student_id AND period_id = p_period_id;

  -- Asistencia del estudiante dentro del rango de fechas del periodo.
  -- 'excused' cuenta como dia asistido (excusa justificada).
  SELECT
    COUNT(*) FILTER (WHERE a.status IN ('present','retirado','late','excused','excusa')) AS asistidos,
    COUNT(*) FILTER (WHERE a.status = 'absent')                                          AS ausencias,
    COUNT(*) FILTER (WHERE a.status = 'late')                                            AS tardanzas,
    COUNT(*) FILTER (WHERE a.status IN ('excused','excusa'))                              AS excusas,
    COUNT(*)                                                                             AS total
  INTO v_att
  FROM public.attendance a
  WHERE a.student_id = p_student_id
    AND (v_period.start_date IS NULL OR a.date >= v_period.start_date)
    AND (v_period.end_date IS NULL OR a.date <= v_period.end_date);

  v_pct := CASE
    WHEN v_att.total > 0
      THEN ROUND(v_att.asistidos::numeric / v_att.total * 100, 1)
    ELSE NULL END;

  RETURN jsonb_build_object(
    'student', jsonb_build_object(
      'id',         v_student.id,
      'name',       v_student.name,
      'matricula',  v_student.matricula,
      'age',        v_student.age,
      'age_type',   v_student.age_type,
      'birth_date', v_student.birth_date,
      'avatar_url', v_student.avatar_url
    ),
    'classroom', jsonb_build_object(
      'id',    v_student.classroom_id,
      'name',  v_student.classroom_name,
      'level', v_student.classroom_level
    ),
    'teacher_name',    v_student.teacher_name,
    'directora_name',  v_directora,
    'school_year_name',v_year,
    'period', jsonb_build_object(
      'id',          v_period.id,
      'name',        v_period.name,
      'start_date',  v_period.start_date,
      'end_date',    v_period.end_date,
      'status',      v_period.status,
      'is_active',   v_period.is_active
    ),
    'areas', v_areas,
    'activities', v_acts,
    'overall_average', v_total,
    'level', v_level,
    'attendance', jsonb_build_object(
      'asistencias',  v_att.asistidos,
      'ausencias',    v_att.ausencias,
      'tardanzas',    v_att.tardanzas,
      'excusas',      v_att.excusas,
      'total',        v_att.total,
      'pct',          v_pct
    ),
    'issued_at', CURRENT_DATE,
    'report', CASE WHEN v_report.id IS NOT NULL THEN
      jsonb_build_object(
        'final_score',      v_report.final_score,
        'level',            v_report.level,
        'teacher_comment',  v_report.teacher_comment,
        'directora_comment',v_report.directora_comment,
        'conducta',         v_report.conducta,
        'fortalezas',       COALESCE(v_report.fortalezas, '{}'),
        'debilidades',      COALESCE(v_report.debilidades, '{}'),
        'generated_at',     v_report.generated_at
      )
    ELSE NULL END
  );
END;
$$;
