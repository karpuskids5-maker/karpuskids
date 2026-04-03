import { supabase, ensureRole, emitEvent, sendPush, initOneSignal } from '../shared/supabase.js';
import { AppState } from './state.js';
import { MaestraApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { WallModule } from '../shared/wall.js';
import { ChatModule } from '../shared/chat.js';
import { VideoCallModule } from '../shared/videocall.js';
import { BadgeSystem } from '../shared/badges.js';
import { ImageLoader } from '../shared/image-loader.js';

import * as Attendance from './modules/attendance.js';
import * as Routine from './modules/routine.js';
import * as Tasks from './modules/tasks.js';
import * as Students from './modules/students.js';
import * as ChatApp from './modules/chat_app.js';
import * as UI from './modules/ui.js';

window.safeToast = UI.safeToast;
const { safeToast, safeEscapeHTML, Modal } = UI;
const { initAttendance, markAllPresent, registerAttendance } = Attendance;
const { initRoutine, updateRoutineField, saveRoutineLog, openNewRoutineModal } = Routine;
const { initTasks, openEditTaskModal, deleteTask, openNewTaskModal, viewTaskSubmissions, submitGrade } = Tasks;
const { openStudentProfile, registerIncidentModal } = Students;
const { initChat, selectChatContact } = ChatApp;

/**
 * 🚀 ARQUITECTURA SENIOR: Definición Global del Objeto App
 * Evita errores de "App is not defined" y centraliza la lógica.
 */
window.App = {
  // Inicializamos con funciones seguras
  registerAttendance: (...args) => window.App._registerAttendance?.(...args),
  markAllPresent: (...args) => window.App._markAllPresent?.(...args),
  openStudentProfile: (...args) => window.App._openStudentProfile?.(...args),
  showClassroomDetail: (...args) => window.App._showClassroomDetail?.(...args),
  registerIncidentModal: (...args) => window.App._registerIncidentModal?.(...args),
  _openEditTaskModal: (...args) => window.App._openEditTaskModal?.(...args),
  _deleteTask: (...args) => window.App._deleteTask?.(...args),
  openNewTaskModal: (...args) => window.App._openNewTaskModal?.(...args),
  viewTaskSubmissions: (...args) => window.App._viewTaskSubmissions?.(...args),
  saveRoutineLog: (...args) => window.App._saveRoutineLog?.(...args),
  submitGrade: (...args) => window.App._submitGrade?.(...args),
  openNewRoutineModal: (...args) => window.App._openNewRoutineModal?.(...args),
  startJitsi: (...args) => window.App._startJitsi?.(...args),
  updateRoutineField: (...args) => window.App._updateRoutineField?.(...args),
  selectChatContact: (...args) => window.App._selectChatContact?.(...args),
  openNewPostModal: () => window.App._openNewPostModal(),
  submitNewPost: () => window.App._submitNewPost()
};

// ✅ Helpers robustos
const obsolete_safeToast = (message, type = 'success') => {
  if (!message) return;
  try {
    if (Helpers && typeof Helpers.toast === 'function') {
      return Helpers.toast(message, type);
    }
    console.log(`[Toast Fallback]: ${message}`);
  } catch (e) {
    console.warn('Toast Error:', e);
  }
};

const obsolete_safeEscapeHTML = (str = '') => {
  try {
    if (Helpers && typeof Helpers.escapeHTML === 'function') {
      return Helpers.escapeHTML(str);
    }
  } catch (e) {}
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
};

/**
 * Inicialización principal
 */

// Global error handler
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message?.toLowerCase() ?? '';
  if (msg.includes('indexeddb') || msg.includes('network') || msg.includes('fetch')) return;
  console.error('[Maestra] Unhandled rejection:', e.reason);
});

