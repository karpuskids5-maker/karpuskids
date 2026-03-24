import { supabase } from '../shared/supabase.js';
import { AppState, TABLES, CacheKeys } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';

/**
 * 📅 MÓDULO DE ASISTENCIA (PADRES)
 */
export const AttendanceModule = {
  _studentId: null,
  _attendance: [],

  /**
   * Inicializa el módulo
   */
  async init(studentId) {
    if (!studentId) return;
    this._studentId = studentId;
    
    // Configurar filtro de asistencia
    const filter = document.getElementById('attendanceFilter');
    if (filter && !filter._initialized) {
      filter.onchange = (e) => {
        const now = new Date();
        this.loadAttendance(now.getFullYear(), now.getMonth() + 1); // For now simple refresh
      };
      filter._initialized = true;
    }

    const now = new Date();
    await this.loadAttendance(now.getFullYear(), now.getMonth() + 1);
  },

  /**
   * Carga historial de asistencia
   */
  async loadAttendance(year, month) {
    const container = document.getElementById('attendanceHistoryList'); // Reusing a common ID pattern or checking HTML
    const calendar = document.getElementById('calendarGrid'); // Corrected from panel_padres.html
    
    // Check if we need to update stats too
    const statsPresent = document.getElementById('attPresent');
    const statsLate = document.getElementById('attLate');
    const statsAbsent = document.getElementById('attAbsent');
    
    if (calendar) calendar.innerHTML = `<div class="col-span-7 h-48 flex items-center justify-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>`;

    try {
      const cacheKey = CacheKeys.attendance(this._studentId, month, year);
      let data = AppState.getCache(cacheKey);

      if (!data) {
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

        const { data: freshData, error } = await supabase
          .from('attendance')
          .select('*')
          .eq('student_id', this._studentId)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: false });
        
        if (error) throw error;
        data = freshData || [];
        AppState.setCache(cacheKey, data, 300000); // 5 min cache
      }

      this._attendance = data;
      
      // Update stats
      if (statsPresent) statsPresent.textContent = data.filter(a => a.status === 'present').length;
      if (statsLate) statsLate.textContent = data.filter(a => a.status === 'late').length;
      if (statsAbsent) statsAbsent.textContent = data.filter(a => a.status === 'absent').length;

      this.renderCalendar(year, month);
      // If we have a list container, render it
      // this.renderList(data);

    } catch (err) {
      console.error('Error loadAttendance:', err);
    }
  },

  /**
   * Renderiza calendario visual
   */
  renderCalendar(year, month) {
    const container = document.getElementById('calendarGrid');
    if (!container) return;

    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = new Date(year, month - 1, 1).getDay();
    
    // Map existing attendance by day
    const attMap = new Map();
    this._attendance.forEach(a => {
      const d = new Date(a.date).getUTCDate(); // Use UTC to avoid timezone shifts
      attMap.set(d, a.status);
    });

    let html = '';

    // Espacios vacíos para el inicio del mes
    for (let i = 0; i < firstDay; i++) {
      html += `<div class="aspect-square"></div>`;
    }

    // Días del mes
    for (let d = 1; d <= daysInMonth; d++) {
      const status = attMap.get(d);
      let classes = "aspect-square flex items-center justify-center rounded-2xl text-xs font-bold transition-all ";
      
      if (status === 'present') classes += "bg-emerald-100 text-emerald-700 border-2 border-emerald-200";
      else if (status === 'absent') classes += "bg-rose-100 text-rose-700 border-2 border-rose-200";
      else if (status === 'late') classes += "bg-amber-100 text-amber-700 border-2 border-amber-200";
      else classes += "bg-slate-50 text-slate-400 hover:bg-slate-100 border-2 border-transparent";

      const isToday = new Date().getUTCDate() === d && new Date().getUTCMonth() + 1 === month;
      if (isToday) classes += " ring-2 ring-indigo-500 ring-offset-2";

      html += `<div class="${classes}">${d}</div>`;
    }

    container.innerHTML = html;
  },

  /**
   * Renderiza lista de eventos
   */
  renderList(data) {
    const container = document.getElementById('attendanceHistoryList');
    if (!container) return;

    if (!data.length) {
      container.innerHTML = Helpers.emptyState('Sin registros este mes', '📅');
      return;
    }

    const statusMap = {
      present: { label: 'Presente', class: 'text-emerald-600 bg-emerald-50' },
      absent: { label: 'Ausente', class: 'text-rose-600 bg-rose-50' },
      late: { label: 'Tarde', class: 'text-amber-600 bg-amber-50' }
    };

    container.innerHTML = data.map(a => {
      const status = statusMap[a.status] || { label: a.status, class: 'bg-slate-50' };
      return `
        <div class="flex items-center justify-between p-4 bg-white rounded-2xl border-2 border-slate-50 mb-3 animate-fade-in">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-sm font-black text-slate-400">
              ${new Date(a.date).getDate()}
            </div>
            <div>
              <p class="text-sm font-black text-slate-800">${Helpers.formatDate(a.date)}</p>
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${a.check_in ? `Ingreso: ${a.check_in}` : 'Sin hora'}</p>
            </div>
          </div>
          <span class="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ${status.class}">${status.label}</span>
        </div>
      `;
    }).join('');
  }
};
