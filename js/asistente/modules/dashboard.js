import { supabase } from '../../shared/supabase.js';
import { AppState } from '../state.js';
import { Helpers } from '../../shared/helpers.js';
import { QueryCache } from '../../shared/query-cache.js';

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
    const updateDate = () => {
      if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('es-DO', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
      }
    };
    updateDate();
    // Update date at midnight
    const msUntilMidnight = () => {
      const now = new Date();
      const midnight = new Date(now); midnight.setHours(24,0,0,0);
      return midnight - now;
    };
    setTimeout(() => { updateDate(); setInterval(updateDate, 86400000); }, msUntilMidnight());

    await Promise.all([
      this.loadStats(),
      this.loadRecentPayments(),
      this._loadMiniChart()
    ]);
  },

  async loadStats() {
      try {
        const today = new Date().toISOString().split('T')[0];
        const monthKey = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');

        // Stale-while-revalidate: mostrar datos cacheados inmediatamente, revalidar en background
        const cachedStats = QueryCache.getStale(
          'asis_dashboard_stats',
          async () => {
            const [studentsRes, attendanceRes, paymentsRes, incomeRes] = await Promise.allSettled([
              supabase.from('students').select('*', { count: 'exact', head: true }),
              supabase.from('attendance').select('*', { count: 'exact', head: true })
                .eq('date', today).in('status', ['present', 'presente']),
              supabase.from('payments').select('*', { count: 'exact', head: true })
                .in('status', ['pending', 'review']),
              supabase.from('payments').select('amount')
                .eq('status', 'paid').eq('month_paid', monthKey)
            ]);
            const get = (r) => r.status === 'fulfilled' ? r.value : {};
            return {
              studentsCount:   get(studentsRes).count  || 0,
              attendanceCount: get(attendanceRes).count || 0,
              paymentsCount:   get(paymentsRes).count  || 0,
              incomeTotal:     (get(incomeRes).data || []).reduce((s, p) => s + Number(p.amount || 0), 0)
            };
          },
          2 * 60_000,
          (fresh) => this._applyStats(fresh)
        );

        if (cachedStats) this._applyStats(cachedStats);

      } catch (e) {
        console.error('Error loading stats:', e);
      }
    }
,

  _applyStats({ studentsCount, attendanceCount, paymentsCount, incomeTotal }) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('statStudents',   studentsCount);
    set('statAttendance', attendanceCount);
    set('statPayments',   paymentsCount);
    set('statIncome',     incomeTotal.toLocaleString('es-DO', { minimumFractionDigits: 2 }));
    set('welcomeName',    (AppState.get('profile')?.name || 'Asistente').split(' ')[0]);
    this._renderUrgentAlerts(paymentsCount, attendanceCount);
  },

  _renderUrgentAlerts(paymentsReview, pendingAbsences) {
    const container = document.getElementById('urgentAlertsWidget');
    if (!container) return;

    const alerts = [];
    
    if (paymentsReview > 0) {
      alerts.push({
        title: `${paymentsReview} Pagos por validar`,
        desc: 'Comprobantes pendientes de revisión bancaria.',
        icon: 'credit-card',
        color: 'rose',
        section: 'pagos'
      });
    }

    // Supongamos que reportes de ausencia son los estudiantes inactivos o algo similar por ahora
    // En una implementación real, sería una tabla de 'absence_reports'
    if (pendingAbsences > 0) {
      alerts.push({
        title: `Actividad de hoy`,
        desc: `${pendingAbsences} estudiantes ya ingresaron a la estancia.`,
        icon: 'users',
        color: 'amber',
        section: 'accesos'
      });
    }

    if (alerts.length === 0) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    container.innerHTML = alerts.map(a => `
      <div onclick="window.App.navigateTo('${a.section}')" class="bg-${a.color}-50 border border-${a.color}-100 p-4 rounded-2xl flex items-start gap-4 cursor-pointer hover:shadow-md transition-all group">
        <div class="w-10 h-10 rounded-xl bg-${a.color}-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-${a.color}-200 group-hover:scale-110 transition-transform">
          <i data-lucide="${a.icon}" class="w-5 h-5"></i>
        </div>
        <div>
          <h4 class="text-sm font-black text-${a.color}-900">${a.title}</h4>
          <p class="text-xs text-${a.color}-700/70 font-bold mt-0.5">${a.desc}</p>
        </div>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
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
        const amt = 'RD$' + Number(p.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

    } catch (_) {
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
        .from('payments').select('amount, month_paid')
        .eq('status', 'paid')
        .like('month_paid', year + '-%');

      const vals = new Array(12).fill(0);
      (data || []).forEach(p => {
        const parts = (p.month_paid || '').split('-');
        const m = parts.length >= 2 ? parseInt(parts[1], 10) - 1 : -1;
        if (m >= 0 && m <= 11) vals[m] += Number(p.amount || 0);
      });

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
      
    }
  }
};
