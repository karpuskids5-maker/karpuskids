import { supabase, ensureRole, initOneSignal } from '../shared/supabase.js';
import { SchoolEngine } from '../shared/school-engine.js';
import { Api } from './api.js';
import { Helpers } from './helpers.js';
import { AppState } from './appState.js';
import { NotifyPermission } from '../shared/notify-permission.js';
import { BadgeSystem } from '../shared/badges.js';
import { OnboardingGuide } from '../shared/onboarding.js';
import { Prefetch } from '../shared/prefetch.js';
import { VideoCallUI } from '../shared/videocall-ui.js';
import { computeAge } from '../shared/birthday-utils.js';
import { RealtimeManager } from '../shared/realtime-manager.js';
import { initLiveClassListener } from './attendance_live.js';
import { DynamicBanner } from './dynamic-banner.js';

window.App = {
  feed: { init: (cid) => import('./feed.js').then(m => m.FeedModule.init(cid)) },
  payments: { init: (sid) => import('./payments.js').then(m => m.PaymentsModule.init(sid)) },
  tasks: { init: (sid) => import('./tasks.js').then(m => m.TasksModule.init(sid)) },
  attendance: { init: (sid) => import('./attendance.js').then(m => m.AttendanceModule.init(sid)) },
  chat: { init: () => import('./chat.js').then(m => m.ChatModule.init()) },
  profile: { init: () => import('./profile.js').then(m => m.ProfileModule.init()) },
  grades: { init: (sid) => import('./grades.js').then(m => m.GradesModule.init(sid)) },
  routine: { initRoutinePanel: (sid) => import('./routine.js').then(m => m.RoutineModule.initRoutinePanel(sid)) },
  reinscripcion: { init: (sid) => import('./reinscripcion.js').then(m => m.ReinscripcionModule.init(sid)) },
  navigateTo: navigateTo,
  openDigitalID: openDigitalID,
  switchStudent: switchStudent,
  updateHeaderProfile: updateHeaderProfile,
  sharePadreQR: () => {
    const student = AppState.get('currentStudent');
    const container = document.getElementById('padre-qr-container');
    const canvas = container?.querySelector('canvas');
    if (!canvas) return;
    canvas.toBlob(blob => {
      const file = new File([blob], `qr-${student?.matricula || 'acceso'}.png`, { type: 'image/png' });
      if (navigator.share && navigator.canShare({ files: [file] })) {
        navigator.share({ title: 'Código QR de acceso', files: [file] });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = file.name;
        a.click(); URL.revokeObjectURL(url);
      }
    });
  },
  printPadreQR: () => {
    const student = AppState.get('currentStudent');
    const container = document.getElementById('padre-qr-container');
    const img = container?.querySelector('img');
    if (!img || !student) return;
    const imgData = img.src;
    const classroom = student.classrooms?.name || '';
    const level = student.classrooms?.level || '';
    _openPrintWindow(Helpers.getQRPrintTemplate(imgData, student.name, student.matricula, {
      classroom, level,
      p1Name: student.p1_name || '',
      p2Name: student.p2_name || '',
      p1Phone: student.p1_phone || '',
      p2Phone: student.p2_phone || '',
      isInactive: student.is_active === false
    }));
  },
  openScheduleModal: openScheduleModal,
  closeScheduleModal: closeScheduleModal,
  saveSchedule: saveSchedule,
};
window.BadgeSystem = BadgeSystem;

// Abre una ventana de impresión sin document.write (API obsoleta)
function _openPrintWindow(html) {
  const win = window.open('', '_blank');
  if (!win) return;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  win.document.replaceChild(win.document.adoptNode(parsed.documentElement), win.document.documentElement);
  const images = Array.from(win.document.images);
  if (!images.length) {
    win.print();
    return;
  }
  let remaining = images.length;
  const tryPrint = () => {
    remaining -= 1;
    if (remaining === 0) win.print();
  };
  images.forEach(img => {
    if (img.complete) {
      tryPrint();
    } else {
      img.addEventListener('load', tryPrint, { once: true });
      img.addEventListener('error', tryPrint, { once: true });
    }
  });
}

// Modal global para el panel padre (compatibilidad con directora/asistente)
if (!window.openGlobalModal) {
  window.openGlobalModal = (html) => {
    let gc = document.getElementById('globalModalContainer');
    if (!gc) {
      gc = document.createElement('div');
      gc.id = 'globalModalContainer';
      document.body.appendChild(gc);
    }
    gc.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;align-items:flex-start;justify-content:center;padding-top:4vh;overflow-y:auto;background:rgba(15,23,42,0.6);';
    gc.innerHTML = `<div id="globalModalInner" style="max-width:32rem;width:95%;">${html}</div>`;
    gc.onclick = (e) => { if (e.target === gc) window.closeGlobalModal?.(); };
    if (window.lucide) requestAnimationFrame(() => lucide.createIcons());
  };
  window.closeGlobalModal = () => {
    const gc = document.getElementById('globalModalContainer');
    if (gc) { gc.style.display = 'none'; gc.innerHTML = ''; }
  };
  window.App.ui = window.App.ui || {};
  window.App.ui.closeModal = window.closeGlobalModal;
}

// Global error handler
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message?.toLowerCase() ?? '';
  if (msg.includes('indexeddb') || msg.includes('network') || msg.includes('fetch')) return;

});

async function _initPush(user) {
  try {
    initOneSignal(user);
  } catch (e) {
    console.warn('OneSignal no inicializado:', e);
  }
}

function _pickDeepLinkStudent(students, deepBoletin) {
  if (!deepBoletin) return null;
  return students.find(s => String(s.id) === String(deepBoletin));
}

function _applyDeepLink(deepBoletin, deepPeriodo) {
  if (!deepBoletin || !deepPeriodo) return;
  navigateTo('grades');
  setTimeout(() => {
    const filter = document.getElementById('padrePeriodFilter');
    if (filter && [...filter.options].some(o => o.value === String(deepPeriodo))) {
      filter.value = String(deepPeriodo);
      filter.dispatchEvent(new Event('change'));
    }
  }, 800);
}

function _preloadQRCode() {
  setTimeout(() => {
    if (!window.QRCode) {
      const s = document.createElement('script');
      s.src = 'js/shared/qrcode.min.js';
      document.head.appendChild(s);
    }
  }, 2000);
}

function _showEmptyStudents() {
  const el = document.getElementById('dashboardGrid');
  if (el) el.innerHTML = Helpers.emptyState('No hay estudiantes vinculados a esta cuenta.');
}

