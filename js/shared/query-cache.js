/**
 * ⚡ Karpus Kids — QueryCache v2
 * Cache en memoria con TTL, deduplicación de requests en vuelo y
 * estrategia stale-while-revalidate para apertura instantánea del sistema.
 *
 * Uso:
 *   const data = await QueryCache.get('students', fetchFn, 60_000);
 *   QueryCache.getStale('students', fetchFn, 60_000, onUpdate);  // stale-while-revalidate
 *   QueryCache.invalidate('students');
 */

const _store    = new Map(); // key → { data, expiresAt, staleAt }
const _inflight = new Map(); // key → Promise (deduplicación)

// TTL de stale: datos se muestran aunque estén expirados, pero se revalidan en background
const STALE_MULTIPLIER = 3; // datos son "stale" pero usables hasta 3x el TTL

export const QueryCache = {
  /**
   * Obtiene datos del caché o ejecuta fetchFn.
   * Si hay una petición en vuelo para la misma key, la reutiliza.
   *
   * @param {string}   key      — clave única
   * @param {Function} fetchFn  — async () => data
   * @param {number}   ttl      — ms (default 2 min)
   */
  async get(key, fetchFn, ttl = 2 * 60_000) {
    // 1. Cache hit fresco
    const cached = _store.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.data;

    // 2. Deduplicar: si ya hay una petición en vuelo, esperar la misma
    if (_inflight.has(key)) return _inflight.get(key);

    // 3. Fetch
    const promise = (async () => {
      try {
        const data = await fetchFn();
        _store.set(key, { data, expiresAt: Date.now() + ttl, staleAt: Date.now() + ttl * STALE_MULTIPLIER });
        return data;
      } finally {
        _inflight.delete(key);
      }
    })();

    _inflight.set(key, promise);
    return promise;
  },

  /**
   * Stale-While-Revalidate: devuelve datos cacheados inmediatamente (aunque estén expirados)
   * y revalida en background. Llama onUpdate(newData) cuando llegan datos frescos.
   *
   * @param {string}   key       — clave única
   * @param {Function} fetchFn   — async () => data
   * @param {number}   ttl       — ms
   * @param {Function} onUpdate  — (data) => void — callback cuando llegan datos frescos
   * @returns {*} datos del caché (pueden ser stale) o null si no hay caché
   */
  getStale(key, fetchFn, ttl = 2 * 60_000, onUpdate = null) {
    const cached = _store.get(key);
    const now = Date.now();

    // Si hay datos en caché (frescos o stale), devolverlos inmediatamente
    if (cached && now < cached.staleAt) {
      // Si están expirados pero dentro del stale window, revalidar en background
      if (now >= cached.expiresAt && !_inflight.has(key)) {
        this._revalidate(key, fetchFn, ttl, onUpdate);
      }
      return cached.data;
    }

    // Sin caché: fetch normal (bloqueante)
    if (!_inflight.has(key)) {
      const promise = (async () => {
        try {
          const data = await fetchFn();
          _store.set(key, { data, expiresAt: now + ttl, staleAt: now + ttl * STALE_MULTIPLIER });
          onUpdate?.(data);
          return data;
        } finally {
          _inflight.delete(key);
        }
      })();
      _inflight.set(key, promise);
    }
    return null; // sin datos aún, el caller debe mostrar skeleton
  },

  /** Revalidación en background sin bloquear la UI */
  _revalidate(key, fetchFn, ttl, onUpdate) {
    const promise = (async () => {
      try {
        const data = await fetchFn();
        const now = Date.now();
        _store.set(key, { data, expiresAt: now + ttl, staleAt: now + ttl * STALE_MULTIPLIER });
        onUpdate?.(data);
        return data;
      } finally {
        _inflight.delete(key);
      }
    })();
    _inflight.set(key, promise);
  },

  /**
   * Búsqueda local en memoria — evita consultas al servidor para listas pequeñas.
   * Filtra datos ya cacheados sin ir a la DB.
   *
   * @param {string}   key    — clave del caché
   * @param {Function} filterFn — (item) => boolean
   * @returns {Array|null} resultados filtrados o null si no hay caché
   */
  searchLocal(key, filterFn) {
    const cached = _store.get(key);
    if (!cached) return null;
    const data = cached.data;
    if (!Array.isArray(data)) return null;
    return data.filter(filterFn);
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
    let fresh = 0, stale = 0, expired = 0;
    for (const [, v] of _store) {
      if (now < v.expiresAt) fresh++;
      else if (now < v.staleAt) stale++;
      else expired++;
    }
    return { fresh, stale, expired, inflight: _inflight.size, total: _store.size };
  }
};
