import { supabase } from '../supabase.js';
import { AppState, TABLES, GlobalCache } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';
import { ChatModule } from '../shared/chat.js';
import { loadDashboard } from './main.js';
import { loadAttendance } from './attendance.js';
import { loadTasks } from './tasks.js';
import { loadGrades } from './grades.js';
import { loadPayments } from './payments.js';

let chatContacts = [];
let activeContact = null;
let chatInitialized = false;
let activeConversationId = null;

// ============================
// 📬 CHAT PRINCIPAL (PADRES)
// ============================
export async function initChatSystem() {
  if (chatInitialized) return;
  chatInitialized = true;

  const container = document.getElementById('notifications');
  if (!container) return;

  const searchInput = document.getElementById('chatSearchInput');
  const sendBtn = document.getElementById('btnSendChatMessage');
  const msgInput = document.getElementById('messageInput');
  const avatarBtn = document.getElementById('chatActiveAvatar');

  if (!searchInput || !sendBtn || !msgInput || !avatarBtn) return;

  searchInput.addEventListener('input', renderChatContacts);
  sendBtn.addEventListener('click', sendChatMessage);
  msgInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  avatarBtn.addEventListener('click', () => {
    if (activeContact) showContactProfile(activeContact);
  });

  document.querySelectorAll('[data-close-profile]').forEach(btn => {
    btn.addEventListener('click', hideContactProfile);
  });

  document.getElementById('contactProfileModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideContactProfile();
  });

  await loadChatContacts();
}

async function loadChatContacts() {
  const student = AppState.get('student');
  const user = AppState.get('user');
  const list = document.getElementById('chatContactsList');

  if (!student || !user || !list) return;

  list.innerHTML = Helpers.skeleton(4);

  // Teacher del aula (puede venir como array o objeto)
  const classroom = Array.isArray(student.classrooms) ? student.classrooms[0] : student.classrooms;
  const teacherId = classroom?.teacher_id;

  const queries = [];

  if (teacherId) {
    queries.push(
      supabase.from(TABLES.PROFILES).select('id,name,avatar_url,role,email,phone').eq('id', teacherId).maybeSingle()
    );
  }

  // Director/a(s)
  queries.push(
    supabase.from(TABLES.PROFILES).select('id,name,avatar_url,role,email,phone').in('role', ['directora', 'directora_general', 'director']).order('name')
  );

  try {
    const results = await Promise.all(queries);

    const contacts = [];

    if (teacherId && results[0]?.data) {
      contacts.push({
        ...results[0].data,
        role: 'Maestra'
      });
    }

    const directors = results[results.length - 1]?.data || [];
    directors.forEach(d => {
      contacts.push({
        ...d,
        role: d.role?.toLowerCase().includes('direct') ? 'Directora' : d.role
      });
    });

    // Fallback si no hay contactos
    if (contacts.length === 0) {
      list.innerHTML = Helpers.emptyState('No hay personal disponible');
      return;
    }

    chatContacts = contacts;
    renderChatContacts();

    // Seleccionar primer contacto por defecto
    selectParentChat(chatContacts[0].id);

  } catch (err) {
    console.error('Error cargando contactos de chat:', err);
    list.innerHTML = Helpers.emptyState('Error cargando contactos');
  }
}

function renderChatContacts() {
  const list = document.getElementById('chatContactsList');
  if (!list) return;

  const q = document.getElementById('chatSearchInput')?.value.toLowerCase() || '';
  const filtered = chatContacts.filter(c =>
    c.name?.toLowerCase().includes(q) ||
    c.role?.toLowerCase().includes(q) ||
    (c.email || '').toLowerCase().includes(q)
  );

  if (filtered.length === 0) {
    list.innerHTML = Helpers.emptyState('No se encontraron contactos');
    return;
  }

  list.innerHTML = filtered
    .map(c => {
      const isActive = activeContact?.id === c.id;
      const avatar = c.avatar_url && c.avatar_url.startsWith('http') ? c.avatar_url : '';

      return `
        <div onclick="window.selectParentChat('${c.id}')" class="flex items-center gap-3 p-3 rounded-2xl hover:bg-white hover:shadow-sm cursor-pointer transition-all border ${isActive ? 'border-blue-200 bg-blue-50' : 'border-transparent'}">
          <div class="w-11 h-11 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold overflow-hidden border border-blue-50 flex-shrink-0">
            ${avatar ? `<img src="${avatar}" class="w-full h-full object-cover">` : c.name.charAt(0)}
          </div>
          <div class="min-w-0">
            <div class="font-bold text-slate-700 text-sm truncate">${escapeHtml(c.name)}</div>
            <div class="text-[10px] text-slate-500 truncate">${escapeHtml(c.role)}</div>
          </div>
        </div>
      `;
    })
    .join('');
}