document.addEventListener('DOMContentLoaded', async () => {
  // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      if (confirm('¿Cerrar sesión?')) {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
      }
    });

    console.log('🎒 Karpus Maestra Module Starting...');
  
  const auth = await ensureRole(['maestra', 'admin']);
  if (!auth) return;
  
  AppState.set('user', auth.user);
  AppState.set('profile', auth.profile);

  // 🔔 Inicializar Notificaciones Push
  // 🔥 FIX: Permitir subdominios como www. y otros para la inicialización
  const host = window.location.hostname;
  const isProd = host === 'karpuskids.com' || host === 'www.karpuskids.com' || host.endsWith('.karpuskids.com');
  
  if (isProd) {
    try { initOneSignal(auth.user); } catch(e) { console.warn("OneSignal ignored:", e); }
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
  if (welcomeText) welcomeText.innerHTML = `<span>🧑‍🏫</span> <span>Hola, <span class="user-name-display text-orange-600">${teacherName}</span>!</span>`;

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
        // Recargar la página para reflejar cambios en sidebar y UI
        setTimeout(() => location.reload(), 1000);
      } catch (err) {
        console.error('Error saving profile:', err);
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
      
      const fileName = `avatar-${auth.user.id}-${Date.now()}.${file.name.split('.').pop()}`;
      const filePath = `avatars/${fileName}`;
      
      try {
        const { error: uploadError } = await supabase.storage
          .from('karpus-uploads')
          .upload(filePath, file);
        
        if (uploadError) throw uploadError;
        
        const { data: { publicUrl } } = supabase.storage
          .from('karpus-uploads')
          .getPublicUrl(filePath);
        
        // Actualizar perfil con nueva URL
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ avatar_url: publicUrl })
          .eq('id', auth.user.id);
        
        if (updateError) throw updateError;
        
        // Actualizar avatar en UI
        document.getElementById('profileAvatar').src = publicUrl;
        document.getElementById('sidebarAvatar').innerHTML = `<img src="${publicUrl}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='${teacherName.charAt(0)}'">`;
        
        // Actualizar estado
        AppState.set('profile', { ...auth.profile, avatar_url: publicUrl });
        
        safeToast('Avatar actualizado correctamente');
      } catch (err) {
        console.error('Error uploading avatar:', err);
        safeToast('Error al subir avatar', 'error');
      }
    };
  }

  // Mapeo de funciones reales al objeto global App (MOVIDO ARRIBA para evitar ReferenceError)
  
  Object.assign(window.App, {
    // UI Helpers
    safeToast: UI.safeToast,
    safeEscapeHTML: UI.safeEscapeHTML,
    Modal: UI.Modal,

    // Attendance
    registerAttendance: Attendance.registerAttendance,
    markAllPresent: Attendance.markAllPresent,
    initAttendance: Attendance.initAttendance,

    // Routine
    initRoutine: Routine.initRoutine,
    updateRoutineField: Routine.updateRoutineField,
    saveRoutineLog: Routine.saveRoutineLog,
    openNewRoutineModal: Routine.openNewRoutineModal,

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

    // Fallbacks to old ones not ported yet
    _showClassroomDetail: showClassroomDetail,
    _startJitsi: startJitsi,
    _openNewPostModal: openNewPostModal,
    _submitNewPost: submitNewPost
  });


  // 🔥 EXPOSICIÓN GLOBAL DE MÓDULOS (CRUCIAL PARA EL MURO)
  window.WallModule = WallModule;

  // Listener delegado para acciones (PRO: submit-grade)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="submit-grade"]');
    if (!btn) return;
    const { taskId, studentId } = btn.dataset;
    submitGrade(taskId, studentId);
  });

  try {
    const { data: classroom, error } = await supabase
      .from('classrooms')
      .select('*')
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

    // Forzar el ID del aula si el perfil lo tiene (con null check)
    if (auth.profile?.classroom_id && classroom.id !== auth.profile.classroom_id) {
      console.log('Using profile classroom_id');
    }

    // Inicializar Módulos
    await initDashboard();
    await initAttendance();
    await initNavigation();
    await initChat();
    initRealtimeUpdates(classroom.id);

    // Badge mensajes no leídos
    loadMaestraUnreadBadge(auth.user.id);

    // 🔴 Sistema de badges por sección
    BadgeSystem.init(auth.user.id);

    // ── Botón hamburguesa móvil ──────────────────────────────────────────────
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
    sidebar.querySelectorAll('button[data-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.innerWidth <= 768) _closeSidebar();
      });
    });

    // ── Botón colapsar sidebar desktop ───────────────────────────────────────
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

    // 🔥 INYECTAR BOTÓN DE NUEVA PUBLICACIÓN (Fix visual)
    const wallContainer = document.getElementById('muroPostsContainer');
    if (wallContainer) {
      const parent = wallContainer.parentElement;
      if (parent && !parent.querySelector('#btnNewPost')) {
        const headerDiv = document.createElement('div');
        headerDiv.className = "flex justify-between items-center mb-6";
        headerDiv.innerHTML = `
          <h3 class="text-2xl font-black text-slate-800">📢 Muro del Aula</h3>
          <button id="btnNewPost" onclick="App.openNewPostModal()" class="px-6 py-2.5 bg-orange-600 text-white rounded-xl font-bold shadow-md hover:bg-orange-700 transition-all flex items-center gap-2"><i data-lucide="plus-circle" class="w-5 h-5"></i> Nueva Publicación</button>
        `;
        parent.insertBefore(headerDiv, wallContainer);
      }
    }

  } catch (e) {
    console.error('Error init:', e);
    safeToast('Error cargando datos del aula', 'error');
  }

  if (window.lucide) window.lucide.createIcons();
});

