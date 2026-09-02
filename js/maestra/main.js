import { ensureRole, supabase, initOneSignal, sendPush, emitEvent, initSessionTimeout, sanitizePushPayload, validateFileUpload, safeFileName, sanitizeText } from '/js/shared/supabase.js';
import { SchoolEngine } from '/js/shared/school-engine.js';
import { RealtimeManager } from '/js/shared/realtime-manager.js';
import { QueryCache } from '/js/shared/query-cache.js';
import { AppState } from './state.js';
import { MaestraApi } from './api.js';
import { Helpers } from '/js/shared/helpers.js';
import { BadgeSystem } from '/js/shared/badges.js';
import { ImageLoader } from '/js/shared/image-loader.js';

import * as Attendance from './modules/attendance.js';
import * as Routine from './modules/routine.js';
import * as Tasks from './modules/tasks.js';
import * as Students from './modules/students.js';
import * as ChatApp from './modules/chat_app.js';
import * as Boletin from './modules/boletin.js';
import { UI } from './modules/ui.js';

import { UIPremium } from '/js/shared/ui-premium.js';
import { BackNavigation } from '/js/shared/back-navigation.js';
import { loadFlags, isEnabled, onFlagsChange, MODULES } from '/js/shared/feature-flags.js';

window.safeToast = UI.safeToast;
const { safeToast, safeEscapeHTML, Modal } = UI;

// Cache de marcas de tiempo para evitar recargas constantes
const _lastLoad = {};

// Exponer Modal globalmente ANTES de cualquier interacción del usuario
// Los onclick inline en HTML dinámico necesitan window.Modal disponible de inmediato
window.Modal = Modal;

// ✅ Shim compatible con otros paneles: módulos compartidos (wall, carnets,
// student-record-modal) llaman window.openGlobalModal() y App.ui.closeModal().
// Sin esto, esos modales fallan silenciosamente en el panel maestra.
window.openGlobalModal = (html, wide = false) => {
  Modal.open('globalModal', `
    <div class="bg-white rounded-3xl shadow-2xl ${wide ? 'sm:max-w-4xl' : 'sm:max-w-2xl'} w-full mx-auto relative">
      <button onclick="Modal.close('globalModal')" class="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-all z-10" aria-label="Cerrar">
        <i data-lucide="x" class="w-5 h-5"></i>
      </button>
      ${html}
    </div>`);
};
window.closeGlobalModal = () => Modal.close('globalModal');
const { initAttendance, markAllPresent, registerAttendance } = Attendance;
const { initRoutine, updateRoutineField, saveRoutineLog, openStudentRoutine, updateRoutineFieldInModal, saveRoutineInModal, openBulkEventModal, confirmBulkEvent, wakeAllSiestas, wakeStudentSiesta, undoLastBulk, publishAll, registerIndividualEvent, toggleTimeline, openExtraEventModal, confirmExtraEvent, registerMissingStudents, insertEventAt, openInsertEventPicker, moveScheduleEvent, cascadeScheduleShift, toggleScheduleAuto, filterEventsByAge, stopAutoRegisterClock, paginateScheduleCatalog, paginateAllEvents, setRoutineFilter, refreshRoutineAttendance, toggleRoutineSection } = Routine;
const { initTasks, openEditTaskModal, deleteTask, openNewTaskModal, viewTaskSubmissions, submitGrade } = Tasks;
const { initGradesV2, openNewActivityModal, gradeActivity, saveGradeV2, deleteActivityV2, toggleArea, deleteArea, openStudentGradesList, viewStudentGrades, openAreasManager, openStudentResultGrid, editStudentScore, editTaskScore } = Tasks;
const { openStudentProfile, registerIncidentModal } = Students;
const { initChat, selectChatContact } = ChatApp;
const { openBoletinList, openBoletin, downloadBoletin } = Boletin;

/**
 * 🚀 ARQUITECTURA SENIOR: Definición Global del Objeto App
 * Evita errores de "App is not defined" y centraliza la lógica.
 */
window.App = {
  // UI Helpers
  safeToast: UI.safeToast,
  safeEscapeHTML: UI.safeEscapeHTML,
  Modal: UI.Modal,
  ui: { closeModal: () => Modal.close('globalModal') },

  // Attendance
  registerAttendance: Attendance.registerAttendance,
  markAllPresent: Attendance.markAllPresent,
  detectAbsents: Attendance.detectAbsents,
  initAttendance: Attendance.initAttendance,
  handleAttendancePointerDown: Attendance.handleAttendancePointerDown,
  handleAttendancePointerUp: Attendance.handleAttendancePointerUp,
  openDailyReport: Attendance.openDailyReport,

  // Routine
  initRoutine: Routine.initRoutine,
  updateRoutineField: Routine.updateRoutineField,
  saveRoutineLog: Routine.saveRoutineLog,
  openStudentRoutine: Routine.openStudentRoutine,
  registerIndividualEvent: Routine.registerIndividualEvent,
  saveInfantEntry: Routine.saveInfantEntry,
  updateRoutineFieldInModal: Routine.updateRoutineFieldInModal,
  saveRoutineInModal: Routine.saveRoutineInModal,
  openBulkEventModal: Routine.openBulkEventModal,
  confirmBulkEvent: Routine.confirmBulkEvent,
  wakeAllSiestas: Routine.wakeAllSiestas,
  wakeStudentSiesta: Routine.wakeStudentSiesta,
  undoLastBulk: Routine.undoLastBulk,
  publishAll: Routine.publishAll,
  toggleTimeline: Routine.toggleTimeline,
  openExtraEventModal: Routine.openExtraEventModal,
  confirmExtraEvent: Routine.confirmExtraEvent,
  registerMissingStudents: Routine.registerMissingStudents,
  // Schedule Builder & Catálogo V8
  openScheduleManager: Routine.openScheduleManager,
  saveScheduleManager: Routine.saveScheduleManager,
  addEventToSchedule: Routine.addEventToSchedule,
  removeEventFromSchedule: Routine.removeEventFromSchedule,
  resetScheduleToDefault: Routine.resetScheduleToDefault,
  filterEventCatalog: Routine.filterEventCatalog,
  filterEventsByAge: Routine.filterEventsByAge,
  paginateScheduleCatalog: Routine.paginateScheduleCatalog,
  openAllEventsMenu: Routine.openAllEventsMenu,
  paginateAllEvents: Routine.paginateAllEvents,
  // Cronología V8: drag & drop, insertar entre bloques y recálculo en cascada
  moveScheduleEvent: Routine.moveScheduleEvent,
  cascadeScheduleShift: Routine.cascadeScheduleShift,
  openInsertEventPicker: Routine.openInsertEventPicker,
  insertEventAt: Routine.insertEventAt,
  toggleScheduleAuto: Routine.toggleScheduleAuto,
  setRoutineFilter: Routine.setRoutineFilter,
  toggleRoutineSection: Routine.toggleRoutineSection,
  openClassroomEventsSheet: Routine.openClassroomEventsSheet,
  toggleTimelineAuto: Routine.toggleTimelineAuto,
  timelineEventTap: Routine.timelineEventTap,
  quickConfirmBulkEvent: Routine.quickConfirmBulkEvent,
  selectClassroomAction: Routine.selectClassroomAction,
  filterClassroomActions: Routine.filterClassroomActions,
  prevActionCategory: Routine.prevActionCategory,
  nextActionCategory: Routine.nextActionCategory,
  _autoSaveNote: (sid, val) => window._routineAutoSaveNote?.(sid, val),

  // Tasks
  initTasks: Tasks.initTasks,
  openEditTaskModal: Tasks.openEditTaskModal,
  deleteTask: Tasks.deleteTask,
  openNewTaskModal: Tasks.openNewTaskModal,
  viewTaskSubmissions: Tasks.viewTaskSubmissions,
  submitGrade: Tasks.submitGrade,
  _bulkGradeAll: (taskId, key) => window._bulkGradeAll?.(taskId, key),

  // Grades V2
  initGradesV2: Tasks.initGradesV2,
  openNewActivityModal: Tasks.openNewActivityModal,
  gradeActivity: Tasks.gradeActivity,
  saveGradeV2: Tasks.saveGradeV2,
  deleteActivityV2: Tasks.deleteActivityV2,
  toggleArea: Tasks.toggleArea,
  deleteArea: Tasks.deleteArea,
  openStudentGradesList: Tasks.openStudentGradesList,
  viewStudentGrades: Tasks.viewStudentGrades,
  openAreasManager: Tasks.openAreasManager,
  openStudentResultGrid: Tasks.openStudentResultGrid,
  editStudentScore: Tasks.editStudentScore,
  editTaskScore: Tasks.editTaskScore,
  refreshPendingGradesBadge: loadPendingGradesBadge,

  // Boletines
  openBoletinList: Boletin.openBoletinList,
  openBoletin: Boletin.openBoletin,
  downloadBoletin: Boletin.downloadBoletin,

  // Students
  openStudentProfile: Students.openStudentProfile,
  registerIncidentModal: Students.registerIncidentModal,

  // Chat
  initChat: ChatApp.initChat,
  selectChatContact: ChatApp.selectChatContact,
  _quickReply: (text) => {
    const input = document.getElementById('chatMessageInput');
    const sendBtn = document.getElementById('btnSendChatMessage');
    if (input) { input.value = text; input.focus(); input.dispatchEvent(new Event('input')); }
    if (sendBtn) setTimeout(() => sendBtn.click(), 150);
  },

  // Permits
  permits: { init: () => import('./modules/permits.js').then(m => m.PermitsModule.init()) },

  // Global actions
  setActiveSection: (targetId, options) => window.App._setActiveSection?.(targetId, options),
  navigateTo: (sectionId, tabId) => {
    const cleanSection = sectionId.startsWith('t-') ? sectionId : `t-${sectionId}`;
    window.App.setActiveSection(cleanSection);
    if (tabId) {
      // Si la sección es detalle de aula, activar el tab
      if (cleanSection === 't-class-detail') {
        window.App.activateTab?.(tabId);
      }
      // Si la sección es home pero el tab es rutina (caso dashboard)
      if (cleanSection === 't-home' && tabId === 'daily-routine') {
        // En este caso, el dashboard redirige a la sección de aula detalle tab rutina
        const classroom = AppState.get('classroom');
        if (classroom) {
          window.App.showClassroomDetail(classroom.id, { activeTab: tabId });
        }
      }
    }
  },
  showClassroomDetail: (classroomId, options) => window.App._showClassroomDetail?.(classroomId, options),
  selectClassroom: (classroomId) => window.App._selectClassroom?.(classroomId),
  startJitsi: () => window.App._startJitsi?.(),
  openNewPostModal: () => window.App._openNewPostModal(),
  submitNewPost: () => window.App._submitNewPost()
};

