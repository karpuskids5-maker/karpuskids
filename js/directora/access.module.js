import { supabase } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';

export const AccessModule = {
  _chart: null,
  _data: { staff: [], students: [], attendance: [] },

  async init() {
    const table = document.getElementById('access-monitor-table-body');
    if (!table) return;
    
    // Fechas por defecto: Hoy
    const today = new Date().toISOString().split('T')[0];
    if (document.getElementById('accessDateFrom')) document.getElementById('accessDateFrom').value = today;
    if (document.getElementById('accessDateTo'))   document.getElementById('accessDateTo').value   = today;

    // Listeners de filtros
    const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
    on('accessDateFrom',   'change', () => this.load());
    on('accessDateTo',     'change', () => this.load());
    on('accessSearch',     'input',  () => this._render());
    document.getElementById('btnExportAccessReport')?.addEventListener('click', () => this.exportDailyReport());
    document.getElementById('btnIntelligentReport')?.addEventListener('click', () => this.exportIntelligenceReport());
    
    await this.load();
  },

  async load() {
    const from = document.getElementById('accessDateFrom')?.value;
    const to   = document.getElementById('accessDateTo')?.value;

    try {
      const [staff, students, doorPunches] = await Promise.all([
        supabase.from('profiles').select('id, name, role, matricula').in('role', ['maestra', 'asistente', 'directora']),
        supabase.from('students').select('id, name, matricula, classrooms(id, name)'),
        supabase.from('door_punches').select('student_id, staff_id, punch_type, punched_at').gte('date', from).lte('date', to)
      ]);
      
      // ✅ CORRECCIÓN DE CONEXIÓN: Obtener también asistencia manual para evitar falsos "No Reportados"
      const { data: manualAtt } = await supabase.from('attendance').select('student_id, status').eq('date', from);
      const manualMap = new Set((manualAtt || []).map(a => String(a.student_id)));

      // Process door punches to get latest status for each person
      const punchMap = new Map();
      (doorPunches.data || []).forEach(punch => {
        const personId = punch.student_id || punch.staff_id;
        if (!punchMap.has(personId)) {
          punchMap.set(personId, []);
        }
        punchMap.get(personId).push(punch);
      });

      // For each person, sort punches by time and determine status
      const processedPunches = new Map();
      punchMap.forEach((punches, personId) => {
        punches.sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at));
        const latestPunch = punches[punches.length - 1];
        const checkInPunch = punches.find(p => p.punch_type === 'check_in');
        const checkOutPunch = punches.find(p => p.punch_type === 'check_out');

        processedPunches.set(personId, {
          check_in: checkInPunch?.punched_at || null,
          check_out: checkOutPunch?.punched_at || null,
          // Si ponchó entrada O si la maestra lo puso presente manualmente
          is_in: latestPunch?.punch_type === 'check_in' || manualMap.has(String(personId))
        });
      });

      this._data = {
        staff: staff.data || [],
        students: students.data || [],
        punches: processedPunches
      };

      this._render();
    } catch (e) {
      Helpers.toast('Error cargando monitoreo', 'error');
    }
  },

  _getFilteredData() {
    const query = (document.getElementById('accessSearch')?.value || '').toLowerCase().trim();

    const filtered = [
      ...this._data.staff.map(s => ({ ...s, isStaff: true })),
      ...this._data.students.map(s => ({ ...s, isStaff: false }))
    ].filter(p => !query || p.name.toLowerCase().includes(query));

    return { filtered };
  },

  _render() {
    const table = document.getElementById('access-monitor-table-body');
    const { filtered } = this._getFilteredData();

    table.innerHTML = filtered.map(p => {
      const log = this._data.punches.get(p.id);
      // ✅ DISEÑO: Status más claro y amigable para producción
      const isIn = log?.is_in;
      const status = isIn ? 'En Estancia' : (log?.check_out ? 'Salió' : 'No Reportado');
      const statusCls = isIn ? 'bg-emerald-100 text-emerald-700' : (log?.check_out ? 'bg-slate-100 text-slate-500' : 'bg-rose-50 text-rose-600 border-rose-100 border');
      
      const checkIn  = log?.check_in  ? new Date(log.check_in).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '—';
      const checkOut = log?.check_out ? new Date(log.check_out).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '—';

      return `<tr class="hover:bg-slate-50 transition-colors">
        <td class="px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg ${p.isStaff ? 'bg-indigo-100 text-indigo-700' : 'bg-orange-100 text-orange-700'} flex items-center justify-center font-black text-xs uppercase">
              ${p.name.charAt(0)}
            </div>
            <span class="font-bold text-slate-800 text-sm">${Helpers.escapeHTML(p.name)}</span>
          </div>
        </td>
        <td class="px-6 py-4">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-tighter">
            ${p.isStaff ? p.role : (p.classrooms?.name || 'General')}
          </span>
        </td>
        <td class="px-6 py-4 text-center font-bold text-slate-600 text-xs">${checkIn}</td>
        <td class="px-6 py-4 text-center font-bold text-slate-600 text-xs">${checkOut}</td>
        <td class="px-6 py-4 text-right">
          <span class="text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest ${statusCls}">${status}</span>
        </td>
      </tr>`;
    }).join('');
    
    document.getElementById('statStaffIn').textContent    = this._data.staff.filter(s => this._data.punches.get(s.id)?.is_in).length;
    document.getElementById('statStudentsIn').textContent = this._data.students.filter(s => this._data.punches.get(s.id)?.is_in).length;

    this._renderChart();
    if (window.lucide) lucide.createIcons();
  },

  _renderChart() {
    const ctx = document.getElementById('accessChart');
    if (!ctx || !window.Chart) return;
    
    const hours = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm'];
    const counts = new Array(12).fill(0);
    
    this._data.punches.forEach(punch => {
      if (!punch.check_in) return;
      const h = new Date(punch.check_in).getHours();
      if (h >= 7 && h <= 18) counts[h-7]++;
    });

    if (this._chart) this._chart.destroy();
    this._chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: hours,
        datasets: [{ label: 'Entradas', data: counts, borderColor: '#4f46e5', tension: 0.4, fill: true, backgroundColor: 'rgba(79, 70, 229, 0.05)' }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  },

  async exportDailyReport() {
    const from = document.getElementById('accessDateFrom')?.value;
    const to   = document.getElementById('accessDateTo')?.value;
    const { filtered } = this._getFilteredData();

    const body = filtered.map(p => {
      const log = this._data.punches.get(p.id);
      return [
        p.name,
        p.isStaff ? p.role : (p.classrooms?.name || 'General'),
        log?.check_in ? new Date(log.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
        log?.check_out ? new Date(log.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
        log ? (log.is_in ? 'En Estancia' : 'Fuera') : 'No Reportado'
      ];
    });

    if (!body.length) return Helpers.toast('No hay datos para exportar', 'warning');

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      doc.setFontSize(18);
      doc.text('Karpus Kids — Reporte de Monitoreo', 14, 15);
      doc.setFontSize(10);
      doc.text(`Periodo: ${from} al ${to}`, 14, 22);

      doc.autoTable({
        startY: 28,
        head: [['Nombre', 'Rol / Aula', 'Entrada', 'Salida', 'Estado']],
        body: body,
        theme: 'grid',
        headStyles: { fillColor: [79, 70, 229] }
      });

      doc.save(`monitoreo_${from}_${to}.pdf`);
      Helpers.toast('PDF generado con éxito', 'success');
    } catch (e) {
      Helpers.toast('Error al generar PDF', 'error');
    }
  },

  async exportIntelligenceReport() {
    const today = new Date().toISOString().split('T')[0];
    const { data: active } = await supabase.from('students').select('id, name, classrooms(name)').eq('is_active', true);
    const { data: att } = await supabase.from('attendance').select('student_id').eq('date', today);

    if (!active) return Helpers.toast('No hay estudiantes activos', 'warning');
    const attIds = new Set((att || []).map(a => a.student_id));
    const missing = active.filter(s => !attIds.has(s.id));

    if (!missing.length) return Helpers.toast('Asistencia completa hoy', 'success');

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text('Alumnos No Reportados (Faltas hoy)', 14, 15);
      doc.autoTable({
        startY: 25,
        head: [['Alumno', 'Aula']],
        body: missing.map(s => [s.name, s.classrooms?.name || 'General']),
        headStyles: { fillColor: [225, 29, 72] }
      });
      doc.save(`faltas_${today}.pdf`);
    } catch (e) {
      Helpers.toast('Error generando reporte', 'error');
    }
  }
};
