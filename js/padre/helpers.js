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
 * 🛠️ HELPERS GLOBALES
 */
export const Helpers = {
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
   * Estado vacío visual
   */
  emptyState: (msg, icon = '✨') => `
    <div class="flex flex-col items-center justify-center py-12 px-4 text-center opacity-60 animate-fade-in">
      <div class="text-4xl mb-3">${icon}</div>
      <p class="text-sm font-bold text-slate-400 uppercase tracking-widest">${escapeHtml(msg)}</p>
    </div>`,

  /**
   * Skeleton loader
   */
  skeleton: (count = 3, height = 'h-24') => 
    Array.from({ length: count }, () => `
      <div class="animate-pulse bg-slate-100 rounded-3xl ${height} w-full mb-4"></div>
    `).join(''),

  /**
   * Formatear moneda
   */
  formatCurrency: (val) => 
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(val || 0)),

  /**
   * Formatear fecha local segura
   */
  formatDate: (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  /**
   * Delegación de eventos segura
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
 * 📧 ENVÍO DE EMAILS (Proxy a Edge Function)
 */
export async function sendEmail(to, subject, html) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sesión expirada');

    const res = await fetch(`${import.meta.env?.VITE_SUPABASE_URL || ''}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ to, subject, html })
    });

    return res.ok;
  } catch (e) {
    console.error('Email error:', e);
    return false;
  }
}