function _showSkeletons() {
  const grid = document.getElementById('dashboardGrid');
  const summary = document.getElementById('dailySummaryCard');
  if (grid) grid.innerHTML = Helpers.skeleton(5, 'h-28');
  if (summary) summary.innerHTML = Helpers.skeleton(1, 'h-40');
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    AppState.set('loading', true);

    const auth = await ensureRole('padre');
    if (!auth) return;

    AppState.set('user', auth.user);
    AppState.set('profile', auth.profile);

    // 🔔 Banner global de mensajes entrantes (visible en todo el panel)
    import('./chat.js').then(({ ChatModule }) => {
      import('/js/shared/incoming-banner.js').then(({ IncomingBanner }) => {
        IncomingBanner.init({
          uid: auth.user.id,
          isActiveChat: (msg) => ChatModule.isActiveChatOpen?.(msg),
          onOpen: (senderId) => {
            App.navigateTo('notifications');
            setTimeout(() => { ChatModule.openChatWithUser?.(senderId); }, 400);
          }
        });
      }).catch(() => {});
    }).catch(() => {});

    // Inicializar School Engine
    await SchoolEngine.init({ forceRefresh: true });
    AppState.set('schoolYear', SchoolEngine.getSchoolYear());
    AppState.set('activePeriod', SchoolEngine.getActivePeriod());
    AppState.set('periods', SchoolEngine.getAllPeriods());

    // 🔁 Botón de Reinscripción: solo visible durante el período de reinscripción
    const reenrollBtn = document.querySelector('.node-reenrollment');
    if (reenrollBtn) reenrollBtn.classList.toggle('hidden', !SchoolEngine.isReenrollmentOpen());

    // ⚡ PREFETCH: Iniciar carga silenciosa de recursos críticos
    Prefetch.start({
      userId: auth.user.id,
      role: 'padre',
      classroomId: auth.profile?.classroom_id,
      studentId: null // Se actualizará al obtener estudiantes
    });

    // ✅ FIX OneSignal: Solo inicializar en el dominio correcto para evitar errores de consola
    const host = window.location.hostname;
    const isProd = host === 'karpuskids.com' || host === 'www.karpuskids.com' || host.endsWith('.karpuskids.com') || host === 'localhost';
    
    if (isProd) { await _initPush(auth.user); }

    const { data: students, error } = await supabase
      .from('students')
      .select('*, classrooms(id, name, level, teacher_id)')
      .eq('parent_id', auth.user.id)
      .order('name');

    if (error) throw error;
    if (!students?.length) {
      _showEmptyStudents();
      return;
    }

    const currentStudent = students[0];
    AppState.set('students', students);

    // 🔗 Deep link del boletín (código QR): ?boletin=<id>&periodo=<id>
    const urlParams = new URLSearchParams(window.location.search);
    const deepBoletin = urlParams.get('boletin');
    const deepPeriodo = urlParams.get('periodo');
    const selectedStudent = _pickDeepLinkStudent(students, deepBoletin) || currentStudent;
    AppState.set('currentStudent', selectedStudent);

    // Actualizar sidebar y header ANTES de cargar datos
    updateHeaderProfile(auth.profile, selectedStudent, students);
    setupNavigation();
    setupGlobalListeners();

    // Activar sección home inmediatamente
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    const homeSection = document.getElementById('home');
    if (homeSection) {
      homeSection.classList.remove('hidden');
      homeSection.classList.add('active');
    }

    // 🔗 Si viene de un QR del boletín, ir directo a calificaciones y pre-seleccionar el período
    _applyDeepLink(deepBoletin, deepPeriodo);

    // Mostrar skeletons inmediatamente
    _showSkeletons();

    // Carga paralela — no bloquea UI
    refreshDashboard().then(() => BadgeSystem.init(auth.user.id));

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

    // 🔄 Badge de reinscripción (pendientes) del primer hijo
    import('./reinscripcion.js').then(m => m.ReinscripcionModule.checkBadge(currentStudent.id));

    // 🔴 Sistema de badges — se inicia en el .then() de refreshDashboard arriba

    // Precargar librería QR en background para que esté lista cuando el padre la necesite
    _preloadQRCode();

    // 🎓 Guía de bienvenida para nuevos padres
    const parentName = auth.profile?.name?.split(' ')[0] || 'Bienvenido';
    
    OnboardingGuide.init({
      userName:   parentName,
      storageKey: 'padre_v2',
      userId:     auth.user.id,
      navigateTo: navigateTo,
      delay:      2000,
      steps: [
        {
          target:  '[data-target="home"]',
          icon:    '🏠',
          title:   'Inicio',
          text:    'Aquí ves el resumen del día: asistencia, tareas pendientes, pagos y más. Todo de un vistazo.'
        },
        {
          target:  '[data-target="class"]',
          icon:    '📢',
          title:   'Muro del Aula',
          text:    'La maestra publica fotos, videos y comunicados aquí. ¡Mantente al día con lo que pasa en el aula!'
        },
        {
          target:  '[data-target="tasks"]',
          icon:    '📚',
          title:   'Tareas',
          text:    'Revisa las tareas asignadas, fechas de entrega y calificaciones de tu hijo/a.'
        },
        {
          target:  '#dashboardGrid',
          icon:    '💳',
          title:   'Pagos',
          text:    'Envía tu comprobante de transferencia directamente desde aquí. Selecciona el mes y adjunta la foto.'
        },
        {
          target:  '[data-target="profile"]',
          icon:    '👤',
          title:   'Mi Perfil',
          text:    'Activa las notificaciones push para recibir alertas en tiempo real sobre tu hijo/a.'
        }
      ]
    });

    // 🔔 Pedir permiso de notificaciones al cargar (con delay para no interrumpir)
    setTimeout(() => NotifyPermission.requestIfNeeded('notifPermissionSlot'), 3000);

    // Realtime: actualizar rutina diaria cuando la maestra la guarda
    _initDailyLogRealtime(currentStudent.id);

  } catch (err) {

    Helpers.toast('Error al iniciar el panel', 'error');
  } finally {
    AppState.set('loading', false);
  }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function refreshDashboard() {
  const student = AppState.get('currentStudent');
  if (!student) return;

  // Use local date (not UTC) to match what the maestra saves
  const now   = new Date();
  const today = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');

  // Carga paralela — allSettled para que un fallo no bloquee el resto
  const [financeRes, academicRes, logsRes, todayAttRes, scheduleRes] = await Promise.allSettled([
    Api.getStudentFinancialStatus(student.id),
    Api.getStudentGrades(student.id),
    Api.getDailyLog(student.id, today),
    supabase.from('attendance').select('status').eq('student_id', student.id).eq('date', today).maybeSingle(),
    Api.getClassroomSchedule(student.classroom_id).catch(() => [])
  ]);

  const finance   = financeRes.status  === 'fulfilled' ? financeRes.value  : null;
  const academic  = academicRes.status === 'fulfilled' ? academicRes.value : null;
  let   logs      = logsRes.status     === 'fulfilled' ? logsRes.value     : null;
  const todayAtt  = todayAttRes.status === 'fulfilled' ? todayAttRes.value?.data : null;
  const rawSchedule = scheduleRes.status === 'fulfilled' ? (scheduleRes.value || []) : [];
  // Normalizar formato del horario
  const schedule = rawSchedule.map(s => ({
    type: s.event_type,
    label: s.event_label,
    icon: s.event_icon,
    hour: s.scheduled_hour,
    minute: s.scheduled_minute,
    duration: s.duration_minutes,
  }));

  // Registrar errores si fallaron promesas críticas
  [financeRes, academicRes, logsRes, todayAttRes, scheduleRes].forEach((res, i) => {
    if (res.status === 'rejected') {
      import('../shared/db-utils.js').then(({ safeHandle }) => {
        safeHandle(res.reason, `refreshDashboard.Promise[${i}]`);
      });
    }
  });

  if (finance?.config) AppState.set('financeConfig', finance.config);
  if (finance?.history) AppState.set('financeHistory', finance.history);
  AppState.set('todayAttendance', todayAtt?.status || null);

  renderHomeCards(student, { finance, academic, todayAtt: todayAtt?.status });
  renderDailySummary(logs, schedule);

  // checkActiveMeetings en background — no bloquea las tarjetas
  checkActiveMeetings().catch(err => console.warn('checkActiveMeetings falló:', err));

  // Banner dinámico unico — reemplaza todos los banners anteriores
  AppState.set('finance', finance);
  DynamicBanner.init();
}

