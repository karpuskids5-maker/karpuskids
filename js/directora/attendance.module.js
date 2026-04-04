import { supabase } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';

const STATUS = {
  present:  { label: 'Presente',  cls: 'bg-emerald-100 text-emerald-700', icon: 'check-circle',    color: '#10b981' },
  presente: { label: 'Presente',  cls: 'bg-emerald-100 text-emerald-700', icon: 'check-circle',    color: '#10b981' },
  absent:   { label: 'Ausente',   cls: 'bg-rose-100 text-rose-700',       icon: 'x-circle',        color: '#f43f5e' },
  ausente:  { label: 'Ausente',   cls: 'bg-rose-100 text-rose-700',       icon: 'x-circle',        color: '#f43f5e' },
  late:     { label: 'Tardanza',  cls: 'bg-amber-100 text-amber-700',     icon: 'clock',           color: '#f59e0b' },
  tarde:    { label: 'Tardanza',  cls: 'bg-amber-100 text-amber-700',     icon: 'clock',           color: '#f59e0b' },
};

const norm = (s) => (s || 'absent').toLowerCase();

export const AttendanceModule = {
  _barChart: null,
  _donutChart: null,
  _mode: 'day',   // 'day' | 'range'
  _data: [],

  async init() {
    this._bindControls();
    this._setDefaultDates();
    await this.load();
  },

  _setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    const el = (id) => document.getElementById(id);
    if (el('attDateSingle'))  el('attDateSingle').value  = today;
    if (el('attDateFrom'))    el('attDateFrom').value    = this._firstOfMonth();
    if (el('attDateTo'))      el('attDateTo').value      = today;
  },

  _firstOfMonth() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  },

  _bindControls() {
    const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

    // Mode tabs
    document.querySelectorAll('[data-att-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._mode = btn.dataset.attMode;
        document.querySelectorAll('[data-att-mode]').forEach(b => {
          b.classList.toggle('active-att-tab', b === btn);
        });
        document.getElementById('attPanelDay')?.classList.toggle('hidden',   this._mode !== 'day');
        document.getElementById('attPanelRange')?.classList.toggle('hidden', this._mode !== 'range');
        this.load();
      });
    });

    on('attDateSingle',    'change', () => this.load());
    on('attDateFrom',      'change', () => this.load());
    on('attDateTo',        'change', () => this.load());
    on('attFilterRoom',    'change', () => this._renderTable());
    on('attFilterStatus',  'change', () => this._renderTable());
    on('attSearch',        'input',  () => this._renderTable());
    on('btnAttRefresh',    'click',  () => this.load());
    on('btnAttExport',     'click',  () => this._exportCSV());
  },

  async load() {
    this._setLoading(true);
    try {
      let q = supabase
        .from('attendance')
        .select('id, date, status, check_in, check_out, student:student_id(id, name, avatar_url), classroom:classroom_id(id, name)')
        .order('date', { ascending: false });

      if (this._mode === 'day') {
        const date = document.getElementById('attDateSingle')?.value || new Date().toISOString().split('T')[0];
        q = q.eq('date', date);
      } else {
        const from = document.getElementById('attDateFrom')?.value || this._firstOfMonth();
        const to   = document.getElementById('attDateTo')?.value   || new Date().toISOString().split('T')[0];
        q = q.gte('date', from).lte('date', to);
      }

      const { data, error } = await q;
      if (error) throw error;

      this._data = data || [];
      this._populateRoomFilter();
      this._renderKPIs();
      this._renderTable();
      this._renderCharts();
    } catch (e) {
      console.error('[AttendanceModule]', e);
      const tb = document.getElementById('attTableBody');
      if (tb) tb.innerHTML = '<tr><td colspan="6" class="text-center py-10">' + Helpers.errorState('Error al cargar asistencia', 'App.attendance.load()') + '</td></tr>';
      if (window.lucide) lucide.createIcons();
    } finally {
      this._setLoading(false);
    }
  },

  _populateRoomFilter() {
    const sel = document.getElementById('attFilterRoom');
    if (!sel) return;
    const rooms = [...new Map(this._data.map(r => [r.classroom?.id, r.classroom?.name]).filter(([id]) => id)).values()];
    const current = sel.value;
    sel.innerHTML = '<option value="">Todas las aulas</option>' +
      rooms.map(name => `<option value="${name}" ${current === name ? 'selected' : ''}>${Helpers.escapeHTML(name)}</option>`).join('');
  },

  _filtered() {
    const room   = document.getElementById('attFilterRoom')?.value   || '';
    const status = document.getElementById('attFilterStatus')?.value || '';
    const q      = (document.getElementById('attSearch')?.value || '').toLowerCase().trim();

    return this._data.filter(r => {
      if (room   && r.classroom?.name !== room)                    return false;
      if (status && norm(r.status) !== status)                     return false;
      if (q      && !(r.student?.name || '').toLowerCase().includes(q)) return false;
      return true;
    });
  },

  _renderKPIs() {
    const d = this._data;
    const total    = d.length;
    const present  = d.filter(r => ['present','presente'].includes(norm(r.status))).length;
    const absent   = d.filter(r => ['absent','ausente'].includes(norm(r.status))).length;
    const late     = d.filter(r => ['late','tarde'].includes(norm(r.status))).length;
    const rate     = total > 0 ? Math.round((present / total) * 100) : 0;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('attKpiTotal',   total);
    set('attKpiPresent', present);
    set('attKpiAbsent',  absent);
    set('attKpiLate',    late);
    set('attKpiRate',    rate + '%');

    // Barra de progreso
    const bar = document.getElementById('attRateBar');
    if (bar) bar.style.width = rate + '%';
  },

  _renderTable() {
    const tbody = document.getElementById('attTableBody');
    if (!tbody) return;

    const rows = this._filtered();
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-14"><div class="flex flex-col items-center gap-2 text-slate-400"><i data-lucide="calendar-x" class="w-8 h-8"></i><p class="font-bold text-sm">Sin registros para este filtro</p></div></td></tr>';
      if (window.lucide) lucide.createIcons();
      return;
    }

    // ✅ MEJORA: En modo rango, agrupar por estudiante y mostrar conteos
    if (this._mode === 'range') {
      this._renderTableGrouped(tbody, rows);
    } else {
      this._renderTableFlat(tbody, rows);
    }

    if (window.lucide) lucide.createIcons();
  },

  /** Vista por día — una fila por registro (comportamiento original) */
  _renderTableFlat(tbody, rows) {
    // Restaurar headers para vista plana
    const head = document.getElementById('attTableHead');
    if (head) {
      head.innerHTML = `<tr class="bg-slate-50 border-b border-slate-100">
        <th class="px-5 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Estudiante</th>
        <th class="px-5 py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-wider">Estado</th>
        <th class="px-5 py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-wider">Fecha</th>
        <th class="px-5 py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-wider">Entrada</th>
        <th class="px-5 py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-wider">Salida</th>
      </tr>`;
    }
    tbody.innerHTML = rows.map(r => {
      const s   = STATUS[norm(r.status)] || STATUS.absent;
      const ini = r.student?.name?.charAt(0)?.toUpperCase() || '?';
      const checkIn  = r.check_in  ? new Date(r.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
      const checkOut = r.check_out ? new Date(r.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
      const dateStr  = new Date(r.date + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });

      return `<tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
        <td class="px-5 py-3.5">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm shrink-0 overflow-hidden">
              ${r.student?.avatar_url ? `<img src="${r.student.avatar_url}" class="w-full h-full object-cover">` : ini}
            </div>
            <div>
              <div class="font-bold text-slate-800 text-sm">${Helpers.escapeHTML(r.student?.name || '—')}</div>
              <div class="text-[10px] text-slate-400 font-bold uppercase">${Helpers.escapeHTML(r.classroom?.name || '—')}</div>
            </div>
          </div>
        </td>
        <td class="px-5 py-3.5 text-center">
          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${s.cls}">
            <i data-lucide="${s.icon}" class="w-3 h-3"></i>${s.label}
          </span>
        </td>
        <td class="px-5 py-3.5 text-center text-[11px] font-bold text-slate-600">${dateStr}</td>
        <td class="px-5 py-3.5 text-center text-[11px] font-bold text-slate-600">${checkIn}</td>
        <td class="px-5 py-3.5 text-center text-[11px] font-bold text-slate-600">${checkOut}</td>
      </tr>`;
    }).join('');
  },

  /** Vista por periodo — UNA fila por estudiante con conteos de presentes/ausentes/tardanzas */
  _renderTableGrouped(tbody, rows) {
    // Actualizar headers para vista agrupada
    const head = document.getElementById('attTableHead');
    if (head) {
      head.innerHTML = `<tr class="bg-slate-50 border-b border-slate-100">
        <th class="px-5 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Estudiante</th>
        <th class="px-5 py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-wider">Presentes</th>
        <th class="px-5 py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-wider">Ausencias / Tardanzas</th>
        <th class="px-5 py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-wider">Asistencia %</th>
        <th class="px-5 py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-wider">Último registro</th>
      </tr>`;
    }
    const map = new Map();
    rows.forEach(r => {
      const sid = r.student?.id || r.student_id || 'unknown';
      if (!map.has(sid)) {
        map.set(sid, {
          student:  r.student,
          classroom: r.classroom,
          present: 0, absent: 0, late: 0, total: 0,
          lastDate: r.date
        });
      }
      const g = map.get(sid);
      const k = norm(r.status);
      if (['present','presente'].includes(k))   g.present++;
      else if (['absent','ausente'].includes(k)) g.absent++;
      else if (['late','tarde'].includes(k))     g.late++;
      g.total++;
      if (r.date > g.lastDate) g.lastDate = r.date;
    });

    const grouped = Array.from(map.values())
      .sort((a, b) => b.present - a.present); // ordenar por más presentes

    tbody.innerHTML = grouped.map(g => {
      const ini  = g.student?.name?.charAt(0)?.toUpperCase() || '?';
      const rate = g.total > 0 ? Math.round((g.present / g.total) * 100) : 0;
      const barColor = rate >= 80 ? 'bg-emerald-500' : rate >= 60 ? 'bg-amber-500' : 'bg-rose-500';
      const lastStr  = g.lastDate ? new Date(g.lastDate + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '—';

      return `<tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
        <td class="px-5 py-3.5">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm shrink-0 overflow-hidden">
              ${g.student?.avatar_url ? `<img src="${g.student.avatar_url}" class="w-full h-full object-cover">` : ini}
            </div>
            <div>
              <div class="font-bold text-slate-800 text-sm">${Helpers.escapeHTML(g.student?.name || '—')}</div>
              <div class="text-[10px] text-slate-400 font-bold uppercase">${Helpers.escapeHTML(g.classroom?.name || '—')}</div>
            </div>
          </div>
        </td>
        <td class="px-5 py-3.5 text-center">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700">
            <i data-lucide="check-circle" class="w-3 h-3"></i>${g.present}
          </span>
        </td>
        <td class="px-5 py-3.5 text-center">
          <div class="flex items-center justify-center gap-2">
            <span class="text-[10px] font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">${g.absent} aus</span>
            <span class="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">${g.late} tard</span>
          </div>
        </td>
        <td class="px-5 py-3.5">
          <div class="flex items-center gap-2">
            <div class="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden max-w-[80px]">
              <div class="${barColor} h-full rounded-full" style="width:${rate}%"></div>
            </div>
            <span class="text-[10px] font-black text-slate-600">${rate}%</span>
          </div>
        </td>
        <td class="px-5 py-3.5 text-center text-[11px] font-bold text-slate-500">${lastStr}</td>
      </tr>`;
    }).join('');
  },

  _renderCharts() {
    const d = this._data;
    const present = d.filter(r => ['present','presente'].includes(norm(r.status))).length;
    const absent  = d.filter(r => ['absent','ausente'].includes(norm(r.status))).length;
    const late    = d.filter(r => ['late','tarde'].includes(norm(r.status))).length;

    // Donut
    const donutCanvas = document.getElementById('attDonutChart');
    if (donutCanvas && window.Chart) {
      if (this._donutChart) this._donutChart.destroy();
      this._donutChart = new Chart(donutCanvas, {
        type: 'doughnut',
        data: {
          labels: ['Presentes', 'Ausentes', 'Tardanzas'],
          datasets: [{ data: [present, absent, late], backgroundColor: ['#10b981','#f43f5e','#f59e0b'], borderWidth: 0, hoverOffset: 6 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '72%',
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 11, weight: 'bold' }, padding: 12 } }
          }
        }
      });
    }

    // Bar por aula (solo en modo rango)
    const barCanvas = document.getElementById('attBarChart');
    if (barCanvas && window.Chart && this._mode === 'range') {
      const roomMap = {};
      d.forEach(r => {
        const name = r.classroom?.name || 'Sin aula';
        if (!roomMap[name]) roomMap[name] = { present: 0, absent: 0, late: 0 };
        const k = norm(r.status);
        if (['present','presente'].includes(k)) roomMap[name].present++;
        else if (['absent','ausente'].includes(k)) roomMap[name].absent++;
        else roomMap[name].late++;
      });
      const labels = Object.keys(roomMap);
      if (this._barChart) this._barChart.destroy();
      this._barChart = new Chart(barCanvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Presentes',  data: labels.map(l => roomMap[l].present), backgroundColor: '#10b981', borderRadius: 6 },
            { label: 'Ausentes',   data: labels.map(l => roomMap[l].absent),  backgroundColor: '#f43f5e', borderRadius: 6 },
            { label: 'Tardanzas',  data: labels.map(l => roomMap[l].late),    backgroundColor: '#f59e0b', borderRadius: 6 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 11, weight: 'bold' }, padding: 10 } } },
          scales: {
            x: { stacked: false, grid: { display: false } },
            y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { precision: 0 } }
          }
        }
      });
      document.getElementById('attBarWrap')?.classList.remove('hidden');
    } else {
      document.getElementById('attBarWrap')?.classList.add('hidden');
    }
  },

  _exportCSV() {
    const rows = this._filtered();
    if (!rows.length) return Helpers.toast('No hay datos para exportar', 'warning');

    const headers = ['Estudiante', 'Aula', 'Estado', 'Fecha', 'Entrada', 'Salida'];
    const lines = rows.map(r => [
      r.student?.name || '',
      r.classroom?.name || '',
      STATUS[norm(r.status)]?.label || r.status,
      r.date,
      r.check_in  ? new Date(r.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      r.check_out ? new Date(r.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
    ].map(v => `"${v}"`).join(','));

    const csv  = [headers.join(','), ...lines].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `asistencia_${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  },

  _setLoading(on) {
    const spinner = document.getElementById('attSpinner');
    if (spinner) spinner.classList.toggle('hidden', !on);
  }
};
