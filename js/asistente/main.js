import { ensureRole, supabase, initOneSignal } from '../shared/supabase.js';
import { AppState } from './state.js';
import { AssistantApi } from './api.js';
import { PaymentsModule } from './payments.js';
import { AccessModule } from './access.js';
import { TeachersModule } from './teachers.js';
import { Helpers } from '../shared/helpers.js';
import { WallModule } from '../shared/wall.js';
import { ChatModule } from '../shared/chat.js';
import { StudentsModule } from './modules/students.js';
import { RoomsModule } from './modules/rooms.js';
import { DashboardModule } from './modules/dashboard.js';
import { BadgeSystem } from '../shared/badges.js';

// 🚀 Definir objeto App globalmente para evitar ReferenceError en onclicks del HTML
window.App = {
  payments: {
    markPaid:      (id)  => PaymentsModule.markPaid(id),
    rejectPayment: (id)  => PaymentsModule.rejectPayment(id),
    deletePayment: (id)  => PaymentsModule.deletePayment(id),
    openModal:     (sid) => PaymentsModule.openPaymentModal(sid),
    closeModal:    ()    => PaymentsModule.closeModal(),
    filterBy:      (s)   => PaymentsModule.filterBy(s)
  },
  registerAccess: (sid, type) => window.App._registerAccess(sid, type),
  confirmPayment: (id) => PaymentsModule.markPaid(id),
  rejectPayment:  (id) => PaymentsModule.rejectPayment(id),
  deletePayment:  (id) => PaymentsModule.deletePayment(id),
  registerPayment:(sid) => PaymentsModule.openPaymentModal(sid),
  openTeacherModal: (id) => window.App._openTeacherModal(id),
  toggleCommentSection: (id) => window.App._toggleCommentSection(id),
  deleteComment: (cid, pid) => window.App._deleteComment(cid, pid),
  sendComment: (pid) => window.App._sendComment(pid),
  toggleLike: (pid) => window.App._toggleLike(pid),
  selectChatContact: (uid, name, role) => window.App._selectChatContact(uid, name, role),
  students: StudentsModule,
  rooms: RoomsModule,
  teachers: {
    openModal:     (id)         => TeachersModule.openModal(id),
    deleteTeacher: (id, name)   => TeachersModule.deleteTeacher(id, name)
  }
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
  console.log('👤 Assistant Role Verified:', auth.profile?.role);

  // 🔴 Sistema de badges por sección
  BadgeSystem.init(auth.user.id);

  // Sidebar profile
  const profile = auth.profile;
  const nameEl = document.getElementById('sidebarUserName');
  if (nameEl) nameEl.textContent = profile?.name || 'Asistente';
  const avatarEl = document.getElementById('sidebarAvatar');
  if (avatarEl && profile?.avatar_url) avatarEl.src = profile.avatar_url;

  // Logout
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  });
  
  // 2. Inicializar módulos ligeros y navegación
  // La navegación ahora se encargará de la carga perezosa (lazy loading) de las secciones.
  WallModule.init('muroPostsContainer', { accentColor: 'teal' }, AppState);
  
  // ✅ FIX OneSignal: Solo inicializar en el dominio correcto para evitar errores de consola
  if (window.location.hostname === 'karpuskids.com' || window.location.hostname === 'localhost') {
    try { initOneSignal(auth.user); } catch(e) {
      console.warn('⚠️ OneSignal error:', e);
    }
  } else {
    console.log('ℹ️ OneSignal skipping: restricted domain');
  }
  
  initNavigation(); // Esto cargará el dashboard y configurará los listeners

  // 3. Estandarizar funciones globales en objeto App (Senior Level)
  // Se mantienen las que son llamadas por módulos que aún usan `onclick`
  Object.assign(window.App, {
    _registerAccess: (sid, type) => AccessModule.register(sid, type),
    _confirmPayment: (id) => PaymentsModule.confirmPayment(id),
    _rejectPayment: (id) => PaymentsModule.rejectPayment(id),
    _deletePayment: (id) => PaymentsModule.deletePayment(id),
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
  window.openTeacherModal = (id) => TeachersModule.openModal(id);

  if (window.lucide) window.lucide.createIcons();
});

/**
 * Carga inicial del dashboard de asistente
 */
async function initDashboard() {
  // Obsoleto, delegado a DashboardModule
}

/**
 * Navegación lateral
 */
const loadedSections = new Set();