/**
 * Inicialización principal
 */

// Global error handler
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message?.toLowerCase() ?? '';
  if (msg.includes('indexeddb') || msg.includes('network') || msg.includes('fetch')) return;
});

document.addEventListener('DOMContentLoaded', async () => {
  // Logout seguro — limpia todo el almacenamiento
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try {
      const preserved = {};
      for (const key of ['maestra_last_section', 'maestra_last_classroom', 'maestra_last_tab']) {
        const v = localStorage.getItem(key);
        if (v !== null) preserved[key] = v;
      }
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('karpus_tl_auto_')) preserved[key] = localStorage.getItem(key);
      }
      localStorage.clear();
      for (const [k, v] of Object.entries(preserved)) localStorage.setItem(k, v);
    } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    try { if (window.caches) caches.keys().then(k => k.forEach(c => caches.delete(c))); } catch (_) {}
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  });

  const auth = await ensureRole(['maestra', 'admin']);
  if (!auth) return;

  // Hydrate QueryCache from IndexedDB for offline-first
  await QueryCache.hydrateFromIDB();
  setInterval(() => QueryCache.saveToIDB(), 30_000);

  // Activar session timeout por inactividad (30 min)
  initSessionTimeout();
  
  AppState.set('user', auth.user);
  AppState.set('profile', auth.profile);

  // 🔔 Banner global de mensajes entrantes (visible en todo el panel)
  import('/js/shared/incoming-banner.js').then(({ IncomingBanner }) => {
    IncomingBanner.init({
      uid: auth.user.id,
      isActiveChat: (msg) => ChatApp.isActiveChatOpen?.(msg),
      onOpen: async (senderId) => {
        window.App.setActiveSection?.('t-chat');
        // Esperar a que la sección renderice y abrir la conversación
        setTimeout(() => { ChatApp.openChatWithUser?.(senderId); }, 400);
      }
    });
  }).catch(() => {});

  // Inicializar School Engine
  await SchoolEngine.init({ forceRefresh: true });
  AppState.set('schoolYear', SchoolEngine.getSchoolYear());
  AppState.set('activePeriod', SchoolEngine.getActivePeriod());
  AppState.set('periods', SchoolEngine.getAllPeriods());

  // 🔔 Inicializar Notificaciones Push
  // 🔥 FIX: Permitir subdominios como www. y otros para la inicialización
  const host = window.location.hostname;
  const isProd = host === 'karpuskids.com' || host === 'www.karpuskids.com' || host.endsWith('.karpuskids.com');
  
  if (isProd) {
    try { initOneSignal(auth.user); } catch(_) {}
  }

  // Identidad
  const teacherName = auth.profile?.full_name || auth.profile?.name || 'Maestra';
  const sidebarAvatar = document.getElementById('sidebarAvatar');
  const sidebarName = document.getElementById('sidebarName');
  const sidebarEmail = document.getElementById('sidebarEmail');
  
  if (sidebarName) sidebarName.textContent = teacherName;
  if (sidebarEmail) sidebarEmail.textContent = auth.user.email;
  
  if (sidebarAvatar) {
    const avatarUrl = auth.profile?.avatar_url;
    if (avatarUrl) {
      const img = document.createElement('img');
      img.src = avatarUrl;
      img.className = 'w-full h-full object-cover';
      img.alt = '';
      img.onerror = function() {
        this.replaceWith(Object.assign(document.createElement('div'), {
          className: 'w-full h-full flex items-center justify-center text-xl font-black text-orange-600 bg-orange-50',
          textContent: teacherName.charAt(0)
        }));
      };
      sidebarAvatar.innerHTML = '';
      sidebarAvatar.appendChild(img);
    } else {
      sidebarAvatar.innerHTML = `<div class="w-full h-full flex items-center justify-center text-xl font-black text-orange-600 bg-orange-50">${safeEscapeHTML(teacherName.charAt(0))}</div>`;
    }
  }

  document.querySelectorAll('.user-name-display').forEach(el => el.textContent = teacherName);
  document.querySelectorAll('.user-email-display').forEach(el => el.textContent = auth.user.email);
  const welcomeText = document.querySelector('#t-home header h1');
  if (welcomeText) welcomeText.innerHTML = `<span>Hola, <span class="user-name-display text-orange-600">${safeEscapeHTML(teacherName)}</span>!</span>`;

  // Cargar Perfil en sección perfil
  const pName = document.getElementById('teacherName');
  const pEmail = document.getElementById('teacherEmail');
  if (pName) pName.textContent = teacherName;
  if (pEmail) pEmail.textContent = auth.user.email;
  if (document.getElementById('profileAvatar')) {
    setProfileAvatar(auth.profile?.avatar_url, teacherName);
  }

  // Inicializar formulario de perfil
  const profileForm = document.getElementById('profileForm');
  if (profileForm) {
    // Cargar datos actuales
    const profName = document.getElementById('profName');
    const profPhone = document.getElementById('profPhone');
    const profEmail = document.getElementById('profEmail');
    const profBio = document.getElementById('profBio');
    
    if (profName) profName.value = auth.profile?.name || '';
    if (profPhone) profPhone.value = auth.profile?.phone || '';
    if (profEmail) profEmail.value = auth.user.email;
    if (profBio) profBio.value = auth.profile?.bio || '';

    profileForm.onsubmit = async (e) => {
      e.preventDefault();
      const btn = profileForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Guardando...';
      
      try {
        const updates = {
          name: profName.value,
          phone: profPhone.value,
          bio: profBio.value,
          updated_at: new Date().toISOString()
        };
        const { error } = await supabase.from('profiles').update(updates).eq('id', auth.user.id);
        if (error) throw error;
        
        // Actualizar estado local
        const oldProfile = AppState.get('profile') || {};
        AppState.set('profile', { ...oldProfile, ...updates });
        
        safeToast('Perfil actualizado correctamente');
        
        // ✅ ACTUALIZACIÓN REACTIVA: Actualizar UI sin recargar
        document.querySelectorAll('.user-name-display').forEach(el => el.textContent = updates.name);
        const sidebarName = document.getElementById('sidebarName');
        if (sidebarName) sidebarName.textContent = updates.name;
        
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Guardar Cambios';
        if (window.lucide) lucide.createIcons();
      } catch (err) {
        safeToast('Error al guardar perfil. Revisa tu conexión.', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Guardar Cambios';
      }
    };
  }

  // Manejar subida de avatar
  const avatarInput = document.getElementById('profileAvatarInput');
  if (avatarInput) {
    avatarInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        safeToast('La imagen es demasiado grande (máx. 5MB)', 'error');
        return;
      }
      
      const fileName = `avatar-${auth.user.id}-${Date.now()}.webp`;
      const filePath = `avatars/${fileName}`;

      try {
        // Comprimir avatar antes de subir (máx 400px, WebP)
        const publicUrl = await ImageLoader.uploadToStorage(file, 'karpus-uploads', filePath, {
          maxWidth: 400, maxHeight: 400, quality: 0.85, maxSizeKB: 150
        });
        
        // Actualizar perfil con nueva URL
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ avatar_url: publicUrl })
          .eq('id', auth.user.id);
        
        if (updateError) throw updateError;
        
        // Actualizar avatar en UI
        setProfileAvatar(publicUrl, teacherName);
        const sideAvatar = document.getElementById('sidebarAvatar');
        if (sideAvatar) {
          const img = document.createElement('img');
          img.src = publicUrl;
          img.className = 'w-full h-full object-cover';
          img.alt = '';
          img.onerror = function() {
            this.replaceWith(Object.assign(document.createElement('div'), {
              className: 'w-full h-full flex items-center justify-center text-xl font-black text-orange-600 bg-orange-50',
              textContent: teacherName.charAt(0)
            }));
          };
          sideAvatar.innerHTML = '';
          sideAvatar.appendChild(img);
        }
        
        // Actualizar estado
        AppState.set('profile', { ...auth.profile, avatar_url: publicUrl });
        
        safeToast('Avatar actualizado correctamente');
      } catch (err) {
        safeToast('Error al subir avatar', 'error');
      }
    };
  }

  // Helper to set profile avatar
  function setProfileAvatar(avatarUrl, name) {
    const avatarEl = document.getElementById('profileAvatar');
    if (!avatarEl) return;
    const initial = (name || 'M').charAt(0).toUpperCase();
    if (avatarUrl) {
      avatarEl.innerHTML = `<img src="${avatarUrl}" class="w-full h-full object-cover rounded-full">`;
    } else {
      avatarEl.innerHTML = initial;
    }
  }
  // Initialize profile avatar
  setProfileAvatar(auth.profile?.avatar_url, teacherName);

  // EXPOSICIÓN GLOBAL DE MÓDULOS (CRUCIAL PARA EL MURO)
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

  // Inicializar QR de la maestra en sección perfil
  _initMaestraQR(auth.profile, auth.user);

  // Asignar funciones internas al objeto global App
  Object.assign(window.App, {
    _showClassroomDetail: showClassroomDetail,
    _selectClassroom: selectClassroom,
    _startJitsi: startJitsi,
    _openNewPostModal: openNewPostModal,
    _submitNewPost: submitNewPost
  });

  // Listener delegado para acciones (PRO: submit-grade)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="submit-grade"]');
    if (btn) {
      const { taskId, studentId } = btn.dataset;
      submitGrade(taskId, studentId);
      return;
    }
    // Cerrar modal estático studentProfileModal con clic afuera o botón X
    const profileModal = document.getElementById('studentProfileModal');
    if (profileModal && !profileModal.classList.contains('hidden')) {
      if (e.target === profileModal || e.target.id === 'closeStudentProfileModal' || e.target.closest('#closeStudentProfileModal')) {
        profileModal.classList.add('hidden');
        profileModal.classList.remove('flex');
      }
    }
  });

  try {
    // Obtener TODAS las aulas asignadas a esta maestra
    const { data: classrooms, error } = await supabase
      .from('classrooms')
      .select('id, name, level, capacity, teacher_id, is_live')
      .eq('teacher_id', auth.user.id)
      .order('name');

    if (error) throw error;
    if (!classrooms || classrooms.length === 0) {
      safeToast('No tienes un aula asignada.', 'warning');
      return;
    }

    // Guardar todas las aulas en estado
    AppState.set('classrooms', classrooms);

    // Seleccionar aula actual: usar la última guardada o la primera
    const lastClassroomId = localStorage.getItem('maestra_last_classroom');
    const initial = classrooms.find(c => String(c.id) === String(lastClassroomId)) || classrooms[0];
    AppState.set('classroom', initial);

    // Inicializar Módulos
    await Promise.all([
      initDashboard(),
      initAttendance(),
      initNavigation(),
      initChat()
    ]);
    
    initRealtimeUpdates(initial.id);

    // Cargar Badges en background (para todas las aulas combinadas)
    loadMaestraUnreadBadge(auth.user.id);
    loadAllClassroomsTasksBadge(classrooms);
    loadPendingGradesBadge();

    // 🔴 Sistema de badges por sección
    BadgeSystem.init(auth.user.id);

    // ── Feature Flags: ocultar módulos desactivados por el admin ──
    await loadFlags();
    _applyModuleVisibility();
    onFlagsChange(() => _applyModuleVisibility());

    // ✅ Mensaje entrante en tiempo real → refrescar badge total del chat
    window.addEventListener('karpus:message-received', (e) => {
      const msg = e.detail || {};
      if (!msg.sender_id || msg.sender_id === auth.user.id) return;
      // Si la conversación abierta es justamente esa, ya se leyó al mostrarse
      const activeConv = AppState.get('activeConversationId');
      if (activeConv && msg.conversation_id === activeConv) return;
      loadMaestraUnreadBadge(auth.user.id);
    });

    // ✅ Al leer/responder mensajes dentro del chat → recalcular badge y card
    // al instante (fuente del bug "respondí pero sigue diciendo sin leer")
    window.addEventListener('karpus:messages-read', () => {
      loadMaestraUnreadBadge(auth.user.id);
      _renderUnreadMessagesCard();
    });

    // ── Sidebar: cerrar al navegar en móvil ────────────────────────────────────────
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');

    const _closeSidebar = () => {
      sidebar?.classList.remove('mobile-visible');
      overlay?.classList.remove('visible');
      if (overlay) overlay.style.display = 'none';
    };

    sidebar?.querySelectorAll('button[data-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.innerWidth <= 768) _closeSidebar();
      });
    });

    const toggleBtn = document.getElementById('toggleSidebar');
    const layoutShell = document.getElementById('layoutShell');
    if (toggleBtn && sidebar && layoutShell) {
      toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        layoutShell.classList.toggle('sidebar-collapsed');
      });
    }
    
    window.WallModule.init('muroPostsContainer', { 
      accentColor: 'orange',
      classroomId: initial.id
    }, AppState);

  } catch (e) {
    safeToast('Error cargando datos del aula', 'error');
  }

  if (window.lucide) window.lucide.createIcons();
});

