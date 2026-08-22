import { SafeAppState } from '../shared/state.js';

const FILTERS_PREFIX = 'karpus_asistente_filters__v1__';

function _serializeFilters(obj) {
  try { return JSON.stringify(obj || {}); } catch (err) { return '{}'; }
}
function _deserializeFilters(str) {
  if (!str) return null;
  try { const v = JSON.parse(str); return typeof v === 'object' && v ? v : null; } catch (err) { return null; }
}

/**
 * Store simple para persistir y recuperar filtros en localStorage.
 * API pública: save(key, value) / load(key, defaultValue) / clear(key) / clearAll()
 */
export const FiltersStore = {
  save(key, value) {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const fullKey = FILTERS_PREFIX + String(key);
      window.localStorage.setItem(fullKey, _serializeFilters(value));
    } catch (err) { /* ignore quota / privacy errors */ }
  },
  load(key, defaultValue = null) {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return defaultValue;
      const fullKey = FILTERS_PREFIX + String(key);
      const raw = window.localStorage.getItem(fullKey);
      const value = _deserializeFilters(raw);
      return value === null ? defaultValue : value;
    } catch (err) { return defaultValue; }
  },
  clear(key) {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const fullKey = FILTERS_PREFIX + String(key);
      window.localStorage.removeItem(fullKey);
    } catch (err) { /* ignore */ }
  },
  clearAll() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(FILTERS_PREFIX)) keys.push(k);
      }
      keys.forEach(k => window.localStorage.removeItem(k));
    } catch (err) { /* ignore */ }
  }
};

// Exponer globalmente para los módulos que usan window._kkFiltersStore
if (typeof window !== 'undefined') {
  window._kkFiltersStore = FiltersStore;
  window._karpusPrompt = (message, defaultValue = '') => {
    try { return window.prompt(message, defaultValue); } catch (err) { return defaultValue; }
  };

  window._karpusJustifiedConfirm = (opts = {}) => new Promise((resolve) => {
    const title = opts.title || 'Confirmar acción';
    const message = opts.message || '';
    const confirmLabel = opts.confirmLabel || 'Confirmar';
    const cancelLabel = opts.cancelLabel || 'Cancelar';
    const placeholder = opts.placeholder || 'Escriba aquí la justificación (requerida)...';
    const tone = opts.tone || 'rose'; // rose | teal | amber
    const requireReason = opts.requireReason !== false;
    const icon = opts.icon || (tone === 'rose' ? 'shield-alert' : tone === 'amber' ? 'alert-triangle' : 'check-circle-2');

    const toneClasses = {
      rose:  { header: 'from-rose-600 to-rose-500', btn: 'bg-rose-600 hover:bg-rose-700 shadow-rose-200', text: 'text-rose-700', pill: 'bg-rose-50 border-rose-100 text-rose-600' },
      teal:  { header: 'from-teal-600 to-teal-500', btn: 'bg-teal-600 hover:bg-teal-700 shadow-teal-200', text: 'text-teal-700', pill: 'bg-teal-50 border-teal-100 text-teal-600' },
      amber: { header: 'from-amber-500 to-amber-400', btn: 'bg-amber-600 hover:bg-amber-700 shadow-amber-200', text: 'text-amber-700', pill: 'bg-amber-50 border-amber-100 text-amber-600' }
    };
    const t = toneClasses[tone] || toneClasses.rose;

    const mountId = '_karpusJustifiedModalMount_' + Date.now();
    const wrapper = document.createElement('div');
    wrapper.id = mountId;
    wrapper.setAttribute('role', 'dialog');
    wrapper.setAttribute('aria-modal', 'true');
    wrapper.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn';
    wrapper.innerHTML = `
      <div class="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-slideUp border border-slate-100">
        <div class="bg-gradient-to-r ${t.header} p-6 text-white flex items-center gap-3">
          <div class="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
            <i data-lucide="${icon}" class="w-6 h-6"></i>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-lg font-black uppercase tracking-tight">${title}</h3>
            ${message ? `<p class="text-xs font-bold text-white/80 mt-0.5">${message}</p>` : ''}
          </div>
        </div>
        <div class="p-6">
          <label class="block mb-2">
            <span class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Justificación ${requireReason ? 'obligatoria' : 'opcional'}</span>
          </label>
          <textarea id="${mountId}_reason" rows="4"
            class="w-full resize-none rounded-xl border-2 border-slate-200 focus:border-teal-400 focus:ring-4 focus:ring-teal-50 outline-none px-4 py-3 text-sm font-bold text-slate-700 placeholder:text-slate-300 transition-all"
            placeholder="${placeholder}"></textarea>
          <p id="${mountId}_err" class="mt-2 text-xs font-black text-rose-500 hidden">⚠ Debe escribir una justificación para continuar.</p>

          <div class="grid grid-cols-2 gap-3 mt-6">
            <button id="${mountId}_cancel" type="button"
              class="py-3.5 bg-slate-100 text-slate-600 rounded-xl font-black uppercase text-xs hover:bg-slate-200 transition-all active:scale-95">
              ${cancelLabel}
            </button>
            <button id="${mountId}_confirm" type="button"
              class="py-3.5 ${t.btn} text-white rounded-xl font-black uppercase text-xs shadow-lg hover:shadow-xl transition-all active:scale-95">
              ${confirmLabel}
            </button>
          </div>
        </div>
      </div>
    `;
    const onDone = (value) => {
      try { document.body.removeChild(wrapper); } catch (_) {}
      resolve(value);
    };
    document.body.appendChild(wrapper);
    if (window.lucide) lucide.createIcons();
    const reasonEl = wrapper.querySelector(`#${mountId}_reason`);
    const errEl = wrapper.querySelector(`#${mountId}_err`);
    const confirmBtn = wrapper.querySelector(`#${mountId}_confirm`);
    const cancelBtn = wrapper.querySelector(`#${mountId}_cancel`);
    if (reasonEl) setTimeout(() => reasonEl.focus({ preventScroll: false }), 60);
    const onKey = (e) => {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); onDone(null); }
    };
    document.addEventListener('keydown', onKey);
    if (cancelBtn) cancelBtn.addEventListener('click', () => onDone(null));
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const text = (reasonEl?.value || '').trim();
        if (requireReason && !text) {
          if (errEl) { errEl.classList.remove('hidden'); reasonEl?.classList.add('border-rose-300', 'ring-4', 'ring-rose-50'); }
          reasonEl?.focus();
          return;
        }
        onDone({ confirmed: true, reason: text });
      });
    }
  });
}

/**
 * Estado específico para el panel de Asistente
 */
export const AppState = new SafeAppState({
  user: null,
  profile: null,
  currentSection: 'dashboard',
  paymentsData: [],
  schoolYear: null,
  activePeriod: null,
  periods: [],
  activeChatUserId: null,
  activeConversationId: null
});
