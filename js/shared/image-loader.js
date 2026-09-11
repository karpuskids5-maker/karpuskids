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
    let src = el.dataset.src;
    const fallback = el.dataset.fallback || 'img/mundo.jpg';
    if (!src) return;

    // ✅ OPTIMIZACIÓN CDN: Transformar URL de Supabase para carga ligera
    // Solo si es una URL de Supabase Storage
    if (src.includes('.supabase.co/storage/v1/object/public/')) {
      const width = el.dataset.width || 400;
      const quality = el.dataset.quality || 75;
      // Supabase Image Transformation requiere habilitar el add-on, 
      // pero podemos usar parámetros estándar si está configurado.
      if (!src.includes('?')) {
        src += `?width=${width}&quality=${quality}&format=webp`;
      }
    }

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
    // Precargar la fuente iluminada — solo metadata primero (rápido, no bloquea)
    if (el.dataset.poster) el.poster = el.dataset.poster;
    el.preload = el.dataset.preload || 'metadata';
    el.src = src; el.load();
    el.dataset.loaded = '1'; el.classList.add('karpus-img-loaded');
    // Cuando la metadata esté lista, subir a preload auto para arranque instantáneo
    el.addEventListener('loadedmetadata', () => {
      if (el.dataset.preload !== 'none') el.preload = 'auto';
    }, { once: true });
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
    const { cls = 'w-full max-h-[500px] mx-auto', controls = true, preload = 'metadata' } = opts;
    return `<video data-src="${src}" ${poster ? `data-poster="${poster}"` : ''} data-preload="${preload}" class="karpus-img karpus-img-loading ${cls}" ${controls ? 'controls' : ''} playsinline preload="${preload}"></video>`;
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
      maxWidth  = 800,    // ✅ Reducido de 1200 a 800 para mayor velocidad
      maxHeight = 800,
      quality   = 0.75,   // ✅ Calidad 75% para balance óptimo
      maxSizeKB = 300,    // ✅ Límite más estricto
      format    = 'image/webp'
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
          // Forzar compresión nativa WebP para optimización de carga
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

          canvas.toBlob((blob) => {
            if (!blob) { resolve(file); return; }
            const name = file.name.replace(/\.[^.]+$/, '') + '.webp';
            resolve(new File([blob], name, { type: 'image/webp' }));
          }, 'image/webp', 0.75); // Forzar compresión nativa WebP a 75%
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
  /**
   * Sube una imagen a Supabase Storage, usando la Edge Function resize-image
   * para redimensionar y convertir a WebP en el servidor si está disponible.
   * Fallback: compresión client-side + upload directo.
   *
   * @param {File}   file         — archivo a subir
   * @param {string} bucket       — bucket de Storage
   * @param {string} path         — ruta destino (ej: 'avatars/user123.webp')
   * @param {object} compressOpts — { maxWidth, maxHeight, quality, maxSizeKB }
   */
  async uploadToStorage(file, bucket, path, compressOpts = {}) {
    const { supabase } = await import('./supabase.js');

    const isVideo = file.type.startsWith('video/') ||
      /\.(mp4|webm|mov|ogv|m4v|mkv|3gp|avi|wmv|flv)$/i.test(file.name || '');

    // ── VIDEOS: no se comprimen ni pasan por resize-image (es solo imágenes).
    // Además, el bucket 'karpus-uploads' NO acepta video/mp4 ni archivos >5MB,
    // por eso los videos se suben a 'classroom_media' (permite video, 50MB).
    if (isVideo) {
      const videoBucket = (bucket === 'karpus-uploads' || bucket === 'avatars' || bucket === 'posts')
        ? 'classroom_media'
        : bucket;
      const { error } = await supabase.storage.from(videoBucket).upload(path, file, {
        cacheControl: '31536000',
        contentType: file.type || 'video/mp4',
        upsert: true
      });
      if (error) throw error;
      const { data } = supabase.storage.from(videoBucket).getPublicUrl(path);
      return data.publicUrl;
    }

    const maxWidth  = compressOpts.maxWidth  || 800;
    const maxHeight = compressOpts.maxHeight || 800;
    const quality   = compressOpts.quality   ? Math.round(compressOpts.quality * 100) : 82;

    // Intentar Edge Function resize-image (servidor — mejor calidad y WebP real)
    try {
      const base64 = await this._fileToBase64(file);
      const { data, error } = await supabase.functions.invoke('resize-image', {
        body: {
          base64,
          mimeType:  file.type || 'image/jpeg',
          bucket,
          path,
          maxWidth,
          maxHeight,
          quality,
        }
      });

      if (!error && data?.publicUrl) {
        return data.publicUrl;
      }
      // Si la Edge Function falla, continuar con fallback
    } catch (_) { /* fallback silencioso */ }

    // Fallback: compresión client-side + upload directo
    const compressed = await this.compress(file, compressOpts);
    const { error } = await supabase.storage.from(bucket).upload(path, compressed, {
      cacheControl: '31536000',
      upsert: true
    });
    if (error) throw error;

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  },

  /** Convierte un File a base64 string */
  _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = (e) => resolve(String(e.target.result).replace(/^data:[^;]+;base64,/, ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  /**
   * Genera thumbnails de un archivo de video usando canvas.
   * @param {File|Blob} videoFile — archivo de video
   * @param {number} count — cuántos thumbnails generar
   * @returns {Promise<Blob|null>} — thumbnails [blobPrincipal, ...multiples] o []
   */
  async _generateVideoThumbnails(videoFile, count = 5) {
    const list = [];
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const url = URL.createObjectURL(videoFile);

    try {
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
        video.src = url;
      });
      const duration = video.duration || 30;
      // Principal: 20% del video o 10s (reutiliza el criterio actual)
      const times = [];
      times.push(Math.max(0.1, Math.min(10, duration * 0.2)));
      for (let i = 0; i < count; i++) {
        times.push(Math.max(0.5, (duration / (count + 1)) * (i + 1)));
      }

      for (const t of times) {
        const blob = await new Promise((resolve) => {
          video.onseeked = () => {
            try {
              const w = video.videoWidth || 640;
              const h = video.videoHeight || 360;
              const canvas = document.createElement('canvas');
              canvas.width = 160;
              canvas.height = Math.round(160 * h / w);
              canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
              canvas.toBlob(b => resolve(b), 'image/webp', 0.6);
            } catch (_) { resolve(null); }
          };
          try { video.currentTime = t; } catch (_) { resolve(null); }
        });
        if (blob) list.push(blob);
      }
    } catch (_) {
      // Silencioso
    } finally {
      URL.revokeObjectURL(url);
    }
    return list;
  },

  /**
   * Sube un video a Supabase Storage y genera su portada y thumbnails
   * múltiples (vista previa estilo YouTube). Devuelve las URLs públicas.
   *
   * @param {File} file — video a subir
   * @param {object} opts — { onProgress }
   * @returns {Promise<{publicUrl, thumbnailUrl, thumbnailUrls}>}
   */
  async uploadVideoWithThumbnails(file, opts = {}) {
    const { supabase } = await import('./supabase.js');
    const { onProgress } = opts;

    const isVideo = file.type.startsWith('video/') ||
      /\.(mp4|webm|mov|ogv|m4v|mkv|3gp|avi|wmv|flv)$/i.test(file.name || '');
    if (!isVideo) {
      const publicUrl = await this.uploadToStorage(file, 'karpus-uploads',
        `posts/${Date.now()}.webp`, { maxWidth: 1200, quality: 0.8 });
      return { publicUrl, thumbnailUrl: null, thumbnailUrls: [] };
    }

    const ext = (file.name || 'video.mp4').split('.').pop();
    const path = `posts/${Date.now()}_${crypto.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 8)}.${ext}`;

    const videoBucket = 'classroom_media';
    const { error } = await supabase.storage.from(videoBucket).upload(path, file, {
      cacheControl: '31536000',
      contentType: file.type || 'video/mp4',
      upsert: true
    });
    if (error) throw error;
    const { data } = supabase.storage.from(videoBucket).getPublicUrl(path);
    const publicUrl = data.publicUrl;

    // Generar portada + thumbnails múltiples
    let thumbnailUrl = null;
    let thumbnailUrls = [];
    try {
      const thumbs = await this._generateVideoThumbnails(file, 5);
      if (thumbs.length > 1) thumbnailUrl = await this._uploadThumb(thumbs[0], 'poster');
      const multi = thumbs.slice(1);
      thumbnailUrls = (await Promise.allSettled(
        multi.map((t, i) => this._uploadThumb(t, `t${i}`))
      )).map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
    } catch (e) {
      console.warn('[ImageLoader] Thumbnail generation failed:', e);
    }

    return { publicUrl, thumbnailUrl, thumbnailUrls };
  },

  async _uploadThumb(blob, label) {
    const { supabase } = await import('./supabase.js');
    const path = `wall/thumbs/${Date.now()}_${label}_${crypto.randomUUID?.().slice(0, 6) || Math.random().toString(36).slice(2, 8)}.webp`;
    const { error } = await supabase.storage.from('posts').upload(path, blob, {
      cacheControl: '31536000',
      contentType: 'image/webp',
      upsert: true
    });
    if (error) throw error;
    const { data } = supabase.storage.from('posts').getPublicUrl(path);
    return data.publicUrl;
  }
};

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ImageLoader.init());
} else {
  ImageLoader.init();
}
