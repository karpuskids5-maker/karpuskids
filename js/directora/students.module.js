import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { UI } from './ui.module.js';
import { AppState } from './state.js';
import { supabase, createClient, SUPABASE_URL, SUPABASE_ANON_KEY } from '../shared/supabase.js';
import { QueryCache } from '../shared/query-cache.js';
import { StudentRecordModal } from '../shared/student-record-modal.js';

export const StudentsModule = {

  async init() {
    try {
      if (!this._dirPage) this._dirPage = 1;
      const pageSize = 10;
      const range = { 
        from: (this._dirPage - 1) * pageSize, 
        to: this._dirPage * pageSize - 1 
      };

      // 1. Obtener datos de estudiantes paginados desde el servidor
      const { data: students, error, count } = await DirectorApi.getStudents({}, range);
      if (error) throw error;

      AppState.set('students', students || []);
      this._totalStudentsCount = count || 0;

      // 2. Obtener datos globales del dashboard para KPIs complementarios
      let dashboardData = AppState.get('dashboardData');
      if (!dashboardData) {
        const { DashboardService } = await import('./dashboard.service.js');
        dashboardData = await DashboardService.getFullData();
      }
      
      const kpis = dashboardData?.stats || {}; // DashboardService usa 'stats'

      // 3. Actualizar tarjetas KPI
      Helpers.setTxt('totalStudents', count || 0);
      Helpers.setTxt('activeStudents', kpis.active || 0);
      Helpers.setTxt('incidents', kpis.pendingInquiries || 0);
      Helpers.setTxt('classroomsCount', kpis.classrooms || 0);
      Helpers.setTxt('avgAttendance', (kpis.attendance || 0) + '%');

      // 4. Renderizar vista de tabla
      const tableWrapper = document.getElementById('studentsTableWrapper');
      tableWrapper?.classList.remove('hidden');
      this.render(students);

      // Renderizar paginación
      this._renderDirPagination(this._dirPage, Math.ceil((count || 0) / pageSize), count || 0, students);
      const searchInput = document.getElementById('searchStudent');
      if (searchInput && !searchInput._bound) {
        searchInput._bound = true;
        searchInput.addEventListener('input', () => this.applyFilters());
      }

      const btnExport = document.getElementById('btnExportStudents');
      if (btnExport && !btnExport._bound) {
        btnExport._bound = true;
        btnExport.onclick = () => {
          Helpers.toast('Generando lista...', 'info');
          Helpers.exportToCSV(AppState.get('students') || [], 'Estudiantes.csv');
        };
      }

      const btnAdd = document.getElementById('btnAddStudent');
      if (btnAdd && !btnAdd._bound) {
        btnAdd._bound = true;
        btnAdd.onclick = () => this.openModal();
      }

      if (window.lucide) lucide.createIcons();
    } catch (e) {
      const container = document.getElementById('studentsTable');
      if (container) {
        container.innerHTML = '<tr><td colspan="3" class="text-center p-8">' + Helpers.errorState('Error al cargar estudiantes', 'App.students.init()') + '</td></tr>';
        if (window.lucide) lucide.createIcons();
      }
    }
  },

  render(students) {
    const tableContainer = document.getElementById('studentsTable');

    if (!students?.length) {
      if (tableContainer) tableContainer.innerHTML = '<tr><td colspan="3" class="text-center py-8 text-slate-500">No hay estudiantes.</td></tr>';
      return;
    }

    const pageStudents = students; // Ya vienen paginados desde el servidor

    // Render Table
    if (tableContainer) {
      tableContainer.innerHTML = pageStudents.map(s => `
        <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 cursor-pointer" ondblclick="App.students.openModal('${s.id}')">
          <td class="p-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-sm font-black text-purple-600 overflow-hidden">
                ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : (s.name || '?').charAt(0)}
              </div>
              <div>
                <div class="font-bold text-slate-800">${Helpers.escapeHTML(s.name)}</div>
                <div class="text-[10px] text-slate-400 font-black uppercase tracking-widest">${s.matricula || 'SIN MATRÍCULA'}</div>
              </div>
            </div>
          </td>
          <td class="p-4 text-sm font-medium text-slate-600">
            <span class="px-3 py-1 bg-slate-100 rounded-full text-[10px] font-black uppercase text-slate-500">
              ${s.classrooms?.name || 'No asignada'}
            </span>
          </td>
          <td class="p-4 text-right">
            <div class="flex justify-end gap-2">
              <button onclick="App.students.openModal('${s.id}')" class="w-9 h-9 flex items-center justify-center bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white rounded-xl transition-all shadow-sm" title="Editar">
                <i data-lucide="edit-3" class="w-4 h-4"></i>
              </button>
              <button onclick="App.students.delete('${s.id}')" class="w-9 h-9 flex items-center justify-center bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-xl transition-all shadow-sm" title="Eliminar">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </td>
        </tr>`).join('');
    }

    if (window.lucide) lucide.createIcons();
  },

  _renderDirPagination(page, totalPages, total, students) {
    let container = document.getElementById('dirStudentsPagination');
    if (!container) {
      const tableWrapper = document.getElementById('studentsTableWrapper');
      if (!tableWrapper) return;
      container = document.createElement('div');
      container.id = 'dirStudentsPagination';
      tableWrapper.insertAdjacentElement('afterend', container);
    }
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    const start = (page - 1) * 10 + 1;
    const end = Math.min(page * 10, total);
    container.className = 'flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-white rounded-b-3xl';
    container.innerHTML = `
      <span class="text-xs font-bold text-slate-400">${start}–${end} de ${total} estudiantes</span>
      <div class="flex gap-2">
        <button id="dirBtnPrev" class="px-3 py-1.5 text-xs font-black rounded-xl border border-slate-200 text-slate-500 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed" ${page <= 1 ? 'disabled' : ''}>← Ant</button>
        <span class="px-3 py-1.5 text-xs font-black text-purple-600 bg-purple-50 rounded-xl">${page} / ${totalPages}</span>
        <button id="dirBtnNext" class="px-3 py-1.5 text-xs font-black rounded-xl border border-slate-200 text-slate-500 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed" ${page >= totalPages ? 'disabled' : ''}>Sig →</button>
      </div>`;
    document.getElementById('dirBtnPrev')?.addEventListener('click', () => { this._dirPage--; this.init(); });
    document.getElementById('dirBtnNext')?.addEventListener('click', () => { this._dirPage++; this.init(); });
  },

  async applyFilters() {
    this._dirPage = 1;
    const term = document.getElementById('searchStudent')?.value.toLowerCase() || '';
    const classroomId = document.getElementById('filterClassroom')?.value || 'all';
    const status = document.getElementById('filterStStatus')?.value || '';
    // const level = document.getElementById('filterLevel')?.value || 'all'; // Comentado si no se usa

    const filters = {};
    if (term) filters.search = term;
    if (classroomId !== 'all') filters.classroom_id = classroomId;
    if (status) filters.status = status;

    const pageSize = 10;
    const range = { from: 0, to: pageSize - 1 };

    UI.setLoading(true);
    try {
      const { data, count } = await DirectorApi.getStudents(filters, range);
      this._totalStudentsCount = count || 0;
      this.render(data);
      this._renderDirPagination(1, Math.ceil((count || 0) / pageSize), count || 0, data);
    } catch (e) {
      Helpers.toast('Error al filtrar', 'error');
    } finally {
      UI.setLoading(false);
    }
  },

  async delete(id) {
    const student = (AppState.get('students') || []).find(s => String(s.id) === String(id));
    const name = student?.name || 'este estudiante';
    const ok = window.confirm(`¿Eliminar a "${name}"?\n\nEsta acción no se puede deshacer. Se perderán todos los datos del estudiante.`);
    if (!ok) return;
    UI.setLoading(true);
    try {
      const res = await DirectorApi.deleteStudent(id);
      const { error } = res || {};
      if (error) throw new Error(typeof error === 'string' ? error : (error.message || JSON.stringify(error)));
      Helpers.toast('Estudiante eliminado correctamente', 'success');
      QueryCache.invalidate('dir_students');
      window.dispatchEvent(new CustomEvent('karpus:students-changed'));
      this.init();
    } catch (e) {
      Helpers.toast('Error al eliminar: ' + (e.message || e), 'error');
    } finally {
      UI.setLoading(false);
    }
  },

  async openModal(id = null) {
    const studentId = id ? parseInt(id, 10) : null;
    await StudentRecordModal.open({
      mode: studentId ? 'edit' : 'create',
      studentId: studentId || null,
      onSaved: () => this.applyFilters(),
    });
  }
};
