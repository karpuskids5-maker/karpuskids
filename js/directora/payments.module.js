import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { UIHelpers } from './ui.module.js';
import { supabase } from '../shared/supabase.js';

const MONTH_NAMES_ES = [
  'enero','febrero','marzo','abril','mayo','junio',
  'julio','agosto','septiembre','octubre','noviembre','diciembre'
];
const MONTH_LABELS = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

export const PaymentsModule = {
  settings: { due_day: 5, generation_day: 25 },
  _financialChart: null,

  async init() {
    this._initPeriodSelectors();
    await this._loadSettings();

    // Evitar listeners duplicados con flag
    if (!this._initialized) {
      this._initialized = true;
      document.getElementById('btnRefreshPayments')?.addEventListener('click', () => this.loadPayments());
      document.getElementById('filterPaymentMonth')?.addEventListener('change', () => this.loadPayments());
      document.getElementById('filterPaymentYear')?.addEventListener('change', () => this.loadPayments());
      document.getElementById('filterPaymentStatus')?.addEventListener('change', () => this.loadPayments());
      document.getElementById('searchPaymentStudent')?.addEventListener('input', () => this.loadPayments());
      document.getElementById('btnNewPaymentAction')?.addEventListener('click', () => this.openPaymentModal());
      document.getElementById('btnNewPayment')?.addEventListener('click', () => this.openPaymentModal());
      document.getElementById('btnGenerateCharges')?.addEventListener('click', () => this.runCycle());
      document.getElementById('btnGeneratePaymentsNow')?.addEventListener('click', () => this.runCycle());
      document.getElementById('btnSavePaymentConfig')?.addEventListener('click', () => this.savePaymentConfig());
    }

    await this.loadPayments();
  },

  _initPeriodSelectors() {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = String(now.getFullYear());
    const ms = document.getElementById('filterPaymentMonth');
    const ys = document.getElementById('filterPaymentYear');
    if (ms) ms.value = m;
    if (ys) ys.value = y;
  },

  async _loadSettings() {
    try {
      const { data } = await DirectorApi.getSchoolSettings();
      if (data) {
        this.settings.generation_day = data.generation_day || 25;
        this.settings.due_day = data.due_day || 5;
        const g = document.getElementById('confGenDay');
        const d = document.getElementById('confDueDay');
        if (g) g.value = this.settings.generation_day;
        if (d) d.value = this.settings.due_day;
      }
    } catch (e) { /* silencioso */ }
  },

  filterBy(status) {
    const sel = document.getElementById('filterPaymentStatus');
    if (sel) { sel.value = status; this.loadPayments(); }
  },

  async loadPayments() {
    const container = document.getElementById('paymentsTableBody');
    if (!container) return;

    container.innerHTML =
      '<tr><td colspan="8" class="text-center py-10">' +
        '<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-2"></div>' +
        '<p class="text-xs text-slate-400">Cargando pagos...</p>' +
      '</td></tr>';

    this.loadStats();
    this.loadIncomeChart();

    try {
      const monthVal     = document.getElementById('filterPaymentMonth')?.value;
      const yearVal      = document.getElementById('filterPaymentYear')?.value;
      const statusFilter = document.getElementById('filterPaymentStatus')?.value;
      const search       = document.getElementById('searchPaymentStudent')?.value?.trim();

      // Filtrar por month_paid (nombre en español)
      const monthIndex = monthVal ? parseInt(monthVal, 10) - 1 : new Date().getMonth();
      const monthName  = MONTH_NAMES_ES[monthIndex];

      let query = supabase
        .from('payments')
        .select('id, student_id, amount, concept, status, due_date, created_at, paid_date, method, bank, reference, month_paid, evidence_url, students:student_id(name, classroom_id, classrooms:classroom_id(name))')
        .ilike('month_paid', monthName)
        .order('due_date', { ascending: true });

      if (statusFilter && statusFilter !== 'all') query = query.eq('status', statusFilter);

      const { data: payments, error } = await query;
      if (error) throw error;

      // Filtro búsqueda en cliente
      let list = payments || [];
      if (search) {
        const q = search.toLowerCase();
        list = list.filter(p => p.students?.name?.toLowerCase().includes(q));
      }

      if (!list.length) {
        const label = MONTH_LABELS[monthIndex];
        container.innerHTML =
          '<tr><td colspan="8" class="text-center py-16">' +
            '<div class="flex flex-col items-center gap-3">' +
              '<div class="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center">' +
                '<i data-lucide="inbox" class="w-7 h-7 text-slate-400"></i>' +
              '</div>' +
              '<p class="font-bold text-slate-500">Sin registros para ' + label + ' ' + (yearVal || '') + '</p>' +
              '<p class="text-xs text-slate-400 max-w-xs text-center">Usa "Generar pagos ahora" para crear las cuotas del mes.</p>' +
            '</div>' +
          '</td></tr>';
        if (window.lucide) lucide.createIcons();
        return;
      }

      const priority = { overdue: 1, pending: 2, review: 3, paid: 4 };
      list.sort((a, b) => (priority[this._calcStatus(a)] || 99) - (priority[this._calcStatus(b)] || 99));

      container.innerHTML = list.map(p => this._renderRow(p)).join('');
      if (window.lucide) lucide.createIcons();

    } catch (e) {
      console.error('[PaymentsModule] loadPayments:', e);
      container.innerHTML =
        '<tr><td colspan="8" class="text-center py-8 text-rose-500 font-bold text-sm">Error al cargar pagos.</td></tr>';
    }
  },

  _calcStatus(p) {
    if (p.status === 'paid') return 'paid';
    if (p.status === 'review' || (p.status === 'pending' && p.method === 'transferencia')) return 'review';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = p.due_date ? new Date(p.due_date + 'T00:00:00') : null;
    if (!due) return 'pending';
    return today > due ? 'overdue' : 'pending';
  },

  _renderRow(p) {
    const statusKey = this._calcStatus(p);
    const statusMap = {
      paid:    { label: 'Aprobado',    cls: 'bg-emerald-100 text-emerald-700', icon: 'check-circle' },
      pending: { label: 'Pendiente',   cls: 'bg-amber-100 text-amber-700',     icon: 'clock' },
      review:  { label: 'En Revision', cls: 'bg-blue-100 text-blue-700',       icon: 'file-search' },
      overdue: { label: 'Vencido',     cls: 'bg-rose-100 text-rose-700',       icon: 'alert-triangle' }
    };
    const st      = statusMap[statusKey] || { label: p.status, cls: 'bg-slate-100 text-slate-700', icon: 'help-circle' };
    const student = p.students || { name: 'Desconocido', classrooms: { name: '-' } };
    const isPending  = statusKey !== 'paid';
    const dueDateStr = p.due_date ? new Date(p.due_date + 'T00:00:00').toLocaleDateString('es-ES') : '-';
    const amountFmt  = Number(p.amount || 0).toLocaleString('es-ES', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

    let urgencyBadge = '';
    if (p.due_date && isPending) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const diff  = Math.round((new Date(p.due_date + 'T00:00:00') - today) / 86400000);
      if (diff < 0)
        urgencyBadge = '<span class="ml-1 text-[9px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">' + Math.abs(diff) + 'd vencido</span>';
      else if (diff === 0)
        urgencyBadge = '<span class="ml-1 text-[9px] font-black text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full">vence hoy</span>';
      else if (diff <= 5)
        urgencyBadge = '<span class="ml-1 text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">vence en ' + diff + 'd</span>';
    }

    return (
      '<tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors' + (statusKey === 'overdue' ? ' bg-rose-50/20' : '') + '">' +
        '<td class="px-5 py-3.5">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm flex-shrink-0">' +
              Helpers.escapeHTML((student.name || '?').charAt(0).toUpperCase()) +
            '</div>' +
            '<div>' +
              '<div class="font-bold text-slate-800 text-sm leading-tight">' + Helpers.escapeHTML(student.name || 'Desconocido') + '</div>' +
              '<div class="text-[10px] text-slate-400 font-bold uppercase tracking-tight">' + (student.classrooms?.name || 'Sin aula') + '</div>' +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td class="px-5 py-3.5 text-center">' +
          '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ' + st.cls + '">' +
            '<i data-lucide="' + st.icon + '" class="w-3 h-3"></i>' + st.label +
          '</span>' +
        '</td>' +
        '<td class="px-5 py-3.5 text-right">' +
          '<div class="font-black text-slate-800 text-base">' + amountFmt + '</div>' +
          (isPending ? '<div class="flex items-center justify-end gap-1 mt-0.5"><span class="text-[10px] text-slate-400 font-bold">pendiente</span>' + urgencyBadge + '</div>' : '') +
        '</td>' +
        '<td class="px-5 py-3.5">' +
          '<span class="text-[10px] font-black uppercase text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">' + (p.method || '-') + '</span>' +
        '</td>' +
        '<td class="px-5 py-3.5">' +
          '<div class="text-[10px] font-bold text-slate-600 uppercase truncate max-w-[110px]">' + (p.bank || '-') + '</div>' +
          '<div class="text-[9px] text-slate-400 font-bold">' + (p.reference || '') + '</div>' +
        '</td>' +
        '<td class="px-5 py-3.5">' +
          '<div class="text-[11px] font-bold text-slate-700">' + (p.paid_date ? new Date(p.paid_date).toLocaleDateString('es-ES') : dueDateStr) + '</div>' +
          '<div class="text-[9px] text-slate-400 font-bold uppercase">' + (p.paid_date ? 'Pagado' : 'Vence') + '</div>' +
        '</td>' +
        '<td class="px-5 py-3.5 text-center">' +
          (p.evidence_url
            ? '<a href="' + p.evidence_url + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-sky-600 hover:text-sky-800 text-xs font-bold uppercase"><i data-lucide="external-link" class="w-3 h-3"></i>Ver</a>'
            : '<span class="text-slate-300 text-xs">-</span>') +
        '</td>' +
        '<td class="px-5 py-3.5 text-center">' +
          '<div class="flex justify-center gap-1.5">' +
            (isPending ? '<button onclick="App.payments.markPaid(\'' + p.id + '\')" class="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors" title="Aprobar pago"><i data-lucide="check" class="w-4 h-4"></i></button>' : '') +
            '<button onclick="App.payments.delete(\'' + p.id + '\')" class="p-1.5 bg-rose-50 text-rose-500 rounded-lg hover:bg-rose-100 transition-colors" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
          '</div>' +
        '</td>' +
      '</tr>'
    );
  },

  async loadStats() {
    try {
      const { data } = await DirectorApi.getPaymentStats();
      if (!data) return;
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      set('kpiIncomeMonth', '$' + Number(data.incomeMonth || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 }));
      set('kpiPendingCount', data.pending);
      set('kpiOverdueCount', data.overdue);
      set('kpiReviewCount',  data.toApprove || 0);
    } catch (e) { console.error(e); }
  },

  async loadIncomeChart() {
    const canvas = document.getElementById('financialChart');
    if (!canvas || !window.Chart) return;
    try {
      const year = document.getElementById('filterPaymentYear')?.value || new Date().getFullYear();
      const { data: payments } = await supabase
        .from('payments')
        .select('amount, created_at')
        .eq('status', 'paid')
        .gte('created_at', year + '-01-01')
        .lte('created_at', year + '-12-31');

      const labels = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      const vals = new Array(12).fill(0);
      (payments || []).forEach(p => {
        const d = new Date(p.created_at);
        if (String(d.getFullYear()) === String(year)) vals[d.getMonth()] += Number(p.amount || 0);
      });
      if (this._financialChart) this._financialChart.destroy();
      this._financialChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{ label: 'Ingresos ($)', data: vals, backgroundColor: 'rgba(79,70,229,0.15)', borderColor: 'rgb(79,70,229)', borderWidth: 2, borderRadius: 6 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } }, x: { grid: { display: false } } }
        }
      });
    } catch (e) { console.error(e); }
  },

  async openPaymentModal(prefillStudentId = null) {
    const ic = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-emerald-100 focus:border-emerald-400 bg-slate-50/50 transition-all text-sm font-medium';
    const lc = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';
    const now = new Date();
    const dueMonth = now.getMonth() + 1;
    const dueYear  = dueMonth > 11 ? now.getFullYear() + 1 : now.getFullYear();
    const defaultDue = new Date(dueYear, dueMonth > 11 ? 0 : dueMonth, this.settings.due_day).toISOString().split('T')[0];
    const monthOptions = MONTH_NAMES_ES.map((m, i) =>
      '<option value="' + m + '"' + (i === now.getMonth() ? ' selected' : '') + '>' + MONTH_LABELS[i] + '</option>'
    ).join('');

    window.openGlobalModal(
      '<div class="bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-6 rounded-t-3xl flex items-center justify-between">' +
        '<div class="flex items-center gap-3"><div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">💰</div>' +
        '<div><h3 class="text-xl font-black">Registrar Pago</h3><p class="text-xs text-white/70 font-bold uppercase tracking-widest">Cobro Manual</p></div></div>' +
        '<button onclick="App.ui.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"><i data-lucide="x" class="w-6 h-6"></i></button>' +
      '</div>' +
      '<div class="p-6 bg-slate-50/30" id="modalPayment">' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
          '<div class="md:col-span-2"><label class="' + lc + '">Estudiante</label><select id="payStudentSelect" class="' + ic + '"><option value="">-- Seleccionar --</option></select></div>' +
          '<div><label class="' + lc + '">Monto ($)</label><input id="payAmount" type="number" step="0.01" min="0" class="' + ic + '" placeholder="0.00"></div>' +
          '<div><label class="' + lc + '">Concepto</label><input id="payConcept" type="text" class="' + ic + '" value="Mensualidad"></div>' +
          '<div><label class="' + lc + '">Mes que se cobra</label><select id="payMonthPaid" class="' + ic + '">' + monthOptions + '</select></div>' +
          '<div><label class="' + lc + '">Fecha Limite de Pago</label><input id="payDueDate" type="date" class="' + ic + '" value="' + defaultDue + '"></div>' +
          '<div><label class="' + lc + '">Metodo de Pago</label><select id="payMethod" class="' + ic + '"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select></div>' +
          '<div><label class="' + lc + '">Estado</label><select id="payStatus" class="' + ic + '"><option value="paid">Pagado</option><option value="pending">Pendiente</option></select></div>' +
        '</div>' +
      '</div>' +
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
    } catch (e) { console.error(e); }

    document.getElementById('btnSavePaymentAction')?.addEventListener('click', () => this.saveManualPayment());
    if (window.lucide) lucide.createIcons();
  },

  async saveManualPayment() {
    const studentId = document.getElementById('payStudentSelect')?.value;
    const amount    = parseFloat(document.getElementById('payAmount')?.value || 0);
    const concept   = document.getElementById('payConcept')?.value?.trim() || 'Mensualidad';
    const monthPaid = document.getElementById('payMonthPaid')?.value;
    const dueDate   = document.getElementById('payDueDate')?.value;
    const method    = document.getElementById('payMethod')?.value || 'efectivo';
    const status    = document.getElementById('payStatus')?.value || 'paid';
    const paidDate  = status === 'paid' ? new Date().toISOString() : null;

    if (!studentId) return Helpers.toast('Selecciona un estudiante', 'warning');
    if (!amount || amount <= 0) return Helpers.toast('Ingresa un monto valido', 'warning');

    UIHelpers.setLoading(true, '#modalPayment');
    try {
      const { data: payment, error } = await DirectorApi.createManualPayment({
        student_id: studentId, amount, concept, method, status,
        month_paid: monthPaid, due_date: dueDate || null,
        paid_date: paidDate, created_at: new Date().toISOString()
      });
      if (error) throw new Error(error);
      Helpers.toast('Pago registrado correctamente', 'success');
      UIHelpers.closeModal();
      await this.loadPayments();
      if (payment?.id) { try { await DirectorApi.sendPaymentReceipt(payment.id); } catch (_) {} }
    } catch (e) {
      console.error(e);
      Helpers.toast('Error al guardar: ' + e.message, 'error');
    } finally {
      UIHelpers.setLoading(false, '#modalPayment');
    }
  },

  async markPaid(id) {
    try {
      await supabase.from('payments').update({ status: 'paid', paid_date: new Date().toISOString() }).eq('id', id);
      Helpers.toast('Pago aprobado', 'success');
      await this.loadPayments();
    } catch (e) { Helpers.toast('Error al aprobar pago', 'error'); }
  },

  async delete(id) {
    if (!confirm('¿Eliminar este registro de pago?')) return;
    try {
      await supabase.from('payments').delete().eq('id', id);
      Helpers.toast('Pago eliminado', 'success');
      await this.loadPayments();
    } catch (e) { Helpers.toast('Error al eliminar pago', 'error'); }
  },

  async runCycle() {
    if (!confirm('¿Ejecutar ciclo de pagos?\n\nEsto generara cuotas del proximo mes y marcara como vencidos los pagos atrasados.')) return;
    try {
      Helpers.toast('Ejecutando ciclo de pagos...', 'info');
      const { data, error } = await supabase.rpc('run_payment_cycle');
      if (error) throw error;
      const result = typeof data === 'string' ? JSON.parse(data) : (data || {});
      Helpers.toast('Ciclo completado: ' + (result.generated || 0) + ' generados, ' + (result.expired || 0) + ' vencidos', 'success');
      await this.loadPayments();
    } catch (e) {
      console.error(e);
      Helpers.toast('Error en ciclo: ' + e.message, 'error');
    }
  },

  async savePaymentConfig() {
    const genDay = parseInt(document.getElementById('confGenDay')?.value || 25);
    const dueDay = parseInt(document.getElementById('confDueDay')?.value || 5);
    if (isNaN(genDay) || genDay < 1 || genDay > 28) return Helpers.toast('Dia de generacion invalido (1-28)', 'warning');
    if (isNaN(dueDay) || dueDay < 1 || dueDay > 28) return Helpers.toast('Dia limite invalido (1-28)', 'warning');
    try {
      await supabase.from('school_settings').upsert({ id: 1, generation_day: genDay, due_day: dueDay, updated_at: new Date().toISOString() });
      this.settings.generation_day = genDay;
      this.settings.due_day = dueDay;
      Helpers.toast('Configuracion guardada', 'success');
    } catch (e) {
      Helpers.toast('Error al guardar: ' + e.message, 'error');
    }
  }
};
