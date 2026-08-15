-- ============================================================
-- KARPUS KIDS — Fix: chat unread counts + messages.is_read
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Agregar columna is_read a messages si no existe
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_id uuid REFERENCES public.profiles(id);
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_name text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_avatar text;

-- 2. Recrear get_unread_counts con manejo robusto
CREATE OR REPLACE FUNCTION public.get_unread_counts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_count   bigint := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  BEGIN
    SELECT COUNT(*) INTO v_count
    FROM public.messages m
    JOIN public.conversation_participants cp
      ON cp.conversation_id = m.conversation_id
     AND cp.user_id = v_user_id
    WHERE m.sender_id <> v_user_id
      AND (m.is_read IS NULL OR m.is_read = false);
  EXCEPTION WHEN OTHERS THEN
    v_count := 0;
  END;

  RETURN jsonb_build_object('total', COALESCE(v_count, 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_counts() TO authenticated;

-- 3. Verificar
SELECT 'get_unread_counts OK' AS status, pg_get_functiondef(oid) IS NOT NULL AS exists
FROM pg_proc WHERE proname = 'get_unread_counts' AND pronamespace = 'public'::regnamespace;
