import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { UI } from './ui.module.js';
import { AppState } from './state.js';
import { supabase } from '../shared/supabase.js';
import { QueryCache } from '../shared/query-cache.js';
import { StudentRecordModal } from '../shared/student-record-modal.js';

export const StudentsModule = {
  _dirPage: 1,
  _pageSize: 10,

  async init() {
    this._dirPage = 1;
    this._bindControls();
    await this._loadClassroomsFilter();
    await this._load();
  },

  _bindControls() {
    const bind = (id, ev, fn) => {
      const el = document.getElementById(id);
      if (!el || el._bound) return;
      el._bound = true;
      el.addEventListener(ev, fn);
    };

    bind('searchStudent',    'input',  () => this._onFilterChange());
    bind('filterClassroom',  'change', () => this._onFilterChange());
    bind('filterStStatus',   'change', () => this._onFilterChange());
    bind('btnAddStudent',    'click',  () => this.openModal());
    bind('btnExportStudents','click',  () => this._exportCSV());
  },

  _onFilterChange() {
    this._dirPage = 1;
    void this._load();
  },

  async _loadClassroomsFilter() {
    const sel = document.getElementById('filterClassroom');
    if (!sel || sel._classroomsLoaded) return;
    try {
      const { data } = await supabase.from('classrooms').select('id, name').order('name');
      sel.innerHTML = '<option value="all">Todas las aulas</option>' +
        (data || []).map(c => `<option value="${c.id}">${Helpers.escapeHTML(c.name)}</option>`).join('');
      sel._classroomsLoaded = true;
    } catch (_) { /* filtro de aulas no crítico */ }
  },

  _currentFilters() {
    return {
      q:      (document.getElementById('searchStudent')?.value   || '').toLowerCase().trim(),
      room:    document.getElementById('filterClassroom')?.value  || 'all',
      status:  document.getElementById('filterStStatus')?.value   || 'all',
    };
  },

  async _load() {
    const { q, room, status } = this._currentFilters();
    const filters = {};
    if (q)             filters.search       = q;
    if (room !== 'all') filters.classroom_id = room;
    // Pasar is_active al API solo cuando hay filtro explícito
    if (status === 'active')   filters.is_active = true;
    if (status === 'inactive') filters.is_active = false;

    const pageSize = this._pageSize;
    const range = {
      from: (this._dirPage - 1) * pageSize,
      to:   this._dirPage * pageSize - 1,
    };

    UI.setLoading(true);
    try {
      const { data: students, error, count } = await DirectorApi.getStudents(filters, range);
      if (error) throw error;

      AppState.set('students', students || []);
      this._totalStudentsCount = count || 0;

      // KPIs
      Helpers.setTxt('totalStudents', count || 0);
      let activeCount;
      if (status === 'inactive')     activeCount = '—';
      else if (status === 'active')  activeCount = count;
      else                           activeCount = (students || []).filter(s => s.is_active).length;
      Helpers.setTxt('activeStudents', activeCount);

      // Tabla
      const tableWrapper = document.getElementById('studentsTableWrapper');
      tableWrapper?.classList.remove('hidden');
      this._render(students || [], count || 0);
      this._renderPagination(this._dirPage, Math.ceil((count || 0) / pageSize), count || 0);
    } catch (e) {
      Helpers.safeLog?.('error', 'StudentsModule._load:', e);
      const tb = document.getElementById('studentsTable');
      if (tb) tb.innerHTML = `<tr><td colspan="6" class="text-center p-8">${Helpers.errorState('Error al cargar estudiantes', 'StudentsModule._load()')}</td></tr>`;
      if (window.lucide) lucide.createIcons();
    } finally {
      UI.setLoading(false);
    }
  },

  _render(students, total) {
    const tbody = document.getElementById('studentsTable');
    if (!tbody) return;

    if (!students.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-12 text-slate-400 font-bold">No hay estudiantes para este filtro.</td></tr>';
      if (window.lucide) lucide.createIcons();
      return;
    }

    tbody.innerHTML = students.map(s => {
      const isActive = s.is_active !== false;
      const statusBadge = isActive
        ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-100 text-emerald-700 uppercase"><i data-lucide="circle-check" class="w-2.5 h-2.5"></i>Activo</span>'
        : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-rose-100 text-rose-600 uppercase"><i data-lucide="circle-x" class="w-2.5 h-2.5"></i>Inactivo</span>';

      const toggleTitle = isActive ? 'Desactivar estudiante' : 'Activar estudiante';
      const toggleCls   = isActive
        ? 'w-9 h-9 flex items-center justify-center bg-amber-50 text-amber-600 hover:bg-amber-600 hover:text-white rounded-xl transition-all shadow-sm'
        : 'w-9 h-9 flex items-center justify-center bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white rounded-xl transition-all shadow-sm';
      const toggleIcon  = isActive ? 'toggle-right' : 'toggle-left';

      return `
        <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 cursor-pointer ${isActive ? '' : 'opacity-70'}" ondblclick="App.students.openModal('${s.id}')">
          <td class="p-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-sm font-black text-purple-600 overflow-hidden shrink-0">
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
              ${Helpers.escapeHTML(s.classrooms?.name || 'No asignada')}
            </span>
          </td>
          <td class="p-4 text-center">${statusBadge}</td>
          <td class="p-4 text-center text-[11px] font-bold text-slate-500">${s.entry_time || '—'}</td>
          <td class="p-4 text-center text-[11px] font-bold text-slate-500">${s.exit_time || '—'}</td>
          <td class="p-4 text-right">
            <div class="flex justify-end gap-2">
              <button onclick="App.students.toggleActive('${s.id}', ${isActive})"
                class="${toggleCls}" title="${toggleTitle}">
                <i data-lucide="${toggleIcon}" class="w-4 h-4"></i>
              </button>
              <button onclick="App.students.openModal('${s.id}')"
                class="w-9 h-9 flex items-center justify-center bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white rounded-xl transition-all shadow-sm" title="Editar">
                <i data-lucide="edit-3" class="w-4 h-4"></i>
              </button>
              <button onclick="App.students.delete('${s.id}')"
                class="w-9 h-9 flex items-center justify-center bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-xl transition-all shadow-sm" title="Eliminar">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');

    if (window.lucide) lucide.createIcons();
  },

  _renderPagination(page, totalPages, total) {
    let container = document.getElementById('dirStudentsPagination');
    if (!container) {
      const tableWrapper = document.getElementById('studentsTableWrapper');
      if (!tableWrapper) return;
      container = document.createElement('div');
      container.id = 'dirStudentsPagination';
      tableWrapper.after(container);
    }
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    const start = (page - 1) * this._pageSize + 1;
    const end   = Math.min(page * this._pageSize, total);
    container.className = 'flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-white rounded-b-3xl';
    container.innerHTML = `
      <span class="text-xs font-bold text-slate-400">${start}–${end} de ${total} estudiantes</span>
      <div class="flex gap-2">
        <button id="dirBtnPrev" class="px-3 py-1.5 text-xs font-black rounded-xl border border-slate-200 text-slate-500 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed" ${page <= 1 ? 'disabled' : ''}>← Ant</button>
        <span class="px-3 py-1.5 text-xs font-black text-purple-600 bg-purple-50 rounded-xl">${page} / ${totalPages}</span>
        <button id="dirBtnNext" class="px-3 py-1.5 text-xs font-black rounded-xl border border-slate-200 text-slate-500 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed" ${page >= totalPages ? 'disabled' : ''}>Sig →</button>
      </div>`;
    document.getElementById('dirBtnPrev')?.addEventListener('click', () => { this._dirPage--; void this._load(); });
    document.getElementById('dirBtnNext')?.addEventListener('click', () => { this._dirPage++; void this._load(); });
  },

  /** Activar / desactivar un estudiante sin eliminar sus datos */
  async toggleActive(id, currentlyActive) {
    const label = currentlyActive ? 'desactivar' : 'activar';
    const ok = window.confirm(`¿Deseas ${label} a este estudiante?\n\n${currentlyActive ? 'No aparecerá en asistencia ni en el panel de la maestra.' : 'Volverá a aparecer en todos los módulos.'}`);
    if (!ok) return;

    UI.setLoading(true);
    try {
      const { error } = await supabase
        .from('students')
        .update({ is_active: !currentlyActive })
        .eq('id', id);
      if (error) throw error;

      QueryCache.invalidate('dir_students');
      Helpers.toast(`Estudiante ${currentlyActive ? 'desactivado' : 'activado'} correctamente`, 'success');
      window.dispatchEvent(new CustomEvent('karpus:students-changed'));
      void this._load();
    } catch (e) {
      Helpers.toast('Error al cambiar estado: ' + (e.message || e), 'error');
    } finally {
      UI.setLoading(false);
    }
  },

  async delete(id) {
    const student = (AppState.get('students') || []).find(s => String(s.id) === String(id));
    const name = student?.name || 'este estudiante';
    const ok = window.confirm(`¿Eliminar a "${name}"?\n\nEsta acción no se puede deshacer.`);
    if (!ok) return;
    UI.setLoading(true);
    try {
      const res = await DirectorApi.deleteStudent(id);
      if (res?.error) throw new Error(typeof res.error === 'string' ? res.error : (res.error.message || JSON.stringify(res.error)));
      Helpers.toast('Estudiante eliminado correctamente', 'success');
      QueryCache.invalidate('dir_students');
      window.dispatchEvent(new CustomEvent('karpus:students-changed'));
      void this._load();
    } catch (e) {
      Helpers.toast('Error al eliminar: ' + (e.message || e), 'error');
    } finally {
      UI.setLoading(false);
    }
  },

  async openModal(id = null) {
    const studentId = id ? Number.parseInt(id, 10) : null;
    await StudentRecordModal.open({
      mode: studentId ? 'edit' : 'create',
      studentId: studentId || null,
      onSaved: () => void this._load(),
    });
  },

  _exportCSV() {
    const list = AppState.get('students') || [];
    if (!list.length) { Helpers.toast('No hay estudiantes para exportar', 'warn'); return; }
    Helpers.toast('Generando lista...', 'info');
    const headers = ['ID', 'Matrícula', 'Nombre', 'Estado', 'Aula', 'Padre/Madre', 'Tel. Padre'];
    const rows = list.map(s => [
      s.id, s.matricula || '', s.name || '',
      s.is_active !== false ? 'Activo' : 'Inactivo',
      s.classrooms?.name || '', s.p1_name || '', s.p1_phone || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => {
      const cell = String(v ?? '').replace(/"/g, '""');
      return /[",\n]/.test(cell) ? `"${cell}"` : cell;
    }).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `estudiantes-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  // Alias de compatibilidad con código heredado del HTML
  applyFilters() { return this._load(); },
};
