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
  _topScrollDestroy: null,

  async init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    this._currentUserId = user.id;

    // Get current user profile for avatar
    const { data: profile } = await supabase.from('profiles').select('name, avatar_url').eq('id', user.id).single();
    this._currentUserProfile = profile || {};

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
    console.log('=== Director Chat: _loadContacts started ===');

    try {
    const roleVal = document.getElementById('chatRoleFilter')?.value || '';
    console.log('roleVal:', roleVal);
    const [usersRes, unreadData] = await Promise.all([
      DirectorApi.getChatUsers(this._currentUserId, roleVal || null),
      // get_unread_counts puede no existir — nunca bloquear la carga de contactos
      supabase.rpc('get_unread_counts').then(r => r.data || {}).catch(() => ({}))
    ]);
    console.log('usersRes:', usersRes);
    const { data: users, error } = usersRes;
    if (error) throw error;
    console.log('users from API:', users);
    console.log('unreadData:', unreadData);

      // Enrich padres with student name
      const parentIds = (users || []).filter(u => u.role === 'padre').map(u => u.id);
      console.log('parentIds:', parentIds);
      let studentMap = {};
      if (parentIds.length) {
        const { data: students } = await DirectorApi.getStudentsByParentIds(parentIds);
        console.log('students from getStudentsByParentIds:', students);
        (students || []).forEach(s => {
          if (!studentMap[s.parent_id]) studentMap[s.parent_id] = { studentName: s.name, classroomName: s.classrooms?.name || '' };
        });
      }
      console.log('studentMap:', studentMap);

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
        console.log('Built contact:', contact);
        return contact;
      });
      console.log('=== Final this._allContacts:', this._allContacts);

      this._renderContacts();
    } catch (e) {
      console.error('=== Error loading chat contacts ===', e);
      list.innerHTML = Helpers.emptyState('Error al cargar contactos: ' + (e.message || 'Desconocido'));
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

    list.innerHTML = filtered.map(c => `
      <div data-contact-id="${c.id}" class="flex items-center gap-3 p-3 rounded-2xl hover:bg-slate-100 cursor-pointer transition-all group relative">
        <div class="relative shrink-0">
          <div class="w-11 h-11 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-500 overflow-hidden">
            ${c.avatar ? `<img src="${c.avatar}" class="w-full h-full object-cover">` : (c.name || '?').charAt(0)}
          </div>
          ${c.unread > 0 ? `<span class="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 shadow animate-pulse">${c.unread > 9 ? '9+' : c.unread}</span>` : ''}
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-bold text-slate-800 text-sm truncate ${c.unread > 0 ? 'text-slate-900' : ''}">${Helpers.escapeHTML(c.name || 'Sin nombre')}</div>
          ${c.parentName ? `<div class="text-[10px] text-slate-500 font-bold truncate">👤 ${Helpers.escapeHTML(c.parentName)}</div>` : ''}
          <div class="text-[10px] text-slate-400 font-bold uppercase truncate">${c.roleLabel}${c.studentName && c.parentName ? '' : c.meta !== 'Personal Karpus' ? ' · ' + Helpers.escapeHTML(c.meta) : ''}</div>
        </div>
        ${c.unread > 0 ? `<div class="w-2 h-2 bg-rose-500 rounded-full shrink-0"></div>` : ''}
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

    // Limpiar badge del contacto
    contact.unread = 0;
    this._renderContacts();

    // Mobile: show chat panel
    document.getElementById('chatAppContainer')?.classList.add('show-chat');

    // Update header
    const nameEl   = document.getElementById('chatActiveName');
    const metaEl   = document.getElementById('chatActiveMeta');
    const avatarEl = document.getElementById('chatActiveAvatar');
    const headerEl = document.getElementById('chatActiveHeader');
    const inputEl  = document.getElementById('chatInputArea');

    if (nameEl)   nameEl.textContent   = contact.name;
    if (metaEl)   metaEl.textContent   = contact.parentName
      ? `${contact.roleLabel} · 👤 ${contact.parentName} · ${contact.meta.split(' · ').slice(-1)[0] || ''}`
      : contact.roleLabel + ' · ' + contact.meta;
    if (avatarEl) avatarEl.innerHTML   = contact.avatar
      ? `<img src="${contact.avatar}" class="w-full h-full object-cover">`
      : (contact.name || '?').charAt(0);
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

      container.innerHTML = '';
      if (!messages.length) {
        container.innerHTML = '<div class="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-60 gap-2"><i data-lucide="message-circle" class="w-10 h-10 text-blue-300"></i><p class="text-sm">Inicia la conversación</p></div>';
        if (window.lucide) lucide.createIcons();
        return;
      }

      messages.forEach(m => this._appendMessage(m));
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
          if (older.length) {
            const frag = document.createDocumentFragment();
            const tmp = document.createElement('div');
            older.forEach(m => {
              tmp.innerHTML = this._buildBubble(m);
              while (tmp.firstChild) frag.appendChild(tmp.firstChild);
            });
            container.insertBefore(frag, container.firstChild);
          }
        }
      });
      this._topScrollDestroy = destroy;

    } catch (e) {
      if (container) container.innerHTML = '<div class="p-4 text-center">' + Helpers.errorState('Error al cargar mensajes') + '</div>';
      if (window.lucide) lucide.createIcons();
    }
  },

  _buildBubble(msg) {
    const isMine = msg.sender_id === this._currentUserId;
    const time   = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Get avatar for sender
    const sender = isMine 
      ? this._currentUserProfile 
      : this._allContacts.find(c => c.id === msg.sender_id);
    
    const avatarUrl = isMine ? (sender?.avatar_url || null) : (msg.sender_avatar || sender?.avatar);
    const name = isMine ? (sender?.name || '') : (msg.sender_name || sender?.name || '');
    
    // Build avatar HTML
    const avatarHtml = avatarUrl 
      ? `<img src="${avatarUrl}" class="w-full h-full object-cover">` 
      : `<span class="text-sm font-bold">${name.charAt(0) || ''}</span>`;
    
    return `<div class="flex ${isMine ? 'justify-end flex-row-reverse' : 'justify-start'} mb-3 gap-2">
      <div class="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-500 overflow-hidden shrink-0">
        ${avatarHtml}
      </div>
      <div class="msg-bubble ${isMine ? 'msg-me' : 'msg-them'} max-w-[80%]">
        <div class="whitespace-pre-wrap break-words">${Helpers.escapeHTML(msg.content || '')}</div>
        <div class="text-[9px] ${isMine ? 'text-blue-100' : 'text-slate-400'} mt-1 text-right opacity-80">${time}</div>
      </div>
    </div>`;
  },

  _appendMessage(msg) {
    const container = document.getElementById('chatMessagesContainer');
    if (!container) return;
    container.insertAdjacentHTML('beforeend', this._buildBubble(msg));
  },

  async sendMessage() {
    const input = document.getElementById('chatMessageInput');
    const text  = input?.value.trim();
    if (!text || !this._activeContactId || !this._currentUserId) return;

    input.value = '';
    input.disabled = true;

    // Optimistic append
    this._appendMessage({ content: text, sender_id: this._currentUserId, created_at: new Date().toISOString() });
    ScrollModule.scrollToBottom(document.getElementById('chatMessagesContainer'), true);

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
      }
    );

    // Escuchar input para broadcast
    const input = document.getElementById('chatMessageInput');
    const user = { name: 'Dirección' }; // O obtener de profiles
    let typingTimeout;
    
    if (input && !input._typingBound) {
      input._typingBound = true;
      input.addEventListener('input', () => {
        if (this._conversationId) {
          SharedChat.broadcastTyping(this._conversationId, user.name, true);
          clearTimeout(typingTimeout);
          typingTimeout = setTimeout(() => {
            SharedChat.broadcastTyping(this._conversationId, user.name, false);
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
