import { supabase, sendPush } from '../../shared/supabase.js';
import { AppState } from '../state.js';
import { MaestraApi } from '../api.js';
import { safeToast, safeEscapeHTML } from './ui.js';

/**
 * 🍱 Rutina Diaria
 */
export async function initRoutine() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('tab-daily-routine');
  if (!container) return;

  try {
    const students = AppState.get('students') || [];
    const today = new Date().toISOString().split('T')[0];
    
    // Obtener logs de hoy para este aula
    const { data: todayLogs } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('classroom_id', classroom.id)
      .eq('date', today);

    const logsMap = {};
    (todayLogs || []).forEach(l => logsMap[l.student_id] = l);

    container.innerHTML = `
      <div class="notebook-paper p-8">
        <div class="flex justify-between items-center mb-8">
          <h3 class="text-2xl font-black text-slate-800 flex items-center gap-3">📝 Reporte Diario de Rutina</h3>
          <div class="text-xs font-bold text-slate-400 uppercase bg-slate-100 px-3 py-1 rounded-full">${today}</div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          ${students.map(s => {
            const log = logsMap[s.id] || {};
            return `
              <div class="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-md transition-all">
                <div class="flex items-center gap-4 mb-6">
                  <div class="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-xl overflow-hidden">
                    ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
                  </div>
                  <div>
                    <h4 class="font-black text-slate-800 text-sm">${safeEscapeHTML(s.name)}</h4>
                    <p class="text-[9px] font-bold text-orange-500 uppercase tracking-widest">Seguimiento Diario</p>
                  </div>
                </div>

                <div class="space-y-4">
                  <!-- Mañana: Ánimo -->
                  <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase mb-2 block tracking-tighter">¿Cómo llegó hoy? (Mañana)</label>
                    <div class="flex gap-2">
                      ${['feliz', 'normal', 'triste', 'enojado'].map(m => `
                        <button onclick="App.updateRoutineField('${s.id}', 'mood', '${m}')" 
                          data-mood="${m}"
                          class="routine-mood-btn-${s.id} flex-1 py-2 rounded-xl text-lg border-2 transition-all ${log.mood === m ? 'bg-orange-500 border-orange-500 scale-105 shadow-lg text-white' : 'bg-slate-50 border-slate-50 hover:border-orange-200'}">
                          ${m === 'feliz' ? '😊' : m === 'normal' ? '😐' : m === 'triste' ? '😢' : '😠'}
                        </button>
                      `).join('')}
                    </div>
                  </div>

                  <!-- Tarde: Comida y Sueño -->
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="text-[10px] font-black text-slate-400 uppercase mb-2 block tracking-tighter">¿Cómo comió?</label>
                      <select id="food-${s.id}" onchange="App.updateRoutineField('${s.id}', 'food', this.value)" 
                        class="w-full p-2 bg-slate-50 rounded-xl text-xs font-bold outline-none border-2 border-transparent focus:border-orange-500">
                        <option value="">Seleccionar</option>
                        <option value="todo" ${log.food === 'todo' || log.eating === 'todo' ? 'selected' : ''}>😋 Todo</option>
                        <option value="poco" ${log.food === 'poco' || log.eating === 'poco' ? 'selected' : ''}>😕 Poco</option>
                        <option value="nada" ${log.food === 'nada' || log.eating === 'nada' ? 'selected' : ''}>🚫 Nada</option>
                      </select>
                    </div>
                    <div>
                      <label class="text-[10px] font-black text-slate-400 uppercase mb-2 block tracking-tighter">¿Durmió siesta?</label>
                      <select id="sleep-${s.id}" onchange="App.updateRoutineField('${s.id}', 'sleep', this.value)" 
                        class="w-full p-2 bg-slate-50 rounded-xl text-xs font-bold outline-none border-2 border-transparent focus:border-orange-500">
                        <option value="">Seleccionar</option>
                        <option value="si" ${log.sleep === 'si' || log.sleeping === 'si' || log.nap === 'si' ? 'selected' : ''}>😴 Sí</option>
                        <option value="no" ${log.sleep === 'no' || log.sleeping === 'no' || log.nap === 'no' ? 'selected' : ''}>🚫 No</option>
                      </select>
                    </div>
                  </div>

                  <!-- Notas Adicionales -->
                  <div>
                    <label class="text-[10px] font-black text-slate-400 uppercase mb-2 block tracking-tighter">Observaciones / Actividades</label>
                    <textarea id="note-${s.id}" class="w-full p-3 bg-slate-50 rounded-2xl text-xs outline-none border-2 border-transparent focus:border-orange-500 resize-none" rows="2" placeholder="Notas adicionales...">${safeEscapeHTML(log.notes || log.activities || '')}</textarea>
                  </div>

                  <button id="btn-save-log-${s.id}" onclick="App.saveRoutineLog('${s.id}')" 
                    data-mood="${log.mood || 'normal'}"
                    data-food="${log.food || log.eating || ''}"
                    data-sleep="${log.sleep || log.sleeping || log.nap || ''}"
                    class="w-full py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-600 transition-all shadow-lg flex items-center justify-center gap-2">
                    <i data-lucide="save" class="w-4 h-4"></i> Guardar Reporte Completo
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    console.error(e);
    container.innerHTML = '<div class="text-center p-8"><p class="text-rose-500">Error al cargar la rutina.</p></div>';
  }
}

