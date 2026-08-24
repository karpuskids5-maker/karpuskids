import { ensureRole, supabase, initOneSignal, sendPush, emitEvent } from '/js/shared/supabase.js';
import { showNotifyFeedback } from '/js/shared/notify-feedback.js';
import { AppState } from './state.js';
import { Helpers } from '/js/shared/helpers.js';
import { BadgeSystem } from '/js/shared/badges.js';
import { ImageLoader } from '/js/shared/image-loader.js';
import { QueryCache } from '/js/shared/query-cache.js';
import { RealtimeManager } from '/js/shared/realtime-manager.js';
import { UIPremium } from '/js/shared/ui-premium.js';
import { FileManager } from '/js/shared/FileManager.js';
import { CarnetsModule } from '/js/shared/carnets.module.js';
import { ScrollModule } from '/js/shared/scroll.module.js';
import { ChatView, ChatListState } from '/js/shared/chat-view.js';
import {
  buildThreadHTML, prependThreadHTML, appendLiveMessage, waBubbleHTML,
  formatDayLabel, chatListItemHTML, reactionChipsHTML
} from '/js/shared/chat-render.js';
import {
  bindMessageActions, closeMessageActions,
  showReplyBar, hideReplyBar, openForwardModal, markRowDeleted
} from '/js/shared/chat-actions.js';
import SchoolEngine from '/js/shared/school-engine.js';
import { GradesModule } from '../directora/grades.module.js';
import { BackNavigation } from '/js/shared/back-navigation.js';

let _chatModule = null;
async function getChatModule() {
  if (!_chatModule) _chatModule = (await import('/js/shared/chat.js')).ChatModule;
  return _chatModule;
}

// Metadatos de contactos del chat del asistente: { id: { name, role, avatar_url } }
const _assistantContacts = {};
let _assistantReply = null; // respuesta citada pendiente

/**
 * Restaura la vista inicial del chat (placeholder "Selecciona un contacto")
 */
