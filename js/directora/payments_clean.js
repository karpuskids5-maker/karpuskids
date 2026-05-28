import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { UIHelpers } from './ui.module.js';
import { supabase } from '../shared/supabase.js';
import { auditLog } from '../shared/db-utils.js';

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
      on('filterPaymentMonth',    'change', () => this.loadPayments());
      on('filterPaymentYear',     'change', () => this.loadPayments());
      on('filterPaymentStatus',   'change', () => this.loadPayments());
      on('searchPaymentStudent',  'input',  () => this.loadPayments());
      on('btnNewPaymentAction',   'click',  () => this.openPaymentModal());
      on('btnNewPayment',         'click',  () => this.openPaymentModal());
      on('btnGenerateCharges',    'click',  () => this.runCycle());
      on('btnGeneratePaymentsNow','click',  () => this.runCycle());
      on('btnSendPaymentReminders','click', () => this.sendReminders());
      on('btnExportMorosidad',    'click',  () => this.exportMorosidad());
      on('btnSavePaymentConfig',  'click',  () => this.savePaymentConfig());
    }
    await this.loadPayments();
  },

  _initSelectors() {
    const now = new Date();
    const ms = document.getElementById('filterPaymentMonth');
    const ys = document.getElementById('filterPaymentYear');
    if (ms) ms.value = String(now.getMonth() + 1).padStart(2, '0');
    if (ys) ys.value = String(now.getFullYear());
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

      const monthKey = `${yv}-${String(mv).padStart(2,'0')}`;
      const SPANISH_MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      const spanishMonth    = SPANISH_MONTHS[parseInt(mv, 10) - 1];
      const spanishMonthCap = spanishMonth ? spanishMonth.charAt(0).toUpperCase() + spanishMonth.slice(1) : null;
      const SEL = 'id,student_id,amount,concept,status,due_date,created_at,paid_date,method,bank,reference,month_paid,evidence_url,students:student_id(name,classroom_id,classrooms:classroom_id(name))';

      // ── 1. Registros del mes seleccionado ──────────────────────────────
      let q = supabase.from('payments').select(SEL)
        .or(spanishMonthCap
          ? `month_paid.eq.${monthKey},month_paid.eq.${spanishMonthCap},month_paid.ilike.${spanishMonth}`
          : `month_paid.eq.${monthKey}`)
        .order('due_date', { ascending: true });
      if (sf && sf !== 'all') q = q.eq('status', sf);
      let { data, error } = await q;
      if (error) throw error;

      // Fallback por created_at si no hay resultados
      if (!data?.length) {
        const rs = `${yv}-${String(mv).padStart(2,'0')}-01`;
        const re = `${yv}-${String(mv).padStart(2,'0')}-31`;
        let q2 = supabase.from('payments').select(SEL)
          .gte('created_at', rs).lte('created_at', re + 'T23:59:59')
          .order('due_date', { ascending: true });
        if (sf && sf !== 'all') q2 = q2.eq('status', sf);
        const r2 = await q2;
        if (!r2.error && r2.data?.length) data = r2.data;
      }

      // ── 2. Deudas pendientes/vencidas de TODOS los meses anteriores ────
      // Se muestran siempre (sin importar el filtro de mes) para visibilidad total
      let prevDebt = [];
      const showPrev = !sf || sf === 'all' || sf === 'pending' || sf === 'overdue';
      if (showPrev) {
        const { data: prev } = await supabase.from('payments').select(SEL)
          .in('status', ['pending', 'overdue'])
          .lt('month_paid', monthKey)
          .order('month_paid', { ascending: true });
        if (prev?.length) prevDebt = prev;
      }

      // ── 3. Normalización y dedup del mes actual ────────────────────────
      const MMAP = { 'enero':'01','febrero':'02','marzo':'03','abril':'04','mayo':'05','junio':'06','julio':'07','agosto':'08','septiembre':'09','octubre':'10','noviembre':'11','diciembre':'12' };
      const normM = (mp, yr) => {
        if (!mp) return '';
        const s = mp.toLowerCase().trim();
        if (/^\d{4}-\d{2}$/.test(s)) return s;
        const n = MMAP[s]; return n ? `${yr || new Date().getFullYear()}-${n}` : s;
      };
      const sPri = { paid: 4, review: 3, overdue: 2, pending: 1 };
      const dmap = new Map();
      for (const p of (data || [])) {
        const k = p.student_id + '|' + normM(p.month_paid, yv);
        const ex = dmap.get(k);
        if (!ex) { dmap.set(k, p); continue; }
        const pp = sPri[p.status?.toLowerCase()] || 0, ep = sPri[ex.status?.toLowerCase()] || 0;
        if (pp > ep || (pp === ep && p.id > ex.id)) dmap.set(k, p);
      }
      let list = Array.from(dmap.values());

      // ── 4. Agregar deudas anteriores (marcadas con _prev) ─────────────
      for (const p of prevDebt) { p._prev = true; list.push(p); }

      // ── 5. Filtro de búsqueda por nombre ──────────────────────────────
      if (sq) { const s = sq.toLowerCase(); list = list.filter(p => p.students?.name?.toLowerCase().includes(s)); }

      // ── 6. Si no hay registros del mes actual, auto-generar silenciosamente ──
      const currList = list.filter(p => !p._prev);
      const prevList = list.filter(p => p._prev);

      if (!currList.length) {
        // Auto-generar cobros del mes actual en background sin bloquear la UI
        supabase.functions.invoke('auto-payment-cycle', { body: { force: true } })
          .then(({ data: cycleData }) => {
            if (cycleData?.generated > 0) {
              // Recargar la tabla después de generar
              setTimeout(() => this.loadPayments(), 800);
            }
          })
          .catch(() => {});
      }

      if (!list.length) {
        const mi = parseInt(mv, 10) - 1;
        const label = MES_LABEL[mi] || mv;
        tbody.innerHTML =
          '<tr><td colspan="8" class="text-center py-10">' +
            '<div class="flex flex-col items-center gap-4">' +
              '<div class="w-12 h-12 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>' +
              '<p class="font-bold text-slate-500 text-sm">Generando cobros de ' + label + ' ' + (yv || '') + '...</p>' +
            '</div>' +
          '</td></tr>';
        if (window.lucide) lucide.createIcons();
        return;
      }

      // ── 7. Ordenar: deudas anteriores primero, luego por estado ───────
      const pri = { overdue: 1, pending: 2, review: 3, paid: 4 };
      list.sort((a, b) => {
        if (a._prev && !b._prev) return -1;
        if (!a._prev && b._prev) return 1;
        return (pri[this._st(a)] || 99) - (pri[this._st(b)] || 99);
      });

      // ── 8. Construir HTML con separadores visuales ────────────────────
      let html = '';
      const mi = parseInt(mv, 10) - 1;
      const currLabel = (MES_LABEL[mi] || mv) + ' ' + yv;

      // Aviso si no hay cobros del mes actual pero sí hay deudas anteriores
      if (!currList.length && prevList.length) {
        html += '<tr><td colspan="8" class="px-5 py-3">' +
          '<div class="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-5 py-3">' +
            '<div class="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin flex-shrink-0" style="border-width:3px"></div>' +
            '<span class="text-blue-800 font-bold text-sm">Generando cobros de ' + currLabel + ' automáticamente...</span>' +
          '</div>' +
        '</td></tr>';
      }

      let shownPrevHeader = false;
      let shownCurrHeader = false;
      for (const p of list) {
        if (p._prev && !shownPrevHeader) {
          html += '<tr><td colspan="8" class="px-5 py-2 bg-rose-50 border-y border-rose-100">' +
            '<div class="flex items-center gap-2 text-rose-700 font-black text-[11px] uppercase tracking-widest">' +
              '<i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i>Deudas de meses anteriores' +
            '</div></td></tr>';
          shownPrevHeader = true;
        }
        if (!p._prev && !shownCurrHeader) {
          html += '<tr><td colspan="8" class="px-5 py-2 bg-slate-50 border-y border-slate-100">' +
            '<div class="flex items-center gap-2 text-slate-500 font-black text-[11px] uppercase tracking-widest">' +
              '<i data-lucide="calendar" class="w-3.5 h-3.5"></i>' + currLabel +
            '</div></td></tr>';
          shownCurrHeader = true;
        }
        html += this._row(p);
      }
      tbody.innerHTML = html;
      if (window.lucide) lucide.createIcons();
    } catch (e) {
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
      const today = new Date(); today.setHours(0,0,0,0);
      if (new Date(p.due_date + 'T00:00:00') < today) return 'overdue';
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
    const stu = p.students || { name: 'Desconocido', classrooms: { name: '-' } };
    const ip  = sk !== 'paid';
    const ds  = p.due_date ? new Date(p.due_date + 'T00:00:00').toLocaleDateString('es-ES') : '-';
    const af  = 'RD$' + Number(p.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Mora acumulada
    const mora         = (ip && p.due_date) ? Helpers.calculateMora(p.due_date) : 0;
    const moraBreakdown = (mora > 0 && p.due_date) ? Helpers.getMoraBreakdown(p.due_date) : null;
    const totalAmount  = Number(p.amount || 0) + mora;
    const tf           = 'RD$' + totalAmount.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let ub = '';
    if (mora > 0 && moraBreakdown) {
      ub = '<div class="mt-1 flex flex-col items-end gap-0.5">' +
             '<span class="text-[9px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full uppercase">' +
               'Mora: +' + Helpers.formatCurrency(mora) + ' (' + moraBreakdown.formattedText + ')' +
             '</span>' +
             '<span class="text-[10px] font-bold text-slate-800 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200">' +
               'Total: ' + tf +
             '</span>' +
           '</div>';
    } else if (p.due_date && ip) {
      const t = new Date(); t.setHours(0, 0, 0, 0);
      const df = Math.round((new Date(p.due_date + 'T00:00:00') - t) / 86400000);
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

    return '<tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors' + (sk === 'overdue' ? ' bg-rose-50/20' : '') + '">' +
      '<td class="px-5 py-3.5"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm flex-shrink-0">' + Helpers.escapeHTML((stu.name || '?').charAt(0).toUpperCase()) + '</div><div><div class="font-bold text-slate-800 text-sm">' + Helpers.escapeHTML(stu.name || '-') + '</div><div class="text-[10px] text-slate-400 font-bold uppercase">' + (stu.classrooms?.name || 'Sin aula') + '</div></div></div></td>' +
      '<td class="px-5 py-3.5 text-center"><span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ' + st.c + '"><i data-lucide="' + st.i + '" class="w-3 h-3"></i>' + st.l + '</span></td>' +
      '<td class="px-5 py-3.5 text-right"><div class="font-black text-slate-800 text-base">' + af + '</div>' + (ip ? '<div class="flex flex-col items-end gap-0.5 mt-0.5">' + ub + '</div>' : '') + '</td>' +
      '<td class="px-5 py-3.5"><span class="text-[10px] font-black uppercase text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">' + (p.method || '-') + '</span></td>' +
      '<td class="px-5 py-3.5"><div class="text-[10px] font-bold text-slate-600 uppercase truncate max-w-[110px]">' + (p.bank || '-') + '</div><div class="text-[9px] text-slate-400 font-bold">' + (p.reference || '') + '</div></td>' +
      '<td class="px-5 py-3.5"><div class="text-[11px] font-bold text-slate-700">' + (p.paid_date ? new Date(p.paid_date).toLocaleDateString('es-ES') : ds) + '</div><div class="text-[9px] text-slate-400 font-bold uppercase">' + (p.paid_date ? 'Pagado' : 'Vence') + '</div></td>' +
      '<td class="px-5 py-3.5 text-center">' + voucherCell + '</td>' +
      '<td class="px-5 py-3.5 text-center"><div class="flex justify-center gap-1.5">' + approveBtn + waiveMoraBtn + deleteBtn + '</div></td>' +
    '</tr>';
  },

  async loadStats() {
    try {
      const mv = document.getElementById('filterPaymentMonth')?.value;
      const yv = document.getElementById('filterPaymentYear')?.value;
      const { data } = await DirectorApi.getPaymentStats(mv, yv);
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
    const ic = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-emerald-100 focus:border-emerald-400 bg-slate-50/50 transition-all text-sm font-medium';
    const lc = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';
    const now = new Date();
    const curMonth = now.getMonth();      // 0-based
    const curYear  = now.getFullYear();
    // due_date = día 5 del mes SIGUIENTE
    const nextM = curMonth + 1 > 11 ? 0 : curMonth + 1;
    const nextY = curMonth + 1 > 11 ? curYear + 1 : curYear;
    const dd = `${nextY}-${String(nextM + 1).padStart(2,'0')}-${String(this.settings.due_day || 5).padStart(2,'0')}`;
    const mo = MES.map((m, i) => {
      const val = `${curYear}-${String(i + 1).padStart(2, '0')}`;
      return '<option value="' + val + '"' + (i === curMonth ? ' selected' : '') + '>' + MES_LABEL[i] + '</option>';
    }).join('');

    window.openGlobalModal(
      '<div class="bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-6 rounded-t-3xl flex items-center justify-between">' +
        '<div class="flex items-center gap-3"><div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">\uD83D\uDCB0</div>' +
        '<div><h3 class="text-xl font-black">Registrar Pago</h3><p class="text-xs text-white/70 font-bold uppercase tracking-widest">Cobro Manual</p></div></div>' +
        '<button onclick="App.ui.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"><i data-lucide="x" class="w-6 h-6"></i></button>' +
      '</div>' +
      '<div class="p-6 bg-slate-50/30" id="modalPayment"><div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
        '<div class="md:col-span-2"><label class="' + lc + '">Estudiante</label><select id="payStudentSelect" class="' + ic + '"><option value="">-- Seleccionar --</option></select></div>' +
        '<div><label class="' + lc + '">Monto ($)</label><input id="payAmount" type="number" step="0.01" min="0" class="' + ic + '" placeholder="0.00"></div>' +
        '<div><label class="' + lc + '">Concepto</label><input id="payConcept" type="text" class="' + ic + '" value="Mensualidad"></div>' +
        '<div><label class="' + lc + '">Mes que se cobra</label><select id="payMonthPaid" class="' + ic + '">' + mo + '</select></div>' +
        '<div><label class="' + lc + '">Fecha Limite</label><input id="payDueDate" type="date" class="' + ic + '" value="' + dd + '"></div>' +
        '<div><label class="' + lc + '">Metodo</label><select id="payMethod" class="' + ic + '"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select></div>' +
        '<div><label class="' + lc + '">Estado</label><select id="payStatus" class="' + ic + '"><option value="paid">Pagado</option><option value="pending">Pendiente</option></select></div>' +
      '</div></div>' +
      '<div class="bg-white p-5 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">' +
        '<button onclick="App.ui.closeModal()" class="px-6 py-2.5 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl">Cancelar</button>' +
        '<button id="btnSavePaymentAction" class="px-8 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg">Registrar Pago</button>' +
      '</div>'
    );

    try {
      const { data: students } = await DirectorApi.getStudents();
      const sel = document.getElementById('payStudentSelect');
      if (sel && students) {
        students.forEach(s => {
          const o = document.createElement('option');
          o.value = s.id;
          o.textContent = s.name + ' (' + (s.classrooms?.name || 'Sin aula') + ')';
          if (prefillStudentId && String(s.id) === String(prefillStudentId)) o.selected = true;
          sel.appendChild(o);
        });
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

    UIHelpers.setLoading(true, '#modalPayment');
    try {
      const { data: pay, error } = await DirectorApi.createManualPayment({ student_id: sid, amount: amt, concept: con, method: met, status: sta, month_paid: mp, due_date: dd || null, paid_date: pd, created_at: new Date().toISOString() });
      if (error) throw new Error(error);
      Helpers.toast('Pago registrado correctamente', 'success');
      UIHelpers.closeModal();
      await this.loadPayments();
      if (pay?.id && sta === 'paid') {
        DirectorApi.sendPaymentReceipt(pay.id).catch(() => {});
        try {
          const { data: p } = await DirectorApi.getPaymentById(pay.id);
          if (p) {
            const { notifyPaymentApproved } = await import('../shared/supabase.js');
            const email = p.students?.p1_email || p.students?.p2_email || null;
            const studentName = p.students?.name || 'Estudiante';
            const amountStr = 'RD$' + Number(amt || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const monthStr = mp || 'Colegiatura';

            await notifyPaymentApproved(pay.id, email, studentName, amountStr, monthStr);
          }
        } catch (_) {}
      }
    } catch (e) {

      Helpers.toast('Error al guardar: ' + e.message, 'error');
    } finally {
      UIHelpers.setLoading(false, '#modalPayment');
    }
  },

  async markPaid(id) {
    try {
      // Usar RPC seguro del servidor (registra auditoría inmutable)
      const { data, error } = await supabase.rpc('approve_payment', { p_payment_id: id });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      Helpers.toast('Pago aprobado', 'success');
      await this.loadPayments();

      // Notificar al padre: email + push via process-event (un solo envío)
      try {
        const { data: p } = await DirectorApi.getPaymentById(id);
        if (p) {
          const { notifyPaymentApproved } = await import('../shared/supabase.js');
          const emails = [p.students?.p1_email, p.students?.p2_email].filter(e => e && e.includes('@'));
          const studentName = p.students?.name || 'Estudiante';
          const amountStr = 'RD$' + Number(p.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const monthStr = p.month_paid || 'Colegiatura';
          await notifyPaymentApproved(id, emails[0] || null, studentName, amountStr, monthStr);
          import('../shared/notify-feedback.js').then(m =>
            m.showNotifyFeedback({ sent: 1, type: 'payment', label: 'Recibo enviado al padre' })
          ).catch(() => {});
        }
      } catch (_) {}
    } catch (e) {
      // Fallback: UPDATE directo si el RPC no existe aún
      try {
        const { error: upErr } = await supabase.from('payments')
          .update({ status: 'paid', paid_date: new Date().toISOString() })
          .eq('id', id);
        if (upErr) throw upErr;
        auditLog('payment.approved', { payment_id: id });
        Helpers.toast('Pago aprobado', 'success');
        await this.loadPayments();
      } catch (e2) {
        Helpers.toast('Error al aprobar pago: ' + (e2.message || e2), 'error');
      }
    }
  },

  async delete(id) {
    if (!confirm('¿Eliminar este registro de pago?\n\nEsta acción quedará registrada en el historial de auditoría.')) return;
    try {
      // Usar RPC seguro (soft delete + auditoría)
      const { data, error } = await supabase.rpc('delete_payment', { p_payment_id: id });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      Helpers.toast('Pago eliminado', 'success');
      await this.loadPayments();
    } catch (e) {
      // Fallback: DELETE directo
      try {
        await supabase.from('payments').delete().eq('id', id);
        auditLog('payment.deleted', { payment_id: id });
        Helpers.toast('Pago eliminado', 'success');
        await this.loadPayments();
      } catch (_) { Helpers.toast('Error al eliminar', 'error'); }
    }
  },

  async runCycle() {
    if (!confirm('¿Ejecutar ciclo de pagos?\n\nRegla: el cobro de cada mes se genera el día 25 y vence el día 5 del mes siguiente.')) return;
    try {
      Helpers.toast('Ejecutando ciclo...', 'info');

      const now      = new Date();
      const today    = now.getDate();
      const genDay   = this.settings.generation_day || 25;
      const dueDay   = this.settings.due_day || 5;

      // ── Validar que hoy sea >= día de generación (solo en modo automático) ──
      // Cuando se llama manualmente desde el panel, siempre se permite
      if (today < genDay && !confirm(`Normalmente el ciclo se activa el día ${genDay}. Hoy es día ${today}.\n\n¿Deseas generar los cobros de todas formas?`)) {
        return;
      }

      const currentMonth = now.getMonth();
      const currentYear  = now.getFullYear();
      const monthKey     = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

      // due_date = día 5 del mes SIGUIENTE
      const nextMonth     = currentMonth + 1 > 11 ? 0 : currentMonth + 1;
      const nextMonthYear = currentMonth + 1 > 11 ? currentYear + 1 : currentYear;
      const dueDate = `${nextMonthYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;

      // Get active students with monthly_fee > 0
      const { data: students, error: sErr } = await supabase
        .from('students')
        .select('id, name, monthly_fee')
        .eq('is_active', true)
        .gt('monthly_fee', 0);

      if (sErr) throw sErr;

      if (!students?.length) {
        Helpers.toast('No hay estudiantes activos con cuota mensual configurada.', 'warning');
        return;
      }

      // Find which students already have a payment for this month
      const { data: existing } = await supabase
        .from('payments')
        .select('student_id')
        .eq('month_paid', monthKey);

      const existingIds = new Set((existing || []).map(p => String(p.student_id)));
      const missing = students.filter(s => !existingIds.has(String(s.id)));

      let generated = 0;
      if (missing.length) {
        const inserts = missing.map(s => ({
          student_id: s.id,
          amount:     s.monthly_fee,
          status:     'pending',
          due_date:   dueDate,
          month_paid: monthKey,
          concept:    'Mensualidad',
          created_at: new Date().toISOString()
        }));
        const { error: insErr } = await supabase.from('payments').insert(inserts);
        if (insErr) throw insErr;
        generated = missing.length;
      }

      // Mark overdue: pending payments where due_date < today
      await supabase
        .from('payments')
        .update({ status: 'overdue' })
        .eq('status', 'pending')
        .lt('due_date', now.toISOString().split('T')[0]);

      const MES_LABEL_LOCAL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      const monthLabel   = MES_LABEL_LOCAL[currentMonth];
      const dueDateLabel = `${dueDay} de ${MES_LABEL_LOCAL[nextMonth]} ${nextMonthYear}`;

      if (generated > 0) {
        Helpers.toast(`✅ ${generated} cobro(s) de ${monthLabel} generados — vencen el ${dueDateLabel}`, 'success');
      } else {
        Helpers.toast(`ℹ️ Todos los estudiantes ya tienen cobro de ${monthLabel} registrado.`, 'info');
      }

      // Switch filter to current month
      const ms = document.getElementById('filterPaymentMonth');
      const ys = document.getElementById('filterPaymentYear');
      if (ms) ms.value = String(currentMonth + 1).padStart(2, '0');
      if (ys) ys.value = String(currentYear);

      await this.loadPayments();
    } catch (e) {
      Helpers.toast('Error en ciclo: ' + (e.message || e), 'error');
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
      // Fallback: extender due_date 30 días hacia adelante para eliminar mora acumulada
      try {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 30);
        const { error: upErr } = await supabase
          .from('payments')
          .update({ due_date: futureDate.toISOString().split('T')[0] })
          .eq('id', id);
        if (upErr) throw upErr;
        auditLog('payment.mora_waived', { payment_id: id, reason: reason.trim() });
        Helpers.toast('Mora eliminada (fecha extendida 30 días)', 'success');
        await this.loadPayments();
      } catch (e2) {
        Helpers.toast('Error al quitar mora: ' + (e2.message || e2), 'error');
      }
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
