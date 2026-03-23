import { ensureRole, supabase, sendPush, initOneSignal } from '../shared/supabase.js';
import { AppState } from './state.js';
import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { WallModule } from './wall.module.js';
import { DashboardService } from '../directora/dashboard.service.js';
import { VideoCallModule } from '../shared/videocall.js';

// Importar nuevos módulos refactorizados
import { UIHelpers, DirectorUI } from './ui.module.js';
import { StudentsModule } from './students.module.js';
import { TeachersModule } from './teachers.module.js';
import { PaymentsModule } from './payments.module.js';
import { GradesModule } from './grades.module.js';
import { AttendanceModule } from './attendance.module.js';
import { ChatModule } from './chat.module.js';
import { InquiriesModule } from './inquiries.module.js';
import { RoomsModule } from './rooms.module.js';

/**
 * 🧠 0. DEFINICIÓN GLOBAL DE APP (INICIO PARA EVITAR REFERENCE ERRORS)
 */
window.App = {
  navigation: { goTo: goToSection },
  students: StudentsModule,
  teachers: {
    ...TeachersModule,
    edit: (id) => TeachersModule.openModal(id)
  },
  rooms: RoomsModule,
  payments: PaymentsModule,
  attendance: AttendanceModule,
  grades: GradesModule,
  ui: { ...UIHelpers, ...DirectorUI },
  inquiries: InquiriesModule,
  chat: ChatModule,
  wall: {
    toggleCommentSection: (pid) => WallModule.toggleCommentSection(pid),
    sendComment: (pid) => WallModule.sendComment(pid),
    deletePost: (pid) => WallModule.deletePost(pid),
    toggleLike: (pid) => WallModule.toggleLike(pid),
    openNewPostModal: () => WallModule.openNewPostModal(),
    loadPosts: (container) => WallModule.loadPosts(container || 'muroPostsContainer')
  }
};

// Exponer WallModule globalmente para onclicks del HTML
window.WallModule = WallModule;

/**
 * 🛠️ SISTEMA GLOBAL DE MODALES (Refactorizado con clase active)
 */
window.openGlobalModal = function(html) {
  const container = document.getElementById('globalModalContainer');
  if (!container) return;

  // El html ya incluye modal-header/body/footer, solo necesita el wrapper scroll
  container.innerHTML = `<div class="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">${html}</div>`;
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  
  if (window.lucide) lucide.createIcons();
};

/**
 * 👤 CARGAR PERFIL DINÁMICO
 */
async function loadProfile() {
  try {
    const profile = AppState.get('profile');
    if (!profile) return;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('confDirName', profile.name);
    setVal('confDirTitle', profile.title);
    setVal('confDirBio', profile.bio);
    setVal('confPhone', profile.phone);
    setVal('confEmail', profile.email);
    setVal('confAddress', profile.address);

    const nameEl = document.getElementById('sidebarName'); if(nameEl) nameEl.textContent = profile.name || 'Directora';
    const avatarEl = document.getElementById('sidebarAvatar');
    if (avatarEl) {
      avatarEl.innerHTML = profile.avatar_url
        ? `<img src="${profile.avatar_url}" class="w-full h-full object-cover" onerror="this.src='img/mundo.jpg';">`
        : `<div class="w-full h-full flex items-center justify-center text-xl font-black text-orange-600 bg-orange-50">${(profile.name || 'D').charAt(0)}</div>`;
    }
  } catch (e) { console.error('Error loadProfile:', e); }
}

/**
 * 📊 INICIALIZAR DASHBOARD
 */