export function updateRoutineField(studentId, field, value) {
  const saveBtn = document.getElementById(`btn-save-log-${studentId}`);
  if (!saveBtn) return;

  saveBtn.dataset[field] = value;

  if (field === 'mood') {
    const buttons = document.querySelectorAll(`.routine-mood-btn-${studentId}`);
    buttons.forEach(b => {
      b.classList.remove('bg-orange-500', 'border-orange-500', 'scale-105', 'shadow-lg', 'text-white');
      b.classList.add('bg-slate-50', 'border-slate-50');
      if (b.dataset.mood === value) {
        b.classList.add('bg-orange-500', 'border-orange-500', 'scale-105', 'shadow-lg', 'text-white');
        b.classList.remove('bg-slate-50', 'border-slate-50');
      }
    });
  }
}

export async function saveRoutineLog(studentId) {
  const btn = document.getElementById(`btn-save-log-${studentId}`);
  const note = document.getElementById(`note-${studentId}`)?.value;
  if (!btn) return;

  const mood = btn.dataset.mood || 'normal';
  const food = btn.dataset.food || document.getElementById(`food-${studentId}`)?.value || '';
  const sleep = btn.dataset.sleep || document.getElementById(`sleep-${studentId}`)?.value || '';

  btn.disabled = true;
  const originalContent = btn.innerHTML;
  btn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Guardando...';
  if (window.lucide) window.lucide.createIcons();

  try {
    const classroom = AppState.get('classroom');
    const payload = {
      student_id: studentId,
      classroom_id: classroom.id,
      date: new Date().toISOString().split('T')[0],
      mood: mood,
      food: food,
      nap: sleep,      // API unifies this
      notes: note
    };

    await MaestraApi.upsertDailyLog(payload);
    safeToast('Reporte guardado con éxito', 'success');

    const student = (AppState.get('students') || []).find(s => s.id == studentId);
    if (student?.parent_id) {
      sendPush({
        user_id: student.parent_id,
        title: 'Reporte de Rutina 📝',
        message: `La maestra ha actualizado el reporte diario de ${student.name}.`,
        link: 'panel_padres.html#daily-routine'
      }).catch(err => console.warn('Error notificando rutina:', err));
    }

  } catch (err) {
    console.error('Error saving routine:', err);
    safeToast('Error al guardar reporte', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalContent;
    if (window.lucide) window.lucide.createIcons();
  }
}

// Global modal open routine for new
export function openNewRoutineModal() {
  safeToast('Usa "Guardar Reporte" en cada tarjeta para registrar la rutina.', 'info');
}
