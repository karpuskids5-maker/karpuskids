/**
 * 🧠 AppState PRO+ (Nivel Empresa)
 */
export class SafeAppState {
  constructor(initialState = {}) {
    this._initialState = Object.freeze({ ...initialState });
    this._state = { ...initialState };

    this._listeners = {};
    this._globalListeners = new Set();

    this._isBatching = false;
    this._batchQueue = new Set();

    // 🔄 Sistema de caché con TTL
    this._cache = {};
    this._cacheTTL = {};
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
      console.error(`❌ [AppState] Clave inválida: "${key}"`);
      return;
    }

    const prev = this._state[key];

    // 🔥 Comparación rápida (referencial)
    if (prev === value) return;

    this._state[key] = value;

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
        } catch (err) {
          console.error(`❌ Error en listener [${key}]`, err);
        }
      });
    }

    // 🌍 listeners globales
    this._globalListeners.forEach(cb => {
      try {
        cb({ key, value, prev, state: this._state });
      } catch (err) {
        console.error('❌ Error global listener:', err);
      }
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
      console.log(`✅ [Cache HIT] ${key} (${Math.round((expiry - now) / 1000)}s restantes)`);
      return cached;
    }

    // 🔄 Si caché expiró o no existe, hacer fetch
    console.log(`🔄 [Cache MISS] ${key} - Obteniendo datos frescos...`);
    try {
      const data = await fetchFn();
      this._cache[key] = data;
      this._cacheTTL[key] = now + ttl;
      console.log(`✅ [Cache STORED] ${key} (TTL: ${Math.round(ttl / 1000)}s)`);
      return data;
    } catch (error) {
      console.error(`❌ [Cache ERROR] ${key}:`, error);
      throw error;
    }
  }

  /**
   * 🗑️ Invalidar caché específico
   */
  invalidateCache(key) {
    delete this._cache[key];
    delete this._cacheTTL[key];
    console.log(`🗑️ [Cache INVALIDATED] ${key}`);
  }

  /**
   * 🗑️ Limpiar todo el caché
   */
  clearAllCache() {
    this._cache = {};
    this._cacheTTL = {};
    console.log('🗑️ [Cache CLEARED] Todos los cachés fueron limpiados');
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
        isValid: now < expiry,
        expiresIn: Math.round(Math.max(0, expiry - now) / 1000),
        size: JSON.stringify(this._cache[key]).length
      };
    });
    return status;
  }
}

export const AppState = new SafeAppState({
  user: null,
  profile: null,
  currentStudent: null,
  liveChannel: null,
  isClassLive: false,
  // Dashboard data can be cached here if needed
  dashboardData: null,
  stats: {},
  students: [],
});