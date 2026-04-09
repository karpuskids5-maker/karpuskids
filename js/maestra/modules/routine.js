import { supabase } from '../../shared/supabase.js';
import { AppState } from '../state.js';
import { MaestraApi } from '../api.js';
import { safeToast, safeEscapeHTML, Modal } from './ui.js';
import { Helpers } from '../../shared/helpers.js';

const _saving = {};

/**
 * L\u00f3gica de 12 horas: El reporte del d\u00eda solo es v\u00e1lido si fue guardado hace menos de 12 horas.
 */
function _isWithin12h(dateStr) {
  if (!dateStr) return false;
  const saved = new Date(dateStr);
  return (Date.now() - saved.getTime()) < 12 * 60 * 60 * 1000;
}

/**
 * Vista de rutina mejorada \u2014 Tarjetas de estudiantes con progreso visual (burbujas).
 * Optimizada para m\u00f3vil y con sistema de alertas.
 */
export async function initRoutine() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('tab-daily-routine');
  if (!container) return;

  try {
    const students = AppState.get('students') || [];
    const today    = new Date().toISOString().split('T')[0];

    // Cargar logs de hoy
    const { data: todayLogs } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('classroom_id', classroom.id)
      .eq('date', today);

    const logsMap = {};
    (todayLogs || []).forEach(l => { logsMap[l.student_id] = l; });

    if (!students.length) {
      container.innerHTML = '<div class="text-center p-12 text-slate-400"><p class="font-bold">No hay estudiantes en esta aula.</p></div>';
      return;
    }

    const todayLabel = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    
    // Calcular periodo actual para alarmas
    const now = new Date();
    const hour = now.getHours();
    let currentPeriod = 'morning'; // 0-12
    if (hour >= 12 && hour < 16) currentPeriod = 'afternoon';
    if (hour >= 16) currentPeriod = 'late';

    const periodNames = { morning: 'Ma\u00f1ana', afternoon: 'Tarde', late: 'Tardecita' };
    
    // Estudiantes pendientes en el periodo actual
    const pendingStudents = students.filter(s => {
      const log = logsMap[s.id];
      if (!log || !_isWithin12h(log.updated_at || log.created_at)) return true;
      
      // Validar si falta alg\u00fan campo cr\u00edtico seg\u00fan el periodo
      if (currentPeriod === 'morning' && !log.mood) return true;
      if (currentPeriod === 'afternoon' && (!log.food || !log.mood)) return true;
      if (currentPeriod === 'late' && (!log.nap || !log.food || !log.mood)) return true;
      
      return false;
    });

    container.innerHTML = `
      <div class="space-y-6 pb-20">
        <!-- Header y Alarmas -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-xl font-black text-slate-800">\ud83d\udcdd Rutina Diaria</h3>
              <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">${todayLabel}</p>
            </div>
            <div class="flex flex-col items-end">
               <span class="text-[10px] font-black text-orange-600 bg-orange-50 border border-orange-100 px-3 py-1 rounded-full uppercase tracking-wider mb-1">
                Periodo: ${periodNames[currentPeriod]}
              </span>
              <button onclick="App.openBulkRoutineModal()" class="text-[10px] font-black text-blue-600 hover:text-blue-700 underline uppercase tracking-widest">
                Rutina General (Bulk)
              </button>
            </div>
          </div>

          <!-- Alarma Visual si hay pendientes -->
          ${pendingStudents.length > 0 ? `
            <div class="bg-amber-50 border-2 border-amber-100 rounded-[2rem] p-5 flex items-center gap-4 animate-pulse-subtle">
              <div class="w-12 h-12 bg-amber-400 text-white rounded-2xl flex items-center justify-center text-2xl shrink-0 shadow-lg shadow-amber-200">⚠️</div>
              <div class="flex-1">
                <p class="text-sm font-black text-amber-800">Reportes Pendientes</p>
                <p class="text-xs font-bold text-amber-600/80">Faltan ${pendingStudents.length} estudiantes por reportar en este periodo.</p>
              </div>
              <div class="flex -space-x-3 overflow-hidden">
                ${pendingStudents.slice(0, 3).map(s => `
                  <div class="w-8 h-8 rounded-full border-2 border-white bg-slate-200 overflow-hidden shadow-sm">
                    ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : `<div class="w-full h-full flex items-center justify-center text-[10px] font-black text-slate-500">${s.name.charAt(0)}</div>`}
                  </div>
                `).join('')}
                ${pendingStudents.length > 3 ? `<div class="w-8 h-8 rounded-full border-2 border-white bg-amber-100 flex items-center justify-center text-[10px] font-black text-amber-600 shadow-sm">+${pendingStudents.length - 3}</div>` : ''}
              </div>
            </div>
          ` : `
            <div class="bg-emerald-50 border-2 border-emerald-100 rounded-[2rem] p-5 flex items-center gap-4">
              <div class="w-12 h-12 bg-emerald-500 text-white rounded-2xl flex items-center justify-center text-2xl shrink-0 shadow-lg shadow-emerald-200">✅</div>
              <div>
                <p class="text-sm font-black text-emerald-800">\u00a1Todo al d\u00eda!</p>
                <p class="text-xs font-bold text-emerald-600/80">Has completado los reportes de este periodo.</p>
              </div>
            </div>
          `}
        </div>

        <!-- Grid de Estudiantes (Cards) -->
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" id="routineStudentsGrid">
          ${students.map(s => _renderStudentRoutineCard(s, logsMap[s.id] || {})).join('')}
        </div>

        <div class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm text-center">
          <p class="text-xs text-slate-400 font-medium">
            \ud83d\udca1 Toca a un estudiante para abrir su reporte de rutina individual.<br>
            Los emojis flotantes indican el progreso actual.
          </p>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    console.error('[Routine]', e);
    container.innerHTML = Helpers.errorState('Error al cargar la rutina', 'App.initRoutine()');
  }
}

/**
 * Renderiza la tarjeta individual del estudiante para la secci\u00f3n de rutina.
 */
function _renderStudentRoutineCard(s, log) {
  const isValid = _isWithin12h(log.created_at || log.updated_at);
  const mood  = isValid && log.mood ? log.mood : null;
  const food  = isValid && log.food ? log.food : null;
  const sleep = isValid && log.nap  ? log.nap  : null;
  const note  = isValid && log.notes ? true : false;

  const moodEmojis  = { feliz: '\ud83d\ude0a', normal: '\ud83d\ude10', triste: '\ud83d\ude22', enojado: '\ud83d\ude21' };
  const foodEmojis  = { todo: '\ud83d\ude0b', poco: '\ud83d\ude15', nada: '\ud83d\udeab' };
  const sleepEmojis = { si: '\ud83d\ude34', no: '\ud83c\udf1e' };

  return `
    <div onclick="App.openStudentRoutine('${s.id}')" 
      class="group relative bg-white rounded-[2rem] p-4 border-2 border-slate-100 hover:border-orange-400 hover:shadow-xl hover:shadow-orange-100 transition-all cursor-pointer active:scale-95 flex flex-col items-center text-center overflow-hidden">
      
      <!-- Burbujas de Emojis Flotantes (Status) -->
      <div class="absolute top-2 right-2 flex flex-col gap-1 z-10">
        ${mood ? `<div class="w-7 h-7 bg-orange-50 rounded-full flex items-center justify-center text-sm shadow-sm border border-orange-100 animate-bounce-subtle">${moodEmojis[mood]}</div>` : ''}
        ${food ? `<div class="w-7 h-7 bg-emerald-50 rounded-full flex items-center justify-center text-sm shadow-sm border border-emerald-100 animate-bounce-subtle" style="animation-delay: 0.2s">${foodEmojis[food]}</div>` : ''}
        ${sleep ? `<div class="w-7 h-7 bg-indigo-50 rounded-full flex items-center justify-center text-sm shadow-sm border border-indigo-100 animate-bounce-subtle" style="animation-delay: 0.4s">${sleepEmojis[sleep]}</div>` : ''}
        ${note ? `<div class="w-7 h-7 bg-slate-50 rounded-full flex items-center justify-center text-xs shadow-sm border border-slate-100 animate-bounce-subtle" style="animation-delay: 0.6s">\ud83d\udcdd</div>` : ''}
      </div>

      <!-- Avatar -->
      <div class="w-20 h-20 rounded-[1.5rem] bg-orange-50 border-4 border-white shadow-inner overflow-hidden mb-3 group-hover:scale-110 transition-transform duration-500">
        ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : `<div class="w-full h-full flex items-center justify-center text-2xl font-black text-orange-300">${s.name.charAt(0)}</div>`}
      </div>

      <!-- Info -->
      <h4 class="text-sm font-black text-slate-800 leading-tight mb-1 line-clamp-2">${safeEscapeHTML(s.name)}</h4>
      
      <!-- Progress Indicator (Dot) -->
      <div class="flex gap-1 mt-auto pt-2">
        <div class="w-1.5 h-1.5 rounded-full ${mood ? 'bg-orange-400' : 'bg-slate-200'}"></div>
        <div class="w-1.5 h-1.5 rounded-full ${food ? 'bg-emerald-400' : 'bg-slate-200'}"></div>
        <div class="w-1.5 h-1.5 rounded-full ${sleep ? 'bg-indigo-400' : 'bg-slate-200'}"></div>
      </div>
    </div>
  `;
}

/**
 * Abre el modal de reporte individual para un estudiante.
 */
export async function openStudentRoutine(studentId) {
  const student = AppState.get('students').find(s => s.id == studentId);
  if (!student) return;

  const today = new Date().toISOString().split('T')[0];
  const { data: log } = await supabase.from('daily_logs').select('*').eq('student_id', studentId).eq('date', today).maybeSingle();
  
  const isValid = log && _isWithin12h(log.created_at || log.updated_at);
  const currentMood  = isValid ? (log?.mood || '') : '';
  const currentFood  = isValid ? (log?.food || '') : '';
  const currentSleep = isValid ? (log?.nap || '') : '';
  const currentNotes = isValid ? (log?.notes || '') : '';

  const moodEmojis  = { feliz: '\ud83d\ude0a', normal: '\ud83d\ude10', triste: '\ud83d\ude22', enojado: '\ud83d\ude21' };
  const foodEmojis  = { todo: '\ud83d\ude0b', poco: '\ud83d\ude15', nada: '\ud83d\udeab' };
  const sleepEmojis = { si: '\ud83d\ude34', no: '\ud83c\udf1e' };

  const modalId = 'routineStudentModal';
  const content = `
    <div class="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col max-h-[90vh]">
      <!-- Header Colorido -->
      <div class="bg-gradient-to-r from-orange-500 to-pink-500 p-6 text-white relative">
        <button onclick="Modal.close('${modalId}')" class="absolute top-4 right-4 p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-2xl bg-white border-4 border-white/20 overflow-hidden shadow-lg">
            ${student.avatar_url ? `<img src="${student.avatar_url}" class="w-full h-full object-cover">` : `<div class="w-full h-full flex items-center justify-center text-xl font-black text-orange-500">${student.name.charAt(0)}</div>`}
          </div>
          <div>
            <h3 class="text-xl font-black">${safeEscapeHTML(student.name)}</h3>
            <p class="text-xs font-bold text-orange-100 uppercase tracking-widest">Reporte de Rutina</p>
          </div>
        </div>
      </div>

      <div class="p-6 space-y-6 overflow-y-auto custom-scrollbar">
        <!-- 1. Estado de \u00c1nimo -->
        <div class="space-y-3">
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">\u00bfC\u00f3mo est\u00e1 de \u00e1nimo? \u2600\ufe0f</label>
          <div class="grid grid-cols-4 gap-2">
            ${Object.entries(moodEmojis).map(([v, e]) => `
              <button onclick="App.updateRoutineFieldInModal('${studentId}','mood','${v}')"
                class="routine-modal-mood-${studentId} flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all active:scale-90
                ${currentMood === v ? 'border-orange-400 bg-orange-50 shadow-md' : 'border-slate-100 bg-slate-50'}"
                data-val="${v}">
                <span class="text-2xl mb-1">${e}</span>
                <span class="text-[9px] font-black uppercase text-slate-500">${v}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- 2. Alimentaci\u00f3n -->
        <div class="space-y-3">
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">\u00bfC\u00f3mo comi\u00f3 hoy? \ud83c\udf7d\ufe0f</label>
          <div class="grid grid-cols-3 gap-2">
            ${Object.entries(foodEmojis).map(([v, e]) => `
              <button onclick="App.updateRoutineFieldInModal('${studentId}','food','${v}')"
                class="routine-modal-food-${studentId} flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all active:scale-90
                ${currentFood === v ? 'border-emerald-400 bg-emerald-50 shadow-md' : 'border-slate-100 bg-slate-50'}"
                data-val="${v}">
                <span class="text-2xl mb-1">${e}</span>
                <span class="text-[9px] font-black uppercase text-slate-500">${v}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- 3. Siesta -->
        <div class="space-y-3">
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">\u00bfHizo su siesta? \ud83d\ude34</label>
          <div class="grid grid-cols-2 gap-3">
            ${Object.entries(sleepEmojis).map(([v, e]) => `
              <button onclick="App.updateRoutineFieldInModal('${studentId}','sleep','${v}')"
                class="routine-modal-sleep-${studentId} flex items-center justify-center gap-3 p-4 rounded-2xl border-2 transition-all active:scale-90
                ${currentSleep === v ? 'border-indigo-400 bg-indigo-50 shadow-md' : 'border-slate-100 bg-slate-50'}"
                data-val="${v}">
                <span class="text-2xl">${e}</span>
                <span class="text-xs font-black uppercase text-slate-600">${v === 'si' ? 'Durmi\u00f3' : 'No durmi\u00f3'}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- 4. Notas -->
        <div class="space-y-3">
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Observaciones adicionales \ud83d\udcdd</label>
          <textarea id="modal-note-${studentId}" 
            class="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium outline-none focus:border-orange-400 transition-all resize-none"
            rows="3" placeholder="Ej: Estuvo muy participativo hoy...">${safeEscapeHTML(currentNotes)}</textarea>
        </div>
      </div>

      <div class="p-6 pt-0 mt-auto">
        <button onclick="App.saveRoutineInModal('${studentId}')" id="btnSaveModalRoutine"
          class="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 flex items-center justify-center gap-2">
          <i data-lucide="check-circle" class="w-4 h-4"></i> Guardar y Cerrar
        </button>
      </div>
    </div>
  `;

  Modal.open(modalId, content);
  if (window.lucide) window.lucide.createIcons();
}

/**
 * Helper para actualizar en modal y luego guardar
 */
export function updateRoutineFieldInModal(sid, field, val) {
  const btns = document.querySelectorAll(`.routine-modal-${field}-${sid}`);
  const colorMap = {
    mood: 'border-orange-400 bg-orange-50 shadow-md',
    food: 'border-emerald-400 bg-emerald-50 shadow-md',
    sleep: 'border-indigo-400 bg-indigo-50 shadow-md'
  };
  const activeCls = colorMap[field].split(' ');
  
  btns.forEach(b => {
    b.classList.remove(...activeCls);
    b.classList.add('border-slate-100', 'bg-slate-50');
    b.classList.remove('shadow-md');
    if (b.dataset.val === val) {
      b.classList.add(...activeCls);
      b.classList.remove('border-slate-100', 'bg-slate-50');
    }
  });
  // Auto-save
  updateRoutineField(sid, field, val);
}

export async function saveRoutineInModal(sid) {
  const note = document.getElementById(`modal-note-${sid}`)?.value;
  await saveRoutineLog(sid, 'notes', note);
  Modal.close('routineStudentModal');
  initRoutine(); // Recargar grid para ver burbujas
}

/**
 * Modal para reporte masivo ( Bulk Report ).
 */
export async function openBulkRoutineModal() {
  const modalId = 'bulkRoutineModal';
  const content = `
    <div class="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn">
      <h3 class="text-2xl font-black text-slate-800 mb-2">Rutina General</h3>
      <p class="text-sm text-slate-500 mb-6">Aplica el mismo reporte para todos los estudiantes presentes hoy.</p>
      
      <div class="space-y-6">
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-2">
            <label class="text-[10px] font-black uppercase text-slate-400 ml-1">\u00c1nimo \ud83d\ude0a</label>
            <select id="bulkMood" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-orange-400">
              <option value="feliz">Feliz \ud83d\ude0a</option>
              <option value="normal">Normal \ud83d\ude10</option>
            </select>
          </div>
          <div class="space-y-2">
            <label class="text-[10px] font-black uppercase text-slate-400 ml-1">Comida \ud83c\udf7d\ufe0f</label>
            <select id="bulkFood" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-orange-400">
              <option value="todo">Todo \ud83d\ude0b</option>
              <option value="poco">Poco \ud83d\ude15</option>
            </select>
          </div>
        </div>

        <div class="space-y-2">
          <label class="text-[10px] font-black uppercase text-slate-400 ml-1">Siesta \ud83d\ude34</label>
          <select id="bulkSleep" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-orange-400">
            <option value="si">Durmi\u00f3 \ud83d\ude34</option>
            <option value="no">No durmi\u00f3 \ud83c\udf1e</option>
          </select>
        </div>

        <div class="flex gap-3 pt-4">
          <button onclick="Modal.close('${modalId}')" class="flex-1 py-4 text-slate-400 font-black text-xs uppercase tracking-widest hover:bg-slate-50 rounded-2xl">Cancelar</button>
          <button onclick="App.applyBulkRoutine()" id="btnBulkSave" class="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-100 hover:bg-blue-700 active:scale-95 transition-all">Aplicar a Todos</button>
        </div>
      </div>
    </div>
  `;
  Modal.open(modalId, content);
}

export async function applyBulkRoutine() {
  const btn = document.getElementById('btnBulkSave');
  if (!btn) return;
  
  btn.disabled = true;
  btn.innerHTML = 'Aplicando...';
  
  const mood = document.getElementById('bulkMood').value;
  const food = document.getElementById('bulkFood').value;
  const sleep = document.getElementById('bulkSleep').value;
  
  const students = AppState.get('students') || [];
  const classroom = AppState.get('classroom');
  const today = new Date().toISOString().split('T')[0];

  try {
    const promises = students.map(s => MaestraApi.upsertDailyLog({
      student_id: s.id,
      classroom_id: classroom.id,
      date: today,
      mood, food, nap: sleep
    }));
    
    await Promise.all(promises);
    safeToast(`Rutina aplicada a ${students.length} estudiantes`);
    Modal.close('bulkRoutineModal');
    initRoutine();
  } catch (e) {
    console.error(e);
    safeToast('Error al aplicar rutina masiva', 'error');
    btn.disabled = false;
    btn.innerHTML = 'Aplicar a Todos';
  }
}

/**
 * Actualiza un campo visualmente y guarda en DB.
 */
export async function updateRoutineField(studentId, field, value) {
  await saveRoutineLog(studentId, field, value);
}

/**
 * Guarda un campo en la DB con upsert.
 */
export async function saveRoutineLog(studentId, field = 'notes', value = null) {
  if (_saving[studentId + field]) return;
  _saving[studentId + field] = true;

  try {
    const classroom = AppState.get('classroom');
    const today = new Date().toISOString().split('T')[0];
    const fieldMap = { mood: 'mood', food: 'food', sleep: 'nap', notes: 'notes' };
    const dbField  = fieldMap[field] || field;
    const fieldValue = value ?? '';

    await MaestraApi.upsertDailyLog({
      student_id:   studentId,
      classroom_id: classroom.id,
      date:         today,
      [dbField]:    fieldValue
    });

  } catch (err) {
    console.error('[Routine] saveRoutineLog:', err);
    safeToast('Error al guardar. Intenta de nuevo.', 'error');
  } finally {
    _saving[studentId + field] = false;
  }
}

export function openNewRoutineModal() {
  safeToast('Toca a un estudiante para reportar su rutina diaria.', 'info');
}
