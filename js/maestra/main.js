import { supabase, ensureRole, emitEvent, sendPush, initOneSignal } from '../shared/supabase.js';
import { AppState } from './state.js';
import { MaestraApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { WallModule } from '../shared/wall.js';
import { ChatModule } from '../shared/chat.js';
import { VideoCallModule } from '../shared/videocall.js';

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

    // ── Botón hamburguesa móvil ──────────────────────────────────────────────
    const menuBtn = document.getElementById('menuBtn');
    const sidebar  = document.getElementById('sidebar');
    const overlay  = document.getElementById('sidebarOverlay');

    if (menuBtn && sidebar) {
      menuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('mobile-visible');
        if (overlay) overlay.classList.toggle('hidden');
      });
    }
    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('mobile-visible');
        overlay.classList.add('hidden');
      });
    }

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
async function obsolete_initAttendance() {
  const classroom = AppState.get('classroom');
  const students = AppState.get('students') || [];
  const today = new Date().toISOString().split('T')[0];
  
  try {
    const attendance = await MaestraApi.getAttendance(classroom.id, today);
    const attMap = {};
    (attendance || []).forEach(a => attMap[a.student_id] = a.status);
    
    const container = document.getElementById('attendanceList');
    if (container) {
      container.innerHTML = `
        <div class="flex justify-between items-center mb-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
          <h4 class="font-black text-slate-800">Control de Asistencia</h4>
          <button onclick="App.markAllPresent()" class="px-4 py-2 bg-emerald-500 text-white rounded-xl text-xs font-black uppercase shadow-lg hover:bg-emerald-600 transition-all flex items-center gap-2">
            <i data-lucide="check-check" class="w-4 h-4"></i> Marcar Todos
          </button>
        </div>
        <div class="space-y-3">
          ${students.map(s => {
            const currentStatus = attMap[s.id] || null;
            return `
              <div class="flex items-center justify-between p-4 bg-white rounded-3xl border border-slate-100 shadow-sm transition-all">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center font-bold text-slate-400 overflow-hidden">
                    ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
                  </div>
                  <div class="font-bold text-slate-700 text-sm">${safeEscapeHTML(s.name)}</div>
                </div>
                <div class="flex gap-2">
                  <button id="btn-${s.id}-present" onclick="App.registerAttendance('${s.id}', 'present')" class="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${currentStatus === 'present' ? 'bg-emerald-500 text-white shadow-lg' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}">Presente</button>
                  <button id="btn-${s.id}-absent" onclick="App.registerAttendance('${s.id}', 'absent')" class="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${currentStatus === 'absent' ? 'bg-rose-500 text-white shadow-lg' : 'bg-rose-50 text-rose-600 hover:bg-rose-100'}">Falta</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (err) {
    console.error(err);
  }
}

async function obsolete_markAllPresent() {
  const students = AppState.get('students') || [];
  const classroom = AppState.get('classroom');
  const today = new Date().toISOString().split('T')[0];
  
  if (!students.length) return safeToast('No hay estudiantes', 'warning');
  if (!confirm('¿Marcar a todos como presentes?')) return;

  try {
    // Mostrar feedback visual inmediato (Optimistic UI)
    safeToast('Registrando asistencia...', 'info');

    const records = students.map(s => ({ 
      student_id: s.id, 
      classroom_id: classroom.id, 
      date: today, 
      status: 'present' 
    }));

    // Usar una sola llamada masiva si es posible, o Promise.all con manejo individual
    const results = await Promise.allSettled(
      records.map(r => MaestraApi.upsertAttendance(r))
    );

    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.error('Algunas asistencias fallaron:', failures);
      safeToast(`Se registraron ${results.length - failures.length} asistencias, ${failures.length} fallaron`, 'warning');
    } else {
      safeToast('Asistencia masiva completada');
      
      // Notificar a todos los padres (Notificaciones Push)
      students.forEach(s => {
        if (s.parent_id) {
          sendPush({
            user_id: s.parent_id,
            title: 'Asistencia Karpus',
            message: `${s.name} ha sido marcado como Presente hoy.`,
            link: 'panel_padres.html#attendance'
          }).catch(err => console.warn(`Error notificando a ${s.name}:`, err));
        }
      });
    }

    await initAttendance();
  } catch (e) {
    console.error('Error masivo:', e);
    safeToast('Error crítico en asistencia masiva', 'error');
  }
}

async function obsolete_registerAttendance(studentId, status) {
  const classroom = AppState.get('classroom');
  const today = new Date().toISOString().split('T')[0];
  if (!studentId || !status) return;

  try {
    // Feedback visual optimista
    const btnPresent = document.getElementById(`btn-${studentId}-present`);
    const btnAbsent = document.getElementById(`btn-${studentId}-absent`);
    
    if (status === 'present') {
      btnPresent?.classList.add('bg-emerald-500', 'text-white', 'shadow-lg');
      btnAbsent?.classList.remove('bg-rose-500', 'text-white', 'shadow-lg');
    } else {
      btnAbsent?.classList.add('bg-rose-500', 'text-white', 'shadow-lg');
      btnPresent?.classList.remove('bg-emerald-500', 'text-white', 'shadow-lg');
    }

    await MaestraApi.upsertAttendance({ 
      student_id: studentId, 
      classroom_id: classroom.id, 
      date: today, 
      status 
    });
    
    // Notificar al padre si tiene usuario asignado
    const student = (AppState.get('students') || []).find(s => s.id === studentId);
    if (student?.parent_id) {
      sendPush({
        user_id: student.parent_id,
        title: 'Asistencia Karpus',
        message: `${student.name} ha sido marcado como ${status === 'present' ? 'Presente' : 'Ausente'} hoy.`,
        link: 'panel_padres.html#attendance'
      }).catch(err => console.warn(`Error notificando a ${student.name}:`, err));
    }
    
    safeToast(`Asistencia: ${status === 'present' ? 'Presente' : 'Falta'}`);
  } catch (e) {
    console.error('Error attendance:', e);
    safeToast('Error al registrar asistencia', 'error');
    // Revertir UI si falla
    await initAttendance();
  }
}

/**
 * 🍱 Rutina Diaria
 */
async function obsolete_initRoutine() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('tab-daily-routine');
  if (!container) return;

  try {
    const students = AppState.get('students') || [];
    const today = new Date().toISOString().split('T')[0];
    
    // Obtener logs de hoy para este aula
    const { data: todayLogs } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('classroom_id', classroom.id)
      .eq('date', today);

    const logsMap = {};
    (todayLogs || []).forEach(l => logsMap[l.student_id] = l);

    container.innerHTML = `
      <div class="notebook-paper p-8">
        <div class="flex justify-between items-center mb-8">
          <h3 class="text-2xl font-black text-slate-800 flex items-center gap-3">📝 Reporte Diario de Rutina</h3>
          <div class="text-xs font-bold text-slate-400 uppercase bg-slate-100 px-3 py-1 rounded-full">${today}</div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          ${students.map(s => {
            const log = logsMap[s.id] || {};
            return `
              <div class="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-md transition-all">
                <div class="flex items-center gap-4 mb-6">
                  <div class="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-xl overflow-hidden">
                    ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
                  </div>
                  <div>
                    <h4 class="font-black text-slate-800 text-sm">${safeEscapeHTML(s.name)}</h4>
                    <p class="text-[9px] font-bold text-orange-500 uppercase tracking-widest">Seguimiento Diario</p>
                  </div>
                </div>

                <div class="space-y-4">
                  <!-- Mañana: Ánimo -->
                  <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase mb-2 block tracking-tighter">¿Cómo llegó hoy? (Mañana)</label>
                    <div class="flex gap-2">
                      ${['feliz', 'normal', 'triste', 'enojado'].map(m => `
                        <button onclick="App.updateRoutineField('${s.id}', 'mood', '${m}')" 
                          class="flex-1 py-2 rounded-xl text-lg border-2 transition-all ${log.mood === m ? 'bg-orange-500 border-orange-500 scale-105 shadow-lg text-white' : 'bg-slate-50 border-slate-50 hover:border-orange-200'}">
                          ${m === 'feliz' ? '😊' : m === 'normal' ? '😐' : m === 'triste' ? '😢' : '😠'}
                        </button>
                      `).join('')}
                    </div>
                  </div>

                  <!-- Tarde: Comida y Sueño -->
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="text-[10px] font-black text-slate-400 uppercase mb-2 block tracking-tighter">¿Cómo comió?</label>
                      <select id="food-${s.id}" onchange="App.updateRoutineField('${s.id}', 'food', this.value)" 
                        class="w-full p-2 bg-slate-50 rounded-xl text-xs font-bold outline-none border-2 border-transparent focus:border-orange-500">
                        <option value="">Seleccionar</option>
                        <option value="todo" ${log.food === 'todo' || log.eating === 'todo' ? 'selected' : ''}>😋 Todo</option>
                        <option value="poco" ${log.food === 'poco' || log.eating === 'poco' ? 'selected' : ''}>😕 Poco</option>
                        <option value="nada" ${log.food === 'nada' || log.eating === 'nada' ? 'selected' : ''}>🚫 Nada</option>
                      </select>
                    </div>
                    <div>
                      <label class="text-[10px] font-black text-slate-400 uppercase mb-2 block tracking-tighter">¿Durmió siesta?</label>
                      <select id="sleep-${s.id}" onchange="App.updateRoutineField('${s.id}', 'sleep', this.value)" 
                        class="w-full p-2 bg-slate-50 rounded-xl text-xs font-bold outline-none border-2 border-transparent focus:border-orange-500">
                        <option value="">Seleccionar</option>
                        <option value="si" ${log.sleep === 'si' || log.sleeping === 'si' || log.nap === 'si' ? 'selected' : ''}>😴 Sí</option>
                        <option value="no" ${log.sleep === 'no' || log.sleeping === 'no' || log.nap === 'no' ? 'selected' : ''}>🚫 No</option>
                      </select>
                    </div>
                  </div>

                  <!-- Notas Adicionales -->
                  <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase mb-2 block tracking-tighter">Observaciones / Actividades</label>
                    <textarea id="note-${s.id}" class="w-full p-3 bg-slate-50 rounded-2xl text-xs outline-none border-2 border-transparent focus:border-orange-500 resize-none" rows="2" placeholder="Notas adicionales...">${safeEscapeHTML(log.notes || log.activities || '')}</textarea>
                  </div>

                  <button id="btn-save-log-${s.id}" onclick="App.saveRoutineLog('${s.id}')" 
                    data-mood="${log.mood || 'normal'}"
                    data-food="${log.food || log.eating || ''}"
                    data-sleep="${log.sleep || log.sleeping || log.nap || ''}"
                    class="w-full py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-600 transition-all shadow-lg flex items-center justify-center gap-2">
                    <i data-lucide="save" class="w-4 h-4"></i> Guardar Reporte Completo
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    console.error(e);
    container.innerHTML = Helpers.emptyState('Error al cargar la rutina');
  }
}

