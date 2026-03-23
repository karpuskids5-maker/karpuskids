import { supabase } from '../supabase.js';

export const DATE_FORMAT = { locale: 'es-ES', options: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' } };
export const TOAST_DURATION = 2800;
export const MODAL_CLOSE_KEYS = ['Escape', 'Esc'];

const escapeHtmlMap = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
};

export const escapeHtml = (str = '') => {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, m => escapeHtmlMap[m]);
};

export const DBHelper = {
  DB_NAME: 'KarpusParentDB',
  DB_VERSION: 1,
  db: null,

  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        console.warn('IndexedDB not supported');
        return resolve();
      }
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onerror = () => {
        console.error("IndexedDB error:", request.error);
        reject("Error opening IndexedDB");
      };
      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log("IndexedDB initialized successfully");
        resolve(this.db);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log("IndexedDB upgrade needed");
        if (!db.objectStoreNames.contains('student')) db.createObjectStore('student');
        if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('evidences')) db.createObjectStore('evidences', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('attendance')) db.createObjectStore('attendance', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('grades')) db.createObjectStore('grades', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('payments')) db.createObjectStore('payments', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('posts')) db.createObjectStore('posts', { keyPath: 'id' });
      };
    });
  },

  async get(storeName, key) {
    if (!this.db) await this.init();
    if (!this.db) return null;
    return new Promise((resolve) => {
      try {
        const transaction = this.db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = key ? store.get(key) : store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch (e) {
        console.warn(`DB get error (${storeName}):`, e);
        resolve(null);
      }
    });
  },

  async set(storeName, data, key = null) {
    if (!this.db) await this.init();
    if (!this.db) return;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        if (Array.isArray(data)) {
          store.clear();
          data.forEach(item => {
            if (!item) return;
            try {
              store.put(item);
            } catch (e) {
              console.warn('IDB put item error:', e);
            }
          });
        } else {
          try {
            key ? store.put(data, key) : store.put(data);
          } catch (e) {
            console.warn('IDB put error:', e);
          }
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        console.warn(`DB set error (${storeName}):`, e);
        resolve();
      }
    });
  }
};

export const Helpers = {
  toast: (() => {
    let activeToasts = 0;
    const MAX_TOASTS = 3;

    return (message, type = 'success') => {
      if (activeToasts >= MAX_TOASTS) return;

      activeToasts++;

      const map = {
        success: 'bg-emerald-500',
        error: 'bg-rose-500',
        info: 'bg-sky-500'
      };

      const toast = document.createElement('div');
      toast.setAttribute('role', 'alert');
      toast.setAttribute('aria-live', 'polite');
      toast.className = `fixed bottom-6 right-6 ${map[type] || map.info} text-white px-5 py-3 rounded-xl shadow-lg z-[100] transition-all opacity-0 translate-y-2`;

      toast.innerHTML = `<span class="text-sm">${escapeHtml(message)}</span>`;

      document.body.appendChild(toast);

      requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', 'translate-y-2');
        toast.classList.add('opacity-100', 'translate-y-0');
      });

      setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0');

        setTimeout(() => {
          toast.remove();
          activeToasts--;
        }, 300);
      }, TOAST_DURATION);
    };
  })(),
  
  emptyState: (msg, icon = '🙂') => 
    `<div class="text-center py-12 text-slate-400" role="status" aria-label="Sin contenido">
      <div class="text-3xl mb-3">${icon}</div>
      <p class="text-sm font-medium">${escapeHtml(msg)}</p>
    </div>`,
  
  skeleton: (count = 3, height = 'h-16') => 
    Array.from({ length: count }, (_, i) => 
      `<div class="animate-pulse bg-slate-100 rounded-xl ${height} w-full mb-3" role="status" aria-busy="true" data-skeleton="${i}"></div>`
    ).join('')
};

export async function sendEmail(to, subject, html, text) {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('No autenticado');
    }

    const res = await fetch('https://wwnfonkvemimwiqjpkij.supabase.co/functions/v1/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ to, subject, html, text })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }

    return true;

  } catch (e) {
    console.error('❌ Email error:', e);
    Helpers.toast('Error enviando correo', 'error');
    return false;
  }
}

export function setupModalAccessibility(modal) {
  if (!modal || modal._initialized) return;

  modal._initialized = true;

  const close = () => {
    modal.classList.add('hidden');
    modal.removeAttribute('aria-modal');
  };

  const handleEscape = (e) => {
    if (MODAL_CLOSE_KEYS.includes(e.key)) close();
  };
  
  const handleClickOutside = (e) => {
    if (e.target === modal) close();
  };
  
  modal.querySelector('[data-close-modal]')?.addEventListener('click', close);
  document.addEventListener('keydown', handleEscape);
  modal.addEventListener('click', handleClickOutside);

  modal._cleanup = () => {
    document.removeEventListener('keydown', handleEscape);
    modal.removeEventListener('click', handleClickOutside);
    modal._initialized = false;
  };
  
  return modal._cleanup;
}

export function triggerConfetti() {
  if (typeof confetti === 'function') {
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    setTimeout(() => confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0 } }), 250);
    setTimeout(() => confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1 } }), 400);
  }
}

export const Utils = {
  debounce(fn, delay = 300) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  },

  formatTime(date) {
    return new Date(date).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
};
