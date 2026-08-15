-- ============================================================
-- FIX: Crear perfil de administrador para impulsodigital@gmail.com
-- UUID: c1e72617-ab8f-44c0-b1eb-cdd92eda62e7
-- EJECUTAR EN: Supabase Dashboard → SQL Editor
-- ============================================================

-- Insertar o actualizar el perfil con rol admin
INSERT INTO public.profiles (id, email, name, role, accepted_terms, created_at)
VALUES (
  'c1e72617-ab8f-44c0-b1eb-cdd92eda62e7',
  'impulsodigital@gmail.com',
  'Administrador',
  'admin',
  true,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  role           = 'admin',
  email          = 'impulsodigital@gmail.com',
  accepted_terms = true;

-- Verificar que quedó bien
SELECT id, email, name, role FROM public.profiles
WHERE id = 'c1e72617-ab8f-44c0-b1eb-cdd92eda62e7';
