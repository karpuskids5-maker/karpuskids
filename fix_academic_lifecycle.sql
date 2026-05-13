-- ============================================================
-- 🎓 Karpus Kids — Sistema de Ciclo de Vida Académico
-- Ejecutar en Supabase SQL Editor DESPUÉS de fix_period_close.sql
-- ============================================================

-- ── 1. COLUMNAS NECESARIAS ───────────────────────────────────────────────────

-- Vincular tasks al período académico
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS period_id bigint REFERENCES public.periods(id) ON DELETE SET NULL;

-- Vincular posts al período académico
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS period_id bigint REFERENCES public.periods(id) ON DELETE SET NULL;

-- Índices para filtrado eficiente por período
CREATE INDEX IF NOT EXISTS idx_tasks_period    ON public.tasks(period_id, classroom_id);
CREATE INDEX IF NOT EXISTS idx_posts_period    ON public.posts(period_id, classroom_id);
CREATE INDEX IF NOT EXISTS idx_grades_period   ON public.grades(period_id, student_id);
CREATE INDEX IF NOT EXISTS idx_evidences_task  ON public.task_evidences(task_id, student_id);

-- ── 2. RPC: Obtener período activo global (sin filtro de aula) ───────────────
CREATE OR REPLACE FUNCTION public.get_current_period()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period periods%ROWTYPE;
BEGIN
  -- Período marcado como is_active = true
  SELECT * INTO v_period FROM public.periods
  WHERE is_active = true ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    -- Fallback: cualquier período abierto más reciente
    SELECT * INTO v_period FROM public.periods
    WHERE status = 'open' ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found',      true,
    'id',         v_period.id,
    'name',       v_period.name,
    'status',     v_period.status,
    'is_active',  v_period.is_active,
    'start_date', v_period.start_date,
    'end_date',   v_period.end_date,
    'classroom_id', v_period.classroom_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_current_period() TO authenticated;

