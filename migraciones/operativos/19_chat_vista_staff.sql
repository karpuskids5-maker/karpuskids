-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · PARCHE: Personal directivo ve TODOS los mensajes del chat
-- ═══════════════════════════════════════════════════════════════════════════
-- CAUSA: La política "messages_all" solo permite ver mensajes de conversaciones
--        donde el usuario autenticado es participante (conversation_participants).
--        admin/directora/asistente quedan ciegos a conversaciones padre↔maestra,
--        padre↔directora, etc. → en el panel de control "no se ve el chat" aunque
--        existan mensajes en la base.
-- SOLUCIÓN: política ADITIVA de SELECT para el personal directivo.
--   - admin / directora / asistente → pueden LEER cualquier mensaje.
--   - La política "messages_all" (membresía) se conserva intacta: los padres y
--     maestras solo ven sus propias conversaciones y todos mantienen las reglas
--     de INSERT/UPDATE/DELETE.
-- Ejecutar en Supabase → SQL Editor. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "messages_staff_view_all" ON public.messages;
CREATE POLICY "messages_staff_view_all" ON public.messages FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','directora','asistente'));