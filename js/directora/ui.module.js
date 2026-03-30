import { Helpers } from '../shared/helpers.js';

const UIHelpers = {
  setLoading(isLoading, containerSelector = '#globalModalContainer', btnSelector = null) {
    const container = document.querySelector(containerSelector);
    if (!container) return;
    if (isLoading) {
      const loader = document.createElement('div');
      loader.id = 'ui-loading-overlay';
      loader.className = 'absolute inset-0 bg-white/60 backdrop-blur-[2px] z-[100] flex items-center justify-center rounded-3xl';
      loader.innerHTML = '<div class="flex flex-col items-center gap-3"><div class="w-12 h-12 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div><span class="text-[10px] font-black text-indigo-600 uppercase tracking-widest animate-pulse">Procesando...</span></div>';
      container.style.position = 'relative';
      container.appendChild(loader);
      if (btnSelector) { const btn = document.querySelector(btnSelector); if (btn) { btn.disabled = true; btn.classList.add('opacity-50', 'cursor-not-allowed'); } }
    } else {
      document.getElementById('ui-loading-overlay')?.remove();
      if (btnSelector) { const btn = document.querySelector(btnSelector); if (btn) { btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); } }
    }
  },

  closeModal(modalSelector = '#globalModalContainer') {
    if (modalSelector === '#globalModalContainer') {
      const c = document.getElementById('globalModalContainer');
      if (c) { c.style.display = 'none'; c.innerHTML = ''; }
    } else {
      const m = document.querySelector(modalSelector);
      if (m) { m.classList.add('hidden'); m.classList.remove('active'); }
    }
  }
};

const DirectorUI = {
  renderDashboard(data) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const kpis = data?.kpis || {};

    // Usar total como fallback cuando active es 0 (RPC puede devolver 0 si no usa is_active)
    const studentCount = (kpis.active > 0 ? kpis.active : null) ?? kpis.total ?? 0;
    set('kpiStudents',   studentCount);
    set('kpiTeachers',   kpis.teachers   > 0 ? kpis.teachers   : (data?.teacherCount ?? 0));
    set('kpiClassrooms', kpis.classrooms > 0 ? kpis.classrooms : (data?.classrooms?.length ?? 0));
    set('kpiAttendance', data?.attendance?.today?.present ?? kpis.attendance_today ?? 0);

    const pending = data?.payments?.summary?.total_pending ?? kpis.pending_amount ?? 0;
    set('kpiPendingMoney', '$' + Number(pending).toLocaleString('es-ES', { minimumFractionDigits: 2 }));
    set('kpiIncidents', data?.inquiries?.count ?? kpis.inquiries ?? 0);

    if (window.lucide) lucide.createIcons();
  },

  renderClassroomRow(r) {
    const occupancy = r.student_count || 0;
    const capacity  = r.capacity || 20;
    const percent   = Math.round((occupancy / capacity) * 100);
    const barColor  = percent > 90 ? 'bg-rose-500' : percent > 70 ? 'bg-amber-500' : 'bg-emerald-500';

    return (
      '<tr class="hover:bg-slate-50 transition-colors">' +
        '<td class="py-4 px-6">' +
          '<div class="font-bold text-slate-800">' + Helpers.escapeHTML(r.name) + '</div>' +
          '<div class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">' + (r.level || 'General') + '</div>' +
        '</td>' +
        '<td class="py-4 px-6">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold">' + (r.profiles?.name || '?').charAt(0) + '</div>' +
            '<div class="text-sm font-medium text-slate-600">' + Helpers.escapeHTML(r.profiles?.name || 'Sin asignar') + '</div>' +
          '</div>' +
        '</td>' +
        '<td class="py-4 px-6">' +
          '<div class="flex items-center gap-4">' +
            '<div class="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden max-w-[100px]">' +
              '<div class="' + barColor + ' h-full rounded-full" style="width:' + percent + '%"></div>' +
            '</div>' +
            '<span class="text-xs font-bold text-slate-500">' + occupancy + '/' + capacity + '</span>' +
          '</div>' +
        '</td>' +
        '<td class="py-4 px-6 text-center">' +
          '<button onclick="App.rooms.openModal(\'' + r.id + '\')" class="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all">' +
            '<i data-lucide="edit-3" class="w-4 h-4"></i>' +
          '</button>' +
        '</td>' +
      '</tr>'
    );
  },

  renderInquiryCard(item) {
    const statusCls = {
      pending:     'bg-amber-100 text-amber-700 border-amber-200',
      in_progress: 'bg-blue-100 text-blue-700 border-blue-200',
      resolved:    'bg-emerald-100 text-emerald-700 border-emerald-200',
      closed:      'bg-slate-100 text-slate-700 border-slate-200'
    }[item.status] || 'bg-slate-100 text-slate-700';

    return (
      '<div class="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-all">' +
        '<div class="flex justify-between items-start mb-4">' +
          '<span class="text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ' + statusCls + '">' + (item.status || '-') + '</span>' +
          '<span class="text-[10px] font-bold text-slate-400">' + new Date(item.created_at).toLocaleDateString() + '</span>' +
        '</div>' +
        '<h3 class="font-bold text-slate-800 mb-1 truncate">' + Helpers.escapeHTML(item.subject || '') + '</h3>' +
        '<p class="text-xs text-slate-500 mb-4 line-clamp-2">' + Helpers.escapeHTML(item.message || '') + '</p>' +
        '<div class="flex items-center justify-between pt-4 border-t border-slate-50">' +
          '<div class="flex items-center gap-2">' +
            '<div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">' + (item.parent?.name || '?').charAt(0) + '</div>' +
            '<div class="text-[10px] font-bold text-slate-600">' + Helpers.escapeHTML(item.parent?.name || 'Padre') + '</div>' +
          '</div>' +
          '<button data-id="' + item.id + '" class="btn-inquiry-detail text-indigo-600 hover:text-indigo-800 font-bold text-xs">Ver Detalle</button>' +
        '</div>' +
      '</div>'
    );
  }
};

export const UI = { ...UIHelpers, ...DirectorUI };
export { UIHelpers, DirectorUI };
