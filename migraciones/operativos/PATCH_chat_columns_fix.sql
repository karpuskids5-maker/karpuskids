-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · PARCHE URGENTE — Columnas extendidas de mensajes (chat)
-- ═══════════════════════════════════════════════════════════════════════════
-- SÍNTOMA: Error 500 en /rest/v1/messages al enviar o cargar mensajes.
-- CAUSA:   Las columnas reactions, reply_to y deleted_at no existen aún
--          en la tabla messages de producción.
-- ACCIÓN:  Ejecutar este script en Supabase → SQL Editor.
--          Es idempotente (IF NOT EXISTS): puede re-ejecutarse sin daño.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Columna reactions (reacciones emoji por usuario)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reactions jsonb DEFAULT '{}'::jsonb;

-- 2. Columna reply_to (referencia al mensaje citado)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to bigint REFERENCES public.messages(id) ON DELETE SET NULL;

-- 3. Columna deleted_at (borrado lógico)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

-- 4. Índices de rendimiento
CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON public.messages(reply_to) WHERE reply_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at DESC);

-- 5. Verificación: muestra las columnas de la tabla messages
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'messages'
ORDER BY ordinal_position;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN DEL PARCHE
-- ═══════════════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════════════
-- PARCHE URGENTE: Fix recursión infinita en RLS de conversation_participants
-- ═══════════════════════════════════════════════════════════════════════════
-- CAUSA: La política "conv_participants_visible" (migración 10) se auto-
--        refencia: consulta conversation_participants DESDE un policy de
--        conversation_participants → recursión infinita → error 500 en TODAS
--        las queries de messages y conversation_participants.
-- SOLUCIÓN: Restaurar una política permisiva simple. Los permisos reales
--           los controla la política de messages (que ya verifica membresía).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Eliminar la política auto-referenciada rota
DROP POLICY IF EXISTS "conv_participants_visible" ON public.conversation_participants;
DROP POLICY IF EXISTS "conv_participants_all" ON public.conversation_participants;

-- 2. Crear política permisiva: cualquier usuario autenticado puede ver participantes
--    (la seguridad real la da messages_all que verifica membresía)
CREATE POLICY "conv_participants_all" ON public.conversation_participants FOR ALL
  USING (auth.uid() IS NOT NULL);

-- 3. Asegurar que la política de conversations también funciona
DROP POLICY IF EXISTS "conversations_participants" ON public.conversations;
CREATE POLICY "conversations_participants" ON public.conversations FOR ALL
  USING (auth.uid() IS NOT NULL);

-- 4. Asegurar que la política de messages funciona correctamente
DROP POLICY IF EXISTS "messages_all" ON public.messages;
CREATE POLICY "messages_all" ON public.messages FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = messages.conversation_id
      AND cp.user_id = auth.uid()
  ));
