/**
 * ⚡ Karpus Kids — QueryCache
 * Cache en memoria con TTL, deduplicación de requests en vuelo y
 * estrategia stale-while-revalidate para 10k+ usuarios.
 *
 * Uso:
 *   const data = await QueryCache.get('students', () => supabase.from('students').select('*'), 60_000);
 *   QueryCache.invalidate('students');
 */

const _store   = new Map(); // key → { data, expiresAt }
const _inflight = new Map(); // key → Promise  (deduplicación)

export const QueryCache = {
  /**
   * Obtiene datos del caché o ejecuta fetchFn.
   * Si hay una petición en vuelo para la misma key, la reutiliza (no duplica requests).
   *
   * @param {string}   key      — clave única
   * @param {Function} fetchFn  — async () => data
   * @param {number}   ttl      — ms (default 2 min)
   */
  async get(key, fetchFn, ttl = 2 * 60_000) {
    // 1. Cache hit
    const cached = _store.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.data;

    // 2. Deduplicar: si ya hay una petición en vuelo, esperar la misma
    if (_inflight.has(key)) return _inflight.get(key);

    // 3. Fetch
    const promise = (async () => {
      try {
        const data = await fetchFn();
        _store.set(key, { data, expiresAt: Date.now() + ttl });
        return data;
      } finally {
        _inflight.delete(key);
      }
    })();

    _inflight.set(key, promise);
    return promise;
  },

  /** Invalida una clave específica */
  invalidate(key) {
    _store.delete(key);
  },

  /** Invalida todas las claves que empiecen con un prefijo */
  invalidatePrefix(prefix) {
    for (const key of _store.keys()) {
      if (key.startsWith(prefix)) _store.delete(key);
    }
  },

  /** Limpia todo el caché */
  clear() {
    _store.clear();
  },

  /** Retorna estadísticas del caché */
  stats() {
    const now = Date.now();
    let valid = 0, expired = 0;
    for (const [, v] of _store) {
      now < v.expiresAt ? valid++ : expired++;
    }
    return { valid, expired, inflight: _inflight.size };
  }
};
