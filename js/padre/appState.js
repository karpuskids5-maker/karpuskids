import { supabase } from '../supabase.js';

// ============================
// 📊 CONSTANTES
// ============================
export const TABLES = {
  PROFILES: 'profiles',
  STUDENTS: 'students',
  TASKS: 'tasks',
  TASK_EVIDENCES: 'task_evidences',
  ATTENDANCE: 'attendance',
  ATTENDANCE_REQUESTS: 'attendance_requests',
  POSTS: 'posts',
  LIKES: 'likes',
  COMMENTS: 'comments',
  GRADES: 'grades',
  MESSAGES: 'messages',
  PAYMENTS: 'payments'
};

export const STORAGE_BUCKETS = { 
  CLASSROOM_MEDIA: 'classroom_media' 
};

// ============================
// 🧠 APP STATE PRO (REACTIVO)
// ============================
class SafeAppState {
  constructor() {
    this._initialState = {
      user: null,
      profile: null,
      student: null,
      tasks: [],
      messages: [],
      feedPosts: [],
      globalChannel: null,
      feedChannel: null,
      liveChannel: null,
      chatChannel: null,
      attendanceChannel: null,
      currentChatUser: null,
      isClassLive: false,
      feedPage: 0,
      feedHasMore: true,
      attendanceUpdated: 0
    };

    this._state = { ...this._initialState };

    // 🔥 listeners para UI reactiva
    this._listeners = {};
  }

  // ============================
  // GET
  // ============================
  get(key) {
    return this._state[key];
  }

  getAll() {
    return { ...this._state };
  }

  // ============================
  // SET (SEGURO + REACTIVO)
  // ============================
  set(key, value) {
    if (!(key in this._state)) {
      console.error(`❌ AppState: Clave inválida "${key}"`);
      return;
    }

    const oldValue = this._state[key];

    // evitar renders innecesarios
    if (oldValue === value) return;

    this._state[key] = value;

    console.log(`🧠 AppState → ${key}:`, value);

    // 🔥 notificar cambios
    this._notify(key, value, oldValue);
  }

  // ============================
  // LISTENERS (🔥 CLAVE PARA UI)
  // ============================
  subscribe(key, callback) {
    if (!this._listeners[key]) {
      this._listeners[key] = [];
    }

    this._listeners[key].push(callback);

    // unsubscribe
    return () => {
      this._listeners[key] = this._listeners[key].filter(cb => cb !== callback);
    };
  }

  _notify(key, value, oldValue) {
    if (!this._listeners[key]) return;

    this._listeners[key].forEach(cb => {
      try {
        cb(value, oldValue);
      } catch (err) {
        console.error('❌ Error en listener:', err);
      }
    });
  }

  // ============================
  // CHANNEL SAFE REMOVE
  // ============================
  async removeChannelSafe(channel) {
    if (!channel) return;

    try {
      if (typeof channel.unsubscribe === 'function') {
        channel.unsubscribe();
      }

      await supabase.removeChannel(channel);
    } catch (err) {
      console.warn('⚠️ Error removiendo canal:', err.message);
    }
  }

  // ============================
  // RESET COMPLETO
  // ============================
  async reset() {
    console.log('🔄 Reseteando AppState...');

    const {
      globalChannel,
      feedChannel,
      liveChannel,
      chatChannel,
      attendanceChannel
    } = this._state;

    const channels = [
      globalChannel,
      feedChannel,
      liveChannel,
      chatChannel,
      attendanceChannel
    ];

    await Promise.all(
      channels.map(c => this.removeChannelSafe(c))
    );

    this._state = { ...this._initialState };

    // 🔥 limpiar listeners
    this._listeners = {};

    // 🔥 limpiar cache global
    GlobalCache.clear();

    console.log('✅ AppState limpio completamente');
  }
}

export const AppState = new SafeAppState();

// ============================
// ⚡ CACHE GLOBAL PRO
// ============================
export const GlobalCache = {
  store: {},
  maxItems: 50,
  cleanupInterval: 60000,
  _interval: null,

  set(key, data, ttl = 60000) {
    // limpiar si está lleno
    if (Object.keys(this.store).length >= this.maxItems) {
      const oldestKey = Object.entries(this.store)
        .sort((a, b) => a[1].time - b[1].time)[0]?.[0];

      if (oldestKey) delete this.store[oldestKey];
    }

    this.store[key] = {
      data,
      time: Date.now(),
      ttl
    };
  },

  get(key) {
    const item = this.store[key];
    if (!item) return null;

    if (Date.now() - item.time > item.ttl) {
      delete this.store[key];
      return null;
    }

    return item.data;
  },

  delete(key) {
    delete this.store[key];
  },

  clear() {
    this.store = {};
  },

  // 🔥 evita múltiples intervalos
  startAutoCleanup() {
    if (this._interval) return;

    this._interval = setInterval(() => {
      const now = Date.now();

      Object.keys(this.store).forEach(key => {
        const item = this.store[key];
        if (now - item.time > item.ttl) {
          delete this.store[key];
        }
      });

      console.log('🧹 Cache limpiado automáticamente');
    }, this.cleanupInterval);
  }
};

// iniciar limpieza automática
GlobalCache.startAutoCleanup();