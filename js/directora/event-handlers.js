// ✅ DELEGATED EVENT HANDLERS (XSS Safe)
// Centralized event handling to replace inline onclick handlers

// 🎯 Mapa central de acciones
const ACTIONS = {
  'btn-inquiry-detail': (id) => window.App?.inquiries?.openDetail?.(id),
  'btn-inquiry-reply': (id) => window.App?.inquiries?.reply?.(id),
  'btn-student-edit': (id) => window.App?.students?.edit?.(id),
  'btn-student-delete': (id) => window.App?.students?.delete?.(id),
  'btn-teacher-edit': (id) => window.App?.teachers?.edit?.(id),
  'btn-modal-close': () => window.UIHelpers?.closeModal?.()
};

// 🎯 Delegación optimizada
document.addEventListener('click', e => {
  const target = e.target.closest('[class*="btn-"]');
  if (!target) return;

  // Buscar clase válida
  const actionClass = Object.keys(ACTIONS).find(cls =>
    target.classList.contains(cls)
  );

  if (!actionClass) return;

  try {
    const id = target.dataset?.id;
    ACTIONS[actionClass](id);
  } catch (err) {
    console.error(`Error ejecutando acción: ${actionClass}`, err);
  }
});

// Safe localStorage helpers
const SafeStorage = {
  get(key, fallback = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : fallback;
    } catch (e) {
      console.warn(`Storage GET error [${key}]`, e);
      return fallback;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn(`Storage SET error [${key}]`, e);
      return false;
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.warn(`Storage REMOVE error [${key}]`, e);
      return false;
    }
  },

  clear() {
    try {
      localStorage.clear();
    } catch (e) {
      console.warn('Storage CLEAR error', e);
    }
  }
};
