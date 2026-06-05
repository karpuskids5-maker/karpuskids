import { supabase } from '/js/shared/supabase.js';
import { AppState } from '../state.js';
import { MaestraApi } from '../api.js';
import { UI } from './ui.js';
import { Helpers } from '/js/shared/helpers.js';

const { safeToast, safeEscapeHTML, Modal } = UI;

const _saving = {};

/**
 * Lógica de 12 horas: El reporte del día solo es válido si fue guardado hace menos de 12 horas.
 */
function _isWithin12h(dateStr) {
  if (!dateStr) return false;
  const saved = new Date(dateStr);
  return (Date.now() - saved.getTime()) < 12 * 60 * 60 * 1000;
}

/**
 * Vista de rutina mejorada — Tarjetas de estudiantes con progreso visual (burbujas).
 * Optimizada para móvil y con sistema de alertas.
 */
export async function initRoutine() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('tab-daily-routine');
  if (!container) return;

  // Mostrar esqueleto de carga para feedback instantáneo
  container.innerHTML = `
    <div class="animate-pulse space-y-6">
      <div class="h-12 bg-slate-100 rounded-2xl w-1/3"></div>
      <div class="h-24 bg-slate-50 rounded-[2rem]"></div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        ${Array(5).fill('<div class="h-40 bg-slate-50 rounded-[2rem]"></div>').join('')}
      </div>
    </div>
  `;

  try {
    // 1. Obtener estudiantes del AppState (ya cargados en showClassroomDetail)
    const students = AppState.get('students') || [];
    const today    = new Date().toISOString().split('T')[0];

    // 2. Cargar logs de hoy usando MaestraApi (Capa de abstracción)
    const { data: todayLogs, error } = await supabase
      .from('daily_logs')
      .select('id, student_id, date, mood, food, nap, eating, sleeping, activities, notes, created_at, infant_data')
      .eq('classroom_id', classroom.id)
      .eq('date', today);

    if (error) throw error;

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
    let currentPeriod = 'morning'; 
    if (hour >= 12 && hour < 16) currentPeriod = 'afternoon';
    if (hour >= 16) currentPeriod = 'late';

    const periodNames = { morning: 'Mañana', afternoon: 'Tarde', late: 'Tardecita' };
    
    // Estudiantes pendientes en el periodo actual
    const pendingStudents = students.filter(s => {
      const log = logsMap[s.id];
      if (!log || !_isWithin12h(log.created_at)) return true;
      
      // Validar si falta algún campo crítico según el periodo
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
              <h3 class="text-xl font-black text-slate-800">📝 Rutina Diaria</h3>
              <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">${todayLabel}</p>
            </div>
            <div class="flex flex-col items-end gap-2">
               <span class="text-[10px] font-black text-orange-600 bg-orange-50 border border-orange-100 px-3 py-1 rounded-full uppercase tracking-wider">
                Periodo: ${periodNames[currentPeriod]}
              </span>
              <div class="flex gap-4">
                <button onclick="App.openBulkRoutineModal()" class="text-[10px] font-black text-blue-600 hover:text-blue-700 underline uppercase tracking-widest">
                  Rutina General (Bulk)
                </button>
                <button onclick="Routine.publishAll()" id="btnPublishAll" class="text-[10px] font-black text-emerald-600 hover:text-emerald-700 underline uppercase tracking-widest hidden">
                  Publicar Todos
                </button>
              </div>
            </div>
          </div>

          <!-- Alarma Visual si hay pendientes -->
          ${pendingStudents.length > 0 ? `
            <div class="bg-orange-50 border-2 border-orange-100 rounded-[2rem] p-5 flex items-center gap-4 animate-pulse-subtle">
              <div class="w-12 h-12 bg-orange-500 text-white rounded-2xl flex items-center justify-center text-2xl shrink-0 shadow-lg shadow-orange-200">⚠️</div>
              <div class="flex-1">
                <p class="text-sm font-black text-orange-800">Reportes Pendientes</p>
                <p class="text-xs font-bold text-orange-600/80">Faltan ${pendingStudents.length} estudiantes por reportar en este periodo.</p>
              </div>
              <div class="flex -space-x-3 overflow-hidden">
                ${pendingStudents.slice(0, 3).map(s => `
                  <div class="w-8 h-8 rounded-full border-2 border-white bg-slate-200 overflow-hidden shadow-sm">
                    ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : `<div class="w-full h-full flex items-center justify-center text-[10px] font-black text-slate-500">${s.name.charAt(0)}</div>`}
                  </div>
                `).join('')}
                ${pendingStudents.length > 3 ? `<div class="w-8 h-8 rounded-full border-2 border-white bg-orange-100 flex items-center justify-center text-[10px] font-black text-orange-600 shadow-sm">+${pendingStudents.length - 3}</div>` : ''}
              </div>
            </div>
          ` : `
            <div class="bg-emerald-50 border-2 border-emerald-100 rounded-[2rem] p-5 flex items-center gap-4">
              <div class="w-12 h-12 bg-emerald-500 text-white rounded-2xl flex items-center justify-center text-2xl shrink-0 shadow-lg shadow-emerald-200">✅</div>
              <div>
                <p class="text-sm font-black text-emerald-800">¡Todo al día!</p>
                <p class="text-xs font-bold text-emerald-600/80">Has completado los reportes de este periodo.</p>
              </div>
            </div>
          `}
        </div>

        <!-- Grid de Estudiantes (Cards) -->
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" id="routineStudentsGrid">
          ${students.map(s => _renderStudentRoutineCard(s, logsMap[s.id] || {})).join('')}
        </div>

        <div class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm text-center border-l-4 border-l-orange-500">
          <p class="text-xs text-slate-400 font-medium">
            💡 Toca a un estudiante para abrir su reporte de rutina individual.<br>
            Los emojis flotantes indican el progreso actual. Los reportes en <strong>Borrador</strong> no son visibles para los padres.
          </p>
        </div>
      </div>
    `;

    // Mostrar botón de publicar todo si hay borradores
    const hasDrafts = (todayLogs || []).some(l => l.status === 'draft');
    if (hasDrafts) document.getElementById('btnPublishAll')?.classList.remove('hidden');

    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    console.error('Error en initRoutine:', e);
    container.innerHTML = Helpers.errorState('Error al cargar la rutina', 'App.initRoutine()');
  }
}

/**
 * Publicar todos los borradores del aula hoy
 */
export async function publishAll() {
  const students = AppState.get('students') || [];
  const today = new Date().toISOString().split('T')[0];
  const classroom = AppState.get('classroom');

  try {
    const { data: drafts } = await supabase
      .from('daily_logs')
      .select('id')
      .eq('classroom_id', classroom.id)
      .eq('date', today)
      .eq('status', 'draft');

    if (!drafts?.length) return;

    if (!confirm(`¿Publicar ${drafts.length} reportes? Los padres recibirán las notificaciones ahora.`)) return;

    Helpers.showLoader('Publicando reportes...');
    await MaestraApi.publishDailyLogs(drafts.map(d => d.id));
    
    Helpers.hideLoader();
    UI.safeToast('Reportes publicados con éxito', 'success');
    await initRoutine();

  } catch (e) {
    Helpers.hideLoader();
    UI.safeToast('Error al publicar reportes', 'error');
  }
}

/**
 * Renderiza la tarjeta individual del estudiante para la sección de rutina.
 */
function _renderStudentRoutineCard(s, log) {
  const isValid = _isWithin12h(log.created_at);
  const mood  = isValid && log.mood ? log.mood : null;
  const food  = isValid && log.food ? log.food : null;
  const sleep = isValid && log.nap  ? log.nap  : null;
  const note  = isValid && log.notes ? true : false;
  const isDraft = isValid && log.status === 'draft';
  const isInfant = s.age_type === 'meses' || s.age_type === 'mes';
  const infantEvents = isValid && log.infant_data ? log.infant_data : [];

    const moodEmojis = { feliz: '😊', normal: '😐', triste: '😢', enojado: '😡' };
    const foodEmojis = { todo: '🍽️', poco: '🍲', nada: '🙅' };
    const sleepEmojis = { si: '💤', no: '☀️' };

  return `
    <div onclick="App.openStudentRoutine('${s.id}')" 
      class="group relative bg-white rounded-[2rem] p-4 border-2 ${isDraft ? 'border-dashed border-orange-200 bg-orange-50/20' : 'border-slate-100'} hover:border-orange-400 hover:shadow-xl hover:shadow-orange-100 transition-all cursor-pointer active:scale-95 flex flex-col items-center text-center overflow-hidden">
      
      <!-- Badge de Borrador -->
      ${isDraft ? `
        <div class="absolute top-2 left-2 z-10">
          <span class="px-2 py-0.5 bg-orange-500 text-white text-[8px] font-black uppercase rounded-lg shadow-sm">Borrador</span>
        </div>
      ` : ''}

      <!-- Burbujas de Emojis Flotantes (Status) -->
      <div class="absolute top-2 right-2 flex flex-col gap-1 z-10">
        ${mood ? `<div class="w-7 h-7 bg-orange-50 rounded-full flex items-center justify-center text-sm shadow-sm border border-orange-100 animate-bounce-subtle">${moodEmojis[mood]}</div>` : ''}
        ${isInfant && infantEvents.length > 0 ? `<div class="w-7 h-7 bg-blue-50 rounded-full flex items-center justify-center text-sm shadow-sm border border-blue-100 animate-bounce-subtle">🍼</div>` : ''}
        ${!isInfant && food ? `<div class="w-7 h-7 bg-emerald-50 rounded-full flex items-center justify-center text-sm shadow-sm border border-emerald-100 animate-bounce-subtle" style="animation-delay: 0.2s">${foodEmojis[food]}</div>` : ''}
        ${sleep ? `<div class="w-7 h-7 bg-indigo-50 rounded-full flex items-center justify-center text-sm shadow-sm border border-indigo-100 animate-bounce-subtle" style="animation-delay: 0.4s">${sleepEmojis[sleep]}</div>` : ''}
        ${note ? `<div class="w-7 h-7 bg-slate-50 rounded-full flex items-center justify-center text-xs shadow-sm border border-slate-100 animate-bounce-subtle" style="animation-delay: 0.6s">📝</div>` : ''}
      </div>

      <!-- Avatar -->
      <div class="w-20 h-20 rounded-[1.5rem] bg-orange-50 border-4 border-white shadow-inner overflow-hidden mb-3 group-hover:scale-110 transition-transform duration-500 flex items-center justify-center font-black text-2xl text-orange-300">
        ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
      </div>

      <!-- Info -->
      <h4 class="text-sm font-black text-slate-800 leading-tight mb-1 line-clamp-2">${safeEscapeHTML(s.name)}</h4>
      <p class="text-[10px] font-black text-slate-400 uppercase tracking-tighter">${s.age} ${s.age_type || 'años'}</p>
      
      <!-- Progress Indicator (Dot) -->
      <div class="flex gap-1 mt-auto pt-2">
        <div class="w-1.5 h-1.5 rounded-full ${mood ? 'bg-orange-400' : 'bg-slate-200'}"></div>
        <div class="w-1.5 h-1.5 rounded-full ${isInfant ? (infantEvents.length ? 'bg-blue-400' : 'bg-slate-200') : (food ? 'bg-emerald-400' : 'bg-slate-200')}"></div>
        <div class="w-1.5 h-1.5 rounded-full ${sleep ? 'bg-indigo-400' : 'bg-slate-200'}"></div>
      </div>
    </div>
  `;
}

export async function openStudentRoutine(studentId) {
  const student = AppState.get('students').find(s => s.id == studentId);
  if (!student) return;

  const today = new Date().toISOString().split('T')[0];
  const { data: log } = await supabase.from('daily_logs').select('*').eq('student_id', studentId).eq('date', today).maybeSingle();
  
  const isInfant = student.age_type === 'meses' || student.age_type === 'mes';
  const modalId = 'routineStudentModal';

  const content = isInfant 
    ? _renderInfantRoutineUI(student, log, modalId)
    : _renderStandardRoutineUI(student, log, modalId);

  Modal.open(modalId, content);
  if (window.lucide) window.lucide.createIcons();
}

function _renderInfantRoutineUI(student, log, modalId) {
  const infantData = log?.infant_data || [];
  const lastEntry = [...infantData].reverse()[0];
  
  const now = new Date();
  const currentHourStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

  const timeOptions = [];
  for(let h=7; h<=18; h++) {
    for(let m=0; m<60; m+=30) {
      const hh = h > 12 ? h-12 : h;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const time = `${hh}:${m.toString().padStart(2, '0')} ${ampm}`;
      timeOptions.push(time);
    }
  }

  const activities = ["Sensorial", "Motricidad", "Música", "Lectura", "Juego libre", "Estimulación temprana", "Arte"];

  return `
    <div class="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col max-h-[95vh]">
      <div class="bg-gradient-to-r from-blue-500 to-indigo-600 p-6 text-white relative">
        <button onclick="Modal.close('${modalId}')" class="absolute top-4 right-4 p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-2xl bg-white/20 border-2 border-white/30 overflow-hidden shadow-inner shrink-0 flex items-center justify-center font-black text-2xl text-white">
            ${student.avatar_url ? `<img src="${student.avatar_url}" class="w-full h-full object-cover">` : student.name.charAt(0)}
          </div>
          <div>
            <h3 class="text-xl font-black">${safeEscapeHTML(student.name)}</h3>
            <p class="text-xs font-bold text-blue-100 uppercase tracking-widest">Registro del Bebé 🍼</p>
          </div>
        </div>
      </div>

      <div class="p-6 space-y-6 overflow-y-auto custom-scrollbar bg-slate-50/50">
        
        <!-- Bloque 1: Hora -->
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Hora del Registro</label>
          <select id="infantTime" class="w-full p-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-400 transition-all">
            ${timeOptions.map(t => `<option value="${t}" ${t === currentHourStr ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>

        <!-- Bloque 2: Leche -->
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Leche (Onzas)</label>
          <div class="flex items-center gap-4">
            <input type="number" id="infantMilk" min="0" max="12" step="0.5" placeholder="0" class="flex-1 p-3.5 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-lg outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-400 transition-all">
            <span class="font-black text-slate-400 uppercase text-[10px] tracking-widest">oz</span>
          </div>
        </div>

        <!-- Bloque 3: Comida -->
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Alimentación</label>
          <div class="grid grid-cols-2 gap-2">
            ${[
              {id: 'none', label: 'No comió', emoji: '🙅'},
              {id: 'little', label: 'Poco', emoji: '🍲'},
              {id: 'half', label: 'La mitad', emoji: '🥣'},
              {id: 'all', label: 'Todo', emoji: '🍽️'}
            ].map(f => `
              <label class="relative flex items-center gap-3 p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl cursor-pointer hover:bg-blue-50 transition-all group">
                <input type="radio" name="infantFood" value="${f.id}" class="hidden peer">
                <div class="w-5 h-5 rounded-full border-2 border-slate-300 peer-checked:border-blue-500 peer-checked:bg-blue-500 flex items-center justify-center transition-all">
                  <div class="w-2 h-2 bg-white rounded-full"></div>
                </div>
                <span class="text-xl">${f.emoji}</span>
                <span class="text-xs font-bold text-slate-600">${f.label}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Bloque 4: Actividades -->
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Actividades</label>
          <div class="flex flex-wrap gap-2">
            ${activities.map(a => `
              <label class="relative cursor-pointer group">
                <input type="checkbox" name="infantActivity" value="${a}" class="hidden peer">
                <span class="block px-4 py-2 bg-slate-50 border-2 border-slate-100 rounded-xl text-xs font-bold text-slate-500 peer-checked:bg-indigo-50 peer-checked:border-indigo-400 peer-checked:text-indigo-700 transition-all">
                  ${a}
                </span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Bloque 5: Comentario -->
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Observación adicional 📝</label>
          <textarea id="infantNotes" rows="2" class="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium outline-none focus:border-blue-400 transition-all resize-none" placeholder="Escribe algo importante..."></textarea>
        </div>

        <!-- Historial Rápido -->
        <div class="pt-2">
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-3">Último Registro</label>
          ${lastEntry ? `
            <div class="p-4 bg-white rounded-3xl border border-slate-100 flex items-center gap-3">
              <div class="w-10 h-10 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center font-black">🍼</div>
              <div class="flex-1 min-w-0">
                <p class="text-[10px] font-black text-slate-400 uppercase">${new Date(lastEntry.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p>
                <p class="text-xs font-bold text-slate-700 truncate">${lastEntry.comment || 'Registro de rutina'}</p>
              </div>
            </div>
          ` : '<p class="text-xs text-slate-400 italic ml-1">No hay registros hoy.</p>'}
        </div>
      </div>

      <div class="p-6 bg-white border-t border-slate-100">
        <button onclick="App.saveInfantEntry('${student.id}')" id="btnSaveInfant"
          class="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2 active:scale-95">
          <i data-lucide="save" class="w-4 h-4"></i> Guardar Registro
        </button>
      </div>
    </div>
  `;
}

function _renderStandardRoutineUI(student, log, modalId) {
  const isValid = log && _isWithin12h(log.created_at);
  const currentMood  = isValid ? (log?.mood || '') : '';
  const currentFood  = isValid ? (log?.food || '') : '';
  const currentSleep = isValid ? (log?.nap || '') : '';
  const currentNotes = isValid ? (log?.notes || '') : '';

    const moodEmojis = { feliz: '😊', normal: '😐', triste: '😢', enojado: '😡' };
    const foodEmojis = { todo: '🍽️', poco: '🍲', nada: '🙅' };
    const sleepEmojis = { si: '💤', no: '☀️' };

  return `
    <div class="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-fadeIn flex flex-col max-h-[90vh]">
      <!-- Header Colorido -->
      <div class="bg-gradient-to-r from-orange-500 to-pink-500 p-6 text-white relative">
        <button onclick="Modal.close('${modalId}')" class="absolute top-4 right-4 p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-2xl bg-white/20 border-2 border-white/30 overflow-hidden shadow-inner shrink-0 flex items-center justify-center font-black text-2xl text-white">
            ${student.avatar_url ? `<img src="${student.avatar_url}" class="w-full h-full object-cover">` : student.name.charAt(0)}
          </div>
          <div>
            <h3 class="text-xl font-black">${safeEscapeHTML(student.name)}</h3>
            <p class="text-xs font-bold text-orange-100 uppercase tracking-widest">Reporte de Rutina</p>
          </div>
        </div>
      </div>

      <div class="p-6 space-y-6 overflow-y-auto custom-scrollbar">
        <!-- 1. Estado de Ánimo -->
        <div class="space-y-3">
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">¿Cómo está de ánimo? ☀️</label>
          <div class="grid grid-cols-4 gap-2">
            ${Object.entries(moodEmojis).map(([v, e]) => `
              <button onclick="App.updateRoutineFieldInModal('${student.id}','mood','${v}')"
                class="routine-modal-mood-${student.id} flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all active:scale-90
                ${currentMood === v ? 'border-orange-400 bg-orange-50 shadow-md' : 'border-slate-100 bg-slate-50'}"
                data-val="${v}">
                <span class="text-2xl mb-1">${e}</span>
                <span class="text-[9px] font-black uppercase text-slate-500">${v}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- 2. Alimentación -->
        <div class="space-y-3">
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">¿Cómo comió hoy? 🍽️</label>
          <div class="grid grid-cols-3 gap-2">
            ${Object.entries(foodEmojis).map(([v, e]) => `
              <button onclick="App.updateRoutineFieldInModal('${student.id}','food','${v}')"
                class="routine-modal-food-${student.id} flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all active:scale-90
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
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">¿Hizo su siesta? 💤</label>
          <div class="grid grid-cols-2 gap-3">
            ${Object.entries(sleepEmojis).map(([v, e]) => `
              <button onclick="App.updateRoutineFieldInModal('${student.id}','sleep','${v}')"
                class="routine-modal-sleep-${student.id} flex items-center justify-center gap-3 p-4 rounded-2xl border-2 transition-all active:scale-90
                ${currentSleep === v ? 'border-indigo-400 bg-indigo-50 shadow-md' : 'border-slate-100 bg-slate-50'}"
                data-val="${v}">
                <span class="text-2xl">${e}</span>
                <span class="text-xs font-black uppercase text-slate-600">${v === 'si' ? 'Durmió' : 'No durmió'}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- 4. Notas -->
        <div class="space-y-3">
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Observaciones adicionales 📝</label>
          <textarea id="modal-note-${student.id}" 
            class="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium outline-none focus:border-orange-400 transition-all resize-none"
            rows="3" placeholder="Ej: Estuvo muy participativo hoy...">${safeEscapeHTML(currentNotes)}</textarea>
        </div>
      </div>

      <div class="p-6 pt-0 mt-auto">
        <button onclick="App.saveRoutineInModal('${student.id}')" id="btnSaveModalRoutine"
          class="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 flex items-center justify-center gap-2">
          <i data-lucide="check-circle" class="w-4 h-4"></i> Guardar y Cerrar
        </button>
      </div>
    </div>
  `;
}

/**
 * Registra un evento de bebé (leche, siesta, vomito, pañal) - Deprecado por saveInfantEntry pero mantenido por compatibilidad
 */
export async function registerInfantEvent(sid, type, val) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const classroom = AppState.get('classroom');
    
    const updatedLog = await MaestraApi.upsertDailyLog({
      student_id: sid,
      classroom_id: classroom.id,
      date: today,
      infant_event: { type, value: val }
    });
    
    safeToast(`Registro de ${type} guardado`);
    
    const modalContent = _renderInfantRoutineUI(
      AppState.get('students').find(s => s.id == sid),
      updatedLog,
      'routineStudentModal'
    );
    document.getElementById('routineStudentModal-inner').innerHTML = modalContent;
    if (window.lucide) window.lucide.createIcons();

  } catch (e) {
    safeToast('Error al registrar evento', 'error');
  }
}

/**
 * Nueva lógica para guardar entrada estructurada de bebé
 */
export async function saveInfantEntry(sid) {
  const btn = document.getElementById('btnSaveInfant');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i> Guardando...'; }
  if (window.lucide) window.lucide.createIcons();

  try {
    const time = document.getElementById('infantTime').value;
    const milk = parseFloat(document.getElementById('infantMilk').value) || 0;
    const food = document.querySelector('input[name="infantFood"]:checked')?.value;
    const activities = Array.from(document.querySelectorAll('input[name="infantActivity"]:checked')).map(cb => cb.value);
    const notes = document.getElementById('infantNotes').value.trim();

    // Generar comentario inteligente
    let commentParts = [];
    if (milk > 0) commentParts.push(`Tomó ${milk} oz de leche.`);
    else if (milk === 0 && document.getElementById('infantMilk').value !== '') commentParts.push(`No quiso tomar leche.`);

    if (food) {
      const foodMap = { none: 'No quiso comer.', little: 'Comió una pequeña cantidad.', half: 'Comió la mitad de su comida.', all: 'Comió toda su comida.' };
      commentParts.push(foodMap[food]);
    }

    if (activities.length > 0) {
      commentParts.push(`Participó en actividades de ${activities.join(', ').toLowerCase()}.`);
    }

    if (notes) commentParts.push(notes);

    const finalComment = commentParts.join(' ');

    const today = new Date().toISOString().split('T')[0];
    const classroom = AppState.get('classroom');

    await MaestraApi.upsertDailyLog({
      student_id: sid,
      classroom_id: classroom.id,
      date: today,
      infant_event: {
        type: 'structured_entry',
        time, milk, food, activities, notes,
        comment: finalComment
      }
    });

    safeToast('Registro guardado correctamente');
    Modal.close('routineStudentModal');
    initRoutine();

  } catch (e) {
    console.error(e);
    safeToast('Error al guardar el registro', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save" class="w-4 h-4"></i> Guardar Registro'; }
    if (window.lucide) window.lucide.createIcons();
  }
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
  const mood = document.querySelector(`.routine-modal-mood-${sid}.border-orange-400`)?.dataset.val;
  const food = document.querySelector(`.routine-modal-food-${sid}.border-emerald-400`)?.dataset.val;
  const sleep = document.querySelector(`.routine-modal-sleep-${sid}.border-indigo-400`)?.dataset.val;

  const updates = { notes: note };
  if (mood) updates.mood = mood;
  if (food) updates.food = food;
  if (sleep) updates.nap = sleep;

  try {
    const today = new Date().toISOString().split('T')[0];
    const classroom = AppState.get('classroom');

    await MaestraApi.upsertDailyLog({
      student_id: sid,
      classroom_id: classroom.id,
      date: today,
      ...updates
    });

    safeToast('Reporte guardado');
    Modal.close('routineStudentModal');
    initRoutine(); 
  } catch (e) {
    safeToast('Error al guardar', 'error');
  }
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
            <label class="text-[10px] font-black uppercase text-slate-400 ml-1">Ánimo 😊</label>
            <select id="bulkMood" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-orange-400">
              <option value="feliz">Feliz 😊</option>
              <option value="normal">Normal 😐</option>
            </select>
          </div>
          <div class="space-y-2">
            <label class="text-[10px] font-black uppercase text-slate-400 ml-1">Comida 🍽️</label>
            <select id="bulkFood" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-orange-400">
              <option value="todo">Todo 😋</option>
              <option value="poco">Poco 🍲</option>
            </select>
          </div>
        </div>

        <div class="space-y-2">
          <label class="text-[10px] font-black uppercase text-slate-400 ml-1">Siesta 💤</label>
          <select id="bulkSleep" class="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-orange-400">
            <option value="si">Durmió 💤</option>
            <option value="no">No durmió ☀️</option>
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
    
    if (window.WallModule) {
      window.WallModule.loadPosts(); 
    }
  } catch (_) {
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

  } catch (_) {
    safeToast('Error al guardar. Intenta de nuevo.', 'error');
  } finally {
    _saving[studentId + field] = false;
  }
}

export function openNewRoutineModal() {
  safeToast('Toca a un estudiante para reportar su rutina diaria.', 'info');
}
