-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · SQL OPERATIVO 09/10 — ÁREAS POR AULA + BOLETÍN DINÁMICO
-- ═══════════════════════════════════════════════════════════════════════════
-- Continuación del esquema maestro (karpus_schema_completo.sql).
-- Contenido: SECCIÓN 31 áreas por aula con aislamiento estricto · SECCIÓN 32 boletín dinámico V1 (RPCs tiempo real)
-- Origen: líneas 4754–5573 del archivo original.
--
-- ⚠ EJECUTAR EN ORDEN: 01 → 10 (Supabase Dashboard → SQL Editor)
--   Cada archivo continúa el esquema del anterior; no saltarse ninguno
--   en una base nueva. En la base existente son idempotentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- SECCION 31 · AREAS POR AULA + AISLAMIENTO ESTRICTO POR AULA
-- Origen : migraciones/areas_por_aula.sql
--   1) Al crear un aula se generan 5 areas y cada area con 5 actividades
--      por defecto (reemplazan a las materias globales en la maestra).
--   2) Las calificaciones de la maestra usan las areas propias de su aula.
--   3) Aislamiento estricto: los datos nunca se mezclan entre aulas; solo
--      los usuarios de esa aula ven sus datos.
-- Implementacion: cada aula tiene sus propias "subjects" (areas) con
-- classroom_id, su fila en period_config (classroom_id) y sus actividades.
-- No depende de nombres de constraints ni de ON CONFLICT: la siembra usa
-- WHERE NOT EXISTS, asi funciona aunque la base no tenga los UNIQUE de
-- referencia.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS classroom_id bigint REFERENCES public.classrooms(id) ON DELETE CASCADE;
ALTER TABLE public.period_config ADD COLUMN IF NOT EXISTS classroom_id bigint REFERENCES public.classrooms(id) ON DELETE CASCADE;

-- Quitar cualquier UNIQUE global sobre subjects(name) para permitir que cada
-- aula tenga su propia area con el mismo nombre (ej. "Lenguaje").
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.subjects'::regclass AND contype = 'u'
             AND conkey = ARRAY[
               (SELECT attnum FROM pg_attribute
                WHERE attrelid = 'public.subjects'::regclass AND attname = 'name')
             ]
  LOOP
    EXECUTE format('ALTER TABLE public.subjects DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- Indices (creacion tolerante: si el dato existente impide un UNIQUE,
-- se omite sin romper el script; la siembra ya valida con NOT EXISTS).
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS subjects_name_global_key
      ON public.subjects (name) WHERE classroom_id IS NULL;
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS subjects_name_classroom_key
      ON public.subjects (classroom_id, name) WHERE classroom_id IS NOT NULL;
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
CREATE INDEX IF NOT EXISTS idx_subjects_classroom ON public.subjects (classroom_id);
CREATE INDEX IF NOT EXISTS idx_period_config_classroom ON public.period_config (classroom_id);

-- Helper de acceso por aula (para politicas RLS).
-- directora/asistente/admin -> todo; maestra -> su aula; padre -> aulas de sus hijos.
-- CASCADE: si ya existen políticas RLS de ejecuciones anteriores que dependen
-- de esta función, se recaen aquí abajo al recrearlas todas en esta sección.
DROP FUNCTION IF EXISTS public.is_classroom_accessible(bigint) CASCADE;
CREATE OR REPLACE FUNCTION public.is_classroom_accessible(p_classroom_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    get_my_role() IN ('directora','asistente','admin')
    OR EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = p_classroom_id AND c.teacher_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.students s
               WHERE s.classroom_id = p_classroom_id AND s.parent_id = auth.uid() AND s.deleted_at IS NULL);
$$;

-- Acceso a una calificacion: por su aula y, si el registro no trae
-- classroom_id (filas historicas), por el aula de la actividad.
DROP FUNCTION IF EXISTS public.is_grade_accessible(bigint, bigint) CASCADE;
CREATE OR REPLACE FUNCTION public.is_grade_accessible(p_classroom_id bigint, p_activity_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    get_my_role() IN ('directora','asistente','admin')
    OR (p_classroom_id IS NOT NULL AND public.is_classroom_accessible(p_classroom_id))
    OR (p_activity_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.activities a
        JOIN public.period_config pc ON pc.id = a.config_id
        WHERE a.id = p_activity_id AND pc.classroom_id IS NOT NULL
          AND public.is_classroom_accessible(pc.classroom_id)
      ));
