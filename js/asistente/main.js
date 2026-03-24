import { ensureRole, supabase, initOneSignal } from '../shared/supabase.js';
import { AppState } from './state.js';
import { AssistantApi } from './api.js';
import { PaymentsModule } from './payments.js';
import { AccessModule } from './access.js';
import { TeachersModule } from './teachers.js';
import { Helpers } from '../shared/helpers.js';
import { WallModule } from '../shared/wall.js';
import { ChatModule } from '../shared/chat.js';

// 🚀 Definir objeto App globalmente (Nivel Senior) para evitar ReferenceError
window.App = {
  registerAccess: (sid, type) => window.App._registerAccess(sid, type),
  confirmPayment: (id) => window.App._confirmPayment(id),
  rejectPayment: (id) => window.App._rejectPayment(id),
  deletePayment: (id) => window.App._deletePayment(id),
  registerPayment: (sid) => window.App._registerPayment(sid),
  openTeacherModal: (id) => window.App._openTeacherModal(id),
  toggleCommentSection: (id) => window.App._toggleCommentSection(id),
  deleteComment: (cid, pid) => window.App._deleteComment(cid, pid),
  sendComment: (pid) => window.App._sendComment(pid),
  toggleLike: (pid) => window.App._toggleLike(pid),
  selectChatContact: (uid, name, role) => window.App._selectChatContact(uid, name, role)
};

/**
 * Inicialización principal del Panel de Asistente
 */
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Karpus Assistant Module Starting...');
  
  // 1. Verificar Rol
  const auth = await ensureRole(['asistente', 'admin', 'directora']);
  if (!auth) return;

  AppState.set('user', auth.user);
  AppState.set('profile', auth.profile);

  // 2. Inicializar Módulos
  await initDashboard();
  await PaymentsModule.init();
  if(AccessModule.init) AccessModule.init();
  await TeachersModule.init();
  initNavigation();
  WallModule.init('muroPostsContainer', { accentColor: 'teal' }, AppState);
  await initAssistantChat();
  try { initOneSignal(auth.user); } catch(e) {}
  initProfile();

  // 3. Estandarizar funciones globales en objeto App (Senior Level)
  Object.assign(window.App, {
    _registerAccess: (sid, type) => AccessModule.register(sid, type),
    _confirmPayment: (id) => confirmPayment(id),
    _rejectPayment: (id) => rejectPayment(id),
    _deletePayment: (id) => deletePayment(id),
    _registerPayment: (sid) => PaymentsModule.openModal(sid),
    _openTeacherModal: (id) => TeachersModule.openModal(id),
    _toggleCommentSection: (id) => WallModule.toggleCommentSection(id),
    _deleteComment: (cid, pid) => WallModule.deleteComment(cid, pid),
    _sendComment: (pid) => sendComment(pid),
    _toggleLike: (pid) => WallModule.toggleLike(pid),
    _selectChatContact: (uid, name, role) => selectAssistantChat(uid, name, role)
  });

  // Mantener compatibilidad temporal para onclick en HTML que no use App.
  Object.assign(window, window.App);

  // 🔥 EXPOSICIÓN GLOBAL DE MÓDULOS
  window.WallModule = WallModule;

  if (window.lucide) window.lucide.createIcons();
});

/**
 * Carga inicial del dashboard de asistente
 */
async function initDashboard() {
  try {
    const [students, rooms] = await Promise.all([
      supabase.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('classrooms').select('*', { count: 'exact', head: true })
    ]);

    const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    setTxt('dashboardActiveStudents', students.count || 0);
    setTxt('dashboardRooms', rooms.count || 0);
    
    // Cargar gráfico de ingresos (mismo que directora pero en el dashboard del asistente)
    PaymentsModule.loadIncomeChart();
  } catch (e) {
    console.error(e);
  }
}

/**
 * Navegación lateral
 */
function initNavigation() {
  const navLinks = document.querySelectorAll('[data-section]');
  const sections = document.querySelectorAll('section[id]');

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.dataset.section;
      
      navLinks.forEach(l => l.classList.remove('bg-teal-50', 'text-teal-600', 'active'));
      link.classList.add('bg-teal-50', 'text-teal-600', 'active');
      
      sections.forEach(s => s.classList.add('hidden'));
      document.getElementById(target)?.classList.remove('hidden');
      
      AppState.set('currentSection', target);
    });
  });
}



/**
 * Perfil del Asistente
 */
async function initProfile() {
  const profile = AppState.get('profile');
  if (!profile) return;
  
  const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };
  setVal('profileName', profile.name);
  setVal('profilePhone', profile.phone);
  setVal('profileEmail', profile.email);
  setVal('profileBio', profile.bio || '');

  const form = document.getElementById('profileForm');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const updates = {
        name: document.getElementById('profileName').value,
        phone: document.getElementById('profilePhone').value,
        bio: document.getElementById('profileBio').value
      };
      const { error } = await supabase.from('profiles').update(updates).eq('id', AppState.get('user').id);
      if (error) Helpers.toast('Error al guardar perfil', 'error');
      else Helpers.toast('Perfil actualizado correctamente');
    };
  }
}

// --- Funciones Globales de Ventana ---

async function confirmPayment(id) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('payments').update({ status: 'confirmado', validated_by: user.id }).eq('id', id);
  if (!error) {
    Helpers.toast('Pago confirmado');
    PaymentsModule.loadPayments();
  }
}