// ── Modal de horario ─────────────────────────────────────────────────────────
function openScheduleModal() {
  const modal = document.getElementById('scheduleModal');
  const entryInput = document.getElementById('modalEntryTime');
  const exitInput = document.getElementById('modalExitTime');
  if (!modal) return;
  const student = AppState.get('currentStudent');
  if (entryInput) entryInput.value = student?.entry_time || '';
  if (exitInput) exitInput.value = student?.exit_time || '';
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeScheduleModal() {
  const modal = document.getElementById('scheduleModal');
  if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

async function saveSchedule() {
  const entryInput = document.getElementById('modalEntryTime');
  const exitInput = document.getElementById('modalExitTime');
  const saveBtn = document.getElementById('scheduleModalSaveBtn');
  if (!entryInput || !exitInput) return;

  const entry = entryInput.value;
  const exit = exitInput.value;
  if (!entry && !exit) {
    Helpers.toast('Ingresa al menos una hora', 'error');
    return;
  }

  const student = AppState.get('currentStudent');
  if (!student?.id) return;

  try {
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }
    const { error } = await supabase
      .from('students')
      .update({ entry_time: entry || null, exit_time: exit || null })
      .eq('id', student.id);
    if (error) throw error;

    student.entry_time = entry || null;
    student.exit_time = exit || null;
    AppState.set('currentStudent', student);

    const profileInput = document.getElementById('inputEntryTime');
    const exitProfileInput = document.getElementById('inputExitTime');
    if (profileInput) profileInput.value = entry || '';
    if (exitProfileInput) exitProfileInput.value = exit || '';

    closeScheduleModal();
    Helpers.toast('Horario guardado', 'success');
    document.getElementById('scheduleReminderBanner')?.classList.add('hidden');
  } catch (e) {
    Helpers.toast('Error al guardar: ' + e.message, 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; }
  }
}

// ── Tarjetas del Dashboard ────────────────────────────────────────────────────
function renderHomeCards(student, data) {
  const grid = document.getElementById('dashboardGrid');
  if (!grid) return;

  const { finance, academic, todayAtt } = data || {};
  const debtTotal = finance?.debt?.total || 0;
  const pendingItems = finance?.debt?.items || [];
  const inReview = pendingItems.some(p => p.evidence_url || p.proof_url);
  const isLive = AppState.get('isClassLive');

  // Estado del card de Pagos según deuda/revisión
  let paySub = 'Al día';
  let payColor = 'border-emerald-200';
  let payIconBg = 'bg-emerald-100 text-emerald-700';
  if (debtTotal > 0) {
    paySub = 'Pendiente';
    payColor = 'border-amber-200';
    payIconBg = 'bg-amber-100 text-amber-700';
  } else if (inReview) {
    paySub = 'En Revisión';
    payColor = 'border-blue-200';
    payIconBg = 'bg-blue-100 text-blue-700';
  }

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
      sub: paySub,
      icon: ICONS.card,
      color: payColor,
      iconBg: payIconBg,
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

  grid.innerHTML = cards.map(card =>
    '<div class="bg-white rounded-2xl p-4 border-2 ' + card.color + ' shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer group relative" data-target="' + card.target + '">' +
      '<span id="badge-card-' + card.target + '" class="hidden absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center shadow px-1 z-10">0</span>' +
      '<div class="flex justify-between items-start mb-3">' +
        '<div class="w-11 h-11 rounded-xl ' + card.iconBg + ' flex items-center justify-center text-xl shadow-sm group-hover:scale-110 transition-transform">' + card.icon + '</div>' +
        '<i data-lucide="chevron-right" class="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors mt-1"></i>' +
      '</div>' +
      '<p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">' + card.title + '</p>' +
      '<h4 class="text-sm font-black text-slate-800 leading-tight">' + card.value + '</h4>' +
      '<p class="text-[10px] font-bold text-slate-500 mt-0.5">' + card.sub + '</p>' +
    '</div>'
  ).join('');

  if (window.lucide) lucide.createIcons();
}

// ── Reporte Diario ────────────────────────────────────────────────────────────
const _V8_ICONS = {
  bienvenida: '👋', desayuno: '🍞', actividad: '📚', bano: '🚽',
  patio: '🌳', almuerzo: '🥗', siesta: '😴', merienda: '🍎', biberon: '🍼',
  panal_humedo:'💧', panal_sucio:'💩', cepillado:'🪥', lavado_manos:'🧼',
  agua:'💧', fruta:'🍌', picada:'🥪', descanso_corto:'😪', crema:'🧴',
  manualidad:'🎨', musica:'🎵', baile:'💃', gimnasia:'🤸', juego_libre:'🧸',
  juegos_mesa:'🎲', construccion:'🧱', convivencia:'🤝', compartir:'💬',
  emociones:'💛', proyecto:'🎯', lectura:'📖', escritura:'✏️', matematicas:'🔢',
  ciencias:'🔬', idiomas:'🗣️', paseo:'🚶', huerta:'🌱', juegos_agua:'💦',
  malestar:'🤢', curacion:'🩹', pelea:'🤜', otro_incidente:'⚠️',
  cumpleanos:'🎂', evento_especial:'🎉',
  temperatura:'🌡️', medicamento:'💊', animo:'😊', nota:'📝',
  fiebre:'🤒', accidente:'🩹', golpe:'🤕', llamada_padres:'📞',
  medicamento_extra:'💊', otro:'📋'
};

const _DEFAULT_SCHEDULE = [
  { type: 'bienvenida', label: 'Bienvenida', hour: 7,  minute: 30, duration: 30, icon: '👋' },
  { type: 'desayuno',   label: 'Desayuno',   hour: 8,  minute: 0,  duration: 60, icon: '🍞' },
  { type: 'actividad',  label: 'Actividad',  hour: 9,  minute: 0,  duration: 30, icon: '📚' },
  { type: 'bano',       label: 'Baño',       hour: 9,  minute: 30, duration: 30, icon: '🚽' },
  { type: 'patio',      label: 'Patio',      hour: 10, minute: 0,  duration: 90, icon: '🌳' },
  { type: 'almuerzo',   label: 'Almuerzo',   hour: 11, minute: 30, duration: 60, icon: '🥗' },
  { type: 'siesta',     label: 'Siesta',     hour: 12, minute: 30, duration: 90, icon: '😴' },
  { type: 'merienda',   label: 'Merienda',   hour: 14, minute: 0,  duration: 60, icon: '🍎' },
  { type: 'biberon',    label: 'Biberón',    hour: 15, minute: 0,  duration: 30, icon: '🍼' },
];

const _FOOD_LABEL = { todo:'Comió todo 🌟', all:'Comió todo 🌟', poco:'Comió poco 🍲', little:'Comió poco 🍲', half:'La mitad 🥣', nada:'No comió 🙅', none:'No comió 🙅' };
const _MOOD_LABEL = { feliz:'Contento/a', bien:'Bien', normal:'Normal', triste:'Triste', inquieto:'Inquieto/a', enojado:'Molesto/a' };

function renderDailySummary(log, schedule = []) {
  const container = document.getElementById('dailySummaryCard');
  if (!container) return;

  if (!log) {
    container.innerHTML =
      '<div class="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm text-center opacity-70">' +
        '<p class="text-3xl mb-2">✨</p>' +
        '<p class="text-sm font-bold text-slate-400 uppercase tracking-widest">Aún no hay reporte del día</p>' +
      '</div>';
    return;
  }

  const student = AppState.get('currentStudent');
  const events = log.events || log.infant_data || [];
  const isInfant = student?.age_type === 'meses';
  const sched = schedule?.length ? schedule : _DEFAULT_SCHEDULE;
  const loggedByType = _groupEventsByType(events);
  const rows = _buildDayRows(events, sched, loggedByType);

  if (isInfant) {
    _renderInfantSummary(container, log);
  } else {
    _renderStandardSummary(container, rows);
  }

  if (window.lucide) lucide.createIcons();
}

function _groupEventsByType(events) {
  const byType = {};
  events.forEach(ev => {
    if (!byType[ev.type]) byType[ev.type] = [];
    byType[ev.type].push(ev);
  });
  return byType;
}

function _formatEventTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function _formatTime12h(s) {
  let hh = s.hour;
  if (hh > 12) hh -= 12;
  else if (hh === 0) hh = 12;
  const ampm = s.hour >= 12 ? 'PM' : 'AM';
  return `${hh}:${String(s.minute).padStart(2, '0')} ${ampm}`;
}

function _buildDayRows(events, sched, loggedByType) {
  const rows = [];
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  sched.forEach(s => {
    const row = _buildScheduleRow(s, loggedByType, nowMins);
    if (row) rows.push(row);
  });

  const schedTypes = new Set(sched.map(s => s.type));
  events.forEach(ev => {
    if (schedTypes.has(ev.type)) return;
    const icon = _V8_ICONS[ev.type] || '📋';
    const label = ev.type.charAt(0).toUpperCase() + ev.type.slice(1).replace('_', ' ');
    rows.push({ icon, label, sub: _formatEventTime(ev.created_at), time: '', color: 'bg-amber-50 border-amber-200' });
  });

  return rows;
}

function _buildScheduleRow(s, loggedByType, nowMins) {
  const sMins = s.hour * 60 + s.minute;
  const timeStr = _formatTime12h(s);
  const evType = s.type;
  const matchingEvents = loggedByType[evType] || [];
  const hasSchedMark = matchingEvents.some(e => e.scheduled_time);
  const matchingSched = hasSchedMark ? matchingEvents.filter(e => (e.scheduled_time || '') === timeStr) : matchingEvents;
  const milkEvents = (loggedByType['biberon'] || []).concat(loggedByType['milk'] || []).concat(loggedByType['structured_entry'] || []);
  const isBiberon = evType === 'biberon';
  let hasLogged = false;
  if (isBiberon) {
    hasLogged = milkEvents.length > 0;
  } else if (hasSchedMark) {
    hasLogged = matchingSched.length > 0;
  } else {
    hasLogged = matchingEvents.length > 0;
  }

  if (!hasLogged || nowMins < sMins) return null;

  const icon = s.icon || _V8_ICONS[s.type] || '⏰';
  const detail = _scheduleDetail(s, matchingSched, loggedByType, isBiberon, milkEvents);

  return { icon, label: detail, sub: timeStr, time: '', color: 'bg-green-50 border-green-200' };
}

function _siestaDetail(label, loggedByType) {
  const events = loggedByType['siesta'] || [];
  if (events.some(e => e.open)) return `${label} — En curso`;
  const totalMins = events.reduce((sum, e) => sum + (e.duration_min || 0), 0);
  if (totalMins > 0) return `${label} — ${totalMins}min`;
  return label;
}

function _firstEventDetail(label, first) {
  if (first.food) return `${label} — ${_FOOD_LABEL[first.food] || first.food}`;
  if (first.mood) return `${label} — ${_MOOD_LABEL[first.mood] || first.mood}`;
  if (first.comment) return `${label} — ${first.comment}`;
  return label;
}

function _scheduleDetail(s, matchingSched, loggedByType, isBiberon, milkEvents) {
  if (isBiberon) {
    const totalOz = milkEvents.reduce((sum, e) => sum + Number.parseFloat(e.oz || e.milk || e.value || 0), 0);
    if (totalOz > 0) return `${s.label} — ${totalOz} oz`;
    return s.label;
  }
  if (s.type === 'siesta') return _siestaDetail(s.label, loggedByType);
  if (matchingSched[0]) return _firstEventDetail(s.label, matchingSched[0]);
  return s.label;
}

function _infantIcon(type) {
  if (type === 'milk') return '🍼';
  if (type === 'health') return '🤢';
  if (type === 'sleep') return '💤';
  return '💩';
}

function _infantEventText(e) {
  if (e.type === 'milk') return `Tomó ${e.value} de leche`;
  if (e.type === 'health') return `Reportó ${e.value}`;
  if (e.type === 'sleep') return 'Inició siesta';
  return `Cambio de pañal: ${e.value}`;
}

function _renderInfantSummary(container, log) {
  const infantData = log.infant_data || [];
  const hasVomit = infantData.some(e => e.type === 'health' && e.value === 'vomito');

  container.innerHTML = `
    <div class="bg-white rounded-2xl p-6 border ${hasVomit ? 'border-rose-200 bg-rose-50/30' : 'border-blue-100'} shadow-sm">
      <h3 class="font-black text-slate-800 text-base mb-4 flex items-center gap-2">
        <span class="bg-blue-100 text-blue-700 p-1.5 rounded-lg"><i data-lucide="baby" class="w-4 h-4"></i></span>
        Cuidado del Bebé - Hoy
      </h3>

      ${hasVomit ? `
        <div class="mb-4 p-4 bg-rose-100 border-2 border-rose-200 rounded-2xl flex items-center gap-3 animate-pulse">
          <span class="text-2xl">⚠️</span>
          <div>
            <p class="text-xs font-black text-rose-800 uppercase">Alerta de Salud</p>
            <p class="text-sm font-bold text-rose-700">Se ha registrado un evento de vómito. Favor estar atentos.</p>
          </div>
        </div>
      ` : ''}

      <div class="relative space-y-4 before:content-[''] before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-0.5 before:bg-blue-100">
        ${infantData.length ? infantData.map(e => `
          <div class="relative pl-10">
            <div class="absolute left-0 top-1 w-8 h-8 rounded-full bg-white border-2 ${e.type === 'health' ? 'border-rose-400' : 'border-blue-400'} flex items-center justify-center text-sm shadow-sm z-10">
              ${_infantIcon(e.type)}
            </div>
            <p class="text-[10px] font-black text-slate-400 uppercase">${_formatEventTime(e.created_at)}</p>
            <p class="text-sm font-bold text-slate-700">
              ${_infantEventText(e)}
            </p>
          </div>
        `).join('') : '<p class="text-xs text-slate-400 italic pl-10">Iniciando el seguimiento del día...</p>'}
      </div>
    </div>
  `;
}

function _renderStandardSummary(container, rows) {
  const rowsHTML = rows.map(r => `
    <div class="flex items-center gap-3 p-3 ${r.color} border rounded-2xl">
      <span class="text-2xl shrink-0">${r.icon}</span>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-black text-slate-700 leading-snug truncate">${r.label}</p>
        <p class="text-[10px] font-bold text-slate-400">${r.sub}</p>
      </div>
      ${r.time ? `<span class="text-[10px] font-black text-slate-400 shrink-0">${r.time}</span>` : ''}
    </div>`).join('');

  container.innerHTML = `
    <div class="bg-white rounded-2xl border border-green-100 shadow-sm overflow-hidden">
      <div class="flex items-center justify-between px-5 pt-5 pb-3">
        <h3 class="font-black text-slate-800 text-sm flex items-center gap-2">
          <span class="bg-green-100 text-green-700 p-1.5 rounded-lg"><i data-lucide="clipboard-list" class="w-4 h-4"></i></span>
          Resumen del Día
        </h3>
        <button onclick="App.navigateTo('routine')" class="text-[10px] font-black text-[#28B54D] uppercase tracking-widest hover:underline whitespace-nowrap">Ver completo →</button>
      </div>
      ${rows.length ? `<div class="px-4 pb-5 space-y-2">${rowsHTML}</div>` : `<div class="px-5 pb-5 text-center text-sm text-slate-400 font-bold">La maestra aún no ha registrado eventos detallados hoy.</div>`}
    </div>`;
}

// ── Navegación ────────────────────────────────────────────────────────────────
const _SECTION_THEMES = {
  home: '#0ea5e9', tasks: '#F59E0B', class: '#3B82F6',
  payments: '#059669', 'live-attendance': '#10B981', reenrollment: '#F59E0B'
};

export async function navigateTo(targetId) {
  if (!targetId) return;
  Helpers.vibrate?.('light');

  // LIMPIEZA DE REALTIME: Eliminar canales al cambiar de sección
  if (RealtimeManager?.unsubscribeAll) RealtimeManager.unsubscribeAll(['notifications', 'live_status']);

  document.querySelectorAll('.section').forEach(sec => {
    sec.classList.add('hidden');
    sec.classList.remove('active');
  });

  const target = document.getElementById(targetId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
    _applySectionTheme(targetId);
    AppState.set('currentSection', targetId);
    _markBadgeRead(targetId);
    _runSection(targetId);
  }

  document.querySelectorAll('[data-target]').forEach(btn => {
    const isActive = btn.dataset.target === targetId;
    btn.classList.toggle('active', isActive);
  });

  _closeMobileSidebar();
}

function _applySectionTheme(targetId) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', _SECTION_THEMES[targetId] || '#0ea5e9');
}