function closeAssistantConversationUI() {
  AppState.set('activeChatUserId', null);
  AppState.set('activeConversationId', null);
  closeMessageActions();
  hideReplyBar();
  _assistantReply = null;
  const header = document.getElementById('chatActiveHeader');
  const inputArea = document.getElementById('chatInputArea');
  const container = document.getElementById('chatMessagesContainer');
  if (header) header.style.display = 'none';
  if (inputArea) { inputArea.classList.add('hidden'); inputArea.style.removeProperty('display'); }
  if (container) {
    container.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-40 py-12">
        <i data-lucide="messages-square" class="w-14 h-14 mb-3"></i>
        <p class="font-medium text-sm">Selecciona un contacto</p>
      </div>`;
    if (window.lucide) lucide.createIcons();
  }
  document.getElementById('chatTypingIndicator')?.classList.add('hidden');
}

/**
 * Abre la vista conversación (móvil: lista ↔ chat; escritorio: deselección)
 * con integración de historial — el botón atrás NO recarga la página
 */
function openAssistantChatView() {
  ChatView.open({
    apply: () => {
      const lp = document.getElementById('chatListPanel');
      const cp = document.getElementById('chatConversationPanel');
      if (lp) lp.style.display = 'none';
      if (cp) cp.style.display = 'flex';
    },
    revert: () => {
      const lp = document.getElementById('chatListPanel');
      const cp = document.getElementById('chatConversationPanel');
      if (cp) cp.style.display = '';
      if (lp) lp.style.display = '';
      closeAssistantConversationUI();
    }
  });
}

// Definir objeto App globalmente para evitar ReferenceError en onclicks del HTML
// Global close modal fallback � always available even before openNewPostModal is called
window._closeAsistenteModal = () => {
  const gc = document.getElementById('globalModalContainer');
  if (gc) { gc.style.display = 'none'; gc.innerHTML = ''; }
};

// Cierre de modales estáticos al hacer clic fuera del contenido
document.addEventListener('click', (e) => {
  const staticModals = ['roomModal', 'roomStudentsModal'];
  for (const id of staticModals) {
    const modal = document.getElementById(id);
    if (modal && e.target === modal && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      break;
    }
  }
});

window.openGlobalModal = (html, wide = false) => {
  const gc = document.getElementById('globalModalContainer');
  if (!gc) return;
  const maxW = wide ? 'max-w-4xl' : 'max-w-2xl';
  gc.innerHTML = `
    <div id="globalModalInner" class="bg-white rounded-3xl shadow-2xl w-full ${maxW} max-h-[92vh] overflow-y-auto mx-3 my-4 relative animate-scaleIn">
      <button onclick="window._closeAsistenteModal()" class="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-all z-[110]">
        <i data-lucide="x" class="w-6 h-6"></i>
      </button>
      ${html}
    </div>`;
  gc.style.cssText = 'display:flex;align-items:flex-start;justify-content:center;padding-top:4vh;position:fixed;inset:0;background:rgba(15,23,42,0.75);z-index:9999;overflow-y:auto;';
  
  gc.onmousedown = (e) => {
    if (e.target === gc) window._closeAsistenteModal();
  };

  if (window.lucide) lucide.createIcons();
};

window.App = {
  payments: {
    markPaid:      (id)  => import('./payments.js').then(m => m.PaymentsModule.markPaid(id)),
    rejectPayment: (id, notes)  => import('./payments.js').then(m => m.PaymentsModule.rejectPayment(id, notes)),
    deletePayment: (id)  => import('./payments.js').then(m => m.PaymentsModule.deletePayment(id)),
    openModal:     (sid) => import('./payments.js').then(m => m.PaymentsModule.openPaymentModal(sid)),
    closeModal:    ()    => import('./payments.js').then(m => m.PaymentsModule.closeModal()),
    filterBy:      (s)   => import('./payments.js').then(m => m.PaymentsModule.filterBy(s)),
    waiveMora:     (id)  => import('./payments.js').then(m => m.PaymentsModule.waiveMora(id)),
    _confirmApproval: (id) => import('./payments.js').then(m => m.PaymentsModule._confirmApproval(id)),
    sendPaymentReminder: (id, ch) => import('./payments.js').then(m => m.PaymentsModule.sendPaymentReminder(id, ch)),
    sendDigitalReceipt:  (id, ch) => import('./payments.js').then(m => m.PaymentsModule.sendDigitalReceipt(id, ch)),
  },
  students: {
    init: () => import('./modules/students.js').then(m => m.StudentsModule.init()),
    loadStudents: () => import('./modules/students.js').then(m => m.StudentsModule.loadStudents?.()),
    openModal: (id) => import('./modules/students.js').then(m => m.StudentsModule.openModal(id)),
    _deleteStudent: (id, name) => import('./modules/students.js').then(m => m.StudentsModule._deleteStudent(id, name)),
  },
  inscripciones: {
    init: () => import('../directora/inscripciones.module.js').then(m => m.InscripcionesModule.init()),
    openRecord: (id) => import('../directora/inscripciones.module.js').then(m => m.InscripcionesModule.openRecord(id)),
    reject: (id) => import('../directora/inscripciones.module.js').then(m => m.InscripcionesModule.reject(id)),
  },
  rooms: {
    init: () => import('./modules/rooms.js').then(m => m.RoomsModule.init()),
    loadRooms: () => import('./modules/rooms.js').then(m => m.RoomsModule.loadRooms?.()),
    openModal: (id) => import('./modules/rooms.js').then(m => m.RoomsModule.openModal(id)),
  },
  teachers: {
    init: () => import('./teachers.js').then(m => m.TeachersModule.init()),
    loadTeachers: () => import('./teachers.js').then(m => m.TeachersModule.loadTeachers?.()),
    openModal:     (id)         => import('./teachers.js').then(m => m.TeachersModule.openModal(id)),
    deleteTeacher: (id, name)   => import('./teachers.js').then(m => m.TeachersModule.deleteTeacher(id, name))
  },
  carnets: CarnetsModule,
  grades: GradesModule,
  ui: { closeModal: () => window._closeAsistenteModal() },
  access: {
    init: () => import('./access.js').then(m => m.AccessModule.init()),
    closeScanner:  ()         => import('./access.js').then(m => m.AccessModule.closeScanner()),
    setPunchType:  (type)     => import('./access.js').then(m => m.AccessModule.setPunchType(type)),
    stopScanner:   ()         => import('./access.js').then(m => m.AccessModule.stopScanner()),
    toggleExteriorMode: ()    => import('./access.js').then(m => m.AccessModule.toggleExteriorMode()),
  },
  dashboard: {
    init: () => import('./modules/dashboard.js').then(m => m.DashboardModule.init()),
  },
};

/**
 * Inicializaci�n principal del Panel de Asistente
 */
document.addEventListener('DOMContentLoaded', async () => {
  
  // 1. Verificar Rol
  const auth = await ensureRole(['asistente', 'admin', 'directora']);
  if (!auth) return;
  
  AppState.set('user', auth.user);
  AppState.set('profile', auth.profile);

  // 🔔 Banner global de mensajes entrantes (visible en todo el panel)
  import('/js/shared/incoming-banner.js').then(({ IncomingBanner }) => {
    IncomingBanner.init({
      uid: auth.user.id,
      isActiveChat: (msg) => {
        const activeConv = AppState.get('activeConversationId');
        return !!activeConv && msg?.conversation_id === activeConv;
      },
      onOpen: (senderId) => {
        window.goToSection?.('chat');
        setTimeout(() => window.selectAssistantChat?.(senderId), 400);
      }
    });
  }).catch(() => {});

  // ?? Sistema de badges por secci�n
  BadgeSystem.init(auth.user.id);

  // ?? Sincronización en vivo: cuando cambia un estudiante, refrescar la
  // tabla de estudiantes y la sección de aulas sin recargar la página.
  window.addEventListener('karpus:students-changed', () => {
    import('./modules/students.js').then(m => m.StudentsModule.loadStudents()).catch(() => {});
    import('./modules/rooms.js').then(m => m.RoomsModule.init()).catch(() => {});
  });

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
  import('/js/shared/wall.js').then(m => m.WallModule.init('muroPostsContainer', { accentColor: 'teal', likeColor: 'emerald' }, AppState)).catch(() => {});
  
  // ? FIX OneSignal: Solo inicializar en el dominio correcto para evitar errores de consola
  if (window.location.hostname === 'karpuskids.com' || window.location.hostname === 'localhost') {
    try { initOneSignal(auth.user); } catch(_) { /* silencioso */ }
  } else {
  }
  
  initNavigation(); // Esto cargar� el dashboard y configurar� los listeners

  // Asignar funciones internas al objeto global App
  Object.assign(window.App, {
    _confirmApproval: (id) => import('./payments.js').then(m => m.PaymentsModule._confirmApproval(id)),
    _rejectPayment: (id) => import('./payments.js').then(m => m.PaymentsModule.rejectPayment(id)),
    _deletePayment: (id) => import('./payments.js').then(m => m.PaymentsModule.deletePayment(id)),
    _registerPayment: (sid) => import('./payments.js').then(m => m.PaymentsModule.openPaymentModal(sid)),
    _openTeacherModal: (id) => import('./teachers.js').then(m => m.TeachersModule.openModal(id)),
    _toggleCommentSection: (id) => import('/js/shared/wall.js').then(m => m.WallModule.toggleCommentSection(id)),
    _deleteComment: (cid, pid) => import('/js/shared/wall.js').then(m => m.WallModule.deleteComment(cid, pid)),
    _sendComment: (pid) => import('/js/shared/wall.js').then(m => m.WallModule.sendComment(pid)),
    _toggleLike: (pid) => import('/js/shared/wall.js').then(m => m.WallModule.toggleLike(pid)),
    selectChatContact: (uid, name, role) => selectAssistantChat(uid, name, role),
    _openStudentModal: (id) => import('./modules/students.js').then(m => m.StudentsModule.openModal(id)),
    _deleteStudent: (id, name) => import('./modules/students.js').then(m => m.StudentsModule._deleteStudent(id, name)),
    _genMatricula: () => window._genMatricula?.(),
    _openRoomModal: (id) => import('./modules/rooms.js').then(m => m.RoomsModule.openModal(id)),
    openNewPostModal,
    submitNewPost
  });

  // Exponer WallModule globalmente
  window.WallModule = {
    init: (...a) => import('/js/shared/wall.js').then(m => m.WallModule.init(...a)),
    loadPosts: (...a) => import('/js/shared/wall.js').then(m => m.WallModule.loadPosts(...a)),
    destroy: (...a) => import('/js/shared/wall.js').then(m => m.WallModule.destroy(...a)),
    toggleCommentSection: (...a) => import('/js/shared/wall.js').then(m => m.WallModule.toggleCommentSection(...a)),
    sendComment: (...a) => import('/js/shared/wall.js').then(m => m.WallModule.sendComment(...a)),
    deletePost: (...a) => import('/js/shared/wall.js').then(m => m.WallModule.deletePost(...a)),
    toggleLike: (...a) => import('/js/shared/wall.js').then(m => m.WallModule.toggleLike(...a)),
    openNewPostModal: (...a) => import('/js/shared/wall.js').then(m => m.WallModule.openNewPostModal(...a)),
    deleteComment: (...a) => import('/js/shared/wall.js').then(m => m.WallModule.deleteComment(...a)),
  };
  window.openTeacherModal = (id) => import('./teachers.js').then(m => m.TeachersModule.openModal(id));
  window.openNewPostModal = openNewPostModal;
  window.submitNewPost = submitNewPost;

  // School Engine init
  try {
    await SchoolEngine.init({ forceRefresh: true });
    AppState.set('schoolYear', SchoolEngine.getSchoolYear());
    AppState.set('activePeriod', SchoolEngine.getActivePeriod());
    AppState.set('periods', SchoolEngine.getAllPeriods());
  } catch(_) {}
  window.App.schoolYear = {
    getSchoolYear: () => SchoolEngine.getSchoolYear(),
    getActivePeriod: () => SchoolEngine.getActivePeriod(),
    getAllPeriods: () => SchoolEngine.getAllPeriods(),
    hasActiveYear: () => SchoolEngine.hasActiveYear(),
  };

  // Mantener compatibilidad temporal para onclick en HTML que no use App.
  Object.assign(window, window.App);

  if (window.lucide) lucide.createIcons();
});

/**
 * 🚀 MURO ESCOLAR - Crear Publicación
 */
async function openNewPostModal() {
  const html = `
      <div class="modal-header bg-gradient-to-r from-teal-600 to-emerald-600 text-white p-6 rounded-t-3xl flex justify-between items-center">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl shadow-inner">📝</div>
          <div>
            <h3 class="text-xl font-black">Crear Publicación</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Muro Escolar</p>
          </div>
        </div>
      </div>
      
      <div class="p-8 bg-white space-y-6">
        <div>
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 ml-1">Contenido del Mensaje</label>
          <textarea id="postContent" rows="4" class="w-full px-4 py-3 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-teal-100 focus:border-teal-400 bg-slate-50/50 transition-all text-sm font-medium resize-none" placeholder="¿Qué quieres compartir hoy con los padres?"></textarea>
        </div>

        <div>
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 ml-1">Aula (Opcional)</label>
          <select id="postClassroom" class="w-full px-4 py-3 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-teal-100 focus:border-teal-400 bg-slate-50/50 transition-all text-sm font-medium appearance-none">
            <option value="">General (Todos)</option>
          </select>
        </div>

        <div class="flex flex-col md:flex-row gap-6 items-center bg-slate-50 p-6 rounded-3xl border-2 border-slate-100">
          <div class="relative group cursor-pointer">
            <div id="postMediaPreview" class="w-24 h-24 rounded-[2rem] bg-white border-4 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 group-hover:border-teal-400 group-hover:bg-teal-50 transition-all overflow-hidden">
              <i data-lucide="camera" class="w-8 h-8 mb-1"></i>
              <span class="text-[9px] font-black uppercase">Media</span>
            </div>
            <input type="file" id="postFile" class="absolute inset-0 opacity-0 cursor-pointer" accept="image/*,video/*">
          </div>
          <div class="flex-1">
            <h4 class="text-sm font-black text-slate-800 mb-1">📸 MULTIMEDIA</h4>
            <p class="text-xs text-slate-500">Sube una imagen o video para acompañar tu publicación. Máximo 10MB.</p>
          </div>
        </div>
      </div>

      <div class="p-6 border-t bg-slate-50 rounded-b-3xl flex justify-end gap-3">
        <button onclick="window._closeAsistenteModal()" class="px-6 py-3 border-2 border-slate-200 text-slate-700 font-bold text-sm rounded-2xl hover:bg-slate-100 transition-all">Cancelar</button>
        <button id="btnSubmitPost" onclick="window.submitNewPost()" class="px-6 py-3 bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-bold text-sm rounded-2xl hover:from-teal-700 hover:to-emerald-700 transition-all shadow-lg shadow-teal-200">Publicar</button>
      </div>
  `;
  window.openGlobalModal(html);

  // Load classrooms for the select
  try {
    const { data: classrooms } = await supabase.from('classrooms').select('id, name').order('name');
    const select = document.getElementById('postClassroom');
    if (select && classrooms) {
      select.innerHTML = '<option value="">General (Todos)</option>';
      classrooms.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        select.appendChild(opt);
      });
    }
  } catch (_) { /* silencioso */ }

  if (window.lucide) lucide.createIcons();
}

async function submitNewPost() {
  const content = document.getElementById('postContent').value.trim();
  const fileInput = document.getElementById('postFile');
  const file = fileInput?.files[0];
  const btn = document.getElementById('btnSubmitPost');
  const classroomSelect = document.getElementById('postClassroom');

  if (!content && !file) return Helpers.toast('Escribe algo o sube un archivo', 'warning');

  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin mx-auto"></i>';
  if(window.lucide) window.lucide.createIcons();

  try {
    let mediaUrl = null;
    let mediaType = null;

    if (file) {
      const ext = file.type.startsWith('video') ? file.name.split('.').pop() : 'webp';
      const path = `posts/${Date.now()}_${Math.random().toString(36).substr(2,9)}.${ext}`;
      
      const publicUrl = await ImageLoader.uploadToStorage(
        file,
        'classroom_media',
        path,
        { maxWidth: 1200, maxHeight: 1200, quality: 0.82, maxSizeKB: 400 }
      );
      mediaUrl = publicUrl;
      mediaType = file.type.startsWith('video') ? 'video' : 'image';
    }

    const user = AppState.get('user');
    if (!user) throw new Error('No hay sesión activa');

    const insertPayload = {
      teacher_id:   user.id,
      content:      content,
      media_url:    mediaUrl,
      media_type:   mediaType,
      classroom_id: classroomSelect?.value || null
    };

    const { error } = await supabase.from('posts').insert(insertPayload);

    if (error) throw error;
    Helpers.toast('Publicado correctamente', 'success');

    // 🔔 Notificar a padres: push + email — audiencia: aula o GENERAL
    try {
      const audienceClassroom = classroomSelect?.value || null;
      let q = supabase.from('students').select('id, parent_id');
      if (audienceClassroom) q = q.eq('classroom_id', audienceClassroom);
      const { data: audience } = await q;
      const list = audience || [];
      const preview = content.length > 80 ? content.substring(0, 80) + '…' : content;
      const parentIds = [...new Set(list.map(s => s.parent_id).filter(Boolean))];

      const results = await Promise.allSettled(parentIds.map(pid => sendPush({
        user_id: pid,
        title: '📢 Nueva publicación — Karpus Kids',
        message: preview,
        type: 'post',
        link: '/panel_padres.html#feed'
      })));
      const sent = results.filter(r => r.status === 'fulfilled' && r.value?.ok !== false).length;

      const profile = (await supabase.from('profiles').select('name').eq('id', user.id).maybeSingle()).data;
      emitEvent('post.created', {
        classroom_id: audienceClassroom,
        teacher_name: profile?.name || 'Asistente',
        content_preview: preview
      }).catch(() => {});

      if (sent > 0) showNotifyFeedback({ sent, type: 'post', label: audienceClassroom ? 'Muro del aula' : 'Muro general' });
    } catch (_) { /* la publicación ya está guardada; notificación best-effort */ }

    window._closeAsistenteModal();
  } catch (err) {
    Helpers.toast('Error al publicar: ' + (err.message || ''), 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'PUBLICAR';
      if(window.lucide) window.lucide.createIcons();
    }
  }
}

/**
 * Navegaci�n lateral
 */
const loadedSections = new Set();

function initNavigation() {
  const navLinks = document.querySelectorAll('[data-section]');
  const sections = document.querySelectorAll('section[id]');

  const showSection = async (target, opts = {}) => {
    const pushHistory = opts.pushHistory !== false;
    Helpers.vibrate?.('light');

    // ✅ LIMPIEZA DE REALTIME: Eliminar canales al cambiar de sección
    RealtimeManager.unsubscribeAll(['notifications']);

    // Desuscribir muro al salir (ahorro de recursos Realtime)
    const prevSection = AppState.get('currentSection');
    if (prevSection === 'muro' && target !== 'muro') {
      import('/js/shared/wall.js').then(m => m.WallModule.destroy?.()).catch(() => {});
      // Permitir re-inicializar el muro la próxima vez
      loadedSections.delete('muro');
    }

    // 1. Limpiar clases activas en botones de navegación�n
    navLinks.forEach(l => {
      l.classList.remove('bg-white/20', 'bg-teal-50', 'text-teal-600', 'active');
      // Si el bot�n est� en el sidebar y no es el activo, restaurar su estilo original de texto blanco
      if (!l.classList.contains('active')) {
        l.classList.add('text-white');
      }
    });

    const activeLink = document.querySelector(`[data-section="${target}"]`);
    if (activeLink) {
      activeLink.classList.add('bg-white/20', 'active');
      activeLink.classList.remove('text-white');
    }

    // Actualizar Bottom Nav
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.section === target);
    });
    
    // 2. Manejo de visibilidad de secciones (ESCENARIO)
    // Lógica de salida de sección (Limpieza)
    if (prevSection === 'accesos' && target !== 'accesos') {
      try {
        import('./access.js').then(m => m.AccessModule?.stopScanner?.()).catch(() => {});
      } catch (_) {}
    }

    sections.forEach(s => {
      s.classList.add('hidden');
      s.classList.remove('active');
    });

    const sectionEl = document.getElementById(target);
    if (sectionEl) {
      sectionEl.classList.remove('hidden');
      sectionEl.classList.add('active'); 
      UIPremium.applySectionTransition(target);
    } else {

    }
    
    AppState.set('currentSection', target);

    // ✅ HISTORIAL (PWA): ATRÁS físico → regresa a la sección anterior sin recargar
    if (pushHistory && prevSection && prevSection !== target) {
      BackNavigation.push(() => showSection(prevSection, { pushHistory: false }), { kind: 'section' });
    }

    // ?? Marcar badge como le�do al entrar a la secci�n
    BadgeSystem.mark(target);

    // 3. Cerrar sidebar en m�vil autom�ticamente al cambiar de secci�n
    const sidebar = document.getElementById('sidebar');
    if (sidebar && window.innerWidth < 768) {
      sidebar.classList.remove('mobile-visible');
      const ov = document.getElementById('sidebarOverlay');
      if (ov) ov.style.display = 'none';
    }

    // ? --- L�GICA DE CARGA PEREZOSA (LAZY LOADING) ---
    if (!loadedSections.has(target)) {
      try {
        switch (target) {
          case 'pagos':
            await import('./payments.js').then(m => m.PaymentsModule.init());
            import('../shared/payment-queue.js').then(m =>
              m.PaymentQueue.init('payment-queue-container')
            ).catch(() => {});
            break;
          case 'accesos':
            await import('./access.js').then(m => m.AccessModule.init());
            document.getElementById('btnExteriorMode')?.addEventListener('click', () => import('./access.js').then(m => m.AccessModule.toggleExteriorMode()));
            break;
          case 'maestros':
            await import('./teachers.js').then(m => m.TeachersModule.init());
            break;
          case 'estudiantes':
            await import('./modules/students.js').then(m => m.StudentsModule.init());
            break;
          case 'inscripciones':
            await import('../directora/inscripciones.module.js').then(m => m.InscripcionesModule.init());
            break;
          case 'aulas':
            await import('./modules/rooms.js').then(m => m.RoomsModule.init());
            break;
          case 'muro':
            import('/js/shared/wall.js').then(m => m.WallModule.init('muroPostsContainer', { 
              accentColor: 'teal', 
              likeColor: 'emerald' 
            }, AppState));
            break;
          case 'staff-permits':
            import('../directora/permits.module.js').then(m => {
              window.App.permits = m.PermitsModule;
              m.PermitsModule.init();
            });
            break;
          case 'chat':
            // Al entrar: lista visible, conversación cerrada (sin recargar)
            document.getElementById('chatListPanel')?.style.setProperty('display', '');
            document.getElementById('chatConversationPanel')?.style.setProperty('display', '');
            ChatView.reset();
            await initAssistantChat();
            break;
          case 'videocall': {
            const vcProfile = AppState.get('profile') || {};
            import('../shared/videocall-ui.js').then(({ VideoCallUI }) => {
              VideoCallUI.renderSection('videocall-asistente-section', {
                role: 'asistente',
                userName: vcProfile?.name || 'Asistente',
                classroomId: null
              });
            }).catch(() => {});
            break;
          }
          case 'calificaciones':
            await import('../directora/grades.module.js').then(m => m.GradesModule.init());
            break;
          case 'tienda':
            await import('../shared/store.js').then(m => m.initStoreAsistente('store-asistente-container'));
            break;
          case 'perfil':
            initProfile();
            import('../shared/notify-permission.js').then(m => m.NotifyPermission.requestIfNeeded());
            break;
          case 'calendario':
            await import('../shared/calendar-view.js').then(({ CalendarView }) => {
              const year = SchoolEngine.getSchoolYear();
              const periods = SchoolEngine.getAllPeriods();
              const container = document.getElementById('calendarSectionContainer');
              if (container) {
                container.innerHTML = '<div class="bg-white rounded-3xl border border-slate-100 shadow-sm p-6"><div id="calendarTimelineAssistant"></div></div>';
                CalendarView.renderPeriodTimeline('calendarTimelineAssistant', periods, year);
              }
            });
            break;
        }
        loadedSections.add(target);
      } catch (err) {

        Helpers.toast(`Error al cargar ${target}`, 'error');
      }
    } else {
      // Re-cargar datos frescos al volver a una sección ya visitada
      switch (target) {
        case 'maestros':   import('./teachers.js').then(m => m.TeachersModule.loadTeachers?.()); break;
        case 'estudiantes': import('./modules/students.js').then(m => m.StudentsModule.loadStudents?.()); break;
        case 'inscripciones': import('../directora/inscripciones.module.js').then(m => m.InscripcionesModule.init()); break;
        case 'aulas':      import('./modules/rooms.js').then(m => m.RoomsModule.loadRooms?.()); break;
        case 'calificaciones': import('../directora/grades.module.js').then(m => m.GradesModule.init()); break;
        case 'tienda':      import('../shared/store.js').then(m => m.initStoreAsistente('store-asistente-container')); break;
        case 'pagos':      import('./payments.js').then(m => m.PaymentsModule.loadPayments?.()); break;
        case 'chat':
          document.getElementById('chatListPanel')?.style.setProperty('display', '');
          document.getElementById('chatConversationPanel')?.style.setProperty('display', '');
          ChatView.reset();
          await initAssistantChat();
          break;
        case 'calendario':
          import('../shared/calendar-view.js').then(({ CalendarView }) => {
            SchoolEngine.refresh().then(() => {
              const year = SchoolEngine.getSchoolYear();
              const periods = SchoolEngine.getAllPeriods();
              const container = document.getElementById('calendarTimelineAssistant');
              if (container) CalendarView.renderPeriodTimeline('calendarTimelineAssistant', periods, year);
            });
          });
          break;
      }
    }
  };

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateFromUser(link.dataset.section);
    });
  });

  /**
   * ✅ Navegación iniciada por el usuario: colapsa capas de historial
   * (conversaciones abiertas, sección previa) y trunca el historial hacia
   * adelante antes de apilar la nueva sección → el botón ATRÁS del móvil
   * nunca "muere" ni saca al usuario de la app inesperadamente.
   */
  async function navigateFromUser(target) {
    await BackNavigation.reset();
    await showSection(target);
  }
  window.App.navigateTo = navigateFromUser;
  window.goToSection = navigateFromUser;

  // Carga inicial del dashboard
  BackNavigation.init();
  import('./modules/dashboard.js').then(m => m.DashboardModule.init().then(() => loadedSections.add('dashboard')));
  showSection('dashboard', { pushHistory: false });

  // -- Hamburger m�vil ------------------------------------------------------
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

  // Cerrar sidebar al hacer click en el main (m�vil)
  document.getElementById('layoutShell')?.addEventListener('click', () => {
    if (window.innerWidth < 768 && sidebar?.classList.contains('mobile-visible')) {
      _closeSidebar();
    }
  });

  // -- Colapsar sidebar desktop ---------------------------------------------
  const toggleBtn   = document.getElementById('toggleSidebar');
  const wrapper     = sidebar?.closest('.app-content-wrapper') || document.querySelector('.app-content-wrapper');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      wrapper?.classList.toggle('sidebar-collapsed');
    });
  }

  // -- Submenús colapsables + persistencia (localStorage) --------------------
  const SUBMENU_KEY = 'karpus_asistente_submenu_state';
  try {
    const saved = JSON.parse(localStorage.getItem(SUBMENU_KEY) || '{}');
    document.querySelectorAll('.kk-submenu-toggle').forEach(toggle => {
      const key = toggle.dataset.submenu;
      const items = document.getElementById('submenu-' + key);
      if (!items) return;

      const isCollapsed = saved[key] === false;
      if (isCollapsed) {
        items.classList.add('collapsed');
        toggle.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      } else {
        items.classList.remove('collapsed');
        toggle.classList.add('active');
        toggle.setAttribute('aria-expanded', 'true');
      }

      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const willCollapse = !items.classList.contains('collapsed');
        items.classList.toggle('collapsed', willCollapse);
        toggle.classList.toggle('active', !willCollapse);
        toggle.setAttribute('aria-expanded', String(!willCollapse));
        try {
          const cur = JSON.parse(localStorage.getItem(SUBMENU_KEY) || '{}');
          cur[key] = !willCollapse;
          localStorage.setItem(SUBMENU_KEY, JSON.stringify(cur));
        } catch (_) {}
      });
    });
  } catch (_) {}

  // -- Persistencia de filtros: se usa FiltersStore de state.js (window._kkFiltersStore)
  //    ya expuesto al cargar el módulo — NO redefinir aquí para mantener
  //    una única fuente de verdad y prefijos consistentes en localStorage.
}



/**
 * Perfil del Asistente
 */
async function initProfile() {
  const profile = AppState.get('profile');
  if (!profile) return;

  // Fetch fresh profile with access_code from DB
  const { data: freshProfile } = await supabase
    .from('profiles')
    .select('id, name, email, phone, bio, avatar_url, access_code, role')
    .eq('id', profile.id)
    .maybeSingle();
  const p = freshProfile || profile;

  const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };
  setVal('profileName', p.name);
  setVal('profilePhone', p.phone);
  setVal('profileEmail', p.email);
  setVal('profileBio', p.bio || '');

  // Helper to set avatar
  const setProfileAvatar = (avatarUrl, name) => {
    const avatarEl = document.getElementById('profileAvatarPreview');
    if (!avatarEl) return;
    const initial = (name || 'A').charAt(0).toUpperCase();
    if (avatarUrl) {
      avatarEl.innerHTML = `<img src="${avatarUrl}" class="w-full h-full object-cover rounded-full">`;
    } else {
      avatarEl.innerHTML = initial;
    }
  };
  
  // Avatar
  const avatarInput   = document.getElementById('profileAvatarInput');
  setProfileAvatar(p.avatar_url, p.name);

  if (avatarInput) {
    avatarInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          // Validar usando FileManager
          const validation = FileManager.validateFile(file, FileManager.PRESETS.PROFILE_PHOTO);
          if (!validation.valid) {
            Helpers.toast(validation.errors[0], 'warning');
            avatarInput.value = '';
            return;
          }
          
          // Obtener vista previa
          const previewUrl = await FileManager.getPreviewURL(file);
          const avatarEl = document.getElementById('profileAvatarPreview');
          avatarEl.innerHTML = `<img src="${previewUrl}" class="w-full h-full object-cover rounded-full">`;
          
        } catch (error) {
          Helpers.toast('Error al procesar la imagen', 'error');
          Helpers.safeLog('error', 'Profile avatar error:', error);
          avatarInput.value = '';
        }
      }
    };
  }

  // -- QR de Acceso Personal --------------------------------------------------
  const code = p.access_code || (p.notes?.startsWith?.('TEA-') || p.notes?.startsWith?.('ASI-') ? p.notes : null);
  const codeInput = document.getElementById('profileAccessCode');
  if (codeInput && code) codeInput.value = code;

  const _renderProfileQR = async (c) => {
    const container = document.getElementById('profileQrContainer');
    if (!container || !c) return;
    container.innerHTML = '<div class="flex items-center justify-center p-4"><div class="w-6 h-6 border-2 border-teal-400 border-t-transparent rounded-full animate-spin"></div></div>';
    try {
      const qrUrl = await Helpers.generateQRWithLogo(
        JSON.stringify({ matricula: c, name: p.name, type: 'karpus-staff', v: 1 }),
        { width: 130, colorDark: '#0d9488' }
      );
      if (qrUrl) {
        container.innerHTML = '';
        const qi = document.createElement('img');
        qi.src = qrUrl;
        qi.style.cssText = 'width:130px;height:130px;border-radius:1.5mm;display:block;margin:auto;';
        container.appendChild(qi);
      } else {
        container.innerHTML = '<p class="text-[9px] text-red-500 font-bold text-center">Error al generar QR</p>';
      }
    } catch (e) {
      container.innerHTML = '<p class="text-[9px] text-red-500 font-bold text-center">Error al generar QR</p>';
    }
  };

  if (code) setTimeout(() => _renderProfileQR(code), 300);

  window._genProfileAccessCode = async () => {
    const prefix = p.role === 'directora' ? 'DIR' : p.role === 'asistente' ? 'ASI' : 'TEA';
    const newCode = `${prefix}-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    if (codeInput) codeInput.value = newCode;
    // Save immediately
    const { error } = await supabase.from('profiles').update({ access_code: newCode }).eq('id', p.id);
    if (!error) {
      Helpers.toast('Código de acceso guardado', 'success');
      AppState.set('profile', { ...AppState.get('profile'), access_code: newCode });
      _renderProfileQR(newCode);
    } else {
      Helpers.toast('Error al guardar código: ' + error.message, 'error');
    }
  };

  window._printProfileQR = () => {
    const c = document.getElementById('profileAccessCode')?.value?.trim();
    const container = document.getElementById('profileQrContainer');
    const img = container?.querySelector('img')?.src;
    if (!img || !c) { Helpers.toast('Genera el QR primero', 'warning'); return; }
    const roleLabel = p.role === 'directora' ? 'Directora' : p.role === 'asistente' ? 'Asistente' : 'Maestra';
    const win = window.open('', '_blank');
    win.document.write(Helpers.getStaffCarnetTemplate(p.name, roleLabel, p.phone || '', { accessCode: c, qrImg: img }));
    win.document.close();
  };

  window._printStaffCredential = () => {
    const roleLabel = p.role === 'directora' ? 'Directora' : p.role === 'asistente' ? 'Asistente' : 'Maestra';
    const win = window.open('', '_blank');
    win.document.write(Helpers.getStaffCarnetTemplate(p.name, roleLabel, p.phone || '', { accessCode: p.access_code }));
    win.document.close();
  };

  // -- Form submit ------------------------------------------------------------
  const form = document.getElementById('profileForm');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
      try {
        const updates = {
          name:  document.getElementById('profileName')?.value?.trim(),
          phone: document.getElementById('profilePhone')?.value?.trim(),
          bio:   document.getElementById('profileBio')?.value?.trim()
        };
        const file = avatarInput?.files[0];
        if (file) {
          // Usar FileManager para procesar y subir con compresión
          const result = await FileManager.processAndUpload({
            file,
            supabase,
            bucket: 'karpus-uploads',
            pathPrefix: 'avatars',
            options: FileManager.PRESETS.PROFILE_PHOTO,
            onProgress: null // No need for progress in this context
          });
          
          if (!result.success) {
            throw new Error(result.error);
          }
          
          updates.avatar_url = result.publicUrl;
          const sidebarAvatar = document.getElementById('sidebarAvatar');
          if (sidebarAvatar) sidebarAvatar.src = result.publicUrl;
          const avatarEl = document.getElementById('profileAvatarPreview');
          if (avatarEl) avatarEl.innerHTML = `<img src="${result.publicUrl}" class="w-full h-full object-cover rounded-full">`;
        }
        const { error } = await supabase.from('profiles').update(updates).eq('id', p.id);
        if (error) throw error;
        Helpers.toast('Perfil actualizado correctamente', 'success');
        AppState.set('profile', { ...AppState.get('profile'), ...updates });
        const nameDisplay = document.getElementById('profileNameDisplay');
        const sidebarName = document.getElementById('sidebarUserName');
        if (nameDisplay) nameDisplay.textContent = updates.name;
        if (sidebarName)  sidebarName.textContent  = updates.name;
      } catch (err) {
        Helpers.toast('Error al guardar perfil: ' + (err.message || ''), 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar Cambios'; }
      }
    };
  }

  if (window.lucide) lucide.createIcons();
}

