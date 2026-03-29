import { supabase } from '../shared/supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';

/**
 * 📬 MÓDULO DE CHAT (PADRES)
 */
import { ChatModule as SharedChatModule } from '../shared/chat.js';

export const ChatModule = {
  _contacts: [],
  _activeContact: null,
  _channel: null,

  /**
   * Inicializa el chat
   */
  async init() {
    const list = document.getElementById('chatContactsList');
    if (!list) return;

    // Configurar listeners de envío (una sola vez)
    const sendBtn = document.getElementById('btnSendChatMessage');
    const input = document.getElementById('messageInput'); // Corrected ID from main.js/HTML
    if (sendBtn && !sendBtn._initialized) {
      sendBtn.onclick = () => this.sendMessage();
      input.onkeydown = (e) => (e.key === 'Enter' && !e.shiftKey) && (e.preventDefault(), this.sendMessage());
      sendBtn._initialized = true;
    }

    // Delegación para seleccionar contacto
    if (!list._initialized) {
      Helpers.delegate(list, '[data-contact-id]', 'click', (e, el) => {
        this.selectContact(el.dataset.contactId);
      });
      list._initialized = true;
    }

    await this.loadContacts();
  },

  /**
   * Carga maestros y directivos
   */
  async loadContacts() {
    const list = document.getElementById('chatContactsList');
    if (!list) return;
    list.innerHTML = Helpers.skeleton(4, 'h-16');

    try {
      const student = AppState.get('currentStudent');
      if (!student) return;

      // Usar ChatModule unificado para cargar contactos restringidos
      this._contacts = await SharedChatModule.loadPadreContacts(student.id);
      this.renderContacts();

    } catch (err) {
      console.error('Chat contacts error:', err);
      list.innerHTML = Helpers.emptyState('Error al cargar contactos');
    }
  },

  renderContacts() {
    const list = document.getElementById('chatContactsList');
    if (!list) return;

    if (!this._contacts.length) {
      list.innerHTML = Helpers.emptyState('No hay contactos disponibles');
      return;
    }

    list.innerHTML = this._contacts.map(c => `
      <div data-contact-id="${c.id}" class="flex items-center gap-3 p-3 rounded-2xl hover:bg-white hover:shadow-sm cursor-pointer transition-all border border-transparent hover:border-slate-100 group mb-1">
        <div class="w-11 h-11 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold overflow-hidden border border-indigo-50 shrink-0">
          ${c.avatar_url ? `<img src="${c.avatar_url}" class="w-full h-full object-cover">` : c.name.charAt(0)}
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-bold text-slate-700 text-sm truncate group-hover:text-indigo-600">${escapeHtml(c.name)}</div>
          <div class="text-[10px] text-slate-400 font-bold uppercase truncate">${c.roleLabel}</div>
        </div>
      </div>
    `).join('');
  },

  /**
   * Selecciona un contacto para chatear
   */
  async selectContact(contactId) {
    const contact = this._contacts.find(c => c.id === contactId);
    if (!contact) return;

    this._activeContact = contact;
    
    // UI Header
    const headerName = document.getElementById('chatActiveName');
    const headerMeta = document.getElementById('chatActiveMeta');
    const headerAvatar = document.getElementById('chatActiveAvatar');
    const headerArea = document.getElementById('chatActiveHeader');

    if (headerName) headerName.textContent = contact.name;
    if (headerMeta) headerMeta.textContent = contact.roleLabel;
    if (headerAvatar) {
      headerAvatar.innerHTML = contact.avatar_url 
        ? `<img src="${contact.avatar_url}" class="w-full h-full object-cover">` 
        : contact.name.charAt(0);
    }
    
    if (headerArea) headerArea.classList.remove('hidden');
    
    await this.loadMessages();
    this.initRealtime();
  },

  async loadMessages() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = `<div class="h-full flex items-center justify-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>`;

    try {
      const user = AppState.get('user');
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${this._activeContact.id}),and(sender_id.eq.${this._activeContact.id},receiver_id.eq.${user.id})`)
        .order('created_at', { ascending: true });

      if (error) throw error;

      container.innerHTML = '';
      (data || []).forEach(m => this.appendMessage(m));
      this.scrollToBottom();

    } catch (err) {
      console.error('Load messages error:', err);
    }
  },

  appendMessage(m) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const user = AppState.get('user');
    const isMine = m.sender_id === user.id;

    const div = document.createElement('div');
    div.className = `flex ${isMine ? 'justify-end' : 'justify-start'} mb-3 animate-fade-in`;
    div.innerHTML = `
      <div class="max-w-[80%] px-4 py-2 rounded-2xl text-sm shadow-sm ${isMine ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white border border-slate-100 text-slate-700 rounded-tl-none'}">
        <p class="whitespace-pre-wrap">${escapeHtml(m.content)}</p>
        <p class="text-[9px] ${isMine ? 'text-indigo-200' : 'text-slate-400'} mt-1 text-right uppercase font-bold">
          ${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    `;
    container.appendChild(div);
  },

  async sendMessage() {
    const input = document.getElementById('messageInput');
    if (!input) return;
    const content = input.value.trim();
    if (!content || !this._activeContact) return;

    const user = AppState.get('user');
    input.value = '';

    try {
      const { error } = await supabase.from('messages').insert({
        sender_id: user.id,
        receiver_id: this._activeContact.id,
        content
      });

      if (error) throw error;
      // El realtime recargará si es el receptor, pero para el emisor lo añadimos manual o confiamos en el insert realtime
      // (Supabase insert realtime also triggers for the sender if they are subscribed)
      this.scrollToBottom();

    } catch (err) {
      Helpers.toast('Error al enviar mensaje', 'error');
    }
  },

  initRealtime() {
    if (this._channel) supabase.removeChannel(this._channel);
    
    const user = AppState.get('user');
    this._channel = supabase
      .channel(`chat_${user.id}_${this._activeContact.id}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages',
        filter: `receiver_id=eq.${user.id}` 
      }, payload => {
        if (payload.new.sender_id === this._activeContact.id) {
          this.appendMessage(payload.new);
          this.scrollToBottom();
        }
      })
      .subscribe();
  },

  scrollToBottom() {
    const el = document.getElementById('chatMessages');
    if (el) el.scrollTop = el.scrollHeight;
  }
};
