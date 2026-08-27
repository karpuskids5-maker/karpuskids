-- ═══════════════════════════════════════════════════════════════════════════
-- PARCHE: mark_messages_read — también actualiza read_at
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.mark_messages_read(p_conversation_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_my_id uuid := auth.uid();
BEGIN
  IF v_my_id IS NULL OR p_conversation_id IS NULL THEN RETURN; END IF;
  UPDATE public.messages
  SET is_read = true, read_at = now()
  WHERE conversation_id = p_conversation_id
    AND sender_id <> v_my_id
    AND (is_read IS NULL OR is_read = false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_messages_read(bigint) TO authenticated;