function _markBadgeRead(targetId) {
  BadgeSystem.mark(targetId);
  const cardBadge = document.getElementById('badge-card-' + targetId);
  if (cardBadge) {
    cardBadge.classList.add('hidden');
    cardBadge.classList.remove('flex');
  }
}

function _closeMobileSidebar() {
  if (window.innerWidth >= 768) return;
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar?.classList.contains('mobile-visible')) {
    sidebar.classList.remove('mobile-visible');
    overlay?.classList.add('hidden');
  }
}

function _runSection(targetId) {
  const student = AppState.get('currentStudent');
  switch (targetId) {
    case 'home':
      refreshDashboard().then(() => {
        if (window.BadgeSystem) BadgeSystem._reapplyCardBadges();
      });
      break;
    case 'payments':        _initPaymentsSection(student); break;
    case 'tasks':           import('./tasks.js').then(m => m.TasksModule.init(student?.id)); break;
    case 'live-attendance': import('./attendance.js').then(m => m.AttendanceModule.init(student?.id)); break;
    case 'notifications':   import('./chat.js').then(m => m.ChatModule.init()); break;
    case 'class':           import('./feed.js').then(m => m.FeedModule.init(student?.classroom_id)); break;
    case 'profile':         _initProfileSection(student); break;
    case 'grades':          import('./grades.js').then(m => m.GradesModule.init(student?.id)); break;
    case 'reenrollment':    import('./reinscripcion.js').then(m => m.ReinscripcionModule.init(student?.id)); break;
    case 'routine':         _initRoutineSection(student); break;
    case 'qr-access':       _initPadreQR(student); break;
    case 'videocall':       _initVideocallSection(); break;
  }
}