async function rejectPayment(id) {
  const reason = prompt('Motivo del rechazo:');
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('payments').update({ status: 'rechazado', validated_by: user.id, notes: reason || null }).eq('id', id);
  if (!error) {
    Helpers.toast('Pago rechazado');
    PaymentsModule.loadPayments();
  }
}

async function deletePayment(id) {
  if (!confirm('¿Seguro que desea eliminar este pago?')) return;
  const { error } = await supabase.from('payments').delete().eq('id', id);
  if (!error) {
    Helpers.toast('Pago eliminado');
    PaymentsModule.loadPayments();
  }
}

async function toggleCommentSection(id) {
  const el = document.getElementById(`comments-section-${id}`);
  if (el) el.classList.toggle('hidden');
}

async function deleteComment(cid, pid) {
  if (!confirm('¿Eliminar comentario?')) return;
  const { error } = await supabase.from('comments').delete().eq('id', cid);
  if (!error) {
    Helpers.toast('Comentario eliminado');
    WallModule.loadPosts(document.getElementById('muroPostsContainer'));
  }
}

async function sendComment(postId) {
  const input = document.getElementById(`comment-input-${postId}`);
  const text = input?.value.trim();
  if(!text) return;

  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('comments').insert({ post_id: postId, user_id: user.id, content: text });
  input.value = '';
  WallModule.loadPosts(document.getElementById('muroPostsContainer'));
}

// =======================================================
// 💬 SISTEMA DE CHAT UNIFICADO (ASISTENTE)
// =======================================================
let activeChatUserId = null;
let activeConversationId = null;

async function initAssistantChat() {
  const container = document.getElementById('chatContactsList');
  if (!container) return; 

  try {
    const unreadMap = await ChatModule.getUnreadCounts();

    // Buscador listener
    const searchInput = document.getElementById('chatSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => loadChatContacts(e.target.value, unreadMap));
    }

    // Carga inicial
    await loadChatContacts('', unreadMap);

    // Listener envio
    const btnSend = document.getElementById('btnSendChatMessage');
    const inputMsg = document.getElementById('chatMessageInput');
    
    if (btnSend && inputMsg) {
      const newBtn = btnSend.cloneNode(true);
      btnSend.parentNode.replaceChild(newBtn, btnSend);
      
      newBtn.addEventListener('click', () => sendAssistantMessage());
      inputMsg.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendAssistantMessage();
        }
      });
    }
  } catch (e) {
    console.error("Error initAssistantChat:", e);
  }
}

async function loadChatContacts(searchTerm = '', unreadMap = {}) {
  const container = document.getElementById('chatContactsList');
  if(!container) return;
  
  let query = supabase
    .from('profiles')
    .select('id, name, role, avatar_url')
    .in('role', ['padre', 'maestra', 'directora'])
    .order('name');
    
  if (searchTerm) {
    query = query.ilike('name', `%${searchTerm}%`);
  }

  const { data: profiles } = await query.limit(50);
  
  if (!profiles || profiles.length === 0) {
    container.innerHTML = `<div class="p-4 text-center text-slate-400 text-sm">No hay contactos.</div>`;
    return;
  }

  container.innerHTML = profiles.map(c => {
    const unread = unreadMap[c.id] || 0;
    const roleLabel = c.role.charAt(0).toUpperCase() + c.role.slice(1);
    return `
    <div onclick="App.selectChatContact('${c.id}', '${Helpers.escapeHTML(c.name)}', '${roleLabel}')" 
         class="p-3 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors flex items-center gap-3 border-b border-slate-50 last:border-0 relative">
      <div class="relative">
        <div class="w-10 h-10 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center font-bold overflow-hidden">
          ${c.avatar_url ? `<img src="${c.avatar_url}" class="w-full h-full object-cover">` : c.name.charAt(0)}
        </div>
        ${unread > 0 ? `<div class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">${unread}</div>` : ''}
      </div>
      <div class="min-w-0">
        <div class="font-bold text-slate-700 text-sm truncate">${Helpers.escapeHTML(c.name)}</div>
        <div class="text-[10px] text-slate-400 truncate">${roleLabel}</div>
      </div>
    </div>
  `}).join('');
}

async function selectAssistantChat(userId, name, role) {
  activeChatUserId = userId;
  activeConversationId = null;
  
  const header = document.getElementById('chatActiveHeader');
  const inputArea = document.getElementById('chatInputArea');
  const msgs = document.getElementById('chatMessagesContainer');

  if(header) {
    header.classList.remove('hidden');
    header.classList.add('flex');
    document.getElementById('chatActiveName').textContent = name;
    document.getElementById('chatActiveMeta').textContent = role;
    document.getElementById('chatActiveAvatar').innerHTML = name.charAt(0);
  }
  if(inputArea) inputArea.classList.remove('hidden');
  if(msgs) msgs.innerHTML = '<div class="flex justify-center p-4"><div class="animate-spin w-6 h-6 border-2 border-teal-500 rounded-full border-t-transparent"></div></div>';

  const { messages, conversationId } = await ChatModule.loadConversation(userId);
  activeConversationId = conversationId;
  
  // Renderizar mensajes (reutilizando lógica simple)
  // ... (implementación de render similar a directora)
}

async function sendAssistantMessage() {
  const input = document.getElementById('chatMessageInput');
  const text = input?.value.trim();
  if (!text || !activeChatUserId) return;
  input.value = '';
  await ChatModule.sendMessage(AppState.get('user').id, activeChatUserId, text, activeConversationId);
}
