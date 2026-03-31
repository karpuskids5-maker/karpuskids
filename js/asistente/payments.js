import { supabase } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';
import { AppState } from './state.js';
import { sendEmail } from '../shared/supabase.js';

const MONTH_NAMES_ES = [
  'enero','febrero','marzo','abril','mayo','junio',
  'julio','agosto','septiembre','octubre','noviembre','diciembre'
];
const MONTH_LABELS = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

// ── Helpers internos ──────────────────────────────────────────────────────────
function openGlobalModal(html) {
  const c = document.getElementById('globalModalContainer');
  if (!c) return;
  c.innerHTML = '<div class="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">' + html + '</div>';
  c.style.display = 'flex';
  c.style.alignItems = 'center';
  c.style.justifyContent = 'center';
  c.style.zIndex = '9999';
  if (window.lucide) lucide.createIcons();
}

function closeGlobalModal() {
  const c = document.getElementById('globalModalContainer');
  if (c) { c.style.display = 'none'; c.innerHTML = ''; }
}

function calcStatus(p) {
  const s = (p.status || '').toLowerCase();
  if (s === 'paid' || s === 'pagado' || s === 'confirmado') return 'paid';
  if (s === 'review' || s === 'revision' || s === 'en revision' ||
      (s === 'pending' || s === 'pendiente') && p.method === 'transferencia') return 'review';
  if (s === 'overdue' || s === 'vencido') return 'overdue';
  return 'pending'; // pending, pendiente, or anything else
}