function _initPaymentsSection(student) {
  const fin = AppState.get('financeConfig') || {};
  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const paidTotal = (AppState.get('financeHistory') || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  setEl('paymentsBalance', Helpers.formatCurrency(paidTotal));
  setEl('paymentsMonthlyFee', Helpers.formatCurrency(fin.monthly_fee || 0));
  setEl('paymentsDueDay', fin.due_day || '-');
  import('./payments.js').then(m => m.PaymentsModule.init(student?.id));
}

function _initProfileSection(student) {
  import('./profile.js').then(m => {
    m.ProfileModule.init();
    _initPadreQR(student);
    NotifyPermission.requestIfNeeded();
  });
}

function _initRoutineSection(student) {
  import('./routine.js').then(m => {
    window.RoutineModule = m.RoutineModule;
    m.RoutineModule.initRoutinePanel(student?.id);
  });
}

function _initVideocallSection() {
  const student = AppState.get('currentStudent');
  const profile = AppState.get('profile');
  VideoCallUI.renderSection('videocall-section', {
    role: 'padre',
    // Mostrar nombre del estudiante en la videollamada, no del padre
    userName: student?.name || profile?.name || 'Padre',
    studentName: student?.name || '',
    classroomId: student?.classroom_id || null
  });
}

function setupNavigation() {
  Helpers.delegate(document.body, '[data-target]', 'click', (_e, el) => {
    navigateTo(el.dataset.target);
  });
}

function setupGlobalListeners() {
  // Solo actualizar header cuando cambia el estudiante
  AppState.subscribe('currentStudent', (student) => {
    if (student) {
      updateHeaderProfile(AppState.get('profile'), student);
      if (student.classroom_id) initLiveClassListener(student.classroom_id);
    }
  });

  // Actualizar tarjeta de asistencia en tiempo real cuando el BadgeSystem detecta un ponche
  window.addEventListener('karpus:attendance-update', (e) => {
    const student = AppState.get('currentStudent');
    if (!student) return;
    const payload = e.detail;
    // Solo actualizar si es el estudiante actual
    if (String(payload?.student_id) !== String(student.id)) return;
    const status = payload?.status || 'present';
    AppState.set('todayAttendance', status);
    // Re-renderizar solo la tarjeta de asistencia sin recargar la página
    const attCard = document.querySelector('[data-target="live-attendance"]');
    if (attCard) {
      const attLabels = { present: 'Presente', presente: 'Presente', absent: 'Ausente', late: 'Tarde' };
      const label = attLabels[status?.toLowerCase()] || 'Registrado';
      const valEl = attCard.querySelector('h4');
      const subEl = attCard.querySelector('p:last-child');
      if (valEl) valEl.textContent = label;
      if (subEl) subEl.textContent = 'Actualizado ahora';
      attCard.className = attCard.className.replace(/border-\w+-\d+/g, 'border-emerald-300');
    }
  });
}

// ── Badge mensajes no leídos ──────────────────────────────────────────────────
async function loadUnreadBadge() {
  try {
    const user = AppState.get('user');
    if (!user) return;

    let total = 0;
    // Mensajes no leídos
    const { data } = await supabase.rpc('get_unread_counts');
    if (data) {
      total = Object.values(data).reduce((a, b) => a + Number(b), 0);
    }
    // Notificaciones no leídas
    const { count: notifCount } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false);
    total += (notifCount || 0);

    const badge = document.getElementById('badge-card-notifications');
    if (!badge) return;
    if (total > 0) {
      badge.textContent = total > 99 ? '99+' : String(total);
      badge.classList.remove('hidden');
      badge.classList.add('flex');
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('flex');
    }
  } catch (_) { console.warn('No se pudo actualizar el badge de mensajes'); }
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
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${user.id}`
    }, () => { loadUnreadBadge(); })
    .subscribe();
}

/**
 * ✨ Abrir Carnet Digital con Brillo Máximo
 */
async function openDigitalID() {
  const student = AppState.get('currentStudent');
  if (!student) return;

  Helpers.vibrate('medium');

  const html = `
    <div class="bg-white rounded-[2.5rem] overflow-hidden shadow-2xl animate-scaleIn">
      <div class="bg-indigo-600 p-6 text-white text-center">
        <h3 class="text-xl font-black">Carnet Digital</h3>
        <p class="text-xs font-bold text-white/70 uppercase tracking-widest mt-1">Escaneo de Acceso</p>
      </div>
      <div class="p-8 flex flex-col items-center gap-6">
        <div class="w-24 h-24 rounded-2xl border-4 border-indigo-50 overflow-hidden shadow-lg">
          ${student.avatar_url
            ? `<img src="${student.avatar_url}" class="w-full h-full object-cover">`
            : `<div class="w-full h-full flex items-center justify-center text-5xl font-black text-indigo-600 bg-indigo-50">${Helpers.escapeHTML((student.name || '?').charAt(0).toUpperCase())}</div>`}
        </div>
        <div class="text-center">
          <h4 class="text-lg font-black text-slate-800">${Helpers.escapeHTML(student.name)}</h4>
          <p class="text-xs font-bold text-slate-400 uppercase tracking-widest">${student.classrooms?.name || 'Sin aula'}</p>
        </div>
        <div id="digitalIDQR" class="p-4 bg-slate-50 rounded-3xl border-2 border-slate-100"></div>
        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Muestra este código en la puerta para marcar asistencia rápida</p>
      </div>
    </div>
  `;

  if (window.openGlobalModal) window.openGlobalModal(html);

  // Generar QR
  setTimeout(() => {
    const qrContainer = document.getElementById('digitalIDQR');
    if (qrContainer && window.QRCode) {
      new QRCode(qrContainer, {
        text: student.matricula || student.id,
        width: 180,
        height: 180,
        colorDark: "#1e1b4b",
        colorLight: "#f8fafc"
      });
    }
  }, 100);

  // ✨ Modo Brillo Máximo (Opcional - solo si el navegador lo soporta)
  if ('wakeLock' in navigator) {
    try {
      await navigator.wakeLock.request('screen');
    } catch (err) {
      console.warn('wakeLock no disponible:', err);
    }
  }
}

function updateHeaderProfile(profile, student, allStudents = []) {
  const studentName = student?.name || 'Estudiante';

  const sidebarName = document.getElementById('sidebar-student-name');
  if (sidebarName) sidebarName.textContent = studentName;

  _wireStudentSwitcher(student, allStudents);
  _renderSiblingChips(allStudents, student);
  _renderSidebarAvatar(student, studentName);
  _renderHeaderAvatars(student, studentName);
  _renderNameDisplays(student, studentName);
  _renderProfileSiblings(allStudents, student);

  if (window.lucide) lucide.createIcons();
}

function _wireStudentSwitcher(student, allStudents) {
  if (allStudents.length <= 1) return;

  const switcherTrigger = document.getElementById('student-switcher-trigger');
  if (switcherTrigger) {
    const label = switcherTrigger.querySelector('p');
    if (label && !label.innerHTML.includes('chevron')) {
      label.innerHTML += ' <i data-lucide="chevron-down" class="inline w-3 h-3 ml-1"></i>';
    }
    switcherTrigger.onclick = () => _showStudentSwitcher(allStudents);
  }

  const mobileAvatar = document.getElementById('headerAvatarMobile');
  if (mobileAvatar) {
    mobileAvatar.style.cursor = 'pointer';
    mobileAvatar.onclick = () => _showStudentSwitcher(allStudents);
  }
}

function _escapeAttr(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text || '').replace(/[&<>"']/g, c => map[c]);
}

function _renderSiblingChips(allStudents, currentStudent) {
  const desktopEl = document.getElementById('siblings-chips-desktop');
  const mobileEl = document.getElementById('siblings-chips-mobile');
  if (!desktopEl && !mobileEl) return;

  if (allStudents.length <= 1) {
    if (desktopEl) desktopEl.innerHTML = '';
    if (mobileEl) mobileEl.innerHTML = '';
    return;
  }

  const chips = allStudents.map(s => {
    const isActive = String(s.id) === String(currentStudent?.id);
    const firstName = (s.name || 'Estudiante').split(' ')[0];
    const esc = _escapeAttr(firstName);
    const avatarBgClass = isActive ? 'bg-white text-emerald-600' : 'bg-slate-500 text-white';
    const avatarHtml = s.avatar_url
      ? '<img src="' + s.avatar_url + '" class="w-6 h-6 rounded-full object-cover mr-1.5 shrink-0" alt="">'
      : '<span class="w-6 h-6 rounded-full ' + avatarBgClass + ' flex items-center justify-center text-[10px] font-black mr-1.5 shrink-0">' + firstName.charAt(0) + '</span>';
    const btnClass = isActive
      ? 'flex items-center px-3 py-1.5 rounded-full text-[11px] font-black transition-all active:scale-95 bg-emerald-500 text-white shadow-md'
      : 'flex items-center px-3 py-1.5 rounded-full text-[11px] font-black transition-all active:scale-95 bg-slate-700 text-white hover:bg-slate-600';
    return '<button type="button" onclick="App.switchStudent(\'' + s.id + '\')" class="' + btnClass + '">' + avatarHtml + esc + '</button>';
  }).join('');
  const chipsHTML = '<div class="flex flex-wrap gap-2">' + chips + '</div>';
  if (desktopEl) desktopEl.innerHTML = chipsHTML;
  if (mobileEl) mobileEl.innerHTML = chipsHTML;
}

function _renderSidebarAvatar(student, studentName) {
  const sidebarAvatar = document.getElementById('sidebarStudentAvatar');
  if (!sidebarAvatar) return;
  sidebarAvatar.innerHTML = student?.avatar_url
    ? '<img src="' + student.avatar_url + '" class="w-full h-full object-cover">'
    : '<span class="text-sm font-black text-emerald-700">' + studentName.charAt(0) + '</span>';
}

function _renderHeaderAvatars(student, studentName) {
  const avatarContainer = document.getElementById('headerStudentAvatar');
  if (avatarContainer) {
    avatarContainer.innerHTML = student?.avatar_url
      ? '<img src="' + student.avatar_url + '" class="w-full h-full object-cover">'
      : '<span class="text-lg font-black text-green-700">' + studentName.charAt(0) + '</span>';
    const avatarImg = avatarContainer.querySelector('img');
    if (avatarImg) {
      avatarImg.onerror = () => {
        avatarContainer.innerHTML = '<span class="text-lg font-black text-green-700">' + studentName.charAt(0) + '</span>';
      };
    }
  }

  const mobileAvatar = document.getElementById('headerAvatarMobile');
  if (mobileAvatar) {
    mobileAvatar.innerHTML = student?.avatar_url
      ? '<img src="' + student.avatar_url + '" class="w-full h-full object-cover">'
      : '<span class="text-sm font-black text-sky-700">' + studentName.charAt(0) + '</span>';
  }
}

function _renderNameDisplays(student, studentName) {
  document.querySelectorAll('.guardian-name-display').forEach(el => el.textContent = studentName);
  document.querySelectorAll('.student-name-display').forEach(el => el.textContent = studentName);
  document.querySelectorAll('.classroom-name-display').forEach(el => {
    el.textContent = student?.classrooms?.name || 'Sin aula';
  });
}

function _renderProfileSiblings(allStudents, currentStudent) {
  const container = document.getElementById('profile-siblings-container');
  const list = document.getElementById('profile-siblings-list');
  if (!container || !list) return;

  if (allStudents.length <= 1) {
    container.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  list.innerHTML = allStudents.map(s => {
    const isActive = String(s.id) === String(currentStudent?.id);
    const avatarClass = isActive ? 'text-white' : 'text-slate-400';
    const avatarHtml = s.avatar_url
      ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">`
      : `<span class="font-black ${avatarClass}">${s.name.charAt(0)}</span>`;
    return `
      <button onclick="App.switchStudent('${s.id}')" 
        class="flex items-center gap-2 p-3 rounded-2xl transition-all border-2 ${isActive ? 'bg-emerald-500 border-emerald-600 text-white' : 'bg-white border-slate-100 hover:bg-emerald-50 hover:border-emerald-200 text-slate-700'}">
        <div class="w-8 h-8 rounded-xl overflow-hidden ${isActive ? 'bg-white/20' : 'bg-slate-100'} flex items-center justify-center shrink-0">
          ${avatarHtml}
        </div>
        <span class="text-sm font-bold">${Helpers.escapeHTML(s.name)}</span>
      </button>`;
  }).join('');
}

