/**
 * 🚀 Karpus Kids — VirtualList
 * Renderiza solo los elementos visibles en el viewport.
 * Crítico para listas de 100+ items (pagos, estudiantes, posts).
 *
 * Uso:
 *   const vl = new VirtualList({
 *     container: document.getElementById('list'),
 *     items: dataArray,
 *     renderItem: (item) => `<div class="card">${item.name}</div>`,
 *     itemHeight: 80,   // altura estimada en px
 *     overscan: 5       // items extra fuera del viewport
 *   });
 *   vl.mount();
 *   vl.update(newItems); // actualizar datos
 *   vl.destroy();
 */

export class VirtualList {
  constructor({ container, items = [], renderItem, itemHeight = 72, overscan = 5 }) {
    this._container  = container;
    this._items      = items;
    this._renderItem = renderItem;
    this._itemHeight = itemHeight;
    this._overscan   = overscan;
    this._scrollEl   = null;
    this._inner      = null;
    this._raf        = null;
    this._lastStart  = -1;
    this._lastEnd    = -1;
  }

  mount() {
    if (!this._container) return;

    // Wrapper con scroll
    this._container.style.cssText = 'overflow-y:auto;position:relative;';
    this._inner = document.createElement('div');
    this._inner.style.cssText = 'position:relative;width:100%;';
    this._container.appendChild(this._inner);

    this._updateHeight();
    this._render();

    this._container.addEventListener('scroll', this._onScroll.bind(this), { passive: true });
    this._resizeObserver = new ResizeObserver(() => this._render());
    this._resizeObserver.observe(this._container);
  }

  update(items) {
    this._items = items;
    this._lastStart = -1;
    this._lastEnd   = -1;
    this._updateHeight();
    this._render();
  }

  destroy() {
    this._container?.removeEventListener('scroll', this._onScroll.bind(this));
    this._resizeObserver?.disconnect();
    cancelAnimationFrame(this._raf);
    if (this._inner) this._inner.remove();
  }

  _updateHeight() {
    if (this._inner) {
      this._inner.style.height = `${this._items.length * this._itemHeight}px`;
    }
  }

  _onScroll() {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this._render());
  }

  _render() {
    if (!this._container || !this._inner) return;

    const scrollTop     = this._container.scrollTop;
    const viewportH     = this._container.clientHeight;
    const totalItems    = this._items.length;

    const startIdx = Math.max(0, Math.floor(scrollTop / this._itemHeight) - this._overscan);
    const endIdx   = Math.min(totalItems - 1, Math.ceil((scrollTop + viewportH) / this._itemHeight) + this._overscan);

    // Evitar re-render si el rango no cambió
    if (startIdx === this._lastStart && endIdx === this._lastEnd) return;
    this._lastStart = startIdx;
    this._lastEnd   = endIdx;

    const fragment = document.createDocumentFragment();
    for (let i = startIdx; i <= endIdx; i++) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;top:${i * this._itemHeight}px;left:0;right:0;`;
      el.innerHTML = this._renderItem(this._items[i], i);
      fragment.appendChild(el);
    }

    this._inner.innerHTML = '';
    this._inner.appendChild(fragment);

    if (window.lucide) lucide.createIcons({ el: this._inner });
  }
}
