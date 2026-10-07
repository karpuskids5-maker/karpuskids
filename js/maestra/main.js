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

// La columna posts.thumbnail_urls puede no existir aún en la BD
// (migraciones/operativos/25_wall_video_thumbnails_strip.sql). Si PostgREST
// responde 400 por ella, se desactiva y el insert se reintenta sin la columna.
let _supportsThumbUrls = null; // null: desconocido / true | false
const _isMissingColumnError = (err, col) =>
  !!err && (err.code === '42703' || new RegExp(String.raw`\b${col}\b`, 'i').test(err.message || ''));

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
    cancelAttendanceLongPress: Attendance.cancelAttendanceLongPress,
    shouldIgnoreAttendanceClick: Attendance.shouldIgnoreAttendanceClick,
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
  viewSubmissionPane: Tasks.viewSubmissionPane,
  openSubmission: Tasks.openSubmission,
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

  // Item #13: despliega la ficha médica dentro de la tarjeta del alumno
  _kkToggleStudentCard: (btn) => {
    const panel = btn?.parentElement?.querySelector('.kk-student-expanded');
    if (!panel) return;
    const open = panel.classList.toggle('hidden');
    btn.setAttribute('aria-expanded', String(!open));
    btn.querySelector('.kk-chev')?.style.setProperty('transform', open ? '' : 'rotate(180deg)');
  },

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

  // EXPOSICIÓN GLOBAL DE WALLMODULE — Proxy UNIVERSAL con caché (mismo patrón
  // que directora/asistente). El muro inyecta HTML con oninput/onclick inline
  // que llaman a WallModule.<metodo>() sobre la variable GLOBAL. En vez de
  // mantener una lista manual (que se puede quedar corta), el Proxy reenvía
  // CUALQUIER método al módulo real con reenvío dinámico cacheado: likes,
  // comentarios, reproducción de video (playVideoCard/_showVideoPreview/
  // _hideVideoPreview/_onVideoError/_replayVideo/_toggleAudio) y cualquier
  // método futuro siempre funcionan.
  const _wallModuleCache = {};
  const _forwardWall = (prop) => (...args) =>
    import('/js/shared/wall.js').then(m => {
      const fn = m.WallModule[prop];
      if (typeof fn !== 'function') throw new Error(`WallModule.${prop} no es una función`);
      return fn.apply(m.WallModule, args);
    });
  window.WallModule = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (!(prop in _wallModuleCache)) _wallModuleCache[prop] = _forwardWall(prop);
      return _wallModuleCache[prop];
    },
  });

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
 * 🧒 Tarjeta de estudiante expandible · Items #5 (alerta de salud), #13
 * (expediente médico sin salir del aula) y #32 (teléfono directo del tutor).
 *
 * La tarjeta lleva `data-student-id` para que el buscador y el filtro de
 * salud la encuentren, y `alergia-alert` / `.alumno-health-badge` como
 * anclas del filtro de alertas médicas.
 */
function _renderStudentCard(s) {
  const hasAllergy   = !!(s.allergies && !/^ninguna$/i.test(s.allergies.trim()));
  const hasMedication= !!(s.medications || s.medical_conditions);
  const hasHealth    = hasAllergy || hasMedication;

  const healthChip = hasHealth
    ? `<span class="alumno-health-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[9px] font-black uppercase tracking-wider">
         <i data-lucide="heart-pulse" class="w-2.5 h-2.5"></i> Salud
       </span>`
    : '';

  const allergyRow = hasAllergy
    ? `<div class="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2">
         <i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-rose-500 mt-0.5 shrink-0"></i>
         <div class="min-w-0">
           <p class="text-[9px] font-black uppercase tracking-widest text-rose-500">Alergia</p>
           <p class="text-[10px] font-medium text-rose-700 break-words whitespace-pre-line">${safeEscapeHTML(s.allergies)}</p>
         </div>
       </div>`
    : '';

  const medRow = hasMedication
    ? `<div class="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
         <i data-lucide="pill" class="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0"></i>
         <div class="min-w-0">
           <p class="text-[9px] font-black uppercase tracking-widest text-amber-600">Medicación / Condición</p>
           <p class="text-xs font-bold text-amber-900 break-words">${safeEscapeHTML(s.medications || s.medical_conditions)}</p>
         </div>
       </div>`
    : '';

  const notesRow = s.medical_notes
    ? `<div class="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
         <i data-lucide="clipboard-list" class="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0"></i>
         <p class="text-xs text-slate-600 break-words">${safeEscapeHTML(s.medical_notes)}</p>
       </div>`
    : '';

  const phone = s.p1_phone || s.p2_phone || '';
  const phoneBtn = phone
    ? `<a href="tel:${safeEscapeHTML(phone)}" class="py-2.5 bg-emerald-50 text-emerald-700 rounded-xl text-[10px] font-black uppercase hover:bg-emerald-600 hover:text-white transition-all flex items-center justify-center gap-1.5" title="Llamar al tutor">
         <i data-lucide="phone-call" class="w-3 h-3"></i> Llamar
       </a>`
    : `<span class="py-2.5 bg-slate-50 text-slate-300 rounded-xl text-[10px] font-black uppercase flex items-center justify-center cursor-not-allowed">Sin tel.</span>`;

  return `
    <div class="p-6 bg-white rounded-[2rem] border ${hasAllergy ? 'alergia-alert border-rose-200' : 'border-slate-100'} shadow-sm hover:shadow-xl transition-all group" data-student-id="${s.id}">
      <div class="flex items-start gap-4 mb-4">
        <div class="relative w-16 h-16 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center font-bold text-2xl overflow-hidden shrink-0">
          ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
          ${hasAllergy ? '<span class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 border-2 border-white animate-pulse" title="Alergia registrada"></span>' : ''}
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-black text-slate-800 text-lg truncate">${safeEscapeHTML(s.name)}</div>
          <div class="flex flex-wrap items-center gap-1.5 mt-1">
            <span class="text-[10px] font-black uppercase tracking-widest text-orange-500">Estudiante</span>
            ${healthChip}
          </div>
          ${phone ? `<p class="text-[11px] font-bold text-slate-400 mt-1 truncate">${safeEscapeHTML(s.p1_name || 'Tutor')}</p>` : ''}
        </div>
      </div>

      <button type="button" data-ripple onclick="window._kkToggleStudentCard(this)" aria-expanded="false"
        class="w-full mb-3 py-2 bg-slate-50 text-slate-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-100 transition-all flex items-center justify-center gap-1.5">
        <i data-lucide="chevron-down" class="w-3 h-3 transition-transform kk-chev"></i> Ficha médica
      </button>

      <div class="kk-student-expanded hidden mb-3 space-y-2">
        ${allergyRow}${medRow}${notesRow}
        ${s.blood_type ? `<div class="flex items-center gap-2 px-3 py-2"><i data-lucide="droplet" class="w-3.5 h-3.5 text-rose-400"></i><span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Sangre</span><span class="text-xs font-black text-slate-700">${safeEscapeHTML(s.blood_type)}</span></div>` : ''}
        <div class="flex items-center gap-2 px-3 py-2">
          <i data-lucide="shield-check" class="w-3.5 h-3.5 text-emerald-500"></i>
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-400">Retiro</span>
          <span class="text-xs font-bold text-slate-700 break-words">${safeEscapeHTML(s.authorized_pickup || 'Tutor 1 autorizado')}</span>
        </div>
        ${s.emergency_protocol ? `<div class="flex items-start gap-2 rounded-xl bg-orange-50 border border-orange-200 px-3 py-2"><i data-lucide="siren" class="w-3.5 h-3.5 text-orange-500 mt-0.5 shrink-0"></i><p class="text-xs text-orange-900 break-words">${safeEscapeHTML(s.emergency_protocol)}</p></div>` : ''}
        ${!allergyRow && !medRow && !notesRow ? '<p class="text-xs text-slate-400 italic">Sin registros médicos.</p>' : ''}
      </div>

      <div class="grid grid-cols-2 gap-2">
        <button onclick="App.openStudentProfile('${s.id}')" class="py-2.5 bg-slate-50 text-slate-600 rounded-xl text-[10px] font-black uppercase hover:bg-orange-600 hover:text-white transition-all">Ver Perfil</button>
        ${phoneBtn}
        <button onclick="App.registerIncidentModal('${s.id}')" class="col-span-2 py-2.5 bg-rose-50 text-rose-600 rounded-xl text-[10px] font-black uppercase hover:bg-rose-600 hover:text-white transition-all">Reportar Incidencia</button>
      </div>
    </div>
  `;
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

    // Auto-detección de ausentes en background (check_in_end + 2h)
    MaestraApi.markAbsentStudents()
      .then(async (res) => {
        if ((res.marked || 0) > 0) {
          const att = await MaestraApi.getAttendance(classroom.id, today);
          AppState.set('attendance', att || []);
          UI.updateDashboardStats({
            present: (att || []).filter(a => ['present', 'late'].includes(a.status)).length,
            absent: (att || []).filter(a => ['absent', 'ausente'].includes(a.status)).length
          });
        }
      })
      .catch(() => {});

    AppState.set('students', students || []);
    AppState.set('attendance', attendance || []);

    // Actualizar Estadísticas (Bloques)
    UI.updateDashboardStats({
      students: students?.length || 0,
      present: (attendance || []).filter(a => ['present', 'late'].includes(a.status)).length,
      absent: (attendance || []).filter(a => ['absent', 'ausente'].includes(a.status)).length,
      incidents: incidentRes.count || 0,
      classes: classesRes.count || 0
    });

    _updateNextActivityWidget();
    _updatePunchAlertWidget(students, attendance);
    _updateTasksToGradeWidget(classroom.id);
    _refreshTasksDeliveredProgress();

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
        classGrid.innerHTML = students.map(s => _renderStudentCard(s)).join('');
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
    let thumbnailUrl = null;
    let thumbnailUrls = [];
    let videoDuration = 0;

    if (file) {
      const isVideo = file.type.startsWith('video/');
      const ext = isVideo ? file.name.split('.').pop() : 'webp';
      const path = `posts/${Date.now()}_${crypto.randomUUID()}.${ext}`;

      if (isVideo) {
        const result = await ImageLoader.uploadVideoWithThumbnails(file, { onProgress: setProgress });
        mediaUrl = result.publicUrl;
        thumbnailUrl = result.thumbnailUrl;
        thumbnailUrls = result.thumbnailUrls;
        videoDuration = result.duration || 0;
      } else {
        mediaUrl = await ImageLoader.uploadToStorage(file, 'karpus-uploads', path, {
          maxWidth: 1200,
          quality: 0.8,
          onProgress: setProgress
        });
      }
      mediaType = isVideo ? 'video' : 'image';
    }

    const { data: { user } } = await supabase.auth.getUser();
    const classroom = AppState.get('classroom');

    // Collect tagged student IDs
    const taggedSids = [...document.querySelectorAll('#postTagChips button[data-sid].bg-orange-100')]
      .map(b => Number(b.dataset.sid));

    const postPayload = {
      content,
      media_url: mediaUrl,
      media_type: mediaType,
      thumbnail_url: thumbnailUrl || null,
      thumbnail_urls: (thumbnailUrls && thumbnailUrls.length ? thumbnailUrls : null),
      duration: videoDuration || null,
      teacher_id: user.id,
      classroom_id: classroom.id,
      ...(taggedSids.length ? { tagged_students: taggedSids } : {})
    };

    let { error } = await supabase.from('posts').insert(postPayload);
    // Fallback: si la columna thumbnail_urls no existe aún en la BD, reintentar sin ella
    if (error?.code === 'PGRST204' && error.message?.includes('thumbnail_urls')) {
      const { thumbnail_urls: _dropped, ...payloadWithout } = postPayload;
      ({ error } = await supabase.from('posts').insert(payloadWithout));
    }

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

/* ════════════════════════════════════════════════════════════
   🏫 PANEL MAESTRA · 50 OPTIMIZACIONES · JS BLOQUE
   20 Funcionales + 15 UX + Integración HTML/CSS
   Arquitectura resiliente: return early + try/catch por helper
   ════════════════════════════════════════════════════════════ */

const _kkMaestra = {
  _cameraStream: null,
  _mediaRecorder: null,
  _recordedChunks: [],
  _camRecordingTimer: null,
  _camActiveTag: 'actividad',
  _incidentDraftTimer: null,
  _pendingSyncCounter: 0,
  _lastRoutineQuickEvent: null,
  _bulkRoutineMode: false,
  _bulkSelectedStudents: new Set(),
  _lastGreetingShown: null,
};

/* ── 1. RIPPLE TÁCTIL · Item #15 ── */
function _setupRippleTactil() {
  try {
    const els = document.querySelectorAll('[data-ripple]');
    els.forEach(el => {
      if (el._rippleBound) return;
      el._rippleBound = true;
      el.addEventListener('pointerdown', (e) => {
        const r = el.getBoundingClientRect();
        const x = ((e.clientX || (r.left + r.width / 2)) - r.left);
        const y = ((e.clientY || (r.top + r.height / 2)) - r.top);
        el.style.setProperty('--rx', (x / r.width * 100).toFixed(1) + '%');
        el.style.setProperty('--ry', (y / r.height * 100).toFixed(1) + '%');
      });
    });
  } catch (e) { console.warn('[Ripple]', e?.message); }
}

/* ── 2. FAB TOOLBAR · Items #14 #50 (ergonómico pulgar) ── */
function _setupFABToolbar() {
  const btn = document.getElementById('btnMaestraFABToggle');
  const menu = document.getElementById('maestraFABMenu');
  const icon = document.getElementById('fabToggleIcon');
  if (!btn || !menu) return;
  if (btn._fabBound) return; btn._fabBound = true;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle('is-open');
    btn.classList.toggle('is-open', open);
    if (icon) icon.setAttribute('data-lucide', open ? 'x' : 'plus');
    if (window.lucide) window.lucide.createIcons();
  });
  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('is-open')) return;
    if (e.target.closest('#maestraFABToolbar')) return;
    menu.classList.remove('is-open');
    btn.classList.remove('is-open');
    if (icon) { icon.setAttribute('data-lucide', 'plus'); if (window.lucide) window.lucide.createIcons(); }
  });
}