function initRealtimeUpdates(classroomId) {
  const channelName = `maestra_room_${classroomId}`;
  
  RealtimeManager.subscribe(channelName, (channel) => {
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_evidences' }, (payload) => {
        const student = (AppState.get('students') || []).find(s => s.id === payload.new.student_id);
        if (student) safeToast(`📝 ${student.name} entregó una tarea`, 'info');
      })
      // Escuchar cambios en posts para actualizar el muro sin recargar
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, (payload) => {
        const { eventType, new: newPost, old: oldPost } = payload;
        const post = newPost || oldPost;
        
        // Solo si es de este aula o general
        if (post && post.classroom_id && post.classroom_id !== classroomId) return;

        if (eventType === 'INSERT') {
          safeToast('Nueva publicación en el muro', 'info');
          window.WallModule.loadPosts('muroPostsContainer');
        } else if (eventType === 'UPDATE') {
          const postId = newPost.id;
          const likeSpan = document.getElementById(`like-count-${postId}`);
          const commBtn = document.querySelector(`#post-${postId} button[onclick*="toggleCommentSection"] span`);
          
          if (likeSpan && typeof newPost.likes_count === 'number') likeSpan.textContent = newPost.likes_count;
          if (commBtn && typeof newPost.comments_count === 'number') commBtn.textContent = `${newPost.comments_count} Comentarios`;
        } else if (eventType === 'DELETE') {
          document.getElementById(`post-${oldPost.id}`)?.remove();
        }
      })
      // Actualizar badge de calificaciones pendientes en tiempo real
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grades' }, () => loadPendingGradesBadge())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, () => loadPendingGradesBadge())
      // ✅ Sync attendance changes from QR scanner / assistant in real-time
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance', filter: `classroom_id=eq.${classroomId}` }, (payload) => {
        const att = payload.new;
        if (!att) return;
        // Update AppState attendance immediately
        const currentAtt = AppState.get('attendance') || [];
        const numSid = Number(att.student_id);
        const idx = currentAtt.findIndex(a => Number(a.student_id) === numSid);
        if (idx >= 0) currentAtt[idx] = { ...currentAtt[idx], status: att.status, check_in: att.check_in, check_out: att.check_out };
        else currentAtt.push({ student_id: numSid, status: att.status, check_in: att.check_in, check_out: att.check_out });
        AppState.set('attendance', [...currentAtt]);
        // Refresh routine if active (so timeline detects present students)
        refreshRoutineAttendance();
      });
  });
}