/**
 * 🔄 Cambio de Estudiante (Multi-hijo)
 */
async function switchStudent(studentId) {
  if (_pickupTimer) { clearInterval(_pickupTimer); _pickupTimer = null; }
  const all = AppState.get('students') || [];
  const selected = all.find(s => String(s.id) === String(studentId));
  if (!selected) return;

  Helpers.vibrate('medium');
  Helpers.showLoader('Cambiando perfil...');

  try {
    // 1. Limpiar Caché de Prefetch y AppState específico
    Prefetch.clear();
    AppState.set('currentDailyLog', null);
    AppState.set('currentGrades', null);
    AppState.set('currentPayments', null);

    // 2. Desuscribir Canales Realtime actuales de forma exhaustiva
    const channels = ['_dailyLogChannel', '_chatChannel', '_classroomChannel', '_notificationChannel', '_padreUnreadChannel'];
    channels.forEach(ch => {
      if (window[ch]) {
        try {
          supabase.removeChannel(window[ch]);
        } catch (err) {
          console.warn('No se pudo remover el canal realtime:', err);
        }
        window[ch] = null;
      }
    });

    // 3. Actualizar Estado Global
    AppState.set('currentStudent', selected);
    localStorage.setItem('karpus_last_student_id', studentId);
    
    // 4. Reiniciar Realtime para el nuevo hijo
    _initDailyLogRealtime(selected.id);
    if (selected.classroom_id) initLiveClassListener(selected.classroom_id);

    // 5. Recargar Dashboard y UI
    updateHeaderProfile(AppState.get('profile'), selected, all);
    await refreshDashboard();

    // Refrescar el badge de reinscripción para el nuevo hijo
    import('./reinscripcion.js').then(m => m.ReinscripcionModule.checkBadge(selected.id));

    // Si estamos en una sección específica, reiniciarla
    const currentSection = AppState.get('currentSection') || 'home';
    navigateTo(currentSection);

    Helpers.hideLoader();
    Helpers.toast(`Perfil de ${selected.name.split(' ')[0]} cargado`, 'success');

  } catch (e) {
    console.error('Error al cambiar de perfil:', e);
    Helpers.hideLoader();
    Helpers.toast('Error al cambiar de perfil: ' + (e.message || e), 'error');
  }
}