function initNavigation() {
  const navLinks = document.querySelectorAll('[data-section]');
  const sections = document.querySelectorAll('section[id]');

  const showSection = async (target) => {
    // 1. Limpiar clases activas en botones de navegación
    navLinks.forEach(l => {
      l.classList.remove('bg-white/20', 'bg-teal-50', 'text-teal-600', 'active');
      // Si el botón está en el sidebar y no es el activo, restaurar su estilo original de texto blanco
      if (!l.classList.contains('active')) {
        l.classList.add('text-white');
      }
    });

    const activeLink = document.querySelector(`[data-section="${target}"]`);
    if (activeLink) {
      activeLink.classList.add('bg-white/20', 'active');
      activeLink.classList.remove('text-white');
    }
    
    // 2. Manejo de visibilidad de secciones (ESCENARIO)
    sections.forEach(s => {
      s.classList.add('hidden');
      s.classList.remove('active');
    });

    const sectionEl = document.getElementById(target);
    if (sectionEl) {
      sectionEl.classList.remove('hidden');
      sectionEl.classList.add('active'); 
      console.log(`🎯 Mostrando escenario: ${target}`);
    } else {
      console.error(`❌ Sección no encontrada: ${target}`);
    }
    
    AppState.set('currentSection', target);

    // 🔴 Marcar badge como leído al entrar a la sección
    BadgeSystem.mark(target);

    // 3. Cerrar sidebar en móvil automáticamente al cambiar de sección
    const sidebar = document.getElementById('sidebar');
    if (sidebar && window.innerWidth < 768) {
      sidebar.classList.remove('mobile-visible');
      const ov = document.getElementById('sidebarOverlay');
      if (ov) ov.style.display = 'none';
    }

    // ✅ --- LÓGICA DE CARGA PEREZOSA (LAZY LOADING) ---
    if (!loadedSections.has(target)) {
      console.log(`🚀 Cargando sección por primera vez: ${target}`);
      switch (target) {
        case 'pagos':
          await PaymentsModule.init();
          // Iniciar cola de verificación
          import('../shared/payment-queue.js').then(m =>
            m.PaymentQueue.init('payment-queue-container')
          ).catch(() => {});
          break;
        case 'accesos':
          if (AccessModule.init) AccessModule.init();
          break;
        case 'maestros':
          await TeachersModule.init();
          break;
        case 'estudiantes':
          await StudentsModule.init();
          break;
        case 'aulas':
          await RoomsModule.init();
          break;
        case 'muro':
          WallModule.loadPosts();
          break;
        case 'chat':
          await initAssistantChat();
          break;
        case 'perfil':
          initProfile();
          import('../shared/notify-permission.js').then(m => m.NotifyPermission.requestIfNeeded());
          break;
      }
      loadedSections.add(target);
    }
  };

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      showSection(link.dataset.section);
    });
  });

  // Carga inicial del dashboard
  DashboardModule.init().then(() => loadedSections.add('dashboard'));
  showSection('dashboard');

  // La gestión del sidebar móvil y de escritorio ahora se maneja en common_ui.js
  // Asegúrate de que common_ui.js esté cargado en tu HTML para el panel de asistente.
  // Si necesitas un botón para colapsar/expandir el sidebar en escritorio,
  // common_ui.js ya lo maneja con el elemento #toggleSidebar.
  // Si necesitas un botón para abrir/cerrar el sidebar en móvil,
  // common_ui.js ya lo maneja con el elemento #menuBtn.
}



/**
 * Perfil del Asistente
 */
