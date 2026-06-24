import { supabase } from '../shared/supabase.js';

export const DATE_FORMAT = { locale: 'es-ES', options: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' } };
export const TOAST_DURATION = 2800;

const escapeHtmlMap = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
};

export const escapeHtml = (str = '') => {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, m => escapeHtmlMap[m]);
};

/**
 * ??? HELPERS GLOBALES
 */
export const Helpers = {
  /**
   * 📳 Haptic Feedback (Vibración sutil para móvil)
   */
  vibrate(style = 'light') {
    if (!('vibrate' in navigator)) return;
    
    try {
      const patterns = {
        light: 10,
        medium: 20,
        heavy: 40,
        success: [10, 40, 10],
        error: [60, 100, 60]
      };
      navigator.vibrate(patterns[style] || 10);
    } catch (e) {
      // Silenciar error de navegador por falta de interacción
    }
  },

  /**
   * 🛡️ Escapar HTML
   */
  escapeHTML(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
  // Alias para compatibilidad
  escapeHtml(str = '') {
    return this.escapeHTML(str);
  },

  /**
   * 🪟 Loading overlay global
   */
  showLoader(msg = 'Cargando...') {
    this.hideLoader();
    const el = document.createElement('div');
    el.id = 'globalLoader';
    el.className = `
      fixed
      inset-0
      bg-white/70
      backdrop-blur-sm
      flex
      items-center
      justify-center
      z-[999]
    `;
    el.innerHTML = `
      <div class="
        flex
        flex-col
        items-center
        gap-4
        p-8
        bg-white
        rounded-3xl
        shadow-xl
      ">
        <div class="
          w-10
          h-10
          border-4
          border-slate-200
          border-t-indigo-500
          rounded-full
          animate-spin
        "></div>
        <p class="text-sm font-bold text-slate-600">
          ${this.escapeHTML(msg)}
        </p>
      </div>
    `;
    document.body.appendChild(el);
  },

  hideLoader() {
    document.getElementById('globalLoader')?.remove();
  },

  /**
   * 🆔 Generar id
   */
  uid() {
    return crypto.randomUUID();
  },

  /**
   * ⏱️ Sleep async
   */
  sleep(ms = 300) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * 🛡️ try/catch global con logging
   */
  async safe(fn, context = 'global') {
    try {
      return await fn();
    } catch (err) {
      console.error(`[Safe:${context}]`, err);
      this.toast('Algo no salió bien. El equipo técnico ha sido notificado.', 'error');
      return null;
    }
  },

  /**
   * Toast notification profesional
   */
  toast: (() => {
    let activeToasts = 0;
    const MAX_TOASTS = 3;

    return (message, type = 'success') => {
      if (activeToasts >= MAX_TOASTS) return;
      activeToasts++;

      const map = {
        success: 'bg-emerald-500',
        error: 'bg-rose-500',
        info: 'bg-sky-500',
        warning: 'bg-amber-500'
      };

      const toast = document.createElement('div');
      toast.className = `fixed bottom-6 right-6 ${map[type] || map.info} text-white px-5 py-3 rounded-2xl shadow-xl z-[9999] transition-all duration-300 opacity-0 translate-y-4 flex items-center gap-3`;
      toast.innerHTML = `<span class="text-sm font-bold">${escapeHtml(message)}</span>`;

      document.body.appendChild(toast);
      requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', 'translate-y-4');
        toast.classList.add('opacity-100', 'translate-y-0');
      });

      setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => {
          toast.remove();
          activeToasts--;
        }, 300);
      }, TOAST_DURATION);
    };
  })(),

  /**
   * Estado vac�o visual
   */
  emptyState: (msg, icon = '?') => `
    <div class="flex flex-col items-center justify-center py-12 px-4 text-center opacity-60 animate-fade-in">
      <div class="text-4xl mb-3">${icon}</div>
      <p class="text-sm font-bold text-slate-400 uppercase tracking-widest">${escapeHtml(msg)}</p>
    </div>`,

  /**
   * Skeleton loader mejorado con Shimmer
   */
  skeleton: (count = 3, height = 'h-24') => 
    Array.from({ length: count }, () => `
      <div class="skeleton-shimmer bg-slate-100 rounded-3xl ${height} w-full mb-4 opacity-50"></div>
    `).join(''),

  /**
   * Formatear moneda
   */
  formatCurrency: (val) => {
    const num = Number(val || 0);
    return num.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  /**
   * Formatear fecha local segura
   */
  formatDate: (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  /**
   * ?? Calcular mora por d�as de retraso
   * Regla: mora empieza el d�a 6 del mes siguiente (d�a despu�s del vencimiento d�a 5)
   * Tasa: 5% del monto base por cada 30 d�as de retraso (m�nimo 1 d�a = 1 d�a de mora)
   * Se aplica sobre el monto base del pago
   */
  calculateMora(dueDate, baseAmount = 0) {
    if (!dueDate) return 0;
    const today = new Date(); today.setHours(0,0,0,0);
    const due   = new Date(dueDate + 'T00:00:00');
    const daysLate = Math.floor((today - due) / 86400000);
    if (daysLate <= 0) return 0;
    // 5% mensual = 0.1667% diario
    const dailyRate = 0.05 / 30;
    return Math.round(Number(baseAmount || 0) * dailyRate * daysLate * 100) / 100;
  },

  /**
   * ?? Desglose de mora para mostrar en UI
   */
  getMoraBreakdown(dueDate, baseAmount = 0) {
    if (!dueDate) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const due   = new Date(dueDate + 'T00:00:00');
    const daysLate = Math.floor((today - due) / 86400000);
    if (daysLate <= 0) return null;
    const mora = this.calculateMora(dueDate, baseAmount);
    const weeks = Math.floor(daysLate / 7);
    const formattedText = daysLate === 1 ? '1 d�a de retraso'
      : daysLate < 7  ? `${daysLate} d�as de retraso`
      : weeks === 1   ? '1 semana de retraso'
      : `${weeks} semanas de retraso`;
    return { daysLate, mora, formattedText };
  },

  /**
   * Delegaci�n de eventos segura
   */
  delegate: (el, selector, event, handler) => {
    el.addEventListener(event, (e) => {
      const target = e.target.closest(selector);
      if (target && el.contains(target)) {
        handler.call(target, e, target);
      }
    });
  }
};

/**
 * ?? ENV�O DE EMAILS (Proxy a Edge Function)
 */
export async function sendEmail(to, subject, html) {
  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to, subject, html }
    });

    if (error) {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}
