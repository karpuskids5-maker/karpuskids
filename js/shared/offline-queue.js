/**
 * 📴 Offline Queue — IndexedDB-backed queue for offline-first operations
 * Used by maestra to register attendance without internet.
 * Syncs automatically when connection is restored.
 */
import { supabase } from './supabase.js';

const DB_NAME    = 'karpus_offline';
const DB_VERSION = 2;
const STORE      = 'queue';

let _db = null;

async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = (e) => reject(e.target.error);
  });
}

export const OfflineQueue = {
  /**
   * Add an operation to the queue (works offline)
   */
  async enqueue(tableName, operation, data) {
    try {
      const db    = await openDB();
      const entry = { table_name: tableName, operation, data, synced: false, created_at: new Date().toISOString() };
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).add(entry);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
      });
    } catch (_) {}
  },

  /**
   * Get all pending (unsynced) operations
   */
  async getPending() {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx    = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        // Get ALL records then filter in JS — avoids IDBIndex boolean key issues
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result || []).filter(r => !r.synced));
        req.onerror   = () => resolve([]);
      });
    } catch (_) { return []; }
  },

  /**
   * Mark an entry as synced
   */
  async markSynced(id) {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx    = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req   = store.get(id);
        req.onsuccess = () => {
          const entry = req.result;
          if (entry) { entry.synced = true; store.put(entry); }
          resolve();
        };
        req.onerror = () => resolve();
      });
    } catch (_) {}
  },

  /**
   * Sync all pending operations to Supabase
   * Called automatically when online
   */
  async syncAll() {
    const pending = await this.getPending();
    if (!pending.length) return { synced: 0, failed: 0 };

    let synced = 0, failed = 0;
    for (const entry of pending) {
      try {
        let result;
        if (entry.operation === 'upsert') {
          const { onConflict, ...data } = entry.data;
          result = await supabase.from(entry.table_name).upsert(data, { onConflict: onConflict || 'student_id,date' });
        } else if (entry.operation === 'insert') {
          result = await supabase.from(entry.table_name).insert(entry.data);
        } else if (entry.operation === 'update') {
          const { id, ...updates } = entry.data;
          result = await supabase.from(entry.table_name).update(updates).eq('id', id);
        }
        if (!result?.error) {
          await this.markSynced(entry.id);
          synced++;
        } else {
          failed++;
        }
      } catch (_) { failed++; }
    }
    return { synced, failed };
  },

  /**
   * Count pending operations
   */
  async pendingCount() {
    const pending = await this.getPending();
    return pending.length;
  },

  /**
   * Start auto-sync when online
   */
  startAutoSync(onSync) {
    const doSync = async () => {
      if (!navigator.onLine) return;
      const result = await this.syncAll();
      if (result.synced > 0 && onSync) onSync(result);
    };

    window.addEventListener('online', doSync);
    // Also try every 30s
    setInterval(doSync, 30_000);
    // Try immediately
    doSync();
  }
};
