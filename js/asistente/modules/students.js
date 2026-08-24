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
    this._applyPersistedFilters();
    await this.loadStudents();
    document.getElementById('btnAddStudent')?.addEventListener('click', () => this.openModal());
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

    if (!page?.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-12 text-center">
        <div class="opacity-30 mb-2"><i data-lucide="search-x" class="w-12 h-12 mx-auto"></i></div>
        <p class="text-sm font-bold text-slate-400">${q ? `Sin resultados para "${q}"` : 'No hay estudiantes registrados.'}</p>
      </td></tr>`;
      if (window.lucide) lucide.createIcons();
      this._renderPagination(0, 0, 0);
      return;
    }

    tbody.innerHTML = page.map(s => `
      <tr class="hover:bg-slate-50 transition-all group cursor-pointer" ondblclick="window.App._openStudentModal('${s.id}')">
        <td class="px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-teal-50 border border-teal-100 overflow-hidden shrink-0 flex items-center justify-center">
              ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : `<span class="font-black text-teal-600">${s.name.charAt(0)}</span>`}
            </div>
            <div>
              <div class="font-black text-slate-700 text-sm group-hover:text-teal-600 transition-colors">${Helpers.escapeHTML(s.name)}</div>
              <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${s.matricula || 'SIN MATRÍCULA'}</div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4">
          <div class="flex flex-col">
            <span class="text-sm font-bold text-slate-600">${s.classrooms?.name || '—'}</span>
            <span class="text-[9px] font-black text-slate-300 uppercase">Aula Asignada</span>
          </div>
        </td>
        <td class="px-6 py-4">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400"><i data-lucide="user" class="w-4 h-4"></i></div>
            <div class="text-xs font-bold text-slate-500">${Helpers.escapeHTML(s.p1_name || 'N/A')}</div>
          </div>
        </td>
        <td class="px-6 py-4">
          <div class="flex items-center gap-2">
            <button onclick="window.App._openStudentModal('${s.id}')" class="p-2 bg-slate-100 text-slate-500 hover:bg-teal-500 hover:text-white rounded-xl transition-all" title="Editar">
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button onclick="window.App._deleteStudent('${s.id}', '${Helpers.escapeHTML(s.name)}')" class="p-2 bg-slate-100 text-slate-500 hover:bg-rose-500 hover:text-white rounded-xl transition-all" title="Eliminar">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      </tr>`).join('');

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
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    const start = (page - 1) * this._pageSize + 1;
    const end = Math.min(page * this._pageSize, total);
    container.className = 'flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-white rounded-b-3xl mt-0';
    container.innerHTML = `
      <span class="text-xs font-bold text-slate-400">${start}–${end} de ${total} estudiantes</span>
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
  },

  async loadStudents() {
    const tbody = document.getElementById('studentsTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-10 text-center">
      <div class="flex flex-col items-center gap-3">
        <div class="animate-spin w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full"></div>
        <p class="text-xs font-black text-slate-400 uppercase tracking-widest">Cargando Estudiantes...</p>
      </div></td></tr>`;

    try {
      const { data: students, error } = await supabase
        .from('students')
        .select('id, name, is_active, p1_name, p1_phone, classroom_id, matricula, avatar_url, classrooms:classroom_id(name)')
        .order('name')
        .limit(500);
      if (error) throw error;

      this._allStudents = students || [];
      this._page = 1;
      this._renderFromCache();
    } catch (e) {
      Helpers.safeLog('error', 'Error loadStudents:', e);
      tbody.innerHTML = '<tr><td colspan="4">' + Helpers.errorState('Error al cargar datos') + '</td></tr>';
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
  }
};