window.selectParentChat = async (contactId) => {
  const contact = chatContacts.find(c => c.id === contactId);
  if (!contact) return;
  activeContact = contact;

  activeConversationId = null; // Reset
  const currentUser = AppState.get('user');
  if (!currentUser) return;

  AppState.set('currentChatUser', contact.id);

  const header = document.getElementById('chatActiveHeader');
  const avatarEl = document.getElementById('chatActiveAvatar');
  const nameEl = document.getElementById('chatActiveName');
  const metaEl = document.getElementById('chatActiveMeta');

  if (header && avatarEl && nameEl && metaEl) {
    header.classList.remove('hidden');
    avatarEl.innerHTML = contact.avatar_url ? `<img src="${contact.avatar_url}" class="w-full h-full object-cover">` : contact.name.charAt(0);
    nameEl.textContent = contact.name;
    metaEl.textContent = contact.role || 'Personal';
  }

  renderChatContacts();
  await loadChatMessages(currentUser.id, contact.id);
};

async function loadChatMessages(myId, contactId) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  container.innerHTML = `
    <div class="flex-1 flex items-center justify-center text-slate-400 opacity-60">
      <i data-lucide="loader-2" class="w-8 h-8 animate-spin text-blue-400"></i>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  try {
    // 🔥 USO UNIFICADO DE CHATMODULE
    const { messages, conversationId } = await ChatModule.loadConversation(contactId);
    
    activeConversationId = conversationId;
    AppState.set('messages', messages);
    renderMessages(messages || [], myId);
    
    // Suscripción Realtime Unificada
    if (activeConversationId) {
      ChatModule.subscribeToConversation(activeConversationId, (newMsg) => handleNewMessage(newMsg, myId));
      ChatModule.markAsRead(activeConversationId);
    }

  } catch (err) {
    console.error('Error cargando mensajes:', err);
    container.innerHTML = Helpers.emptyState('Error al cargar mensajes');
  }
}

function renderMessages(messages, myId) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  if (!messages || messages.length === 0) {
    container.innerHTML = Helpers.emptyState('No hay mensajes aún');
    return;
  }

  container.innerHTML = '';

  messages.forEach(msg => appendMessage(msg, myId));
  scrollToBottom();
}

function appendMessage(msg, myId) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  const isMine = msg.sender_id === myId;
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const wrapper = document.createElement('div');
  wrapper.className = `flex ${isMine ? 'justify-end' : 'justify-start'} gap-2 items-end animate-fade-in`;

  const bubble = document.createElement('div');
  bubble.className = `max-w-[85%] md:max-w-[70%] group`;

  const inner = document.createElement('div');
  inner.className = `px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
    isMine
      ? 'bg-blue-600 text-white rounded-tr-none'
      : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none'
  }`;
  inner.innerHTML = `<div class="whitespace-pre-wrap break-words">${escapeHtml(msg.content)}</div>
    <div class="text-[9px] ${isMine ? 'text-blue-200' : 'text-slate-400'} mt-1 text-right font-bold uppercase tracking-tighter">${time}</div>`;

  if (!isMine) {
    const avatar = document.createElement('div');
    avatar.className = 'w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold overflow-hidden flex-shrink-0';
    const contactAvatar = activeContact?.avatar_url || '';
    avatar.innerHTML = contactAvatar ? `<img src="${contactAvatar}" class="w-full h-full object-cover">` : (activeContact?.name?.charAt(0) || '?');

    wrapper.appendChild(avatar);
  }

  bubble.appendChild(inner);
  wrapper.appendChild(bubble);
  container.appendChild(wrapper);
}

function scrollToBottom() {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 50);
}

export async function sendChatMessage() {
  const input = document.getElementById('messageInput');
  const content = input?.value.trim();
  const user = AppState.get('user');
  const contact = activeContact;

  if (!content || !user || !contact) return;

  input.value = '';

  const tempMsg = {
    id: `temp-${Date.now()}`,
    conversation_id: activeConversationId,
    sender_id: user.id,
    receiver_id: contact.id, // Legacy support field
    content,
    created_at: new Date().toISOString()
  };

  // Optimistic UI
  const messages = [...(AppState.get('messages') || []), tempMsg];
  AppState.set('messages', messages);
  renderMessages(messages, user.id);

  try {
    // 🔥 USO UNIFICADO DE CHATMODULE
    const { message, conversationId } = await ChatModule.sendMessage(
      user.id, 
      contact.id, 
      content, 
      activeConversationId
    );

    // Si se creó una nueva conversación, actualizar ID y suscribirse
    if (!activeConversationId && conversationId) {
      activeConversationId = conversationId;
      ChatModule.subscribeToConversation(activeConversationId, (newMsg) => handleNewMessage(newMsg, user.id));
    }

  } catch (err) {
    console.error('Error enviando mensaje:', err);
    Helpers.toast('Error al enviar', 'error');
  }
}

// Handler para mensajes entrantes
function handleNewMessage(msg, myId) {
  let messages = AppState.get('messages') || [];
  if (messages.some(m => m.id === msg.id)) return; // Evitar duplicados
  
  messages = [...messages, msg];
  AppState.set('messages', messages);
  renderMessages(messages, myId);
  
  if (msg.sender_id !== myId) {
    Helpers.toast('💬 Nuevo mensaje', 'info');
    ChatModule.markAsRead(activeConversationId);
  }
}

function showContactProfile(contact) {
  const modal = document.getElementById('contactProfileModal');
  if (!modal) return;

  document.getElementById('contactProfileName').textContent = contact.name || 'Sin nombre';
  document.getElementById('contactProfileRole').textContent = contact.role || '';
  document.getElementById('contactProfileEmail').textContent = contact.email || '';
  document.getElementById('contactProfilePhone').textContent = contact.phone || '';

  const avatarEl = document.getElementById('contactProfileAvatar');
  const avatar = contact.avatar_url && contact.avatar_url.startsWith('http') ? contact.avatar_url : '';
  avatarEl.innerHTML = avatar ? `<img src="${avatar}" class="w-full h-full object-cover">` : (contact.name?.charAt(0) || '?');

  modal.classList.remove('hidden');
}

function hideContactProfile() {
  const modal = document.getElementById('contactProfileModal');
  if (!modal) return;
  modal.classList.add('hidden');
}

export function initGlobalRealtime() {
  const student = AppState.get('student');
  const classroomId = student?.classroom_id;
  const studentId = student?.id;

  if (!classroomId || !studentId) return;

  if (AppState.get('globalChannel')) {
    console.warn('⚠️ Global realtime ya activo');
    return;
  }

  const subscribeToRealtime = async () => {
    try {
      const old = AppState.get('globalChannel');
      if (old) {
        await AppState.removeChannelSafe(old);
      }

      const channel = supabase
        .channel('global-realtime')

        // 📚 TASKS
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: TABLES.TASKS, 
          filter: `classroom_id=eq.${classroomId}` 
        }, (payload) => {
          console.log('📚 Task update:', payload);

          if (payload.eventType === 'INSERT') {
            const title = payload.new.title || 'Nueva tarea';
            Helpers.toast(`Nueva tarea: ${escapeHtml(title)}`, 'info');
          }

          GlobalCache.delete('tasks');

          if (document.getElementById('tasks')?.classList.contains('active')) {
            loadTasks();
          }

          if (document.getElementById('home')?.classList.contains('active')) {
            loadDashboard();
          }
        })

        // 📊 ATTENDANCE
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: TABLES.ATTENDANCE,
          filter: `student_id=eq.${studentId}`
        }, () => {
          console.log('📊 Attendance update');

          GlobalCache.delete('attendance');

          if (document.getElementById('live-attendance')?.classList.contains('active')) {
            loadAttendance();
          }
        })

        // 📝 EVIDENCIAS
        .on('postgres_changes', { 
          event: 'UPDATE', 
          schema: 'public', 
          table: TABLES.TASK_EVIDENCES, 
          filter: `student_id=eq.${studentId}` 
        }, (payload) => {
          console.log('📝 Evidence update:', payload);

          if (payload.new.grade_letter) {
            Helpers.toast(`¡Tarea calificada! Nota: ${payload.new.grade_letter}`, 'success');
          }

          GlobalCache.delete('evidences');
          GlobalCache.delete('grades');

          if (document.getElementById('tasks')?.classList.contains('active')) loadTasks();
          if (document.getElementById('grades')?.classList.contains('active')) loadGrades();
          if (document.getElementById('home')?.classList.contains('active')) loadDashboard();
        })

        // 💰 PAGOS
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: TABLES.PAYMENTS, 
          filter: `student_id=eq.${studentId}` 
        }, () => {
          console.log('💰 Payment update');

          GlobalCache.delete('payments');

          if (document.getElementById('payments')?.classList.contains('active')) {
            loadPayments();
          }
        })

        .subscribe((status) => {
          console.log('🌐 Global realtime:', status);
        });

      AppState.set('globalChannel', channel);

    } catch (e) {
      console.error('❌ Error en realtime global:', e);
    }
  };

  subscribeToRealtime();
}

window.sendChatMessage = sendChatMessage;
