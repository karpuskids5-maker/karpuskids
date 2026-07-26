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
    const tasks = await MaestraApi.getTasksByClassroom(classroom.id);
    if (!tasks.length) {
      listContainer.innerHTML = '<div class="text-center p-8 text-slate-500">AÃƒºn no has asignado tareas.</div>';
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
    const { data: task, error } = await supabase.from('tasks').select('id, title, description, due_date, grading_system, file_url, classroom_id').eq('id', taskId).single();
    if (error) throw error;
    openNewTaskModal(task);
  } catch (err) {
    safeToast('No se pudo cargar la tarea para editar', 'error');
  }
}

export async function deleteTask(taskId) {
  if (!confirm('¿Eliminar esta tarea? Los datos se perderÃƒ¡n permanentemente.')) return;
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
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Ti­tulo de la Tarea</label>
          <input type="text" id="taskTitle" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-orange-400 outline-none" required>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Descripcion / Instrucciones</label>
          <textarea id="taskDesc" rows="5" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-orange-400 outline-none resize-none" placeholder="Explica quÃƒ© deben hacer los alumnos..." required></textarea>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Fecha de Entrega</label>
          <input type="date" id="taskDueDate" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-orange-400 outline-none" required>
        </div>
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
       return safeToast('El archivo es demasiado grande (mÃƒ¡x 50MB)', 'error');
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

      const payload = {
        classroom_id: classroom.id,
        title,
        description,
        due_date: dueDate,
        file_url: fileUrl,
        teacher_id: AppState.get('user').id
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
          title:   `Ã°Å¸â€œÅ¡ Nueva Tarea Ã¢â‚¬â€ ${classroomName}`,
          message: `"${payload.title}" Ã‚· Entrega: ${payload.due_date}`,
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

// Ã¢â€â‚¬Ã¢â€â‚¬ Helper: verificar si el perÃƒ­odo activo del aula estÃƒ¡ abierto Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
async function _getPeriodStatus(classroomId) {
  try {
    const { data, error } = await supabase.rpc('get_active_period', { p_classroom_id: classroomId });
    // Si el RPC no existe (404) o hay error, asumir perÃƒ­odo abierto (permisivo)
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
    // Verificar estado del perÃƒ­odo ANTES de mostrar el modal
    const { open: periodOpen, period } = await _getPeriodStatus(classroom?.id);

    const { data: submissions, error: subError } = await supabase
      .from('task_evidences')
      .select('id, task_id, student_id, status, grade_letter, stars, file_url, comment, created_at')
      .eq('task_id', taskId);
    if (subError) throw subError;

    const subMap = {};
    (submissions || []).forEach(s => subMap[s.student_id] = s);

    // Banner de perÃƒ­odo cerrado
    const closedBanner = !periodOpen ? `
      <div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3">
        <span class="text-xl">Ã°Å¸â€â€™</span>
        <div>
          <p class="text-xs font-black text-amber-800 uppercase tracking-wide">PerÃƒ­odo cerrado</p>
          <p class="text-[10px] text-amber-600 font-medium">Las calificaciones estÃƒ¡n bloqueadas. Solo la directora puede reabrirlo.</p>
        </div>
      </div>` : '';

    const content = `
      <div class="bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col max-h-[90vh]">
        <div class="flex justify-between items-start mb-6">
          <div>
            <h3 class="text-2xl font-black text-slate-800">RevisiÃƒ³n de Entregas</h3>
            ${period ? `<p class="text-xs font-bold text-slate-400 mt-1">PerÃƒ­odo: ${safeEscapeHTML(period.name)} ${periodOpen ? 'Ã°Å¸Å¸¢ Abierto' : 'Ã°Å¸â€â€™ Cerrado'}</p>` : ''}
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
            // Deshabilitar inputs si perÃƒ­odo cerrado
            const disabled = !periodOpen ? 'disabled class="opacity-50 cursor-not-allowed"' : '';
            const disabledSelect = !periodOpen ? 'disabled' : '';
            const btnDisabled = !periodOpen ? 'disabled title="PerÃƒ­odo cerrado" class="p-2 bg-slate-300 text-slate-500 rounded-lg cursor-not-allowed self-end"' : 'class="p-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all self-end" title="Guardar CalificaciÃƒ³n"';

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
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div class="md:col-span-2">
                    <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">RetroalimentaciÃƒ³n</label>
                    <textarea id="feedback-${s.id}" ${disabled} rows="2"
                      class="w-full p-2 bg-white rounded-lg text-xs border border-slate-200 focus:ring-1 focus:ring-orange-400 outline-none ${!periodOpen ? 'opacity-50 cursor-not-allowed' : ''}"
                      placeholder="Escribe un comentario...">${safeEscapeHTML(sub?.comment || '')}</textarea>
                  </div>
                  <div class="flex items-center gap-2">
                    <div class="flex-1">
                      <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Nota</label>
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
                        ${[0,1,2,3,4,5].map(n => `<option value="${n}" ${sub?.stars === n ? 'selected' : ''}>${'Ã¢­'.repeat(n) || 'Ninguna'}</option>`).join('')}
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
  // Verificar perÃƒ­odo antes de guardar
  const classroom = AppState.get('classroom');
  const { open: periodOpen } = await _getPeriodStatus(classroom?.id);
  if (!periodOpen) {
    safeToast('El perÃƒ­odo estÃƒ¡ cerrado. No se pueden modificar calificaciones.', 'warning');
    return;
  }

  const grade = document.getElementById(`grade-${studentId}`)?.value;
  const stars = document.getElementById(`stars-${studentId}`)?.value;
  const feedback = document.getElementById(`feedback-${studentId}`)?.value;

  if (!grade) return safeToast('Selecciona una nota para calificar.', 'warning');

  try {
    await MaestraApi.gradeTask(taskId, studentId, grade, parseInt(stars), feedback);
    
    const student = (AppState.get('students') || []).find(s => s.id === studentId);
    if (student?.parent_id) {
      sendPush({
        user_id: student.parent_id,
        title: 'Tarea Calificada Ã°Å¸â€ ',
        message: `La maestra ha calificado una tarea de ${student.name}. Nota: ${grade}`,
        link: 'panel_padres.html#grades'
      }).catch(() => {});
    }
    
    safeToast('CalificaciÃƒ³n guardada');
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
    const period = periodRes?.data;

    if (!period || !period.found) {
      content.innerHTML = `
        <div class="text-center py-16">
          <div class="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-4">📋</div>
          <p class="font-bold text-slate-600">No hay periodo activo</p>
          <p class="text-xs text-slate-400 mt-1">La directora debe crear y activar un periodo primero</p>
        </div>`;
      return;
    }

    const config = await MaestraApi.getPeriodConfig(period.id);
    if (!config || !config.length) {
      content.innerHTML = `
        <div class="text-center py-16">
          <div class="w-16 h-16 bg-amber-100 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-4">⚙️</div>
          <p class="font-bold text-slate-600">Sin materias configuradas</p>
          <p class="text-xs text-slate-400 mt-1">La directora debe configurar las materias del periodo</p>
        </div>`;
      return;
    }

    const activities = await MaestraApi.getActivitiesWithGrades(period.id);
    const actByConfig = {};
    (activities || []).forEach(a => {
      if (!actByConfig[a.config_id]) actByConfig[a.config_id] = [];
      actByConfig[a.config_id].push(a);
    });

    const students = AppState.get('students') || [];

    let html = `
      <div class="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-2xl flex items-center gap-3">
        <i data-lucide="info" class="w-5 h-5 text-indigo-500"></i>
        <div>
          <p class="text-xs font-black text-indigo-800 uppercase tracking-wide">${safeEscapeHTML(period.name)}</p>
          <p class="text-[10px] text-indigo-600 font-medium">Periodo activo — ${config.length} materias configuradas</p>
        </div>
      </div>`;

    for (const cfg of config) {
      const existingActs = actByConfig[cfg.id] || [];
      const slotsUsed = existingActs.length;
      const slotsTotal = cfg.activity_count;
      const isFull = slotsUsed >= slotsTotal;

      html += `
        <div class="bg-white p-5 rounded-3xl border-2 border-slate-50 shadow-sm">
          <div class="flex justify-between items-start mb-4">
            <div>
              <h4 class="font-black text-slate-800 text-base">${safeEscapeHTML(cfg.subject_name)}</h4>
              <p class="text-xs font-bold text-slate-400">${slotsUsed}/${slotsTotal} actividades creadas</p>
            </div>
            ${!isFull ? `
              <button onclick="App.openNewActivityModal('${cfg.id}', '${safeEscapeHTML(cfg.subject_name)}', ${slotsUsed + 1})"
                class="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase hover:bg-indigo-700 transition-all flex items-center gap-2">
                <i data-lucide="plus" class="w-4 h-4"></i> Nueva Actividad
              </button>
            ` : '<span class="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-black">COMPLETO</span>'}
          </div>
          ${existingActs.length > 0 ? `
            <div class="space-y-3">
              ${existingActs.map(act => `
                <div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div class="flex items-center gap-3">
                    <span class="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center font-black text-sm">${act.activity_number}</span>
                    <div>
                      <div class="font-bold text-slate-800 text-sm">${safeEscapeHTML(act.title)}</div>
                      <div class="text-[10px] text-slate-400 font-bold">${act.graded_count}/${students.length} calificada${students.length !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <button onclick="App.gradeActivity('${act.id}', '${safeEscapeHTML(act.title)}', ${act.activity_number})"
                      class="px-4 py-2 bg-orange-600 text-white rounded-xl text-xs font-black uppercase hover:bg-orange-700 transition-all">
                      Calificar
                    </button>
                    <button onclick="App.deleteActivityV2('${act.id}')"
                      class="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                      title="Eliminar actividad">
                      <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <div class="text-center py-6 text-slate-400 text-sm">
              <p class="font-bold">Aún no hay actividades creadas</p>
              <p class="text-xs mt-1">Crea actividades para comenzar a calificar</p>
            </div>
          `}
        </div>`;
    }

    content.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
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
