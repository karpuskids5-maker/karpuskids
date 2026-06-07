/**
 * 🧠 AppState PRO+ (Nivel Empresa)
 */
export class SafeAppState {
  constructor(initialState = {}, options = {}) {
    this._initialState = Object.freeze({ ...initialState });
    this._state = { ...initialState };
    this._persistenceKey = options.persistenceKey || null;

    this._listeners = {};
    this._globalListeners = new Set();

    this._isBatching = false;
    this._batchQueue = new Set();

    // 🔄 Sistema de caché con TTL
    this._cache = {};
    this._cacheTTL = {};

    // 💾 Cargar persistencia si existe
    if (this._persistenceKey) {
      this._loadFromStorage();
    }
  }

  _loadFromStorage() {
    if (!this._persistenceKey) return;
    try {
      const saved = localStorage.getItem(this._persistenceKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Solo restauramos las claves que existen en el estado inicial para evitar basura
        Object.keys(parsed).forEach(key => {
          if (key in this._initialState) {
            this._state[key] = parsed[key];
          }
        });
        
        // ✅ NOTIFICAR RESTAURACIÓN (Para que la UI se pinte de inmediato)
        setTimeout(() => {
          Object.keys(parsed).forEach(key => {
            if (key in this._initialState) {
              this._notify(key, this._state[key], null);
            }
          });
        }, 10);
      }
    } catch (e) {
      console.warn('[SafeAppState] Error loading persistence:', e);
    }
  }

  _saveToStorage() {
    if (!this._persistenceKey) return;
    try {
      localStorage.setItem(this._persistenceKey, JSON.stringify(this._state));
    } catch (e) {
      console.warn('[SafeAppState] Error saving persistence:', e);
    }
  }

  /**
   * 📥 GET (rápido + seguro)
   */
  get(key) {
    return this._state[key];
  }

  /**
   * 📦 GET TODO (solo cuando realmente lo necesites)
   */
  getAll() {
    return structuredClone(this._state);
  }

  /**
   * 📤 SET optimizado
   */
  set(key, value) {
    if (!(key in this._initialState)) {
      return;
    }

    const prev = this._state[key];

    // 🔥 Comparación rápida (referencial)
    if (prev === value) return;

    this._state[key] = value;

    // ✅ PERSISTENCIA INMEDIATA: Guardar solo las claves necesarias si se desea
    this._saveToStorage();

    if (this._isBatching) {
      this._batchQueue.add(key);
      return;
    }

    this._notify(key, value, prev);
  }

  /**
   * 📦 SET múltiple (🔥 PRO)
   */
  setMany(updates = {}) {
    this._isBatching = true;

    Object.entries(updates).forEach(([key, value]) => {
      this.set(key, value);
    });

    this._isBatching = false;

    // 🔥 Notificar todo junto
    this._batchQueue.forEach(key => {
      this._notify(key, this._state[key], null);
    });

    this._batchQueue.clear();
  }

  /**
   * 🔔 Subscribe por clave
   */
  subscribe(key, callback) {
    if (!this._listeners[key]) {
      this._listeners[key] = new Set();
    }

    this._listeners[key].add(callback);

    return () => {
      this._listeners[key].delete(callback);
    };
  }

  /**
   * 🌍 Subscribe global (🔥 PRO)
   */
  subscribeAll(callback) {
    this._globalListeners.add(callback);

    return () => {
      this._globalListeners.delete(callback);
    };
  }

  /**
   * 🔄 Notificar cambios
   */
  _notify(key, value, prev) {
    // 🔑 listeners por clave
    if (this._listeners[key]) {
      this._listeners[key].forEach(cb => {
        try {
          cb(value, prev);
        } catch (_) {}
      });
    }

    this._globalListeners.forEach(cb => {
      try {
        cb({ key, value, prev, state: this._state });
      } catch (_) {}
    });
  }

  /**
   * ♻️ Reset limpio
   */
  reset() {
    this._state = { ...this._initialState };
    this._listeners = {};
    this._globalListeners.clear();
    this._batchQueue.clear();
    this._cache = {};
    this._cacheTTL = {};
    if (this._persistenceKey) {
      localStorage.removeItem(this._persistenceKey);
    }
  }

  /**
   * 💾 Caché con TTL (Time To Live)
   * @param {string} key - Clave única del caché
   * @param {Function} fetchFn - Función asincrónica que obtiene los datos
   * @param {number} ttl - Tiempo en milisegundos (defecto: 5 minutos)
   * @returns {Promise} Datos cacheados o frescos
   */
  async getOrFetch(key, fetchFn, ttl = 5 * 60 * 1000) {
    const now = Date.now();
    const cached = this._cache[key];
    const expiry = this._cacheTTL[key];

    // ✅ Si existe caché y no ha expirado, devolverlo
    if (cached !== undefined && expiry !== undefined && now < expiry) {
      return cached;
    }

    // 🔄 Si caché expiró o no existe, hacer fetch
    try {
      const data = await fetchFn();
      this._cache[key] = data;
      this._cacheTTL[key] = now + ttl;
      return data;
    } catch (error) {
      throw error;
    }
  }

  // 📦 Métodos directos de caché (Compatibilidad GlobalCache)
  setCache(key, value, ttl = 5 * 60 * 1000) {
    this._cache[key] = value;
    this._cacheTTL[key] = Date.now() + ttl;
  }

  getCache(key) {
    const now = Date.now();
    if (this._cache[key] !== undefined && this._cacheTTL[key] > now) {
      return this._cache[key];
    }
    return null;
  }

  /**
   * 🗑️ Invalidar caché específico
   */
  invalidateCache(key) {
    delete this._cache[key];
    delete this._cacheTTL[key];
  }

  /**
   * 🗑️ Limpiar todo el caché
   */
  clearAllCache() {
    this._cache = {};
    this._cacheTTL = {};
  }

  /**
   * 📊 Obtener estado del caché
   */
  getCacheStatus() {
    const status = {};
    Object.keys(this._cache).forEach(key => {
      const now = Date.now();
      const expiry = this._cacheTTL[key] || 0;
      status[key] = {
        expired: now >= expiry,
        ttl: Math.max(0, expiry - now)
      };
    });
    return status;
  }
}
