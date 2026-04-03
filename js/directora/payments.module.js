import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { UIHelpers } from './ui.module.js';
import { supabase } from '../shared/supabase.js';

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
      on('btnSavePaymentConfig',      'click',  () => this.savePaymentConfig());
      on('btnSendPaymentReminders',   'click',  () => this.sendReminders());
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
      if (g) g.value = this.settings.generation_day;
      if (d) d.value = this.settings.due_day;
    } catch (_) {}
  },

  filterBy(status) {
    const sel = document.getElementById('filterPaymentStatus');
    if (sel) { sel.value = status; this.loadPayments(); }
  },

  async loadPayments() {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-2"></div><p class="text-xs text-slate-400">Cargando pagos...</p></td></tr>';
    this.loadStats();
    this.loadIncomeChart();
    try {
      const mv = document.getElementById('filterPaymentMonth')?.value;
      const yv = document.getElementById('filterPaymentYear')?.value;
      const sf = document.getElementById('filterPaymentStatus')?.value;
      const sq = document.getElementById('searchPaymentStudent')?.value?.trim();
      const mi = mv ? parseInt(mv, 10) - 1 : new Date().getMonth();
      const mn = MES[mi];

      let q = supabase
        .from('payments')
        .select('id,student_id,amount,concept,status,due_date,created_at,paid_date,method,bank,reference,month_paid,evidence_url,students:student_id(name,classroom_id,classrooms:classroom_id(name))')
        .ilike('month_paid', mn)
        .order('due_date', { ascending: true });
      if (sf && sf !== 'all') q = q.eq('status', sf);

      const { data, error } = await q;
      if (error) throw error;

      // 1. DEDUPLICACIÓN INTELIGENTE:
      // Si hay varios registros para el mismo estudiante y mes, priorizamos el que tiene evidencia
      // o el que está en un estado más avanzado (paid > review > pending).
      const uniqueMap = new Map();
      (data || []).forEach(p => {
        const key = `${p.student_id}-${(p.month_paid || '').toLowerCase()}`;
        const existing = uniqueMap.get(key);
        
        if (!existing) {
          uniqueMap.set(key, p);
        } else {
          const statusPriority = { paid: 4, review: 3, pending: 2, overdue: 1 };
          const pScore = (statusPriority[p.status] || 0) + (p.evidence_url ? 10 : 0);
          const eScore = (statusPriority[existing.status] || 0) + (existing.evidence_url ? 10 : 0);
          
          if (pScore > eScore) {
            uniqueMap.set(key, p);
          }
        }
      });

      let list = Array.from(uniqueMap.values());
      if (sq) {
        const s = sq.toLowerCase();
        list = list.filter(p => p.students?.name?.toLowerCase().includes(s));
      }

      if (!list.length) {
        const label = MES_LABEL[mi];
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-16"><div class="flex flex-col items-center gap-3"><div class="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center"><i data-lucide="inbox" class="w-7 h-7 text-slate-400"></i></div><p class="font-bold text-slate-500">Sin registros para ' + label + ' ' + (yv || '') + '</p></div></td></tr>';
        if (window.lucide) lucide.createIcons();
        return;
      }

      const pri = { overdue: 1, pending: 2, review: 3, paid: 4 };
      list.sort((a, b) => (pri[this._st(a)] || 99) - (pri[this._st(b)] || 99));
      tbody.innerHTML = list.map(p => this._row(p)).join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('[Payments] loadPayments:', e);
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-rose-500 font-bold text-sm">Error al cargar pagos.</td></tr>';
    }
  },

  _st(p) {
    if (p.status === 'paid') return 'paid';
    if (p.status === 'review' || (p.status === 'pending' && p.method === 'transferencia')) return 'review';
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const d = p.due_date ? new Date(p.due_date + 'T00:00:00') : null;
    if (!d) return 'pending';
    return t > d ? 'overdue' : 'pending';
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
    
    // Cálculo de Mora usando Helpers
    const moraBreakdown = p.due_date && ip ? Helpers.getMoraBreakdown(p.due_date + 'T00:00:00') : null;
    const currentMora = moraBreakdown ? moraBreakdown.total : 0;
    const totalAmount = Number(p.amount || 0) + currentMora;

    const af  = Number(p.amount || 0).toLocaleString('es-ES', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
    const tf  = totalAmount.toLocaleString('es-ES', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

    let ub = '';
    if (moraBreakdown) {
      const df = moraBreakdown.daysLate;
      if (df > 0) {
        ub = `<div class="mt-1 flex flex-col items-end gap-1">
                <span class="text-[9px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full uppercase tracking-tighter">
                  Mora: +${Helpers.formatCurrency(currentMora)} (${moraBreakdown.formattedText})
                </span>
                <span class="text-[10px] font-bold text-slate-800 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200">
                  Total: ${tf}
                </span>
              </div>`;
      } else {
        const t = new Date(); t.setHours(0, 0, 0, 0);
        const diffDays = Math.round((new Date(p.due_date + 'T00:00:00') - t) / 86400000);
        if (diffDays === 0) ub = '<span class="ml-1 text-[9px] font-black text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full uppercase tracking-tighter">vence hoy</span>';
        else if (diffDays <= 5)  ub = '<span class="ml-1 text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full uppercase tracking-tighter">vence en ' + diffDays + 'd</span>';
      }
    }

    const approveBtn = ip ? '<button onclick="App.payments.markPaid(\'' + p.id + '\')" class="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors" title="Aprobar"><i data-lucide="check" class="w-4 h-4"></i></button>' : '';
    const deleteBtn  = '<button onclick="App.payments.delete(\'' + p.id + '\')" class="p-1.5 bg-rose-50 text-rose-500 rounded-lg hover:bg-rose-100 transition-colors" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>';
    const voucherCell = p.evidence_url
      ? '<a href="' + p.evidence_url + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-sky-600 hover:text-sky-800 text-xs font-bold uppercase"><i data-lucide="external-link" class="w-3 h-3"></i>Ver</a>'
      : '<span class="text-slate-300 text-xs">-</span>';

    return '<tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors' + (sk === 'overdue' ? ' bg-rose-50/20' : '') + '">' +
      '<td class="px-5 py-3.5"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm flex-shrink-0">' + Helpers.escapeHTML((stu.name || '?').charAt(0).toUpperCase()) + '</div><div><div class="font-bold text-slate-800 text-sm">' + Helpers.escapeHTML(stu.name || '-') + '</div><div class="text-[10px] text-slate-400 font-bold uppercase">' + (stu.classrooms?.name || 'Sin aula') + '</div></div></div></td>' +
      '<td class="px-5 py-3.5 text-center"><span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ' + st.c + '"><i data-lucide="' + st.i + '" class="w-3 h-3"></i>' + st.l + '</span></td>' +
      '<td class="px-5 py-3.5 text-right"><div class="font-black text-slate-800 text-base">' + af + '</div>' + (ip ? '<div class="flex flex-col items-end gap-1 mt-0.5">' + ub + '</div>' : '') + '</td>' +
      '<td class="px-5 py-3.5"><span class="text-[10px] font-black uppercase text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">' + (p.method || '-') + '</span></td>' +
      '<td class="px-5 py-3.5"><div class="text-[10px] font-bold text-slate-600 uppercase truncate max-w-[110px]">' + (p.bank || '-') + '</div><div class="text-[9px] text-slate-400 font-bold">' + (p.reference || '') + '</div></td>' +
      '<td class="px-5 py-3.5"><div class="text-[11px] font-bold text-slate-700">' + (p.paid_date ? new Date(p.paid_date).toLocaleDateString('es-ES') : ds) + '</div><div class="text-[9px] text-slate-400 font-bold uppercase">' + (p.paid_date ? 'Pagado' : 'Vence') + '</div></td>' +
      '<td class="px-5 py-3.5 text-center">' + voucherCell + '</td>' +
      '<td class="px-5 py-3.5 text-center"><div class="flex justify-center gap-1.5">' + approveBtn + deleteBtn + '</div></td>' +
    '</tr>';
  },

  async loadStats() {
    try {
      const { data } = await DirectorApi.getPaymentStats();
      if (!data) return;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
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
    } catch (e) { console.error(e); }
  },

  async openPaymentModal(prefillStudentId = null) {
    const ic = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-emerald-100 focus:border-emerald-400 bg-slate-50/50 transition-all text-sm font-medium';
    const lc = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';
    const now = new Date();
    const dm  = now.getMonth() + 1;
    const dy  = dm > 11 ? now.getFullYear() + 1 : now.getFullYear();
    const dd  = new Date(dy, dm > 11 ? 0 : dm, this.settings.due_day).toISOString().split('T')[0];
    const mo  = MES.map((m, i) => '<option value="' + m + '"' + (i === now.getMonth() ? ' selected' : '') + '>' + MES_LABEL[i] + '</option>').join('');

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
    } catch (e) { console.error(e); }

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
      if (pay?.id) { try { await DirectorApi.sendPaymentReceipt(pay.id); } catch (_) {} }
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
    } catch (_) { Helpers.toast('Error al aprobar pago', 'error'); }
  },

  async delete(id) {
    if (!confirm('Eliminar este registro?')) return;
    try {
      await supabase.from('payments').delete().eq('id', id);
      Helpers.toast('Pago eliminado', 'success');
      await this.loadPayments();
    } catch (_) { Helpers.toast('Error al eliminar', 'error'); }
  },

  async runCycle() {
    if (!confirm('Ejecutar ciclo de pagos?')) return;
    try {
      Helpers.toast('Ejecutando...', 'info');
      const { data, error } = await supabase.rpc('run_payment_cycle');
      if (error) throw error;
      const r = typeof data === 'string' ? JSON.parse(data) : (data || {});
      Helpers.toast('Ciclo completado: ' + (r.generated || 0) + ' generados, ' + (r.expired || 0) + ' vencidos', 'success');
      await this.loadPayments();
    } catch (e) { Helpers.toast('Error en ciclo: ' + e.message, 'error'); }
  },

  async sendReminders() {
    if (!confirm('¿Enviar recordatorios de pago por correo y push ahora?')) return;
    try {
      Helpers.toast('Enviando recordatorios...', 'info');
      const { data, error } = await supabase.functions.invoke('payment-reminders', { body: {} });
      if (error) throw new Error(error.message || JSON.stringify(error));
      const r = data || {};
      Helpers.toast(
        `Recordatorios enviados: ${r.emails_sent || 0} correos, ${r.pushes_sent || 0} push`,
        'success'
      );
    } catch (e) {
      console.error('[sendReminders]', e);
      Helpers.toast('Error enviando recordatorios: ' + e.message, 'error');
    }
  },

  async savePaymentConfig() {
    const g = parseInt(document.getElementById('confGenDay')?.value || 25);
    const d = parseInt(document.getElementById('confDueDay')?.value || 5);
    if (isNaN(g) || g < 1 || g > 28) return Helpers.toast('Dia generacion invalido (1-28)', 'warning');
    if (isNaN(d) || d < 1 || d > 28) return Helpers.toast('Dia limite invalido (1-28)', 'warning');
    try {
      await supabase.from('school_settings').upsert({ id: 1, generation_day: g, due_day: d, updated_at: new Date().toISOString() });
      this.settings.generation_day = g;
      this.settings.due_day = d;
      Helpers.toast('Configuracion guardada', 'success');
    } catch (e) { Helpers.toast('Error: ' + e.message, 'error'); }
  }
};