/**
 * 🍱 Rutina Diaria - Lógica Profesional
 */
async function obsolete_updateRoutineField(studentId, field, value) {
  const saveBtn = document.getElementById(`btn-save-log-${studentId}`);
  if (!saveBtn) return;

  // Actualizar el estado en el botón
  saveBtn.dataset[field] = value;

  // Feedback visual si es mood
  if (field === 'mood') {
    const parent = document.querySelector(`[onclick*="updateRoutineField('${studentId}', 'mood'"]`)?.parentElement;
    if (parent) {
      parent.querySelectorAll('button').forEach(b => {
        b.classList.remove('bg-orange-500', 'border-orange-500', 'scale-105', 'shadow-lg', 'text-white');
        b.classList.add('bg-slate-50', 'border-slate-50');
      });
      // Encontrar el botón clickeado
      const clicked = Array.from(parent.querySelectorAll('button')).find(b => b.onclick.toString().includes(`'${value}'`));
      if (clicked) {
        clicked.classList.add('bg-orange-500', 'border-orange-500', 'scale-105', 'shadow-lg', 'text-white');
        clicked.classList.remove('bg-slate-50', 'border-slate-50');
      }
    }
  }
}

async function obsolete_saveRoutineLog(studentId) {
  const btn = document.getElementById(`btn-save-log-${studentId}`);
  const note = document.getElementById(`note-${studentId}`)?.value;
  if (!btn) return;

  // Obtener valores actualizados de los datasets o selectores
  const mood = btn.dataset.mood || 'normal';
  const food = btn.dataset.food || document.getElementById(`food-${studentId}`)?.value || '';
  const sleep = btn.dataset.sleep || document.getElementById(`sleep-${studentId}`)?.value || '';

  btn.disabled = true;
  const originalContent = btn.innerHTML;
  btn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Guardando...';
  if (window.lucide) window.lucide.createIcons();

  try {
    const classroom = AppState.get('classroom');
    const payload = {
      student_id: studentId,
      classroom_id: classroom.id,
      date: new Date().toISOString().split('T')[0],
      mood: mood,
      food: food,
      eating: food,    // Unificar campos
      nap: sleep,      // Unificar campos
      sleeping: sleep, // Unificar campos
      notes: note,
      activities: note // Unificar campos
    };

    await MaestraApi.upsertDailyLog(payload);
    safeToast('Reporte guardado con éxito', 'success');

    // Notificar al padre (Notificación Push)
    const student = (AppState.get('students') || []).find(s => s.id == studentId);
    if (student?.parent_id) {
      sendPush({
        user_id: student.parent_id,
        title: 'Reporte de Rutina 📝',
        message: `La maestra ha actualizado el reporte diario de ${student.name}.`,
        link: 'panel_padres.html#daily-routine'
      }).catch(err => console.warn('Error notificando rutina:', err));
    }

  } catch (err) {
    console.error('Error saving routine:', err);
    safeToast('Error al guardar reporte', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalContent;
    if (window.lucide) window.lucide.createIcons();
  }
}

/**
 * 📝 Tareas
 */
async function obsolete_initTasks() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('tab-tasks');
  if (!container) return;

  // Añadir header con botón de "Nueva Tarea"
  container.innerHTML = `
    <div class="flex justify-between items-center mb-8">
      <h3 class="text-2xl font-black text-slate-800 flex items-center gap-3">🎒 Mochila de Tareas</h3>
      <button onclick="App.openNewTaskModal()" class="px-6 py-3 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-orange-200 hover:bg-orange-700 transition-all flex items-center gap-2">
        <i data-lucide="plus-circle" class="w-5 h-5"></i> Nueva Tarea
      </button>
    </div>
    <div id="tasksListContainer" class="space-y-4">
      ${Helpers.skeleton(3)}
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();

  const listContainer = document.getElementById('tasksListContainer');
  try {
    const tasks = await MaestraApi.getTasksByClassroom(classroom.id);
    if (!tasks.length) {
      listContainer.innerHTML = Helpers.emptyState('Aún no has asignado tareas.', 'clipboard-check');
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    listContainer.innerHTML = tasks.map(t => {
      const dueDate = new Date(t.due_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
      return `
      <div class="bg-white p-6 rounded-3xl border-2 border-slate-50 shadow-sm hover:shadow-md transition-all group">
        <div class="flex justify-between items-start mb-4">
          <div>
            <h4 class="font-black text-slate-800 text-base mb-1">${safeEscapeHTML(t.title)}</h4>
            <p class="text-xs font-bold text-slate-400 flex items-center gap-1.5"><i data-lucide="calendar" class="w-3 h-3"></i> Entrega: ${dueDate}</p>
          </div>
          <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onclick="App.openEditTaskModal('${t.id}')" class="p-2 bg-slate-100 text-slate-500 rounded-lg hover:bg-blue-100 hover:text-blue-600 transition-colors" title="Editar Tarea">
              <i data-lucide="edit" class="w-4 h-4"></i>
            </button>
            <button onclick="App.deleteTask('${t.id}')" class="p-2 bg-slate-100 text-slate-500 rounded-lg hover:bg-red-100 hover:text-red-600 transition-colors" title="Eliminar Tarea">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
        <p class="text-sm text-slate-600 line-clamp-2">${safeEscapeHTML(t.description)}</p>
        <div class="flex justify-between items-center pt-4 border-t border-slate-50">
          <div>
            ${t.file_url ? '<span class="px-2 py-1 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-full flex items-center gap-1"><i data-lucide="paperclip" class="w-3 h-3"></i> Adjunto</span>' : ''}
          </div>
          <button onclick="App.viewTaskSubmissions('${t.id}')" class="px-4 py-2 bg-orange-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-orange-700 transition-all shadow-sm">Ver Entregas</button>
        </div>
      </div>
    `}).join('');
    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    console.error(e);
    listContainer.innerHTML = Helpers.emptyState('Error al cargar tareas.', 'alert-circle');
    if (window.lucide) window.lucide.createIcons();
  }
}

async function obsolete_openEditTaskModal(taskId) {
  try {
    const { data: task, error } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    if (error) throw error;
    // Llama a la función de modal refactorizada con los datos de la tarea
    openNewTaskModal(task);
  } catch (err) {
    console.error('Error al obtener la tarea para editar:', err);
    safeToast('No se pudo cargar la tarea para editar', 'error');
  }
}

async function obsolete_deleteTask(taskId) {
  if (!confirm('¿Estás segura de que quieres eliminar esta tarea? Esta acción no se puede deshacer.')) {
    return;
  }
  try {
    await MaestraApi.deleteTask(taskId);
    safeToast('Tarea eliminada correctamente');
    await initTasks(); // Refrescar la lista de tareas
  } catch (err) {
    console.error('Error al eliminar la tarea:', err);
    safeToast('No se pudo eliminar la tarea', 'error');
  }
}

async function obsolete_openNewTaskModal(taskToEdit = null) {
  const isEditing = taskToEdit !== null;
  const modalId = 'newTaskModal';
  const modalTitle = isEditing ? 'Editar Tarea' : 'Asignar Nueva Tarea';
  const buttonText = isEditing ? 'Guardar Cambios' : 'Asignar y Notificar';

  const content = `
    <div class="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col max-h-[90vh]">
      <div class="flex justify-between items-start mb-6">
        <h3 class="text-2xl font-black text-slate-800">${modalTitle}</h3>
        <button onclick="document.getElementById('${modalId}').remove()" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
          <i data-lucide="x" class="w-6 h-6 text-slate-400"></i>
        </button>
      </div>
      <form id="taskForm" class="space-y-5 overflow-y-auto pr-2 flex-1">
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Título de la Tarea</label>
          <input type="text" id="taskTitle" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-orange-400 outline-none" required>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Descripción / Instrucciones</label>
          <textarea id="taskDesc" rows="5" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-orange-400 outline-none resize-none" placeholder="Explica qué deben hacer los alumnos..." required></textarea>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Fecha de Entrega</label>
          <input type="date" id="taskDueDate" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-orange-400 outline-none" required>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Adjuntar Archivo (Opcional)</label>
          <div class="relative">
            <input type="file" id="taskFileInput" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" accept="image/*,video/*,.pdf,.doc,.docx">
            <div class="bg-slate-50 p-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-orange-300 transition-all flex items-center justify-center gap-3">
              <i data-lucide="paperclip" class="w-5 h-5 text-slate-400"></i>
              <span id="taskFileName" class="text-sm font-medium text-slate-500">Seleccionar archivo...</span>
            </div>
          </div>
        </div>
      </form>
      <div class="pt-6 mt-auto border-t border-slate-100">
        <button id="btnSaveTask" class="w-full py-4 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-orange-200 hover:bg-orange-700 transition-all flex items-center justify-center gap-2">
          <i data-lucide="${isEditing ? 'save' : 'send'}" class="w-5 h-5"></i> ${buttonText}
        </button>
      </div>
    </div>
  `;
  createOrGetModal(modalId, content);

  // Pre-rellenar formulario si estamos editando
  if (isEditing) {
    document.getElementById('taskTitle').value = taskToEdit.title;
    document.getElementById('taskDesc').value = taskToEdit.description;
    // El formato para input type="date" es YYYY-MM-DD
    document.getElementById('taskDueDate').value = new Date(taskToEdit.due_date).toISOString().split('T')[0];
    if (taskToEdit.file_url) {
        const fileName = taskToEdit.file_url.split('/').pop().split('?')[0]; // Extracción básica del nombre
        document.getElementById('taskFileName').textContent = decodeURIComponent(fileName);
        document.getElementById('taskFileName').classList.add('text-orange-600', 'font-bold');
    }
  }

  // Lógica para el input de archivo
  const fileInput = document.getElementById('taskFileInput');
  const fileNameEl = document.getElementById('taskFileName');
  fileInput.onchange = () => {
    if (fileInput.files.length > 0) {
      fileNameEl.textContent = fileInput.files[0].name;
      fileNameEl.classList.add('text-orange-600', 'font-bold');
    } else {
      fileNameEl.textContent = 'Seleccionar archivo...';
      fileNameEl.classList.remove('text-orange-600', 'font-bold');
    }
  };

  // Lógica para el botón de guardar
  const saveBtn = document.getElementById('btnSaveTask');
  saveBtn.onclick = async () => {
    const title = document.getElementById('taskTitle').value;
    const description = document.getElementById('taskDesc').value;
    const dueDate = document.getElementById('taskDueDate').value;
    const file = fileInput.files[0];

    // Validación de archivo (PRO: Seguridad)
    // 🔥 FIX: Permitir más formatos y tamaño
    if (file && file.size > 50 * 1024 * 1024) { 
       return safeToast('El archivo es demasiado grande (máx 50MB)', 'error');
    }

    if (!title || !description || !dueDate) {
      return safeToast('Completa todos los campos requeridos.', 'error');
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> ${isEditing ? 'Guardando...' : 'Asignando...'}`;
    requestAnimationFrame(() => window.lucide?.createIcons());

    try {
      let fileUrl = isEditing ? taskToEdit.file_url : null;
      const classroom = AppState.get('classroom');
      if (!classroom) throw new Error('No hay aula activa');

      if (file) {
        // Si se selecciona un nuevo archivo, se sube, incluso en modo edición.
        // Nota: Esto no borra el archivo antiguo. Para un sistema de producción, podrías querer añadir esa lógica.
        const classroomId = classroom.id;
        const filePath = `${classroomId}/${Date.now()}-${file.name}`;
        
        const { error: uploadError } = await supabase.storage
          .from('classroom_media') // 🔥 FIX: Usar bucket existente
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('classroom_media')
          .getPublicUrl(filePath);
        
        fileUrl = urlData.publicUrl;
      }

      const payload = {
        classroom_id: classroom.id,
        title,
        description,
        due_date: dueDate,
        file_url: fileUrl,
        teacher_id: AppState.get('user').id
      };
      
      if (isEditing) {
        await MaestraApi.updateTask(taskToEdit.id, payload);
        safeToast('Tarea actualizada correctamente');
      } else {
        await MaestraApi.createTask(payload);
        // Notificar a los padres solo al crear
        const students = AppState.get('students');
        const classroomName = AppState.get('classroom').name;
        const notificationPromises = students
          .filter(student => student.parent_id)
          .map(student => sendPush({
              user_id: student.parent_id,
              title: `Nueva Tarea en ${classroomName}`,
              message: `Se ha asignado una nueva tarea: "${payload.title}"`,
              link: 'panel_padres.html#tasks'
          }));
        
        await Promise.all(notificationPromises);
        safeToast('Tarea asignada y padres notificados');
      }

      Modal.close(modalId);
      await initTasks();

    } catch (err) {
      console.error('Error guardando tarea:', err);
      safeToast(`Error al ${isEditing ? 'actualizar' : 'crear'} la tarea. Revisa la consola.`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i data-lucide="${isEditing ? 'save' : 'send'}" class="w-5 h-5"></i> ${buttonText}`;
      requestAnimationFrame(() => window.lucide?.createIcons());
    }
  };
}

async function obsolete_viewTaskSubmissions(taskId) {
  const students = AppState.get('students') || [];
  const modalId = 'taskSubmissionsModal';
  try {
    const { data: submissions, error: subError } = await supabase.from('task_evidences').select('*').eq('task_id', taskId);
    if (subError) throw subError;

    const subMap = {};
    (submissions || []).forEach(s => subMap[s.student_id] = s);

    const content = `
      <div class="bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col max-h-[90vh]">
        <div class="flex justify-between items-start mb-6">
          <h3 class="text-2xl font-black text-slate-800">Revisión de Entregas</h3>
          <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <i data-lucide="x" class="w-6 h-6 text-slate-400"></i>
          </button>
        </div>
        <div class="space-y-4 overflow-y-auto pr-2 flex-1">
          ${students.length > 0 ? students.map(s => {
            const sub = subMap[s.id];
            const hasSubmission = sub && sub.file_url;
            const isGraded = sub && sub.status === 'graded';
            const safeUrl = hasSubmission ? encodeURI(sub.file_url) : '#';
            return `
              <div class="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                <div class="flex items-center justify-between mb-4">
                  <div class="font-bold text-slate-800">${safeEscapeHTML(s.name)}</div>
                  ${hasSubmission 
                    ? `<a href="${safeUrl}" target="_blank" class="px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-200 transition-colors flex items-center gap-2">
                         <i data-lucide="download" class="w-3 h-3"></i> Ver Entrega
                       </a>`
                    : `<span class="px-3 py-1.5 bg-slate-100 text-slate-400 rounded-lg text-xs font-bold">Sin entregar</span>`
                  }
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div class="md:col-span-2">
                    <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Retroalimentación</label>
                    <textarea id="feedback-${s.id}" class="w-full p-2 bg-white rounded-lg text-xs border border-slate-200 focus:ring-1 focus:ring-orange-400 outline-none" rows="2" placeholder="Escribe un comentario para el padre...">${safeEscapeHTML(sub?.comment || '')}</textarea>
                  </div>
                  <div class="flex items-center gap-2">
                    <div class="flex-1">
                      <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Nota</label>
                      <select id="grade-${s.id}" class="w-full p-2 rounded-lg text-xs font-bold bg-white border border-slate-200">
                        <option value="">-</option>
                        <option value="A" ${sub?.grade_letter === 'A' ? 'selected' : ''}>A (Excelente)</option>
                        <option value="B" ${sub?.grade_letter === 'B' ? 'selected' : ''}>B (Bien)</option>
                        <option value="C" ${sub?.grade_letter === 'C' ? 'selected' : ''}>C (Suficiente)</option>
                        <option value="D" ${sub?.grade_letter === 'D' ? 'selected' : ''}>D (Mejorable)</option>
                      </select>
                    </div>
                    <div class="flex-1">
                      <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Estrellas</label>
                      <select id="stars-${s.id}" class="w-full p-2 rounded-lg text-xs font-bold bg-white border border-slate-200">
                        ${[0,1,2,3,4,5].map(n => `<option value="${n}" ${sub?.stars === n ? 'selected' : ''}>${'⭐'.repeat(n) || 'Sin estrellas'}</option>`).join('')}
                      </select>
                    </div>
                    <button data-action="submit-grade" data-task-id="${taskId}" data-student-id="${s.id}" class="p-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all self-end" title="Guardar Calificación">
                      <i data-lucide="save" class="w-4 h-4"></i>
                    </button>
                  </div>
                </div>
                ${isGraded ? `<div class="text-xs text-green-600 font-bold mt-2 flex items-center gap-1"><i data-lucide="check-circle" class="w-3 h-3"></i> Calificado</div>` : ''}
              </div>
            `;
          }).join('') : Helpers.emptyState('No hay alumnos en esta clase.')}
        </div>
        <div class="pt-6 mt-auto border-t border-slate-100">
          <button onclick="Modal.close('${modalId}')" class="w-full py-3 bg-slate-100 text-slate-500 rounded-xl font-black text-xs uppercase hover:bg-slate-200 transition-colors">Cerrar</button>
        </div>
      </div>
    `;
    Modal.open(modalId, content);
  } catch (err) {
    console.error('Error al cargar entregas:', err);
    safeToast('Error al cargar entregas', 'error');
  }
}

async function obsolete_submitGrade(taskId, studentId) {
  const grade = document.getElementById(`grade-${studentId}`)?.value;
  const stars = document.getElementById(`stars-${studentId}`)?.value;
  const feedback = document.getElementById(`feedback-${studentId}`)?.value; // Obtener retroalimentación

  if (!grade) return safeToast('Selecciona una nota para calificar.', 'warning');

  try {
    await MaestraApi.gradeTask(taskId, studentId, grade, parseInt(stars), feedback); // Pasar retroalimentación
    
    // Notificar al padre si tiene usuario asignado (Notificación Push)
    const student = (AppState.get('students') || []).find(s => s.id === studentId);
    if (student?.parent_id) {
      sendPush({
        user_id: student.parent_id,
        title: 'Tarea Calificada 🏆',
        message: `La maestra ha calificado una tarea de ${student.name}. Nota: ${grade}`,
        link: 'panel_padres.html#grades'
      }).catch(err => console.warn(`Error notificando calificación a ${student.name}:`, err));
    }
    
    safeToast('Calificación guardada y notificada al padre.');
    // Feedback visual en la tarjeta del alumno dentro del modal
    const el = document.getElementById(`feedback-${studentId}`);
    const studentCard = el ? el.closest('.p-5') : null;
    if (studentCard) {
        studentCard.classList.add('border-green-300');
        setTimeout(() => studentCard.classList.remove('border-green-300'), 2000);
    }
  } catch (e) {
    console.error('Error al calificar tarea:', e);
    safeToast('Error al calificar', 'error');
  }
}

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
      if (targetTab === 'videocall')     initVideocall();
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

async function obsolete_initChat() {
  const container = document.getElementById('chatContactsList');
  if (!container) return;

  try {
    // 1. Obtener conteo de mensajes no leídos (Unificado)
    const unreadMap = await ChatModule.getUnreadCounts();

    const students = AppState.get('students') || [];
    // Filtrar estudiantes que tienen padre asignado y crear lista única de padres
    const parentsMap = new Map();
    
    students.forEach(s => {
      if (s.parent_id) {
        // Usamos el ID del padre como clave
        if (!parentsMap.has(s.parent_id)) {
          parentsMap.set(s.parent_id, {
            id: s.parent_id,
            name: s.name, // 🔥 Ahora mostramos al estudiante
            childName: s.name, // Nombre del hijo para referencia
            avatar: s.avatar_url || null // 🔥 Avatar del estudiante
          });
        } else {
          // Si tiene varios hijos, concatenar nombres
          const p = parentsMap.get(s.parent_id);
          if (!p.childName.includes(s.name)) {
            p.childName += `, ${s.name}`;
          }
        }
      }
    });

    const contacts = Array.from(parentsMap.values());

    if (contacts.length === 0) {
      container.innerHTML = `<div class="p-4 text-center text-slate-400 text-sm">No hay padres registrados aún.</div>`;
      return;
    }

    container.innerHTML = contacts.map(c => {
      const unread = unreadMap[c.id] || 0;
      return `
      <div onclick="App.selectChatContact('${c.id}', '${safeEscapeHTML(c.name)}', '${safeEscapeHTML(c.childName)}')" 
           class="p-3 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors flex items-center gap-3 border-b border-slate-50 last:border-0 relative">
        <div class="relative">
          <div class="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
            ${c.name.charAt(0)}
          </div>
          ${unread > 0 ? `<div class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm animate-pulse">${unread}</div>` : ''}
        </div>
        <div class="min-w-0">
          <div class="font-bold text-slate-700 text-sm truncate">${safeEscapeHTML(c.name)}</div>
          <div class="text-[10px] text-slate-400 truncate">Papá/Mamá de: ${safeEscapeHTML(c.childName)}</div>
        </div>
      </div>
    `}).join('');

    // Listener para enviar mensaje
    const btnSend = document.getElementById('btnSendChatMessage');
    const inputMsg = document.getElementById('chatMessageInput');
    
    if (btnSend && inputMsg) {
      // Remover listeners anteriores para evitar duplicados
      const newBtn = btnSend.cloneNode(true);
      btnSend.parentNode.replaceChild(newBtn, btnSend);
      
      newBtn.addEventListener('click', () => sendChatMessage());
      inputMsg.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage();
        }
      });
    }

  } catch (err) {
    console.error('Error initChat:', err);
  }
}

async function obsolete_selectChatContact(userId, name, meta) {
  activeChatUserId = userId;
  activeConversationId = null; // Resetear al cambiar de contacto
  
  // UI Updates
  const header = document.getElementById('chatActiveHeader');
  if (header) {
    header.classList.remove('hidden');
    header.classList.add('flex');
  }
  
  const nameEl = document.getElementById('chatActiveName');
  if (nameEl) nameEl.textContent = name;
  
  const metaEl = document.getElementById('chatActiveMeta');
  if (metaEl) metaEl.textContent = meta;
  
  const avatarEl = document.getElementById('chatActiveAvatar');
  if (avatarEl) avatarEl.innerHTML = name.charAt(0);

  const inputArea = document.getElementById('chatInputArea');
  if (inputArea) inputArea.classList.remove('hidden');
  
  const messagesContainer = document.getElementById('chatMessagesContainer');
  if (messagesContainer) {
    messagesContainer.innerHTML = '<div class="flex justify-center p-4"><div class="animate-spin w-6 h-6 border-2 border-orange-500 rounded-full border-t-transparent"></div></div>';
  }

  // Cargar Historial
  await loadChatMessages(userId);
}

/**
 * Busca o inicializa la conversación (sin crearla en DB hasta enviar mensaje, 
 * pero buscamos si ya existe para cargar historial)
 */
async function obsolete_loadChatMessages(otherUserId) {
  const user = AppState.get('user');
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;
  let messages = [];
  
  try {
    // 1. Carga optimizada mediante ChatModule
    const { messages: loadedMsgs, conversationId } = await ChatModule.loadConversation(otherUserId);
    messages = loadedMsgs;
    activeConversationId = conversationId;

    if (messages.length > 0) {
      renderMessages(messages, user.id);
      subscribeToChat(activeConversationId);
      
      // Marcar como leídos silenciosamente
      ChatModule.markAsRead(activeConversationId);
      return;
    }
    
    // Si llegamos aquí, no hay conversación previa
    activeConversationId = null; 
    container.innerHTML = '<div class="text-center text-xs text-slate-400 mt-4 italic">Inicio de la conversación. Di hola 👋</div>';

  } catch (err) {
    console.error("Error cargando chat:", err);
    container.innerHTML = '<div class="text-center text-xs text-red-400 mt-4">Error cargando mensajes.</div>';
  }

  renderMessages(messages, user.id);
}

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

async function obsolete_subscribeToChat(conversationId) {
  if (!conversationId) return;
  
  // Usar suscripción del módulo compartido
  ChatModule.subscribeToConversation(conversationId, (newMsg) => {
    // Simplemente recargamos o añadimos al UI existente
    // Aquí reutilizamos la lógica existente de recarga por simplicidad, 
    // pero idealmente haríamos un appendMessages([newMsg])
    loadChatMessages(activeChatUserId); 
  });
}

// =======================================================
// 📝 LÓGICA DE NUEVA PUBLICACIÓN (MURO)
// =======================================================
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

    // Notify parents of this classroom
    const students = AppState.get('students') || [];
    const classroom = AppState.get('classroom');
    students.forEach(s => {
      if (s.parent_id) {
        sendPush({
          user_id: s.parent_id,
          title: '📢 Nueva publicación en el muro',
          message: `La maestra publicó en el muro de ${classroom?.name || 'tu aula'}.`,
          type: 'post',
          link: 'panel_padres.html'
        }).catch(() => {});
      }
    });
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
      '<div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">' +
        '<table class="w-full text-sm text-left">' +
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