function _showStudentSwitcher(students) {
  const current = AppState.get('currentStudent');
  const html = `
    <div class="bg-white rounded-[2.5rem] overflow-hidden shadow-2xl animate-scaleIn w-full max-w-xs">
      <div class="p-6 border-b border-slate-100 bg-slate-50/50">
        <h3 class="font-black text-slate-800 text-center">Cambiar de Estudiante</h3>
      </div>
      <div class="p-4 space-y-2">
        ${students.map(s => `
          <button onclick="App.switchStudent('${s.id}'); App.ui.closeModal()" 
            class="w-full p-4 flex items-center gap-4 rounded-3xl transition-all ${String(s.id) === String(current?.id) ? 'bg-indigo-50 border-2 border-indigo-200' : 'bg-white border border-slate-100 hover:bg-slate-50'}">
            <div class="w-12 h-12 rounded-2xl overflow-hidden bg-slate-100 flex items-center justify-center shrink-0">
              ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : `<span class="font-black text-slate-400">${s.name.charAt(0)}</span>`}
            </div>
            <div class="text-left flex-1 min-w-0">
              <p class="font-black text-slate-800 text-sm truncate">${Helpers.escapeHTML(s.name)}</p>
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${s.classrooms?.name || 'Sin aula'}</p>
            </div>
            ${String(s.id) === String(current?.id) ? '<i data-lucide="check" class="w-4 h-4 text-indigo-600"></i>' : ''}
          </button>
        `).join('')}
      </div>
      <div class="p-4 bg-slate-50 flex justify-center">
         <button onclick="App.ui.closeModal()" class="text-[10px] font-black text-slate-400 uppercase tracking-widest p-2">Cerrar</button>
      </div>
    </div>
  `;
  window.openGlobalModal(html);
  if (window.lucide) lucide.createIcons();
}

