-- ══════════════════════════════════════════════════════════════
-- FIX RLS: Políticas débiles → estrictas
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ── COMMENTS: eliminar la política débil FOR ALL y mantener las específicas ──
DROP POLICY IF EXISTS "comments_all" ON public.comments;

-- ── LIKES: eliminar la política débil FOR ALL y mantener las específicas ──
DROP POLICY IF EXISTS "likes_all" ON public.likes;

-- ── CONVERSATIONS: reemplazar FOR ALL por política basada en participantes ──
DROP POLICY IF EXISTS "conversations_all" ON public.conversations;
DROP POLICY IF EXISTS "conversations_participants" ON public.conversations;
CREATE POLICY "conversations_participants" ON public.conversations FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = conversations.id AND cp.user_id = auth.uid()
  ));

-- ── CONVERSATION_PARTICIPANTS: reemplazar FOR ALL ──
DROP POLICY IF EXISTS "conv_participants_all" ON public.conversation_participants;
DROP POLICY IF EXISTS "conv_participants_visible" ON public.conversation_participants;
CREATE POLICY "conv_participants_visible" ON public.conversation_participants FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.conversation_participants cp2
    WHERE cp2.conversation_id = conversation_participants.conversation_id AND cp2.user_id = auth.uid()
  ));

-- ── CLASSROOM_GALLERY: solo miembros del aula ──
DROP POLICY IF EXISTS "gallery_all" ON public.classroom_gallery;
DROP POLICY IF EXISTS "gallery_classroom_members" ON public.classroom_gallery;
CREATE POLICY "gallery_classroom_members" ON public.classroom_gallery FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','admin')
    OR is_teacher_of_classroom(classroom_id)
    OR is_parent_of_classroom(classroom_id)
  );

-- ── CLASSROOM_CHAT: solo miembros del aula ──
DROP POLICY IF EXISTS "classroom_chat_all" ON public.classroom_chat;
DROP POLICY IF EXISTS "classroom_chat_classroom_members" ON public.classroom_chat;
CREATE POLICY "classroom_chat_classroom_members" ON public.classroom_chat FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','admin')
    OR is_teacher_of_classroom(classroom_id)
    OR is_parent_of_classroom(classroom_id)
  );

-- ── AUDIT_LOGS: restringir INSERT a service_role únicamente ──
DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_service_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_service_insert" ON public.audit_logs FOR INSERT
  WITH CHECK (current_setting('role') = 'service_role');