$$;

-- RLS de aislamiento estricto por aula
-- ── CLASSROOMS (lectura para autenticados; escritura solo staff) ──
DROP POLICY IF EXISTS "classrooms_all" ON public.classrooms;
DROP POLICY IF EXISTS "classrooms_read_all" ON public.classrooms;
DROP POLICY IF EXISTS "classrooms_staff_write" ON public.classrooms;
CREATE POLICY "classrooms_read_all" ON public.classrooms FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "classrooms_staff_write" ON public.classrooms FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin'));

-- ── STUDENTS: la maestra solo ve alumnos de su aula ──
DROP POLICY IF EXISTS "students_staff" ON public.students;
CREATE POLICY "students_staff" ON public.students FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','admin')
    OR (get_my_role() = 'maestra' AND classroom_id IS NOT NULL AND public.is_classroom_accessible(classroom_id))
  )
  WITH CHECK (
    get_my_role() IN ('directora','asistente','admin')
    OR (get_my_role() = 'maestra' AND classroom_id IS NOT NULL AND public.is_classroom_accessible(classroom_id))
  );

-- ── RUTINA (schedule + log) ──
DROP POLICY IF EXISTS "event_schedule_staff" ON public.classroom_event_schedule;
DROP POLICY IF EXISTS "event_schedule_parent" ON public.classroom_event_schedule;
DROP POLICY IF EXISTS "Maestras ven schedule de su aula" ON public.classroom_event_schedule;
DROP POLICY IF EXISTS "Maestras gestionan schedule de su aula" ON public.classroom_event_schedule;
DROP POLICY IF EXISTS "schedule_access_staff" ON public.classroom_event_schedule;
CREATE POLICY "schedule_access_staff" ON public.classroom_event_schedule FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id));
DROP POLICY IF EXISTS "schedule_access_parent" ON public.classroom_event_schedule;
CREATE POLICY "schedule_access_parent" ON public.classroom_event_schedule FOR SELECT
  USING (public.is_classroom_accessible(classroom_id));

DROP POLICY IF EXISTS "timeline_log_staff" ON public.timeline_event_log;
DROP POLICY IF EXISTS "timeline_log_parent" ON public.timeline_event_log;
DROP POLICY IF EXISTS "Maestras ven logs de su aula" ON public.timeline_event_log;
DROP POLICY IF EXISTS "Maestras insertan logs en su aula" ON public.timeline_event_log;
DROP POLICY IF EXISTS "Padres ven logs de hijos" ON public.timeline_event_log;
DROP POLICY IF EXISTS "timeline_log_access_staff" ON public.timeline_event_log;
CREATE POLICY "timeline_log_access_staff" ON public.timeline_event_log FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id));
DROP POLICY IF EXISTS "timeline_log_access_parent" ON public.timeline_event_log;
CREATE POLICY "timeline_log_access_parent" ON public.timeline_event_log FOR SELECT
  USING (public.is_classroom_accessible(classroom_id));

-- ── CALIFICACIONES ──
DROP POLICY IF EXISTS "grades_staff" ON public.grades;
CREATE POLICY "grades_staff" ON public.grades FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_grade_accessible(classroom_id, activity_id))
  WITH CHECK (
    get_my_role() IN ('directora','asistente','maestra','admin')
    AND public.is_grade_accessible(classroom_id, activity_id)
    AND (period_id IS NULL OR public.is_period_open(period_id) OR get_my_role() IN ('directora','admin'))
  );

DROP POLICY IF EXISTS "period_config_staff" ON public.period_config;
CREATE POLICY "period_config_staff" ON public.period_config FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','admin')
    OR (get_my_role() = 'maestra' AND classroom_id IS NOT NULL AND public.is_classroom_accessible(classroom_id))
  )
  WITH CHECK (
    get_my_role() IN ('directora','asistente','admin')
    OR (get_my_role() = 'maestra' AND classroom_id IS NOT NULL AND public.is_classroom_accessible(classroom_id))
  );

