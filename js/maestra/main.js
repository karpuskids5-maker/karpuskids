import { ensureRole, supabase, initOneSignal, RealtimeUtils, emitEvent, sendPush } from '/js/shared/supabase.js';
import { RealtimeManager } from '/js/shared/realtime-manager.js';
import { AppState } from './state.js';
import { MaestraApi } from './api.js';
import { Helpers } from '/js/shared/helpers.js';
import { WallModule } from '/js/shared/wall.js';
import { ChatModule } from '/js/shared/chat.js';
import { VideoCallModule } from '/js/shared/videocall.js';
import { BadgeSystem } from '/js/shared/badges.js';
import { ImageLoader } from '/js/shared/image-loader.js';

import * as Attendance from './modules/attendance.js';
import * as Routine from './modules/routine.js';
import * as Tasks from './modules/tasks.js';
import * as Students from './modules/students.js';
import * as ChatApp from './modules/chat_app.js';
import { PermitsModule } from './modules/permits.js';
import { UI } from './modules/ui.js';

import { UIPremium } from '/js/shared/ui-premium.js';

window.safeToast = UI.safeToast;
const { safeToast, safeEscapeHTML, Modal } = UI;

// Cache de marcas de tiempo para evitar recargas constantes
const _lastLoad = {};

// Exponer Modal globalmente ANTES de cualquier interacción del usuario
// Los onclick inline en HTML dinámico necesitan window.Modal disponible de inmediato
window.Modal = Modal;
const { initAttendance, markAllPresent, registerAttendance } = Attendance;
const { initRoutine, updateRoutineField, saveRoutineLog, openNewRoutineModal, openStudentRoutine, openBulkRoutineModal, updateRoutineFieldInModal, saveRoutineInModal, applyBulkRoutine } = Routine;
const { initTasks, openEditTaskModal, deleteTask, openNewTaskModal, viewTaskSubmissions, submitGrade } = Tasks;
const { openStudentProfile, registerIncidentModal } = Students;
const { initChat, selectChatContact } = ChatApp;

/**
 * 🚀 ARQUITECTURA SENIOR: Definición Global del Objeto App
 * Evita errores de "App is not defined" y centraliza la lógica.
 */
