-- fix_preinscripcion_rls.sql
-- El formulario público (anon) inserta en student_preregistrations. El INSERT
-- funcionaba, pero `.insert(...).select('id')` y el posterior `update(documents)`
-- fallaban porque `anon` no tiene políticas SELECT/UPDATE (solo staff).
-- Solución: RPC SECURITY DEFINER que inserta y devuelve el id, y otro que
-- actualiza el jsonb `documents` tras subir los archivos a Storage.

-- ------------------------------------------------------------
-- 1. submit_preinscripcion: inserta el expediente y devuelve el id
-- ------------------------------------------------------------
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
    school_year_requested, level_requested, schedule, estimated_entry_date,
    has_siblings, sibling_name,
    parent_1, parent_2, emergency_contact, authorized_people,
    medical, documents, consents, signature_data,
    contact_email, contact_phone, user_agent
  )
  VALUES (
    payload->>'student_name', payload->>'student_last_name',
    (payload->>'birth_date')::date, payload->>'gender', COALESCE(payload->>'nationality', 'Dominicana'),
    payload->>'school_year_requested', payload->>'level_requested', payload->>'schedule',
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

-- ------------------------------------------------------------
-- 2. set_preinscripcion_documents: guarda las URLs de los adjuntos
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_preinscripcion_documents(p_id bigint, documents jsonb DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.student_preregistrations
  SET documents = documents
  WHERE id = p_id;
END;
$$;

-- ------------------------------------------------------------
-- 3. Seguridad: solo anon/authenticated (y nadie más) invocan estas funciones
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.submit_preinscripcion(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_preinscripcion(jsonb) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.set_preinscripcion_documents(bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_preinscripcion_documents(bigint, jsonb) TO anon, authenticated;
