/**
 * ⬅️ BackNavigation — Botón ATRÁS físico/navegador para PWAs (compartido)
 *
 * Problema que resuelve: en modo PWA, pulsar ATRÁS del móvil dentro de una
 * sección (chat, conversación abierta, etc.) sacaba al usuario de la app y
 * recargaba todo.
 *
 * Modelo:
 * - Cada "vista" apilada (sección, conversación de chat, etc.) empuja UNA
 *   entrada de historial con estado { kkDepth: n } y un callback de cierre.
 * - popstate → se desapilan callbacks hasta alcanzar la profundidad del
 *   estado destino, SIN recargar la página.
 * - Navegación normal a otra sección: reset() colapsa la pila y trunca el
 *   historial hacia adelante (history.go negativo), dejando la base limpia
 *   para la nueva sección.
 *
 * Uso típico en un panel:
 *   BackNavigation.init();
 *   // usuario toca una sección:
 *   await BackNavigation.reset();
 *   showSection(target);
 *   BackNavigation.push(() => showSection(prevSection)); // ATRÁS → volver
 *   // usuario abre una conversación:
 *   BackNavigation.push(closeConvUI);                    // ATRÁS → cerrar chat
 */

let _stack = [];          // [{ cb, cancelled }] — LIFO
let _depth = 0;           // entradas de historial propias sobre la base
let _bound = false;
let _seq = 0;
const _resolvers = [];

/** Garantiza estado base {kkDepth:0} y bindea popstate (idempotente) */
function _init() {
  if (_bound) return;
  _bound = true;
  try {
    if (!(history.state && typeof history.state.kkDepth === 'number')) {
      history.replaceState({ ...(history.state || {}), kkDepth: 0 }, '');
    }
  } catch (_) { /* silencioso */ }
  window.addEventListener('popstate', (e) => {
    const target = (e.state && typeof e.state.kkDepth === 'number') ? e.state.kkDepth : 0;

    if (_depth === 0 && _stack.length === 0) {
      // La pila está vacía: el navegador intentó ir "más atrás" del estado base.
      // Re-empujamos el estado base para que la PWA no abandone la app.
      try { history.pushState({ kkDepth: 0 }, ''); } catch (_) {}
      return;
    }

    while (_depth > target && _stack.length) {
      _depth--;
      const layer = _stack.pop();
      if (layer && !layer.cancelled) {
        try { layer.cb(); } catch (_) { /* silencioso */ }
      }
    }
    // Resolver promesas pendientes de reset()
    while (_resolvers.length) {
      try { _resolvers.shift()(); } catch (_) {}
    }
  });
}

export const BackNavigation = {
  /** Inicializa el estado base. Llamar una vez al arrancar el panel. */
  init() { _init(); },

  /** Profundidad actual (entradas propias sobre la base) */
  get depth() { return _depth; },

  /** Tipo de la capa superior ('section' | 'chat' | …) o null */
  topKind() {
    return _stack.length ? (_stack[_stack.length - 1].kind || null) : null;
  },

  /**
   * Apila una capa: nueva entrada de historial + callback de cierre.
   * @param {Function} onClose       callback de cierre (revert)
   * @param {Object}   [opts]        { kind: 'section'|'chat'|… }
   * @returns {boolean} true si se empujó historial
   */
  push(onClose, opts = {}) {
    _init();
    _stack.push({ cb: onClose, cancelled: false, kind: opts.kind || null });
    _depth++;
    try {
      history.pushState({ kkDepth: _depth, seq: ++_seq }, '');
      return true;
    } catch (_) {
      _stack.pop();
      _depth--;
      return false;
    }
  },

  /**
   * Sustituye el callback de la capa superior SIN crear entrada nueva
   * (p. ej., cambiar de conversación A→B sin apilar).
   */
  replaceTop(onClose, opts = {}) {
    if (_stack.length) {
      _stack[_stack.length - 1] = { cb: onClose, cancelled: false, kind: opts.kind || _stack[_stack.length - 1].kind };
    } else {
      this.push(onClose, opts);
    }
  },

  /**
   * ATRÁS programático (botón de UI). Consume la entrada superior vía
   * history.back() → popstate ejecuta el callback registrado.
   * @returns {boolean} false si no hay capas propias.
   */
  back() {
    if (_depth > 0) {
      try { history.back(); return true; } catch (_) { /* cae a manual */ }
    }
    const layer = _stack.pop();
    if (layer) {
      _depth = Math.max(0, _depth - 1);
      if (!layer.cancelled) { try { layer.cb(); } catch (_) {} }
      return true;
    }
    return false;
  },

  /**
   * Cierra la capa superior SIN animación de historial visible para el
   * usuario: cancela su callback (lo ejecuta ya) y neutraliza su entrada
   * reemplazando el estado actual. Úsalo solo cuando vas a navegar a otra
   * vista de inmediato.
   */
  dropTop(runCb = true) {
    const layer = _stack.pop();
    if (!layer) return;
    _depth = Math.max(0, _depth - 1);
    try { history.replaceState({ kkDepth: _depth }, ''); } catch (_) {}
    if (runCb && !layer.cancelled) { try { layer.cb(); } catch (_) {} }
  },

  /**
   * Colapsa TODAS las capas y trunca el historial hacia adelante hasta la
   * base. Devuelve una Promise que resuelve cuando el historial está limpio
   * (o tras un timeout de seguridad).
   */
  reset() {
    _init();
    _stack.forEach(l => { l.cancelled = true; });
    _stack = [];
    const from = _depth;
    _depth = 0;
    if (from > 0) {
      const p = new Promise(res => {
        _resolvers.push(res);
        setTimeout(res, 120); // seguridad si popstate no llega
      });
      try { history.go(-from); } catch (_) { /* resolverá por timeout */ }
      return p;
    }
    return Promise.resolve();
  }
};

export default BackNavigation;

// Exposición global: permite onclick="window._kkSectionBack()" en HTML
// (botón atrás de cabeceras) sin importar el módulo en cada página.
if (typeof window !== 'undefined') {
  window.BackNavigation = BackNavigation;
  /**
   * Atrás "de sección" para botones de UI:
   * - Si hay capa propia (sección/conversación), la consume vía historial.
   * - Si no, hace fallback al callback del panel (p. ej., ir al dashboard).
   */
  window._kkSectionBack = (fallback) => {
    if (BackNavigation.depth > 0) BackNavigation.back();
    else if (typeof fallback === 'function') fallback();
    else history.length > 1 ? history.back() : null;
  };
}
