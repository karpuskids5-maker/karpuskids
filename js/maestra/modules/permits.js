import { supabase } from '/js/shared/supabase.js';
import { TABLES } from '/js/shared/constants.js';
import { Helpers } from '/js/shared/helpers.js';
import { UI } from './ui.js';

export const PermitsModule = {
  async init() {
    this._bindForm();
    await this.loadMyHistory();
  },

  _bindForm() {
    const form = document.getElementById('formRequestPermit');
    if (!form) return;

    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Enviando...';

      try {
        const user = (await supabase.auth.getUser()).data.user;
        const payload = {
          staff_id: user.id,
          type: document.getElementById('permitType').value,
          start_date: document.getElementById('permitStart').value,
          end_date: document.getElementById('permitEnd').value,
          reason: document.getElementById('permitReason').value,
          status: 'pending'
        };

        const { error } = await supabase.from(TABLES.STAFF_PERMITS).insert(payload);
        if (error) throw error;

        Helpers.toast('Solicitud enviada correctamente', 'success');
        form.reset();
        await this.loadMyHistory();
      } catch (err) {
        Helpers.toast('Error al enviar solicitud', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i> Enviar Solicitud';
        if (window.lucide) lucide.createIcons();
      }
    };
  },

  async loadMyHistory() {
    const tbody = document.getElementById('my-permits-table-body');
    if (!tbody) return;

    try {
      const user = (await supabase.auth.getUser()).data.user;
      const { data, error } = await supabase
        .from(TABLES.STAFF_PERMITS)
        .select('*')
        .eq('staff_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center py-8 text-slate-400">No has solicitado permisos a\u00fan.</td></tr>';
        return;
      }

      tbody.innerHTML = data.map(p => {
        const typeLabels = { permission: 'Personal', medical: 'M\u00e9dico', absence: 'Falta', other: 'Otro' };
        const statusCls = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-rose-100 text-rose-700' };
        const statusLabels = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };

        return `
          <tr class="hover:bg-slate-50/50 transition-colors">
            <td class="px-4 py-4 font-bold text-slate-700">${typeLabels[p.type] || p.type}</td>
            <td class="px-4 py-4 text-xs font-medium text-slate-500">${new Date(p.start_date).toLocaleDateString()}</td>
            <td class="px-4 py-4 text-center">
              <span class="px-2 py-1 rounded-lg text-[9px] font-black uppercase ${statusCls[p.status] || ''}">${statusLabels[p.status] || p.status}</span>
            </td>
          </tr>
        `;
      }).join('');

    } catch (err) {
      console.error(err);
      tbody.innerHTML = '<tr><td colspan="3" class="text-center py-8 text-rose-500 font-bold">Error al cargar historial.</td></tr>';
    }
  }
};
