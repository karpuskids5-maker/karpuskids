import { supabase } from '../shared/supabase.js';
import { AppState } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';
import { Helpers as SharedHelpers } from '../shared/helpers.js';
import { ChatModule as SharedChatModule } from '../shared/chat.js';
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
  <div class="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-40 py-12">
    <i data-lucide="message-square" class="w-16 h-16 mb-4"></i>
    <p class="font-medium">Selecciona un contacto para comenzar</p>
  </div>`;

export const ChatModule = {
  _contacts: [],
  _activeContact: null,
  _conversationId: null,
  _channel: null,
  _topScrollDestroy: null,
  _previews: {},        // vista previa del último mensaje por contacto
  _pendingReply: null,  // respuesta citada pendiente

  /**
   * Restaura la vista inicial del chat (placeholder "Selecciona un contacto")
   */
  _closeConversationUI() {
    this._activeContact = null;
    this._conversationId = null;
    this._pendingReply = null;
    closeMessageActions();
    hideReplyBar();
    const header = document.getElementById('chatActiveHeader');
    const inputArea = document.querySelector('#chatConversationPanel .chat-input-sticky');
    const container = document.getElementById('chatMessages');
    if (header) header.style.display = 'none';
    if (inputArea) inputArea.style.display = 'none';
    if (container) {
      container.innerHTML = CHAT_PLACEHOLDER_HTML;
      if (window.lucide) lucide.createIcons();
    }
    if (this._channel) { supabase.removeChannel(this._channel); this._channel = null; }
    if (this._topScrollDestroy) { this._topScrollDestroy(); this._topScrollDestroy = null; }
  },

  /**
   * Abre la vista conversación (móvil: lista ↔ chat) con historial integrado —
   * el botón atrás del navegador NO recarga la página
   */
  _openChatView() {
    ChatView.open({
      apply: () => {
        const lp = document.getElementById('chatListPanel');
        const cp = document.getElementById('chatConversationPanel');
        if (lp) lp.style.display = 'none';
        if (cp) cp.style.display = 'flex';
      },
      revert: () => {
        const lp = document.getElementById('chatListPanel');
        const cp = document.getElementById('chatConversationPanel');
        if (cp) cp.style.display = '';
        if (lp) lp.style.display = '';
        this._closeConversationUI();
      }
    });
  },

  /**
   * API para el banner global: abrir conversación por userId
   */
  async openChatWithUser(userId) {
    if (!this._contacts.length) await this.loadContacts();
    if (this._contacts.some(c => c.id === userId)) {
      this.selectContact(userId);
      return true;
    }
    return false;
  },

  isActiveChatOpen(msg) {
    return !!this._activeContact && !!msg?.conversation_id && msg.conversation_id === this._conversationId;
  },

  async init() {
    const list = document.getElementById('chatContactsList');
    if (!list) return;

    // Listeners de envío — una sola vez
    const sendBtn = document.getElementById('btnSendChatMessage');
    const input   = document.getElementById('messageInput');
    if (sendBtn && !sendBtn._chatBound) {
      sendBtn._chatBound = true;
      sendBtn.addEventListener('click', () => this.sendMessage());
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
        });
      }
    }

    // Botón atrás — móvil y escritorio, una sola vez (usa historial)
    const backBtn = document.getElementById('chatBackBtn');
    if (backBtn && !backBtn._kkBound) {
      backBtn._kkBound = true;
      backBtn.addEventListener('click', () => ChatView.back());
    }

    // Búsqueda de contactos
    const searchInput = document.getElementById('chatSearchInput');
    if (searchInput && !searchInput._kkBound) {
      searchInput._kkBound = true;
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        list.querySelectorAll('[data-contact-id]').forEach(el => {
          el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }

    // Delegación para seleccionar contacto
    if (!list._chatBound) {
      list._chatBound = true;
      Helpers.delegate(list, '[data-contact-id]', 'click', (_e, el) => {
        this.selectContact(el.dataset.contactId);
      });
    }

    await this.loadContacts();
  },

  async loadContacts() {
    const list = document.getElementById('chatContactsList');
    if (!list) return;
    list.innerHTML = Helpers.skeleton(3, 'h-16');

    try {
      const student = AppState.get('currentStudent');
      if (!student) {
        list.innerHTML = Helpers.emptyState('No hay estudiante vinculado');
        return;
      }

      const [contacts, unreadRes] = await Promise.all([
        SharedChatModule.loadPadreContacts(student.id),
        SharedChatModule.getUnreadCounts().catch(() => ({ counts: {} }))
      ]);
      this._contacts = contacts;
      const unreadMap = unreadRes?.counts || {};

      if (!this._contacts.length) {
        list.innerHTML = Helpers.emptyState('No hay contactos disponibles');
        return;
      }

      // ✅ Vista previa del último mensaje + presencia global (en paralelo)
      const contactIds = this._contacts.map(c => c.id).filter(Boolean);
      const [previews] = await Promise.all([
        SharedChatModule.getLastMessagePreviews(contactIds),
        Promise.resolve(SharedChatModule.subscribeGlobalPresence((online) => {
          document.querySelectorAll('#chatContactsList [data-contact-id]').forEach(el => {
            const dot = el.querySelector('.kk-online-dot');
            if (dot) dot.classList.toggle('is-online', online.has(el.dataset.contactId));
          });
          // Estado en header del chat abierto
          const activeId = this._activeContact?.id;
          const metaEl = activeId && document.getElementById('chatActiveMeta');
          if (metaEl && metaEl.dataset.baseMeta) {
            const isOnline = online.has(activeId);
            metaEl.innerHTML = `<span class="kk-header-status ${isOnline ? 'is-online' : ''}">
              <span class="kk-status-dot"></span>${isOnline ? 'En línea' : escapeHtml(metaEl.dataset.baseMeta)}</span>`;
          }
        }))
      ]);
      this._previews = previews;

      // Orden: último mensaje más reciente primero; sin mensajes → por no leídos
      this._contacts.sort((a, b) => {
        const ta = previews[a.id]?.created_at ? new Date(previews[a.id].created_at).getTime() : 0;
        const tb = previews[b.id]?.created_at ? new Date(previews[b.id].created_at).getTime() : 0;
        if (ta !== tb) return tb - ta;
        return (unreadMap[b.id] || 0) - (unreadMap[a.id] || 0);
      });

      list.innerHTML = this._contacts.map(c => chatListItemHTML({
        c: { id: c.id, name: c.name, avatar: c.avatar_url },
        unread: unreadMap[c.id] || 0,
        lastMsg: previews[c.id] || null,
        online: SharedChatModule.getOnlineUsers().has(c.id),
        sub: c.roleLabel || c.role || '',
        avatarBg: 'bg-green-100 text-green-700'
      })).join('');

      // ✅ Restaurar búsqueda / scroll preservados (experiencia PWA)
      ChatListState.restoreUI('padre', { searchEl: document.getElementById('chatSearchInput') });
      const savedList = ChatListState.load('padre');
      if (savedList.scrollTop) requestAnimationFrame(() => { list.scrollTop = savedList.scrollTop; });
      if (!list._kkScrollSave) {
        list._kkScrollSave = true;
        let tSave = null;
        list.addEventListener('scroll', () => {
          clearTimeout(tSave);
          tSave = setTimeout(() => ChatListState.save('padre', {
            ...ChatListState.load('padre'),
            scrollTop: list.scrollTop
          }), 300);
        }, { passive: true });
      }

    } catch (err) {
      list.innerHTML = Helpers.emptyState('Error al cargar contactos');
    }
  },

  async selectContact(contactId) {
    const contact = this._contacts.find(c => c.id === contactId);
    if (!contact) return;

    this._activeContact = contact;
    this._conversationId = null;

    // ✅ VISTA MÓVIL/DESKTOP + HISTORIAL (botón atrás sin recargar)
    this._openChatView();

    // Actualizar header (visible — contiene el botón volver)
    const headerName   = document.getElementById('chatActiveName');
    const headerMeta   = document.getElementById('chatActiveMeta');
    const headerAvatar = document.getElementById('chatActiveAvatar');
    const headerArea   = document.getElementById('chatActiveHeader');

    const baseMeta = contact.roleLabel || contact.role || '';
    if (headerName)   headerName.textContent   = contact.name;
    if (headerMeta) {
      headerMeta.textContent = baseMeta;
      headerMeta.dataset.baseMeta = baseMeta;
      const isOnline = SharedChatModule.getOnlineUsers().has(contactId);
      headerMeta.innerHTML = `<span class="kk-header-status ${isOnline ? 'is-online' : ''}">
        <span class="kk-status-dot"></span>${isOnline ? 'En línea' : escapeHtml(baseMeta)}</span>`;
    }
    if (headerAvatar) headerAvatar.innerHTML   = contact.avatar_url
      ? '<img src="' + contact.avatar_url + '" class="w-full h-full object-cover">'
      : contact.name.charAt(0);
    if (headerArea) headerArea.style.display = 'flex';

    // ✅ Limpiar badge de no leídos del contacto abierto
    document.querySelector(`#chatContactsList [data-contact-id="${contactId}"] .kk-unread-badge`)?.remove();

    // ✅ Limpiar respuesta pendiente anterior
    hideReplyBar();
    this._pendingReply = null;

    await this.loadMessages();
    this.initRealtime();
  },

  async loadMessages(loadMore = false) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const myId = AppState.get('user')?.id;

    if (!loadMore) {
      // Skeleton de burbujas para no dejar pantalla en blanco mientras carga
      container.innerHTML = `
        <div class="flex flex-col gap-3 p-2 animate-pulse">
          <div class="flex justify-start gap-2"><div class="w-7 h-7 rounded-full bg-slate-200 shrink-0"></div><div class="bg-slate-100 rounded-2xl h-10 w-48"></div></div>
          <div class="flex justify-end gap-2"><div class="w-7 h-7 rounded-full bg-slate-200 shrink-0"></div><div class="bg-green-100 rounded-2xl h-10 w-36"></div></div>
          <div class="flex justify-start gap-2"><div class="w-7 h-7 rounded-full bg-slate-200 shrink-0"></div><div class="bg-slate-100 rounded-2xl h-16 w-56"></div></div>
          <div class="flex justify-end gap-2"><div class="w-7 h-7 rounded-full bg-slate-200 shrink-0"></div><div class="bg-green-100 rounded-2xl h-10 w-44"></div></div>
          <div class="flex justify-start gap-2"><div class="w-7 h-7 rounded-full bg-slate-200 shrink-0"></div><div class="bg-slate-100 rounded-2xl h-10 w-32"></div></div>
        </div>`;
      SharedChatModule.resetPagination(this._conversationId);
    }

    try {
      const { messages, conversationId, hasMore } = await SharedChatModule.loadConversation(
        this._activeContact.id, this._conversationId, loadMore
      );
      this._conversationId = conversationId;

      // Marcar como leídos al abrir
      if (!loadMore && conversationId) SharedChatModule.markAsRead(conversationId);

      if (!loadMore) {
        container.classList.add('wa-wallpaper');
        this._resolveReplyPreviews(messages);
        container.innerHTML = messages.length
          ? buildThreadHTML(messages, (m) => this._bubbleHtml(m, myId))
          : '<div class="h-full flex flex-col items-center justify-center text-slate-400 text-sm"><p>No hay mensajes aun.</p><p class="text-xs mt-1">Escribe el primero.</p></div>';
        ScrollModule.scrollToBottom(container);

        // ✅ Acciones de mensaje: mantener presionado / clic derecho
        bindMessageActions(container, {
          myId,
          onReply: (msg) => {
            const senderName = msg.sender_id === myId ? 'ti' : (this._contacts.find(c => c.id === msg.sender_id)?.name || 'Contacto');
            this._pendingReply = { id: msg.id, senderName, content: msg.content };
            showReplyBar(document.querySelector('#chatConversationPanel .chat-input-sticky'), { senderName, content: msg.content }, () => { this._pendingReply = null; });
          },
          onForward: (msg) => {
            const targets = this._contacts.filter(c => c.id).map(c => ({ id: c.id, name: c.name, avatar: c.avatar_url }));
            openForwardModal(targets, async (ct) => {
              const u = AppState.get('user');
              await SharedChatModule.sendMessage(u?.id, ct.id, msg.content);
            });
          },
          onReact: async (msgId, emoji) => SharedChatModule.toggleReaction(msgId, emoji),
          onDelete: async (msgId) => SharedChatModule.deleteMessage(msgId)
        });

        // Activar top-scroll para cargar más
        if (this._topScrollDestroy) this._topScrollDestroy();
        if (hasMore !== false) {
          const { destroy } = ScrollModule.topScroll({
            container,
            loadFn: () => this.loadMessages(true)
          });
          this._topScrollDestroy = destroy;
        }
      } else if (messages.length) {
        prependThreadHTML(container, messages, (m) => this._bubbleHtml(m, myId));
      }

    } catch (err) {
      if (!loadMore) {
        container.innerHTML = SharedHelpers.errorState('Error al cargar mensajes');
        if (window.lucide) lucide.createIcons();
      }
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

  _bubbleHtml(m, myId) {
    const isMine = m.sender_id === myId;

    // ✅ ¿Quién escribió? — resolver contacto para mensajes entrantes
    const sender = isMine ? AppState.get('profile') : this._contacts.find(c => c.id === m.sender_id);
    const senderName = isMine ? (sender?.name || '') : (m.sender_name || sender?.name || 'Contacto');
    const avatarUrl = isMine ? (sender?.avatar_url || null) : (m.sender_avatar || sender?.avatar_url || null);

    return waBubbleHTML({
      m, myId,
      senderName,
      avatarUrl,
      showName: true,
      showAvatar: true
    });
  },

  async sendMessage() {
    const input = document.getElementById('messageInput');
    if (!input) return;
    const content = input.value.trim();
    if (!content || !this._activeContact) return;

    // Rate limit: máx 20 mensajes por minuto
    const { checkRateLimit, messageLimiter } = await import('../shared/rate-limiter.js');
    if (!checkRateLimit(messageLimiter, 'enviar mensajes')) return;

    const user    = AppState.get('user');
    const profile = AppState.get('profile');
    if (!user) return;

    const reply = this._pendingReply;
    input.value = '';
    input.disabled = true;
    hideReplyBar();
    this._pendingReply = null;
    // Stop typing indicator
    if (this._conversationId) {
      SharedChatModule.broadcastTyping(this._conversationId, profile?.name || 'Padre', false);
    }

    // Optimistic append (con cita si es respuesta)
    const container = document.getElementById('chatMessages');
    if (container) {
      container.insertAdjacentHTML('beforeend', this._bubbleHtml({
        sender_id: user.id, content,
        created_at: new Date().toISOString(),
        _replyPreview: reply ? { sender_name: reply.senderName, content: reply.content } : null
      }, user.id));
      ScrollModule.scrollToBottom(container, true);
    }

    try {
      const { conversationId } = await SharedChatModule.sendMessage(
        user.id, this._activeContact.id, content, this._conversationId, reply?.id || null
      );
      if (!this._conversationId && conversationId) {
        this._conversationId = conversationId;
        this.initRealtime();
      }
    } catch (err) {
      Helpers.toast('Error al enviar mensaje', 'error');
      container?.lastElementChild?.remove();
    } finally {
      input.disabled = false;
      input.focus();
    }
  },

  initRealtime() {
    if (this._channel) { supabase.removeChannel(this._channel); this._channel = null; }
    if (!this._conversationId) return;
    const user    = AppState.get('user');
    const profile = AppState.get('profile');

    // Typing debounce
    let typingTimer = null;
    const input = document.getElementById('messageInput');
    if (input && !input._typingBound) {
      input._typingBound = true;
      input.addEventListener('input', () => {
        if (!this._conversationId) return;
        SharedChatModule.broadcastTyping(this._conversationId, profile?.name || 'Padre', true);
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
          SharedChatModule.broadcastTyping(this._conversationId, profile?.name || 'Padre', false);
        }, 2000);
      });
    }

    this._channel = SharedChatModule.subscribeToConversation(
      this._conversationId,
      (newMsg) => {
        if (newMsg.sender_id !== user?.id) {
          const container = document.getElementById('chatMessages');
          if (container) {
            // Remove typing indicator if present
            document.getElementById('typing-indicator')?.remove();
            appendLiveMessage(container, newMsg, (m) => this._bubbleHtml(m, user?.id));
            ScrollModule.scrollToBottom(container, true);
          }
          // Mark as read
          SharedChatModule.markAsRead(this._conversationId);
        }
      },
      // Typing callback
      ({ userName, isTyping }) => {
        const container = document.getElementById('chatMessages');
        if (!container) return;
        const existing = document.getElementById('typing-indicator');
        if (isTyping) {
          if (!existing) {
            const el = document.createElement('div');
            el.id = 'typing-indicator';
            el.className = 'flex justify-start mb-2';
            el.innerHTML = '<div class="bg-white border border-slate-100 rounded-2xl rounded-tl-none px-4 py-2 text-xs text-slate-400 font-bold flex items-center gap-1.5 shadow-sm">' +
              '<span class="flex gap-0.5">' +
                '<span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style="animation-delay:0ms"></span>' +
                '<span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style="animation-delay:150ms"></span>' +
                '<span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style="animation-delay:300ms"></span>' +
              '</span>' +
              escapeHtml(userName) + ' está escribiendo...' +
            '</div>';
            container.appendChild(el);
            ScrollModule.scrollToBottom(container, true);
          }
        } else {
          existing?.remove();
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
          bubble.insertAdjacentHTML('beforeend', reactionChipsHTML(updated.reactions, user?.id));
        }
      }
    );
  }
};