async function initDashboard() {
  try {
    const dashboardData = await DashboardService.getFullData();
    AppState.set('dashboardData', dashboardData);
    AppState.set('stats', dashboardData.kpis);

    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const kpis = dashboardData.kpis || {};
    setTxt('kpiStudents', kpis.total || 0);
    setTxt('kpiTeachers', kpis.teachers || 0);
    setTxt('kpiClassrooms', kpis.classrooms || 0);
    setTxt('kpiIncidents', kpis.inquiries || 0);
    
    const attTotal = dashboardData.attendance?.today?.total || 0;
    const attPresent = (dashboardData.attendance?.today?.present || 0) + (dashboardData.attendance?.today?.late || 0);
    const attPercent = attTotal > 0 ? Math.round((attPresent / attTotal) * 100) : 0;
    setTxt('kpiAttendance', `${attPercent}%`);
    setTxt('kpiPendingMoney', `$${dashboardData.payments?.summary?.total_pending || 0}`);

    // Estudiantes recientes
    const studentsContainer = document.getElementById('recentStudents');
    if (studentsContainer) {
      if (dashboardData.students?.recent?.length) {
        studentsContainer.innerHTML = dashboardData.students.recent.slice(0, 10).map(s => `
          <div class="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100 hover:shadow-md transition-all cursor-pointer group" onclick="App.navigation.goTo('estudiantes')">
            <div class="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center font-black overflow-hidden">
              ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : (s.name || '?').charAt(0)}
            </div>
            <div class="min-w-0 flex-1">
              <div class="font-bold text-slate-800 text-sm truncate group-hover:text-purple-600">${Helpers.escapeHTML(s.name || 'Estudiante')}</div>
              <div class="text-[10px] text-slate-400 font-bold uppercase">${s.classrooms?.name || 'Sin aula'}</div>
            </div>
            <i data-lucide="chevron-right" class="w-4 h-4 text-slate-300 group-hover:text-purple-400 transition-colors"></i>
          </div>`).join('');
      } else {
        studentsContainer.innerHTML = Helpers.emptyState('No hay estudiantes recientes');
      }
    }

    // Aulas con semáforo
    const classroomsContainer = document.getElementById('classroomsGrid');
    if (classroomsContainer) {
      if (dashboardData.classrooms?.length) {
        classroomsContainer.innerHTML = dashboardData.classrooms.map(c => {
          const color = c.occupancyStatus === 'red' ? 'border-rose-200 bg-rose-50 text-rose-700' :
                        c.occupancyStatus === 'yellow' ? 'border-amber-200 bg-amber-50 text-amber-700' :
                        'border-emerald-200 bg-emerald-50 text-emerald-700';
          const percent = c.max_capacity ? Math.round((c.current_capacity / c.max_capacity) * 100) : 0;
          return `
            <div class="p-4 border-2 rounded-2xl ${color} flex flex-col items-center text-center">
              <div class="font-black text-sm mb-1">${Helpers.escapeHTML(c.name || 'Aula')}</div>
              <div class="text-[10px] font-bold uppercase opacity-70 mb-2">${c.current_capacity || 0}/${c.max_capacity || 0} Niños</div>
              <div class="w-full h-1.5 bg-white/50 rounded-full overflow-hidden">
                <div class="h-full bg-current opacity-50" style="width: ${percent}%"></div>
              </div>
            </div>`;
        }).join('');
      } else {
        classroomsContainer.innerHTML = Helpers.emptyState('No hay aulas');
      }
    }

    if (window.lucide) lucide.createIcons();
  } catch (error) {
    console.error('Error initDashboard:', error);
    Helpers.toast('Error al cargar datos del dashboard', 'error');
  }
}

/**
 * 🧭 NAVEGACIÓN
 */
function initNavigation() {
  const navLinks = document.querySelectorAll('[data-section]');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      goToSection(link.dataset.section);
    });
  });
}

function goToSection(sectionId) {
  if (!sectionId) return;

  // Ocultar todas las secciones
  document.querySelectorAll('section.section').forEach(s => {
    s.classList.add('hidden');
    s.classList.remove('active');
  });

  // Mostrar la sección destino
  const targetSec = document.getElementById(sectionId);
  if (targetSec) {
    targetSec.classList.remove('hidden');
    targetSec.classList.add('active');
    AppState.set('currentSection', sectionId);
    
    // Cargar data según la sección
    switch(sectionId) {
      case 'dashboard': initDashboard(); break;
      case 'maestros': App.teachers.init(); break;
      case 'estudiantes': App.students.init(); break;
      case 'aulas': App.rooms.init(); break;
      case 'calificaciones': App.grades.init(); break;
      case 'asistencia': App.attendance.loadAttendance(); break;
      case 'pagos': App.payments.init(); break;
      case 'reportes': App.inquiries.init(); break;
      case 'muro': App.wall.loadPosts ? App.wall.loadPosts() : WallModule.loadPosts('muroPostsContainer'); break;
      case 'videoconferencia': VideoCallModule.init(); break;
    }

    // Actualizar estado visual de los botones de navegación
    document.querySelectorAll('[data-section]').forEach(el => {
      if (el.dataset.section === sectionId) {
        el.classList.add('bg-slate-800', 'text-white');
        el.classList.remove('text-slate-500');
      } else {
        el.classList.remove('bg-slate-800', 'text-white');
        el.classList.add('text-slate-500');
      }
    });
  }
}

