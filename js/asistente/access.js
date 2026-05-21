import { supabase, emitEvent } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';
import { AssistantApi } from './api.js';

let isProcessing = false;
let _accessChart = null;

export const AccessModule = {

  async init() {
    this._setupDateFilters();
    this._bindTableSearch();
    await this.loadStats();
    await this.loadHistory();
    await this.initChart();
    this._bindExport();
  },

  _setupDateFilters() {
    const fromInput = document.getElementById('accessFilterFrom');
    const toInput = document.getElementById('accessFilterTo');
    const applyBtn = document.getElementById('btnApplyAccessFilters');
    
    // Set default dates (today)
    const today = new Date().toISOString().split('T')[0];
    if (fromInput) fromInput.value = today;
    if (toInput) toInput.value = today;

    applyBtn?.addEventListener('click', () => {
      this.loadHistory();
      this.loadStats();
      this.updateChart();
    });
  },

  _bindTableSearch() {
    const input = document.getElementById('searchAccessTable');
    input?.addEventListener('input', Helpers.debounce((e) => {
      this._filterTable(e.target.value.toLowerCase());
    }, 200));
  },

  _filterTable(term) {
    const rows = document.querySelectorAll('#accessTableBody tr');
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(term) ? '' : 'none';
    });
  },

  _bindExport() {
    const btn = document.getElementById('btnExportExcel');
    btn?.addEventListener('click', () => this.exportToExcel());
  },

  // ── Estadísticas con Filtro ──────────────────────────────────────────────
  async loadStats() {
    try {
      const from = document.getElementById('accessFilterFrom')?.value;
      const to = document.getElementById('accessFilterTo')?.value;
      
      let query = supabase.from('attendance').select('status, check_out');
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);

      const { data } = await query;

      const present  = (data || []).filter(r => ['present', 'late'].includes(r.status)).length;
      const late     = (data || []).filter(r => r.status === 'late').length;
      const checkouts = (data || []).filter(r => r.status === 'retirado').length;
      const total    = (data || []).length;

      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('statAccessPresent',  present);
      set('statAccessLate',     late);
      set('statAccessCheckout', checkouts);
      set('statAccessTotal',    total);
    } catch (err) {
    }
  },

  // ── Historial Detallado (Tabla) ───────────────────────────────────────────
  async loadHistory() {
    const tbody = document.getElementById('accessTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-slate-400 font-bold">Cargando registros...</td></tr>`;

    try {
      const from = document.getElementById('accessFilterFrom')?.value;
      const to = document.getElementById('accessFilterTo')?.value;
      const status = document.getElementById('accessFilterStatus')?.value;

      let query = supabase
        .from('attendance')
        .select('id, date, check_in, check_out, status, student_id, classroom_id, student:student_id(name, matricula, avatar_url)')
        .order('date', { ascending: false })
        .order('check_in', { ascending: false });

      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      if (status && status !== 'all') query = query.eq('status', status);

      const { data, error } = await query.limit(200);
      if (error) throw error;

      if (!data?.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-slate-300 font-bold uppercase tracking-widest text-xs">Sin movimientos en este rango</td></tr>`;
        return;
      }

      tbody.innerHTML = data.map(log => {
        const dateStr = new Date(log.date + 'T12:00:00').toLocaleDateString('es-DO', { day: '2-digit', month: 'short' });
        const inTime = log.check_in ? new Date(log.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
        const outTime = log.check_out ? new Date(log.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
        
        let statusBadge = '';
        if (log.status === 'present') statusBadge = '<span class="px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[9px] font-black uppercase">Entrada</span>';
        else if (log.status === 'late') statusBadge = '<span class="px-2.5 py-1 bg-amber-50 text-amber-600 rounded-lg text-[9px] font-black uppercase">Tardanza</span>';
        else if (log.status === 'retirado') statusBadge = '<span class="px-2.5 py-1 bg-blue-50 text-blue-600 rounded-lg text-[9px] font-black uppercase">Salida</span>';

        return `
          <tr class="hover:bg-slate-50/50 transition-colors">
            <td class="px-8 py-4">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden shrink-0 border border-slate-200">
                  ${log.student?.avatar_url ? `<img src="${log.student.avatar_url}" class="w-full h-full object-cover">` : `<i data-lucide="user" class="w-4 h-4 text-slate-300"></i>`}
                </div>
                <span class="font-bold text-slate-700">${Helpers.escapeHTML(log.student?.name || '—')}</span>
              </div>
            </td>
            <td class="px-8 py-4 font-mono text-[10px] text-slate-400 font-bold">${log.student?.matricula || '—'}</td>
            <td class="px-8 py-4 text-slate-500 font-bold">${dateStr}</td>
            <td class="px-8 py-4 text-center font-black text-slate-700 italic">${inTime}</td>
            <td class="px-8 py-4 text-center font-black text-slate-700 italic">${outTime}</td>
            <td class="px-8 py-4 text-center">${statusBadge}</td>
          </tr>`;
      }).join('');

      if (window.lucide) lucide.createIcons();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-rose-500 font-bold">Error al cargar datos: ${err.message}</td></tr>`;
    }
  },

  // ── Gráfico de Tendencia ──────────────────────────────────────────────────
  async initChart() {
    const ctx = document.getElementById('accessChart')?.getContext('2d');
    if (!ctx) return;

    if (!window.Chart) {
      await this._loadChartJs();
    }

    this.updateChart();
  },

  async updateChart() {
    const ctx = document.getElementById('accessChart')?.getContext('2d');
    if (!ctx) return;

    try {
      const from = document.getElementById('accessFilterFrom')?.value;
      const { data } = await supabase.from('attendance').select('date, status').gte('date', from).order('date');
      
      const days = [...new Set(data.map(d => d.date))].slice(-7);
      const entries = days.map(day => data.filter(d => d.date === day && d.status === 'present').length);
      const lates = days.map(day => data.filter(d => d.date === day && d.status === 'late').length);

      if (_accessChart) _accessChart.destroy();

      _accessChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: days.map(d => new Date(d + 'T12:00:00').toLocaleDateString('es-DO', { weekday: 'short' })),
          datasets: [
            { label: 'Entradas', data: entries, borderColor: '#10b981', backgroundColor: '#10b98120', fill: true, tension: 0.4 },
            { label: 'Tardanzas', data: lates, borderColor: '#f59e0b', backgroundColor: '#f59e0b20', fill: true, tension: 0.4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }
        }
      });
    } catch (e) { /* silencioso */ }
  },async _loadChartJs() {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script.onload = resolve;
      document.head.appendChild(script);
    });
  },

  // ── Exportación a Excel (Simple CSV) ───────────────────────────────────────
  async exportToExcel() {
    const rows = [['Estudiante', 'Matricula', 'Fecha', 'Entrada', 'Salida', 'Estado']];
    const tbody = document.querySelectorAll('#accessTableBody tr');
    
    tbody.forEach(tr => {
      const cols = tr.querySelectorAll('td');
      if (cols.length < 6) return;
      rows.push([
        cols[0].querySelector('span')?.textContent || '',
        cols[1].textContent,
        cols[2].textContent,
        cols[3].textContent,
        cols[4].textContent,
        cols[5].textContent.trim()
      ]);
    });

    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `reporte_asistencia_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    Helpers.toast('Reporte generado correctamente');
  },

  async updateChart() {
    const ctx = document.getElementById('accessChart')?.getContext('2d');
    if (!ctx) return;

    try {
      const from = document.getElementById('accessFilterFrom')?.value;
      const to = document.getElementById('accessFilterTo')?.value;
      
      let query = supabase.from('attendance').select('date, status').order('date');
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);

      const { data } = await query;
      if (!data) return;

      const days = [...new Set(data.map(d => d.date))];
      const entries = days.map(day => data.filter(d => d.date === day && d.status === 'present').length);
      const lates = days.map(day => data.filter(d => d.date === day && d.status === 'late').length);

      if (_accessChart) _accessChart.destroy();

      _accessChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: days.map(d => new Date(d + 'T12:00:00').toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric' })),
          datasets: [
            { label: 'Entradas', data: entries, borderColor: '#10b981', backgroundColor: '#10b98120', fill: true, tension: 0.4 },
            { label: 'Tardanzas', data: lates, borderColor: '#f59e0b', backgroundColor: '#f59e0b20', fill: true, tension: 0.4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }
        }
      });
    } catch (e) { /* silencioso */ }
  }
};

// Delegación global para botones de ponche en resultados de búsqueda
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.punch-btn');
  if (!btn) return;
  const { id, type } = btn.dataset;
  if (id && type) window.App?.access?.register(id, type);
});
