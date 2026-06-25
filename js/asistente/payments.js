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
