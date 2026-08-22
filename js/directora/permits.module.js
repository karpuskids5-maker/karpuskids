import { supabase } from '../shared/supabase.js';
import { TABLES } from '../shared/constants.js';
import { Helpers } from '../shared/helpers.js';
import { auditLog } from '../shared/db-utils.js';

export const PermitsModule = {
  async init() {
    this._bindFilters();
    await this.loadHistory();
    await this.loadStats();
  },

  _bindFilters() {
    document.getElementById('permitFilterStatus')?.addEventListener('change', () => this.loadHistory());
  },

  async loadStats() {
    const today = new Date().toISOString().split('T')[0];
    try {
      const { data: todayPermits } = await supabase
        .from(TABLES.STAFF_PERMITS)
        .select('id', { count: 'exact' })
        .eq('status', 'approved')
        .lte('start_date', today)
        .gte('end_date', today);

      const { data: pendingPermits } = await supabase
        .from(TABLES.STAFF_PERMITS)
        .select('id', { count: 'exact' })
        .eq('status', 'pending');

      Helpers.setTxt('statPermitsToday', todayPermits?.length || 0);
      Helpers.setTxt('statPermitsPending', pendingPermits?.length || 0);
    } catch (e) { Helpers.safeLog('error', 'Error loadStats permits:', e); }
  },

  async loadHistory() {
    const tbody = document.getElementById('permits-table-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-slate-400">Cargando...</td></tr>';

    try {
      const status = document.getElementById('permitFilterStatus')?.value || 'pending';
      let query = supabase
        .from(TABLES.STAFF_PERMITS)
        .select('*, profiles:staff_id(name, role)');

      if (status !== 'all') query = query.eq('status', status);
      
      const { data, error } = await query.order('created_at', { ascending: false }).limit(50);
      if (error) throw error;

      if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-slate-400 font-medium">No hay solicitudes encontradas.</td></tr>';
        return;
      }

      tbody.innerHTML = data.map(p => {
        const staffName = p.profiles?.name || 'Personal';
        const typeLabels = { permission: 'Permiso', medical: 'M\u00e9dico', absence: 'Falta', other: 'Otro' };
        const statusCls = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-rose-100 text-rose-700' };
        
        return `
          <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4">
              <div class="font-bold text-slate-800">${Helpers.escapeHTML(staffName)}</div>
              <div class="text-[10px] text-slate-400 font-black uppercase tracking-wider">${p.profiles?.role || 'Staff'}</div>
            </td>
            <td class="px-6 py-4">
              <span class="text-xs font-bold text-slate-600">${typeLabels[p.type] || p.type}</span>
            </td>
            <td class="px-6 py-4">
              <div class="text-xs font-bold text-slate-700">${new Date(p.start_date).toLocaleDateString()}</div>
              <div class="text-[10px] text-slate-400 font-medium">${p.start_date === p.end_date ? 'Un solo d\u00eda' : 'Hasta ' + new Date(p.end_date).toLocaleDateString()}</div>
            </td>
            <td class="px-6 py-4">
              <span class="px-2 py-1 rounded-lg text-[10px] font-black uppercase ${statusCls[p.status] || ''}">${p.status}</span>
            </td>
            <td class="px-6 py-4 text-right">
              <div class="flex justify-end gap-2">
                ${p.status === 'pending' ? `
                  <button onclick="App.permits.updateStatus('${p.id}', 'approved')" class="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100" title="Aprobar"><i data-lucide="check" class="w-4 h-4"></i></button>
                  <button onclick="App.permits.updateStatus('${p.id}', 'rejected')" class="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100" title="Rechazar"><i data-lucide="x" class="w-4 h-4"></i></button>
                ` : ''}
                <button onclick="App.permits.viewDetails('${p.id}')" class="p-2 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100" title="Ver Detalles"><i data-lucide="eye" class="w-4 h-4"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
      
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      Helpers.safeLog('error', 'Error loadHistory permits:', e);
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-rose-500 font-bold">Error al cargar historial.</td></tr>';
    }
  },

  async updateStatus(id, newStatus) {
    const isApproved = newStatus === 'approved';
    const staffName = (await this._fetchPermitById(id))?.profiles?.name || 'Personal';

    const opts = isApproved
      ? {
          title: 'Aprobar solicitud',
          message: `Aprobar solicitud de ${staffName}.`,
          confirmLabel: 'Aprobar',
          tone: 'teal',
          icon: 'check-circle-2',
          placeholder: 'Opcional: comentario sobre la aprobación...',
          requireReason: false
        }
      : {
          title: 'Rechazar solicitud',
          message: `Rechazar solicitud de ${staffName}.`,
          confirmLabel: 'Rechazar',
          tone: 'rose',
          icon: 'shield-alert',
          placeholder: 'Justifique el motivo del rechazo (requerido)...',
          requireReason: true
        };

    const modalResult = typeof window._karpusJustifiedConfirm === 'function'
      ? await window._karpusJustifiedConfirm(opts)
      : (window.confirm(`${opts.title} ${opts.message}`) ? { confirmed: true, reason: '' } : null);

    if (!modalResult?.confirmed) return;

    try {
      const userId = (await supabase.auth.getUser()).data?.user?.id;
      const payload = { status: newStatus };
      if (userId) payload.approved_by = userId;
      if (modalResult.reason) payload.admin_notes = modalResult.reason; // Intento guardar notas

      const { error } = await supabase
        .from(TABLES.STAFF_PERMITS)
        .update(payload)
        .eq('id', id);

      if (error) {
        // Si falla por admin_notes inexistente, reintento sin el campo
        if (/column.*admin_notes.*does not exist/i.test(error?.message || '')) {
          const { error: e2 } = await supabase
            .from(TABLES.STAFF_PERMITS)
            .update({ status: newStatus, approved_by: userId })
            .eq('id', id);
          if (e2) throw e2;
        } else {
          throw error;
        }
      }

      try {
        await auditLog(
          isApproved ? 'staff_permit.approved' : 'staff_permit.rejected',
          { permit_id: id, staff_name: staffName, reason: modalResult.reason || null }
        );
      } catch (_) {}

      Helpers.toast(
        isApproved ? 'Solicitud aprobada' : 'Solicitud rechazada',
        isApproved ? 'success' : 'info'
      );
      this.loadHistory();
      this.loadStats();
    } catch (e) {
      Helpers.safeLog('error', 'Error updateStatus permit:', e);
      Helpers.toast('Error al actualizar estado', 'error');
    }
  },

  async _fetchPermitById(id) {
    try {
      const { data } = await supabase
        .from(TABLES.STAFF_PERMITS)
        .select('id, type, profiles:staff_id(name)')
        .eq('id', id)
        .maybeSingle();
      return data || null;
    } catch (_) { return null; }
  },

  async viewDetails(id) {
    try {
      const { data, error } = await supabase
        .from(TABLES.STAFF_PERMITS)
        .select('*, profiles:staff_id(name)')
        .eq('id', id)
        .single();
      
      if (error) throw error;

      const html = `
        <div class="p-8">
          <div class="flex justify-between items-start mb-6">
            <div>
              <h2 class="text-2xl font-black text-slate-800">Detalles de Solicitud</h2>
              <p class="text-sm text-slate-500 font-medium">Personal: ${Helpers.escapeHTML(data.profiles?.name)}</p>
            </div>
          </div>

          <div class="space-y-6">
            <div class="bg-slate-50 p-6 rounded-3xl border border-slate-100">
              <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Motivo / Raz\u00f3n</p>
              <p class="text-slate-700 font-bold leading-relaxed">${Helpers.escapeHTML(data.reason)}</p>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div class="bg-indigo-50 p-4 rounded-2xl border border-indigo-100 text-indigo-700">
                <p class="text-[10px] font-black uppercase opacity-70 mb-1">Fecha Inicio</p>
                <p class="text-lg font-black">${new Date(data.start_date).toLocaleDateString()}</p>
              </div>
              <div class="bg-indigo-50 p-4 rounded-2xl border border-indigo-100 text-indigo-700">
                <p class="text-[10px] font-black uppercase opacity-70 mb-1">Fecha Fin</p>
                <p class="text-lg font-black">${new Date(data.end_date).toLocaleDateString()}</p>
              </div>
            </div>
          </div>
        </div>
      `;
      window.openGlobalModal(html);
    } catch (e) {
      Helpers.toast('Error al cargar detalles', 'error');
    }
  }
};