/**
 * 📊 Dashboard
 */
async function initDashboard() {
  const classroom = AppState.get('classroom');
  if (!classroom) return;

  try {
    const today = new Date().toISOString().split('T')[0];
    const startOfDay = `${today}T00:00:00Z`;
    const endOfDay   = `${today}T23:59:59Z`;

    // 1. Carga paralela de datos críticos
    const [students, attendance, incidentRes, classesRes] = await Promise.all([
      MaestraApi.getStudentsByClassroom(classroom.id),
      MaestraApi.getAttendance(classroom.id, today),
      supabase
        .from('incidents')
        .select('id', { count: 'exact', head: true })
        .eq('classroom_id', classroom.id)
        .gte('created_at', startOfDay)
        .lte('created_at', endOfDay),
      supabase
        .from('classrooms')
        .select('id', { count: 'exact', head: true })
        .eq('teacher_id', AppState.get('user').id)
    ]);

    AppState.set('students', students || []);
    AppState.set('attendance', attendance || []);

    // Actualizar Estadísticas (Bloques)
    UI.updateDashboardStats({
      students: students?.length || 0,
      present: (attendance || []).filter(a => ['present', 'late'].includes(a.status)).length,
      incidents: incidentRes.count || 0,
      classes: classesRes.count || 0
    });

    _updateNextActivityWidget();
    _updatePunchAlertWidget(students, attendance);
    _updateTasksToGradeWidget(classroom.id);

    // Grid de Aulas (Home) — renderizar UNA tarjeta por cada aula asignada
    const grid = document.getElementById('classesGrid'); 
    if (grid) {
      const allClassrooms = AppState.get('classrooms') || [classroom];
      grid.innerHTML = allClassrooms.map(c => `
        <div onclick="App.selectClassroom('${c.id}')" class="p-6 bg-white rounded-[2rem] border-2 ${String(c.id) === String(classroom.id) ? 'border-orange-400 ring-4 ring-orange-100' : 'border-orange-100'} shadow-sm hover:shadow-xl hover:border-orange-200 transition-all cursor-pointer group relative overflow-hidden">
          <div class="flex items-center gap-5 relative z-10">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 text-white flex items-center justify-center font-black text-2xl shadow-lg">${safeEscapeHTML(String(c.name).charAt(0).toUpperCase())}</div>
            <div>
              <h3 class="font-black text-slate-800 text-xl tracking-tight">${safeEscapeHTML(c.name)}</h3>
              <p class="text-xs font-black text-orange-500 uppercase tracking-widest">${safeEscapeHTML(c.level || '')}${c.level ? ' · ' : ''}Aula</p>
            </div>
          </div>
          <div class="mt-8 flex justify-between items-center relative z-10">
            ${String(c.id) === String(classroom.id)
              ? '<span class="text-[10px] font-black text-orange-700 uppercase tracking-widest flex items-center gap-1"><i data-lucide="check-circle" class="w-4 h-4"></i> Activa</span>'
              : '<span class="text-[10px] font-black text-orange-600 uppercase tracking-widest flex items-center gap-1">Entrar <i data-lucide="arrow-right" class="w-4 h-4"></i></span>'}
          </div>
        </div>
      `).join('');
    }

    // ✅ Card de mensajes sin responder
    _renderUnreadMessagesCard();

    // Grid de Estudiantes (Tab)
    const classGrid = document.getElementById('classroomStudentsGrid');
    if (classGrid) {
      if (!students || students.length === 0) {
        classGrid.innerHTML = `
          <div class="col-span-full py-12 text-center bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200">
            <p class="font-bold text-slate-400">No hay estudiantes registrados en esta aula.</p>
          </div>
        `;
      } else {
        classGrid.innerHTML = students.map(s => `
          <div class="p-6 bg-white rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all group">
            <div class="flex items-center gap-4 mb-6">
              <div class="w-16 h-16 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center font-bold text-2xl overflow-hidden">
                ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
              </div>
              <div class="min-w-0">
                <div class="font-black text-slate-800 text-lg truncate">${safeEscapeHTML(s.name)}</div>
                <div class="text-[10px] font-black uppercase tracking-widest text-orange-500">Estudiante</div>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button onclick="App.openStudentProfile('${s.id}')" class="py-2.5 bg-slate-50 text-slate-600 rounded-xl text-[10px] font-black uppercase hover:bg-orange-600 hover:text-white transition-all">Ver Perfil</button>
              <button onclick="App.registerIncidentModal('${s.id}')" class="py-2.5 bg-rose-50 text-rose-600 rounded-xl text-[10px] font-black uppercase hover:bg-rose-600 hover:text-white transition-all">Reportar</button>
            </div>
          </div>
        `).join('');
      }
    }
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    safeToast('Error cargando dashboard', 'error');
  }
}

/**
 * AUTOMATIZACIÓN: Widgets Inteligentes
 */