function _initDailyLogRealtime(studentId) {
  // Cancelar el canal anterior si existe
  if (window._dailyLogChannel) {
    try {
      window._dailyLogChannel.unsubscribe();
    } catch (err) {
      console.warn('No se pudo cancelar el canal de daily log:', err);
    }
  }
  window._dailyLogChannel = supabase
    .channel('daily_log_' + studentId)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'daily_logs'
      // No filter here — filter client-side to avoid bigint cast issues
    }, async (payload) => {
      if (String(payload.new?.student_id) !== String(studentId) &&
          String(payload.old?.student_id) !== String(studentId)) return;
      const now = new Date();
      const today = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
      try {
        const student = AppState.get('currentStudent');
        const [log, rawSched] = await Promise.all([
          Api.getDailyLog(studentId, today),
          student?.classroom_id ? Api.getClassroomSchedule(student.classroom_id).catch(() => []) : Promise.resolve([])
        ]);
        const schedNorm = (rawSched || []).map(s => ({
          type: s.event_type, label: s.event_label, icon: s.event_icon,
          hour: s.scheduled_hour, minute: s.scheduled_minute, duration: s.duration_minutes,
        }));
        renderDailySummary(log, schedNorm);
      } catch (err) {
        console.warn('No se pudo renderizar el resumen diario:', err);
      }
    })
    .subscribe();
}

async function checkActiveMeetings() {
  try {
    const student = AppState.get('currentStudent');
    const active  = await VideoCallUI.getActiveMeeting(student?.classroom_id);
    AppState.set('isClassLive', !!active);

    const btn = document.querySelector('[data-target="videocall"]');
    if (!btn) return;

    if (active) {
      btn.classList.remove('hidden');
      btn.classList.add('ring-2', 'ring-rose-400', 'animate-pulse');
      if (!btn._vcInitialized) {
        const room = active.room_name;
        btn.addEventListener('click', () => {
          navigateTo('videocall');
          window.open('https://meet.jit.si/' + room, '_blank');
        });
        btn._vcInitialized = true;
      }
    } else {
      btn.classList.add('hidden');
      btn.classList.remove('ring-2', 'ring-rose-400', 'animate-pulse');
    }
  } catch (err) {
    console.warn('No se pudo verificar la clase en vivo:', err);
  }
}

// ── QR de Acceso del Padre ────────────────────────────────────────────────────
async function _initPadreQR(student) {
  const container = document.getElementById('padre-qr-container');
  const matLabel  = document.getElementById('padre-qr-matricula');
  const nameLabel = document.getElementById('padre-qr-name');
  if (!container || !student) {

    return;
  }

  const matricula = student.matricula;
  const name      = student.name;

  if (matLabel) matLabel.textContent = matricula || 'Sin matrícula';
  if (nameLabel) nameLabel.textContent = name || '';

  // Mostrar botones siempre (solo compartir para el padre)
  const shareBtn = document.getElementById('btn-share-padre-qr');
  const printBtn = document.getElementById('btn-print-padre-qr');
  if (shareBtn) shareBtn.classList.remove('hidden');
  if (printBtn) printBtn.classList.remove('hidden');

  if (!matricula) {
    container.innerHTML = '<div class="w-48 h-48 flex flex-col items-center justify-center text-slate-400 gap-2 text-center"><p class="text-xs font-bold">Sin matrícula asignada.<br>Contacta a la directora.</p></div>';
    if (window.lucide) lucide.createIcons({ props: { class: 'w-10 h-10' } });
    return;
  }

  // Mostrar spinner mientras carga
  container.innerHTML = '<div class="w-48 h-48 flex items-center justify-center"><div class="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div></div>';

  // Esperar QR lib (ya debería estar precargada)
  try {
    container.innerHTML = '';
    const qrData = matricula;

    const qrUrl = await Helpers.generateQRWithLogo(qrData, { width: 192, colorDark: '#198754' });
    if (qrUrl) {
      const qrImg = document.createElement('img');
      qrImg.src = qrUrl;
      qrImg.style.cssText = 'width:192px;height:192px;border-radius:1.5mm;display:block;';
      container.appendChild(qrImg);
    } else {
      container.innerHTML = '<div class="w-48 h-48 flex items-center justify-center text-rose-500 text-xs text-center font-bold">Error al generar QR.<br>Reintenta recargando la página.</div>';
    }
  } catch (e) {

    container.innerHTML = '<div class="w-48 h-48 flex items-center justify-center text-rose-500 text-xs text-center font-bold">Error al cargar QR.<br>Reintenta recargando la página.</div>';
  }

  // Imprimir
  window.App.printPadreQR = () => {
    const img = container.querySelector('img')?.src;
    if (!img) return;
    const classroom = student.classrooms?.name || '';
    const level = student.classrooms?.level || '';
    _openPrintWindow(Helpers.getQRPrintTemplate(img, name, matricula, {
      classroom, level,
      p1Name: student.p1_name || '',
      p2Name: student.p2_name || '',
      p1Phone: student.p1_phone || '',
      p2Phone: student.p2_phone || '',
      isInactive: student.is_active === false
    }));
  };

  // Compartir (solo padre)
  window.App.sharePadreQR = async () => {
    const canvas = container.querySelector('canvas');
    const img    = container.querySelector('img');
    try {
      if (canvas) {
        canvas.toBlob(async (blob) => {
          if (!blob) return;
          const file = new File([blob], `QR-${matricula}.png`, { type: 'image/png' });
          if (navigator.share && navigator.canShare?.({ files: [file] })) {
            await navigator.share({ title: `QR Karpus Kids - ${name}`, text: `Código QR de ${name} para Karpus Kids`, files: [file] });
          } else {
            // Fallback: descargar
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `QR-${matricula}.png`; a.click();
            URL.revokeObjectURL(url);
          }
        });
      } else if (img) {
        // Compartir como URL si no hay canvas
        if (navigator.share) {
          await navigator.share({ title: `QR Karpus Kids - ${name}`, text: `Código QR de ${name}`, url: img.src });
        }
      }
    } catch (err) {
      console.warn('No se pudo compartir el QR:', err);
    }
  };
}


