/**
 * 💬 ChatView — Control de vistas del chat estilo WhatsApp (compartido por todos los paneles)
 *
 * - Móvil (<769px): alterna lista ↔ conversación con estilos inline
 *   (a prueba de Tailwind compilado / especificidad).
 * - Historial: delega en BackNavigation — el botón ATRÁS físico del móvil
 *   o del navegador cierra la conversación y regresa a la lista SIN recargar
 *   la página (crítico en modo PWA).
 */

import { BackNavigation } from './back-navigation.js';

const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

let _lastRevert = null;

/** Placeholder estándar "Selecciona un contacto" */
function _placeholderHTML(icon = 'messages-square', text = 'Selecciona un contacto') {
  return `<div class="kk-chat-placeholder">
    <i data-lucide="${icon}"></i>
    <p>${text}</p>
  </div>`;
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
    _lastRevert = revert || null;
    try { apply?.(); } catch (_) { /* silencioso */ }
    if (BackNavigation.topKind() === 'chat') {
      // Cambio directo de conversación A→B: sin apilar historial
      BackNavigation.replaceTop(revert || null, { kind: 'chat' });
    } else {
      BackNavigation.push(revert || null, { kind: 'chat' });
    }
  },

  /** ¿Hay una conversación abierta gestionada por ChatView? */
  isOpen() {
    return BackNavigation.topKind() === 'chat';
  },

  /** Cierra la conversación directamente (consume su entrada de historial) */
  close() {
    if (this.isOpen()) {
      _lastRevert = null; // lo ejecutará popstate vía BackNavigation
      BackNavigation.back();
    }
  },

  /**
   * Acción del botón ATRÁS de la interfaz:
   * consume la entrada de historial de la conversación (popstate → revert).
   */
  back() {
    this.close();
  },

  /**
   * Limpieza al abandonar / reentrar a la sección: ejecuta el último revert
   * registrado (restaura lista + placeholder) y desactiva la capa de chat.
   * El truncado del historial lo hace BackNavigation.reset() en la navegación.
   */
  reset() {
    const r = _lastRevert;
    _lastRevert = null;
    if (r) { try { r(); } catch (_) { /* silencioso */ } }
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