let currentChannel = null;

function initRealtimeUpdates(classroomId) {
  if (currentChannel) {
    currentChannel.unsubscribe();
    supabase.removeChannel(currentChannel);
  }

  currentChannel = supabase.channel(`maestra_room_${classroomId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_evidences' }, (payload) => {
      const student = (AppState.get('students') || []).find(s => s.id === payload.new.student_id);
      if (student) safeToast(`📝 ${student.name} entregó una tarea`, 'info');
    })
    .subscribe();
}

async function notify({ message, pushTo = null }) {
  safeToast(message, 'info');
  if (pushTo) {
    sendPush({
      user_id: pushTo,
      title: 'Notificación Karpus',
      message: message,
      link: '/panel_padres.html'
    }).catch(console.warn);
  }
}

/**
 * 📊 Dashboard
 */
async function initDashboard() {
  const classroom = AppState.get('classroom');
  if (!classroom) return;

  try {
    const students = await MaestraApi.getStudentsByClassroom(classroom.id);
    AppState.set('students', students || []);
    
    const today = new Date().toISOString().split('T')[0];
    const attendance = await MaestraApi.getAttendance(classroom.id, today);
    
    const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    setTxt('statStudents', (students || []).length);
    setTxt('statClasses', '1');
    setTxt('statPresent', (attendance || []).filter(a => a.status === 'present').length);

    // Grid de Aulas
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

    // Tab Estudiantes
    const classGrid = document.getElementById('classroomStudentsGrid');
    if (classGrid) {
      classGrid.innerHTML = (students || []).map(s => `
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
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error(err);
    safeToast('Error cargando dashboard', 'error');
  }
}

/**
 * 📅 Asistencia
 */



/**
 * 🍱 Rutina Diaria
 */

/**
 * 🍱 Rutina Diaria - Lógica Profesional
 */


/**
 * 📝 Tareas
 */






/**
 * 🛠️ Modales (Centralizado PRO)
 */
const obsolete_Modal = {
  open(id, content) {
    document.getElementById(id)?.remove();
    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in';
    modal.innerHTML = content;
    document.body.appendChild(modal);
    requestAnimationFrame(() => window.lucide?.createIcons());
  },
  close(id) {
    document.getElementById(id)?.remove();
  }
};

// Make Modal globally available
window.Modal = Modal;

