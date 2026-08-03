/**
 * ============================================================
 * PANEL PADRE — ANÁLISIS DE RUTINA DIARIA V2
 * Transparencia analítica: date picker, timeline, resumen semanal/mensual
 * ============================================================
 */
import { supabase } from '../shared/supabase.js';
import { Api } from './api.js';
import { Helpers } from './helpers.js';
import { AppState } from './appState.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const EVENT_META = {
  biberon:           { icon: '🍼', label: 'Biberón'          },
  panal_humedo:      { icon: '💧', label: 'Pañal mojado'     },
  panal_sucio:       { icon: '💩', label: 'Pañal sucio'      },
  siesta:            { icon: '😴', label: 'Siesta'            },
  temperatura:       { icon: '🌡️', label: 'Temperatura'      },
  medicamento:       { icon: '💊', label: 'Medicamento'      },
  bano:              { icon: '🚽', label: 'Baño'              },
  animo:             { icon: '😊', label: 'Ánimo'             },
  desayuno:          { icon: '🥐', label: 'Desayuno'          },
  almuerzo:          { icon: '🍽️', label: 'Almuerzo'         },
  merienda:          { icon: '🍎', label: 'Merienda'          },
  nota:              { icon: '📝', label: 'Nota'               },
  milk:              { icon: '🍼', label: 'Biberón'           },
  structured_entry:  { icon: '📋', label: 'Registro'          },
  fiebre:            { icon: '🤒', label: 'Fiebre'            },
  accidente:         { icon: '🩹', label: 'Accidente'        },
  golpe:             { icon: '🤕', label: 'Golpe'             },
  llamada_padres:    { icon: '📞', label: 'Llamada a padres'  },
  medicamento_extra: { icon: '💊', label: 'Medicamento extra' },
  otro:              { icon: '📋', label: 'Otro evento'       },
  // Catálogo V8
  bienvenida:        { icon: '👋', label: 'Bienvenida'        },
  actividad:         { icon: '📚', label: 'Actividad'         },
  patio:             { icon: '🌳', label: 'Patio'             },
  cepillado:         { icon: '🪥', label: 'Cepillado'         },
  lavado_manos:      { icon: '🧼', label: 'Lavado de manos'   },
  agua:              { icon: '💧', label: 'Agua'              },
  fruta:             { icon: '🍌', label: 'Fruta'             },
  picada:            { icon: '🥪', label: 'Picada'            },
  descanso_corto:    { icon: '😪', label: 'Descanso breve'    },
  crema:             { icon: '🧴', label: 'Crema / Solar'     },
  manualidad:        { icon: '🎨', label: 'Manualidad'        },
  musica:            { icon: '🎵', label: 'Música'            },
  baile:             { icon: '💃', label: 'Baile'             },
  gimnasia:          { icon: '🤸', label: 'Gimnasia'          },
  juego_libre:       { icon: '🧸', label: 'Juego libre'       },
  juegos_mesa:       { icon: '🎲', label: 'Juegos de mesa'    },
  construccion:      { icon: '🧱', label: 'Bloques'           },
  convivencia:       { icon: '🤝', label: 'Convivencia'       },
  compartir:         { icon: '💬', label: 'Compartir'         },
  emociones:         { icon: '💛', label: 'Emociones'         },
  proyecto:          { icon: '🎯', label: 'Proyecto'          },
  lectura:           { icon: '📖', label: 'Cuento'            },
  escritura:         { icon: '✏️', label: 'Escritura'         },
  matematicas:       { icon: '🔢', label: 'Matemáticas'       },
  ciencias:          { icon: '🔬', label: 'Ciencias'          },
  idiomas:           { icon: '🗣️', label: 'Idiomas'           },
  paseo:             { icon: '🚶', label: 'Paseo'             },
  huerta:            { icon: '🌱', label: 'Huerta'            },
  juegos_agua:       { icon: '💦', label: 'Juegos de agua'    },
  malestar:          { icon: '🤢', label: 'Malestar'          },
  curacion:          { icon: '🩹', label: 'Curaciones'        },
  pelea:             { icon: '🤜', label: 'Pelea'             },
  otro_incidente:    { icon: '⚠️', label: 'Incidente'         },
  cumpleanos:        { icon: '🎂', label: 'Cumpleaños'        },
  evento_especial:   { icon: '🎉', label: 'Evento especial'   },
};

