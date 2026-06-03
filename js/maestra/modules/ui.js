/**
 * Módulo de Interfaz de Usuario para el Panel de Maestra
 */

export const safeToast = (message, type = 'success') => {
  if (!message) return;
  try {
    if (window.Helpers && typeof window.Helpers.toast === 'function') {
      return window.Helpers.toast(message, type);
    }
  } catch (_) {
    /* silencioso */
  }
};

export const safeEscapeHTML = (str = '') => {
  try {
    if (window.Helpers && typeof window.Helpers.escapeHTML === 'function') {
      return window.Helpers.escapeHTML(str);
    }
  } catch (e) {}
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
};

export const Modal = {
  open(id, content) {
    document.getElementById(id)?.remove();
    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in';
    modal.innerHTML = `<div id="${id}-inner" class="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto">${content}</div>`;
    
    // Cerrar al hacer clic afuera
    modal.onclick = (e) => {
      if (e.target === modal) this.close(id);
    };

    document.body.appendChild(modal);
    requestAnimationFrame(() => window.lucide?.createIcons());
  },
  close(id) {
    document.getElementById(id)?.remove();
  }
};

export const Skeleton = {
  render(type, count = 3) {
    const skeletons = {
      card: `
        <div class="p-6 bg-white rounded-[2rem] border border-slate-100 shadow-sm animate-pulse">
          <div class="flex items-center gap-4 mb-6">
            <div class="w-16 h-16 rounded-2xl bg-slate-100"></div>
            <div class="flex-1 space-y-2">
              <div class="h-4 bg-slate-100 rounded w-3/4"></div>
              <div class="h-3 bg-slate-100 rounded w-1/2"></div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div class="h-10 bg-slate-50 rounded-xl"></div>
            <div class="h-10 bg-slate-50 rounded-xl"></div>
          </div>
        </div>
      `,
      list: `
        <div class="flex items-center justify-between p-4 bg-white rounded-3xl border border-slate-100 shadow-sm animate-pulse">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-slate-100"></div>
            <div class="h-4 bg-slate-100 rounded w-32"></div>
          </div>
          <div class="flex gap-2">
            <div class="w-16 h-8 bg-slate-50 rounded-xl"></div>
            <div class="w-16 h-8 bg-slate-50 rounded-xl"></div>
          </div>
        </div>
      `,
      tableRow: `
        <tr class="animate-pulse">
          <td class="px-5 py-4"><div class="h-4 bg-slate-100 rounded w-32"></div></td>
          <td class="px-5 py-4 text-center"><div class="h-6 bg-slate-100 rounded-full w-12 mx-auto"></div></td>
          <td class="px-5 py-4 text-center"><div class="h-4 bg-slate-100 rounded w-16 mx-auto"></div></td>
          <td class="px-5 py-4 text-right"><div class="h-8 bg-slate-100 rounded-xl w-20 ml-auto"></div></td>
        </tr>
      `
    };

    return Array(count).fill(skeletons[type] || skeletons.card).join('');
  }
};

export const updateDashboardStats = (stats = {}) => {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  if (stats.students !== undefined) set('statStudents', stats.students);
  if (stats.present !== undefined) set('statPresent', stats.present);
  if (stats.incidents !== undefined) set('statIncidents', stats.incidents);
  if (stats.classes !== undefined) set('statClasses', stats.classes);
};

// Exportación unificada para módulos que prefieren el objeto UI
export const UI = {
  safeToast,
  safeEscapeHTML,
  Modal,
  Skeleton,
  updateDashboardStats
};

export default UI;