/* ── 3. BACK TO TOP · Item #46 ── */
function _setupBackToTop() {
  const btn = document.getElementById('btnMaestraBackToTop');
  const shell = document.getElementById('layoutShell');
  if (!btn) return;
  if (btn._bttBound) return; btn._bttBound = true;
  const onScroll = () => {
    const y = (shell?.scrollTop || window.scrollY || 0);
    if (y > 500) btn.classList.add('is-visible'); else btn.classList.remove('is-visible');
  };
  const target = shell || window;
  target.addEventListener('scroll', onScroll, { passive: true });
  btn.addEventListener('click', () => {
    if (shell) shell.scrollTo({ top: 0, behavior: 'smooth' }); else window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  onScroll();
}

/* ── 4. DEVICE STATUS · Item #44 (batería, red) ── */
function _setupDeviceStatus() {
  const box = document.getElementById('deviceStatusBadge');
  const netText = document.getElementById('netStatusText');
  const netIcon = document.getElementById('netStatusIcon');
  const battText = document.getElementById('batteryText');
  const battIcon = document.getElementById('batteryIcon');
  if (!box) return;
  const updateNet = () => {
    try {
      const on = navigator.onLine !== false;
      const conn = (navigator.connection || navigator.mozConnection || navigator.webkitConnection);
      const type = conn?.effectiveType || (on ? 'wifi' : 'offline');
      box.classList.toggle('net-offline', !on);
      box.classList.toggle('net-cellular', on && type && type.startsWith('4') === false && type.startsWith('3') === false);
      if (netText) netText.textContent = !on ? 'Offline' : (conn?.type === 'wifi' ? 'Wi-Fi' : (type.toUpperCase() || 'Red'));
      if (netIcon && window.lucide) {
        const i = !on ? 'wifi-off' : (conn?.type === 'cellular' ? 'signal' : 'wifi');
        netIcon.innerHTML = `<i data-lucide="${i}" class="w-3.5 h-3.5"></i>`;
      }
    } catch (_) {}
  };
  const updateBatt = async () => {
    try {
      if (!navigator.getBattery) return;
      const b = await navigator.getBattery();
      const pct = Math.round((b.level || 0) * 100);
      if (battText) battText.textContent = pct + '%';
      box.classList.toggle('batt-low', !b.charging && pct <= 20);
      box.classList.toggle('charging', !!b.charging);
      if (battIcon && window.lucide) {
        const tier = b.charging ? 'battery-charging' : (pct <= 20 ? 'battery-low' : (pct <= 60 ? 'battery-medium' : 'battery-full'));
        battIcon.innerHTML = `<i data-lucide="${tier}" class="w-3.5 h-3.5"></i>`;
        window.lucide.createIcons();
      }
    } catch (_) {}
  };
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);
  updateNet(); updateBatt();
  setInterval(updateBatt, 60000);
}

/* ── 5. CLOUD SYNC BADGE · Item #11 ── */
function _setCloudSync(state = 'synced', text = null) {
  const el = document.getElementById('cloudSyncBadge');
  const tEl = document.getElementById('cloudSyncText');
  if (!el) return;
  el.classList.remove('syncing', 'offline');
  if (state === 'syncing') el.classList.add('syncing');
  if (state === 'offline') el.classList.add('offline');
  if (tEl) tEl.textContent = text || ({ synced: 'Sincronizado', syncing: 'Guardando…', offline: 'Modo Offline' }[state] || 'Sincronizado');
}
function _setupCloudSyncListener() {
  try {
    _setCloudSync(navigator.onLine === false ? 'offline' : 'synced');
    window.addEventListener('online', () => _setCloudSync('synced'));
    window.addEventListener('offline', () => _setCloudSync('offline'));
    document.addEventListener('supabase:request:start', () => _setCloudSync('syncing'));
    document.addEventListener('supabase:request:end', () => setTimeout(() => _setCloudSync('synced'), 400));
  } catch (_) {}
}

/* ── 6. HEADER ASISTENCIA + MATRIZ + FILTER · Items #1 #2 #4 #16 ── */
let _attFilter = 'all';
let _attFilterBound = false;

function _updateAttendanceHeaderCounts(counts) {
  try {
    const c = counts || { total: 0, present: 0, absent: 0, late: 0, excused: 0 };
    const counter = document.getElementById('attendanceCounter');
    const countText = document.getElementById('attendanceCountText');
    const prog = document.getElementById('attendanceCountProgress');
    if (counter) counter.textContent = `${c.present || 0} / ${c.total || 0} Estudiantes`;
    if (countText) countText.textContent = (c.present || 0) + '/' + (c.total || 0);
    if (prog) {
      const pct = c.total ? Math.max(0, Math.min(100, ((c.present || 0) / c.total) * 100)) : 0;
      const dash = 100; const circ = 2 * Math.PI * 15.9;
      prog.setAttribute('stroke-dasharray', circ);
      prog.setAttribute('stroke-dashoffset', (circ * (1 - pct / 100)).toFixed(2));
    }
    ['all', 'present', 'absent', 'late', 'excused'].forEach(k => {
      const span = document.querySelector(`.att-count-${k}`);
      if (span) span.textContent = k === 'all' ? (c.total || 0) : (c[k] || 0);
    });
    _checkClassroomCapacity(c.total, c.present);
  } catch (e) { console.warn('[AttHeader]', e?.message); }
}

function _setupAttendanceFilterChips() {
  try {
    const chips = document.querySelectorAll('#attendanceFilterChips .att-filter-chip');
    if (!chips.length) return;
    if (!_attFilterBound) {
      _attFilterBound = true;
      chips.forEach(chip => {
        if (chip._attBound) return; chip._attBound = true;
        chip.addEventListener('click', () => {
          chips.forEach(c => c.classList.remove('att-filter-active'));
          chip.classList.add('att-filter-active');
          _attFilter = chip.dataset.attFilter || 'all';
          _applyAttendanceFilter();
        });
      });
    }
    _applyAttendanceFilter();
  } catch (e) { console.warn('[AttFilter]', e?.message); }
}

/** Aplica el chip activo sobre las tarjetas recién renderizadas (Item #1) */
function _applyAttendanceFilter() {
  const filter = _attFilter || 'all';
  document.querySelectorAll('#attendanceList .att-card').forEach(card => {
    card.style.display = (filter === 'all' || card.dataset.status === filter) ? '' : 'none';
  });
}

function _setupMarkAllPresentButton() {
  try {
    const btn = document.getElementById('btnMarkAllPresent');
    if (!btn || btn._mapBound) return; btn._mapBound = true;
    btn.addEventListener('click', async () => {
      try {
        _setCloudSync('syncing');
        if (typeof Attendance.markAllPresent === 'function') {
          await Attendance.markAllPresent();
        } else if (typeof window.App.markAllPresent === 'function') {
          await window.App.markAllPresent();
        }
        safeToast('✅ Todos marcados presentes', 'success');
        setTimeout(() => _setCloudSync('synced'), 600);
      } catch (e) { safeToast('Error al marcar asistencia', 'error'); _setCloudSync('synced'); }
    });
  } catch (_) {}
}

/* ── 7. CAPACIDAD AULA · Item #35 ── */
function _checkClassroomCapacity(total, present) {
  try {
    const badge = document.getElementById('capacityAlertBadge');
    const textEl = document.getElementById('capacityAlertText');
    if (!badge) return;
    const classroom = AppState.get('classroom') || {};
    const limit = Number(classroom.capacity || classroom.max_students || 0);
    if (!limit) { badge.classList.remove('visible'); return; }
    const over = (present || 0) > limit;
    badge.classList.toggle('visible', over);
    if (textEl && over) textEl.textContent = `${present}/${limit} · Aforo superado`;
  } catch (_) {}
}

/* ── 8. EXPORT ASISTENCIA A EXCEL (CSV UTF-8 BOM) · Item #33 ── */
function _setupExportAttendance() {
  const btn = document.getElementById('btnExportAttendance');
  if (!btn || btn._expBound) return; btn._expBound = true;
  btn.addEventListener('click', async () => {
    try {
      const students = AppState.get('students') || [];
      if (!students.length) return safeToast('No hay alumnos para exportar', 'warning');
      const classroom = AppState.get('classroom') || {};
      const today = new Date().toISOString().slice(0, 10);
      const rows = [['Nombre Alumno', 'Matrícula', 'Fecha', 'Estado', 'Tutor', 'Teléfono']];
      const attRes = await supabase.from('attendance').select('student_id,status').eq('classroom_id', classroom.id).gte('date', today + 'T00:00:00').lte('date', today + 'T23:59:59');
      const attMap = {}; (attRes?.data || []).forEach(a => attMap[a.student_id] = a.status);
      students.forEach(s => rows.push([s.name || '', s.id || '', today, attMap[s.id] || 'Pendiente', s.parent_name || s.tutor_name || '', s.parent_phone || '']));
      const csv = rows.map(r => r.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `asistencia_${classroom.name?.replace(/\s+/g,'_') || 'aula'}_${today}.csv`;
      a.click(); URL.revokeObjectURL(url);
      safeToast('✅ Asistencia exportada a CSV', 'success');
    } catch (e) { safeToast('Error exportando CSV', 'error'); }
  });
}

/* ── 7bis. DARK MODE AULA · Item #8 ── */
const _DARK_KEY = 'kk_maestra_dark_mode';
function _isDarkMode() {
  try { return localStorage.getItem(_DARK_KEY) === '1'; } catch (_) { return false; }
}
function _applyDarkMode(on) {
  document.body.classList.toggle('kk-dark', !!on);
  try { localStorage.setItem(_DARK_KEY, on ? '1' : '0'); } catch (_) {}
  const btn = document.getElementById('fabDark');
  const icon = btn?.querySelector('[data-lucide]');
  if (icon) icon.setAttribute('data-lucide', on ? 'sun' : 'moon');
  if (btn) btn.setAttribute('aria-pressed', String(!!on));
  if (window.lucide) window.lucide.createIcons();
}
function _toggleDarkMode() { _applyDarkMode(!_isDarkMode()); }
// Restituye la preferencia apenas el DOM existe (antes del primer render).
function _restoreDarkMode() {
  try { _applyDarkMode(_isDarkMode()); } catch (_) {}
}

/* ── 7ter. ALERTAS DE MEDICAMENTO · Item #21 ── */
/** Extrae hora (HH:MM) de un texto libre tipo "08:00 - 2Pastillas" o "8:00am". */
function _parseMedTime(raw) {
  const m = String(raw || '').match(/(\d{1,2})[:h.](\d{2})/);
  if (!m) return null;
  const h = Math.min(23, parseInt(m[1], 10));
  const min = Math.min(59, parseInt(m[2], 10));
  return h * 60 + min;
}
function _medicationSchedule() {
  const students = AppState.get('students') || [];
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const list = [];
  students.forEach(s => {
    const raw = s.medications || '';
    if (!String(raw).trim()) return;
    String(raw).split(/[;,\n]/).forEach(part => {
      const t = _parseMedTime(part);
      if (t == null) return;
      const dueIn = t - nowMin;
      list.push({ student: s, label: part.trim(), minutes: t, dueIn, overdue: dueIn < 0 && dueIn > -120 });
    });
  });
  return list;
}
function _updateMedicationAlertDot() {
  try {
    const due = _medicationSchedule().filter(m => m.dueIn >= -5 && m.dueIn <= 60);
    document.getElementById('medAlertDot')?.classList.toggle('hidden', due.length === 0);
  } catch (_) {}
}
function _openMedicationAlerts() {
  try {
    const list = _medicationSchedule();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const byTime = [...list].sort((a, b) => a.minutes - b.minutes);
    const rows = byTime.map(m => {
      const diff = m.minutes - nowMin;
      const when = `${String(Math.floor(m.minutes / 60)).padStart(2,'0')}:${String(m.minutes % 60).padStart(2,'0')}`;
      const badge = diff < 0
        ? '<span class="px-2 py-0.5 bg-rose-50 text-rose-600 rounded-full text-[10px] font-black">Atrasada</span>'
        : diff <= 30 ? `<span class="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-[10px] font-black">en ${diff} min</span>`
        : '<span class="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-[10px] font-black">Programada</span>';
      return `<div class="flex items-center gap-3 p-3 rounded-2xl border border-slate-100">
        <div class="w-9 h-9 rounded-xl bg-fuchsia-50 text-fuchsia-600 flex items-center justify-center shrink-0"><i data-lucide="pill" class="w-4 h-4"></i></div>
        <div class="min-w-0 flex-1">
          <p class="font-black text-slate-800 text-xs truncate">${safeEscapeHTML(m.student.name || 'Alumno')}</p>
          <p class="text-[10px] font-bold text-slate-400 truncate">${safeEscapeHTML(m.label)}</p>
        </div>
        <span class="text-xs font-black text-slate-600 tabular-nums">${when}</span>
        ${badge}
      </div>`;
    }).join('');

    openGlobalModal(`
      <div class="p-6 space-y-4 max-w-lg mx-auto">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-2xl bg-fuchsia-100 text-fuchsia-700 flex items-center justify-center"><i data-lucide="pill" class="w-5 h-5"></i></div>
          <div>
            <h3 class="text-xl font-black text-slate-800">Alertas de medicamento</h3>
            <p class="text-[10px] font-black uppercase tracking-wider text-slate-400">Item #21 · ${list.length} medicamento(s) con hora</p>
          </div>
        </div>
        <div class="space-y-2 max-h-[55vh] overflow-auto">
          ${rows || '<p class="text-center p-6 text-slate-400 text-sm font-bold">Ningún medicamento con horario registrado.</p>'}
        </div>
        <div class="flex gap-2 pt-2">
          <button onclick="Modal.close('globalModal')" class="flex-1 px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-sm hover:bg-slate-200">Cerrar</button>
        </div>
      </div>`, true);
    if (window.lucide) window.lucide.createIcons();
  } catch (e) { console.warn('[MedAlerts]', e?.message); }
}

/* ── 7cuart. LECTOR QR DE PUERTA/AULA · Item #22 ── */
function _openAulaQRScanner() {
  try {
    const classroom = AppState.get('classroom') || {};
    const students = AppState.get('students') || [];
    const html = `
    <div class="p-6 space-y-4 max-w-lg mx-auto">
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-2xl bg-cyan-100 text-cyan-700 flex items-center justify-center"><i data-lucide="scan-line" class="w-5 h-5"></i></div>
        <div>
          <h3 class="text-xl font-black text-slate-800">QR de Puerta</h3>
          <p class="text-[10px] font-black uppercase tracking-wider text-slate-400">Item #22 · confirmar retiro de ${safeEscapeHTML(classroom.name || 'aula')}</p>
        </div>
      </div>

      <div class="p-4 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 text-center">
        <i data-lucide="camera" class="w-9 h-9 mx-auto mb-2 text-slate-400"></i>
        <p class="text-xs font-bold text-slate-500 mb-3">Apunta al carnet del alumno (o escribe el código manualmente)</p>
        <input id="aulaQrManual" inputmode="numeric" placeholder="Ej. 1042" class="w-full px-4 py-2.5 bg-white border-2 border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-cyan-500">
      </div>

      <div class="flex gap-2">
        <button onclick="Modal.close('globalModal')" class="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-sm hover:bg-slate-200">Cancelar</button>
        <button id="btnConfirmRetiro" class="flex-1 px-4 py-2.5 bg-cyan-600 text-white rounded-xl font-black text-sm hover:bg-cyan-700 shadow-md">
          <i data-lucide="check" class="w-4 h-4 inline -mt-0.5 mr-1"></i>Confirmar retiro
        </button>
      </div>

      <div class="pt-2 border-t border-slate-100">
        <p class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Alumnos del aula</p>
        <div class="max-h-40 overflow-auto space-y-1">
          ${students.map(s => `
            <button onclick="App._confirmQrRetirement('${s.id}')" class="w-full text-left px-3 py-2 rounded-xl hover:bg-cyan-50 transition-colors flex items-center justify-between">
              <span class="text-xs font-bold text-slate-700">${safeEscapeHTML(s.name || '')}</span>
              <span class="text-[10px] font-black text-slate-400 tabular-nums">${safeEscapeHTML(String(s.matricula || s.id))}</span>
            </button>`).join('')}
        </div>
      </div>
    </div>`;
    openGlobalModal(html, true);
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
      const btn = document.getElementById('btnConfirmRetiro');
      if (btn && !btn._qBound) {
        btn._qBound = true;
        btn.addEventListener('click', () => {
          const code = (document.getElementById('aulaQrManual')?.value || '').trim();
          const s = students.find(x => String(x.matricula || x.id) === code);
          if (!s) return safeToast('Código no encontrado en el aula', 'warning');
          App._confirmQrRetirement(s.id);
        });
      }
    }, 60);
  } catch (e) { console.warn('[AulaQR]', e?.message); }
}
/** Marca el retiro del alumno y lo notifica al tutor. */
async function _confirmQrRetirement(studentId) {
  try {
    const students = AppState.get('students') || [];
    const s = students.find(x => String(x.id) === String(studentId));
    if (!s) return;
    const when = new Date().toISOString();
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('attendance').upsert({
      student_id: s.id,
      classroom_id: AppState.get('classroom')?.id,
      date: when.slice(0, 10),
      status: 'retirado',
      check_out: when,
    }, { onConflict: 'student_id,date' });

    const { notifyParents } = await import('/js/shared/notify-feedback.js');
    notifyParents({
      students: [s],
      title: 'Karpus Kids 👋 Retiro registrado',
      message: `${s.name || 'Su hijo/a'} fue retirado(a) del aula a las ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.`,
      type: 'attendance',
      link: 'panel_padres.html?rutina=' + s.id,
      label: 'Retiro registrado',
    });
    closeGlobalModal();
    safeToast(`✅ Retiro de ${s.name || 'alumno'} registrado`, 'success');
    if (typeof Attendance.initAttendance === 'function') Attendance.initAttendance({ silent: true });
    void user;
  } catch (e) { console.warn('[QrRetire]', e?.message); }
}

