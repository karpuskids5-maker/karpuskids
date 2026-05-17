-- ============================================================
-- FIX CRÍTICO: Error 400 al publicar en el muro (panel maestra)
-- "invalid input syntax for type json" / "send_notification does not exist"
-- EJECUTAR EN: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. Eliminar triggers desconocidos en posts que llaman send_notification ───
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

-- ── 2. Crear send_notification con todas las firmas posibles ─────────────────
-- La tabla notifications tiene: user_id, title, message, type, link, is_read
-- NO tiene columna "data" — usar title=type como fallback

CREATE OR REPLACE FUNCTION public.send_notification(
  p_user_id uuid, p_type text, p_message text,
  p_data jsonb DEFAULT '{}', p_link text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, link, is_read, created_at)
  VALUES (p_user_id, p_type, p_message, p_type, p_link, false, now())
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_notification(
  p_user_id uuid, p_type text, p_message text,
  p_data json DEFAULT NULL, p_link text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, link, is_read, created_at)
  VALUES (p_user_id, p_type, p_message, p_type, p_link, false, now())
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_notification(
  p_user_id uuid, p_type text, p_message text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, is_read, created_at)
  VALUES (p_user_id, p_type, p_message, p_type, false, now())
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_notification(
  p_user_id text, p_type text, p_message text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, is_read, created_at)
  VALUES (p_user_id::uuid, p_type, p_message, p_type, false, now())
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

-- ── 5. Trigger teacher_info ───────────────────────────────────────────────────
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

-- ── 6. Diagnóstico final ──────────────────────────────────────────────────────
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'posts' AND trigger_schema = 'public'
ORDER BY trigger_name;
