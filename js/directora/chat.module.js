import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { supabase, sendPush } from '../shared/supabase.js';
import { ChatModule as SharedChat } from '../shared/chat.js';
import { ScrollModule } from '../shared/scroll.module.js';

export const ChatModule = {
  _currentUserId: null,
  _activeContactId: null,
  _conversationId: null,
  _channel: null,
  _allContacts: [],

  async init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    this._currentUserId = user.id;

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

    document.getElementById('chatSearchInput')?.addEventListener('input', () => this._renderContacts());
    document.getElementById('chatRoleFilter')?.addEventListener('change', () => this._loadContacts());
    document.getElementById('chatBackBtn')?.addEventListener('click', () => {
      document.getElementById('chatAppContainer')?.classList.remove('show-chat');
      this._unsubscribe();
    });

    // Expose for inline onclick
    window._chatSelect = (id) => this.selectChat(id);

    await this._loadContacts();
  },

  async _loadContacts() {
    const list = document.getElementById('chatContactsList');
    if (!list) return;
    list.innerHTML = Helpers.skeleton(4);

    try {
      const roleVal = document.getElementById('chatRoleFilter')?.value || '';
      const { data: users, error } = await DirectorApi.getChatUsers(this._currentUserId, roleVal || null);
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
        const si = studentMap[u.id];
        const displayName = (u.role === 'padre' && si?.studentName) ? si.studentName : (u.name || 'Usuario');
        return {
          id: u.id,
          name: displayName,
          avatar: u.avatar_url,
          roleLabel: { maestra: 'Maestra', padre: 'Padre/Madre', asistente: 'Asistente', directora: 'Directora' }[u.role] || u.role,
          meta: u.role === 'padre'
            ? `Padre de ${si?.studentName || 'N/A'} · ${si?.classroomName || 'Sin aula'}`
            : 'Personal Karpus'
        };
      });

      this._renderContacts();
    } catch (e) {
      console.error('[ChatModule] loadContacts:', e);
      list.innerHTML = Helpers.emptyState('Error al cargar contactos');
    }
  },

  _renderContacts() {
    const list = document.getElementById('chatContactsList');
    if (!list) return;
    const q = (document.getElementById('chatSearchInput')?.value || '').toLowerCase();
    const filtered = this._allContacts.filter(c =>
      c.name.toLowerCase().includes(q) || c.meta.toLowerCase().includes(q)
    );

    if (!filtered.length) { list.innerHTML = Helpers.emptyState('Sin contactos'); return; }

    list.innerHTML = filtered.map(c => `
      <div data-contact-id="${c.id}" class="flex items-center gap-3 p-3 rounded-2xl hover:bg-slate-100 cursor-pointer transition-all group">
        <div class="w-11 h-11 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-500 overflow-hidden shrink-0">
          ${c.avatar ? `<img src="${c.avatar}" class="w-full h-full object-cover">` : c.name.charAt(0)}
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-bold text-slate-800 text-sm truncate">${Helpers.escapeHTML(c.name)}</div>
          <div class="text-[10px] text-slate-400 font-bold uppercase truncate">${c.roleLabel}</div>
        </div>
      </div>`).join('');

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

    // Mobile: show chat panel
    document.getElementById('chatAppContainer')?.classList.add('show-chat');

    // Update header
    const nameEl   = document.getElementById('chatActiveName');
    const metaEl   = document.getElementById('chatActiveMeta');
    const avatarEl = document.getElementById('chatActiveAvatar');
    const headerEl = document.getElementById('chatActiveHeader');
    const inputEl  = document.getElementById('chatInputArea');

    if (nameEl)   nameEl.textContent   = contact.name;
    if (metaEl)   metaEl.textContent   = contact.roleLabel + ' · ' + contact.meta;
    if (avatarEl) avatarEl.innerHTML   = contact.avatar
      ? `<img src="${contact.avatar}" class="w-full h-full object-cover">`
      : contact.name.charAt(0);
    headerEl?.classList.remove('hidden');
    inputEl?.classList.remove('hidden');

    await this._loadMessages();
    this._subscribeRealtime();
  },

  async _loadMessages() {
    const container = document.getElementById('chatMessagesContainer');
    if (!container) return;
    container.innerHTML = '<div class="flex-1 flex items-center justify-center"><div class="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div></div>';

    try {
      const { messages, conversationId } = await SharedChat.loadConversation(this._activeContactId);
      this._conversationId = conversationId;

      container.innerHTML = '';
      if (!messages.length) {
        container.innerHTML = '<div class="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-60 gap-2"><i data-lucide="message-circle" class="w-10 h-10 text-blue-300"></i><p class="text-sm">Inicia la conversación</p></div>';
        if (window.lucide) lucide.createIcons();
        return;
      }

      messages.forEach(m => this._appendMessage(m));
      this._scrollToBottom();
    } catch (e) {
      console.error('[ChatModule] loadMessages:', e);
      if (container) container.innerHTML = '<div class="p-4 text-center text-rose-500 text-sm font-bold">Error al cargar mensajes.</div>';
    }
  },

  _appendMessage(msg) {
    const container = document.getElementById('chatMessagesContainer');
    if (!container) return;
    const isMine = msg.sender_id === this._currentUserId;
    const time   = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const div    = document.createElement('div');
    div.className = `flex ${isMine ? 'justify-end' : 'justify-start'} mb-2`;
    div.innerHTML = `<div class="msg-bubble ${isMine ? 'msg-me' : 'msg-them'}">
      <div class="whitespace-pre-wrap break-words">${Helpers.escapeHTML(msg.content || '')}</div>
      <div class="text-[9px] ${isMine ? 'text-blue-100' : 'text-slate-400'} mt-1 text-right opacity-80">${time}</div>
    </div>`;
    container.appendChild(div);
  },

  async sendMessage() {
    const input = document.getElementById('chatMessageInput');
    const text  = input?.value.trim();
    if (!text || !this._activeContactId || !this._currentUserId) return;

    input.value = '';
    input.disabled = true;

    // Optimistic append
    this._appendMessage({ content: text, sender_id: this._currentUserId, created_at: new Date().toISOString() });
    this._scrollToBottom();

    try {
      const { conversationId } = await SharedChat.sendMessage(
        this._currentUserId,
        this._activeContactId,
        text,
        this._conversationId
      );

      if (!this._conversationId && conversationId) {
        this._conversationId = conversationId;
        this._subscribeRealtime();
      }

      // Push notification (silent fail)
      sendPush({ user_id: this._activeContactId, title: 'Nuevo mensaje de Dirección', message: text, type: 'chat' }).catch(() => {});
    } catch (e) {
      console.error('[ChatModule] sendMessage:', e);
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
          this._scrollToBottom();
        }
      }
    );
  },

  _unsubscribe() {
    if (this._channel) {
      supabase.removeChannel(this._channel);
      this._channel = null;
    }
  },

  _scrollToBottom() {
    const el = document.getElementById('chatMessagesContainer');
    if (el) el.scrollTop = el.scrollHeight;
  }
};
