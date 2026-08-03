export const CalendarView = {
  renderPeriodTimeline(containerId, periods, schoolYear) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!periods || periods.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8 text-slate-400">
          <i data-lucide="calendar-x" class="w-12 h-12 mx-auto mb-3 opacity-50"></i>
          <p class="text-sm font-bold">No hay períodos configurados</p>
        </div>
      `;
      this._initIcons();
      return;
    }

    let yearStart, yearEnd;
    if (schoolYear) {
      yearStart = new Date(schoolYear.start_date);
      yearEnd = new Date(schoolYear.end_date);
    } else {
      const sorted = [...periods].sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
      yearStart = new Date(sorted[0].start_date);
      yearEnd = new Date(sorted[sorted.length - 1].end_date);
    }
    const totalDays = this._daysBetween(yearStart, yearEnd) || 1;

    let timelineHtml = `
      <div class="space-y-6">
        <div class="relative py-4">
          <div class="absolute left-0 right-0 top-1/2 h-2 bg-slate-100 rounded-full -translate-y-1/2"></div>
          <div class="relative flex justify-between" style="height:60px;">
    `;

    periods.forEach((p, idx) => {
      const pStart = new Date(p.start_date);
      const pEnd = new Date(p.end_date);
      const leftPct = Math.max(0, (this._daysBetween(yearStart, pStart) / totalDays) * 100);
      const widthPct = Math.max(2, (this._daysBetween(pStart, pEnd) / totalDays) * 100);

      const colorMap = {
        open: 'bg-emerald-400',
        closed: 'bg-slate-300',
        pending: 'bg-slate-200'
      };
      const barColor = colorMap[p.status] || 'bg-slate-200';
      const isActive = p.is_active;

      timelineHtml += `
        <div class="absolute" style="left:${leftPct}%;width:${widthPct}%;top:50%;transform:translateY(-50%);">
          <div class="${barColor} ${isActive ? 'ring-2 ring-violet-500 ring-offset-2 animate-pulse' : ''} rounded-full h-3 relative group cursor-pointer transition-all hover:h-4" title="${p.name}: ${p.start_date} → ${p.end_date}">
            <div class="opacity-0 group-hover:opacity-100 absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] font-bold px-3 py-1.5 rounded-xl whitespace-nowrap shadow-lg transition-all z-10">
              ${p.name}: ${this._formatDate(p.start_date)} → ${this._formatDate(p.end_date)}
            </div>
          </div>
        </div>
      `;
    });

    timelineHtml += `
          </div>
          <div class="flex justify-between mt-1">
            <span class="text-[10px] font-bold text-slate-400">${this._formatDate(yearStart.toISOString().split('T')[0])}</span>
            <span class="text-[10px] font-bold text-slate-400">${this._formatDate(yearEnd.toISOString().split('T')[0])}</span>
          </div>
        </div>
    `;

    timelineHtml += `
        <div class="grid gap-3">
          ${periods.map(p => this._renderPeriodCard(p)).join('')}
        </div>
    `;

    if (!schoolYear && periods.some(p => p.source === 'legacy')) {
      timelineHtml += `
        <div class="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-700 flex items-center gap-2">
          <i data-lucide="info" class="w-4 h-4 shrink-0"></i>
          Mostrando períodos del sistema anterior. Configura un Año Escolar en el panel de Directora para activar el nuevo sistema.
        </div>
      `;
    }

    timelineHtml += `</div>`;
    container.innerHTML = timelineHtml;
    this._initIcons();
  },

  _renderPeriodCard(p) {
    const isActive = p.is_active;
    const statusColors = {
      open: { bg: 'bg-emerald-50 border-emerald-200', badge: 'bg-emerald-500 text-white', dot: 'bg-emerald-500', text: 'text-emerald-700' },
      closed: { bg: 'bg-slate-50 border-slate-200', badge: 'bg-slate-400 text-white', dot: 'bg-slate-400', text: 'text-slate-500' },
      pending: { bg: 'bg-slate-50 border-slate-100', badge: 'bg-slate-300 text-white', dot: 'bg-slate-300', text: 'text-slate-400' }
    };
    const sc = statusColors[p.status] || statusColors.pending;

    const startParts = p.start_date.split('-');
    const endParts = p.end_date.split('-');
    const startObj = new Date(p.start_date + 'T00:00:00');
    const endObj = new Date(p.end_date + 'T00:00:00');
    const durationDays = Math.round((endObj - startObj) / (1000 * 60 * 60 * 24)) + 1;

    return `
      <div class="flex items-center gap-4 p-4 rounded-2xl border ${sc.bg} ${isActive ? 'ring-2 ring-violet-500 ring-offset-1' : ''} transition-all">
        <div class="w-12 h-12 rounded-xl ${isActive ? 'bg-violet-500 text-white' : p.status === 'closed' ? 'bg-slate-300 text-white' : 'bg-violet-100 text-violet-600'} flex items-center justify-center font-black text-sm shrink-0">
          ${p.order_index}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-0.5">
            <p class="text-sm font-black text-slate-800 truncate">${p.name}</p>
            ${isActive ? '<span class="w-2 h-2 rounded-full bg-violet-500 animate-pulse"></span>' : ''}
          </div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span class="text-[10px] font-bold text-slate-400 flex items-center gap-1">
              <i data-lucide="calendar" class="w-3 h-3"></i>
              ${this._formatDate(p.start_date)} — ${this._formatDate(p.end_date)}
            </span>
            <span class="text-[10px] font-bold text-slate-400 flex items-center gap-1">
              <i data-lucide="clock" class="w-3 h-3"></i>
              ${durationDays} día${durationDays !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="px-3 py-1 rounded-full text-[10px] font-black ${sc.badge}">
            ${p.status === 'open' ? 'ABIERTO' : p.status === 'closed' ? 'CERRADO' : 'PENDIENTE'}
          </span>
        </div>
      </div>
    `;
  },

  _formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  },

  _daysBetween(d1, d2) {
    const diff = d2.getTime() - d1.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  },

  _initIcons() {
    if (window.lucide) {
      setTimeout(() => lucide.createIcons(), 50);
    }
  }
};
