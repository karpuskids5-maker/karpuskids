-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · PARCHE — Las maestras no ven contactos de directora/asistente
-- ═══════════════════════════════════════════════════════════════════════════
-- SÍNTOMA: En el panel de la maestra, la sección Chat/Contactos NO muestra a
--          la directora ni a las asistentes, así que no puede hablar con ellas.
-- CAUSA:   La política "profiles_select" solo permite ver perfiles ajenos a
--          directora/asistente/admin y a los padres (staff + profesores).
--          Las MAESTRAS quedaron fuera del select → la consulta de contactos
--          staff (chat_app.js) la bloquea RLS y devuelve lista vacía.
-- ACCIÓN:  Ejecutar este script en Supabase → SQL Editor.
--          Es idempotente (DROP POLICY IF EXISTS): puede re-ejecutarse sin daño.
-- ═══════════════════════════════════════════════════════════════════════════

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
    -- 5. MAESTRAS ven perfiles del staff directivo (directora/asistente) para el chat
    OR (
      get_my_role() = 'maestra'
      AND role IN ('directora', 'asistente')
    )
    -- 6. MAESTRAS ven los perfiles de los padres de sus estudiantes (para el chat)
    OR (
      get_my_role() = 'maestra'
      AND id IN (
        SELECT s.parent_id
        FROM public.students s
        WHERE s.parent_id IS NOT NULL
          AND s.deleted_at IS NULL
          AND s.classroom_id IN (
            SELECT c.id FROM public.classrooms c WHERE c.teacher_id = auth.uid()
          )
      )
    )
  )
);

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN DEL PARCHE
-- ═══════════════════════════════════════════════════════════════════════════