const MOOD_MAP  = { feliz:'😊 Contento/a', bien:'😊 Bien', normal:'😐 Normal', triste:'😢 Triste', inquieto:'😫 Inquieto/a', enojado:'😡 Molesto/a' };
const FOOD_MAP  = { todo:'Comió todo 🌟', poco:'Comió poco 🍲', nada:'No quiso comer 🙅', all:'Comió todo 🌟', half:'Comió la mitad 🥣', little:'Comió poco 🍲', none:'No quiso comer 🙅' };
const SLEEP_MAP = { si:'Durmió su siesta 💤', no:'No durmió ☀️' };

let _selectedDate   = _todayStr();
let _realtimeChannel = null;
let _scheduleChannel = null;

function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _formatDateLong(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

function _formatTime(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
}

function _minsToDuration(mins) {
  if (!mins || mins < 0) return '–';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`;
}

// ── INIT ──────────────────────────────────────────────────────────────────────
export async function initRoutinePanel(studentId) {
  const container = document.getElementById('routineSection');
  if (!container) return;
  _selectedDate = _todayStr();

  container.innerHTML = _renderSkeleton();

  await _loadAndRender(studentId, _selectedDate);
  _initRealtime(studentId);
}

async function _loadAndRender(studentId, date) {
  const container = document.getElementById('routineSection');
  if (!container) return;

  try {
    // Cargar log del día seleccionado y rango para analytics
    const today = _todayStr();
    const monthStart = date.substring(0, 8) + '01';
    const weekAgo    = (() => { const d = new Date(date); d.setDate(d.getDate() - 6); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();

    // Obtener classroom_id del estudiante actual para cargar el horario
    const student = AppState.get('currentStudent') || {};
    const classroomId = student?.classroom_id;

    const [log, weekLogs, rawSchedule] = await Promise.all([
      Api.getDailyLog(studentId, date),
      Api.getDailyLogsRange(studentId, monthStart < weekAgo ? weekAgo : monthStart, today),
      classroomId ? Api.getClassroomSchedule(classroomId).catch(() => []) : Promise.resolve([])
    ]);

    // Normalizar formato del horario (DB usa scheduled_hour/scheduled_minute, internamente usamos hour/minute)
    const schedule = (rawSchedule || []).map(s => ({
      type: s.event_type,
      label: s.event_label,
      icon: s.event_icon,
      hour: s.scheduled_hour,
      minute: s.scheduled_minute,
      duration: s.duration_minutes,
    }));

    container.innerHTML = _renderFullPanel(log, weekLogs || [], date, studentId, schedule);
    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="p-10 text-center text-rose-500 font-bold">Error al cargar el reporte. Intenta de nuevo.</div>`;
  }
}

function _initRealtime(studentId) {
  if (_realtimeChannel) { supabase.removeChannel(_realtimeChannel); }
  _realtimeChannel = supabase
    .channel('padre_routine_' + studentId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_logs', filter: `student_id=eq.${studentId}` }, () => {
      _loadAndRender(studentId, _selectedDate);
    })
    .subscribe();

  const student = AppState.get('currentStudent') || {};
  const classroomId = student?.classroom_id;
  if (classroomId) {
    if (_scheduleChannel) supabase.removeChannel(_scheduleChannel);
    _scheduleChannel = supabase
      .channel('padre_schedule_' + classroomId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classroom_event_schedule', filter: `classroom_id=eq.${classroomId}` }, () => {
        _loadAndRender(studentId, _selectedDate);
      })
      .subscribe();
  }
}

export function changeRoutineDate(studentId, delta) {
  const d = new Date(_selectedDate);
  d.setDate(d.getDate() + delta);
  const next = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if (next > _todayStr()) return; // No navegar al futuro
  _selectedDate = next;
  document.getElementById('routineSection').innerHTML = _renderSkeleton();
  _loadAndRender(studentId, _selectedDate);
}

export function selectRoutineDate(studentId, date) {
  if (!date || date > _todayStr()) return;
  _selectedDate = date;
  document.getElementById('routineSection').innerHTML = _renderSkeleton();
  _loadAndRender(studentId, _selectedDate);
}