window.App = {
  // UI Helpers
  safeToast: UI.safeToast,
  safeEscapeHTML: UI.safeEscapeHTML,
  Modal: UI.Modal,

  // Attendance
  registerAttendance: Attendance.registerAttendance,
  markAllPresent: Attendance.markAllPresent,
  initAttendance: Attendance.initAttendance,
  handleAttendancePointerDown: Attendance.handleAttendancePointerDown,
  handleAttendancePointerUp: Attendance.handleAttendancePointerUp,

  // Routine
  initRoutine: Routine.initRoutine,
  updateRoutineField: Routine.updateRoutineField,
  saveRoutineLog: Routine.saveRoutineLog,
  openNewRoutineModal: Routine.openNewRoutineModal,
  openStudentRoutine: Routine.openStudentRoutine,
  registerInfantEvent: Routine.registerInfantEvent,
  saveInfantEntry: Routine.saveInfantEntry,
  openBulkRoutineModal: Routine.openBulkRoutineModal,
  updateRoutineFieldInModal: Routine.updateRoutineFieldInModal,
  saveRoutineInModal: Routine.saveRoutineInModal,
  applyBulkRoutine: Routine.applyBulkRoutine,

  // Tasks
  initTasks: Tasks.initTasks,
  openEditTaskModal: Tasks.openEditTaskModal,
  deleteTask: Tasks.deleteTask,
  openNewTaskModal: Tasks.openNewTaskModal,
  viewTaskSubmissions: Tasks.viewTaskSubmissions,
  submitGrade: Tasks.submitGrade,

  // Students
  openStudentProfile: Students.openStudentProfile,
  registerIncidentModal: Students.registerIncidentModal,

  // Chat
  initChat: ChatApp.initChat,
  selectChatContact: ChatApp.selectChatContact,

  // Permits
  permits: PermitsModule,

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
  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  });

  const auth = await ensureRole(['maestra', 'admin']);
  if (!auth) return;
  
  AppState.set('user', auth.user);
  AppState.set('profile', auth.profile);

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
    sidebarAvatar.innerHTML = avatarUrl 
      ? `<img src="${avatarUrl}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='${teacherName.charAt(0)}'">`
      : `<div class="w-full h-full flex items-center justify-center text-xl font-black text-orange-600 bg-orange-50">${teacherName.charAt(0)}</div>`;
  }

  document.querySelectorAll('.user-name-display').forEach(el => el.textContent = teacherName);
  document.querySelectorAll('.user-email-display').forEach(el => el.textContent = auth.user.email);
  const welcomeText = document.querySelector('#t-home header h1');
  if (welcomeText) welcomeText.innerHTML = `<span>Hola, <span class="user-name-display text-orange-600">${teacherName}</span>!</span>`;

  // Cargar Perfil en sección perfil
  const pName = document.getElementById('teacherName');
  const pEmail = document.getElementById('teacherEmail');
  if (pName) pName.textContent = teacherName;
  if (pEmail) pEmail.textContent = auth.user.email;
  if (document.getElementById('profileAvatar')) {
    document.getElementById('profileAvatar').src = auth.profile?.avatar_url || 'img/1.jpg';
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
        document.getElementById('sidebarAvatar').innerHTML = `<img src="${publicUrl}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='${teacherName.charAt(0)}'">`;
        
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

  // 🔥 EXPOSICIÓN GLOBAL DE MÓDULOS (CRUCIAL PARA EL MURO)
  window.WallModule = WallModule;

  // Inicializar QR de la maestra en sección perfil
  _initMaestraQR(auth.profile, auth.user);

  // Asignar funciones internas al objeto global App
  Object.assign(window.App, {
    _showClassroomDetail: showClassroomDetail,
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
    const { data: classroom, error } = await supabase
      .from('classrooms')
      .select('id, name, level, capacity, teacher_id, is_live')
      .eq('teacher_id', auth.user.id)
      .order('name')
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!classroom) {
      safeToast('No tienes un aula asignada.', 'warning');
      return;
    }
    
    AppState.set('classroom', classroom);

    // Inicializar Módulos
    await Promise.all([
      initDashboard(),
      initAttendance(),
      initNavigation(),
      initChat()
    ]);
    
    initRealtimeUpdates(classroom.id);

    // Cargar Badges en background
    loadMaestraUnreadBadge(auth.user.id);
    loadPendingTasksBadge(classroom.id);

    // 🔴 Sistema de badges por sección
    BadgeSystem.init(auth.user.id);

    // ── Botón hamburguesa móvil ────────────────────────────────────────────────────────
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

    if (menuBtn && sidebar) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.contains('mobile-visible') ? _closeSidebar() : _openSidebar();
      });
    }
    if (overlay) {
      overlay.addEventListener('click', _closeSidebar);
    }

    // Cerrar sidebar al hacer click en un link (móvil)
    sidebar?.querySelectorAll('button[data-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.innerWidth <= 768) _closeSidebar();
      });
    });

    // ── Botón colapsar sidebar desktop ─────────────────────────────────────────
    const toggleBtn  = document.getElementById('toggleSidebar');
    const layoutShell = document.getElementById('layoutShell');
    if (toggleBtn && sidebar && layoutShell) {
      toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        layoutShell.classList.toggle('sidebar-collapsed');
      });
    }
    
    WallModule.init('muroPostsContainer', { 
      accentColor: 'orange',
      classroomId: classroom.id
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
          WallModule.loadPosts('muroPostsContainer');
        } else if (eventType === 'UPDATE') {
          const postId = newPost.id;
          const likeSpan = document.getElementById(`like-count-${postId}`);
          const commBtn = document.querySelector(`#post-${postId} button[onclick*="toggleCommentSection"] span`);
          
          if (likeSpan && typeof newPost.likes_count === 'number') likeSpan.textContent = newPost.likes_count;
          if (commBtn && typeof newPost.comments_count === 'number') commBtn.textContent = `${newPost.comments_count} Comentarios`;
        } else if (eventType === 'DELETE') {
          document.getElementById(`post-${oldPost.id}`)?.remove();
        }
      });
  });
}

async function notify({ message, pushTo = null }) {
  safeToast(message, 'info');
  if (pushTo) {
    sendPush({
      user_id: pushTo,
      title: 'Notificación Karpus',
      message: message,
      link: '/panel_padres.html'
    }).catch(() => {});
  }
}

/**
 * 📊 Dashboard
 */
