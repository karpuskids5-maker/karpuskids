import { supabase, sendPush, emitEvent } from '/js/shared/supabase.js';
import { TABLES } from '/js/shared/constants.js';
import { AppState } from '../state.js';
import { MaestraApi } from '../api.js';
import { UI } from './ui.js';
import { notifyParents } from '/js/shared/notify-feedback.js';
import { Helpers } from '/js/shared/helpers.js';

const { safeToast, safeEscapeHTML, Modal } = UI;

export async function initTasks() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('tab-tasks');
  if (!container) return;

  container.innerHTML = `
    <div class="flex justify-between items-center mb-8">
      <h3 class="text-2xl font-black text-slate-800 flex items-center gap-3">Mochila de Tareas</h3>
      <button onclick="App.openNewTaskModal()" class="px-6 py-3 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-orange-200 hover:bg-orange-700 transition-all flex items-center gap-2">
        <i data-lucide="plus-circle" class="w-5 h-5"></i> Nueva Tarea
      </button>
    </div>
    <div id="tasksListContainer" class="space-y-4">
      <div class="animate-pulse space-y-4">
        <div class="h-32 bg-slate-50 rounded-3xl"></div>
        <div class="h-32 bg-slate-50 rounded-3xl"></div>
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();

  const listContainer = document.getElementById('tasksListContainer');
  try {
    const tasks = await MaestraApi.getTasksByClassroom(classroom.id, AppState.get('activePeriod')?.id);
    let subjectMap = {};
    try {
      const periodId = AppState.get('activePeriod')?.id;
      if (periodId) {
        const cfgList = await MaestraApi.getPeriodConfig(periodId);
        (cfgList || []).forEach(c => { subjectMap[String(c.id)] = c.subject_name; });
      }
    } catch (_) {}

    if (!tasks.length) {
      listContainer.innerHTML = '<div class="text-center p-8 text-slate-500">Aún no has asignado tareas.</div>';
      return;
    }

    // Cargar conteo de entregas pendientes de revisar
    const taskIds = tasks.map(t => t.id);
    const { data: pendingSubmissions } = await supabase
      .from('task_evidences')
      .select('task_id')
      .in('task_id', taskIds)
      .neq('status', 'graded');

    const pendingMap = {};
    (pendingSubmissions || []).forEach(s => {
      pendingMap[s.task_id] = (pendingMap[s.task_id] || 0) + 1;
    });

    listContainer.innerHTML = tasks.map(t => {
      const dueDate = new Date(t.due_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
      const pendingCount = pendingMap[t.id] || 0;
      return `
      <div class="bg-white p-6 rounded-3xl border-2 border-slate-50 shadow-sm hover:shadow-md transition-all group">
        <div class="flex justify-between items-start mb-4">
          <div>
            <h4 class="font-black text-slate-800 text-base mb-1">${safeEscapeHTML(t.title)}</h4>
            ${t.config_id && subjectMap[String(t.config_id)] ? `<span class="inline-block mb-1 px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black uppercase">${safeEscapeHTML(subjectMap[String(t.config_id)])}</span>` : ''}
            <p class="text-xs font-bold text-slate-400 flex items-center gap-1.5"><i data-lucide="calendar" class="w-3 h-3"></i> Entrega: ${dueDate}</p>
          </div>
          <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onclick="App.openEditTaskModal('${t.id}')" class="p-2 bg-slate-100 text-slate-500 rounded-lg hover:bg-blue-100 hover:text-blue-600 transition-colors" title="Editar Tarea">
              <i data-lucide="edit" class="w-4 h-4"></i>
            </button>
            <button onclick="App.deleteTask('${t.id}')" class="p-2 bg-slate-100 text-slate-500 rounded-lg hover:bg-red-100 hover:text-red-600 transition-colors" title="Eliminar Tarea">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
        <p class="text-sm text-slate-600 line-clamp-2">${safeEscapeHTML(t.description)}</p>
        <div class="flex justify-between items-center pt-4 border-t border-slate-50 mt-4">
          <div>
            ${t.file_url ? '<span class="px-2 py-1 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-full flex items-center gap-1"><i data-lucide="paperclip" class="w-3 h-3"></i> Adjunto</span>' : ''}
          </div>
          <button onclick="App.viewTaskSubmissions('${t.id}')" class="relative px-4 py-2 bg-orange-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-orange-700 transition-all shadow-sm flex items-center gap-2">
            Ver Entregas
            ${pendingCount > 0 ? `<span class="absolute -top-2 -right-2 w-5 h-5 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center shadow-sm animate-pulse">${pendingCount}</span>` : ''}
          </button>
        </div>
      </div>
    `}).join('');
    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    listContainer.innerHTML = Helpers.errorState('Error al cargar tareas', 'App.initTasks()');
    if (window.lucide) window.lucide.createIcons();
  }
}

export async function openEditTaskModal(taskId) {
  try {
    const { data: task, error } = await supabase.from('tasks').select('id, title, description, due_date, grading_system, file_url, classroom_id, config_id').eq('id', taskId).single();
    if (error) throw error;
    openNewTaskModal(task);
  } catch (err) {
    safeToast('No se pudo cargar la tarea para editar', 'error');
  }
}

export async function deleteTask(taskId) {
  if (!confirm('¿Eliminar esta tarea? Los datos se perderán permanentemente.')) return;
  try {
    await MaestraApi.deleteTask(taskId);
    safeToast('Tarea eliminada correctamente');
    await initTasks();
  } catch (err) {
    safeToast('No se pudo eliminar la tarea', 'error');
  }
}

export async function openNewTaskModal(taskToEdit = null) {
  const isEditing = taskToEdit !== null;
  const modalId = 'newTaskModal';
  const modalTitle = isEditing ? 'Editar Tarea' : 'Asignar Nueva Tarea';
  const buttonText = isEditing ? 'Guardar Cambios' : 'Asignar y Notificar';

  let periodSubjects = [];
  try {
    const classroom = AppState.get('classroom');
    const periodRes = await supabase.rpc('get_active_period', { p_classroom_id: classroom?.id });
    const period = periodRes?.data;
    if (period?.found) {
      periodSubjects = await MaestraApi.getPeriodConfig(period.id);
    } else {
      const activePeriod = AppState.get('activePeriod');
      if (activePeriod?.id) periodSubjects = await MaestraApi.getPeriodConfig(activePeriod.id);
    }
  } catch (_) {}

  const content = `
    <div class="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col max-h-[90vh]">
      <div class="flex justify-between items-start mb-6">
        <h3 class="text-2xl font-black text-slate-800">${modalTitle}</h3>
        <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
          <i data-lucide="x" class="w-6 h-6 text-slate-400"></i>
        </button>
      </div>
      <form id="taskForm" class="space-y-5 overflow-y-auto pr-2 flex-1">
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Tiítulo de la Tarea</label>
          <input type="text" id="taskTitle" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-orange-400 outline-none" required>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Descripcion / Instrucciones</label>
          <textarea id="taskDesc" rows="5" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-orange-400 outline-none resize-none" placeholder="Explica qué deben hacer los alumnos..." required></textarea>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Fecha de Entrega</label>
          <input type="date" id="taskDueDate" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-orange-400 outline-none" required>
        </div>
        ${periodSubjects.length ? `
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Área / Materia (Opcional)</label>
          <select id="taskConfig" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-orange-400 outline-none">
            <option value="">— Sin área —</option>
            ${periodSubjects.map(s => `<option value="${s.id}">${safeEscapeHTML(s.subject_name)}</option>`).join('')}
          </select>
        </div>` : ''}
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Adjuntar Archivo (Opcional)</label>
          <div class="relative">
            <input type="file" id="taskFileInput" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" accept="image/*,video/*,.pdf,.doc,.docx">
            <div class="bg-slate-50 p-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-orange-300 transition-all flex items-center justify-center gap-3">
              <i data-lucide="paperclip" class="w-5 h-5 text-slate-400"></i>
              <span id="taskFileName" class="text-sm font-medium text-slate-500">Seleccionar archivo...</span>
            </div>
          </div>
        </div>
      </form>
      <div class="pt-6 mt-auto border-t border-slate-100">
        <button id="btnSaveTask" class="w-full py-4 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-orange-200 hover:bg-orange-700 transition-all flex items-center justify-center gap-2">
          <i data-lucide="${isEditing ? 'save' : 'send'}" class="w-5 h-5"></i> ${buttonText}
        </button>
      </div>
    </div>
  `;
  Modal.open(modalId, content);

  if (isEditing) {
    document.getElementById('taskTitle').value = taskToEdit.title;
    document.getElementById('taskDesc').value = taskToEdit.description;
    const dateVal = new Date(taskToEdit.due_date).toISOString().split('T')[0];
    document.getElementById('taskDueDate').value = dateVal;
    const cfgSel = document.getElementById('taskConfig');
    if (cfgSel && taskToEdit.config_id) cfgSel.value = taskToEdit.config_id;
    if (taskToEdit.file_url) {
        const fileName = taskToEdit.file_url.split('/').pop().split('?')[0];
        document.getElementById('taskFileName').textContent = decodeURIComponent(fileName);
        document.getElementById('taskFileName').classList.add('text-orange-600', 'font-bold');
    }
  }

  const fileInput = document.getElementById('taskFileInput');
  const fileNameEl = document.getElementById('taskFileName');
  fileInput.onchange = () => {
    if (fileInput.files.length > 0) {
      fileNameEl.textContent = fileInput.files[0].name;
      fileNameEl.classList.add('text-orange-600', 'font-bold');
    } else {
      fileNameEl.textContent = 'Seleccionar archivo...';
      fileNameEl.classList.remove('text-orange-600', 'font-bold');
    }
  };

  const saveBtn = document.getElementById('btnSaveTask');
  saveBtn.onclick = async () => {
    const title = document.getElementById('taskTitle').value;
    const description = document.getElementById('taskDesc').value;
    const dueDate = document.getElementById('taskDueDate').value;
    const file = fileInput.files[0];

    if (file && file.size > 50 * 1024 * 1024) { 
       return safeToast('El archivo es demasiado grande (máx 50MB)', 'error');
    }

    if (!title || !description || !dueDate) {
      return safeToast('Completa todos los campos requeridos.', 'warning');
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> ${isEditing ? 'Guardando...' : 'Asignando...'}`;
    requestAnimationFrame(() => window.lucide?.createIcons());

    try {
      let fileUrl = isEditing ? taskToEdit.file_url : null;
      const classroom = AppState.get('classroom');
      if (!classroom) throw new Error('No hay aula activa');

      if (file) {
        const filePath = `${classroom.id}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('classroom_media')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('classroom_media')
          .getPublicUrl(filePath);
        
        fileUrl = urlData.publicUrl;
      }

      const configId = document.getElementById('taskConfig')?.value || null;
      const payload = {
        classroom_id: classroom.id,
        title,
        description,
        due_date: dueDate,
        file_url: fileUrl,
        teacher_id: AppState.get('user').id,
        config_id: configId
      };
      
      if (isEditing) {
        await MaestraApi.updateTask(taskToEdit.id, payload);
        safeToast('Tarea actualizada correctamente');
      } else {
        await MaestraApi.createTask(payload);
        const students = AppState.get('students') || [];
        const classroomName = AppState.get('classroom').name;

        // Push with visual feedback
        notifyParents({
          students,
          title:   `📚 Nueva Tarea — ${classroomName}`,
          message: `"${payload.title}" · Entrega: ${payload.due_date}`,
          type:    'task',
          link:    'panel_padres.html',
          label:   payload.title
        });

        // Email via process-event
        emitEvent('task.created', {
          classroom_id: payload.classroom_id,
          title:        payload.title,
          due_date:     payload.due_date
        }).catch(() => {});

        safeToast('Tarea asignada correctamente');
      }

      Modal.close(modalId);
      await initTasks();

    } catch (err) {
      safeToast(`Error al ${isEditing ? 'actualizar' : 'crear'} la tarea.`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i data-lucide="${isEditing ? 'save' : 'send'}" class="w-5 h-5"></i> ${buttonText}`;
      requestAnimationFrame(() => window.lucide?.createIcons());
    }
  };
}

// ── Helper: verificar si el período activo del aula está abierto ──
async function _getPeriodStatus(classroomId) {
  try {
    const { data, error } = await supabase.rpc('get_active_period', { p_classroom_id: classroomId });
    // Si el RPC no existe (404) o hay error, asumir período abierto (permisivo)
    if (error) return { open: true, period: null };
    if (!data) return { open: true, period: null };
    return { open: data.status === 'open', period: data };
  } catch (_) {
    return { open: true, period: null };
  }
}

export async function viewTaskSubmissions(taskId) {
  const students = AppState.get('students') || [];
  const classroom = AppState.get('classroom');
  const modalId = 'taskSubmissionsModal';

  try {
    // Verificar estado del período ANTES de mostrar el modal
    const { open: periodOpen, period } = await _getPeriodStatus(classroom?.id);

    const { data: submissions, error: subError } = await supabase
      .from('task_evidences')
      .select('id, task_id, student_id, status, grade_letter, stars, score_v2, file_url, comment, created_at')
      .eq('task_id', taskId);
    if (subError) throw subError;

    const subMap = {};
    (submissions || []).forEach(s => subMap[s.student_id] = s);

    // Banner de período cerrado
    const closedBanner = !periodOpen ? `
      <div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3">
        <span class="text-xl">🔒</span>
        <div>
          <p class="text-xs font-black text-amber-800 uppercase tracking-wide">Período cerrado</p>
          <p class="text-[10px] text-amber-600 font-medium">Las calificaciones están bloqueadas. Solo la directora puede reabrirlo.</p>
        </div>
      </div>` : '';

    const content = `
      <div class="bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col max-h-[90vh]">
        <div class="flex justify-between items-start mb-6">
          <div>
            <h3 class="text-2xl font-black text-slate-800">Revisión de Entregas</h3>
            ${period ? `<p class="text-xs font-bold text-slate-400 mt-1">Período: ${safeEscapeHTML(period.name)} ${periodOpen ? '🟢 Abierto' : '🔒 Cerrado'}</p>` : ''}
          </div>
          <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <i data-lucide="x" class="w-6 h-6 text-slate-400"></i>
          </button>
        </div>
        ${closedBanner}
        <div class="space-y-4 overflow-y-auto pr-2 flex-1">
          ${students.length > 0 ? students.map(s => {
            const sub = subMap[s.id];
            const hasSubmission = sub && sub.file_url;
            const isGraded = sub && sub.status === 'graded';
            const safeUrl = hasSubmission ? encodeURI(sub.file_url) : '#';
            // Deshabilitar inputs si período cerrado
            const disabled = !periodOpen ? 'disabled class="opacity-50 cursor-not-allowed"' : '';
            const disabledSelect = !periodOpen ? 'disabled' : '';
            const btnDisabled = !periodOpen ? 'disabled title="Período cerrado" class="p-2 bg-slate-300 text-slate-500 rounded-lg cursor-not-allowed self-end"' : 'class="p-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all self-end" title="Guardar Calificación"';

            return `
              <div class="p-5 bg-slate-50 rounded-2xl border ${isGraded ? 'border-green-200 bg-green-50/30' : 'border-slate-100'}">
                <div class="flex items-center justify-between mb-4">
                  <div class="font-bold text-slate-800">${safeEscapeHTML(s.name)}</div>
                  ${hasSubmission 
                    ? `<a href="${safeUrl}" target="_blank" class="px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-200 transition-colors flex items-center gap-2">
                         <i data-lucide="download" class="w-3 h-3"></i> Ver Entrega
                       </a>`
                    : `<span class="px-3 py-1.5 bg-slate-100 text-slate-400 rounded-lg text-xs font-bold">Sin entregar</span>`
                  }
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                  <div class="md:col-span-2">
                    <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Retroalimentación</label>
                    <textarea id="feedback-${s.id}" ${disabled} rows="2"
                      class="w-full p-2 bg-white rounded-lg text-xs border border-slate-200 focus:ring-1 focus:ring-orange-400 outline-none ${!periodOpen ? 'opacity-50 cursor-not-allowed' : ''}"
                      placeholder="Escribe un comentario...">${safeEscapeHTML(sub?.comment || '')}</textarea>
                  </div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <div class="flex-1 min-w-[110px]">
                      <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Nota (0-100)</label>
                      <input type="number" id="score-${s.id}" min="0" max="100" step="0.1"
                        ${disabled} value="${sub?.score_v2 != null ? sub.score_v2 : ''}"
                        class="w-full p-2 rounded-lg text-xs font-black text-center bg-white border border-slate-200 focus:ring-1 focus:ring-orange-400 outline-none ${!periodOpen ? 'opacity-50 cursor-not-allowed' : ''}"
                        placeholder="0-100">
                    </div>
                    <div class="flex-1">
                      <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Letra</label>
                      <select id="grade-${s.id}" ${disabledSelect}
                        class="w-full p-2 rounded-lg text-xs font-bold bg-white border border-slate-200 ${!periodOpen ? 'opacity-50 cursor-not-allowed' : ''}">
                        <option value="">-</option>
                        <option value="A" ${sub?.grade_letter === 'A' ? 'selected' : ''}>A (Excelente)</option>
                        <option value="B" ${sub?.grade_letter === 'B' ? 'selected' : ''}>B (Bien)</option>
                        <option value="C" ${sub?.grade_letter === 'C' ? 'selected' : ''}>C (Suficiente)</option>
                        <option value="D" ${sub?.grade_letter === 'D' ? 'selected' : ''}>D (Mejorable)</option>
                      </select>
                    </div>
                    <div class="flex-1">
                      <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Estrellas</label>
                      <select id="stars-${s.id}" ${disabledSelect}
                        class="w-full p-2 rounded-lg text-xs font-bold bg-white border border-slate-200 ${!periodOpen ? 'opacity-50 cursor-not-allowed' : ''}">
                        ${[0,1,2,3,4,5].map(n => `<option value="${n}" ${sub?.stars === n ? 'selected' : ''}>${'⭐'.repeat(n) || 'Ninguna'}</option>`).join('')}
                      </select>
                    </div>
                    <button onclick="${periodOpen ? `App.submitGrade('${taskId}', '${s.id}')` : 'void(0)'}" ${btnDisabled}>
                      <i data-lucide="save" class="w-4 h-4"></i>
                    </button>
                  </div>
                </div>
                ${isGraded ? `<div class="text-xs text-green-600 font-bold mt-2 flex items-center gap-1"><i data-lucide="check-circle" class="w-3 h-3"></i> Calificado</div>` : ''}
              </div>
            `;
          }).join('') : '<div class="text-center p-4 text-slate-400">No hay alumnos en la clase.</div>'}
        </div>
      </div>
    `;
    Modal.open(modalId, content);
  } catch (err) {
    safeToast('Error al cargar entregas', 'error');
  }
}

export async function submitGrade(taskId, studentId) {
  // Verificar período antes de guardar
  const classroom = AppState.get('classroom');
  const { open: periodOpen } = await _getPeriodStatus(classroom?.id);
  if (!periodOpen) {
    safeToast('El período está cerrado. No se pueden modificar calificaciones.', 'warning');
    return;
  }

  const grade = document.getElementById(`grade-${studentId}`)?.value;
  const stars = document.getElementById(`stars-${studentId}`)?.value;
  const feedback = document.getElementById(`feedback-${studentId}`)?.value;
  const score = document.getElementById(`score-${studentId}`)?.value;

  const scoreVal = (score != null && score !== '') ? parseFloat(score) : null;
  if (!grade && scoreVal == null) return safeToast('Selecciona una letra o escribe la nota numérica (0-100).', 'warning');
  if (scoreVal != null && (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 100)) {
    return safeToast('La nota numérica debe ser entre 0 y 100.', 'warning');
  }

  try {
    await MaestraApi.gradeTask(taskId, studentId, grade, parseInt(stars), feedback, score);

    const student = (AppState.get('students') || []).find(s => s.id === studentId);
    if (student?.parent_id) {
      const nota = scoreVal != null ? `${scoreVal}/100` : grade;
      sendPush({
        user_id: student.parent_id,
        title: 'Tarea Calificada 📝',
        message: `La maestra ha calificado una tarea de ${student.name}. Nota: ${nota}`,
        link: 'panel_padres.html#grades'
      }).catch(() => {});
    }
    
    safeToast('Calificación guardada');
    const el = document.getElementById(`feedback-${studentId}`);
    if (el) {
      const card = el.closest('.p-5');
      if (card) {
        card.classList.add('border-green-300', 'bg-emerald-50');
        setTimeout(() => card.classList.remove('border-green-300', 'bg-emerald-50'), 1500);
      }
    }
  } catch (e) {
    safeToast('Error al calificar', 'error');
  }
}

// ── CALIFICACIONES V2: Actividades Evaluables ───────────────

// Resuelve el id legacy del período activo igual que la directora (get_grade_periods).
// Si get_active_period devuelve un id académico que colisiona con un período legacy
// viejo (misma identidad), get_period_config devolvería [] aunque la configuración
// exista. Esto busca el id correcto y reusa la configuración encontrada.
export async function resolveActivePeriodConfig(period) {
  try {
    const { data: gps, error: gpsErr } = await supabase.rpc('get_grade_periods');
    if (gpsErr || !gps?.length) return { period, config: [] };
    const active = gps.find(p => p.is_active) || gps.find(p => p.status === 'open');
    if (!active || String(active.id) === String(period.id)) return { period, config: [] };
    const cfg = await MaestraApi.getPeriodConfig(active.id);
    if (!cfg?.length) return { period, config: [] };
    return { period: { ...period, id: active.id, name: active.name || period.name }, config: cfg };
  } catch (_) {
    return { period, config: [] };
  }
}

// ── CALIFICACIONES V2: Vista por estudiante ─────────────────

// Promedio por área con la misma lógica del cierre de período:
// si hay 5+ calificaciones usa las mejores 5, si no usa todas.
function computeAreaAverage(scores) {
  const nums = (scores || []).map(Number).filter(v => !isNaN(v));
  if (!nums.length) return null;
  let used = nums;
  if (nums.length >= 5) used = [...nums].sort((a, b) => b - a).slice(0, 5);
  return used.reduce((s, x) => s + x, 0) / used.length;
}

// Estadísticas por estudiante (listo para la lista principal)
function buildStudentStats(students, config, activities, allGrades, taskScores = [], tasks = []) {
  const gradeByStudent = {};
  (allGrades || []).forEach(g => {
    if (g.score_v2 == null) return;
    (gradeByStudent[g.student_id] = gradeByStudent[g.student_id] || []).push(g);
  });
  const taskScoreByStudent = {};
  (taskScores || []).forEach(s => {
    if (s.score_v2 == null) return;
    (taskScoreByStudent[s.student_id] = taskScoreByStudent[s.student_id] || []).push(s);
  });
  const actByConfig = {};
  (activities || []).forEach(a => {
    (actByConfig[a.config_id] = actByConfig[a.config_id] || []).push(a);
  });
  const taskByConfig = {};
  (tasks || []).forEach(t => {
    (taskByConfig[t.config_id] = taskByConfig[t.config_id] || []).push(t);
  });
  return (students || []).map(s => {
    const sGrades = gradeByStudent[s.id] || [];
    const sTaskScores = taskScoreByStudent[s.id] || [];
    const scoreMap = {};
    sGrades.forEach(g => { if (g.activity_id) scoreMap[g.activity_id] = Number(g.score_v2); });
    const taskScoreMap = {};
    sTaskScores.forEach(g => { if (g.task_id) taskScoreMap[g.task_id] = Number(g.score_v2); });
    const gradedCount = sGrades.length + sTaskScores.length;
    const totalActs = (activities || []).length + (tasks || []).length;
    const areaAvgs = (config || []).map(cfg => {
      const acts = actByConfig[cfg.id] || [];
      const tks = taskByConfig[cfg.id] || [];
      const scores = [
        ...acts.map(a => scoreMap[a.id]).filter(v => v != null),
        ...tks.map(t => taskScoreMap[t.id]).filter(v => v != null)
      ];
      return { cfg, avg: computeAreaAverage(scores), graded: scores.length, total: acts.length + tks.length };
    });
    const computed = areaAvgs.filter(x => x.avg != null).map(x => x.avg);
    const overall = computed.length ? computed.reduce((a, b) => a + b, 0) / computed.length : null;
    const pct = totalActs ? Math.round((gradedCount / totalActs) * 100) : 0;
    const level = overall == null ? 'Sin calificar' : overall >= 90 ? 'Excelente' : overall >= 80 ? 'Bueno' : overall >= 70 ? 'En proceso' : 'Requiere apoyo';
    return { student: s, gradedCount, totalActs, pending: Math.max(0, totalActs - gradedCount), overall, pct, areaAvgs, level };
  });
}

// Trae todas las calificaciones del período (incluye datos legacy sin period_id)
async function fetchPeriodGrades(period, activities) {
  const actIds = (activities || []).map(a => a.id);
  const [r1, r2] = await Promise.all([
    supabase.from('grades').select('id, activity_id, student_id, score_v2, notes').eq('period_id', period.id),
    actIds.length
      ? supabase.from('grades').select('id, activity_id, student_id, score_v2, notes').in('activity_id', actIds).is('period_id', null)
      : Promise.resolve({ data: [] })
  ]);
  return [...(r1?.data || []), ...(r2?.data || [])];
}

// Tareas con área asignada del período + sus notas numéricas por estudiante
async function loadPeriodTasks(config) {
  const tasks = await MaestraApi.getTasksForPeriod(config || []);
  const scores = await MaestraApi.getTaskScoresForStudents((tasks || []).map(t => t.id));
  return { tasks: tasks || [], scores: scores || [] };
}

const AREA_STYLES = [
  { grad: 'from-blue-600 to-blue-500',      chip: 'bg-blue-50 text-blue-600',      bar: 'bg-blue-500',      dark: 'text-blue-700' },
  { grad: 'from-emerald-600 to-emerald-500', chip: 'bg-emerald-50 text-emerald-600', bar: 'bg-emerald-500', dark: 'text-emerald-700' },
  { grad: 'from-amber-500 to-amber-400',    chip: 'bg-amber-50 text-amber-600',    bar: 'bg-amber-500',     dark: 'text-amber-700' },
  { grad: 'from-pink-600 to-pink-500',      chip: 'bg-pink-50 text-pink-600',      bar: 'bg-pink-500',      dark: 'text-pink-700' },
  { grad: 'from-orange-600 to-orange-500',  chip: 'bg-orange-50 text-orange-600',  bar: 'bg-orange-500',   dark: 'text-orange-700' },
  { grad: 'from-violet-600 to-violet-500',  chip: 'bg-violet-50 text-violet-600',  bar: 'bg-violet-500',   dark: 'text-violet-700' },
];
const areaStyle = i => AREA_STYLES[i % AREA_STYLES.length];

// Panel de gestión de áreas y actividades (modal)
function renderAreasPanel(config, actByConfig, statTotal, taskByConfig = {}, taskScores = []) {
  const areasHtml = config.map((cfg, i) => {
    const s = areaStyle(i);
    const existingActs = actByConfig[cfg.id] || [];
    const slotsUsed = existingActs.length;
    const slotsTotal = cfg.activity_count || 1;
    const isFull = slotsUsed >= slotsTotal;
    const slotPct = Math.min(100, Math.round((slotsUsed / slotsTotal) * 100));
    let pendingArea = 0;
    existingActs.forEach(a => pendingArea += Math.max(0, statTotal - (a.graded_count || 0)));

    const rows = existingActs.map(act => {
      const gradedCount = act.graded_count || 0;
      const gradedPct = Math.min(100, Math.round((gradedCount / statTotal) * 100));
      const allGraded = gradedCount >= statTotal;
      return `
        <div class="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition-colors">
          <div class="flex items-center gap-3 min-w-0">
            <span class="w-7 h-7 rounded-lg ${s.chip} flex items-center justify-center font-black text-[11px] shrink-0">${act.activity_number}</span>
            <div class="min-w-0">
              <div class="font-bold text-slate-800 text-sm truncate">${safeEscapeHTML(act.title)}</div>
              <div class="flex items-center gap-2 mt-0.5">
                <div class="w-16 h-1 rounded-full bg-slate-200 overflow-hidden">
                  <div class="h-full ${s.bar} rounded-full" style="width:${gradedPct}%"></div>
                </div>
                <span class="text-[10px] font-bold ${allGraded ? 'text-emerald-600' : 'text-slate-400'}">${gradedCount}/${statTotal} notas</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button onclick="App.gradeActivity('${act.id}', '${safeEscapeHTML(act.title)}', ${act.activity_number})"
              class="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase hover:bg-indigo-700 transition-all">
              Calificar
            </button>
            <button onclick="App.deleteActivityV2('${act.id}')"
              class="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar actividad">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    const taskRows = (taskByConfig[cfg.id] || []).map(tsk => {
      const gradedCount = (taskScores || []).filter(sc => String(sc.task_id) === String(tsk.id)).length;
      const gradedPct = Math.min(100, Math.round((gradedCount / statTotal) * 100));
      const allGraded = gradedCount >= statTotal;
      return `
        <div class="flex items-center justify-between gap-3 p-3 rounded-xl border border-dashed border-violet-200 bg-violet-50/40 hover:bg-violet-50 transition-colors">
          <div class="flex items-center gap-3 min-w-0">
            <span class="w-7 h-7 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center text-[12px] shrink-0">📝</span>
            <div class="min-w-0">
              <div class="font-bold text-slate-800 text-sm truncate flex items-center gap-1.5">${safeEscapeHTML(tsk.title)} <span class="px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded-full text-[8px] font-black uppercase shrink-0">Tarea</span></div>
              <div class="flex items-center gap-2 mt-0.5">
                <div class="w-16 h-1 rounded-full bg-slate-200 overflow-hidden">
                  <div class="h-full ${s.bar} rounded-full" style="width:${gradedPct}%"></div>
                </div>
                <span class="text-[10px] font-bold ${allGraded ? 'text-emerald-600' : 'text-slate-400'}">${gradedCount}/${statTotal} notas</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button onclick="App.viewTaskSubmissions('${tsk.id}')"
              class="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-[10px] font-black uppercase hover:bg-violet-700 transition-all">
              Calificar
            </button>
          </div>
        </div>`;
    }).join('');

    const hasItems = existingActs.length > 0 || taskRows !== '';
    const body = hasItems
      ? `<div class="space-y-2">${rows}${taskRows}</div>`
      : `
        <div class="text-center py-6">
          <p class="text-sm font-bold text-slate-500">Aún no hay actividades</p>
          <p class="text-[10px] text-slate-400 mt-0.5">Usa el botón "+ Actividad" para crear la primera</p>
        </div>`;

    return `
      <div>
        <div onclick="App.toggleArea('${cfg.id}')" class="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50/60 transition-colors">
          <div class="flex items-center gap-3 min-w-0">
            <span class="w-9 h-9 rounded-xl ${s.chip} flex items-center justify-center font-black text-xs shrink-0">${safeEscapeHTML((cfg.subject_name || '?').charAt(0).toUpperCase())}</span>
            <div class="min-w-0">
              <div class="flex items-center gap-2 min-w-0">
                <h4 class="font-black text-slate-800 text-sm truncate">${safeEscapeHTML(cfg.subject_name)}</h4>
                ${isFull ? '<span class="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[9px] font-black shrink-0">Completo</span>' : ''}
                ${pendingArea > 0 ? `<span class="px-1.5 py-0.5 bg-rose-100 text-rose-600 rounded-full text-[9px] font-black shrink-0">${pendingArea} por calificar</span>` : ''}
              </div>
              <div class="flex items-center gap-2 mt-1">
                <div class="w-24 h-1 rounded-full bg-slate-200 overflow-hidden">
                  <div class="h-full ${s.bar} rounded-full" style="width:${slotPct}%"></div>
                </div>
                <span class="text-[10px] font-bold text-slate-400">${slotsUsed}/${slotsTotal} actividades</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            ${!isFull ? `
              <button onclick="event.stopPropagation(); App.openNewActivityModal('${cfg.id}', '${safeEscapeHTML(cfg.subject_name)}', ${slotsUsed + 1})"
                class="px-2.5 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-black uppercase hover:bg-indigo-100 transition-colors flex items-center gap-1">
                <i data-lucide="plus" class="w-3 h-3"></i> Actividad
              </button>` : ''}
            <button onclick="event.stopPropagation(); App.deleteArea('${cfg.id}', '${safeEscapeHTML(cfg.subject_name)}')"
              class="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar área">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
            <span class="p-1 text-slate-300 transition-colors">
              <i data-lucide="chevron-down" class="w-4 h-4 transition-transform" id="area-chevron-${cfg.id}"></i>
            </span>
          </div>
        </div>
        <div id="area-body-${cfg.id}" data-area-body class="hidden px-4 pb-4">${body}</div>
      </div>`;
  }).join('');

  return `
    <div class="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
        <h4 class="font-black text-slate-700 text-xs uppercase tracking-widest flex items-center gap-2">
          <i data-lucide="layout-grid" class="w-4 h-4 text-indigo-500"></i> Áreas del período
        </h4>
        <span class="text-[10px] font-bold text-slate-400 hidden md:block">Toca un área para ver sus actividades</span>
      </div>
      <div class="divide-y divide-slate-50">${areasHtml}</div>
    </div>`;
}

export async function initGradesV2() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('tab-grades-v2') || document.getElementById('t-grades-inner');
  if (!container) return;

  container.innerHTML = `
    <div class="flex justify-between items-center mb-8">
      <h3 class="text-2xl font-black text-slate-800 flex items-center gap-3">
        <i data-lucide="star" class="w-6 h-6 text-indigo-500"></i>
        Calificaciones
      </h3>
    </div>
    <div id="gradesV2Content" class="space-y-4">
      <div class="animate-pulse space-y-4">
        <div class="h-32 bg-slate-50 rounded-3xl"></div>
        <div class="h-32 bg-slate-50 rounded-3xl"></div>
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();

  const content = document.getElementById('gradesV2Content');
  try {
    const periodRes = await supabase.rpc('get_active_period', { p_classroom_id: classroom?.id });
    let period = periodRes?.data;

    if (!period || !period.found) {
      content.innerHTML = `
        <div class="text-center py-16">
          <div class="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-4">📋</div>
          <p class="font-bold text-slate-600">No hay periodo activo</p>
          <p class="text-xs text-slate-400 mt-1">La directora debe crear y activar un periodo primero</p>
        </div>`;
      return;
    }

    let config = await MaestraApi.getPeriodConfig(period.id);
    if (!config || !config.length) {
      const resolved = await resolveActivePeriodConfig(period);
      period = resolved.period;
      config = resolved.config;
    }

    const students = AppState.get('students') || [];
    const activities = await MaestraApi.getActivitiesWithGrades(period.id);
    const allGrades = await fetchPeriodGrades(period, activities);
    const { tasks, scores } = await loadPeriodTasks(config);
    const stats = buildStudentStats(students, config, activities, allGrades, scores, tasks);

    const totalActs = activities.length + tasks.length;
    const totalGraded = allGrades.filter(g => g.score_v2 != null).length + scores.length;
    const pendingAll = Math.max(0, (totalActs * students.length) - totalGraded);

    const headerBar = `
      <div class="mb-4 flex items-center justify-between gap-3 bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3 flex-wrap">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <i data-lucide="calendar-range" class="w-4 h-4"></i>
          </div>
          <div class="min-w-0">
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Período activo</p>
            <p class="font-black text-slate-800 leading-tight truncate">${safeEscapeHTML(period.name)}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <button onclick="App.openAreasManager()"
            class="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black uppercase hover:bg-indigo-100 transition-colors flex items-center gap-1">
            <i data-lucide="layout-grid" class="w-3.5 h-3.5"></i> Áreas y actividades
          </button>
          <button onclick="App.openBoletinList()"
            class="px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black uppercase hover:bg-emerald-100 transition-colors flex items-center gap-1">
            <i data-lucide="file-text" class="w-3.5 h-3.5"></i> Ver boletín
          </button>
        </div>
      </div>`;

    const chipsHtml = `
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 text-indigo-600 bg-indigo-50 rounded-full text-[11px] font-black"><i data-lucide="users" class="w-3.5 h-3.5"></i> ${students.length} Estudiantes</span>
        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 text-blue-600 bg-blue-50 rounded-full text-[11px] font-black"><i data-lucide="layout-grid" class="w-3.5 h-3.5"></i> ${config.length} Áreas</span>
        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 text-violet-600 bg-violet-50 rounded-full text-[11px] font-black"><i data-lucide="clipboard-list" class="w-3.5 h-3.5"></i> ${totalActs} Actividades</span>
        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 text-emerald-600 bg-emerald-50 rounded-full text-[11px] font-black"><i data-lucide="check-check" class="w-3.5 h-3.5"></i> ${totalGraded} Notas</span>
        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 text-rose-600 bg-rose-50 rounded-full text-[11px] font-black"><i data-lucide="clock" class="w-3.5 h-3.5"></i> ${pendingAll} Por calificar</span>
      </div>`;

    const configBanner = config.length ? '' : `
      <div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3">
        <i data-lucide="alert-triangle" class="w-5 h-5 text-amber-500 shrink-0"></i>
        <div>
          <p class="text-xs font-black text-amber-800 uppercase tracking-wide">Sin áreas configuradas</p>
          <p class="text-[10px] text-amber-600 font-medium">Pide a la directora que configure las áreas y actividades del período.</p>
        </div>
      </div>`;

    const studentCard = ({ student: s, gradedCount, totalActs: ta, overall, pct, level }) => {
      const overallCls = overall == null ? 'text-slate-400' : overall >= 80 ? 'text-emerald-600' : overall >= 60 ? 'text-amber-600' : 'text-rose-600';
      const barCls = overall == null ? 'bg-slate-300' : overall >= 80 ? 'bg-emerald-500' : overall >= 60 ? 'bg-amber-500' : 'bg-rose-500';
      const pillCls = overall == null ? 'bg-slate-100 text-slate-500' : overall >= 90 ? 'bg-emerald-50 text-emerald-700' : overall >= 80 ? 'bg-emerald-50 text-emerald-600' : overall >= 70 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700';
      return `
        <div data-student-card data-search="${safeEscapeHTML((s.name || '') + ' ' + (s.matricula || ''))}"
          ondblclick="App.openStudentResultGrid('${s.id}')"
          class="p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:shadow-md cursor-pointer transition-all select-none">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm overflow-hidden shrink-0">
              ${s.avatar_url ? `<img src="${safeEscapeHTML(s.avatar_url)}" alt="" class="w-full h-full object-cover" onerror="this.remove()">` : safeEscapeHTML((s.name || '?').charAt(0))}
            </div>
            <div class="min-w-0 flex-1">
              <div class="font-black text-slate-800 text-sm truncate">${safeEscapeHTML(s.name)}</div>
              <div class="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">${safeEscapeHTML(s.matricula || 'Sin matrícula')}</div>
            </div>
            <div class="text-center shrink-0">
              <div class="text-[9px] font-black uppercase tracking-wider text-slate-400">Promedio</div>
              <div class="text-xl font-black leading-tight ${overallCls}">${overall != null ? Number(overall).toFixed(1) : '—'}</div>
            </div>
          </div>
          <div class="flex items-center gap-2 mb-2">
            <div class="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <div class="h-full rounded-full transition-all ${barCls}" style="width:${pct}%"></div>
            </div>
            <span class="text-[10px] font-black text-slate-500">${gradedCount}/${ta}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${pillCls}">${level}</span>
            <span class="text-[9px] text-slate-400 font-bold flex items-center gap-1"><i data-lucide="info" class="w-3 h-3"></i> Doble clic para ver cuadrícula</span>
          </div>
        </div>`;
    };

    const studentsPanel = `
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div class="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
          <h4 class="font-black text-slate-700 text-xs uppercase tracking-widest flex items-center gap-2">
            <i data-lucide="users" class="w-4 h-4 text-indigo-500"></i> Estudiantes
          </h4>
          <span class="text-[10px] font-bold text-slate-400 hidden md:block">Doble clic sobre un estudiante para ver su cuadrícula</span>
        </div>
        <div class="p-4">
          ${configBanner}
          <div class="relative mb-4">
            <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"></i>
            <input id="studentsGradesSearch" type="text" placeholder="Buscar estudiante por nombre o matrícula..."
              class="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-400 outline-none">
          </div>
          ${students.length
            ? `<div id="studentsGradesGrid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">${stats.map(studentCard).join('')}</div>`
            : `
              <div class="text-center py-14">
                <div class="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-4">👧</div>
                <p class="font-bold text-slate-600">No hay estudiantes en esta aula</p>
              </div>`}
        </div>
      </div>`;

    content.innerHTML = headerBar + chipsHtml + studentsPanel;
    if (window.lucide) window.lucide.createIcons();

    const search = document.getElementById('studentsGradesSearch');
    if (search) {
      search.addEventListener('input', () => {
        const q = (search.value || '').trim().toLowerCase();
        document.querySelectorAll('[data-student-card]').forEach(card => {
          card.style.display = (card.dataset.search || '').toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }
  } catch (e) {
    content.innerHTML = `
      <div class="text-center py-12">
        <div class="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center text-2xl mx-auto mb-3">⚠️</div>
        <p class="font-bold text-slate-700">Error al cargar calificaciones</p>
        <p class="text-xs text-slate-400 mt-1">${safeEscapeHTML(e?.message || '')}</p>
        <button onclick="App.initGradesV2()" class="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase">Reintentar</button>
      </div>`;
  }
}

// ── Gestión de áreas y actividades (modal) ────────────────────

export async function openAreasManager() {
  const modalId = 'areasManagerModal';
  const classroom = AppState.get('classroom');
  try {
    const periodRes = await supabase.rpc('get_active_period', { p_classroom_id: classroom?.id });
    let period = periodRes?.data;
    if (!period || !period.found) return safeToast('No hay período activo para esta aula', 'warning');

    let config = await MaestraApi.getPeriodConfig(period.id);
    if (!config || !config.length) {
      const resolved = await resolveActivePeriodConfig(period);
      period = resolved.period;
      config = resolved.config;
    }

    const activities = await MaestraApi.getActivitiesWithGrades(period.id);
    const actByConfig = {};
    (activities || []).forEach(a => { if (!actByConfig[a.config_id]) actByConfig[a.config_id] = []; actByConfig[a.config_id].push(a); });
    const { tasks, scores } = await loadPeriodTasks(config);
    const taskByConfig = {};
    (tasks || []).forEach(t => { if (!taskByConfig[t.config_id]) taskByConfig[t.config_id] = []; taskByConfig[t.config_id].push(t); });
    const students = AppState.get('students') || [];
    const statTotal = students.length || 1;

    Modal.open(modalId, `
      <div class="bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col max-h-[90vh]">
        <div class="flex justify-between items-start mb-6">
          <div>
            <h3 class="text-2xl font-black text-slate-800 flex items-center gap-2"><i data-lucide="layout-grid" class="w-6 h-6 text-indigo-500"></i> Áreas y actividades</h3>
            <p class="text-xs font-bold text-slate-400 mt-1">${safeEscapeHTML(period.name)} — Crea o elimina áreas y actividades del período</p>
          </div>
          <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors"><i data-lucide="x" class="w-6 h-6 text-slate-400"></i></button>
        </div>
        <div class="overflow-y-auto pr-2 flex-1">
          ${config.length
            ? renderAreasPanel(config, actByConfig, statTotal, taskByConfig, scores)
            : '<div class="text-center py-16"><div class="w-16 h-16 bg-amber-100 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-4">⚙️</div><p class="font-bold text-slate-600">Sin materias configuradas</p><p class="text-xs text-slate-400 mt-1">La directora debe configurar las materias del periodo</p></div>'}
        </div>
      </div>`);
  } catch (e) {
    safeToast('Error al cargar áreas', 'error');
  }
}

// ── Cuadrícula de resultados por estudiante ───────────────────

export async function openStudentResultGrid(studentId) {
  const modalId = 'studentResultGridModal';
  const classroom = AppState.get('classroom');
  const student = (AppState.get('students') || []).find(s => String(s.id) === String(studentId));
  if (!student) return safeToast('Estudiante no encontrado', 'warning');

  Modal.open(modalId, `
    <div class="bg-white w-full max-w-5xl rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col max-h-[90vh]">
      <div class="flex justify-between items-center mb-6">
        <h3 class="text-2xl font-black text-slate-800">Cuadrícula de resultados</h3>
        <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors"><i data-lucide="x" class="w-6 h-6 text-slate-400"></i></button>
      </div>
      <div class="flex-1 overflow-y-auto pr-2">
        <div class="space-y-3">
          <div class="h-24 bg-slate-50 rounded-2xl animate-pulse"></div>
          <div class="h-40 bg-slate-50 rounded-2xl animate-pulse"></div>
        </div>
      </div>
    </div>
  `);

  try {
    const periodRes = await supabase.rpc('get_active_period', { p_classroom_id: classroom?.id });
    let period = periodRes?.data;
    if (!period || !period.found) {
      safeToast('No hay período activo para esta aula', 'warning');
      return Modal.close(modalId);
    }

    let config = await MaestraApi.getPeriodConfig(period.id);
    if (!config || !config.length) {
      const resolved = await resolveActivePeriodConfig(period);
      period = resolved.period;
      config = resolved.config;
    }

    const activities = await MaestraApi.getActivitiesWithGrades(period.id);
    const allGrades = await fetchPeriodGrades(period, activities);
    const studentGrades = allGrades.filter(g => String(g.student_id) === String(studentId));
    const { tasks, scores } = await loadPeriodTasks(config);
    const studentTaskScores = scores.filter(s => String(s.student_id) === String(studentId));

    const actByConfig = {};
    (activities || []).forEach(a => { (actByConfig[a.config_id] = actByConfig[a.config_id] || []).push(a); });
    (tasks || []).forEach(t => { (actByConfig[t.config_id] = actByConfig[t.config_id] || []).push({ ...t, isTask: true }); });
    config.forEach(cfg => (actByConfig[cfg.id] || []).sort((a, b) => {
      if (!!a.isTask !== !!b.isTask) return a.isTask ? 1 : -1;
      if (a.isTask) return String(a.created_at || '') < String(b.created_at || '') ? -1 : 1;
      return (a.activity_number || 0) - (b.activity_number || 0);
    }));
    const maxCols = config.length ? Math.max(1, ...config.map(cfg => (actByConfig[cfg.id] || []).length)) : 0;

    const gradeMap = {};
    studentGrades.forEach(g => { if (g.activity_id) gradeMap[g.activity_id] = g; });
    const taskScoreMap = {};
    studentTaskScores.forEach(g => { if (g.task_id) taskScoreMap[g.task_id] = g; });

    const areaAvgs = config.map(cfg => {
      const acts = actByConfig[cfg.id] || [];
      const scores = acts.map(a => {
        if (a.isTask) return (taskScoreMap[a.id]?.score_v2 != null ? Number(taskScoreMap[a.id].score_v2) : null);
        return (gradeMap[a.id]?.score_v2 != null ? Number(gradeMap[a.id].score_v2) : null);
      }).filter(v => v != null);
      return { cfg, avg: computeAreaAverage(scores), graded: scores.length, total: acts.length };
    });
    const computed = areaAvgs.filter(x => x.avg != null).map(x => x.avg);
    const overall = computed.length ? computed.reduce((a, b) => a + b, 0) / computed.length : null;

    const colHeaders = [];
    for (let j = 0; j < maxCols; j++) colHeaders.push(`<th class="px-2 py-2.5 text-center bg-slate-100 text-slate-500 text-[10px] font-black uppercase">Act. ${j + 1}</th>`);

    const rowsHtml = config.map((cfg, idx) => {
      const s = areaStyle(idx);
      const acts = actByConfig[cfg.id] || [];
      const avg = areaAvgs[idx]?.avg ?? null;
      const cells = [];
      for (let j = 0; j < maxCols; j++) {
        const act = acts[j];
        if (!act) { cells.push('<td class="px-2 py-1.5 bg-slate-50/40 border-t border-slate-100"></td>'); continue; }
        const g = act.isTask ? taskScoreMap[act.id] : gradeMap[act.id];
        const sc = g?.score_v2 != null ? Number(g.score_v2) : null;
        const cellCls = sc != null
          ? (sc >= 80 ? 'bg-emerald-50 hover:bg-emerald-100' : sc >= 60 ? 'bg-amber-50 hover:bg-amber-100' : 'bg-rose-50 hover:bg-rose-100')
          : 'bg-slate-50 hover:bg-indigo-50 border border-dashed border-slate-200';
        const scoreCls = sc != null
          ? (sc >= 80 ? 'text-emerald-600' : sc >= 60 ? 'text-amber-600' : 'text-rose-600')
          : 'text-slate-300';
        const handler = act.isTask
          ? `App.editTaskScore('${act.id}', '${student.id}', ${sc != null ? sc : 'null'}, '${encodeURIComponent(act.title)}')`
          : `App.editStudentScore('${act.id}', '${student.id}', ${sc != null ? sc : 'null'}, '${encodeURIComponent(act.title)}')`;
        const label = (act.isTask ? '📝 ' : '') + safeEscapeHTML(act.title);
        cells.push(`
          <td class="px-1.5 py-1.5 border-t border-slate-100 align-top">
            <button onclick="${handler}"
              class="w-full rounded-xl p-2 text-center transition-all ${cellCls}">
              <div class="text-base font-black leading-none ${scoreCls}">${sc != null ? Number(sc).toFixed(1) : '+'}</div>
              <div class="mt-1 text-[9px] font-bold ${sc != null ? 'text-slate-500' : 'text-slate-400'} truncate" title="${safeEscapeHTML(act.title)}">${label}</div>
            </button>
          </td>`);
      }
      return `
        <tr>
          <td class="px-3 py-2 border-t border-slate-100 bg-slate-50/60">
            <div class="flex items-center gap-2">
              <span class="w-7 h-7 rounded-lg ${s.chip} flex items-center justify-center font-black text-[10px] shrink-0">${safeEscapeHTML((cfg.subject_name || '?').charAt(0).toUpperCase())}</span>
              <div class="min-w-0">
                <div class="font-black text-slate-800 text-xs truncate">${safeEscapeHTML(cfg.subject_name)}</div>
                <div class="text-[9px] text-slate-400 font-bold">${areaAvgs[idx].graded}/${acts.length} calificados</div>
              </div>
            </div>
          </td>
          ${cells.join('')}
          <td class="px-3 py-2 border-t border-slate-100 text-center bg-indigo-50/60">
            <div class="text-sm font-black ${avg != null ? 'text-indigo-700' : 'text-slate-400'}">${avg != null ? Number(avg).toFixed(1) : '—'}</div>
          </td>
        </tr>`;
    }).join('');

    const overallRow = `
      <tr class="bg-indigo-600 text-white">
        <td class="px-3 py-3 font-black text-[11px] uppercase tracking-widest">Promedio general</td>
        <td colspan="${maxCols}" class="px-3 py-3 text-center text-[10px] font-bold text-white/70">${config.length} áreas</td>
        <td class="px-3 py-3 text-center text-xl font-black">${overall != null ? Number(overall).toFixed(1) : '—'}</td>
      </tr>`;

    const content = `
      <div class="bg-white w-full max-w-5xl rounded-[2.5rem] shadow-2xl p-6 md:p-8 animate-fadeIn flex flex-col max-h-[92vh]">
        <div class="flex justify-between items-start mb-5">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center font-black text-lg overflow-hidden shrink-0">
              ${student.avatar_url ? `<img src="${safeEscapeHTML(student.avatar_url)}" alt="" class="w-full h-full object-cover">` : safeEscapeHTML((student.name || '?').charAt(0))}
            </div>
            <div class="min-w-0">
              <h3 class="text-xl font-black text-slate-800 truncate">${safeEscapeHTML(student.name)}</h3>
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${safeEscapeHTML(student.matricula || 'Sin matrícula')} · ${safeEscapeHTML(period.name)}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <div class="text-right">
              <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">Promedio</p>
              <p class="text-2xl font-black leading-tight ${overall != null ? (overall >= 80 ? 'text-emerald-600' : overall >= 60 ? 'text-amber-600' : 'text-rose-600') : 'text-slate-400'}">${overall != null ? Number(overall).toFixed(1) : '—'}</p>
            </div>
            <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors"><i data-lucide="x" class="w-6 h-6 text-slate-400"></i></button>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto pr-1">
          ${config.length ? `
            <div class="grades-table-wrap mb-3">
              <table class="w-full border-collapse rounded-2xl overflow-hidden border border-slate-100">
                <thead>
                  <tr class="bg-slate-100">
                    <th class="px-3 py-2.5 text-left text-slate-500 text-[10px] font-black uppercase">Área</th>
                    ${colHeaders.join('')}
                    <th class="px-3 py-2.5 text-center text-indigo-600 text-[10px] font-black uppercase">Promedio</th>
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>${overallRow}</tfoot>
              </table>
            </div>
            <div class="flex items-center justify-between gap-3 flex-wrap mb-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black">&ge;80 Bueno</span>
                <span class="px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full text-[9px] font-black">60-79 En proceso</span>
                <span class="px-2 py-0.5 bg-rose-50 text-rose-600 rounded-full text-[9px] font-black">&lt;60 Requiere apoyo</span>
              </div>
              <span class="text-[10px] text-slate-400 font-bold flex items-center gap-1"><i data-lucide="pencil-line" class="w-3.5 h-3.5"></i> Toca una calificación para editarla</span>
            </div>` : '<div class="text-center py-14"><p class="font-bold text-slate-500">Sin áreas configuradas</p><p class="text-[10px] text-slate-400 mt-1">La directora debe configurar las áreas del período</p></div>'}
        </div>
      </div>`;

    Modal.open(modalId, content);
  } catch (e) {
    Modal.open(modalId, `
      <div class="bg-white w-full max-w-5xl rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn">
        <div class="text-center py-12">
          <div class="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center text-2xl mx-auto mb-3">⚠️</div>
          <p class="font-bold text-slate-700">Error al cargar la cuadrícula</p>
          <p class="text-xs text-slate-400 mt-1">${safeEscapeHTML(e?.message || '')}</p>
          <button onclick="Modal.close('${modalId}')" class="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase">Cerrar</button>
        </div>
      </div>`);
  }
}

export async function editStudentScore(activityId, studentId, currentScore, encodedTitle) {
  const modalId = 'editScoreModal';
  const student = (AppState.get('students') || []).find(s => String(s.id) === String(studentId));
  const activityTitle = decodeURIComponent(encodedTitle || '');

  let existingNotes = '';
  try {
    const { data: ex } = await supabase
      .from('grades')
      .select('notes, score_v2')
      .eq('activity_id', activityId)
      .eq('student_id', studentId)
      .maybeSingle();
    if (ex?.score_v2 != null) currentScore = ex.score_v2;
    existingNotes = ex?.notes || '';
  } catch (_) {}

  Modal.open(modalId, `
    <div class="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col max-h-[90vh]">
      <div class="flex justify-between items-start mb-6">
        <div>
          <h3 class="text-2xl font-black text-slate-800">Editar calificación</h3>
          <p class="text-xs font-bold text-slate-400 mt-1">${safeEscapeHTML(student?.name || '')} — ${safeEscapeHTML(activityTitle)}</p>
        </div>
        <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors"><i data-lucide="x" class="w-6 h-6 text-slate-400"></i></button>
      </div>
      <div class="space-y-5 flex-1 overflow-y-auto pr-2">
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Calificación (0-100)</label>
          <input type="number" id="editScoreInput" min="0" max="100" step="0.1"
            value="${currentScore != null ? currentScore : ''}"
            class="w-full p-3 bg-slate-50 border-none rounded-xl text-lg font-black text-center focus:ring-2 focus:ring-indigo-400 outline-none"
            placeholder="0-100" autofocus>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Comentario (Opcional)</label>
          <textarea id="editScoreComment" rows="3" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 outline-none resize-none"
            placeholder="Retroalimentación...">${safeEscapeHTML(existingNotes)}</textarea>
        </div>
      </div>
      <div class="pt-5 mt-5 border-t border-slate-100">
        <button id="btnSaveScore" class="w-full py-3.5 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2">
          <i data-lucide="save" class="w-5 h-5"></i> Guardar calificación
        </button>
      </div>
    </div>
  `);

  document.getElementById('btnSaveScore').onclick = async () => {
    const score = document.getElementById('editScoreInput').value;
    const comment = document.getElementById('editScoreComment').value;
    if (score === '' || score === null || score === undefined) return safeToast('Ingresa una calificación', 'warning');
    const scoreNum = parseFloat(score);
    if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) return safeToast('La calificación debe ser entre 0 y 100', 'warning');

    const btn = document.getElementById('btnSaveScore');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Guardando...';
    requestAnimationFrame(() => window.lucide?.createIcons());
    try {
      const user = AppState.get('user');
      await MaestraApi.saveGradeV2(activityId, studentId, scoreNum, comment, user?.id);

      const st = (AppState.get('students') || []).find(x => String(x.id) === String(studentId));
      if (st?.parent_id) {
        sendPush({
          user_id: st.parent_id,
          title: 'Calificación registrada',
          message: `${st.name} recibió ${scoreNum}/100 en "${activityTitle}"`,
          link: 'panel_padres.html#grades'
        }).catch(() => {});
      }

      safeToast('Calificación guardada');
      if (window.App?.refreshPendingGradesBadge) window.App.refreshPendingGradesBadge();
      Modal.close(modalId);
      await openStudentResultGrid(studentId);
      initGradesV2();
    } catch (e) {
      safeToast('Error al guardar: ' + (e.message || ''), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Guardar calificación';
      requestAnimationFrame(() => window.lucide?.createIcons());
    }
  };
}

export async function editTaskScore(taskId, studentId, currentScore, encodedTitle) {
  const modalId = 'editTaskScoreModal';
  const student = (AppState.get('students') || []).find(s => String(s.id) === String(studentId));
  const taskTitle = decodeURIComponent(encodedTitle || '');

  let existingNotes = '';
  try {
    const { data: ex } = await supabase
      .from('task_evidences')
      .select('comment, score_v2')
      .eq('task_id', taskId)
      .eq('student_id', studentId)
      .maybeSingle();
    if (ex?.score_v2 != null) currentScore = ex.score_v2;
    existingNotes = ex?.comment || '';
  } catch (_) {}

  Modal.open(modalId, `
    <div class="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col max-h-[90vh]">
      <div class="flex justify-between items-start mb-6">
        <div>
          <h3 class="text-2xl font-black text-slate-800">Calificar tarea</h3>
          <p class="text-xs font-bold text-slate-400 mt-1">${safeEscapeHTML(student?.name || '')} — ${safeEscapeHTML(taskTitle)}</p>
        </div>
        <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors"><i data-lucide="x" class="w-6 h-6 text-slate-400"></i></button>
      </div>
      <div class="space-y-5 flex-1 overflow-y-auto pr-2">
        <div class="flex items-center gap-3 p-4 bg-violet-50 rounded-2xl">
          <i data-lucide="notebook-pen" class="w-5 h-5 text-violet-500 shrink-0"></i>
          <p class="text-xs text-violet-700 font-medium">La nota numérica de esta tarea también aparece en la cuadrícula de calificaciones y cuenta para el promedio.</p>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Calificación (0-100)</label>
          <input type="number" id="editTaskScoreInput" min="0" max="100" step="0.1"
            value="${currentScore != null ? currentScore : ''}"
            class="w-full p-3 bg-slate-50 border-none rounded-xl text-lg font-black text-center focus:ring-2 focus:ring-violet-400 outline-none"
            placeholder="0-100" autofocus>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Comentario (Opcional)</label>
          <textarea id="editTaskScoreComment" rows="3" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-violet-400 outline-none resize-none"
            placeholder="Retroalimentación...">${safeEscapeHTML(existingNotes)}</textarea>
        </div>
      </div>
      <div class="pt-5 mt-5 border-t border-slate-100">
        <button id="btnSaveTaskScore" class="w-full py-3.5 bg-violet-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-violet-200 hover:bg-violet-700 transition-all flex items-center justify-center gap-2">
          <i data-lucide="save" class="w-5 h-5"></i> Guardar calificación
        </button>
      </div>
    </div>
  `);

  document.getElementById('btnSaveTaskScore').onclick = async () => {
    const score = document.getElementById('editTaskScoreInput').value;
    const comment = document.getElementById('editTaskScoreComment').value;
    if (score === '' || score === null || score === undefined) return safeToast('Ingresa una calificación', 'warning');
    const scoreNum = parseFloat(score);
    if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) return safeToast('La calificación debe ser entre 0 y 100', 'warning');

    const classroom = AppState.get('classroom');
    const { open: periodOpen } = await _getPeriodStatus(classroom?.id);
    if (!periodOpen) {
      Modal.close(modalId);
      return safeToast('El período está cerrado. No se pueden modificar calificaciones.', 'warning');
    }

    const btn = document.getElementById('btnSaveTaskScore');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Guardando...';
    requestAnimationFrame(() => window.lucide?.createIcons());
    try {
      await MaestraApi.saveTaskScoreV2(taskId, studentId, scoreNum, comment);

      const st = (AppState.get('students') || []).find(x => String(x.id) === String(studentId));
      if (st?.parent_id) {
        sendPush({
          user_id: st.parent_id,
          title: 'Tarea Calificada 📝',
          message: `${st.name} recibió ${scoreNum}/100 en "${taskTitle}"`,
          link: 'panel_padres.html#grades'
        }).catch(() => {});
      }

      safeToast('Calificación guardada');
      if (window.App?.refreshPendingGradesBadge) window.App.refreshPendingGradesBadge();
      Modal.close(modalId);
      await openStudentResultGrid(studentId);
      initGradesV2();
    } catch (e) {
      safeToast('Error al guardar: ' + (e.message || ''), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Guardar calificación';
      requestAnimationFrame(() => window.lucide?.createIcons());
    }
  };
}

export function openNewActivityModal(configId, subjectName, nextNumber) {
  const modalId = 'newActivityModal';
  const content = `
    <div class="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col max-h-[90vh]">
      <div class="flex justify-between items-start mb-6">
        <div>
          <h3 class="text-2xl font-black text-slate-800">Nueva Actividad</h3>
          <p class="text-xs font-bold text-slate-400 mt-1">${safeEscapeHTML(subjectName)} — Actividad #${nextNumber}</p>
        </div>
        <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
          <i data-lucide="x" class="w-6 h-6 text-slate-400"></i>
        </button>
      </div>
      <form id="activityForm" class="space-y-5 overflow-y-auto pr-2 flex-1">
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Nombre de la Actividad</label>
          <input type="text" id="actTitle" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-400 outline-none"
            placeholder="Ej: Examen, Proyecto, Participacion..." required>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Descripcion (Opcional)</label>
          <textarea id="actDesc" rows="3" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 outline-none resize-none"
            placeholder="Instrucciones o detalles de la actividad..."></textarea>
        </div>
        <div class="flex items-center gap-3 p-4 bg-indigo-50 rounded-2xl">
          <i data-lucide="info" class="w-5 h-5 text-indigo-500"></i>
          <p class="text-xs text-indigo-700 font-medium">La calificacion sera del 0 al 100.</p>
        </div>
      </form>
      <div class="pt-6 mt-auto border-t border-slate-100">
        <button id="btnSaveActivity" class="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2">
          <i data-lucide="plus-circle" class="w-5 h-5"></i> Crear Actividad
        </button>
      </div>
    </div>
  `;
  Modal.open(modalId, content);

  document.getElementById('btnSaveActivity').onclick = async () => {
    const title = document.getElementById('actTitle').value;
    const desc = document.getElementById('actDesc').value;
    if (!title) return safeToast('Escribe un nombre para la actividad', 'warning');

    const btn = document.getElementById('btnSaveActivity');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Creando...';
    requestAnimationFrame(() => window.lucide?.createIcons());

    try {
      await MaestraApi.createActivity(configId, title, desc, nextNumber, true);
      safeToast('Actividad creada correctamente');
      Modal.close(modalId);
      await initGradesV2();
    } catch (e) {
      safeToast('Error al crear actividad: ' + (e.message || ''), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="plus-circle" class="w-5 h-5"></i> Crear Actividad';
      requestAnimationFrame(() => window.lucide?.createIcons());
    }
  };
}

export async function gradeActivity(activityId, activityTitle, activityNumber) {
  const students = AppState.get('students') || [];
  const classroom = AppState.get('classroom');
  const modalId = 'gradeActivityModal';

  try {
    const { open: periodOpen } = await _getPeriodStatus(classroom?.id);

    const { data: existingGrades } = await supabase
      .from('grades')
      .select('id, student_id, score_v2, notes')
      .eq('activity_id', activityId);

    const gradeMap = {};
    (existingGrades || []).forEach(g => { gradeMap[g.student_id] = g; });

    const closedBanner = !periodOpen ? `
      <div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3">
        <i data-lucide="lock" class="w-5 h-5 text-amber-500"></i>
        <div>
          <p class="text-xs font-black text-amber-800 uppercase tracking-wide">Periodo cerrado</p>
          <p class="text-[10px] text-amber-600 font-medium">Las calificaciones estan bloqueadas.</p>
        </div>
      </div>` : '';

    const content = `
      <div class="bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col max-h-[90vh]">
        <div class="flex justify-between items-start mb-6">
          <div>
            <h3 class="text-2xl font-black text-slate-800">Calificar Actividad</h3>
            <p class="text-xs font-bold text-slate-400 mt-1">${safeEscapeHTML(activityTitle)} — #${activityNumber}</p>
          </div>
          <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <i data-lucide="x" class="w-6 h-6 text-slate-400"></i>
          </button>
        </div>
        ${closedBanner}
        <div class="space-y-3 overflow-y-auto pr-2 flex-1">
          ${students.length > 0 ? students.map(s => {
            const existing = gradeMap[s.id];
            const currentScore = existing?.score_v2 ?? '';
            const disabled = !periodOpen ? 'disabled' : '';

            return `
              <div class="p-4 bg-slate-50 rounded-2xl border ${existing ? 'border-green-200 bg-green-50/30' : 'border-slate-100'}">
                <div class="flex items-center justify-between mb-3">
                  <div class="font-bold text-slate-800 text-sm">${safeEscapeHTML(s.name)}</div>
                  ${existing ? '<span class="text-xs text-green-600 font-bold flex items-center gap-1"><i data-lucide="check-circle" class="w-3 h-3"></i> Calificado</span>' : ''}
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div class="md:col-span-2">
                    <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Comentario (Opcional)</label>
                    <textarea id="v2comment-${s.id}" ${disabled} rows="2"
                      class="w-full p-2 bg-white rounded-lg text-xs border border-slate-200 focus:ring-1 focus:ring-indigo-400 outline-none"
                      placeholder="Retroalimentacion...">${safeEscapeHTML(existing?.notes || '')}</textarea>
                  </div>
                  <div class="flex items-center gap-2">
                    <div class="flex-1">
                      <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Calificacion (0-100)</label>
                      <input type="number" id="v2score-${s.id}" ${disabled} min="0" max="100" step="0.1"
                        value="${currentScore}"
                        class="w-full p-2 rounded-lg text-sm font-bold bg-white border border-slate-200 focus:ring-1 focus:ring-indigo-400 outline-none text-center"
                        placeholder="0-100">
                    </div>
                    <button onclick="${periodOpen ? `App.saveGradeV2('${activityId}', '${s.id}')` : 'void(0)'}"
                      class="p-2 ${periodOpen ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-300 text-slate-500 cursor-not-allowed'} rounded-lg transition-all"
                      ${!periodOpen ? 'disabled' : ''}>
                      <i data-lucide="save" class="w-4 h-4"></i>
                    </button>
                  </div>
                </div>
              </div>`;
          }).join('') : '<div class="text-center p-4 text-slate-400">No hay alumnos en la clase.</div>'}
        </div>
      </div>
    `;
    Modal.open(modalId, content);
    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    safeToast('Error al cargar actividad', 'error');
  }
}

export async function saveGradeV2(activityId, studentId) {
  const classroom = AppState.get('classroom');
  const { open: periodOpen } = await _getPeriodStatus(classroom?.id);
  if (!periodOpen) {
    safeToast('El periodo esta cerrado', 'warning');
    return;
  }

  const score = document.getElementById(`v2score-${studentId}`)?.value;
  const comment = document.getElementById(`v2comment-${studentId}`)?.value;

  if (score === '' || score === null || score === undefined) {
    return safeToast('Ingresa una calificacion', 'warning');
  }

  const scoreNum = parseFloat(score);
  if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) {
    return safeToast('La calificacion debe ser entre 0 y 100', 'warning');
  }

  try {
    const user = AppState.get('user');
    await MaestraApi.saveGradeV2(activityId, studentId, scoreNum, comment, user?.id);

    const student = (AppState.get('students') || []).find(s => s.id === studentId);
    if (student?.parent_id) {
      sendPush({
        user_id: student.parent_id,
        title: 'Calificacion Registrada',
        message: `${student.name} recibio ${scoreNum}/100 en una actividad`,
        link: 'panel_padres.html#grades'
      }).catch(() => {});
    }

    safeToast('Calificacion guardada');
    if (window.App?.refreshPendingGradesBadge) window.App.refreshPendingGradesBadge();
    const el = document.getElementById(`v2score-${studentId}`);
    if (el) {
      const card = el.closest('.p-4');
      if (card) {
        card.classList.add('border-green-300', 'bg-emerald-50');
        setTimeout(() => card.classList.remove('border-green-300', 'bg-emerald-50'), 1500);
      }
    }
  } catch (e) {
    safeToast('Error al calificar: ' + (e.message || ''), 'error');
  }
}

export async function deleteActivityV2(activityId) {
  if (!confirm('Eliminar esta actividad? Se perderan todas las calificaciones asociadas.')) return;
  try {
    await MaestraApi.deleteActivity(activityId);
    safeToast('Actividad eliminada');
    await initGradesV2();
  } catch (e) {
    safeToast('Error al eliminar', 'error');
  }
}

export function toggleArea(configId) {
  const body = document.getElementById(`area-body-${configId}`);
  if (!body) return;
  const willOpen = body.classList.contains('hidden');
  document.querySelectorAll('[data-area-body]').forEach(b => b.classList.add('hidden'));
  if (willOpen) body.classList.remove('hidden');
  const chevron = document.getElementById(`area-chevron-${configId}`);
  if (chevron && window.lucide) {
    chevron.innerHTML = `<i data-lucide="${willOpen ? 'chevron-up' : 'chevron-down'}" class="w-4 h-4"></i>`;
  }
  if (window.lucide) window.lucide.createIcons();
}

export async function deleteArea(configId, subjectName) {
  if (!confirm(`Eliminar el área "${subjectName}"? Se perderán todas sus actividades y calificaciones.`)) return;
  try {
    await MaestraApi.deletePeriodConfig(configId);
    safeToast('Área eliminada');
    await initGradesV2();
  } catch (e) {
    safeToast('Error al eliminar el área', 'error');
  }
}

// ── Vista: Notas por estudiante (modal auxiliar) ──────────────

export async function openStudentGradesList() {
  const modalId = 'studentGradesModal';
  const classroom = AppState.get('classroom');

  const periodRes = await supabase.rpc('get_active_period', { p_classroom_id: classroom?.id });
  let period = periodRes?.data;
  if (!period || !period.found) return safeToast('No hay período activo para esta aula', 'warning');

  let config = await MaestraApi.getPeriodConfig(period.id);
  if (!config || !config.length) {
    const resolved = await resolveActivePeriodConfig(period);
    period = resolved.period;
    config = resolved.config;
  }

  const students = AppState.get('students') || [];
  const activities = await MaestraApi.getActivitiesWithGrades(period.id);
  const allGrades = await fetchPeriodGrades(period, activities);
  const { tasks, scores } = await loadPeriodTasks(config);
  const stats = buildStudentStats(students, config, activities, allGrades, scores, tasks);

  Modal.open(modalId, `
    <div class="bg-white w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden rounded-[2rem]">
      <div class="flex justify-between items-start px-6 pt-6 pb-4 border-b border-slate-100">
        <div>
          <h3 class="text-2xl font-black text-slate-800">Estudiantes</h3>
          <p class="text-xs font-bold text-slate-400 mt-1">${safeEscapeHTML(period.name)} · ${students.length} estudiantes · Doble clic para ver cuadrícula</p>
        </div>
        <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors"><i data-lucide="x" class="w-6 h-6 text-slate-400"></i></button>
      </div>
      <div class="flex-1 overflow-y-auto p-5 bg-slate-50">
        <div class="relative mb-4">
          <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"></i>
          <input id="studentGradesSearch" type="text" placeholder="Buscar por nombre o matrícula..."
            class="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-400 outline-none">
        </div>
        <div class="space-y-2">
          ${students.length ? stats.map(({ student: s, overall }) => `
            <div data-student-row data-search="${safeEscapeHTML((s.name || '') + ' ' + (s.matricula || ''))}"
              ondblclick="App.openStudentResultGrid('${s.id}')"
              class="flex items-center justify-between gap-3 p-3 bg-white rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:border-indigo-200 hover:shadow-md transition-all">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm overflow-hidden shrink-0">
                  ${s.avatar_url ? `<img src="${safeEscapeHTML(s.avatar_url)}" alt="" class="w-full h-full object-cover" onerror="this.remove()">` : safeEscapeHTML((s.name || '?').charAt(0))}
                </div>
                <div class="min-w-0">
                  <div class="font-black text-slate-800 text-sm truncate">${safeEscapeHTML(s.name)}</div>
                  <div class="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">${safeEscapeHTML(s.matricula || 'Sin matrícula')}</div>
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${overall == null ? 'bg-slate-100 text-slate-500' : overall >= 80 ? 'bg-emerald-50 text-emerald-600' : overall >= 60 ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'}">${overall != null ? Number(overall).toFixed(1) : '—'}</span>
                <i data-lucide="chevron-right" class="w-4 h-4 text-slate-300"></i>
              </div>
            </div>`).join('') : `
            <div class="text-center py-16">
              <div class="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-4">👧</div>
              <p class="font-bold text-slate-600">No hay estudiantes en esta aula</p>
            </div>`}
        </div>
      </div>
    </div>
  `);
  if (window.lucide) window.lucide.createIcons();

  const input = document.getElementById('studentGradesSearch');
  if (input) {
    input.addEventListener('input', () => {
      const q = (input.value || '').trim().toLowerCase();
      document.querySelectorAll('[data-student-row]').forEach(row => {
        row.style.display = (row.dataset.search || '').toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }
}

export function viewStudentGrades(studentId) {
  return openStudentResultGrid(studentId);
}