/* ── 7quinto. RESUMEN DE FIN DE JORNADA · Item #43 ── */
async function _openDaySummary() {
  try {
    const classroom = AppState.get('classroom') || {};
    const students = AppState.get('students') || [];
    const today = new Date().toISOString().slice(0, 10);

    const { data: att } = await supabase.from('attendance')
      .select('student_id,status').eq('classroom_id', classroom.id).eq('date', today);
    const attMap = {}; (att || []).forEach(a => attMap[a.student_id] = a.status);
    const present = students.filter(s => attMap[s.id] === 'present').length;
    const late = students.filter(s => attMap[s.id] === 'late').length;
    const excused = students.filter(s => attMap[s.id] === 'excused' || attMap[s.id] === 'excusa').length;
    const absent = students.filter(s => attMap[s.id] === 'absent').length;
    const unmarked = students.length - present - late - excused - absent;

    // Rutinas enviadas hoy vs. pendientes (#43: "100% de rutinas enviadas").
    let sent = 0, pending = 0;
    try {
      const { data: logs } = await supabase.from('daily_logs')
        .select('student_id').eq('classroom_id', classroom.id).eq('date', today);
      const sentSet = new Set((logs || []).map(l => l.student_id));
      students.forEach(s => sentSet.has(s.id) ? sent++ : pending++);
    } catch (_) { sent = students.length; pending = 0; }

    const pct = students.length ? Math.round((sent / students.length) * 100) : 0;
    const cell = (label, val, cls) => `
      <div class="p-4 rounded-2xl ${cls} text-center">
        <p class="text-2xl font-black tabular-nums">${val}</p>
        <p class="text-[10px] font-black uppercase tracking-wider mt-0.5 opacity-80">${label}</p>
      </div>`;

    openGlobalModal(`
      <div class="p-6 space-y-4 max-w-lg mx-auto">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center"><i data-lucide="clipboard-check" class="w-5 h-5"></i></div>
          <div>
            <h3 class="text-xl font-black text-slate-800">Cierre de jornada</h3>
            <p class="text-[10px] font-black uppercase tracking-wider text-slate-400">Item #43 · ${safeEscapeHTML(classroom.name || 'Aula')}</p>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          ${cell('Presentes', present, 'bg-emerald-50 text-emerald-700')}
          ${cell('Tarde', late, 'bg-amber-50 text-amber-700')}
          ${cell('Excusa', excused, 'bg-sky-50 text-sky-700')}
          ${cell('Ausentes', absent, 'bg-rose-50 text-rose-700')}
          ${cell('Sin marcar', unmarked, 'bg-slate-100 text-slate-500')}
        </div>

        <div class="p-4 rounded-2xl bg-slate-50 border border-slate-100">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-black uppercase tracking-wider text-slate-600">Rutinas enviadas a padres</span>
            <span class="text-sm font-black tabular-nums ${pct === 100 ? 'text-emerald-600' : 'text-amber-600'}">${pct}%</span>
          </div>
          <div class="h-2.5 w-full bg-slate-200 rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-700 ${pct === 100 ? 'bg-emerald-500' : 'bg-amber-500'}" style="width:${pct}%"></div>
          </div>
          <p class="text-[10px] font-bold text-slate-400 mt-1.5">${sent} de ${students.length} · ${pending} pendiente(s)</p>
        </div>

        <div class="flex gap-2 pt-1">
          <button onclick="Modal.close('globalModal')" class="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-sm hover:bg-slate-200">Cerrar</button>
          <button id="btnDaySummaryReport" class="flex-1 px-4 py-2.5 bg-orange-600 text-white rounded-xl font-black text-sm hover:bg-orange-700 shadow-md">
            <i data-lucide="file-text" class="w-4 h-4 inline -mt-0.5 mr-1"></i>Generar reporte
          </button>
        </div>
      </div>`, true);
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
      const b = document.getElementById('btnDaySummaryReport');
      if (!b || b._dsBound) return; b._dsBound = true;
      b.addEventListener('click', async () => {
        try {
          const g = document.getElementById('btnGenerateReport');
          if (typeof App.openDailyReport === 'function') { App.openDailyReport(); return; }
          if (g) { g.click(); return; }
          safeToast('Reporte no disponible', 'warning');
        } catch (e) { safeToast('Error: ' + (e?.message || ''), 'error'); }
      });
    }, 60);
  } catch (e) { console.warn('[DaySummary]', e?.message); }
}

