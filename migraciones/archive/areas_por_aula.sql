-- ============================================================
-- KARPUS KIDS — ÁREAS POR AULA + AISLAMIENTO ESTRICTO
--
-- Reglas:
--   1) Al crear un aula se generan automáticamente 5 áreas y
--      cada área con sus 5 actividades por defecto.
--   2) Las calificaciones de la maestra usan las áreas propias
--      de su aula (reemplazan a las materias globales).
--   3) Cada aula es individual: los datos nunca se mezclan entre
--      aulas. Solo los usuarios de esa aula ven sus datos.
--
-- Implementación: se reutiliza el motor existente (subjects ->
-- period_config -> activities -> grades). Cada aula obtiene sus
-- propias "subjects" (areas) con classroom_id, su propia fila en
-- period_config (classroom_id) y sus actividades. Los RPC de
-- configuración reciben p_classroom_id para filtrar por aula.
--
-- NOTAS:
--   * Las ALTER TABLE van al INICIO porque las funciones
--     LANGUAGE sql validan sus columnas al momento de crearse.
--   * No se depende de nombres de constraints ni de ON CONFLICT:
--     la siembra usa comprobaciones WHERE NOT EXISTS, así funciona
--     aunque la base no tenga los UNIQUE del schema.sql de referencia.
-- ============================================================

-- 0. COLUMNAS: areas por aula
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS classroom_id bigint REFERENCES public.classrooms(id) ON DELETE CASCADE;
ALTER TABLE public.period_config ADD COLUMN IF NOT EXISTS classroom_id bigint REFERENCES public.classrooms(id) ON DELETE CASCADE;

-- 0b. Quitar cualquier UNIQUE global sobre subjects(name) para permitir
--     que cada aula tenga su propia área con el mismo nombre (ej. "Lenguaje").
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

-- 0c. Índices (creación tolerante: si el dato existente impide un UNIQUE,
--     se omite sin romper el script; la siembra ya valida con NOT EXISTS).
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

-- 1. Helper de acceso por aula (para políticas RLS)
--    directora/asistente/admin -> todo; maestra -> su aula;
--    padre -> aulas de sus hijos.
DROP FUNCTION IF EXISTS public.is_classroom_accessible(bigint);
CREATE OR REPLACE FUNCTION public.is_classroom_accessible(p_classroom_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    get_my_role() IN ('directora','asistente','admin')
    OR EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = p_classroom_id AND c.teacher_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.students s
               WHERE s.classroom_id = p_classroom_id AND s.parent_id = auth.uid() AND s.deleted_at IS NULL);
$$;

-- 1b. Acceso a una calificación: por su aula y, si el registro no trae
--     classroom_id (filas históricas), por el aula de la actividad.
DROP FUNCTION IF EXISTS public.is_grade_accessible(bigint, bigint);
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

