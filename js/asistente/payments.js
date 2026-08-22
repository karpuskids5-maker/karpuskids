import { supabase } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';
import { AppState } from './state.js';
import { calcMora } from '../shared/payment-service.js';
import { QueryCache } from '../shared/query-cache.js';

const MONTH_NAMES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MONTH_LABELS   = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const FILTER_KEY = 'asistente_pagos_filters_v1';

function calcStatus(p) {
  const s = p?.status?.toLowerCase?.().trim();
  if (s === 'paid') return 'paid';
  if (s === 'review') return 'review';
  if (s === 'overdue') return 'overdue';
  if (s === 'rejected') return 'rejected';
  if (p?.evidence_url) return 'review';
  return 'pending';
}

export const PaymentsModule = {
  _financialChart: null,
  settings: { due_day: 5, generation_day: 25 },

  async init() {
    this._initPeriodSelectors();
    await this._loadSettings();

    this._applyPersistedFilters();

    const persistFilters = () => this._persistFilters();

    document.getElementById('filterPaymentMonth')?.addEventListener('change', () => { persistFilters(); this.loadPayments(); this.loadIncomeChart(); });
    document.getElementById('filterPaymentYear')?.addEventListener('change',  () => { persistFilters(); this.loadPayments(); this.loadIncomeChart(); });
    document.getElementById('filterPaymentStatus')?.addEventListener('change', () => { persistFilters(); this.loadPayments(); });
    document.getElementById('searchPaymentStudent')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const cached = AppState.get('paymentsData');
      if (cached && q) { this._renderPaymentRows(cached.filter(p => p?.students?.name?.toLowerCase().includes(q))); }
      else { this.loadPayments(); }
    });
    document.getElementById('btnNewPayment')?.addEventListener('click',       () => this.openPaymentModal());
    document.getElementById('btnGeneratePayments')?.addEventListener('click', () => this.runCycle());
    document.getElementById('btnRefreshPayments')?.addEventListener('click',  () => this.loadPayments());
    document.getElementById('statusPills')?.addEventListener('click', (e) => {
      const pill = e.target.closest('[data-status]');
      if (!pill) return;
      const status = pill.dataset.status;
      const sel = document.getElementById('filterPaymentStatus');
      if (sel) sel.value = status;
      this._updatePillsUI(status);
      persistFilters();
      this.loadPayments();
    });
    document.getElementById('chartYear')?.addEventListener('change', () => {
      const fy = document.getElementById('filterPaymentYear');
      const cy = document.getElementById('chartYear');
      if (fy && cy && fy.value !== cy.value) fy.value = cy.value;
      this.loadPayments(); this.loadIncomeChart();
    });
    await this.loadPayments();
    this.loadIncomeChart();
  },

  _persistFilters() {
    if (!window._kkFiltersStore) return;
    window._kkFiltersStore.save(FILTER_KEY, {
      month: document.getElementById('filterPaymentMonth')?.value || '',
      year: document.getElementById('filterPaymentYear')?.value || '',
      status: document.getElementById('filterPaymentStatus')?.value || 'all'
    });
  },

  _applyPersistedFilters() {
    if (!window._kkFiltersStore) return;
    const saved = window._kkFiltersStore.load(FILTER_KEY, null);
    if (!saved) { this._updatePillsUI('all'); return; }
    const mSel = document.getElementById('filterPaymentMonth');
    const ySel = document.getElementById('filterPaymentYear');
    const sSel = document.getElementById('filterPaymentStatus');
    if (mSel && saved.month) mSel.value = saved.month;
    if (ySel && saved.year)  ySel.value = saved.year;
    if (sSel && saved.status) sSel.value = saved.status;
    this._updatePillsUI(saved.status || 'all');
  },

  _updatePillsUI(activeStatus) {
    const stylesByStatus = {
      all:     { active:   { cls: 'bg-teal-600 text-white shadow-md shadow-teal-100' },
                  inactive: { cls: 'bg-slate-100 text-slate-700 hover:bg-teal-50 hover:text-teal-700 border border-slate-200' } },
      pending: { active:   { cls: 'bg-amber-500 text-white shadow-md shadow-amber-100' },
                  inactive: { cls: 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200' } },
      review:  { active:   { cls: 'bg-blue-500 text-white shadow-md shadow-blue-100' },
                  inactive: { cls: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200' } },
      paid:    { active:   { cls: 'bg-emerald-500 text-white shadow-md shadow-emerald-100' },
                  inactive: { cls: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200' } },
      overdue: { active:   { cls: 'bg-rose-500 text-white shadow-md shadow-rose-100' },
                  inactive: { cls: 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200' } }
    };
    document.querySelectorAll('.status-pill').forEach(p => {
      const st = p.dataset.status;
      const def = stylesByStatus[st] || stylesByStatus.all;
      const isActive = st === activeStatus;
      const style = isActive ? def.active : def.inactive;
      p.className = 'status-pill px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ' + style.cls;
    });
  },

  _initPeriodSelectors() {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = String(now.getFullYear());
    const ms = document.getElementById('filterPaymentMonth');
    const ys = document.getElementById('filterPaymentYear');
    if (ms) ms.value = m;
    if (ys) ys.value = y;
    const cy = document.getElementById('chartYear');
    if (cy) cy.value = y;
  },

  async _loadSettings() {
    try {
      const { data } = await supabase.from('school_settings').select('id, generation_day, due_day').eq('id', 1).maybeSingle();
      if (data) { this.settings.generation_day = data.generation_day || 25; this.settings.due_day = data.due_day || 5; }
    } catch (error_) { Helpers.safeLog?.(error_); }
  },

  filterBy(status) {
    const sel = document.getElementById('filterPaymentStatus');
    if (sel) { sel.value = status; this.loadPayments(); }
  },

  async loadPayments() {
    const container = document.getElementById('paymentsTableBody');
    if (!container) return;
    container.innerHTML = '<tr><td colspan="8" class="text-center py-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 mx-auto mb-2"></div><p class="text-xs text-slate-400">Cargando pagos...</p></td></tr>';
    this.loadStats();

    try {
      const monthVal  = document.getElementById('filterPaymentMonth')?.value;
      const yearVal   = document.getElementById('filterPaymentYear')?.value || String(new Date().getFullYear());
      const statusFilter = document.getElementById('filterPaymentStatus')?.value || 'all';
      const search    = (document.getElementById('searchPaymentStudent')?.value || '').trim().toLowerCase();

      const list = await this._fetchFilteredPayments(yearVal, monthVal, statusFilter, search);

      AppState.set('paymentsData', list);
      this._renderPaymentsList(container, list, monthVal, yearVal);
    } catch (error_) {
      Helpers.safeLog?.(error_);
      container.innerHTML = '<tr><td colspan="8" class="text-center py-8"><p class="text-rose-500 font-bold">Error al cargar: Intenta recargar</p></td></tr>';
    }
  },

  async _fetchFilteredPayments(yearVal, monthVal, statusFilter, search) {
    let q = supabase
      .from('payments')
      .select('id, student_id, amount, concept, status, due_date, created_at, paid_date, method, bank, reference, month_paid, evidence_url, proof_url, notes, students:student_id(id, name, monthly_fee, classroom_id, classrooms:classroom_id(name))')
      .gte('created_at', yearVal + '-01-01T00:00:00')
      .lte('created_at', yearVal + '-12-31T23:59:59')
      .order('created_at', { ascending: false })
      .limit(500);

    if (statusFilter !== 'all') q = q.eq('status', statusFilter);

    const { data: payments, error } = await q;
    if (error) throw error;

    let list = payments || [];

    if (monthVal) {
      list = this._filterByMonth(list, monthVal, yearVal);
    }

    if (search) list = list.filter(p => (p?.students?.name || '').toLowerCase().includes(search));

    return list;
  },

  _filterByMonth(list, monthVal, yearVal) {
    const monthNum = Number.parseInt(monthVal, 10);
    const mk  = yearVal + '-' + String(monthVal).padStart(2, '0');
    const mks = yearVal + '-' + monthNum;
    const mkn = MONTH_NAMES_ES[monthNum - 1];
    return list.filter(p => {
      const mp = (p.month_paid || '').toLowerCase();
      if (mp === mk) return true;
      if (mp === mks) return true;
      return mp.startsWith(mkn);
    });
  },

  _renderPaymentsList(container, list, monthVal, yearVal) {
    if (!list.length) {
      const label = monthVal ? MONTH_LABELS[Number.parseInt(monthVal, 10) - 1] + ' ' + yearVal : 'este periodo';
      container.innerHTML = '<tr><td colspan="8" class="text-center py-16"><div class="flex flex-col items-center gap-3"><div class="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center"><i data-lucide="inbox" class="w-7 h-7 text-slate-400"></i></div><p class="font-bold text-slate-500">Sin registros para ' + label + '</p><p class="text-xs text-slate-400">Prueba cambiando el filtro de estado o mes.</p></div></td></tr>';
      if (window.lucide) lucide.createIcons();
      return;
    }
    container.innerHTML = list.map(p => this._renderRow(p)).join('');
    if (window.lucide) lucide.createIcons();
  },

  async _getStudentParent(studentId) {
    try {
      const { data } = await supabase.from('students').select('parent_id, parents:parent_id(id, name, phone, whatsapp_optin)').eq('id', studentId).maybeSingle();
      return data?.parents || null;
    } catch (error_) { Helpers.safeLog?.(error_); return null; }
  },

  async sendPaymentReminder(paymentId, channel = 'chat') {
    const p = (AppState.get('paymentsData') || []).find(x => String(x.id) === String(paymentId));
    if (!p) return Helpers.toast('Pago no encontrado', 'warning');
    const student = p?.students || {};
    const parent = await this._getStudentParent(p.student_id);
    if (!parent) return Helpers.toast('Tutor no asignado', 'warning');

    const amount = Number(p.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
    const month = p.month_paid || 'período actual';
    const due = p.due_date ? new Date(p.due_date + 'T00:00:00').toLocaleDateString('es-ES') : '';
    const msg = `📋 *Recordatorio de Pago*\n\nEstimado(a) ${parent.name || 'Tutor'},\n\nLe recordamos que el pago correspondiente a *${month}* del estudiante *${student.name || ''}* aún no ha sido registrado.\n\n💰 Monto: *$${amount}*${due ? `\n📅 Vence: ${due}` : ''}\n\nSi ya realizó la transferencia, por favor adjunte el comprobante en el portal o responda a este mensaje.\n\n— Karpus Kids 💚`;

    if (channel === 'whatsapp' && parent.phone) {
      const url = `https://wa.me/${String(parent.phone).replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank', 'noopener');
      Helpers.toast('Abriendo WhatsApp…', 'success');
      return;
    }

    try {
      window.goToSection?.('chat');
      setTimeout(async () => {
        try {
          await window.selectAssistantChat?.(parent.id, parent.name, 'padre');
          const input = document.getElementById('chatMessageInput');
          if (input) { input.value = msg; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); }
          Helpers.toast('Mensaje listo para enviar en el Chat', 'info');
        } catch (error_) { Helpers.safeLog?.(error_); Helpers.toast('No se pudo abrir el chat', 'error'); }
      }, 600);
    } catch (error_) { Helpers.safeLog?.(error_); Helpers.toast('No se pudo abrir el chat', 'error'); }
  },

  async sendDigitalReceipt(paymentId, channel = 'chat') {
    const p = (AppState.get('paymentsData') || []).find(x => String(x.id) === String(paymentId));
    if (!p) return Helpers.toast('Pago no encontrado', 'warning');
    const student = p?.students || {};
    const parent = await this._getStudentParent(p.student_id);
    if (!parent) return Helpers.toast('Tutor no asignado', 'warning');

    const amount = Number(p.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
    const month = p.month_paid || 'período actual';
    const paidOn = p.paid_date ? new Date(p.paid_date).toLocaleDateString('es-ES') : new Date().toLocaleDateString('es-ES');
    const method = p.method ? p.method.charAt(0).toUpperCase() + p.method.slice(1) : '';
    const ref = p.reference ? `\n🔖 Ref: ${p.reference}` : '';
    const receipt = `✅ *Recibo de Pago Confirmado*\n\nEstimado(a) ${parent.name || 'Tutor'},\n\nHemos recibido correctamente su pago correspondiente a *${month}* del estudiante *${student.name || ''}*.\n\n💰 Monto: *$${amount}*\n📅 Fecha: ${paidOn}${method ? `\n💳 Método: ${method}` : ''}${ref}\n\nGracias por su puntualidad. Si necesita el comprobante físico formal, no dude en solicitarlo en recepción.\n\n— Karpus Kids 💚`;

    if (channel === 'whatsapp' && parent.phone) {
      const url = `https://wa.me/${String(parent.phone).replace(/\D/g,'')}?text=${encodeURIComponent(receipt)}`;
      window.open(url, '_blank', 'noopener');
      Helpers.toast('Abriendo WhatsApp con recibo…', 'success');
      return;
    }

    try {
      window.goToSection?.('chat');
      setTimeout(async () => {
        try {
          await window.selectAssistantChat?.(parent.id, parent.name, 'padre');
          const input = document.getElementById('chatMessageInput');
          if (input) { input.value = receipt; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); }
          Helpers.toast('Recibo listo para enviar en el Chat', 'info');
        } catch (error_) { Helpers.safeLog?.(error_); Helpers.toast('No se pudo abrir el chat', 'error'); }
      }, 600);
    } catch (error_) { Helpers.safeLog?.(error_); Helpers.toast('No se pudo abrir el chat', 'error'); }
  },

  _getMoraInfo(p, isPending) {
    if (!isPending || !p.due_date) return '';
    const mora = calcMora ? calcMora(p.due_date) : 0;
    if (mora > 0) return '<span class="text-[9px] font-black text-rose-600">+' + mora.toLocaleString('es-DO') + ' mora</span>';
    const nowTs = Date.now();
    const dueTs = new Date(p.due_date + 'T00:00:00').getTime();
    const diff = Math.round((dueTs - nowTs) / 86400000);
    if (diff === 0) return '<span class="text-[9px] font-black text-orange-600">vence hoy</span>';
    if (diff > 0 && diff <= 5) return '<span class="text-[9px] font-black text-amber-600">vence en ' + diff + 'd</span>';
    return '';
  },

  _renderRow(p) {
    const statusKey = calcStatus(p);
    const st = {
      paid:    { label: 'Aprobado',    cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200', icon: 'check-circle' },
      pending: { label: 'Pendiente',   cls: 'bg-amber-50 text-amber-700 border border-amber-200',     icon: 'clock' },
      review:  { label: 'En Revisión', cls: 'bg-blue-50 text-blue-700 border border-blue-200',       icon: 'file-search' },
      overdue: { label: 'Vencido',     cls: 'bg-rose-50 text-rose-700 border border-rose-200',       icon: 'alert-triangle' },
      rejected:{ label: 'Rechazado',   cls: 'bg-slate-100 text-slate-500 border border-slate-200',     icon: 'x-circle' }
    }[statusKey] || { label: p.status, cls: 'bg-slate-100 text-slate-500 border border-slate-200', icon: 'help-circle' };

    const student   = p?.students || { name: 'Desconocido', classrooms: { name: '-' } };
    const isPending = statusKey !== 'paid' && statusKey !== 'rejected';
    const isOverdue = statusKey === 'overdue';
    const ds        = p.due_date ? new Date(p.due_date + 'T00:00:00').toLocaleDateString('es-ES') : '-';
    const amountFmt = Number(p.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const monthFmt  = p.month_paid || '-';
    const hasV      = !!(p.evidence_url || p.proof_url);

    const moraBlock = this._getMoraInfo(p, isPending);
    const bankRef = [p.bank, p.reference].filter(Boolean).join(' / ') || '-';
    const reminderCta = this._buildReminderCTA(p.id, isPending, isOverdue);
    const receiptCta = this._buildReceiptCTA(p.id, statusKey);
    const evidenceCell = this._buildEvidenceCell(hasV, p);
    const actionsCell = this._buildActionsCell(p.id, isPending, statusKey, hasV);
    const rowClass = 'hover:bg-slate-50 border-b border-slate-100 transition-colors' + (statusKey === 'overdue' ? ' bg-rose-50/30' : '');
    const firstLetter = (student.name || '?').charAt(0).toUpperCase();

    return '<tr class="' + rowClass + '">' +
      '<td class="px-4 py-3"><div class="flex items-center gap-3"><div class="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-black text-sm flex-shrink-0">' + firstLetter + '</div><div><div class="font-bold text-slate-800 text-sm">' + Helpers.escapeHTML(student.name || '-') + '</div><div class="text-[10px] text-slate-400 uppercase tracking-wider">' + (student?.classrooms?.name || 'Sin aula') + '</div></div></div></td>' +
      '<td class="px-4 py-3 text-center"><span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider ' + st.cls + '"><i data-lucide="' + st.icon + '" class="w-3 h-3"></i>' + st.label + '</span></td>' +
      '<td class="px-4 py-3 text-right"><div class="font-black text-slate-800 text-sm">$' + amountFmt + '</div>' + (moraBlock ? '<div class="mt-0.5">' + moraBlock + '</div>' : '') + receiptCta + reminderCta + '</td>' +
      '<td class="px-4 py-3"><span class="text-[10px] font-black uppercase tracking-wider text-slate-500 bg-slate-100 px-2.5 py-1 rounded-xl">' + (p.method || '-') + '</span></td>' +
      '<td class="px-4 py-3"><div class="text-[11px] font-bold text-slate-700">' + Helpers.escapeHTML(bankRef) + '</div><div class="text-[9px] text-slate-400 uppercase tracking-wider mt-0.5">' + monthFmt + '</div></td>' +
      '<td class="px-4 py-3"><div class="text-[11px] font-bold text-slate-700">' + (p.paid_date ? new Date(p.paid_date).toLocaleDateString('es-ES') : ds) + '</div><div class="text-[9px] text-slate-400 uppercase tracking-wider mt-0.5">' + (p.paid_date ? 'Pagado' : 'Vence') + '</div></td>' +
      '<td class="px-4 py-3 text-center">' + evidenceCell + '</td>' +
      '<td class="px-4 py-3 text-center"><div class="flex justify-center items-center gap-1.5 flex-wrap">' + actionsCell + '</div></td></tr>';
  },

  _buildReminderCTA(id, isPending, isOverdue) {
    if (!(isPending || isOverdue)) return '';
    const chatBtn = '<button onclick="App.payments.sendPaymentReminder(\'' + id + '\',\'chat\')" class="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 rounded-lg text-[9px] font-black uppercase transition-all">' +
                    '<i data-lucide="message-square" class="w-2.5 h-2.5"></i> Chat</button>';
    const waBtn = '<button onclick="App.payments.sendPaymentReminder(\'' + id + '\',\'whatsapp\')" class="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 rounded-lg text-[9px] font-black uppercase transition-all">' +
                  '<svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg> WA</button>';
    return '<div class="flex gap-1 mt-1.5">' + chatBtn + waBtn + '</div>';
  },

  _buildReceiptCTA(id, statusKey) {
    if (statusKey !== 'paid') return '';
    const chatBtn = '<button onclick="App.payments.sendDigitalReceipt(\'' + id + '\',\'chat\')" class="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 rounded-lg text-[9px] font-black uppercase transition-all">' +
                    '<i data-lucide="message-square" class="w-2.5 h-2.5"></i> Recibo</button>';
    const waBtn = '<button onclick="App.payments.sendDigitalReceipt(\'' + id + '\',\'whatsapp\')" class="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 rounded-lg text-[9px] font-black uppercase transition-all">' +
                  '<svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg> WA</button>';
    return '<div class="flex gap-1 mt-1.5">' + chatBtn + waBtn + '</div>';
  },

  _buildEvidenceCell(hasV, p) {
    if (hasV) {
      const url = p.evidence_url || p.proof_url;
      return '<a href="' + url + '" target="_blank" class="inline-flex items-center gap-1 text-sky-600 text-xs font-bold hover:text-sky-700 transition-colors"><i data-lucide="external-link" class="w-3.5 h-3.5"></i>Comprobante</a>';
    }
    return '<span class="text-slate-300 text-xs">—</span>';
  },

  _buildActionsCell(id, isPending, statusKey, hasV) {
    const parts = [];
    if (isPending) {
      let approveBtn = '<button onclick="App.payments.markPaid(\'' + id + '\')" class="p-2 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 border border-emerald-100 transition-all active:scale-95" title="Aprobar Pago">';
      if (hasV) approveBtn += '<i data-lucide="check" class="w-4 h-4"></i>';
      if (!hasV) approveBtn += '<i data-lucide="check" class="w-4 h-4"></i>';
      approveBtn += '</button>';
      parts.push(approveBtn);
    }
    if (statusKey === 'review') {
      parts.push('<button onclick="App.payments.rejectPayment(\'' + id + '\')" class="p-2 bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-100 border border-rose-100 transition-all active:scale-95" title="Rechazar Comprobante"><i data-lucide="x" class="w-4 h-4"></i></button>');
    }
    parts.push('<button onclick="App.payments.deletePayment(\'' + id + '\')" class="p-2 bg-slate-50 text-slate-400 rounded-xl hover:bg-rose-50 hover:text-rose-500 border border-slate-100 transition-all active:scale-95" title="Eliminar Registro"><i data-lucide="trash-2" class="w-4 h-4"></i></button>');
    return parts.join('');
  },

  _renderPaymentRows(list) {
    const container = document.getElementById('paymentsTableBody');
    if (!container) return;
    if (!list.length) { container.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-slate-400">Sin resultados.</td></tr>'; return; }
    container.innerHTML = list.map(p => this._renderRow(p)).join('');
    if (window.lucide) lucide.createIcons();
  },

  async loadStats() {
    try {
      const mv  = document.getElementById('filterPaymentMonth')?.value;
      const yv  = document.getElementById('filterPaymentYear')?.value || String(new Date().getFullYear());
      const { data: pays } = await supabase.from('payments').select('id, amount, status, due_date, month_paid')
        .gte('created_at', yv + '-01-01T00:00:00').lte('created_at', yv + '-12-31T23:59:59').limit(2000);
      if (!pays) return;
      const filtered = this._filterStatsByMonth(pays, mv, yv);
      const counts = this._computePaymentCounters(filtered);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('kpiIncomeMonth', '$' + counts.income.toLocaleString('es-DO', { minimumFractionDigits: 2 }));
      set('kpiPendingCount', counts.pending);
      set('kpiOverdueCount', counts.overdue);
      set('kpiReviewCount', counts.review);
    } catch (error_) { Helpers.safeLog?.(error_); }
  },

  _filterStatsByMonth(pays, mv, yv) {
    if (!mv) return pays;
    const mk = yv + '-' + String(mv).padStart(2, '0');
    const mkn = MONTH_NAMES_ES[Number.parseInt(mv, 10) - 1];
    const mknAlt = yv + '-' + Number.parseInt(mv, 10);
    return pays.filter(p => {
      const mp = (p.month_paid || '').toLowerCase();
      if (mp === mk) return true;
      if (mp === mknAlt) return true;
      return mp.startsWith(mkn);
    });
  },

  _computePaymentCounters(payments) {
    const nowTs = new Date().setHours(0, 0, 0, 0);
    let income = 0, pending = 0, overdue = 0, review = 0;
    for (const p of payments) {
      if (p.status === 'paid') { income += Number(p.amount || 0); continue; }
      if (p.status === 'review') { review++; continue; }
      if (p.due_date) {
        const ddTs = new Date(p.due_date + 'T00:00:00').getTime();
        if (nowTs > ddTs) { overdue++; continue; }
      }
      pending++;
    }
    return { income, pending, overdue, review };
  },

  async loadIncomeChart() {
    const canvas = document.getElementById('paymentsIncomeChart');
    if (!canvas || !window.Chart) return;
    try {
      const year = document.getElementById('chartYear')?.value || String(new Date().getFullYear());
      const { data: pays } = await supabase.from('payments').select('amount, status, month_paid, created_at')
        .gte('created_at', year + '-01-01').lte('created_at', year + '-12-31');
      const labels = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      const paid = new Array(12).fill(0);
      const pending = new Array(12).fill(0);
      for (const p of (pays || [])) {
        const m = this._resolveChartMonthIndex(p);
        if (m < 0 || m > 11) continue;
        const statusOk = (p.status || '') === 'paid';
        const amt = Number(p.amount || 0);
        if (statusOk) paid[m] += amt;
        else pending[m] += amt;
      }
      if (this._financialChart) this._financialChart.destroy();
      this._financialChart = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets: [
          { label: 'Cobrado',   data: paid,    backgroundColor: 'rgba(13,148,136,0.85)', borderRadius: 6 },
          { label: 'Pendiente', data: pending, backgroundColor: 'rgba(251,191,36,0.6)',  borderRadius: 6 }
        ]},
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true } },
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } } } }
      });
    } catch (error_) { Helpers.safeLog?.(error_); }
  },

  _resolveChartMonthIndex(p) {
    const parts = (p.month_paid || '').split('-');
    if (parts.length >= 2) return Number.parseInt(parts[1], 10) - 1;
    return new Date(p.created_at).getMonth();
  },

  async openPaymentModal(prefillStudentId = null) {
    const ic = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-teal-100 focus:border-teal-400 bg-slate-50/50 transition-all text-sm font-medium';
    const lc = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';
    const now = new Date(); const cy = now.getFullYear(); const cm = now.getMonth();
    const nextM = cm + 1 > 11 ? 0 : cm + 1;
    const nextY = cm + 1 > 11 ? cy + 1 : cy;
    const defaultDue = nextY + '-' + String(nextM + 1).padStart(2, '0') + '-' + String(this.settings.due_day || 5).padStart(2, '0');
    const monthOpts = MONTH_LABELS.map((lbl, i) => '<option value="' + cy + '-' + String(i + 1).padStart(2, '0') + '"' + (i === cm ? ' selected' : '') + '>' + lbl + '</option>').join('');
    openGlobalModal(
      '<div class="bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-6 rounded-t-2xl flex items-center gap-3">' +
        '<div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">&#128176;</div>' +
        '<div><h3 class="text-xl font-black">Registrar Pago</h3><p class="text-xs text-white/70 font-bold uppercase tracking-widest">Cobro Manual</p></div>' +
      '</div>' +
      '<div class="p-6 bg-slate-50/30" id="modalPaymentBody"><div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
        '<div class="md:col-span-2"><label class="' + lc + '">Estudiante</label>' +
          '<select id="payStudentSelect" class="' + ic + '"><option value="">-- Cargando... --</option></select>' +
          '<div id="payStudentInfo" class="mt-2 hidden p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-700"></div></div>' +
        '<div><label class="' + lc + '">Monto ($)</label><input id="payAmount" type="number" step="0.01" min="0" class="' + ic + '" placeholder="0.00"></div>' +
        '<div><label class="' + lc + '">Concepto</label><input id="payConcept" type="text" class="' + ic + '" value="Mensualidad"></div>' +
        '<div><label class="' + lc + '">Mes que se cobra</label><select id="payMonthPaid" class="' + ic + '">' + monthOpts + '</select></div>' +
        '<div><label class="' + lc + '">Fecha Límite</label><input id="payDueDate" type="date" class="' + ic + '" value="' + defaultDue + '"></div>' +
        '<div><label class="' + lc + '">Método</label><select id="payMethod" class="' + ic + '"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select></div>' +
        '<div><label class="' + lc + '">Estado</label><select id="payStatus" class="' + ic + '"><option value="paid">Pagado</option><option value="pending">Pendiente</option></select></div>' +
      '</div></div>' +
      '<div class="bg-white p-5 rounded-b-2xl border-t border-slate-100 flex justify-end gap-3">' +
        '<button onclick="App.payments.closeModal()" class="px-6 py-2.5 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl">Cancelar</button>' +
        '<button id="btnSavePaymentAction" class="px-8 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg active:scale-95">Registrar Pago</button>' +
      '</div>'
    );
    try {
      const { data: students } = await supabase.from('students').select('id, name, monthly_fee, classroom_id, classrooms:classroom_id(name)').eq('is_active', true).is('deleted_at', null).order('name').limit(200);
      const sel = document.getElementById('payStudentSelect');
      if (sel && students?.length) {
        sel.innerHTML = '<option value="">-- Seleccionar Estudiante --</option>' +
          students.map(s => '<option value="' + s.id + '" data-fee="' + (s.monthly_fee || 0) + '"' + (prefillStudentId && String(s.id) === String(prefillStudentId) ? ' selected' : '') + '>' + Helpers.escapeHTML(s.name) + ' (' + (s?.classrooms?.name || 'Sin aula') + ')</option>').join('');
        sel.addEventListener('change', e => {
          const opt = e.target.selectedOptions[0];
          const fi = document.getElementById('payAmount');
          if (fi && opt?.dataset?.fee > 0) fi.value = opt.dataset.fee;
        });
        if (prefillStudentId) sel.dispatchEvent(new Event('change'));
      }
    } catch (error_) { Helpers.safeLog?.(error_); }
    document.getElementById('btnSavePaymentAction')?.addEventListener('click', () => this.saveManualPayment());
    if (window.lucide) lucide.createIcons();
  },

  closeModal() {
    const c = document.getElementById('globalModalContainer');
    if (c) { c.style.display = 'none'; c.innerHTML = ''; }
  },

  async saveManualPayment() {
    const studentId = document.getElementById('payStudentSelect')?.value;
    const amount    = Number.parseFloat(document.getElementById('payAmount')?.value || 0);
    const concept   = document.getElementById('payConcept')?.value?.trim() || 'Mensualidad';
    const monthPaid = document.getElementById('payMonthPaid')?.value;
    const dueDate   = document.getElementById('payDueDate')?.value;
    const method    = document.getElementById('payMethod')?.value || 'efectivo';
    const status    = document.getElementById('payStatus')?.value || 'paid';
    const paidDate  = status === 'paid' ? new Date().toISOString() : null;
    if (!studentId) return Helpers.toast('Selecciona un estudiante', 'warning');
    if (!amount || amount <= 0) return Helpers.toast('Ingresa un monto válido', 'warning');
    const btn = document.getElementById('btnSavePaymentAction');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
    try {
      const monthPart = (monthPaid || '').split('-')[1];
      const mesN = monthPart ? MONTH_NAMES_ES[Number.parseInt(monthPart, 10) - 1] : null;
      const { data: exList } = await supabase.from('payments').select('id, status').eq('student_id', studentId).or('month_paid.eq.' + monthPaid + ',month_paid.eq.' + (mesN || '')).limit(5);
      const ex = exList?.[0] || null;
      if (ex) {
        if (ex.status === 'paid') { Helpers.toast('Pago ya aprobado para este mes', 'warning'); return; }
        const { error } = await supabase.from('payments').update({ amount, concept, method, status, month_paid: monthPaid, due_date: dueDate || null, paid_date: paidDate }).eq('id', ex.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('payments').insert({ student_id: studentId, amount, concept, method, status, month_paid: monthPaid, due_date: dueDate || null, paid_date: paidDate, created_at: new Date().toISOString() });
        if (error) { if (error.code === '23505') throw new Error('Ya existe un registro para este mes.'); throw error; }
      }
      if (status === 'paid') {
        try {
          await supabase.from('students').update({ is_active: true }).eq('id', studentId);
        } catch (error_) { Helpers.safeLog?.(error_); }
      }
      QueryCache.invalidatePrefix('asistente_payments');
      Helpers.toast('Pago registrado correctamente', 'success');
      this.closeModal();
      await Promise.all([this.loadPayments(), this.loadStats(), this.loadIncomeChart()]);
    } catch (error_) {
      Helpers.toast('Error: ' + (error_.message || 'No se pudo guardar'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Registrar Pago'; }
    }
  },

  async markPaid(id) {
    this._confirmApproval(id);
  },

  _showPostApprovalCTA(paymentId) {
    const p = (AppState.get('paymentsData') || []).find(x => String(x.id) === String(paymentId));
    if (!p) return;
    const student = p?.students || { name: '' };
    const amount = Number(p.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
    const html = `
      <div class="bg-gradient-to-br from-emerald-500 to-teal-600 text-white p-6 rounded-t-2xl flex items-center gap-4">
        <div class="w-14 h-14 rounded-2xl bg-white/25 flex items-center justify-center flex-shrink-0">
          <i data-lucide="check-circle-2" class="w-8 h-8"></i>
        </div>
        <div>
          <h3 class="font-black text-xl leading-tight">¡Pago Aprobado!</h3>
          <p class="text-white/80 font-bold text-sm mt-0.5">${student.name || 'Estudiante'} · $${amount}</p>
        </div>
      </div>
      <div class="p-6 space-y-3 bg-slate-50/40">
        <p class="text-xs font-bold text-slate-500 uppercase tracking-wider">¿Enviar recibo digital al tutor?</p>
        <div class="grid grid-cols-2 gap-3">
          <button id="ctaReceiptChat" class="flex flex-col items-center gap-2 p-4 bg-white rounded-2xl border-2 border-teal-100 hover:border-teal-300 hover:bg-teal-50 transition-all active:scale-95">
            <div class="w-10 h-10 rounded-xl bg-teal-100 text-teal-600 flex items-center justify-center">
              <i data-lucide="message-square" class="w-5 h-5"></i>
            </div>
            <span class="font-black text-xs uppercase tracking-wider text-teal-700">Chat Interno</span>
          </button>
          <button id="ctaReceiptWA" class="flex flex-col items-center gap-2 p-4 bg-white rounded-2xl border-2 border-green-100 hover:border-green-300 hover:bg-green-50 transition-all active:scale-95">
            <div class="w-10 h-10 rounded-xl bg-green-100 text-green-600 flex items-center justify-center">
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
            </div>
            <span class="font-black text-xs uppercase tracking-wider text-green-700">WhatsApp</span>
          </button>
        </div>
      </div>
      <div class="p-4 border-t border-slate-100 rounded-b-2xl bg-white flex justify-end">
        <button id="ctaCloseApproval" class="px-5 py-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl font-black text-xs uppercase transition-all active:scale-95">
          Cerrar
        </button>
      </div>`;
    window.openGlobalModal(html);
    if (window.lucide) lucide.createIcons();

    const closeFn = () => { window.App.ui.closeModal?.(); };
    document.getElementById('ctaCloseApproval')?.addEventListener('click', closeFn);
    document.getElementById('ctaReceiptChat')?.addEventListener('click', () => {
      closeFn();
      this.sendDigitalReceipt(paymentId, 'chat');
    });
    document.getElementById('ctaReceiptWA')?.addEventListener('click', () => {
      closeFn();
      this.sendDigitalReceipt(paymentId, 'whatsapp');
    });
  },

  async _confirmApproval(id) {
    try {
      const { error } = await supabase.from('payments').update({ status: 'paid', paid_date: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      QueryCache.invalidatePrefix('asistente_payments');
      Helpers.toast('Pago aprobado ✅', 'success');
      this.closeModal();
      await this.loadPayments();
      this.loadStats();
      setTimeout(() => this._showPostApprovalCTA(id), 300);
    } catch (error_) { Helpers.toast('Error al aprobar: ' + error_.message, 'error'); }
  },

  async rejectPayment(id, reason) {
    let r = reason;
    if (!r || !String(r).trim()) {
      const modalResult = typeof window._karpusJustifiedConfirm === 'function'
        ? await window._karpusJustifiedConfirm({
            title: 'Rechazar comprobante',
            message: 'El pago volverá a estado Pendiente.',
            confirmLabel: 'Rechazar',
            tone: 'rose',
            icon: 'shield-alert',
            placeholder: 'Justifique el motivo del rechazo (requerido)...',
            requireReason: true
          })
        : null;
      if (!modalResult?.confirmed) return;
      r = modalResult.reason;
    }
    if (!r?.trim()) return Helpers.toast('Debes indicar el motivo', 'warning');
    try {
      const { error } = await supabase.from('payments').update({ status: 'pending', evidence_url: null, notes: r }).eq('id', id);
      if (error) throw error;
      QueryCache.invalidatePrefix('asistente_payments');
      Helpers.toast('Pago rechazado', 'info');
      this.closeModal();
      this.loadPayments();
    } catch (error_) { Helpers.toast('Error al rechazar: ' + error_.message, 'error'); }
  },

  async deletePayment(id) {
    if (!confirm('¿Eliminar este registro?')) return;
    try {
      const { error } = await supabase.from('payments').delete().eq('id', id);
      if (error) throw error;
      QueryCache.invalidatePrefix('asistente_payments');
      Helpers.toast('Eliminado', 'success');
      await this.loadPayments();
    } catch (error_) { Helpers.safeLog?.(error_); Helpers.toast('Error al eliminar', 'error'); }
  },

  async waiveMora(id) {
    const reason = window._karpusPrompt?.('Motivo (opcional):') ?? 'Mora exonerada';
    if (reason === null || reason === undefined) return;
    try {
      const { error } = await supabase.rpc('waive_payment_mora', { p_payment_id: id, p_reason: reason || 'Mora exonerada' });
      if (error) throw error;
      QueryCache.invalidatePrefix('asistente_payments');
      Helpers.toast('Mora eliminada', 'success');
      await this.loadPayments();
    } catch (error_) {
      Helpers.safeLog?.(error_);
      try {
        await supabase.from('payments').update({ due_date: new Date().toISOString().split('T')[0] }).eq('id', id);
        QueryCache.invalidatePrefix('asistente_payments');
        Helpers.toast('Mora eliminada', 'success');
        await this.loadPayments();
      } catch (errorInner) { Helpers.toast('Error: ' + errorInner.message, 'error'); }
    }
  },

  async runCycle() {
    if (!confirm('¿Ejecutar ciclo de pagos?')) return;
    try {
      Helpers.toast('Ejecutando...', 'info');
      const { data, error } = await supabase.rpc('run_payment_cycle');
      if (error) throw error;
      QueryCache.invalidatePrefix('asistente_payments');
      const r = (typeof data === 'string') ? JSON.parse(data) : (data || {});
      Helpers.toast('Ciclo completado: ' + (r.generated || 0) + ' generados, ' + (r.expired || 0) + ' vencidos', 'success');
      await this.loadPayments();
    } catch (error_) { Helpers.toast('Error en ciclo: ' + error_.message, 'error'); }
  }
};
