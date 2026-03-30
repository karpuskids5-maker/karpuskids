import { supabase } from '../../shared/supabase.js';
import { AppState } from '../state.js';
import { MaestraApi } from '../api.js';
import { safeToast, safeEscapeHTML } from './ui.js';

// Track pending saves per student to debounce rapid clicks
const _saving = {};

/**
 * Renders the routine section with per-field auto-save.
 * Each field (mood, food, sleep, notes) saves independently on change.
 */
export async function initRoutine() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('tab-daily-routine');
  if (!container) return;

  try {
    const students = AppState.get('students') || [];
    const today = new Date().toISOString().split('T')[0];

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

    container.innerHTML = `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-xl font-black text-slate-800">📝 Reporte Diario de Rutina</h3>
            <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">${todayLabel}</p>
          </div>
          <span class="text-[10px] font-black text-orange-600 bg-orange-50 border border-orange-100 px-3 py-1.5 rounded-full uppercase tracking-wider">
            Guardado automático
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          ${students.map(s => _renderStudentCard(s, logsMap[s.id] || {})).join('')}
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    console.error('[Routine]', e);
    container.innerHTML = '<div class="text-center p-8 text-rose-500 font-bold">Error al cargar la rutina.</div>';
  }
}

function _renderStudentCard(s, log) {
  const sid = s.id;
  const moods = [
    { v: 'feliz',   e: '😊', label: 'Feliz' },
    { v: 'normal',  e: '😐', label: 'Normal' },
    { v: 'triste',  e: '😢', label: 'Triste' },
    { v: 'enojado', e: '😠', label: 'Enojado' }
  ];

  const currentMood  = log.mood  || '';
  const currentFood  = log.food  || log.eating || '';
  const currentSleep = log.nap   || log.sleeping || '';
  const currentNotes = log.notes || '';

  const savedBadge = (field) => {
    const val = field === 'mood' ? currentMood : field === 'food' ? currentFood : field === 'sleep' ? currentSleep : currentNotes;
    return val ? `<span class="text-[9px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">✓ Guardado</span>` : '';
  };

  return `
    <div class="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden" id="card-${sid}">
      <!-- Student header -->
      <div class="flex items-center gap-3 p-4 bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-100">
        <div class="w-11 h-11 rounded-2xl bg-orange-100 flex items-center justify-center font-black text-orange-600 text-lg overflow-hidden shrink-0">
          ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover" loading="lazy">` : s.name.charAt(0)}
        </div>
        <div class="min-w-0">
          <h4 class="font-black text-slate-800 text-sm truncate">${safeEscapeHTML(s.name)}</h4>
          <p class="text-[9px] font-bold text-orange-500 uppercase tracking-widest">Seguimiento del día</p>
        </div>
        <div id="status-${sid}" class="ml-auto text-[9px] font-black text-slate-400 uppercase tracking-wider shrink-0"></div>
      </div>

      <div class="p-4 space-y-5">

        <!-- MOOD — saves on click -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-[10px] font-black text-slate-400 uppercase tracking-wider">☀️ Ánimo al llegar</label>
            <span id="saved-mood-${sid}">${savedBadge('mood')}</span>
          </div>
          <div class="grid grid-cols-4 gap-2">
            ${moods.map(m => `
              <button
                onclick="App.updateRoutineField('${sid}', 'mood', '${m.v}')"
                data-mood="${m.v}"
                class="routine-mood-${sid} flex flex-col items-center gap-1 py-2.5 rounded-2xl border-2 transition-all text-lg
                  ${currentMood === m.v
                    ? 'border-orange-400 bg-orange-50 scale-105 shadow-md'
                    : 'border-slate-100 bg-slate-50 hover:border-orange-200'}">
                ${m.e}
                <span class="text-[9px] font-black text-slate-500">${m.label}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- FOOD — saves on change -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-[10px] font-black text-slate-400 uppercase tracking-wider">🍽️ Alimentación</label>
            <span id="saved-food-${sid}">${savedBadge('food')}</span>
          </div>
          <div class="grid grid-cols-3 gap-2">
            ${[['todo','😋','Todo'],['poco','😕','Poco'],['nada','🚫','Nada']].map(([v,e,l]) => `
              <button
                onclick="App.updateRoutineField('${sid}', 'food', '${v}')"
                data-food="${v}"
                class="routine-food-${sid} flex flex-col items-center gap-1 py-2.5 rounded-2xl border-2 transition-all text-lg
                  ${currentFood === v
                    ? 'border-emerald-400 bg-emerald-50 scale-105 shadow-md'
                    : 'border-slate-100 bg-slate-50 hover:border-emerald-200'}">
                ${e}
                <span class="text-[9px] font-black text-slate-500">${l}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- SLEEP — saves on click -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-[10px] font-black text-slate-400 uppercase tracking-wider">😴 Siesta</label>
            <span id="saved-sleep-${sid}">${savedBadge('sleep')}</span>
          </div>
          <div class="grid grid-cols-2 gap-2">
            ${[['si','😴','Durmió'],['no','🌞','No durmió']].map(([v,e,l]) => `
              <button
                onclick="App.updateRoutineField('${sid}', 'sleep', '${v}')"
                data-sleep="${v}"
                class="routine-sleep-${sid} flex flex-col items-center gap-1 py-2.5 rounded-2xl border-2 transition-all text-lg
                  ${currentSleep === v
                    ? 'border-indigo-400 bg-indigo-50 scale-105 shadow-md'
                    : 'border-slate-100 bg-slate-50 hover:border-indigo-200'}">
                ${e}
                <span class="text-[9px] font-black text-slate-500">${l}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- NOTES — saves on blur -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-[10px] font-black text-slate-400 uppercase tracking-wider">📌 Observaciones</label>
            <span id="saved-notes-${sid}">${savedBadge('notes')}</span>
          </div>
          <textarea
            id="note-${sid}"
            rows="2"
            onblur="App.saveRoutineLog('${sid}', 'notes')"
            class="w-full p-3 bg-slate-50 rounded-2xl text-xs font-medium outline-none border-2 border-transparent focus:border-orange-400 resize-none transition-all"
            placeholder="Ej: Estuvo muy participativo hoy...">${safeEscapeHTML(currentNotes)}</textarea>
        </div>

      </div>
    </div>
  `;
}

/**
 * Called by onclick on each field button.
 * Updates visual state immediately, then auto-saves just that field.
 */
export async function updateRoutineField(studentId, field, value) {
  // 1. Update visual selection
  const colorMap = {
    mood:  { active: 'border-orange-400 bg-orange-50 scale-105 shadow-md',  inactive: 'border-slate-100 bg-slate-50' },
    food:  { active: 'border-emerald-400 bg-emerald-50 scale-105 shadow-md', inactive: 'border-slate-100 bg-slate-50' },
    sleep: { active: 'border-indigo-400 bg-indigo-50 scale-105 shadow-md',   inactive: 'border-slate-100 bg-slate-50' }
  };
  const cm = colorMap[field];
  if (cm) {
    document.querySelectorAll(`.routine-${field}-${studentId}`).forEach(btn => {
      const isSelected = btn.dataset[field] === value;
      btn.className = btn.className
        .replace(/border-\S+/g, '')
        .replace(/bg-\S+/g, '')
        .replace(/scale-\S+/g, '')
        .replace(/shadow-\S+/g, '')
        .trim();
      btn.classList.add(...(isSelected ? cm.active : cm.inactive).split(' '));
    });
  }

  // 2. Auto-save this field
  await saveRoutineLog(studentId, field, value);
}

/**
 * Saves a single field (or all fields if called from notes blur).
 * field: 'mood' | 'food' | 'sleep' | 'notes'
 */
export async function saveRoutineLog(studentId, field = 'notes', value = null) {
  if (_saving[studentId + field]) return;
  _saving[studentId + field] = true;

  const statusEl = document.getElementById(`status-${studentId}`);
  const savedEl  = document.getElementById(`saved-${field}-${studentId}`);
  if (statusEl) statusEl.textContent = 'Guardando...';

  try {
    const classroom = AppState.get('classroom');
    const today = new Date().toISOString().split('T')[0];

    // Build partial payload — only the changed field
    const fieldMap = {
      mood:  'mood',
      food:  'food',
      sleep: 'nap',
      notes: 'notes'
    };

    const dbField = fieldMap[field] || field;
    const fieldValue = value ?? document.getElementById(`note-${studentId}`)?.value ?? '';

    const payload = {
      student_id:   studentId,
      classroom_id: classroom.id,
      date:         today,
      [dbField]:    fieldValue
    };

    await MaestraApi.upsertDailyLog(payload);

    if (statusEl) statusEl.textContent = '';
    if (savedEl)  savedEl.innerHTML = '<span class="text-[9px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">✓ Guardado</span>';

  } catch (err) {
    console.error('[Routine] saveRoutineLog:', err);
    if (statusEl) statusEl.textContent = '⚠ Error';
    safeToast('Error al guardar. Intenta de nuevo.', 'error');
  } finally {
    _saving[studentId + field] = false;
  }
}

export function openNewRoutineModal() {
  safeToast('Selecciona cada campo en la tarjeta del estudiante para guardar automáticamente.', 'info');
}
