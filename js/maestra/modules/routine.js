/**
 * ============================================================
 * RUTINA EXPRESS V2 — Panel Maestra
 * Filosofía: 1 registro = 1-3 segundos
 * Eventos estructurados, modal colectivo con chips, siesta activa, undo bar
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

// ── Constantes de Eventos ─────────────────────────────────────────────────────
const EVENT_TYPES = {
  biberon:      { icon: '🍼', label: 'Biberón',    color: 'blue'   },
  panal_humedo: { icon: '💧', label: 'Pañal 💧',   color: 'sky'    },
  panal_sucio:  { icon: '💩', label: 'Pañal 💩',   color: 'amber'  },
  siesta:       { icon: '😴', label: 'Siesta',      color: 'indigo' },
  temperatura:  { icon: '🌡️', label: 'Temperatura', color: 'rose'   },
  medicamento:  { icon: '💊', label: 'Medicamento', color: 'purple' },
  bano:         { icon: '🚽', label: 'Baño',        color: 'teal'   },
  animo:        { icon: '😊', label: 'Ánimo',       color: 'orange' },
  desayuno:     { icon: '🥐', label: 'Desayuno',    color: 'yellow' },
  almuerzo:     { icon: '🍽️', label: 'Almuerzo',   color: 'green'  },
  merienda:     { icon: '🍎', label: 'Merienda',    color: 'lime'   },
  nota:         { icon: '📝', label: 'Nota',        color: 'slate'  },
};

const SCHEDULE = [
  { hour: 8,  minute: 0,  label: 'Desayuno', type: 'desayuno' },
  { hour: 10, minute: 30, label: 'Merienda',  type: 'merienda' },
  { hour: 12, minute: 0,  label: 'Almuerzo',  type: 'almuerzo' },
  { hour: 13, minute: 30, label: 'Siesta',    type: 'siesta'   },
  { hour: 15, minute: 0,  label: 'Biberón',   type: 'biberon'  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function _isWithin12h(dateStr) {
  if (!dateStr) return false;
  return (Date.now() - new Date(dateStr).getTime()) < 12 * 60 * 60 * 1000;
}

function _getCurrentScheduleEvent() {
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  let closest = null, minDiff = Infinity;
  for (const ev of SCHEDULE) {
    const diff = Math.abs(mins - (ev.hour * 60 + ev.minute));
    if (diff < minDiff && diff <= 90) { minDiff = diff; closest = ev; }
  }
  return closest;
}

function _formatTime(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
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

// ── INIT RUTINA V2 ─────────────────────────────────────────────────────────────
export async function initRoutine() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('tab-daily-routine');
  if (!container) return;

  container.innerHTML = `
    <div class="animate-pulse space-y-5">
      <div class="h-10 bg-slate-100 rounded-2xl w-1/2"></div>
      <div class="h-20 bg-orange-50 rounded-[2rem]"></div>
      <div class="h-16 bg-indigo-50 rounded-[2rem]"></div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        ${Array(5).fill('<div class="h-44 bg-slate-50 rounded-[2rem]"></div>').join('')}
      </div>
    </div>`;

  try {
    const students = AppState.get('students') || [];
    const today    = new Date().toISOString().split('T')[0];

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

    const todayLabel   = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    const withReport   = students.filter(s => logsMap[s.id] && _isWithin12h(logsMap[s.id].created_at)).length;
    const scheduleNow  = _getCurrentScheduleEvent();
    const activeSiestas = _getActiveSiestas(students, logsMap);
    const hasDrafts    = (todayLogs || []).some(l => l.status === 'draft');

    container.innerHTML = _renderRoutineLayout({
      todayLabel, students, logsMap, withReport,
      scheduleNow, activeSiestas, hasDrafts, today, classroom
    });

    // Render tarjetas
    const grid = document.getElementById('routineStudentsGrid');
    if (grid) grid.innerHTML = students.map(s => _renderStudentRoutineCard(s, logsMap[s.id] || {})).join('');

    if (hasDrafts) document.getElementById('btnPublishAll')?.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();

  } catch (e) {
    console.error(e);
    container.innerHTML = '<div class="text-center p-10 text-rose-500 font-bold">Error al cargar rutina. Intenta de nuevo.</div>';
  }
}

// ── RENDER LAYOUT PRINCIPAL ───────────────────────────────────────────────────
function _renderRoutineLayout({ todayLabel, students, logsMap, withReport, scheduleNow, activeSiestas, hasDrafts, today, classroom }) {
  return `
  <div class="space-y-5 pb-24" id="routineWrapper">

    <!-- HEADER -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h3 class="text-xl font-black text-slate-800">📝 Rutina Express</h3>
        <p class="text-xs font-bold text-slate-400 uppercase tracking-wider capitalize">${todayLabel}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-black text-[#28B54D] bg-green-50 border border-green-200 px-3 py-1.5 rounded-full">
          ${withReport}/${students.length} reportes
        </span>
        <button onclick="App.initRoutine()" class="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all" title="Actualizar">
          <i data-lucide="refresh-cw" class="w-4 h-4 text-slate-500"></i>
        </button>
        <button onclick="App.publishAll()" id="btnPublishAll" class="hidden text-[10px] font-black text-[#28B54D] border border-green-300 bg-green-50 px-3 py-1.5 rounded-full hover:bg-green-100 transition-all uppercase tracking-wider">
          Publicar todos
        </button>
      </div>
    </div>

    <!-- BANNER SIESTAS ACTIVAS -->
    ${activeSiestas.length > 0 ? `
    <div class="bg-purple-50 border-2 border-purple-200 rounded-[1.5rem] p-4 flex items-center gap-4">
      <div class="w-11 h-11 bg-purple-500 text-white rounded-2xl flex items-center justify-center text-xl shrink-0 shadow-md shadow-purple-200">😴</div>
      <div class="flex-1">
        <p class="text-sm font-black text-purple-800">${activeSiestas.length} siesta${activeSiestas.length > 1 ? 's' : ''} activa${activeSiestas.length > 1 ? 's' : ''}</p>
        <p class="text-[11px] font-bold text-purple-600">
          ${activeSiestas.slice(0,2).map(s => s.name.split(' ')[0]).join(', ')}${activeSiestas.length > 2 ? ` y ${activeSiestas.length - 2} más` : ''}
        </p>
      </div>
      <button onclick="App.wakeAllSiestas()" class="px-4 py-2 bg-purple-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-purple-700 active:scale-95 transition-all shadow-lg shadow-purple-200">
        Despertar todos
      </button>
    </div>
    ` : ''}

    <!-- ALERTA MOMENTO DEL DÍA -->
    ${scheduleNow ? `
    <div class="bg-[#FF8A00]/10 border-2 border-[#FF8A00]/30 rounded-[1.5rem] p-4 flex items-center gap-4">
      <div class="w-11 h-11 bg-[#FF8A00] text-white rounded-2xl flex items-center justify-center text-xl shrink-0 shadow-md">
        ${EVENT_TYPES[scheduleNow.type]?.icon || '⏰'}
      </div>
      <div class="flex-1">
        <p class="text-[10px] font-black text-[#FF8A00] uppercase tracking-wider">Momento del día</p>
        <p class="text-sm font-black text-slate-800">Es hora del ${scheduleNow.label}</p>
      </div>
      <button onclick="App.openBulkEventModal('${scheduleNow.type}')"
        class="px-4 py-2 bg-[#FF8A00] text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-600 active:scale-95 transition-all shadow-lg shadow-orange-200">
        Registrar todos
      </button>
    </div>
    ` : ''}

    <!-- PARRILLA DE EVENTOS COLECTIVOS -->
    <div class="bg-white border border-slate-100 rounded-[1.5rem] p-5 shadow-sm">
      <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Registrar para todos</p>
      <div class="grid grid-cols-4 sm:grid-cols-6 gap-3">
        ${Object.entries(EVENT_TYPES).map(([type, meta]) => `
          <button onclick="App.openBulkEventModal('${type}')"
            class="flex flex-col items-center gap-1.5 p-3 bg-slate-50 hover:bg-${meta.color}-50 border-2 border-transparent hover:border-${meta.color}-200 rounded-[1.2rem] transition-all active:scale-90 group">
            <span class="text-2xl group-hover:scale-110 transition-transform">${meta.icon}</span>
            <span class="text-[9px] font-black text-slate-400 uppercase tracking-tight leading-tight text-center">${meta.label}</span>
          </button>
        `).join('')}
      </div>
    </div>

    <!-- LÍNEA DE TIEMPO DEL DÍA -->
    <div class="overflow-x-auto pb-1" style="scrollbar-width:none">
      <div class="flex gap-3 min-w-max px-1">
        ${SCHEDULE.map(ev => {
          const h = ev.hour > 12 ? ev.hour - 12 : ev.hour;
          const ampm = ev.hour >= 12 ? 'PM' : 'AM';
          return `
          <button onclick="App.openBulkEventModal('${ev.type}')"
            class="flex flex-col items-center gap-1 px-4 py-3 bg-white border-2 border-slate-100 hover:border-[#FF8A00] hover:bg-orange-50 rounded-[1.2rem] transition-all active:scale-90 shrink-0">
            <span class="text-xl">${EVENT_TYPES[ev.type]?.icon || '⏰'}</span>
            <span class="text-[9px] font-black text-slate-500">${h}:${String(ev.minute).padStart(2,'0')} ${ampm}</span>
            <span class="text-[8px] font-black text-slate-300 uppercase">${ev.label}</span>
          </button>`;
        }).join('')}
      </div>
    </div>

    <!-- GRID DE TARJETAS DE ESTUDIANTES -->
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" id="routineStudentsGrid"></div>

    <p class="text-[10px] text-slate-400 text-center font-medium pb-2">
      💡 Toca un estudiante para editar su reporte individual · Los borradores no son visibles para los padres
    </p>
  </div>`;
}

// ── TARJETA ESTUDIANTE ────────────────────────────────────────────────────────
function _renderStudentRoutineCard(s, log) {
  const isValid    = _isWithin12h(log.created_at);
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

  const moodEmojis = { feliz: '😊', normal: '😐', triste: '😢', enojado: '😡' };
  const foodEmojis = { todo: '🍽️', poco: '🍲', nada: '🙅' };
  const sleepEmojis = { si: '💤', no: '☀️' };

  return `
    <div onclick="App.openStudentRoutine('${s.id}')"
      class="group relative bg-white rounded-[1.5rem] p-4 border-2 ${isDraft ? 'border-dashed border-[#FF8A00]/40 bg-orange-50/20' : isValid ? 'border-[#28B54D]/30' : 'border-slate-100'} hover:border-[#FF8A00] hover:shadow-xl hover:shadow-orange-100 transition-all cursor-pointer active:scale-95 flex flex-col items-center text-center overflow-hidden">

      <!-- Badge borrador -->
      ${isDraft ? `<div class="absolute top-2 left-2 z-10"><span class="px-2 py-0.5 bg-[#FF8A00] text-white text-[8px] font-black uppercase rounded-lg">Borrador</span></div>` : ''}

      <!-- Siesta activa -->
      ${activeSiesta ? `<div class="absolute top-2 left-2 z-10 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-sm shadow-md animate-pulse">😴</div>` : ''}

      <!-- Burbujas status -->
      <div class="absolute top-2 right-2 flex flex-col gap-1 z-10">
        ${mood ? `<div class="w-6 h-6 bg-orange-50 rounded-full flex items-center justify-center text-xs shadow-sm border border-orange-100">${moodEmojis[mood] || '😊'}</div>` : ''}
        ${(isInfant && hasBiberon) ? `<div class="w-6 h-6 bg-blue-50 rounded-full flex items-center justify-center text-xs shadow-sm border border-blue-100">🍼</div>` : ''}
        ${(!isInfant && food) ? `<div class="w-6 h-6 bg-emerald-50 rounded-full flex items-center justify-center text-xs shadow-sm border border-emerald-100">${foodEmojis[food] || '🍽️'}</div>` : ''}
        ${sleep ? `<div class="w-6 h-6 bg-indigo-50 rounded-full flex items-center justify-center text-xs shadow-sm border border-indigo-100">${sleepEmojis[sleep] || '💤'}</div>` : ''}
        ${note ? `<div class="w-6 h-6 bg-slate-50 rounded-full flex items-center justify-center text-xs shadow-sm border border-slate-100">📝</div>` : ''}
      </div>

      <!-- Avatar -->
      <div class="w-18 h-18 w-[72px] h-[72px] rounded-[1.2rem] bg-orange-50 border-4 border-white shadow-inner overflow-hidden mb-3 group-hover:scale-105 transition-transform flex items-center justify-center font-black text-2xl text-orange-300">
        ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover" loading="lazy">` : s.name.charAt(0)}
      </div>

      <h4 class="text-xs font-black text-slate-800 leading-tight mb-0.5 line-clamp-2">${safeEscapeHTML(s.name)}</h4>
      <p class="text-[9px] font-bold text-slate-400 uppercase">${s.age} ${s.age_type || 'años'}</p>

      ${lastEvent ? `<p class="text-[9px] font-bold text-slate-300 mt-1">${_formatTime(lastEvent.created_at)}</p>` : ''}

      <!-- Indicadores círculo -->
      <div class="flex gap-1.5 mt-auto pt-2">
        <div class="w-2.5 h-2.5 rounded-full ${mood ? 'bg-[#FF8A00]' : 'bg-slate-200'}" title="Ánimo"></div>
        <div class="w-2.5 h-2.5 rounded-full ${isInfant ? (hasBiberon ? 'bg-blue-400' : 'bg-slate-200') : (food ? 'bg-[#28B54D]' : 'bg-slate-200')}" title="${isInfant ? 'Biberón' : 'Comida'}"></div>
        <div class="w-2.5 h-2.5 rounded-full ${sleep ? 'bg-indigo-400' : 'bg-slate-200'}" title="Siesta"></div>
      </div>
    </div>`;
}

// ── MODAL COLECTIVO (BULK) ────────────────────────────────────────────────────
export async function openBulkEventModal(eventType = 'animo') {
  const students = AppState.get('students') || [];
  const meta = EVENT_TYPES[eventType] || { icon: '📝', label: eventType, color: 'slate' };
  const modalId = 'bulkEventModal';

  // Sub-parámetros por tipo de evento
  const subParams = _renderSubParams(eventType);

  const chipsHTML = students.map(s => `
    <button type="button" data-sid="${s.id}" onclick="this.classList.toggle('selected'); this.classList.toggle('ring-2'); this.classList.toggle('ring-[#28B54D]');"
      class="selected flex items-center gap-2 px-3 py-2 bg-green-50 border-2 border-[#28B54D]/30 rounded-xl transition-all active:scale-90 hover:border-[#28B54D]">
      <div class="w-7 h-7 rounded-full bg-slate-200 overflow-hidden shrink-0 flex items-center justify-center text-xs font-black text-slate-500">
        ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
      </div>
      <span class="text-[11px] font-black text-slate-700 leading-tight">${s.name.split(' ')[0]}</span>
    </button>`).join('');

  const content = `
    <div class="bg-white w-full max-w-md rounded-[1.8rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col max-h-[90vh]">
      <div class="bg-gradient-to-r from-[#28B54D] to-emerald-600 p-5 text-white flex items-center gap-4">
        <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">${meta.icon}</div>
        <div>
          <h3 class="text-lg font-black">${meta.label}</h3>
          <p class="text-xs font-bold text-green-100 uppercase tracking-widest">Registro colectivo</p>
        </div>
        <button onclick="Modal.close('${modalId}')" class="ml-auto p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>

      <div class="overflow-y-auto flex-1 p-5 space-y-5 custom-scrollbar">
        <!-- Sub parámetros -->
        ${subParams}

        <!-- Chips de estudiantes -->
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
          class="w-full py-4 bg-[#FF8A00] text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-orange-600 active:scale-95 transition-all shadow-lg shadow-orange-200 flex items-center justify-center gap-2">
          <i data-lucide="check-circle" class="w-4 h-4"></i> Confirmar
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
        <div class="space-y-2">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Onzas de leche</p>
          <div class="grid grid-cols-4 gap-2">
            ${[2,4,6,8].map(oz => `
              <button type="button" data-oz="${oz}" onclick="document.querySelectorAll('[data-oz]').forEach(b=>b.classList.remove('bg-blue-500','text-white','border-blue-500')); this.classList.add('bg-blue-500','text-white','border-blue-500');"
                class="py-3 bg-blue-50 border-2 border-blue-200 rounded-2xl font-black text-sm text-blue-700 hover:bg-blue-100 transition-all active:scale-90">
                ${oz}<span class="text-[9px]">oz</span>
              </button>`).join('')}
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
              <button type="button" data-temp="${t}" onclick="document.querySelectorAll('[data-temp]').forEach(b=>{b.classList.remove('bg-rose-500','text-white','border-rose-500','bg-blue-500','border-blue-400'); b.classList.add('bg-slate-50','border-slate-100');}); this.classList.remove('bg-slate-50','border-slate-100'); this.classList.add('${fiebre ? 'bg-rose-500 border-rose-500' : 'bg-blue-500 border-blue-400'}','text-white');"
                class="py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs ${fiebre ? 'text-rose-600' : 'text-slate-600'} hover:bg-slate-100 transition-all active:scale-90 relative">
                ${t}°${fiebre ? '<span class="absolute -top-1 -right-1 text-[8px]">🔥</span>' : ''}
              </button>`;}).join('')}
          </div>
        </div>`;
    }
    case 'medicamento':
      return `
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Medicamento</p>
            <input id="medNombre" type="text" placeholder="Ej: Ibuprofeno" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-purple-400 transition-all">
          </div>
          <div class="space-y-1">
            <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Dosis</p>
            <input id="medDosis" type="text" placeholder="Ej: 5ml" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold outline-none focus:border-purple-400 transition-all">
          </div>
        </div>`;
    case 'animo':
      return `
        <div class="space-y-2">
          <p class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Estado de ánimo</p>
          <div class="grid grid-cols-4 gap-2">
            ${Object.entries({feliz:'😊',normal:'😐',triste:'😢',enojado:'😡'}).map(([v,e]) => `
              <button type="button" data-mood="${v}" onclick="document.querySelectorAll('[data-mood]').forEach(b=>{b.classList.remove('border-orange-400','bg-orange-50');}); this.classList.add('border-orange-400','bg-orange-50');"
                class="flex flex-col items-center p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl transition-all active:scale-90">
                <span class="text-2xl">${e}</span>
                <span class="text-[9px] font-black text-slate-400 uppercase mt-1">${v}</span>
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
              class="flex flex-col items-center gap-2 p-4 bg-indigo-50 border-2 border-indigo-200 rounded-2xl transition-all active:scale-90 hover:border-indigo-400">
              <span class="text-3xl">😴</span>
              <span class="text-xs font-black text-indigo-700 uppercase tracking-wide">Se durmió</span>
            </button>
            <button type="button" data-siesta-action="despertar"
              onclick="document.querySelectorAll('[data-siesta-action]').forEach(b=>{b.classList.remove('bg-indigo-500','text-white','border-indigo-500');}); this.classList.add('bg-indigo-500','text-white','border-indigo-500');"
              class="flex flex-col items-center gap-2 p-4 bg-amber-50 border-2 border-amber-200 rounded-2xl transition-all active:scale-90 hover:border-amber-400">
              <span class="text-3xl">☀️</span>
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

    const classroom = AppState.get('classroom');
    const today     = new Date().toISOString().split('T')[0];
    const logsMap   = AppState.get('logsMap') || {};

    // Recolectar parámetros adicionales
    const extra = {};
    if (eventType === 'biberon')      extra.oz    = parseFloat(document.querySelector('[data-oz].bg-blue-500')?.dataset.oz) || 0;
    if (eventType === 'temperatura')  extra.temp  = parseFloat(document.querySelector('[data-temp].text-white')?.dataset.temp) || null;
    if (eventType === 'medicamento')  { extra.nombre = document.getElementById('medNombre')?.value.trim(); extra.dosis = document.getElementById('medDosis')?.value.trim(); }
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
        // Cerrar la siesta abierta más reciente y calcular duración
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
        // Si no había siesta abierta, crear el evento cerrado directamente
        if (!closed) {
          events.push(_makeEvent('siesta', { open: false, end_at: now, duration_min: 0 }));
        }
        newEvents = events;
      } else {
        const newEvent = _makeEvent(eventType, extra);
        if (eventType === 'siesta') newEvent.open = true; // "Se durmió"
        newEvents = _addEventToLog(currentLog, newEvent);
      }

      const payload = { student_id: sid, classroom_id: classroom.id, date: today, events: newEvents };
      if (eventType === 'animo'  && extra.mood) payload.mood = extra.mood;
      if (eventType === 'biberon')               payload.nap  = currentLog.nap || null;

      return MaestraApi.upsertDailyLog(payload);
    });

    await Promise.all(promises);

    Modal.close('bulkEventModal');
    safeToast(`${EVENT_TYPES[eventType]?.label || eventType} registrado para ${selected.length} estudiante${selected.length > 1 ? 's' : ''}`);

    // Actualizar logsMap en AppState
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();

    // Mostrar barra de Undo
    _showUndoBar(eventType, selected, prevState);

  } catch (e) {
    console.error(e);
    safeToast('Error al guardar', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4"></i> Confirmar'; if (window.lucide) lucide.createIcons(); }
  }
}

// ── UNDO BAR (10 segundos) ───────────────────────────────────────────────────
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

  // Drenar barra de progreso
  let pct = 100;
  const tick = setInterval(() => {
    pct -= 2;
    const prog = document.getElementById('undoProgress');
    if (prog) prog.style.height = pct + '%';
    if (pct <= 0) {
      clearInterval(tick);
      el.innerHTML = '';
      _undoPayload = null;
    }
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
    const promises = sids.map(sid => {
      const prev = prevState[sid] || {};
      return MaestraApi.upsertDailyLog({
        student_id: sid, classroom_id: classroom.id, date: today,
        events: prev.events || [], mood: prev.mood || null, food: prev.food || null, nap: prev.nap || null
      });
    });
    await Promise.all(promises);
    _undoPayload = null;
    document.getElementById('undoBarWrapper').innerHTML = '';
    safeToast('Registro revertido', 'success');
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
  } catch (e) {
    safeToast('Error al deshacer', 'error');
  }
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
  return newMap;
}

function _refreshStudentCards() {
  const students = AppState.get('students') || [];
  const logsMap  = AppState.get('logsMap') || {};
  const grid = document.getElementById('routineStudentsGrid');
  if (!grid) return;
  grid.innerHTML = students.map(s => _renderStudentRoutineCard(s, logsMap[s.id] || {})).join('');
  if (window.lucide) window.lucide.createIcons();
  // Actualizar contador progreso
  const withReport = students.filter(s => logsMap[s.id] && _isWithin12h(logsMap[s.id].created_at)).length;
  const badge = document.querySelector('#routineWrapper .text-\\[\\#28B54D\\].bg-green-50');
  if (badge) badge.textContent = `${withReport}/${students.length} reportes`;
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
      // Cerrar última siesta abierta
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'siesta' && events[i].open) {
          const start = new Date(events[i].created_at);
          const end   = new Date(now);
          const mins  = Math.round((end - start) / 60000);
          events[i]   = { ...events[i], open: false, end_at: now, duration_min: mins };
          break;
        }
      }
      return MaestraApi.upsertDailyLog({ student_id: s.id, classroom_id: classroom.id, date: today, events, nap: 'si' });
    }));
    safeToast(`${active.length} siesta${active.length > 1 ? 's' : ''} cerrada${active.length > 1 ? 's' : ''} con éxito`);
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
    // Actualizar banner
    const banner = document.querySelector('#routineWrapper .bg-purple-50');
    if (banner) banner.remove();
  } catch(e) {
    safeToast('Error al cerrar siestas', 'error');
  }
}

// ── MODAL INDIVIDUAL ESTUDIANTE ───────────────────────────────────────────────
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

// ── MODAL INDIVIDUAL: ESTÁNDAR ────────────────────────────────────────────────
function _renderStandardRoutineUI(student, log, modalId) {
  const isValid      = log && _isWithin12h(log.created_at);
  const currentMood  = isValid ? (log.mood  || '') : '';
  const currentFood  = isValid ? (log.food  || '') : '';
  const currentSleep = isValid ? (log.nap   || '') : '';
  const currentNotes = isValid ? (log.notes || '') : '';
  const events       = isValid ? (log.events || []) : [];

  const moodEmojis  = { feliz: '😊', normal: '😐', triste: '😢', enojado: '😡' };
  const foodEmojis  = { todo: '🍽️', poco: '🍲', nada: '🙅' };

  const timelineHTML = events.length ? events.slice().reverse().map(ev => {
    const meta = EVENT_TYPES[ev.type] || { icon: '📋', label: ev.type };
    let detail = '';
    if (ev.type === 'biberon')     detail = ev.oz ? `${ev.oz} oz` : '';
    if (ev.type === 'temperatura') detail = ev.temp ? `${ev.temp}°C ${ev.temp >= 37.5 ? '🔥' : ''}` : '';
    if (ev.type === 'medicamento') detail = [ev.nombre, ev.dosis].filter(Boolean).join(' · ');
    if (ev.type === 'siesta')      detail = ev.duration_min ? `${ev.duration_min} min` : (ev.open ? 'En curso...' : '');
    return `
      <div class="flex items-start gap-3">
        <div class="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-sm shrink-0">${meta.icon}</div>
        <div>
          <p class="text-[10px] font-black text-slate-400">${_formatTime(ev.created_at)}</p>
          <p class="text-xs font-bold text-slate-700">${meta.label}${detail ? ` · ${detail}` : ''}</p>
        </div>
      </div>`;
  }).join('') : '<p class="text-xs text-slate-400 italic">Sin eventos registrados hoy.</p>';

  return `
    <div class="bg-white w-full max-w-md rounded-[1.8rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col max-h-[92vh]">
      <div class="bg-gradient-to-r from-[#FF8A00] to-pink-500 p-5 text-white relative">
        <button onclick="Modal.close('${modalId}')" class="absolute top-4 right-4 p-2 bg-white/20 rounded-full hover:bg-white/30">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-2xl bg-white/20 border-2 border-white/30 overflow-hidden flex items-center justify-center font-black text-2xl shrink-0">
            ${student.avatar_url ? `<img src="${student.avatar_url}" class="w-full h-full object-cover">` : student.name.charAt(0)}
          </div>
          <div>
            <h3 class="text-lg font-black">${safeEscapeHTML(student.name)}</h3>
            <p class="text-[10px] font-bold text-orange-100 uppercase tracking-widest">Reporte de Rutina</p>
          </div>
        </div>
      </div>

      <div class="p-5 space-y-5 overflow-y-auto custom-scrollbar">
        <!-- Ánimo -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Estado de ánimo ☀️</label>
          <div class="grid grid-cols-4 gap-2">
            ${Object.entries(moodEmojis).map(([v,e]) => `
              <button onclick="App.updateRoutineFieldInModal('${student.id}','mood','${v}')"
                class="routine-modal-mood-${student.id} flex flex-col items-center p-3 rounded-2xl border-2 transition-all active:scale-90 ${currentMood===v ? 'border-[#FF8A00] bg-orange-50 shadow-md' : 'border-slate-100 bg-slate-50'}" data-val="${v}">
                <span class="text-2xl mb-1">${e}</span>
                <span class="text-[9px] font-black uppercase text-slate-500">${v}</span>
              </button>`).join('')}
          </div>
        </div>

        <!-- Comida -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Alimentación 🍽️</label>
          <div class="grid grid-cols-3 gap-2">
            ${Object.entries(foodEmojis).map(([v,e]) => `
              <button onclick="App.updateRoutineFieldInModal('${student.id}','food','${v}')"
                class="routine-modal-food-${student.id} flex flex-col items-center p-3 rounded-2xl border-2 transition-all active:scale-90 ${currentFood===v ? 'border-[#28B54D] bg-green-50 shadow-md' : 'border-slate-100 bg-slate-50'}" data-val="${v}">
                <span class="text-2xl mb-1">${e}</span>
                <span class="text-[9px] font-black uppercase text-slate-500">${v}</span>
              </button>`).join('')}
          </div>
        </div>

        <!-- Siesta -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Siesta 💤</label>
          ${(() => {
            const activeSiesta = events.find(e => e.type === 'siesta' && e.open);
            if (activeSiesta) {
              const start = new Date(activeSiesta.created_at);
              const elapsed = Math.round((Date.now() - start) / 60000);
              return `
              <div class="p-4 bg-purple-50 border-2 border-purple-200 rounded-2xl flex items-center justify-between gap-3">
                <div class="flex items-center gap-3">
                  <span class="text-2xl animate-pulse">😴</span>
                  <div>
                    <p class="text-xs font-black text-purple-800">Durmiendo ahora</p>
                    <p class="text-[10px] font-bold text-purple-600">Inició a las ${_formatTime(activeSiesta.created_at)} · ${elapsed}min</p>
                  </div>
                </div>
                <button onclick="App.wakeStudentSiesta('${student.id}')"
                  class="px-3 py-2 bg-purple-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-purple-700 active:scale-90 transition-all shrink-0 shadow-md shadow-purple-200">
                  ☀️ Despertó
                </button>
              </div>`;
            }
            return `
            <div class="grid grid-cols-2 gap-2">
              ${Object.entries({si:'💤',no:'☀️'}).map(([v,e]) => `
                <button onclick="App.updateRoutineFieldInModal('${student.id}','sleep','${v}')"
                  class="routine-modal-sleep-${student.id} flex items-center justify-center gap-3 p-4 rounded-2xl border-2 transition-all active:scale-90 ${currentSleep===v ? 'border-indigo-400 bg-indigo-50 shadow-md' : 'border-slate-100 bg-slate-50'}" data-val="${v}">
                  <span class="text-2xl">${e}</span>
                  <span class="text-xs font-black uppercase text-slate-600">${v==='si' ? 'Durmió' : 'No durmió'}</span>
                </button>`).join('')}
            </div>`;
          })()}
        </div>

        <!-- Notas -->
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Observaciones 📝</label>
          <textarea id="modal-note-${student.id}" rows="3"
            class="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium outline-none focus:border-[#FF8A00] transition-all resize-none"
            placeholder="Escribe aquí...">${safeEscapeHTML(currentNotes)}</textarea>
        </div>

        <!-- Línea de tiempo individual -->
        ${events.length ? `
        <div class="space-y-2">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Eventos del día</label>
          <div class="space-y-3 max-h-40 overflow-y-auto pr-1">${timelineHTML}</div>
        </div>` : ''}
      </div>

      <div class="p-5 pt-0">
        <button onclick="App.saveRoutineInModal('${student.id}')" id="btnSaveModalRoutine"
          class="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg flex items-center justify-center gap-2">
          <i data-lucide="check-circle" class="w-4 h-4"></i> Guardar y Cerrar
        </button>
      </div>
    </div>`;
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
    <div class="bg-white w-full max-w-md rounded-[1.8rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col max-h-[95vh]">
      <div class="bg-gradient-to-r from-blue-500 to-indigo-600 p-5 text-white relative">
        <button onclick="Modal.close('${modalId}')" class="absolute top-4 right-4 p-2 bg-white/20 rounded-full hover:bg-white/30">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-2xl bg-white/20 border-2 border-white/30 overflow-hidden flex items-center justify-center font-black text-2xl shrink-0">
            ${student.avatar_url ? `<img src="${student.avatar_url}" class="w-full h-full object-cover">` : student.name.charAt(0)}
          </div>
          <div>
            <h3 class="text-lg font-black">${safeEscapeHTML(student.name)}</h3>
            <p class="text-[10px] font-bold text-blue-100 uppercase tracking-widest">Registro del Bebé 🍼</p>
          </div>
        </div>
      </div>

      <div class="p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar bg-slate-50/50">
        <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Hora del registro</label>
          <select id="infantTime" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-blue-400">
            ${timeOptions.map(t => `<option ${t === currentHourStr ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>

        <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Leche (Onzas)</label>
          <div class="flex items-center gap-3">
            <input type="number" id="infantMilk" min="0" max="12" step="0.5" placeholder="0"
              class="flex-1 p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-lg outline-none focus:border-blue-400">
            <span class="font-black text-slate-400 text-[11px] uppercase">oz</span>
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
          <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Observación 📝</label>
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

      <div class="p-5 bg-white border-t border-slate-100">
        <button onclick="App.saveInfantEntry('${student.id}')" id="btnSaveInfant"
          class="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 active:scale-95 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2">
          <i data-lucide="save" class="w-4 h-4"></i> Guardar Registro
        </button>
      </div>
    </div>`;
}

// ── GUARDAR BEBÉ ──────────────────────────────────────────────────────────────
export async function saveInfantEntry(sid) {
  const btn = document.getElementById('btnSaveInfant');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i> Guardando...'; if (window.lucide) lucide.createIcons(); }
  try {
    const time    = document.getElementById('infantTime').value;
    const milk    = parseFloat(document.getElementById('infantMilk').value) || 0;
    const food    = document.querySelector('input[name="infantFood"]:checked')?.value;
    const acts    = [...document.querySelectorAll('input[name="infantActivity"]:checked')].map(c => c.value);
    const notes   = document.getElementById('infantNotes').value.trim();

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
    safeToast('Registro guardado');
    Modal.close('routineStudentModal');
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
  } catch (e) {
    safeToast('Error al guardar', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = 'Guardar Registro'; }
  }
}

// ── UPDATE CAMPO EN MODAL ─────────────────────────────────────────────────────
export function updateRoutineFieldInModal(sid, field, val) {
  const fieldMap = { mood: 'orange-400 bg-orange-50', food: '[#28B54D] bg-green-50', sleep: 'indigo-400 bg-indigo-50' };
  const target   = field === 'sleep' ? 'sleep' : field;
  document.querySelectorAll(`.routine-modal-${target}-${sid}`).forEach(b => {
    b.className = b.className.replace(/border-[\w\[\]#]+ bg-\w+-\d+ shadow-md/g, '');
    b.classList.add('border-slate-100', 'bg-slate-50');
    b.classList.remove('shadow-md');
    if (b.dataset.val === val) {
      b.classList.remove('border-slate-100', 'bg-slate-50');
      const cls = fieldMap[field]?.split(' ') || [];
      cls.forEach(c => b.classList.add(`border-${c.includes('#') ? c : c}`, c));
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
  } catch (e) {
    safeToast('Error al guardar', 'error');
  }
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
    safeToast('Siesta cerrada — duración calculada automáticamente');
    Modal.close('routineStudentModal');
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
  } catch (e) {
    safeToast('Error al registrar despertar', 'error');
  }
}

// ── PUBLICAR TODOS LOS BORRADORES ────────────────────────────────────────────
export async function publishAll() {
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  const { data: drafts } = await supabase.from('daily_logs').select('id').eq('classroom_id', classroom.id).eq('date', today).eq('status', 'draft');
  if (!drafts?.length) { safeToast('No hay borradores para publicar'); return; }
  if (!confirm(`¿Publicar ${drafts.length} reporte${drafts.length > 1 ? 's' : ''}? Los padres podrán verlos ahora.`)) return;
  try {
    await MaestraApi.publishDailyLogs(drafts.map(d => d.id));
    safeToast('Reportes publicados con éxito', 'success');
    document.getElementById('btnPublishAll')?.classList.add('hidden');
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
  } catch (e) {
    safeToast('Error al publicar', 'error');
  }
}

// ── MODAL BULK LEGACY (compatibilidad) ───────────────────────────────────────
export async function openBulkRoutineModal() { return openBulkEventModal('animo'); }

export async function applyBulkRoutine() {
  const mood  = document.getElementById('bulkMood')?.value;
  const food  = document.getElementById('bulkFood')?.value;
  const sleep = document.getElementById('bulkSleep')?.value;
  const students  = AppState.get('students') || [];
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  try {
    await Promise.all(students.map(s => MaestraApi.upsertDailyLog({ student_id: s.id, classroom_id: classroom.id, date: today, mood, food, nap: sleep })));
    safeToast(`Rutina aplicada a ${students.length} estudiantes`);
    Modal.close('bulkRoutineModal');
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
  } catch (_) { safeToast('Error al aplicar rutina masiva', 'error'); }
}

// ── GUARDAR CAMPO INDIVIDUAL ──────────────────────────────────────────────────
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

export function openNewRoutineModal() { openBulkEventModal('animo'); }

// ── COMPATIBILIDAD infant ─────────────────────────────────────────────────────
export async function registerInfantEvent(sid, type, val) {
  const classroom = AppState.get('classroom');
  const today     = new Date().toISOString().split('T')[0];
  const logsMap   = AppState.get('logsMap') || {};
  const currentLog = logsMap[sid] || {};
  const newEvents  = _addEventToLog(currentLog, _makeEvent(type, { value: val }));
  try {
    await MaestraApi.upsertDailyLog({ student_id: sid, classroom_id: classroom.id, date: today, events: newEvents });
    safeToast(`Registro de ${type} guardado`);
    await _refreshLogsMap(classroom.id, today);
    _refreshStudentCards();
  } catch (e) { safeToast('Error al registrar evento', 'error'); }
}
