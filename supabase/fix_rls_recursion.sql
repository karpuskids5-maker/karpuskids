-- FIX: Corregir error de "infinite recursion" en políticas RLS y agregar columnas faltantes
-- Este script crea una función segura para verificar roles, actualiza las políticas y asegura que la tabla students tenga todas las columnas.

-- 1. Función para obtener el rol del usuario actual (bypass RLS)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- 2. Corregir política recursiva en PROFILES
DROP POLICY IF EXISTS "Directora ve todos los perfiles" ON public.profiles;

CREATE POLICY "Directora ve todos los perfiles" ON public.profiles FOR SELECT USING (
  get_my_role() = 'directora'
);

-- 3. Optimizar otras políticas para usar la nueva función (evita subconsultas repetitivas)

-- Classrooms
DROP POLICY IF EXISTS "Directora gestiona aulas" ON public.classrooms;
CREATE POLICY "Directora gestiona aulas" ON public.classrooms FOR ALL USING (
  get_my_role() = 'directora'
);

DROP POLICY IF EXISTS "Maestra ve sus aulas" ON public.classrooms;
CREATE POLICY "Maestra ve sus aulas" ON public.classrooms FOR SELECT USING (
  teacher_id = auth.uid() OR get_my_role() = 'directora'
);

-- Students
DROP POLICY IF EXISTS "Directora gestiona estudiantes" ON public.students;
CREATE POLICY "Directora gestiona estudiantes" ON public.students FOR ALL USING (
  get_my_role() = 'directora'
);

-- Attendance
DROP POLICY IF EXISTS "Directora ve asistencia" ON public.attendance;
CREATE POLICY "Directora ve asistencia" ON public.attendance FOR SELECT USING (
  get_my_role() = 'directora'
);

-- 4. Agregar columnas faltantes a la tabla students (para el modal de perfil)
ALTER TABLE public.students 
ADD COLUMN IF NOT EXISTS p1_name text,
ADD COLUMN IF NOT EXISTS p1_phone text,
ADD COLUMN IF NOT EXISTS p1_email text,
ADD COLUMN IF NOT EXISTS p1_job text,
ADD COLUMN IF NOT EXISTS p1_address text,
ADD COLUMN IF NOT EXISTS p1_emergency_contact text,
ADD COLUMN IF NOT EXISTS p2_name text,
ADD COLUMN IF NOT EXISTS p2_phone text,
ADD COLUMN IF NOT EXISTS p2_email text,
ADD COLUMN IF NOT EXISTS p2_job text,
ADD COLUMN IF NOT EXISTS p2_address text,
ADD COLUMN IF NOT EXISTS p2_emergency_contact text,
ADD COLUMN IF NOT EXISTS start_date date,
ADD COLUMN IF NOT EXISTS allergies text,
ADD COLUMN IF NOT EXISTS blood_type text,
ADD COLUMN IF NOT EXISTS authorized_pickup text;
