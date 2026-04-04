import { supabase } from '../../shared/supabase.js';
import { AppState } from '../state.js';
import { MaestraApi } from '../api.js';
import { safeToast, safeEscapeHTML } from './ui.js';
import { Helpers } from '../../shared/helpers.js';

const _saving = {};

// ── Lógica de 12 horas ────────────────────────────────────────────────────────
// El reporte del día solo es válido si fue guardado hace menos de 12 horas.
// Pasadas las 12 horas, los campos se resetean visualmente para el nuevo turno.
function _isWithin12h(dateStr) {
  if (!dateStr) return false;
  const saved = new Date(dateStr);
  return (Date.now() - saved.getTime()) < 12 * 60 * 60 * 1000;
}

/**
 * Vista compacta de rutina — tabla con una fila por estudiante.
 * Mucho más eficiente que tarjetas grandes.
 */
export async function initRoutine() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('tab-daily-routine');
  if (!container) return;

  try {
    const students = AppState.get('students') || [];
    const today    = new Date().toISOString().split('T')[0];

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
    const totalFilled = students.filter(s => {
      const log = logsMap[s.id];
      return log && _isWithin12h(log.updated_at || log.created_at);
    }).length;

    container.innerHTML = `
      <div class="space-y-4">
        <!-- Header con progreso -->
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 class="text-lg font-black text-slate-800">📝 Reporte Diario</h3>
            <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">${todayLabel}</p>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <div class="w-24 bg-slate-200 rounded-full h-2 overflow-hidden">
                <div class="bg-emerald-500 h-full rounded-full transition-all" style="width:${Math.round((totalFilled/students.length)*100)}%"></div>
              </div>
              <span class="text-xs font-black text-slate-600">${totalFilled}/${students.length}</span>
            </div>
            <span class="text-[10px] font-black text-orange-600 bg-orange-50 border border-orange-100 px-3 py-1.5 rounded-full uppercase tracking-wider">
              Auto-guardado · Válido 12h
            </span>
          </div>
        </div>

        <!-- Tabla compacta -->
        <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <!-- Headers -->
          <div class="grid grid-cols-[1fr_auto_auto_auto_1fr] gap-0 bg-slate-50 border-b border-slate-200 px-4 py-2.5">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider">Estudiante</span>
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider text-center px-3">Ánimo</span>
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider text-center px-3">Comida</span>
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider text-center px-3">Siesta</span>
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider pl-3">Nota</span>
          </div>

          <!-- Filas por estudiante -->
          <div class="divide-y divide-slate-100">
            ${students.map(s => _renderCompactRow(s, logsMap[s.id] || {})).join('')}
          </div>
        </div>

        <p class="text-[10px] text-slate-400 text-center font-medium">
          💡 Los reportes se reinician automáticamente cada 12 horas. Toca cada emoji para guardar.
        </p>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    console.error('[Routine]', e);
    container.innerHTML = Helpers.errorState('Error al cargar la rutina', 'App.initRoutine()');
    if (window.lucide) window.lucide.createIcons();
  }
}

function _renderCompactRow(s, log) {
  const sid = s.id;

  // Si el log tiene más de 12 horas, tratar como vacío
  const isValid = _isWithin12h(log.created_at);
  const currentMood  = isValid ? (log.mood  || '') : '';
  const currentFood  = isValid ? (log.food  || log.eating || '') : '';
  const currentSleep = isValid ? (log.nap   || log.sleeping || '') : '';
  const currentNotes = isValid ? (log.notes || '') : '';

  const moodEmoji  = { feliz: '😊', normal: '😐', triste: '😢', enojado: '😠' };
  const foodEmoji  = { todo: '😋', poco: '😕', nada: '🚫' };
  const sleepEmoji = { si: '😴', no: '🌞' };

  const btnCls = 'w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all active:scale-90 cursor-pointer border-2';
  const activeCls = 'border-orange-400 bg-orange-50 scale-105 shadow-sm';
  const inactiveCls = 'border-slate-100 bg-slate-50 hover:border-slate-300';

  return `
    <div class="grid grid-cols-[1fr_auto_auto_auto_1fr] gap-0 items-center px-4 py-3 hover:bg-slate-50/50 transition-colors" id="row-${sid}">

      <!-- Nombre -->
      <div class="flex items-center gap-2.5 min-w-0 pr-2">
        <div class="w-8 h-8 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center font-black text-sm overflow-hidden shrink-0">
          ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover" loading="lazy">` : s.name.charAt(0)}
        </div>
        <div class="min-w-0">
          <p class="font-bold text-slate-800 text-sm truncate">${safeEscapeHTML(s.name)}</p>
          <span id="status-${sid}" class="text-[9px] text-slate-400 font-bold"></span>
        </div>
      </div>

      <!-- Ánimo — 4 botones compactos -->
      <div class="flex gap-1 px-2">
        ${Object.entries(moodEmoji).map(([v, e]) => `
          <button onclick="App.updateRoutineField('${sid}','mood','${v}')"
            data-mood="${v}"
            title="${v}"
            class="routine-mood-${sid} ${btnCls} ${currentMood === v ? activeCls : inactiveCls}">
            ${e}
          </button>`).join('')}
      </div>

      <!-- Comida — 3 botones -->
      <div class="flex gap-1 px-2">
        ${Object.entries(foodEmoji).map(([v, e]) => `
          <button onclick="App.updateRoutineField('${sid}','food','${v}')"
            data-food="${v}"
            title="${v}"
            class="routine-food-${sid} ${btnCls} ${currentFood === v ? 'border-emerald-400 bg-emerald-50 scale-105 shadow-sm' : inactiveCls}">
            ${e}
          </button>`).join('')}
      </div>

      <!-- Siesta — 2 botones -->
      <div class="flex gap-1 px-2">
        ${Object.entries(sleepEmoji).map(([v, e]) => `
          <button onclick="App.updateRoutineField('${sid}','sleep','${v}')"
            data-sleep="${v}"
            title="${v === 'si' ? 'Durmió' : 'No durmió'}"
            class="routine-sleep-${sid} ${btnCls} ${currentSleep === v ? 'border-indigo-400 bg-indigo-50 scale-105 shadow-sm' : inactiveCls}">
            ${e}
          </button>`).join('')}
      </div>

      <!-- Nota rápida -->
      <div class="pl-2">
        <input
          id="note-${sid}"
          type="text"
          value="${safeEscapeHTML(currentNotes)}"
          onblur="App.saveRoutineLog('${sid}','notes')"
          placeholder="Observación..."
          class="w-full px-3 py-1.5 bg-slate-50 rounded-xl text-xs font-medium outline-none border-2 border-transparent focus:border-orange-400 transition-all">
      </div>

    </div>`;
}

/**
 * Actualiza un campo visualmente y guarda en DB.
 */
export async function updateRoutineField(studentId, field, value) {
  const colorMap = {
    mood:  { active: 'border-orange-400 bg-orange-50 scale-105 shadow-sm',  inactive: 'border-slate-100 bg-slate-50' },
    food:  { active: 'border-emerald-400 bg-emerald-50 scale-105 shadow-sm', inactive: 'border-slate-100 bg-slate-50' },
    sleep: { active: 'border-indigo-400 bg-indigo-50 scale-105 shadow-sm',   inactive: 'border-slate-100 bg-slate-50' }
  };
  const cm = colorMap[field];
  if (cm) {
    document.querySelectorAll(`.routine-${field}-${studentId}`).forEach(btn => {
      const isSelected = btn.dataset[field] === value;
      // Reset classes
      btn.className = btn.className
        .replace(/border-\S+/g, '').replace(/bg-\S+/g, '')
        .replace(/scale-\S+/g, '').replace(/shadow-\S+/g, '').trim();
      btn.classList.add(...(isSelected ? cm.active : cm.inactive).split(' '));
    });
  }
  await saveRoutineLog(studentId, field, value);
}

/**
 * Guarda un campo en la DB con upsert.
 */
export async function saveRoutineLog(studentId, field = 'notes', value = null) {
  if (_saving[studentId + field]) return;
  _saving[studentId + field] = true;

  const statusEl = document.getElementById(`status-${studentId}`);
  if (statusEl) statusEl.textContent = '⏳';

  try {
    const classroom = AppState.get('classroom');
    const today = new Date().toISOString().split('T')[0];
    const fieldMap = { mood: 'mood', food: 'food', sleep: 'nap', notes: 'notes' };
    const dbField  = fieldMap[field] || field;
    const fieldValue = value ?? document.getElementById(`note-${studentId}`)?.value ?? '';

    await MaestraApi.upsertDailyLog({
      student_id:   studentId,
      classroom_id: classroom.id,
      date:         today,
      [dbField]:    fieldValue
    });

    if (statusEl) statusEl.textContent = '✓';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);

  } catch (err) {
    console.error('[Routine] saveRoutineLog:', err);
    if (statusEl) statusEl.textContent = '⚠';
    safeToast('Error al guardar. Intenta de nuevo.', 'error');
  } finally {
    _saving[studentId + field] = false;
  }
}

export function openNewRoutineModal() {
  safeToast('Toca cada emoji para guardar automáticamente. Válido por 12 horas.', 'info');
}