DROP POLICY IF EXISTS "activities_staff" ON public.activities;
CREATE POLICY "activities_staff" ON public.activities FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','admin')
    OR EXISTS (
      SELECT 1 FROM public.period_config pc
      WHERE pc.id = activities.config_id AND pc.classroom_id IS NOT NULL
        AND public.is_classroom_accessible(pc.classroom_id)
    )
  )
  WITH CHECK (
    get_my_role() IN ('directora','asistente','admin')
    OR EXISTS (
      SELECT 1 FROM public.period_config pc
      WHERE pc.id = activities.config_id AND pc.classroom_id IS NOT NULL
        AND public.is_classroom_accessible(pc.classroom_id)
    )
  );

-- ── MATERIAS (subjects): globales solo staff; por aula, solo su aula ──
DROP POLICY IF EXISTS "subjects_auth" ON public.subjects;
DROP POLICY IF EXISTS "subjects_access" ON public.subjects;
CREATE POLICY "subjects_access" ON public.subjects FOR SELECT
  USING (
    (classroom_id IS NULL AND get_my_role() IN ('directora','asistente','maestra','admin'))
    OR (classroom_id IS NOT NULL AND public.is_classroom_accessible(classroom_id))
  );

-- ── TAREAS ──
DROP POLICY IF EXISTS "tasks_staff" ON public.tasks;
CREATE POLICY "tasks_staff" ON public.tasks FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id));

-- ── DAILY LOGS ──
DROP POLICY IF EXISTS "daily_logs_staff" ON public.daily_logs;
CREATE POLICY "daily_logs_staff" ON public.daily_logs FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id));

-- ── ASISTENCIA ──
DROP POLICY IF EXISTS "attendance_staff" ON public.attendance;
CREATE POLICY "attendance_staff" ON public.attendance FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id));

-- ── GALERIA Y CHAT DEL AULA ──
DROP POLICY IF EXISTS "gallery_all" ON public.classroom_gallery;
DROP POLICY IF EXISTS "gallery_access" ON public.classroom_gallery;
CREATE POLICY "gallery_access" ON public.classroom_gallery FOR ALL
  USING (public.is_classroom_accessible(classroom_id))
  WITH CHECK (public.is_classroom_accessible(classroom_id));
DROP POLICY IF EXISTS "classroom_chat_all" ON public.classroom_chat;
DROP POLICY IF EXISTS "classroom_chat_access" ON public.classroom_chat;
CREATE POLICY "classroom_chat_access" ON public.classroom_chat FOR ALL
  USING (public.is_classroom_accessible(classroom_id))
  WITH CHECK (public.is_classroom_accessible(classroom_id));

-- RPCs con filtro por aula (p_classroom_id opcional)
DROP FUNCTION IF EXISTS public.get_period_config(bigint);
DROP FUNCTION IF EXISTS public.get_activities_with_grades(bigint);
CREATE OR REPLACE FUNCTION public.get_period_config(p_period_id bigint, p_classroom_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',pc.id,'subject_id',pc.subject_id,'subject_name',s.name,
    'education_level',s.education_level,'activity_count',pc.activity_count) ORDER BY s.name),'[]')
  FROM public.period_config pc JOIN public.subjects s ON s.id = pc.subject_id
  WHERE pc.period_id = public.resolve_period_id(p_period_id)
    AND (p_classroom_id IS NULL OR pc.classroom_id = p_classroom_id);
$$;
GRANT EXECUTE ON FUNCTION public.get_period_config(bigint, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_activities_with_grades(p_period_id bigint, p_classroom_id bigint DEFAULT NULL)
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
  WHERE pc.period_id = public.resolve_period_id(p_period_id)
    AND (p_classroom_id IS NULL OR pc.classroom_id = p_classroom_id);
$$;
GRANT EXECUTE ON FUNCTION public.get_activities_with_grades(bigint, bigint) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- ═════════════════════════════════════════════════════════════════════════════
-- SECCION 32 · BOLETIN DINAMICO V1
-- Origen : migraciones/add_boletin_dinamico.sql
-- Motor del boletin: promedios en tiempo real por area y periodo +
-- fortalezas/debilidades/comentario + QR/PDF. Reutiliza el esquema V2.
-- (Las RPC id-agnosticas resolve_period_id/get_period_config/
--  get_activities_with_grades/get_student_grades_v2/get_student_subject_averages
--  ya estan consolidadas en la SECCION 18 de la PARTE A.)
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Columnas nuevas en report_cards
ALTER TABLE public.report_cards ADD COLUMN IF NOT EXISTS fortalezas        text[] DEFAULT '{}';
ALTER TABLE public.report_cards ADD COLUMN IF NOT EXISTS debilidades       text[] DEFAULT '{}';
ALTER TABLE public.report_cards ADD COLUMN IF NOT EXISTS directora_comment text;
ALTER TABLE public.report_cards ADD COLUMN IF NOT EXISTS conducta          text;
ALTER TABLE public.report_cards ADD COLUMN IF NOT EXISTS qr_code           text;
ALTER TABLE public.report_cards ADD COLUMN IF NOT EXISTS pdf_url           text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'report_cards' AND column_name = 'conducta'
  ) THEN
    ALTER TABLE public.report_cards DROP CONSTRAINT IF EXISTS report_cards_conducta_check;
    ALTER TABLE public.report_cards ADD CONSTRAINT report_cards_conducta_check
      CHECK (conducta IN ('Excelente','Muy buena','Buena','Regular'));
  END IF;