// --- Funciones Globales de Ventana ---
window.selectAssistantChat = async (userId, name, role, avatarUrl = null) => {
  // ✅ Resolver metadatos del contacto desde caché local (evita strings complejos en onclick)
  const meta = _assistantContacts[userId] || {};
  try { name = decodeURIComponent(name || meta.name || ''); } catch (_) { name = meta.name || name || ''; }
  role = role || meta.role || '';
  avatarUrl = (avatarUrl && avatarUrl !== 'null') ? avatarUrl : (meta.avatar_url || '');

  // ✅ Fallback: si el contacto no está en caché (apertura desde banner), buscar perfil
  if (!name) {
    try {
      const { data: p } = await supabase.from('profiles')
        .select('name, role, avatar_url').eq('id', userId).maybeSingle();
      if (p) { name = p.name || 'Contacto'; role = p.role || role; avatarUrl = avatarUrl || p.avatar_url || ''; }
    } catch (_) {}
  }

  // ✅ VISTA MÓVIL/DESKTOP + HISTORIAL (botón atrás sin recargar)
  openAssistantChatView();

  // ✅ BOTÓN ATRÁS — móvil y escritorio, una sola vez
  const backBtn = document.getElementById('chatBackBtn');
  if (backBtn && !backBtn._kkBound) {
    backBtn._kkBound = true;
    backBtn.addEventListener('click', () => ChatView.back());
  }

  // ✅ Header visible al entrar a una conversación (contiene el botón volver)
  document.getElementById('chatActiveHeader')?.style.setProperty('display', 'flex');

  // ✅ Limpiar badge de no leídos del contacto abierto
  document.querySelector(`#chatContactsList [data-user-id="${userId}"] .kk-unread-badge`)?.remove();

  // ✅ UI Header
  const nameEl = document.getElementById('chatActiveName');
  const metaEl = document.getElementById('chatActiveMeta');
  const avatarEl = document.getElementById('chatActiveAvatar');
  const inputArea = document.getElementById('chatInputArea');

  // ✅ ENRIQUECIMIENTO DE CONTEXTO: Título con nombre del Estudiante (solo activos)
  const { data: student } = await supabase
    .from('students')
    .select('id, name')
    .eq('parent_id', userId)
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('name')
    .limit(1)
    .maybeSingle();
  if (nameEl) nameEl.textContent = student ? `Estudiante: ${student.name}` : name;
  if (metaEl) {
    const base = student ? `Padre: ${name}` : (role || 'Usuario');
    metaEl.textContent = base;
    metaEl.dataset.baseMeta = base;
    const online = (await getChatModule()).getOnlineUsers().has(userId);
    metaEl.innerHTML = `<span class="kk-header-status ${online ? 'is-online' : ''}">
      <span class="kk-status-dot"></span>${online ? 'En línea' : Helpers.escapeHTML(base)}</span>`;
  }

  // ✅ BOTONES DE ACCESO RÁPIDO (Directora/Asistente)
  const headerActions = document.getElementById('chatHeaderActions');
  if (headerActions) {
    headerActions.innerHTML = student ? `
      <button onclick="window.App._openStudentModal('${student.id}')" class="p-2 text-teal-600 hover:bg-teal-50 rounded-xl transition-all" title="Ver Ficha">
        <i data-lucide="user-square" class="w-5 h-5"></i>
      </button>
      <button onclick="window.goToSection('pagos')" class="p-2 text-teal-600 hover:bg-teal-50 rounded-xl transition-all" title="Ver Pagos">
        <i data-lucide="credit-card" class="w-5 h-5"></i>
      </button>
    ` : '';
    if (window.lucide) lucide.createIcons();
  }

  if (avatarEl) {
    if (avatarUrl && avatarUrl !== 'null') {
      avatarEl.innerHTML = `<img src="${avatarUrl}" class="w-full h-full object-cover">`;
    } else {
      avatarEl.innerHTML = (name || '?').charAt(0);
    }
  }
  // ✅ Composer SIEMPRE activo al entrar a una conversación
  inputArea?.classList.remove('hidden');
  inputArea?.style.removeProperty('display');
  const sendBtn = document.getElementById('btnSendChatMessage');
  const chatInput = document.getElementById('chatMessageInput');
  if (sendBtn) { sendBtn.disabled = false; sendBtn.style.display = ''; }
  if (chatInput) { chatInput.disabled = false; }

  // ✅ Limpiar respuesta pendiente anterior
  hideReplyBar();
  _assistantReply = null;

  const user = AppState.get('user');
  const profile = AppState.get('profile');

    // ✅ Reset UI al cambiar de chat
    AppState.set('activeChatUserId', userId);

    const container = document.getElementById('chatMessagesContainer');
  if (container) {
    container.innerHTML = '<div class="p-8 text-center"><div class="animate-spin w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full mx-auto"></div></div>';

    // ✅ Acciones de mensaje: mantener presionado / clic derecho
    bindMessageActions(container, {
      myId: user.id,
      onReply: (msg) => {
        const currentId = AppState.get('activeChatUserId');
        const senderName = msg.sender_id === user.id ? 'ti' : (_assistantContacts[currentId]?.name || 'Contacto');
        _assistantReply = { id: msg.id, senderName, content: msg.content };
        showReplyBar(document.getElementById('chatInputArea'), { senderName, content: msg.content }, () => { _assistantReply = null; });
      },
      onForward: (msg) => {
        const targets = Object.values(_assistantContacts).filter(c => c.id);
        openForwardModal(targets, async (contact) => {
          await (await getChatModule()).sendMessage(user.id, contact.id, msg.content);
        });
      },
      onReact: async (msgId, emoji) => (await getChatModule()).toggleReaction(msgId, emoji),
      onDelete: async (msgId) => (await getChatModule()).deleteMessage(msgId)
    });
  }

  try {
    let messages = [], conversationId = null;
    try {
      const chatMod = await getChatModule();
      const res = await chatMod.loadConversation(userId);
      messages = res.messages || [];
      conversationId = res.conversationId || null;
    } catch (_) {
      // Si get_direct_messages falla (función no existe aún), mostrar chat vacío
      messages = [];
      conversationId = null;
    }
    AppState.set('activeConversationId', conversationId);

    // Marcar como leídos al abrir
    if (conversationId) (await getChatModule()).markAsRead(conversationId);

    if (container) {
      container.classList.add('wa-wallpaper');
      _resolveReplyPreviews(messages);
      container.innerHTML = messages.length
        ? buildThreadHTML(messages, (m) => _msgBubble(m, user.id))
        : '<div class="p-8 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">No hay mensajes previos</div>';
      ScrollModule.scrollToBottom(container, false);

      // ✅ TOP-SCROLL: Cargar mensajes históricos
      if (conversationId) {
        if (window._chatTopScroll) window._chatTopScroll.destroy();
        window._chatTopScroll = ScrollModule.topScroll({
          container: container,
          loadFn: async () => {
            const { messages: moreMsg, hasMore } = await (await getChatModule()).loadConversation(userId, conversationId, true);
            if (moreMsg.length > 0) {
              prependThreadHTML(container, moreMsg, (m) => _msgBubble(m, user.id));
            }
          }
        });
      }
    }

    // Subscribe Realtime
    if (conversationId) {
      (await getChatModule()).subscribeToConversation(conversationId,
        (newMsg) => {
          if (newMsg.sender_id === user.id) return;
          if (container) {
            appendLiveMessage(container, newMsg, (m) => _msgBubble(m, user.id));
            ScrollModule.scrollToBottom(container, true);
          }
        },
        (typing) => {
          const indicator = document.getElementById('chatTypingIndicator');
          if (!indicator) return;
          if (typing.isTyping && typing.userName !== profile?.name) {
            indicator.textContent = `${typing.userName} está escribiendo...`;
            indicator.classList.remove('hidden');
          } else {
            indicator.classList.add('hidden');
          }
        },
        (presence) => {
          // Presence handler: actualizar círculos verdes en la lista
          _updatePresenceUI(presence);
        },
        (receipt) => {
          // Read receipt handler (✓✓)
          if (!receipt?.id || !receipt.is_read) return;
          const msgEl = document.getElementById(`msg-${receipt.id}`);
          const checks = msgEl?.querySelector('.kk-checks');
          if (checks) { checks.textContent = '✓✓'; checks.classList.add('is-read'); }
        },
        (updated) => {
          // ✅ REACCIONES / ELIMINADOS en tiempo real
          if (!updated?.id) return;
          const row = document.getElementById(`msg-${updated.id}`);
          if (!row) return;
          const bubble = row.querySelector('.kk-msg-bubble');
          if (!bubble) return;
          if (updated.deleted_at && !row.classList.contains('is-deleted')) {
            markRowDeleted(row);
            row.classList.add('is-deleted');
            return;
          }
          bubble.querySelector('.kk-reaction-chips')?.remove();
          if (updated.reactions && Object.keys(updated.reactions).length) {
            bubble.insertAdjacentHTML('beforeend', reactionChipsHTML(updated.reactions, user.id));
          }
        }
      );
    }
  } catch (err) {
    Helpers.toast('Error al cargar chat', 'error');
  }
};

