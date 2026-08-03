
import { supabase } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';

const ReportsModule = {
  state: {
    reports: [],
    loading: false,
    filters: {
      target_type: null,
      status: null,
      severity: null
    }
  },

  severityConfig: {
    low: { color: 'bg-blue-100 text-blue-800 border-blue-300', emoji: '🔵', label: 'Baja' },
    medium: { color: 'bg-yellow-100 text-yellow-800 border-yellow-300', emoji: '🟡', label: 'Media' },
    high: { color: 'bg-orange-100 text-orange-800 border-orange-300', emoji: '🟠', label: 'Alta' },
    critical: { color: 'bg-red-100 text-red-800 border-red-300', emoji: '🔴', label: 'Crítica' }
  },

  statusConfig: {
    pending: { color: 'bg-gray-100 text-gray-800', label: 'Pendiente', icon: '⏳' },
    in_progress: { color: 'bg-blue-100 text-blue-800', label: 'En Proceso', icon: '🔄' },
    resolved: { color: 'bg-green-100 text-green-800', label: 'Resuelto', icon: '✅' },
    escalated: { color: 'bg-red-100 text-red-800', label: 'Escalado', icon: '⚠️' },
    closed: { color: 'bg-gray-100 text-gray-600', label: 'Cerrado', icon: '📦' }
  },

  categoryLabels: {
    conduct: 'Conducta',
    academic: 'Académico',
    attendance: 'Asistencia',
    communication: 'Comunicación',
    other: 'Otro'
  },

  init: async function () {
    await this.fetchReports();
    this.render();
    this.bindEvents();
  },

  fetchReports: async function () {
    this.state.loading = true;
    try {
      // PostgREST no soporta filter:{} inline en select — se hace query separada
      let query = supabase
        .from('reports')
        .select(`
          *,
          target:profiles!reports_target_id_fkey(id, name, email),
          reporter:profiles!reports_reporter_id_fkey(id, name),
          attachments_count:report_attachments(count),
          actions_pending:report_actions(count)
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (this.state.filters.target_type) {
        query = query.eq('target_type', this.state.filters.target_type);
      }
      if (this.state.filters.status) {
        query = query.eq('status', this.state.filters.status);
      }
      if (this.state.filters.severity) {
        query = query.eq('severity', this.state.filters.severity);
      }

      const { data, error } = await query;
      if (error) throw error;
      this.state.reports = data || [];
    } catch (err) {
      Helpers.safeLog('error', 'Error fetching reports:', err);
      Helpers.toast('Error al cargar reportes', 'error');
    } finally {
      this.state.loading = false;
    }
  },

  render: function () {
    const container = document.getElementById('reports-container');
    if (!container) return;

    if (this.state.loading) {
      container.innerHTML = this.renderSkeleton();
      return;
    }

    if (!this.state.reports.length) {
      container.innerHTML = `
        <div class="text-center py-12">
          <div class="text-6xl mb-4">📋</div>
          <h3 class="text-xl font-semibold text-gray-700 mb-2">No hay reportes</h3>
          <p class="text-gray-500 mb-4">Comienza a crear reportes haciendo clic en el botón de abajo</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.state.reports.map(report => this.renderReportCard(report)).join('');
    
    if (window.lucide) lucide.createIcons();
  },

  renderSkeleton: function () {
    return Array(3).fill(`
      <div class="bg-white rounded-lg shadow-md p-4 animate-pulse">
        <div class="h-6 bg-gray-200 rounded w-3/4 mb-2"></div>
        <div class="h-4 bg-gray-200 rounded w-1/2 mb-3"></div>
        <div class="h-16 bg-gray-200 rounded mb-3"></div>
        <div class="flex gap-2">
          <div class="h-6 bg-gray-200 rounded w-20"></div>
          <div class="h-6 bg-gray-200 rounded w-24"></div>
        </div>
      </div>
    `).join('');
  },

  renderReportCard: function (report) {
    const severity = this.severityConfig[report.severity];
    const status = this.statusConfig[report.status];
    const attachmentCount = (report.attachments_count && report.attachments_count[0]?.count) || 0;
    const actionsPending = (report.actions_pending && report.actions_pending[0]?.count) || 0;
    const createdAt = new Date(report.created_at).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
    const followUpDate = report.follow_up_date ? new Date(report.follow_up_date).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short'
    }) : null;

    return `
      <div class="bg-white rounded-lg shadow-md hover:shadow-lg transition-all duration-200 border-l-4 ${severity.color.split(' ')[2]} p-4 cursor-pointer hover:scale-[1.01]"
           data-report-id="${report.id}"
           onclick="ReportsModule.openReportDetail('${report.id}')">
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="text-2xl">${severity.emoji}</span>
            <div>
              <h3 class="font-semibold text-gray-900 text-lg">${Helpers.escapeHTML(report.title)}</h3>
              <p class="text-sm text-gray-500">${Helpers.escapeHTML(report.report_number)}</p>
            </div>
          </div>
          <div class="px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${status.color}">
            ${status.icon} ${status.label}
          </div>
        </div>

        <div class="flex items-center gap-2 mb-3 text-sm">
          <span class="text-gray-500">${report.target_type === 'teacher' ? '👨‍🏫' : '👨‍👩‍👧'}</span>
          <span class="text-gray-700">Reportar a:</span>
          <span class="font-medium text-gray-900">${Helpers.escapeHTML(report.target?.name || 'Desconocido')}</span>
        </div>

        <p class="text-sm text-gray-600 mb-3 line-clamp-2">${Helpers.escapeHTML(report.description)}</p>

        <div class="flex flex-wrap gap-2 mb-3">
          <span class="px-2 py-1 rounded text-xs font-medium ${severity.color}">
            ${severity.label}
          </span>
          <span class="px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-800">
            🏷️ ${this.categoryLabels[report.category]}
          </span>
          ${attachmentCount > 0 ? `
            <span class="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">
              📎 ${attachmentCount} archivo${attachmentCount > 1 ? 's' : ''}
            </span>
          ` : ''}
          ${actionsPending > 0 ? `
            <span class="px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-800">
              📋 ${actionsPending} acción${actionsPending > 1 ? 'es' : ''} pendiente${actionsPending > 1 ? 's' : ''}
            </span>
          ` : ''}
        </div>

        <div class="flex items-center justify-between text-xs text-gray-500 pt-3 border-t">
          <div class="flex items-center gap-1">
            📅 Creado: ${createdAt}
          </div>
          ${followUpDate ? `
            <div class="flex items-center gap-1 text-orange-600">
              ⏳ Seguimiento: ${followUpDate}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  },

  openCreateModal: function () {
    window.openGlobalModal(this.renderCreateForm());
    this.bindModalEvents();
  },

  renderCreateForm: function () {
    return `
      <div class="p-6">
        <h2 class="text-2xl font-bold text-gray-900 mb-6">Crear Nuevo Reporte</h2>
        <form id="create-report-form" class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Reportar a:</label>
              <select id="report-target-type" class="w-full p-2 border rounded-lg" required>
                <option value="teacher">👨‍🏫 Maestro</option>
                <option value="parent">👨‍👩‍👧 Padre</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Severidad:</label>
              <select id="report-severity" class="w-full p-2 border rounded-lg" required>
                <option value="low">🔵 Baja</option>
                <option value="medium" selected>🟡 Media</option>
                <option value="high">🟠 Alta</option>
                <option value="critical">🔴 Crítica</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Destinatario:</label>
            <select id="report-target-id" class="w-full p-2 border rounded-lg" required></select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Categoría:</label>
            <select id="report-category" class="w-full p-2 border rounded-lg" required>
              <option value="conduct">Conducta</option>
              <option value="academic">Académico</option>
              <option value="attendance">Asistencia</option>
              <option value="communication">Comunicación</option>
              <option value="other">Otro</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Título del Reporte:</label>
            <input type="text" id="report-title" class="w-full p-2 border rounded-lg" required placeholder="Ej: Incidente en el aula">
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Descripción Detallada:</label>
            <textarea id="report-description" rows="4" class="w-full p-2 border rounded-lg" required placeholder="Describe el incidente o situación..."></textarea>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Acciones Requeridas (una por línea):</label>
            <textarea id="report-required-actions" rows="3" class="w-full p-2 border rounded-lg" placeholder="- Reunión con el maestro&#10;- Seguimiento semanal&#10;- Plan de mejora"></textarea>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Fecha de Seguimiento:</label>
            <input type="date" id="report-follow-up-date" class="w-full p-2 border rounded-lg">
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Evidencias (Archivos):</label>
            <input type="file" id="report-attachments" multiple accept="image/*,.pdf,.doc,.docx" class="w-full p-2 border rounded-lg">
            <p id="attachment-count" class="text-sm text-gray-600 mt-1"></p>
          </div>

          <div class="flex gap-2 justify-end pt-4">
            <button type="button" onclick="App.ui.closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-50">
              Cancelar
            </button>
            <button type="submit" id="submit-report-btn" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
              Crear Reporte
            </button>
          </div>
        </form>
      </div>
    `;
  },

  bindModalEvents: function () {
    // Cargar destinatarios
    const targetTypeSelect = document.getElementById('report-target-type');
    const targetIdSelect = document.getElementById('report-target-id');
    this.loadTargets(targetTypeSelect.value);

    targetTypeSelect.addEventListener('change', (e) => {
      this.loadTargets(e.target.value);
    });

    // Mostrar conteo de archivos
    const attachmentsInput = document.getElementById('report-attachments');
    const attachmentCount = document.getElementById('attachment-count');
    attachmentsInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        attachmentCount.textContent = `${e.target.files.length} archivo${e.target.files.length > 1 ? 's' : ''} seleccionado${e.target.files.length > 1 ? 's' : ''}`;
      } else {
        attachmentCount.textContent = '';
      }
    });

    // Envío del formulario
    const form = document.getElementById('create-report-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.createReport();
    });
  },

  loadTargets: async function (targetType) {
    const targetIdSelect = document.getElementById('report-target-id');
    try {
      let query = supabase.from('profiles').select('id, name');
      if (targetType === 'teacher') {
        query = query.in('role', ['maestra', 'asistente']);
      } else {
        query = query.eq('role', 'padre');
      }
      const { data, error } = await query.order('name');
      if (error) throw error;

      targetIdSelect.innerHTML = data.map(p => `
        <option value="${p.id}">${Helpers.escapeHTML(p.name)}</option>
      `).join('');
    } catch (err) {
      Helpers.safeLog('error', 'Error loading targets:', err);
      Helpers.toast('Error al cargar destinatarios', 'error');
    }
  },

  createReport: async function () {
    const btn = document.getElementById('submit-report-btn');
    btn.disabled = true;
    btn.textContent = 'Creando...';

    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: profileData } = await supabase.from('profiles').select('role').eq('id', userData.user.id).single();

      const reportNumber = `KR-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
      const requiredActionsInput = document.getElementById('report-required-actions').value;
      const requiredActions = requiredActionsInput ? requiredActionsInput.split('\n').filter(Boolean) : null;

      const { data: newReport, error: createError } = await supabase
        .from('reports')
        .insert({
          report_number: reportNumber,
          reporter_id: userData.user.id,
          reporter_role: profileData.role,
          target_type: document.getElementById('report-target-type').value,
          target_id: document.getElementById('report-target-id').value,
          category: document.getElementById('report-category').value,
          severity: document.getElementById('report-severity').value,
          title: document.getElementById('report-title').value,
          description: document.getElementById('report-description').value,
          required_actions: requiredActions,
          follow_up_date: document.getElementById('report-follow-up-date').value || null,
          status: 'pending'
        })
        .select()
        .single();

      if (createError) throw createError;

      // Subir archivos adjuntos
      const filesInput = document.getElementById('report-attachments');
      if (filesInput.files.length > 0) {
        for (let i = 0; i < filesInput.files.length; i++) {
          const file = filesInput.files[i];
          const filePath = `reports/${newReport.id}/${file.name}`;
          
          const { error: uploadError } = await supabase.storage
            .from('attachments')
            .upload(filePath, file);

          if (!uploadError) {
            await supabase.from('report_attachments').insert({
              report_id: newReport.id,
              file_name: file.name,
              file_path: filePath,
              file_type: file.type,
              file_size: file.size,
              uploaded_by: userData.user.id
            });
          }
        }
      }

      // Enviar notificación
      await supabase.from('notifications').insert({
        user_id: newReport.target_id,
        type: 'report_received',
        title: 'Nuevo Reporte',
        message: `Has recibido un nuevo reporte: ${newReport.title}`
      });

      Helpers.toast('Reporte creado exitosamente!', 'success');
      App.ui.closeModal();
      await this.fetchReports();
      this.render();
    } catch (err) {
      Helpers.safeLog('error', 'Error creating report:', err);
      Helpers.toast('Error al crear reporte', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Crear Reporte';
    }
  },

  openReportDetail: function (reportId) {
    const report = this.state.reports.find(r => r.id === reportId);
    if (!report) return;

    window.openGlobalModal(this.renderReportDetail(report));
  },

  renderReportDetail: function (report) {
    const severity = this.severityConfig[report.severity];
    const status = this.statusConfig[report.status];
    const createdAt = new Date(report.created_at).toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    return `
      <div class="p-6">
        <div class="flex items-start justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold text-gray-900 mb-1">${Helpers.escapeHTML(report.title)}</h2>
            <p class="text-gray-500">${Helpers.escapeHTML(report.report_number)}</p>
          </div>
          <div class="px-3 py-1 rounded-full text-sm font-medium ${status.color}">
            ${status.icon} ${status.label}
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4 mb-6">
          <div class="bg-gray-50 p-4 rounded-lg">
            <p class="text-sm text-gray-500 mb-1">Reportante</p>
            <p class="font-semibold">${Helpers.escapeHTML(report.reporter?.name || 'Desconocido')}</p>
          </div>
          <div class="bg-gray-50 p-4 rounded-lg">
            <p class="text-sm text-gray-500 mb-1">Destinatario</p>
            <p class="font-semibold">
              ${report.target_type === 'teacher' ? '👨‍🏫' : '👨‍👩‍👧'} ${Helpers.escapeHTML(report.target?.name || 'Desconocido')}
            </p>
          </div>
          <div class="bg-gray-50 p-4 rounded-lg">
            <p class="text-sm text-gray-500 mb-1">Categoría</p>
            <p class="font-semibold">${this.categoryLabels[report.category]}</p>
          </div>
          <div class="bg-gray-50 p-4 rounded-lg">
            <p class="text-sm text-gray-500 mb-1">Severidad</p>
            <p class="font-semibold ${severity.color}">${severity.label}</p>
          </div>
        </div>

        <div class="mb-6">
          <h3 class="font-semibold mb-2">Descripción</h3>
          <p class="text-gray-700 whitespace-pre-wrap">${Helpers.escapeHTML(report.description)}</p>
        </div>

        ${report.required_actions?.length ? `
          <div class="mb-6">
            <h3 class="font-semibold mb-2">Acciones Requeridas</h3>
            <ul class="list-disc list-inside text-gray-700 space-y-1">
              ${report.required_actions.map(action => `<li>${Helpers.escapeHTML(action)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <div class="text-sm text-gray-500 pt-4 border-t">
          <p>Creado el ${createdAt}</p>
          ${report.follow_up_date ? `
            <p class="text-orange-600 mt-1">⏳ Fecha de seguimiento: ${new Date(report.follow_up_date).toLocaleDateString('es-ES')}</p>
          ` : ''}
        </div>

        <div class="flex gap-2 justify-end mt-6 pt-4 border-t">
          <button onclick="App.ui.closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-50">
            Cerrar
          </button>
          ${['pending', 'in_progress'].includes(report.status) ? `
            <button onclick="ReportsModule.updateStatus('${report.id}', 'resolved')" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
              ✅ Marcar como Resuelto
            </button>
          ` : ''}
        </div>
      </div>
    `;
  },

  updateStatus: async function (reportId, newStatus) {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const updateData = {
        status: newStatus,
        updated_at: new Date().toISOString()
      };
      
      if (newStatus === 'resolved' || newStatus === 'closed') {
        updateData.resolved_at = new Date().toISOString();
        updateData.resolved_by = userData.user.id;
      }

      const { error } = await supabase
        .from('reports')
        .update(updateData)
        .eq('id', reportId);

      if (error) throw error;

      Helpers.toast('Estado actualizado!', 'success');
      App.ui.closeModal();
      await this.fetchReports();
      this.render();
    } catch (err) {
      Helpers.safeLog('error', 'Error updating status:', err);
      Helpers.toast('Error al actualizar estado', 'error');
    }
  },

  bindEvents: function () {
    // Botón crear reporte
    const createBtn = document.getElementById('create-report-btn');
    if (createBtn && !createBtn._bound) {
      createBtn._bound = true;
      createBtn.addEventListener('click', () => this.openCreateModal());
    }

    // Filtros
    const bindFilter = (id, key) => {
      const el = document.getElementById(id);
      if (el && !el._bound) {
        el._bound = true;
        el.addEventListener('change', async (e) => {
          this.state.filters[key] = e.target.value || null;
          await this.fetchReports();
          this.render();
        });
      }
    };
    bindFilter('filter-report-status',   'status');
    bindFilter('filter-report-severity', 'severity');
    bindFilter('filter-report-type',     'target_type');
  }
};

window.ReportsModule = ReportsModule;

export { ReportsModule };
export default ReportsModule;
