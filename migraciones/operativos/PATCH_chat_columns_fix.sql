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
