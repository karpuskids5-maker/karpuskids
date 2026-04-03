/**
 * 🖼️ Karpus Kids — ImageLoader
 * Lazy loading con skeleton shimmer y blur-up effect.
 * Se auto-inicializa al importar.
 */

const BLUR_PH = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export const ImageLoader = {
  _observer: null,

  init() {
    if (this._observer || typeof IntersectionObserver === 'undefined') return;
    this._observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const el = e.target;
        el.tagName === 'VIDEO' ? this._loadVideo(el) : this._loadImage(el);
        this._observer.unobserve(el);
      });
    }, { rootMargin: '200px' });
    this._observeAll();
  },

  observe(container = document) {
    container.querySelectorAll('[data-src]:not([data-loaded])').forEach(el => {
      this._observer?.observe(el);
    });
  },

  _observeAll() {
    document.querySelectorAll('[data-src]:not([data-loaded])').forEach(el => {
      this._observer?.observe(el);
    });
  },

  _loadImage(el) {
    const src = el.dataset.src;
    const fallback = el.dataset.fallback || 'img/mundo.jpg';
    if (!src) return;
    const tmp = new Image();
    tmp.onload = () => { el.src = src; el.classList.remove('karpus-img-loading'); el.classList.add('karpus-img-loaded'); el.dataset.loaded = '1'; };
    tmp.onerror = () => { if (fallback) el.src = fallback; el.classList.remove('karpus-img-loading'); el.classList.add('karpus-img-loaded'); el.dataset.loaded = '1'; };
    tmp.src = src;
  },

  _loadVideo(el) {
    const src = el.dataset.src;
    if (!src) return;
    if (el.dataset.poster) el.poster = el.dataset.poster;
    el.src = src; el.load();
    el.dataset.loaded = '1'; el.classList.add('karpus-img-loaded');
  },

  img(src, opts = {}) {
    const { fallback = 'img/mundo.jpg', alt = '', cls = 'w-full h-full object-cover' } = opts;
    if (!src) return `<img src="${fallback}" alt="${alt}" class="${cls}" loading="lazy">`;
    return `<img src="${BLUR_PH}" data-src="${src}" data-fallback="${fallback}" alt="${alt}" class="karpus-img karpus-img-loading ${cls}" loading="lazy" decoding="async">`;
  },

  avatar(url, name = '?', opts = {}) {
    const { size = 'w-10 h-10', cls = '', bgCls = 'bg-slate-200', textCls = 'text-slate-600' } = opts;
    const initial = (name || '?').charAt(0).toUpperCase();
    if (!url) return `<div class="${size} rounded-full ${bgCls} flex items-center justify-center font-bold ${textCls} ${cls}">${initial}</div>`;
    return `<div class="${size} rounded-full overflow-hidden ${bgCls} ${cls} relative">
      <img src="${BLUR_PH}" data-src="${url}" alt="${name}" class="karpus-img karpus-img-loading w-full h-full object-cover" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="absolute inset-0 ${bgCls} ${textCls} font-bold flex items-center justify-center" style="display:none">${initial}</div>
    </div>`;
  },

  video(src, poster = '', opts = {}) {
    const { cls = 'w-full max-h-[500px] mx-auto', controls = true } = opts;
    return `<video data-src="${src}" ${poster ? `data-poster="${poster}"` : ''} class="karpus-img karpus-img-loading ${cls}" ${controls ? 'controls' : ''} playsinline preload="none"></video>`;
  },

  skeleton(cls = 'w-full h-48') {
    return `<div class="skeleton ${cls} rounded-xl"></div>`;
  }
};

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ImageLoader.init());
} else {
  ImageLoader.init();
}
