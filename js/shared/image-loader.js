/**
 * 🖼️ Karpus Kids — ImageLoader v2
 * Lazy loading con skeleton shimmer, blur-up effect y compresión antes de subir.
 * v2: compresión WebP, cache de URLs, uploadToStorage helper.
 */

const BLUR_PH = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Cache de URLs ya procesadas para evitar re-fetch
const _urlCache = new Map();

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
    }, { rootMargin: '300px' }); // 300px de anticipación para pre-cargar
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

    // Usar cache si ya se cargó esta URL
    if (_urlCache.has(src)) {
      el.src = _urlCache.get(src);
      el.classList.remove('karpus-img-loading');
      el.classList.add('karpus-img-loaded');
      el.dataset.loaded = '1';
      return;
    }

    const tmp = new Image();
    tmp.onload = () => {
      _urlCache.set(src, src);
      el.src = src;
      el.classList.remove('karpus-img-loading');
      el.classList.add('karpus-img-loaded');
      el.dataset.loaded = '1';
    };
    tmp.onerror = () => {
      if (fallback) el.src = fallback;
      el.classList.remove('karpus-img-loading');
      el.classList.add('karpus-img-loaded');
      el.dataset.loaded = '1';
    };
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
    const { fallback = 'img/mundo.jpg', alt = '', cls = 'w-full h-full object-cover', priority = 'low' } = opts;
    if (!src) return `<img src="${fallback}" alt="${alt}" class="${cls}" loading="lazy">`;
    // Primer post o imágenes críticas: cargar inmediatamente sin lazy
    if (priority === 'high') {
      return `<img src="${src}" alt="${alt}" class="${cls}" loading="eager" decoding="async" onerror="this.src='${fallback}'">`;
    }
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
  },

  prefetch(urls = []) {
    if (!urls.length) return;
    const load = () => {
      urls.forEach(url => {
        if (!url || _urlCache.has(url)) return;
        const img = new Image();
        img.onload = () => _urlCache.set(url, url);
        img.src = url;
      });
    };
    if ('requestIdleCallback' in window) {
      requestIdleCallback(load, { timeout: 2000 });
    } else {
      setTimeout(load, 500);
    }
  },

  /**
   * 🚀 Prefetch — pre-carga URLs en background para que estén listas antes de mostrarse.
   * Llamar con las URLs del siguiente lote de posts.
   */
  prefetch(urls = []) {
    if (!urls.length) return;
    // Usar requestIdleCallback para no bloquear el hilo principal
    const load = () => {
      urls.forEach(url => {
        if (!url || _urlCache.has(url)) return;
        const img = new Image();
        img.onload = () => _urlCache.set(url, url);
        img.src = url;
      });
    };
    if ('requestIdleCallback' in window) {
      requestIdleCallback(load, { timeout: 2000 });
    } else {
      setTimeout(load, 500);
    }
  },

  /**
   * 🗜️ Comprimir imagen antes de subir a Supabase Storage.
   * Reduce el tamaño hasta un 80% manteniendo buena calidad visual.
   *
   * @param {File} file — archivo original
   * @param {object} opts — { maxWidth, maxHeight, quality, maxSizeKB }
   * @returns {Promise<File>} — archivo comprimido
   */
  async compress(file, opts = {}) {
    const {
      maxWidth  = 1200,
      maxHeight = 1200,
      quality   = 0.82,   // 82% calidad — buen balance tamaño/calidad
      maxSizeKB = 500,    // si supera 500KB, comprimir más
      format    = 'image/webp' // WebP es 30% más pequeño que JPEG
    } = opts;

    // Solo comprimir imágenes (no PDFs, videos, etc.)
    if (!file.type.startsWith('image/')) return file;

    // Si ya es pequeño, no comprimir
    if (file.size < 100 * 1024) return file; // < 100KB → no tocar

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');

          // Calcular dimensiones manteniendo proporción
          let { width, height } = img;
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width  = Math.round(width  * ratio);
            height = Math.round(height * ratio);
          }

          canvas.width  = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Intentar WebP primero, fallback a JPEG
          const tryFormat = canvas.toDataURL(format, quality);
          const useFormat = tryFormat.startsWith('data:image/webp') ? format : 'image/jpeg';

          canvas.toBlob((blob) => {
            if (!blob) { resolve(file); return; }

            // Si sigue siendo grande, comprimir más
            if (blob.size > maxSizeKB * 1024 && quality > 0.5) {
              canvas.toBlob((blob2) => {
                const ext = useFormat === 'image/webp' ? 'webp' : 'jpg';
                const name = file.name.replace(/\.[^.]+$/, '') + '.' + ext;
                resolve(new File([blob2 || blob], name, { type: useFormat }));
              }, useFormat, quality * 0.7);
            } else {
              const ext = useFormat === 'image/webp' ? 'webp' : 'jpg';
              const name = file.name.replace(/\.[^.]+$/, '') + '.' + ext;
              const compressed = new File([blob], name, { type: useFormat });
              console.log(`[ImageLoader] Comprimido: ${(file.size/1024).toFixed(0)}KB → ${(compressed.size/1024).toFixed(0)}KB`);
              resolve(compressed);
            }
          }, useFormat, quality);
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  },

  /**
   * 📤 Subir imagen a Supabase Storage con compresión automática.
   * Retorna la URL pública.
   *
   * @param {File} file — archivo a subir
   * @param {string} bucket — nombre del bucket
   * @param {string} path — ruta dentro del bucket
   * @param {object} compressOpts — opciones de compresión
   */
  async uploadToStorage(file, bucket, path, compressOpts = {}) {
    const { supabase } = await import('./supabase.js');

    // Comprimir antes de subir
    const compressed = await this.compress(file, compressOpts);

    const { error } = await supabase.storage.from(bucket).upload(path, compressed, {
      cacheControl: '31536000', // 1 año de caché en CDN
      upsert: true
    });

    if (error) throw error;

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }
};

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ImageLoader.init());
} else {
  ImageLoader.init();
}