async function initDashboard() {
  const classroom = AppState.get('classroom');
  if (!classroom) return;

  console.log('[MaestraDashboard] Iniciando para aula:', classroom.id);

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

    // Grid de Aulas (Home)
    const grid = document.getElementById('classesGrid'); 
    if (grid) {
      grid.innerHTML = `
        <div onclick="App.showClassroomDetail('${classroom.id}')" class="p-6 bg-white rounded-[2rem] border-2 border-orange-100 shadow-sm hover:shadow-xl hover:border-orange-200 transition-all cursor-pointer group relative overflow-hidden">
          <div class="flex items-center gap-5 relative z-10">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 text-white flex items-center justify-center font-black text-2xl shadow-lg">${classroom.name.charAt(0)}</div>
            <div>
              <h3 class="font-black text-slate-800 text-xl tracking-tight">${safeEscapeHTML(classroom.name)}</h3>
              <p class="text-xs font-black text-orange-500 uppercase tracking-widest">Aula Principal</p>
            </div>
          </div>
          <div class="mt-8 flex justify-between items-center relative z-10">
            <span class="text-[10px] font-black text-orange-600 uppercase tracking-widest flex items-center gap-1">Entrar <i data-lucide="arrow-right" class="w-4 h-4"></i></span>
          </div>
        </div>
      `;
    }

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
    console.error('[MaestraDashboard] Error crítico:', err);
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
  } catch (e) {
    console.error('Error updating tasks widget:', e);
  }
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
 * 🧭 Navegación
 */
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn-toy[data-section]');
  const sections = document.querySelectorAll('.section');

  // Track previous section for cleanup
  let previousSection = null;
  
  const setActiveSection = (targetId, options = {}) => {
    // Si el targetId ya viene con 't-', lo usamos directamente, si no lo agregamos
    const fullId = targetId.startsWith('t-') ? targetId : `t-${targetId}`;
    const cleanId = targetId.replace('t-', '');

    Helpers.vibrate?.('light');

    // ✅ LIMPIEZA DE REALTIME: Eliminar canales al cambiar de sección
    if (previousSection && (previousSection === 't-home' || previousSection === 't-class-detail')) {
      WallModule.destroy();
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

    // Lógica de refresco inteligente (TTL: 2 minutos)
    const now = Date.now();
    const isFresh = _lastLoad[cleanId] && (now - _lastLoad[cleanId] < 120000);
    if (isFresh) return;
    _lastLoad[cleanId] = now;

    if (cleanId === 'home') initDashboard();
    if (cleanId === 'attendance') initAttendance();
    if (cleanId === 'daily-routine') initRoutine();
    if (cleanId === 'tasks') initTasks();
    if (cleanId === 'grades') initGrades();
    if (cleanId === 'permits') PermitsModule.init();
    if (cleanId === 'chat') initChat();
    if (cleanId === 'profile') {
      import('../shared/notify-permission.js').then(m => m.NotifyPermission.requestIfNeeded());
    }

    // 🔴 Marcar badge como leído al entrar a la sección
    BadgeSystem.mark(fullId);
    
    previousSection = fullId;
  };

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => setActiveSection(btn.dataset.section));
  });

  // Exponer para uso global
  window.App.setActiveSection = setActiveSection;
  window.App._setActiveSection = setActiveSection; // Alias interno para el proxy global

  // Restaurar última sección
  const lastSection = localStorage.getItem('maestra_last_section') || 't-home';
  const lastClassroom = localStorage.getItem('maestra_last_classroom');
  const lastTab = localStorage.getItem('maestra_last_tab');

  if (lastSection === 't-class-detail' && lastClassroom) {
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
      WallModule.init('muroPostsContainer', { 
        accentColor: 'orange',
        likeColor: 'orange',
        classroomId: classroom.id 
      }, AppState);

      initClassTabs(options.activeTab);

    } catch (error) {
      console.error('Error en showClassroomDetail:', error);
      safeToast('Error al cargar datos del aula', 'error');
    }
}

/**
 * 📋 Inicializar Tabs Internas de Aula
 */
