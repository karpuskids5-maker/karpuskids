/**
 * ⚡ Karpus Kids — MediaModule
 * Optimización de imágenes nivel Facebook:
 * - Transformación en el edge via Supabase Storage
 * - LQIP (Low Quality Image Placeholder) con blur
 * - Lazy loading con IntersectionObserver (200px de anticipación)
 * - Upload Queue Manager con progreso
 */

import { supabase } from './supabase.js';

// ─── Transformación de imágenes en el edge ────────────────────────────────────

/**
 * Genera URL optimizada de Supabase Storage con resize en el edge.
 * @param {string} url       URL original de Supabase Storage
 * @param {object} opts      { width, height, quality, format }
 */
export function optimizeImageUrl(url, { width = 800, height, quality = 80, format = 'webp' } = {}) {
  if (!url || !url.includes('supabase')) return url;
  try {
    const u = new URL(url);
    // Supabase Storage Image Transformation API
    u.searchParams.set('width', width);
    if (height) u.searchParams.set('height', height);
    u.searchParams.set('quality', quality);
    u.searchParams.set('format', format);
    u.searchParams.set('resize', 'contain');
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Genera URL de miniatura (thumbnail) muy pequeña para LQIP.
 */
export function thumbnailUrl(url) {
  return optimizeImageUrl(url, { width: 20, quality: 20, format: 'webp' });
}

// ─── Lazy Loading con LQIP ────────────────────────────────────────────────────

const _lazyObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const img = entry.target;
    const src = img.dataset.src;
    if (!src) return;

    // Cargar imagen real
    const real = new Image();
    real.onload = () => {
      img.src = src;
      img.style.filter = 'none';
      img.style.transition = 'filter 0.4s ease';
      img.removeAttribute('data-src');
    };
    real.src = src;
    _lazyObserver.unobserve(img);
  });
}, {
  rootMargin: '200px 0px',  // empieza a cargar 200px antes de ser visible
  threshold: 0
});

/**
 * Renderiza una imagen con LQIP + lazy loading.
 * Uso: en lugar de <img src="...">, usa renderLazyImage(url, alt, className)
 */
export function renderLazyImage(url, alt = '', className = '', opts = {}) {
  if (!url) return `<div class="bg-slate-100 ${className} flex items-center justify-center text-slate-300 text-xs">Sin imagen</div>`;

  const optimized = optimizeImageUrl(url, opts);
  const lqip      = thumbnailUrl(url);

  return `<img
    src="${lqip}"
    data-src="${optimized}"
    alt="${alt}"
    class="${className} lazy-img"
    style="filter:blur(8px);transition:filter 0.4s ease;"
    loading="lazy"
    decoding="async"
  >`;
}

/**
 * Activa el lazy loading en todas las imágenes con data-src en el contenedor.
 */
export function activateLazyImages(container = document) {
  container.querySelectorAll('img[data-src]').forEach(img => {
    _lazyObserver.observe(img);
  });
}

// ─── Upload Queue Manager ─────────────────────────────────────────────────────

export const UploadQueue = {
  _queue: [],
  _active: false,
  _listeners: [],

  /**
   * Agrega un archivo a la cola de subida.
   * @param {File}     file
   * @param {string}   bucket   — nombre del bucket de Supabase Storage
   * @param {string}   path     — ruta dentro del bucket
   * @param {Function} onDone   — callback(publicUrl) cuando termina
   */
  add(file, bucket, path, onDone) {
    const id = crypto.randomUUID();
    this._queue.push({ id, file, bucket, path, onDone, progress: 0, status: 'pending' });
    this._notify();
    this._process();
    return id;
  },

  async _process() {
    if (this._active) return;
    const item = this._queue.find(i => i.status === 'pending');
    if (!item) return;

    this._active = true;
    item.status = 'uploading';
    this._notify();

    try {
      // Supabase Storage upload con seguimiento de progreso via XMLHttpRequest
      const { data, error } = await supabase.storage
        .from(item.bucket)
        .upload(item.path, item.file, {
          cacheControl: '3600',
          upsert: true,
          onUploadProgress: (e) => {
            item.progress = Math.round((e.loaded / e.total) * 100);
            this._notify();
          }
        });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage.from(item.bucket).getPublicUrl(item.path);
      item.status = 'done';
      item.progress = 100;
      this._notify();
      item.onDone?.(publicUrl);

    } catch (e) {
      item.status = 'error';
      item.error = e.message;
      this._notify();
      console.error('[UploadQueue] Error:', e.message);
    } finally {
      this._active = false;
      // Limpiar completados después de 3s
      setTimeout(() => {
        this._queue = this._queue.filter(i => i.status !== 'done');
        this._notify();
        this._process(); // procesar siguiente
      }, 3000);
    }
  },

  /** Suscribirse a cambios de la cola */
  subscribe(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  },

  _notify() {
    this._listeners.forEach(fn => fn([...this._queue]));
    this._renderToast();
  },

  /** Toast flotante de progreso */
  _renderToast() {
    const active = this._queue.filter(i => i.status === 'uploading' || i.status === 'pending');
    let toast = document.getElementById('_upload_toast');

    if (!active.length) {
      toast?.remove();
      return;
    }

    if (!toast) {
      toast = document.createElement('div');
      toast.id = '_upload_toast';
      toast.style.cssText = 'position:fixed;bottom:80px;right:16px;z-index:9990;min-width:220px;max-width:280px;';
      document.body.appendChild(toast);
    }

    const item = active[0];
    toast.innerHTML = `
      <div class="bg-white rounded-2xl shadow-xl border border-slate-100 p-4">
        <div class="flex items-center gap-3 mb-2">
          <div class="w-8 h-8 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
            <svg class="w-4 h-4 text-indigo-600 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-xs font-bold text-slate-700 truncate">Subiendo archivo...</p>
            <p class="text-[10px] text-slate-400 truncate">${item.file?.name || ''}</p>
          </div>
        </div>
        <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div class="h-full bg-indigo-500 rounded-full transition-all duration-300" style="width:${item.progress}%"></div>
        </div>
        <p class="text-[10px] text-slate-400 mt-1 text-right">${item.progress}%</p>
      </div>`;
  }
};
