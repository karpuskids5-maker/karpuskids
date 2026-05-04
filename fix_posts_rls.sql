-- ============================================================
-- FIX CRÍTICO: Posts generales visibles para padres y maestras
-- EJECUTAR EN: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. FUNCIÓN RPC que bypasea RLS para padres ────────────────────────────────
-- Esta función usa SECURITY DEFINER para leer posts sin restricciones de RLS
-- Solo retorna posts del aula del padre O posts generales (classroom_id IS NULL)

CREATE OR REPLACE FUNCTION public.get_posts_for_parent(p_classroom_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',           p.id,
      'content',      p.content,
      'media_url',    p.media_url,
      'media_type',   p.media_type,
      'image_url',    p.image_url,
      'created_at',   p.created_at,
      'classroom_id', p.classroom_id,
      'teacher_id',   p.teacher_id,
      'teacher', jsonb_build_object(
        'name',       COALESCE(pr.name, p.teacher_name, 'Maestra'),
        'avatar_url', COALESCE(pr.avatar_url, p.teacher_avatar),
        'role',       pr.role
      ),
      'likes',    COALESCE((
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
    )
    ORDER BY p.created_at DESC
  )
  INTO v_result
  FROM public.posts p
  LEFT JOIN public.profiles pr ON pr.id = p.teacher_id
  WHERE
    -- Posts generales (sin aula) — visibles para todos
    p.classroom_id IS NULL
    -- O posts del aula específica del estudiante
    OR (p_classroom_id IS NOT NULL AND p.classroom_id = p_classroom_id);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- Dar acceso a usuarios autenticados
GRANT EXECUTE ON FUNCTION public.get_posts_for_parent(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_posts_for_parent(bigint) TO anon;

-- ── 2. ACTUALIZAR POLÍTICAS RLS (también necesario) ───────────────────────────

DROP POLICY IF EXISTS "posts_select" ON public.posts;
CREATE POLICY "posts_select" ON public.posts FOR SELECT USING (
  auth.uid() IS NOT NULL
  AND (
    get_my_role() IN ('directora', 'asistente', 'admin', 'maestra')
    OR classroom_id IS NULL
    OR is_teacher_of_classroom(classroom_id)
    OR is_parent_of_classroom(classroom_id)
  )
);

DROP POLICY IF EXISTS "comments_select" ON public.comments;
CREATE POLICY "comments_select" ON public.comments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.posts p WHERE p.id = comments.post_id
    AND (
      auth.uid() IS NOT NULL AND (
        get_my_role() IN ('directora', 'asistente', 'admin', 'maestra')
        OR p.classroom_id IS NULL
        OR is_teacher_of_classroom(p.classroom_id)
        OR is_parent_of_classroom(p.classroom_id)
      )
    )
  )
);

DROP POLICY IF EXISTS "comments_insert" ON public.comments;
CREATE POLICY "comments_insert" ON public.comments FOR INSERT WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.posts p WHERE p.id = comments.post_id
    AND (
      get_my_role() IN ('directora', 'asistente', 'maestra', 'admin')
      OR p.classroom_id IS NULL
      OR is_parent_of_classroom(p.classroom_id)
    )
  )
);

DROP POLICY IF EXISTS "likes_select" ON public.likes;
CREATE POLICY "likes_select" ON public.likes FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.posts p WHERE p.id = likes.post_id
    AND (
      auth.uid() IS NOT NULL AND (
        get_my_role() IN ('directora', 'asistente', 'admin', 'maestra')
        OR p.classroom_id IS NULL
        OR is_teacher_of_classroom(p.classroom_id)
        OR is_parent_of_classroom(p.classroom_id)
      )
    )
  )
);

-- ── 3. VERIFICAR que hay posts generales ─────────────────────────────────────
-- Ejecuta esto para confirmar:
-- SELECT id, content, classroom_id, created_at FROM public.posts
-- WHERE classroom_id IS NULL ORDER BY created_at DESC LIMIT 5;
