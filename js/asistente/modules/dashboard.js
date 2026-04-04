import { supabase } from '../../shared/supabase.js';
import { AppState } from '../state.js';
import { Helpers } from '../../shared/helpers.js';

const STATUS_MAP = {
  paid:    { label: 'Aprobado',    cls: 'bg-emerald-100 text-emerald-700' },
  pending: { label: 'Pendiente',   cls: 'bg-amber-100 text-amber-700' },
  review:  { label: 'En Revisión', cls: 'bg-blue-100 text-blue-700' },
  overdue: { label: 'Vencido',     cls: 'bg-rose-100 text-rose-700' }
};

export const DashboardModule = {
  _chart: null,

  async init() {
    const dateEl = document.getElementById('dashboardDate');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('es-ES', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
    }

    await Promise.all([
      this.loadStats(),
      this.loadRecentPayments(),
      this._loadMiniChart()
    ]);
  },

  async loadStats() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

      const [studentsRes, attendanceRes, paymentsRes, incomeRes] = await Promise.allSettled([
        supabase.from('students').select('*', { count: 'exact', head: true }),
        supabase.from('attendance').select('*', { count: 'exact', head: true })
          .eq('date', today).in('status', ['present', 'presente']),
        supabase.from('payments').select('*', { count: 'exact', head: true })
          .in('status', ['pending', 'review']),
        supabase.from('payments').select('amount')
          .eq('status', 'paid').gte('created_at', monthStart)
      ]);

      const get = (r) => r.status === 'fulfilled' ? r.value : {};
      const studentsCount   = get(studentsRes).count  || 0;
      const attendanceCount = get(attendanceRes).count || 0;
      const paymentsCount   = get(paymentsRes).count  || 0;
      const incomeData      = get(incomeRes).data || [];
      const incomeTotal     = incomeData.reduce((s, p) => s + Number(p.amount || 0), 0);

      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('statStudents',   studentsCount);
      set('statAttendance', attendanceCount);
      set('statPayments',   paymentsCount);
      set('statIncome',     '$' + incomeTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 }));
      set('welcomeName',    (AppState.get('profile')?.name || 'Asistente').split(' ')[0]);

    } catch (e) {
      console.error('[DashboardModule] loadStats:', e);
    }
  },

  async loadRecentPayments() {
    const container = document.getElementById('dashRecentPayments');
    if (!container) return;

    try {
      const { data, error } = await supabase
        .from('payments')
        .select('id, amount, status, month_paid, method, students:student_id(name)')
        .order('created_at', { ascending: false })
        .limit(6);

      if (error) throw error;

      if (!data?.length) {
        container.innerHTML = '<div class="px-5 py-8 text-center text-slate-400 text-sm">Sin pagos recientes.</div>';
        return;
      }

      container.innerHTML = data.map(p => {
        const st  = STATUS_MAP[p.status] || { label: p.status, cls: 'bg-slate-100 text-slate-600' };
        const amt = Number(p.amount || 0).toLocaleString('es-ES', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
        const ini = (p.students?.name || '?').charAt(0).toUpperCase();
        return (
          '<div class="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">' +
            '<div class="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-black text-sm shrink-0">' + ini + '</div>' +
            '<div class="min-w-0 flex-1">' +
              '<p class="font-bold text-slate-800 text-sm truncate">' + Helpers.escapeHTML(p.students?.name || 'Desconocido') + '</p>' +
              '<p class="text-[10px] text-slate-400 font-bold uppercase">' + (p.month_paid || '-') + ' · ' + (p.method || '-') + '</p>' +
            '</div>' +
            '<div class="text-right shrink-0">' +
              '<p class="font-black text-slate-800 text-sm">' + amt + '</p>' +
              '<span class="text-[9px] font-black px-2 py-0.5 rounded-full ' + st.cls + '">' + st.label + '</span>' +
            '</div>' +
          '</div>'
        );
      }).join('');

    } catch (e) {
      console.error('[DashboardModule] loadRecentPayments:', e);
      container.innerHTML = Helpers.errorState('Error al cargar pagos');
      if (window.lucide) lucide.createIcons();
    }
  },

  async _loadMiniChart() {
    const canvas = document.getElementById('incomeChart');
    if (!canvas || !window.Chart) return;
    try {
      const year = new Date().getFullYear();
      const { data } = await supabase
        .from('payments').select('amount, created_at')
        .eq('status', 'paid')
        .gte('created_at', year + '-01-01')
        .lte('created_at', year + '-12-31');

      const vals = new Array(12).fill(0);
      (data || []).forEach(p => { vals[new Date(p.created_at).getMonth()] += Number(p.amount || 0); });

      if (this._chart) this._chart.destroy();
      this._chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: ['E','F','M','A','M','J','J','A','S','O','N','D'],
          datasets: [{
            data: vals,
            backgroundColor: 'rgba(139,92,246,0.75)',
            borderRadius: 5,
            borderSkipped: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 9 } } },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(0,0,0,0.04)' },
              ticks: { font: { size: 9 }, callback: (v) => '$' + v }
            }
          }
        }
      });
    } catch (e) {
      console.warn('[Dashboard] miniChart:', e);
    }
  }
};
