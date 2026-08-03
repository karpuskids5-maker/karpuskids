-- ============================================================
-- KARPUS KIDS — Funciones RPC para el sistema de chat
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. find_or_create_private_conversation ──────────────────
-- Busca o crea una conversación directa entre dos usuarios.
-- Retorna el conversation_id (bigint).

CREATE OR REPLACE FUNCTION public.find_or_create_private_conversation(
  p_user1 uuid,
  p_user2 uuid
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv_id bigint;
BEGIN
  -- Buscar conversación existente donde ambos son participantes
  SELECT cp1.conversation_id INTO v_conv_id
  FROM public.conversation_participants cp1
  JOIN public.conversation_participants cp2
    ON cp2.conversation_id = cp1.conversation_id
   AND cp2.user_id = p_user2
  JOIN public.conversations c
    ON c.id = cp1.conversation_id
   AND c.type = 'direct_message'
  WHERE cp1.user_id = p_user1
  LIMIT 1;

  -- Si existe, retornar
  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  -- Crear nueva conversación
  INSERT INTO public.conversations (type)
  VALUES ('direct_message')
  RETURNING id INTO v_conv_id;

  -- Agregar participantes
  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (v_conv_id, p_user1), (v_conv_id, p_user2)
  ON CONFLICT DO NOTHING;

  RETURN v_conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_or_create_private_conversation(uuid, uuid) TO authenticated;


-- ── 2. get_direct_messages ───────────────────────────────────
-- Obtiene los últimos mensajes de la conversación privada
-- entre el usuario actual y otro usuario.

DROP FUNCTION IF EXISTS public.get_direct_messages(uuid);

CREATE OR REPLACE FUNCTION public.get_direct_messages(
  p_other_user_id uuid
)
RETURNS TABLE (
  id              bigint,
  conversation_id bigint,
  sender_id       uuid,
  receiver_id     uuid,
  content         text,
  is_read         boolean,
  created_at      timestamp with time zone
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id   uuid := auth.uid();
  v_conv_id bigint;
BEGIN
  IF v_my_id IS NULL THEN RETURN; END IF;

  -- Buscar conversación existente
  SELECT cp1.conversation_id INTO v_conv_id
  FROM public.conversation_participants cp1
  JOIN public.conversation_participants cp2
    ON cp2.conversation_id = cp1.conversation_id
   AND cp2.user_id = p_other_user_id
  JOIN public.conversations c
    ON c.id = cp1.conversation_id
   AND c.type = 'direct_message'
  WHERE cp1.user_id = v_my_id
  LIMIT 1;

  -- Si no hay conversación, retornar vacío (no crear aquí)
  IF v_conv_id IS NULL THEN RETURN; END IF;

  -- Retornar últimos 50 mensajes ordenados cronológicamente
  RETURN QUERY
  SELECT
    m.id,
    m.conversation_id,
    m.sender_id,
    m.receiver_id,
    m.content,
    m.is_read,
    m.created_at
  FROM public.messages m
  WHERE m.conversation_id = v_conv_id
  ORDER BY m.created_at ASC
  LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_direct_messages(uuid) TO authenticated;


-- ── 3. mark_messages_read ────────────────────────────────────
-- Marca como leídos los mensajes de una conversación donde
-- el receptor es el usuario actual.

CREATE OR REPLACE FUNCTION public.mark_messages_read(
  p_conversation_id bigint
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_my_id uuid := auth.uid();
BEGIN
  IF v_my_id IS NULL OR p_conversation_id IS NULL THEN RETURN; END IF;

  UPDATE public.messages
  SET is_read = true
  WHERE conversation_id = p_conversation_id
    AND sender_id <> v_my_id
    AND (is_read IS NULL OR is_read = false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_messages_read(bigint) TO authenticated;


-- ── 4. get_unread_counts (versión robusta) ───────────────────

CREATE OR REPLACE FUNCTION public.get_unread_counts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_count   bigint := 0;
BEGIN
  IF v_user_id IS NULL THEN RETURN '{}'::jsonb; END IF;

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


-- ── Verificación ──────────────────────────────────────────────
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname IN (
  'find_or_create_private_conversation',
  'get_direct_messages',
  'mark_messages_read',
  'get_unread_counts'
)
AND pronamespace = 'public'::regnamespace
ORDER BY proname;
