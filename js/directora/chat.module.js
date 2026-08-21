import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { supabase, sendPush } from '../shared/supabase.js';
import { ChatModule as SharedChat } from '../shared/chat.js';
import { ScrollModule } from '../shared/scroll.module.js';
import { ChatView, ChatListState } from '../shared/chat-view.js';
import {
  buildThreadHTML, prependThreadHTML, appendLiveMessage, waBubbleHTML,
  chatListItemHTML, reactionChipsHTML
} from '../shared/chat-render.js';
import {
  bindMessageActions, closeMessageActions,
  showReplyBar, hideReplyBar, openForwardModal, markRowDeleted
} from '../shared/chat-actions.js';

const CHAT_PLACEHOLDER_HTML = `
  <div class="h-full flex flex-col items-center justify-center text-slate-400 opacity-40">
    <i data-lucide="message-circle" class="w-16 h-16 mb-4"></i>
    <p class="font-medium">Selecciona una conversación</p>
  </div>`;

export const ChatModule = {
  _currentUserId: null,
  _activeContactId: null,
  _conversationId: null,
  _channel: null,
  _allContacts: [],
  _topScrollDestroy: null,
  _previews: {},          // vista previa del último mensaje por contacto
  _pendingReply: null,    // respuesta citada pendiente

  async init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    this._currentUserId = user.id;

    // Get current user profile for avatar
    const { data: profile } = await supabase.from('profiles').select('name, avatar_url').eq('id', user.id).single();
    this._currentUserProfile = profile || {};

    // ✅ Presencia global (puntos verdes en la lista + estado en header)
    SharedChat.subscribeGlobalPresence((online) => this._renderPresence(online));

    // Bind send button + enter key — once only
    const sendBtn = document.getElementById('btnSendChatMessage');
    const input   = document.getElementById('chatMessageInput');
    if (sendBtn && !sendBtn._bound) {
      sendBtn._bound = true;
      sendBtn.addEventListener('click', () => this.sendMessage());
      input?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
      });
    }

    const searchInput = document.getElementById('chatSearchInput');
    if (searchInput && !searchInput._kkBound) {
      searchInput._kkBound = true;
      searchInput.addEventListener('input', () => this._renderContacts());
    }

    // ✅ Restaurar búsqueda preservada (una sola vez, tras bindear el listener)
    ChatListState.restoreUI('directora', { searchEl: searchInput });
    const roleFilter = document.getElementById('chatRoleFilter');
    if (roleFilter && !roleFilter._kkBound) {
      roleFilter._kkBound = true;
      roleFilter.addEventListener('change', () => this._loadContacts());
    }

    // ✅ Botón atrás — móvil y escritorio, una sola vez (usa historial)
    const backBtn = document.getElementById('chatBackBtn');
    if (backBtn && !backBtn._kkBound) {
      backBtn._kkBound = true;
      backBtn.addEventListener('click', () => ChatView.back());
    }

    // Expose for inline onclick
    window._chatSelect = (id) => this.selectChat(id);

    await this._loadContacts();
  },

  /**
   * Restaura la vista inicial del chat (placeholder "Selecciona una conversación")
   */
  _closeConversationUI() {
    this._activeContactId = null;
    this._conversationId = null;
    this._pendingReply = null;
    this._unsubscribe();
    closeMessageActions();
    hideReplyBar();
    if (this._topScrollDestroy) { this._topScrollDestroy(); this._topScrollDestroy = null; }
    document.getElementById('chatActiveHeader')?.classList.add('hidden');
    document.getElementById('chatInputArea')?.classList.add('hidden');
    document.getElementById('chatTypingIndicator')?.classList.add('hidden');
    const container = document.getElementById('chatMessagesContainer');
    if (container) {
      container.innerHTML = CHAT_PLACEHOLDER_HTML;
      if (window.lucide) lucide.createIcons();
    }
  },

  /**
   * Abre la vista conversación con historial integrado —
   * el botón atrás del navegador NO recarga la página
   */
  _openChatView() {
    ChatView.open({
      apply: () => {
        // En móvil muestra el panel de conversación; en escritorio no tiene efecto
        document.getElementById('chatAppContainer')?.classList.add('show-chat');
      },
      revert: () => {
        document.getElementById('chatAppContainer')?.classList.remove('show-chat');
        this._closeConversationUI();
      }
    });
  },

  /**
   * API para el banner global: abrir conversación por userId
   */
  openChatWithUser(userId) {
    if (this._allContacts.some(c => c.id === userId)) {
      this.selectChat(userId);
      return true;
    }
    return false;
  },

  isActiveChatOpen(msg) {
    return !!this._activeContactId && !!msg?.conversation_id && msg.conversation_id === this._conversationId;
  },

  async _loadContacts() {
    const list = document.getElementById('chatContactsList');
    if (!list) return;
    list.innerHTML = Helpers.skeleton(4);

    try {
    const roleVal = document.getElementById('chatRoleFilter')?.value || '';
    const [usersRes, unreadData] = await Promise.all([
      DirectorApi.getChatUsers(this._currentUserId, roleVal || null),
      supabase.rpc('get_unread_counts').then(r => r.data || {}).catch(() => ({}))
    ]);
    const { data: users, error } = usersRes;
    if (error) throw error;

      // Enrich padres with student name
      const parentIds = (users || []).filter(u => u.role === 'padre').map(u => u.id);
      let studentMap = {};
      if (parentIds.length) {
        const { data: students } = await DirectorApi.getStudentsByParentIds(parentIds);
        (students || []).forEach(s => {
          if (!studentMap[s.parent_id]) studentMap[s.parent_id] = { studentName: s.name, classroomName: s.classrooms?.name || '' };
        });
      }

      this._allContacts = (users || []).map(u => {
        const si = studentMap[u.id] || {};
        // Para padres: mostrar nombre del estudiante como título principal
        // y nombre del padre como subtítulo
        const parentName   = u.name || 'Sin nombre';
        const studentName  = si?.studentName || null;
        const displayName  = (u.role === 'padre' && studentName)
          ? studentName
          : parentName;

        const roleLabel = { maestra: 'Maestra', padre: 'Padre/Madre', asistente: 'Asistente', directora: 'Directora' }[u.role] || u.role;

        let meta = 'Personal Karpus';
        if (u.role === 'padre') {
          const parts = [];
          if (studentName)        parts.push(`👦 ${studentName}`);
          if (si?.classroomName)  parts.push(`🏫 ${si.classroomName}`);
          parts.push(`👤 ${parentName}`);
          meta = parts.join(' · ');
        }

        const contact = {
          id:          u.id,
          name:        displayName,
          parentName:  u.role === 'padre' ? parentName : null,
          studentName: u.role === 'padre' ? studentName : null,
          avatar:      u.avatar_url,
          unread:      Number((unreadData && unreadData[u.id]) || 0),
          roleLabel,
          meta
        };
        return contact;
      });

      // ✅ Vista previa del último mensaje por contacto
      const contactIds = this._allContacts.map(c => c.id).filter(Boolean);
      this._previews = await SharedChat.getLastMessagePreviews(contactIds);

      // Orden: último mensaje más reciente primero; sin mensajes → por no leídos
      this._allContacts.sort((a, b) => {
        const ta = this._previews[a.id]?.created_at ? new Date(this._previews[a.id].created_at).getTime() : 0;
        const tb = this._previews[b.id]?.created_at ? new Date(this._previews[b.id].created_at).getTime() : 0;
        if (ta !== tb) return tb - ta;
        return b.unread - a.unread;
      });

      this._renderContacts();
    } catch (e) {
      console.error('Chat contacts error:', e);
      list.innerHTML = Helpers.emptyState('Error al cargar contactos');
    }
  },

  /** Puntos de presencia en la lista + estado en header */
  _renderPresence(onlineSet) {
    document.querySelectorAll('#chatContactsList [data-contact-id]').forEach(el => {
      const dot = el.querySelector('.kk-online-dot');
      if (dot) dot.classList.toggle('is-online', onlineSet.has(el.dataset.contactId));
    });
    if (this._activeContactId) {
      const metaEl = document.getElementById('chatActiveMeta');
      if (metaEl && metaEl.dataset.baseMeta) {
        const online = onlineSet.has(this._activeContactId);
        metaEl.innerHTML = `<span class="kk-header-status ${online ? 'is-online' : ''}">
          <span class="kk-status-dot"></span>${online ? 'En línea' : Helpers.escapeHTML(metaEl.dataset.baseMeta)}</span>`;
      }
    }
  },

  _renderContacts() {
    const list = document.getElementById('chatContactsList');
    if (!list) return;
    const q = (document.getElementById('chatSearchInput')?.value || '').toLowerCase();
    const filtered = this._allContacts.filter(c =>
      (c.name || '').toLowerCase().includes(q) || (c.meta || '').toLowerCase().includes(q)
    );

    if (!filtered.length) { list.innerHTML = Helpers.emptyState('Sin contactos'); return; }

    list.innerHTML = filtered.map(c => chatListItemHTML({
      c: { id: c.id, name: c.name || 'Sin nombre', avatar: c.avatar },
      unread: c.unread,
      lastMsg: this._previews[c.id] || null,
      online: SharedChat.getOnlineUsers().has(c.id),
      sub: c.parentName ? `👤 ${c.parentName} · ${c.roleLabel}` : c.roleLabel,
      avatarBg: 'bg-blue-100 text-blue-600'
    })).join('');

    // ✅ Restaurar scroll preservado (experiencia PWA)
    const savedList = ChatListState.load('directora');
    if (savedList.scrollTop) requestAnimationFrame(() => { list.scrollTop = savedList.scrollTop; });
    if (!list._kkScrollSave) {
      list._kkScrollSave = true;
      let tSave = null;
      list.addEventListener('scroll', () => {
        clearTimeout(tSave);
        tSave = setTimeout(() => ChatListState.save('directora', {
          ...ChatListState.load('directora'),
          scrollTop: list.scrollTop
        }), 300);
      }, { passive: true });
    }

    // Delegate click
    if (!list._bound) {
      list._bound = true;
      list.addEventListener('click', e => {
        const el = e.target.closest('[data-contact-id]');
        if (el) this.selectChat(el.dataset.contactId);
      });
    }
  },

  async selectChat(contactId) {
    const contact = this._allContacts.find(c => c.id === contactId);
    if (!contact) return;

    this._activeContactId = contactId;
    this._conversationId  = null;

    // Limpiar badge del contacto
    contact.unread = 0;
    this._renderContacts();

    // ✅ VISTA MÓVIL/DESKTOP + HISTORIAL (botón atrás sin recargar)
    this._openChatView();

    // Update header
    const nameEl   = document.getElementById('chatActiveName');
    const metaEl   = document.getElementById('chatActiveMeta');
    const avatarEl = document.getElementById('chatActiveAvatar');
    const headerEl = document.getElementById('chatActiveHeader');
    const inputEl  = document.getElementById('chatInputArea');

    const baseMeta = contact.parentName
      ? `${contact.roleLabel} · 👤 ${contact.parentName} · ${contact.meta.split(' · ').slice(-1)[0] || ''}`
      : contact.roleLabel + ' · ' + contact.meta;

    if (nameEl)   nameEl.textContent   = contact.name;
    if (metaEl) {
      metaEl.textContent = baseMeta;
      metaEl.dataset.baseMeta = baseMeta;
      this._renderPresence(SharedChat.getOnlineUsers());
    }
    if (avatarEl) avatarEl.innerHTML   = contact.avatar
      ? `<img src="${contact.avatar}" class="w-full h-full object-cover">`
      : (contact.name || '?').charAt(0);
    headerEl?.classList.remove('hidden');
    inputEl?.classList.remove('hidden');

    // ✅ Limpiar respuesta pendiente anterior
    hideReplyBar();
    this._pendingReply = null;

    await this._loadMessages();
    this._subscribeRealtime();
  },

  async _loadMessages() {
    const container = document.getElementById('chatMessagesContainer');
    if (!container) return;
    container.innerHTML = '<div class="flex-1 flex items-center justify-center"><div class="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div></div>';

    try {
      // Reset paginación al abrir un chat nuevo
      SharedChat.resetPagination(this._conversationId);

      let messages = [], conversationId = null;
      try {
        const res = await SharedChat.loadConversation(this._activeContactId);
        messages = res.messages || [];
        conversationId = res.conversationId || null;
      } catch (_) {
        // get_direct_messages puede no existir aún — mostrar chat vacío
        messages = [];
        conversationId = null;
      }
      this._conversationId = conversationId;

      // Marcar como leídos al abrir
      if (conversationId) SharedChat.markAsRead(conversationId);

      container.classList.add('wa-wallpaper');

      // ✅ Acciones de mensaje: mantener presionado / clic derecho (siempre, idempotente)
      bindMessageActions(container, {
        myId: this._currentUserId,
        onReply: (msg) => {
          const senderName = msg.sender_id === this._currentUserId
            ? 'ti' : (this._allContacts.find(c => c.id === msg.sender_id)?.name || 'Contacto');
          this._pendingReply = { id: msg.id, senderName, content: msg.content };
          showReplyBar(document.getElementById('chatInputArea'), { senderName, content: msg.content }, () => { this._pendingReply = null; });
        },
        onForward: (msg) => {
          const targets = this._allContacts.filter(c => c.id).map(c => ({ id: c.id, name: c.name, avatar: c.avatar }));
          openForwardModal(targets, async (ct) => {
            await SharedChat.sendMessage(this._currentUserId, ct.id, msg.content);
          });
        },
        onReact: async (msgId, emoji) => SharedChat.toggleReaction(msgId, emoji),
        onDelete: async (msgId) => SharedChat.deleteMessage(msgId)
      });

      if (!messages.length) {
        container.innerHTML = '<div class="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-60 gap-2"><i data-lucide="message-circle" class="w-10 h-10 text-blue-300"></i><p class="text-sm">Inicia la conversación</p></div>';
        if (window.lucide) lucide.createIcons();
        return;
      }

      this._resolveReplyPreviews(messages);
      container.innerHTML = buildThreadHTML(messages, (m) => this._bubbleHtml(m));

      this._scrollToBottom();

      // Top-scroll para cargar mensajes anteriores
      if (this._topScrollDestroy) this._topScrollDestroy();
      const { destroy } = ScrollModule.topScroll({
        container,
        loadFn: async () => {
          if (!this._conversationId) return;
          const { messages: older } = await SharedChat.loadConversation(
            this._activeContactId, this._conversationId, true
          );
          if (older.length) prependThreadHTML(container, older, (m) => this._bubbleHtml(m));
        }
      });
      this._topScrollDestroy = destroy;

    } catch (e) {
      if (container) container.innerHTML = '<div class="p-4 text-center">' + Helpers.errorState('Error al cargar mensajes') + '</div>';
      if (window.lucide) lucide.createIcons();
    }
  },

  /** Resuelve las citas de respuesta contra los mensajes ya cargados */
  _resolveReplyPreviews(messages) {
    if (!messages?.length) return;
    const byId = new Map(messages.filter(m => m.id).map(m => [String(m.id), m]));
    messages.forEach(m => {
      if (m.reply_to && !m._replyPreview) {
        const src = byId.get(String(m.reply_to));
        if (src) m._replyPreview = { sender_name: src.sender_name || '', content: src.content || '' };
      }
    });
  },

  _bubbleHtml(msg) {
    const isMine = msg.sender_id === this._currentUserId;

    // ✅ ¿Quién escribió? — resolver contacto para mensajes entrantes
    const sender = isMine ? this._currentUserProfile : this._allContacts.find(c => c.id === msg.sender_id);
    const senderName = isMine ? (sender?.name || '') : (msg.sender_name || sender?.name || 'Contacto');
    const avatarUrl = isMine ? (sender?.avatar_url || null) : (msg.sender_avatar || sender?.avatar || null);

    return waBubbleHTML({
      m: msg, myId: this._currentUserId,
      senderName,
      avatarUrl,
      showName: true,
      showAvatar: true
    });
  },

  _appendMessage(msg) {
    const container = document.getElementById('chatMessagesContainer');
    if (!container) return;
    container.insertAdjacentHTML('beforeend', this._bubbleHtml(msg));
  },

  async sendMessage() {
    const input = document.getElementById('chatMessageInput');
    const text  = input?.value.trim();
    if (!text || !this._activeContactId || !this._currentUserId) return;

    const reply = this._pendingReply;
    input.value = '';
    input.disabled = true;
    hideReplyBar();
    this._pendingReply = null;

    // Optimistic append (con cita si es respuesta)
    const optimistic = {
      content: text, sender_id: this._currentUserId,
      created_at: new Date().toISOString(),
      _replyPreview: reply ? { sender_name: reply.senderName, content: reply.content } : null
    };
    this._appendMessage(optimistic);
    ScrollModule.scrollToBottom(document.getElementById('chatMessagesContainer'), true);

    try {
      const { conversationId } = await SharedChat.sendMessage(
        this._currentUserId,
        this._activeContactId,
        text,
        this._conversationId,
        reply?.id || null
      );

      if (!this._conversationId && conversationId) {
        this._conversationId = conversationId;
        this._subscribeRealtime();
      }

      // Push notification (silent fail)
      sendPush({ user_id: this._activeContactId, title: 'Nuevo mensaje de Dirección', message: text, type: 'chat' }).catch(() => {});
    } catch (e) {
      Helpers.toast('Error al enviar mensaje', 'error');
      // Remove optimistic message
      document.getElementById('chatMessagesContainer')?.lastChild?.remove();
    } finally {
      input.disabled = false;
      input.focus();
    }
  },

  _subscribeRealtime() {
    this._unsubscribe();
    if (!this._conversationId) return;

    this._channel = SharedChat.subscribeToConversation(
      this._conversationId,
      (newMsg) => {
        if (newMsg.sender_id !== this._currentUserId) {
          this._appendMessage(newMsg);
          ScrollModule.scrollToBottom(document.getElementById('chatMessagesContainer'), true);
        }
      },
      (typingData) => {
        // ✅ TYPING INDICATOR
        const typingEl = document.getElementById('chatTypingIndicator');
        if (!typingEl) return;
        
        if (typingData.isTyping && typingData.userId !== this._currentUserId) {
          typingEl.textContent = `${typingData.userName} está escribiendo...`;
          typingEl.classList.remove('hidden');
        } else {
          typingEl.classList.add('hidden');
        }
      },
      null,
      // Read receipts (✓✓)
      (receipt) => {
        if (!receipt?.id || !receipt.is_read) return;
        const msgEl = document.getElementById(`msg-${receipt.id}`);
        const checks = msgEl?.querySelector('.kk-checks');
        if (checks) { checks.textContent = '✓✓'; checks.classList.add('is-read'); }
      },
      // Reacciones / eliminados en tiempo real
      (updated) => {
        if (!updated?.id) return;
        const row = document.getElementById(`msg-${updated.id}`);
        if (!row) return;
        const bubble = row.querySelector('.kk-msg-bubble');
        if (!bubble) return;
        if (updated.deleted_at && !row.classList.contains('is-deleted')) {
          markRowDeleted(row);
          row.classList.add('is-deleted');
          return;
        }
        bubble.querySelector('.kk-reaction-chips')?.remove();
        if (updated.reactions && Object.keys(updated.reactions).length) {
          bubble.insertAdjacentHTML('beforeend', reactionChipsHTML(updated.reactions, this._currentUserId));
        }
      }
    );

    // Escuchar input para broadcast
    const input = document.getElementById('chatMessageInput');
    const userName = this._currentUserProfile?.name || 'Dirección';
    let typingTimeout;
    
    if (input && !input._typingBound) {
      input._typingBound = true;
      input.addEventListener('input', () => {
        if (this._conversationId) {
          SharedChat.broadcastTyping(this._conversationId, userName, true);
          clearTimeout(typingTimeout);
          typingTimeout = setTimeout(() => {
            SharedChat.broadcastTyping(this._conversationId, userName, false);
          }, 3000);
        }
      });
    }
  },

  _unsubscribe() {
    if (this._channel) {
      supabase.removeChannel(this._channel);
      this._channel = null;
    }
  },

  _scrollToBottom() {
    ScrollModule.scrollToBottom(document.getElementById('chatMessagesContainer'));
  }
};
