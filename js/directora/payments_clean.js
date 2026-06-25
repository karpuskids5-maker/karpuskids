import { DirectorApi } from './api.js';
import { AppState } from './state.js';
import { Helpers } from '/js/shared/helpers.js';
import { UIHelpers } from './ui.module.js';
import { supabase } from '/js/shared/supabase.js';
import { auditLog } from '/js/shared/db-utils.js';
import { UIPremium } from '/js/shared/ui-premium.js';

const MES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MES_LABEL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

export const PaymentsModule = {
  settings: { due_day: 5, generation_day: 25 },
  _chart: null,
  _ready: false,

  async init() {
    this._initSelectors();
    await this._loadSettings();
    if (!this._ready) {
      this._ready = true;
      const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
      on('btnRefreshPayments',    'click',  () => this.loadPayments());
      on('filterPaymentMonth',    'change', () => { this._saveFilters(); this.loadPayments(); });
      on('filterPaymentYear',     'change', () => { this._saveFilters(); this.loadPayments(); });
      on('filterPaymentStatus',   'change', () => { this._saveFilters(); this.loadPayments(); });
      on('searchPaymentStudent',  'input',  () => { this._saveFilters(); this.loadPayments(); });
      on('btnNewPaymentAction',   'click',  () => this.openPaymentModal());
      on('btnNewPayment',         'click',  () => this.openPaymentModal());
      on('btnGenerateCharges',    'click',  () => this.showCyclePreview());
      on('btnGeneratePaymentsNow','click',  () => this.showCyclePreview());
      on('btnSendPaymentReminders','click', () => this.sendReminders());
      on('btnExportMorosidad',    'click',  () => this.exportMorosidad());
      on('btnSavePaymentConfig',  'click',  () => this.savePaymentConfig());
    }
    this._loadFilters();
    await this.loadPayments();
  },

  _saveFilters() {
    const filters = {
      month:  document.getElementById('filterPaymentMonth')?.value,
      year:   document.getElementById('filterPaymentYear')?.value,
      status: document.getElementById('filterPaymentStatus')?.value,
      search: document.getElementById('searchPaymentStudent')?.value
    };
    sessionStorage.setItem('karpus_payment_filters', JSON.stringify(filters));
  },

  _loadFilters() {
    try {
      const saved = sessionStorage.getItem('karpus_payment_filters');
      if (!saved) return;
      const filters = JSON.parse(saved);
      const ms = document.getElementById('filterPaymentMonth');
      const ys = document.getElementById('filterPaymentYear');
      const ss = document.getElementById('filterPaymentStatus');
      const qs = document.getElementById('searchPaymentStudent');
      if (ms && filters.month) ms.value = filters.month;
      if (ys && filters.year)  ys.value = filters.year;
      if (ss && filters.status) ss.value = filters.status;
      if (qs && filters.search) qs.value = filters.search;
    } catch (_) {}
  },

  _initSelectors() {
    const selectorDate = new Date();
    const ms = document.getElementById('filterPaymentMonth');
    const ys = document.getElementById('filterPaymentYear');
    if (ms) ms.value = String(selectorDate.getMonth() + 1).padStart(2, '0');
    if (ys) ys.value = String(selectorDate.getFullYear());
  },

  async _loadSettings() {
    try {
      const { data } = await DirectorApi.getSchoolSettings();
      if (!data) return;
      this.settings.generation_day = data.generation_day || 25;
      this.settings.due_day = data.due_day || 5;
      const g = document.getElementById('confGenDay');
      const d = document.getElementById('confDueDay');
      const p = document.getElementById('confPhone');
      const h = document.getElementById('confHours');
      if (g) g.value = this.settings.generation_day;
      if (d) d.value = this.settings.due_day;
      if (p) p.value = data.phone || '';
      if (h) h.value = data.business_hours || '';
    } catch (_) {}
  },

  filterBy(status) {
    const sel = document.getElementById('filterPaymentStatus');
    if (sel) { sel.value = status; this.loadPayments(); }
  },

  async loadPayments() {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;
    tbody.innerHTML = `
      <tr><td colspan="8" class="px-5 py-3"><div class="h-12 bg-slate-100 rounded-xl animate-pulse w-full"></div></td></tr>
      <tr><td colspan="8" class="px-5 py-3"><div class="h-12 bg-slate-100 rounded-xl animate-pulse w-full" style="opacity:.7"></div></td></tr>
      <tr><td colspan="8" class="px-5 py-3"><div class="h-12 bg-slate-100 rounded-xl animate-pulse w-full" style="opacity:.5"></div></td></tr>
    `;
    this.loadStats();
    this.loadIncomeChart();
    try {
      const mv = document.getElementById('filterPaymentMonth')?.value;
      const yv = document.getElementById('filterPaymentYear')?.value;
      const sf = document.getElementById('filterPaymentStatus')?.value;
      const sq = document.getElementById('searchPaymentStudent')?.value?.trim();

      const currentDate = new Date();
      const today  = currentDate.getDate();
      const genDay = this.settings.generation_day || 25; // Día de generación

      // El mes actual solo es visible si hoy es >= 25.
      const currentYear  = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1; // 1-12
      
      let maxVisibleMonthKey;
      if (today >= genDay) {
        maxVisibleMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
      } else {
        const prevM = currentMonth === 1 ? 12 : currentMonth - 1;
        const prevY = currentMonth === 1 ? currentYear - 1 : currentYear;
        maxVisibleMonthKey = `${prevY}-${String(prevM).padStart(2, '0')}`;
      }

      const monthKey = yv && mv ? `${yv}-${String(mv).padStart(2,'0')}` : maxVisibleMonthKey;

      // Si el usuario selecciona un mes que aún no debe ser visible
      if (monthKey > maxVisibleMonthKey) {
        const mi = parseInt(mv, 10) - 1;
        const label = MES_LABEL[mi] || mv;
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-16">
          <div class="flex flex-col items-center gap-3">
            <div class="w-14 h-14 bg-indigo-50 rounded-full flex items-center justify-center text-2xl">📅</div>
            <p class="font-black text-slate-600 text-sm">Los cobros de ${label} ${yv} se generan el día ${genDay}</p>
            <p class="text-xs text-slate-400 font-medium">Vuelve a partir del día ${genDay} para ver este periodo.</p>
          </div></td></tr>`;
        if (window.lucide) lucide.createIcons();
        return;
      }

      const SEL = 'id,student_id,amount,concept,status,due_date,created_at,paid_date,method,bank,reference,month_paid,evidence_url,mora_amount,total_due,student_name,classroom_name';

      let q = supabase.from('v_payments_with_mora').select(SEL);

      if (sf === 'all') {
        q = q.or(`and(status.eq.overdue,month_paid.lt.${maxVisibleMonthKey}),month_paid.eq.${monthKey}`);
      } else if (sf === 'pending' || sf === 'overdue' || sf === 'review') {
        q = q.eq('status', sf).lte('month_paid', maxVisibleMonthKey);
      } else {
        q = q.eq('month_paid', monthKey);
        if (sf && sf !== 'all') q = q.eq('status', sf);
      }

      q = q.order('month_paid', { ascending: false }).order('due_date', { ascending: true });

      let { data, error } = await q;
      if (error) throw error;

      let list = data || [];
      if (sq) {
        const query = sq.toLowerCase();
        list = list.filter(p => p.student_name?.toLowerCase().includes(query));
      }

      AppState.set('paymentsData', list);

      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-16">
          <div class="flex flex-col items-center gap-3">
            <div class="w-14 h-14 bg-slate-50 rounded-full flex items-center justify-center"><i data-lucide="inbox" class="w-7 h-7 text-slate-300"></i></div>
            <p class="font-black text-slate-400 text-sm">Sin registros para este periodo</p>
          </div></td></tr>`;
        if (window.lucide) lucide.createIcons();
        return;
      }

      const previousMonthDebts = list.filter(p => p.month_paid < monthKey && this._st(p) === 'overdue');
      const currentMonthItems = list.filter(p => p.month_paid === monthKey);
      const otherItems = list.filter(p => p.month_paid !== monthKey && !previousMonthDebts.includes(p));

      let html = '';
      if (previousMonthDebts.length > 0) {
        html += '<tr class="bg-rose-50/30"><td colspan="8" class="px-5 py-2 text-[10px] font-black text-rose-600 uppercase tracking-[0.2em] border-y border-rose-100">\u26A0\uFE0F DEUDAS VENCIDAS (MESES ANTERIORES)</td></tr>';
        html += previousMonthDebts.map(p => this._row(p)).join('');
      }
      if (currentMonthItems.length > 0) {
        const monthLabel = MES_LABEL[parseInt(mv || (maxVisibleMonthKey.split('-')[1]), 10) - 1]?.toUpperCase() || 'MES SELECCIONADO';
        html += `<tr class="bg-indigo-50/50"><td colspan="8" class="px-5 py-2 text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em] border-y border-indigo-100">\uD83D\uDCC5 ${monthLabel} ${yv || maxVisibleMonthKey.split('-')[0]}</td></tr>`;
        html += currentMonthItems.map(p => this._row(p)).join('');
      }
      if (otherItems.length > 0 && sf !== 'all') {
        html += '<tr class="bg-slate-50/30"><td colspan="8" class="px-5 py-2 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-y border-slate-100">OTROS REGISTROS</td></tr>';
        html += otherItems.map(p => this._row(p)).join('');
      }

      tbody.innerHTML = html;

      // ✨ Inicializar Gestos Swipe
      UIPremium.initSwipeActions('paymentsTableBody', {
        onRight: (id) => {
          Helpers.vibrate('medium');
          this.markPaid(id);
        },
        onLeft: (id) => {
          const p = AppState.get('paymentsData')?.find(x => x.id === id);
          if (p?.evidence_url) window.open(p.evidence_url, '_blank');
        }
      });

      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('Error in loadPayments:', e);
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8">' + Helpers.errorState('Error al cargar pagos', 'App.payments.loadPayments()') + '</td></tr>';
      if (window.lucide) lucide.createIcons();
    }
  },

  _st(p) {
    const s = (p.status || '').toLowerCase();
    if (s === 'paid') return 'paid';
    if (s === 'review') return 'review';
    if (s === 'overdue') return 'overdue';
    if (s === 'rejected') return 'rechazado';
    // Si tiene comprobante subido → mostrar como en revisión aunque el status sea pending
    if (p.evidence_url) return 'review';
    // Si el due_date ya pasó y sigue pending → mostrar como overdue en UI
    if (s === 'pending' && p.due_date) {
      const todayDate = new Date(); todayDate.setHours(0,0,0,0);
      if (new Date(p.due_date + 'T00:00:00') < todayDate) return 'overdue';
    }
    return 'pending';
  },

  _row(p) {
    const sk = this._st(p);
    const sm = {
      paid:    { l: 'Aprobado',    c: 'bg-emerald-100 text-emerald-700', i: 'check-circle' },
      pending: { l: 'Pendiente',   c: 'bg-amber-100 text-amber-700',     i: 'clock' },
      review:  { l: 'En Revision', c: 'bg-blue-100 text-blue-700',       i: 'file-search' },
      overdue: { l: 'Vencido',     c: 'bg-rose-100 text-rose-700',       i: 'alert-triangle' }
    };
    const st  = sm[sk] || { l: p.status, c: 'bg-slate-100 text-slate-700', i: 'help-circle' };
    const stu = { name: p.student_name || 'Desconocido', classrooms: { name: p.classroom_name || '-' } };
    const ip  = sk !== 'paid';
    const ds  = p.due_date ? new Date(p.due_date + 'T00:00:00').toLocaleDateString('es-ES') : '-';
    const af  = 'RD$' + Number(p.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Mora acumulada (usando valores de la vista de Postgres)
    const mora         = Number(p.mora_amount || 0);
    const totalAmount  = Number(p.total_due || p.amount || 0);
    const tf           = 'RD$' + totalAmount.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let ub = '';
    if (mora > 0) {
      // Intentar obtener desglose local si es posible para el texto
      const breakdown = p.due_date ? Helpers.getMoraBreakdown(p.due_date, p.amount) : null;
      ub = '<div class="mt-1 flex flex-col items-end gap-0.5">' +
             '<span class="text-[9px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full uppercase">' +
               'Mora: +' + Helpers.formatCurrency(mora) + (breakdown ? ' (' + breakdown.formattedText + ')' : '') +
             '</span>' +
             '<span class="text-[10px] font-bold text-slate-800 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200">' +
               'Total: ' + tf +
             '</span>' +
           '</div>';
    } else if (p.due_date && ip) {
      const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
      const df = Math.round((new Date(p.due_date + 'T00:00:00') - todayMidnight) / 86400000);
      if (df === 0)      ub = '<span class="ml-1 text-[9px] font-black text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full">vence hoy</span>';
      else if (df <= 5)  ub = '<span class="ml-1 text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">vence en ' + df + 'd</span>';
    }

    const approveBtn  = ip ? '<button onclick="App.payments.markPaid(\'' + p.id + '\')" class="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors" title="Aprobar"><i data-lucide="check" class="w-4 h-4"></i></button>' : '';
    const waiveMoraBtn = (mora > 0)
      ? '<button onclick="App.payments.waiveMora(\'' + p.id + '\')" class="p-1.5 bg-violet-50 text-violet-600 rounded-lg hover:bg-violet-100 transition-colors" title="Quitar Mora"><i data-lucide="shield-off" class="w-4 h-4"></i></button>'
      : '';
    const deleteBtn   = '<button onclick="App.payments.delete(\'' + p.id + '\')" class="p-1.5 bg-rose-50 text-rose-500 rounded-lg hover:bg-rose-100 transition-colors" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>';
    const voucherCell = p.evidence_url
      ? '<a href="' + p.evidence_url + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-sky-600 hover:text-sky-800 text-xs font-bold uppercase"><i data-lucide="external-link" class="w-3 h-3"></i>Ver</a>'
      : '<span class="text-slate-300 text-xs">-</span>';

    return '<tr class="swipe-row hover:bg-slate-50 border-b border-slate-100 transition-colors' + (sk === 'overdue' ? ' bg-rose-50/20' : '') + '" data-id="' + p.id + '">' +
      '<td colspan="8" class="p-0 border-none">' +
        '<div class="swipe-actions">' +
          '<div class="action-left"><i data-lucide="check"></i></div>' +
          '<div class="action-right"><i data-lucide="eye"></i></div>' +
        '</div>' +
        '<div class="swipe-content bg-white flex w-full">' +
          '<table class="w-full table-fixed">' +
            '<tr>' +
              '<td class="px-5 py-3.5 w-1/4"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm flex-shrink-0">' + Helpers.escapeHTML((stu.name || '?').charAt(0).toUpperCase()) + '</div><div><div class="font-bold text-slate-800 text-sm truncate">' + Helpers.escapeHTML(stu.name || '-') + '</div><div class="text-[10px] text-slate-400 font-bold uppercase truncate">' + (stu.classrooms?.name || 'Sin aula') + '</div></div></div></td>' +
              '<td class="px-5 py-3.5 text-center w-1/6"><span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ' + st.c + '"><i data-lucide="' + st.i + '" class="w-3 h-3"></i>' + st.l + '</span></td>' +
              '<td class="px-5 py-3.5 text-right w-1/6"><div class="font-black text-slate-800 text-base">' + af + '</div>' + (ip ? '<div class="flex flex-col items-end gap-0.5 mt-0.5">' + ub + '</div>' : '') + '</td>' +
              '<td class="px-5 py-3.5 w-1/8"><span class="text-[10px] font-black uppercase text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">' + (p.method || '-') + '</span></td>' +
              '<td class="px-5 py-3.5 w-1/6"><div class="text-[10px] font-bold text-slate-600 uppercase truncate max-w-[110px]">' + (p.bank || '-') + '</div><div class="text-[9px] text-slate-400 font-bold">' + (p.reference || '') + '</div></td>' +
              '<td class="px-5 py-3.5 w-1/8"><div class="text-[11px] font-bold text-slate-700">' + (p.paid_date ? new Date(p.paid_date).toLocaleDateString('es-ES') : ds) + '</div><div class="text-[9px] text-slate-400 font-bold uppercase">' + (p.paid_date ? 'Pagado' : 'Vence') + '</div></td>' +
              '<td class="px-5 py-3.5 text-center w-1/12">' + voucherCell + '</td>' +
              '<td class="px-5 py-3.5 text-center w-1/8"><div class="flex justify-center gap-1.5">' + approveBtn + waiveMoraBtn + deleteBtn + '</div></td>' +
            '</tr>' +
          '</table>' +
        '</div>' +
      '</td>' +
    '</tr>';
  },

  async loadStats() {
    try {
      const mv = document.getElementById('filterPaymentMonth')?.value;
      const yv = document.getElementById('filterPaymentYear')?.value;

      // Lógica de visibilidad (idéntica a loadPayments)
      const currentDate = new Date();
      const today  = currentDate.getDate();
      const genDay = this.settings.generation_day || 25;
      const currentYear  = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1;

      let maxVisibleMonthKey;
      if (today >= genDay) {
        maxVisibleMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
      } else {
        const prevM = currentMonth === 1 ? 12 : currentMonth - 1;
        const prevY = currentMonth === 1 ? currentYear - 1 : currentYear;
        maxVisibleMonthKey = `${prevY}-${String(prevM).padStart(2, '0')}`;
      }

      // Si el mes seleccionado es mayor al máximo visible, no mostrar estadísticas (o mostrar 0)
      const selectedMonthKey = yv && mv ? `${yv}-${String(mv).padStart(2,'0')}` : maxVisibleMonthKey;
      
      if (selectedMonthKey > maxVisibleMonthKey) {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('kpiIncomeMonth', '$0.00');
        set('kpiPendingCount', '0');
        set('kpiOverdueCount', '0');
        set('kpiReviewCount', '0');
        return;
      }

      // Si no hay mv/yv (inicio), usar los de maxVisibleMonthKey
      const [defY, defM] = maxVisibleMonthKey.split('-');
      const { data } = await DirectorApi.getPaymentStats(mv || defM, yv || defY);

      if (!data) return;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('kpiIncomeMonth', '$' + Number(data.incomeMonth || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 }));
      set('kpiPendingCount', data.pending);
      set('kpiOverdueCount', data.overdue);
      set('kpiReviewCount',  data.toApprove || 0);
    } catch (_) {}
  },

  async loadIncomeChart() {
    const canvas = document.getElementById('financialChart');
    if (!canvas || !window.Chart) return;
    try {
      const year = document.getElementById('filterPaymentYear')?.value || new Date().getFullYear();
      const { data: pays } = await supabase.from('payments').select('amount,created_at').eq('status', 'paid').gte('created_at', year + '-01-01').lte('created_at', year + '-12-31');
      const labels = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      const vals = new Array(12).fill(0);
      (pays || []).forEach(p => { const d = new Date(p.created_at); vals[d.getMonth()] += Number(p.amount || 0); });
      if (this._chart) this._chart.destroy();
      this._chart = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Ingresos ($)', data: vals, backgroundColor: 'rgba(79,70,229,0.15)', borderColor: 'rgb(79,70,229)', borderWidth: 2, borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } }, x: { grid: { display: false } } } }
      });
    } catch (_) {}
  },

  async openPaymentModal(prefillStudentId = null) {
    const ic = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-bold text-slate-700';
    const lc = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';
    const modalDate = new Date();
    const curMonth = modalDate.getMonth();
    const curYear  = modalDate.getFullYear();
    const nextM = curMonth + 1 > 11 ? 0 : curMonth + 1;
    const nextY = curMonth + 1 > 11 ? curYear + 1 : curYear;
    const dd = `${nextY}-${String(nextM + 1).padStart(2,'0')}-${String(this.settings.due_day || 5).padStart(2,'0')}`;
    const mo = MES.map((m, i) => {
      const val = `${curYear}-${String(i + 1).padStart(2, '0')}`;
      return '<option value="' + val + '"' + (i === curMonth ? ' selected' : '') + '>' + MES_LABEL[i] + '</option>';
    }).join('');

    window.openGlobalModal(
      '<div class="bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6 rounded-t-3xl flex items-center justify-between">' +
        '<div class="flex items-center gap-3"><div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">\uD83D\uDCB0</div>' +
        '<div><h3 class="text-xl font-black">Registrar Pago</h3><p class="text-xs text-white/70 font-bold uppercase tracking-widest">Cobro Manual</p></div></div>' +
      '</div>' +
      '<div class="p-6 bg-slate-50/30" id="modalPayment"><div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
        '<div class="md:col-span-2"><label class="' + lc + '">Estudiante (Pendientes/Vencidos)</label>' +
          '<select id="payStudentSelect" class="' + ic + '"><option value="">-- Cargando... --</option></select>' +
          '<div id="payStudentInfo" class="mt-2 hidden p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-700"></div>' +
        '</div>' +
        '<div><label class="' + lc + '">Monto ($)</label><input id="payAmount" type="number" step="0.01" min="0" class="' + ic + '" placeholder="0.00"></div>' +
        '<div><label class="' + lc + '">Concepto</label><input id="payConcept" type="text" class="' + ic + '" value="Mensualidad"></div>' +
        '<div><label class="' + lc + '">Mes que se cobra</label><select id="payMonthPaid" class="' + ic + '">' + mo + '</select></div>' +
        '<div><label class="' + lc + '">Fecha Limite</label><input id="payDueDate" type="date" class="' + ic + '" value="' + dd + '"></div>' +
        '<div><label class="' + lc + '">Metodo</label><select id="payMethod" class="' + ic + '"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select></div>' +
        '<div><label class="' + lc + '">Estado</label><select id="payStatus" class="' + ic + '"><option value="paid">Pagado</option><option value="pending">Pendiente</option></select></div>' +
      '</div></div>' +
      '<div class="bg-white p-5 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">' +
        '<button onclick="App.ui.closeModal()" class="px-6 py-2.5 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl">Cancelar</button>' +
        '<button id="btnSavePaymentAction" class="px-10 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-purple-100 transition-all hover:-translate-y-0.5 active:scale-95">Registrar Pago</button>' +
      '</div>'
    );

    try {
      // Cargar solo estudiantes con pagos pendientes o vencidos
      const { data: pendingPayments } = await supabase
        .from('payments')
        .select('student_id, amount, due_date, month_paid, status, students:student_id(id, name, monthly_fee, classrooms:classroom_id(name))')
        .in('status', ['pending', 'overdue'])
        .order('due_date', { ascending: true });

      const select = document.getElementById('payStudentSelect');
      if (select) {
        if (!pendingPayments?.length) {
          select.innerHTML = '<option value="">-- No hay pagos pendientes --</option>';
        } else {
          // Deduplicar por estudiante (tomar el más urgente)
          const studentMap = new Map();
          for (const p of pendingPayments) {
            const sid = p.student_id;
            if (!studentMap.has(sid) || p.status === 'overdue') {
              studentMap.set(sid, p);
            }
          }
          select.innerHTML = '<option value="">-- Seleccionar Estudiante --</option>' +
            Array.from(studentMap.values()).map(p => {
              const s = p.students;
              const isOverdue = p.status === 'overdue';
              const label = `${s?.name || 'Estudiante'} (${s?.classrooms?.name || 'Sin aula'}) ${isOverdue ? '⚠️ Vencido' : '⏳ Pendiente'}`;
              const selected = prefillStudentId && String(p.student_id) === String(prefillStudentId) ? ' selected' : '';
              return `<option value="${p.student_id}" data-fee="${s?.monthly_fee || 0}" data-due="${p.due_date || ''}" data-month="${p.month_paid || ''}" data-status="${p.status}" data-payment-id="${p.id || ''}"${selected}>${Helpers.escapeHTML(label)}</option>`;
            }).join('');
        }

        // Auto-fill monto + mora al seleccionar estudiante
        select.addEventListener('change', (e) => {
          const opt = e.target.selectedOptions[0];
          if (!opt?.value) {
            document.getElementById('payStudentInfo')?.classList.add('hidden');
            return;
          }
          const fee = parseFloat(opt.dataset.fee || 0);
          const dueDate = opt.dataset.due;
          const monthPaid = opt.dataset.month;
          const status = opt.dataset.status;
          const amtInput = document.getElementById('payAmount');
          const infoDiv = document.getElementById('payStudentInfo');
          const monthSelect = document.getElementById('payMonthPaid');

          // Calcular mora si aplica
          let mora = 0;
          if (dueDate && status === 'overdue') {
            const todayModal = new Date(); todayModal.setHours(0,0,0,0);
            const due = new Date(dueDate + 'T00:00:00');
            const daysLate = Math.max(0, Math.floor((todayModal - due) / 86400000));
            if (daysLate > 0) {
              const moraRate = 0.05; // 5% por mes de mora
              const monthsLate = Math.ceil(daysLate / 30);
              mora = fee * moraRate * monthsLate;
            }
          }

          const total = fee + mora;
          if (amtInput) {
            amtInput.value = total > 0 ? total.toFixed(2) : '';
            amtInput.classList.add('ring-2', 'ring-purple-100');
            setTimeout(() => amtInput.classList.remove('ring-2', 'ring-purple-100'), 1000);
          }

          // Mostrar info de mora si aplica
          if (infoDiv) {
            if (mora > 0) {
              infoDiv.classList.remove('hidden');
              infoDiv.innerHTML = `Mensualidad: RD$${fee.toFixed(2)} + Mora: RD$${mora.toFixed(2)} = <strong>Total: RD$${total.toFixed(2)}</strong>`;
            } else {
              infoDiv.classList.add('hidden');
            }
          }

          // Sincronizar mes del pago
          if (monthPaid && monthSelect) {
            const opt2 = monthSelect.querySelector(`option[value="${monthPaid}"]`);
            if (opt2) monthSelect.value = monthPaid;
          }

          // Sincronizar fecha límite
          if (dueDate) {
            const dueDateInput = document.getElementById('payDueDate');
            if (dueDateInput) dueDateInput.value = dueDate;
          }
        });

        if (prefillStudentId) select.dispatchEvent(new Event('change'));
      }
    } catch (_) {}

    document.getElementById('btnSavePaymentAction')?.addEventListener('click', () => this.saveManualPayment());
    if (window.lucide) lucide.createIcons();
  },

  async saveManualPayment() {
    const sid = document.getElementById('payStudentSelect')?.value;
    const amt = parseFloat(document.getElementById('payAmount')?.value || 0);
    const con = document.getElementById('payConcept')?.value?.trim() || 'Mensualidad';
    const mp  = document.getElementById('payMonthPaid')?.value;
    const dd  = document.getElementById('payDueDate')?.value;
    const met = document.getElementById('payMethod')?.value || 'efectivo';
    const sta = document.getElementById('payStatus')?.value || 'paid';
    const pd  = sta === 'paid' ? new Date().toISOString() : null;

    if (!sid) return Helpers.toast('Selecciona un estudiante', 'warning');
    if (!amt || amt <= 0) return Helpers.toast('Ingresa un monto valido', 'warning');

    const saveBtn = document.getElementById('btnSavePaymentAction');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }

    UIHelpers.setLoading(true, '#modalPayment');
    try {
      // Buscar pago existente por YYYY-MM y también por nombre de mes (legacy)
      const mesNombre = MES[parseInt(mp.split('-')[1], 10) - 1];
      const { data: existingList } = await supabase
        .from('payments')
        .select('id, status, month_paid')
        .eq('student_id', sid)
        .or(`month_paid.eq.${mp},month_paid.eq.${mesNombre}`)
        .limit(5);

      const existing = existingList?.[0] || null;
      let pay;

      if (existing) {
        if (existing.status === 'paid') {
          Helpers.toast('Este estudiante ya tiene un pago aprobado para este mes', 'warning');
          return;
        }
        // Actualizar existente y normalizar month_paid a YYYY-MM
        const { data: updated, error: upErr } = await supabase.from('payments').update({
          amount: amt, concept: con, method: met, status: sta,
          due_date: dd || null, paid_date: pd,
          month_paid: mp,
          updated_at: new Date().toISOString()
        }).eq('id', existing.id).select().single();
        if (upErr) throw upErr;
        pay = updated;
      } else {
        const { data: inserted, error: insErr } = await supabase.from('payments').insert({
          student_id: sid, amount: amt, concept: con, method: met, status: sta,
          month_paid: mp, due_date: dd || null, paid_date: pd,
          created_at: new Date().toISOString()
        }).select().single();
        if (insErr) {
          if (insErr.code === '23505') throw new Error('Ya existe un registro para este mes.');
          throw insErr;
        }
        pay = inserted;
      }

      // Si está pagado, activar estudiante
      if (sta === 'paid') {
        await supabase.from('students').update({ is_active: true, status: 'activo' }).eq('id', sid);
      }

      Helpers.toast('Pago registrado correctamente', 'success');
      UIHelpers.closeModal();
      await this.loadPayments();
      this.loadStats();
      this.loadIncomeChart();

      if (pay?.id && sta === 'paid') {
        DirectorApi.sendPaymentReceipt(pay.id).catch(() => {});
        try {
          const { data: p } = await DirectorApi.getPaymentById(pay.id);
          if (p) {
            const { notifyPaymentApproved } = await import('../shared/supabase.js');
            const email = p.students?.p1_email || p.students?.p2_email || null;
            const amountStr = 'RD$' + Number(amt).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            await notifyPaymentApproved(pay.id, email, p.students?.name || 'Estudiante', amountStr, mp || 'Colegiatura');
          }
        } catch (_) {}
      }
    } catch (e) {
      console.error('[Payments] saveManualPayment error:', e);
      Helpers.toast('Error al guardar: ' + (e.message || 'Error desconocido'), 'error');
    } finally {
      UIHelpers.setLoading(false, '#modalPayment');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Registrar Pago'; }
    }
  },

  async markPaid(id) {
    try {
      Helpers.vibrate('success');
      // Aprobar directamente — funciona para efectivo y transferencia sin depender de RPC
      const { error } = await supabase.from('payments')
        .update({ status: 'paid', paid_date: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;

      // Obtener datos del pago para notificar y activar estudiante
      const { data: pay } = await supabase.from('payments')
        .select('student_id, amount, month_paid, students:student_id(name, p1_email, p2_email)')
        .eq('id', id).single();

      // Activar estudiante al aprobar pago
      if (pay?.student_id) {
        await supabase.from('students')
          .update({ is_active: true, status: 'activo' })
          .eq('id', pay.student_id);
      }

      Helpers.toast('Pago aprobado correctamente', 'success');
      await this.loadPayments();
      this.loadStats();

      // Notificar al padre en background
      if (pay) {
        try {
          const { notifyPaymentApproved } = await import('/js/shared/supabase.js');
          const emails = [pay.students?.p1_email, pay.students?.p2_email].filter(e => e && e.includes('@'));
          const amountStr = 'RD$' + Number(pay.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          await notifyPaymentApproved(id, emails[0] || null, pay.students?.name || 'Estudiante', amountStr, pay.month_paid || 'Colegiatura');
        } catch (_) {}
      }
    } catch (e) {
      Helpers.toast('Error al aprobar pago: ' + (e.message || e), 'error');
    }
  },

  async delete(id) {
    if (!confirm('¿Eliminar este registro de pago?\n\nEsta acción quedará registrada en el historial de auditoría.')) return;
    try {
      // Usar RPC seguro (soft delete + auditoría)
      const { data, error } = await supabase.rpc('delete_payment', { 
        p_payment_id: id,
        p_reason: 'Eliminado desde el panel de Directora'
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      Helpers.toast('Pago eliminado', 'success');
      await this.loadPayments();
    } catch (e) {
      Helpers.toast('Error al eliminar: ' + (e.message || e), 'error');
    }
  },

  async showCyclePreview() {
    Helpers.showLoader('Calculando resumen del ciclo...');
    try {
      // ✅ OBTENCIÓN DE DATOS DESDE EL SERVIDOR (RPC)
      // Centraliza la lógica de previsualización para que coincida con la ejecución real
      const { data, error } = await supabase.rpc('preview_payment_cycle');
      if (error) throw error;

      const { count, total_amount, grace_count, existing_count, target_month_label } = data;

      Helpers.hideLoader();

      window.openGlobalModal(`
        <div class="bg-white rounded-[2.5rem] overflow-hidden shadow-2xl animate-scaleIn w-full max-w-md">
          <div class="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white text-center">
            <div class="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-4 text-3xl shadow-lg backdrop-blur-md">📅</div>
            <h3 class="text-2xl font-black">Resumen del Ciclo</h3>
            <p class="text-indigo-100 font-bold uppercase tracking-widest text-[10px] mt-1">Periodo: ${target_month_label}</p>
          </div>
          
          <div class="p-8 space-y-6 bg-slate-50/50">
            <div class="grid grid-cols-2 gap-4">
              <div class="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Nuevos Cobros</p>
                <p class="text-2xl font-black text-indigo-600">${count}</p>
              </div>
              <div class="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Total Estimado</p>
                <p class="text-xl font-black text-slate-700">RD$${Helpers.formatCurrency(total_amount)}</p>
              </div>
            </div>

            <div class="space-y-3">
              <div class="flex items-center justify-between text-sm">
                <span class="text-slate-500 font-medium">En Periodo de Gracia</span>
                <span class="font-black text-amber-600">${grace_count}</span>
              </div>
              <div class="flex items-center justify-between text-sm">
                <span class="text-slate-500 font-medium">Ya generados</span>
                <span class="font-black text-emerald-600">${existing_count}</span>
              </div>
            </div>

            <div class="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
              <p class="text-[10px] text-indigo-700 font-bold leading-relaxed">
                ℹ️ Los cobros se generan automáticamente para estudiantes activos. La fecha de vencimiento será el día ${this.settings.due_day} del mes próximo.
              </p>
            </div>
          </div>

          <div class="p-6 bg-white border-t border-slate-100 flex gap-3">
            <button onclick="App.ui.closeModal()" class="flex-1 py-4 text-slate-400 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
            <button id="confirmRunCycle" class="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-indigo-100 active:scale-95 transition-all">Confirmar y Ejecutar</button>
          </div>
        </div>
      `);

      document.getElementById('confirmRunCycle')?.addEventListener('click', () => {
        UIHelpers.closeModal();
        this.runCycle();
      });

    } catch (e) {
      Helpers.hideLoader();
      Helpers.toast('Error al calcular resumen: ' + e.message, 'error');
    }
  },

  async runCycle() {
    try {
      Helpers.showLoader('Generando cobros en el servidor...');
      
      // ✅ EJECUCIÓN 100% SERVIDOR (RPC)
      // Centraliza la lógica de redondeo, duplicados y periodo de gracia en Postgres
      const { data, error } = await supabase.rpc('run_payment_cycle');
      
      Helpers.hideLoader();

      if (error) throw error;

      const gen = data?.generated || 0;
      const exp = data?.expired || 0;

      if (gen > 0) {
        Helpers.vibrate('success');
        Helpers.toast(`✅ ¡Ciclo completado! Se generaron ${gen} cobros.`, 'success');
        if (window.confetti) confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      } else if (exp > 0) {
        Helpers.toast(`ℹ️ Se marcaron ${exp} pago(s) como vencidos. No se generaron nuevos cobros.`, 'info');
      } else {
        Helpers.toast('ℹ️ El ciclo ya está al día. No se requirieron acciones.', 'info');
      }

      await this.loadPayments();
      this.loadStats();

    } catch (e) {
      Helpers.hideLoader();
      console.error('[Payments] runCycle error:', e);
      Helpers.toast('Error crítico en el servidor: ' + (e.message || 'Consulta al administrador'), 'error');
    }
  },

  /**
   * Quitar mora a un pago específico
   */
  async waiveMora(id) {
    const reason = prompt('Motivo de la exoneración de mora (requerido):');
    if (reason === null) return; // cancelado
    if (!reason || reason.trim().length < 3) {
      Helpers.toast('Ingresa un motivo válido', 'warning');
      return;
    }
    try {
      const { data, error } = await supabase.rpc('waive_payment_mora', {
        p_payment_id: id,
        p_reason: reason.trim()
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      Helpers.toast('Mora eliminada correctamente', 'success');
      await this.loadPayments();
    } catch (e) {
      Helpers.toast('Error al quitar mora: ' + (e.message || e), 'error');
    }
  },

  /**
   * 🔧 sendReminders — Llamada delegada a Edge Function
   * 
   * ✅ Ventajas:
   *  - Procesamiento en servidor (no congela navegador)
   *  - Manejo seguro de lotes grandes
   *  - Reintentos automáticos en caso de falla
   *  - Auditoría en el servidor
   * 
   * Nota: La Edge Function 'payment-reminders' puede configurarse como cron automático
   */
  async sendReminders() {
    if (!confirm('¿Enviar recordatorios de pago ahora?\n\nEsta acción se procesará en el servidor y puede tomar unos minutos.')) return;
    const btn = document.getElementById('btnSendPaymentReminders');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No autenticado');

      // Llamar a la Edge Function payment-reminders que gestiona todo en el servidor
      const { data, error } = await supabase.functions.invoke('payment-reminders', {
        body: { action: 'send_all' }
      });

      if (error) throw error;

      // Respuesta esperada: { processed, reminder_3d, due_today, overdue_1d, emails_sent, pushes_sent }
      const results = data || {};
      const processed = results.processed || 0;
      const total = (results.reminder_3d || 0) + (results.due_today || 0) + (results.overdue_1d || 0) || processed;

      if (processed === 0 && total === 0) {
        Helpers.toast('No hay pagos pendientes o vencidos este mes', 'info');
      } else if (processed > 0 && (results.emails_sent || 0) === 0 && (results.pushes_sent || 0) === 0) {
        Helpers.toast(`⚠️ ${processed} pago(s) encontrados pero los estudiantes no tienen correo ni notificaciones configuradas`, 'warning');
      } else {
        const msg = `✅ ${processed} recordatorio(s) procesados\n📧 ${results.emails_sent || 0} correos enviados\n🔔 ${results.pushes_sent || 0} notificaciones push`;
        Helpers.toast(msg, 'success');

        // Auditar la acción
        await auditLog('payment_reminders_sent', {
          processed,
          emails_sent: results.emails_sent,
          pushes_sent: results.pushes_sent,
          total
        });
      }
    } catch (e) {
      Helpers.toast('Error: ' + (e.message || e), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar recordatorios ahora'; }
    }
  },

  async exportMorosidad() {
    try {
      Helpers.toast('Generando reporte...', 'info');
      const mv = document.getElementById('filterPaymentMonth')?.value;
      const yv = document.getElementById('filterPaymentYear')?.value;
      const monthKey = mv && yv ? `${yv}-${String(mv).padStart(2,'0')}` : null;

      const { data, error } = await supabase.rpc('get_morosidad_report', { p_month: monthKey });
      if (error) throw error;
      if (!data?.length) { Helpers.toast('No hay pagos pendientes para exportar', 'info'); return; }

      const headers = ['Estudiante','Aula','Padre/Madre','Email','Teléfono','Mes','Monto','Estado','Vence','Días vencido'];
      const rows = data.map(r => [
        r.student_name, r.classroom, r.parent_name, r.parent_email, r.parent_phone,
        r.month_paid, r.amount, r.status, r.due_date, r.days_overdue
      ]);
      const csv = [headers, ...rows].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `morosidad_${monthKey || 'todos'}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      Helpers.toast(`Reporte exportado: ${data.length} registros`, 'success');
    } catch (e) {
      Helpers.toast('Error al exportar: ' + (e.message || e), 'error');
    }
  },

  async savePaymentConfig() {
    const g = parseInt(document.getElementById('confGenDay')?.value || 25);
    const d = parseInt(document.getElementById('confDueDay')?.value || 5);
    const phone = document.getElementById('confPhone')?.value?.trim();
    const hours = document.getElementById('confHours')?.value?.trim();

    if (isNaN(g) || g < 1 || g > 28) return Helpers.toast('Dia generacion invalido (1-28)', 'warning');
    if (isNaN(d) || d < 1 || d > 28) return Helpers.toast('Dia limite invalido (1-28)', 'warning');

    try {
      await supabase.from('school_settings').upsert({ 
        id: 1, 
        generation_day: g, 
        due_day: d, 
        phone: phone,
        business_hours: hours,
        updated_at: new Date().toISOString() 
      });
      this.settings.generation_day = g;
      this.settings.due_day = d;
      Helpers.toast('Configuracion guardada', 'success');
    } catch (e) { Helpers.toast('Error: ' + e.message, 'error'); }
  }
};