export const PaymentsModule = {
  _financialChart: null,
  settings: { due_day: 5, generation_day: 25 },

  async init() {
    this._initPeriodSelectors();
    await this._loadSettings();

    document.getElementById('filterPaymentMonth')?.addEventListener('change', () => this.loadPayments());
    document.getElementById('filterPaymentYear')?.addEventListener('change',  () => this.loadPayments());
    document.getElementById('filterPaymentStatus')?.addEventListener('change', () => this.loadPayments());
    document.getElementById('searchPaymentStudent')?.addEventListener('input', () => this.loadPayments());
    document.getElementById('btnNewPayment')?.addEventListener('click',        () => this.openPaymentModal());
    document.getElementById('btnGeneratePayments')?.addEventListener('click',  () => this.runCycle());
    document.getElementById('btnRefreshPayments')?.addEventListener('click',   () => this.loadPayments());

    // Status pill buttons
    document.getElementById('statusPills')?.addEventListener('click', (e) => {
      const pill = e.target.closest('[data-status]');
      if (!pill) return;
      const status = pill.dataset.status;
      // Update hidden select
      const sel = document.getElementById('filterPaymentStatus');
      if (sel) sel.value = status;
      // Update pill styles
      document.querySelectorAll('.status-pill').forEach(p => {
        p.classList.remove('bg-teal-600', 'text-white', 'active-pill');
        p.classList.add('bg-slate-100', 'text-slate-500');
      });
      pill.classList.remove('bg-slate-100', 'text-slate-500');
      pill.classList.add('bg-teal-600', 'text-white', 'active-pill');
      this.loadPayments();
    });

    // Chart year selector
    document.getElementById('chartYear')?.addEventListener('change', () => this.loadIncomeChart());

    await this.loadPayments();
    this.loadIncomeChart();
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
      const { data } = await supabase.from('school_settings').select('*').eq('id', 1).single();
      if (data) {
        this.settings.generation_day = data.generation_day || 25;
        this.settings.due_day = data.due_day || 5;
      }
    } catch (e) { /* silencioso */ }
  },

  filterBy(status) {
    const sel = document.getElementById('filterPaymentStatus');
    if (sel) sel.value = status;
    // Sync pill UI
    document.querySelectorAll('.status-pill').forEach(p => {
      const isActive = p.dataset.status === status;
      p.classList.toggle('bg-teal-600', isActive);
      p.classList.toggle('text-white',  isActive);
      p.classList.toggle('active-pill', isActive);
      p.classList.toggle('bg-slate-100', !isActive);
      p.classList.toggle('text-slate-500', !isActive);
    });
    this.loadPayments();
  },

  async loadPayments() {
    const container = document.getElementById('paymentsTableBody');
    if (!container) return;

      container.innerHTML =
      '<tr><td colspan="7" class="text-center py-10">' +
        '<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 mx-auto mb-2"></div>' +
        '<p class="text-xs text-slate-400">Cargando pagos...</p>' +
      '</td></tr>';

    this.loadStats();

    try {
      const monthVal    = document.getElementById('filterPaymentMonth')?.value;
      const yearVal     = document.getElementById('filterPaymentYear')?.value;
      const statusFilter = document.getElementById('filterPaymentStatus')?.value;
      const search      = document.getElementById('searchPaymentStudent')?.value?.trim();

      // Filtrar por month_paid (nombre en español) igual que directora
      const monthIndex = monthVal ? parseInt(monthVal, 10) - 1 : new Date().getMonth();
      const monthName  = MONTH_NAMES_ES[monthIndex];

      let query = supabase
        .from('payments')
        .select('id, student_id, amount, concept, status, due_date, created_at, paid_date, method, bank, reference, month_paid, evidence_url, students:student_id(name, classroom_id, classrooms:classroom_id(name))')
        .ilike('month_paid', monthName)
        .order('due_date', { ascending: true });

      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data: payments, error } = await query;
      if (error) throw error;

      // Filtro búsqueda en cliente
      let list = payments || [];
      if (search) {
        const q = search.toLowerCase();
        list = list.filter(p => p.students?.name?.toLowerCase().includes(q));
      }

      AppState.set('paymentsData', list);

      if (!list.length) {
        const label = MONTH_LABELS[monthIndex];
        container.innerHTML =
          '<tr><td colspan="7" class="text-center py-16">' +
            '<div class="flex flex-col items-center gap-3">' +
              '<div class="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center">' +
                '<i data-lucide="inbox" class="w-7 h-7 text-slate-400"></i>' +
              '</div>' +
              '<p class="font-bold text-slate-500">Sin registros para ' + label + ' ' + (yearVal || '') + '</p>' +
              '<p class="text-xs text-slate-400 max-w-xs text-center">Usa "Generar pagos" para crear las cuotas del mes.</p>' +
            '</div>' +
          '</td></tr>';
        if (window.lucide) lucide.createIcons();
        return;
      }

      const priority = { overdue: 1, pending: 2, review: 3, paid: 4 };
      list.sort((a, b) => (priority[calcStatus(a)] || 99) - (priority[calcStatus(b)] || 99));

      container.innerHTML = list.map(p => this._renderRow(p)).join('');
      if (window.lucide) lucide.createIcons();

    } catch (e) {
      console.error('[PaymentsModule] loadPayments:', e);
      container.innerHTML =
        '<tr><td colspan="7" class="text-center py-8 text-rose-500 font-bold text-sm">Error al cargar pagos.</td></tr>';
    }
  },

  _renderRow(p) {
    const statusKey = calcStatus(p);
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
            '<div class="w-8 h-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-black text-sm flex-shrink-0">' +
              Helpers.escapeHTML((student.name || '?').charAt(0).toUpperCase()) +
            '</div>' +
            '<div>' +
              '<div class="font-bold text-slate-800 text-sm">' + Helpers.escapeHTML(student.name || '-') + '</div>' +
              '<div class="text-[10px] text-slate-400 font-bold uppercase">' + (student.classrooms?.name || 'Sin aula') + '</div>' +
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
            (isPending
              ? '<button onclick="App.payments.markPaid(\'' + p.id + '\')" class="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors" title="Aprobar"><i data-lucide="check" class="w-4 h-4"></i></button>'
              : '') +
            (statusKey === 'review'
              ? '<button onclick="App.payments.rejectPayment(\'' + p.id + '\')" class="p-1.5 bg-rose-50 text-rose-500 rounded-lg hover:bg-rose-100 transition-colors" title="Rechazar"><i data-lucide="x" class="w-4 h-4"></i></button>'
              : '') +
            '<button onclick="App.payments.deletePayment(\'' + p.id + '\')" class="p-1.5 bg-slate-50 text-slate-400 rounded-lg hover:bg-rose-50 hover:text-rose-500 transition-colors" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
          '</div>' +
        '</td>' +
      '</tr>'
    );
  },

  async loadStats() {
    try {
      const now = new Date();
      const monthStart = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01T00:00:00.000Z';

      const [incomeRes, pendingRes, overdueRes, reviewRes] = await Promise.all([
        // Paid: both English and Spanish
        supabase.from('payments').select('amount').in('status', ['paid', 'pagado', 'confirmado']).gte('created_at', monthStart),
        // Pending: both English and Spanish
        supabase.from('payments').select('*', { count: 'exact', head: true }).in('status', ['pending', 'pendiente']),
        // Overdue: both
        supabase.from('payments').select('*', { count: 'exact', head: true }).in('status', ['overdue', 'vencido']),
        // Review: both
        supabase.from('payments').select('*', { count: 'exact', head: true }).in('status', ['review', 'revision', 'en revision'])
      ]);

      const income = (incomeRes.data || []).reduce((s, p) => s + Number(p.amount || 0), 0);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('kpiIncomeMonth', '$' + income.toLocaleString('es-ES', { minimumFractionDigits: 2 }));
      set('kpiPendingCount', pendingRes.count || 0);
      set('kpiOverdueCount', overdueRes.count || 0);
      set('kpiReviewCount',  reviewRes.count  || 0);
    } catch (e) { console.error(e); }
  },

  async loadIncomeChart() {
    const canvas = document.getElementById('paymentsIncomeChart');
    if (!canvas || !window.Chart) return;
    try {
      const year = document.getElementById('chartYear')?.value || new Date().getFullYear();
      const { data: payments } = await supabase
        .from('payments').select('amount, status, created_at')
        .gte('created_at', year + '-01-01').lte('created_at', year + '-12-31');

      const labels = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      const paid    = new Array(12).fill(0);
      const pending = new Array(12).fill(0);

      (payments || []).forEach(p => {
        const m = new Date(p.created_at).getMonth();
        const s = (p.status || '').toLowerCase();
        if (s === 'paid' || s === 'pagado' || s === 'confirmado') paid[m] += Number(p.amount || 0);
        else pending[m] += Number(p.amount || 0);
      });

      if (this._financialChart) this._financialChart.destroy();
      this._financialChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Cobrado',
              data: paid,
              backgroundColor: 'rgba(13,148,136,0.85)',
              borderRadius: 6,
              borderSkipped: false
            },
            {
              label: 'Pendiente',
              data: pending,
              backgroundColor: 'rgba(251,191,36,0.6)',
              borderRadius: 6,
              borderSkipped: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'top',
              labels: { font: { size: 11, weight: 'bold' }, padding: 12, usePointStyle: true }
            },
            tooltip: {
              callbacks: {
                label: (ctx) => ' ' + ctx.dataset.label + ': $' + Number(ctx.raw).toLocaleString('es-ES', { minimumFractionDigits: 2 })
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 10, weight: 'bold' } } },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(0,0,0,0.04)' },
              ticks: {
                font: { size: 10 },
                callback: (v) => '$' + Number(v).toLocaleString('es-ES')
              }
            }
          }
        }
      });
    } catch (e) { console.error('[loadIncomeChart]', e); }
  },

  async openPaymentModal(prefillStudentId = null) {
    const ic = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-teal-100 focus:border-teal-400 bg-slate-50/50 transition-all text-sm font-medium';
    const lc = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';
    const now = new Date();
    const dueMonth = now.getMonth() + 1;
    const dueYear  = dueMonth > 11 ? now.getFullYear() + 1 : now.getFullYear();
    const defaultDue = new Date(dueYear, dueMonth > 11 ? 0 : dueMonth, this.settings.due_day).toISOString().split('T')[0];
    const monthOptions = MONTH_NAMES_ES.map((m, i) =>
      '<option value="' + m + '"' + (i === now.getMonth() ? ' selected' : '') + '>' + MONTH_LABELS[i] + '</option>'
    ).join('');

    openGlobalModal(
      '<div class="bg-gradient-to-r from-teal-600 to-emerald-600 text-white p-6 rounded-t-3xl flex items-center justify-between">' +
        '<div class="flex items-center gap-3">' +
          '<div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">💰</div>' +
          '<div><h3 class="text-xl font-black">Registrar Pago</h3><p class="text-xs text-white/70 font-bold uppercase tracking-widest">Cobro Manual</p></div>' +
        '</div>' +
        '<button onclick="App.payments.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"><i data-lucide="x" class="w-6 h-6"></i></button>' +
      '</div>' +
      '<div class="p-6 bg-slate-50/30" id="modalPaymentBody">' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
          '<div class="md:col-span-2"><label class="' + lc + '">Estudiante</label>' +
            '<select id="payStudentSelect" class="' + ic + '"><option value="">-- Seleccionar --</option></select></div>' +
          '<div><label class="' + lc + '">Monto ($)</label>' +
            '<input id="payAmount" type="number" step="0.01" min="0" class="' + ic + '" placeholder="0.00"></div>' +
          '<div><label class="' + lc + '">Concepto</label>' +
            '<input id="payConcept" type="text" class="' + ic + '" value="Mensualidad"></div>' +
          '<div><label class="' + lc + '">Mes que se cobra</label>' +
            '<select id="payMonthPaid" class="' + ic + '">' + monthOptions + '</select></div>' +
          '<div><label class="' + lc + '">Fecha Limite de Pago</label>' +
            '<input id="payDueDate" type="date" class="' + ic + '" value="' + defaultDue + '"></div>' +
          '<div><label class="' + lc + '">Metodo de Pago</label>' +
            '<select id="payMethod" class="' + ic + '">' +
              '<option value="efectivo">Efectivo</option>' +
              '<option value="transferencia">Transferencia</option>' +
              '<option value="tarjeta">Tarjeta</option>' +
            '</select></div>' +
          '<div><label class="' + lc + '">Estado</label>' +
            '<select id="payStatus" class="' + ic + '">' +
              '<option value="paid">Pagado</option>' +
              '<option value="pending">Pendiente</option>' +
            '</select></div>' +
        '</div>' +
      '</div>' +
      '<div class="bg-white p-5 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">' +
        '<button onclick="App.payments.closeModal()" class="px-6 py-2.5 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl">Cancelar</button>' +
        '<button id="btnSavePaymentAction" class="px-8 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg">Registrar Pago</button>' +
      '</div>'
    );

    try {
      const { data: students } = await supabase.from('students').select('id, name, classrooms:classroom_id(name)').order('name');
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

  closeModal() { closeGlobalModal(); },

  async saveManualPayment() {
    const studentId = document.getElementById('payStudentSelect')?.value;
    const amount    = parseFloat(document.getElementById('payAmount')?.value || 0);
    const concept   = document.getElementById('payConcept')?.value?.trim() || 'Mensualidad';
    const monthPaid = document.getElementById('payMonthPaid')?.value;
    const dueDate   = document.getElementById('payDueDate')?.value;
    const method    = document.getElementById('payMethod')?.value || 'efectivo';
    const status    = document.getElementById('payStatus')?.value || 'paid';
    const paidDate  = status === 'paid' ? new Date().toISOString() : null;
    const user      = AppState.get('user');

    if (!studentId) return Helpers.toast('Selecciona un estudiante', 'warning');
    if (!amount || amount <= 0) return Helpers.toast('Ingresa un monto valido', 'warning');

    const btn = document.getElementById('btnSavePaymentAction');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
      const { error } = await supabase.from('payments').insert({
        student_id: studentId, amount, concept, method, status,
        month_paid: monthPaid,
        due_date:   dueDate || null,
        paid_date:  paidDate,
        recorded_by: user?.id || null,
        created_at: new Date().toISOString()
      });
      if (error) throw error;
      Helpers.toast('Pago registrado correctamente', 'success');
      closeGlobalModal();
      await this.loadPayments();
    } catch (e) {
      console.error(e);
      Helpers.toast('Error al guardar: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Registrar Pago'; }
    }
  },

  async markPaid(id) {
    try {
      const { error } = await supabase.from('payments').update({ status: 'paid', paid_date: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      Helpers.toast('Pago aprobado', 'success');
      await this.loadPayments();
      // Send receipt email silently
      this._sendReceipt(id).catch(() => {});
    } catch (e) { Helpers.toast('Error al aprobar pago', 'error'); }
  },

  async _sendReceipt(paymentId) {
    try {
      const { data: p } = await supabase
        .from('payments')
        .select('*, students:student_id(name, p1_email, p2_email, classrooms:classroom_id(name))')
        .eq('id', paymentId).single();
      if (!p) return;

      const emails = [p.students?.p1_email, p.students?.p2_email].filter(e => e && e.includes('@'));
      if (!emails.length) return;

      const studentName = p.students?.name || 'Estudiante';
      const amount  = Number(p.amount || 0).toLocaleString('es-ES', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
      const month   = p.month_paid || 'Colegiatura';
      const method  = (p.method || 'efectivo').charAt(0).toUpperCase() + (p.method || 'efectivo').slice(1);
      const dateStr = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

      const rows = [
        ['Estudiante', studentName],
        ['Concepto',   month],
        ['Monto',      amount],
        ['Método',     method],
        ['Fecha',      dateStr]
      ].map(([l, v], i) => {
        const b = i < 4 ? 'border-bottom:1px solid #d1fae5;' : '';
        const vs = l === 'Monto'
          ? 'text-align:right;font-weight:800;color:#16a34a;font-size:16px;padding:6px 0;' + b
          : 'text-align:right;font-weight:700;color:#111827;padding:6px 0;' + b;
        return '<tr><td style="color:#6b7280;padding:6px 0;' + b + '">' + l + '</td><td style="' + vs + '">' + v + '</td></tr>';
      }).join('');

      const html = '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">' +
        '<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">' +
          '<div style="background:linear-gradient(135deg,#16a34a,#15803d);padding:32px 40px;text-align:center;">' +
            '<h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">✅ Pago Confirmado</h1>' +
            '<p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Karpus Kids — Recibo de Pago</p>' +
          '</div>' +
          '<div style="padding:32px 40px;">' +
            '<p style="margin:0 0 24px;color:#374151;font-size:15px;">Se ha confirmado el pago de colegiatura para <strong>' + studentName + '</strong>.</p>' +
            '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px 24px;margin-bottom:24px;">' +
              '<table style="width:100%;border-collapse:collapse;font-size:14px;">' + rows + '</table>' +
            '</div>' +
            '<div style="text-align:center;">' +
              '<a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none;">Ver mi Panel →</a>' +
            '</div>' +
          '</div>' +
          '<div style="background:#f9fafb;border-top:1px solid #f0f0f0;padding:16px 40px;text-align:center;">' +
            '<p style="margin:0;font-size:11px;color:#9ca3af;">Karpus Kids · Correo automático, por favor no respondas.</p>' +
          '</div>' +
        '</div></body></html>';

      await sendEmail(emails, 'Recibo de Pago — ' + month + ' · ' + studentName, html);
    } catch (e) {
      console.warn('[Asistente] sendReceipt error:', e);
    }
  },

  async rejectPayment(id) {
    const reason = prompt('Motivo del rechazo (opcional):');
    if (reason === null) return;
    try {
      const user = AppState.get('user');
      const { error } = await supabase.from('payments').update({ status: 'rechazado', validated_by: user?.id, notes: reason || null }).eq('id', id);
      if (error) throw error;
      Helpers.toast('Pago rechazado', 'success');
      await this.loadPayments();
    } catch (e) { Helpers.toast('Error al rechazar', 'error'); }
  },

  async deletePayment(id) {
    if (!confirm('¿Eliminar este registro de pago?')) return;
    try {
      const { error } = await supabase.from('payments').delete().eq('id', id);
      if (error) throw error;
      Helpers.toast('Pago eliminado', 'success');
      await this.loadPayments();
    } catch (e) { Helpers.toast('Error al eliminar', 'error'); }
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
  }
};
