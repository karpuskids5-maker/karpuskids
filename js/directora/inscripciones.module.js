import { supabase } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';
import { auditLog } from '../shared/db-utils.js';
import { StudentRecordModal } from '../shared/student-record-modal.js';

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
      this.render();
      this._wireFilters();
    } catch (e) {
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
      search.addEventListener('input', () => { this._query = search.value; this.render(); });
    }
    const sel = document.getElementById('filterPrereg');
    if (sel && !sel._bound) {
      sel._bound = true;
      sel.addEventListener('change', () => { this._filter = sel.value; this.render(); });
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
          <td colspan="7" class="px-4 py-12 text-center">
            <div class="w-16 h-16 mx-auto rounded-2xl bg-purple-50 text-purple-400 flex items-center justify-center mb-4">
              <i data-lucide="inbox" class="w-8 h-8"></i>
            </div>
            <h3 class="font-black text-slate-700 mb-1">Sin preinscripciones</h3>
            <p class="text-xs text-slate-400 font-bold">Comparte el formulario público para recibir solicitudes.</p>
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
      const age = r.birth_date
        ? Math.max(0, Math.floor((Date.now() - new Date(r.birth_date).getTime()) / (365.25 * 24 * 3600 * 1000)))
        : null;

      return `
        <tr class="group">
          <td class="px-4 py-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white font-black text-sm shadow-md shadow-purple-100 shrink-0">
                ${Helpers.escapeHTML((r.student_name || '?').charAt(0))}
              </div>
              <div class="min-w-0">
                <p class="font-black text-slate-800 text-sm truncate">${Helpers.escapeHTML(r.student_name || 'Sin nombre')}${r.student_last_name ? ' ' + Helpers.escapeHTML(r.student_last_name) : ''}</p>
                <p class="text-[10px] text-slate-400 font-black uppercase tracking-widest">#${r.id}${age != null ? ' · ' + age + ' años' : ''}</p>
              </div>
            </div>
          </td>
          <td class="px-4 py-3 text-xs font-bold text-slate-700">${Helpers.escapeHTML(p1.name || '—')}${p2.name ? ' / ' + Helpers.escapeHTML(p2.name) : ''}</td>
          <td class="px-4 py-3 text-xs text-slate-500">${Helpers.escapeHTML(r.contact_phone || '—')}<span class="block text-[10px] text-slate-400">${Helpers.escapeHTML(r.contact_email || '')}</span></td>
          <td class="px-4 py-3 text-xs font-bold text-slate-600">${Helpers.escapeHTML(r.level_requested || '—')}${r.schedule ? '<span class="block text-[10px] font-black text-purple-500 uppercase tracking-wider">' + Helpers.escapeHTML(r.schedule) + (r.entry_time && r.exit_time ? ' · ' + r.entry_time + ' – ' + r.exit_time : '') + '</span>' : ''}</td>
          <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${new Date(r.created_at).toLocaleDateString()}</td>
          <td class="px-4 py-3 whitespace-nowrap">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider ${meta.cls}">
              <span class="w-1.5 h-1.5 rounded-full ${meta.dot}"></span>${meta.label}
            </span>
          </td>
          <td class="px-4 py-3">
            <div class="flex items-center justify-end gap-2">
              ${r.medical?.allergies ? `<span class="text-[10px] text-rose-500 font-black" title="Alergias registradas">⚠</span>` : ''}
              ${docsCount ? `<span class="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-black">${docsCount} docs</span>` : ''}
              <button onclick="App.inscripciones.reject(${r.id})" class="w-9 h-9 flex items-center justify-center bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-xl transition-all shadow-sm" title="Rechazar">
                <i data-lucide="x" class="w-4 h-4"></i>
              </button>
              <button onclick="App.inscripciones.openRecord(${r.id})" class="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-md shadow-purple-100 transition-all active:scale-95">
                <i data-lucide="folder-open" class="w-3.5 h-3.5"></i> Revisar
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
  },

  openRecord(id) {
    const prereg = this._list.find(r => String(r.id) === String(id));
    if (!prereg) { Helpers.toast('Preinscripción no encontrada', 'warning'); return; }
    StudentRecordModal.open({
      prereg,
      onSaved: () => this.init(),
    });
  },

  async reject(id) {
    const prereg = this._list.find(r => String(r.id) === String(id));
    const name = prereg?.student_name || 'este estudiante';
    const ok = window.confirm('¿Rechazar la preinscripción de "' + name + '"?');
    if (!ok) return;

    try {
      const { error } = await supabase.rpc('review_preregistration', {
        p_id: id,
        p_status: 'rejected',
        p_notes: 'Rechazada por el staff el ' + new Date().toLocaleDateString(),
      });
      if (error) throw error;
      await auditLog('preregistration.rejected', { prereg_id: id, student_name: prereg?.student_name });
      Helpers.toast('Preinscripción rechazada', 'info');
      this.init();
    } catch (e) {
      Helpers.toast('Error al rechazar: ' + (e.message || e), 'error');
    }
  },
};
