/**
 * 🧰 Helpers PRO - Nivel Empresa
 */
export const Helpers = {
  /**
   * 🛡️ Escapar HTML (sin DOM - más rápido y universal)
   */
  escapeHTML(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /**
   * 🔔 Toast avanzado
   */
  toast(msg, type = 'success', duration = 4000) {
    if (!msg) return;

    document.querySelectorAll('.app-toast').forEach(t => t.remove());

    const t = document.createElement('div');
    t.className = `app-toast fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl transition-all duration-300 border ${
      type === 'error'
        ? 'bg-rose-500 text-white border-rose-400'
        : type === 'warning'
        ? 'bg-amber-500 text-white border-amber-400'
        : 'bg-slate-900 text-white border-slate-800'
    }`;

    t.innerHTML = `
      <div class="w-2 h-2 rounded-full bg-white animate-pulse"></div>
      <span class="text-sm font-black uppercase tracking-wider">
        ${Helpers.escapeHTML(msg)}
      </span>
    `;

    document.body.appendChild(t);

    setTimeout(() => {
      t.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => t.remove(), 300);
    }, duration);
  },

  /**
   * 🎭 Empty State
   */
  emptyState(msg, icon = 'smile') {
    return `
      <div class="flex flex-col items-center justify-center p-12 text-center bg-slate-50/50 rounded-[3rem] border-2 border-dashed border-slate-200 w-full">
        <div class="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 shadow-xl">
          <i data-lucide="${icon}" class="w-10 h-10 text-slate-300"></i>
        </div>
        <h4 class="text-slate-800 font-black text-lg mb-2">Sin datos</h4>
        <p class="text-slate-400 font-bold text-sm max-w-[250px]">
          ${Helpers.escapeHTML(msg)}
        </p>
      </div>
    `;
  },

  /**
   * 🦴 Skeleton Loader
   */
  skeleton(count = 3, height = 'h-20') {
    return Array.from({ length: count }).map(() => `
      <div class="w-full ${height} bg-slate-100 rounded-3xl animate-pulse mb-4 flex items-center gap-4 px-6">
        <div class="w-12 h-12 bg-slate-200 rounded-2xl"></div>
        <div class="flex-1 space-y-2">
          <div class="w-1/2 h-3 bg-slate-200 rounded-full"></div>
          <div class="w-1/4 h-2 bg-slate-200 rounded-full"></div>
        </div>
      </div>
    `).join('');
  },

  /**
   * ⏳ Debounce PRO (con cancel)
   */
  debounce(func, wait = 300) {
    let timeout;

    const debounced = (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };

    debounced.cancel = () => clearTimeout(timeout);

    return debounced;
  },

  /**
   * 🆔 Generador de IDs
   */
  uid() {
    return crypto.randomUUID();
  },

  /**
   * ⏱️ Sleep (UX async)
   */
  sleep(ms = 300) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * 📅 Formatear fecha
   */
  formatDate(date) {
    if (!date) return '';
    return new Date(date).toLocaleDateString('es-DO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  },

  /**
   * 💰 Formato moneda RD
   */
  formatCurrency(amount = 0) {
    return new Intl.NumberFormat('es-DO', {
      style: 'currency',
      currency: 'DOP'
    }).format(amount);
  },

  /**
   * 📉 Exportar datos a CSV (Excel)
   * @param {Array} data - Array de objetos
   * @param {string} filename - Nombre del archivo
   */
  exportToCSV(data, filename = 'export.csv') {
    if (!data || !data.length) {
      this.toast('No hay datos para exportar', 'warning');
      return;
    }

    // Obtener headers
    const headers = Object.keys(data[0]);
    
    // Convertir a CSV string
    const csvContent = [
      headers.join(','), // Header row
      ...data.map(row => headers.map(fieldName => {
        let val = row[fieldName] === null || row[fieldName] === undefined ? '' : row[fieldName];
        // Escapar comillas y envolver en comillas si tiene comas
        val = String(val).replace(/"/g, '""');
        if (val.search(/("|,|\n)/g) >= 0) val = `"${val}"`;
        return val;
      }).join(','))
    ].join('\r\n');

    // Crear Blob y descargar
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' }); // \ufeff es BOM para que Excel abra UTF-8
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
};