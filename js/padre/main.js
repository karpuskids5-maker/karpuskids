import { supabase, ensureRole, initOneSignal } from '../shared/supabase.js';
import { Api } from './api.js';
import { Helpers } from './helpers.js';
import { AppState } from './appState.js';
import { VideoCallModule } from '../shared/videocall.js';
import { PaymentsModule }  from './payments.js';
import { TasksModule }     from './tasks.js';
import { AttendanceModule } from './attendance.js';
import { ChatModule }      from './chat.js';
import { FeedModule }      from './feed.js';
import { ProfileModule }   from './profile.js';
import { GradesModule }    from './grades.js';
import { initLiveClassListener } from './attendance_live.js';

window.App = {
  feed: FeedModule, payments: PaymentsModule, tasks: TasksModule,
  attendance: AttendanceModule, chat: ChatModule, profile: ProfileModule,
  grades: GradesModule, navigateTo: navigateTo
};

document.addEventListener('DOMContentLoaded', async () => {
  try {
    AppState.set('loading', true);

    const auth = await ensureRole('padre');
    if (!auth) return;

    AppState.set('user', auth.user);
    AppState.set('profile', auth.profile);

    try { await initOneSignal(auth.user); } catch (_) {}

    const { data: students, error } = await supabase
      .from('students')
      .select('*, classrooms(id, name, level, teacher_id)')
      .eq('parent_id', auth.user.id);

    if (error) throw error;
    if (!students?.length) {
      const el = document.getElementById('dashboardGrid');
      if (el) el.innerHTML = Helpers.emptyState('No hay estudiantes vinculados a esta cuenta.');
      return;
    }

    const currentStudent = students[0];
    AppState.set('students', students);
    AppState.set('currentStudent', currentStudent);

    // Actualizar sidebar y header ANTES de cargar datos
    updateHeaderProfile(auth.profile, currentStudent);
    setupNavigation();
    setupGlobalListeners();

    // Activar sección home inmediatamente
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    const homeSection = document.getElementById('home');
    if (homeSection) {
      homeSection.classList.remove('hidden');
      homeSection.classList.add('active');
    }

    // Mostrar skeletons inmediatamente
    const grid    = document.getElementById('dashboardGrid');
    const summary = document.getElementById('dailySummaryCard');
    if (grid)    grid.innerHTML    = Helpers.skeleton(5, 'h-28');
    if (summary) summary.innerHTML = Helpers.skeleton(1, 'h-40');

    // Carga paralela — no bloquea UI
    refreshDashboard();

    if (currentStudent?.classroom_id) {
      initLiveClassListener(currentStudent.classroom_id);
    }

    // Logout — ambos botones (móvil y desktop)
    const logoutHandler = async () => {
      await supabase.auth.signOut();
      window.location.href = 'login.html';
    };
    document.getElementById('btnLogout')?.addEventListener('click', logoutHandler);
    document.getElementById('btnLogoutDesktop')?.addEventListener('click', logoutHandler);

    // Badge de mensajes no leídos
    loadUnreadBadge();
    initMessageBadgeRealtime();

  } catch (err) {
    console.error('Init Error:', err);
    Helpers.toast('Error al iniciar el panel', 'error');
  } finally {
    AppState.set('loading', false);
  }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function refreshDashboard() {
  const student = AppState.get('currentStudent');
  if (!student) return;

  const today = new Date().toISOString().split('T')[0];

  // Carga paralela — allSettled para que un fallo no bloquee el resto
  const [financeRes, academicRes, logsRes, todayAttRes] = await Promise.allSettled([
    Api.getStudentFinancialStatus(student.id),
    Api.getStudentGrades(student.id),
    Api.getDailyLog(student.id, today),
    supabase.from('attendance').select('status').eq('student_id', student.id).eq('date', today).maybeSingle()
  ]);

  const finance  = financeRes.status  === 'fulfilled' ? financeRes.value  : null;
  const academic = academicRes.status === 'fulfilled' ? academicRes.value : null;
  const logs     = logsRes.status     === 'fulfilled' ? logsRes.value     : null;
  const todayAtt = todayAttRes.status === 'fulfilled' ? todayAttRes.value?.data : null;

  if (finance?.config) AppState.set('financeConfig', finance.config);
  AppState.set('todayAttendance', todayAtt?.status || null);

  renderHomeCards(student, { finance, academic, todayAtt: todayAtt?.status });
  renderDailySummary(logs);

  // checkActiveMeetings en background — no bloquea las tarjetas
  checkActiveMeetings().catch(() => {});
}

// ── Tarjetas del Dashboard ────────────────────────────────────────────────────
function renderHomeCards(student, data) {
  const grid = document.getElementById('dashboardGrid');
  if (!grid) return;

  const { finance, academic, todayAtt } = data || {};
  const debtTotal = finance?.debt?.total || 0;
  const pendingItems = finance?.debt?.items || [];
  const inReview = pendingItems.filter(p => p.evidence_url || p.proof_url).length > 0;
  const isLive = AppState.get('isClassLive');

  // Mapeo de estados de asistencia
  const attLabels = {
    present: 'Presente',
    presente: 'Presente',
    absent: 'Ausente',
    ausente: 'Ausente',
    late: 'Tarde',
    tarde: 'Tarde'
  };
  const currentAtt = attLabels[todayAtt?.toLowerCase()] || 'Hoy';

  // Iconos como unicode para evitar problemas de encoding
  const ICONS = {
    calendar:  '\uD83D\uDCC5', // 📅
    chat:      '\uD83D\uDCAC', // 💬
    video:     '\uD83C\uDFA5', // 🎥
    card:      '\uD83D\uDCB3', // 💳
    trophy:    '\uD83C\uDFC6', // 🏆
    live:      '\uD83D\uDD34', // 🔴
  };

  const cards = [
    {
      title: 'Asistencia',
      value: currentAtt,
      sub: todayAtt ? 'Actualizado' : 'Ver registro',
      icon: ICONS.calendar,
      color: todayAtt ? 'border-emerald-300' : 'border-emerald-200',
      iconBg: todayAtt ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-700',
      target: 'live-attendance'
    },
    {
      title: 'Chat',
      value: 'Mensajes',
      sub: 'Con el personal',
      icon: ICONS.chat,
      color: 'border-sky-200',
      iconBg: 'bg-sky-100 text-sky-700',
      target: 'notifications'
    },
    {
      title: isLive ? 'Clase en Vivo' : 'Videollamada',
      value: isLive ? (ICONS.live + ' En vivo') : 'Aula Virtual',
      sub: isLive ? 'Unirse ahora' : 'Disponible pronto',
      icon: ICONS.video,
      color: isLive ? 'border-rose-300 ring-2 ring-rose-300 animate-pulse' : 'border-violet-200',
      iconBg: isLive ? 'bg-rose-100 text-rose-700' : 'bg-violet-100 text-violet-700',
      target: 'videocall'
    },
    {
      title: 'Pagos',
      value: Helpers.formatCurrency(debtTotal),
      sub: debtTotal > 0 ? 'Pendiente' : (inReview ? 'En Revisión' : 'Al día'),
      icon: ICONS.card,
      color: debtTotal > 0 ? 'border-amber-200' : (inReview ? 'border-blue-200' : 'border-emerald-200'),
      iconBg: debtTotal > 0 ? 'bg-amber-100 text-amber-700' : (inReview ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'),
      target: 'payments'
    },
    {
      title: 'Notas',
      value: String(academic?.evidences?.length ?? 0),
      sub: 'Calificaciones',
      icon: ICONS.trophy,
      color: 'border-green-200',
      iconBg: 'bg-green-100 text-green-700',
      target: 'grades'
    }
  ];

  grid.innerHTML = cards.map(c =>
    '<div class="bg-white rounded-2xl p-4 border-2 ' + c.color + ' shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer group" data-target="' + c.target + '">' +
      '<div class="flex justify-between items-start mb-3">' +
        '<div class="w-11 h-11 rounded-xl ' + c.iconBg + ' flex items-center justify-center text-xl shadow-sm group-hover:scale-110 transition-transform">' + c.icon + '</div>' +
        '<i data-lucide="chevron-right" class="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors mt-1"></i>' +
      '</div>' +
      '<p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">' + c.title + '</p>' +
      '<h4 class="text-sm font-black text-slate-800 leading-tight">' + c.value + '</h4>' +
      '<p class="text-[10px] font-bold text-slate-500 mt-0.5">' + c.sub + '</p>' +
    '</div>'
  ).join('');

  if (window.lucide) lucide.createIcons();
}

// ── Reporte Diario ────────────────────────────────────────────────────────────
function renderDailySummary(log) {
  const container = document.getElementById('dailySummaryCard');
  if (!container) return;

  if (!log) {
    container.innerHTML =
      '<div class="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm text-center opacity-70">' +
        '<p class="text-3xl mb-2">\u2728</p>' +
        '<p class="text-sm font-bold text-slate-400 uppercase tracking-widest">A\u00FAn no hay reporte del d\u00EDa</p>' +
      '</div>';
    return;
  }

  const moodMap = { feliz: '\uD83D\uDE03', bien: '\uD83D\uDE0A', normal: '\uD83D\uDE10', triste: '\uD83D\uDE22', inquieto: '\uD83D\uDE2B', enojado: '\uD83D\uDE20' };
  const moodIcon = moodMap[(log.mood || '').toLowerCase()] || '\u2728';

  container.innerHTML =
    '<div class="bg-white rounded-2xl p-6 border border-green-100 shadow-sm">' +
      '<h3 class="font-black text-slate-800 text-base mb-4 flex items-center gap-2">' +
        '<span class="bg-green-100 text-green-700 p-1.5 rounded-lg"><i data-lucide="clipboard-list" class="w-4 h-4"></i></span>' +
        'Resumen del D\u00EDa' +
      '</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">' +
        '<div class="bg-slate-50 p-4 rounded-xl flex items-center gap-3">' +
          '<div class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shadow-sm">' + moodIcon + '</div>' +
          '<div><p class="text-[10px] font-black text-slate-400 uppercase">\u00C1nimo</p><p class="font-bold text-slate-700 capitalize">' + (log.mood || 'Bien') + '</p></div>' +
        '</div>' +
        '<div class="bg-slate-50 p-4 rounded-xl flex items-center gap-3">' +
          '<div class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shadow-sm">\uD83C\uDF7D\uFE0F</div>' +
          '<div><p class="text-[10px] font-black text-slate-400 uppercase">Comida</p><p class="font-bold text-slate-700">' + (log.food || 'Sin registro') + '</p></div>' +
        '</div>' +
        '<div class="bg-slate-50 p-4 rounded-xl flex items-center gap-3">' +
          '<div class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shadow-sm">\uD83D\uDE34</div>' +
          '<div><p class="text-[10px] font-black text-slate-400 uppercase">Siesta</p><p class="font-bold text-slate-700">' + (log.nap || log.sleeping || 'No registrada') + '</p></div>' +
        '</div>' +
      '</div>' +
      ((log.notes || log.observations) ?
        '<div class="mt-3 p-3 bg-amber-50 rounded-xl border border-amber-100">' +
          '<p class="text-[10px] font-black text-amber-500 uppercase mb-1">Observaciones</p>' +
          '<p class="text-sm text-slate-600 italic">&ldquo;' + (log.notes || log.observations) + '&rdquo;</p>' +
        '</div>' : '') +
    '</div>';

  if (window.lucide) lucide.createIcons();
}

// ── Navegación ────────────────────────────────────────────────────────────────
export function navigateTo(targetId) {
  if (!targetId) return;

  document.querySelectorAll('.section').forEach(sec => {
    sec.classList.add('hidden');
    sec.classList.remove('active');
  });

  const target = document.getElementById(targetId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
    AppState.set('currentSection', targetId);

    const student = AppState.get('currentStudent');
    switch (targetId) {
      case 'home':            refreshDashboard(); break;      case 'payments':        PaymentsModule.init(student?.id); break;
      case 'tasks':           TasksModule.init(student?.id); break;
      case 'live-attendance': AttendanceModule.init(student?.id); break;
      case 'notifications':   ChatModule.init(); break;
      case 'class':           FeedModule.init(student?.classroom_id); break;
      case 'profile':         ProfileModule.init(); break;
      case 'grades':          GradesModule.init(student?.id); break;
    }
  }

  document.querySelectorAll('[data-target]').forEach(btn => {
    const isActive = btn.dataset.target === targetId;
    btn.classList.toggle('active', isActive);
  });
}

function setupNavigation() {
  Helpers.delegate(document.body, '[data-target]', 'click', (_e, el) => {
    navigateTo(el.dataset.target);
  });
}

function setupGlobalListeners() {
  // Solo actualizar header cuando cambia el estudiante — NO navegar a home (ya se hizo en init)
  AppState.subscribe('currentStudent', (student) => {
    if (student) {
      updateHeaderProfile(AppState.get('profile'), student);
      if (student.classroom_id) initLiveClassListener(student.classroom_id);
    }
  });
}

// ── Badge mensajes no leídos ──────────────────────────────────────────────────
async function loadUnreadBadge() {
  try {
    const user = AppState.get('user');
    if (!user) return;

    let total = 0;
    const { data, error } = await supabase.rpc('get_unread_counts');
    if (!error && data) {
      total = Object.values(data).reduce((a, b) => a + Number(b), 0);
    }
    // Si el RPC falla, mostrar 0 silenciosamente

    const badge = document.getElementById('badge-muro');
    if (!badge) return;

    if (total > 0) {
      badge.textContent = total > 99 ? '99+' : String(total);
      badge.classList.remove('hidden');
      badge.classList.add('flex');
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('flex');
    }
  } catch (_) { /* silencioso */ }
}

// Actualizar badge en tiempo real cuando llega un mensaje nuevo
function initMessageBadgeRealtime() {
  const user = AppState.get('user');
  if (!user || window._padreUnreadChannel) return;
  window._padreUnreadChannel = supabase
    .channel('padre_unread_' + user.id)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages'
    }, () => { loadUnreadBadge(); })
    .subscribe();
}

function updateHeaderProfile(profile, student) {
  const studentName = student?.name || 'Estudiante';

  // Sidebar — nombre del estudiante
  const sidebarName = document.getElementById('sidebar-student-name');
  if (sidebarName) sidebarName.textContent = studentName;

  document.querySelectorAll('.guardian-name-display').forEach(el => el.textContent = studentName);
  document.querySelectorAll('.student-name-display').forEach(el => el.textContent = studentName);
  document.querySelectorAll('.classroom-name-display').forEach(el => {
    el.textContent = student?.classrooms?.name || 'Sin aula';
  });

  const avatarContainer = document.getElementById('headerStudentAvatar');
  if (avatarContainer) {
    if (student?.avatar_url) {
      avatarContainer.innerHTML = '<img src="' + student.avatar_url + '" class="w-full h-full object-cover">';
    } else {
      avatarContainer.innerHTML = '<span class="text-lg font-black text-green-700">' + studentName.charAt(0) + '</span>';
    }
  }

  if (window.lucide) lucide.createIcons();
}

async function checkActiveMeetings() {
  try {
    const meetings = await VideoCallModule.getMyMeetings();
    const active   = (meetings || []).find(m => m.status === 'live');
    AppState.set('isClassLive', !!active);

    const btn = document.querySelector('.node-videocall');
    if (!btn) return;

    if (active) {
      btn.classList.remove('hidden');
      btn.classList.add('ring-2', 'ring-rose-400', 'animate-pulse');
      if (!btn._vcInitialized) {
        btn.addEventListener('click', () => {
          navigateTo('videocall');
          VideoCallModule.joinMeeting(active, 'meet', AppState.get('profile'));
        });
        btn._vcInitialized = true;
      }
    } else {
      btn.classList.add('hidden');
      btn.classList.remove('ring-2', 'ring-rose-400', 'animate-pulse');
    }
  } catch (_) {}
}