-- ── 3. RPC: Tareas del período activo para una maestra ───────────────────────
-- Maestra solo ve tareas del período activo de su aula
CREATE OR REPLACE FUNCTION public.get_tasks_for_period(p_classroom_id bigint, p_period_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period_id bigint := p_period_id;
  v_result    jsonb;
BEGIN
  -- Si no se pasa period_id, usar el activo del aula
  IF v_period_id IS NULL THEN
    SELECT id INTO v_period_id FROM public.periods
    WHERE classroom_id = p_classroom_id AND is_active = true
    ORDER BY created_at DESC LIMIT 1;

    -- Fallback: cualquier período abierto
    IF v_period_id IS NULL THEN
      SELECT id INTO v_period_id FROM public.periods
      WHERE classroom_id = p_classroom_id AND status = 'open'
      ORDER BY created_at DESC LIMIT 1;
    END IF;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',          t.id,
      'title',       t.title,
      'description', t.description,
      'due_date',    t.due_date,
      'file_url',    t.file_url,
      'grading_system', t.grading_system,
      'classroom_id', t.classroom_id,
      'period_id',   t.period_id,
      'created_at',  t.created_at
    ) ORDER BY t.due_date ASC
  )
  INTO v_result
  FROM public.tasks t
  WHERE t.classroom_id = p_classroom_id
    AND (
      -- Si hay período activo, filtrar por él
      v_period_id IS NULL
      OR t.period_id = v_period_id
      -- Incluir tareas sin period_id creadas dentro del rango del período
      OR (t.period_id IS NULL AND v_period_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.periods p
        WHERE p.id = v_period_id
          AND t.created_at BETWEEN p.start_date AND p.end_date + INTERVAL '1 day'
      ))
    );

  RETURN jsonb_build_object(
    'tasks',     COALESCE(v_result, '[]'::jsonb),
    'period_id', v_period_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_tasks_for_period(bigint, bigint) TO authenticated;

-- ── 4. RPC: Posts del período activo para padres ─────────────────────────────
-- Padres solo ven posts del período activo de su aula
CREATE OR REPLACE FUNCTION public.get_posts_for_period(
  p_classroom_id bigint DEFAULT NULL,
  p_period_id    bigint DEFAULT NULL,
  p_limit        int    DEFAULT 50
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period_id bigint := p_period_id;
  v_result    jsonb;
BEGIN
  -- Resolver período activo si no se pasa
  IF v_period_id IS NULL AND p_classroom_id IS NOT NULL THEN
    SELECT id INTO v_period_id FROM public.periods
    WHERE classroom_id = p_classroom_id AND is_active = true
    ORDER BY created_at DESC LIMIT 1;

    IF v_period_id IS NULL THEN
      SELECT id INTO v_period_id FROM public.periods
      WHERE classroom_id = p_classroom_id AND status = 'open'
      ORDER BY created_at DESC LIMIT 1;
    END IF;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',           p.id,
      'content',      p.content,
      'media_url',    p.media_url,
      'media_type',   p.media_type,
      'image_url',    p.image_url,
      'created_at',   p.created_at,
      'classroom_id', p.classroom_id,
      'period_id',    p.period_id,
      'teacher_id',   p.teacher_id,
      'teacher', jsonb_build_object(
        'name',       COALESCE(pr.name, p.teacher_name, 'Maestra'),
        'avatar_url', COALESCE(pr.avatar_url, p.teacher_avatar),
        'role',       pr.role
      ),
      'likes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('user_id', l.user_id, 'id', l.id))
        FROM public.likes l WHERE l.post_id = p.id
      ), '[]'::jsonb),
      'comments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', c.id, 'content', c.content,
          'user_name', c.user_name, 'user_id', c.user_id,
          'created_at', c.created_at
        ) ORDER BY c.created_at ASC)
        FROM public.comments c WHERE c.post_id = p.id
      ), '[]'::jsonb)
    ) ORDER BY p.created_at DESC
  )
  INTO v_result
  FROM public.posts p
  LEFT JOIN public.profiles pr ON pr.id = p.teacher_id
  WHERE
    -- Posts del aula del estudiante O posts generales
    (p.classroom_id = p_classroom_id OR p.classroom_id IS NULL)
    AND (
      -- Filtrar por período si existe
      v_period_id IS NULL
      OR p.period_id = v_period_id
      OR (p.period_id IS NULL AND v_period_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.periods per
        WHERE per.id = v_period_id
          AND p.created_at BETWEEN per.start_date AND per.end_date + INTERVAL '1 day'
      ))
    )
  LIMIT p_limit;

  RETURN jsonb_build_object(
    'posts',     COALESCE(v_result, '[]'::jsonb),
    'period_id', v_period_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_posts_for_period(bigint, bigint, int) TO authenticated;

-- ── 5. RPC: Activar nuevo período (Directora) ────────────────────────────────
-- Desactiva el período anterior y activa el nuevo
CREATE OR REPLACE FUNCTION public.activate_period(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id   uuid;
  v_role      text;
  v_period    periods%ROWTYPE;
  v_old_id    bigint;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora', 'admin') THEN
    RETURN jsonb_build_object('error', 'Solo la directora puede activar períodos');
  END IF;

  SELECT * INTO v_period FROM public.periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Período no encontrado');
  END IF;

  -- Guardar el período activo anterior
  SELECT id INTO v_old_id FROM public.periods WHERE is_active = true LIMIT 1;

  -- Desactivar todos los períodos del mismo aula
  UPDATE public.periods
  SET is_active = false
  WHERE classroom_id = v_period.classroom_id OR classroom_id IS NULL;

  -- Activar el nuevo
  UPDATE public.periods
  SET is_active = true, status = 'open'
  WHERE id = p_period_id;

  -- Auditoría
  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (v_user_id, 'period.activated', jsonb_build_object(
    'new_period_id',  p_period_id,
    'new_period_name', v_period.name,
    'old_period_id',  v_old_id
  ), now());

  RETURN jsonb_build_object(
    'success',         true,
    'period_id',       p_period_id,
    'period_name',     v_period.name,
    'old_period_id',   v_old_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.activate_period(bigint) TO authenticated;

-- ── 6. RPC: Historial de estudiante por período (Directora/Auditoría) ────────
CREATE OR REPLACE FUNCTION public.get_student_history(p_student_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora', 'asistente', 'admin') THEN
    RETURN jsonb_build_object('error', 'No autorizado');
  END IF;

  RETURN (
    SELECT jsonb_agg(
      jsonb_build_object(
        'period_id',    rc.period_id,
        'period_name',  p.name,
        'period_status', p.status,
        'classroom_id', rc.classroom_id,
        'classroom_name', c.name,
        'task_avg',     rc.task_avg,
        'formal_avg',   rc.formal_avg,
        'final_score',  rc.final_score,
        'level',        rc.level,
        'teacher_comment', rc.teacher_comment,
        'created_at',   rc.created_at
      ) ORDER BY p.start_date DESC
    )
    FROM public.report_cards rc
    JOIN public.periods p ON p.id = rc.period_id
    LEFT JOIN public.classrooms c ON c.id = rc.classroom_id
    WHERE rc.student_id = p_student_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_history(bigint) TO authenticated;

-- ── 7. Vista: Tareas del período activo por aula ─────────────────────────────
CREATE OR REPLACE VIEW public.v_active_tasks AS
SELECT
  t.*,
  p.name  AS period_name,
  p.status AS period_status
FROM public.tasks t
LEFT JOIN public.periods p ON p.id = t.period_id
WHERE
  p.is_active = true
  OR (t.period_id IS NULL AND EXISTS (
    SELECT 1 FROM public.periods ap
    WHERE ap.classroom_id = t.classroom_id
      AND ap.is_active = true
      AND t.created_at BETWEEN ap.start_date AND ap.end_date + INTERVAL '1 day'
  ));

GRANT SELECT ON public.v_active_tasks TO authenticated;
