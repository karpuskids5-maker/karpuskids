/**
 * ⚡ Karpus Kids — ScrollModule
 * Sistema reutilizable de scroll inteligente para todos los paneles.
 * - Infinite scroll (tipo Instagram) para listas hacia abajo
 * - Top scroll (tipo WhatsApp) para cargar mensajes anteriores
 * - Debounce integrado para buscadores
 */

export const ScrollModule = {

  /**
   * Infinite scroll hacia abajo — para feeds, listas, tablas
   * @param {HTMLElement|string} container  — el contenedor con scroll
   * @param {Function}           loadFn     — async fn que carga más datos
   * @param {number}             threshold  — px antes del fondo para disparar (default 150)
   * @returns {{ destroy: Function }}
   */
  infiniteScroll({ container, loadFn, threshold = 150 }) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return { destroy: () => {} };

    let loading = false;

    const handler = async () => {
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
      if (!nearBottom || loading) return;
      loading = true;
      try { await loadFn(); } finally { loading = false; }
    };

    el.addEventListener('scroll', handler, { passive: true });
    return { destroy: () => el.removeEventListener('scroll', handler) };
  },

  /**
   * Infinite scroll usando IntersectionObserver — más eficiente que scroll event
   * Observa el último elemento del contenedor y carga más cuando es visible
   * @param {HTMLElement} sentinel  — elemento centinela al final de la lista
   * @param {Function}    loadFn    — async fn que carga más datos
   * @returns {{ destroy: Function }}
   */
  observeEnd(sentinel, loadFn) {
    if (!sentinel) return { destroy: () => {} };
    let loading = false;

    const observer = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting || loading) return;
      loading = true;
      try { await loadFn(); } finally { loading = false; }
    }, { rootMargin: '200px' });

    observer.observe(sentinel);
    return { destroy: () => observer.disconnect() };
  },

  /**
   * Top scroll — para chat tipo WhatsApp (cargar mensajes anteriores)
   * @param {HTMLElement|string} container
   * @param {Function}           loadFn
   * @returns {{ destroy: Function }}
   */
  topScroll({ container, loadFn }) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return { destroy: () => {} };

    let loading = false;

    const handler = async () => {
      if (el.scrollTop > 40 || loading) return;
      loading = true;
      const prevHeight = el.scrollHeight;
      try {
        await loadFn();
        // Mantener posición de scroll después de insertar mensajes arriba
        el.scrollTop = el.scrollHeight - prevHeight;
      } finally {
        loading = false;
      }
    };

    el.addEventListener('scroll', handler, { passive: true });
    return { destroy: () => el.removeEventListener('scroll', handler) };
  },

  /**
   * Scroll al fondo de un contenedor (para chat)
   * @param {HTMLElement|string} container
   * @param {boolean}            smooth
   */
  scrollToBottom(container, smooth = false) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  },

  /**
   * Debounce para buscadores — evita queries en cada tecla
   * @param {Function} fn
   * @param {number}   delay  ms (default 300)
   * @returns {Function}
   */
  debounce(fn, delay = 300) {
    let t;
    const debounced = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
    debounced.cancel = () => clearTimeout(t);
    return debounced;
  },

  /**
   * Filtro DOM en tiempo real — para listas ya renderizadas
   * @param {string}   listSelector  — selector de los items (ej: '.student-item')
   * @param {string}   query         — texto a buscar
   * @param {string}   textSelector  — selector del texto dentro del item (opcional)
   */
  filterList(listSelector, query, textSelector = null) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll(listSelector).forEach(item => {
      const text = textSelector
        ? (item.querySelector(textSelector)?.textContent || '')
        : item.textContent;
      item.style.display = (!q || text.toLowerCase().includes(q)) ? '' : 'none';
    });
  },

  /**
   * Conecta un input de búsqueda con filterList automáticamente
   * @param {string}   inputId
   * @param {string}   listSelector
   * @param {string}   textSelector  (opcional)
   * @param {Function} onSearch      callback adicional (opcional)
   */
  bindSearch(inputId, listSelector, textSelector = null, onSearch = null) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const handler = this.debounce((e) => {
      const q = e.target.value;
      this.filterList(listSelector, q, textSelector);
      if (onSearch) onSearch(q);
    }, 280);

    input.addEventListener('input', handler);
    return { destroy: () => input.removeEventListener('input', handler) };
  }
};
