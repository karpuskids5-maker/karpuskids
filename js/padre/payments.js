/**
 * 💳 Panel Padre — Módulo de Pagos (limpio, sin columnas inexistentes)
 */
import { supabase } from '../shared/supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';
import { calcMora, getMoraBreakdown, normalizeStatus, daysUntilDue } from '../shared/payment-service.js';
import { emitEvent } from '../shared/supabase.js';

export const PaymentsModule = {
  _studentId: null,
  _payments:  [],

  async init(studentId) {
    if (!studentId) return;
    this._studentId = studentId;
    const form = document.getElementById('paymentForm');
    if (form) form.onsubmit = (e) => this.submitPaymentProof(e);
    this._initMoraCalculator();
    await this.loadPayments();
  },

  /**
   * 🧮 Mora auto-calculator — sugiere el total con recargo si ya pasó el día 5
   */
  _initMoraCalculator() {
    const amountInput = document.getElementById('paymentAmount');
    const monthSelect = document.getElementById('paymentMonth');
    if (!amountInput || !monthSelect) return;

    const update = () => {
      const hint    = document.getElementById('moraCalculatorHint');
      const baseEl  = document.getElementById('moraBase');
      const moraEl  = document.getElementById('moraAmount');
      const totalEl = document.getElementById('moraTotal');
      const labelEl = document.getElementById('moraLabel');
      if (!hint) return;

      const base     = parseFloat(amountInput.value) || 0;
      const monthVal = monthSelect.value; // YYYY-MM
      if (!base || !monthVal) { hint.classList.add('hidden'); return; }

      // Build due_date: day 5 of the selected month
      const [yr, mo] = monthVal.split('-').map(Number);
      const dueDate  = `${yr}-${String(mo).padStart(2,'0')}-05`;
      const mora     = calcMora(dueDate);
      const breakdown = getMoraBreakdown(dueDate);

      if (mora <= 0) { hint.classList.add('hidden'); return; }

      const fmt = (n) => Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (baseEl)  baseEl.textContent  = fmt(base);
      if (moraEl)  moraEl.textContent  = '+' + fmt(mora);
      if (totalEl) totalEl.textContent = fmt(base + mora);
      if (labelEl && breakdown) labelEl.textContent = `Mora (${breakdown.formattedText}):`;
      hint.classList.remove('hidden');

      // "Aplicar total" button
      const btn = document.getElementById('btnApplyMora');
      if (btn) {
        btn.onclick = () => {
          amountInput.value = (base + mora).toFixed(2);
          hint.classList.add('hidden');
        };
      }
    };

    amountInput.addEventListener('input', update);
    monthSelect.addEventListener('change', update);
    // Run once in case month is pre-selected
    update();
  },

  async loadPayments() {
    const container = document.getElementById('paymentsHistory');
    if (!container) return;

    const today = new Date();
    const isDay25OrLater = today.getDate() >= 25;

    container.innerHTML = Helpers.skeleton(3, 'h-24');
    try {
      const { data, error } = await supabase
        .from(TABLES.PAYMENTS)
        .select('id,student_id,amount,concept,status,due_date,created_at,paid_date,method,month_paid,evidence_url,notes')
        .eq('student_id', this._studentId)
        .order('due_date', { ascending: false });
      if (error) throw error;

      // Deduplicar: por mes — normalizar month_paid a YYYY-MM para comparar
      // Handles both '2026-04' and 'Abril' formats
      const MONTH_MAP = {
        'enero':'01','febrero':'02','marzo':'03','abril':'04','mayo':'05','junio':'06',
        'julio':'07','agosto':'08','septiembre':'09','octubre':'10','noviembre':'11','diciembre':'12'
      };
      const normalizeMonth = (mp) => {
        if (!mp) return '';
        const s = mp.toLowerCase().trim();
        // Already YYYY-MM
        if (/^\d{4}-\d{2}$/.test(s)) return s;
        // Spanish month name — use current year
        const num = MONTH_MAP[s];
        if (num) return `${new Date().getFullYear()}-${num}`;
        return s;
      };

      const statusPriority = { paid: 4, review: 3, overdue: 2, pending: 1 };
      const monthMap = new Map();
      for (const p of data || []) {
        const key = normalizeMonth(p.month_paid);
        const ex  = monthMap.get(key);
        if (!ex) { monthMap.set(key, p); continue; }
        const pPri  = statusPriority[(p.status||'').toLowerCase()] || 0;
        const exPri = statusPriority[(ex.status||'').toLowerCase()] || 0;
        if (pPri > exPri) { monthMap.set(key, p); continue; }
        if (pPri === exPri) {
          if (p.evidence_url && !ex.evidence_url) { monthMap.set(key, p); continue; }
          if (new Date(p.created_at) > new Date(ex.created_at)) monthMap.set(key, p);
        }
      }
      
      // Filter: always show paid, only show pending/overdue if day >= 25
      let allPayments = Array.from(monthMap.values());
      let filteredPayments = allPayments.filter(p => {
        const isPaid = ['paid'].includes((p.status||'').toLowerCase());
        return isPaid || isDay25OrLater;
      });
      
      this._payments = filteredPayments
        .sort((a, b) => {
          // Sort: pending/overdue first (by due_date asc), then paid (by paid_date desc)
          const aIsPaid = ['paid'].includes((a.status||'').toLowerCase());
          const bIsPaid = ['paid'].includes((b.status||'').toLowerCase());
          if (!aIsPaid && !bIsPaid) return new Date(a.due_date||0) - new Date(b.due_date||0);
          if (!aIsPaid) return -1;
          if (!bIsPaid) return 1;
          return new Date(b.paid_date||b.created_at) - new Date(a.paid_date||a.created_at);
        });

      if (!this._payments.length) {
        if (isDay25OrLater) {
          container.innerHTML = Helpers.emptyState('No hay registros de pagos', 'credit-card');
        } else {
          // If no paid payments and not day25+
          container.innerHTML = Helpers.emptyState('No hay pagos registrados aún. Los pagos pendientes se mostrarán a partir del día 25 del mes.', 'lock');
        }
        return;
      }
      this._renderAlertBanner(allPayments);
      container.innerHTML = this._payments.map(p => this._renderCard(p)).join('');

      // Update header stats (always calculate from all payments)
      const paidTotal = allPayments
        .filter(p => ['paid'].includes((p.status||'').toLowerCase()))
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      const el = document.getElementById('paymentsBalance');
      if (el) el.textContent = Helpers.formatCurrency(paidTotal);

      if (window.lucide) lucide.createIcons();
    } catch (err) {
      container.innerHTML = Helpers.emptyState('Error al cargar pagos', 'alert-triangle');
    }
  },

  _renderAlertBanner(payments) {
    const banner = document.getElementById('paymentAlertBanner');
    if (!banner) return;

    const today = new Date();
    const isDay25OrLater = today.getDate() >= 25;
    
    const pending = payments.filter(p => !['paid'].includes((p.status||'').toLowerCase()));
    const totalDebt = pending.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    
    const urgent = pending
      .map(p => ({ ...p, days: daysUntilDue(p.due_date) }))
      .filter(p => p.days !== null)
      .sort((a, b) => a.days - b.days)[0];

    if ((!urgent || !isDay25OrLater) && totalDebt <= 0) {
      // ✅ Mostrar estado al día si no hay pendientes (even before day 25)
      banner.classList.remove('hidden');
      banner.innerHTML = `
        <div class="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-3xl p-5 shadow-lg">
          <div class="flex items-center gap-4">
            <div class="text-2xl shrink-0">✨</div>
            <div class="flex-1 min-w-0">
              <p class="font-black text-white text-base leading-tight">¡Estás al día!</p>
              <p class="text-white/80 text-sm font-medium mt-1 leading-relaxed">No tienes pagos pendientes registrados. ¡Gracias!</p>
            </div>
            <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <i data-lucide="check" class="w-5 h-5 text-white"></i>
            </div>
          </div>
        </div>`;
      if (window.lucide) lucide.createIcons();
      return;
    }
    
    // If before day25, hide the alert for pending payments
    if (!isDay25OrLater) {
      banner.classList.add('hidden');
      return;
    }

    const days   = urgent?.days ?? 0;
    const amount = Helpers.formatCurrency(totalDebt);
    const month  = urgent?.month_paid || 'tus mensualidades';
    let cfg;

    if (days < 0) {
      const mora = calcMora(urgent.due_date);
      cfg = {
        bg: 'bg-gradient-to-r from-rose-500 to-red-600',
        icon: '🚨',
        title: `Pagos pendientes — ${amount}`,
        msg: `Tienes ${pending.length} pago(s) pendiente(s). ${month} venció hace ${Math.abs(days)} días.`,
        btn: 'Pagar ahora', btnCls: 'bg-white text-rose-600'
      };
    } else if (days === 0) {
      cfg = {
        bg: 'bg-gradient-to-r from-orange-500 to-amber-500',
        icon: '⏰',
        title: `Hoy vence un pago — ${amount}`,
        msg: `Último día para pagar ${month} sin recargos.`,
        btn: 'Enviar comprobante', btnCls: 'bg-white text-orange-600'
      };
    } else if (days <= 3) {
      cfg = {
        bg: 'bg-gradient-to-r from-amber-400 to-yellow-500',
        icon: '📅',
        title: `Próximo vencimiento — ${amount}`,
        msg: `${month} vence en ${days} días. Evita recargos pagando a tiempo.`,
        btn: 'Pagar a tiempo', btnCls: 'bg-white text-amber-700'
      };
    } else if (days <= 7 || totalDebt > 0) {
      cfg = {
        bg: 'bg-gradient-to-r from-blue-500 to-indigo-500',
        icon: '💡',
        title: `Saldo pendiente — ${amount}`,
        msg: `Recuerda realizar tu pago de ${month} antes de su vencimiento.`,
        btn: 'Ver detalles', btnCls: 'bg-white text-blue-700'
      };
    } else {
      banner.classList.add('hidden');
      return;
    }

    banner.classList.remove('hidden');
    banner.innerHTML = `
      <div class="${cfg.bg} rounded-2xl p-4 shadow-lg overflow-hidden">
        <div class="flex items-start gap-3">
          <div class="text-xl shrink-0 mt-0.5">${cfg.icon}</div>
          <div class="flex-1 min-w-0 overflow-hidden">
            <p class="font-black text-white text-sm leading-tight truncate">${cfg.title}</p>
            <p class="text-white/80 text-xs font-medium mt-1 leading-relaxed break-words">${cfg.msg}</p>
            <button onclick="document.getElementById('paymentForm')?.scrollIntoView({behavior:'smooth'})"
              class="${cfg.btnCls} font-black text-xs px-4 py-2 rounded-xl mt-3 inline-block active:scale-95 transition-transform whitespace-nowrap">
              ${cfg.btn}
            </button>
          </div>
        </div>
      </div>`;
  },

  _renderCard(p) {
    const status   = normalizeStatus(p);
    const isPaid   = status === 'paid';
    const amount   = Number(p.amount || 0);
    const mora     = isPaid ? 0 : calcMora(p.due_date);
    const moraInfo = isPaid ? null : getMoraBreakdown(p.due_date);
    const total    = amount + mora;
    const days     = daysUntilDue(p.due_date);

    const SC = {
      paid:      { label: 'Aprobado',    cls: 'bg-emerald-100 text-emerald-700', icon: 'check-circle',   border: '' },
      review:    { label: 'En Revisión', cls: 'bg-blue-100 text-blue-700',       icon: 'clock',          border: '' },
      overdue:   { label: 'Vencido',     cls: 'bg-rose-100 text-rose-700',       icon: 'alert-triangle', border: 'border-l-4 border-l-rose-500' },
      rechazado: { label: 'Rechazado',   cls: 'bg-rose-100 text-rose-700',       icon: 'x-circle',       border: 'border-l-4 border-l-rose-400' },
      pending:   { label: 'Pendiente',   cls: 'bg-amber-100 text-amber-700',     icon: 'alert-circle',   border: '' }
    };
    const sc = SC[status] || SC.pending;

    let urgencyBadge = '';
    if (!isPaid && days !== null) {
      if (days < 0)        urgencyBadge = `<span class="text-[9px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">${Math.abs(days)}d vencido</span>`;
      else if (days === 0) urgencyBadge = `<span class="text-[9px] font-black text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full">vence hoy</span>`;
      else if (days <= 3)  urgencyBadge = `<span class="text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">vence en ${days}d</span>`;
    }

    return `
      <div class="bg-white rounded-3xl border border-slate-100 overflow-hidden ${sc.border} mb-3 ${isPaid ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all active:scale-[0.99]' : ''}"
        ${isPaid ? `onclick="PaymentsModule.openReceipt('${p.id}')"` : ''}>
        <div class="p-5">
          <div class="flex justify-between items-start gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-11 h-11 rounded-2xl ${mora > 0 ? 'bg-rose-50 text-rose-500' : (isPaid ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')} flex items-center justify-center text-xl shrink-0">
                ${mora > 0 ? '⚠️' : (isPaid ? '✅' : (p.method === 'transferencia' ? '🏦' : '💵'))}
              </div>
              <div class="min-w-0">
                <p class="font-black text-slate-800 text-sm truncate">${escapeHtml(p.month_paid || 'Colegiatura')}</p>
                <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span class="text-[9px] font-bold text-slate-400 uppercase">${Helpers.formatDate(p.created_at)}</span>
                  ${p.bank ? `<span class="text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">🏦 ${escapeHtml(p.bank)}</span>` : ''}
                  ${urgencyBadge}
                </div>
                ${p.due_date && !isPaid ? `<p class="text-[9px] font-black uppercase mt-0.5 ${mora > 0 ? 'text-rose-500' : 'text-slate-400'}">Vence: ${new Date(p.due_date + 'T00:00:00').toLocaleDateString('es-DO')}</p>` : ''}
              </div>
            </div>
            <div class="text-right shrink-0">
              <p class="font-black text-slate-900 text-lg leading-none">${Helpers.formatCurrency(isPaid ? amount : total)}</p>
              <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase mt-1 ${sc.cls}">
                <i data-lucide="${sc.icon}" class="w-3 h-3"></i>${sc.label}
              </span>
              ${isPaid ? `<p class="text-[9px] text-emerald-600 font-bold mt-1 flex items-center justify-end gap-0.5"><i data-lucide="download" class="w-3 h-3"></i> Ver recibo</p>` : ''}
            </div>
          </div>

          ${moraInfo ? `
          <div class="mt-3 p-3 bg-rose-50 rounded-2xl border border-rose-100">
            <div class="flex justify-between items-center">
              <span class="text-[10px] font-black text-rose-700 uppercase">Recargo por mora (${moraInfo.formattedText})</span>
              <span class="text-xs font-black text-rose-700">+${Helpers.formatCurrency(mora)}</span>
            </div>
            <div class="flex justify-between items-center mt-1 pt-1 border-t border-rose-200/50">
              <span class="text-[10px] font-black text-slate-500 uppercase">Monto base</span>
              <span class="text-xs font-bold text-slate-500">${Helpers.formatCurrency(amount)}</span>
            </div>
          </div>` : ''}

          ${p.evidence_url && !isPaid ? `
          <div class="mt-3 pt-3 border-t border-slate-50 flex justify-between items-center">
            <p class="text-[10px] font-bold text-slate-400 italic">Comprobante enviado. Esperando validación.</p>
            <a href="${p.evidence_url}" target="_blank" class="text-[10px] font-black text-blue-600 hover:underline flex items-center gap-1">Ver <i data-lucide="external-link" class="w-3 h-3"></i></a>
          </div>` : ''}
        </div>
      </div>`;
  },

  /**
   * 🧾 openReceipt — Modal de recibo PDF para pagos aprobados
   * Genera descarga real con jsPDF
   */
  async openReceipt(paymentId) {
    // Buscar en cache local primero
    const cached = this._payments?.find(x => String(x.id) === String(paymentId));
    let p = cached || { id: paymentId };

    // Obtener datos frescos del pago con info del estudiante y quien aprobó
    let payment = p;
    try {
      const { data } = await supabase
        .from('payments')
        .select(`
          id, amount, concept, status, month_paid, due_date, paid_date,
          method, bank, reference, notes,
          validated_by,
          students:student_id (
            name, p1_name, p1_email, p2_name,
            classrooms:classroom_id ( name )
          )
        `)
        .eq('id', p.id)
        .maybeSingle();
      if (data) payment = data;
    } catch (_) {}

    // Obtener nombre de quien aprobó
    let approvedBy = 'Administración';
    if (payment.validated_by) {
      try {
        const { data: approver } = await supabase
          .from('profiles')
          .select('name, role')
          .eq('id', payment.validated_by)
          .maybeSingle();
        if (approver?.name) approvedBy = approver.name;
      } catch (_) {}
    }

    const student    = payment.students || {};
    const studentName = student.name || 'Estudiante';
    const parentName  = student.p1_name || 'Padre/Tutor';
    const classroom   = student.classrooms?.name || 'Sin aula';
    const amount      = Number(payment.amount || 0);
    const amountFmt   = Helpers.formatCurrency(amount);
    const monthPaid   = payment.month_paid || 'Mensualidad';
    const paidDate    = payment.paid_date
      ? new Date(payment.paid_date).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' })
      : new Date().toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' });
    const method      = (payment.method || 'efectivo').charAt(0).toUpperCase() + (payment.method || 'efectivo').slice(1);
    const receiptNo   = `KK-${String(payment.id).slice(-6).toUpperCase().padStart(6,'0')}`;

    // Construir modal
    const modal = document.createElement('div');
    modal.id = 'receiptModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:24px;width:100%;max-width:480px;max-height:90dvh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,0.25);">
        <!-- Header corporativo -->
        <div style="background:linear-gradient(135deg,#16a34a,#15803d);padding:28px 28px 20px;border-radius:24px 24px 0 0;text-align:center;position:relative;">
          <button onclick="document.getElementById('receiptModal').remove()"
            style="position:absolute;top:14px;right:14px;background:rgba(255,255,255,0.2);border:none;color:white;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;line-height:1;">×</button>
          <div style="width:56px;height:56px;background:rgba(255,255,255,0.95);border-radius:16px;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.2);">
            <img src="img/mundo.jpg" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';this.parentElement.innerHTML='🎓'">
          </div>
          <h2 style="margin:0;color:white;font-family:sans-serif;font-size:20px;font-weight:900;letter-spacing:-0.3px;">Karpus Kids</h2>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-family:sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">Recibo de Pago Oficial</p>
          <div style="margin-top:14px;background:rgba(255,255,255,0.15);border-radius:10px;padding:8px 16px;display:inline-block;">
            <span style="color:white;font-family:monospace;font-size:13px;font-weight:900;letter-spacing:2px;">${receiptNo}</span>
          </div>
        </div>

        <!-- Sello de aprobado -->
        <div style="background:#f0fdf4;border-bottom:1px solid #bbf7d0;padding:12px 28px;display:flex;align-items:center;gap:10px;">
          <div style="width:36px;height:36px;background:#16a34a;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:white;font-size:18px;">✓</span>
          </div>
          <div>
            <p style="margin:0;font-family:sans-serif;font-size:13px;font-weight:900;color:#15803d;">Pago Confirmado y Aprobado</p>
            <p style="margin:2px 0 0;font-family:sans-serif;font-size:11px;color:#16a34a;font-weight:600;">Aprobado por: ${approvedBy}</p>
          </div>
        </div>

        <!-- Cuerpo del recibo -->
        <div style="padding:24px 28px;">
          <!-- Info estudiante -->
          <div style="background:#f8fafc;border-radius:14px;padding:16px;margin-bottom:16px;border:1px solid #e2e8f0;">
            <p style="margin:0 0 10px;font-family:sans-serif;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;">Datos del Estudiante</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div>
                <p style="margin:0;font-family:sans-serif;font-size:10px;color:#64748b;font-weight:600;">Estudiante</p>
                <p style="margin:2px 0 0;font-family:sans-serif;font-size:13px;font-weight:800;color:#1e293b;">${studentName}</p>
              </div>
              <div>
                <p style="margin:0;font-family:sans-serif;font-size:10px;color:#64748b;font-weight:600;">Aula</p>
                <p style="margin:2px 0 0;font-family:sans-serif;font-size:13px;font-weight:800;color:#1e293b;">${classroom}</p>
              </div>
              <div>
                <p style="margin:0;font-family:sans-serif;font-size:10px;color:#64748b;font-weight:600;">Padre/Tutor</p>
                <p style="margin:2px 0 0;font-family:sans-serif;font-size:13px;font-weight:800;color:#1e293b;">${parentName}</p>
              </div>
              <div>
                <p style="margin:0;font-family:sans-serif;font-size:10px;color:#64748b;font-weight:600;">Fecha de Pago</p>
                <p style="margin:2px 0 0;font-family:sans-serif;font-size:13px;font-weight:800;color:#1e293b;">${paidDate}</p>
              </div>
            </div>
          </div>

          <!-- Detalle del pago -->
          <div style="border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;margin-bottom:16px;">
            <div style="background:#f8fafc;padding:10px 16px;border-bottom:1px solid #e2e8f0;">
              <p style="margin:0;font-family:sans-serif;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;">Detalle del Pago</p>
            </div>
            <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px;">
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:10px 16px;color:#64748b;font-weight:600;">Concepto</td>
                <td style="padding:10px 16px;text-align:right;font-weight:800;color:#1e293b;">${monthPaid}</td>
              </tr>
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:10px 16px;color:#64748b;font-weight:600;">Método de Pago</td>
                <td style="padding:10px 16px;text-align:right;font-weight:800;color:#1e293b;">${method}</td>
              </tr>
              ${payment.bank ? `<tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:10px 16px;color:#64748b;font-weight:600;">Banco</td><td style="padding:10px 16px;text-align:right;font-weight:800;color:#1e293b;">${payment.bank}</td></tr>` : ''}
              ${payment.reference ? `<tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:10px 16px;color:#64748b;font-weight:600;">Referencia</td><td style="padding:10px 16px;text-align:right;font-weight:700;color:#475569;font-size:11px;">${payment.reference}</td></tr>` : ''}
              <tr style="background:#f0fdf4;">
                <td style="padding:12px 16px;color:#15803d;font-weight:900;font-size:15px;">TOTAL PAGADO</td>
                <td style="padding:12px 16px;text-align:right;font-weight:900;color:#15803d;font-size:18px;">${amountFmt}</td>
              </tr>
            </table>
          </div>

          <!-- Footer del recibo -->
          <div style="text-align:center;padding:12px;background:#f8fafc;border-radius:12px;border:1px dashed #e2e8f0;">
            <p style="margin:0;font-family:sans-serif;font-size:10px;color:#94a3b8;font-weight:600;">San Cristóbal, República Dominicana</p>
            <p style="margin:4px 0 0;font-family:sans-serif;font-size:10px;color:#94a3b8;">Este recibo es un comprobante oficial de pago de Karpus Kids.</p>
            <p style="margin:4px 0 0;font-family:monospace;font-size:9px;color:#cbd5e1;">ID: ${receiptNo} · ${new Date().toLocaleDateString('es-DO')}</p>
          </div>
        </div>

        <!-- Botones de acción -->
        <div style="padding:16px 28px 24px;display:flex;gap:10px;">
          <button id="btnDownloadPDF"
            style="flex:1;padding:14px;background:linear-gradient(135deg,#16a34a,#15803d);color:white;border:none;border-radius:14px;font-family:sans-serif;font-size:13px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 12px rgba(22,163,74,0.35);">
            📥 Descargar PDF
          </button>
          <button onclick="document.getElementById('receiptModal').remove()"
            style="padding:14px 20px;background:#f1f5f9;color:#475569;border:none;border-radius:14px;font-family:sans-serif;font-size:13px;font-weight:800;cursor:pointer;">
            Cerrar
          </button>
        </div>
      </div>`;

    // Cerrar al hacer click fuera
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);

    // Botón de descarga PDF con jsPDF
    modal.querySelector('#btnDownloadPDF').addEventListener('click', () => {
      this._downloadReceiptPDF({
        receiptNo, studentName, parentName, classroom, paidDate,
        method, bank: payment.bank, reference: payment.reference,
        monthPaid, amountFmt, approvedBy, amount
      });
    });
  },

  /**
   * 📄 Genera y descarga el recibo como PDF usando jsPDF
   */
  async _downloadReceiptPDF(data) {
    const btn = document.getElementById('btnDownloadPDF');
    if (btn) { btn.textContent = '⏳ Generando...'; btn.disabled = true; }

    try {
      // Cargar jsPDF si no está disponible
      if (!window.jspdf) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'js/shared/jspdf.min.js';
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
      const W = doc.internal.pageSize.getWidth();

      // ── Header verde ──────────────────────────────────────────
      doc.setFillColor(22, 163, 74);
      doc.roundedRect(0, 0, W, 42, 0, 0, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text('Karpus Kids', W / 2, 16, { align: 'center' });
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text('RECIBO DE PAGO OFICIAL', W / 2, 23, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont('courier', 'bold');
      doc.text(data.receiptNo, W / 2, 33, { align: 'center' });

      // ── Sello aprobado ────────────────────────────────────────
      doc.setFillColor(240, 253, 244);
      doc.rect(0, 42, W, 16, 'F');
      doc.setTextColor(21, 128, 61);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('Pago Confirmado y Aprobado', 14, 51);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(`Aprobado por: ${data.approvedBy}`, 14, 57);

      // ── Datos del estudiante ──────────────────────────────────
      let y = 68;
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(10, y - 5, W - 20, 36, 3, 3, 'F');
      doc.setTextColor(148, 163, 184);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.text('DATOS DEL ESTUDIANTE', 14, y);
      y += 6;

      const col2 = W / 2 + 2;
      const infoRows = [
        ['Estudiante', data.studentName, 'Aula', data.classroom],
        ['Padre/Tutor', data.parentName, 'Fecha de Pago', data.paidDate]
      ];
      doc.setFontSize(8);
      for (const [l1, v1, l2, v2] of infoRows) {
        doc.setTextColor(100, 116, 139); doc.setFont('helvetica', 'normal');
        doc.text(l1, 14, y); doc.text(l2, col2, y);
        doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold');
        doc.text(String(v1), 14, y + 4); doc.text(String(v2), col2, y + 4);
        y += 11;
      }

      // ── Detalle del pago ──────────────────────────────────────
      y += 2;
      doc.setTextColor(148, 163, 184);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.text('DETALLE DEL PAGO', 14, y);
      y += 6;

      const detailRows = [
        ['Concepto', data.monthPaid],
        ['Método de Pago', data.method],
        ...(data.bank ? [['Banco', data.bank]] : []),
        ...(data.reference ? [['Referencia', data.reference]] : [])
      ];

      doc.setFontSize(9);
      for (const [label, value] of detailRows) {
        doc.setTextColor(100, 116, 139); doc.setFont('helvetica', 'normal');
        doc.text(label, 14, y);
        doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold');
        doc.text(String(value), W - 14, y, { align: 'right' });
        doc.setDrawColor(241, 245, 249);
        doc.line(14, y + 2, W - 14, y + 2);
        y += 9;
      }

      // Total row
      doc.setFillColor(240, 253, 244);
      doc.roundedRect(10, y - 4, W - 20, 12, 2, 2, 'F');
      doc.setTextColor(21, 128, 61);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('TOTAL PAGADO', 14, y + 4);
      doc.text(data.amountFmt, W - 14, y + 4, { align: 'right' });
      y += 18;

      // ── Footer ────────────────────────────────────────────────
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(10, y, W - 20, 20, 3, 3, 'F');
      doc.setTextColor(148, 163, 184);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text('San Cristóbal, República Dominicana', W / 2, y + 6, { align: 'center' });
      doc.text('Este recibo es un comprobante oficial de pago de Karpus Kids.', W / 2, y + 11, { align: 'center' });
      doc.setFont('courier', 'normal');
      doc.text(`ID: ${data.receiptNo} · ${new Date().toLocaleDateString('es-DO')}`, W / 2, y + 16, { align: 'center' });

      doc.save(`Recibo-${data.receiptNo}.pdf`);
      Helpers.toast('Recibo descargado', 'success');
    } catch (err) {
      console.error('Error generando PDF:', err);
      Helpers.toast('Error al generar PDF', 'error');
    } finally {
      if (btn) { btn.textContent = '📥 Descargar PDF'; btn.disabled = false; }
    }
  },

  async submitPaymentProof(e) {
    if (e && e.preventDefault) e.preventDefault();
    
    const student = AppState.get('currentStudent');
    if (!student) return;

    // Rate limit: máx 3 comprobantes por hora
    const { checkRateLimit, paymentProofLimiter } = await import('../shared/rate-limiter.js');
    if (!checkRateLimit(paymentProofLimiter, 'enviar comprobantes')) return;

    const fileInput = document.getElementById('paymentFileInput');
    const file   = fileInput?.files[0];
    const amount = parseFloat(document.getElementById('paymentAmount')?.value || '0');
    const monthRaw = document.getElementById('paymentMonth')?.value?.trim();
    const method = document.getElementById('paymentMethod')?.value || 'transferencia';
    const bank   = document.getElementById('paymentBank')?.value?.trim() || null;

    if (!file)   { Helpers.toast('Adjunta el comprobante', 'warning'); return; }
    if (!amount || amount <= 0 || amount > 99999) { Helpers.toast('Ingresa un monto válido (mayor a 0)', 'warning'); return; }
    if (!monthRaw) { Helpers.toast('Selecciona el mes', 'warning'); return; }
    if (!bank)   { Helpers.toast('Selecciona el banco de origen', 'warning'); return; }
    
    // Normalizar mes para búsqueda (Abril 2026 -> 2026-04)
    const month = monthRaw.includes(' ') ? (monthRaw.split(' ')[1] + '-' + {
      'Enero':'01','Febrero':'02','Marzo':'03','Abril':'04','Mayo':'05','Junio':'06',
      'Julio':'07','Agosto':'08','Septiembre':'09','Octubre':'10','Noviembre':'11','Diciembre':'12'
    }[monthRaw.split(' ')[0]] || monthRaw) : monthRaw;

    if (file.size > 5 * 1024 * 1024) { Helpers.toast('Archivo muy grande (max 5MB)', 'error'); return; }
    if (!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)) {
      Helpers.toast('Formato no permitido (JPG, PNG, PDF)', 'error'); return;
    }

    const btn = document.getElementById('btnSubmitPayment');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

    // Barra de progreso visual
    const progressWrap = document.createElement('div');
    progressWrap.id = 'payment-upload-progress';
    progressWrap.className = 'mt-3 w-full bg-slate-100 rounded-full h-2 overflow-hidden';
    progressWrap.innerHTML = '<div id="payment-progress-fill" class="h-full bg-green-500 rounded-full transition-all duration-300" style="width:5%"></div>';
    btn?.parentElement?.insertBefore(progressWrap, btn.nextSibling);
    const setP = (p) => { const f = document.getElementById('payment-progress-fill'); if(f) f.style.width = p + '%'; };

    try {
      Helpers.toast('Subiendo comprobante...', 'info');
      const ext  = file.name.split('.').pop().toLowerCase();
      const path = `payments/${student.id}_${Date.now()}.${ext}`;
      let uploadFile = file;
      
      // Comprimir imagen si es necesario
      if (file.type.startsWith('image/')) {
        try {
          const { ImageLoader } = await import('../shared/image-loader.js');
          uploadFile = await ImageLoader.compress(file, { maxWidth: 1000, maxHeight: 1000, quality: 0.8, maxSizeKB: 400 });
        } catch (err) {
          console.warn('Fallo compresión, subiendo original:', err);
        }
      }

      setP(20);
      const { error: upErr } = await supabase.storage.from('classroom_media').upload(path, uploadFile, {
        onUploadProgress: (progress) => {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          setP(percent);
        }
      });
      if (upErr) throw upErr;
      
      setP(95);
      const { data: { publicUrl } } = supabase.storage.from('classroom_media').getPublicUrl(path);

      // 🔍 Buscar registro existente (Vencido o Pendiente) para este mes
      // Intentamos con el formato normalizado YYYY-MM y con el original
      const { data: existingPayments, error: fetchErr } = await supabase
        .from(TABLES.PAYMENTS)
        .select('id, status, month_paid')
        .eq('student_id', student.id)
        .or(`month_paid.eq."${month}",month_paid.eq."${monthRaw}"`)
        .neq('status', 'paid')
        .limit(1);

      if (fetchErr) throw fetchErr;
      const existing = existingPayments?.[0] || null;

      if (existing) {
        // UPDATE: Cambiar a revisión y adjuntar comprobante
        const { error: updateErr } = await supabase.from(TABLES.PAYMENTS)
          .update({ 
            evidence_url: publicUrl, 
            status: 'review', 
            method, 
            bank
          })
          .eq('id', existing.id);
        if (updateErr) throw updateErr;
      } else {
        // INSERT: Crear nuevo registro en revisión si no existe
        const { error: insertErr } = await supabase.from(TABLES.PAYMENTS).insert({
          student_id: student.id, 
          amount, 
          month_paid: month,
          method, 
          bank, 
          evidence_url: publicUrl, 
          status: 'review',
          created_at: new Date().toISOString()
        });
        if (insertErr) throw insertErr;
      }
      
      this._showSuccessConfirmation(amount, monthRaw, bank);
      setP(100);

      // ✅ ÉXITO: Confetti
      if (window.confetti) {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#10b981', '#3b82f6', '#f59e0b']
        });
      }
      
      setTimeout(() => {
        document.getElementById('payment-upload-progress')?.remove();
      }, 1500);
      
      const form = document.getElementById('paymentForm');
      if (form) form.reset();
      
      // Forzar recarga de datos en AppState y UI
      await this.loadPayments();
      
      // Notificar al staff en tiempo real
      emitEvent('payment.receipt_uploaded', {
        student_id:   student.id,
        student_name: student.name,
        amount:       amount.toFixed(2),
        month:        monthRaw
      }).catch(() => {});

    } catch (err) {
      console.error('Error en submitPaymentProof:', err);
      document.getElementById('payment-upload-progress')?.remove();
      Helpers.toast('Error al enviar: ' + (err.message || 'Error desconocido'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar Reporte'; }
    }
  },

  _showSuccessConfirmation(amount, month, bank = '') {
    const container = document.getElementById('paymentsHistory');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-4 mb-4 flex items-center gap-3';
    el.innerHTML = `<div class="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white text-xl shrink-0">✅</div>
      <div>
        <p class="font-black text-emerald-800 text-sm">Comprobante enviado correctamente</p>
        <p class="text-[10px] font-bold text-emerald-600 uppercase">${Helpers.formatCurrency(amount)} · ${month}${bank ? ' · ' + bank : ''} · En revisión</p>
      </div>`;
    container.insertBefore(el, container.firstChild);
    setTimeout(() => { el.style.opacity='0'; el.style.transition='opacity 0.4s'; setTimeout(()=>el.remove(),400); }, 8000);
  },

  _compressImage(file, maxWidth=800, quality=0.8) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          blob => blob ? resolve(new File([blob], file.name, {type:'image/jpeg'})) : reject(new Error('Compresión fallida')),
          'image/jpeg', quality
        );
      };
      img.onerror = reject;
      img.src = url;
    });
  }
};

window.PaymentsModule = PaymentsModule;