// Función de compatibilidad temporal (si se usa en otros archivos o HTML legacy)
function obsolete_createOrGetModal(id, content) {
  Modal.open(id, content);
}

function obsolete_openStudentProfile(studentId) {
  const student = AppState.get('students').find(s => s.id == studentId);
  if (!student) return safeToast('Estudiante no encontrado', 'error');
  
  const modalId = 'studentProfileModal';
  const content = `
    <div class="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden p-8 animate-fadeIn flex flex-col max-h-[90vh]">
      <div class="flex justify-between items-start mb-8">
        <div class="flex items-center gap-6">
          <div class="w-24 h-24 rounded-3xl bg-orange-50 flex items-center justify-center text-4xl font-black text-orange-500 overflow-hidden shadow-inner">
            ${student.avatar_url ? `<img src="${student.avatar_url}" class="w-full h-full object-cover">` : student.name.charAt(0)}
          </div>
          <div>
            <h3 class="text-3xl font-black text-slate-800">${safeEscapeHTML(student.name)}</h3>
            <p class="text-xs font-black text-orange-500 uppercase tracking-widest mt-1">Ficha del Alumno</p>
          </div>
        </div>
        <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
          <i data-lucide="x" class="w-6 h-6 text-slate-400"></i>
        </button>
      </div>
      
      <div class="space-y-6 overflow-y-auto pr-2">
        <div class="bg-slate-50 p-6 rounded-3xl border border-slate-100">
          <h4 class="font-bold text-sm text-slate-400 uppercase tracking-wider mb-4">Datos del Alumno</h4>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">Alergias</span> <span class="text-rose-500 font-bold">${safeEscapeHTML(student.allergies || 'Ninguna')}</span></div>
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">Tipo de Sangre</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.blood_type || 'N/A')}</span></div>
            <div class="flex flex-col col-span-2"><span class="font-bold text-slate-400 text-xs">Personas Autorizadas para Recoger</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.authorized_pickup || 'N/A')}</span></div>
          </div>
        </div>

        <div class="bg-slate-50 p-6 rounded-3xl border border-slate-100">
          <h4 class="font-bold text-sm text-slate-400 uppercase tracking-wider mb-4">Contacto Principal (Tutor 1)</h4>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">Nombre</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p1_name || 'N/A')}</span></div>
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">Teléfono</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p1_phone || 'N/A')}</span></div>
            <div class="flex flex-col col-span-2"><span class="font-bold text-slate-400 text-xs">Email</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p1_email || 'N/A')}</span></div>
          </div>
        </div>

        ${(student.p2_name || student.p2_phone) ? `
        <div class="bg-slate-50 p-6 rounded-3xl border border-slate-100">
          <h4 class="font-bold text-sm text-slate-400 uppercase tracking-wider mb-4">Contacto Secundario (Tutor 2)</h4>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">Nombre</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p2_name || 'N/A')}</span></div>
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">Teléfono</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p2_phone || 'N/A')}</span></div>
          </div>
        </div>` : ''}
      </div>
      
      <button onclick="Modal.close('${modalId}')" class="mt-8 w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-colors">Cerrar</button>
    </div>
  `;
  Modal.open(modalId, content);
}

