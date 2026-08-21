/**
 * 💬 ChatView — Control de vistas del chat estilo WhatsApp (compartido por todos los paneles)
 *
 * - Móvil (<769px): alterna lista ↔ conversación con estilos inline
 *   (a prueba de Tailwind compilado / especificidad).
 * - Historial: al abrir una conversación se empuja un estado; el botón
 *   ATRÁS físico del móvil o del navegador regresa a la lista de contactos
 *   SIN recargar la página.
 */

const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

let _activeRevert = null;
let _bound = false;
let _pushSeq = 0;

/** Placeholder estándar "Selecciona un contacto" */
function _placeholderHTML(icon = 'messages-square', text = 'Selecciona un contacto') {
  return `<div class="kk-chat-placeholder">
    <i data-lucide="${icon}"></i>
    <p>${text}</p>
  </div>`;
}

function _bindPopstate() {
  if (_bound) return;
  _bound = true;
  window.addEventListener('popstate', () => {
    // Botón atrás físico (móvil) o del navegador → cerrar conversación sin recargar
    if (_activeRevert) {
      const fn = _activeRevert;
      _activeRevert = null;
      try { fn(); } catch (_) { /* silencioso */ }
    }
  });
}

function _pushState() {
  try {
    if (!(history.state && 'karpusChat' in history.state)) {
      history.pushState({ karpusChat: ++_pushSeq }, '', '#chat');
    }
  } catch (_) { /* silencioso */ }
}

export const ChatView = {
  isMobile,
  placeholderHTML: _placeholderHTML,

  /**
   * Abre la vista conversación.
   * @param {Object}   opts
   * @param {Function} opts.apply   — muestra la conversación (por panel)
   * @param {Function} opts.revert  — restaura la lista / estado inicial (por panel)
   */
  open({ apply, revert }) {
    _bindPopstate();
    try { apply?.(); } catch (_) { /* silencioso */ }
    _pushState();
    _activeRevert = revert || null;
  },

  /** ¿Hay una conversación abierta gestionada por ChatView? */
  isOpen() {
    return !!_activeRevert;
  },

  /** Cierra la conversación directamente (sin tocar historial) */
  close() {
    const revert = _activeRevert;
    _activeRevert = null;
    try { revert?.(); } catch (_) { /* silencioso */ }
  },

  /**
   * Acción del botón ATRÁS de la interfaz:
   * si hay entrada de historial propia se consume (dispara popstate → revert);
   * si no, cierra directo.
   */
  back() {
    if (_activeRevert && history.state && 'karpusChat' in history.state) {
      history.back();
    } else {
      this.close();
    }
  },

  /** Limpieza al abandonar la sección (sin revert visual) */
  reset() {
    _activeRevert = null;
  }
};

/**
 * 💾 ChatListState — Preserva posición de scroll, búsqueda y filtro activo
 * de la lista de chats entre navegaciones (experiencia PWA tipo app real).
 */
const _listStateKey = (key) => `kk_chat_list_${key || 'default'}`;

export const ChatListState = {
  save(key, data) {
    try { sessionStorage.setItem(_listStateKey(key), JSON.stringify(data || {})); } catch (_) {}
  },

  load(key) {
    try {
      return JSON.parse(sessionStorage.getItem(_listStateKey(key)) || '{}');
    } catch (_) {
      return {};
    }
  },

  /** Guarda scroll/búsqueda/filtro leyendo el DOM directamente */
  capture(key, { listEl, searchEl, filterSelector }) {
    const data = {
      scrollTop: listEl?.scrollTop || 0,
      search: searchEl?.value || '',
      filter: document.querySelector(`${filterSelector} .is-active-filter`)?.dataset.filter || ''
    };
    this.save(key, data);
  },

  /** Restaura búsqueda + filtro; el scroll debe restaurarse tras render */
  restoreUI(key, { searchEl, filterSelector }) {
    const s = this.load(key);
    if (searchEl && s.search) {
      searchEl.value = s.search;
      searchEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (filterSelector && s.filter) {
      document.querySelector(`${filterSelector} [data-filter="${s.filter}"]`)?.click();
    }
    return s;
  }
};
