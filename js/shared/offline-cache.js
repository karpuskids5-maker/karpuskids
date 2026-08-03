/**
 * 📴 OfflineCache — IndexedDB cache for padre panel offline reading
 * Stores tasks and feed posts so they're available without internet.
 */

const DB_NAME    = 'karpus_offline_cache';
const DB_VERSION = 1;
const STORES     = ['tasks', 'feed', 'payments'];

let _db = null;

async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'cacheKey' });
        }
      }
    };
    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = (e) => reject(e.target.error);
  });
}

export const OfflineCache = {
  /**
   * Save data to a named store under a cache key
   * @param {string} store  - 'tasks' | 'feed' | 'payments'
   * @param {string} key    - unique key (e.g. studentId)
   * @param {any}    data   - data to cache
   */
  async set(store, key, data) {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).put({ cacheKey: key, data, savedAt: Date.now() });
        req.onsuccess = () => resolve();
        req.onerror   = () => reject(req.error);
      });
    } catch (_) { /* silently fail — cache is best-effort */ }
  },

  /**
   * Retrieve cached data
   * @param {string} store
   * @param {string} key
   * @returns {{ data: any, savedAt: number } | null}
   */
  async get(store, key) {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx  = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = () => resolve(null);
      });
    } catch (_) { return null; }
  },

  /** Check if the browser is currently offline */
  isOffline() {
    return !navigator.onLine;
  }
};
