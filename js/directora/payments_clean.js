import { DirectorApi } from './api.js';
import { AppState } from './state.js';
import { Helpers } from '/js/shared/helpers.js';
import { UIHelpers } from './ui.module.js';
import { supabase } from '/js/shared/supabase.js';
import { MES, MES_LABEL } from '/js/shared/payment-service.js';
import { SchoolEngine } from '/js/shared/school-engine.js';

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
      on('filterPaymentMonth',    'change', () => { this._saveFilters(); this.loadPayments(); });
      on('filterPaymentYear',     'change', () => { this._saveFilters(); this.loadPayments(); });
      on('filterPaymentStatus',   'change', () => { this._saveFilters(); this.loadPayments(); });
      on('searchPaymentStudent',  'input',  () => { this._saveFilters(); this.loadPayments(); });
      on('btnNewPayment',         'click',  () => this.openPaymentModal());
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
      if (ms && filters.month && filters.month !== 'all') ms.value = filters.month;
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
      if (g) g.value = this.settings.generation_day;
      if (d) d.value = this.settings.due_day;
      if (p) p.value = data.phone || '';
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

      const monthKey = (yv && mv && mv !== 'all') ? `${yv}-${String(mv).padStart(2,'0')}` : maxVisibleMonthKey;

      const SEL = 'id,student_id,amount,concept,status,due_date,created_at,paid_date,method,bank,reference,month_paid,evidence_url,proof_url,mora_amount,total_due,student_name,classroom_name,original_amount,discount_pct,discount_amount,discount_reason';
      const SEL_LEGACY = 'id,student_id,amount,concept,status,due_date,created_at,paid_date,method,bank,reference,month_paid,evidence_url,proof_url,mora_amount,total_due,student_name,classroom_name';

      const build = (s) => {
        let q = supabase.from('v_payments_with_mora').select(s);
        if (mv === 'all' || !mv) {
          // Todos los meses del año seleccionado
          q = q.gte('month_paid', (yv || currentYear) + '-01')
               .lte('month_paid', maxVisibleMonthKey);
          if (sf && sf !== 'all') q = q.eq('status', sf);
        } else if (sf === 'all') {
          q = q.or(`and(status.eq.overdue,month_paid.lt.${maxVisibleMonthKey}),month_paid.eq.${monthKey}`);
        } else if (sf === 'pending' || sf === 'overdue' || sf === 'review') {
          q = q.eq('status', sf).lte('month_paid', maxVisibleMonthKey);
        } else {
          q = q.eq('month_paid', monthKey);
          if (sf && sf !== 'all') q = q.eq('status', sf);
        }
        return q.order('month_paid', { ascending: false }).order('due_date', { ascending: true });
      };

      let data, error;
      try {
        const r = await build(SEL);
        if (r.error) {
          const r2 = await build(SEL_LEGACY);
          data = r2.data; error = r2.error;
        } else {
          data = r.data; error = null;
        }
      } catch (err_) {
        const r2 = await build(SEL_LEGACY).catch(() => null);
        if (!r2 || r2.error) throw err_;
        data = r2.data; error = null;
      }
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
        const activeMv = (mv && mv !== 'all') ? mv : maxVisibleMonthKey.split('-')[1];
        const monthLabel = MES_LABEL[parseInt(activeMv, 10) - 1]?.toUpperCase() || 'MES SELECCIONADO';
        html += `<tr class="bg-indigo-50/50"><td colspan="8" class="px-5 py-2 text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em] border-y border-indigo-100">\uD83D\uDCC5 ${monthLabel} ${yv || maxVisibleMonthKey.split('-')[0]}</td></tr>`;
        html += currentMonthItems.map(p => this._row(p)).join('');
      }
      if (otherItems.length > 0 && sf !== 'all') {
        html += '<tr class="bg-slate-50/30"><td colspan="8" class="px-5 py-2 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-y border-slate-100">OTROS REGISTROS</td></tr>';
        html += otherItems.map(p => this._row(p)).join('');
      }

      tbody.innerHTML = html;

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
    const discPct = Number(p.discount_pct || 0);
    const origAmt = Number(p.original_amount || 0);
    const hasDisc = discPct > 0 || Number(p.discount_amount || 0) > 0;

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
    const discountBtn = '<button onclick="App.payments.applyDiscount(\'' + p.id + '\')" class="p-1.5 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition-colors" title="Aplicar / quitar descuento"><i data-lucide="badge-percent" class="w-4 h-4"></i></button>';
    const waiveMoraBtn = (mora > 0)
      ? '<button onclick="App.payments.waiveMora(\'' + p.id + '\')" class="p-1.5 bg-violet-50 text-violet-600 rounded-lg hover:bg-violet-100 transition-colors" title="Quitar Mora"><i data-lucide="shield-off" class="w-4 h-4"></i></button>'
      : '';
    const deleteBtn   = '<button onclick="App.payments.delete(\'' + p.id + '\')" class="p-1.5 bg-rose-50 text-rose-500 rounded-lg hover:bg-rose-100 transition-colors" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>';
    const voucherUrl = p.evidence_url || p.proof_url;
    const voucherCell = voucherUrl
      ? '<a href="' + voucherUrl + '" target="_blank" rel="noopener noreferrer" class="group inline-flex flex-col items-center gap-1" title="Ver comprobante / foto del pago">' +
          '<span class="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center">' +
            '<img src="' + voucherUrl + '" alt="Comprobante" class="w-full h-full object-cover group-hover:scale-105 transition-transform">' +
          '</span>' +
        '</a>'
      : '<span class="text-slate-300 text-xs">-</span>';

    return '<tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors' + (sk === 'overdue' ? ' bg-rose-50/20' : '') + '" data-id="' + p.id + '">' +
      '<td class="px-6 py-3.5"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm flex-shrink-0">' + Helpers.escapeHTML((stu.name || '?').charAt(0).toUpperCase()) + '</div><div><div class="font-bold text-slate-800 text-sm">' + Helpers.escapeHTML(stu.name || '-') + '</div><div class="text-[10px] text-slate-400 font-bold uppercase">' + (stu.classrooms?.name || 'Sin aula') + '</div></div></div></td>' +
      '<td class="px-6 py-3.5 text-center"><span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ' + st.c + '"><i data-lucide="' + st.i + '" class="w-3 h-3"></i>' + st.l + '</span></td>' +
      '<td class="px-6 py-3.5 text-right">' +
      (hasDisc && origAmt > 0 ? '<div class="text-[9px] font-black text-slate-400 line-through">' + 'RD$' + origAmt.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</div>' : '') +
      '<div class="font-black text-slate-800">' + af + '</div>' +
      (hasDisc ? '<span class="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 bg-amber-50 border border-amber-200 rounded-full text-[9px] font-black text-amber-700 uppercase" title="Descuento ' + (p.discount_reason || '') + '"><i data-lucide="badge-percent" class="w-2.5 h-2.5"></i> -' + discPct + '%</span>' : '') +
      (ip ? '<div class="flex flex-col items-end gap-0.5 mt-0.5">' + ub + '</div>' : '') + '</td>' +
      '<td class="px-6 py-3.5"><span class="text-[10px] font-black uppercase text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">' + (p.method || '-') + '</span></td>' +
      '<td class="px-6 py-3.5"><div class="text-[10px] font-bold text-slate-600 uppercase truncate max-w-[120px]">' + Helpers.escapeHTML(p.bank || '-') + '</div><div class="text-[9px] text-slate-400 font-bold">' + Helpers.escapeHTML(p.reference || '') + '</div></td>' +
      '<td class="px-6 py-3.5"><div class="text-[11px] font-bold text-slate-700">' + (p.paid_date ? new Date(p.paid_date).toLocaleDateString('es-ES') : ds) + '</div><div class="text-[9px] text-slate-400 font-bold uppercase">' + (p.paid_date ? 'Pagado' : 'Vence') + '</div></td>' +
      '<td class="px-6 py-3.5 text-center">' + voucherCell + '</td>' +
      '<td class="px-6 py-3.5 text-center"><div class="flex justify-center gap-1.5">' + discountBtn + approveBtn + waiveMoraBtn + deleteBtn + '</div></td>' +
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
        Helpers.setTxt('kpiIncomeMonth', '$0.00');
        Helpers.setTxt('kpiPendingCount', '0');
        Helpers.setTxt('kpiOverdueCount', '0');
        Helpers.setTxt('kpiReviewCount', '0');
        return;
      }

      // Si no hay mv/yv (inicio), usar los de maxVisibleMonthKey
      const [defY, defM] = maxVisibleMonthKey.split('-');
      const { data } = await DirectorApi.getPaymentStats(mv || defM, yv || defY);

      if (!data) return;
      Helpers.setTxt('kpiIncomeMonth', '$' + Number(data.incomeMonth || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 }));
      Helpers.setTxt('kpiPendingCount', data.pending);
      Helpers.setTxt('kpiOverdueCount', data.overdue);
      Helpers.setTxt('kpiReviewCount',  data.toApprove || 0);
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
    const curMonth  = modalDate.getMonth();
    const curYear   = modalDate.getFullYear();
    const genDay    = Number(this.settings.generation_day) || 25;
    // Mes a cobrar por defecto = mes visible del sistema (regla del día de
    // generación): el actual si ya pasó el gen_day; si no, el anterior.
    let tgtMonth = curMonth, tgtYear = curYear;
    if (modalDate.getDate() < genDay) {
      tgtMonth = curMonth === 0 ? 11 : curMonth - 1;
      tgtYear  = curMonth === 0 ? curYear - 1 : curYear;
    }
    // Vencimiento = día due_day del mes siguiente al mes cobrado.
    const dueMonth = tgtMonth + 1 > 11 ? 0 : tgtMonth + 1;
    const dueYear  = tgtMonth + 1 > 11 ? tgtYear + 1 : tgtYear;
    const dd = `${dueYear}-${String(dueMonth + 1).padStart(2,'0')}-${String(this.settings.due_day || 5).padStart(2,'0')}`;
    const mo = MES.map((m, i) => {
      const val = `${tgtYear}-${String(i + 1).padStart(2, '0')}`;
      return '<option value="' + val + '"' + (i === tgtMonth ? ' selected' : '') + '>' + MES_LABEL[i] + '</option>';
    }).join('');

    // Estado del descuento para este registro (base = monto original a cobrar)
    this._disc = { base: 0, pct: 0, amt: 0, reason: '', source: 'pct' };

    window.openGlobalModal(
      '<div class="bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6 rounded-t-3xl flex items-center gap-3">' +
        '<div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">\uD83D\uDCB0</div>' +
        '<div><h3 class="text-xl font-black">Registrar Pago</h3><p class="text-xs text-white/70 font-bold uppercase tracking-widest">Cobro Manual</p></div>' +
      '</div>' +
      '<div class="p-6 bg-slate-50/30" id="modalPayment"><div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
        '<div class="md:col-span-2"><label class="' + lc + '">Estudiante (Pendientes/Vencidos)</label>' +
          '<select id="payStudentSelect" class="' + ic + '"><option value="">-- Cargando... --</option></select>' +
          '<div id="payStudentInfo" class="mt-2 hidden p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-700"></div>' +
        '</div>' +
        '<div><label class="' + lc + '">Monto ($)</label><input id="payAmount" type="number" step="0.01" min="0" class="' + ic + '" placeholder="0.00"></div>' +
        '<div><label class="' + lc + '">Concepto</label><input id="payConcept" type="text" class="' + ic + '" value="Mensualidad"></div>' +
        '<div class="md:col-span-2">' +
          '<button type="button" id="payToggleDiscount" class="w-full px-4 py-2.5 border-2 border-dashed border-amber-300 bg-amber-50/60 text-amber-700 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 hover:bg-amber-50 transition-all active:scale-[0.98]">' +
            '<i data-lucide="badge-percent" class="w-4 h-4"></i> Aplicar Descuento' +
          '</button>' +
          '<div id="payDiscountSection" class="hidden mt-3 p-4 bg-white border border-amber-200 rounded-2xl space-y-3">' +
            '<div class="grid grid-cols-2 gap-3">' +
              '<div><label class="' + lc + '">Porcentaje (%)</label><input id="payDiscountPct" type="number" step="0.01" min="0" max="100" class="' + ic + '" placeholder="10" inputmode="decimal"></div>' +
              '<div><label class="' + lc + '">Descuento (RD$)</label><input id="payDiscountAmount" type="number" step="0.01" min="0" class="' + ic + '" placeholder="0.00" inputmode="decimal"></div>' +
            '</div>' +
            '<div><label class="' + lc + '">Motivo del descuento</label><input id="payDiscountReason" type="text" class="' + ic + '" placeholder="Ej: Becado, pronto pago, acuerdo especial..."></div>' +
            '<div id="payDiscountPreview" class="p-2.5 bg-amber-50 border border-amber-100 rounded-xl text-[11px] font-bold text-amber-700"></div>' +
          '</div>' +
        '</div>' +
        '<div><label class="' + lc + '">Mes que se cobra</label><select id="payMonthPaid" class="' + ic + '">' + mo + '</select></div>' +
        '<div><label class="' + lc + '">Fecha Limite</label><input id="payDueDate" type="date" class="' + ic + '" value="' + dd + '"></div>' +
        '<div><label class="' + lc + '">Metodo</label><select id="payMethod" class="' + ic + '"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select></div>' +
        '<div><label class="' + lc + '">Estado</label><select id="payStatus" class="' + ic + '"><option value="paid">Pagado</option><option value="pending" selected>Pendiente</option></select></div>' +
        '<div><label class="' + lc + '">Monto Dado / Efectivo ($)</label><input id="payTendered" type="number" step="0.01" min="0" class="' + ic + '" placeholder="0.00" inputmode="decimal"></div>' +
        '<div><label class="' + lc + '">Devuelta ($)</label><input id="payChange" type="text" class="' + ic + '" readonly placeholder="0.00" style="background:#f1f5f9;font-weight:800;color:#334155;"></div>' +
      '</div>' +
      '<div id="payChangeAlert" class="hidden px-6 py-3 text-xs font-black text-rose-600 bg-rose-50 border-t border-rose-100"></div>' +
      '</div>' +
      '<div class="bg-white p-5 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">' +
        '<button onclick="App.ui.closeModal()" class="px-6 py-2.5 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl">Cancelar</button>' +
        '<button id="btnPrintInvoiceAction" class="px-6 py-2.5 bg-white text-indigo-600 border-2 border-indigo-200 rounded-2xl font-black text-xs uppercase hover:bg-indigo-50 transition-all">Imprimir Factura</button>' +
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

        // Devuelta = montoDado - monto (en tiempo real)
        const recalcChange = () => {
          const amt = parseFloat(document.getElementById('payAmount')?.value || 0);
          const tend = parseFloat(document.getElementById('payTendered')?.value || 0);
          const chgInput = document.getElementById('payChange');
          const alertBox = document.getElementById('payChangeAlert');
          if (chgInput) {
            const chg = tend - amt;
            chgInput.value = (chg > 0 ? chg : 0).toFixed(2);
            chgInput.style.color = chg < 0 ? '#dc2626' : '#16a34a';
          }
          if (alertBox) {
            const isCash = (document.getElementById('payMethod')?.value || 'efectivo') === 'efectivo';
            if (isCash && tend > 0 && tend < amt) {
              alertBox.classList.remove('hidden');
              alertBox.textContent = 'El monto dado es menor al total (' + 'RD$' + amt.toFixed(2) + '). Falta: RD$' + (amt - tend).toFixed(2);
            } else {
              alertBox.classList.add('hidden');
            }
          }
        };
        ['payAmount', 'payTendered', 'payMethod'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.addEventListener('input', recalcChange);
        });

        // Auto-fill monto + mora al seleccionar estudiante
        select.addEventListener('change', (e) => {
          const opt = e.target.selectedOptions[0];
          if (!opt?.value) {
            document.getElementById('payStudentInfo')?.classList.add('hidden');
            return;
          }
          // Los estudiantes listados estan pendientes/vencidos → Estado por defecto "Pendiente"
          const statusSel = document.getElementById('payStatus');
          if (statusSel) statusSel.value = 'pending';
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

          // Reiniciar el estado del descuento para este estudiante
          this._baseTotal = total > 0 ? total : 0;
          this._disc.base   = this._baseTotal;
          this._disc.pct    = 0;
          this._disc.amt    = 0;
          this._disc.reason = '';
          this._disc.source = 'pct';
          const pdPct  = document.getElementById('payDiscountPct');
          const pdAmt  = document.getElementById('payDiscountAmount');
          const pdPrev = document.getElementById('payDiscountPreview');
          if (pdPct) pdPct.value = '';
          if (pdAmt) pdAmt.value = '';
          if (pdPrev) pdPrev.textContent = '';

          // Mostrar info de mora si aplica
          if (infoDiv) {
            if (mora > 0) {
              infoDiv.classList.remove('hidden');
              infoDiv.innerHTML = `Mensualidad: RD$${fee.toFixed(2)} + Mora: RD$${mora.toFixed(2)} = <strong>Total: RD$${total.toFixed(2)}</strong>`;
            } else {
              infoDiv.classList.add('hidden');
            }
          }

          recalcChange();

          // Sincronizar mes del pago → siempre mes actual
          const nowSel = new Date();
          const currentMonth = String(nowSel.getMonth() + 1).padStart(2, '0');
          if (monthSelect) {
            const opt2 = monthSelect.querySelector(`option[value="${currentMonth}"]`);
            if (opt2) monthSelect.value = currentMonth;
          }

          // Sincronizar fecha límite → día due_day del mes siguiente al mes cobrado
          const dueDateInput = document.getElementById('payDueDate');
          const mpVal = monthSelect?.value || '';
          if (dueDateInput) {
            if (/^\d{4}-\d{2}$/.test(mpVal)) {
              const [my, mm] = mpVal.split('-').map(Number);
              const dm = mm === 12 ? 1 : mm + 1;
              const dy = mm === 12 ? my + 1 : my;
              dueDateInput.value = `${dy}-${String(dm).padStart(2, '0')}-${String(this.settings.due_day || 5).padStart(2, '0')}`;
            } else {
              dueDateInput.value = dd;
            }
          }
        });

        // ── Descuento en el registro de pago (aplica % y/o RD$ automáticamente) ──
        const discSection   = document.getElementById('payDiscountSection');
        const discPctEl     = document.getElementById('payDiscountPct');
        const discAmtEl     = document.getElementById('payDiscountAmount');
        const discReasonEl  = document.getElementById('payDiscountReason');
        const discPrevEl    = document.getElementById('payDiscountPreview');
        const discBtn       = document.getElementById('payToggleDiscount');

        const recalcDiscount = () => {
          const base = this._disc.base || 0;
          if (!base) return;
          if (this._disc.source === 'amt') {
            this._disc.amt = Math.max(0, Math.min(parseFloat(discAmtEl?.value || 0) || 0, base));
            this._disc.pct = base > 0 ? +(this._disc.amt / base * 100).toFixed(2) : 0;
            if (discPctEl) discPctEl.value = this._disc.pct > 0 ? this._disc.pct : '';
          } else {
            this._disc.pct = Math.max(0, Math.min(parseFloat(discPctEl?.value || 0) || 0, 100));
            this._disc.amt = +(base * this._disc.pct / 100).toFixed(2);
            if (discAmtEl) discAmtEl.value = this._disc.amt > 0 ? this._disc.amt : '';
          }
          const net = Math.max(0, +(base - this._disc.amt).toFixed(2));
          const amtInput = document.getElementById('payAmount');
          if (amtInput) amtInput.value = net.toFixed(2);
          if (discPrevEl) {
            discPrevEl.textContent = this._disc.amt > 0
              ? 'Original: RD$' + base.toFixed(2) + '  →  Descuento: -RD$' + this._disc.amt.toFixed(2) + '  →  A cobrar: RD$' + net.toFixed(2)
              : 'Sin descuento aplicado';
          }
          recalcChange();
        };

        const resetDiscount = () => {
          this._baseTotal = this._baseTotal || 0;
          this._disc.base = this._baseTotal;
          this._disc.pct = 0; this._disc.amt = 0; this._disc.reason = '';
          if (discPctEl) discPctEl.value = '';
          if (discAmtEl) discAmtEl.value = '';
          if (discReasonEl) discReasonEl.value = '';
          if (discPrevEl) discPrevEl.textContent = '';
          const amtInput = document.getElementById('payAmount');
          if (amtInput && this._baseTotal > 0) amtInput.value = this._baseTotal.toFixed(2);
          recalcChange();
        };

        discBtn?.addEventListener('click', () => {
          if (!discSection) return;
          const willHide = !discSection.classList.contains('hidden');
          discSection.classList.toggle('hidden');
          if (willHide) {
            resetDiscount();
            discBtn.innerHTML = '<i data-lucide="badge-percent" class="w-4 h-4"></i> Aplicar Descuento';
          } else {
            if (this._disc.base <= 0) this._disc.base = this._baseTotal || 0;
            this._disc.source = 'pct';
            recalcDiscount();
            discBtn.innerHTML = '<i data-lucide="badge-percent" class="w-4 h-4"></i> Ocultar Descuento';
          }
          if (window.lucide) lucide.createIcons();
        });

        discPctEl?.addEventListener('focus', () => { this._disc.source = 'pct'; });
        discPctEl?.addEventListener('input', () => { this._disc.source = 'pct'; recalcDiscount(); });
        discAmtEl?.addEventListener('focus', () => { this._disc.source = 'amt'; });
        discAmtEl?.addEventListener('input', () => { this._disc.source = 'amt'; recalcDiscount(); });
        discReasonEl?.addEventListener('input', () => { this._disc.reason = discReasonEl.value.trim(); });
        document.getElementById('payMonthPaid')?.addEventListener('change', () => {
          const mpVal = document.getElementById('payMonthPaid')?.value || '';
          const dueDateInput = document.getElementById('payDueDate');
          if (dueDateInput && /^\d{4}-\d{2}$/.test(mpVal)) {
            const [my, mm] = mpVal.split('-').map(Number);
            const dm = mm === 12 ? 1 : mm + 1;
            const dy = mm === 12 ? my + 1 : my;
            dueDateInput.value = `${dy}-${String(dm).padStart(2, '0')}-${String(this.settings.due_day || 5).padStart(2, '0')}`;
          }
        });

        if (prefillStudentId) select.dispatchEvent(new Event('change'));
      }
    } catch (_) {}

    document.getElementById('btnSavePaymentAction')?.addEventListener('click', () => this.saveManualPayment());
    document.getElementById('btnPrintInvoiceAction')?.addEventListener('click', () => this._printInvoiceFromModal());
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
    const tendered = parseFloat(document.getElementById('payTendered')?.value || 0) || 0;

    // Descuento aplicado en el registro (si se activó la sección)
    const hasDisc    = this._disc && Number(this._disc.amt || 0) > 0;
    const discountAmt = hasDisc ? Number(this._disc.amt) : 0;
    const discountPct = hasDisc ? Number(this._disc.pct || 0) : 0;
    const discountReason = hasDisc ? (this._disc.reason || 'Descuento') : null;
    const originalAmt = hasDisc && Number(this._disc.base || 0) > 0 ? Number(this._disc.base) : null;

    if (!sid) return Helpers.toast('Selecciona un estudiante', 'warning');
    if (!amt || amt <= 0) return Helpers.toast('Ingresa un monto valido', 'warning');
    if ((met === 'efectivo') && sta === 'paid' && tendered <= 0) return Helpers.toast('Ingresa el monto dado en efectivo', 'warning');
    if ((met === 'efectivo') && tendered > 0 && tendered < amt) return Helpers.toast('El monto dado no cubre el total', 'warning');

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
          original_amount: originalAmt, discount_pct: discountPct, discount_amount: discountAmt, discount_reason: discountReason,
          updated_at: new Date().toISOString()
        }).eq('id', existing.id).select().single();
        if (upErr) throw upErr;
        pay = updated;
      } else {
        const { data: inserted, error: insErr } = await supabase.from('payments').insert({
          student_id: sid, amount: amt, concept: con, method: met, status: sta,
          month_paid: mp, due_date: dd || null, paid_date: pd,
          original_amount: originalAmt, discount_pct: discountPct, discount_amount: discountAmt, discount_reason: discountReason,
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
          const studentName = p?.students?.name || 'Estudiante';
          const parentEmail = p?.students?.p1_email || p?.students?.p2_email || null;
          const amountStr = 'RD$' + Number(amt).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

          // Construir y enviar la factura (PDF) como adjunto
          try {
            const { buildFactura } = await import('../shared/factura.js');
            const when = new Date();
            const parentName = p?.students?.p1_name || p?.students?.p2_name || null;
            const built = await buildFactura(p, {
              student: p?.students || {},
              parent: { name: parentName, email: parentEmail, phone: (p?.students?.p1_phone || p?.students?.p2_phone || '') },
              amount: amt,
              subtotal: originalAmt || amt,
              descuento: discountAmt,
              recargo: 0,
              total: amt,
              tendered,
              change: Math.max(0, tendered - amt),
              month: mp || 'Colegiatura',
              method: met,
              concept: con,
              dueDate: dd || null,
              paidDate: when.toISOString(),
              status: sta,
              approvedBy: 'Administración Karpus Kids',
              note: 'Pagado desde el panel de la Directora.'
            });
            const { sendEmail } = await import('../shared/supabase.js');
            if (parentEmail && built?.pdfBase64) {
              await sendEmail(
                parentEmail,
                'Factura de Pago - ' + (mp || 'Colegiatura') + ' · ' + built.data.receiptNo,
                await this._buildReceiptEmailHTML(studentName, built.data.total, mp || 'Colegiatura', built.data.receiptNo),
                'Adjuntamos la factura de tu pago registrado.',
                [{ filename: 'Factura-' + built.data.receiptNo + '.pdf', content: built.pdfBase64 }]
              ).catch(() => {});
            }
          } catch (pdfErr) {
            console.warn('[Payments] No se pudo enviar factura PDF:', pdfErr);
          }

          const { notifyPaymentApproved } = await import('../shared/supabase.js');
          await notifyPaymentApproved(pay.id, parentEmail, studentName, amountStr, mp || 'Colegiatura');
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

  // Requiere las librerías de la factura (jsPDF, autotable, QR)
  async _ensureFacturaLibs() {
    try {
      const { loadFacturaLibs } = await import('../shared/factura.js');
      return await loadFacturaLibs();
    } catch (_) { return false; }
  },

  // Imprime la factura del estudiante/monto seleccionados en el modal (formato oficial)
  async _printInvoiceFromModal() {
    try {
      const select = document.getElementById('payStudentSelect');
      const opt = select?.selectedOptions?.[0];
      if (!opt?.value) return Helpers.toast('Selecciona un estudiante', 'warning');

      const { printFactura, getActivePeriodLabel } = await import('../shared/factura.js');
      const sid = opt.value;
      const amt = parseFloat(document.getElementById('payAmount')?.value || opt.dataset.fee || 0);
      const month = document.getElementById('payMonthPaid')?.value || opt.dataset.month || null;
      const due = document.getElementById('payDueDate')?.value || opt.dataset.due || null;

      const { data: s } = await supabase
        .from('students')
        .select('name, last_name, matricula, birth_date, age, age_type, p1_name, p2_name, p1_phone, p2_phone, p1_email, p2_email, classrooms:classroom_id(name)')
        .eq('id', sid)
        .single();

      const period = await getActivePeriodLabel();
      await printFactura({}, {
        student: s || {},
        parent: { name: (s?.p1_name || s?.p2_name || null), email: (s?.p1_email || s?.p2_email || null), phone: (s?.p1_phone || s?.p2_phone || '') },
        amount: amt,
        subtotal: (this._disc?.amt > 0 && this._disc?.base > 0) ? this._disc.base : amt,
        descuento: this._disc?.amt > 0 ? this._disc.amt : 0,
        recargo: 0,
        total: amt,
        tendered: 0,
        change: 0,
        month: month || 'Colegiatura',
        method: 'efectivo',
        concept: document.getElementById('payConcept')?.value?.trim() || 'Mensualidad',
        dueDate: due || null,
        status: 'pending',
        period,
        approvedBy: 'Administración Karpus Kids'
      });
    } catch (e) {
      console.error('[Payments] _printInvoiceFromModal error:', e);
      Helpers.toast('No se pudo generar la factura', 'error');
    }
  },

  // HTML del correo de confirmación con la factura adjunta
  async _buildReceiptEmailHTML(studentName, total, month, receiptNo) {
    const { fmtRD } = await import('../shared/factura.js');
    return '<div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px;border-radius:14px;max-width:480px">' +
      '<div style="background:#141c30;color:#fff;padding:18px;border-radius:12px;font-weight:800;font-size:17px">Karpus Kids</div>' +
      '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;margin-top:12px">' +
      '<p style="margin:0 0 12px;color:#0f172a;font-size:14px;font-weight:700">Hola ' + studentName + ',</p>' +
      '<p style="margin:0 0 12px;color:#475569;font-size:13px;line-height:1.5">Registramos tu pago por la colegiatura y te enviamos la factura oficial adjunta.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<tr><td style="padding:6px 0;color:#64748b">Periodo</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a">' + month + '</td></tr>' +
        '<tr><td style="padding:6px 0;color:#64748b">Total pagado</td><td style="padding:6px 0;text-align:right;font-weight:800;color:#16a34a">' + fmtRD(total) + '</td></tr>' +
      '</table>' +
      '<p style="margin:14px 0 0;font-size:11px;color:#94a3b8">Recibo: ' + (receiptNo || '—') + '</p>' +
      '</div></div>';
  },

  async applyDiscount(id) {
    const p = (AppState.get('paymentsData') || []).find(x => String(x.id) === String(id));
    if (!p) return Helpers.toast('Pago no encontrado', 'warning');

    const orig  = Number(p.original_amount || p.amount || 0);
    const cur   = Number(p.amount || 0);
    const curP  = Number(p.discount_pct || 0);
    const saved = Math.max(0, (orig - cur).toFixed(2));

    const ic = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-bold text-slate-700';
    const lc = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';
    const inputCls = 'w-full px-4 py-2.5 border-2 rounded-2xl outline-none focus:ring-4 transition-all text-sm font-bold';

    window.openGlobalModal(
      '<div class="bg-gradient-to-r from-amber-500 to-orange-500 text-white p-6 rounded-t-3xl flex items-center gap-3">' +
        '<div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center"><i data-lucide="badge-percent" class="w-7 h-7"></i></div>' +
        '<div><h3 class="text-xl font-black">Aplicar Descuento</h3><p class="text-xs text-white/70 font-bold uppercase tracking-widest">Mensualidad · ' + Helpers.escapeHTML(p.student_name || 'Estudiante') + '</p></div>' +
      '</div>' +
      '<div class="p-6 bg-slate-50/30 space-y-4" id="discModalBody">' +
        '<div class="p-4 bg-white rounded-2xl border border-slate-100 grid grid-cols-3 gap-3 text-center">' +
          '<div><div class="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Monto Original</div><div class="font-black text-slate-700 text-sm" id="discOrig">' + Helpers.formatCurrency(orig) + '</div></div>' +
          '<div><div class="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Desc. Actual</div><div class="font-black text-teal-600 text-sm">' + (curP > 0 ? '-' + curP + '% ' : '') + Helpers.formatCurrency(saved) + '</div></div>' +
          '<div><div class="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Nuevo Total</div><div class="font-black text-emerald-600 text-sm" id="discNew">' + Helpers.formatCurrency(cur) + '</div></div>' +
        '</div>' +
        '<div class="grid grid-cols-2 gap-3">' +
          '<button id="discModePct" class="px-3 py-2 rounded-xl bg-amber-500 text-white font-black text-xs uppercase active:scale-95 transition-all">Porcentaje %</button>' +
          '<button id="discModeFixed" class="px-3 py-2 rounded-xl bg-slate-100 text-slate-500 font-black text-xs uppercase hover:bg-slate-200 active:scale-95 transition-all">Monto Fijo RD$</button>' +
        '</div>' +
        '<div>' +
          '<label id="discValueLabel" class="' + lc + '">Porcentaje a aplicar (%)</label>' +
          '<input id="discValue" type="number" step="0.01" min="0" max="100" class="' + inputCls + ' border-slate-100 focus:ring-amber-100 focus:border-amber-400 bg-slate-50/50" value="' + curP + '" placeholder="10">' +
        '</div>' +
        '<div>' +
          '<label class="' + lc + '">Motivo del descuento (requerido si aplica)</label>' +
          '<input id="discReason" type="text" class="' + ic + '" placeholder="Ej: Becado, acuerdo especial, pronto pago..." value="' + (p.discount_reason ? Helpers.escapeHTML(p.discount_reason) : '') + '">' +
        '</div>' +
        '<div class="p-3 bg-indigo-50 border border-indigo-100 rounded-2xl text-[11px] font-bold text-indigo-700 flex items-start gap-2">' +
          '<i data-lucide="info" class="w-4 h-4 mt-0.5 flex-shrink-0"></i>' +
          '<span>El descuento aplica a esta mensualidad tanto si se paga en <strong>efectivo</strong> como por <strong>transferencia</strong>, y queda registrado con auditoría.</span>' +
        '</div>' +
      '</div>' +
      '<div class="bg-white p-5 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">' +
        '<button onclick="UIHelpers.closeModal()" class="px-6 py-2.5 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl">Cancelar</button>' +
        '<button id="btnSaveDiscountAction" class="px-8 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-amber-100 active:scale-95">Guardar Descuento</button>' +
      '</div>'
    );

    let mode = 'pct';
    const valueInput = document.getElementById('discValue');
    const newLabel   = document.getElementById('discNew');
    const pctBtn     = document.getElementById('discModePct');
    const fixedBtn   = document.getElementById('discModeFixed');

    const paint = (m) => {
      mode = m;
      pctBtn.className   = 'px-3 py-2 rounded-xl font-black text-xs uppercase active:scale-95 transition-all ' + (m === 'pct' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200');
      fixedBtn.className = 'px-3 py-2 rounded-xl font-black text-xs uppercase active:scale-95 transition-all ' + (m === 'fixed' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200');
      const vLabel = document.getElementById('discValueLabel');
      if (vLabel) vLabel.textContent = m === 'pct' ? 'Porcentaje a aplicar (%)' : 'Monto fijo a descontar (RD$)';
      if (valueInput) { if (m === 'pct') valueInput.max = 100; else valueInput.removeAttribute('max'); }
      if (m === 'pct' && valueInput && !Number(valueInput.dataset.touched)) valueInput.value = curP || '';
    };
    pctBtn?.addEventListener('click', () => paint('pct'));
    fixedBtn?.addEventListener('click', () => { valueInput.dataset.touched = '1'; paint('fixed'); if (valueInput) valueInput.value = saved > 0 ? saved : ''; });

    const preview = () => {
      const v = Math.max(0, parseFloat(valueInput?.value || 0) || 0);
      let disc = mode === 'pct' ? orig * v / 100 : v;
      disc = Math.min(disc, orig);
      const net = Math.max(0, orig - disc);
      if (newLabel) newLabel.textContent = Helpers.formatCurrency(net);
    };
    valueInput?.addEventListener('input', preview);

    document.getElementById('btnSaveDiscountAction')?.addEventListener('click', async () => {
      const v = Math.max(0, parseFloat(valueInput?.value || 0) || 0);
      const reason = (document.getElementById('discReason')?.value || '').trim();
      const isRemove = v === 0;
      if (!isRemove && !reason) return Helpers.toast('Indica el motivo del descuento', 'warning');
      if (mode === 'pct' && v > 100) return Helpers.toast('El porcentaje no puede superar 100%', 'warning');
      const btn = document.getElementById('btnSaveDiscountAction');
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
      try {
        const pct = mode === 'pct' ? v : null;
        const fixed = mode === 'fixed' ? v : null;
        const { data, error } = await supabase.rpc('apply_payment_discount', { p_payment_id: id, p_pct: pct, p_reason: reason, p_fixed: fixed });
        if (error) throw error;
        if (data?.error) return Helpers.toast(data.error, 'error');
        Helpers.toast(isRemove ? 'Descuento eliminado' : 'Descuento aplicado correctamente', 'success');
        UIHelpers.closeModal();
        await this.loadPayments();
        this.loadStats();
      } catch (e) {
        Helpers.toast('Error al aplicar descuento: ' + (e.message || e), 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar Descuento'; }
      }
    });
    if (window.lucide) lucide.createIcons();
  },

  async markPaid(id) {
    try {
      Helpers.vibrate('success');
      // Descuento ANTES de aprobar: si el pago viene en revisión y aún no tiene
      // descuento, ofrecer aplicarlo primero (el monto queda fijo al aprobar).
      const p = (AppState.get('paymentsData') || []).find(x => String(x.id) === String(id));
      const hasDisc = p && (Number(p.discount_pct || 0) > 0 || Number(p.discount_amount || 0) > 0);
      if (p && this._st(p) === 'review' && !hasDisc && window.confirm('Aplicar un descuento antes de aprobar este pago?\n\nOK = abrir descuento · Cancelar = aprobar ahora mismo')) {
        await this.applyDiscount(id);
        return;
      }
      // Usar RPC seguro que valida comprobante antes de aprobar
      const { data, error: rpcError } = await supabase.rpc('approve_payment', {
        p_payment_id: id,
        p_notes: 'Aprobado desde panel de Directora'
      });
      if (rpcError) throw rpcError;
      if (data?.error) throw new Error(data.error);

      // Obtener datos del pago para notificar y activar estudiante
      const { data: pay } = await supabase.from('payments')
        .select('student_id, amount, month_paid, status, students:student_id(name, p1_email, p2_email)')
        .eq('id', id).single();

      // Verificar que la aprobación SÍ persistió (el trigger fn_protect_paid_records
      // con `RETURN OLD` descartaba los UPDATE de pagos no aprobados sin error).
      if (!pay || pay.status !== 'paid') {
        Helpers.toast('No se pudo aprobar: aplica la migración 16 (sección 8) en Supabase SQL Editor y reintenta.', 'error');
        await this.loadPayments();
        this.loadStats();
        return;
      }

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
      const [rpcRes, studentsRes] = await Promise.all([
        supabase.rpc('preview_payment_cycle'),
        supabase.from('students').select('monthly_fee, prolongado_fee').eq('is_active', true).gt('monthly_fee', 0)
      ]);
      if (rpcRes.error) throw rpcRes.error;

      const { count = 0, existing_count = 0 } = rpcRes.data;
      const activeStudents = studentsRes.data || [];
      const totalEstimate = activeStudents.reduce((sum, s) => sum + (s.monthly_fee || 0) + (s.prolongado_fee || 0), 0);

      const activePeriod = SchoolEngine.getActivePeriod();
      const allPeriods = SchoolEngine.getAllPeriods();
      const openPeriod = activePeriod || allPeriods.find(p => p.status === 'open') || allPeriods[0];
      const periodLabel = openPeriod?.name || 'Sin periodo activo';

      const now = new Date();
      const billingMonthLabel = `${MES_LABEL[now.getMonth()]} ${now.getFullYear()}`;

      const grace_count = (count > 0 && existing_count > 0) ? existing_count : 0;

      Helpers.hideLoader();

      window.openGlobalModal(`
        <div class="bg-white rounded-[2.5rem] overflow-hidden shadow-2xl animate-scaleIn w-full max-w-md">
          <div class="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white text-center">
            <div class="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-4 text-3xl shadow-lg backdrop-blur-md">📅</div>
            <h3 class="text-2xl font-black">Resumen del Ciclo</h3>
            <p class="text-indigo-100 font-bold uppercase tracking-widest text-[10px] mt-1">${periodLabel} · ${billingMonthLabel}</p>
          </div>
          
          <div class="p-8 space-y-6 bg-slate-50/50">
            <div class="grid grid-cols-2 gap-4">
              <div class="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Nuevos Cobros</p>
                <p class="text-2xl font-black text-indigo-600">${count}</p>
              </div>
              <div class="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Total Estimado</p>
                <p class="text-xl font-black text-slate-700">RD$${Helpers.formatCurrency(totalEstimate)}</p>
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
                ℹ️ Los cobros se generan automáticamente para ${activeStudents.length} estudiantes activos. La fecha de vencimiento será el día ${this.settings.due_day} del mes siguiente.
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

      if (error) {
        console.error('[Payments] Edge Function error:', error);
        throw new Error(`Error en la función Edge: ${error.message || 'Función no disponible'}\nPor favor verifica que la función 'payment-reminders' esté desplegada en Supabase.`);
      }

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
      }
    } catch (e) {
      console.error('[Payments] sendReminders error:', e);
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

    if (isNaN(g) || g < 1 || g > 28) return Helpers.toast('Dia generacion invalido (1-28)', 'warning');
    if (isNaN(d) || d < 1 || d > 28) return Helpers.toast('Dia limite invalido (1-28)', 'warning');

    try {
      await supabase.from('school_settings').upsert({ 
        id: 1, 
        generation_day: g, 
        due_day: d, 
        phone: phone,
        updated_at: new Date().toISOString() 
      });
      this.settings.generation_day = g;
      this.settings.due_day = d;
      Helpers.toast('Configuracion guardada', 'success');
    } catch (e) { Helpers.toast('Error: ' + e.message, 'error'); }
  }
};