async function initProfile() {
  const profile = AppState.get('profile');
  if (!profile) {
    console.warn('⚠️ Profile not loaded');
    return;
  }
  
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
    
    if (btnSend && inputMsg && !btnSend.dataset.bound) {
      const newBtn = btnSend.cloneNode(true);
      btnSend.parentNode.replaceChild(newBtn, btnSend);
      
      newBtn.dataset.bound = 'true';
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

  const { data: profiles, error } = await query.limit(50);

  if (error) {
    console.error('❌ Chat contacts error:', error);
    container.innerHTML = `<div class="p-4 text-center text-red-500 text-sm">Error cargando contactos.</div>`;
    return;
  }
  
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

  try {
    const { messages, conversationId } = await ChatModule.loadConversation(userId);
    activeConversationId = conversationId;
    
    // Renderizar mensajes (reutilizando lógica simple)
    const profile = AppState.get('profile');
    if (!messages || messages.length === 0) {
        msgs.innerHTML = '<div class="h-full flex flex-col items-center justify-center text-slate-400 text-sm"><p>No hay mensajes aún.</p><p>Escribe el primero.</p></div>';
    } else {
        msgs.innerHTML = messages.map(m => {
            const isMe = m.sender_id === profile.id;
            return `
                <div class="flex ${isMe ? 'justify-end' : 'justify-start'}">
                    <div class="max-w-[75%] rounded-2xl p-3 text-sm ${isMe ? 'bg-teal-600 text-white rounded-tr-none' : 'bg-slate-100 text-slate-700 rounded-tl-none'}">
                        <p>${Helpers.escapeHTML(m.content)}</p>
                        <p class="text-[10px] opacity-70 mt-1 text-right">${new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p>
                    </div>
                </div>
            `;
        }).join('');
    }
    msgs.scrollTop = msgs.scrollHeight;

    // Suscripción
    ChatModule.subscribeToConversation(conversationId, (newMsg) => {
        const isMe = newMsg.sender_id === profile.id;
        const html = `
            <div class="flex ${isMe ? 'justify-end' : 'justify-start'}">
                <div class="max-w-[75%] rounded-2xl p-3 text-sm ${isMe ? 'bg-teal-600 text-white rounded-tr-none' : 'bg-slate-100 text-slate-700 rounded-tl-none'}">
                    <p>${Helpers.escapeHTML(newMsg.content)}</p>
                    <p class="text-[10px] opacity-70 mt-1 text-right">${new Date(newMsg.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p>
                </div>
            </div>
        `;
        msgs.insertAdjacentHTML('beforeend', html);
        msgs.scrollTop = msgs.scrollHeight;
    });

  } catch (e) {
    console.error('❌ Chat load error:', e);
    msgs.innerHTML = `<div class="p-4 text-center text-red-500 text-sm">Error cargando chat</div>`;
  }
}

async function sendAssistantMessage() {
  const input = document.getElementById('chatMessageInput');
  const text = input?.value.trim();
  if (!text || !activeChatUserId) return;
  try {
    input.value = '';
    await ChatModule.sendMessage(AppState.get('user').id, activeChatUserId, text, activeConversationId);
  } catch (e) {
    console.error('❌ Send message error:', e);
    Helpers.toast('Error enviando mensaje', 'error');
  }
}

// ── Estudiantes (Asistente) ───────────────────────────────────────────────────
async function loadAsistenteStudents() {
  const tbody = document.getElementById('studentsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8"><div class="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600 mx-auto"></div></td></tr>';

  try {
    const { data: students, error } = await supabase
      .from('students')
      .select('id, name, is_active, p1_name, p1_phone, classroom_id, classrooms:classroom_id(name)')
      .order('name');
    if (error) throw error;

    if (!students?.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-400">No hay estudiantes registrados.</td></tr>';
      return;
    }

    tbody.innerHTML = students.map(s => `
      <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
        <td class="px-6 py-3 font-bold text-slate-800 text-sm">${Helpers.escapeHTML(s.name)}</td>
        <td class="px-6 py-3 text-slate-500 text-sm">${s.classrooms?.name || 'Sin Aula'}</td>
        <td class="px-6 py-3 text-slate-500 text-sm">${s.p1_name || 'N/A'}</td>
        <td class="px-6 py-3">
          <span class="px-2 py-1 rounded-full text-[10px] font-bold ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">
            ${s.is_active ? 'Activo' : 'Inactivo'}
          </span>
        </td>
      </tr>`).join('');

    // Buscador
    const search = document.getElementById('searchStudentInput');
    if (search && !search._bound) {
      search._bound = true;
      search.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        tbody.querySelectorAll('tr').forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }

    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error('[loadAsistenteStudents]', e);
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-rose-500 font-bold text-sm">Error al cargar estudiantes.</td></tr>';
  }
}

// ── Aulas (Asistente) ─────────────────────────────────────────────────────────
async function loadAsistenteRooms() {
  const tbody = document.getElementById('roomsTable');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8"><div class="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600 mx-auto"></div></td></tr>';

  try {
    const { data: rooms, error } = await supabase
      .from('classrooms')
      .select('id, name, level, capacity, teacher:teacher_id(name), students(count)')
      .order('name');
    if (error) throw error;

    if (!rooms?.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-slate-400">No hay aulas registradas.</td></tr>';
      return;
    }

    tbody.innerHTML = rooms.map(r => {
      const count = r.students?.[0]?.count || 0;
      const cap   = r.capacity || 20;
      const pct   = Math.round((count / cap) * 100);
      const barColor = pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500';
      return `
        <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
          <td class="px-4 py-3 font-bold text-slate-800 text-sm">${Helpers.escapeHTML(r.name)}</td>
          <td class="px-4 py-3 text-slate-500 text-sm hidden md:table-cell">${r.teacher?.name || 'Sin asignar'}</td>
          <td class="px-4 py-3">
            <div class="flex items-center gap-2">
              <div class="flex-1 bg-slate-100 rounded-full h-2 max-w-[80px]">
                <div class="${barColor} h-full rounded-full" style="width:${pct}%"></div>
              </div>
              <span class="text-xs font-bold text-slate-500">${count}/${cap}</span>
            </div>
          </td>
          <td class="px-4 py-3 text-center">
            <span class="px-2 py-1 rounded-full text-[10px] font-bold ${pct < 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">
              ${pct < 100 ? 'Disponible' : 'Llena'}
            </span>
          </td>
          <td class="px-4 py-3 text-right text-slate-400 text-xs">${r.level || 'General'}</td>
        </tr>`;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error('[loadAsistenteRooms]', e);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-rose-500 font-bold text-sm">Error al cargar aulas.</td></tr>';
  }
}
