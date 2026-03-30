import { supabase } from '../shared/supabase.js';
import { AppState } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';
import { ChatModule as SharedChatModule } from '../shared/chat.js';

export const ChatModule = {
  _contacts: [],
  _activeContact: null,
  _conversationId: null,
  _channel: null,

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
          '<div class="w-11 h-11 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold overflow-hidden border border-green-50 shrink-0">' +
            (c.avatar_url ? '<img src="' + c.avatar_url + '" class="w-full h-full object-cover">' : c.name.charAt(0)) +
          '</div>' +
          '<div class="min-w-0 flex-1">' +
            '<div class="font-bold text-slate-700 text-sm truncate group-hover:text-green-700">' + escapeHtml(c.name) + '</div>' +
            '<div class="text-[10px] text-slate-400 font-bold uppercase truncate">' + (c.roleLabel || c.role || '') + '</div>' +
          '</div>' +
        '</div>'
      ).join('');

    } catch (err) {
      console.error('[ChatModule] loadContacts error:', err);
      list.innerHTML = Helpers.emptyState('Error al cargar contactos');
    }
  },

  async selectContact(contactId) {
    const contact = this._contacts.find(c => c.id === contactId);
    if (!contact) return;

    this._activeContact = contact;
    this._conversationId = null;

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
    if (headerArea)  headerArea.classList.remove('hidden');
    // El área de input siempre está visible en panel_padres.html

    await this.loadMessages();
    this.initRealtime();
  },

  async loadMessages() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = '<div class="h-full flex items-center justify-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div></div>';

    try {
      const { messages, conversationId } = await SharedChatModule.loadConversation(this._activeContact.id);
      this._conversationId = conversationId;

      container.innerHTML = '';
      if (!messages.length) {
        container.innerHTML = '<div class="h-full flex flex-col items-center justify-center text-slate-400 text-sm"><p>No hay mensajes aun.</p><p class="text-xs mt-1">Escribe el primero.</p></div>';
        return;
      }

      const user = AppState.get('user');
      messages.forEach(m => this._appendMessage(m, user?.id));
      this._scrollToBottom();

    } catch (err) {
      console.error('[ChatModule] loadMessages error:', err);
      const container2 = document.getElementById('chatMessages');
      if (container2) container2.innerHTML = '<div class="p-4 text-center text-rose-500 text-sm">Error al cargar mensajes.</div>';
    }
  },

  _appendMessage(m, myId) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const isMine = m.sender_id === myId;
    const div = document.createElement('div');
    div.className = 'flex ' + (isMine ? 'justify-end' : 'justify-start') + ' mb-3';
    div.innerHTML =
      '<div class="max-w-[80%] px-4 py-2 rounded-2xl text-sm shadow-sm ' +
        (isMine ? 'bg-green-600 text-white rounded-tr-none' : 'bg-white border border-slate-100 text-slate-700 rounded-tl-none') +
      '">' +
        '<p class="whitespace-pre-wrap">' + escapeHtml(m.content) + '</p>' +
        '<p class="text-[9px] ' + (isMine ? 'text-green-200' : 'text-slate-400') + ' mt-1 text-right uppercase font-bold">' +
          new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
        '</p>' +
      '</div>';
    container.appendChild(div);
  },

  async sendMessage() {
    const input = document.getElementById('messageInput');
    if (!input) return;
    const content = input.value.trim();
    if (!content || !this._activeContact) return;

    const user = AppState.get('user');
    if (!user) return;

    input.value = '';
    input.disabled = true;

    try {
      // Usar SharedChatModule que maneja conversation_id correctamente
      const { conversationId } = await SharedChatModule.sendMessage(
        user.id,
        this._activeContact.id,
        content,
        this._conversationId
      );

      if (!this._conversationId && conversationId) {
        this._conversationId = conversationId;
        this.initRealtime(); // Suscribirse a la nueva conversación
      }

      // Recargar mensajes para mostrar el enviado
      await this.loadMessages();

    } catch (err) {
      console.error('[ChatModule] sendMessage error:', err);
      Helpers.toast('Error al enviar mensaje', 'error');
    } finally {
      input.disabled = false;
      input.focus();
    }
  },

  initRealtime() {
    if (this._channel) {
      supabase.removeChannel(this._channel);
      this._channel = null;
    }
    if (!this._conversationId) return;

    const user = AppState.get('user');
    this._channel = SharedChatModule.subscribeToConversation(
      this._conversationId,
      (newMsg) => {
        if (newMsg.sender_id !== user?.id) {
          this._appendMessage(newMsg, user?.id);
          this._scrollToBottom();
        }
      }
    );
  },

  _scrollToBottom() {
    const el = document.getElementById('chatMessages');
    if (el) el.scrollTop = el.scrollHeight;
  }
};
