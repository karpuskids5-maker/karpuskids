import { supabase, sendPush, emitEvent } from '../../shared/supabase.js';
import { AppState } from '../state.js';
import { MaestraApi } from '../api.js';
import { safeToast, safeEscapeHTML, Modal } from './ui.js';
import { notifyParents } from '../../shared/notify-feedback.js';

export async function initTasks() {
  const classroom = AppState.get('classroom');
  const container = document.getElementById('tab-tasks');
  if (!container) return;

  container.innerHTML = `
    <div class="flex justify-between items-center mb-8">
      <h3 class="text-2xl font-black text-slate-800 flex items-center gap-3">🎒 Mochila de Tareas</h3>
      <button onclick="App.openNewTaskModal()" class="px-6 py-3 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-orange-200 hover:bg-orange-700 transition-all flex items-center gap-2">
        <i data-lucide="plus-circle" class="w-5 h-5"></i> Nueva Tarea
      </button>
    </div>
    <div id="tasksListContainer" class="space-y-4">
      <div class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600 mx-auto"></div></div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();

  const listContainer = document.getElementById('tasksListContainer');
  try {
    const tasks = await MaestraApi.getTasksByClassroom(classroom.id);
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
    console.error(e);
    listContainer.innerHTML = '<div class="text-center p-8 text-rose-500">Error al cargar tareas.</div>';
  }
}

export async function openEditTaskModal(taskId) {
  try {
    const { data: task, error } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    if (error) throw error;
    openNewTaskModal(task);
  } catch (err) {
    console.error('Error al obtener la tarea para editar:', err);
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
    console.error('Error al eliminar tarea:', err);
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
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Título de la Tarea</label>
          <input type="text" id="taskTitle" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-orange-400 outline-none" required>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Descripción / Instrucciones</label>
          <textarea id="taskDesc" rows="5" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-orange-400 outline-none resize-none" placeholder="Explica qué deben hacer los alumnos..." required></textarea>
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
      console.error('Error guardando tarea:', err);
      safeToast(`Error al ${isEditing ? 'actualizar' : 'crear'} la tarea.`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i data-lucide="${isEditing ? 'save' : 'send'}" class="w-5 h-5"></i> ${buttonText}`;
      requestAnimationFrame(() => window.lucide?.createIcons());
    }
  };
}

export async function viewTaskSubmissions(taskId) {
  const students = AppState.get('students') || [];
  const modalId = 'taskSubmissionsModal';
  try {
    const { data: submissions, error: subError } = await supabase.from('task_evidences').select('*').eq('task_id', taskId);
    if (subError) throw subError;

    const subMap = {};
    (submissions || []).forEach(s => subMap[s.student_id] = s);

    const content = `
      <div class="bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col max-h-[90vh]">
        <div class="flex justify-between items-start mb-6">
          <h3 class="text-2xl font-black text-slate-800">Revisión de Entregas</h3>
          <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <i data-lucide="x" class="w-6 h-6 text-slate-400"></i>
          </button>
        </div>
        <div class="space-y-4 overflow-y-auto pr-2 flex-1">
          ${students.length > 0 ? students.map(s => {
            const sub = subMap[s.id];
            const hasSubmission = sub && sub.file_url;
            const isGraded = sub && sub.status === 'graded';
            const safeUrl = hasSubmission ? encodeURI(sub.file_url) : '#';
            return `
              <div class="p-5 bg-slate-50 rounded-2xl border border-slate-100">
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
                    <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Retroalimentación</label>
                    <textarea id="feedback-${s.id}" class="w-full p-2 bg-white rounded-lg text-xs border border-slate-200 focus:ring-1 focus:ring-orange-400 outline-none" rows="2" placeholder="Escribe un comentario...">${safeEscapeHTML(sub?.comment || '')}</textarea>
                  </div>
                  <div class="flex items-center gap-2">
                    <div class="flex-1">
                      <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Nota</label>
                      <select id="grade-${s.id}" class="w-full p-2 rounded-lg text-xs font-bold bg-white border border-slate-200">
                        <option value="">-</option>
                        <option value="A" ${sub?.grade_letter === 'A' ? 'selected' : ''}>A (Excelente)</option>
                        <option value="B" ${sub?.grade_letter === 'B' ? 'selected' : ''}>B (Bien)</option>
                        <option value="C" ${sub?.grade_letter === 'C' ? 'selected' : ''}>C (Suficiente)</option>
                        <option value="D" ${sub?.grade_letter === 'D' ? 'selected' : ''}>D (Mejorable)</option>
                      </select>
                    </div>
                    <div class="flex-1">
                      <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Estrellas</label>
                      <select id="stars-${s.id}" class="w-full p-2 rounded-lg text-xs font-bold bg-white border border-slate-200">
                        ${[0,1,2,3,4,5].map(n => `<option value="${n}" ${sub?.stars === n ? 'selected' : ''}>${'⭐'.repeat(n) || 'Ninguna'}</option>`).join('')}
                      </select>
                    </div>
                    <button onclick="App.submitGrade('${taskId}', '${s.id}')" class="p-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all self-end" title="Guardar Calificación">
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
    console.error('Error al cargar entregas:', err);
    safeToast('Error al cargar entregas', 'error');
  }
}

export async function submitGrade(taskId, studentId) {
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
        title: 'Tarea Calificada 🏆',
        message: `La maestra ha calificado una tarea de ${student.name}. Nota: ${grade}`,
        link: 'panel_padres.html#grades'
      }).catch(err => console.warn('Push error:', err));
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
    console.error('Error al calificar tarea:', e);
    safeToast('Error al calificar', 'error');
  }
}