/* ── 9. BUSCADOR ALUMNOS + FILTRO SALUD · Items #5 #13 #32 ── */
let _studentsQuery = '';
let _studentsHealthOnly = false;

function _applyStudentsFilter() {
  const grid = document.getElementById('classroomStudentsGrid');
  if (!grid) return;
  const q = _studentsQuery.trim().toLowerCase();
  const students = AppState.get('students') || [];
  grid.querySelectorAll('[data-student-id]').forEach(card => {
    const s = students.find(x => String(x.id) === String(card.dataset.studentId));
    if (!s) return;
    const hay = (s.name || '').toLowerCase().includes(q)
      || `${s.last_name || ''}`.toLowerCase().includes(q)
      || (s.p1_name || '').toLowerCase().includes(q)
      || (s.p2_name || '').toLowerCase().includes(q)
      || String(s.p1_phone || '').includes(q)
      || String(s.matricula || '').toLowerCase().includes(q);
    const healthOk = !_studentsHealthOnly
      || card.classList.contains('alergia-alert')
      || !!card.querySelector('.alumno-health-badge');
    card.style.display = (hay && healthOk) ? '' : 'none';
  });
}

function _setupStudentsSearchAndHealth() {
  try {
    const input = document.getElementById('maestraStudentsSearch');
    const healthBtn = document.getElementById('btnFilterHealthAlerts');
    if (input && !input._sBound) { input._sBound = true;
      input.addEventListener('input', () => { _studentsQuery = input.value; _applyStudentsFilter(); });
    }
    if (healthBtn && !healthBtn._hBound) { healthBtn._hBound = true;
      healthBtn.addEventListener('click', () => {
        _studentsHealthOnly = !_studentsHealthOnly;
        healthBtn.classList.toggle('bg-rose-100', _studentsHealthOnly);
        healthBtn.classList.toggle('border-rose-300', _studentsHealthOnly);
        _applyStudentsFilter();
      });
    }
  } catch (e) { console.warn('[StudentsSearch]', e?.message); }
}

