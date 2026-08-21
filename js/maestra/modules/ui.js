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
    // z-index 3000: por encima del header sticky (200), overlay (1040) y sidebar (1050).
    // Sheet detection: si el content incluye la marca 'kk-is-sheet', alinear al fondo en móvil.
    const isSheet = content.includes('kk-is-sheet');
    modal.id = id;
    modal.className = isSheet
      ? 'fixed inset-0 flex items-end sm:items-center justify-center overscroll-contain'
      : 'fixed inset-0 flex items-center justify-center overflow-y-auto overscroll-contain p-3 sm:p-4';
    modal.style.cssText = 'z-index:3000;background:rgba(15,23,42,0.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:fadeInModal 0.15s ease-out;-webkit-overflow-scrolling:touch;';

    if (isSheet) {
      modal.innerHTML = `<div id="${id}-inner" class="relative w-full sm:m-auto flex justify-center" style="max-width:28rem;">${content}</div>`;
    } else {
      modal.innerHTML = `<div id="${id}-inner" class="relative m-auto" style="max-width:calc(100vw - 1.5rem);max-height:calc(100dvh - 1.5rem);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;">${content}</div>`;
    }

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

if (!document.getElementById('modal-animations')) {
  const style = document.createElement('style');
  style.id = 'modal-animations';
  style.textContent = `@keyframes fadeInModal{from{opacity:0}to{opacity:1}}`;
  document.head.appendChild(style);
}

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