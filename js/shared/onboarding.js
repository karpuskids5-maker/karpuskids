/**
 * 🎓 Karpus Kids — Onboarding Guide
 * Sistema de guía de bienvenida para nuevos usuarios.
 * Muestra un saludo amigable y luego guía por cada sección.
 *
 * Uso:
 *   OnboardingGuide.init({ userName, steps, storageKey })
 */

const STORAGE_KEY_PREFIX = 'karpus_onboarding_';

export const OnboardingGuide = {
  _steps: [],
  _current: 0,
  _overlay: null,
  _storageKey: '',

  /**
   * Inicializa la guía si el usuario no la ha completado.
   * @param {object} opts
   *   userName   — nombre del usuario para el saludo
   *   steps      — array de { target, title, text, position }
   *   storageKey — clave única por panel (ej: 'padre_v1')
   *   delay      — ms antes de mostrar (default 1500)
   */
  init({ userName = 'Bienvenido', steps = [], storageKey = 'default', delay = 1500 } = {}) {
    this._storageKey = STORAGE_KEY_PREFIX + storageKey;
    this._steps = steps;

    // No mostrar si ya completó la guía
    if (localStorage.getItem(this._storageKey) === 'done') return;

    setTimeout(() => this._showWelcome(userName), delay);
  },

  _showWelcome(userName) {
    // Saludo flotante en esquina inferior derecha
    const toast = document.createElement('div');
    toast.id = 'onboarding-welcome';
    toast.className = [
      'fixed bottom-6 right-4 z-[9990]',
      'bg-white rounded-3xl shadow-2xl border border-slate-100',
      'p-5 max-w-[300px] w-[calc(100vw-2rem)]',
      'flex flex-col gap-3',
      'animate-slide-up-in'
    ].join(' ');

    toast.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-2xl shrink-0 shadow-lg">👋</div>
        <div class="min-w-0">
          <p class="font-black text-slate-800 text-sm leading-tight">¡Hola, ${this._escapeHTML(userName)}!</p>
          <p class="text-xs text-slate-500 font-medium mt-1 leading-snug">Bienvenido a <b>Karpus Kids</b>. ¿Te gustaría un recorrido rápido por tu panel?</p>
        </div>
      </div>
      <div class="flex gap-2">
        <button id="onboarding-start" class="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-md active:scale-95 transition-all">
          Sí, mostrarme 🚀
        </button>
        <button id="onboarding-skip" class="px-4 py-2.5 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase hover:bg-slate-200 transition-all">
          Omitir
        </button>
      </div>`;

    document.body.appendChild(toast);
    this._injectCSS();

    document.getElementById('onboarding-start')?.addEventListener('click', () => {
      toast.remove();
      this._current = 0;
      this._showStep();
    });
    document.getElementById('onboarding-skip')?.addEventListener('click', () => {
      toast.remove();
      this._complete();
    });
  },

  _showStep() {
    this._clearHighlight();
    if (this._current >= this._steps.length) {
      this._showComplete();
      return;
    }

    const step = this._steps[this._current];
    const target = step.target ? document.querySelector(step.target) : null;

    // Crear overlay
    this._overlay = document.createElement('div');
    this._overlay.id = 'onboarding-overlay';
    this._overlay.className = 'fixed inset-0 z-[9980] pointer-events-none';
    this._overlay.style.background = 'rgba(0,0,0,0.45)';
    document.body.appendChild(this._overlay);

    // Resaltar elemento target
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('onboarding-highlight');
    }

    // Tooltip
    const tip = document.createElement('div');
    tip.id = 'onboarding-tip';
    tip.className = [
      'fixed z-[9991] bg-white rounded-3xl shadow-2xl border border-slate-100',
      'p-5 max-w-[280px] w-[calc(100vw-2rem)]',
      'pointer-events-auto'
    ].join(' ');

    tip.innerHTML = `
      <div class="flex items-center gap-2 mb-3">
        <span class="text-xl">${step.icon || '💡'}</span>
        <h4 class="font-black text-slate-800 text-sm">${this._escapeHTML(step.title)}</h4>
        <span class="ml-auto text-[10px] font-black text-slate-400">${this._current + 1}/${this._steps.length}</span>
      </div>
      <p class="text-xs text-slate-600 font-medium leading-relaxed mb-4">${step.text}</p>
      <div class="flex gap-2">
        ${this._current > 0 ? `<button id="onboarding-prev" class="px-3 py-2 bg-slate-100 text-slate-500 rounded-xl font-black text-xs hover:bg-slate-200 transition-all">← Atrás</button>` : ''}
        <button id="onboarding-next" class="flex-1 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-black text-xs uppercase shadow-sm active:scale-95 transition-all">
          ${this._current < this._steps.length - 1 ? 'Siguiente →' : '¡Listo! 🎉'}
        </button>
        <button id="onboarding-exit" class="px-3 py-2 text-slate-300 hover:text-slate-500 font-black text-xs transition-all">✕</button>
      </div>
      <!-- Barra de progreso -->
      <div class="mt-3 h-1 bg-slate-100 rounded-full overflow-hidden">
        <div class="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full transition-all duration-500"
             style="width:${Math.round(((this._current + 1) / this._steps.length) * 100)}%"></div>
      </div>`;

    document.body.appendChild(tip);
    this._positionTip(tip, target);

    document.getElementById('onboarding-next')?.addEventListener('click', () => {
      this._current++;
      tip.remove();
      this._overlay?.remove();
      this._showStep();
    });
    document.getElementById('onboarding-prev')?.addEventListener('click', () => {
      this._current--;
      tip.remove();
      this._overlay?.remove();
      this._showStep();
    });
    document.getElementById('onboarding-exit')?.addEventListener('click', () => {
      tip.remove();
      this._overlay?.remove();
      this._clearHighlight();
      this._complete();
    });
  },

  _positionTip(tip, target) {
    // Posicionar el tooltip cerca del elemento o centrado en móvil
    if (!target || window.innerWidth < 640) {
      tip.style.bottom = '80px';
      tip.style.left   = '50%';
      tip.style.transform = 'translateX(-50%)';
      return;
    }

    const rect = target.getBoundingClientRect();
    const tipH = 200; // altura estimada
    const tipW = 280;

    let top  = rect.bottom + 12;
    let left = rect.left;

    // No salir de la pantalla
    if (top + tipH > window.innerHeight) top = rect.top - tipH - 12;
    if (left + tipW > window.innerWidth) left = window.innerWidth - tipW - 16;
    if (left < 8) left = 8;

    tip.style.top  = `${Math.max(8, top)}px`;
    tip.style.left = `${left}px`;
  },

  _showComplete() {
    this._clearHighlight();
    const toast = document.createElement('div');
    toast.className = [
      'fixed bottom-6 right-4 z-[9990]',
      'bg-gradient-to-br from-emerald-500 to-teal-600 text-white',
      'rounded-3xl shadow-2xl p-5 max-w-[280px] w-[calc(100vw-2rem)]',
      'animate-slide-up-in'
    ].join(' ');
    toast.innerHTML = `
      <div class="text-3xl mb-2">🎉</div>
      <p class="font-black text-lg leading-tight">¡Listo!</p>
      <p class="text-sm text-white/80 font-medium mt-1">Ya conoces tu panel. Si necesitas ayuda, visita tu perfil.</p>
      <button onclick="this.parentElement.remove()" class="mt-3 w-full py-2 bg-white/20 hover:bg-white/30 rounded-2xl font-black text-xs uppercase transition-all">Entendido</button>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
    this._complete();
  },

  _complete() {
    localStorage.setItem(this._storageKey, 'done');
  },

  _clearHighlight() {
    document.querySelectorAll('.onboarding-highlight').forEach(el => el.classList.remove('onboarding-highlight'));
    document.getElementById('onboarding-overlay')?.remove();
  },

  _escapeHTML(str = '') {
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  },

  /** Resetear guía (para testing) */
  reset(storageKey = 'default') {
    localStorage.removeItem(STORAGE_KEY_PREFIX + storageKey);
  },

  _injectCSS() {
    if (document.getElementById('onboarding-css')) return;
    const s = document.createElement('style');
    s.id = 'onboarding-css';
    s.textContent = `
      @keyframes slideUpIn {
        from { opacity:0; transform:translateY(20px); }
        to   { opacity:1; transform:translateY(0); }
      }
      .animate-slide-up-in { animation: slideUpIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both; }
      .onboarding-highlight {
        position: relative;
        z-index: 9985 !important;
        box-shadow: 0 0 0 4px #10b981, 0 0 0 8px rgba(16,185,129,0.3) !important;
        border-radius: 12px;
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(s);
  }
};