function _renderSkeleton() {
  return `<div class="animate-pulse space-y-4 p-4">
    <div class="h-8 bg-green-50 rounded-2xl w-2/3"></div>
    <div class="h-32 bg-slate-100 rounded-[1.5rem]"></div>
    <div class="grid grid-cols-3 gap-3"><div class="h-20 bg-slate-100 rounded-[1.5rem]"></div><div class="h-20 bg-slate-100 rounded-[1.5rem]"></div><div class="h-20 bg-slate-100 rounded-[1.5rem]"></div></div>
    <div class="h-40 bg-slate-100 rounded-[1.5rem]"></div>
  </div>`;
}

// ── RENDER PANEL COMPLETO ────────────────────────────────────────────────────
function _renderFullPanel(log, weekLogs, date, studentId, schedule = []) {
  const events    = log ? (log.events || log.infant_data || []) : [];
  const lastUpdate = log?.created_at ? `Actualizado ${_formatTime(log.created_at)}` : '';
  const isToday   = date === _todayStr();
  const canGoNext = !isToday;

  // Calcular stats del día
  const totalNapMins  = _calcTotalNapMins(events);
  const totalOz       = _calcTotalOz(events, log);
  const wetDiapers    = events.filter(e => e.type === 'panal_humedo').length;
  const dirtyDiapers  = events.filter(e => e.type === 'panal_sucio').length;

  return `
  <div class="space-y-5 pb-10" id="routinePanelInner">

    <!-- DATE PICKER / NAVEGACIÓN -->
    <div class="bg-white rounded-[1.5rem] border border-green-100 shadow-sm p-4">
      <div class="flex items-center justify-between gap-3">
        <button onclick="window.RoutineModule?.changeRoutineDate('${studentId}', -1)"
          class="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center hover:bg-green-100 hover:text-[#28B54D] transition-all active:scale-90">
          <i data-lucide="chevron-left" class="w-5 h-5"></i>
        </button>
        <div class="flex-1 text-center">
          <p class="text-xs font-black text-[#28B54D] uppercase tracking-widest mb-0.5">
            ${isToday ? 'Hoy' : 'Historial'}
          </p>
          <h3 class="text-sm font-black text-slate-800 capitalize leading-tight">${_formatDateLong(date)}</h3>
          ${lastUpdate ? `<p class="text-[10px] text-slate-400 font-bold mt-0.5">${lastUpdate}</p>` : ''}
        </div>
        <button onclick="window.RoutineModule?.changeRoutineDate('${studentId}', 1)"
          class="w-10 h-10 rounded-xl flex items-center justify-center transition-all ${canGoNext ? 'bg-slate-100 hover:bg-green-100 hover:text-[#28B54D] active:scale-90' : 'bg-slate-50 text-slate-300 cursor-not-allowed'}">
          <i data-lucide="chevron-right" class="w-5 h-5"></i>
        </button>
      </div>
      <!-- Mini input de fecha -->
      <div class="mt-3 flex justify-center">
        <input type="date" max="${_todayStr()}" value="${date}"
          onchange="window.RoutineModule?.selectRoutineDate('${studentId}', this.value)"
          class="text-[11px] font-bold text-slate-500 border border-slate-200 rounded-xl px-3 py-1.5 outline-none focus:border-[#28B54D] bg-slate-50 cursor-pointer">
      </div>
    </div>

    ${!log ? _renderNoReport(isToday) : `

    <!-- 3 INDICADORES RÁPIDOS -->
    <div class="grid grid-cols-3 gap-3">
      ${_renderQuickIndicator('Ánimo', log.mood ? (MOOD_MAP[log.mood.toLowerCase()] || log.mood) : '–', 'bg-orange-50 border-orange-100')}
      ${_renderQuickIndicator('Comida', log.food ? (FOOD_MAP[log.food.toLowerCase()] || log.food) : '–', 'bg-green-50 border-green-100')}
      ${(() => {
        const siestaEvs = events.filter(e => e.type === 'siesta');
        const active = siestaEvs.find(e => e.open);
        if (active) return _renderQuickIndicator('Siesta', '😴 En curso', 'bg-purple-50 border-purple-200');
        if (totalNapMins > 0) return _renderQuickIndicator('Siesta', `💤 ${_minsToDuration(totalNapMins)}`, 'bg-indigo-50 border-indigo-100');
        if (log.nap) return _renderQuickIndicator('Siesta', SLEEP_MAP[log.nap.toLowerCase()] || log.nap, 'bg-indigo-50 border-indigo-100');
        return _renderQuickIndicator('Siesta', '–', 'bg-indigo-50 border-indigo-100');
      })()}
    </div>

    <!-- ESTADÍSTICAS ACUMULADAS -->
    ${_renderDayStats(totalNapMins, totalOz, wetDiapers, dirtyDiapers, events)}

    <!-- OBSERVACIONES DE LA MAESTRA -->
    ${log.notes ? `
    <div class="bg-gradient-to-br from-[#28B54D]/5 to-green-50 border border-green-200 rounded-[1.5rem] p-5">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-lg">✏️</span>
        <p class="text-[11px] font-black text-[#28B54D] uppercase tracking-widest">Nota de la maestra</p>
      </div>
      <p class="text-sm font-medium text-slate-700 italic leading-relaxed">&ldquo;${Helpers.escapeHTML ? Helpers.escapeHTML(log.notes) : log.notes}&rdquo;</p>
    </div>` : ''}

    <!-- TIMELINE DE EVENTOS -->
    ${_renderTimeline(events, schedule, date)}

    `}

    <!-- ANALYTICS SEMANAL/MENSUAL -->
    ${weekLogs.length ? _renderWeeklyAnalytics(weekLogs, log, date) : ''}
  </div>`;
}

