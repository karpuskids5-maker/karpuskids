-- ============================================================
-- KARPUS KIDS — Limpiar education_level de subjects
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Relajar el CHECK constraint (acepta cualquier valor de texto)
ALTER TABLE public.subjects 
  DROP CONSTRAINT IF EXISTS subjects_education_level_check;

-- 2. Hacer el campo nullable para mayor flexibilidad
ALTER TABLE public.subjects 
  ALTER COLUMN education_level DROP NOT NULL;

-- 3. Actualizar los valores del schema inicial a NULL
--    (ya no se usan estancia/preescolar/primaria como categorías)
UPDATE public.subjects
SET education_level = NULL
WHERE education_level IN ('estancia', 'preescolar', 'primaria');

-- 4. Actualizar también la función insert_subject para que acepte NULL
--    y áreas por aula (p_classroom_id). Solo directora/asistente crean áreas.
DROP FUNCTION IF EXISTS public.insert_subject(text, text, text, bigint);
DROP FUNCTION IF EXISTS public.insert_subject(text, text, text);
CREATE OR REPLACE FUNCTION public.insert_subject(
  p_name            text,
  p_education_level text DEFAULT NULL,
  p_description     text DEFAULT NULL,
  p_classroom_id    bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_row  public.subjects%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error', 'Solo directora/asistente pueden crear áreas');
  END IF;

  IF p_classroom_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.classrooms WHERE id = p_classroom_id) THEN
    RETURN jsonb_build_object('error', 'El aula seleccionada no existe');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subjects
    WHERE name = btrim(p_name)
      AND ((p_classroom_id IS NULL AND classroom_id IS NULL)
           OR (p_classroom_id IS NOT NULL AND classroom_id = p_classroom_id))
  ) THEN
    RETURN jsonb_build_object('error', CASE WHEN p_classroom_id IS NOT NULL
      THEN 'Ya existe un área con ese nombre en este aula'
      ELSE 'Ya existe un área con ese nombre' END);
  END IF;

  INSERT INTO public.subjects (name, education_level, description, is_active, classroom_id)
  VALUES (btrim(p_name), p_education_level, p_description, true, p_classroom_id)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'name', v_row.name);
END;
$$;
GRANT EXECUTE ON FUNCTION public.insert_subject(text, text, text, bigint) TO authenticated;

-- 5. Verificar resultado
SELECT id, name, education_level, is_active
FROM public.subjects
ORDER BY name;
