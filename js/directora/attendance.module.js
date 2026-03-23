import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { AppState } from './state.js';

export const AttendanceModule = {
  _attendancePieChart: null,

  async init() {
    const attendanceDateInput = document.getElementById('attendanceDateFilter');
    if (attendanceDateInput) {
      attendanceDateInput.value = new Date().toISOString().split('T')[0];
      attendanceDateInput.addEventListener('change', () => this.loadAttendance());
    }
    document.getElementById('btnRefreshAttendance')?.addEventListener('click', () => this.loadAttendance());
    
    await this.loadAttendance();
  },

  async loadAttendance() {
    const container = document.getElementById('attendanceTableBody');
    if (!container) return;
    container.innerHTML = '<tr><td colspan="5" class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div></td></tr>';
    
    try {
      const date = document.getElementById('attendanceDateFilter')?.value || new Date().toISOString().split('T')[0];
      const { data: attendance, error } = await DirectorApi.getAttendanceByDate(date);
      if (error) throw error;

      if (!attendance?.length) {
        container.innerHTML = '<tr><td colspan="5" class="text-center py-12 text-slate-400">No hay registros para este día.</td></tr>';
        this.updatePieChart({ present: 0, absent: 0, late: 0 });
        return;
      }

      const stats = { present: 0, absent: 0, late: 0 };
      container.innerHTML = attendance.map(a => {
        const statusKey = a.status || 'absent';
        const statusMap = {
          present: { label: 'Presente', class: 'bg-emerald-100 text-emerald-700', icon: 'check-circle' },
          absent: { label: 'Ausente', class: 'bg-rose-100 text-rose-700', icon: 'x-circle' },
          late: { label: 'Tarde', class: 'bg-amber-100 text-amber-700', icon: 'clock' }
        };
        const status = statusMap[statusKey] || statusMap.absent;
        stats[statusKey]++;
        
        return `
          <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
            <td class="px-6 py-4">
              <div class="font-bold text-slate-800">${Helpers.escapeHTML(a.student?.name || 'Estudiante')}</div>
              <div class="text-[10px] text-slate-400 font-black uppercase tracking-tighter">${a.classroom?.name || 'General'}</div>
            </td>
            <td class="px-6 py-4 text-center">
              <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black uppercase ${status.class} w-fit">
                <i data-lucide="${status.icon}" class="w-3 h-3"></i> ${status.label}
              </span>
            </td>
            <td class="px-6 py-4 text-center">
              <div class="text-[11px] font-bold text-slate-600">
                ${a.check_in ? new Date(a.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
              </div>
            </td>
            <td class="px-6 py-4">
              <div class="text-[10px] text-slate-500 line-clamp-1 max-w-[150px]" title="${a.notes || ''}">${a.notes || '—'}</div>
            </td>
          </tr>`;
      }).join('');

      this.updatePieChart(stats);
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('loadAttendance error:', e);
      container.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-red-500">Error al cargar asistencia.</td></tr>';
    }
  },

  updatePieChart(stats) {
    const canvas = document.getElementById('attendancePieChart');
    if (!canvas || !window.Chart) return;

    if (this._attendancePieChart) this._attendancePieChart.destroy();
    this._attendancePieChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Presentes', 'Ausentes', 'Tarde'],
        datasets: [{
          data: [stats.present, stats.absent, stats.late],
          backgroundColor: ['#10b981', '#f43f5e', '#f59e0b'],
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        cutout: '70%'
      }
    });
  }
};
