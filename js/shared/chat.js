import { supabase } from './supabase.js';

/**
 * 💬 ChatModule: Cerebro unificado de mensajería
 * Maneja la lógica compleja de conversaciones, participantes y realtime.
 */
export const ChatModule = {
  _activeSubscription: null,

  /**
   * Obtiene un mapa de mensajes no leídos por remitente { userId: count }
   * Usa una RPC optimizada de base de datos.
   */
  async getUnreadCounts() {
    try {
      const { data, error } = await supabase.rpc('get_unread_counts');
      return error ? {} : (data || {});
    } catch (e) {
      console.warn('ChatModule: Error obteniendo conteos', e);
      return {};
    }
  },

  /**
   * Carga la conversación privada con otro usuario.
   * Retorna: { messages: [], conversationId: number | null }
   */
  async loadConversation(otherUserId) {
    const { data, error } = await supabase.rpc('get_direct_messages', {
      p_other_user_id: otherUserId
    });

    if (error) throw error;

    const messages = data || [];
    // Si hay mensajes, extraemos el ID de conversación del primero
    const conversationId = messages.length > 0 ? messages[0].conversation_id : null;

    return { messages, conversationId };
  },

  /**
   * Envía un mensaje. 
   * 🔥 Lógica Inteligente: Si no existe conversación, la crea automáticamente junto con los participantes.
   */
  async sendMessage(senderId, receiverId, content, knownConversationId = null) {
    let conversationId = knownConversationId;

    // 1. Si no tenemos ID, creamos la estructura de conversación
    if (!conversationId) {
      // A. Crear Conversación
      const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .insert({ type: 'private' })
        .select('id')
        .single();
      
      if (convErr) throw convErr;
      conversationId = conv.id;

      // B. Asignar Participantes
      const { error: partErr } = await supabase
        .from('conversation_participants')
        .insert([
          { conversation_id: conversationId, user_id: senderId },
          { conversation_id: conversationId, user_id: receiverId }
        ]);
      
      if (partErr) throw partErr;
    }

    // 2. Insertar Mensaje
    const { data: msg, error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        content: content.trim()
      })
      .select()
      .single();

    if (msgErr) throw msgErr;

    return { message: msg, conversationId };
  },

  /**
   * Suscripción Realtime Unificada
   */
  subscribeToConversation(conversationId, onMessage) {
    // Limpiar suscripción anterior si existe
    this.unsubscribe();

    this._activeSubscription = supabase.channel(`chat_cv_${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        if (payload.new) onMessage(payload.new);
      })
      .subscribe();

    return this._activeSubscription;
  },

  unsubscribe() {
    if (this._activeSubscription) {
      supabase.removeChannel(this._activeSubscription);
      this._activeSubscription = null;
    }
  },

  /**
   * Marca como leídos los mensajes de una conversación
   */
  async markAsRead(conversationId) {
    if (!conversationId) return;
    try {
      await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
    } catch (e) {
      console.warn('Error marcando leído:', e);
    }
  },

  /**
   * Obtiene la lista de conversaciones/chats según el rol del usuario
   */
  async getChatList() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    const role = profile?.role || 'padre';

    // 1. Query base de conversaciones
    let query = supabase
      .from('conversations')
      .select(`
        id, 
        type, 
        classroom_id, 
        classrooms(name),
        conversation_participants(
          user_id, 
          profiles(id, name, role, avatar_url)
        )
      `);

    // RLS ya filtra para maestra/padre, pero Directora puede ver todo.
    const { data: conversations, error } = await query.order('updated_at', { ascending: false });
    if (error) throw error;

    // 2. Normalizar para UI tipo Messenger
    return conversations.map(c => {
      if (c.type === 'classroom') {
        return {
          conversationId: c.id,
          name: `Grupo: ${c.classrooms?.name || 'Aula'}`,
          meta: 'Chat del salón',
          avatar: null,
          type: 'classroom'
        };
      } else {
        const other = c.conversation_participants.find(p => p.user_id !== user.id);
        return {
          conversationId: c.id,
          name: other?.profiles?.name || 'Usuario',
          meta: other?.profiles?.role || '',
          avatar: other?.profiles?.avatar_url,
          type: 'direct_message',
          otherUserId: other?.profiles?.id
        };
      }
    });
  },
  async init() {
    // Placeholder para inicialización si se requiere en el futuro
  }
};