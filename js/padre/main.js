import { supabase, ensureRole, initOneSignal } from '../shared/supabase.js';
import { Api } from './api.js';
import { Helpers } from './helpers.js';
import { AppState } from './appState.js';
import { VideoCallModule } from '../shared/videocall.js';

// Importar Módulos
import { PaymentsModule } from './payments.js';
import { TasksModule } from './tasks.js';
import { AttendanceModule } from './attendance.js';
import { ChatModule } from './chat.js';
import { FeedModule } from './feed.js';
import { ProfileModule } from './profile.js';
import { GradesModule } from './grades.js';
import { initLiveClassListener } from './attendance_live.js';

/**
 * 👨‍👩‍👧 LÓGICA PRINCIPAL PANEL PADRES
 */
window.App = {
  feed: FeedModule,
  payments: PaymentsModule,
  tasks: TasksModule,
  attendance: AttendanceModule,
  chat: ChatModule,
  profile: ProfileModule,
  grades: GradesModule,
  navigateTo: navigateTo
};

document.addEventListener('DOMContentLoaded', async () => {
  try {
    AppState.set('loading', true);

    // 1. Seguridad y Autenticación
    const auth = await ensureRole('padre');
    if (!auth) return;
    
    AppState.set('user', auth.user);
    AppState.set('profile', auth.profile);

    // 2. Notificaciones Push
    try { await initOneSignal(auth.user); } catch(e) { console.warn("OneSignal skipping..."); }

    // 3. Obtener Estudiante (Hijo)
    const { data: students, error } = await supabase
      .from('students')
      .select('*, classrooms(id, name, level, teacher_id)')
      .eq('parent_id', auth.user.id);

    if (error) throw error;
    if (!students?.length) {
      document.getElementById('dashboardContent').innerHTML = Helpers.emptyState('No hay estudiantes vinculados a esta cuenta.');
      return;
    }

    // Seleccionar primer hijo por defecto
    const currentStudent = students[0];
    AppState.set('students', students);
    AppState.set('currentStudent', currentStudent);

    // 4. Inicializar UI Base
    updateHeaderProfile(auth.profile, currentStudent);
    setupNavigation();
    setupGlobalListeners();

    // 5. Carga de Datos Inicial (Home)
    await refreshDashboard();

    // 6. Listener de Clase en Vivo
    if (currentStudent?.classroom_id) {
      initLiveClassListener(currentStudent.classroom_id);
    }

    console.log('🚀 Karpus Parent Panel Ready');
  } catch (err) {
    console.error('Init Error:', err);
    Helpers.toast('Error al iniciar el panel', 'error');
  } finally {
    AppState.set('loading', false);
  }
});

/**
 * 🔄 Refrescar Dashboard (Home)
 */
async function refreshDashboard() {
  const student = AppState.get('currentStudent');
  if (!student) return;

  try {
    // Carga paralela de datos para el Home
    const [finance, academic, logs] = await Promise.all([
      Api.getStudentFinancialStatus(student.id),
      Api.getStudentGrades(student.id),
      Api.getDailyLog(student.id, new Date().toISOString().split('T')[0])
    ]);

    renderHomeCards(student, { finance, academic });
    renderDailySummary(logs);
    checkActiveMeetings();
  } catch (e) {
    console.error('Refresh Error:', e);
  }
}

/**
 * 📊 Renderiza las tarjetas de acceso rápido (Bento Grid)
 */