/* ── 10. TASKS PROGRESS BAR + BULK GRADE · Items #6 #19 #27 #34 ── */
function _updateTasksDeliveredProgress(meta) {
  try {
    const m = meta || { total: 0, delivered: 0, pending: 0, graded: 0 };
    const text = document.getElementById('tasksDeliveredText');
    const bar = document.getElementById('tasksDeliveredBar');
    const badge = document.getElementById('tasksPendingBadge');
    const pct = m.total ? Math.max(0, Math.min(100, ((m.delivered || 0) / m.total) * 100)) : 0;
    if (text) text.textContent = `${m.delivered || 0} / ${m.total || 0} entregados`;
    if (bar) bar.style.width = pct + '%';
    if (badge) {
      badge.innerHTML = `<i data-lucide="hourglass" class="w-3 h-3 mr-1"></i>${m.pending ?? 0}`;
      badge.classList.toggle('bg-amber-50', (m.pending ?? 0) === 0);
      badge.classList.toggle('border-amber-200', (m.pending ?? 0) === 0);
      badge.classList.toggle('text-amber-700', (m.pending ?? 0) === 0);
      badge.classList.toggle('bg-rose-50', (m.pending ?? 0) > 0);
      badge.classList.toggle('border-rose-200', (m.pending ?? 0) > 0);
      badge.classList.toggle('text-rose-700', (m.pending ?? 0) > 0);
      if (window.lucide) window.lucide.createIcons();
    }
    AppState.set('tasksProgress', m);
  } catch (e) { console.warn('[TasksProg]', e?.message); }
}

/** Recalcula la barra de progreso desde los datos ya cargados (Item #6) */
function _refreshTasksDeliveredProgress() {
  try {
    const students = (AppState.get('students') || []).length;
    const cached = AppState.get('tasksProgress');
    if (!cached || !students) return;
    _updateTasksDeliveredProgress(cached);
  } catch (_) {}
}
function _setupTasksPendingFilter() {
  const sel = document.getElementById('tasksPendingFilter');
  if (!sel || sel._fBound) return; sel._fBound = true;
  sel.addEventListener('change', () => {
    if (typeof Tasks.setTasksFilter === 'function') Tasks.setTasksFilter(sel.value);
  });
}
function _setupBulkGradeShortcuts() {
  try {
    const btns = document.querySelectorAll('.grade-shortcut-btn');
    btns.forEach(b => { if (b._gBound) return; b._gBound = true;
      b.addEventListener('click', () => {
        btns.forEach(x => x.classList.remove('is-active'));
        b.classList.add('is-active');
        AppState.set('lastBulkGrade', b.dataset.grade);
      });
    });
  } catch (_) {}
}

/* ── 11. GRADES EXCEL-LIKE GRID · Item #7 #20 (comentarios IA/plantillas) ── */
function _renderGradesExcelGrid(students, subjects, gradesMatrix) {
  try {
    const ph = document.getElementById('gradesGridPlaceholder');
    const grid = document.getElementById('gradesExcelGrid');
    const headRow = document.getElementById('gradesHeaderRow');
    const body = document.getElementById('gradesBodyRows');
    if (!grid || !headRow || !body) return;
    if (!students || !students.length) { if (ph) ph.classList.remove('hidden'); grid.classList.add('hidden'); return; }
    if (ph) ph.classList.add('hidden'); grid.classList.remove('hidden');
    const subjects2 = subjects || [{ id: 'lectura', name: 'Lectura' }, { id: 'mates', name: 'Matemáticas' }, { id: 'arte', name: 'Arte' }, { id: 'hab-social', name: 'Hab. Sociales' }];
    let htmlHead = `<th class="student-name">Alumno</th>`;
    subjects2.forEach(s => htmlHead += `<th>${s.name}</th>`);
    htmlHead += `<th>Promedio</th>`;
    headRow.innerHTML = htmlHead;
    let bodyHtml = '';
    const gm = gradesMatrix || {};
    students.forEach(s => {
      bodyHtml += `<tr data-student-id="${s.id}">`;
      bodyHtml += `<td class="student-name"><div class="flex items-center gap-2">
        <div class="w-7 h-7 rounded-full bg-orange-100 text-orange-700 text-[10px] font-black flex items-center justify-center shrink-0">${(s.name || '?').charAt(0).toUpperCase()}</div>
        <span>${safeEscapeHTML(s.name || s.full_name || 'Alumno')}</span></div></td>`;
      let sum = 0, count = 0;
      subjects2.forEach(sub => {
        const g = (gm[s.id] && gm[s.id][sub.id]) ? String(gm[s.id][sub.id]).toUpperCase() : '';
        const cls = ['A','B','C','D'].includes(g) ? ` grade-${g}` : '';
        sum += ({ A: 95, B: 80, C: 65, D: 50 }[g] || 0); if (g) count++;
        bodyHtml += `<td class="grade-cell${cls}" contenteditable="true" data-student="${s.id}" data-subject="${sub.id}" spellcheck="false">${g}</td>`;
      });
      const avg = count ? Math.round(sum / count) : 0;
      const tier = avg >= 85 ? 'avg-high' : (avg >= 65 ? 'avg-mid' : 'avg-low');
      bodyHtml += `<td class="${tier}" style="text-align:center;font-weight:900;">${count ? avg : '—'}</td>`;
      bodyHtml += `</tr>`;
    });
    body.innerHTML = bodyHtml;
    body.querySelectorAll('.grade-cell').forEach(cell => {
      cell.addEventListener('focus', () => cell.classList.add('is-focused'));
      cell.addEventListener('blur', () => cell.classList.remove('is-focused'));
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); cell.blur(); _saveGradeCell(cell); }
      });
    });
  } catch (e) { console.warn('[GradesGrid]', e?.message); }
}

/**
 * Alimenta la cuadrícula Excel-Like con datos reales del aula (Item #7).
 * Antes la función existía pero nadie la llamaba, así que la tabla nunca
 * mostraba nada y el placeholder quedaba siempre visible.
 */
async function _loadGradesExcelGrid() {
  try {
    const students = AppState.get('students') || [];
    const periodId = AppState.get('activePeriod')?.id;
    let subjects = [];
    let matrix = {};

    if (periodId) {
      const cfg = await MaestraApi.getPeriodConfig(periodId, AppState.get('classroom')?.id);
      subjects = (cfg || []).map(c => ({ id: String(c.id), name: c.subject_name }));

      const { data: grades } = await supabase
        .from('grades')
        .select('student_id, config_id, score_v2')
        .eq('period_id', periodId);
      (grades || []).forEach(g => {
        if (g.score_v2 == null) return;
        const key = String(g.student_id);
        matrix[key] = matrix[key] || {};
        matrix[key][String(g.config_id)] = _gradeLetterFromScore(g.score_v2);
      });
    }

    _renderGradesExcelGrid(students, subjects, matrix);
  } catch (e) { console.warn('[GradesGridLoad]', e?.message); }
}

/** Convierte un score_v2 (0-100) a la escala A/B/C/D usada por la cuadrícula. */
function _gradeLetterFromScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return '';
  if (n >= 90) return 'A';
  if (n >= 80) return 'B';
  if (n >= 70) return 'C';
  return 'D';
}

/**
 * Atajos de comentarios frecuentes (Item #34) y calificación en lote (Item #19).
 * Publica los botones en el footer del visor de entregas de una tarea.
 */
