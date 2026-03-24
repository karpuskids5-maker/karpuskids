// ✅ DELEGATED EVENT HANDLERS (XSS Safe)
// Centralized event handling to replace inline onclick handlers

// 🎯 Mapa central de acciones
const ACTIONS = {
  'btn-inquiry-detail': (id) => window.App?.inquiries?.openDetail?.(id),
  'btn-inquiry-reply': (id) => window.App?.inquiries?.reply?.(id),
  'btn-student-edit': (id) => window.App?.students?.edit?.(id),
  'btn-student-delete': (id) => window.App?.students?.delete?.(id),
  'btn-teacher-edit': (id) => window.App?.teachers?.edit?.(id),
  'btn-modal-close': () => window.App?.ui?.closeModal?.(),
  'btn-logout': () => window.supabase?.auth?.signOut()?.then(() => window.location.href = 'index.html')
};

// 🎯 Delegación optimizada
document.addEventListener('click', e => {
  // 1. Manejo de Secciones (Navegación)
  const navTarget = e.target.closest('[data-section]');
  if (navTarget) {
    const section = navTarget.dataset.section;
    window.App?.navigation?.goTo(section);
    return;
  }

  // 2. Manejo de Acciones por Clase
  const actionTarget = e.target.closest('[class*="btn-"]');
  if (actionTarget) {
    const actionClass = Object.keys(ACTIONS).find(cls =>
      actionTarget.classList.contains(cls)
    );

    if (actionClass) {
      try {
        const id = actionTarget.dataset?.id;
        ACTIONS[actionClass](id);
      } catch (err) {
        console.error(`Error ejecutando acción: ${actionClass}`, err);
      }
      return;
    }
  }

  // 3. Manejo de Acciones Genéricas (data-action)
  const genericTarget = e.target.closest('[data-action]');
  if (genericTarget) {
    const action = genericTarget.dataset.action;
    const id = genericTarget.dataset.id;
    
    switch(action) {
      case 'go-section':
        window.App?.navigation?.goTo(genericTarget.dataset.section);
        break;
      case 'refresh-dashboard':
        window.App?.ui?.setLoading(true);
        // Recargar datos...
        break;
    }
  }
});

// Safe localStorage helpers
export const SafeStorage = {
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

// Expose globally for backward compatibility
window.SafeStorage = SafeStorage;