function renderHomeCards(student, data) {
  const grid = document.getElementById('dashboardGrid');
  if (!grid) return;

  const { finance, academic } = data;
  const debt = finance?.debt?.total || 0;

  const cards = [
    { id: 'attendance', title: 'Asistencia', value: 'Hoy', sub: 'Ver reporte', icon: '📅', color: 'bg-emerald-50 text-emerald-600', target: 'live-attendance' },
    { id: 'tasks', title: 'Tareas', value: academic?.evidences?.length || 0, sub: 'Entregadas', icon: '🎒', color: 'bg-blue-50 text-blue-600', target: 'tasks' },
    { id: 'payments', title: 'Pagos', value: Helpers.formatCurrency(debt), sub: debt > 0 ? 'Pendiente' : 'Al día', icon: '💳', color: debt > 0 ? 'bg-rose-50 text-rose-600' : 'bg-teal-50 text-teal-600', target: 'payments' },
    { id: 'chat', title: 'Mensajes', value: 'Chat', sub: 'Con maestros', icon: '💬', color: 'bg-indigo-50 text-indigo-600', target: 'notifications' }
  ];

  grid.innerHTML = cards.map(c => `
    <div class="patio-card p-4 cursor-pointer hover:scale-[1.02] transition-all active:scale-95 group" data-target="${c.target}">
      <div class="flex justify-between items-start mb-4">
        <div class="w-10 h-10 rounded-xl ${c.color} flex items-center justify-center text-xl shadow-sm group-hover:shadow-md transition-all">${c.icon}</div>
        <i data-lucide="chevron-right" class="w-4 h-4 text-slate-300 group-hover:text-slate-500"></i>
      </div>
      <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">${c.title}</p>
      <h4 class="text-lg font-black text-slate-800 leading-tight">${c.value}</h4>
      <p class="text-[10px] font-bold text-slate-500">${c.sub}</p>
    </div>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

/**
 * 📝 Renderiza el resumen del día (Daily Logs)
 */
function renderDailySummary(log) {
  const container = document.getElementById('dailySummaryCard');
  if (!container) return;

  if (!log) {
    container.innerHTML = Helpers.emptyState('Aún no hay reporte del día', '✨');
    return;
  }

  const moodMap = { feliz: '😃', normal: '😐', triste: '😢', inquieto: '😫' };
  
  container.innerHTML = `
    <div class="patio-card p-6 bg-gradient-to-br from-white to-slate-50 border border-slate-100 relative overflow-hidden group animate-fade-in">
      <div class="absolute top-0 right-0 w-24 h-24 bg-yellow-100 rounded-full -mr-10 -mt-10 opacity-40 group-hover:scale-110 transition-transform duration-700"></div>
      <div class="relative z-10">
        <h3 class="font-black text-slate-800 text-lg mb-6 flex items-center gap-2">
          <span class="bg-orange-100 text-orange-600 p-1.5 rounded-lg"><i data-lucide="clipboard-list" class="w-5 h-5"></i></span>
          Resumen del Día
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3">
            <div class="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center text-2xl shadow-inner">${moodMap[log.mood?.toLowerCase()] || '✨'}</div>
            <div><p class="text-[10px] font-black text-slate-400 uppercase tracking-wider">Ánimo</p><p class="font-bold text-slate-700 capitalize">${log.mood || 'Bien'}</p></div>
          </div>
          <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3">
            <div class="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-2xl shadow-inner">🍽️</div>
            <div><p class="text-[10px] font-black text-slate-400 uppercase tracking-wider">Comida</p><p class="font-bold text-slate-700">${log.food || 'Sin registro'}</p></div>
          </div>
          <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3">
            <div class="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center text-2xl shadow-inner">😴</div>
            <div><p class="text-[10px] font-black text-slate-400 uppercase tracking-wider">Siesta</p><p class="font-bold text-slate-700">${log.nap || log.sleeping || 'No registrada'}</p></div>
          </div>
        </div>
      </div>
    </div>`;
  
  if (window.lucide) lucide.createIcons();
}

/**
 * 🧭 Navegación Global
 */
export function navigateTo(targetId) {
  if (!targetId) return;

  // 1. Manejo de Clases Active/Hidden
  document.querySelectorAll('.section').forEach(sec => {
    sec.classList.add('hidden');
    sec.classList.remove('active');
  });

  const target = document.getElementById(targetId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
    AppState.set('currentSection', targetId);
    
    // 2. Carga bajo demanda por módulo
    const student = AppState.get('currentStudent');
    switch(targetId) {
      case 'home': refreshDashboard(); break;
      case 'payments': PaymentsModule.init(student.id); break;
      case 'tasks': TasksModule.init(student.id); break;
      case 'live-attendance': AttendanceModule.init(student.id); break;
      case 'notifications': ChatModule.init(); break;
      case 'class': FeedModule.init(student.classroom_id); break;
      case 'profile': ProfileModule.init(); break;
      case 'grades': GradesModule.init(student.id); break;
    }
  }

  // 3. Actualizar Botones Nav
  document.querySelectorAll('[data-target]').forEach(btn => {
    if (btn.dataset.target === targetId) {
      btn.classList.add('active', 'text-indigo-600');
      btn.classList.remove('text-slate-400');
    } else {
      btn.classList.remove('active', 'text-indigo-600');
      btn.classList.add('text-slate-400');
    }
  });
}

function setupNavigation() {
  // Delegación de eventos para navegación
  Helpers.delegate(document.body, '[data-target]', 'click', (e, target) => {
    navigateTo(target.dataset.target);
  });
}

function setupGlobalListeners() {
  // Suscripción al estado para cambios reactivos
  AppState.subscribe('currentStudent', (student) => {
    if (student) {
      updateHeaderProfile(AppState.get('profile'), student);
      
      // Reiniciar listener de clase en vivo si cambia el estudiante
      if (student.classroom_id) {
        initLiveClassListener(student.classroom_id);
      }
      
      navigateTo('home');
    }
  });
}

function updateHeaderProfile(profile, student) {
  const guardianName = profile?.name || 'Familia';
  const studentName = student?.name || 'Estudiante';
  
  // Mostrar nombre del estudiante en el saludo principal (petición del usuario)
  document.querySelectorAll('.guardian-name-display').forEach(el => el.textContent = studentName);
  
  // Mostrar nombre del estudiante en otros lugares si es necesario
  document.querySelectorAll('.student-name-display').forEach(el => el.textContent = studentName);
  
  document.querySelectorAll('.classroom-name-display').forEach(el => el.textContent = student?.classrooms?.name || 'Sin aula');

  const avatarContainer = document.getElementById('headerStudentAvatar');
  if (avatarContainer && student?.avatar_url) {
    avatarContainer.innerHTML = `<img src="${student.avatar_url}" class="w-full h-full object-cover">`;
  }

  // Refrescar iconos
  if (window.lucide) lucide.createIcons();
}

async function checkActiveMeetings() {
  try {
    const meetings = await VideoCallModule.getMyMeetings('padre');
    const active = meetings.find(m => m.status === 'live');
    const btn = document.querySelector('.node-videocall');
    
    if (!btn) return;
    if (!active) { btn.classList.add('hidden'); return; }

    btn.classList.remove('hidden');
    if (!btn._initialized) {
      btn.onclick = () => {
        const currentActive = btn._activeMeeting;
        if (currentActive) {
          navigateTo('videocall');
          VideoCallModule.joinMeeting(currentActive, 'meet', AppState.get('profile'));
        }
      };
      btn._initialized = true;
    }
    btn._activeMeeting = active;
  } catch (e) { console.warn('Meeting check failed'); }
}