function _openBulkCommentShortcuts() {
  const PHRASES = [
    '¡Excelente trabajo!',
    '¡Participó muy bien!',
    'Tarea completa y ordenada.',
    'Muy buen esfuerzo esta semana.',
    'Debe reforzar la lectura en casa.',
  ];
  const html = `
  <div class="p-6 space-y-4 max-w-lg mx-auto">
    <div>
      <h3 class="text-xl font-black text-slate-800">Comentarios frecuentes</h3>
      <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1">Item #34 · un toque para insertar</p>
    </div>
    <div class="flex flex-wrap gap-2">
      ${PHRASES.map((p, i) => `<button data-phrase="${safeEscapeHTML(p)}" data-idx="${i}" class="comment-shortcut-btn px-3 py-2 bg-violet-50 border border-violet-200 text-violet-700 rounded-xl text-xs font-black hover:bg-violet-100 transition-all">${safeEscapeHTML(p)}</button>`).join('')}
    </div>
    <div class="flex gap-2 pt-2">
      <button onclick="Modal.close('globalModal')" class="flex-1 px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-sm hover:bg-slate-200">Cerrar</button>
    </div>
  </div>`;
  openGlobalModal(html, true);
  if (window.lucide) window.lucide.createIcons();
  setTimeout(() => {
    document.querySelectorAll('.comment-shortcut-btn').forEach(b => {
      if (b._cBound) return; b._cBound = true;
      b.addEventListener('click', () => {
        const phrase = b.dataset.phrase || '';
        const active = document.activeElement;
        if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
          active.value = (active.value ? active.value + ' ' : '') + phrase;
          active.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          AppState.set('pendingCommentPhrase', phrase);
        }
        closeGlobalModal();
      });
    });
  }, 50);
}
function _saveGradeCell(cell) {
  try {
    const sid = cell.dataset.student; const sub = cell.dataset.subject; const val = (cell.textContent || '').trim().toUpperCase().slice(0, 2);
    cell.textContent = ['A','B','C','D','1','2','3','4','5','6','7','8','9','10'].some(v => val.startsWith(v)) ? val : '';
    cell.classList.remove('grade-A','grade-B','grade-C','grade-D');
    if (['A','B','C','D'].includes(val)) cell.classList.add('grade-' + val);
    if (typeof Tasks.editStudentScore === 'function') Tasks.editStudentScore(sid, sub, val);
    _setCloudSync('syncing');
    setTimeout(() => _setCloudSync('synced'), 500);
  } catch (_) {}
}
function _setupGenerateCommentsButton() {
  const btn = document.getElementById('btnGenerateComments');
  if (!btn || btn._gcBound) return; btn._gcBound = true;
  btn.addEventListener('click', async () => {
    try {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Generando…`;
      if (window.lucide) window.lucide.createIcons();
      const templates = [
        '🌟 Excelente desempeño este período. Participa activamente y muestra gran interés por aprender.',
        '👍 Buen progreso. Continúa practicando en casa para reforzar los temas vistos.',
        '📚 Trabajo constante. Se recomienda repasar semanalmente para fortalecer conocimientos.',
        '💪 Esfuerzo visible. Requiere apoyo adicional en lectura y razonamiento matemático.',
      ];
      const picked = templates[Math.floor(Math.random() * templates.length)];
      AppState.set('aiCommentTemplate', picked);
      const clipboardFallback = () => {
        const ta = document.createElement('textarea');
        ta.value = picked; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch(_){} document.body.removeChild(ta);
      };
      try { await navigator.clipboard.writeText(picked); } catch(_) { clipboardFallback(); }
      safeToast('💡 Comentario sugerido copiado al portapapeles', 'success');
    } catch(e) { safeToast('Error generando comentarios', 'error');
    } finally { btn.disabled = false; btn.innerHTML = `<i data-lucide="sparkles" class="w-3.5 h-3.5"></i> <span class="hidden sm:inline">IA Comentarios</span><span class="sm:hidden">IA</span>`; if (window.lucide) window.lucide.createIcons(); }
  });
}

/* ── 12. ROUTINE TIMELINE RÁPIDO + BATCH · Items #3 #17 ── */
function _setupRoutineQuickChips() {
  try {
    const btns = document.querySelectorAll('.routine-quick-btn');
    const batchBtn = document.getElementById('btnRoutineBatchMode');
    if (!btns.length) return;
    btns.forEach(b => { if (b._rBound) return; b._rBound = true;
      b.addEventListener('click', async () => {
        const ev = b.dataset.event;
        if (!ev) return;
        btns.forEach(x => x.classList.remove('is-selected'));
        b.classList.add('is-selected');
        _kkMaestra._lastRoutineQuickEvent = ev;
        setTimeout(() => b.classList.remove('is-selected'), 800);
        _setCloudSync('syncing');

        // Item #3: el chip registra sobre TODOS los alumnos presentes en menos
        // de 3 s. `quickConfirmBulkEvent` pide confirmación y aplica el lote.
        // Antes se llamaba registerIndividualEvent(ev) — su firma es
        // (sid, type, extra), así que el tipo acababa en el id del alumno.
        if (_kkMaestra._bulkRoutineMode) {
          safeToast('Modo lote · abre Acciones del Aula para elegir alumnos', 'info');
          _setCloudSync('synced');
          return;
        }
        try {
          if (typeof Routine.quickConfirmBulkEvent === 'function') {
            Routine.quickConfirmBulkEvent(ev);
          } else if (typeof Routine.openBulkEventModal === 'function') {
            Routine.openBulkEventModal(ev);
          }
        } catch(e) { safeToast('Error registrando evento', 'error'); }
        setTimeout(() => _setCloudSync('synced'), 700);
      });
    });
    if (batchBtn && !batchBtn._rbBound) { batchBtn._rbBound = true;
      batchBtn.addEventListener('click', () => {
        _kkMaestra._bulkRoutineMode = !_kkMaestra._bulkRoutineMode;
        batchBtn.classList.toggle('is-active', _kkMaestra._bulkRoutineMode);
        safeToast(_kkMaestra._bulkRoutineMode ? '🎯 Modo lote activado' : 'Modo lote desactivado', 'info');
      });
    }
  } catch (e) { console.warn('[RoutineQuick]', e?.message); }
}

/* ── 13. BANNER PRÓXIMA ACTIVIDAD · Item #12 ── */
function _setupBannerProximaActividad() {
  try {
    const banner = document.getElementById('bannerProximaActividad');
    const timeEl = document.getElementById('nextActivityTime');
    const titleEl = document.getElementById('nextActivityTitle');
    const btn = document.getElementById('btnNextActivityAction');
    if (!banner) return;
    const now = new Date();
    const items = [
      { h: 8, m: 30, title: '👋 Bienvenida y Asamblea Matutina' },
      { h: 9, m: 0, title: '📚 Lectura Guiada en grupo' },
      { h: 10, m: 0, title: '➕ Actividad de Matemáticas' },
      { h: 11, m: 30, title: '🍎 Almuerzo en el comedor' },
      { h: 13, m: 0, title: '😴 Hora de la Siesta' },
      { h: 15, m: 0, title: '🎨 Arte y Manualidades' },
      { h: 16, m: 0, title: '🏃 Juegos en el Patio' },
      { h: 16, m: 45, title: '👋 Salida · Entrega a Padres' },
    ];
    const curMin = now.getHours() * 60 + now.getMinutes();
    const next = items.find(x => x.h * 60 + x.m > curMin) || items[0];
    const hh = String(next.h).padStart(2,'0') + ':' + String(next.m).padStart(2,'0');
    if (timeEl) timeEl.textContent = `Próxima · ${hh}`;
    if (titleEl) titleEl.textContent = next.title;
    banner.classList.remove('hidden');
    if (btn && !btn._nbaBound) { btn._nbaBound = true;
      btn.addEventListener('click', () => {
        if (window.App.activateTab) window.App.activateTab('daily-routine');
      });
    }
  } catch (e) { console.warn('[BannerNext]', e?.message); }
}

/* ── 14. CHAT SCHEDULE BADGE · Item #26 ── */
function _setupChatScheduleBadge() {
  try {
    const el = document.getElementById('chatScheduleBadge');
    const dot = document.getElementById('chatScheduleDot');
    const textEl = document.getElementById('chatScheduleText');
    if (!el) return;
    const now = new Date(); const wd = now.getDay(); const hr = now.getHours() * 60 + now.getMinutes();
    const weekday = wd >= 1 && wd <= 5;
    const inHours = weekday && hr >= (7*60+30) && hr <= (17*60+30);
    el.classList.remove('in-hours', 'out-hours', 'silenced');
    if (!weekday) { el.classList.add('silenced'); if (textEl) textEl.textContent = 'Fin de Semana · Silenciado'; }
    else if (inHours) { el.classList.add('in-hours'); if (textEl) textEl.textContent = 'Horario Escolar · Activo'; }
    else { el.classList.add('out-hours'); if (textEl) textEl.textContent = 'Fuera de Horario · Silenciado'; }
    if (dot && window.lucide) {
      const icon = inHours ? 'bell-ring' : 'bell-off';
      dot.parentElement.querySelectorAll('svg').forEach(n => n.remove());
      const ins = document.createElement('i'); ins.setAttribute('data-lucide', icon); ins.className = 'w-3 h-3';
      dot.parentElement.insertBefore(ins, dot.nextSibling);
      window.lucide.createIcons();
    }
  } catch (_) {}
}

/* ── 15. CÁMARA HD + VIDEO 30s + COMPRESIÓN + ETIQUETADO PRIVADO · Items #10 #18 #25 #30 ── */
function _openCameraModal(mode = 'photo') {
  const modal = document.getElementById('cameraPreviewModal');
  const video = document.getElementById('cameraVideo');
  if (!modal) return safeToast('Cámara no disponible', 'warning');
  modal.classList.add('flex'); modal.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
  _setupCameraControlsOnce();
  if (mode === 'video') setTimeout(() => { const b = document.getElementById('btnCameraVideo'); if (b) b.click(); }, 300);
  navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: true })
    .then(stream => {
      if (video) { video.srcObject = stream; _kkMaestra._cameraStream = stream; }
      const ph = document.getElementById('cameraPlaceholder'); if (ph) ph.classList.add('hidden');
    })
    .catch(err => {
      const ph = document.getElementById('cameraPlaceholder'); if (ph) ph.classList.remove('hidden');
      console.warn('[Camera]', err?.message); safeToast('No se pudo acceder a la cámara', 'warning');
    });
}
function _setupCameraControlsOnce() {
  if (_kkMaestra._camControlsBound) return; _kkMaestra._camControlsBound = true;
  const modal = document.getElementById('cameraPreviewModal');
  const close = () => {
    modal.classList.add('hidden'); modal.classList.remove('flex');
    try { _kkMaestra._cameraStream?.getTracks().forEach(t => t.stop()); } catch(_){}
    _kkMaestra._cameraStream = null;
    if (_kkMaestra._camRecordingTimer) { clearInterval(_kkMaestra._camRecordingTimer); _kkMaestra._camRecordingTimer = null; }
  };
  document.getElementById('btnCameraClose')?.addEventListener('click', close);
  modal?.addEventListener('click', (e) => { if (e.target === modal) close(); });

  document.getElementById('btnCameraSwitch')?.addEventListener('click', async () => {
    try {
      const cur = _kkMaestra._cameraStream?.getVideoTracks()[0];
      const curFacing = cur?.getSettings().facingMode === 'environment' ? 'user' : 'environment';
      cur?.stop();
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: curFacing }, audio: true });
      const v = document.getElementById('cameraVideo'); if (v) v.srcObject = s; _kkMaestra._cameraStream = s;
    } catch (_) { safeToast('No se pudo cambiar la cámara', 'warning'); }
  });

  document.getElementById('btnCameraPhoto')?.addEventListener('click', async () => {
    const v = document.getElementById('cameraVideo'); const c = document.getElementById('cameraCanvas');
    if (!v || !c || !v.videoWidth) return;
    try {
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      const blob = await new Promise(res => c.toBlob(b => res(b), 'image/webp', 0.82));
      const file = new File([blob], `foto_${Date.now()}.webp`, { type: 'image/webp' });
      await _uploadCameraMedia(file, 'image');
    } catch(e) { safeToast('Error capturando foto', 'error'); }
  });

  const camTimerBadge = document.getElementById('cameraTimerBadge');
  const camTimerText = document.getElementById('cameraTimerText');
  const camVideoInner = document.getElementById('cameraVideoInner');
  document.getElementById('btnCameraVideo')?.addEventListener('click', async () => {
    if (!_kkMaestra._mediaRecorder || _kkMaestra._mediaRecorder.state !== 'recording') {
      const stream = _kkMaestra._cameraStream;
      if (!stream) return;
      try {
        let recClass = window.MediaRecorder;
        let opts = {};
        ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'].forEach(t => { if (!opts.mimeType && recClass?.isTypeSupported?.(t)) opts.mimeType = t; });
        const rec = new recClass(stream, opts);
        _kkMaestra._recordedChunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) _kkMaestra._recordedChunks.push(e.data); };
        rec.onstop = async () => {
          const blob = new Blob(_kkMaestra._recordedChunks, { type: opts.mimeType || 'video/webm' });
          const file = new File([blob], `video_${Date.now()}.webm`, { type: blob.type });
          try { await _uploadCameraMedia(file, 'video'); } catch(e) { safeToast('Error subiendo video', 'error'); }
          camTimerBadge?.classList.add('hidden'); camTimerBadge?.classList.remove('flex');
          camVideoInner?.classList.remove('is-recording');
        };
        rec.start();
        _kkMaestra._mediaRecorder = rec;
        camVideoInner?.classList.add('is-recording');
        camTimerBadge?.classList.remove('hidden'); camTimerBadge?.classList.add('flex');
        let remain = 30;
        const upd = () => { camTimerText && (camTimerText.textContent = '00:' + String(remain).padStart(2,'0')); };
        upd();
        _kkMaestra._camRecordingTimer = setInterval(() => {
          remain--; upd();
          if (remain <= 0) { clearInterval(_kkMaestra._camRecordingTimer); try { rec.stop(); } catch(_){} }
        }, 1000);
      } catch(e) { safeToast('Video no soportado', 'warning'); console.warn(e); }
    } else {
      try { _kkMaestra._mediaRecorder.stop(); } catch(_){}
      if (_kkMaestra._camRecordingTimer) { clearInterval(_kkMaestra._camRecordingTimer); _kkMaestra._camRecordingTimer = null; }
    }
  });

  document.getElementById('btnCameraUpload')?.addEventListener('click', () => {
    document.getElementById('cameraFileInput')?.click();
  });
  document.getElementById('cameraFileInput')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    await _uploadCameraMedia(f, f.type.startsWith('video') ? 'video' : 'image');
  });

  document.querySelectorAll('.cam-tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cam-tag-btn').forEach(b => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      _kkMaestra._camActiveTag = btn.dataset.tag || 'actividad';
    });
  });
  document.querySelector('.cam-tag-btn[data-tag="actividad"]')?.classList.add('is-selected');
}
async function _uploadCameraMedia(file, type) {
  try {
    _setCloudSync('syncing');
    safeToast(`Subiendo ${type === 'video' ? 'video' : 'foto'}…`, 'info');
    let mediaUrl, thumbnailUrl, duration = 0;
    if (type === 'video') {
      const r = await ImageLoader.uploadVideoWithThumbnails(file, {});
      mediaUrl = r.publicUrl; thumbnailUrl = r.thumbnailUrl; duration = r.duration || 0;
    } else {
      const compressed = await ImageLoader.compress(file, { maxWidth: 1600, quality: 0.82 });
      const ext = (compressed.type || 'image/webp').split('/')[1] || 'webp';
      const path = `posts/cam_${Date.now()}_${crypto.randomUUID()}.${ext}`;
      mediaUrl = await ImageLoader.uploadToStorage(compressed, 'karpus-uploads', path, {});
    }
    const isPrivate = _kkMaestra._camActiveTag === 'privado';
    const { data: { user } } = await supabase.auth.getUser();
    const classroom = AppState.get('classroom');
    const payload = {
      content: `#${_kkMaestra._camActiveTag} · ${new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}`,
      media_url: mediaUrl, media_type: type, thumbnail_url: thumbnailUrl || null,
      teacher_id: user?.id, classroom_id: classroom?.id,
      visibility: isPrivate ? 'tutors_only' : 'classroom',
      tag: _kkMaestra._camActiveTag,
    };
    if (duration) payload.duration = duration;
    const { error } = await supabase.from('posts').insert(payload);
    if (error) throw error;
    safeToast(`✅ ${type === 'video' ? 'Video' : 'Foto'} publicada`, 'success');
    document.getElementById('cameraPreviewModal')?.classList.add('hidden');
    document.getElementById('cameraPreviewModal')?.classList.remove('flex');
    try { _kkMaestra._cameraStream?.getTracks().forEach(t => t.stop()); } catch(_){}
    _setCloudSync('synced');
    setTimeout(() => window.WallModule?.loadPosts?.(), 300);
  } catch(e) { _setCloudSync('synced'); safeToast('Error al subir: ' + (e?.message || ''), 'error'); }
}

/* ── 16. INCIDENT MODAL + AUTO-SAVE 5s · Items #31 #41 ── */
function _openIncidentModal() {
  const m = document.getElementById('incidentModal');
  if (!m) return;
  m.classList.add('flex'); m.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
  _setupIncidentModalOnce();
}
function _setupIncidentModalOnce() {
  if (_kkMaestra._incBound) return; _kkMaestra._incBound = true;
  const close = () => {
    document.getElementById('incidentModal').classList.add('hidden');
    document.getElementById('incidentModal').classList.remove('flex');
  };
  document.getElementById('btnIncidentClose')?.addEventListener('click', close);
  document.getElementById('btnIncidentCancel')?.addEventListener('click', close);
  document.getElementById('incidentModal')?.addEventListener('click', (e) => { if (e.target.id === 'incidentModal') close(); });
  document.querySelectorAll('.incident-type-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.incident-type-btn').forEach(x => x.classList.remove('is-active'));
    b.classList.add('is-active');
    AppState.set('incidentType', b.dataset.type);
  }));
  const descEl = document.getElementById('incidentDescription');
  const statusEl = document.getElementById('incidentDraftStatus');
  descEl?.addEventListener('input', () => {
    if (_kkMaestra._incidentDraftTimer) clearTimeout(_kkMaestra._incidentDraftTimer);
    if (statusEl) statusEl.textContent = 'Escribiendo…';
    _kkMaestra._incidentDraftTimer = setTimeout(() => {
      try {
        const type = AppState.get('incidentType') || 'disciplina';
        localStorage.setItem('incident_draft_' + (AppState.get('classroom')?.id || '0'), JSON.stringify({ type, desc: descEl.value, date: new Date().toISOString() }));
        if (statusEl) statusEl.textContent = 'Borrador guardado · ' + new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
      } catch(_){}
    }, 5000);
  });
  // Cargar borrador previo
  try {
    const raw = localStorage.getItem('incident_draft_' + (AppState.get('classroom')?.id || '0'));
    if (raw) {
      const d = JSON.parse(raw);
      if (d.desc && descEl) descEl.value = d.desc;
      if (d.type) {
        document.querySelectorAll('.incident-type-btn').forEach(b => { if (b.dataset.type === d.type) b.classList.add('is-active'); else b.classList.remove('is-active'); });
        AppState.set('incidentType', d.type);
      }
    }
  } catch(_){}
  document.getElementById('btnIncidentSave')?.addEventListener('click', async () => {
    try {
      const type = AppState.get('incidentType') || document.querySelector('.incident-type-btn.is-active')?.dataset.type;
      const desc = (document.getElementById('incidentDescription')?.value || '').trim();
      const students = document.getElementById('incidentStudents')?.value || '';
      if (!type || !desc) return safeToast('Completa tipo y descripción', 'warning');
      _setCloudSync('syncing');
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('incidents').insert({
        classroom_id: AppState.get('classroom')?.id, reporter_id: user?.id,
        type, description: desc, involved: students || null, reported_at: new Date().toISOString(),
      });
      if (error) throw error;
      localStorage.removeItem('incident_draft_' + (AppState.get('classroom')?.id || '0'));
      close();
      if (descEl) descEl.value = '';
      if (document.getElementById('incidentStudents')) document.getElementById('incidentStudents').value = '';
      safeToast('✅ Incidencia registrada (confidencial)', 'success');
      _setCloudSync('synced');
    } catch(e) { _setCloudSync('synced'); safeToast('Error: ' + (e?.message || ''), 'error'); }
  });
}