function obsolete_registerIncidentModal(studentId) {
  const student = AppState.get('students').find(s => s.id == studentId);
  if (!student) return safeToast('Estudiante no encontrado', 'error');
  
  const modalId = 'incidentModal';
  const content = `
    <div class="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col">
      <div class="flex justify-between items-start mb-6">
        <h3 class="text-2xl font-black text-slate-800 flex items-center gap-3">
          <span class="text-rose-500">⚠️</span>
          <span>Reportar Incidente</span>
        </h3>
        <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
          <i data-lucide="x" class="w-6 h-6 text-slate-400"></i>
        </button>
      </div>
      
      <form id="incidentForm" class="space-y-5">
        <p class="text-sm text-slate-600 bg-slate-50 p-3 rounded-xl">Reportando a: <span class="font-black text-slate-800">${safeEscapeHTML(student.name)}</span></p>
        
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Severidad</label>
          <select id="incSeverity" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-rose-400 outline-none">
            <option value="leve">Leve</option>
            <option value="media">Media</option>
            <option value="alta">Alta</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Descripción del incidente</label>
          <textarea id="incDesc" rows="4" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-rose-400 outline-none resize-none" placeholder="Detalla lo sucedido de forma clara y objetiva..." required></textarea>
        </div>

        <div class="flex justify-end gap-3 pt-4">
          <button type="button" onclick="Modal.close('${modalId}')" class="px-6 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-colors">Cancelar</button>
          <button type="submit" class="px-6 py-3 rounded-xl font-bold bg-rose-500 text-white hover:bg-rose-600 shadow-lg shadow-rose-200 transition-transform active:scale-95 flex items-center gap-2">
            <i data-lucide="send" class="w-4 h-4"></i> Enviar Reporte
          </button>
        </div>
      </form>
    </div>
  `;
  Modal.open(modalId, content);
  const form = document.getElementById('incidentForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Enviando...';
    if(window.lucide) window.lucide.createIcons();
    
    try {
      const payload = {
        student_id: student.id,
        classroom_id: AppState.get('classroom').id,
        teacher_id: AppState.get('user').id,
        severity: document.getElementById('incSeverity').value,
        description: document.getElementById('incDesc').value
      };

      await MaestraApi.registerIncident(payload);
      safeToast('Incidente reportado correctamente');
      Modal.close(modalId);

      // Notificar al padre (Notificación Push)
      if (student.parent_id) {
        sendPush({
          user_id: student.parent_id,
          title: 'Aviso de Incidente ⚠️',
          message: `Se ha registrado un reporte de conducta sobre ${student.name}. Por favor revisa la sección de incidentes.`,
          link: 'panel_padres.html#incidents'
        }).catch(err => console.warn('Error notificando incidente:', err));
      }

      // Actualizar contador de incidentes en el dashboard
      const statEl = document.getElementById('statIncidents');
      if (statEl) {
        const current = parseInt(statEl.textContent || '0', 10);
        statEl.textContent = current + 1;
      }
    } catch (err) {
      console.error('Error reporting incident:', err);
      safeToast('Error al reportar incidente. Revisa tu conexión.', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i> Enviar Reporte';
      if(window.lucide) window.lucide.createIcons();
    }
  };
}

function obsolete_openNewRoutineModal() {
  safeToast('Usa "Guardar Reporte" en cada tarjeta para registrar la rutina.', 'info');
}

/**
 * 🧭 Navegación
 */
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn-toy[data-section]');
  const sections = document.querySelectorAll('.section');

  const setActiveSection = (targetId) => {
    // Si el targetId ya viene con 't-', lo usamos directamente, si no lo agregamos
    const fullId = targetId.startsWith('t-') ? targetId : `t-${targetId}`;
    const cleanId = targetId.replace('t-', '');

    sections.forEach(s => s.classList.remove('active'));
    const target = document.getElementById(fullId);
    if (target) target.classList.add('active');

    navButtons.forEach(btn => {
      const btnSection = btn.dataset.section;
      if (btnSection === fullId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (cleanId === 'home') initDashboard();
    if (cleanId === 'attendance') initAttendance();
    if (cleanId === 'daily-routine') initRoutine();
    if (cleanId === 'tasks') initTasks();
    if (cleanId === 'grades') initGrades();
    if (cleanId === 'chat') initChat();
    if (cleanId === 'profile') {
      import('../shared/notify-permission.js').then(m => m.NotifyPermission.requestIfNeeded());
    }

    // 🔴 Marcar badge como leído al entrar a la sección
    BadgeSystem.mark(fullId);
  };

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => setActiveSection(btn.dataset.section));
  });

  // Exponer para uso global
  window.App.setActiveSection = setActiveSection;

  setActiveSection('t-home');
}

