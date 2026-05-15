-- ============================================================
-- FIX: Permisos de INSERT en tabla posts para maestras
-- EJECUTAR EN: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Asegurar que authenticated puede hacer INSERT/UPDATE/DELETE en posts
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.likes TO authenticated;

-- 2. Asegurar que la secuencia de IDs también tiene permisos
GRANT USAGE, SELECT ON SEQUENCE public.posts_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.comments_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.likes_id_seq TO authenticated;

-- 3. Verificar que la política de INSERT existe y es correcta
DROP POLICY IF EXISTS "posts_insert" ON public.posts;
CREATE POLICY "posts_insert" ON public.posts
  FOR INSERT
  WITH CHECK (
    auth.uid() = teacher_id
    AND get_my_role() IN ('directora', 'asistente', 'maestra', 'admin')
  );

-- 4. Asegurar que period_id existe (por si no se ejecutó fix_academic_lifecycle.sql)
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS period_id bigint REFERENCES public.periods(id) ON DELETE SET NULL;

-- 5. Verificar con:
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
-- WHERE table_name = 'posts' AND grantee = 'authenticated';