function _updateNextActivityWidget() {
  const titleEl = document.getElementById('nextActivityTitle');
  const timeEl = document.getElementById('nextActivityTime');
  if (!titleEl || !timeEl) return;

  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  // Horario predefinido (se puede traer de DB en el futuro)
  const schedule = [
    { name: 'Entrada y Bienvenida', start: 420, end: 480 }, // 7:00 AM - 8:00 AM
    { name: 'Desayuno', start: 480, end: 540 },            // 8:00 AM - 9:00 AM
    { name: 'Actividades Pedagógicas', start: 540, end: 660 }, // 9:00 AM - 11:00 AM
    { name: 'Merienda', start: 660, end: 720 },            // 11:00 AM - 12:00 PM
    { name: 'Almuerzo', start: 720, end: 780 },            // 12:00 PM - 1:00 PM
    { name: 'Siesta', start: 780, end: 870 },              // 1:00 PM - 2:30 PM
    { name: 'Juego Libre', start: 870, end: 960 },          // 2:30 PM - 4:00 PM
    { name: 'Salida', start: 960, end: 1080 }              // 4:00 PM - 6:00 PM
  ];

  const current = schedule.find(s => currentTime >= s.start && currentTime < s.end);
  const next = schedule.find(s => s.start > currentTime);

  if (current) {
    titleEl.textContent = current.name;
    const endH = Math.floor(current.end / 60);
    const endM = current.end % 60;
    const ampm = endH >= 12 ? 'PM' : 'AM';
    const h12 = endH > 12 ? endH - 12 : endH;
    timeEl.textContent = `En curso — Termina ${h12}:${endM.toString().padStart(2, '0')} ${ampm}`;
  } else if (next) {
    titleEl.textContent = `Próximo: ${next.name}`;
    const startH = Math.floor(next.start / 60);
    const startM = next.start % 60;
    const ampm = startH >= 12 ? 'PM' : 'AM';
    const h12 = startH > 12 ? startH - 12 : startH;
    timeEl.textContent = `Inicia a las ${h12}:${startM.toString().padStart(2, '0')} ${ampm}`;
  } else {
    titleEl.textContent = 'Fuera de Horario Escolar';
    timeEl.textContent = '¡Hasta mañana! 👋';
  }
}

function _updatePunchAlertWidget(students, attendance) {
  const widget = document.getElementById('punchAlertWidget');
  const textEl = document.getElementById('punchAlertText');
  if (!widget || !textEl) return;

  const total = students.length;
  const present = (attendance || []).filter(a => ['present', 'late'].includes(a.status)).length;
  const missing = total - present;

  if (missing > 0 && total > 0) {
    widget.classList.remove('hidden');
    textEl.textContent = `${missing} niños aún no han marcado entrada hoy.`;
  } else {
    widget.classList.add('hidden');
  }
}

/**
 * Widget de Tareas Pendientes por Calificar
 * Solo aparece si hay entregas de hace más de 24 horas sin calificar.
 */
async function _updateTasksToGradeWidget(classroomId) {
  const widget = document.getElementById('tasksToGradeWidget');
  const textEl = document.getElementById('tasksToGradeText');
  if (!widget || !textEl) return;

  try {
    // 1. Obtener tareas del aula
    const { data: tasks } = await supabase.from('tasks').select('id').eq('classroom_id', classroomId);
    if (!tasks?.length) return widget.classList.add('hidden');

    const taskIds = tasks.map(t => t.id);

    // 2. Buscar entregas no calificadas
    const { data: pending } = await supabase
      .from('task_evidences')
      .select('id, created_at')
      .in('task_id', taskIds)
      .neq('status', 'graded');

    if (!pending?.length) return widget.classList.add('hidden');

    // 3. Filtrar las que tienen más de 24 horas (opcional, según requerimiento)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const veryOld = pending.filter(p => new Date(p.created_at) < dayAgo);

    if (veryOld.length > 0) {
      widget.classList.remove('hidden');
      textEl.textContent = `Tienes ${veryOld.length} entrega${veryOld.length > 1 ? 's' : ''} pendiente${veryOld.length > 1 ? 's' : ''} de revisar (más de 24h).`;
    } else {
      widget.classList.add('hidden');
    }
  } catch (e) { /* tasks widget */ }
}

window.App.sendAbsenceAlerts = async () => {
  const students = AppState.get('students') || [];
  const today = new Date().toISOString().split('T')[0];
  const attendance = await MaestraApi.getAttendance(AppState.get('classroom').id, today);
  const presentIds = (attendance || []).map(a => a.student_id);
  
  const missing = students.filter(s => !presentIds.includes(s.id));
  if (missing.length === 0) return safeToast('Todos los alumnos están presentes');

  const confirm = await Helpers.confirm(`¿Enviar aviso de ausencia a los padres de ${missing.length} niños?`);
  if (!confirm) return;

  safeToast('Enviando notificaciones...', 'info');
  let sent = 0;
  for (const s of missing) {
    if (s.parent_id) {
      await sendPush({
        user_id: s.parent_id,
        title: 'Aviso de Ausencia ❓',
        message: `Hola, notamos que ${s.name} no ha llegado hoy. Por favor confírmanos si asistirá o si tiene algún inconveniente.`,
        link: 'panel_padres.html'
      }).catch(() => {});
      sent++;
    }
  }
  safeToast(`Se enviaron ${sent} avisos de ausencia`);
};

/**
 * 🔧 Feature Flags: ocultar/mostrar módulos según configuración del admin
 */
function _applyModuleVisibility() {
  const userId = AppState.get('user')?.id;
  const role = 'maestra';

  // Sidebar buttons: data-section → feature flag key mapping
  const sidebarMap = {
    't-chat':    'chat',
    't-grades':  'grades',
  };
  Object.entries(sidebarMap).forEach(([sectionId, flagKey]) => {
    const btn = document.querySelector(`button[data-section="${sectionId}"]`);
    if (btn) {
      const visible = isEnabled(flagKey, role, userId);
      btn.style.display = visible ? '' : 'none';
    }
  });

  // Class detail tabs: data-tab → feature flag key mapping
  const tabMap = {
    'feed':          'wall',
    'daily-routine': 'routine',
    'attendance':    'attendance_live',
    'tasks':         'tasks',
    'videocall':     'video_calls',
  };
  Object.entries(tabMap).forEach(([tabKey, flagKey]) => {
    const btn = document.querySelector(`.class-tab-btn[data-tab="${tabKey}"]`);
    if (btn) {
      const visible = isEnabled(flagKey, role, userId);
      btn.style.display = visible ? '' : 'none';
    }
  });

  // If current section is hidden by flag, redirect to home
  const currentSection = document.querySelector('.section.active');
  if (currentSection) {
    const sectionId = currentSection.id;
    const flagForSection = sidebarMap[sectionId];
    if (flagForSection && !isEnabled(flagForSection, role, userId)) {
      window.App.setActiveSection?.('t-home');
    }
  }
}