END $$;

-- 2. RPC: Boletín completo de un estudiante (tiempo real)
DROP FUNCTION IF EXISTS public.get_student_boletin(bigint, bigint);
CREATE OR REPLACE FUNCTION public.get_student_boletin(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  -- Asistencia del estudiante dentro del rango de fechas del periodo
  SELECT
    COUNT(*) FILTER (WHERE a.status IN ('present','retirado','late'))  AS asistidos,
    COUNT(*) FILTER (WHERE a.status = 'absent')                        AS ausencias,
    COUNT(*) FILTER (WHERE a.status = 'late')                          AS tardanzas,
    COUNT(*)                                                            AS total
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

GRANT EXECUTE ON FUNCTION public.get_student_boletin(bigint, bigint) TO authenticated;

-- 3. RPC: Guardar notas del boletín (comentario/f.t./deb.)
DROP FUNCTION IF EXISTS public.save_boletin_notes(bigint, bigint, text, text[], text[], text, text);
CREATE OR REPLACE FUNCTION public.save_boletin_notes(
  p_student_id      bigint,
  p_period_id       bigint,
  p_teacher_comment text DEFAULT NULL,
  p_fortalezas      text[] DEFAULT NULL,
  p_debilidades     text[] DEFAULT NULL,
  p_observaciones   text DEFAULT NULL,
  p_conducta        text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id      uuid;
  v_role         text;
  v_classroom_id bigint;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora','asistente','maestra','admin') THEN
    RETURN jsonb_build_object('error', 'Acceso denegado');
  END IF;

  IF p_conducta IS NOT NULL AND p_conducta NOT IN ('Excelente','Muy buena','Buena','Regular') THEN
    RETURN jsonb_build_object('error', 'Conducta inválida');
  END IF;

  SELECT classroom_id INTO v_classroom_id
  FROM public.students WHERE id = p_student_id;

  -- Acepta id de academic_periods o de legacy periods
  p_period_id := public.resolve_period_id(p_period_id);

  INSERT INTO public.report_cards (
    student_id, classroom_id, period_id,
    teacher_comment, fortalezas, debilidades, directora_comment, conducta
  )
  VALUES (
    p_student_id, v_classroom_id, p_period_id,
    p_teacher_comment,
    COALESCE(p_fortalezas, '{}'),
    COALESCE(p_debilidades, '{}'),
    p_observaciones,
    p_conducta
  )
  ON CONFLICT (student_id, period_id) DO UPDATE SET
    teacher_comment  = EXCLUDED.teacher_comment,
    fortalezas       = EXCLUDED.fortalezas,
    debilidades      = EXCLUDED.debilidades,
    directora_comment = EXCLUDED.directora_comment,
    conducta         = EXCLUDED.conducta;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_boletin_notes(bigint, bigint, text, text[], text[], text, text) TO authenticated;

-- 4. RPC: Editar nombre y descripcion de un area (materia)
DROP FUNCTION IF EXISTS public.update_subject(bigint, text, text);
CREATE OR REPLACE FUNCTION public.update_subject(
  p_subject_id   bigint,
  p_name         text,
  p_description  text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
BEGIN
  v_role := (SELECT role FROM public.profiles WHERE id = auth.uid());
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error', 'Acceso denegado');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('error', 'El nombre del área es requerido');
  END IF;

  UPDATE public.subjects
  SET name        = btrim(p_name),
      description = NULLIF(btrim(COALESCE(p_description, '')), '')
  WHERE id = p_subject_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Área no encontrada');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_subject(bigint, text, text) TO authenticated;

-- 5. RPC: Periodos para calificaciones (academic_periods → legacy)
DROP FUNCTION IF EXISTS public.get_grade_periods();
CREATE OR REPLACE FUNCTION public.get_grade_periods()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role      text;
  v_ap        record;
  v_legacy    bigint;
  v_name      text;
  v_start     date;
  v_end       date;
  v_status    text;
  v_is_active boolean;
  v_result    jsonb := '[]'::jsonb;
BEGIN
  v_role := (SELECT role FROM public.profiles WHERE id = auth.uid());
  IF v_role IS NULL OR v_role NOT IN ('directora','asistente','maestra','admin') THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_ap IN
    SELECT ap.id, ap.name, ap.start_date, ap.end_date, ap.status, ap.is_active, ap.order_index
    FROM public.academic_periods ap
    ORDER BY ap.order_index, ap.start_date
  LOOP
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
    ELSE
      UPDATE public.periods
      SET status = CASE WHEN v_ap.status IN ('open','closed') THEN v_ap.status ELSE status END,
          is_active = v_ap.is_active
      WHERE id = v_legacy;
    END IF;

    SELECT status, is_active INTO v_status, v_is_active
    FROM public.periods WHERE id = v_legacy;

    v_result := v_result || jsonb_build_object(
      'id',                 v_legacy,
      'academic_period_id', v_ap.id,
      'name',               v_ap.name,
      'start_date',         v_ap.start_date,
      'end_date',           v_ap.end_date,
      'status',             v_status,
      'is_active',          v_is_active,
      'order_index',        v_ap.order_index
    );
  END LOOP;

  -- Periodos legacy huerfanos (sin contraparte en academic_periods)
  FOR v_legacy IN
    SELECT p.id FROM public.periods p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.academic_periods ap
      WHERE ap.name = p.name AND ap.start_date = p.start_date AND ap.end_date = p.end_date
    )
    ORDER BY p.start_date, p.id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result) e WHERE (e->>'id')::bigint = v_legacy) THEN
      SELECT name, start_date, end_date, status, is_active
        INTO v_name, v_start, v_end, v_status, v_is_active
      FROM public.periods WHERE id = v_legacy;

      v_result := v_result || jsonb_build_object(
        'id', v_legacy, 'academic_period_id', NULL,
        'name', v_name, 'start_date', v_start, 'end_date', v_end,
        'status', v_status, 'is_active', v_is_active, 'order_index', 0
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_grade_periods() TO authenticated;

-- 6. RPC: Crear un area (materia) nueva
-- education_level es una etiqueta libre/opcional, sin valores fijos.
-- p_classroom_id opcional: si se envía, el área se crea para esa aula.
-- Solo directora y asistente crean áreas.
DROP FUNCTION IF EXISTS public.insert_subject(text, text, text, bigint);
DROP FUNCTION IF EXISTS public.insert_subject(text, text, text);
CREATE OR REPLACE FUNCTION public.insert_subject(
  p_name            text,
  p_education_level text DEFAULT NULL,
  p_description     text DEFAULT NULL,
  p_classroom_id    bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_row  public.subjects%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error', 'Solo directora/asistente pueden crear áreas');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('error', 'El nombre del área es requerido');
  END IF;

  IF p_classroom_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.classrooms WHERE id = p_classroom_id) THEN
    RETURN jsonb_build_object('error', 'El aula seleccionada no existe');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subjects
    WHERE name = btrim(p_name)
      AND ((p_classroom_id IS NULL AND classroom_id IS NULL)
           OR (p_classroom_id IS NOT NULL AND classroom_id = p_classroom_id))
  ) THEN
    RETURN jsonb_build_object('error', CASE WHEN p_classroom_id IS NOT NULL
      THEN 'Ya existe un área con ese nombre en este aula'
      ELSE 'Ya existe un área con ese nombre' END);
  END IF;

  INSERT INTO public.subjects (name, education_level, description, is_active, classroom_id)
  VALUES (btrim(p_name), p_education_level, NULLIF(btrim(COALESCE(p_description, '')), ''), true, p_classroom_id)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'name', v_row.name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_subject(text, text, text, bigint) TO authenticated;
-- FIN · KARPUS KIDS SCHEMA COMPLETO v1.0.0
-- ═════════════════════════════════════════════════════════════════════════════

