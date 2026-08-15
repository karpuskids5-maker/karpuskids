-- Agrega columna login_email al expediente de students.
-- Regla: p1_email / p2_email son SOLO correos de notificación.
-- login_email es el correo de ACCESO (login) definido por la directora/asistente
-- y con el cual se crea la cuenta en Supabase Auth (perfil rol 'padre').

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS login_email text;

-- Opcional: para registros existentes con cuenta de padre vinculada,
-- rellena login_email desde el correo del perfil vinculado.
UPDATE public.students s
SET login_email = p.email
FROM public.profiles p
WHERE s.parent_id = p.id
  AND s.login_email IS NULL
  AND p.email IS NOT NULL;
