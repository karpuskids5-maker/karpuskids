import { supabase } from '../supabase.js';
import { AppState, TABLES, GlobalCache, STORAGE_BUCKETS } from './appState.js';
import { Helpers, escapeHtml, triggerConfetti } from './helpers.js';

export async function loadTasks(filter = 'pending') {
  const container = document.getElementById('tasksList');
  if (!container) return;

  container.innerHTML = Helpers.skeleton(3, 'h-24');
  container.setAttribute('aria-busy', 'true');

  try {
    const student = AppState.get('student');
    if (!student?.classroom_id) {
      container.innerHTML = Helpers.emptyState('No hay aula asignada');
      return;
    }

    let tasksData = GlobalCache.get('tasks');
    let evidencesData = GlobalCache.get('evidences');

    if (!tasksData || !evidencesData) {
      const [tasksRes, evidencesRes] = await Promise.all([
        supabase
          .from(TABLES.TASKS)
          .select('*')
          .eq('classroom_id', student.classroom_id)
          .order('due_date', { ascending: false })
          .range(0, 49),

        supabase
          .from(TABLES.TASK_EVIDENCES)
          .select('*')
          .eq('student_id', student.id)
      ]);

      if (tasksRes.error) throw tasksRes.error;
      if (evidencesRes.error) throw evidencesRes.error;

      tasksData = tasksRes.data || [];
      evidencesData = evidencesRes.data || [];

      GlobalCache.set('tasks', tasksData);
      GlobalCache.set('evidences', evidencesData);
    }

    const evidenceMap = new Map(evidencesData.map(e => [e.task_id, e]));
    const filteredTasks = filterTasks(tasksData, evidenceMap, filter);

    if (!filteredTasks.length) {
      container.innerHTML = Helpers.emptyState(
        filter === 'pending'
          ? '¡Todo al día! No hay tareas pendientes'
          : 'No hay tareas en esta categoría'
      );
      return;
    }

    container.innerHTML = filteredTasks
      .map(task => renderTaskCard(task, evidenceMap))
      .join('');

    const summary = document.getElementById('tasksSummary');
    if (summary) {
      const pendingCount = filterTasks(tasksData, evidenceMap, 'pending').length;
      summary.textContent = pendingCount > 0
        ? `Tienes ${pendingCount} tareas pendientes`
        : '¡Estás al día!';
    }

    if (window.lucide) lucide.createIcons();

  } catch (err) {
    console.error('Error cargando tareas:', err);
    container.innerHTML = Helpers.emptyState('Error al cargar tareas');
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

function filterTasks(tasks, evidenceMap, filter) {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  return tasks.filter(task => {
    const isDelivered = evidenceMap.has(task.id);
    const dueDate = task.due_date ? new Date(task.due_date) : null;
    const isOverdue = !isDelivered && dueDate && dueDate < endOfToday;

    if (filter === 'submitted') return isDelivered;
    if (filter === 'overdue') return isOverdue;
    if (filter === 'pending') return !isDelivered && !isOverdue;

    return true;
  });
}

function renderTaskCard(task, evidenceMap) {
  const evidence = evidenceMap.get(task.id);
  const isDelivered = !!evidence;

  const classroom = Array.isArray(task.classrooms)
    ? task.classrooms[0]
    : task.classrooms;

  if (isDelivered) {
    const gradeMap = {
      A: { color: 'bg-emerald-500', label: 'Excelente' },
      B: { color: 'bg-sky-500', label: 'Muy bien' },
      C: { color: 'bg-amber-500', label: 'Regular' }
    };

    const grade = gradeMap[evidence.grade_letter] || {
      color: 'bg-slate-400',
      label: 'En revisión'
    };

    return `
    <article class="bg-emerald-50 border border-emerald-100 p-5 rounded-2xl">
      <h3 class="font-bold">${escapeHtml(task.title)}</h3>
      <p class="text-sm">${escapeHtml(task.description || '')}</p>

      <div class="mt-3 flex justify-between items-center">
        <span class="text-xs text-slate-500">
          ${new Date(evidence.created_at).toLocaleDateString()}
        </span>

        <div class="flex items-center gap-2">
          <div class="${grade.color} text-white px-2 py-1 rounded">
            ${escapeHtml(evidence.grade_letter || '')}
          </div>
          <span class="text-xs">${grade.label}</span>
        </div>
      </div>

      <button 
        class="js-task-detail-btn mt-3 text-xs text-blue-600"
        data-task-id="${task.id}">
        Ver detalle
      </button>
    </article>`;
  }

  return `
  <article class="bg-white border p-5 rounded-2xl">
    <h3 class="font-bold">${escapeHtml(task.title)}</h3>
    <p class="text-sm">${escapeHtml(task.description || '')}</p>

    <button 
      class="js-task-detail-btn mt-3 bg-blue-600 text-white px-4 py-2 rounded"
      data-task-id="${task.id}">
      Realizar tarea
    </button>
  </article>`;
}

export async function openTaskDetail(taskId) {
  const modal = document.getElementById('modalTaskDetail');
  if (!modal) return;

  modal.classList.remove('hidden');
  modal.classList.add('flex');

  try {
    const { data: task, error } = await supabase
      .from(TABLES.TASKS)
      .select('*')
      .eq('id', taskId)
      .single();

    if (error) throw error;

    document.getElementById('taskDetailTitle').textContent = task.title;
    document.getElementById('taskDetailDesc').textContent =
      task.description || '';

  } catch (e) {
    console.error(e);
    Helpers.toast('Error al cargar tarea', 'error');
  }
}

export function initTaskSubmissionModule() {
  const fileInput = document.getElementById('taskFileInput');
  const nameDisplay = document.getElementById('fileNameDisplay');

  if (fileInput && nameDisplay) {
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      nameDisplay.textContent = file ? file.name : '';
    });
  }
}