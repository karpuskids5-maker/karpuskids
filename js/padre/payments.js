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
    await this.loadPayments();
  },

  async loadPayments() {
    const container = document.getElementById('paymentsHistory');
    if (!container) return;
    container.innerHTML = Helpers.skeleton(3, 'h-24');
    try {
      const { data, error } = await supabase
        .from(TABLES.PAYMENTS)
        .select('id,student_id,amount,concept,status,due_date,created_at,paid_date,method,month_paid,evidence_url,notes')
        .eq('student_id', this._studentId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Deduplicar por mes
      const monthMap = new Map();
      for (const p of data || []) {
        const key = (p.month_paid || 'varios').toLowerCase();
        const ex  = monthMap.get(key);
        if (!ex) { monthMap.set(key, p); continue; }
        if (p.evidence_url && !ex.evidence_url) { monthMap.set(key, p); continue; }
        if (new Date(p.created_at) > new Date(ex.created_at)) monthMap.set(key, p);
      }
      this._payments = Array.from(monthMap.values())
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      if (!this._payments.length) {
        container.innerHTML = Helpers.emptyState('No hay registros de pagos', 'credit-card');
        return;
      }
      this._renderAlertBanner(this._payments);
      container.innerHTML = this._payments.map(p => this._renderCard(p)).join('');
      if (window.lucide) lucide.createIcons();
    } catch (err) {
      console.error('[PaymentsModule]', err);
      container.innerHTML = Helpers.emptyState('Error al cargar pagos', 'alert-triangle');
    }
  },

  _renderAlertBanner(payments) {
    const banner = document.getElementById('paymentAlertBanner');
    if (!banner) return;
    const urgent = payments
      .filter(p => !['paid','pagado','confirmado'].includes((p.status||'').toLowerCase()))
      .map(p => ({ ...p, days: daysUntilDue(p.due_date) }))
      .filter(p => p.days !== null)
      .sort((a, b) => a.days - b.days)[0];

    if (!urgent) { banner.classList.add('hidden'); return; }
    const days   = urgent.days;
    const amount = Helpers.formatCurrency(Number(urgent.amount || 0));
    const month  = urgent.month_paid || 'tu mensualidad';
    let cfg;

    if (days < 0) {
      const mora = calcMora(urgent.due_date);
      cfg = {
        bg: 'bg-gradient-to-r from-rose-500 to-red-600',
        icon: '🚨',
        title: `Pago vencido — ${month}`,
        msg: mora > 0
          ? `${Math.abs(days)} días de retraso. Mora: ${Helpers.formatCurrency(mora)}`
          : `${Math.abs(days)} días de retraso. Paga cuanto antes.`,
        btn: 'Pagar ahora', btnCls: 'bg-white text-rose-600'
      };
    } else if (days === 0) {
      cfg = {
        bg: 'bg-gradient-to-r from-orange-500 to-amber-500',
        icon: '⏰',
        title: `¡Hoy vence tu pago! — ${month}`,
        msg: `Último día para pagar ${amount} sin recargo.`,
        btn: 'Enviar comprobante', btnCls: 'bg-white text-orange-600'
      };
    } else if (days <= 3) {
      cfg = {
        bg: 'bg-gradient-to-r from-amber-400 to-yellow-500',
        icon: '📅',
        title: `Vence en ${days} día${days > 1 ? 's' : ''} — ${month}`,
        msg: `Paga ${amount} antes del ${new Date(urgent.due_date + 'T00:00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'long' })} para evitar recargos.`,
        btn: 'Pagar a tiempo', btnCls: 'bg-white text-amber-700'
      };
    } else if (days <= 7) {
      cfg = {
        bg: 'bg-gradient-to-r from-blue-500 to-indigo-500',
        icon: '💡',
        title: `Recordatorio — ${month}`,
        msg: `Tu pago de ${amount} vence en ${days} días.`,
        btn: 'Ver detalles', btnCls: 'bg-white text-blue-700'
      };
    } else {
      banner.classList.add('hidden');
      return;
    }

    banner.classList.remove('hidden');
    banner.innerHTML = `
      <div class="${cfg.bg} rounded-2xl px-5 py-4 flex items-center gap-3 shadow-lg">
        <div class="text-2xl shrink-0">${cfg.icon}</div>
        <div class="flex-1 min-w-0">
          <p class="font-black text-white text-sm">${cfg.title}</p>
          <p class="text-white/80 text-xs font-medium mt-0.5">${cfg.msg}</p>
        </div>
        <button onclick="document.getElementById('paymentForm')?.scrollIntoView({behavior:'smooth'})"
          class="${cfg.btnCls} font-black text-xs px-4 py-2 rounded-xl shrink-0 active:scale-95 transition-transform whitespace-nowrap">
          ${cfg.btn}
        </button>
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
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all mb-4 overflow-hidden ${sc.border}">
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

  async submitPaymentProof(e) {
    e.preventDefault();
    const student = AppState.get('currentStudent');
    if (!student) return;
    const fileInput = document.getElementById('paymentFileInput');
    const file   = fileInput?.files[0];
    const amount = parseFloat(document.getElementById('paymentAmount')?.value || '0');
    const month  = document.getElementById('paymentMonth')?.value?.trim();
    const method = document.getElementById('paymentMethod')?.value || 'transferencia';
    const bank   = document.getElementById('paymentBank')?.value?.trim() || null;

    if (!file)   { Helpers.toast('Adjunta el comprobante', 'warning'); return; }
    if (!amount || amount <= 0 || amount > 99999) { Helpers.toast('Ingresa un monto válido (mayor a 0)', 'warning'); return; }
    if (!month)  { Helpers.toast('Selecciona el mes', 'warning'); return; }
    if (!bank)   { Helpers.toast('Selecciona el banco de origen', 'warning'); return; }
    if (file.size > 5 * 1024 * 1024) { Helpers.toast('Archivo muy grande (max 5MB)', 'error'); return; }
    if (!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)) {
      Helpers.toast('Formato no permitido (JPG, PNG, PDF)', 'error'); return;
    }

    const btn = document.getElementById('btnSubmitPayment');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
    try {
      Helpers.toast('Subiendo comprobante...', 'info');
      const ext  = file.name.split('.').pop().toLowerCase();
      const path = `payments/${student.id}_${Date.now()}.${ext}`;
      let uploadFile = file;
      if (file.type.startsWith('image/')) {
        try { uploadFile = await this._compressImage(file, 800, 0.8); } catch (_) {}
      }
      const { error: upErr } = await supabase.storage.from('classroom_media').upload(path, uploadFile);
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('classroom_media').getPublicUrl(path);

      const existing = this._payments.find(p =>
        (p.month_paid||'').toLowerCase() === month.toLowerCase() &&
        !['paid','pagado','confirmado'].includes((p.status||'').toLowerCase())
      );
      if (existing) {
        const { error } = await supabase.from(TABLES.PAYMENTS)
          .update({ evidence_url: publicUrl, status: 'review', method, bank }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(TABLES.PAYMENTS).insert({
          student_id: student.id, amount, month_paid: month,
          method, bank, evidence_url: publicUrl, status: 'review',
          created_at: new Date().toISOString()
        });
        if (error) throw error;
      }
      this._showSuccessConfirmation(amount, month, bank);
      e.target.reset();
      await this.loadPayments();

      // Notificar al staff que hay un comprobante nuevo
      const student = AppState.get('currentStudent');
      emitEvent('payment.receipt_uploaded', {
        student_id:   student?.id,
        student_name: student?.name || 'Estudiante',
        amount:       amount.toFixed(2),
        month
      }).catch(() => {});
    } catch (err) {
      console.error('[submitPaymentProof]', err);
      Helpers.toast('Error al enviar: ' + (err.message || ''), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar Comprobante'; }
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