/* ── 17. QUICK POLL / ENCUESTA EXPRESA · Item #24 ── */
function _openQuickPoll() {
  const html = `
  <div class="p-6 space-y-4 max-w-xl mx-auto">
    <div class="flex items-center gap-3 mb-2">
      <div class="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center"><i data-lucide="vote" class="w-5 h-5"></i></div>
      <div>
        <h3 class="text-xl font-black text-slate-800">Encuesta Expresa</h3>
        <p class="text-xs font-bold text-slate-500 uppercase tracking-wider">Creada en 30 segundos · Envío a padres</p>
      </div>
    </div>
    <div>
      <label class="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Pregunta</label>
      <input id="quickPollQuestion" placeholder="¿Quién asistirá a la reunión de mañana?" class="w-full px-4 py-2.5 bg-slate-50 border-2 border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500">
    </div>
    <div>
      <label class="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Opciones (separadas por coma)</label>
      <input id="quickPollOptions" value="Sí asistiré, No puedo, Confirmo más tarde" class="w-full px-4 py-2.5 bg-slate-50 border-2 border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500">
    </div>
    <div class="flex gap-2 pt-2">
      <button onclick="Modal.close('globalModal')" class="flex-1 px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-sm hover:bg-slate-200">Cancelar</button>
      <button id="quickPollPublishBtn" class="flex-[2] px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-sm hover:bg-emerald-700 shadow-md">
        <i data-lucide="send" class="w-4 h-4 inline -mt-0.5 mr-1"></i>Publicar Encuesta
      </button>
    </div>
  </div>`;
  openGlobalModal(html, true);
  if (window.lucide) window.lucide.createIcons();
  setTimeout(() => {
    const b = document.getElementById('quickPollPublishBtn');
    if (!b || b._qpBound) return; b._qpBound = true;
    b.addEventListener('click', async () => {
      try {
        const q = (document.getElementById('quickPollQuestion')?.value || '').trim();
        const opts = (document.getElementById('quickPollOptions')?.value || '').split(',').map(x => x.trim()).filter(Boolean);
        if (!q || opts.length < 2) return safeToast('Agrega pregunta y 2+ opciones', 'warning');
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('polls').insert({
          classroom_id: AppState.get('classroom')?.id, created_by: user?.id,
          question: q, options: opts, expires_at: new Date(Date.now() + 1000*60*60*24).toISOString(),
        });
        closeGlobalModal(); safeToast('✅ Encuesta publicada a los padres', 'success');
      } catch(e) { safeToast('Error: ' + (e?.message || ''), 'error'); }
    });
  }, 50);
}

