import { supabase } from '../shared/supabase.js';
import { AppState } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';
import { Helpers as SharedHelpers } from '../shared/helpers.js';
import { ChatModule as SharedChatModule } from '../shared/chat.js';
import { ScrollModule } from '../shared/scroll.module.js';

export const ChatModule = {
  _contacts: [],
  _activeContact: null,
  _conversationId: null,
  _channel: null,
  _topScrollDestroy: null,

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

      this._contacts = await SharedChatModule.loadPadreContacts(student.id);

      if (!this._contacts.length) {
        list.innerHTML = Helpers.emptyState('No hay contactos disponibles');
        return;
      }

      list.innerHTML = this._contacts.map(c =>
        '<div data-contact-id="' + c.id + '" class="flex items-center gap-3 p-3 rounded-2xl hover:bg-white hover:shadow-sm cursor-pointer transition-all border border-transparent hover:border-slate-100 group mb-1">' +
          '<div class="w-12 h-12 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold overflow-hidden border-2 border-green-50 shrink-0 aspect-square shadow-sm">' +
            (c.avatar_url ? '<img src="' + c.avatar_url + '" class="w-full h-full object-cover">' : c.name.charAt(0)) +
          '</div>' +
          '<div class="min-w-0 flex-1">' +
            '<div class="font-bold text-slate-700 text-sm truncate group-hover:text-green-700">' + escapeHtml(c.name) + '</div>' +
            '<div class="text-[10px] text-slate-400 font-bold uppercase truncate">' + (c.roleLabel || c.role || '') + '</div>' +
          '</div>' +
        '</div>'
      ).join('');

    } catch (err) {
      list.innerHTML = Helpers.emptyState('Error al cargar contactos');
    }
  },

  async selectContact(contactId) {
    const contact = this._contacts.find(c => c.id === contactId);
    if (!contact) return;

    this._activeContact = contact;
    this._conversationId = null;

    // Mobile: ocultar lista, mostrar conversación
    const listPanel = document.getElementById('chatListPanel');
    const convPanel = document.getElementById('chatConversationPanel');
    if (listPanel && convPanel) {
      listPanel.classList.add('chat-hidden');
      convPanel.classList.remove('chat-hidden');
      convPanel.classList.add('flex');
    }

    // Actualizar header
    const headerName   = document.getElementById('chatActiveName');
    const headerMeta   = document.getElementById('chatActiveMeta');
    const headerAvatar = document.getElementById('chatActiveAvatar');
    const headerArea   = document.getElementById('chatActiveHeader');

    if (headerName)   headerName.textContent   = contact.name;
    if (headerMeta)   headerMeta.textContent   = contact.roleLabel || contact.role || '';
    if (headerAvatar) headerAvatar.innerHTML   = contact.avatar_url
      ? '<img src="' + contact.avatar_url + '" class="w-full h-full object-cover">'
      : contact.name.charAt(0);
    if (headerArea) { headerArea.classList.remove('hidden'); headerArea.classList.add('flex'); }

    // Back button
    const backBtn = document.getElementById('chatBackBtn');
    if (backBtn) {
      const newBack = backBtn.cloneNode(true);
      backBtn.parentNode.replaceChild(newBack, backBtn);
      newBack.addEventListener('click', () => {
        if (listPanel && convPanel) {
          convPanel.classList.add('chat-hidden');
          convPanel.classList.remove('flex');
          listPanel.classList.remove('chat-hidden');
        }
      });
    }

    await this.loadMessages();
    this.initRealtime();
  },

  async loadMessages(loadMore = false) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    if (!loadMore) {
      container.innerHTML = '<div class="h-full flex items-center justify-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div></div>';
      SharedChatModule.resetPagination(this._conversationId);
    }

    try {
      const { messages, conversationId, hasMore } = await SharedChatModule.loadConversation(
        this._activeContact.id, this._conversationId, loadMore
      );
      this._conversationId = conversationId;

      if (!loadMore) {
        container.innerHTML = '';
        if (!messages.length) {
          container.innerHTML = '<div class="h-full flex flex-col items-center justify-center text-slate-400 text-sm"><p>No hay mensajes aun.</p><p class="text-xs mt-1">Escribe el primero.</p></div>';
          return;
        }
      }

      const user = AppState.get('user');
      if (loadMore) {
        // Insertar al principio
        const frag = document.createDocumentFragment();
        messages.forEach(m => {
          const div = this._buildBubble(m, user?.id);
          frag.appendChild(div);
        });
        container.insertBefore(frag, container.firstChild);
      } else {
        messages.forEach(m => container.appendChild(this._buildBubble(m, user?.id)));
        ScrollModule.scrollToBottom(container);

        // Activar top-scroll para cargar más
        if (this._topScrollDestroy) this._topScrollDestroy();
        if (hasMore !== false) {
          const { destroy } = ScrollModule.topScroll({
            container,
            loadFn: () => this.loadMessages(true)
          });
          this._topScrollDestroy = destroy;
        }
      }

    } catch (err) {
      if (!loadMore) container.innerHTML = SharedHelpers.errorState('Error al cargar mensajes');
      if (window.lucide) lucide.createIcons();
    }
  },

  _buildBubble(m, myId) {
    const isMine = m.sender_id === myId;
    const div = document.createElement('div');
    div.className = 'flex ' + (isMine ? 'justify-end flex-row-reverse' : 'justify-start') + ' mb-3 gap-2';

    // Get avatar for sender
    const sender = isMine 
      ? AppState.get('profile') 
      : this._contacts.find(c => c.id === m.sender_id);
    
    const avatarUrl = isMine ? (sender?.avatar_url || null) : (m.sender_avatar || sender?.avatar_url);
    const name = isMine ? (sender?.name || '') : (m.sender_name || sender?.name || '');
    
    // Build avatar HTML
    const avatarHtml = avatarUrl 
      ? `<img src="${avatarUrl}" class="w-full h-full object-cover">` 
      : `<span class="text-sm font-bold">${name.charAt(0) || ''}</span>`;

    // Read receipt: show "Visto" for my sent messages that have been read
    const readReceipt = isMine && m.read_at
      ? '<span class="text-[8px] text-green-300 font-bold ml-1">✓✓ Visto</span>'
      : (isMine && m.is_read ? '<span class="text-[8px] text-green-300 font-bold ml-1">✓✓</span>' : '');

    div.innerHTML =
      '<div class="w-8 h-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold overflow-hidden shrink-0 aspect-square">' +
        avatarHtml +
      '</div>' +
      '<div class="max-w-[80%] px-4 py-2 rounded-2xl text-sm shadow-sm ' +
        (isMine ? 'bg-green-600 text-white rounded-tr-none' : 'bg-white border border-slate-100 text-slate-700 rounded-tl-none') +
      '">' +
        '<p class="whitespace-pre-wrap">' + escapeHtml(m.content) + '</p>' +
        '<p class="text-[9px] ' + (isMine ? 'text-green-200' : 'text-slate-400') + ' mt-1 text-right uppercase font-bold flex items-center justify-end gap-1">' +
          new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
          readReceipt +
        '</p>' +
      '</div>';
    return div;
  },

  _appendMessage(m, myId) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.appendChild(this._buildBubble(m, myId));
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

    input.value = '';
    input.disabled = true;
    // Stop typing indicator
    if (this._conversationId) {
      SharedChatModule.broadcastTyping(this._conversationId, profile?.name || 'Padre', false);
    }

    // Optimistic append
    const container = document.getElementById('chatMessages');
    if (container) {
      container.appendChild(this._buildBubble({ sender_id: user.id, content, created_at: new Date().toISOString() }, user.id));
      ScrollModule.scrollToBottom(container, true);
    }

    try {
      const { conversationId } = await SharedChatModule.sendMessage(
        user.id, this._activeContact.id, content, this._conversationId
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
            container.appendChild(this._buildBubble(newMsg, user?.id));
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
      }
    );
  },

  _scrollToBottom() {
    ScrollModule.scrollToBottom(document.getElementById('chatMessages'));
  }
};
