import { supabase } from './supabase.js';
import { ScrollModule } from './scroll.module.js';
import { QueryCache } from './query-cache.js';
import { RealtimeManager } from './realtime-manager.js';
import { withTimeout } from './db-utils.js';

const MSG_PAGE_SIZE = 20;

// Columnas base (siempre existen) + columnas opcionales (requieren migración)
const MSG_SELECT_BASE = 'id, conversation_id, sender_id, receiver_id, content, is_read, read_at, created_at';
const MSG_SELECT_FULL = `${MSG_SELECT_BASE}, sender_name, sender_avatar, reactions, reply_to, deleted_at`;

/**
 * 💬 ChatModule: Cerebro unificado de mensajería
 * Maneja la lógica compleja de conversaciones, participantes y realtime.
 */
export const ChatModule = {
  _activeSubscription: null,
  // Paginación por conversación: { [convId]: { page, hasMore, loading } }
  _pagination: {},
  // ¿La BD ya tiene las columnas extendidas? (null = desconocido, se autodetecta)
  _extendedCols: null,
  // Canal global de presencia compartido entre paneles
  _presenceChannel: null,
  _presenceOnline: new Set(),
  _presenceCbs: new Set(),

  /**
   * Select de mensajes con autodetección de columnas extendidas
   * (reactions / reply_to / deleted_at requieren migración).
   */
  async _msgSelect() {
    if (this._extendedCols !== null) {
      return this._extendedCols ? MSG_SELECT_FULL : MSG_SELECT_BASE;
    }
    try {
      const { error } = await supabase.from('messages').select(MSG_SELECT_FULL).limit(1);
      this._extendedCols = !error;
    } catch (_) {
      this._extendedCols = false;
    }
    return this._extendedCols ? MSG_SELECT_FULL : MSG_SELECT_BASE;
  },

  /**
   * Vista previa del último mensaje por contacto: { [contactId]: { content, created_at, sender_id, mine } }
   * Una sola query para toda la lista (mensajes directos usan sender_id + receiver_id).
   */
  async getLastMessagePreviews(contactIds) {
    const ids = (contactIds || []).filter(Boolean);
    if (!ids.length) return {};
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return {};

      const sel = await this._msgSelect();
      const { data, error } = await supabase
        .from('messages')
        .select(sel)
        .or(
          `and(sender_id.eq.${user.id},receiver_id.in.(${ids.join(',')})),` +
          `and(receiver_id.eq.${user.id},sender_id.in.(${ids.join(',')}))`
        )
        .order('created_at', { ascending: false })
        .limit(300);

      if (error) return {};

      const previews = {};
      (data || []).forEach(m => {
        // Los mensajes vienen ordenados desc → el primero de cada contacto es el último
        const otherId = m.sender_id === user.id ? m.receiver_id : m.sender_id;
        if (!otherId || previews[otherId]) return;
        previews[otherId] = {
          content: m.deleted_at ? '' : (m.content || ''),
          created_at: m.created_at,
          sender_id: m.sender_id,
          mine: m.sender_id === user.id,
          deleted: !!m.deleted_at
        };
      });
      return previews;
    } catch (_) {
      return {};
    }
  },

  /**
   * Presencia global (lista completa): canal compartido con tracking propio.
   * Devuelve un Set con los user_id en línea; onChange se llama en cada sync.
   */
  subscribeGlobalPresence(onChange) {
    if (onChange && !this._presenceCbs.has(onChange)) this._presenceCbs.add(onChange);
    if (this._presenceChannel) return this._presenceChannel;

    const channel = supabase.channel('karpus_presence');
    channel
      .on('presence', { event: 'sync' }, () => {
        try {
          const state = channel.presenceState();
          const online = new Set();
          Object.values(state).forEach(arr => (arr || []).forEach(p => p.user_id && online.add(p.user_id)));
          this._presenceOnline = online;
          this._presenceCbs.forEach(cb => { try { cb(online); } catch (_) {} });
        } catch (_) {}
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) await channel.track({ user_id: user.id, online_at: new Date().toISOString() });
          } catch (_) {}
        }
      });

    this._presenceChannel = channel;
    return channel;
  },

  /** IDs en línea conocidos (Set) */
  getOnlineUsers() {
    return this._presenceOnline;
  },

  /**
   * Reaccionar a un mensaje: reactions = { [userId]: emoji }. Toggle (mismo emoji → quita).
   */
  async toggleReaction(messageId, emoji) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !messageId) return null;

      const sel = await this._msgSelect();
      if (!this._extendedCols) return null; // sin columna reactions en BD

      const { data: msg } = await supabase.from('messages').select(sel).eq('id', messageId).single();
      if (!msg) return null;

      const reactions = { ...(msg.reactions || {}) };
      if (reactions[user.id] === emoji) delete reactions[user.id];
      else reactions[user.id] = emoji;

      const { data: updated, error } = await supabase
        .from('messages')
        .update({ reactions })
        .eq('id', messageId)
        .select(sel)
        .single();

      if (error) return null;
      return updated;
    } catch (_) {
      return null;
    }
  },

  /**
   * Eliminar (borrado lógico) un mensaje propio.
   * Si la BD no tiene deleted_at, solo se elimina localmente (el caller decide).
   * @returns {boolean} true si se eliminó en servidor
   */
  async deleteMessage(messageId) {
    try {
      if (!this._extendedCols) {
        // Autodetectar una vez más por si la migración llegó tarde
        await this._msgSelect();
        if (!this._extendedCols) return false;
      }
      const { error } = await supabase
        .from('messages')
        .update({ deleted_at: new Date().toISOString(), content: 'Mensaje eliminado' })
        .eq('id', messageId);
      return !error;
    } catch (_) {
      return false;
    }
  },

  /**
   * Obtiene un mapa de mensajes no leídos por remitente { userId: count }
   * Usa una RPC optimizada de base de datos.
   */
  async getUnreadCounts() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { total: 0, counts: {} };

      const { data, error } = await supabase
        .from('messages')
        .select('sender_id')
        .eq('receiver_id', user.id)
        .eq('is_read', false);

      if (error) return { total: 0, counts: {} };

      const counts = {};
      (data || []).forEach(m => {
        counts[m.sender_id] = (counts[m.sender_id] || 0) + 1;
      });

      return { total: data.length, counts };
    } catch (_) {
      return { total: 0, counts: {} };
    }
  },

  /**
   * Carga los contactos para el padre (Restringido a Maestra y Directora)
   */
  async loadPadreContacts(studentId) {
    return QueryCache.get(`padre_contacts_${studentId}`, async () => {
      try {
        const { data: student } = await supabase
          .from('students')
          .select('classroom_id, classrooms(teacher_id)')
          .eq('id', studentId)
          .single();
        
        const teacherId = student?.classrooms?.teacher_id;

        const [teacherRes, staffRes] = await Promise.all([
          teacherId ? supabase.from('profiles').select('id, name, avatar_url, role').eq('id', teacherId).single() : Promise.resolve({ data: null }),
          supabase.from('profiles').select('id, name, avatar_url, role').in('role', ['directora', 'asistente']).order('name')
        ]);

        const contacts = [];
        if (teacherRes.data) contacts.push({ ...teacherRes.data, roleLabel: 'Maestra Titular' });
        (staffRes.data || []).forEach(s => {
          if (s.id !== teacherId) contacts.push({ ...s, roleLabel: s.role === 'directora' ? 'Directora' : 'Administración' });
        });
        return contacts;
      } catch (err) {
        return [];
      }
    }, 5 * 60_000); // 5 min TTL
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

        const sel = await this._msgSelect();
        let query = supabase
          .from('messages')
          .select(sel)
          .eq('conversation_id', conversationId);

        if (this._extendedCols) query = query.is('deleted_at', null);

        const { data: messages, error } = await query
          .order('created_at', { ascending: false })  // más recientes primero
          .range(from, to);

        if (error) throw error;

        const ordered = (messages || []).reverse(); // invertir para mostrar cronológico
        state.page++;
        state.hasMore = (messages || []).length === MSG_PAGE_SIZE;

        // ✅ LIMPIEZA LÓGICA DE DOM: Si hay demasiados mensajes, podríamos truncar, 
        // pero por ahora garantizamos que el estado refleje lo cargado
        return { messages: ordered, conversationId, hasMore: state.hasMore };
      } finally {
        state.loading = false;
      }
    } else {
      // Modo normal: buscar por ID de usuario destino via RPC
      const { data, error } = await supabase.rpc('get_direct_messages', {
        p_other_user_id: otherUserId
      });

      // Si el RPC no existe aún, retornar vacío sin lanzar error
      if (error) {
        return { messages: [], conversationId: null, hasMore: false };
      }

      const visible = (data || []).filter(m => !m.deleted_at);
      const messages = visible.slice(-MSG_PAGE_SIZE);
      const foundConvId = messages.length > 0 ? messages[0].conversation_id : null;

      if (foundConvId) {
        const state = this._getPagState(foundConvId);
        state.page = 1;
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
   * @param {string|null} replyToId — id del mensaje al que se responde (opcional)
   */
  async sendMessage(senderId, receiverId, content, conversationId = null, replyToId = null) {
    try {
      let activeConvId = conversationId;

      // 1. Si no hay conversationId, buscar una existente o crearla
      if (!activeConvId) {
        // Buscar conversación privada existente entre estos dos usuarios
        let convId = null;

        // Intentar con RPC primero
        const rpcRes = await supabase.rpc('find_or_create_private_conversation', {
          p_user1: senderId,
          p_user2: receiverId
        });

        if (!rpcRes.error && rpcRes.data) {
          convId = rpcRes.data;
        } else {
          // Fallback: crear manualmente si el RPC no existe
          const { data: newConv } = await supabase
            .from('conversations')
            .insert({ type: 'direct_message' })
            .select('id')
            .single();

          if (newConv?.id) {
            convId = newConv.id;
            await supabase.from('conversation_participants').insert([
              { conversation_id: convId, user_id: senderId },
              { conversation_id: convId, user_id: receiverId }
            ]).catch(() => {});
          }
        }

        if (convId) {
          activeConvId = convId;
        } else {
          throw new Error('No se pudo crear o encontrar la conversación');
        }
      }

      // 2. Insertar el mensaje (con reply_to si la BD lo soporta)
      const payload = {
        conversation_id: activeConvId,
        sender_id: senderId,
        receiver_id: receiverId,   // keep for NOT NULL compat until migration runs
        content: content.trim(),
        is_read: false
      };

      let message = null, msgError = null;
      if (replyToId && this._extendedCols) {
        const res = await supabase
          .from('messages')
          .insert({ ...payload, reply_to: replyToId })
          .select()
          .single();
        message = res.data; msgError = res.error;
        if (msgError) { message = null; msgError = null; } // fallback sin reply_to
      }
      if (!message) {
        const res = await supabase
          .from('messages')
          .insert(payload)
          .select()
          .single();
        message = res.data; msgError = res.error;
      }

      if (msgError) throw msgError;

      return { message, conversationId: activeConvId };
    } catch (err) {
      throw err;
    }
  },

  /**
   * Suscripción Realtime Unificada — con typing indicators, presence y read receipts
   */
  subscribeToConversation(conversationId, onMessage, onTyping, onPresence, onReadReceipt, onMessageUpdate) {
    this.unsubscribe();

    const channelName = `chat_cv_${conversationId}`;
    this._activeSubscription = supabase.channel(channelName);
    
    this._activeSubscription
      // 1. Nuevos mensajes
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        if (payload.new) {
          // Marcar como leído si el chat está abierto (lado receptor)
          supabase.auth.getUser().then(({ data }) => {
            if (payload.new.sender_id !== data?.user?.id) {
              this.markAsRead(conversationId);
            }
          }).catch(() => {});
          onMessage(payload.new);
        }
      })
      // 2. Read receipts (Doble Check) + reacciones/eliminados
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        if (payload.new && onReadReceipt) onReadReceipt(payload.new);
        if (payload.new && onMessageUpdate) onMessageUpdate(payload.new);
      })
      // 3. Typing indicator via broadcast
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (onTyping) onTyping(payload.payload);
      })
      // 4. Presence (Estado en Línea)
      .on('presence', { event: 'sync' }, () => {
        const state = this._activeSubscription.presenceState();
        if (onPresence) onPresence(state);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Track user presence
          const user = (await supabase.auth.getUser())?.data?.user;
          if (user) {
            await this._activeSubscription.track({
              user_id: user.id,
              online_at: new Date().toISOString(),
            });
          }
        }
      });

    this._activeChannelName = channelName;
    this._activeConvId = conversationId;
    return this._activeSubscription;
  },

  /**
   * Broadcast typing indicator to conversation participants
   */
  async broadcastTyping(conversationId, userName, isTyping) {
    if (!conversationId || !this._activeSubscription) return;
    try {
      await this._activeSubscription.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userName, isTyping, userId: (await supabase.auth.getUser())?.data?.user?.id }
      });
    } catch (_) {}
  },

  unsubscribe() {
    if (this._activeSubscription) {
      supabase.removeChannel(this._activeSubscription);
      this._activeSubscription = null;
      this._activeChannelName = null;
      this._activeConvId = null;
    }
  },

  /** Obtiene un mensaje por id (para renderizar la cita de una respuesta) */
  async getMessageById(messageId) {
    try {
      const sel = await this._msgSelect();
      const { data } = await supabase.from('messages').select(sel).eq('id', messageId).maybeSingle();
      return data || null;
    } catch (_) {
      return null;
    }
  },

  /**
   * Marca como leídos los mensajes de una conversación (con timestamp)
   */
  async markAsRead(conversationId) {
    if (!conversationId) return;
    try {
      // Use the new RPC that sets read_at timestamp
      await supabase.rpc('mark_messages_read', {
        p_conversation_id: conversationId
      });
    } catch (_) {}
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
