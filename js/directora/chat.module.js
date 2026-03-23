import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { supabase, sendPush } from '../shared/supabase.js';

export const ChatModule = {
  currentChatUser: null,
  chatChannel: null,
  allContacts: [],

  scrollToBottom() {
    const el = document.getElementById('chatMessagesContainer');
    if (el) el.scrollTop = el.scrollHeight;
  },

  async init() {
    document.getElementById('btnSendChatMessage')?.addEventListener('click', () => this.sendChatMessage());
    document.getElementById('chatMessageInput')?.addEventListener('keydown', e => (e.key === 'Enter' && !e.shiftKey) && (e.preventDefault(), this.sendChatMessage()));
    document.getElementById('chatSearchInput')?.addEventListener('input', () => this.renderContacts());
    document.getElementById('chatRoleFilter')?.addEventListener('change', () => this.loadChatUsers());
    // Exponer select globalmente para los onclick inline del HTML
    window._chatSelect = (userId, name, role, meta, avatar) => this.selectChat(userId, name, role, meta, avatar);
    await this.loadChatUsers();
  },

  async loadChatUsers() {
    const listContainer = document.getElementById('chatContactsList');
    if (!listContainer) return;
    listContainer.innerHTML = Helpers.skeleton(4);
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    const roleVal = document.getElementById('chatRoleFilter')?.value;
    const { data: users, error } = await DirectorApi.getChatUsers(currentUser.id, roleVal);
    if (error) throw new Error(error);

    const parentIds = (users || []).filter(u => u.role === 'padre').map(u => u.id);
    let studentMap = {};
    if (parentIds.length > 0) {
        const { data: students, error: sError } = await DirectorApi.getStudentsByParentIds(parentIds);
        if (!sError) {
          students?.forEach(s => !studentMap[s.parent_id] && (studentMap[s.parent_id] = { studentName: s.name, classroomName: s.classrooms?.name || 'Aula' }));
        }
    }

    this.allContacts = (users || []).map(u => {
      const studentInfo = studentMap[u.id];
      const studentName = studentInfo?.studentName;
      const profileName = u.name || u.full_name || u.p1_name || 'Usuario';

      return {
        id: u.id,
        name: u.role === 'padre' && studentName ? studentName : profileName,
        avatar: u.avatar_url,
        role: { maestra: 'Maestra', padre: 'Padre/Madre', asistente: 'Asistente' }[u.role] || u.role,
        meta: u.role === 'padre'
          ? `Estudiante: ${studentName || 'N/A'} • Aula: ${studentInfo?.classroomName || 'Sin asignar'} (${profileName})`
          : 'Personal Karpus'
      };
    });
    this.renderContacts();
  },

  select(userId, name, role, meta, avatar) {
    return this.selectChat(userId, name, role, meta, avatar);
  },

  renderContacts() {
    const listContainer = document.getElementById('chatContactsList');
    if (!listContainer) return;
    const q = document.getElementById('chatSearchInput')?.value.toLowerCase() || '';
    const filtered = this.allContacts.filter(c => c.name.toLowerCase().includes(q) || c.meta.toLowerCase().includes(q));
    if (filtered.length === 0) { listContainer.innerHTML = Helpers.emptyState('No se encontraron contactos'); return; }
    listContainer.innerHTML = filtered.map(c => `
      <div onclick="App.chat.selectChat('${c.id}', '${Helpers.escapeHTML(c.name)}', '${c.role}', '${Helpers.escapeHTML(c.meta)}', '${c.avatar || ''}')" class="flex items-center gap-3 p-3 rounded-2xl hover:bg-white hover:shadow-sm cursor-pointer transition-all border border-transparent hover:border-slate-100 group">
        <div class="w-11 h-11 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold overflow-hidden border border-blue-50 shrink-0">
          ${c.avatar ? `<img src="${c.avatar}" class="w-full h-full object-cover">` : c.name.charAt(0)}
        </div>
        <div class="min-w-0 flex-1"><div class="font-bold text-slate-700 text-sm truncate group-hover:text-blue-600">${Helpers.escapeHTML(c.name)}</div><div class="text-[10px] text-slate-400 font-bold uppercase truncate">${c.role}</div><div class="text-[10px] text-slate-500 truncate mt-0.5">${c.meta}</div></div>
      </div>`).join('');
  },

  async selectChat(userId, name, role, meta, avatar) {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    this.currentChatUser = userId;
    document.getElementById('chatActiveHeader')?.classList.remove('hidden');
    document.getElementById('chatInputArea')?.classList.remove('hidden');
    const nameEl = document.getElementById('chatActiveName'); if(nameEl) nameEl.textContent = name;
    const metaEl = document.getElementById('chatActiveMeta'); if(metaEl) metaEl.textContent = `${role} • ${meta}`;
    const avatarEl = document.getElementById('chatActiveAvatar'); if(avatarEl) avatarEl.innerHTML = avatar ? `<img src="${avatar}" class="w-full h-full object-cover">` : name.charAt(0);
    const msgContainer = document.getElementById('chatMessagesContainer');
    if(msgContainer) msgContainer.innerHTML = `<div class="flex-1 flex items-center justify-center"><i data-lucide="loader-2" class="w-8 h-8 animate-spin text-blue-400"></i></div>`;
    if (window.lucide) lucide.createIcons();
    
    const { data: msgs, error } = await DirectorApi.getChatHistory(userId);
    if (error) throw new Error(error);

    if(msgContainer) {
      msgContainer.innerHTML = '';
      if (msgs && msgs.length > 0) msgs.forEach(m => this.appendMessage(m, currentUser.id)); 
      else { msgContainer.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-60"><i data-lucide="sparkles" class="w-12 h-12 mb-3 text-blue-300"></i><p class="text-sm">Inicia la conversación con ${name}</p></div>`; if (window.lucide) lucide.createIcons(); }
    }
    this.scrollToBottom();
    
    if (this.chatChannel) {
      supabase.removeChannel(this.chatChannel);
      this.chatChannel = null;
    }
    
    this.chatChannel = supabase.channel(`chat_dir_${currentUser.id}_${userId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages',
        filter: `sender_id=eq.${userId}`
      }, payload => { 
        const msg = payload.new;
        if (msgContainer?.querySelector('.opacity-60')) msgContainer.innerHTML = ''; 
        this.appendMessage(msg, currentUser.id); 
        this.scrollToBottom();
      }).subscribe();
  },

  appendMessage(msg, myId) {
    const container = document.getElementById('chatMessagesContainer');
    if(!container) return;
    const isMine = msg.sender_id === myId;
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const safeContent = Helpers.escapeHTML(msg.content || '');
    const div = document.createElement('div');
    div.className = `flex ${isMine ? 'justify-end' : 'justify-start'} animate-fade-in`;
    div.innerHTML = `<div class="max-w-[85%] md:max-w-[70%] group"><div class="px-4 py-2.5 rounded-2xl text-xs shadow-sm ${isMine ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none'}"><div class="whitespace-pre-wrap break-words">${safeContent}</div><div class="text-[9px] ${isMine ? 'text-blue-200' : 'text-slate-400'} mt-1 text-right font-bold uppercase">${time}</div></div></div>`;
    container.appendChild(div);
  },
 
  async sendChatMessage() {
    const input = document.getElementById('chatMessageInput');
    const text = input?.value.trim();
    if (!text || !this.currentChatUser) return;
    
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    this.appendMessage({ content: text, sender_id: currentUser.id, created_at: new Date().toISOString() }, currentUser.id);
    this.scrollToBottom();
    input.value = ''; 
    
    try {
      const { error } = await DirectorApi.sendMessage(currentUser.id, this.currentChatUser, text);
      if (error) throw new Error(error);
      sendPush({ user_id: this.currentChatUser, title: 'Nuevo mensaje de Dirección', message: text, type: 'chat' });
    } catch (e) { 
      console.error(e); 
      Helpers.toast('Error al enviar mensaje', 'error');
      document.getElementById('chatMessagesContainer')?.lastChild?.remove();
    }
  }
};
