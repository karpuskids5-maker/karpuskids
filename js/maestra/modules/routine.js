/**
 * ============================================================
 * RUTINA EXPRESS V4 — Panel Maestra
 * Arquitectura de 4 niveles con timeline dinámico:
 *   1. Timeline del Día (colapsable → ventana vertical / barra horizontal)
 *   2. Contenedor Colectivo
 *   3. Tarjetas de los Alumnos
 *   4. Modal Individual completo
 * Schedule configurable desde BD, diseño profesional, sync con panel padre
 * ============================================================
 */
import { supabase } from '/js/shared/supabase.js';
import { AppState } from '../state.js';
import { MaestraApi } from '../api.js';
import { UI } from './ui.js';
import { Helpers } from '/js/shared/helpers.js';

const { safeToast, safeEscapeHTML, Modal } = UI;
const _saving = {};
let _undoTimer = null;
let _undoPayload = null;
let _timelineExpanded = true;
let _classroomSchedule = [];

// ── Constantes de Eventos ─────────────────────────────────────────────────────
const EVENT_TYPES = {
  bienvenida:    { icon: '👋', label: 'Bienvenida', color: 'slate'  },
  biberon:      { icon: '🍼', label: 'Biberón',    color: 'blue'   },
  panal_humedo: { icon: '💧', label: 'Pañal 💧',   color: 'sky'    },
  panal_sucio:  { icon: '💩', label: 'Pañal 💩',   color: 'amber'  },
  siesta:       { icon: '😴', label: 'Siesta',      color: 'indigo' },
  temperatura:  { icon: '🌡️', label: 'Temperatura', color: 'rose'   },
  medicamento:  { icon: '💊', label: 'Medicamento', color: 'purple' },
  bano:         { icon: '🚽', label: 'Baño',        color: 'teal'   },
  animo:        { icon: '😊', label: 'Ánimo',       color: 'orange' },
  desayuno:     { icon: '🥐', label: 'Desayuno',    color: 'yellow' },
  actividad:    { icon: '📚', label: 'Actividad',   color: 'blue'   },
  patio:        { icon: '🌳', label: 'Patio',       color: 'green'  },
  almuerzo:     { icon: '🍽️', label: 'Almuerzo',   color: 'green'  },
  merienda:     { icon: '🍎', label: 'Merienda',    color: 'lime'   },
  nota:         { icon: '📝', label: 'Nota',        color: 'slate'  },
  cepillado:    { icon: '🪥', label: 'Cepillado',   color: 'cyan'   },
  lavado_manos: { icon: '🧼', label: 'Lavado',      color: 'sky'    },
};

const DEFAULT_SCHEDULE = [
  { hour: 7,  minute: 30, label: 'Bienvenida',   type: 'bienvenida', duration: 30 },
  { hour: 8,  minute: 0,  label: 'Desayuno',     type: 'desayuno',   duration: 60 },
  { hour: 9,  minute: 0,  label: 'Actividad',    type: 'actividad',  duration: 30 },
  { hour: 9,  minute: 30, label: 'Baño',         type: 'bano',       duration: 30 },
  { hour: 10, minute: 0,  label: 'Patio',        type: 'patio',      duration: 90 },
  { hour: 11, minute: 30, label: 'Almuerzo',     type: 'almuerzo',   duration: 60 },
  { hour: 12, minute: 30, label: 'Siesta',       type: 'siesta',     duration: 90 },
  { hour: 14, minute: 0,  label: 'Merienda',     type: 'merienda',   duration: 60 },
  { hour: 15, minute: 0,  label: 'Biberón',      type: 'biberon',    duration: 30 },
];

const EXTRA_EVENT_TYPES = [
  { type: 'fiebre',       icon: '🤒', label: 'Fiebre' },
  { type: 'accidente',    icon: '🩹', label: 'Accidente' },
  { type: 'golpe',        icon: '🤕', label: 'Golpe' },
  { type: 'llamada_padres', icon: '📞', label: 'Llamada a padres' },
  { type: 'medicamento_extra', icon: '💊', label: 'Medicamento' },
  { type: 'otro',         icon: '📋', label: 'Otro' },
];

