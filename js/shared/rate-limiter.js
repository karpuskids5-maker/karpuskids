/**
 * 🛡️ Karpus Kids — Rate Limiter del lado del cliente
 * Previene abuso en uploads, mensajes y otras acciones costosas.
 * Usa localStorage para persistir entre recargas.
 */

export class RateLimiter {
  /**
   * @param {string} key       — identificador único de la acción (ej: 'upload_avatar')
   * @param {number} maxCalls  — máximo de llamadas permitidas en la ventana
   * @param {number} windowMs  — ventana de tiempo en ms (ej: 60_000 = 1 minuto)
   */
  constructor(key, maxCalls, windowMs) {
    this._key      = `karpus_rl_${key}`;
    this._max      = maxCalls;
    this._window   = windowMs;
  }

  /** Retorna true si la acción está permitida, false si está bloqueada */
  check() {
    const now   = Date.now();
    const state = this._getState();

    // Limpiar entradas fuera de la ventana
    const recent = state.filter(ts => now - ts < this._window);

    if (recent.length >= this._max) {
      return false;
    }

    recent.push(now);
    this._setState(recent);
    return true;
  }

  /** Tiempo restante en segundos hasta que se libere un slot */
  remainingSeconds() {
    const now   = Date.now();
    const state = this._getState().filter(ts => now - ts < this._window);
    if (state.length < this._max) return 0;
    const oldest = Math.min(...state);
    return Math.ceil((oldest + this._window - now) / 1000);
  }

  reset() {
    try { localStorage.removeItem(this._key); } catch (_) {}
  }

  _getState() {
    try { return JSON.parse(localStorage.getItem(this._key) || '[]'); } catch (_) { return []; }
  }

  _setState(arr) {
    try { localStorage.setItem(this._key, JSON.stringify(arr)); } catch (_) {}
  }
}

// ── Instancias predefinidas ───────────────────────────────────────────────────

/** Máx 5 uploads por minuto */
export const uploadLimiter = new RateLimiter('upload', 5, 60_000);

/** Máx 20 mensajes de chat por minuto */
export const messageLimiter = new RateLimiter('message', 20, 60_000);

/** Máx 3 envíos de comprobante de pago por hora */
export const paymentProofLimiter = new RateLimiter('payment_proof', 3, 60 * 60_000);

/** Máx 10 comentarios en el muro por minuto */
export const commentLimiter = new RateLimiter('comment', 10, 60_000);

/**
 * Helper: verificar rate limit y mostrar toast si está bloqueado
 * @returns {boolean} true = permitido, false = bloqueado
 */
export function checkRateLimit(limiter, actionLabel = 'esta acción') {
  if (limiter.check()) return true;
  const secs = limiter.remainingSeconds();
  const msg  = `Demasiados intentos. Espera ${secs}s antes de ${actionLabel}.`;
  if (window.Helpers?.toast) {
    window.Helpers.toast(msg, 'warning');
  } else {
    console.warn('[RateLimit]', msg);
  }
  return false;
}