/* ── 18. SALUDO MAESTRA · Item #39 (mensajes de ánimo diarios) ── */
function _showMaestraWelcomeGreeting() {
  try {
    const today = new Date().toDateString();
    if (_kkMaestra._lastGreetingShown === today) return;
    _kkMaestra._lastGreetingShown = today;
    const h = new Date().getHours();
    const msgs = h < 11 ? ['☀️ ¡Buenos días! Hoy será un día genial con los niños.', '📚 Maestra, tu energía marca la diferencia hoy.', '🌱 Cada pequeña enseñanza cuenta. ¡Vamos allá!']
              : h < 15 ? ['🍱 Ánimo después del almuerzo. ¡Te queda medio día super!', '✨ Lo que estás construyendo importa. Sigue así.', '🤗 Gracias por tu paciencia y dedicación.']
              : ['🌇 ¡Casi terminamos la jornada! Excelente trabajo.', '⭐ Cada día que enseñas transformas vidas. Descansa bien.', '💛 Has hecho un gran esfuerzo. ¡Orgullo!'];
    const profile = AppState.get('profile') || AppState.get('user') || {};
    const name = (profile?.name || 'Maestra').split(' ')[0];
    const msg = msgs[Math.floor(Math.random() * msgs.length)];
    setTimeout(() => safeToast(`¡Hola ${name}! ${msg}`, 'info'), 2200);
  } catch(_) {}
}

/* ── 19. INTEGRACIÓN RIPPLE EN CONTENIDO DINÁMICO (MutationObserver) ── */
function _setupRippleObserver() {
  try {
    if (!window.MutationObserver) return;
    const obs = new MutationObserver(() => _setupRippleTactil());
    obs.observe(document.body, { childList: true, subtree: true });
  } catch(_) {}
}

/* ── 20. INICIALIZADOR CENTRAL PANEL MAESTRA · SEGURO ── */
function initPanelMaestraOptimizations() {
  try { _setupRippleTactil();    } catch(e){ console.warn('[MOPT 01]',e?.message);}
  try { _setupRippleObserver();  } catch(e){ console.warn('[MOPT 02]',e?.message);}
  try { _setupFABToolbar();      } catch(e){ console.warn('[MOPT 03]',e?.message);}
  try { _setupBackToTop();       } catch(e){ console.warn('[MOPT 04]',e?.message);}
  try { _setupDeviceStatus();    } catch(e){ console.warn('[MOPT 05]',e?.message);}
  try { _setupCloudSyncListener();}catch(e){ console.warn('[MOPT 06]',e?.message);}
  try { _setupAttendanceFilterChips();} catch(e){console.warn('[MOPT 07]',e?.message);}
  try {
    // Items #1 #4 #35: attendance.js re-renderiza #attendanceList en cada pase
    // de lista; este evento reconecta contador, chips y aforo sin polling.
    if (!window.__kkAttBound) {
      window.__kkAttBound = true;
      window.addEventListener('kk:attendance-rendered', (ev) => {
        _updateAttendanceHeaderCounts(ev.detail);
        _applyAttendanceFilter();
      });
    }
    const att = AppState.get('attendance') || [];
    const students = AppState.get('students') || [];
    _updateAttendanceHeaderCounts({
      total: students.length,
      present: students.filter(s => att.find(a => Number(a.student_id) === Number(s.id))?.status === 'present').length,
      late: att.filter(a => a.status === 'late').length,
      excused: att.filter(a => a.status === 'excused').length,
      absent: att.filter(a => a.status === 'absent').length,
    });
  } catch(e){console.warn('[MOPT 07b]',e?.message);}
  try { _setupMarkAllPresentButton();} catch(e){console.warn('[MOPT 08]',e?.message);}
  try { _setupExportAttendance();} catch(e){ console.warn('[MOPT 09]',e?.message);}
  try { _setupStudentsSearchAndHealth();} catch(e){console.warn('[MOPT 10]',e?.message);}
  try { _setupTasksPendingFilter();} catch(e){console.warn('[MOPT 11]',e?.message);}
  try {
    // Item #6: tasks.js publica el conteo real de entregas al renderizar la lista
    if (!window.__kkTasksBound) {
      window.__kkTasksBound = true;
      window.addEventListener('kk:tasks-progress', (ev) => _updateTasksDeliveredProgress(ev.detail));
    }
  } catch(e){console.warn('[MOPT 11b]',e?.message);}
  try { _setupBulkGradeShortcuts();} catch(e){console.warn('[MOPT 12]',e?.message);}
  try { _loadGradesExcelGrid(); } catch(e){console.warn('[MOPT 12b]',e?.message);}
  try { _setupGenerateCommentsButton();} catch(e){console.warn('[MOPT 13]',e?.message);}
  try { _restoreDarkMode(); _updateMedicationAlertDot(); } catch(e){console.warn('[MOPT 13b]',e?.message);}
  try { _setupRoutineQuickChips();} catch(e){ console.warn('[MOPT 14]',e?.message);}
  try { _setupBannerProximaActividad();} catch(e){console.warn('[MOPT 15]',e?.message);}
  try { _setupChatScheduleBadge();} catch(e){ console.warn('[MOPT 16]',e?.message);}
  try { _showMaestraWelcomeGreeting();} catch(e){console.warn('[MOPT 17]',e?.message);}

  Object.assign(window.App, {
    _openCameraModal,
    _openIncidentModal,
    _openQuickPoll,
    _updateAttendanceHeaderCounts,
    _updateTasksDeliveredProgress,
    _renderGradesExcelGrid,
    _setCloudSync,
    setTasksFilter: Tasks.setTasksFilter,
    renderTasksList: Tasks.renderTasksList,
    _loadGradesExcelGrid,
    _openBulkCommentShortcuts,
    toggleDarkMode: _toggleDarkMode,
    _openMedicationAlerts,
    _openAulaQRScanner,
    _confirmQrRetirement,
    _openDaySummary,
  });
  window._updateAttendanceHeaderCounts = _updateAttendanceHeaderCounts;
  window._updateTasksDeliveredProgress = _updateTasksDeliveredProgress;
  window._renderGradesExcelGrid = _renderGradesExcelGrid;
  window._setCloudSync = _setCloudSync;
}

/* Hook al final del módulo ES6: esperar DOM + main init (50ms buffer) */
if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(() => setTimeout(initPanelMaestraOptimizations, 80), { timeout: 2500 });
} else {
  setTimeout(() => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(initPanelMaestraOptimizations, 80));
    else setTimeout(initPanelMaestraOptimizations, 80);
  }, 30);
}
