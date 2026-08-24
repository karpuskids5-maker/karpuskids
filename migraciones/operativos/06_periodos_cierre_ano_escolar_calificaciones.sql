-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · SQL OPERATIVO 06/10 — PERÍODOS · CIERRE · AÑO ESCOLAR · CALIFICACIONES
-- ═══════════════════════════════════════════════════════════════════════════
-- Continuación del esquema maestro (karpus_schema_completo.sql).
-- Contenido: SECCIÓN 15 períodos · 16 cierre con calificaciones V2 · 17 año escolar · 18 calificaciones/tareas por período
-- Origen: líneas 3399–3866 del archivo original.
--
-- ⚠ EJECUTAR EN ORDEN: 01 → 10 (Supabase Dashboard → SQL Editor)
--   Cada archivo continúa el esquema del anterior; no saltarse ninguno
--   en una base nueva. En la base existente son idempotentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- SECCIÓN 15: PERÍODOS — get_current_period, get_active_period, activate_period
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_current_period()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period periods%ROWTYPE;
BEGIN
  SELECT * INTO v_period FROM public.periods WHERE is_active = true ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN SELECT * INTO v_period FROM public.periods WHERE status = 'open' ORDER BY created_at DESC LIMIT 1; END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF;
  RETURN jsonb_build_object('found',true,'id',v_period.id,'name',v_period.name,'status',v_period.status,
    'is_active',v_period.is_active,'start_date',v_period.start_date,'end_date',v_period.end_date,'classroom_id',v_period.classroom_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_current_period() TO authenticated;

-- get_active_period — busca en academic_periods primero, fallback a legacy periods
-- Devuelve SIEMPRE el id de legacy "periods" (donde viven period_config/activities/
-- grades/report_cards), igual que get_grade_periods, para que maestra, directora y
-- padres usen exactamente el mismo id que la configuración de materias.
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

CREATE OR REPLACE FUNCTION public.activate_period(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid; v_role text; v_period periods%ROWTYPE; v_old_id bigint;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora','admin') THEN RETURN jsonb_build_object('error','Solo la directora puede activar períodos'); END IF;
  SELECT * INTO v_period FROM public.periods WHERE id = p_period_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Período no encontrado'); END IF;
  SELECT id INTO v_old_id FROM public.periods WHERE is_active = true LIMIT 1;
  UPDATE public.periods SET is_active = false WHERE classroom_id = v_period.classroom_id OR classroom_id IS NULL;
  UPDATE public.periods SET is_active = true, status = 'open' WHERE id = p_period_id;
  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (v_user_id,'period.activated',jsonb_build_object('new_period_id',p_period_id,'old_period_id',v_old_id),now());
  RETURN jsonb_build_object('success',true,'period_id',p_period_id,'period_name',v_period.name,'old_period_id',v_old_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.activate_period(bigint) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 16: CIERRE DE PERÍODO con calificaciones V2
-- ══════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 17: AÑO ESCOLAR — get_active_school_year, get/advance_school_year_status
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_active_school_year()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('id',id,'name',name,'start_date',start_date,'end_date',end_date,'status',status,
    'enrollment_start',enrollment_start,'enrollment_end',enrollment_end,
    'reenrollment_start',reenrollment_start,'reenrollment_end',reenrollment_end)
  INTO v_result FROM public.school_years
  WHERE status IN ('active','enrollment','reenrollment')
  ORDER BY CASE status WHEN 'active' THEN 1 WHEN 'enrollment' THEN 2 WHEN 'reenrollment' THEN 3 END LIMIT 1;
  RETURN COALESCE(v_result,'{}');
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_active_school_year() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_school_year_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_year record; v_today date := CURRENT_DATE;
  v_enrollment_open boolean := false; v_reenrollment_open boolean := false;
  v_active_period jsonb; v_days_remaining integer; v_ap_count int;
BEGIN
  SELECT * INTO v_year FROM public.school_years WHERE status IN ('active','enrollment','reenrollment') LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_year FROM public.school_years WHERE status = 'draft' ORDER BY id DESC LIMIT 1;
    IF FOUND THEN UPDATE public.school_years SET status='active', updated_at=now() WHERE id = v_year.id; END IF;
  END IF;
  IF NOT FOUND THEN
    SELECT COUNT(*) INTO v_ap_count FROM public.academic_periods;
    IF v_ap_count > 0 THEN RETURN jsonb_build_object('has_active_year',false,'status','orphan_periods','orphan_count',v_ap_count); END IF;
    RETURN jsonb_build_object('has_active_year',false,'status','none','message','No hay año escolar configurado');
  END IF;
  IF v_year.enrollment_start IS NOT NULL AND v_year.enrollment_end IS NOT NULL THEN
    v_enrollment_open := v_today BETWEEN v_year.enrollment_start AND v_year.enrollment_end;
  END IF;
  IF v_year.reenrollment_start IS NOT NULL AND v_year.reenrollment_end IS NOT NULL THEN
    v_reenrollment_open := v_today BETWEEN v_year.reenrollment_start AND v_year.reenrollment_end;
  END IF;
  v_active_period := public.get_active_period();
  v_days_remaining := GREATEST(0,(v_year.end_date - v_today)::int);
  RETURN jsonb_build_object(
    'has_active_year',true,'school_year_id',v_year.id,'school_year_name',v_year.name,
    'status',v_year.status,'start_date',v_year.start_date,'end_date',v_year.end_date,
    'enrollment_open',v_enrollment_open,'enrollment_window',jsonb_build_object('start',v_year.enrollment_start,'end',v_year.enrollment_end),
    'reenrollment_open',v_reenrollment_open,'reenrollment_window',jsonb_build_object('start',v_year.reenrollment_start,'end',v_year.reenrollment_end),
    'active_period',v_active_period,'days_remaining',v_days_remaining,
    'is_school_time',v_year.status = 'active' AND v_today BETWEEN v_year.start_date AND v_year.end_date
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_school_year_status() TO authenticated;

-- create_school_year / update_school_year
CREATE OR REPLACE FUNCTION public.create_school_year(
  p_name text, p_start_date date, p_end_date date,
  p_enrollment_start date DEFAULT NULL, p_enrollment_end date DEFAULT NULL,
  p_reenrollment_start date DEFAULT NULL, p_reenrollment_end date DEFAULT NULL,
  p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text; v_status text; v_row public.school_years%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','admin') THEN RETURN jsonb_build_object('error','Solo directora o admin pueden crear años escolares'); END IF;
  v_status := COALESCE(p_status, CASE WHEN p_enrollment_start IS NOT NULL THEN 'draft' ELSE 'active' END);
  INSERT INTO public.school_years (name, start_date, end_date, enrollment_start, enrollment_end, reenrollment_start, reenrollment_end, status, created_by)
  VALUES (p_name, p_start_date, p_end_date, p_enrollment_start, p_enrollment_end, p_reenrollment_start, p_reenrollment_end, v_status, auth.uid())
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('id',v_row.id,'name',v_row.name,'status',v_row.status,'created_at',v_row.created_at);
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_school_year(text,date,date,date,date,date,date,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_academic_period(
  p_school_year_id bigint, p_name text, p_start_date date, p_end_date date,
  p_order_index integer, p_status text DEFAULT 'pending', p_is_active boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text; v_row public.academic_periods%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','maestra','asistente','admin') THEN RETURN jsonb_build_object('error','Sin permisos'); END IF;
  INSERT INTO public.academic_periods (school_year_id, name, start_date, end_date, order_index, status, is_active)
  VALUES (p_school_year_id, p_name, p_start_date, p_end_date, p_order_index, p_status, p_is_active) RETURNING * INTO v_row;
  RETURN jsonb_build_object('id',v_row.id,'name',v_row.name,'status',v_row.status);
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_academic_period(bigint,text,date,date,integer,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_academic_period(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text; v_period public.academic_periods%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','maestra','asistente','admin') THEN RETURN jsonb_build_object('error','Sin permisos'); END IF;
  SELECT * INTO v_period FROM public.academic_periods WHERE id = p_period_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Período no encontrado'); END IF;
  UPDATE public.academic_periods SET is_active=false WHERE school_year_id = v_period.school_year_id;
  UPDATE public.academic_periods SET is_active=true, status='open' WHERE id = p_period_id;
  RETURN jsonb_build_object('success',true,'id',v_period.id,'name',v_period.name);
END;
$$;
GRANT EXECUTE ON FUNCTION public.activate_academic_period(bigint) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 18: CALIFICACIONES — get_tasks_for_period, get_posts_for_period,
--             get_period_config, get_activities_with_grades, get_student_grades_v2,
--             get_student_subject_averages, get_student_history
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_tasks_for_period(p_classroom_id bigint, p_period_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period_id bigint := p_period_id; v_result jsonb;
BEGIN
  IF v_period_id IS NULL THEN
    SELECT id INTO v_period_id FROM public.periods WHERE classroom_id = p_classroom_id AND is_active = true ORDER BY created_at DESC LIMIT 1;
    IF v_period_id IS NULL THEN SELECT id INTO v_period_id FROM public.periods WHERE classroom_id = p_classroom_id AND status = 'open' ORDER BY created_at DESC LIMIT 1; END IF;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'description',t.description,'due_date',t.due_date,
    'file_url',t.file_url,'grading_system',t.grading_system,'classroom_id',t.classroom_id,'period_id',t.period_id,'created_at',t.created_at)
    ORDER BY t.due_date ASC) INTO v_result
  FROM public.tasks t
  WHERE t.classroom_id = p_classroom_id
    AND (v_period_id IS NULL OR t.period_id = v_period_id OR
      (t.period_id IS NULL AND v_period_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.periods p WHERE p.id = v_period_id AND t.created_at BETWEEN p.start_date AND p.end_date + INTERVAL '1 day')));
  RETURN jsonb_build_object('tasks',COALESCE(v_result,'[]'),'period_id',v_period_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_tasks_for_period(bigint, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_posts_for_period(
  p_classroom_id bigint DEFAULT NULL, p_period_id bigint DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period_id bigint := p_period_id; v_result jsonb;
BEGIN
  IF v_period_id IS NULL AND p_classroom_id IS NOT NULL THEN
    SELECT id INTO v_period_id FROM public.periods WHERE classroom_id = p_classroom_id AND is_active = true ORDER BY created_at DESC LIMIT 1;
    IF v_period_id IS NULL THEN SELECT id INTO v_period_id FROM public.periods WHERE classroom_id = p_classroom_id AND status = 'open' ORDER BY created_at DESC LIMIT 1; END IF;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id',p.id,'content',p.content,'media_url',p.media_url,'media_type',p.media_type,
    'image_url',p.image_url,'created_at',p.created_at,'classroom_id',p.classroom_id,'teacher_id',p.teacher_id,'period_id',p.period_id,
    'teacher',jsonb_build_object('name',COALESCE(pr.name,p.teacher_name,'Maestra'),'avatar_url',COALESCE(pr.avatar_url,p.teacher_avatar),'role',pr.role),
    'likes',COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id',l.user_id,'id',l.id)) FROM public.likes l WHERE l.post_id = p.id),'[]'),
    'comments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'content',c.content,'user_name',c.user_name,'user_id',c.user_id,'created_at',c.created_at) ORDER BY c.created_at) FROM public.comments c WHERE c.post_id = p.id),'[]'))
    ORDER BY p.created_at DESC) INTO v_result
  FROM public.posts p
  LEFT JOIN public.profiles pr ON pr.id = p.teacher_id
  WHERE (p.classroom_id = p_classroom_id OR p.classroom_id IS NULL)
    AND (v_period_id IS NULL OR p.period_id = v_period_id OR
      (p.period_id IS NULL AND v_period_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.periods per WHERE per.id = v_period_id AND p.created_at BETWEEN per.start_date AND per.end_date + INTERVAL '1 day')))
  LIMIT p_limit;
  RETURN jsonb_build_object('posts',COALESCE(v_result,'[]'),'period_id',v_period_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_posts_for_period(bigint, bigint, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_period_config(p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',pc.id,'subject_id',pc.subject_id,'subject_name',s.name,
    'education_level',s.education_level,'activity_count',pc.activity_count) ORDER BY s.name),'[]')
  FROM public.period_config pc JOIN public.subjects s ON s.id = pc.subject_id WHERE pc.period_id = public.resolve_period_id(p_period_id);
$$;
GRANT EXECUTE ON FUNCTION public.get_period_config(bigint) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.get_student_subject_averages(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period_id bigint;
  v_area      record;
  v_count     int;
  v_avg       numeric(5,2);
  v_result    jsonb := '[]'::jsonb;
BEGIN
  -- Promedio por materia EN TIEMPO REAL (grades + task_evidences), misma
  -- lógica del boletín (mejores 5 si hay 5+ notas). Antes solo aparecía al
  -- cerrar el período (subject_averages), dejando "Sin calificar" en curso.
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

CREATE OR REPLACE FUNCTION public.get_student_history(p_student_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('period_name',p.name,'classroom_name',c.name,
    'task_avg',rc.task_avg,'formal_avg',rc.formal_avg,'final_score',rc.final_score,
    'level',rc.level,'teacher_comment',rc.teacher_comment,'generated_at',rc.generated_at)
    ORDER BY p.start_date DESC),'[]')
  FROM public.report_cards rc JOIN public.periods p ON p.id = rc.period_id
  LEFT JOIN public.classrooms c ON c.id = rc.classroom_id WHERE rc.student_id = p_student_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_history(bigint) TO authenticated;

-- ══════════════════════════════════════════════════════════════
