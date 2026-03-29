import { supabase } from '../shared/supabase.js';
import { Helpers } from './helpers.js';

export const AttendanceModule = {
  _studentId: null,
  _attendance: [],

  async init(studentId) {
    // Usar el studentId pasado como parámetro — no buscar en auth
    if (studentId) this._studentId = studentId;
    if (!this._studentId) return;

    const filter = document.getElementById('attendanceFilter');
    if (filter && !filter._initialized) {
      filter._initialized = true;
      filter.addEventListener('change', (e) => {
        const now = new Date();
        const val = e.target.value; // 'semana' | 'mes' | 'YYYY-MM'
        if (val === 'semana') {
          // Últimos 7 días — mostrar mes actual
          this.loadAttendance(now.getFullYear(), now.getMonth() + 1);
        } else if (val === 'mes') {
          this.loadAttendance(now.getFullYear(), now.getMonth() + 1);
        } else if (val && val.includes('-')) {
          // Formato "YYYY-MM" para meses específicos
          const [y, m] = val.split('-').map(Number);
          this.loadAttendance(y, m);
        }
      });

      // Poblar opciones de los últimos 6 meses
      const now = new Date();
      for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        const label = d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label.charAt(0).toUpperCase() + label.slice(1);
        if (i === 0) opt.selected = true;
        filter.appendChild(opt);
      }
    }

    const now = new Date();
    await this.loadAttendance(now.getFullYear(), now.getMonth() + 1);
  },

  async loadAttendance(year, month) {
    const calendar     = document.getElementById('calendarGrid');
    const statsPresent = document.getElementById('attPresent');
    const statsLate    = document.getElementById('attLate');
    const statsAbsent  = document.getElementById('attAbsent');

    if (calendar) {
      calendar.innerHTML = Helpers.skeleton(5, 'h-10');
    }

    try {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay   = new Date(year, month, 0).getDate();
      const endDate   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const { data, error } = await supabase
        .from('attendance')
        .select('*')
        .eq('student_id', this._studentId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (error) throw error;

      this._attendance = data || [];

      // KPIs — Normalizar estados para conteo robusto y asegurar que sean números
      const present = this._attendance.filter(a => ['present', 'presente'].includes(a.status?.toLowerCase())).length;
      const late    = this._attendance.filter(a => ['late', 'tarde'].includes(a.status?.toLowerCase())).length;
      const absent  = this._attendance.filter(a => ['absent', 'ausente'].includes(a.status?.toLowerCase())).length;

      if (statsPresent) statsPresent.textContent = present;
      if (statsLate)    statsLate.textContent    = late;
      if (statsAbsent)  statsAbsent.textContent  = absent;

      this.renderCalendar(year, month);
      this.renderList(this._attendance);

    } catch (err) {
      console.error('Error loadAttendance:', err);
      if (calendar) {
        calendar.innerHTML = Helpers.emptyState('Error al cargar asistencia', '❌');
      }
    }
  },

  renderCalendar(year, month) {
    const container = document.getElementById('calendarGrid');
    if (!container) return;

    // Actualizar nombre del mes en el filtro si es necesario o en un header
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay    = new Date(year, month - 1, 1).getDay();

    // Parsear fecha del string "YYYY-MM-DD" directamente — evita problemas de timezone
    const attMap = new Map();
    this._attendance.forEach(a => {
      if (!a.date) return;
      // Extraer día del string "YYYY-MM-DD" de forma robusta
      const parts = a.date.split('-');
      const day = parseInt(parts[2], 10);
      attMap.set(day, a.status?.toLowerCase());
    });

    const today     = new Date();
    const todayDay  = today.getDate();
    const todayMon  = today.getMonth() + 1;
    const todayYear = today.getFullYear();

    let html = '';

    // Celdas vacías al inicio del mes
    for (let i = 0; i < firstDay; i++) {
      html += '<div class="aspect-square"></div>';
    }

    // Días del mes
    for (let d = 1; d <= daysInMonth; d++) {
      const status  = attMap.get(d);
      const isToday = d === todayDay && month === todayMon && year === todayYear;

      let cls = 'aspect-square flex flex-col items-center justify-center rounded-2xl text-xs font-black transition-all ';

      if (status === 'present' || status === 'presente') {
        cls += 'bg-green-500 text-white shadow-lg shadow-green-100 scale-105 z-10';
      } else if (status === 'absent' || status === 'ausente') {
        cls += 'bg-rose-500 text-white shadow-lg shadow-rose-100';
      } else if (status === 'late' || status === 'tarde') {
        cls += 'bg-amber-500 text-white shadow-lg shadow-amber-100';
      } else {
        cls += 'bg-white text-slate-400 border border-slate-100 hover:bg-slate-50';
      }

      if (isToday && !status) cls += ' ring-2 ring-emerald-400 ring-offset-2';

      html += `
        <div class="${cls}">
          <span>${d}</span>
          ${status === 'present' || status === 'presente' ? '<div class="w-1 h-1 bg-white rounded-full mt-0.5"></div>' : ''}
        </div>`;
    }

    container.innerHTML = html;
  },

  renderList(data) {
    const container = document.getElementById('attendanceHistoryList');
    if (!container) return;

    if (!data.length) {
      container.innerHTML = Helpers.emptyState('Sin registros este mes', '\uD83D\uDCC5');
      return;
    }

    const statusMap = {
      present:  { label: 'Presente', cls: 'bg-emerald-100 text-emerald-700' },
      presente: { label: 'Presente', cls: 'bg-emerald-100 text-emerald-700' },
      absent:   { label: 'Ausente',  cls: 'bg-rose-100 text-rose-700' },
      ausente:  { label: 'Ausente',  cls: 'bg-rose-100 text-rose-700' },
      late:     { label: 'Tarde',    cls: 'bg-amber-100 text-amber-700' },
      tarde:    { label: 'Tarde',    cls: 'bg-amber-100 text-amber-700' }
    };

    container.innerHTML = data.map(a => {
      const statusKey = a.status?.toLowerCase();
      const st  = statusMap[statusKey] || { label: a.status, cls: 'bg-slate-100 text-slate-600' };
      const day = parseInt(a.date.split('-')[2], 10);
      return (
        '<div class="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 shadow-sm mb-3 group hover:shadow-md transition-all">' +
          '<div class="flex items-center gap-4">' +
            '<div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-sm font-black text-slate-400 group-hover:bg-emerald-50 group-hover:text-emerald-500 transition-colors">' + day + '</div>' +
            '<div>' +
              '<p class="text-sm font-black text-slate-800">' + Helpers.formatDate(a.date) + '</p>' +
              '<p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">' + (a.check_in ? 'Ingreso: ' + a.check_in : 'Sin registro de hora') + '</p>' +
            '</div>' +
          '</div>' +
          '<span class="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ' + st.cls + '">' + st.label + '</span>' +
        '</div>'
      );
    }).join('');
  }
};
