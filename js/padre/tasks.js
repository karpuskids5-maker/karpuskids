import { supabase } from '../shared/supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';
import { ImageLoader } from '../shared/image-loader.js';

/**
 * 🎒 MÓDULO DE TAREAS (PADRES)
 */
export const TasksModule = {
  _studentId: null,
  _activeFilter: 'pending',
  _tasks: [],          // tareas del aula + evidencias, para el selector de captura
  _evidenceMap: new Map(),
  _pendingCapture: null, // File comprimida lista para adjuntar

  /**
   * Inicializa el módulo
   */
  async init(studentId) {
    if (!studentId) return;
    this._studentId = studentId;
    this._injectStyles();

    // Delegación de eventos para filtros
    const filtersContainer = document.querySelector('.task-filters-container') || document.querySelector('#tasks .flex.bg-white.p-1.rounded-full.shadow-sm.border');
    if (filtersContainer && !filtersContainer._initialized) {
      Helpers.delegate(filtersContainer, 'button', 'click', (e, btn) => {
        const filter = btn.dataset.filter || 'pending';
        this._activeFilter = filter;
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



    // 🔁 Restaurar el filtro activo previo (no perder contexto al volver)
    await this.loadTasks(this._activeFilter);
  },

  /**
   * Estilos mínimos del módulo: el badge de estado usa sombra doble
   * (claro arriba / oscuro abajo) que `shadow-*` de Tailwind no expresa.
   * Se inyecta una sola vez para no depender de recompilar karpus-tailwind.css.
   */
  _injectStyles() {
    if (document.getElementById('kk-task-styles')) return;
    const style = document.createElement('style');
    style.id = 'kk-task-styles';
    style.textContent = `
      .kk-task-neu{box-shadow:inset 0 1px 2px rgba(255,255,255,0.9),inset 0 -2px 4px rgba(15,23,42,0.10)}
      .kk-task-neu-amber{background:#fef3c7;color:#92400e;box-shadow:inset 0 1px 2px rgba(255,255,255,0.9),inset 0 -2px 5px rgba(180,83,9,0.22)}
      .kk-task-neu-blue{background:#dbeafe;color:#1e40af;box-shadow:inset 0 1px 2px rgba(255,255,255,0.9),inset 0 -2px 5px rgba(29,78,216,0.22)}
      .kk-task-neu-green{background:#dcfce7;color:#166534;box-shadow:inset 0 1px 2px rgba(255,255,255,0.9),inset 0 -2px 5px rgba(21,128,61,0.22)}
      .kk-task-neu-rose{background:#ffe4e6;color:#9f1239;box-shadow:inset 0 1px 2px rgba(255,255,255,0.9),inset 0 -2px 5px rgba(190,18,60,0.22)}
      .kk-task-pick{display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;border-radius:16px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;text-align:left;transition:all 0.15s}
      .kk-task-pick:hover{border-color:#fdba74;background:#fff7ed;transform:translateX(2px)}
      .kk-task-pick:active{transform:scale(0.98)}`;
    document.head.appendChild(style);
  },



  /** Menú corto: cámara directa o elegir de la galería */
  _chooseCaptureSource(camInput, galInput) {
    const openPicker = () => { try { camInput.click(); } catch (_) { galInput.click(); } };
    const openGallery = () => { try { galInput.click(); } catch (_) { /* sin fallback */ } };

    if (!window.openGlobalModal) { openPicker(); return; }
    window.openGlobalModal(`
      <div class="bg-white rounded-[2.5rem] p-6 w-full max-w-sm">
        <h3 class="text-lg font-black text-slate-800 mb-1">Subir evidencia</h3>
        <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-5">Captura rápida</p>
        <button id="kkCapCam" class="kk-task-pick mb-3">
          <span class="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">📷</span>
          <span class="flex-1">
            <span class="block text-sm font-black text-slate-800">Tomar foto</span>
            <span class="block text-[11px] font-bold text-slate-400">Cámara trasera del cuaderno</span>
          </span>
        </button>
        <button id="kkCapGal" class="kk-task-pick">
          <span class="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">🖼️</span>
          <span class="flex-1">
            <span class="block text-sm font-black text-slate-800">Elegir de la galería</span>
            <span class="block text-[11px] font-bold text-slate-400">Foto o PDF ya guardado</span>
          </span>
        </button>
        <button onclick="window.closeGlobalModal?.()" class="w-full mt-5 py-3 bg-slate-100 text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all">Cancelar</button>
      </div>`);

    document.getElementById('kkCapCam')?.addEventListener('click', () => {
      window.closeGlobalModal?.();
      setTimeout(openPicker, 120);
    });
    document.getElementById('kkCapGal')?.addEventListener('click', () => {
      window.closeGlobalModal?.();
      setTimeout(openGallery, 120);
    });
  },

  /**
   * Comprime la imagen en el cliente y pide a qué tarea adjuntarla.
   * La compresión baja el peso antes de subir: en redes de móvil la foto de
   * 4 MB de la cámara es la causa más común de envíos fallidos.
   */
  async _handleCapturedFile(file) {
    if (file.type.startsWith('image/') && file.size > 5 * 1024 * 1024) {
      return Helpers.toast('Foto demasiado grande (máx 5MB)', 'error');
    }
    Helpers.toast('Optimizando imagen...', 'info');
    let prepared = file;
    try {
      prepared = await ImageLoader.compress(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.82 });
    } catch (_) { prepared = file; }
    this._pendingCapture = prepared;
    if (navigator.vibrate) navigator.vibrate(12);
    this._pickTaskForCapture();
  },

  /** Selector de tarea destino; si solo hay una pendiente, se abre directo */
  _pickTaskForCapture() {
    const open = this.filterTasks(this._tasks, this._evidenceMap, 'pending');
    const overdue = this.filterTasks(this._tasks, this._evidenceMap, 'overdue');
    const candidates = [...open, ...overdue];

    if (!candidates.length) {
      return Helpers.toast('No tienes tareas pendientes para entregar', 'warning');
    }
    if (candidates.length === 1) {
      return this.openSubmitModal(candidates[0].id);
    }

    const rows = candidates.map(t => {
      const late = this._evidenceMap.has(t.id) === false && t.due_date && new Date(t.due_date) < new Date();
      return `
        <button class="kk-task-pick mb-2" data-task="${t.id}">
          <span class="w-10 h-10 rounded-xl ${late ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'} flex items-center justify-center shrink-0">📝</span>
          <span class="flex-1 min-w-0">
            <span class="block text-sm font-black text-slate-800 truncate">${escapeHtml(t.title)}</span>
            <span class="block text-[11px] font-bold ${late ? 'text-rose-500' : 'text-slate-400'}">Vence: ${Helpers.formatDate(t.due_date)}</span>
          </span>
        </button>`;
    }).join('');

    window.openGlobalModal?.(`
      <div class="bg-white rounded-[2.5rem] p-6 w-full max-w-md">
        <h3 class="text-lg font-black text-slate-800 mb-1">¿A qué tarea?</h3>
        <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-5">Foto lista para enviar</p>
        <div class="max-h-80 overflow-y-auto">${rows}</div>
        <button onclick="window.closeGlobalModal?.()" class="w-full mt-4 py-3 bg-slate-100 text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all">Cancelar</button>
      </div>`);

    document.querySelectorAll('[data-task]').forEach(btn => {
      btn.addEventListener('click', () => {
        window.closeGlobalModal?.();
        setTimeout(() => this.openSubmitModal(btn.dataset.task), 120);
      });
    });
  },

  /**
   * Abre modal para enviar tarea. `prefilled` adjunta la foto ya capturada.
   */
  async openSubmitModal(taskId, prefilled = null) {
    try {
      const { data: task, error } = await supabase.from(TABLES.TASKS).select('id, title, description, due_date, grading_system, file_url, classroom_id, created_at').eq('id', taskId).single();
      if (error) throw error;

      const modal = document.getElementById('modalTaskDetail');
      if (!modal) return;

      document.getElementById('taskDetailTitle').textContent = task.title;
      document.getElementById('taskDetailDate').innerHTML = `<i data-lucide="calendar" class="w-3 h-3"></i> Vence: ${Helpers.formatDate(task.due_date)}`;
      document.getElementById('taskDetailDesc').textContent = task.description || 'Sin descripción.';

      // Reset form
      document.getElementById('uploadSection').classList.remove('hidden');
      document.getElementById('evidenceSection').classList.add('hidden');
      const fileInput = document.getElementById('taskFileInput');
      fileInput.value = '';
      this._pendingCapture = prefilled || null;
      document.getElementById('fileNameDisplay').textContent = this._pendingCapture
        ? `📷 ${this._pendingCapture.name}`
        : 'Toca para subir tu tarea';
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

        fileInput.onchange = (e) => {
          const file = e.target.files[0];
          if (file) {
            this._pendingCapture = null; // el archivo manual manda sobre la captura
            document.getElementById('fileNameDisplay').textContent = file.name;
          }
        };
        modal._initialized = true;
      }
    } catch (e) {
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
    // La captura por cámara vive fuera del <input>, así que se prioriza.
    const file = this._pendingCapture || fileInput.files[0];
    const comment = document.getElementById('taskCommentInput').value.trim();

    if (!file) return Helpers.toast('Debes adjuntar un archivo', 'warning');

    // 🛡️ Validación de tamaño (Máx 5MB)
    if (file.size > 5 * 1024 * 1024) return Helpers.toast('El archivo es muy grande (máx 5MB)', 'error');

    try {
      AppState.set('loading', true);
      Helpers.toast('Enviando misión...', 'info');

      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
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

      this._pendingCapture = null;

      // ✅ ÉXITO: Confetti y Mensaje Motivador
      window.App?.celebrate?.(['#f59e0b', '#3b82f6', '#10b981']);

      Helpers.toast('¡Misión cumplida! Tarea enviada', 'success');

      // Mostrar mensaje de éxito bonito
      window.openGlobalModal(`
        <div class="bg-white rounded-[2.5rem] p-8 text-center animate-scaleIn w-full max-w-sm">
          <div class="w-20 h-20 bg-orange-100 text-orange-600 rounded-3xl flex items-center justify-center mx-auto mb-6 text-4xl shadow-lg shadow-orange-50">🚀</div>
          <h3 class="text-2xl font-black text-slate-800 mb-2">¡Tarea Enviada!</h3>
          <p class="text-sm font-bold text-slate-500 leading-relaxed mb-6">
            ¡Misión cumplida! La maestra revisará tu tarea pronto. ¡Sigue así! 🌟
          </p>
          <button onclick="window.closeGlobalModal?.()" class="w-full py-4 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-orange-100 active:scale-95 transition-all">
            ¡Entendido!
          </button>
        </div>
      `);

      modal.classList.add('hidden');
      await this.loadTasks(this._activeFilter);

    } catch (e) {
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

      // Si la maestra ya calificación, se muestra arriba del archivo.
      let gradeEl = document.getElementById('evidenceGrade');
      if (!gradeEl) {
        gradeEl = document.createElement('div');
        gradeEl.id = 'evidenceGrade';
        gradeEl.className = 'mb-4';
        document.getElementById('evidenceSection')?.prepend(gradeEl);
      }
      if (evidence.status === 'graded') {
        const parts = [];
        if (evidence.grade_letter) parts.push(`Letra ${escapeHtml(String(evidence.grade_letter))}`);
        if (evidence.stars != null) parts.push('⭐'.repeat(Math.max(0, Number(evidence.stars) || 0)));
        gradeEl.className = 'kk-task-neu-green rounded-xl px-4 py-3 mb-4 text-center';
        gradeEl.innerHTML = `<p class="text-[9px] font-black uppercase tracking-widest mb-1">Calificación de la maestra</p>
          <p class="text-sm font-black">${parts.length ? parts.join(' · ') : 'Tarea revisada'}</p>`;
      } else {
        gradeEl.className = '';
        gradeEl.innerHTML = '';
      }

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
      Helpers.toast('Error al ver entrega', 'error');
    }
  },

  /**
   * Carga tareas y evidencias
   */
  async loadTasks(filter = 'pending') {
    const container = document.getElementById('tasksList');
    if (!container) return;
    this._activeFilter = filter;

    container.innerHTML = Helpers.skeleton(3, 'h-32');

    try {
      const student = AppState.get('currentStudent');
      if (!student?.classroom_id) {
        container.innerHTML = Helpers.emptyState('Sin aula asignada', '🎒');
        return;
      }

      // Intentar RPC que filtra por período activo automáticamente
      let tasks = [];
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('get_tasks_for_period', {
          p_classroom_id: student.classroom_id,
          p_period_id:    null
        });
        // Solo usar si el RPC existe (no 404/PGRST202)
        if (!rpcErr && rpcData?.tasks) {
          tasks = rpcData.tasks;
        } else if (rpcErr?.code === 'PGRST202' || rpcErr?.message?.includes('function') || rpcErr?.message?.includes('404')) {
          // RPC no desplegado aún — usar fallback silenciosamente
        }
      } catch (_) { /* fallback */ }

      // Fallback: query directa sin filtro de período
      if (!tasks.length) {
        const { data, error } = await supabase
          .from(TABLES.TASKS)
          .select('id, title, description, due_date, grading_system, file_url, created_at, period_id')
          .eq('classroom_id', student.classroom_id)
          .order('due_date', { ascending: false });
        if (error) throw error;
        tasks = data || [];
      }

      // Evidencias del estudiante
      const { data: evidences, error: evErr } = await supabase
        .from(TABLES.TASK_EVIDENCES)
        .select('id, task_id, status, grade_letter, stars, file_url, comment, created_at')
        .eq('student_id', student.id);
      if (evErr) throw evErr;

      const evidenceMap = new Map((evidences || []).map(e => [e.task_id, e]));
      this._tasks = tasks || [];
      this._evidenceMap = evidenceMap;
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
   * Estado de una tarea visto por la familia.
   * `graded` es el valor que escribe la maestra (js/maestra/modules/tasks.js
   * cuenta como pendientes justamente lo que NO es 'graded').
   */
  _statusOf(t, evidence) {
    if (!evidence) {
      const due = t.due_date ? new Date(t.due_date) : null;
      if (due && due < new Date()) return 'overdue';
      return 'pending';
    }
    return evidence.status === 'graded' ? 'graded' : 'delivered';
  },

  /**
   * Renderiza una tarea
   */
  renderTaskCard(t, evidence) {
    const dueDate = t.due_date ? new Date(t.due_date) : null;
    const status = this._statusOf(t, evidence);

    // Código de color: Pendiente (amarillo) · Enviada (azul) · Calificada (verde).
    // "Vencida" conserva el rojo: es una alerta, no una etapa del flujo.
    const META = {
      pending:  { label: 'Pendiente',  cls: 'kk-task-neu-amber', icon: '📝', dot: 'text-amber-500',  btn: 'bg-green-500 hover:bg-green-600 text-white shadow-md shadow-green-200', btnLabel: '🚀 Enviar Tarea', action: 'submit' },
      overdue:  { label: 'Vencida',    cls: 'kk-task-neu-rose',  icon: '⚠️', dot: 'text-rose-500',   btn: 'bg-green-500 hover:bg-green-600 text-white shadow-md shadow-green-200', btnLabel: '🚀 Enviar Tarea', action: 'submit' },
      delivered:{ label: 'Enviada',    cls: 'kk-task-neu-blue',  icon: '📨', dot: 'text-blue-500',   btn: 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100', btnLabel: '👀 Ver Entrega', action: 'view' },
      graded:   { label: 'Calificada', cls: 'kk-task-neu-green', icon: '⭐', dot: 'text-green-600',  btn: 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100', btnLabel: '⭐ Ver Calificación', action: 'view' },
    };
    const meta = META[status];
    const isGraded = status === 'graded';

    // Calificación de la maestra, si ya la dejó.
    let gradeTag = '';
    if (isGraded) {
      const parts = [];
      if (evidence.grade_letter) parts.push(`Letra ${escapeHtml(String(evidence.grade_letter))}`);
      if (evidence.stars != null) parts.push(`${'⭐'.repeat(Math.max(0, Number(evidence.stars) || 0))}`);
      if (parts.length) {
        gradeTag = `<div class="mb-3 rounded-xl bg-green-50 border border-green-200 px-3 py-2 text-[11px] font-black text-green-700">${parts.join(' · ')}</div>`;
      }
    }

    return `
      <div class="task-card bg-white p-5 rounded-2xl border-2 ${isGraded ? 'border-green-200' : 'border-slate-100'} mb-4 hover:shadow-lg transition-all group" data-task-id="${t.id || ''}">
        <div class="flex justify-between items-start mb-3">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-11 h-11 rounded-xl ${meta.cls} flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
              ${meta.icon}
            </div>
            <div class="min-w-0">
              <h4 class="font-black text-slate-800 text-sm leading-tight truncate">${escapeHtml(t.title)}</h4>
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Vence: ${Helpers.formatDate(t.due_date)}</p>
            </div>
          </div>
          <span class="${meta.cls} px-3 py-1 text-[9px] font-black uppercase rounded-full shrink-0 kk-task-neu">${meta.label}</span>
        </div>

        ${gradeTag}

        ${t.file_url ? `<div class="mb-3 rounded-xl overflow-hidden border border-slate-100 cursor-zoom-in bg-black" onclick="window.openLightbox('${t.file_url}','image')"><img src="${t.file_url}" class="w-full max-h-64 object-cover" loading="lazy" alt="Imagen de tarea" onerror="this.parentElement.style.display='none'"></div>` : ''}

        <p class="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-4">${escapeHtml(t.description || 'Sin descripción detallada.')}</p>

        <div class="flex gap-2">
          <button data-action="${meta.action}" data-id="${t.id}"
            class="flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${meta.btn}">
            ${meta.btnLabel}
          </button>
          ${status === 'overdue' ? `
          <button onclick="App.navigateTo('grades')" title="Ver calificaciones y progreso de tu hijo/a"
            class="px-3 py-2.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-100 transition-all shrink-0">
            🏆 Progreso
          </button>` : ''}
        </div>
      </div>
    `;
  }
};