-- 2. Asegurar 5 áreas x 5 actividades para un aula (idempotente)
CREATE OR REPLACE FUNCTION public.ensure_classroom_areas(p_classroom_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_classroom public.classrooms%ROWTYPE;
  v_level       text;
  v_areas       text[];
  v_def_acts    text[];
  v_area        text;
  v_act         text;
  v_idx         int;
  v_subject_id  bigint;
  v_period_id   bigint;
  v_config_id   bigint;
  v_active_ap   bigint;
BEGIN
  IF p_classroom_id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_classroom FROM public.classrooms WHERE id = p_classroom_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Nivel del aula: columna level, si no se infiere del nombre
  v_level := lower(coalesce(v_classroom.level, ''));
  IF v_level NOT IN ('estancia','preescolar','primaria') THEN
    IF v_classroom.name ILIKE '%estancia%' OR v_classroom.name ILIKE '%lactante%'
       OR v_classroom.name ILIKE '%maternal%' OR v_classroom.name ILIKE '%beb%' THEN
      v_level := 'estancia';
    ELSIF v_classroom.name ILIKE '%primaria%' OR v_classroom.name ILIKE '%b%asica%' THEN
      v_level := 'primaria';
    ELSIF v_classroom.name ILIKE '%preescolar%' OR v_classroom.name ILIKE '%k%nder%'
       OR v_classroom.name ILIKE '%pre-k%' OR v_classroom.name ILIKE '%p%rvulos%' THEN
      v_level := 'preescolar';
    ELSE
      v_level := 'estancia';
    END IF;
    UPDATE public.classrooms SET level = v_level WHERE id = p_classroom_id;
  END IF;

  -- 5 áreas por defecto según el nivel
  IF v_level = 'preescolar' THEN
    v_areas := ARRAY['Lenguaje y Comunicación','Pensamiento Matemático','Exploración y Conocimiento','Desarrollo Socioemocional','Arte y Expresión'];
  ELSIF v_level = 'primaria' THEN
    v_areas := ARRAY['Español','Matemáticas','Ciencias Naturales','Ciencias Sociales','Inglés'];
  ELSE
    v_areas := ARRAY['Desarrollo Socioemocional','Psicomotricidad','Lenguaje','Descubrimiento del Entorno','Arte y Creatividad'];
  END IF;

  -- 5 actividades por defecto para cada área
  v_def_acts := ARRAY['Participación en clase','Trabajo individual','Trabajo en equipo','Evaluación escrita','Proyecto o tarea'];

  -- Período objetivo: el período activo del centro (compartido por fechas) o
  -- el último período legacy; si no existe ninguno, se crea uno propio del aula.
  SELECT ap.id INTO v_active_ap
  FROM public.academic_periods ap
  JOIN public.school_years sy ON sy.id = ap.school_year_id
  WHERE ap.is_active = true AND ap.status = 'open'
    AND sy.status IN ('active','enrollment','reenrollment')
  ORDER BY ap.order_index
  LIMIT 1;

  IF v_active_ap IS NOT NULL THEN
    v_period_id := public.resolve_period_id(v_active_ap);
  END IF;

  IF v_period_id IS NULL THEN
    SELECT id INTO v_period_id FROM public.periods
    WHERE is_active = true AND status = 'open'
    ORDER BY created_at DESC, id DESC LIMIT 1;
  END IF;

  IF v_period_id IS NULL THEN
    SELECT id INTO v_period_id FROM public.periods
    ORDER BY created_at DESC, id DESC LIMIT 1;
  END IF;

  IF v_period_id IS NULL THEN
    INSERT INTO public.periods (name, start_date, end_date, status, is_active, classroom_id)
    VALUES ('Período ' || v_classroom.name, current_date, (current_date + interval '6 months')::date, 'open', true, p_classroom_id)
    RETURNING id INTO v_period_id;
  END IF;

  -- Crear las 5 áreas + su period_config + sus 5 actividades (idempotente)
  FOREACH v_area IN ARRAY v_areas LOOP
    IF NOT EXISTS (SELECT 1 FROM public.subjects
                   WHERE classroom_id = p_classroom_id AND name = v_area) THEN
      INSERT INTO public.subjects (name, education_level, description, classroom_id)
      VALUES (v_area, v_level, 'Área del aula ' || v_classroom.name, p_classroom_id);
    END IF;

    SELECT id INTO v_subject_id FROM public.subjects
    WHERE classroom_id = p_classroom_id AND name = v_area
    LIMIT 1;
    IF v_subject_id IS NULL THEN CONTINUE; END IF;

    SELECT id INTO v_config_id FROM public.period_config
    WHERE period_id = v_period_id AND subject_id = v_subject_id
    LIMIT 1;

    IF v_config_id IS NULL THEN
      INSERT INTO public.period_config (period_id, subject_id, activity_count, classroom_id)
      VALUES (v_period_id, v_subject_id, 5, p_classroom_id)
      RETURNING id INTO v_config_id;
    END IF;
    IF v_config_id IS NULL THEN CONTINUE; END IF;

    v_idx := 1;
    FOREACH v_act IN ARRAY v_def_acts LOOP
      IF NOT EXISTS (SELECT 1 FROM public.activities
                     WHERE config_id = v_config_id AND activity_number = v_idx) THEN
        INSERT INTO public.activities (config_id, title, description, max_score, activity_number, is_mandatory)
        VALUES (v_config_id, v_act, 'Actividad evaluable del área ' || v_area, 100, v_idx, true);
      END IF;
      v_idx := v_idx + 1;
    END LOOP;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_classroom_areas(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_classroom_areas(bigint) TO service_role;

-- 3. Trigger: al crear un aula, generar sus áreas automáticamente
CREATE OR REPLACE FUNCTION public.classroom_after_insert_areas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ensure_classroom_areas(NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_classroom_auto_areas ON public.classrooms;
CREATE TRIGGER trg_classroom_auto_areas
  AFTER INSERT ON public.classrooms
  FOR EACH ROW EXECUTE FUNCTION public.classroom_after_insert_areas();

-- 4. Backfill: aulas existentes (idempotente)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.classrooms LOOP
    PERFORM public.ensure_classroom_areas(r.id);
  END LOOP;
END $$;

-- 5. RLS de aislamiento estricto por aula
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
CREATE POLICY "schedule_access_staff" ON public.classroom_event_schedule FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id));
CREATE POLICY "schedule_access_parent" ON public.classroom_event_schedule FOR SELECT
  USING (public.is_classroom_accessible(classroom_id));

DROP POLICY IF EXISTS "timeline_log_staff" ON public.timeline_event_log;
DROP POLICY IF EXISTS "timeline_log_parent" ON public.timeline_event_log;
DROP POLICY IF EXISTS "Maestras ven logs de su aula" ON public.timeline_event_log;
DROP POLICY IF EXISTS "Maestras insertan logs en su aula" ON public.timeline_event_log;
DROP POLICY IF EXISTS "Padres ven logs de hijos" ON public.timeline_event_log;
CREATE POLICY "timeline_log_access_staff" ON public.timeline_event_log FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id));
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

-- ── GALERÍA Y CHAT DEL AULA ──
DROP POLICY IF EXISTS "gallery_all" ON public.classroom_gallery;
CREATE POLICY "gallery_access" ON public.classroom_gallery FOR ALL
  USING (public.is_classroom_accessible(classroom_id))
  WITH CHECK (public.is_classroom_accessible(classroom_id));
DROP POLICY IF EXISTS "classroom_chat_all" ON public.classroom_chat;
CREATE POLICY "classroom_chat_access" ON public.classroom_chat FOR ALL
  USING (public.is_classroom_accessible(classroom_id))
  WITH CHECK (public.is_classroom_accessible(classroom_id));

-- 6. RPCs con filtro por aula (p_classroom_id opcional)
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