/**
 * 🧭 Navegación
 */
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn-toy[data-section]');
  const sections = document.querySelectorAll('.section');

  // Track previous section for cleanup
  let previousSection = null;
  
  const setActiveSection = (targetId, options = {}) => {
    const fullId = targetId.startsWith('t-') ? targetId : `t-${targetId}`;
    const cleanId = targetId.replace('t-', '');

    // Feature Flags: block navigation to disabled modules
    const userId = AppState.get('user')?.id;
    const ffSidebarMap = { 't-chat': 'chat', 't-grades': 'grades' };
    if (ffSidebarMap[fullId] && !isEnabled(ffSidebarMap[fullId], 'maestra', userId)) {
      safeToast('Este módulo está desactivado.', 'warning');
      return;
    }

    Helpers.vibrate?.('light');

    // LIMPIEZA DE REALTIME: Eliminar canales al cambiar de sección
    if (previousSection && (previousSection === 't-home' || previousSection === 't-class-detail')) {
      import('/js/shared/wall.js').then(m => m.WallModule.destroy()).catch(() => {});
      const classroom = AppState.get('classroom');
      if (classroom) {
        RealtimeManager.unsubscribe(`maestra_room_${classroom.id}`);
      }
    }

    sections.forEach(s => s.classList.remove('active'));
    const target = document.getElementById(fullId);
    if (target) {
      target.classList.add('active');
      UIPremium.applySectionTransition(fullId);
    }

    navButtons.forEach(btn => {
      const btnSection = btn.dataset.section;
      if (btnSection === fullId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Actualizar Bottom Nav
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.section === fullId);
    });

    // Guardar en localStorage para persistencia
    if (!options.skipSave) {
      localStorage.setItem('maestra_last_section', fullId);
    }

    // ✅ HISTORIAL (PWA): ATRÁS físico → regresa a la sección anterior sin recargar
    if (!options.noHistory && previousSection && previousSection !== fullId) {
      const backTo = previousSection;
      BackNavigation.push(() => setActiveSection(backTo, { noHistory: true, skipSave: true }), { kind: 'section' });
    }

    // Lógica de refresco inteligente (TTL: 2 minutos)
    const now = Date.now();
    const isFresh = _lastLoad[cleanId] && (now - _lastLoad[cleanId] < 120000);
    // El chat NUNCA se salta: los indicadores de no leídos deben estar al día
    if (isFresh && cleanId !== 'chat') return;
    _lastLoad[cleanId] = now;

    if (cleanId === 'home') initDashboard();
    if (cleanId === 'attendance') initAttendance();
    if (cleanId === 'daily-routine') initRoutine();
    if (cleanId === 'tasks') initTasks();
    if (cleanId === 'grades') { initGrades(); loadPendingGradesBadge(); }
    if (cleanId === 'permits') import('./modules/permits.js').then(m => m.PermitsModule.init());
    if (cleanId === 'chat') initChat();
    if (cleanId === 'profile') {
      import('../shared/notify-permission.js').then(m => m.NotifyPermission.requestIfNeeded());
    }

    // 🔴 Marcar badge como leído al entrar a la sección
    BadgeSystem.mark(fullId);
    
    previousSection = fullId;
  };

  /**
   * ✅ Navegación iniciada por el usuario: colapsa capas de historial
   * (conversaciones, sección previa) y trunca el historial hacia adelante
   * antes de apilar la nueva sección → ATRÁS del móvil nunca queda "muerto".
   */
  const navigateFromUser = async (targetId, options = {}) => {
    await BackNavigation.reset();
    setActiveSection(targetId, options);
  };

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => navigateFromUser(btn.dataset.section));
  });

  // Exponer para uso global
  window.App.setActiveSection = (targetId, options) => {
    // Solo las llamadas marcadas explícitamente como internas (callbacks de
    // ATRÁS con noHistory) evitan el colapso del historial; todo lo demás
    // (onclick inline, banners push, detalle de aula) es navegación del
    // usuario → reset + push de capa de sección.
    if (options && options.noHistory) {
      setActiveSection(targetId, options);
    } else {
      navigateFromUser(targetId, options || {});
    }
  };
  window.App._setActiveSection = setActiveSection; // Alias interno para el proxy global

  BackNavigation.init();

  // Restaurar última sección (sección "boletines" eliminada → redirigir a calificaciones)
  const rawLastSection = localStorage.getItem('maestra_last_section') || 't-home';
  const lastSection = rawLastSection === 't-boletin' ? 't-grades' : rawLastSection;
  const lastClassroom = localStorage.getItem('maestra_last_classroom');
  const lastTab = localStorage.getItem('maestra_last_tab');

  // La maestra trabaja SIEMPRE con su aula asignada por la directora: si el id
  // guardado no coincide con su aula actual, no se abre un detalle de otra aula.
  const assignedClassroom = AppState.get('classroom');
  const sameClassroom = assignedClassroom && String(assignedClassroom.id) === String(lastClassroom);

  if (lastSection === 't-class-detail' && sameClassroom) {
    showClassroomDetail(lastClassroom, { activeTab: lastTab });
  } else {
    setActiveSection(lastSection, { skipSave: true });
  }
}

/**
   * 🏫 Mostrar Detalle de Aula
   */
  async function showClassroomDetail(classroomId, options = {}) {
    // 1. Carga eficiente y paralela (Optimización de Datos)
    try {
      // Intentamos obtener del AppState primero para velocidad instantánea
      let classroom = AppState.get('classroom');
      let students = AppState.get('students');

      // Si no tenemos los datos o el ID es diferente, cargamos en paralelo
      if (!classroom || classroom.id != classroomId || !students) {
        const [classroomRes, studentsRes] = await Promise.all([
          supabase.from('classrooms').select('*').eq('id', classroomId).maybeSingle(),
          MaestraApi.getStudentsByClassroom(classroomId)
        ]);

        if (classroomRes.data) {
          classroom = classroomRes.data;
          AppState.set('classroom', classroom);
        }
        
        if (studentsRes) {
          students = studentsRes;
          AppState.set('students', studentsRes);
        }
      }

      if (!classroom) return safeToast('Aula no encontrada', 'error');

      // Guardar para persistencia
      localStorage.setItem('maestra_last_section', 't-class-detail');
      localStorage.setItem('maestra_last_classroom', classroomId);

      // 2. Actualizar UI del detalle
      const nameEl = document.getElementById('currentClassName');
      if (nameEl) nameEl.textContent = classroom.name;

      // 3. Cambiar a la sección de detalle
      const layoutShell = document.getElementById('layoutShell');
      if (layoutShell) layoutShell.scrollTop = 0;

      if (window.App.setActiveSection) {
        window.App.setActiveSection('t-class-detail', { skipSave: true });
      } else {
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById('t-class-detail')?.classList.add('active');
      }

      // 4. Inicializar tabs del aula
      window.WallModule.init('muroPostsContainer', { 
        accentColor: 'orange',
        likeColor: 'orange',
        classroomId: classroom.id 
      }, AppState);

      initClassTabs(options.activeTab);

    } catch (error) {
      safeToast('Error al cargar datos del aula', 'error');
    }
}

/**
 * 🔄 Seleccionar aula activa (cuando la maestra tiene varias)
 */
async function selectClassroom(classroomId) {
  const classrooms = AppState.get('classrooms') || [];
  const target = classrooms.find(c => String(c.id) === String(classroomId));
  if (!target) return;

  // Si ya es la aula activa, solo abrir detalle
  const current = AppState.get('classroom');
  if (current && String(current.id) === String(classroomId)) {
    return showClassroomDetail(classroomId);
  }

  // Cambiar aula activa
  AppState.set('classroom', target);
  localStorage.setItem('maestra_last_classroom', classroomId);

  // Desuscribir realtime anterior
  const oldClassroom = current;
  if (oldClassroom && String(oldClassroom.id) !== String(classroomId)) {
    RealtimeManager.unsubscribe(`maestra_room_${oldClassroom.id}`);
  }

  // Recargar datos del dashboard con la nueva aula
  await initDashboard();

  // Suscribir realtime a la nueva aula
  initRealtimeUpdates(target.id);

  // Recargar badges
  loadPendingTasksBadge(target.id);
  loadPendingGradesBadge();

  // Abrir detalle del aula
  showClassroomDetail(classroomId);
}

/**
 * 📋 Inicializar Tabs Internas de Aula
 */
