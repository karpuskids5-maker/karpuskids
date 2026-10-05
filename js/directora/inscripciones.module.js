import { supabase } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';
import { auditLog } from '../shared/db-utils.js';
import { StudentRecordModal } from '../shared/student-record-modal.js';
import { computeAge } from '../shared/birthday-utils.js';
import { FiltersStore } from '../asistente/state.js';

const INSCRIPCIONES_FILTER_KEY = 'asistente_inscripciones_filters_v1';

const STATUS_META = {
  pending:   { label: 'Pendiente',  cls: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-500' },
  reviewing: { label: 'En revisión',cls: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-500' },
  admitted:  { label: 'Admitida',   cls: 'bg-sky-100 text-sky-700',      dot: 'bg-sky-500' },
  converted: { label: 'Inscrita',   cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  rejected:  { label: 'Rechazada',  cls: 'bg-rose-100 text-rose-700',    dot: 'bg-rose-500' },
  expired:   { label: 'Expirada',   cls: 'bg-slate-100 text-slate-500',  dot: 'bg-slate-400' },
};

export const InscripcionesModule = {

  _list: [],
  _filter: 'pending',
  _query: '',

  _persistFilters() {
    FiltersStore.save(INSCRIPCIONES_FILTER_KEY, { filter: this._filter, query: this._query });
  },

  _applyPersistedFilters() {
    const saved = FiltersStore.load(INSCRIPCIONES_FILTER_KEY, null);
    if (!saved) return;
    if (saved.filter && typeof saved.filter === 'string') this._filter = saved.filter;
    if (typeof saved.query === 'string') this._query = saved.query;
    const filterSel = document.getElementById('filterPrereg');
    const searchInp = document.getElementById('searchPrereg');
    if (filterSel) {
      const hasOpt = [...filterSel.options].some(o => o.value === this._filter);
      filterSel.value = hasOpt ? this._filter : 'pending';
    }
    if (searchInp) searchInp.value = this._query;
  },

  async init() {
    try {
      const { data, error } = await supabase
        .from('student_preregistrations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      this._list = data || [];

      const count = (s) => this._list.filter(r => r.status === s).length;
      Helpers.setTxt('inscTotal', this._list.length);
      Helpers.setTxt('inscPending', count('pending'));
      Helpers.setTxt('inscInscribed', count('converted') + count('admitted'));
      Helpers.setTxt('inscRejected', count('rejected'));

      this._renderBadge(count('pending'));
      this._applyPersistedFilters();
      this.render();
      this._wireFilters();
    } catch (e) {
      Helpers.safeLog('error', 'Error init Inscripciones:', e);
      Helpers.toast('Error al cargar preinscripciones: ' + (e.message || e), 'error');
    }
  },

  _renderBadge(count) {
    const badge = document.getElementById('badge-inscripciones');
    if (!badge) return;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  },

  _wireFilters() {
    const search = document.getElementById('searchPrereg');
    if (search && !search._bound) {
      search._bound = true;
      search.addEventListener('input', Helpers.debounce(() => {
        this._query = search.value;
        this._persistFilters();
        this.render();
      }, 250));
    }
    const sel = document.getElementById('filterPrereg');
    if (sel && !sel._bound) {
      sel._bound = true;
      sel.addEventListener('change', () => {
        this._filter = sel.value;
        this._persistFilters();
        this.render();
      });
    }
  },

  filtered() {
    const q = this._query.trim().toLowerCase();
    return this._list.filter(r => {
      if (this._filter !== 'all' && r.status !== this._filter) return false;
      if (!q) return true;
      const p1 = r.parent_1 || {};
      const hay = [
        r.student_name, r.student_last_name, r.contact_email,
        r.contact_phone, r.level_requested, p1.name, p1.phone,
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  },

  render() {
    const tbody = document.getElementById('preregList');
    if (!tbody) return;
    const list = this.filtered();

    if (!list.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="px-4 py-16 text-center">
            <div class="relative inline-block mb-5">
              <div class="absolute inset-0 rounded-3xl bg-gradient-to-br from-purple-200/40 to-indigo-200/40 blur-2xl scale-125"></div>
              <div class="relative w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-100 text-purple-400 flex items-center justify-center shadow-sm">
                <i data-lucide="clipboard-list" class="w-9 h-9"></i>
              </div>
            </div>
            <h3 class="font-black text-slate-700 mb-1.5 text-lg">Bandeja de preinscripciones limpia</h3>
            <p class="text-xs text-slate-400 font-bold mb-4 max-w-sm mx-auto leading-relaxed">No hay solicitudes en este estado. Comparte el formulario público para recibir nuevas solicitudes de inscripción.</p>
            <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
              <i data-lucide="sparkles" class="w-3 h-3 text-purple-400"></i> Recibirás una notificación por cada nueva solicitud
            </div>
          </td>
        </tr>`;
      if (window.lucide) lucide.createIcons();
      return;
    }

    tbody.innerHTML = list.map(r => {
      const meta = STATUS_META[r.status] || STATUS_META.pending;
      const p1 = r.parent_1 || {};
      const p2 = r.parent_2 || {};
      const docsCount = Object.keys(r.documents || {}).length;
      const ageText = r.birth_date ? computeAge(r.birth_date) : '';
      const hasAllergies = !!(r.medical?.allergies && r.medical.allergies.trim());
      const canAdmit = r.status === 'pending' || r.status === 'reviewing';

      return `
        <tr class="group hover:bg-slate-50/70 transition-colors">
          <td data-label="Estudiante" class="px-4 py-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white font-black text-sm shadow-md shadow-purple-100 shrink-0 ring-2 ring-white">
                ${Helpers.escapeHTML((r.student_name || '?').charAt(0))}
              </div>
              <div class="min-w-0">
                <p class="font-black text-slate-800 text-sm truncate group-hover:text-indigo-700 transition-colors">${Helpers.escapeHTML(r.student_name || 'Sin nombre')}${r.student_last_name ? ' ' + Helpers.escapeHTML(r.student_last_name) : ''}</p>
                <p class="text-[10px] text-slate-400 font-black uppercase tracking-widest"><span class="font-mono text-purple-500">#${String(r.id).padStart(4,'0')}</span>${ageText ? ' · ' + ageText : ''}</p>
              </div>
            </div>
          </td>
          <td data-label="Padres" class="px-4 py-3 text-xs font-bold text-slate-700">${Helpers.escapeHTML(p1.name || '—')}${p2.name ? ' / ' + Helpers.escapeHTML(p2.name) : ''}</td>
          <td data-label="Contacto" class="px-4 py-3 text-xs text-slate-500">${Helpers.escapeHTML(r.contact_phone || '—')}<span class="block text-[10px] text-slate-400 truncate">${Helpers.escapeHTML(r.contact_email || '')}</span></td>
          <td data-label="Nivel / Horario" class="px-4 py-3 text-xs font-bold text-slate-600">${Helpers.escapeHTML(r.level_requested || '—')}${r.schedule ? '<span class="block text-[10px] font-black text-purple-500 uppercase tracking-wider mt-0.5">' + Helpers.escapeHTML(r.schedule) + (r.entry_time && r.exit_time ? ' · ' + r.entry_time + '–' + r.exit_time : '') + '</span>' : ''}</td>
          <td data-label="Fecha" class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${new Date(r.created_at).toLocaleDateString()}</td>
          <td data-label="Estado" class="px-4 py-3 whitespace-nowrap">
            <div class="flex flex-col gap-1.5">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider ${meta.cls} w-max shadow-sm">
                <span class="w-1.5 h-1.5 rounded-full ${meta.dot} animate-pulse"></span>${meta.label}
              </span>
              ${hasAllergies ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-rose-500 text-white w-max ring-1 ring-rose-200 shadow-sm animate-pulse" title="Alergias: ${Helpers.escapeHTML(r.medical.allergies)}">
                <i data-lucide="alert-triangle" class="w-3 h-3"></i> Alergias
              </span>` : ''}
              ${docsCount ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 w-max ring-1 ring-indigo-100">
                <i data-lucide="file-text" class="w-3 h-3"></i> ${docsCount} doc${docsCount === 1 ? '' : 's'}
              </span>` : ''}
            </div>
          </td>
          <td data-label="Acciones" class="px-4 py-3">
            <div class="flex items-center justify-end gap-1.5">
              ${canAdmit ? `<button onclick="App.inscripciones.admit(${r.id})" class="w-9 h-9 flex items-center justify-center bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white rounded-xl transition-all shadow-sm hover:shadow-md hover:shadow-emerald-500/30 hover:-translate-y-0.5 active:scale-95" title="Aprobar solicitud">
                <i data-lucide="check" class="w-4 h-4"></i>
              </button>` : ''}
              <button onclick="App.inscripciones.reject(${r.id})" class="w-9 h-9 flex items-center justify-center bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-xl transition-all shadow-sm hover:-translate-y-0.5 active:scale-95" title="Rechazar">
                <i data-lucide="x" class="w-4 h-4"></i>
              </button>
              <button onclick="App.inscripciones.openRecord(${r.id})" class="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-md shadow-purple-100 transition-all active:scale-95 hover:shadow-lg hover:-translate-y-0.5">
                <i data-lucide="folder-open" class="w-3.5 h-3.5"></i> Revisar
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
  },

  async admit(id) {
    const prereg = this._list.find(r => String(r.id) === String(id));
    const name = prereg?.student_name || 'este estudiante';
    const ok = window.confirm(`¿Aprobar la preinscripción de "${name}"?\n\nEl estado pasará a "Admitida".`);
    if (!ok) return;
    try {
      const { error } = await supabase.rpc('review_preregistration', {
        p_id: id,
        p_status: 'admitted',
        p_notes: `Aprobada rápidamente por staff — ${new Date().toLocaleString()}`,
      });
      if (error) throw error;
      await auditLog('preregistration.admitted', { prereg_id: id, student_name: prereg?.student_name, method: 'one-click' });
      Helpers.toast('Preinscripción aprobada ✔', 'success');
      this.init();
    } catch (e) {
      Helpers.safeLog('error', 'Error admitting prereg:', e);
      Helpers.toast('Error al aprobar: ' + (e.message || e), 'error');
    }
  },

  openRecord(id) {
    const prereg = this._list.find(r => String(r.id) === String(id));
    if (!prereg) { Helpers.toast('Preinscripción no encontrada', 'warning'); return; }
    StudentRecordModal.open({
      prereg,
      onSaved: () => {
        this.init();
        // Sincronizar inmediatamente la lista de estudiantes sin recargar
        try { window.dispatchEvent(new CustomEvent('karpus:students-changed')); } catch (_) {}
        try {
          import('../asistente/modules/students.js')
            .then(m => m.StudentsModule.loadStudents?.())
            .catch(() => {});
        } catch (_) {}
      },
    });
  },

  async reject(id) {
    const prereg = this._list.find(r => String(r.id) === String(id));
    const name = prereg?.student_name || 'este estudiante';

    const opts = {
      title: 'Rechazar preinscripción',
      message: `Rechazar solicitud de "${name}".`,
      confirmLabel: 'Rechazar',
      cancelLabel: 'Cancelar',
      tone: 'rose',
      icon: 'shield-alert',
      placeholder: 'Justifique el motivo del rechazo para el expediente (requerido)...',
      requireReason: true
    };

    const modalResult = typeof window._karpusJustifiedConfirm === 'function'
      ? await window._karpusJustifiedConfirm(opts)
      : (window.confirm(`¿Rechazar la preinscripción de "${name}"?`) ? { confirmed: true, reason: 'Rechazada por el staff el ' + new Date().toLocaleDateString() } : null);

    if (!modalResult?.confirmed) return;
    const notes = modalResult.reason && modalResult.reason.trim()
      ? `${modalResult.reason.trim()} — ${new Date().toLocaleDateString()}`
      : 'Rechazada por el staff el ' + new Date().toLocaleDateString();

    try {
      const { error } = await supabase.rpc('review_preregistration', {
        p_id: id,
        p_status: 'rejected',
        p_notes: notes,
      });
      if (error) throw error;
      await auditLog('preregistration.rejected', { prereg_id: id, student_name: prereg?.student_name, reason: modalResult.reason || null });
      Helpers.toast('Preinscripción rechazada', 'info');
      this.init();
    } catch (e) {
      Helpers.safeLog('error', 'Error rejecting prereg:', e);
      Helpers.toast('Error al rechazar: ' + (e.message || e), 'error');
    }
  },
};
