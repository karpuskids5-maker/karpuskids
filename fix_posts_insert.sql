-- ============================================================
-- FIX CRÍTICO: Error 400 al publicar en el muro (panel maestra)
-- "invalid input syntax for type json" / "send_notification does not exist"
-- EJECUTAR EN: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. Eliminar TODOS los triggers desconocidos en posts ─────────────────────
-- Hay un trigger en producción que llama a send_notification con firma incorrecta.
-- Lo eliminamos para que el INSERT funcione limpiamente.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE event_object_table = 'posts'
      AND trigger_schema = 'public'
      AND trigger_name NOT IN (
        'on_new_post_populate_teacher',
        'set_updated_at_posts'
      )
  LOOP
    EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.trigger_name) || ' ON public.posts';
    RAISE NOTICE 'Dropped trigger: %', r.trigger_name;
  END LOOP;
END;
$$;

-- ── 2. Crear send_notification con TODAS las firmas posibles ─────────────────
-- La función puede ser llamada con distintas firmas desde triggers legacy.

-- Firma 1: (uuid, text, text, jsonb, text)
CREATE OR REPLACE FUNCTION public.send_notification(
  p_user_id uuid, p_type text, p_message text,
  p_data jsonb DEFAULT '{}', p_link text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications(user_id, type, message, data, link, is_read, created_at)
  VALUES (p_user_id, p_type, p_message, COALESCE(p_data,'{}'), p_link, false, now())
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

-- Firma 2: (uuid, text, text, json, text)  ← la que falla con "invalid json"
CREATE OR REPLACE FUNCTION public.send_notification(
  p_user_id uuid, p_type text, p_message text,
  p_data json DEFAULT NULL, p_link text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications(user_id, type, message, data, link, is_read, created_at)
  VALUES (p_user_id, p_type, p_message,
          COALESCE(p_data::jsonb,'{}'), p_link, false, now())
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

-- Firma 3: (uuid, text, text)  ← versión mínima
CREATE OR REPLACE FUNCTION public.send_notification(
  p_user_id uuid, p_type text, p_message text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications(user_id, type, message, is_read, created_at)
  VALUES (p_user_id, p_type, p_message, false, now())
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

-- Firma 4: (text, text, text)  ← sin UUID tipado
CREATE OR REPLACE FUNCTION public.send_notification(
  p_user_id text, p_type text, p_message text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications(user_id, type, message, is_read, created_at)
  VALUES (p_user_id::uuid, p_type, p_message, false, now())
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ── 3. Permisos de tabla ──────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.likes    TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public   TO authenticated;

-- ── 4. Política INSERT correcta ───────────────────────────────────────────────
DROP POLICY IF EXISTS "posts_insert" ON public.posts;
CREATE POLICY "posts_insert" ON public.posts
  FOR INSERT WITH CHECK (
    auth.uid() = teacher_id
    AND get_my_role() IN ('directora','asistente','maestra','admin')
  );

-- ── 5. Trigger teacher_info (asegurar que existe) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_post_teacher_info()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.teacher_id IS NOT NULL THEN
    NEW.teacher_name   := (SELECT name       FROM public.profiles WHERE id = NEW.teacher_id LIMIT 1);
    NEW.teacher_avatar := (SELECT avatar_url FROM public.profiles WHERE id = NEW.teacher_id LIMIT 1);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_new_post_populate_teacher ON public.posts;
CREATE TRIGGER on_new_post_populate_teacher
  BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_post_teacher_info();

-- ── 6. Diagnóstico: ver qué triggers quedan en posts ─────────────────────────
SELECT trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'posts' AND trigger_schema = 'public'
ORDER BY trigger_name;