function initClassTabs(defaultTab = null) {
  const tabBtns     = document.querySelectorAll('.class-tab-btn');
  const tabContents = document.querySelectorAll('.class-tab-content');

  const activateTab = (targetTab) => {
    // 1. Resetear TODOS los botones
    tabBtns.forEach(b => {
      b.classList.remove('active', 'bg-orange-600', 'bg-orange-500', 'text-white', 'ring-4', 'ring-orange-100');
      b.classList.add('bg-slate-100', 'text-slate-600');
    });

    // 2. Activar botones que coincidan (con énfasis especial en Rutina)
    tabBtns.forEach(b => {
      if (b.dataset.tab === targetTab) {
        const isRoutine = targetTab === 'daily-routine';
        
        // Estilo Naranja Vibrante solicitado por el usuario
        b.classList.add('active', isRoutine ? 'bg-orange-600' : 'bg-orange-500', 'text-white', 'ring-4', 'ring-orange-100');
        b.classList.remove('bg-slate-100', 'text-slate-600', 'text-slate-500');
        
        // Efecto visual extra para Rutina
        if (isRoutine) {
           b.classList.add('animate-pulse-subtle');
        }
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
      if (targetTab === 'feed')          WallModule.loadPosts();
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

  // Activar tab inicial
  const tabToActivate = defaultTab || localStorage.getItem('maestra_last_tab') || 'feed';
  activateTab(tabToActivate);
}

function initVideocall() {
  const container = document.getElementById('meet');
  if (!container) return;
  const classroom = AppState.get('classroom');

  // 1. Mostrar Panel de Gestión
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center p-12 text-center">
      <div class="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mb-6">
        <i data-lucide="video" class="w-10 h-10 text-orange-600"></i>
      </div>
      <h4 class="text-xl font-black text-slate-800 mb-2">Aula Virtual: ${classroom?.name}</h4>
      
      <div class="flex gap-4 mt-6">
        <button onclick="App.startJitsi()" class="px-8 py-4 bg-orange-600 text-white rounded-2xl font-black shadow-xl shadow-orange-200 hover:scale-105 transition-all flex items-center gap-3">
            <i data-lucide="radio"></i> Iniciar Clase Ahora
        </button>
        <button onclick="App.scheduleClassMeeting()" class="px-8 py-4 bg-white border-2 border-orange-100 text-orange-600 rounded-2xl font-black hover:bg-orange-50 transition-all flex items-center gap-3">
            <i data-lucide="calendar-plus"></i> Programar Futura
        </button>
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}

window.App.scheduleClassMeeting = async () => {
    const title = prompt("Título de la clase/reunión:");
    if(!title) return;
    
    try {
        await VideoCallModule.scheduleMeeting({
            title,
            startTime: new Date().toISOString(), // O pedir fecha real
            type: 'classroom',
            targetId: AppState.get('classroom').id,
            hostId: AppState.get('user').id
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
    // 1. Crear reunión y notificar padres automáticamente
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

    // 4. Abrir en nueva pestaña (evita lobby membersOnly)
    const _fullRoom = 'karpuskids-edu-2026_' + meeting.room_name;
    window.open('https://meet.jit.si/' + _fullRoom, '_blank');

    safeToast('¡Clase iniciada! Los padres han sido notificados 🎥', 'success');
  } catch (e) {
    safeToast('Error al iniciar la clase: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="radio"></i> Iniciar Clase Ahora'; }
  }
}

async function openNewPostModal() {
  const html = `
    <div class="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn">
      <div class="flex justify-between items-start mb-6">
        <h3 class="text-2xl font-black text-slate-800">Crear Publicación</h3>
        <button onclick="Modal.close('newPostModal')" class="p-2 hover:bg-slate-100 rounded-full"><i data-lucide="x" class="w-6 h-6 text-slate-400"></i></button>
      </div>
      <div class="space-y-4">
        <textarea id="postContent" rows="4" class="w-full p-4 bg-slate-50 border-none rounded-2xl text-sm outline-none resize-none focus:ring-2 focus:ring-orange-400" placeholder="¿Qué quieres compartir con la clase?"></textarea>
        
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
      const path = `posts/${Date.now()}_${Math.random().toString(36).substr(2,9)}.${ext}`;
      
      mediaUrl = await ImageLoader.uploadToStorage(file, 'karpus-uploads', path, {
        maxWidth: 1200,
        quality: 0.8,
        onProgress: setProgress
      });
      mediaType = file.type.startsWith('video') ? 'video' : 'image';
    }

    const { data: { user } } = await supabase.auth.getUser();
    const classroom = AppState.get('classroom');

    const { error } = await supabase.from('posts').insert({
      content,
      media_url: mediaUrl,
      media_type: mediaType,
      author_id: user.id,
      classroom_id: classroom.id,
      type: 'classroom'
    });

    if (error) throw error;

    safeToast('Publicación creada con éxito', 'success');
    Modal.close('newPostModal');
    WallModule.loadPosts('muroPostsContainer');

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
    const { count } = await supabase
      .from('task_evidences')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
      // Podrías filtrar por classroom_id si las tareas tienen ese campo
    
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

function initGrades() {
  const container = document.getElementById('t-grades-inner');
  if (!container) return;
  
  container.innerHTML = `
    <header class="mb-6">
      <h1 class="text-2xl md:text-3xl font-black text-slate-800 flex items-center gap-3">
        <span class="p-2 bg-indigo-100 text-indigo-600 rounded-2xl"><i data-lucide="graduation-cap" class="w-6 h-6"></i></span>
        Centro de Calificaciones
      </h1>
      <p class="text-slate-500 font-medium">Gestiona las notas y el progreso académico de tus alumnos</p>
    </header>
    <div class="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm text-center">
      <div class="w-20 h-20 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">📝</div>
      <h3 class="text-xl font-black text-slate-800 mb-2">Próximamente</h3>
      <p class="text-slate-500 max-w-sm mx-auto">Estamos trabajando en una nueva interfaz para que calificar sea más rápido y divertido.</p>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}