function initClassTabs(defaultTab = null) {
  const tabBtns     = document.querySelectorAll('.class-tab-btn');
  const tabContents = document.querySelectorAll('.class-tab-content');

  const activateTab = (targetTab) => {
    // Feature Flags: block disabled tabs
    const ffTabMap = { 'feed': 'wall', 'daily-routine': 'routine', 'attendance': 'attendance_live', 'tasks': 'tasks', 'videocall': 'video_calls' };
    if (ffTabMap[targetTab] && !isEnabled(ffTabMap[targetTab], 'maestra', AppState.get('user')?.id)) return;

    // 1. Resetear TODOS los botones
    tabBtns.forEach(b => {
      b.classList.remove('active', 'bg-orange-600', 'bg-orange-500', 'text-white', 'ring-4', 'ring-orange-100');
      b.classList.add('bg-slate-100', 'text-slate-600');
    });

    // 2. Activar botones que coincidan (con énfasis especial en Rutina)
    tabBtns.forEach(b => {
      if (b.dataset.tab === targetTab) {
        const isRoutine = targetTab === 'daily-routine';
        b.classList.add('active', isRoutine ? 'bg-orange-600' : 'bg-orange-500', 'text-white', 'ring-4', 'ring-orange-100');
        b.classList.remove('bg-slate-100', 'text-slate-600', 'text-slate-500');
        if (isRoutine) b.classList.add('animate-pulse-subtle');
        // Scroll the active chip into view in the horizontal bar
        b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    });

    // 3. Mostrar contenido correcto
    tabContents.forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${targetTab}`)?.classList.remove('hidden');

    // Guardar tab en localStorage
    localStorage.setItem('maestra_last_tab', targetTab);

    // 4. Actualizar indicador de título para contexto visual
    const titleMap = { 
      'feed': 'Muro del Aula', 
      'daily-routine': 'Rutina Diaria',
      'students': 'Lista de Estudiantes', 
      'attendance': 'Pase de Lista', 
      'tasks': 'Gestión de Tareas' 
    };
    const subTitle = document.getElementById('class-detail-subtitle');
    if (subTitle) subTitle.textContent = titleMap[targetTab] || '';

    // 5. Carga de datos optimizada (Solo si es necesario o forzado)
    setTimeout(() => {
      if (targetTab === 'feed')          import('/js/shared/wall.js').then(m => m.WallModule.loadPosts()).catch(() => {});
      if (targetTab === 'daily-routine') initRoutine();
      if (targetTab === 'students')      initDashboard();
      if (targetTab === 'attendance')    initAttendance();
      if (targetTab === 'tasks')         initTasks();
      if (targetTab === 'videocall') {
        const classroom = AppState.get('classroom');
        const profile   = AppState.get('profile');
        import('../shared/videocall-ui.js').then(({ VideoCallUI }) => {
          VideoCallUI.renderSection('videocall-maestra-section', {
            role: 'maestra',
            userName: profile?.name || 'Maestra',
            classroomId: classroom?.id
          });
        }).catch(() => {});
      }
    }, 0);
  };

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  window.App.activateTab = activateTab;

  // ✅ Botón atrás del detalle de aula → regresa a la lista de aulas (t-home)
  const backToClassesBtn = document.getElementById('backToClasses');
  if (backToClassesBtn && !backToClassesBtn._kkBound) {
    backToClassesBtn._kkBound = true;
    backToClassesBtn.addEventListener('click', () => {
      // Si BackNavigation tiene capas propias (conversación de chat abierta, etc.)
      // las consume primero. Si no, navega al home directamente.
      if (BackNavigation.depth > 0) {
        BackNavigation.back();
      } else {
        navigateFromUser('t-home');
      }
    });
  }

  // Activar tab inicial
  let tabToActivate = defaultTab || localStorage.getItem('maestra_last_tab') || 'feed';
  // If default tab is disabled by feature flags, fall back to first available tab
  const ffTabMap = { 'feed': 'wall', 'daily-routine': 'routine', 'attendance': 'attendance_live', 'tasks': 'tasks', 'videocall': 'video_calls' };
  if (ffTabMap[tabToActivate] && !isEnabled(ffTabMap[tabToActivate], 'maestra', AppState.get('user')?.id)) {
    tabToActivate = 'feed';
  }
  activateTab(tabToActivate);
}

window.App.scheduleClassMeeting = async () => {
    const title = prompt("Título de la clase/reunión:");
    if(!title) return;
    
    try {
        const { VideoCallModule } = await import('/js/shared/videocall.js');
        await VideoCallModule.scheduleMeeting({
            title,
            start_time: new Date().toISOString(),
            type: 'classroom',
            target_id: AppState.get('classroom').id,
            host_id: AppState.get('user').id
        });
        safeToast("Clase programada y notificada");
    } catch(e) { safeToast("Error al programar", "error"); }
};

async function startJitsi() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('meet');
  if (!container || !classroom) return;

  const btn = document.querySelector('[onclick*="startJitsi"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Iniciando...'; }

  try {
    const { VideoCallModule } = await import('/js/shared/videocall.js');
    const meeting = await VideoCallModule.scheduleMeeting({
      title:      `Clase en Vivo: ${classroom.name}`,
      start_time: new Date().toISOString(),
      type:       'classroom',
      target_id:  classroom.id,
      host_id:    AppState.get('user').id
    });

    // 2. Marcar como en vivo en la tabla classrooms (para que el padre lo vea)
    await supabase.from('classrooms').update({ is_live: true }).eq('id', classroom.id);

    // 3. Iniciar la reunión
    await VideoCallModule.startMeeting(meeting.id);

    // 4. Abrir en nueva pestaña (evita lobby membersOnly) — room_name ya incluye el prefijo único
    window.open('https://meet.jit.si/' + meeting.room_name, '_blank');

    safeToast('¡Clase iniciada! Los padres han sido notificados 🎥', 'success');
  } catch (e) {
    safeToast('Error al iniciar la clase: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="radio"></i> Iniciar Clase Ahora'; }
  }
}

async function openNewPostModal() {
  const students = AppState.get('students') || [];
  const html = `
    <div class="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn">
      <div class="flex justify-between items-start mb-6">
        <h3 class="text-2xl font-black text-slate-800">Crear Publicación</h3>
        <button onclick="Modal.close('newPostModal')" class="p-2 hover:bg-slate-100 rounded-full"><i data-lucide="x" class="w-6 h-6 text-slate-400"></i></button>
      </div>
      <div class="space-y-4">
        <textarea id="postContent" rows="4" class="w-full p-4 bg-slate-50 border-none rounded-2xl text-sm outline-none resize-none focus:ring-2 focus:ring-orange-400" placeholder="¿Qué quieres compartir con la clase?"></textarea>
        
        <!-- Etiquetar alumnos -->
        <div>
          <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Etiquetar alumnos (opcional)</p>
          <div class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto" id="postTagChips">
            <button type="button" onclick="document.querySelectorAll('#postTagChips button[data-sid]').forEach(b=>{b.classList.toggle('bg-orange-100');b.classList.toggle('border-orange-400');b.classList.toggle('text-orange-700');b.classList.toggle('bg-slate-50');b.classList.toggle('border-slate-200');b.classList.toggle('text-slate-500');})" class="px-2 py-1 text-[8px] font-black uppercase bg-orange-100 border border-orange-300 text-orange-700 rounded-lg transition-all active:scale-95">Todos</button>
            ${students.map(s => `
              <button type="button" data-sid="${s.id}" onclick="this.classList.toggle('bg-orange-100');this.classList.toggle('border-orange-400');this.classList.toggle('text-orange-700');this.classList.toggle('bg-slate-50');this.classList.toggle('border-slate-200');this.classList.toggle('text-slate-500');" class="px-2 py-1 text-[8px] font-black bg-slate-50 border border-slate-200 text-slate-500 rounded-lg transition-all active:scale-95">
                ${safeEscapeHTML(s.name.split(' ')[0])}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="relative">
          <input type="file" id="postFile" class="hidden" accept="image/*,video/*" onchange="document.getElementById('fileName').textContent = this.files[0]?.name || 'Adjuntar foto/video'">
          <label for="postFile" class="flex items-center gap-3 p-3 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:bg-slate-50 hover:border-orange-300 transition-all">
            <div class="w-10 h-10 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center"><i data-lucide="image-plus"></i></div>
            <span id="fileName" class="text-sm font-bold text-slate-500">Adjuntar foto o video</span>
          </label>
        </div>

        <button id="btnSubmitPost" onclick="App.submitNewPost()" class="w-full py-3.5 bg-orange-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-orange-700 shadow-lg shadow-orange-200 transition-all">PUBLICAR</button>
      </div>
    </div>
  `;
  Modal.open('newPostModal', html);
}

async function submitNewPost() {
  const content = document.getElementById('postContent').value.trim();
  const fileInput = document.getElementById('postFile');
  const file = fileInput?.files[0];
  const btn = document.getElementById('btnSubmitPost');

  if (!content && !file) return safeToast('Escribe algo o sube un archivo', 'warning');

  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin mx-auto"></i>';
  if(window.lucide) window.lucide.createIcons();

  // Barra de progreso para archivos grandes
  let progressBar = null;
  if (file && file.size > 500_000) {
    progressBar = document.createElement('div');
    progressBar.className = 'mt-3 w-full bg-slate-100 rounded-full h-2 overflow-hidden';
    progressBar.innerHTML = '<div id="upload-progress-fill" class="h-full bg-orange-500 rounded-full transition-all duration-200" style="width:0%"></div>';
    btn.parentElement?.insertBefore(progressBar, btn.nextSibling);
  }

  const setProgress = (pct) => {
    const fill = document.getElementById('upload-progress-fill');
    if (fill) fill.style.width = pct + '%';
  };

  try {
    let mediaUrl = null;
    let mediaType = null;

    if (file) {
      const ext = file.type.startsWith('video') ? file.name.split('.').pop() : 'webp';
      const path = `posts/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      
      mediaUrl = await ImageLoader.uploadToStorage(file, 'karpus-uploads', path, {
        maxWidth: 1200,
        quality: 0.8,
        onProgress: setProgress
      });
      mediaType = file.type.startsWith('video') ? 'video' : 'image';
    }

    const { data: { user } } = await supabase.auth.getUser();
    const classroom = AppState.get('classroom');

    // Collect tagged student IDs
    const taggedSids = [...document.querySelectorAll('#postTagChips button[data-sid].bg-orange-100')]
      .map(b => Number(b.dataset.sid));

    const { error } = await supabase.from('posts').insert({
      content,
      media_url: mediaUrl,
      media_type: mediaType,
      teacher_id: user.id,
      classroom_id: classroom.id,
      ...(taggedSids.length ? { tagged_students: taggedSids } : {})
    });

    if (error) throw error;

    safeToast('Publicación creada con éxito', 'success');
    Modal.close('newPostModal');
    window.WallModule.loadPosts('muroPostsContainer');

    // Notificar a padres del aula vía push + email (process-event maneja ambos)
    const students = AppState.get('students') || [];
    const parentIds = [...new Set(students.map(s => s.parent_id).filter(Boolean))];
    const preview = content.length > 80 ? content.substring(0, 80) + '…' : content;

    // Enviar push en paralelo a todos los padres
    const pushPromises = parentIds.map(parentId =>
      sendPush({
        user_id: parentId,
        title: `📢 Nueva publicación — ${classroom?.name || 'Aula'}`,
        message: preview,
        type: 'post',
        link: '/panel_padres.html#feed'
      }).catch(() => null)
    );
    const pushResults = await Promise.allSettled(pushPromises);
    const pushSent = pushResults.filter(r => r.status === 'fulfilled' && r.value?.ok !== false).length;

    // Email vía process-event (en background, no bloquea UI)
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    const profile = (await supabase.from('profiles').select('name').eq('id', currentUser?.id).maybeSingle()).data;
    emitEvent('post.created', {
      classroom_id: classroom?.id,
      teacher_name: profile?.name || 'La maestra',
      content_preview: preview
    }).catch(() => {});

    // Mostrar banner de confirmación de envío
    const { showNotifyFeedback } = await import('/js/shared/notify-feedback.js');
    if (pushSent > 0) {
      showNotifyFeedback({ sent: pushSent, type: 'post', label: 'Muro Escolar' });
    } else if (parentIds.length > 0) {
      safeToast(`Publicación enviada a ${parentIds.length} padres`, 'info');
    }

  } catch (err) {
    safeToast('Error al crear publicación', 'error');
    btn.disabled = false;
    btn.innerHTML = 'PUBLICAR';
  }
}

/**
 * Cargar insignias de mensajes no leídos para la maestra
 */
async function loadMaestraUnreadBadge(userId) {
  try {
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', userId)
      .eq('is_read', false);
    
    const badge = document.getElementById('badge-t-chat');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  } catch (_) {}
}

/**
 * Cargar insignias de tareas pendientes por calificar
 */
async function loadPendingTasksBadge(classroomId) {
  try {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('classroom_id', classroomId);
    const taskIds = (tasks || []).map(t => t.id);

    let count = 0;
    if (taskIds.length) {
      const res = await supabase
        .from('task_evidences')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .in('task_id', taskIds);
      count = res.count || 0;
    }

    const badge = document.getElementById('badge-t-home');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  } catch (_) {}
}

/**
 * Cargar insignia de tareas pendientes para TODAS las aulas de la maestra
 */
async function loadAllClassroomsTasksBadge(classrooms) {
  try {
    let totalCount = 0;
    for (const c of classrooms) {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id')
        .eq('classroom_id', c.id);
      const taskIds = (tasks || []).map(t => t.id);
      if (!taskIds.length) continue;
      const res = await supabase
        .from('task_evidences')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .in('task_id', taskIds);
      totalCount += res.count || 0;
    }

    const badge = document.getElementById('badge-t-home');
    if (badge) {
      if (totalCount > 0) {
        badge.textContent = totalCount > 99 ? '99+' : totalCount;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  } catch (_) {}
}

/**
 * Cargar insignia de calificaciones pendientes por llenar (badge-t-grades)
 */
async function loadPendingGradesBadge() {
  try {
    const classroom = AppState.get('classroom');
    if (!classroom) return;
    const periodRes = await supabase.rpc('get_active_period', { p_classroom_id: classroom.id });
    const period = periodRes?.data;
    if (!period || !period.found) return;

    const [activities, students, config] = await Promise.all([
      MaestraApi.getActivitiesWithGrades(period.id, classroom.id),
      MaestraApi.getStudentsByClassroom(classroom.id),
      MaestraApi.getPeriodConfig(period.id, classroom.id)
    ]);
    const tasks = await MaestraApi.getTasksForPeriod(config);
    const taskScores = await MaestraApi.getTaskScoresForStudents(tasks.map(t => t.id));
    const actCount = (activities || []).length;
    const taskCount = (tasks || []).length;
    const studentCount = (students || []).length;
    const graded = (activities || []).reduce((s, a) => s + (Number(a.graded_count) || 0), 0) + taskScores.length;
    const pending = Math.max(0, ((actCount + taskCount) * studentCount) - graded);

    const badge = document.getElementById('badge-t-grades');
    if (!badge) return;
    if (pending > 0) {
      badge.textContent = pending > 99 ? '99+' : String(pending);
      badge.classList.remove('hidden');
      badge.classList.add('flex');
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('flex');
    }
  } catch (_) {}
}

/**
 * Inicializar QR de la maestra
 */
function _initMaestraQR(profile, user) {
  const container = document.getElementById('maestra-qr-container');
  const matriculaEl = document.getElementById('maestra-qr-matricula');
  
  if (matriculaEl) {
    matriculaEl.textContent = user.id;
  }
  
  if (!container) return;
  
  const qrData = JSON.stringify({
    id: user.id,
    role: 'maestra',
    name: profile?.name || 'Maestra'
  });
  
  // Usar una API de QR externa o librería si está disponible
  container.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}" class="mx-auto border-4 border-white shadow-lg rounded-2xl" alt="QR Maestra">`;
}

/**
 * ✅ Card de mensajes sin responder — se muestra en el dashboard
 */
async function _renderUnreadMessagesCard() {
  try {
    // ✅ Eliminar tarjeta previa SIEMPRE: evita duplicados al volver al home
    // y elimina tarjetas obsoletas cuando ya se leyó/respondió en el chat.
    document.getElementById('unreadMessagesCard')?.remove();

    const grid = document.getElementById('classesGrid');
    if (!grid) return;
    const user = AppState.get('user');
    if (!user) return;

    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', user.id)
      .eq('is_read', false);
    const total = count || 0;
    if (total <= 0) return;

    const card = document.createElement('div');
    card.id = 'unreadMessagesCard';
    card.className = 'col-span-full';
    card.innerHTML = `
      <div onclick="App.setActiveSection('t-chat')" class="p-5 bg-gradient-to-r from-rose-50 to-orange-50 rounded-[2rem] border-2 border-rose-200 shadow-sm hover:shadow-lg hover:border-rose-300 transition-all cursor-pointer flex items-center gap-4">
        <div class="w-14 h-14 rounded-2xl bg-rose-500 text-white flex items-center justify-center shadow-lg">
          <i data-lucide="message-square" class="w-7 h-7"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-black text-slate-800 text-lg">Tienes ${total} mensaje${total > 1 ? 's' : ''} sin leer</div>
          <div class="text-xs font-bold text-rose-500 uppercase tracking-widest">De padres esperando respuesta</div>
        </div>
        <div class="shrink-0">
          <i data-lucide="arrow-right" class="w-6 h-6 text-rose-400"></i>
        </div>
      </div>`;
    grid.parentNode.insertBefore(card, grid.nextSibling);
    if (window.lucide) window.lucide.createIcons();
  } catch (_) {}
}

function initGrades() {
  Tasks.initGradesV2();
}
