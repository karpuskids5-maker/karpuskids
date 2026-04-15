-- ============================================================
-- PEGA ESTO EN: supabase.com/dashboard/project/wwnfonkvemimwiqjpkij/sql/new
-- ============================================================

-- PASO 1: Añadir la columna classroom_id si no existe
ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS classroom_id bigint REFERENCES public.classrooms(id) ON DELETE SET NULL;

-- PASO 2: Crear función RPC de asignación (2 parámetros, soporta NULL para desasignar)
DROP FUNCTION IF EXISTS public.assign_student_to_classroom(bigint, bigint);
DROP FUNCTION IF EXISTS public.assign_student_to_classroom(bigint);

CREATE OR REPLACE FUNCTION public.assign_student_to_classroom(p_student_id bigint, p_classroom_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  ALTER TABLE public.students ADD COLUMN IF NOT EXISTS classroom_id bigint REFERENCES public.classrooms(id) ON DELETE SET NULL;
  UPDATE public.students SET classroom_id = p_classroom_id WHERE id = p_student_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_student_to_classroom(bigint, bigint) TO authenticated;

-- PASO 3: Verificar
SELECT id, name, classroom_id FROM public.students LIMIT 5;
