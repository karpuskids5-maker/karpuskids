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
import { ImageLoader } from '../shared/image-loader.js';
import { QueryCache } from '../shared/query-cache.js';
import { RealtimeManager } from '../shared/realtime-manager.js';
import { Security } from '../shared/security.js';

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
    RealtimeManager.unsubscribeAll();
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

  // Asignar funciones internas al objeto global App
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
    _selectChatContact: (uid, name, role) => selectAssistantChat(uid, name, role),
    selectChatContact: (uid, name, role) => selectAssistantChat(uid, name, role),
    _openStudentModal: (id) => StudentsModule.openModal(id),
    _openRoomModal: (id) => RoomsModule.openModal(id),
    openNewPostModal,
    submitNewPost
  });

  // Exponer WallModule globalmente
  window.WallModule = WallModule;
  window.openTeacherModal = (id) => TeachersModule.openModal(id);

  // Mantener compatibilidad temporal para onclick en HTML que no use App.
  Object.assign(window, window.App);

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
      try {
        switch (target) {
          case 'pagos':
            await PaymentsModule.init();
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
      } catch (err) {
        console.error(`[Asistente] Error cargando sección ${target}:`, err);
        Helpers.toast(`Error al cargar ${target}`, 'error');
      }
    } else {
      // Re-cargar datos frescos al volver a una sección ya visitada
      switch (target) {
        case 'maestros':   TeachersModule.loadTeachers?.(); break;
        case 'estudiantes': StudentsModule.loadStudents?.(); break;
        case 'aulas':      RoomsModule.loadRooms?.(); break;
        case 'pagos':      PaymentsModule.loadPayments?.(); break;
      }
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

  // ── Hamburger móvil ──────────────────────────────────────────────────────
  const menuBtn = document.getElementById('menuBtn');
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebarOverlay');

  const _openSidebar = () => {
    sidebar?.classList.add('mobile-visible');
    if (overlay) overlay.style.display = 'block';
  };
  const _closeSidebar = () => {
    sidebar?.classList.remove('mobile-visible');
    if (overlay) overlay.style.display = 'none';
  };

  if (menuBtn) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar?.classList.contains('mobile-visible') ? _closeSidebar() : _openSidebar();
    });
  }
  if (overlay) {
    overlay.addEventListener('click', _closeSidebar);
  }

  // Cerrar sidebar al hacer click en el main (móvil)
  document.getElementById('layoutShell')?.addEventListener('click', () => {
    if (window.innerWidth < 768 && sidebar?.classList.contains('mobile-visible')) {
      _closeSidebar();
    }
  });

  // ── Colapsar sidebar desktop ─────────────────────────────────────────────
  const toggleBtn   = document.getElementById('toggleSidebar');
  const wrapper     = sidebar?.closest('.app-content-wrapper') || document.querySelector('.app-content-wrapper');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      wrapper?.classList.toggle('sidebar-collapsed');
    });
  }
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

  // Avatar preview y upload
  const avatarInput = document.getElementById('profileAvatarInput');
  const avatarPreview = document.getElementById('profileAvatarPreview');
  
  if (avatarPreview && profile.avatar_url) {
    avatarPreview.innerHTML = `<img src="${profile.avatar_url}" class="w-full h-full object-cover rounded-full">`;
  }

  if (avatarInput) {
    avatarInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file && avatarPreview) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          avatarPreview.innerHTML = `<img src="${ev.target.result}" class="w-full h-full object-cover rounded-full">`;
        };
        reader.readAsDataURL(file);
      }
    };
  }

  const form = document.getElementById('profileForm');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

      try {
        const updates = {
          name: document.getElementById('profileName').value,
          phone: document.getElementById('profilePhone').value,
          bio: document.getElementById('profileBio').value
        };

        // Subir avatar si hay uno seleccionado
        const file = avatarInput?.files[0];
        if (file) {
          const ext = file.name.split('.').pop();
          const path = `avatars/${AppState.get('user').id}_${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage.from('karpus-uploads').upload(path, file);
          if (upErr) throw upErr;
          
          const { data: { publicUrl } } = supabase.storage.from('karpus-uploads').getPublicUrl(path);
          updates.avatar_url = publicUrl;
        }

        const { error } = await supabase.from('profiles').update(updates).eq('id', AppState.get('user').id);
        if (error) throw error;
        
        Helpers.toast('Perfil actualizado correctamente');
        // Actualizar estado local
        AppState.set('profile', { ...profile, ...updates });
        
      } catch (err) {
        console.error('Error updating profile:', err);
        Helpers.toast('Error al guardar perfil', 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar Cambios'; }
      }
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

  // Cache key includes search term
  const cacheKey = `asistente_contacts_${searchTerm.slice(0, 20)}`;
  const TTL = searchTerm ? 30_000 : 3 * 60_000;

  try {
    const contacts = await QueryCache.get(cacheKey, async () => {
      // 1. Obtener perfiles — todos los roles con quienes puede chatear
      let query = supabase
        .from('profiles')
        .select('id, name, role, avatar_url')
        .in('role', ['padre', 'maestra', 'directora', 'asistente'])
        .neq('id', AppState.get('user')?.id || 'none')  // no mostrar a sí mismo
        .order('name');
      if (searchTerm) query = query.ilike('name', `%${searchTerm}%`);
      const { data: profiles, error } = await query.limit(100);
      if (error) throw error;

      // 2. Para los padres, buscar el nombre de sus hijos
      const parentIds = profiles.filter(p => p.role === 'padre').map(p => p.id);
      let studentMap = {};
      
      if (parentIds.length > 0) {
        const { data: students } = await supabase
          .from('students')
          .select('parent_id, name')
          .in('parent_id', parentIds);
        
        if (students) {
          students.forEach(s => {
            if (!studentMap[s.parent_id]) studentMap[s.parent_id] = [];
            studentMap[s.parent_id].push(s.name);
          });
        }
      }

      return profiles.map(p => ({
        ...p,
        studentNames: studentMap[p.id] ? studentMap[p.id].join(', ') : null
      }));
    }, TTL);

    if (!contacts.length) {
      container.innerHTML = `<div class="p-4 text-center text-slate-400 text-sm">No hay contactos.</div>`;
      return;
    }

    container.innerHTML = contacts.map(c => {
      const unread = unreadMap[c.id] || 0;
      // Prioridad: Nombre Estudiante (si es padre) > Nombre Perfil
      const displayName = c.role === 'padre' && c.studentNames ? c.studentNames : (c.name || 'Usuario');
      const roleLabel = (c.role || '').charAt(0).toUpperCase() + (c.role || '').slice(1);
      const subLabel = c.role === 'padre' && c.studentNames ? `Padre de ${c.name}` : roleLabel;

      return `
      <div onclick="App.selectChatContact('${c.id}', '${Helpers.escapeHTML(displayName)}', '${roleLabel}')" 
           class="p-3 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors flex items-center gap-3 border-b border-slate-50 last:border-0 relative">
        <div class="relative">
          <div class="w-10 h-10 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center font-bold overflow-hidden">
            ${c.avatar_url ? `<img src="${c.avatar_url}" class="w-full h-full object-cover" loading="lazy">` : displayName.charAt(0).toUpperCase()}
          </div>
          ${unread > 0 ? `<div class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">${unread}</div>` : ''}
        </div>
        <div class="min-w-0">
          <div class="font-bold text-slate-700 text-sm truncate">${Helpers.escapeHTML(displayName)}</div>
          <div class="text-[10px] text-slate-400 truncate">${subLabel}</div>
        </div>
      </div>
    `}).join('');
  } catch (error) {
    console.error('❌ Chat contacts error:', error);
    container.innerHTML = Helpers.errorState('Error cargando contactos');
    if (window.lucide) lucide.createIcons();
  }
}

async function selectAssistantChat(userId, name, role) {
  activeChatUserId = userId;
  activeConversationId = null;

  // Mobile: ocultar lista, mostrar conversación
  const listPanel = document.getElementById('chatListPanel');
  const convPanel = document.getElementById('chatConversationPanel');
  if (listPanel && convPanel) {
    listPanel.classList.add('chat-hidden');
    convPanel.classList.remove('chat-hidden');
    convPanel.classList.add('flex');
  }

  const header = document.getElementById('chatActiveHeader');
  const inputArea = document.getElementById('chatInputArea');
  const msgs = document.getElementById('chatMessagesContainer');

  if (header) {
    header.classList.remove('hidden');
    header.classList.add('flex');
    document.getElementById('chatActiveName').textContent = name;
    document.getElementById('chatActiveMeta').textContent = role;
    document.getElementById('chatActiveAvatar').innerHTML = name.charAt(0);
  }
  if (inputArea) inputArea.classList.remove('hidden');
  if (msgs) msgs.innerHTML = '<div class="flex justify-center p-4"><div class="animate-spin w-6 h-6 border-2 border-teal-500 rounded-full border-t-transparent"></div></div>';

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

  try {
    const { messages, conversationId } = await ChatModule.loadConversation(userId);
    activeConversationId = conversationId;

    const profile = AppState.get('profile');
    const myId = profile?.id;

    const buildBubble = (m) => {
      const isMe = m.sender_id === myId;
      return `<div class="flex ${isMe ? 'justify-end' : 'justify-start'} mb-2">
        <div class="max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${isMe
          ? 'bg-teal-600 text-white rounded-br-none shadow-md'
          : 'bg-white border border-slate-100 text-slate-700 rounded-bl-none shadow-sm'}">
          <p class="whitespace-pre-wrap">${Helpers.escapeHTML(m.content)}</p>
          <p class="text-[9px] ${isMe ? 'text-teal-200' : 'text-slate-400'} mt-1 text-right">${new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p>
        </div>
      </div>`;
    };

    if (!messages || messages.length === 0) {
      msgs.innerHTML = '<div class="flex-1 flex flex-col items-center justify-center text-slate-400 text-sm py-12"><p>No hay mensajes aún.</p><p class="text-xs mt-1">Escribe el primero 👋</p></div>';
    } else {
      msgs.innerHTML = messages.map(buildBubble).join('');
      import('../shared/scroll.module.js').then(({ ScrollModule }) => ScrollModule.scrollToBottom(msgs));
    }

    // Suscripción realtime
    ChatModule.subscribeToConversation(conversationId, (newMsg) => {
      msgs.insertAdjacentHTML('beforeend', buildBubble(newMsg));
      import('../shared/scroll.module.js').then(({ ScrollModule }) => ScrollModule.scrollToBottom(msgs, true));
    });

  } catch (e) {
    console.error('❌ Chat load error:', e);
    msgs.innerHTML = Helpers.errorState('Error cargando chat');
    if (window.lucide) lucide.createIcons();
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

// =======================================================
// 📰 MURO ESCOLAR (ASISTENTE)
// =======================================================

async function openNewPostModal() {
  // Cargar aulas para el selector
  const { data: classrooms } = await supabase.from('classrooms').select('id, name').order('name');
  
  const classroomOptions = (classrooms || []).map(c => `<option value="${c.id}">${Helpers.escapeHTML(c.name)}</option>`).join('');

  const html = `
    <div class="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn">
      <div class="flex justify-between items-start mb-6">
        <h3 class="text-2xl font-black text-slate-800">Crear Publicación</h3>
        <button onclick="window._closeAsistenteModal()" class="p-2 hover:bg-slate-100 rounded-full text-slate-400">✕</button>
      </div>
      <div class="space-y-4">
        <div>
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Aula (Opcional)</label>
          <select id="postClassroom" class="w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-teal-100 focus:border-teal-400 bg-slate-50/50 transition-all text-sm font-medium">
            <option value="">-- Todas las Aulas (General) --</option>
            ${classroomOptions}
          </select>
        </div>

        <textarea id="postContent" rows="4" class="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm outline-none resize-none focus:ring-4 focus:ring-teal-100 focus:border-teal-400" placeholder="¿Qué quieres compartir con la escuela?"></textarea>
        
        <div class="relative">
          <input type="file" id="postFile" class="hidden" accept="image/*,video/*" onchange="document.getElementById('fileName').textContent = this.files[0]?.name || 'Adjuntar foto/video'">
          <label for="postFile" class="flex items-center gap-3 p-3 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:bg-teal-50 hover:border-teal-300 transition-all">
            <div class="w-10 h-10 bg-teal-100 text-teal-600 rounded-xl flex items-center justify-center"><i data-lucide="image-plus"></i></div>
            <span id="fileName" class="text-sm font-bold text-slate-500">Adjuntar foto o video</span>
          </label>
        </div>

        <button id="btnSubmitPost" onclick="App.submitNewPost()" class="w-full py-3.5 bg-teal-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-teal-700 shadow-lg shadow-teal-200 transition-all">PUBLICAR</button>
      </div>
    </div>
  `;

  const gc = document.getElementById('globalModalContainer');
  if (gc) {
    gc.innerHTML = '<div class="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-hidden mx-3 flex flex-col">' + html + '</div>';
    gc.style.display = 'flex';
    gc.style.alignItems = 'center';
    gc.style.justifyContent = 'center';
    gc.style.zIndex = '9999';
  }
  if (window.lucide) lucide.createIcons();
}

async function submitNewPost() {
  const content = document.getElementById('postContent').value.trim();
  const classroomId = document.getElementById('postClassroom').value || null;
  const fileInput = document.getElementById('postFile');
  const file = fileInput?.files[0];
  const btn = document.getElementById('btnSubmitPost');

  if (!content && !file) return Helpers.toast('Escribe algo o sube un archivo', 'warning');

  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin mx-auto"></i>';
  if(window.lucide) window.lucide.createIcons();

  try {
    let mediaUrl = null;
    let mediaType = null;

    if (file) {
      const ext = file.name.split('.').pop();
      const path = `posts/${Date.now()}_${Math.random().toString(36).substr(2,9)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('posts').upload(path, file);
      if (upErr) throw upErr;
      
      const { data } = supabase.storage.from('posts').getPublicUrl(path);
      mediaUrl = data.publicUrl;
      mediaType = file.type.startsWith('video') ? 'video' : 'image';
    }

    const { error } = await supabase.from('posts').insert({
      classroom_id: classroomId,
      teacher_id: AppState.get('user').id,
      content: content,
      media_url: mediaUrl,
      media_type: mediaType
    });

    if (error) throw error;
    Helpers.toast('Publicado correctamente', 'success');
    window._closeAsistenteModal?.();
    WallModule.loadPosts(document.getElementById('muroPostsContainer'));

  } catch (e) {
    console.error('Error submitting post:', e);
    Helpers.toast('Error al publicar', 'error');
    btn.disabled = false;
    btn.innerHTML = 'PUBLICAR';
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
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8">' + Helpers.errorState('Error al cargar estudiantes') + '</td></tr>';
    if (window.lucide) lucide.createIcons();
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
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8">' + Helpers.errorState('Error al cargar aulas') + '</td></tr>';
    if (window.lucide) lucide.createIcons();
  }
}