/**
   * 🏫 Mostrar Detalle de Aula
   */
  async function showClassroomDetail(classroomId) {
    let classroom = AppState.get('classroom');
    
    // Si no coincide (usamos loose equality para manejar string vs number), intentar obtenerlo de la base de datos o AppState
    if (!classroom || classroom.id != classroomId) {
      console.warn('Classroom mismatch, fetching or using state...');
      const { data } = await supabase.from('classrooms').select('*').eq('id', classroomId).maybeSingle();
      if (data) {
        classroom = data;
        AppState.set('classroom', data);
      }
    }

   if (!classroom) return safeToast('Aula no encontrada', 'error');

   // 1. Actualizar UI del detalle
   const nameEl = document.getElementById('currentClassName');
   if (nameEl) nameEl.textContent = classroom.name;

  // 2. Cambiar a la sección de detalle
  const layoutShell = document.getElementById('layoutShell');
  if (layoutShell) layoutShell.scrollTop = 0;

  if (window.App.setActiveSection) {
    window.App.setActiveSection('t-class-detail');
  } else {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('t-class-detail')?.classList.add('active');
  }

  // 3. Inicializar tabs del aula (Muro por defecto)
  WallModule.init('muroPostsContainer', { 
    accentColor: 'orange',
    classroomId: classroom.id 
  }, AppState);

  // 4. Configurar listeners de tabs si no están
  initClassTabs();
}

/**
 * 📑 Inicializar Tabs Internas de Aula
 */
function initClassTabs() {
  const tabBtns     = document.querySelectorAll('.class-tab-btn');
  const tabContents = document.querySelectorAll('.class-tab-content');

  tabBtns.forEach(btn => {
    btn.onclick = () => {
      const targetTab = btn.dataset.tab;

      // Reset ALL tab buttons (both mobile grid and desktop row)
      tabBtns.forEach(b => {
        b.classList.remove('active', 'bg-orange-600', 'text-white');
        b.classList.add('bg-slate-100', 'text-slate-600');
      });
      // Activate clicked button
      btn.classList.add('active', 'bg-orange-600', 'text-white');
      btn.classList.remove('bg-slate-100', 'text-slate-600', 'text-slate-500');

      // Show correct content
      tabContents.forEach(c => c.classList.add('hidden'));
      document.getElementById(`tab-${targetTab}`)?.classList.remove('hidden');

      // Load data
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
            role:        'maestra',
            userName:    profile?.name || 'Maestra',
            classroomId: classroom?.id || null
          });
        }).catch(console.error);
      }
    };
  });
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

    // 4. Renderizar Jitsi
    VideoCallModule.joinMeeting(meeting, 'meet', AppState.get('profile'));

    safeToast('¡Clase iniciada! Los padres han sido notificados 🎥', 'success');
  } catch (e) {
    console.error('startJitsi error:', e);
    safeToast('Error al iniciar la clase: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="radio"></i> Iniciar Clase Ahora'; }
  }
}

/**
 * 💬 SISTEMA DE CHAT MAESTRA
 */
let activeChatUserId = null;
let activeConversationId = null; // Guardamos el ID de la conversación activa



/**
 * Busca o inicializa la conversación (sin crearla en DB hasta enviar mensaje, 
 * pero buscamos si ya existe para cargar historial)
 */

