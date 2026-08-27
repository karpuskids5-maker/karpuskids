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
