-- =============================================================
-- CHAT: Reacciones, respuestas citadas y borrado lógico
-- Soporte para la experiencia estilo WhatsApp en todos los paneles:
--   - Mantener presionado un mensaje → 👍 ❤️ 😂 😮 😢
--   - Responder citando el mensaje original (reply_to)
--   - Eliminar mensaje propio (borrado lógico, se ve "Mensaje eliminado")
--
-- Las columnas son OPCIONALES: el frontend autodetecta su existencia
-- (js/shared/chat.js → _msgSelect) y degrada elegantemente si aún
-- no se ha aplicado esta migración.
-- =============================================================

-- 1. Reacciones: { [user_id]: emoji }
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reactions jsonb DEFAULT '{}'::jsonb;

-- 2. Respuesta citada (auto-referencia)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to bigint REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON public.messages(reply_to) WHERE reply_to IS NOT NULL;

-- 3. Borrado lógico
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at DESC);
