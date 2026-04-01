import { supabase } from './supabase.js';
import { ScrollModule } from './scroll.module.js';

const MSG_PAGE_SIZE = 20;

/**
 * 💬 ChatModule: Cerebro unificado de mensajería
 * Maneja la lógica compleja de conversaciones, participantes y realtime.
 */
export const ChatModule = {
  _activeSubscription: null,
  // Paginación por conversación: { [convId]: { page, hasMore, loading } }
  _pagination: {},

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
   * Carga los contactos para el padre (Restringido a Maestra y Directora)
   */
  async loadPadreContacts(studentId) {
    try {
      // 1. Obtener Maestra del Aula
      const { data: student } = await supabase
        .from('students')
        .select('classroom_id, classrooms(teacher_id)')
        .eq('id', studentId)
        .single();
      
      const teacherId = student?.classrooms?.teacher_id;

      // 2. Consultar Maestra y Directivos
      const [teacherRes, staffRes] = await Promise.all([
        teacherId ? supabase.from('profiles').select('id, name, avatar_url, role').eq('id', teacherId).single() : Promise.resolve({ data: null }),
        supabase.from('profiles').select('id, name, avatar_url, role').in('role', ['directora', 'asistente']).order('name')
      ]);

      const contacts = [];
      if (teacherRes.data) {
        contacts.push({ ...teacherRes.data, roleLabel: 'Maestra Titular' });
      }
      
      (staffRes.data || []).forEach(s => {
        if (s.id !== teacherId) {
          contacts.push({ ...s, roleLabel: s.role === 'directora' ? 'Directora' : 'Administración' });
        }
      });

      return contacts;
    } catch (err) {
      console.error('[ChatModule] Error loadPadreContacts:', err);
      return [];
    }
  },

  /**
   * Carga la conversación privada con otro usuario — PAGINADA (últimos 20 mensajes).
   * @param {string}  otherUserId
   * @param {string}  conversationId  — si ya se conoce
   * @param {boolean} loadMore        — true = cargar página anterior (scroll arriba)
   */
  async loadConversation(otherUserId, conversationId = null, loadMore = false) {
    if (conversationId) {
      // Modo paginado por conversationId
      const state = this._getPagState(conversationId);
      if (loadMore && !state.hasMore) return { messages: [], conversationId };
      if (state.loading) return { messages: [], conversationId };
      state.loading = true;

      try {
        const from = state.page * MSG_PAGE_SIZE;
        const to   = from + MSG_PAGE_SIZE - 1;

        const { data: messages, error } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })  // más recientes primero
          .range(from, to);

        if (error) throw error;

        const ordered = (messages || []).reverse(); // invertir para mostrar cronológico
        state.page++;
        state.hasMore = (messages || []).length === MSG_PAGE_SIZE;
        return { messages: ordered, conversationId, hasMore: state.hasMore };
      } finally {
        state.loading = false;
      }
    } else {
      // Modo normal: buscar por ID de usuario destino via RPC
      const { data, error } = await supabase.rpc('get_direct_messages', {
        p_other_user_id: otherUserId
      });
      if (error) throw error;

      const messages = (data || []).slice(-MSG_PAGE_SIZE); // solo últimos 20
      const foundConvId = messages.length > 0 ? messages[0].conversation_id : null;

      if (foundConvId) {
        const state = this._getPagState(foundConvId);
        state.page = 1; // ya cargamos la primera página
        state.hasMore = (data || []).length >= MSG_PAGE_SIZE;
      }

      return { messages, conversationId: foundConvId, hasMore: false };
    }
  },

  /** Obtiene o crea el estado de paginación para una conversación */
  _getPagState(convId) {
    if (!this._pagination[convId]) {
      this._pagination[convId] = { page: 0, hasMore: true, loading: false };
    }
    return this._pagination[convId];
  },

  /** Resetea la paginación de una conversación (al abrir un chat nuevo) */
  resetPagination(convId) {
    if (convId) delete this._pagination[convId];
  },

  /**
   * Envía un mensaje. 
   * 🔥 Lógica Inteligente: Si no existe conversación, la crea automáticamente junto con los participantes.
   */
  async sendMessage(senderId, receiverId, content, conversationId = null) {
    try {
      let activeConvId = conversationId;

      // 1. Si no hay conversationId, buscar una existente o crearla
      if (!activeConvId) {
        // Buscar conversación privada existente entre estos dos usuarios usando RPC para evitar sintaxis compleja de filtros cruzados
        const { data: convId } = await supabase.rpc('find_or_create_private_conversation', {
          p_user1: senderId,
          p_user2: receiverId
        });

        if (convId) {
          activeConvId = convId;
        } else {
          throw new Error('No se pudo crear o encontrar la conversación');
        }
      }

      // 2. Insertar el mensaje
      const { data: message, error: msgError } = await supabase
        .from('messages')
        .insert({
          conversation_id: activeConvId,
          sender_id: senderId,
          receiver_id: receiverId,   // keep for NOT NULL compat until migration runs
          content: content.trim(),
          is_read: false
        })
        .select()
        .single();

      if (msgError) throw msgError;

      return { message, conversationId: activeConvId };
    } catch (err) {
      console.error('[ChatModule] Error enviando mensaje:', err);
      throw err;
    }
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 🛡️ Verificación de Auditoría:
      // Solo intentamos marcar como leído si somos participantes del chat.
      const { data: isParticipant } = await supabase.rpc('user_is_participant', {
        p_conversation_id: conversationId,
        p_user_id: user.id
      });

      if (!isParticipant) return;

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
        return { conversationId: c.id, name: `Grupo: ${c.classrooms?.name || 'Aula'}`, meta: 'Chat del salón', avatar: null, type: 'classroom' };
      } else {
        // Detectar si soy participante
        const isMeParticipant = c.conversation_participants.some(p => p.user_id === user.id);
        
        if (!isMeParticipant && role === 'directora') {
          // Formato Auditoría: mostrar quién habla con quién
          const p1 = c.conversation_participants[0]?.profiles?.name || 'Usuario A';
          const p2 = c.conversation_participants[1]?.profiles?.name || 'Usuario B';
          return {
            conversationId: c.id,
            name: `${p1} ↔ ${p2}`,
            meta: 'Supervisión de chat',
            avatar: null,
            type: 'audit'
          };
        }

        const other = c.conversation_participants.find(p => p.user_id !== user.id);
        return { conversationId: c.id, name: other?.profiles?.name || 'Usuario', meta: other?.profiles?.role || '', avatar: other?.profiles?.avatar_url, type: 'direct_message', otherUserId: other?.profiles?.id };
      }
    });
  },
  async init() {
    // Placeholder para inicialización si se requiere en el futuro
  }
};