const MOOD_OPTIONS = [
  { value: 'feliz',        icon: '😀', label: 'Feliz' },
  { value: 'tranquilo',    icon: '🙂', label: 'Tranquilo' },
  { value: 'normal',       icon: '😐', label: 'Normal' },
  { value: 'triste',       icon: '😢', label: 'Triste' },
  { value: 'llanto',       icon: '😭', label: 'Llanto' },
  { value: 'enfermo',      icon: '🤒', label: 'Enfermo' },
  { value: 'somnoliento',  icon: '😴', label: 'Somnoliento' },
  { value: 'irritable',    icon: '😡', label: 'Irritable' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function _isWithin12h(dateStr) {
  if (!dateStr) return false;
  return (Date.now() - new Date(dateStr).getTime()) < 12 * 60 * 60 * 1000;
}

function _getCurrentScheduleEvent() {
  const schedule = _classroomSchedule.length ? _classroomSchedule : DEFAULT_SCHEDULE;
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  let closest = null, minDiff = Infinity;
  for (const ev of schedule) {
    const diff = Math.abs(mins - (ev.hour * 60 + ev.minute));
    if (diff < minDiff && diff <= 90) { minDiff = diff; closest = ev; }
  }
  return closest;
}

function _getActiveScheduleIndex() {
  const schedule = _classroomSchedule.length ? _classroomSchedule : DEFAULT_SCHEDULE;
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  let activeIdx = -1;
  for (let i = schedule.length - 1; i >= 0; i--) {
    if (mins >= schedule[i].hour * 60 + schedule[i].minute) {
      activeIdx = i;
      break;
    }
  }
  return activeIdx;
}

function _formatTime(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function _formatTime12(h, m) {
  const hh = h > 12 ? h - 12 : h;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${hh}:${String(m).padStart(2,'0')} ${ampm}`;
}

function _formatDate(dateStr) {
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

function _getActiveSiestas(students, logsMap) {
  return students.filter(s => {
    const events = logsMap[s.id]?.events || [];
    const siestas = events.filter(e => e.type === 'siesta');
    return siestas.length && siestas[siestas.length - 1].open === true;
  });
}

function _makeEvent(type, data = {}) {
  return { id: crypto.randomUUID(), type, created_at: new Date().toISOString(), ...data };
}

function _addEventToLog(log, event) {
  const events = Array.isArray(log?.events) ? [...log.events] : [];
  events.push(event);
  return events;
}

function _getScheduleEventIcon(type) {
  const iconMap = {
    bienvenida: '👋', desayuno: '🍞', actividad: '📚', bano: '🚽',
    patio: '🌳', almuerzo: '🥗', siesta: '😴', merienda: '🍎', biberon: '🍼'
  };
  return iconMap[type] || EVENT_TYPES[type]?.icon || '⏰';
}

function _countReportedStudents(logsMap, students) {
  return students.filter(s => {
    const log = logsMap[s.id];
    return log && (log.mood || log.food || log.nap || log.notes || (log.events && log.events.length));
  }).length;
}

function _isStudentPresent(studentId) {
  const attendance = AppState.get('attendance') || [];
  const record = attendance.find(a => a.student_id === studentId);
  return !record || record.status === 'present' || record.status === 'late';
}

function _getPresentStudentIds() {
  const students = AppState.get('students') || [];
  return students.filter(s => _isStudentPresent(s.id)).map(s => s.id);
}

// ── LOAD SCHEDULE FROM DB ─────────────────────────────────────────────────────
async function _loadSchedule(classroomId) {
  try {
    const { data, error } = await supabase
      .from('classroom_event_schedule')
      .select('event_type, event_label, event_icon, scheduled_hour, scheduled_minute, duration_minutes, auto_register, applies_to')
      .eq('classroom_id', classroomId)
      .eq('is_active', true)
      .order('sort_order');

    if (error || !data?.length) {
      _classroomSchedule = DEFAULT_SCHEDULE;
      return;
    }

    _classroomSchedule = data.map(d => ({
      type: d.event_type,
      label: d.event_label,
      icon: d.event_icon,
      hour: d.scheduled_hour,
      minute: d.scheduled_minute,
      duration: d.duration_minutes,
      autoRegister: d.auto_register,
      appliesTo: d.applies_to,
    }));
  } catch {
    _classroomSchedule = DEFAULT_SCHEDULE;
  }
}

// ── LOG EVENT TO TIMELINE ─────────────────────────────────────────────────────
async function _logTimelineEvent(classroom, eventType, studentIds, extra = {}) {
  try {
    const user = AppState.get('user');
    await supabase.rpc('log_timeline_event', {
      p_classroom_id: classroom.id,
      p_event_type: eventType,
      p_registered_by: user?.id || null,
      p_target_students: studentIds || [],
      p_scheduled_time: extra.scheduledTime || null,
      p_duration_minutes: extra.duration || null,
      p_metadata: extra.metadata || {},
    });
  } catch { /* silencioso */ }
}

// ── INIT RUTINA V4 ─────────────────────────────────────────────────────────────
export async function initRoutine() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('tab-daily-routine');
  if (!container) return;

  container.innerHTML = `
    <div class="animate-pulse space-y-5">
      <div class="h-10 bg-slate-100 rounded-2xl w-1/2"></div>
      <div class="h-28 bg-gradient-to-r from-orange-50 to-amber-50 rounded-[2rem]"></div>
      <div class="h-20 bg-indigo-50 rounded-[2rem]"></div>
      <div class="h-16 bg-green-50 rounded-[2rem]"></div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        ${Array(5).fill('<div class="h-44 bg-slate-50 rounded-[2rem]"></div>').join('')}
      </div>
    </div>`;

  try {
    const students = AppState.get('students') || [];
    const today    = new Date().toISOString().split('T')[0];

    // Cargar asistencia si no está en estado
    let attendance = AppState.get('attendance');
    if (!attendance || !attendance.length) {
      const { data: attData } = await supabase
        .from('attendance')
        .select('student_id, status')
        .eq('classroom_id', classroom.id)
        .eq('date', today);
      attendance = attData || [];
      AppState.set('attendance', attendance);
    }

    await _loadSchedule(classroom.id);

    const { data: todayLogs, error } = await supabase
      .from('daily_logs')
      .select('id, student_id, mood, food, nap, notes, status, created_at, infant_data, events')
      .eq('classroom_id', classroom.id)
      .eq('date', today);

    if (error) throw error;

    const logsMap = {};
    (todayLogs || []).forEach(l => { logsMap[l.student_id] = l; });
    AppState.set('logsMap', logsMap);

    if (!students.length) {
      container.innerHTML = '<div class="text-center p-12 text-slate-400 font-bold">No hay estudiantes en esta aula.</div>';
      return;
    }

    const todayLabel    = _formatDate(today);
    const withReport    = _countReportedStudents(logsMap, students);
    const scheduleNow   = _getCurrentScheduleEvent();
    const activeSiestas = _getActiveSiestas(students, logsMap);

    container.innerHTML = _renderRoutineLayout({
      todayLabel, students, logsMap, withReport,
      scheduleNow, activeSiestas, today, classroom
    });

    _refreshStudentCards();
    if (window.lucide) window.lucide.createIcons();

  } catch (e) {
    container.innerHTML = '<div class="text-center p-10 text-rose-500 font-bold">Error al cargar rutina. Intenta de nuevo.</div>';
  }
}

// ── RENDER LAYOUT PRINCIPAL (4 NIVELES) ───────────────────────────────────────
function _renderRoutineLayout({ todayLabel, students, logsMap, withReport, scheduleNow, activeSiestas, today, classroom }) {
  const activeIdx = _getActiveScheduleIndex();
  const schedule = _classroomSchedule.length ? _classroomSchedule : DEFAULT_SCHEDULE;

  return `
  <div class="space-y-5 pb-24" id="routineWrapper">

    <!-- ═══ NIVEL 1: TIMELINE DEL DÍA ═══ -->
    <div class="bg-white border border-slate-100 rounded-[2rem] overflow-hidden" id="timelineContainer" style="box-shadow:0 4px 24px rgba(0,0,0,0.04);">
      <!-- Header -->
      <div class="px-5 py-4 flex items-center justify-between border-b border-slate-100" style="background:linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl flex items-center justify-center text-white text-lg shadow-md" style="background:linear-gradient(135deg, #FF8A00, #f97316);box-shadow:0 4px 12px rgba(255,138,0,0.3);">📅</div>
          <div>
            <h3 class="text-sm font-black text-slate-800">Timeline del Día</h3>
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider capitalize">${todayLabel}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-black text-[#28B54D] bg-green-50 border border-green-200 px-3 py-1.5 rounded-full">
            ${withReport}/${students.length} reportes
          </span>
          <button onclick="App.toggleTimeline()" id="btnToggleTimeline"
            class="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all text-[10px] font-black text-slate-500 uppercase tracking-widest active:scale-95">
            <span id="timelineToggleIcon">${_timelineExpanded ? '▲' : '▼'}</span>
            <span id="timelineToggleLabel">${_timelineExpanded ? 'Ocultar' : 'Abrir'}</span>
          </button>
        </div>
      </div>

      <!-- Timeline Expandido: Ventana Vertical con Detalles -->
      <div id="timelineExpanded" class="${_timelineExpanded ? '' : 'hidden'}">
        <div class="max-h-[420px] overflow-y-auto custom-scrollbar">
          <div class="relative p-5">
            <!-- Línea vertical conectora -->
            <div class="absolute left-[38px] top-5 bottom-5 w-0.5 bg-gradient-to-b from-[#FF8A00]/30 via-slate-200 to-slate-100"></div>

            <div class="space-y-2">
              ${schedule.map((ev, i) => {
                const isActive = i === activeIdx;
                const isPast   = i < activeIdx;
                const isFuture = i > activeIdx;
                const timeStr  = _formatTime12(ev.hour, ev.minute);
                const eventIcon = _getScheduleEventIcon(ev.type);
                const endMins  = ev.hour * 60 + ev.minute + (ev.duration || 30);
                const endTime  = _formatTime12(Math.floor(endMins / 60), endMins % 60);

                // Contar cuántos alumnos PRESENTES tienen este evento registrado hoy
                const presentStudents = students.filter(s => _isStudentPresent(s.id));
                const studentsWithEvent = presentStudents.filter(s => {
                  const evts = logsMap[s.id]?.events || [];
                  return evts.some(e => e.type === ev.type);
                }).length;

                const activeSoftBgs = {
                  bienvenida:'#f1f5f9', desayuno:'#fef3c7', actividad:'#eff6ff',
                  bano:'#f0fdfa', patio:'#f0fdf4', almuerzo:'#f0fdf4',
                  siesta:'#eef2ff', merienda:'#ecfccb', biberon:'#f0f9ff'
                };

                return `
                <button onclick="App.openBulkEventModal('${ev.type}')"
                  class="relative flex items-start gap-4 w-full p-3 rounded-2xl transition-all active:scale-[0.98] ${
                    isActive ? `bg-gradient-to-r from-[#FF8A00]/10 to-orange-50 border-2 border-[#FF8A00]/30 shadow-md shadow-orange-100/50` :
                    isPast ? 'bg-slate-50/80 border-2 border-transparent hover:bg-slate-50' :
                    'border-2 border-transparent hover:bg-slate-50'
                  }">

                  <!-- Icono en la línea -->
                  <div class="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 z-10 transition-all ${isActive ? 'text-white shadow-lg scale-110' : 'text-slate-500'}" style="${isActive ? 'background:linear-gradient(135deg, #FF8A00, #f97316);box-shadow:0 4px 12px rgba(255,138,0,0.3);' : `background:${activeSoftBgs[ev.type] || '#f1f5f9'};`}">
                    ${eventIcon}
                  </div>

                  <!-- Contenido -->
                  <div class="flex-1 text-left min-w-0">
                    <div class="flex items-center gap-2 mb-0.5">
                      <span class="text-[11px] font-black ${isActive ? 'text-[#FF8A00]' : isPast ? 'text-slate-500' : 'text-slate-400'}">${timeStr}</span>
                      ${isActive ? '<span class="px-2 py-0.5 bg-[#FF8A00] text-white text-[7px] font-black uppercase rounded-lg animate-pulse shadow-sm">AHORA</span>' : ''}
                      ${isPast ? '<span class="px-2 py-0.5 bg-slate-200 text-slate-500 text-[7px] font-black uppercase rounded-lg">✓ Hecho</span>' : ''}
                    </div>
                    <p class="text-sm font-black text-slate-700 leading-tight">${ev.label}</p>
                    <div class="flex items-center gap-3 mt-1">
                      <span class="text-[9px] font-bold text-slate-400">${endTime}</span>
                      <span class="text-[9px] font-bold text-slate-300">·</span>
                      <span class="text-[9px] font-bold text-slate-400">${ev.duration || 30}min</span>
                      ${studentsWithEvent > 0 ? `
                        <span class="text-[9px] font-black ${studentsWithEvent === presentStudents.length ? 'text-[#28B54D]' : 'text-[#FF8A00]'}">
                          ${studentsWithEvent}/${presentStudents.length} alumnos
                        </span>
                      ` : ''}
                    </div>
                  </div>

                  <!-- Chevron -->
                  <div class="shrink-0 mt-1">
                    <i data-lucide="chevron-right" class="w-4 h-4 ${isActive ? 'text-[#FF8A00]' : 'text-slate-300'}"></i>
                  </div>
                </button>`;
              }).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Timeline Colapsado: Barra Horizontal de Emojis -->
      <div id="timelineCollapsed" class="${_timelineExpanded ? 'hidden' : ''} px-4 py-3 border-t border-slate-100">
        <div class="overflow-x-auto" style="scrollbar-width:none" id="timelineCollapsedScroll">
          <div class="flex items-center gap-1.5 min-w-max py-1">
            ${schedule.map((ev, i) => {
              const isActive = i === activeIdx;
              const isPast   = i < activeIdx;
              return `
              <button onclick="App.openBulkEventModal('${ev.type}')"
                class="flex flex-col items-center gap-1 px-3 py-2 rounded-2xl transition-all active:scale-90 ${
                  isActive ? 'bg-[#FF8A00]/10 scale-110 shadow-sm' :
                  isPast ? 'bg-slate-50/50' : 'hover:bg-slate-50'
                }">
                <span class="text-xl leading-none ${isActive ? 'drop-shadow-md' : ''}">${_getScheduleEventIcon(ev.type)}</span>
                ${isActive ? '<span class="w-1.5 h-1.5 bg-[#FF8A00] rounded-full"></span>' :
                  isPast ? '<span class="w-1.5 h-1.5 bg-[#28B54D] rounded-full"></span>' :
                  '<span class="w-1.5 h-1.5 bg-slate-200 rounded-full"></span>'}
              </button>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ NIVEL 2: CONTENEDOR COLECTIVO ═══ -->

    <!-- Banner Siestas Activas -->
    ${activeSiestas.length > 0 ? `
    <div class="bg-white border-2 border-purple-200 rounded-[1.5rem] p-4 flex items-center gap-4 shadow-sm" style="background:linear-gradient(135deg, #faf5ff 0%, #f0f0ff 100%);">
      <div class="w-12 h-12 text-white rounded-2xl flex items-center justify-center text-xl shrink-0 shadow-lg animate-pulse" style="background:linear-gradient(135deg, #9333ea, #7c3aed);box-shadow:0 4px 14px rgba(147,51,234,0.35);">😴</div>
      <div class="flex-1">
        <p class="text-sm font-black text-purple-800">${activeSiestas.length} siesta${activeSiestas.length > 1 ? 's' : ''} activa${activeSiestas.length > 1 ? 's' : ''}</p>
        <p class="text-[11px] font-bold text-purple-600">
          ${activeSiestas.slice(0,2).map(s => s.name.split(' ')[0]).join(', ')}${activeSiestas.length > 2 ? ` y ${activeSiestas.length - 2} más` : ''}
        </p>
      </div>
      <button onclick="App.wakeAllSiestas()" class="px-4 py-2.5 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all shadow-lg" style="background:linear-gradient(135deg, #9333ea, #7c3aed);box-shadow:0 4px 14px rgba(147,51,234,0.35);">
        Despertar todos
      </button>
    </div>
    ` : ''}

    <!-- Alerta Momento del Día -->
    ${scheduleNow ? `
    <div class="bg-white border-2 rounded-[1.5rem] p-4 flex items-center gap-4 shadow-sm" style="border-color:rgba(255,138,0,0.3);background:linear-gradient(135deg, #fff7ed 0%, #fffbeb 100%);">
      <div class="w-12 h-12 text-white rounded-2xl flex items-center justify-center text-xl shrink-0 shadow-lg" style="background:linear-gradient(135deg, #FF8A00, #f97316);box-shadow:0 4px 14px rgba(255,138,0,0.35);">
        ${EVENT_TYPES[scheduleNow.type]?.icon || _getScheduleEventIcon(scheduleNow.type)}
      </div>
      <div class="flex-1">
        <p class="text-[10px] font-black uppercase tracking-wider" style="color:#FF8A00;">Momento del día</p>
        <p class="text-sm font-black text-slate-800">Es hora del ${scheduleNow.label}</p>
      </div>
      <button onclick="App.openBulkEventModal('${scheduleNow.type}')"
        class="px-4 py-2.5 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all shadow-lg" style="background:linear-gradient(135deg, #FF8A00, #f97316);box-shadow:0 4px 14px rgba(255,138,0,0.35);">
        Registrar todos
      </button>
    </div>
    ` : ''}

    <!-- Acciones Colectivas del Aula -->
    <div class="bg-white border border-slate-100 rounded-[2rem] p-5 shadow-lg" style="box-shadow:0 4px 24px rgba(0,0,0,0.04);">
      <div class="flex items-center justify-between mb-4">
        <div>
          <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Acciones del Aula</p>
          <p class="text-[9px] font-bold text-slate-300 mt-0.5">${withReport} de ${students.length} reportados</p>
        </div>
      </div>
      <div class="grid grid-cols-4 sm:grid-cols-6 gap-2.5">
        ${Object.entries(EVENT_TYPES).map(([type, meta]) => {
          const softBgs = {slate:'#f1f5f9',blue:'#eff6ff',sky:'#f0f9ff',amber:'#fffbeb',indigo:'#eef2ff',rose:'#fff1f2',purple:'#faf5ff',teal:'#f0fdfa',orange:'#fff7ed',yellow:'#fefce8',green:'#f0fdf4',lime:'#f7fee7',cyan:'#ecfeff'};
          const softBorders = {slate:'#cbd5e1',blue:'#93c5fd',sky:'#7dd3fc',amber:'#fcd34d',indigo:'#a5b4fc',rose:'#fda4af',purple:'#d8b4fe',teal:'#5eead4',orange:'#fdba74',yellow:'#fde047',green:'#86efac',lime:'#bef264',cyan:'#67e8f9'};
          const bg = softBgs[meta.color] || '#f1f5f9';
          const hovBorder = softBorders[meta.color] || '#cbd5e1';
          return `
          <button onclick="App.openBulkEventModal('${type}')"
            class="flex flex-col items-center gap-1.5 p-3 hover:bg-white border-2 border-transparent rounded-[1.2rem] transition-all active:scale-90 group" style="background:${bg};box-shadow:0 1px 3px rgba(0,0,0,0.04);--hov-bc:${hovBorder};" onmouseenter="this.style.borderColor=this.style.getPropertyValue('--hov-bc')" onmouseleave="this.style.borderColor='transparent'">
            <span class="text-2xl group-hover:scale-110 transition-transform">${meta.icon}</span>
            <span class="text-[9px] font-black uppercase tracking-tight leading-tight text-center" style="color:${hovBorder};">${meta.label}</span>
          </button>`;
        }).join('')}
      </div>
      <button onclick="App.registerMissingStudents()" class="w-full mt-3 py-2.5 bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-200 rounded-2xl text-[10px] font-black text-slate-400 uppercase tracking-widest transition-all active:scale-95">
        Registrar faltantes
      </button>
    </div>

    <!-- ═══ NIVEL 3: TARJETAS DE LOS ALUMNOS ═══ -->
    <div>
      <div class="flex items-center justify-between mb-3 px-1">
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Alumnos</p>
        <span class="text-[9px] font-bold text-slate-300">${_getPresentStudentIds().length} presentes</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3" id="routineStudentsGrid"></div>
    </div>

    <p class="text-[10px] text-slate-400 text-center font-medium pb-2">
      Toca un alumno para ver su reporte completo
    </p>
  </div>`;
}

// ── TARJETA ESTUDIANTE (NIVEL 3) ──────────────────────────────────────────────
function _renderStudentRoutineCard(s, log) {
  const isValid    = !!(log && (log.mood || log.food || log.nap || log.notes || (log.events && log.events.length)));
  const mood       = isValid && log.mood  ? log.mood  : null;
  const food       = isValid && log.food  ? log.food  : null;
  const sleep      = isValid && log.nap   ? log.nap   : null;
  const note       = isValid && log.notes ? true       : false;
  const isDraft    = isValid && log.status === 'draft';
  const isInfant   = s.age_type === 'meses' || s.age_type === 'mes';
  const events     = isValid ? (log.events || log.infant_data || []) : [];
  const lastEvent  = events.length ? events[events.length - 1] : null;
  const hasBiberon = events.some(e => e.type === 'biberon' || e.type === 'milk' || e.type === 'structured_entry');
  const activeSiesta = events.filter(e => e.type === 'siesta').some(e => e.open === true);
  const isPresent  = _isStudentPresent(s.id);

  const moodEmojiMap = {};
  MOOD_OPTIONS.forEach(m => { moodEmojiMap[m.value] = m.icon; });
  const moodEmojis = { ...moodEmojiMap, feliz: '😀', normal: '😐', triste: '😢', enojado: '😡' };
  const foodEmojis = { todo: '🍽️', poco: '🍲', nada: '🙅', all: '🍽️', half: '🥣', little: '🍲', none: '🙅' };
  const sleepEmojis = { si: '💤', no: '☀️' };

  const eventTypes = [];
  if (events.some(e => e.type === 'desayuno'))  eventTypes.push('🍞');
  if (events.some(e => e.type === 'almuerzo'))  eventTypes.push('🥗');
  if (events.some(e => e.type === 'siesta'))    eventTypes.push('😴');
  if (events.some(e => e.type === 'actividad')) eventTypes.push('📚');
  if (events.some(e => e.type === 'bano'))      eventTypes.push('🚽');
  if (hasBiberon)                               eventTypes.push('🍼');

  return `
    <div onclick="App.openStudentRoutine('${s.id}')"
      class="group relative bg-white rounded-[1.5rem] p-3 border-2 ${!isPresent ? 'border-dashed border-slate-200 opacity-60' : isDraft ? 'border-dashed border-[#FF8A00]/40 bg-orange-50/20' : isValid ? 'border-[#28B54D]/30' : 'border-slate-100'} hover:border-[#FF8A00] hover:shadow-xl hover:shadow-orange-100 transition-all cursor-pointer active:scale-95 flex flex-col overflow-hidden">

      ${!isPresent ? '<div class="absolute top-2 left-2 z-10"><span class="px-2 py-0.5 bg-slate-400 text-white text-[8px] font-black uppercase rounded-lg">Ausente</span></div>' : ''}
      ${isDraft ? '<div class="absolute top-2 left-2 z-10"><span class="px-2 py-0.5 bg-[#FF8A00] text-white text-[8px] font-black uppercase rounded-lg">Borrador</span></div>' : ''}
      ${activeSiesta ? '<div class="absolute top-2 left-2 z-10 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-sm shadow-md animate-pulse">😴</div>' : ''}

      <div class="flex items-center gap-2.5 mb-2">
        <div class="w-11 h-11 rounded-xl bg-orange-50 border-2 border-white shadow-inner overflow-hidden shrink-0 flex items-center justify-center font-black text-base text-orange-300 group-hover:scale-105 transition-transform">
          ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover" loading="lazy">` : s.name.charAt(0)}
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="text-[11px] font-black text-slate-800 leading-tight truncate">${safeEscapeHTML(s.name)}</h4>
          <p class="text-[9px] font-bold text-slate-400 uppercase">${s.age} ${s.age_type || 'años'}</p>
        </div>
        <div class="flex flex-col gap-0.5 shrink-0">
          ${mood ? `<div class="w-5 h-5 bg-orange-50 rounded-full flex items-center justify-center text-[10px] border border-orange-100">${moodEmojis[mood] || '😐'}</div>` : ''}
          ${(!isInfant && food) ? `<div class="w-5 h-5 bg-emerald-50 rounded-full flex items-center justify-center text-[10px] border border-emerald-100">${foodEmojis[food] || '🍽️'}</div>` : ''}
          ${(isInfant && hasBiberon) ? '<div class="w-5 h-5 bg-blue-50 rounded-full flex items-center justify-center text-[10px] border border-blue-100">🍼</div>' : ''}
          ${sleep ? `<div class="w-5 h-5 bg-indigo-50 rounded-full flex items-center justify-center text-[10px] border border-indigo-100">${sleepEmojis[sleep] || '💤'}</div>` : ''}
        </div>
      </div>

      ${eventTypes.length > 0 ? `
      <div class="flex items-center gap-0.5 flex-wrap mb-1.5">
        ${eventTypes.map(e => `<span class="text-[10px] leading-none">${e}</span>`).join('')}
      </div>
      ` : ''}

      <div class="mt-auto flex items-center justify-between">
        ${lastEvent ? `<p class="text-[8px] font-bold text-slate-300">${_formatTime(lastEvent.created_at)}</p>` : '<p class="text-[8px] font-bold text-slate-200">Sin registros</p>'}
        <div class="flex gap-1">
          <div class="w-2 h-2 rounded-full ${mood ? 'bg-[#FF8A00]' : 'bg-slate-200'}"></div>
          <div class="w-2 h-2 rounded-full ${isInfant ? (hasBiberon ? 'bg-blue-400' : 'bg-slate-200') : (food ? 'bg-[#28B54D]' : 'bg-slate-200')}"></div>
          <div class="w-2 h-2 rounded-full ${sleep ? 'bg-indigo-400' : 'bg-slate-200'}"></div>
        </div>
      </div>
    </div>`;
}

// ── TOGGLE TIMELINE ───────────────────────────────────────────────────────────
export function toggleTimeline() {
  _timelineExpanded = !_timelineExpanded;
  const expanded  = document.getElementById('timelineExpanded');
  const collapsed = document.getElementById('timelineCollapsed');
  const icon      = document.getElementById('timelineToggleIcon');
  const label     = document.getElementById('timelineToggleLabel');

  if (_timelineExpanded) {
    expanded?.classList.remove('hidden');
    collapsed?.classList.add('hidden');
    if (icon) icon.textContent = '▲';
    if (label) label.textContent = 'Ocultar';
  } else {
    expanded?.classList.add('hidden');
    collapsed?.classList.remove('hidden');
    if (icon) icon.textContent = '▼';
    if (label) label.textContent = 'Abrir';
    const activeIdx = _getActiveScheduleIndex();
    const scroll = document.getElementById('timelineCollapsedScroll');
    if (scroll && activeIdx >= 0) {
      const btns = scroll.querySelectorAll('button');
      if (btns[activeIdx]) btns[activeIdx].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }
}

// ── REFRESH HELPERS ───────────────────────────────────────────────────────────
function _refreshReportCount() {
  const students = AppState.get('students') || [];
  const logsMap  = AppState.get('logsMap') || {};
  const withReport = _countReportedStudents(logsMap, students);
  const badge = document.querySelector('#routineWrapper .text-\\[\\#28B54D\\]');
  if (badge) badge.textContent = `${withReport}/${students.length} reportes`;
  const countEl = document.querySelectorAll('#routineWrapper .text-slate-300');
  countEl.forEach(el => { if (el.textContent.includes(' de ')) el.textContent = `${withReport} de ${students.length}`; });
}

// ── REGISTER MISSING STUDENTS ─────────────────────────────────────────────────
export async function registerMissingStudents() {
  const students  = AppState.get('students') || [];
  const logsMap   = AppState.get('logsMap') || {};
  const missing   = students.filter(s => {
    const log = logsMap[s.id];
    return !log || !(log.mood || log.food || log.nap || log.notes || (log.events && log.events.length));
  });
  if (!missing.length) { safeToast('Todos los alumnos ya tienen registro hoy'); return; }
  if (!confirm(`¿Registrar ${missing.length} alumno${missing.length > 1 ? 's' : ''} faltante${missing.length > 1 ? 's' : ''} como presentes?`)) return;

  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  try {
    await Promise.all(missing.map(s =>
      MaestraApi.upsertDailyLog({ student_id: s.id, classroom_id: classroom.id, date: today, events: [] })
    ));
    await _logTimelineEvent(classroom, 'registro_manual', missing.map(s => s.id));
    safeToast(`${missing.length} alumno${missing.length > 1 ? 's' : ''} registrado${missing.length > 1 ? 's' : ''}`);
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
    _refreshReportCount();
  } catch (e) {
    safeToast('Error al registrar faltantes', 'error');
  }
}

// ── MODAL COLECTIVO (BULK) — DISEÑO PROFESIONAL ──────────────────────────────
export async function openBulkEventModal(eventType = 'animo') {
  const students = AppState.get('students') || [];
  const meta = EVENT_TYPES[eventType] || { icon: '📝', label: eventType, color: 'slate' };
  const modalId = 'bulkEventModal';

  const subParams = _renderSubParams(eventType);

  const chipsHTML = students.map(s => {
    const isPresent = _isStudentPresent(s.id);
    return `
    <button type="button" data-sid="${s.id}" onclick="this.classList.toggle('selected'); this.classList.toggle('ring-2'); this.classList.toggle('ring-[#28B54D]');"
      class="${isPresent ? 'selected ring-2 ring-[#28B54D]' : 'opacity-50'} flex items-center gap-2 px-3 py-2.5 ${isPresent ? 'bg-green-50/80 border-2 border-[#28B54D]/20' : 'bg-slate-50/80 border-2 border-slate-200/50'} rounded-2xl transition-all active:scale-95 hover:border-[#28B54D] hover:bg-green-50">
      <div class="w-8 h-8 rounded-full bg-slate-200 overflow-hidden shrink-0 flex items-center justify-center text-xs font-black text-slate-500">
        ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
      </div>
      <div class="flex-1 min-w-0 text-left">
        <span class="text-[11px] font-black text-slate-700 leading-tight block truncate">${s.name.split(' ')[0]}</span>
        <span class="text-[8px] font-bold ${isPresent ? 'text-[#28B54D]' : 'text-slate-400'} uppercase">${isPresent ? 'Presente' : 'Ausente'}</span>
      </div>
    </button>`;
  }).join('');

  const content = `
    <div class="bg-white w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col" style="max-height:min(90vh, calc(100vh - 32px));">
      <!-- Header con gradiente -->
      <div class="p-6 text-white relative overflow-hidden" style="background:linear-gradient(135deg, #28B54D 0%, #10b981 50%, #14b8a6 100%);">
        <div class="absolute -top-8 -right-8 w-32 h-32 rounded-full blur-2xl" style="background:rgba(255,255,255,0.1);"></div>
        <div class="absolute -bottom-8 -left-8 w-24 h-24 rounded-full blur-xl" style="background:rgba(255,255,255,0.1);"></div>
        <div class="relative flex items-center gap-4">
          <div class="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center text-2xl border border-white/20 shadow-lg">${meta.icon}</div>
          <div class="flex-1">
            <h3 class="text-xl font-black">${meta.label}</h3>
            <p class="text-xs font-bold text-green-100 uppercase tracking-widest">Registro colectivo</p>
          </div>
          <button onclick="Modal.close('${modalId}')" class="p-2.5 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors border border-white/20">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <div class="overflow-y-auto flex-1 p-5 space-y-5 custom-scrollbar">
        ${subParams}

        <div>
          <div class="flex items-center justify-between mb-3">
            <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">¿A quién aplica?</p>
            <div class="flex gap-2">
              <button type="button" onclick="_bulkSelectAll(true)"  class="text-[9px] font-black text-[#28B54D] hover:underline uppercase">Todos</button>
              <button type="button" onclick="_bulkSelectAll(false)" class="text-[9px] font-black text-slate-400 hover:underline uppercase">Ninguno</button>
            </div>
          </div>
          <div id="bulkChipsGrid" class="flex flex-wrap gap-2">
            ${chipsHTML}
          </div>
        </div>
      </div>

      <div class="p-5 bg-white border-t border-slate-100">
        <button id="btnBulkConfirm" onclick="App.confirmBulkEvent('${eventType}')"
          class="w-full py-4 text-white rounded-2xl font-black text-sm uppercase tracking-widest active:scale-[0.98] transition-colors flex items-center justify-center gap-2" style="background:#FF8A00 !important;border:2px solid #E67A00 !important;box-shadow:0 6px 20px rgba(255,138,0,0.4);opacity:1 !important;">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Confirmar
        </button>
      </div>
    </div>`;

  Modal.open(modalId, content);
  if (window.lucide) window.lucide.createIcons();
}

function _renderSubParams(eventType) {
  switch (eventType) {
    case 'biberon':
      return `
        <div class="space-y-4">
          <div class="space-y-2">
            <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Onzas de leche</p>
            <div class="grid grid-cols-4 gap-2">
              ${[2,4,6,8].map(oz => `
                <button type="button" data-oz="${oz}" onclick="document.querySelectorAll('[data-oz]').forEach(b=>b.classList.remove('bg-blue-500','text-white','border-blue-500')); this.classList.add('bg-blue-500','text-white','border-blue-500');"
                  class="py-3.5 bg-blue-50 border-2 border-blue-200 rounded-2xl font-black text-sm text-blue-700 hover:bg-blue-100 transition-all active:scale-90">
                  ${oz}<span class="text-[9px]">oz</span>
                </button>`).join('')}
            </div>
          </div>
          <div class="space-y-2">
            <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Temperatura</p>
            <div class="grid grid-cols-4 gap-2">
              ${['Fría','Natural','Tibia','Caliente'].map(t => `
                <button type="button" data-milk-temp="${t}" onclick="document.querySelectorAll('[data-milk-temp]').forEach(b=>b.classList.remove('bg-sky-500','text-white','border-sky-500')); this.classList.add('bg-sky-500','text-white','border-sky-500');"
                  class="py-2.5 bg-sky-50 border-2 border-sky-200 rounded-2xl font-black text-[10px] text-sky-700 hover:bg-sky-100 transition-all active:scale-90 uppercase">
                  ${t}
                </button>`).join('')}
            </div>
          </div>
        </div>`;
    case 'temperatura': {
      const temps = [36.4,36.6,36.8,37.0,37.2,37.5,37.8,38.0];
      return `
        <div class="space-y-2">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Temperatura</p>
          <div class="grid grid-cols-4 gap-2">
            ${temps.map(t => {
              const fiebre = t >= 37.5;
              return `
              <button type="button" data-temp="${t}" onclick="document.querySelectorAll('[data-temp]').forEach(b=>{b.classList.remove('bg-rose-500','text-white','border-rose-500','bg-blue-500','border-blue-400'); b.classList.add('bg-slate-50','border-slate-100');}); this.classList.remove('bg-slate-50','border-slate-100'); this.classList.add('${fiebre ? 'bg-rose-500' : 'bg-blue-500'}','${fiebre ? 'border-rose-500' : 'border-blue-400'}','text-white');"
                class="py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs ${fiebre ? 'text-rose-600' : 'text-slate-600'} hover:bg-slate-100 transition-all active:scale-90 relative">
                ${t}°${fiebre ? '<span class="absolute -top-1 -right-1 text-[8px]">🔥</span>' : ''}
              </button>`;}).join('')}
          </div>
        </div>`;
    }
    case 'medicamento':
      return `
        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Nombre</p>
              <input id="medNombre" type="text" placeholder="Ej: Ibuprofeno" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-purple-400 transition-all">
            </div>
            <div class="space-y-1">
              <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Dosis</p>
              <input id="medDosis" type="text" placeholder="Ej: 5ml" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-purple-400 transition-all">
            </div>
          </div>
          <div class="space-y-1">
            <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Autorización</p>
            <input id="medAuth" type="text" placeholder="Ej: Padre autorizó" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-purple-400 transition-all">
          </div>
        </div>`;
    case 'animo':
      return `
        <div class="space-y-2">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Estado de ánimo</p>
          <div class="grid grid-cols-4 gap-2">
            ${MOOD_OPTIONS.map(m => `
              <button type="button" data-mood="${m.value}" onclick="document.querySelectorAll('[data-mood]').forEach(b=>{b.classList.remove('border-orange-400','bg-orange-50');}); this.classList.add('border-orange-400','bg-orange-50');"
                class="flex flex-col items-center p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl transition-all active:scale-90 hover:border-orange-200 hover:bg-orange-50/50">
                <span class="text-2xl">${m.icon}</span>
                <span class="text-[8px] font-black text-slate-400 uppercase mt-1 leading-tight text-center">${m.label}</span>
              </button>`).join('')}
          </div>
        </div>`;
    case 'siesta':
      return `
        <div class="space-y-2">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Acción de siesta</p>
          <div class="grid grid-cols-2 gap-3">
            <button type="button" data-siesta-action="iniciar"
              onclick="document.querySelectorAll('[data-siesta-action]').forEach(b=>{b.classList.remove('bg-indigo-500','text-white','border-indigo-500');}); this.classList.add('bg-indigo-500','text-white','border-indigo-500');"
              class="flex flex-col items-center gap-2 p-5 bg-indigo-50 border-2 border-indigo-200 rounded-2xl transition-all active:scale-95 hover:border-indigo-400">
              <span class="text-4xl">😴</span>
              <span class="text-xs font-black text-indigo-700 uppercase tracking-wide">Se durmió</span>
            </button>
            <button type="button" data-siesta-action="despertar"
              onclick="document.querySelectorAll('[data-siesta-action]').forEach(b=>{b.classList.remove('bg-indigo-500','text-white','border-indigo-500');}); this.classList.add('bg-indigo-500','text-white','border-indigo-500');"
              class="flex flex-col items-center gap-2 p-5 bg-amber-50 border-2 border-amber-200 rounded-2xl transition-all active:scale-95 hover:border-amber-400">
              <span class="text-4xl">☀️</span>
              <span class="text-xs font-black text-amber-700 uppercase tracking-wide">Despertó</span>
            </button>
          </div>
        </div>`;
    case 'nota':
      return `
        <div class="space-y-1">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Observación grupal</p>
          <textarea id="bulkNota" rows="3" placeholder="Escribe aquí la nota para el grupo..." class="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium outline-none focus:border-slate-400 transition-all resize-none"></textarea>
        </div>`;
    default:
      return '';
  }
}

window._bulkSelectAll = (select) => {
  document.querySelectorAll('#bulkChipsGrid button[data-sid]').forEach(b => {
    if (select) { b.classList.add('selected','ring-2','ring-[#28B54D]'); }
    else { b.classList.remove('selected','ring-2','ring-[#28B54D]'); }
  });
};

// ── CONFIRMAR EVENTO COLECTIVO ────────────────────────────────────────────────
export async function confirmBulkEvent(eventType) {
  const btn = document.getElementById('btnBulkConfirm');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="animate-spin">⏳</span> Guardando...'; }

  try {
    const selected = [...document.querySelectorAll('#bulkChipsGrid button.selected[data-sid]')].map(b => b.dataset.sid);
    if (!selected.length) { safeToast('Selecciona al menos un estudiante', 'warning'); return; }

    const presentIds = _getPresentStudentIds();
    const absentSelected = selected.filter(sid => !presentIds.includes(sid));
    if (absentSelected.length > 0) {
      const proceed = confirm(`Hay ${absentSelected.length} estudiante${absentSelected.length > 1 ? 's' : ''} ausente${absentSelected.length > 1 ? 's' : ''} seleccionado${absentSelected.length > 1 ? 's' : ''}. ¿Registrar evento de todos modos?\n\nSolo se recomienda registrar eventos para estudiantes presentes.`);
      if (!proceed) return;
    }

    const classroom = AppState.get('classroom');
    const today     = new Date().toISOString().split('T')[0];
    const logsMap   = AppState.get('logsMap') || {};

    const extra = {};
    if (eventType === 'biberon') {
      extra.oz    = parseFloat(document.querySelector('[data-oz].bg-blue-500')?.dataset.oz) || 0;
      extra.milk_temp = document.querySelector('[data-milk-temp].bg-sky-500')?.dataset.milkTemp || null;
    }
    if (eventType === 'temperatura')  extra.temp  = parseFloat(document.querySelector('[data-temp].text-white')?.dataset.temp) || null;
    if (eventType === 'medicamento')  {
      extra.nombre = document.getElementById('medNombre')?.value.trim();
      extra.dosis  = document.getElementById('medDosis')?.value.trim();
      extra.autorizacion = document.getElementById('medAuth')?.value.trim();
    }
    if (eventType === 'animo')        extra.mood  = document.querySelector('[data-mood].border-orange-400')?.dataset.mood;
    if (eventType === 'nota')         extra.texto = document.getElementById('bulkNota')?.value.trim();
    const siestaAction = eventType === 'siesta' ? document.querySelector('[data-siesta-action].bg-indigo-500')?.dataset.siestaAction : null;

    const prevState = {};
    const now = new Date().toISOString();
    const promises  = selected.map(async (sid) => {
      const currentLog = logsMap[sid] || {};
      prevState[sid]   = { ...currentLog };
      let newEvents;

      if (eventType === 'siesta' && siestaAction === 'despertar') {
        const events = [...(currentLog.events || [])];
        let closed = false;
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].type === 'siesta' && events[i].open) {
            const start = new Date(events[i].created_at);
            const mins  = Math.round((new Date(now) - start) / 60000);
            events[i] = { ...events[i], open: false, end_at: now, duration_min: mins };
            closed = true;
            break;
          }
        }
        if (!closed) events.push(_makeEvent('siesta', { open: false, end_at: now, duration_min: 0 }));
        newEvents = events;
      } else {
        const newEvent = _makeEvent(eventType, extra);
        if (eventType === 'siesta') newEvent.open = true;
        newEvents = _addEventToLog(currentLog, newEvent);
      }

      const payload = { student_id: sid, classroom_id: classroom.id, date: today, events: newEvents };
      if (eventType === 'animo'  && extra.mood) payload.mood = extra.mood;
      if (eventType === 'biberon')               payload.nap  = currentLog.nap || null;
      return MaestraApi.upsertDailyLog(payload);
    });

    await Promise.all(promises);

    await _logTimelineEvent(classroom, eventType, selected.map(Number), {
      metadata: { oz: extra.oz, temp: extra.temp, mood: extra.mood, milk_temp: extra.milk_temp }
    });

    Modal.close('bulkEventModal');
    safeToast(`${EVENT_TYPES[eventType]?.label || eventType} registrado para ${selected.length} estudiante${selected.length > 1 ? 's' : ''}`);

    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
    _refreshReportCount();
    _showUndoBar(eventType, selected, prevState);

  } catch (e) {
    safeToast('Error al guardar', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4"></i> Confirmar'; if (window.lucide) lucide.createIcons(); }
  }
}

// ── UNDO BAR ──────────────────────────────────────────────────────────────────
function _showUndoBar(eventType, sids, prevState) {
  clearTimeout(_undoTimer);
  _undoPayload = { eventType, sids, prevState };

  let el = document.getElementById('undoBarWrapper');
  if (!el) {
    el = document.createElement('div');
    el.id = 'undoBarWrapper';
    el.className = 'fixed bottom-0 left-0 right-0 z-[9999] p-4 flex justify-center pointer-events-none';
    document.body.appendChild(el);
  }

  el.innerHTML = `
    <div class="pointer-events-auto bg-slate-900 text-white rounded-2xl px-5 py-3 flex items-center gap-4 shadow-2xl max-w-sm w-full animate-slideUpFade">
      <span class="text-sm font-bold flex-1">${EVENT_TYPES[eventType]?.icon || '✅'} Registrado para ${sids.length} estudiante${sids.length > 1 ? 's' : ''}</span>
      <button onclick="App.undoLastBulk()" class="text-[#FF8A00] font-black text-xs uppercase tracking-widest hover:text-orange-400 transition-colors shrink-0">Deshacer</button>
      <div class="w-1 h-8 bg-slate-700 rounded-full overflow-hidden shrink-0">
        <div id="undoProgress" class="w-full bg-[#FF8A00] rounded-full transition-all" style="height:100%"></div>
      </div>
    </div>`;

  let pct = 100;
  const tick = setInterval(() => {
    pct -= 2;
    const prog = document.getElementById('undoProgress');
    if (prog) prog.style.height = pct + '%';
    if (pct <= 0) { clearInterval(tick); el.innerHTML = ''; _undoPayload = null; }
  }, 200);
  _undoTimer = setTimeout(() => { clearInterval(tick); el.innerHTML = ''; _undoPayload = null; }, 10000);
}

export async function undoLastBulk() {
  if (!_undoPayload) return;
  clearTimeout(_undoTimer);
  const { sids, prevState } = _undoPayload;
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  try {
    await Promise.all(sids.map(sid => {
      const prev = prevState[sid] || {};
      return MaestraApi.upsertDailyLog({
        student_id: sid, classroom_id: classroom.id, date: today,
        events: prev.events || [], mood: prev.mood || null, food: prev.food || null, nap: prev.nap || null
      });
    }));
    _undoPayload = null;
    document.getElementById('undoBarWrapper').innerHTML = '';
    safeToast('Registro revertido', 'success');
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
    _refreshReportCount();
  } catch (e) { safeToast('Error al deshacer', 'error'); }
}

async function _refreshLogsMap(classroomId, today) {
  const { data } = await supabase
    .from('daily_logs')
    .select('id, student_id, mood, food, nap, notes, status, created_at, infant_data, events')
    .eq('classroom_id', classroomId)
    .eq('date', today);
  const newMap = {};
  (data || []).forEach(l => { newMap[l.student_id] = l; });
  AppState.set('logsMap', newMap);

  // Also refresh attendance
  const { data: attData } = await supabase
    .from('attendance')
    .select('student_id, status')
    .eq('classroom_id', classroomId)
    .eq('date', today);
  AppState.set('attendance', attData || []);

  return newMap;
}

function _refreshStudentCards() {
  const students = AppState.get('students') || [];
  const logsMap  = AppState.get('logsMap') || {};
  const grid = document.getElementById('routineStudentsGrid');
  if (!grid) return;
  grid.innerHTML = students.map(s => _renderStudentRoutineCard(s, logsMap[s.id] || {})).join('');
  if (window.lucide) window.lucide.createIcons();
}

// ── DESPERTAR SIESTAS ────────────────────────────────────────────────────────
export async function wakeAllSiestas() {
  const students   = AppState.get('students') || [];
  const logsMap    = AppState.get('logsMap') || {};
  const classroom  = AppState.get('classroom');
  const today      = new Date().toISOString().split('T')[0];
  const active     = _getActiveSiestas(students, logsMap);
  if (!active.length) return;

  try {
    const now = new Date().toISOString();
    await Promise.all(active.map(s => {
      const log    = logsMap[s.id];
      const events = [...(log.events || [])];
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'siesta' && events[i].open) {
          const mins = Math.round((new Date(now) - new Date(events[i].created_at)) / 60000);
          events[i] = { ...events[i], open: false, end_at: now, duration_min: mins };
          break;
        }
      }
      return MaestraApi.upsertDailyLog({ student_id: s.id, classroom_id: classroom.id, date: today, events, nap: 'si' });
    }));
    await _logTimelineEvent(classroom, 'siesta', active.map(s => s.id), { metadata: { action: 'wake_all' } });
    safeToast(`${active.length} siesta${active.length > 1 ? 's' : ''} cerrada${active.length > 1 ? 's' : ''}`);
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
    const banner = document.querySelector('#routineWrapper [class*="border-purple-200"]');
    if (banner) banner.remove();
  } catch(e) { safeToast('Error al cerrar siestas', 'error'); }
}

// ── MODAL INDIVIDUAL ESTUDIANTE (NIVEL 4) ────────────────────────────────────
export async function openStudentRoutine(studentId) {
  const student = AppState.get('students').find(s => s.id == studentId);
  if (!student) return;
  const today = new Date().toISOString().split('T')[0];
  const { data: log } = await supabase.from('daily_logs').select('*').eq('student_id', studentId).eq('date', today).maybeSingle();
  const isInfant = student.age_type === 'meses' || student.age_type === 'mes';
  const modalId  = 'routineStudentModal';
  const content  = isInfant ? _renderInfantRoutineUI(student, log, modalId) : _renderStandardRoutineUI(student, log, modalId);
  Modal.open(modalId, content);
  if (window.lucide) window.lucide.createIcons();
}

// ── MODAL INDIVIDUAL: ESTÁNDAR (NIVEL 4) ─────────────────────────────────────
function _renderStandardRoutineUI(student, log, modalId) {
  const isValid      = log && _isWithin12h(log.created_at);
  const currentMood  = isValid ? (log.mood  || '') : '';
  const currentFood  = isValid ? (log.food  || '') : '';
  const currentSleep = isValid ? (log.nap   || '') : '';
  const currentNotes = isValid ? (log.notes || '') : '';
  const events       = isValid ? (log.events || []) : [];

  const moodEmojiMap = {};
  MOOD_OPTIONS.forEach(m => { moodEmojiMap[m.value] = m.icon; });

  const foodOptions = [
    { value: 'nada',  icon: '🙅', label: 'No comió' },
    { value: 'poco',  icon: '🍲', label: 'Poco' },
    { value: 'half',  icon: '🥣', label: 'Mitad' },
    { value: 'all',   icon: '🍽️', label: 'Todo' },
  ];

  const timelineHTML = events.length ? events.map(ev => {
    const meta = EVENT_TYPES[ev.type] || { icon: '📋', label: ev.type };
    const extraType = EXTRA_EVENT_TYPES.find(e => e.type === ev.type);
    const icon = extraType ? extraType.icon : meta.icon;
    const label = extraType ? extraType.label : meta.label;
    let detail = '';
    if (ev.type === 'biberon') { const p = []; if (ev.oz) p.push(`${ev.oz} oz`); if (ev.milk_temp) p.push(ev.milk_temp); detail = p.join(' · '); }
    if (ev.type === 'temperatura') detail = ev.temp ? `${ev.temp}°C ${parseFloat(ev.temp) >= 37.5 ? '🔥' : ''}` : '';
    if (ev.type === 'medicamento') detail = [ev.nombre, ev.dosis, ev.autorizacion].filter(Boolean).join(' · ');
    if (ev.type === 'siesta') detail = ev.duration_min ? `${ev.duration_min} min` : (ev.open ? 'En curso...' : '');
    if (ev.type === 'nota') detail = ev.texto ? (ev.texto.length > 40 ? ev.texto.substring(0,40)+'…' : ev.texto) : '';
    if (ev.type === 'fiebre') detail = ev.temp ? `${ev.temp}°C` : '';
    if (ev.type === 'medicamento_extra') detail = [ev.nombre, ev.dosis].filter(Boolean).join(' · ');
    if (ev.type === 'llamada_padres') detail = ev.motivo || '';

    return `
      <div class="flex items-start gap-3 group">
        <div class="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-sm shrink-0 group-hover:scale-110 transition-transform">${icon}</div>
        <div class="flex-1 min-w-0">
          <p class="text-[10px] font-black text-slate-400">${_formatTime(ev.created_at)}</p>
          <p class="text-xs font-bold text-slate-700">${label}${detail ? ` · ${detail}` : ''}</p>
        </div>
      </div>`;
  }).join('') : '<p class="text-xs text-slate-400 italic">Sin eventos registrados hoy.</p>';

  const activeSiesta = events.find(e => e.type === 'siesta' && e.open);
  const siestaSection = activeSiesta ? (() => {
    const elapsed = Math.round((Date.now() - new Date(activeSiesta.created_at)) / 60000);
    return `
      <div class="p-4 bg-purple-50 border-2 border-purple-200 rounded-2xl flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="text-2xl animate-pulse">😴</span>
          <div>
            <p class="text-xs font-black text-purple-800">Durmiendo ahora</p>
            <p class="text-[10px] font-bold text-purple-600">Desde ${_formatTime(activeSiesta.created_at)} · ${elapsed}min</p>
          </div>
        </div>
        <button onclick="App.wakeStudentSiesta('${student.id}')"
          class="px-3 py-2 bg-purple-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-purple-700 active:scale-90 transition-all shrink-0 shadow-md shadow-purple-200">
          ☀️ Despertó
        </button>
      </div>`;
  })() : `
    <div class="grid grid-cols-2 gap-2">
      ${Object.entries({si:'💤',no:'☀️'}).map(([v,e]) => `
        <button onclick="App.updateRoutineFieldInModal('${student.id}','sleep','${v}')"
          class="routine-modal-sleep-${student.id} flex items-center justify-center gap-3 p-4 rounded-2xl border-2 transition-all active:scale-90 ${currentSleep===v ? 'border-indigo-400 bg-indigo-50 shadow-md' : 'border-slate-100 bg-slate-50'}" data-val="${v}">
          <span class="text-2xl">${e}</span>
          <span class="text-xs font-black uppercase text-slate-600">${v==='si' ? 'Durmió' : 'No durmió'}</span>
        </button>`).join('')}
    </div>`;

  return `
    <div class="bg-white w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col" style="max-height:min(95vh, calc(100vh - 32px));">
      <!-- Header con gradiente -->
      <div class="p-5 text-white relative overflow-hidden shrink-0" style="background:linear-gradient(135deg, #FF8A00 0%, #f97316 40%, #ec4899 100%);">
        <div class="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl" style="background:rgba(255,255,255,0.1);"></div>
        <div class="absolute -bottom-10 -left-10 w-32 h-32 rounded-full blur-2xl" style="background:rgba(255,255,255,0.1);"></div>
        <button onclick="Modal.close('${modalId}')" class="absolute top-4 right-4 p-2.5 rounded-full hover:bg-white/30 transition-colors border border-white/20 z-10" style="background:rgba(255,255,255,0.2);backdrop-filter:blur(4px);">
          <svg class="w-4 h-4" fill="none" stroke="white" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
        <div class="relative flex items-center gap-4">
          <div class="w-14 h-14 rounded-2xl overflow-hidden flex items-center justify-center font-black text-2xl shrink-0 shadow-lg" style="background:rgba(255,255,255,0.2);backdrop-filter:blur(4px);border:2px solid rgba(255,255,255,0.3);color:white;">
            ${student.avatar_url ? `<img src="${student.avatar_url}" class="w-full h-full object-cover" style="color:transparent;">` : `<span style="color:white;">${student.name.charAt(0)}</span>`}
          </div>
          <div>
            <h3 class="text-lg font-black" style="color:white !important;text-shadow:0 1px 3px rgba(0,0,0,0.15);">${safeEscapeHTML(student.name)}</h3>
            <p class="text-[10px] font-bold uppercase tracking-widest" style="color:rgba(255,255,255,0.85);">Reporte de Rutina</p>
          </div>
        </div>
      </div>

      <div class="p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar" style="-webkit-overflow-scrolling:touch;">

        <!-- Estado Emocional -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Estado Emocional</label>
          <div class="grid grid-cols-4 gap-1.5">
            ${MOOD_OPTIONS.map(m => `
              <button onclick="App.updateRoutineFieldInModal('${student.id}','mood','${m.value}')"
                class="routine-modal-mood-${student.id} flex flex-col items-center p-2 rounded-2xl border-2 transition-all active:scale-90 ${currentMood===m.value ? 'border-[#FF8A00] bg-orange-50 shadow-md' : 'border-slate-100 bg-slate-50 hover:border-orange-200'}" data-val="${m.value}">
                <span class="text-lg">${m.icon}</span>
                <span class="text-[7px] font-black uppercase text-slate-500 leading-tight text-center mt-0.5">${m.label}</span>
              </button>`).join('')}
          </div>
        </div>

        <!-- Alimentación -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Alimentación</label>
          <div class="grid grid-cols-4 gap-2">
            ${foodOptions.map(f => `
              <button onclick="App.updateRoutineFieldInModal('${student.id}','food','${f.value}')"
                class="routine-modal-food-${student.id} flex flex-col items-center p-2.5 rounded-2xl border-2 transition-all active:scale-90 ${currentFood===f.value ? 'border-[#28B54D] bg-green-50 shadow-md' : 'border-slate-100 bg-slate-50 hover:border-green-200'}" data-val="${f.value}">
                <span class="text-lg">${f.icon}</span>
                <span class="text-[8px] font-black uppercase text-slate-500 leading-tight text-center">${f.label}</span>
              </button>`).join('')}
          </div>
        </div>

        <!-- Siesta -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Siesta</label>
          ${siestaSection}
        </div>

        <!-- Biberón -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Biberón</label>
          <div class="bg-blue-50/50 border border-blue-100 rounded-2xl p-3 space-y-2">
            <div class="grid grid-cols-4 gap-2">
              ${[2,4,6,8].map(oz => `
                <button onclick="App.registerIndividualEvent('${student.id}','biberon',{oz:${oz}}); App.safeToast('${oz}oz registrado ✓');"
                  class="py-2.5 bg-blue-50 border-2 border-blue-200 rounded-2xl font-black text-sm text-blue-700 hover:bg-blue-100 transition-all active:scale-90">
                  ${oz}<span class="text-[9px]">oz</span>
                </button>`).join('')}
            </div>
            <div class="grid grid-cols-4 gap-2">
              ${['Fría','Natural','Tibia','Caliente'].map(t => `
                <button onclick="this.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('bg-sky-500','text-white','border-sky-500')); this.classList.add('bg-sky-500','text-white','border-sky-500');"
                  class="py-2 bg-sky-50 border-2 border-sky-200 rounded-2xl font-black text-[10px] text-sky-700 hover:bg-sky-100 transition-all active:scale-90 uppercase">
                  ${t}
                </button>`).join('')}
            </div>
          </div>
        </div>

        <!-- Temperatura -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Temperatura</label>
          <div class="grid grid-cols-4 gap-2">
            ${[36.4,36.6,36.8,37.0,37.2,37.5,37.8,38.0].map(t => {
              const fiebre = t >= 37.5;
              return `<button type="button" data-ind-temp-${student.id}="${t}"
                onclick="document.querySelectorAll('[data-ind-temp-${student.id}]').forEach(b=>{b.classList.remove('bg-rose-500','bg-blue-500','text-white','border-rose-500','border-blue-400'); b.classList.add('bg-slate-50','border-slate-100');}); this.classList.remove('bg-slate-50','border-slate-100'); this.classList.add('${fiebre ? 'bg-rose-500' : 'bg-blue-500'}','${fiebre ? 'border-rose-500' : 'border-blue-400'}','text-white'); App.registerIndividualEvent('${student.id}','temperatura',{temp:${t}});"
                class="py-2.5 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs ${fiebre ? 'text-rose-600' : 'text-slate-600'} hover:bg-slate-100 transition-all active:scale-90 relative">
                ${t}°${fiebre ? '<span class="absolute -top-1 -right-1 text-[8px]">🔥</span>' : ''}
              </button>`;
            }).join('')}
          </div>
        </div>

        <!-- Medicamentos -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Medicamentos</label>
          <div class="bg-purple-50/50 border border-purple-100 rounded-2xl p-3 space-y-2">
            <div class="grid grid-cols-2 gap-2">
              <input id="ind-med-nombre-${student.id}" type="text" placeholder="Nombre" class="p-2.5 bg-white border-2 border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-purple-400 transition-all">
              <input id="ind-med-dosis-${student.id}" type="text" placeholder="Dosis" class="p-2.5 bg-white border-2 border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-purple-400 transition-all">
            </div>
            <input id="ind-med-auth-${student.id}" type="text" placeholder="Autorización (opcional)" class="w-full p-2.5 bg-white border-2 border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-purple-400 transition-all">
            <button onclick="App.registerIndividualEvent('${student.id}','medicamento',{nombre:document.getElementById('ind-med-nombre-${student.id}')?.value.trim(),dosis:document.getElementById('ind-med-dosis-${student.id}')?.value.trim(),autorizacion:document.getElementById('ind-med-auth-${student.id}')?.value.trim()}); ['ind-med-nombre-${student.id}','ind-med-dosis-${student.id}','ind-med-auth-${student.id}'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});"
              class="w-full py-2 bg-purple-50 border-2 border-purple-200 rounded-xl text-[10px] font-black text-purple-700 hover:bg-purple-100 transition-all active:scale-95 uppercase tracking-widest">
              💊 Registrar medicamento
            </button>
          </div>
        </div>

        <!-- Eventos Rápidos -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Eventos del día</label>
          <div class="grid grid-cols-4 gap-2">
            ${[
              {type:'desayuno', icon:'🥐', label:'Desayuno'},
              {type:'almuerzo', icon:'🍽️', label:'Almuerzo'},
              {type:'merienda', icon:'🍎', label:'Merienda'},
              {type:'panal_humedo', icon:'💧', label:'Pañal'},
              {type:'panal_sucio',  icon:'💩', label:'Sucio'},
              {type:'bano',        icon:'🚽', label:'Baño'},
              {type:'lavado_manos', icon:'🧼', label:'Lavado'},
              {type:'cepillado',   icon:'🪥', label:'Cepillado'},
            ].map(ev => `
              <button onclick="App.registerIndividualEvent('${student.id}','${ev.type}',{})"
                class="flex flex-col items-center gap-1 p-2.5 bg-slate-50 hover:bg-slate-100 border-2 border-transparent hover:border-slate-200 rounded-xl transition-all active:scale-90">
                <span class="text-xl">${ev.icon}</span>
                <span class="text-[8px] font-black text-slate-400 uppercase leading-tight text-center">${ev.label}</span>
              </button>`).join('')}
          </div>
        </div>

        <!-- Eventos Extra -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Agregar Evento</label>
          <div class="grid grid-cols-3 gap-2">
            ${EXTRA_EVENT_TYPES.map(ev => `
              <button onclick="App.openExtraEventModal('${student.id}','${ev.type}','${ev.icon}','${ev.label}')"
                class="flex flex-col items-center gap-1 p-2.5 bg-slate-50 hover:bg-rose-50 border-2 border-transparent hover:border-rose-200 rounded-xl transition-all active:scale-90">
                <span class="text-lg">${ev.icon}</span>
                <span class="text-[8px] font-black text-slate-400 uppercase leading-tight text-center">${ev.label}</span>
              </button>`).join('')}
          </div>
        </div>

        <!-- Observaciones -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Observaciones</label>
          <textarea id="modal-note-${student.id}" rows="3"
            class="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium outline-none focus:border-[#FF8A00] transition-all resize-none"
            placeholder="Escribe aquí...">${safeEscapeHTML(currentNotes)}</textarea>
        </div>

        <!-- Timeline individual -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Registro del día</label>
          <div class="space-y-3 max-h-64 overflow-y-auto pr-1" id="ind-timeline-${student.id}">${timelineHTML}</div>
        </div>
      </div>

      <div class="p-4 shrink-0" style="background:#f8fafc;border-top:1px solid #e2e8f0;">
        <button onclick="App.saveRoutineInModal('${student.id}')" id="btnSaveModalRoutine"
          class="w-full py-4 text-white rounded-2xl font-black text-sm uppercase tracking-widest active:scale-[0.98] transition-colors flex items-center justify-center gap-2" style="background:#198754 !important;border:2px solid #146C43 !important;box-shadow:0 6px 20px rgba(25,135,84,0.45);opacity:1 !important;">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Guardar y Cerrar
        </button>
      </div>
    </div>`;
}

// ── MODAL EVENTO EXTRA ────────────────────────────────────────────────────────
export function openExtraEventModal(studentId, eventType, icon, label) {
  const modalId = 'extraEventModal';
  let extraFields = '';

  if (eventType === 'fiebre') {
    extraFields = `<div class="space-y-2">
      <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Temperatura</p>
      <input id="extraTemp" type="number" step="0.1" min="35" max="42" placeholder="37.5"
        class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-rose-400 transition-all">
    </div>`;
  } else if (eventType === 'medicamento_extra') {
    extraFields = `<div class="grid grid-cols-2 gap-2">
      <div class="space-y-1">
        <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Nombre</p>
        <input id="extraMedName" type="text" placeholder="Ej: Paracetamol" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-purple-400 transition-all">
      </div>
      <div class="space-y-1">
        <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Dosis</p>
        <input id="extraMedDosis" type="text" placeholder="Ej: 5ml" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-purple-400 transition-all">
      </div>
    </div>`;
  } else if (eventType === 'llamada_padres') {
    extraFields = `<div class="space-y-2">
      <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Motivo</p>
      <input id="extraMotivo" type="text" placeholder="Ej: Fiebre, golpe..." class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-blue-400 transition-all">
    </div>`;
  }

  const content = `
    <div class="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden animate-fadeIn">
      <div class="p-5 text-white relative overflow-hidden" style="background:linear-gradient(135deg, #e11d48 0%, #db2777 100%);">
        <div class="absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl" style="background:rgba(255,255,255,0.1);"></div>
        <div class="relative flex items-center gap-4">
          <div class="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center text-2xl border border-white/20 shadow-lg">${icon}</div>
          <div>
            <h3 class="text-lg font-black">${label}</h3>
            <p class="text-xs font-bold text-pink-100 uppercase tracking-widest">Evento especial</p>
          </div>
          <button onclick="Modal.close('${modalId}')" class="ml-auto p-2.5 bg-white/20 backdrop-blur-sm rounded-full hover:bg-white/30 transition-colors border border-white/20">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="p-5 space-y-4">
        <p class="text-xs text-slate-500 text-center">Hora: <span class="font-black text-slate-800">${new Date().toLocaleTimeString('es-ES', {hour:'2-digit',minute:'2-digit'})}</span></p>
        ${extraFields}
        <div class="space-y-2">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Observaciones</p>
          <textarea id="extraObs" rows="2" placeholder="Detalles..." class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium outline-none focus:border-rose-400 transition-all resize-none"></textarea>
        </div>
        <button onclick="App.confirmExtraEvent('${studentId}','${eventType}')"
          class="w-full py-3.5 text-white rounded-2xl font-black text-sm uppercase tracking-widest active:scale-[0.98] transition-colors shadow-lg flex items-center justify-center gap-2" style="background:#E11D48 !important;border:2px solid #BE123C !important;box-shadow:0 6px 20px rgba(225,29,72,0.4);opacity:1 !important;">
          Registrar Evento
        </button>
      </div>
    </div>`;
  Modal.open(modalId, content);
  if (window.lucide) window.lucide.createIcons();
}

export async function confirmExtraEvent(studentId, eventType) {
  const extra = { obs: document.getElementById('extraObs')?.value.trim() || '' };
  if (eventType === 'fiebre') extra.temp = parseFloat(document.getElementById('extraTemp')?.value) || null;
  else if (eventType === 'medicamento_extra') { extra.nombre = document.getElementById('extraMedName')?.value.trim() || ''; extra.dosis = document.getElementById('extraMedDosis')?.value.trim() || ''; }
  else if (eventType === 'llamada_padres') extra.motivo = document.getElementById('extraMotivo')?.value.trim() || '';

  await registerIndividualEvent(studentId, eventType, extra);
  Modal.close('extraEventModal');
}

// ── MODAL INDIVIDUAL: BEBÉ ────────────────────────────────────────────────────
function _renderInfantRoutineUI(student, log, modalId) {
  const infantData = log?.events || log?.infant_data || [];
  const lastEntry  = infantData.length ? infantData[infantData.length - 1] : null;
  const now        = new Date();
  const currentHourStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  const timeOptions = [];
  for (let h = 7; h <= 18; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = h > 12 ? h - 12 : h;
      const ampm = h >= 12 ? 'PM' : 'AM';
      timeOptions.push(`${hh}:${String(m).padStart(2,'0')} ${ampm}`);
    }
  }
  const activities = ['Sensorial','Motricidad','Música','Lectura','Juego libre','Estimulación temprana','Arte'];

  return `
    <div class="bg-white w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col" style="max-height:min(95vh, calc(100vh - 32px));">
      <div class="p-5 text-white relative overflow-hidden" style="background:linear-gradient(135deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%);">
        <div class="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl" style="background:rgba(255,255,255,0.1);"></div>
        <button onclick="Modal.close('${modalId}')" class="absolute top-4 right-4 p-2.5 rounded-full hover:bg-white/30 border border-white/20 z-10" style="background:rgba(255,255,255,0.2);backdrop-filter:blur(4px);">
          <i data-lucide="x" class="w-4 h-4" style="color:white;"></i>
        </button>
        <div class="relative flex items-center gap-4">
          <div class="w-14 h-14 rounded-2xl overflow-hidden flex items-center justify-center font-black text-2xl shrink-0 shadow-lg" style="background:rgba(255,255,255,0.2);backdrop-filter:blur(4px);border:2px solid rgba(255,255,255,0.3);color:white;">
            ${student.avatar_url ? `<img src="${student.avatar_url}" class="w-full h-full object-cover" style="color:transparent;">` : `<span style="color:white;">${student.name.charAt(0)}</span>`}
          </div>
          <div>
            <h3 class="text-lg font-black" style="color:white !important;text-shadow:0 1px 3px rgba(0,0,0,0.15);">${safeEscapeHTML(student.name)}</h3>
            <p class="text-[10px] font-bold uppercase tracking-widest" style="color:rgba(255,255,255,0.85);">Registro del Bebé 🍼</p>
          </div>
        </div>
      </div>
      <div class="p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar" style="background:rgba(248,250,252,0.5);-webkit-overflow-scrolling:touch;">
        <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Hora</label>
          <select id="infantTime" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-blue-400">
            ${timeOptions.map(t => `<option ${t === currentHourStr ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Leche (Onzas)</label>
          <div class="flex items-center gap-3">
            <input type="number" id="infantMilk" min="0" max="12" step="0.5" placeholder="0" class="flex-1 p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-lg outline-none focus:border-blue-400">
            <span class="font-black text-slate-400 text-[11px] uppercase">oz</span>
          </div>
          <div class="grid grid-cols-4 gap-2 mt-2">
            ${['Fría','Natural','Tibia','Caliente'].map(t => `
              <button type="button" onclick="this.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('bg-sky-500','text-white','border-sky-500')); this.classList.add('bg-sky-500','text-white','border-sky-500');"
                class="py-1.5 bg-sky-50 border-2 border-sky-200 rounded-xl font-black text-[9px] text-sky-700 hover:bg-sky-100 transition-all active:scale-90 uppercase">
                ${t}
              </button>`).join('')}
          </div>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Alimentación</label>
          <div class="grid grid-cols-2 gap-2">
            ${[{id:'none',label:'No comió',e:'🙅'},{id:'little',label:'Poco',e:'🍲'},{id:'half',label:'La mitad',e:'🥣'},{id:'all',label:'Todo',e:'🍽️'}].map(f => `
              <label class="flex items-center gap-2 p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl cursor-pointer hover:bg-blue-50 transition-all">
                <input type="radio" name="infantFood" value="${f.id}" class="accent-blue-500">
                <span class="text-lg">${f.e}</span>
                <span class="text-xs font-bold text-slate-600">${f.label}</span>
              </label>`).join('')}
          </div>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Actividades</label>
          <div class="flex flex-wrap gap-2">
            ${activities.map(a => `
              <label class="cursor-pointer">
                <input type="checkbox" name="infantActivity" value="${a}" class="hidden peer">
                <span class="block px-3 py-1.5 bg-slate-50 border-2 border-slate-100 rounded-xl text-[11px] font-bold text-slate-500 peer-checked:bg-indigo-50 peer-checked:border-indigo-400 peer-checked:text-indigo-700 transition-all">
                  ${a}
                </span>
              </label>`).join('')}
          </div>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Observación</label>
          <textarea id="infantNotes" rows="2" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium outline-none focus:border-blue-400 resize-none" placeholder="Anota algo importante..."></textarea>
        </div>
        ${lastEntry ? `
        <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Último registro</p>
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center text-lg">🍼</div>
            <div>
              <p class="text-[10px] font-black text-slate-400 uppercase">${_formatTime(lastEntry.created_at)}</p>
              <p class="text-xs font-bold text-slate-700">${lastEntry.comment || 'Registro de rutina'}</p>
            </div>
          </div>
        </div>` : ''}
      </div>
      <div class="p-4 shrink-0" style="background:#f8fafc;border-top:1px solid #e2e8f0;">
        <button onclick="App.saveInfantEntry('${student.id}')" id="btnSaveInfant"
          class="w-full py-4 text-white rounded-2xl font-black text-sm uppercase tracking-widest active:scale-[0.98] transition-colors flex items-center justify-center gap-2" style="background:#2563EB !important;border:2px solid #1D4ED8 !important;box-shadow:0 6px 20px rgba(37,99,235,0.45);opacity:1 !important;">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Guardar Registro
        </button>
      </div>
    </div>`;
}

// ── GUARDAR BEBÉ ──────────────────────────────────────────────────────────────
export async function saveInfantEntry(sid) {
  const btn = document.getElementById('btnSaveInfant');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i> Guardando...'; if (window.lucide) lucide.createIcons(); }
  try {
    const time = document.getElementById('infantTime').value;
    const milk = parseFloat(document.getElementById('infantMilk').value) || 0;
    const food = document.querySelector('input[name="infantFood"]:checked')?.value;
    const acts = [...document.querySelectorAll('input[name="infantActivity"]:checked')].map(c => c.value);
    const notes = document.getElementById('infantNotes').value.trim();
    const parts = [];
    if (milk > 0) parts.push(`Tomó ${milk} oz de leche.`);
    if (food) { const fm = {none:'No quiso comer.',little:'Comió poco.',half:'Comió la mitad.',all:'Comió todo.'}; parts.push(fm[food]); }
    if (acts.length) parts.push(`Actividades: ${acts.join(', ')}.`);
    if (notes) parts.push(notes);

    const classroom = AppState.get('classroom');
    const today     = new Date().toISOString().split('T')[0];
    const logsMap   = AppState.get('logsMap') || {};
    const currentLog = logsMap[sid] || {};
    const newEvent  = _makeEvent('biberon', { time, milk, food, activities: acts, notes, comment: parts.join(' ') });
    const newEvents = _addEventToLog(currentLog, newEvent);
    await MaestraApi.upsertDailyLog({ student_id: sid, classroom_id: classroom.id, date: today, events: newEvents });
    await _logTimelineEvent(classroom, 'biberon', [sid], { metadata: { milk, food } });
    safeToast('Registro guardado');
    Modal.close('routineStudentModal');
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
    _refreshReportCount();
  } catch (e) {
    safeToast('Error al guardar', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = 'Guardar Registro'; }
  }
}

// ── UPDATE CAMPO EN MODAL ─────────────────────────────────────────────────────
export function updateRoutineFieldInModal(sid, field, val) {
  const fieldMap = { mood: 'orange-400 bg-orange-50', food: '[#28B54D] bg-green-50', sleep: 'indigo-400 bg-indigo-50' };
  const target = field === 'sleep' ? 'sleep' : field;
  document.querySelectorAll(`.routine-modal-${target}-${sid}`).forEach(b => {
    b.className = b.className.replace(/border-[\w\[\]#]+ bg-\w+-\d+ shadow-md/g, '');
    b.classList.add('border-slate-100', 'bg-slate-50');
    b.classList.remove('shadow-md');
    if (b.dataset.val === val) {
      b.classList.remove('border-slate-100', 'bg-slate-50');
      const cls = fieldMap[field]?.split(' ') || [];
      cls.forEach(c => {
        if (c.startsWith('bg-')) b.classList.add(c);
        else b.classList.add(`border-${c}`);
      });
      b.classList.add('shadow-md');
    }
  });
  updateRoutineField(sid, field, val);
}

export async function saveRoutineInModal(sid) {
  const note  = document.getElementById(`modal-note-${sid}`)?.value.trim();
  const mood  = document.querySelector(`.routine-modal-mood-${sid}.border-\\[\\#FF8A00\\]`)?.dataset.val
             || document.querySelector(`.routine-modal-mood-${sid}.border-orange-400`)?.dataset.val;
  const food  = document.querySelector(`.routine-modal-food-${sid}.border-\\[\\#28B54D\\]`)?.dataset.val
             || document.querySelector(`.routine-modal-food-${sid}.border-emerald-400`)?.dataset.val;
  const sleep = document.querySelector(`.routine-modal-sleep-${sid}.border-indigo-400`)?.dataset.val;
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  try {
    await MaestraApi.upsertDailyLog({ student_id: sid, classroom_id: classroom.id, date: today, mood, food, nap: sleep, notes: note });
    Modal.close('routineStudentModal');
    safeToast('Reporte guardado');
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
    _refreshReportCount();
  } catch (e) { safeToast('Error al guardar', 'error'); }
}

export async function wakeStudentSiesta(studentId) {
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  const logsMap   = AppState.get('logsMap') || {};
  const log       = logsMap[studentId] || {};
  const events    = [...(log.events || [])];
  const now       = new Date().toISOString();
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'siesta' && events[i].open) {
      const mins = Math.round((new Date(now) - new Date(events[i].created_at)) / 60000);
      events[i] = { ...events[i], open: false, end_at: now, duration_min: mins };
      break;
    }
  }
  try {
    await MaestraApi.upsertDailyLog({ student_id: studentId, classroom_id: classroom.id, date: today, events, nap: 'si' });
    await _logTimelineEvent(classroom, 'siesta', [studentId], { metadata: { action: 'wake' } });
    safeToast('Siesta cerrada');
    Modal.close('routineStudentModal');
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
  } catch (e) { safeToast('Error al cerrar siesta', 'error'); }
}

// ── PUBLICAR ──────────────────────────────────────────────────────────────────
export async function publishAll() {
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  const { data: drafts } = await supabase.from('daily_logs').select('id').eq('classroom_id', classroom.id).eq('date', today).eq('status', 'draft');
  if (!drafts?.length) { safeToast('No hay borradores para publicar'); return; }
  if (!confirm(`¿Publicar ${drafts.length} reporte${drafts.length > 1 ? 's' : ''}?`)) return;
  try {
    await MaestraApi.publishDailyLogs(drafts.map(d => d.id));
    safeToast('Reportes publicados', 'success');
    document.getElementById('btnPublishAll')?.classList.add('hidden');
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
  } catch (e) { safeToast('Error al publicar', 'error'); }
}

export async function updateRoutineField(studentId, field, value) {
  await saveRoutineLog(studentId, field, value);
}

export async function saveRoutineLog(studentId, field = 'notes', value = null) {
  const key = studentId + field;
  if (_saving[key]) return;
  _saving[key] = true;
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  const fieldMap  = { mood: 'mood', food: 'food', sleep: 'nap', notes: 'notes' };
  const dbField   = fieldMap[field] || field;
  try {
    await MaestraApi.upsertDailyLog({ student_id: studentId, classroom_id: classroom.id, date: today, [dbField]: value });
  } catch (_) { safeToast('Error al guardar', 'error'); }
  finally { _saving[key] = false; }
}

export async function registerIndividualEvent(sid, type, extra = {}) {
  if (!_isStudentPresent(sid)) {
    const proceed = confirm('Este estudiante no está marcado como presente. ¿Registrar evento de todos modos?\n\nSolo se recomienda registrar eventos para estudiantes presentes.');
    if (!proceed) return;
  }
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  const logsMap   = AppState.get('logsMap') || {};
  const currentLog = logsMap[sid] || {};
  let newEvents = [...(currentLog.events || [])];
  if (type === 'siesta') {
    newEvents = _addEventToLog(currentLog, _makeEvent('siesta', { open: true }));
  } else {
    newEvents = _addEventToLog(currentLog, _makeEvent(type, extra));
  }
  const payload = { student_id: sid, classroom_id: classroom.id, date: today, events: newEvents };
  try {
    await MaestraApi.upsertDailyLog(payload);
    await _logTimelineEvent(classroom, type, [sid], { metadata: extra });
    const meta = EVENT_TYPES[type] || { icon: '📋', label: type };
    const extraType = EXTRA_EVENT_TYPES.find(e => e.type === type);
    const icon = extraType ? extraType.icon : meta.icon;
    const label = extraType ? extraType.label : meta.label;
    let detail = '';
    if (type === 'temperatura' && extra.temp) detail = ` · ${extra.temp}°C${parseFloat(extra.temp) >= 37.5 ? ' 🔥' : ''}`;
    if (type === 'biberon' && extra.oz) detail = ` · ${extra.oz}oz`;
    if (type === 'medicamento') detail = [extra.nombre, extra.dosis].filter(Boolean).join(' · ');
    if (type === 'fiebre' && extra.temp) detail = ` · ${extra.temp}°C`;
    if (type === 'medicamento_extra') detail = [extra.nombre, extra.dosis].filter(Boolean).join(' · ');
    safeToast(`${icon} ${label}${detail} registrado`);
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
    _refreshReportCount();
    const tlContainer = document.getElementById(`ind-timeline-${sid}`);
    if (tlContainer) {
      const updatedLog = (AppState.get('logsMap') || {})[sid] || {};
      const updatedEvents = (updatedLog.events || []);
      tlContainer.innerHTML = updatedEvents.length ? updatedEvents.map(ev => {
        const m = EVENT_TYPES[ev.type] || { icon: '📋', label: ev.type };
        const et = EXTRA_EVENT_TYPES.find(e => e.type === ev.type);
        const ico = et ? et.icon : m.icon;
        const lbl = et ? et.label : m.label;
        let d = '';
        if (ev.type === 'biberon') { const p = []; if (ev.oz) p.push(`${ev.oz} oz`); if (ev.milk_temp) p.push(ev.milk_temp); d = p.join(' · '); }
        if (ev.type === 'temperatura') d = ev.temp ? `${ev.temp}°C ${parseFloat(ev.temp) >= 37.5 ? '🔥' : ''}` : '';
        if (ev.type === 'medicamento') d = [ev.nombre, ev.dosis, ev.autorizacion].filter(Boolean).join(' · ');
        if (ev.type === 'siesta') d = ev.duration_min ? `${ev.duration_min} min` : (ev.open ? 'En curso...' : '');
        if (ev.type === 'fiebre') d = ev.temp ? `${ev.temp}°C` : '';
        if (ev.type === 'medicamento_extra') d = [ev.nombre, ev.dosis].filter(Boolean).join(' · ');
        if (ev.type === 'llamada_padres') d = ev.motivo || '';
        return `<div class="flex items-start gap-3"><div class="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-sm shrink-0">${ico}</div><div class="flex-1 min-w-0"><p class="text-[10px] font-black text-slate-400">${_formatTime(ev.created_at)}</p><p class="text-xs font-bold text-slate-700">${lbl}${d ? ` · ${d}` : ''}</p></div></div>`;
      }).join('') : '<p class="text-xs text-slate-400 italic">Sin eventos registrados hoy.</p>';
    }
  } catch (e) { safeToast('Error al registrar evento', 'error'); }
}