function obsolete_renderMessages(messages, myId) {
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;
  if (!messages.length) {
    container.innerHTML = '<div class="text-center text-xs text-slate-400 mt-4 italic">Inicio de la conversación. Di hola 👋</div>';
    return;
  }

  container.innerHTML = messages.map(m => {
    const isMe = m.sender_id === myId;
    return `
      <div class="flex ${isMe ? 'justify-end' : 'justify-start'} mb-2">
        <div class="max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${isMe ? 'bg-orange-600 text-white rounded-br-none shadow-md shadow-orange-100' : 'bg-white border border-slate-100 text-slate-700 rounded-bl-none shadow-sm'}">
          ${safeEscapeHTML(m.content)}
        </div>
      </div>
    `;
  }).join('');
  
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  if (!activeChatUserId) return;
  const input = document.getElementById('chatMessageInput');
  const text = input?.value.trim();
  if (!text) return;

  const user = AppState.get('user');
  if (!user) return;

  input.value = '';
  input.disabled = true;

  try {
    const { message, conversationId } = await ChatModule.sendMessage(
      user.id,
      activeChatUserId,
      text,
      activeConversationId
    );

    if (!activeConversationId && conversationId) {
      activeConversationId = conversationId;
    }

    await loadChatMessages(activeChatUserId);

  } catch (err) {
    console.error('Error enviando mensaje:', err);
    safeToast('Error al enviar mensaje', 'error');
  } finally {
    input.disabled = false;
    input.focus();
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

  try {
    let mediaUrl = null;
    let mediaType = null;

    if (file) {
      const ext = file.name.split('.').pop();
      const path = `posts/${Date.now()}_${Math.random().toString(36).substr(2,9)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('classroom_media').upload(path, file);
      if (upErr) throw upErr;
      
      const { data } = supabase.storage.from('classroom_media').getPublicUrl(path);
      mediaUrl = data.publicUrl;
      mediaType = file.type.startsWith('video') ? 'video' : 'image';
    }

    const { error } = await supabase.from('posts').insert({
      classroom_id: AppState.get('classroom').id,
      teacher_id: AppState.get('user').id,
      content: content,
      media_url: mediaUrl,
      media_type: mediaType
    });

    if (error) throw error;
    safeToast('Publicado correctamente', 'success');
    Modal.close('newPostModal');
    WallModule.loadPosts(document.getElementById('muroPostsContainer'));

    // Notify parents of this classroom (via background event)
    const classroom = AppState.get('classroom');
    const teacherName = AppState.get('profile')?.name || 'La maestra';

    emitEvent('post.created', {
      classroom_id:    classroom?.id,
      teacher_name:    teacherName,
      content_preview: content.slice(0, 80)
    }).catch(err => console.warn('[post.created] event failed:', err));
  } catch (e) {
    console.error(e);
    safeToast('Error al publicar', 'error');
    btn.disabled = false;
    btn.innerHTML = 'PUBLICAR';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 📊 SISTEMA DE CALIFICACIONES — PANEL MAESTRA
// ═══════════════════════════════════════════════════════════════════════════

function scoreFromEvidence(g) {
  if (g.stars != null && g.stars > 0) return Number(g.stars);
  const map = { A: 5, B: 4, C: 3, D: 2, E: 1 };
  return map[g.grade_letter] || 0;
}

function getLevelLabel(score) {
  if (score >= 4.5) return { label: 'Excelente',     cls: 'bg-emerald-100 text-emerald-700' };
  if (score >= 3.5) return { label: 'Bueno',          cls: 'bg-blue-100 text-blue-700' };
  if (score >= 2.5) return { label: 'En proceso',     cls: 'bg-amber-100 text-amber-700' };
  return              { label: 'Requiere apoyo', cls: 'bg-rose-100 text-rose-700' };
}

async function initGrades() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('t-grades-inner') || document.getElementById('t-grades');
  if (!container || !classroom) return;

  container.innerHTML =
    '<div class="flex justify-between items-center mb-6">' +
      '<h3 class="text-2xl font-black text-slate-800">📊 Calificaciones del Aula</h3>' +
    '</div>' +
    '<div id="gradesContent" class="space-y-4">' +
      '<div class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600 mx-auto"></div></div>' +
    '</div>';

  if (window.lucide) window.lucide.createIcons();

  try {
    const students = AppState.get('students') || [];

    // Cargar todas las evidencias del aula
    const { data: evidences, error } = await supabase
      .from('task_evidences')
      .select('stars, grade_letter, student_id, task_id, task:task_id(title, classroom_id)')
      .in('student_id', students.map(s => s.id));

    if (error) throw error;

    // Filtrar solo las del aula actual
    const filtered = (evidences || []).filter(e => e.task?.classroom_id == classroom.id);

    // Agrupar por estudiante
    const byStudent = {};
    filtered.forEach(g => {
      const score = scoreFromEvidence(g);
      if (!score) return;
      const sid = g.student_id;
      if (!byStudent[sid]) byStudent[sid] = { total: 0, count: 0, tasks: [] };
      byStudent[sid].total += score;
      byStudent[sid].count++;
      byStudent[sid].tasks.push(g);
    });

    const content = document.getElementById('gradesContent');
    if (!content) return;

    if (!students.length) {
      content.innerHTML = '<div class="text-center py-12 text-slate-400">No hay estudiantes en esta aula.</div>';
      return;
    }

    content.innerHTML =
      '<div class="w-full overflow-x-auto rounded-3xl border border-slate-100 shadow-sm bg-white">' +
        '<table class="w-full text-sm text-left min-w-[640px]">' +
          '<thead class="bg-slate-50 text-slate-500 font-black uppercase text-[10px] tracking-wider">' +
            '<tr>' +
              '<th class="px-5 py-4">Estudiante</th>' +
              '<th class="px-5 py-4 text-center">Promedio</th>' +
              '<th class="px-5 py-4 text-center">Nivel</th>' +
              '<th class="px-5 py-4 text-center">Tareas Calificadas</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody class="divide-y divide-slate-100">' +
            students.map(s => {
              const data = byStudent[s.id];
              const avg = data && data.count > 0 ? data.total / data.count : 0;
              const level = getLevelLabel(avg);
              const colorCls = avg >= 3.5 ? 'bg-emerald-50 text-emerald-700' : avg >= 2.5 ? 'bg-amber-50 text-amber-700' : avg > 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-400';
              return '<tr class="hover:bg-slate-50 transition-colors">' +
                '<td class="px-5 py-3.5"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center font-black text-sm">' + s.name.charAt(0) + '</div><div class="font-bold text-slate-800 text-sm">' + safeEscapeHTML(s.name) + '</div></div></td>' +
                '<td class="px-5 py-3.5 text-center"><span class="px-3 py-1 rounded-lg ' + colorCls + ' font-black text-sm">' + (avg > 0 ? avg.toFixed(1) : '-') + '</span></td>' +
                '<td class="px-5 py-3.5 text-center"><span class="px-2 py-1 rounded-full text-[10px] font-black uppercase ' + (avg > 0 ? level.cls : 'bg-slate-100 text-slate-400') + '">' + (avg > 0 ? level.label : 'Sin datos') + '</span></td>' +
                '<td class="px-5 py-3.5 text-center text-sm font-bold text-slate-600">' + (data?.count || 0) + '</td>' +
              '</tr>';
            }).join('') +
          '</tbody>' +
        '</table>' +
      '</div>';

    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    console.error('[initGrades]', e);
    const content = document.getElementById('gradesContent');
    if (content) content.innerHTML = '<div class="text-center py-8 text-rose-500 font-bold">Error al cargar calificaciones.</div>';
  }
}

// ── Badge mensajes no leídos (maestra) ───────────────────────────────────────
async function loadMaestraUnreadBadge(userId) {
  try {
    let total = 0;

    const { data, error } = await supabase.rpc('get_unread_counts');
    if (!error && data) {
      total = Object.values(data).reduce((a, b) => a + Number(b), 0);
    }
    // Si el RPC falla, mostrar 0 silenciosamente

    const badge = document.getElementById('badge-chat-maestra');
    if (!badge) return;
    if (total > 0) {
      badge.textContent = total > 9 ? '9+' : String(total);
      badge.classList.remove('hidden');
      badge.classList.add('flex');
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('flex');
    }

    if (!window._maestraUnreadChannel) {
      window._maestraUnreadChannel = supabase.channel('maestra_unread_' + userId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
          loadMaestraUnreadBadge(userId);
        })
        .subscribe();
    }
  } catch (_) {}
}