async function initAssistantChat() {
  const list = document.getElementById('chatContactsList');
  if (!list) return;
  
  list.innerHTML = Helpers.skeleton(4, 'h-16 mb-2');
  const user = AppState.get('user');
  const profile = AppState.get('profile');

  // Guard: si no hay usuario autenticado, no continuar
  if (!user?.id) {
    list.innerHTML = Helpers.errorState('Sesión no disponible. Recarga la página.');
    return;
  }

  try {
    // Cargar contactos — solo perfiles activos con nombre válido
    const [profilesRes, unreadRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, name, avatar_url, role')
        .neq('id', user.id)
        .is('deleted_at', null)
        .not('name', 'is', null)
        .order('name'),
      getChatModule().then(m => m.getUnreadCounts()).catch(() => ({ counts: {} }))
    ]);
    const { data: profiles, error } = profilesRes;
    const unreadMap = unreadRes?.counts || {};

    if (error) throw error;

    // Obtener nombres de estudiantes para padres en query separada
    const parentIds = (profiles || []).filter(p => p.role === 'padre').map(p => p.id);
    let studentMap = {};
    let activeParentIds = [];
    if (parentIds.length > 0) {
      const { data: students } = await supabase
        .from('students')
        .select('parent_id, name')
        .in('parent_id', parentIds)
        .is('deleted_at', null)
        .eq('is_active', true);
      (students || []).forEach(s => {
        if (!studentMap[s.parent_id]) studentMap[s.parent_id] = s.name;
        if (!activeParentIds.includes(s.parent_id)) activeParentIds.push(s.parent_id);
      });
    }

    // Filtro final: solo perfiles con nombre válido y padres con al menos un estudiante activo
    const activeProfiles = (profiles || []).filter(p => {
      if (!p.name || p.name.trim().length === 0) return false;
      if (p.role === 'padre' && !activeParentIds.includes(p.id)) return false;
      return true;
    });

    if (!activeProfiles.length) {
      list.innerHTML = Helpers.emptyState('No hay contactos disponibles');
      return;
    }

    // ✅ Vista previa del último mensaje + presencia global (en paralelo)
    const contactIds = activeProfiles.filter(p => p.id).map(p => p.id);
    const [previews] = await Promise.all([
      getChatModule().then(m => m.getLastMessagePreviews(contactIds)),
      getChatModule().then(m => m.subscribeGlobalPresence(online => _updatePresenceUI(online)))
    ]);

    // Orden: último mensaje más reciente primero; sin mensajes → por no leídos
    activeProfiles.sort((a, b) => {
      const ta = previews[a.id]?.created_at ? new Date(previews[a.id].created_at).getTime() : 0;
      const tb = previews[b.id]?.created_at ? new Date(previews[b.id].created_at).getTime() : 0;
      if (ta !== tb) return tb - ta;
      return (unreadMap[a.id] || 0) - (unreadMap[b.id] || 0);
    });

    list.innerHTML = activeProfiles.map(p => {
      const unread = unreadMap[p.id] || 0;
      const studentName = p.role === 'padre' ? (studentMap[p.id] || null) : null;
      const mainTitle = studentName ? `Estudiante: ${studentName}` : (p.name || 'Sin nombre');
      const subTitle = studentName ? `Padre: ${p.name || 'Sin nombre'}` : (p.role || 'Usuario');
      const roleLabel = p.role === 'directora' ? 'Directora'
        : p.role === 'asistente' ? 'Asistente'
        : p.role === 'maestra' ? 'Maestra' : (p.role || 'Usuario');

      // ✅ Guardar metadatos localmente — onclick solo pasa el ID (seguro ante comillas/apóstrofes)
      _assistantContacts[p.id] = { id: p.id, name: p.name || 'Sin nombre', role: p.role, avatar_url: p.avatar_url || '' };

      return chatListItemHTML({
        c: { id: p.id, name: mainTitle, avatar: p.avatar_url },
        unread,
        lastMsg: previews[p.id] || null,
        online: false,
        sub: subTitle,
        avatarBg: 'bg-teal-100 text-teal-700',
        extraAttr: `data-user-id="${p.id}"`
      });
    }).join('');

    // ✅ Buscador de contactos (una sola vez)
    const searchInputEl = document.getElementById('chatSearchInput');
    if (searchInputEl && !searchInputEl._kkBound) {
      searchInputEl._kkBound = true;
      searchInputEl.addEventListener('input', () => {
        const q = searchInputEl.value.trim().toLowerCase();
        list.querySelectorAll('.kk-chat-item').forEach(el => {
          el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? '' : 'none';
        });
      });
    }

    // ✅ Restaurar búsqueda / scroll preservados (experiencia PWA)
    ChatListState.restoreUI('asistente', { searchEl: searchInputEl });
    const savedList = ChatListState.load('asistente');
    if (savedList.scrollTop) requestAnimationFrame(() => { list.scrollTop = savedList.scrollTop; });
    if (!list._kkScrollSave) {
      list._kkScrollSave = true;
      let tSave = null;
      list.addEventListener('scroll', () => {
        clearTimeout(tSave);
        tSave = setTimeout(() => ChatListState.save('asistente', {
          ...ChatListState.load('asistente'),
          scrollTop: list.scrollTop
        }), 300);
      }, { passive: true });
    }

    // ✅ Delegación de clic en la lista (una sola vez)
    if (!list._kkClickBound) {
      list._kkClickBound = true;
      list.addEventListener('click', (e) => {
        const row = e.target.closest('.kk-chat-item');
        if (row?.dataset.userId) window.selectAssistantChat(row.dataset.userId);
      });
    }

    // Listeners para envío
    const sendBtn = document.getElementById('btnSendChatMessage');
    const input = document.getElementById('chatMessageInput');
    
    if (sendBtn && !sendBtn._bound) {
      sendBtn._bound = true;
      
      // ✅ INTERFAZ OPTIMISTA: Envío inmediato y sincronización
      const _optimisticSend = async () => {
        const text = input.value.trim();
        const destId = AppState.get('activeChatUserId');
        const convId = AppState.get('activeConversationId');
        if (!text || !destId) return;

        const reply = _assistantReply;
        input.value = '';
        hideReplyBar();
        _assistantReply = null;
        const tempId = `temp-${Date.now()}`;
        const container = document.getElementById('chatMessagesContainer');
        container?.insertAdjacentHTML('beforeend', _msgBubble({
          id: tempId, sender_id: user.id, content: text,
          _replyPreview: reply ? { sender_name: reply.senderName, content: reply.content } : null
        }, user.id));
        ScrollModule.scrollToBottom(container, true);

        try {
          const res = await (await getChatModule()).sendMessage(user.id, destId, text, convId, reply?.id || null);
          // Actualizar ID temporal con el real de Supabase
          const tempMsg = document.getElementById(`msg-${tempId}`);
          if (tempMsg && res.message?.id) {
            tempMsg.id = `msg-${res.message.id}`;
            const timeSpan = tempMsg.querySelector('.kk-msg-time');
            const now = new Date();
            if (timeSpan) timeSpan.textContent = `${formatDayLabel(now)} · ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          }
          if (!convId && res.conversationId) {
            AppState.set('activeConversationId', res.conversationId);
          }
        } catch (_) {
          const tempMsg = document.getElementById(`msg-${tempId}`);
          if (tempMsg) tempMsg.style.opacity = '0.5';
          Helpers.toast('Error al enviar', 'error');
        }
      };

      sendBtn.onclick = _optimisticSend;
      input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _optimisticSend(); } };
      
      // Typing broadcast
      let t;
      input.oninput = async () => {
        const cid = AppState.get('activeConversationId');
        if (!cid) return;
        (await getChatModule()).broadcastTyping(cid, profile?.name, true);
        clearTimeout(t);
        t = setTimeout(async () => (await getChatModule()).broadcastTyping(cid, profile?.name, false), 2000);
      };
    }

  } catch (err) {
    list.innerHTML = Helpers.errorState('Error al cargar contactos: ' + (err?.message || 'Intenta recargar'));
  }
}

/**
 * Actualiza los indicadores de presencia en la lista de contactos.
 * Acepta un Set de user_id (presencia global) o el presenceState del canal.
 */
function _updatePresenceUI(presenceSource) {
  let onlineUsers;
  if (presenceSource instanceof Set) {
    onlineUsers = presenceSource;
  } else {
    onlineUsers = new Set();
    Object.values(presenceSource || {}).forEach(p => {
      p.forEach(presence => onlineUsers.add(presence.user_id));
    });
  }

  document.querySelectorAll('#chatContactsList [data-user-id]').forEach(el => {
    const dot = el.querySelector('.kk-online-dot');
    if (dot) dot.classList.toggle('is-online', onlineUsers.has(el.dataset.userId));
  });

  // Estado en el header del chat abierto
  const activeId = AppState.get('activeChatUserId');
  if (activeId) {
    const metaEl = document.getElementById('chatActiveMeta');
    if (metaEl && metaEl.dataset.baseMeta) {
      const online = onlineUsers.has(activeId);
      metaEl.innerHTML = `<span class="kk-header-status ${online ? 'is-online' : ''}">
        <span class="kk-status-dot"></span>${online ? 'En línea' : Helpers.escapeHTML(metaEl.dataset.baseMeta)}</span>`;
    }
  }
}

/** Resuelve las citas de respuesta contra los mensajes ya cargados */
function _resolveReplyPreviews(messages) {
  if (!messages?.length) return;
  const byId = new Map(messages.filter(m => m.id).map(m => [String(m.id), m]));
  messages.forEach(m => {
    if (m.reply_to && !m._replyPreview) {
      const src = byId.get(String(m.reply_to));
      if (src) m._replyPreview = { sender_name: src.sender_name || '', content: src.content || '' };
    }
  });
}

function _msgBubble(m, myId) {
  const isMe = m.sender_id === myId;

  // ✅ ¿Quién escribió? — resolver contacto activo para mensajes entrantes
  const profile = AppState.get('profile');
  const activeId = AppState.get('activeChatUserId');
  const contact = !isMe && activeId ? _assistantContacts[activeId] : null;
  const senderName = isMe ? (profile?.name || '') : (m.sender_name || contact?.name || 'Contacto');
  const avatarUrl = isMe ? (profile?.avatar_url || null) : (m.sender_avatar || contact?.avatar_url || null);

  return waBubbleHTML({
    m, myId,
    senderName,
    avatarUrl,
    showName: true,
    showAvatar: true
  });
}
