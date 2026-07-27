-- Update get_direct_messages to include sender info
DROP FUNCTION IF EXISTS get_direct_messages(uuid);

CREATE OR REPLACE FUNCTION public.get_direct_messages(p_other_user_id uuid)
RETURNS TABLE (
  id              bigint,
  content         text,
  sender_id       uuid,
  created_at      timestamp with time zone,
  is_read         boolean,
  conversation_id bigint,
  sender_name     text,
  sender_avatar   text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    m.id,
    m.content,
    m.sender_id,
    m.created_at,
    m.is_read,
    m.conversation_id,
    p.name AS sender_name,
    p.avatar_url AS sender_avatar
  FROM public.messages m
  LEFT JOIN public.profiles p ON m.sender_id = p.id
  WHERE m.conversation_id = (
    SELECT c.id
    FROM public.conversations c
    WHERE c.type IN ('direct_message','private')
      AND EXISTS (
        SELECT 1 FROM public.conversation_participants x
        WHERE x.conversation_id = c.id AND x.user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1 FROM public.conversation_participants y
        WHERE y.conversation_id = c.id AND y.user_id = p_other_user_id
      )
    LIMIT 1
  )
  ORDER BY m.created_at asc;
$$;

GRANT EXECUTE ON FUNCTION public.get_direct_messages(uuid) TO authenticated;
