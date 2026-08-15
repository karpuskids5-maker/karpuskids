-- ══════════════════════════════════════════════════════════════════════════════
-- HORARIO DE ENTRADA/SALIDA DEL ESTUDIANTE + PREINSCRIPCIÓN (tiempo real aulas)
-- 1) Columnas entry_time / exit_time en students y student_preregistrations
-- 2) submit_preinscripcion acepta y guarda las horas
-- 3) get_classrooms_capacity visible para el público (anon) → nivel con cupos
-- 4) student_name opcional (formulario sin campos obligatorios)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Columnas de horario ────────────────────────────────────────────────────
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS entry_time time,
  ADD COLUMN IF NOT EXISTS exit_time  time;

ALTER TABLE public.student_preregistrations
  ADD COLUMN IF NOT EXISTS entry_time time,
  ADD COLUMN IF NOT EXISTS exit_time  time;

-- ── 2. submit_preinscripcion: guarda horas + tolera expediente incompleto ─────
CREATE OR REPLACE FUNCTION public.submit_preinscripcion(payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.student_preregistrations (
    student_name, student_last_name, birth_date, gender, nationality,
    school_year_requested, level_requested, schedule, entry_time, exit_time,
    estimated_entry_date, has_siblings, sibling_name,
    parent_1, parent_2, emergency_contact, authorized_people,
    medical, documents, consents, signature_data,
    contact_email, contact_phone, user_agent
  )
  VALUES (
    COALESCE(payload->>'student_name', 'Sin nombre'), payload->>'student_last_name',
    (payload->>'birth_date')::date, payload->>'gender', COALESCE(payload->>'nationality', 'Dominicana'),
    payload->>'school_year_requested', payload->>'level_requested', payload->>'schedule',
    (payload->>'entry_time')::time, (payload->>'exit_time')::time,
    (payload->>'estimated_entry_date')::date,
    COALESCE((payload->>'has_siblings')::boolean, false), payload->>'sibling_name',
    COALESCE(payload->'parent_1', '{}'), COALESCE(payload->'parent_2', '{}'),
    COALESCE(payload->'emergency_contact', '{}'), COALESCE(payload->'authorized_people', '[]'),
    COALESCE(payload->'medical', '{}'), COALESCE(payload->'documents', '{}'),
    COALESCE(payload->'consents', '{}'), payload->>'signature_data',
    payload->>'contact_email', payload->>'contact_phone', payload->>'user_agent'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_preinscripcion(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_preinscripcion(jsonb) TO anon, authenticated;

-- formulario 100% opcional → el único campo NOT NULL ya no bloquea
ALTER TABLE public.student_preregistrations ALTER COLUMN student_name DROP NOT NULL;

-- ── 3. Aulas con cupos para el formulario público ─────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_classrooms_capacity() TO anon;