/**
 * 🚀 INICIALIZACIÓN APP
 */
async function initApp() {
  console.log('🚀 Karpus Admin Module Starting...');
  const auth = await ensureRole(['directora', 'admin']);
  if (!auth) return;
  
  AppState.set('user', auth.user);
  AppState.set('profile', auth.profile);

  // Bind de eventos principales
  const bindClick = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
  };

  bindClick('btnAddStudent', () => App.students.openModal());
  bindClick('btnNewPayment', () => App.payments.openPaymentModal());
  bindClick('btnAddAssistant', () => App.teachers.openModal());
  bindClick('btnAddRoom', () => App.rooms.openModal());
  bindClick('btnLogout', async () => { await supabase.auth.signOut(); window.location.href = 'login.html'; });

  // Dashboard cards
  bindClick('cardReportes', () => goToSection('reportes'));
  bindClick('cardMuro', () => goToSection('muro'));
  bindClick('cardVideoconferencia', () => goToSection('videoconferencia'));
  bindClick('cardComunicaciones', () => goToSection('comunicacion'));

  // Dashboard actions
  bindClick('btnRefreshDashboard', async () => {
    const btn = document.getElementById('btnRefreshDashboard');
    if(btn) btn.classList.add('animate-spin');
    await initDashboard();
    if(btn) btn.classList.remove('animate-spin');
    Helpers.toast('Dashboard actualizado', 'success');
  });
  
  // Botón volver a clases (Fix: Listener faltante)
  bindClick('backToClasses', () => goToSection('dashboard'));

  bindClick('btnSaveConfig', saveConfigProfile);

  // Alias global para compatibilidad con HTML inline
  window.openCreateRoomModal = (id) => App.rooms.openModal(id);

  initNavigation();
  loadProfile();

  try { initOneSignal(auth.user); } catch(e) { console.error("OneSignal error:", e); }

  // Carga inicial: dashboard primero, luego módulos secundarios
  await initDashboard().catch(e => console.error('Dashboard init error:', e));

  Promise.allSettled([
    DashboardService.subscribeToChanges(),
    AttendanceModule.init(),
    ChatModule.init(),
    VideoCallModule.init(),
    WallModule.init('muroPostsContainer', { accentColor: 'orange' }, AppState),
    InquiriesModule.init()
  ]).then(results => {
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`Module ${i} init failed:`, r.reason);
    });
  });

  // Listeners globales
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') App.ui.closeModal(); });
  document.addEventListener('click', (e) => { if (e.target.id === 'globalModalContainer') App.ui.closeModal(); });

  // Listener para data-action="go-section"
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action="go-section"]');
    if (el?.dataset.section) goToSection(el.dataset.section);
  });

  goToSection('dashboard');
  if (window.lucide) lucide.createIcons();

  // Ocultar loader
  const loader = document.getElementById('initial-loading');
  if (loader) {
    loader.style.opacity = '0';
    loader.style.transition = 'opacity 0.4s ease';
    setTimeout(() => loader.remove(), 450);
  }
}

// ✅ Guardar configuración
async function saveConfigProfile() {
  const btn = document.getElementById('btnSaveConfig');
  if (!btn) return;

  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Guardando...';
  if (window.lucide) lucide.createIcons();

  try {
    const user = AppState.get('user');
    const updates = {
      name: document.getElementById('confDirName')?.value,
      title: document.getElementById('confDirTitle')?.value,
      bio: document.getElementById('confDirBio')?.value,
      phone: document.getElementById('confPhone')?.value,
      email: document.getElementById('confEmail')?.value,
      address: document.getElementById('confAddress')?.value,
      updated_at: new Date()
    };

    const { error } = await supabase.from('profiles').update(updates).eq('id', user.id);
    if (error) throw error;
    
    Helpers.toast('Configuración actualizada', 'success');
    // Actualizar perfil en estado y UI
    const { data: newProfile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    AppState.set('profile', newProfile);
    await loadProfile();
  } catch (e) {
    console.error('Error saving config:', e);
    Helpers.toast('Error al guardar configuración', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save" class="w-4 h-4"></i> Guardar Cambios';
    if (window.lucide) lucide.createIcons();
  }
}

// Arrancar App
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
