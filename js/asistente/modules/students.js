import { supabase } from '../../shared/supabase.js';
import { Helpers } from '../../shared/helpers.js';
import { QueryCache } from '../../shared/query-cache.js';
import { StudentRecordModal } from '../../shared/student-record-modal.js';
import { FiltersStore } from '../state.js';

const FILTER_KEY = 'asistente_students_filters_v1';

const IC = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-teal-100 focus:border-teal-400 bg-slate-50/50 transition-all text-sm font-medium';
const LC = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';

export const StudentsModule = {
  _page: 1,
  _pageSize: 10,
  _allStudents: [],

  async init() {
    this._page = 1;
    this._bindClassroomFilter();
    this._bindStatusFilter();
    this._bindSearch();
    await this._loadClassroomsFilter();
    this._applyPersistedFilters();
    await this.loadStudents();
    document.getElementById('btnAddStudent')?.addEventListener('click', () => this.openModal());
  },

  async _loadClassroomsFilter() {
    const sel = document.getElementById('filterStudentClassroom');
    if (!sel) return;
    try {
      const { data, error } = await supabase
        .from('classrooms')
        .select('id, name')
        .order('name');
      if (error) throw error;
      const currentValue = sel.value;
      sel.innerHTML = '<option value="all">Todas las aulas</option>' +
        (data || []).map(c => `<option value="${c.id}">${Helpers.escapeHTML(c.name)}</option>`).join('');
      if (currentValue && [...sel.options].some(o => o.value === currentValue)) {
        sel.value = currentValue;
      }
    } catch (e) {
      Helpers.safeLog('warn', 'No se pudieron cargar las aulas en el filtro:', e);
    }
  },

  _avatarGradientClass(str) {
    const palettes = [
      'from-emerald-400 to-teal-500',
      'from-sky-400 to-blue-500',
      'from-violet-400 to-purple-500',
      'from-fuchsia-400 to-pink-500',
      'from-orange-400 to-red-500',
      'from-amber-400 to-orange-500',
    ];
    let h = 0;
    const s = String(str || 'x');
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return palettes[Math.abs(h) % palettes.length];
  },

  _persistFilters() {
    const search = document.getElementById('searchStudentInput')?.value?.toLowerCase().trim() || '';
    const classroom = document.getElementById('filterStudentClassroom')?.value || 'all';
    const status = document.getElementById('filterStudentStatus')?.value || 'all';
    FiltersStore.save(FILTER_KEY, { search, classroom, status });
  },

  _applyPersistedFilters() {
    const saved = FiltersStore.load(FILTER_KEY, null);
    if (!saved) return;
    const searchInput = document.getElementById('searchStudentInput');
    const classSel = document.getElementById('filterStudentClassroom');
    const statusSel = document.getElementById('filterStudentStatus');
    if (searchInput && saved.search) { searchInput.value = saved.search; }
    if (classSel && saved.classroom) {
      // Valida que la opción exista, si no usa "all"
      const hasOpt = [...classSel.options].some(o => o.value === saved.classroom);
      classSel.value = hasOpt ? saved.classroom : 'all';
    }
    if (statusSel && saved.status) {
      const hasOpt = [...statusSel.options].some(o => o.value === saved.status);
      statusSel.value = hasOpt ? saved.status : 'all';
    }
  },

  _bindClassroomFilterOnce: null,

  _bindClassroomFilter() {
    const sel = document.getElementById('filterStudentClassroom');
    if (!sel || sel._bound) return;
    sel._bound = true;
    sel.addEventListener('change', () => {
      this._page = 1;
      this._persistFilters();
      this._renderFromCache();
    });
  },

  _bindStatusFilter() {
    const sel = document.getElementById('filterStudentStatus');
    if (!sel || sel._bound) return;
    sel._bound = true;
    sel.addEventListener('change', () => {
      this._page = 1;
      this._persistFilters();
      this._renderFromCache();
    });
  },

  _bindSearch() {
    const input = document.getElementById('searchStudentInput');
    if (!input || input._bound) return;
    input._bound = true;
    let t = null;
    input.addEventListener('input', (e) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        this._page = 1;
        this._persistFilters();
        this._renderFromCache();
      }, 220);
    });
  },

  _currentFilters() {
    const q = (document.getElementById('searchStudentInput')?.value || '').toLowerCase().trim();
    const cr = document.getElementById('filterStudentClassroom')?.value || 'all';
    const st = document.getElementById('filterStudentStatus')?.value || 'all';
    return { q, cr, st };
  },

  _applyFiltersOn(list) {
    const { q, cr, st } = this._currentFilters();
    let result = list || [];
    if (st === 'active') result = result.filter(s => !!s.is_active);
    if (st === 'inactive') result = result.filter(s => !s.is_active);
    if (cr !== 'all') result = result.filter(s => String(s.classroom_id) === String(cr));
    if (q) {
      const qq = q.toLowerCase();
      result = result.filter(s =>
        (s.name || '').toLowerCase().includes(qq) ||
        (s.matricula || '').toLowerCase().includes(qq) ||
        (s.p1_name || '').toLowerCase().includes(qq)
      );
    }
    return result;
  },

  _renderFromCache() {
    const list = this._applyFiltersOn(this._allStudents);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / this._pageSize));
    if (this._page > totalPages) this._page = totalPages;
    const start = (this._page - 1) * this._pageSize;
    const page = list.slice(start, start + this._pageSize);
    this._renderPageContent(page, total, totalPages);
  },

  _renderPageContent(page, total, totalPages) {
    const tbody = document.getElementById('studentsTableBody');
    if (!tbody) return;
    const { q } = this._currentFilters();

    const meta = document.getElementById('studentsResultMeta');
    if (meta) {
      meta.className = 'text-xs font-bold text-slate-400 uppercase tracking-widest';
      meta.innerHTML = total > 0
        ? `<i data-lucide="users" class="w-3.5 h-3.5 inline mr-1.5 -mt-0.5"></i> ${total} estudiante${total === 1 ? '' : 's'} · Página ${this._page} de ${totalPages}`
        : `<i data-lucide="search-x" class="w-3.5 h-3.5 inline mr-1.5 -mt-0.5"></i> Sin resultados`;
    }

    if (!page?.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center">
        <div class="opacity-30 mb-2"><i data-lucide="search-x" class="w-12 h-12 mx-auto"></i></div>
        <p class="text-sm font-bold text-slate-400">${q ? `Sin resultados para "${q}"` : 'No hay estudiantes registrados.'}</p>
      </td></tr>`;
      if (window.lucide) lucide.createIcons();
      this._renderPagination(0, 0, 0);
      return;
    }

    tbody.innerHTML = page.map(s => {
      const grad = this._avatarGradientClass(s.id || s.name);
      const emergName = Helpers.escapeHTML(s.emergency_contact || '—');
      const emergRel = Helpers.escapeHTML(s.emergency_relationship || '');
      return `
      <tr class="hover:bg-slate-50 transition-all group cursor-pointer" ondblclick="window.App._openStudentModal('${s.id}')">
        <td data-label="Estudiante / ID" class="px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-gradient-to-br ${grad} overflow-hidden shrink-0 flex items-center justify-center shadow-sm ring-2 ring-white">
              ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : `<span class="font-black text-white text-sm drop-shadow-sm">${(s.name || '?').charAt ? s.name.charAt(0) : (s.name || '?').substring(0,1)}</span>`}
            </div>
            <div>
              <div class="font-black text-slate-700 text-sm group-hover:text-teal-600 transition-colors">${Helpers.escapeHTML(s.name)}</div>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md tracking-tight">#${String(s.id).padStart(4, '0')}</span>
                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${s.matricula || 'SIN MATRÍCULA'}</span>
                ${s.is_active ? '' : '<span class="text-[9px] font-black text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-full uppercase">Inactivo</span>'}
              </div>
            </div>
          </div>
        </td>
        <td data-label="Aula" class="px-6 py-4">
          <div class="flex flex-col">
            <span class="inline-flex items-center gap-1.5 text-sm font-bold text-slate-700">
              <i data-lucide="school" class="w-3.5 h-3.5 text-teal-500"></i>${s.classrooms?.name || 'Sin aula'}
            </span>
            <span class="text-[9px] font-black text-slate-300 uppercase mt-1">Aula Asignada</span>
          </div>
        </td>
        <td data-label="Padre / Madre" class="px-6 py-4">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-full bg-gradient-to-br from-sky-100 to-blue-100 flex items-center justify-center text-sky-600 shrink-0"><i data-lucide="user-round" class="w-4 h-4"></i></div>
            <div class="text-xs font-bold text-slate-600 leading-tight">
              <div>${Helpers.escapeHTML(s.p1_name || 'N/A')}</div>
              ${s.p1_phone ? `<div class="text-[10px] font-semibold text-slate-400 mt-0.5">${Helpers.escapeHTML(s.p1_phone)}</div>` : ''}
            </div>
          </div>
        </td>
        <td data-label="Contacto Emergencia" class="px-6 py-4">
          ${emergName === '—'
            ? '<div class="text-[11px] font-semibold text-slate-300 italic flex items-center gap-1.5"><i data-lucide="shield-off" class="w-3 h-3"></i> No registrado</div>'
            : `<div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full bg-gradient-to-br from-rose-50 to-orange-50 flex items-center justify-center text-rose-500 shrink-0 ring-1 ring-rose-100"><i data-lucide="siren" class="w-4 h-4"></i></div>
                <div class="text-xs font-bold text-slate-600 leading-tight">
                  <div>${emergName}${emergRel ? ` <span class="text-slate-400 font-semibold">· ${emergRel}</span>` : ''}</div>
                </div>
              </div>`
          }
        </td>
        <td data-label="Acciones" class="px-6 py-4">
          <div class="flex items-center gap-1.5 justify-end">
            <button onclick="window.App.students.toggleActive('${s.id}', ${!!s.is_active})"
              class="p-2 bg-slate-50 text-slate-500 ${s.is_active !== false ? 'hover:bg-amber-500' : 'hover:bg-emerald-500'} hover:text-white rounded-xl transition-all hover:-translate-y-0.5"
              title="${s.is_active !== false ? 'Desactivar estudiante' : 'Activar estudiante'}">
              <i data-lucide="${s.is_active !== false ? 'toggle-right' : 'toggle-left'}" class="w-4 h-4"></i>
            </button>
            <button onclick="window.App._openStudentModal('${s.id}')" class="p-2 bg-slate-50 text-slate-500 hover:bg-teal-500 hover:text-white rounded-xl transition-all group/btn hover:shadow-lg hover:shadow-teal-500/20 hover:-translate-y-0.5" title="Editar ficha">
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button onclick="window.App._deleteStudent('${s.id}', '${Helpers.escapeHTML(s.name)}')" class="p-2 bg-slate-50 text-slate-500 hover:bg-rose-500 hover:text-white rounded-xl transition-all hover:shadow-lg hover:shadow-rose-500/20 hover:-translate-y-0.5" title="Eliminar">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      </tr>`;}).join('');

    if (window.lucide) window.lucide.createIcons();
    this._renderPagination(this._page, totalPages, total);
  },

  _renderPagination(page, totalPages, total) {
    let container = document.getElementById('studentsPagination');
    if (!container) {
      const tbody = document.getElementById('studentsTableBody');
      const wrapper = tbody?.closest('.overflow-x-auto') || tbody?.closest('div') || tbody?.parentElement?.parentElement;
      if (!wrapper) return;
      container = document.createElement('div');
      container.id = 'studentsPagination';
      wrapper.after(container);
    }
    if (total <= 0) { container.innerHTML = ''; return; }
    const start = total > 0 ? (page - 1) * this._pageSize + 1 : 0;
    const end = Math.min(page * this._pageSize, total);
    container.className = 'flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-white rounded-b-3xl mt-0';
    container.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="text-xs font-bold text-slate-400">${start}–${end} de ${total} estudiantes</span>
        <label class="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          Mostrar
          <select id="studentsPageSize" class="appearance-none px-2 py-1 border border-slate-200 rounded-lg bg-white text-slate-600 font-black text-xs outline-none focus:ring-2 focus:ring-teal-200 cursor-pointer">
            <option value="10" ${this._pageSize === 10 ? 'selected' : ''}>10</option>
            <option value="25" ${this._pageSize === 25 ? 'selected' : ''}>25</option>
            <option value="50" ${this._pageSize === 50 ? 'selected' : ''}>50</option>
          </select>
        </label>
      </div>
      <div class="flex gap-2">
        <button id="btnPrevPage" class="px-3 py-1.5 text-xs font-black rounded-xl border border-slate-200 text-slate-500 hover:bg-teal-50 hover:border-teal-300 hover:text-teal-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed" ${page <= 1 ? 'disabled' : ''}>← Ant</button>
        <span class="px-3 py-1.5 text-xs font-black text-teal-600 bg-teal-50 rounded-xl">${page} / ${totalPages}</span>
        <button id="btnNextPage" class="px-3 py-1.5 text-xs font-black rounded-xl border border-slate-200 text-slate-500 hover:bg-teal-50 hover:border-teal-300 hover:text-teal-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed" ${page >= totalPages ? 'disabled' : ''}>Sig →</button>
      </div>`;
    document.getElementById('btnPrevPage')?.addEventListener('click', () => {
      this._page--;
      this._renderFromCache();
    });
    document.getElementById('btnNextPage')?.addEventListener('click', () => {
      this._page++;
      this._renderFromCache();
    });
    document.getElementById('studentsPageSize')?.addEventListener('change', (e) => {
      this._pageSize = Number(e.target.value) || 10;
      this._page = 1;
      this._renderFromCache();
    });
  },

  _exportList() {
    const list = this._applyFiltersOn(this._allStudents);
    if (!list.length) {
      Helpers.toast('No hay estudiantes para exportar', 'warn');
      return;
    }
    try {
      const headers = ['ID', 'Matrícula', 'Nombre', 'Estado', 'Aula', 'Padre/Madre', 'Tel. Padre', 'Contacto Emergencia', 'Parentesco Emergencia'];
      const rows = list.map(s => [
        s.id,
        s.matricula || '',
        s.name || '',
        s.is_active ? 'Activo' : 'Inactivo',
        s.classrooms?.name || '',
        s.p1_name || '',
        s.p1_phone || '',
        s.emergency_contact || '',
        s.emergency_relationship || '',
      ]);
      const csv = [
        headers.join(','),
        ...rows.map(r => r.map(cell => {
          const v = String(cell ?? '').replace(/"/g, '""');
          return /[",\n]/.test(v) ? `"${v}"` : v;
        }).join(','))
      ].join('\n');
      const bom = '\uFEFF';
      const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `estudiantes-karpus-${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      Helpers.toast(`Exportados ${list.length} estudiantes`, 'success');
    } catch (e) {
      Helpers.safeLog('error', 'Export students failed:', e);
      Helpers.toast('Error al exportar. Usando impresión.', 'warn');
      window.print();
    }
  },

  async loadStudents() {
    const tbody = document.getElementById('studentsTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center">
      <div class="flex flex-col items-center gap-3">
        <div class="animate-spin w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full"></div>
        <p class="text-xs font-black text-slate-400 uppercase tracking-widest">Cargando Estudiantes...</p>
      </div></td></tr>`;

    try {
      const { data: students, error } = await supabase
        .from('students')
        .select('id, name, is_active, p1_name, p1_phone, classroom_id, matricula, avatar_url, emergency_contact, emergency_relationship, classrooms:classroom_id(name)')
        .order('name')
        .limit(500);
      if (error) throw error;

      this._allStudents = students || [];
      this._page = 1;
      this._renderFromCache();
    } catch (e) {
      Helpers.safeLog('error', 'Error loadStudents:', e);
      tbody.innerHTML = '<tr><td colspan="5">' + Helpers.errorState('Error al cargar datos') + '</td></tr>';
    }
  },

  async _deleteStudent(id, name) {
    const ok = confirm(`¿Estás seguro de eliminar al estudiante "${name}"?\n\nEsta acción no se puede deshacer.`);
    if (!ok) return;

    try {
      const { error } = await supabase.from('students').delete().eq('id', id);
      if (error) throw error;
      QueryCache.invalidate('dir_students');
      Helpers.toast('Estudiante eliminado correctamente', 'success');
      await this.loadStudents();
    } catch (e) {
      Helpers.toast('Error al eliminar: ' + e.message, 'error');
    }
  },

  async openModal(studentId = null) {
    const id = studentId ? Number.parseInt(studentId, 10) : null;
    await StudentRecordModal.open({
      mode: id ? 'edit' : 'create',
      studentId: id || null,
      onSaved: () => this.loadStudents(),
    });
  },

  /** Activar / desactivar sin eliminar datos */
  async toggleActive(id, currentlyActive) {
    const label = currentlyActive ? 'desactivar' : 'activar';
    const ok = confirm(`¿Deseas ${label} a este estudiante?\n\n${currentlyActive ? 'No aparecerá en asistencia ni en el panel de la maestra.' : 'Volverá a aparecer en todos los módulos.'}`);
    if (!ok) return;
    try {
      const { error } = await supabase
        .from('students')
        .update({ is_active: !currentlyActive })
        .eq('id', id);
      if (error) throw error;
      QueryCache.invalidate('dir_students');
      Helpers.toast(`Estudiante ${currentlyActive ? 'desactivado' : 'activado'} correctamente`, 'success');
      window.dispatchEvent(new CustomEvent('karpus:students-changed'));
      await this.loadStudents();
    } catch (e) {
      Helpers.toast('Error al cambiar estado: ' + (e.message || e), 'error');
    }
  }
};
