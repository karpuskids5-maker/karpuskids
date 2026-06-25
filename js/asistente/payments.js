import { supabase } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';
import { AppState } from './state.js';
import { sendEmail } from '../shared/supabase.js';
import { calcMora } from '../shared/payment-service.js';

const MONTH_NAMES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MONTH_LABELS   = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function openGlobalModal(html) {
  const c = document.getElementById('globalModalContainer');
  if (!c) return;
  c.innerHTML = '<div class="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">' + html + '</div>';
  c.style.cssText = 'display:flex;align-items:center;justify-content:center;position:fixed;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);z-index:9999;';
  if (window.lucide) lucide.createIcons();
}

function calcStatus(p) {
  if (!p || !p.status) return 'pending';
  const s = p.status.toLowerCase().trim();
  if (s === 'paid') return 'paid';
  if (s === 'review') return 'review';
  if (s === 'overdue') return 'overdue';
  if (s === 'rejected') return 'rejected';
  if (p.evidence_url) return 'review';
  return 'pending';
}

export const PaymentsModule = {
  _financialChart: null,
  settings: { due_day: 5, generation_day: 25 },

  async init() {
    this._initPeriodSelectors();
    await this._loadSettings();
    document.getElementById('filterPaymentMonth')?.addEventListener('change', () => { this.loadPayments(); this.loadIncomeChart(); });
    document.getElementById('filterPaymentYear')?.addEventListener('change',  () => { this.loadPayments(); this.loadIncomeChart(); });
    document.getElementById('filterPaymentStatus')?.addEventListener('change', () => this.loadPayments());
    document.getElementById('searchPaymentStudent')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const cached = AppState.get('paymentsData');
      if (cached && q) { this._renderPaymentRows(cached.filter(p => p.students?.name?.toLowerCase().includes(q))); }
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
      document.querySelectorAll('.status-pill').forEach(p => {
        p.classList.toggle('bg-teal-600', p.dataset.status === status);
        p.classList.toggle('text-white',  p.dataset.status === status);
        p.classList.toggle('bg-slate-100', p.dataset.status !== status);
        p.classList.toggle('text-slate-500', p.dataset.status !== status);
      });
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
    } catch (_) {}
  },

  filterBy(status) {
    const sel = document.getElementById('filterPaymentStatus');
    if (sel) sel.value = status;
    document.querySelectorAll('.status-pill').forEach(p => {
      p.classList.toggle('bg-teal-600',   p.dataset.status === status);
      p.classList.toggle('text-white',    p.dataset.status === status);
      p.classList.toggle('bg-slate-100',  p.dataset.status !== status);
      p.classList.toggle('text-slate-500',p.dataset.status !== status);
    });
    this.loadPayments();
  },

  async loadPayments() {
    const container = document.getElementById('paymentsTableBody');
    if (!container) return;
    container.innerHTML = '<tr><td colspan="7" class="text-center py-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 mx-auto mb-2"></div><p class="text-xs text-slate-400">Cargando pagos...</p></td></tr>';
    this.loadStats();

    try {
      const monthVal  = document.getElementById('filterPaymentMonth')?.value;
      const yearVal   = document.getElementById('filterPaymentYear')?.value || String(new Date().getFullYear());
      const statusFilter = document.getElementById('filterPaymentStatus')?.value || 'all';
      const search    = (document.getElementById('searchPaymentStudent')?.value || '').trim().toLowerCase();

      // Query por año completo + filtro en cliente
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

      // Filtrar por mes en cliente
      if (monthVal) {
        const mk  = yearVal + '-' + String(monthVal).padStart(2, '0');
        const mks = yearVal + '-' + parseInt(monthVal, 10);
        const mkn = MONTH_NAMES_ES[parseInt(monthVal, 10) - 1];
        list = list.filter(p => {
          const mp = (p.month_paid || '').toLowerCase();
          return mp === mk || mp === mks || mp.startsWith(mkn);
        });
      }

      if (search) list = list.filter(p => (p.students?.name || '').toLowerCase().includes(search));

      AppState.set('paymentsData', list);

      if (!list.length) {
        const label = monthVal ? MONTH_LABELS[parseInt(monthVal, 10) - 1] + ' ' + yearVal : 'este periodo';
        container.innerHTML = '<tr><td colspan="7" class="text-center py-16"><div class="flex flex-col items-center gap-3"><div class="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center"><i data-lucide="inbox" class="w-7 h-7 text-slate-400"></i></div><p class="font-bold text-slate-500">Sin registros para ' + label + '</p><p class="text-xs text-slate-400">Prueba cambiando el filtro de estado o mes.</p></div></td></tr>';
        if (window.lucide) lucide.createIcons();
        return;
      }

      container.innerHTML = list.map(p => this._renderRow(p)).join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      container.innerHTML = '<tr><td colspan="7" class="text-center py-8"><p class="text-rose-500 font-bold">Error al cargar: ' + (e.message || 'Intenta recargar') + '</p></td></tr>';
    }
  },

  _renderRow(p) {
    const statusKey = calcStatus(p);
    const st = {
      paid:    { label: 'Aprobado',    cls: 'bg-emerald-100 text-emerald-700', icon: 'check-circle' },
      pending: { label: 'Pendiente',   cls: 'bg-amber-100 text-amber-700',     icon: 'clock' },
      review:  { label: 'En Revisión', cls: 'bg-blue-100 text-blue-700',       icon: 'file-search' },
      overdue: { label: 'Vencido',     cls: 'bg-rose-100 text-rose-700',       icon: 'alert-triangle' },
      rejected:{ label: 'Rechazado',   cls: 'bg-slate-100 text-slate-500',     icon: 'x-circle' }
    }[statusKey] || { label: p.status, cls: 'bg-slate-100 text-slate-500', icon: 'help-circle' };

    const student   = p.students || { name: 'Desconocido', classrooms: { name: '-' } };
    const isPending = statusKey !== 'paid' && statusKey !== 'rejected';
    const ds        = p.due_date ? new Date(p.due_date + 'T00:00:00').toLocaleDateString('es-ES') : '-';
    const amountFmt = Number(p.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const monthFmt  = p.month_paid || '-';
    const hasV      = !!(p.evidence_url || p.proof_url);

    let moraBlock = '';
    if (isPending && p.due_date) {
      const mora = calcMora ? calcMora(p.due_date) : 0;
      if (mora > 0) moraBlock = '<span class="text-[9px] font-black text-rose-600">+' + mora.toLocaleString('es-DO') + ' mora</span>';
      else {
        const diff = Math.round((new Date(p.due_date + 'T00:00:00') - new Date()) / 86400000);
        if (diff === 0) moraBlock = '<span class="text-[9px] font-black text-orange-600">vence hoy</span>';
        else if (diff > 0 && diff <= 5) moraBlock = '<span class="text-[9px] font-black text-amber-600">vence en ' + diff + 'd</span>';
      }
    }

    return '<tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors' + (statusKey === 'overdue' ? ' bg-rose-50/20' : '') + '">' +
      '<td class="px-5 py-3.5"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-black text-sm flex-shrink-0">' + (student.name || '?').charAt(0).toUpperCase() + '</div><div><div class="font-bold text-slate-800 text-sm">' + Helpers.escapeHTML(student.name || '-') + '</div><div class="text-[10px] text-slate-400 uppercase">' + (student.classrooms?.name || 'Sin aula') + '</div></div></div></td>' +
      '<td class="px-5 py-3.5 text-center"><span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ' + st.cls + '"><i data-lucide="' + st.icon + '" class="w-3 h-3"></i>' + st.label + '</span></td>' +
      '<td class="px-5 py-3.5 text-right"><div class="font-black text-slate-800">' + amountFmt + '</div>' + (moraBlock ? '<div class="mt-0.5">' + moraBlock + '</div>' : '') + '</td>' +
      '<td class="px-5 py-3.5"><span class="text-[10px] font-black uppercase text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">' + (p.method || '-') + '</span></td>' +
      '<td class="px-5 py-3.5"><div class="text-[11px] font-bold text-slate-700">' + monthFmt + '</div></td>' +
      '<td class="px-5 py-3.5"><div class="text-[11px] font-bold text-slate-700">' + (p.paid_date ? new Date(p.paid_date).toLocaleDateString('es-ES') : ds) + '</div><div class="text-[9px] text-slate-400 uppercase">' + (p.paid_date ? 'Pagado' : 'Vence') + '</div></td>' +
      '<td class="px-5 py-3.5 text-center">' + (hasV ? '<a href="' + (p.evidence_url || p.proof_url) + '" target="_blank" class="inline-flex items-center gap-1 text-sky-600 text-xs font-bold"><i data-lucide="external-link" class="w-3 h-3"></i>Ver</a>' : '<span class="text-slate-300 text-xs">-</span>') + '</td>' +
      '<td class="px-5 py-3.5 text-center"><div class="flex justify-center gap-1.5">' +
        (isPending ? '<button onclick="App.payments.markPaid(\'' + p.id + '\')" class="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100" title="Aprobar">' + (hasV ? '<span class="relative flex h-3 w-3 absolute -top-1 -right-1"><span class="animate-ping absolute h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span class="relative rounded-full h-3 w-3 bg-emerald-500"></span></span>' : '') + '<i data-lucide="check" class="w-4 h-4"></i></button>' : '') +
        (statusKey === 'review' ? '<button onclick="App.payments.rejectPayment(\'' + p.id + '\')" class="p-1.5 bg-rose-50 text-rose-500 rounded-lg hover:bg-rose-100" title="Rechazar"><i data-lucide="x" class="w-4 h-4"></i></button>' : '') +
        '<button onclick="App.payments.deletePayment(\'' + p.id + '\')" class="p-1.5 bg-slate-50 text-slate-400 rounded-lg hover:bg-rose-100 hover:text-rose-500" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
      '</div></td></tr>';
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
      let data = pays;
      if (mv) {
        const mk = yv + '-' + String(mv).padStart(2,'0');
        const mkn = MONTH_NAMES_ES[parseInt(mv,10)-1];
        data = pays.filter(p => { const mp=(p.month_paid||'').toLowerCase(); return mp===mk||mp===yv+'-'+parseInt(mv)||mp.startsWith(mkn); });
      }
      const now = new Date(); now.setHours(0,0,0,0);
      let income=0, pending=0, overdue=0, review=0;
      data.forEach(p => {
        if (p.status==='paid') { income+=Number(p.amount||0); return; }
        if (p.status==='review') { review++; return; }
        const dd = p.due_date ? new Date(p.due_date+'T00:00:00') : null;
        if (dd && now > dd) overdue++; else pending++;
      });
      const set = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
      set('kpiIncomeMonth', '$' + income.toLocaleString('es-DO', { minimumFractionDigits: 2 }));
      set('kpiPendingCount', pending);
      set('kpiOverdueCount', overdue);
      set('kpiReviewCount', review);
    } catch (_) {}
  },

  async loadIncomeChart() {
    const canvas = document.getElementById('paymentsIncomeChart');
    if (!canvas || !window.Chart) return;
    try {
      const year = document.getElementById('chartYear')?.value || String(new Date().getFullYear());
      const { data: pays } = await supabase.from('payments').select('amount, status, month_paid, created_at')
        .gte('created_at', year + '-01-01').lte('created_at', year + '-12-31');
      const labels = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      const paid = new Array(12).fill(0), pending = new Array(12).fill(0);
      (pays || []).forEach(p => {
        const parts = (p.month_paid || '').split('-');
        let m = parts.length >= 2 ? parseInt(parts[1], 10) - 1 : new Date(p.created_at).getMonth();
        if (m < 0 || m > 11) return;
        if ((p.status || '') === 'paid') paid[m] += Number(p.amount || 0);
        else pending[m] += Number(p.amount || 0);
      });
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
    } catch (_) {}
  },

  async openPaymentModal(prefillStudentId = null) {
    const ic = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-teal-100 focus:border-teal-400 bg-slate-50/50 transition-all text-sm font-medium';
    const lc = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';
    const now = new Date(); const cy = now.getFullYear(); const cm = now.getMonth();
    const nextM = cm+1>11?0:cm+1; const nextY = cm+1>11?cy+1:cy;
    const defaultDue = nextY+'-'+String(nextM+1).padStart(2,'0')+'-'+String(this.settings.due_day||5).padStart(2,'0');
    const monthOpts = MONTH_LABELS.map((lbl,i) => '<option value="'+cy+'-'+String(i+1).padStart(2,'0')+'"'+(i===cm?' selected':'')+'>'+lbl+'</option>').join('');
    openGlobalModal(
      '<div class="bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-6 rounded-t-3xl flex items-center gap-3">' +
        '<div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">&#128176;</div>' +
        '<div><h3 class="text-xl font-black">Registrar Pago</h3><p class="text-xs text-white/70 font-bold uppercase tracking-widest">Cobro Manual</p></div>' +
      '</div>' +
      '<div class="p-6 bg-slate-50/30" id="modalPaymentBody"><div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
        '<div class="md:col-span-2"><label class="'+lc+'">Estudiante</label>' +
          '<select id="payStudentSelect" class="'+ic+'"><option value="">-- Cargando... --</option></select>' +
          '<div id="payStudentInfo" class="mt-2 hidden p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-700"></div></div>' +
        '<div><label class="'+lc+'">Monto ($)</label><input id="payAmount" type="number" step="0.01" min="0" class="'+ic+'" placeholder="0.00"></div>' +
        '<div><label class="'+lc+'">Concepto</label><input id="payConcept" type="text" class="'+ic+'" value="Mensualidad"></div>' +
        '<div><label class="'+lc+'">Mes que se cobra</label><select id="payMonthPaid" class="'+ic+'">'+monthOpts+'</select></div>' +
        '<div><label class="'+lc+'">Fecha Límite</label><input id="payDueDate" type="date" class="'+ic+'" value="'+defaultDue+'"></div>' +
        '<div><label class="'+lc+'">Método</label><select id="payMethod" class="'+ic+'"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select></div>' +
        '<div><label class="'+lc+'">Estado</label><select id="payStatus" class="'+ic+'"><option value="paid">Pagado</option><option value="pending">Pendiente</option></select></div>' +
      '</div></div>' +
      '<div class="bg-white p-5 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">' +
        '<button onclick="App.payments.closeModal()" class="px-6 py-2.5 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl">Cancelar</button>' +
        '<button id="btnSavePaymentAction" class="px-8 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg active:scale-95">Registrar Pago</button>' +
      '</div>'
    );
    try {
      const { data: students } = await supabase.from('students').select('id, name, monthly_fee, classroom_id, classrooms:classroom_id(name)').eq('is_active', true).is('deleted_at', null).order('name').limit(200);
      const sel = document.getElementById('payStudentSelect');
      if (sel && students?.length) {
        sel.innerHTML = '<option value="">-- Seleccionar Estudiante --</option>' +
          students.map(s => '<option value="'+s.id+'" data-fee="'+(s.monthly_fee||0)+'"'+(prefillStudentId&&String(s.id)===String(prefillStudentId)?' selected':'')+'>'+Helpers.escapeHTML(s.name)+' ('+(s.classrooms?.name||'Sin aula')+')</option>').join('');
        sel.addEventListener('change', e => {
          const opt = e.target.selectedOptions[0];
          const fi = document.getElementById('payAmount');
          if (fi && opt?.dataset?.fee > 0) fi.value = opt.dataset.fee;
        });
        if (prefillStudentId) sel.dispatchEvent(new Event('change'));
      }
    } catch (_) {}
    document.getElementById('btnSavePaymentAction')?.addEventListener('click', () => this.saveManualPayment());
    if (window.lucide) lucide.createIcons();
  },

  closeModal() {
    const c = document.getElementById('globalModalContainer');
    if (c) { c.style.display = 'none'; c.innerHTML = ''; }
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
    if (!amount || amount <= 0) return Helpers.toast('Ingresa un monto válido', 'warning');
    const btn = document.getElementById('btnSavePaymentAction');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
    try {
      const mesN = MONTH_NAMES_ES[parseInt((monthPaid||'').split('-')[1],10)-1];
      const { data: exList } = await supabase.from('payments').select('id, status').eq('student_id', studentId).or('month_paid.eq.'+monthPaid+',month_paid.eq.'+(mesN||'')).limit(5);
      const ex = exList?.[0] || null;
      if (ex) {
        if (ex.status === 'paid') { Helpers.toast('Pago ya aprobado para este mes', 'warning'); return; }
        const { error } = await supabase.from('payments').update({ amount, concept, method, status, month_paid: monthPaid, due_date: dueDate||null, paid_date: paidDate }).eq('id', ex.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('payments').insert({ student_id: studentId, amount, concept, method, status, month_paid: monthPaid, due_date: dueDate||null, paid_date: paidDate, created_at: new Date().toISOString() });
        if (error) { if (error.code==='23505') throw new Error('Ya existe un registro para este mes.'); throw error; }
      }
      if (status === 'paid') await supabase.from('students').update({ is_active: true }).eq('id', studentId).catch(() => {});
      Helpers.toast('Pago registrado correctamente', 'success');
      this.closeModal();
      await Promise.all([this.loadPayments(), this.loadStats(), this.loadIncomeChart()]);
    } catch (e) {
      Helpers.toast('Error: ' + (e.message || 'No se pudo guardar'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Registrar Pago'; }
    }
  },

  async markPaid(id) {
    const p = (AppState.get('paymentsData') || []).find(x => String(x.id) === String(id));
    if (p?.evidence_url || p?.proof_url) { this._confirmApproval(id); return; }
    this._confirmApproval(id);
  },

  async _confirmApproval(id) {
    try {
      const { error } = await supabase.from('payments').update({ status: 'paid', paid_date: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      Helpers.toast('Pago aprobado ✅', 'success');
      this.closeModal();
      this.loadPayments(); this.loadStats();
    } catch (e) { Helpers.toast('Error al aprobar: ' + e.message, 'error'); }
  },

  async rejectPayment(id, reason) {
    const r = reason || prompt('Motivo del rechazo:');
    if (!r?.trim()) return Helpers.toast('Debes indicar el motivo', 'warning');
    try {
      const { error } = await supabase.from('payments').update({ status: 'pending', evidence_url: null, notes: r }).eq('id', id);
      if (error) throw error;
      Helpers.toast('Pago rechazado', 'info');
      this.closeModal(); this.loadPayments();
    } catch (e) { Helpers.toast('Error al rechazar: ' + e.message, 'error'); }
  },

  async deletePayment(id) {
    if (!confirm('¿Eliminar este registro?')) return;
    try {
      const { error } = await supabase.from('payments').delete().eq('id', id);
      if (error) throw error;
      Helpers.toast('Eliminado', 'success');
      await this.loadPayments();
    } catch (_) { Helpers.toast('Error al eliminar', 'error'); }
  },

  async waiveMora(id) {
    const reason = prompt('Motivo (opcional):') ?? 'Mora exonerada';
    if (reason === null) return;
    try {
      const { data, error } = await supabase.rpc('waive_payment_mora', { p_payment_id: id, p_reason: reason || 'Mora exonerada' });
      if (error) throw error;
      Helpers.toast('Mora eliminada', 'success');
      await this.loadPayments();
    } catch (_) {
      try {
        await supabase.from('payments').update({ due_date: new Date().toISOString().split('T')[0] }).eq('id', id);
        Helpers.toast('Mora eliminada', 'success');
        await this.loadPayments();
      } catch (e2) { Helpers.toast('Error: ' + e2.message, 'error'); }
    }
  },

  async runCycle() {
    if (!confirm('¿Ejecutar ciclo de pagos?')) return;
    try {
      Helpers.toast('Ejecutando...', 'info');
      const { data, error } = await supabase.rpc('run_payment_cycle');
      if (error) throw error;
      const r = (typeof data === 'string') ? JSON.parse(data) : (data || {});
      Helpers.toast('Ciclo completado: ' + (r.generated || 0) + ' generados, ' + (r.expired || 0) + ' vencidos', 'success');
      await this.loadPayments();
    } catch (e) { Helpers.toast('Error en ciclo: ' + e.message, 'error'); }
  }
};
