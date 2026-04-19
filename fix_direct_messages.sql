-- Ejecutar en Supabase SQL Editor

-- 1. Columna classroom_id
ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS classroom_id bigint REFERENCES public.classrooms(id) ON DELETE SET NULL;

-- 2. Funciones de asignación
CREATE OR REPLACE FUNCTION public.assign_student_to_classroom(p_student_id bigint, p_classroom_id bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.students SET classroom_id = p_classroom_id WHERE id = p_student_id;
$$;

CREATE OR REPLACE FUNCTION public.assign_students_bulk(p_student_ids bigint[], p_classroom_id bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.students SET classroom_id = p_classroom_id WHERE id = ANY(p_student_ids);
$$;

GRANT EXECUTE ON FUNCTION public.assign_student_to_classroom(bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_students_bulk(bigint[], bigint) TO authenticated;

-- 3. get_direct_messages reescrita en SQL puro (sin DECLARE, sin ambigüedad)
CREATE OR REPLACE FUNCTION public.get_direct_messages(p_other_user_id uuid)
RETURNS TABLE (
  id              bigint,
  content         text,
  sender_id       uuid,
  created_at      timestamp with time zone,
  is_read         boolean,
  conversation_id bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    m.id,
    m.content,
    m.sender_id,
    m.created_at,
    m.is_read,
    m.conversation_id
  FROM public.messages m
  WHERE m.conversation_id = (
    SELECT c.id
    FROM public.conversations c
    WHERE c.type IN ('direct_message', 'private')
      AND EXISTS (
        SELECT 1 FROM public.conversation_participants x
        WHERE x.conversation_id = c.id AND x.user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1 FROM public.conversation_participants y
        WHERE y.conversation_id = c.id AND y.user_id = p_other_user_id
      )
    LIMIT 1
  )
  ORDER BY m.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_direct_messages(uuid) TO authenticated;

-- 4. Política profiles abierta para usuarios autenticados
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (
  deleted_at IS NULL AND auth.uid() IS NOT NULL
);