function _renderNoReport(isToday) {
  return `
  <div class="bg-white rounded-[1.5rem] border border-slate-100 shadow-sm p-10 text-center">
    <span class="text-5xl block mb-4">${isToday ? '⏳' : '📭'}</span>
    <p class="text-sm font-black text-slate-500">${isToday ? 'El reporte de hoy aún no ha sido publicado.' : 'No hay reporte para este día.'}</p>
    ${isToday ? `<p class="text-xs text-slate-400 mt-1">La maestra lo publicará durante la jornada.</p>` : ''}
  </div>`;
}

function _renderQuickIndicator(title, value, colorCls) {
  return `
  <div class="bg-white border ${colorCls} rounded-[1.5rem] p-4 text-center shadow-sm">
    <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">${title}</p>
    <p class="text-xs font-black text-slate-700 leading-snug">${value}</p>
  </div>`;
}

function _renderDayStats(napMins, totalOz, wetDiapers, dirtyDiapers, events) {
  // Calcular hora que despertó (última siesta cerrada)
  const closedSiestas = (events || []).filter(e => e.type === 'siesta' && !e.open && e.end_at);
  const lastWake      = closedSiestas.length ? closedSiestas[closedSiestas.length - 1] : null;
  const lastSleepStart = (() => {
    const s = (events || []).filter(e => e.type === 'siesta');
    return s.length ? s[0] : null;
  })();

  const stats = [
    { icon: '😴', label: 'Sueño total',    value: napMins  > 0 ? _minsToDuration(napMins) : '–' },
    { icon: '🛌', label: 'Se durmió',      value: lastSleepStart ? _formatTime(lastSleepStart.created_at) : '–' },
    { icon: '☀️', label: 'Despertó',       value: lastWake ? _formatTime(lastWake.end_at) : (lastSleepStart?.open ? 'En curso' : '–') },
    { icon: '🍼', label: 'Leche total',    value: totalOz  > 0 ? `${totalOz} oz`          : '–' },
    { icon: '💧', label: 'Pañales 💧',     value: String(wetDiapers) },
    { icon: '💩', label: 'Pañales 💩',     value: String(dirtyDiapers) },
  ].filter(s => s.value !== '–' || ['Sueño total','Leche total'].includes(s.label));

  return `
  <div class="bg-white border border-slate-100 rounded-[1.5rem] shadow-sm p-5">
    <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Estadísticas del día</p>
    <div class="grid grid-cols-2 gap-3">
      ${stats.map(s => `
      <div class="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl">
        <span class="text-xl shrink-0">${s.icon}</span>
        <div>
          <p class="text-[9px] font-black text-slate-400 uppercase">${s.label}</p>
          <p class="text-sm font-black text-slate-800">${s.value}</p>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

// ── TIMELINE DE EVENTOS ───────────────────────────────────────────────────────
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

function _formatTime12(h, m) {
  const hh = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${hh}:${String(m).padStart(2,'0')} ${ampm}`;
}

function _renderTimeline(events, schedule = [], date = '') {
  const sched = schedule.length ? schedule : _DEFAULT_SCHEDULE;
  const isToday = date === _todayStr();
  const now = isToday ? new Date() : null;
  const nowMins = now ? now.getHours() * 60 + now.getMinutes() : -1;

  // Mapear eventos logueados por tipo para saber cuáles ya tienen registro
  const loggedByType = {};
  events.forEach(ev => {
    if (!loggedByType[ev.type]) loggedByType[ev.type] = [];
    loggedByType[ev.type].push(ev);
  });

  // Encontrar el slot activo (el más reciente que ya pasó o está pasando)
  let activeIdx = -1;
  if (isToday) {
    for (let i = sched.length - 1; i >= 0; i--) {
      const slotMins = sched[i].hour * 60 + sched[i].minute;
      if (nowMins >= slotMins) { activeIdx = i; break; }
    }
  }

  // Construir items del timeline combinando schedule + eventos extra
  const scheduleItems = sched.map((ev, i) => {
    const timeStr = _formatTime12(ev.hour, ev.minute);
    const endMins = ev.hour * 60 + ev.minute + (ev.duration || 30);
    const endTimeStr = _formatTime12(Math.floor(endMins / 60), endMins % 60);
    const isPast = i < activeIdx;
    const isActive = i === activeIdx;
    const isFuture = i > activeIdx;

    // Verificar si este tipo de evento tiene registros
    const evType = ev.type;
    const logged = loggedByType[evType] || [];
    const hasSchedMark = logged.some(e => e.scheduled_time);
    const hasLogged = hasSchedMark
      ? logged.some(e => (e.scheduled_time || '') === timeStr)
      : logged.length > 0;
    const detailLogged = hasSchedMark ? logged.filter(e => (e.scheduled_time || '') === timeStr) : logged;

    // Para biberón, también checar structured_entry y milk
    const hasMilkLogged = (loggedByType['biberon'] || []).length > 0 ||
                          (loggedByType['milk'] || []).length > 0 ||
                          (loggedByType['structured_entry'] || []).length > 0;

    const isLogged = evType === 'biberon' ? hasMilkLogged : hasLogged;

    // Icono del schedule o del EVENT_META
    const icon = ev.icon || EVENT_META[evType]?.icon || '⏰';

    // Construir detalle
    let detail = '';
    if (isLogged && evType === 'biberon') {
      const totalOz = (loggedByType['biberon'] || [])
        .concat(loggedByType['milk'] || [])
        .reduce((sum, e) => sum + parseFloat(e.oz || e.milk || e.value || 0), 0);
      detail = totalOz > 0 ? `${totalOz} oz` : '';
    } else if (isLogged && evType === 'siesta') {
      const siestaEvs = loggedByType['siesta'] || [];
      const totalMins = siestaEvs.reduce((sum, e) => sum + (e.duration_min || 0), 0);
      if (totalMins > 0) detail = _minsToDuration(totalMins);
    } else if (isLogged && detailLogged[0]) {
      // Tomar detalle del primer evento logueado de este tipo
      const firstEv = detailLogged[0];
      if (firstEv.comment) detail = firstEv.comment;
      else if (firstEv.value) detail = String(firstEv.value);
    }

    // Color/estilo según estado
    let statusBadge = '';
    if (isActive) {
      statusBadge = '<span class="px-2 py-0.5 bg-[#FF8A00] text-white text-[7px] font-black uppercase rounded-lg animate-pulse">AHORA</span>';
    } else if (isPast) {
      statusBadge = isLogged
        ? '<span class="px-2 py-0.5 bg-green-100 text-[#28B54D] text-[7px] font-black uppercase rounded-lg">✓ Hecho</span>'
        : '<span class="px-2 py-0.5 bg-slate-100 text-slate-400 text-[7px] font-black uppercase rounded-lg">—</span>';
    }

    const borderCls = isActive
      ? 'border-2 border-[#FF8A00]/30 bg-gradient-to-r from-[#FF8A00]/5 to-orange-50/50 shadow-sm'
      : isPast && isLogged
        ? 'border-2 border-green-100 bg-green-50/30'
        : 'border-2 border-transparent';

    return `
    <div class="relative flex items-start gap-4 p-3 rounded-2xl ${borderCls}">
      <div class="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 z-10 ${isActive ? 'shadow-md' : ''}"
        style="${isActive ? 'background:linear-gradient(135deg, #FF8A00, #f97316);color:white;box-shadow:0 4px 12px rgba(255,138,0,0.3);' : 'background:white;border:2px solid #f1f5f9;'}">
        ${icon}
      </div>
      <div class="flex-1 pb-1">
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-[11px] font-black ${isActive ? 'text-[#FF8A00]' : isPast ? 'text-slate-500' : 'text-slate-400'}">${timeStr}</span>
          ${statusBadge}
        </div>
        <p class="text-xs font-black ${isPast ? 'text-slate-600' : 'text-slate-700'} leading-tight">${ev.label}</p>
        <div class="flex items-center gap-2 mt-0.5">
          <span class="text-[9px] font-bold text-slate-300">${endTimeStr}</span>
          <span class="text-[9px] font-bold text-slate-300">·</span>
          <span class="text-[9px] font-bold text-slate-300">${ev.duration || 30}min</span>
        </div>
        ${detail ? `<p class="text-[10px] font-medium text-slate-500 mt-0.5 leading-snug">${detail}</p>` : ''}
      </div>
    </div>`;
  });

  // Eventos extra que no están en el schedule (fiebre, accidente, golpe, medicamento, nota, etc.)
  const scheduleTypes = new Set(sched.map(s => s.type));
  const extraEvents = events.filter(ev => !scheduleTypes.has(ev.type));

  const extraItems = extraEvents.map(ev => {
    const meta = EVENT_META[ev.type] || { icon: '📋', label: ev.type };
    let detail = '';
    let alertCls = '';

    if (ev.type === 'temperatura') {
      const temp = ev.temp;
      if (temp) {
        const isFever = parseFloat(temp) >= 37.5;
        detail = `${temp}°C`;
        alertCls = isFever ? 'bg-rose-50 border-rose-200' : '';
        if (isFever) detail += ' 🔥 Fiebre';
      }
    } else if (ev.type === 'medicamento') {
      detail = [ev.nombre, ev.dosis].filter(Boolean).join(' · ');
    } else if (ev.type === 'fiebre') {
      const temp = ev.temp;
      if (temp) { detail = `${temp}°C 🔥 Fiebre`; alertCls = 'bg-rose-50 border-rose-200'; }
    } else if (ev.type === 'accidente') {
      detail = ev.descripcion || ev.comment || '';
      alertCls = 'bg-rose-50 border-rose-200';
    } else if (ev.type === 'golpe') {
      detail = ev.descripcion || ev.comment || '';
      alertCls = 'bg-rose-50 border-rose-200';
    } else if (ev.type === 'llamada_padres') {
      detail = ev.motivo || ev.comment || 'La maestra llamó';
      alertCls = 'bg-amber-50 border-amber-200';
    } else if (ev.type === 'medicamento_extra') {
      detail = [ev.nombre, ev.dosis, ev.obs].filter(Boolean).join(' · ');
    } else if (ev.type === 'nota' || ev.type === 'note') {
      detail = ev.texto || ev.value || ev.comment || '';
    } else if (ev.comment) {
      detail = ev.comment;
    }

    return `
    <div class="relative flex items-start gap-4 p-3 rounded-2xl border-2 ${alertCls || 'border-transparent'}">
      <div class="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 z-10" style="background:white;border:2px solid #f1f5f9;">
        ${meta.icon}
      </div>
      <div class="flex-1 pb-1">
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-[11px] font-black text-slate-500">${_formatTime(ev.created_at)}</span>
        </div>
        <p class="text-xs font-black text-slate-700 leading-tight">${meta.label}</p>
        ${detail ? `<p class="text-[10px] font-medium text-slate-500 mt-0.5 leading-snug">${detail}</p>` : ''}
      </div>
    </div>`;
  });

  const allItems = [...scheduleItems, ...extraItems];
  if (!allItems.length) return '';

  return `
  <div class="bg-white border border-slate-100 rounded-[1.5rem] shadow-sm p-5">
    <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Historial del día</p>
    <div class="relative">
      <div class="absolute left-[18px] top-5 bottom-5 w-0.5 bg-gradient-to-b from-slate-200 via-slate-100 to-transparent"></div>
      <div class="space-y-1">${allItems.join('')}</div>
    </div>
  </div>`;
}

// ── ANALYTICS SEMANAL/MENSUAL ─────────────────────────────────────────────────
function _renderWeeklyAnalytics(logs, todayLog, date) {
  const totalDays = logs.length;
  if (!totalDays) return '';

  // Sueño
  const napData = logs.map(l => _calcTotalNapMins(l.events || l.infant_data || [], l));
  const avgNap  = napData.filter(v => v > 0).length
    ? Math.round(napData.filter(v=>v>0).reduce((a,b)=>a+b,0) / napData.filter(v=>v>0).length) : 0;
  const todayNap = todayLog ? _calcTotalNapMins(todayLog.events || todayLog.infant_data || []) : 0;
  const napTrend = napData.length >= 2
    ? (napData[0] >= napData[1] ? 'Mejorando ↑' : 'Variando ↓') : 'Sin datos';

  // Biberón
  const ozData  = logs.map(l => _calcTotalOz(l.events || l.infant_data || [], l));
  const avgOz   = ozData.filter(v=>v>0).length
    ? Math.round(ozData.filter(v=>v>0).reduce((a,b)=>a+b,0) / ozData.filter(v=>v>0).length) : 0;
  const todayOz = todayLog ? _calcTotalOz(todayLog.events || todayLog.infant_data || [], todayLog) : 0;

  // Comidas sólidas — porcentaje promedio
  const foodScore = (food) => ({ todo:100, all:100, poco:50, little:50, half:50, nada:0, none:0 }[food?.toLowerCase()] ?? null);
  const foodScores = logs.map(l => foodScore(l.food)).filter(v => v !== null);
  const avgFood   = foodScores.length ? Math.round(foodScores.reduce((a,b)=>a+b,0) / foodScores.length) : null;
  const todayFood = foodScore(todayLog?.food);

  // Ánimo predominante
  const moodCounts = {};
  logs.forEach(l => { if (l.mood) moodCounts[l.mood] = (moodCounts[l.mood] || 0) + 1; });
  const topMood = Object.entries(moodCounts).sort((a,b)=>b[1]-a[1])[0];

  // Temperatura — último valor
  const allTempEvents = logs.flatMap(l => (l.events || []).filter(e => e.type === 'temperatura'));
  const lastTemp = allTempEvents.length ? allTempEvents[allTempEvents.length-1] : null;

  // Pañales promedio
  const avgDiapers = totalDays > 0
    ? Math.round(logs.reduce((sum,l) => sum + (l.events||[]).filter(e=>e.type==='panal_humedo'||e.type==='panal_sucio').length, 0) / totalDays)
    : 0;

  // Eventos de salud (fiebre, accidente, golpe, llamada_padres)
  const healthAlerts = logs.reduce((sum, l) => sum + (l.events||[]).filter(e => ['fiebre','accidente','golpe','llamada_padres','medicamento_extra'].includes(e.type)).length, 0);

  return `
  <div class="bg-white border border-slate-100 rounded-[1.5rem] shadow-sm p-5 space-y-5">
    <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Análisis ${totalDays <= 7 ? 'semanal' : 'mensual'} (${totalDays} días)</p>

    <!-- Sueño -->
    <div class="p-4 bg-indigo-50 rounded-2xl border border-indigo-100 space-y-3">
      <div class="flex items-center gap-2">
        <span class="text-xl">😴</span>
        <p class="text-sm font-black text-indigo-900">Análisis de Sueño</p>
      </div>
      <div class="grid grid-cols-3 gap-2 text-center">
        ${_analyticsCell('Hoy', todayNap > 0 ? _minsToDuration(todayNap) : '–', 'text-indigo-700')}
        ${_analyticsCell('Promedio', avgNap > 0 ? _minsToDuration(avgNap) : '–', 'text-slate-600')}
        ${_analyticsCell('Tendencia', napTrend, napTrend.includes('Mejor') ? 'text-[#28B54D]' : 'text-amber-500')}
      </div>
    </div>

    <!-- Biberón -->
    ${avgOz > 0 || todayOz > 0 ? `
    <div class="p-4 bg-blue-50 rounded-2xl border border-blue-100 space-y-3">
      <div class="flex items-center gap-2">
        <span class="text-xl">🍼</span>
        <p class="text-sm font-black text-blue-900">Análisis de Leche</p>
      </div>
      <div class="grid grid-cols-2 gap-2 text-center">
        ${_analyticsCell('Hoy', todayOz > 0 ? `${todayOz} oz` : '–', 'text-blue-700')}
        ${_analyticsCell('Promedio', avgOz > 0 ? `${avgOz} oz` : '–', 'text-slate-600')}
      </div>
    </div>` : ''}

    <!-- Comidas sólidas -->
    ${avgFood !== null ? `
    <div class="p-4 bg-green-50 rounded-2xl border border-green-100 space-y-3">
      <div class="flex items-center gap-2">
        <span class="text-xl">🍽️</span>
        <p class="text-sm font-black text-green-900">Análisis de Comidas</p>
      </div>
      <div class="grid grid-cols-2 gap-2 text-center">
        ${_analyticsCell('Hoy', todayFood !== null ? `${todayFood}%` : '–', 'text-green-700')}
        ${_analyticsCell('Promedio', `${avgFood}%`, 'text-slate-600')}
      </div>
      <div class="w-full bg-green-200 rounded-full h-2">
        <div class="bg-[#28B54D] h-2 rounded-full transition-all" style="width:${avgFood}%"></div>
      </div>
    </div>` : ''}

    <!-- Salud y bienestar -->
    <div class="p-4 bg-rose-50 rounded-2xl border border-rose-100 space-y-3">
      <div class="flex items-center gap-2">
        <span class="text-xl">❤️</span>
        <p class="text-sm font-black text-rose-900">Salud y Bienestar</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        ${lastTemp ? `
        <div class="bg-white rounded-2xl p-3 border border-rose-100">
          <p class="text-[9px] font-black text-slate-400 uppercase">Últ. Temperatura</p>
          <p class="text-sm font-black ${parseFloat(lastTemp.temp) >= 37.5 ? 'text-rose-600' : 'text-slate-700'}">${lastTemp.temp}°C ${parseFloat(lastTemp.temp) >= 37.5 ? '🔥' : '✅'}</p>
        </div>` : ''}
        <div class="bg-white rounded-2xl p-3 border border-slate-100">
          <p class="text-[9px] font-black text-slate-400 uppercase">Pañales / día</p>
          <p class="text-sm font-black text-slate-700">~${avgDiapers}</p>
        </div>
        ${topMood ? `
        <div class="bg-white rounded-2xl p-3 border border-slate-100 col-span-${lastTemp ? '1' : '2'}">
          <p class="text-[9px] font-black text-slate-400 uppercase">Ánimo frecuente</p>
          <p class="text-sm font-black text-slate-700">${MOOD_MAP[topMood[0]] || topMood[0]}</p>
        </div>` : ''}
        ${healthAlerts > 0 ? `
        <div class="bg-white rounded-2xl p-3 border border-rose-100 col-span-2">
          <p class="text-[9px] font-black text-slate-400 uppercase">Eventos de salud</p>
          <p class="text-sm font-black text-rose-600">${healthAlerts} registro${healthAlerts > 1 ? 's' : ''} esta semana (fiebre, golpes, accidentes)</p>
        </div>` : ''}
      </div>
    </div>
  </div>`;
}

function _analyticsCell(label, value, colorCls) {
  return `
  <div class="bg-white rounded-2xl p-2 border border-white/80 shadow-sm">
    <p class="text-[9px] font-black text-slate-400 uppercase">${label}</p>
    <p class="text-xs font-black ${colorCls}">${value}</p>
  </div>`;
}

// ── CÁLCULOS ──────────────────────────────────────────────────────────────────
function _calcTotalNapMins(events, log) {
  let mins = 0;
  (events || []).forEach(e => {
    if (e.type === 'siesta' && e.duration_min) mins += e.duration_min;
  });
  return mins;
}

function _calcTotalOz(events, log) {
  let total = 0;
  (events || []).forEach(e => {
    if (e.type === 'biberon' || e.type === 'milk')      total += parseFloat(e.oz || e.value || 0);
    if (e.type === 'structured_entry' && e.milk)        total += parseFloat(e.milk || 0);
  });
  return Math.round(total * 10) / 10;
}

// ── EXPORTS GLOBALES (para onclick en HTML) ────────────────────────────────────
export const RoutineModule = { initRoutinePanel, changeRoutineDate, selectRoutineDate };
