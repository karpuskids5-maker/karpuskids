-- ══════════════════════════════════════════════════════════════
-- FIX: Padres pueden ver perfiles de staff para el chat
-- El RLS anterior solo permitía ver: propio perfil OR staff ve todos
-- Padres necesitan ver: directora/asistente + profesores de sus aulas
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (
  deleted_at IS NULL AND (
    -- 1. Cualquiera ve su propio perfil
    auth.uid() = id
    -- 2. Staff ve todos los perfiles
    OR get_my_role() IN ('directora', 'asistente', 'admin')
    -- 3. Padres ven perfiles de directora/asistente (para chat, notificaciones)
    OR (
      get_my_role() = 'padre'
      AND role IN ('directora', 'asistente')
    )
    -- 4. Padres ven el perfil del profesor titular de sus aulas
    OR (
      get_my_role() = 'padre'
      AND id IN (
        SELECT c.teacher_id
        FROM public.classrooms c
        JOIN public.students s ON s.classroom_id = c.id
        WHERE s.parent_id = auth.uid()
          AND c.teacher_id IS NOT NULL
      )
    )
  )
);

SELECT '✅ profiles_select actualizado — padres ven staff en chat' AS status;
