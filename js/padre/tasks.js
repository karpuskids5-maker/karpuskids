import { supabase } from '../shared/supabase.js';
import { AppState, TABLES, CacheKeys } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';

/**
 * 🎒 MÓDULO DE TAREAS (PADRES)
 */
export const TasksModule = {
  _studentId: null,

  /**
   * Inicializa el módulo
   */
  async init(studentId) {
    if (!studentId) return;
    this._studentId = studentId;
    
    // Delegación de eventos para filtros
    const filtersContainer = document.querySelector('.task-filters-container') || document.querySelector('#tasks .flex.bg-white.p-1.rounded-full.shadow-sm.border');
    if (filtersContainer && !filtersContainer._initialized) {
      Helpers.delegate(filtersContainer, 'button', 'click', (e, btn) => {
        const filter = btn.dataset.filter || 'pending';
        this.loadTasks(filter);
        
        // Actualizar UI de botones
        filtersContainer.querySelectorAll('button').forEach(b => {
          b.classList.toggle('bg-emerald-100', b === btn);
          b.classList.toggle('text-emerald-700', b === btn);
          b.classList.toggle('text-slate-500', b !== btn);
          b.classList.toggle('font-bold', b === btn);
        });
      });
      filtersContainer._initialized = true;
    }

    // Delegación para acciones de tareas (Enviar/Ver)
    const list = document.getElementById('tasksList');
    if (list && !list._initialized) {
      Helpers.delegate(list, '[data-action="submit"]', 'click', (e, btn) => {
        this.openSubmitModal(btn.dataset.id);
      });
      Helpers.delegate(list, '[data-action="view"]', 'click', (e, btn) => {
        this.viewEvidence(btn.dataset.id);
      });
      list._initialized = true;
    }

    await this.loadTasks('pending');
  },

  /**
   * Abre modal para enviar tarea
   */
  async openSubmitModal(taskId) {
    try {
      const { data: task, error } = await supabase.from(TABLES.TASKS).select('*').eq('id', taskId).single();
      if (error) throw error;

      const modal = document.getElementById('modalTaskDetail');
      if (!modal) return;

      document.getElementById('taskDetailTitle').textContent = task.title;
      document.getElementById('taskDetailDate').innerHTML = `<i data-lucide="calendar" class="w-3 h-3"></i> Vence: ${Helpers.formatDate(task.due_date)}`;
      document.getElementById('taskDetailDesc').textContent = task.description || 'Sin descripción.';
      
      // Reset form
      document.getElementById('uploadSection').classList.remove('hidden');
      document.getElementById('evidenceSection').classList.add('hidden');
      document.getElementById('taskFileInput').value = '';
      document.getElementById('fileNameDisplay').textContent = 'Toca para subir tu tarea';
      document.getElementById('taskCommentInput').value = '';
      
      // Store current task ID in modal for submit
      modal.dataset.currentTaskId = taskId;

      modal.classList.remove('hidden');
      modal.classList.add('flex');
      if (window.lucide) lucide.createIcons();

      // Setup close and submit listeners once
      if (!modal._initialized) {
        document.getElementById('btnCloseTaskDetail').onclick = () => modal.classList.add('hidden');
        document.getElementById('btnSubmitTask').onclick = () => this.submitTask();
        
        document.getElementById('taskFileInput').onchange = (e) => {
          const file = e.target.files[0];
          if (file) {
            document.getElementById('fileNameDisplay').textContent = file.name;
          }
        };
        modal._initialized = true;
      }
    } catch (e) {
      console.error('Error openSubmitModal:', e);
      Helpers.toast('Error al abrir detalle de tarea', 'error');
    }
  },

  /**
   * Envía la evidencia de la tarea
   */
  async submitTask() {
    const modal = document.getElementById('modalTaskDetail');
    const taskId = modal.dataset.currentTaskId;
    const student = AppState.get('currentStudent');
    const user = AppState.get('user');

    const fileInput = document.getElementById('taskFileInput');
    const file = fileInput.files[0];
    const comment = document.getElementById('taskCommentInput').value.trim();

    if (!file) return Helpers.toast('Debes adjuntar un archivo', 'warning');

    // 🛡️ Validación de tamaño (Máx 5MB)
    if (file.size > 5 * 1024 * 1024) return Helpers.toast('El archivo es muy grande (máx 5MB)', 'error');

    try {
      AppState.set('loading', true);
      Helpers.toast('Enviando misión...', 'info');

      const ext = file.name.split('.').pop().toLowerCase();
      const path = `evidences/${student.id}_${taskId}_${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage.from('classroom_media').upload(path, file);
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage.from('classroom_media').getPublicUrl(path);

      const { error } = await supabase.from(TABLES.TASK_EVIDENCES).insert({
        task_id: taskId,
        student_id: student.id,
        parent_id: user.id,
        file_url: publicUrl,
        comment,
        status: 'submitted'
      });

      if (error) throw error;

      Helpers.toast('¡Misión cumplida! Tarea enviada', 'success');
      modal.classList.add('hidden');
      await this.loadTasks('pending');

    } catch (e) {
      console.error('Submit task error:', e);
      Helpers.toast('Error al enviar tarea', 'error');
    } finally {
      AppState.set('loading', false);
    }
  },

  /**
   * Ver evidencia ya enviada
   */
  async viewEvidence(taskId) {
    try {
      const student = AppState.get('currentStudent');
      const { data: evidence, error } = await supabase
        .from(TABLES.TASK_EVIDENCES)
        .select('*, task:task_id(*)')
        .eq('task_id', taskId)
        .eq('student_id', student.id)
        .single();

      if (error) throw error;

      const modal = document.getElementById('modalTaskDetail');
      if (!modal) return;

      document.getElementById('taskDetailTitle').textContent = evidence.task.title;
      document.getElementById('taskDetailDate').innerHTML = `<i data-lucide="calendar" class="w-3 h-3"></i> Entregada: ${Helpers.formatDate(evidence.created_at)}`;
      document.getElementById('taskDetailDesc').textContent = evidence.task.description || 'Sin descripción.';

      // Show evidence section
      document.getElementById('uploadSection').classList.add('hidden');
      document.getElementById('evidenceSection').classList.remove('hidden');
      
      document.getElementById('evidenceDate').textContent = `Enviado el: ${Helpers.formatDate(evidence.created_at)}`;
      document.getElementById('evidenceComment').textContent = evidence.comment || "Sin comentario";
      const evidenceLink = document.getElementById('evidenceLink');
      if (evidenceLink) {
        evidenceLink.href = '#';
        evidenceLink.onclick = (e) => { e.preventDefault(); window.openLightbox(evidence.file_url, 'image'); };
      }

      modal.classList.remove('hidden');
      modal.classList.add('flex');
      if (window.lucide) lucide.createIcons();

      if (!modal._initialized) {
        document.getElementById('btnCloseTaskDetail').onclick = () => modal.classList.add('hidden');
        modal._initialized = true;
      }
    } catch (e) {
      console.error('Error viewEvidence:', e);
      Helpers.toast('Error al ver entrega', 'error');
    }
  },

  /**
   * Carga tareas y evidencias
   */
  async loadTasks(filter = 'pending') {
    const container = document.getElementById('tasksList');
    if (!container) return;

    container.innerHTML = Helpers.skeleton(3, 'h-32');

    try {
      const student = AppState.get('currentStudent');
      if (!student?.classroom_id) {
        container.innerHTML = Helpers.emptyState('Sin aula asignada', '🎒');
        return;
      }

      // Obtener tareas y evidencias en paralelo
      const [tasksRes, evidencesRes] = await Promise.all([
        supabase.from(TABLES.TASKS).select('*').eq('classroom_id', student.classroom_id).order('due_date', { ascending: false }),
        supabase.from(TABLES.TASK_EVIDENCES).select('*').eq('student_id', student.id)
      ]);

      if (tasksRes.error) throw tasksRes.error;
      if (evidencesRes.error) throw evidencesRes.error;

      const tasks = tasksRes.data || [];
      const evidences = evidencesRes.data || [];
      const evidenceMap = new Map(evidences.map(e => [e.task_id, e]));

      // Filtrar
      const filtered = this.filterTasks(tasks, evidenceMap, filter);

      if (!filtered.length) {
        container.innerHTML = Helpers.emptyState(
          filter === 'pending' ? '¡Todo al día! No hay tareas pendientes' : 'No hay tareas en esta categoría',
          filter === 'pending' ? '🎉' : '🎒'
        );
        return;
      }

      container.innerHTML = filtered.map(t => this.renderTaskCard(t, evidenceMap.get(t.id))).join('');
      if (window.lucide) lucide.createIcons();

    } catch (err) {
      console.error('Error loadTasks:', err);
      container.innerHTML = Helpers.emptyState('Error al cargar tareas', '❌');
    }
  },

  /**
   * Filtra tareas según estado
   */
  filterTasks(tasks, evidenceMap, filter) {
    const now = new Date();
    return tasks.filter(t => {
      const isDelivered = evidenceMap.has(t.id);
      const isOverdue = !isDelivered && t.due_date && new Date(t.due_date) < now;

      if (filter === 'submitted') return isDelivered;
      if (filter === 'overdue') return isOverdue;
      if (filter === 'pending') return !isDelivered && !isOverdue;
      return true;
    });
  },

  /**
   * Renderiza una tarea
   */
  renderTaskCard(t, evidence) {
    const isDelivered = !!evidence;
    const dueDate = t.due_date ? new Date(t.due_date) : null;
    const isOverdue = !isDelivered && dueDate && dueDate < new Date();

    let statusBadge = '';
    if (isDelivered) {
      statusBadge = `<span class="px-3 py-1 bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase rounded-full">Entregada</span>`;
    } else if (isOverdue) {
      statusBadge = `<span class="px-3 py-1 bg-rose-100 text-rose-700 text-[9px] font-black uppercase rounded-full">Vencida</span>`;
    } else {
      statusBadge = `<span class="px-3 py-1 bg-blue-100 text-blue-700 text-[9px] font-black uppercase rounded-full">Pendiente</span>`;
    }

    return `
      <div class="bg-white p-5 rounded-2xl border-2 border-slate-100 mb-4 hover:shadow-lg hover:border-green-200 transition-all group">
        <div class="flex justify-between items-start mb-3">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-xl ${isDelivered ? 'bg-green-100 text-green-700' : 'bg-amber-50 text-amber-600'} flex items-center justify-center text-xl shadow-sm group-hover:scale-110 transition-transform">
              ${isDelivered ? '\u2705' : '\uD83D\uDCDD'}
            </div>
            <div>
              <h4 class="font-black text-slate-800 text-sm leading-tight">${escapeHtml(t.title)}</h4>
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Vence: ${Helpers.formatDate(t.due_date)}</p>
            </div>
          </div>
          ${statusBadge}
        </div>
        
        ${t.file_url ? `<div class="mb-3 rounded-xl overflow-hidden border border-slate-100 cursor-zoom-in bg-black" onclick="window.openLightbox('${t.file_url}','image')"><img src="${t.file_url}" class="w-full max-h-64 object-cover" loading="lazy" alt="Imagen de tarea" onerror="this.parentElement.style.display='none'"></div>` : ''}
        
        <p class="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-4">${escapeHtml(t.description || 'Sin descripción detallada.')}</p>
        
        <div class="flex gap-2">
          ${isDelivered 
            ? `<button data-action="view" data-id="${t.id}" class="flex-1 py-2.5 bg-green-50 text-green-700 border border-green-200 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-green-100 transition-all">\u2705 Ver Entrega</button>`
            : `<button data-action="submit" data-id="${t.id}" class="flex-1 py-2.5 bg-green-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-green-600 shadow-md shadow-green-200 transition-all">\uD83D\uDE80 Enviar Tarea</button>`
          }
        </div>
      </div>
    `;
  }
};
