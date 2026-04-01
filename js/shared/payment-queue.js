/**
 * 🔍 PaymentQueue — Cola de verificación de vouchers
 * Panel Asistente y Directora: lista de comprobantes pendientes de validar.
 * Incluye visor de imagen, OCR con Tesseract y detección de duplicados.
 */
import { PaymentService } from './payment-service.js';
import { Helpers } from './helpers.js';

export const PaymentQueue = {
  _channel: null,

  /**
   * Renderiza la cola en un contenedor dado.
   * @param {string} containerId  — ID del div donde se renderiza
   * @param {object} opts         — { accentColor, onApprove, onReject }
   */
  async init(containerId, opts = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    await this._render(container, opts);

    // Realtime: actualizar cuando llega un nuevo voucher
    if (this._channel) {
      const { supabase } = await import('./supabase.js');
      supabase.removeChannel(this._channel);
    }
    this._channel = PaymentService.subscribeToNewVouchers((p) => {
      this._showNewVoucherToast(p);
      this._render(container, opts);
    });
  },

  async _render(container, opts) {
    container.innerHTML = `<div class="flex justify-center py-8"><div class="animate-spin w-8 h-8 border-2 border-indigo-500 rounded-full border-t-transparent"></div></div>`;
    try {
      const list = await PaymentService.getPendingValidation();
      if (!list.length) {
        container.innerHTML = `
          <div class="flex flex-col items-center justify-center py-16 text-slate-400">
            <div class="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-4">
              <svg class="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
            </div>
            <p class="font-bold text-slate-600">Todo al día</p>
            <p class="text-sm text-slate-400 mt-1">No hay comprobantes pendientes de validar.</p>
          </div>`;
        return;
      }

      container.innerHTML = `
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-black text-slate-800 flex items-center gap-2">
            <span class="w-6 h-6 bg-amber-500 text-white rounded-full flex items-center justify-center text-xs font-black">${list.length}</span>
            Pendientes de Validación
          </h3>
          <button onclick="PaymentQueue.init('${container.id}')" class="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            Actualizar
          </button>
        </div>
        <div class="space-y-4" id="queue-list">
          ${list.map(p => this._card(p)).join('')}
        </div>`;

      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('[PaymentQueue]', e);
      container.innerHTML = `<p class="text-center text-rose-500 py-8 text-sm font-bold">Error al cargar la cola.</p>`;
    }
  },

  _card(p) {
    const student = p.students || {};
    const amount  = Helpers.formatCurrency(Number(p.amount || 0));
    const date    = new Date(p.created_at).toLocaleDateString('es-ES', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    const imgUrl  = p.evidence_url || '';
    const isImg   = /\.(jpg|jpeg|png|webp|gif)$/i.test(imgUrl);

    return `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" id="qcard-${p.id}">
        <div class="flex items-center gap-3 p-4 border-b border-slate-100">
          <div class="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-black text-sm shrink-0">
            ${Helpers.escapeHTML((student.name||'?').charAt(0).toUpperCase())}
          </div>
          <div class="min-w-0 flex-1">
            <div class="font-bold text-slate-800 text-sm truncate">${Helpers.escapeHTML(student.name||'Desconocido')}</div>
            <div class="text-[10px] text-slate-400 font-bold uppercase">${Helpers.escapeHTML(student.classrooms?.name||'Sin aula')} · ${Helpers.escapeHTML(p.month_paid||'-')}</div>
          </div>
          <div class="text-right shrink-0">
            <div class="font-black text-slate-800">${amount}</div>
            <div class="text-[10px] text-slate-400">${date}</div>
          </div>
        </div>

        ${imgUrl ? `
        <div class="relative bg-slate-50 border-b border-slate-100">
          ${isImg
            ? `<img src="${imgUrl}" alt="Voucher" class="w-full max-h-64 object-contain cursor-zoom-in" onclick="window.openLightbox && window.openLightbox('${imgUrl}','image')" loading="lazy">`
            : `<div class="p-4 flex items-center gap-3"><svg class="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><a href="${imgUrl}" target="_blank" class="text-sm font-bold text-blue-600 hover:underline">Ver documento adjunto</a></div>`
          }
          ${isImg ? `
          <button onclick="PaymentQueue.runOCR('${p.id}','${imgUrl}')"
            class="absolute bottom-2 right-2 flex items-center gap-1.5 bg-white/90 backdrop-blur-sm border border-slate-200 text-slate-700 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase shadow-sm hover:bg-slate-50 transition-colors">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            Leer con OCR
          </button>` : ''}
        </div>` : ''}

        ${p.excuse_text ? `
        <div class="px-4 py-3 bg-violet-50 border-b border-violet-100">
          <p class="text-[10px] font-black text-violet-700 uppercase mb-1">📝 Excusa del padre:</p>
          <p class="text-xs text-violet-800 italic">"${Helpers.escapeHTML(p.excuse_text)}"</p>
          ${p.excuse_approved === null ? `
          <div class="flex gap-2 mt-2">
            <button onclick="PaymentQueue.approveExcuse('${p.id}')"
              class="flex-1 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase hover:bg-emerald-700 transition-colors">
              ✅ Aprobar excusa
            </button>
            <button onclick="PaymentQueue.rejectExcuse('${p.id}')"
              class="flex-1 py-1.5 bg-rose-50 text-rose-600 rounded-lg text-[10px] font-black uppercase hover:bg-rose-100 transition-colors">
              ❌ Rechazar
            </button>
          </div>` : `<p class="text-[9px] font-black mt-1 ${p.excuse_approved ? 'text-emerald-600' : 'text-rose-600'}">${p.excuse_approved ? '✅ Excusa aprobada' : '❌ Excusa rechazada'}</p>`}
        </div>` : ''}

        <div id="ocr-result-${p.id}" class="hidden px-4 py-3 bg-blue-50 border-b border-blue-100 text-xs font-mono text-blue-800"></div>
        <div id="dup-alert-${p.id}" class="hidden px-4 py-3 bg-rose-50 border-b border-rose-200 text-xs font-bold text-rose-700 flex items-center gap-2">
          <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          <span></span>
        </div>

        <div class="flex gap-2 p-4">
          <button onclick="PaymentQueue.approve('${p.id}')"
            class="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs uppercase transition-colors shadow-sm active:scale-95">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
            Aprobar
          </button>
          <button onclick="PaymentQueue.reject('${p.id}')"
            class="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 rounded-xl font-black text-xs uppercase transition-colors active:scale-95">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
            Rechazar
          </button>
        </div>
      </div>`;
  },

  /** Ejecutar OCR con Tesseract en la imagen del voucher */
  async runOCR(paymentId, imgUrl) {
    const resultEl = document.getElementById(`ocr-result-${paymentId}`);
    const dupEl    = document.getElementById(`dup-alert-${paymentId}`);
    if (!resultEl) return;

    resultEl.classList.remove('hidden');
    resultEl.textContent = '🔍 Leyendo imagen...';

    try {
      if (!window.Tesseract) {
        resultEl.textContent = '⚠️ Tesseract no disponible. Verifica el comprobante manualmente.';
        return;
      }

      const { data: { text } } = await window.Tesseract.recognize(imgUrl, 'spa+eng', {
        logger: () => {}
      });

      // Extraer referencia bancaria (números de 6-20 dígitos)
      const refMatch = text.match(/\b\d{6,20}\b/g);
      const ref = refMatch ? refMatch[0] : null;

      // Extraer monto (patrones como $1,234.56 o 1234.56)
      const amtMatch = text.match(/[\$RD]?\s*[\d,]+\.?\d{0,2}/g);
      const detectedAmount = amtMatch ? amtMatch[0].replace(/[^0-9.]/g, '') : null;

      resultEl.innerHTML = `
        <div class="font-bold mb-1">📄 Texto detectado:</div>
        <div class="text-[10px] leading-relaxed opacity-80 max-h-24 overflow-y-auto">${Helpers.escapeHTML(text.slice(0, 400))}</div>
        ${ref ? `<div class="mt-2 font-black text-blue-900">🔢 Referencia detectada: <span class="bg-blue-200 px-1.5 py-0.5 rounded">${ref}</span></div>` : ''}
        ${detectedAmount ? `<div class="font-black text-blue-900">💰 Monto detectado: <span class="bg-blue-200 px-1.5 py-0.5 rounded">$${detectedAmount}</span></div>` : ''}`;

      // Verificar duplicado si se detectó referencia
      if (ref && dupEl) {
        const dup = await PaymentService.checkDuplicate(ref);
        if (dup) {
          dupEl.classList.remove('hidden');
          dupEl.querySelector('span').textContent =
            `⚠️ DUPLICADO: Esta referencia ya fue registrada para ${dup.students?.name || 'otro estudiante'} (${dup.month_paid}).`;
        }
      }
    } catch (e) {
      resultEl.textContent = '❌ Error al leer imagen: ' + (e.message || 'desconocido');
    }
  },

  /** Aprobar desde la cola */
  async approve(id) {
    const card = document.getElementById(`qcard-${id}`);
    if (card) {
      card.style.opacity = '0.5';
      card.style.pointerEvents = 'none';
    }
    try {
      await PaymentService.approve(id);
      Helpers.toast('✅ Pago aprobado y notificación enviada al padre', 'success');
      card?.remove();
      // Actualizar contador
      const list = document.getElementById('queue-list');
      if (list && !list.children.length) {
        list.innerHTML = `<p class="text-center text-emerald-600 font-bold py-8">🎉 ¡Cola vacía! Todo validado.</p>`;
      }
    } catch (e) {
      Helpers.toast('Error al aprobar: ' + e.message, 'error');
      if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; }
    }
  },

  /** Rechazar desde la cola */
  async reject(id) {
    const reason = prompt('Motivo del rechazo (se enviará al padre):') ?? null;
    if (reason === null) return;
    const card = document.getElementById(`qcard-${id}`);
    if (card) { card.style.opacity = '0.5'; card.style.pointerEvents = 'none'; }
    try {
      await PaymentService.reject(id, reason);
      Helpers.toast('Pago rechazado. Padre notificado.', 'success');
      card?.remove();
    } catch (e) {
      Helpers.toast('Error al rechazar: ' + e.message, 'error');
      if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; }
    }
  },

  /** Aprobar excusa del padre */
  async approveExcuse(id) {
    try {
      await PaymentService.reviewExcuse(id, true);
      Helpers.toast('✅ Excusa aprobada. Mora suspendida.', 'success');
      const container = document.getElementById('payment-queue-container');
      if (container) await this._render(container, {});
    } catch (e) { Helpers.toast('Error: ' + e.message, 'error'); }
  },

  /** Rechazar excusa del padre */
  async rejectExcuse(id) {
    const note = prompt('Motivo del rechazo (se enviará al padre):') ?? null;
    if (note === null) return;
    try {
      await PaymentService.reviewExcuse(id, false, note);
      Helpers.toast('Excusa rechazada. Padre notificado.', 'success');
      const container = document.getElementById('payment-queue-container');
      if (container) await this._render(container, {});
    } catch (e) { Helpers.toast('Error: ' + e.message, 'error'); }
  },

  /** Toast cuando llega un nuevo voucher en tiempo real */
  _showNewVoucherToast(p) {
    const student = p.students?.name || 'Un padre';
    const amount  = Helpers.formatCurrency(Number(p.amount || 0));
    const toast   = document.createElement('div');
    toast.className = 'fixed top-5 right-5 z-[9999] flex items-center gap-3 bg-white border-2 border-amber-400 rounded-2xl shadow-2xl px-5 py-4 max-w-sm animate-bounce-in';
    toast.innerHTML = `
      <div class="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-xl shrink-0">💳</div>
      <div class="min-w-0">
        <p class="font-black text-slate-800 text-sm">Nuevo comprobante</p>
        <p class="text-xs text-slate-500 truncate">${Helpers.escapeHTML(student)} · ${amount}</p>
      </div>
      <button onclick="this.parentElement.remove()" class="ml-2 text-slate-300 hover:text-slate-500 shrink-0">✕</button>`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.4s'; setTimeout(() => toast.remove(), 400); }, 8000);
  }
};

// Exponer globalmente para los onclick inline
window.PaymentQueue = PaymentQueue;
