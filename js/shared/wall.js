/**
 * 🏫 WALL MODULE v4 — Muro Escolar Karpus Kids
 * 50 mejoras: seguridad, multimedia sin límite de duración, UX, performance, moderación
 */
import { supabase } from './supabase.js';
import { Helpers } from './helpers.js';
import { ImageLoader } from './image-loader.js';
import { QueryCache } from './query-cache.js';
import { withTimeout, runWithRetry } from './db-utils.js';

// ─── Utilidades ───────────────────────────────────────────────────────────────
const optimizeImageUrl = (url, opts = {}) => {
  if (!url) return null;
  if (/\.(mp4|webm|mov|ogv|m4v|mkv|3gp|avi|wmv|flv)([?#]|$)/i.test(url)) return url;
  if (!url.includes('/storage/v1/object/public/')) return url;
  const { width, quality } = opts;
  if (!width && !quality) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete('width');
    u.searchParams.delete('quality');
    if (width) u.searchParams.set('width', String(width));
    if (quality) u.searchParams.set('quality', String(quality));
    return u.toString();
  } catch (_) { return url; }
};

/** Detecta error 400 de PostgREST por columna inexistente (ej: likes.reaction_type) */
const _isMissingColumnError = (err, col) =>
  !!err && (err.code === '42703' || new RegExp(String.raw`\b${col}\b`, 'i').test(err.message || ''));

/** XSS-safe sanitization */
const _sanitizeHTML = (str) => {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

/** Genera UUID v4 simple */
const _uuid = () => {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};

// ─── Constantes ───────────────────────────────────────────────────────────────
const REACTION_EMOJIS = ['❤️', '👏', '😊', '🎉', '👍', '😍'];
const _SPAM_COOLDOWN_MS = 10_000;
// Límites del Muro Escolar. Fuente única: los tres flujos (directora, maestra y
// asistente) deben leer de aquí para no divergir.
// Ver propuesta.md sección 18 (9:16, 30 s, 25 MB) y sección 24.
const MAX_VIDEO_SIZE_MB = 500;         // MB — sin límite práctico de tamaño
const MAX_IMAGE_SIZE_MB = 5;           // MB
const MAX_IMAGE_WIDTH = 1920;          // px
const SIGNED_URL_EXPIRY_SEC = 3600;    // 1 hora
const MAX_PINNED_POSTS = 2;
// La query del muro hace 4 embeds (likes, comments(count), classroom, teacher) sobre
// PostgREST; 10 s se quedaba corto en paneles con muchos posts y sesión abierta,
// provocando "Query timeout" y dejando el muro en blanco. 25 s mantiene la UI
// responsiva sin falsos negativos.
const POSTS_QUERY_TIMEOUT_MS = 25_000;
const MAX_ALBUM_PHOTOS = 5;

// Relación de aspecto vertical del Muro (propuesta.md L110).
const TARGET_ASPECT_RATIO = 9 / 16;    // 0.5625
const ASPECT_TOLERANCE = 0.04;         // margen: videos de teléfono caen en 0.46-0.60
const MIN_ASPECT_RATIO = TARGET_ASPECT_RATIO - ASPECT_TOLERANCE;
const MAX_ASPECT_RATIO = TARGET_ASPECT_RATIO + ASPECT_TOLERANCE;

// ─── Compresión WebP cliente ────────────────────────────────────────────────
const compressImageToWebP = (file, maxWidth = MAX_IMAGE_WIDTH, quality = 0.80) => {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxWidth) { height = Math.round(height * maxWidth / width); width = maxWidth; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(blob || file), 'image/webp', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
};

/** Genera thumbnail (poster) de video en canvas.
 * Punto de captura: el 20% del video O 10 segundos (se usa el menor de ambos),
 * de modo que la portada sea representativa sin quedarse en el segundo 0 o 1.
 */
const generateVideoThumbnail = (file) => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const url = URL.createObjectURL(file);
    let captured = false;

    const _targetTime = () => {
      const duration = video.duration || MAX_VIDEO_DURATION;
      // 20% del video o 10s, el que sea menor (nunca 0, nunca por encima de la duración).
      return Math.max(0.1, Math.min(10, duration * 0.2));
    };

    const capture = () => {
      if (captured) return;
      captured = true;
      try {
        const w = video.videoWidth || 640;
        const h = video.videoHeight || 360;
        const canvas = document.createElement('canvas');
        canvas.width  = Math.min(w, 640);
        canvas.height = Math.round(canvas.width * h / w);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(blob => resolve(blob), 'image/webp', 0.7);
      } catch (e) {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };

    video.onloadedmetadata = () => {
      try { video.currentTime = _targetTime(); } catch (_) { capture(); }
    };
    // Captura cuando el seek llega al frame objetivo.
    video.onseeked = capture;
    // Fallback: algunos navegadores no disparan 'seeked' de forma fiable;
    // capturamos al alcanzar el punto objetivo durante la reproducción real.
    video.ontimeupdate = () => {
      if (Math.abs(video.currentTime - _targetTime()) < 0.25) capture();
    };
    video.onerror = () => { if (!captured) { URL.revokeObjectURL(url); resolve(null); } };
    video.src = url;
  });
};

/**
 * Genera N miniaturas equiespaciadas a lo largo del video (estilo YouTube).
 * Devuelve [{ blob, time }, ...] o [] si falla.
 */
const generateVideoThumbnailsMulti = (file, count = 5) => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const url = URL.createObjectURL(file);
    const thumbs = [];
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(thumbs);
    };

    const capture = () => {
      try {
        const w = video.videoWidth || 640;
        const h = video.videoHeight || 360;
        const canvas = document.createElement('canvas');
        canvas.width  = Math.min(w, 640);
        canvas.height = Math.round(canvas.width * h / w);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!done && blob) thumbs.push({ blob, time: video.currentTime });
          next();
        }, 'image/webp', 0.7);
      } catch (_) { next(); }
    };

    const seek = (t, onReady) => {
      const fallback = setTimeout(onReady, 2500);
      video.onseeked = () => { clearTimeout(fallback); onReady(); };
      try { video.currentTime = t; } catch (_) { clearTimeout(fallback); onReady(); }
    };

    const next = () => {
      const duration = video.duration || MAX_VIDEO_DURATION;
      if (thumbs.length >= count || duration <= 0) { finish(); return; }
      const target = ((thumbs.length + 1) * duration) / (count + 1);
      seek(target, capture);
    };

    video.onloadedmetadata = () => {
      if (!video.duration || video.duration <= 0) { finish(); return; }
      next();
    };
    video.onerror = () => finish();
    video.src = url;
  });
};

/**
 * Lee duración y dimensiones de un video.
 * Devuelve { ok, duration, width, height, ratio, tooLong, wrongAspect, error }.
 * Never rejects: un video que el navegador no puede leer devuelve error y el
 * llamador decide si bloquear.
 */
const probeVideo = (file) => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (r) => { URL.revokeObjectURL(url); resolve(r); };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
      const ratio = h > 0 ? w / h : 0;
      done({
        ok: true,
        duration: video.duration,
        width: w,
        height: h,
        ratio,
        tooLong: false,       // sin restricción de duración
        wrongAspect: false,   // cualquier orientación permitida
      });
    };
    video.onerror = () => done({ ok: false, error: 'No se pudo leer el video' });
    video.src = url;
  });
};

/** Valida duración de video — sin restricción, siempre ok */
const validateVideoDuration = (file) => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ ok: true, duration: video.duration });
    };
    video.onerror = () => { URL.revokeObjectURL(url); resolve({ ok: true, duration: -1 }); };
    video.src = url;
  });
};

/**
 * Valida un video antes de subir al Muro.
 * Solo verifica que el archivo se pueda leer. Sin restricción de duración ni orientación.
 */
const validateWallVideo = async (file) => {
  if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
    return { ok: false, reason: 'size', message: `El video supera los ${MAX_VIDEO_SIZE_MB}MB permitidos` };
  }
  const info = await probeVideo(file);
  if (!info.ok) {
    return { ok: false, reason: 'unreadable', message: 'No se pudo leer el video. Prueba con otro archivo.' };
  }
  return { ok: true, ...info };
};

// ─── Upload con reintentos ────────────────────────────────────────────────────
const uploadWithRetry = async (bucket, path, blob, mimeType, onProgress, maxRetries = 3) => {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { error } = await supabase.storage.from(bucket).upload(path, blob, {
        contentType: mimeType,
        upsert: true,
        ...(onProgress ? { onUploadProgress: (e) => onProgress(Math.round(e.loaded * 100 / e.total)) } : {})
      });
      if (error) throw error;
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
};

// ─── Draft localStorage ───────────────────────────────────────────────────────
const DraftManager = {
  KEY: 'karpus_wall_draft',
  save(data) { try { localStorage.setItem(this.KEY, JSON.stringify({ ...data, savedAt: Date.now() })); } catch (e) { console.warn('[Wall] Draft save failed:', e); } },
  load() { try { const d = localStorage.getItem(this.KEY); return d ? JSON.parse(d) : null; } catch (_) { return null; } },
  clear() { try { localStorage.removeItem(this.KEY); } catch (e) { console.warn('[Wall] Draft clear failed:', e); } }
};

// ─── WallModule Principal ─────────────────────────────────────────────────────
const WallModule = {
  _appState: null,
  _commentsCache: {},
  _containerId: null,
  _observer: null,
  _options: {},
  _lastPostTime: 0,
  _activeFilter: 'all',
  _videoObserver: null,
  _realtimeChannel: null,
  _page: 0,
  _pageSize: 10,
  _isLoading: false,
  _hasMore: true,
  _supportsThumbStrip: null,   // false si posts.thumbnail_urls aún no existe en la BD
  _pendingUploads: [],       // cola de subidas en segundo plano
  _schedulerTimer: null,
  _recordStream: null,       // MediaStream de grabación
  _lastPrefetched: '',       // URL del último video precargado (siguiente del muro)

  _getLikeColors() {
    let color = this._options.likeColor;
    if (!color) {
      const role = this._appState?.get('profile')?.role || 'padre';
      const map = { padre: 'emerald', maestra: 'orange', asistente: 'emerald', directora: 'purple', admin: 'purple' };
      color = map[role] || 'rose';
    }
    return { text: `text-${color}-500`, fill: `fill-${color}-500`, hover: `hover:text-${color}-500` };
  },

  _relativeTimeFromNow(ts) {
    try {
      const diff = Date.now() - new Date(ts).getTime();
      if (diff < 0) return 'hace poco';
      const s = Math.floor(diff / 1000);
      if (s < 60) return `hace ${s}s`;
      const m = Math.floor(s / 60);
      if (m < 60) return `hace ${m} min`;
      const h = Math.floor(m / 60);
      if (h < 24) return `hace ${h}h`;
      const d = Math.floor(h / 24);
      if (d < 30) return `hace ${d} días`;
      return `hace ${Math.floor(d / 30)} meses`;
    } catch (_) { return ''; }
  },

  _isExpired(createdAt, expireDays) {
    if (!expireDays) return false;
    const d = new Date(createdAt);
    d.setDate(d.getDate() + expireDays);
    return d < new Date();
  },

  _detectSlowNetwork() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return false;
    return conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g' || conn.saveData;
  },

  async init(containerId, options = {}, appState = null) {
    // Invalida cualquier carga en vuelo de una inicialización anterior
    const initToken = (this._initToken = (this._initToken || 0) + 1);
    this._seq = (this._seq || 0) + 1;
    this._page = 0; this._pageSize = 10;
    this._isLoading = false; this._hasMore = true;
    this._autoRetried = false;
    this._containerId = containerId;
    this._options = options;
    this._appState = appState;
    this._activeFilter = 'all';
    this._lastPostTime = 0;

    const container = document.getElementById(containerId);
    if (!container) return;

    await this.loadClassrooms();
    if (initToken !== this._initToken) return; // otra init() la reemplazó
    this.setupFilters();
    this._injectStyles();
    await this.loadPosts(container);
    if (initToken !== this._initToken) return;
    this.subscribeRealtime();
    this._startSchedulerChecker();
  },

  _injectStyles() {
    if (document.getElementById('wall-v4-styles')) return;
    const style = document.createElement('style');
    style.id = 'wall-v4-styles';
    style.textContent = `
      @keyframes wall-shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
      @keyframes wall-slide-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
      @keyframes wall-bounce-in{0%{transform:scale(0.85);opacity:0}60%{transform:scale(1.05)}100%{transform:scale(1);opacity:1}}
      @keyframes wall-record-pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)}50%{box-shadow:0 0 0 8px rgba(239,68,68,0)}}
      .wall-shimmer{background:linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%);background-size:800px 100%;animation:wall-shimmer 1.5s infinite}
      .wall-skeleton{border-radius:1rem;animation:wall-shimmer 1.5s infinite;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:800px 100%}
      .wall-blur-up{filter:blur(10px);transition:filter 0.4s ease}
      .wall-blur-up.wall-img-loaded{filter:blur(0)}
      .wall-video-wrapper{position:relative;cursor:pointer;border-radius:1rem;overflow:hidden;background:#0f172a;display:flex;align-items:center;justify-content:center;max-width:100%;aspect-ratio:16/9;max-height:min(72vh,620px)}
      @media (max-width:640px){.wall-video-wrapper{aspect-ratio:4/3;max-height:min(62vh,440px)}}
      .wall-play-btn{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:60px;height:60px;background:rgba(255,138,0,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:22px;transition:all 0.2s;backdrop-filter:blur(4px);pointer-events:none;box-shadow:0 4px 24px rgba(255,138,0,0.4)}
      .wall-video-wrapper:hover .wall-play-btn{transform:translate(-50%,-50%) scale(1.12);background:rgba(255,138,0,1)}
      .wall-video-duration{position:absolute;bottom:8px;right:10px;background:rgba(0,0,0,0.65);color:white;font-size:9px;font-weight:900;padding:2px 7px;border-radius:8px;backdrop-filter:blur(4px);z-index:3}
      .wall-video-poster{transition:transform 0.35s ease,filter 0.35s ease}
      .wall-video-poster-overlay{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;pointer-events:none;background:#0f172a;transition:opacity 0.3s ease}
      .wall-video-wrapper.is-hovering .wall-play-btn{opacity:0;transform:translate(-50%,-50%) scale(0.6)}
      .wall-video-wrapper.is-loading .wall-play-btn{opacity:0}
      @keyframes wall-spin{to{transform:rotate(360deg)}}
      .wall-video-loading{position:absolute;top:50%;left:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid rgba(255,255,255,0.25);border-top-color:#fff;border-radius:50%;animation:wall-spin 0.8s linear infinite;z-index:3;pointer-events:none}
      .wall-video-badge-hd{position:absolute;top:10px;left:10px;z-index:3;background:rgba(15,23,42,0.55);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.3);color:#fff;font-size:9px;font-weight:900;padding:2px 6px;border-radius:6px;letter-spacing:0.05em}
      .wall-audio-toggle{position:absolute;top:10px;right:10px;z-index:4;width:34px;height:34px;border-radius:9999px;background:rgba(15,23,42,0.55);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.3);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer;transition:all 0.2s;-webkit-tap-highlight-color:transparent;box-shadow:0 2px 10px rgba(0,0,0,0.3)}
      .wall-audio-toggle:active{transform:scale(0.88)}
      @keyframes wall-heart-burst{0%{transform:translate(-50%,-50%) scale(0.4);opacity:0}25%{transform:translate(-50%,-50%) scale(1.2);opacity:1}60%{transform:translate(-50%,-50%) scale(1);opacity:1}100%{transform:translate(-50%,-160%) scale(1.7);opacity:0}}
      .wall-heart-burst{position:absolute;left:0;top:0;z-index:5;font-size:58px;line-height:1;pointer-events:none;animation:wall-heart-burst 0.95s ease forwards;filter:drop-shadow(0 4px 14px rgba(0,0,0,0.35))}
      .wall-thumb-strip{position:absolute;left:0;right:0;bottom:0;display:flex;gap:4px;padding:8px 6px;background:linear-gradient(to top,rgba(0,0,0,0.85),rgba(0,0,0,0));opacity:1;transform:none;transition:opacity 0.2s ease;pointer-events:none;z-index:2}
      .wall-thumb-strip-item{position:relative;flex:1;min-width:0;border-radius:6px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,0.4);transition:transform 0.18s ease}
      .wall-video-wrapper:hover .wall-thumb-strip-item{transform:scale(1.06);box-shadow:0 2px 10px rgba(0,0,0,0.55)}
      .wall-thumb-strip-item img{width:100%;height:100%;object-fit:cover;display:block;aspect-ratio:16/9}
      .wall-thumb-strip-item::after{content:attr(data-time-label);position:absolute;bottom:2px;right:3px;background:rgba(0,0,0,0.7);color:white;font-size:8px;font-weight:900;padding:1px 4px;border-radius:4px;letter-spacing:0.03em}
      .wall-custom-video{width:100%;max-width:100%;height:auto;max-height:min(70vh,560px);background:#000;border-radius:0;display:block}
      .wall-img{width:100%;height:auto;max-height:min(70vh,560px);object-fit:contain;display:block;margin-inline:auto}
      .wall-img.wall-img-compact{max-height:min(52vh,340px)}
      @media (max-width:640px){.wall-img{max-height:min(56vh,420px)}.wall-img.wall-img-compact{max-height:min(46vh,280px)}}
      /* Escritorio: contenedor de foto/video centrado (estilo panel directora) */
      @media (min-width:768px){
        .wall-video-wrapper{max-width:min(100%,820px);margin-inline:auto}
        .wall-img{max-width:min(100%,820px);width:auto}
        .wall-album-carousel{max-width:min(100%,820px);margin-inline:auto}
      }
      .wall-album-slide img.wall-album-img{width:100%;height:auto;max-height:min(70vh,520px);object-fit:contain;display:block;margin-inline:auto}
      @media (max-width:640px){.wall-album-slide img.wall-album-img{max-height:min(56vh,420px)}}
      .wall-lightbox-media{width:100%;height:auto;max-height:85vh;object-fit:contain;border-radius:0.75rem}
      /* ── Lightbox de escritorio: media a la izquierda, conversación a la derecha ── */
      .wall-lb-shell{position:relative;width:100%;max-height:92vh;background:#0b1220;border-radius:1.25rem;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,0.55);display:flex;flex-direction:column}
      @media (min-width:900px){.wall-lb-shell{flex-direction:row;max-width:1240px;height:88vh}}
      .wall-lb-media{position:relative;display:flex;align-items:center;justify-content:center;background:#000;flex:1 1 auto;min-height:0;overflow:hidden}
      @media (min-width:900px){.wall-lb-media{flex:1 1 62%}}
      .wall-lb-media .wall-lightbox-media{max-height:92vh;width:100%;height:auto;object-fit:contain;background:#000}
      @media (min-width:900px){.wall-lb-media .wall-lightbox-media{max-height:none;height:100%;width:100%}}
      .wall-lb-side{background:#ffffff;color:#1e293b;display:flex;flex-direction:column;flex:0 0 auto;border-top:1px solid #e2e8f0;min-height:0;max-height:34vh}
      @media (min-width:900px){.wall-lb-side{flex:1 1 38%;border-top:none;border-left:1px solid #e2e8f0;max-height:none}}
      .wall-lb-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #e2e8f0;flex:0 0 auto}
      .wall-lb-head-title{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:0.09em;color:#64748b}
      .wall-lb-list{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;padding:14px 16px;display:flex;flex-direction:column;gap:14px}
      .wall-lb-foot{display:flex;gap:8px;align-items:center;padding:12px 16px;border-top:1px solid #e2e8f0;background:#f8fafc;flex:0 0 auto}
      .wall-lb-input{flex:1;min-width:0;padding:10px 14px;font-size:13px;border:1px solid #e2e8f0;border-radius:14px;background:#fff;outline:none}
      .wall-lb-input:focus{border-color:#c7d2fe;box-shadow:0 0 0 2px #e0e7ff}
      .wall-lb-send{flex:0 0 auto;padding:10px 14px;border:none;border-radius:14px;background:#4f46e5;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform 0.15s,background 0.15s}
      .wall-lb-send:hover{background:#4338ca}
      .wall-lb-send:active{transform:scale(0.94)}
      .wall-lb-reactions{display:flex;gap:5px;flex-wrap:wrap;padding:10px 16px;border-top:1px solid #f1f5f9;flex:0 0 auto;background:#fff}
      .wall-lb-reaction{width:34px;height:34px;border-radius:50%;border:1px solid #e2e8f0;background:#fff;font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform 0.15s,background 0.15s}
      .wall-lb-reaction:hover{transform:scale(1.16);background:#f8fafc}
      .wall-lb-empty{margin:auto;text-align:center;font-size:12px;color:#94a3b8;font-style:italic;padding:20px}
      .wall-progress-bar{height:3px;background:linear-gradient(90deg,#f97316,#22c55e);border-radius:2px;transition:width 0.1s linear}
      /* ── Controles táctiles del video (feed vertical móvil) ── */
      .wall-scrub{position:absolute;left:0;right:0;bottom:0;height:20px;z-index:6;cursor:pointer;touch-action:none;-webkit-tap-highlight-color:transparent}
      /* La tira de miniaturas ocupa el pie del wrapper: la barra sube para no taparla */
      .wall-scrub.wall-scrub-above-strip{bottom:56px}
      .wall-scrub-track{position:absolute;left:0;right:0;bottom:3px;height:3px;background:rgba(255,255,255,0.28);border-radius:2px;transition:height 0.18s ease}
      .wall-scrub:hover .wall-scrub-track,.wall-scrub.wall-scrub-active .wall-scrub-track{height:6px}
      .wall-scrub-fill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:2px;background:linear-gradient(90deg,#f97316,#22c55e)}
      .wall-scrub-knob{position:absolute;bottom:3px;left:0;width:13px;height:13px;margin-left:-6.5px;border-radius:50%;background:#fff;box-shadow:0 2px 7px rgba(0,0,0,0.5);opacity:0;transform:scale(0.5);transition:opacity 0.18s ease,transform 0.18s ease;pointer-events:none}
      .wall-scrub:hover .wall-scrub-knob,.wall-scrub.wall-scrub-active .wall-scrub-knob{opacity:1;transform:scale(1)}
      .wall-scrub-time{position:absolute;bottom:26px;transform:translateX(-50%);background:rgba(0,0,0,0.78);color:#fff;font-size:10px;font-weight:900;padding:3px 8px;border-radius:7px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.15s ease;backdrop-filter:blur(4px)}
      .wall-scrub.wall-scrub-active .wall-scrub-time{opacity:1}
      .wall-hold-pause{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:7;pointer-events:none;display:flex;flex-col;align-items:center;gap:7px;opacity:0;transition:opacity 0.16s ease}
      .wall-hold-pause.wall-hold-on{opacity:1}
      .wall-hold-icon{width:54px;height:54px;border-radius:50%;background:rgba(0,0,0,0.62);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.32);color:#fff;font-size:19px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 18px rgba(0,0,0,0.4)}
      .wall-hold-label{background:rgba(0,0,0,0.62);backdrop-filter:blur(8px);color:#fff;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.07em;padding:3px 9px;border-radius:7px;white-space:nowrap}
      .wall-tap-icon{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:7;pointer-events:none;width:56px;height:56px;border-radius:50%;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.32);color:#fff;font-size:20px;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.14s ease}
      .wall-tap-icon.wall-tap-on{opacity:1}
      @media (prefers-reduced-motion:reduce){.wall-scrub-track,.wall-scrub-knob,.wall-scrub-time,.wall-hold-pause,.wall-tap-icon{transition:none}}
      @keyframes wall-like-pop{0%{transform:scale(1)}30%{transform:scale(1.45)}60%{transform:scale(0.9)}100%{transform:scale(1)}}
      @keyframes wall-particle-fly{0%{opacity:1;transform:translate(0,0) scale(1)}100%{opacity:0;transform:translate(var(--tx),var(--ty)) scale(0.3)}}
      @keyframes wall-counter-bump{0%{transform:scale(1)}40%{transform:scale(1.25)}100%{transform:scale(1)}}
      @keyframes wall-reaction-picker-in{from{opacity:0;transform:translateY(8px) scale(0.9)}to{opacity:1;transform:translateY(0) scale(1)}}
      @keyframes wall-reply-in{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
      .wall-reaction-bar{display:flex;gap:3px;flex-wrap:wrap}
      .wall-reaction-btn{padding:3px 7px;border-radius:12px;border:1px solid #e2e8f0;background:white;cursor:pointer;font-size:13px;transition:all 0.15s;display:flex;align-items:center;gap:2px;line-height:1;position:relative;user-select:none}
      .wall-reaction-btn:hover{background:#f8fafc;border-color:#cbd5e1;transform:scale(1.12)}
      .wall-reaction-btn.active{background:#eff6ff;border-color:#93c5fd;box-shadow:0 0 0 2px #bfdbfe}
      .wall-reaction-btn.wall-like-pop{animation:wall-like-pop 0.4s cubic-bezier(.36,.07,.19,.97)}
      .wall-like-main{display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:24px;border:1.5px solid #e2e8f0;background:white;cursor:pointer;font-size:12px;font-weight:700;color:#64748b;transition:all 0.15s;user-select:none;position:relative;-webkit-tap-highlight-color:transparent}
      .wall-like-main:hover,.wall-like-main:focus-visible{border-color:#f9a8d4;background:#fdf2f8;color:#e11d48}
      .wall-like-main.active{border-color:#f9a8d4;background:#fdf2f8;color:#e11d48;box-shadow:0 0 0 2px #fecdd3}
      .wall-like-main .wall-emoji{display:inline-block;transition:transform 0.15s;font-size:15px}
      .wall-like-main:active .wall-emoji,.wall-like-main.active .wall-emoji{transform:scale(1.3)}
      .wall-like-label{font-size:11px;font-weight:800}
      .wall-reaction-picker{position:fixed;left:0;top:0;background:white;border-radius:40px;padding:8px 12px;display:flex;gap:4px;box-shadow:0 12px 40px rgba(0,0,0,0.2),0 2px 8px rgba(0,0,0,0.1);border:1px solid #f1f5f9;z-index:9999;animation:wall-reaction-picker-in 0.22s cubic-bezier(.34,1.56,.64,1);white-space:nowrap}
      .wall-reaction-picker::after{content:'';position:absolute;top:100%;left:var(--arrow-x,50%);transform:translateX(-50%);border:6px solid transparent;border-top-color:white;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.08))}
      .wall-reaction-picker.flip::after{top:auto;bottom:100%;border-top-color:transparent;border-bottom-color:white}
      .wall-reaction-picker-btn{font-size:26px;width:38px;height:38px;cursor:pointer;border:none;background:none;border-radius:50%;transition:transform 0.15s;line-height:1;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}
      @media (min-width:640px){.wall-reaction-picker{padding:8px 10px;gap:6px}.wall-reaction-picker-btn{font-size:22px;width:auto;height:auto;padding:3px 4px}}
      .wall-reaction-picker-btn:hover,.wall-reaction-picker-btn:focus-visible{transform:scale(1.45) translateY(-5px)}
      .wall-counter{font-weight:700;font-size:11px;color:#64748b;min-width:14px;display:inline-block}
      .wall-counter.hidden{display:none}
      .wall-counter-bump{animation:wall-counter-bump 0.35s ease}
      .wall-particle{position:absolute;pointer-events:none;font-size:14px;z-index:99;animation:wall-particle-fly 0.7s ease forwards}
      .wall-reply-item{animation:wall-reply-in 0.25s ease;margin-left:28px;margin-top:4px}
      .wall-reply-toggle{font-size:10px;font-weight:700;color:#6366f1;cursor:pointer;background:none;border:none;padding:0 4px;}
      .wall-pinned-badge{background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:2px 8px;border-radius:8px;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:0.05em}
      .wall-net-slow{background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:10px;font-weight:700;color:#92400e;display:flex;align-items:center;gap:6px}
      .wall-view-count{font-size:9px;color:#94a3b8;font-weight:700;display:flex;align-items:center;gap:3px}
      .wall-tagged-avatars{display:flex;margin-top:6px;gap:-4px}
      .wall-tagged-avatar{width:22px;height:22px;border-radius:50%;border:2px solid white;background:#e2e8f0;font-size:8px;font-weight:900;display:flex;align-items:center;justify-content:center;margin-left:-6px;box-shadow:0 1px 3px rgba(0,0,0,0.15);color:#475569}
      .wall-album-carousel{position:relative;overflow:hidden;border-radius:1rem}
      .wall-album-track{display:flex;transition:transform 0.3s ease;will-change:transform}
      .wall-album-slide{flex-shrink:0;width:100%}
      .wall-album-dot{width:6px;height:6px;border-radius:50%;background:#e2e8f0;transition:all 0.2s;cursor:pointer}
      .wall-album-dot.active{background:#f97316;width:16px}
      .wall-record-btn{animation:wall-record-pulse 1.5s infinite}
      .wall-upload-progress{background:#f1f5f9;border-radius:8px;overflow:hidden;height:6px;margin-top:4px}
      .wall-slide-up{animation:wall-slide-up 0.3s ease}
      .wall-bounce-in{animation:wall-bounce-in 0.4s ease}
      .wall-watermark{position:absolute;bottom:8px;left:8px;opacity:0.6;pointer-events:none;font-size:9px;font-weight:900;color:white;text-shadow:0 1px 3px rgba(0,0,0,0.8);letter-spacing:0.05em}
    `;
    document.head.appendChild(style);
  },

  async loadClassrooms() {
    try {
      const cls = await QueryCache.get('classrooms_list',
        async () => { const { data } = await supabase.from('classrooms').select('id, name').order('name'); return data || []; },
        10 * 60_000);
      const sel = document.getElementById('wallClassroomFilter');
      if (sel && cls) {
        sel.innerHTML = '<option value="">Todas las aulas</option>';
        cls.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); });
      }
    } catch (e) {
      console.warn('[Wall] loadClassrooms failed:', e);
    }
  },

  setupFilters() {
    const si = document.getElementById('wallSearch');
    const cs = document.getElementById('wallClassroomFilter');
    let t;
    if (si) si.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.applyFilters(), 500); });
    if (cs) cs.addEventListener('change', () => this.applyFilters());
  },

  setFilter(filter) {
    this._activeFilter = filter;
    document.querySelectorAll('.wall-tab-btn').forEach(btn => {
      const active = btn.dataset.filter === filter;
      btn.classList.toggle('bg-white', active); btn.classList.toggle('shadow-sm', active);
      btn.classList.toggle('text-slate-800', active); btn.classList.toggle('text-slate-400', !active);
    });
    this._page = 0; this._hasMore = true;
    const c = document.getElementById(this._containerId);
    if (c) this.loadPosts(c);
  },

  async applyFilters() {
    const si = document.getElementById('wallSearch');
    const cs = document.getElementById('wallClassroomFilter');
    this._options.searchTerm = si?.value.toLowerCase() || '';
    this._options.classroomId = cs?.value || null;
    this._page = 0; this._hasMore = true;
    const c = document.getElementById(this._containerId);
    if (c) await this.loadPosts(c);
  },

  async loadPosts(container, append = false) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) container = document.getElementById(this._containerId);
    if (!container) return;
    if (append && (this._isLoading || !this._hasMore)) return;
    // Cargas completas nuevas pueden "pisar" a una en curso: el token de
    // secuencia descarta los resultados obsoletos de forma segura.

    // Token de secuencia: cada nueva carga invalida los resultados de las anteriores
    const seq = (this._seq = (this._seq || 0) + 1);
    this._isLoading = true;

    if (!append) {
      container.innerHTML = `
        <div id="wall-loader" class="space-y-4 py-4">
          ${[1,2,3].map(() => `
            <div class="bg-white rounded-3xl p-5 border border-slate-100">
              <div class="flex items-center gap-3 mb-4">
                <div class="wall-skeleton w-10 h-10 rounded-full"></div>
                <div class="flex-1 space-y-2"><div class="wall-skeleton h-3 w-32 rounded-lg"></div><div class="wall-skeleton h-2 w-24 rounded-lg"></div></div>
              </div>
              <div class="wall-skeleton h-48 rounded-2xl mb-3"></div>
              <div class="wall-skeleton h-3 w-full rounded-lg mb-2"></div>
              <div class="wall-skeleton h-3 w-2/3 rounded-lg"></div>
            </div>`).join('')}
        </div>`;
      this._page = 0; this._hasMore = true;
    }

    try {
      const user = this._appState?.get('user');
      const from = this._page * this._pageSize;
      const to   = from + this._pageSize - 1;

      // La columna likes.reaction_type puede no existir aún en la BD
      // (ver migraciones/fix_likes_reaction_type.sql). Si PostgREST responde 400
      // por ella, se desactiva automáticamente y se reintenta sin ella.
      const buildEmbedSelect = () => `
        id, content, media_url, media_type, image_url, images, thumbnail_url, title, created_at, updated_at,
        teacher_name, teacher_avatar, is_pinned, comments_enabled, expire_days,
        scheduled_at, views_count, duration, tagged_students${this._supportsThumbStrip === false ? '' : ', thumbnail_urls'},
        classroom:classrooms(name),
        teacher:profiles(name, avatar_url),
        likes(user_id${this._supportsReactionType === false ? '' : ', reaction_type'}),
        comments(count)`;
      const buildFlatSelect = () => `
        id, content, media_url, media_type, image_url, images, thumbnail_url, title, created_at, updated_at,
        teacher_name, teacher_avatar, is_pinned, comments_enabled, expire_days,
        views_count, duration, tagged_students${this._supportsThumbStrip === false ? '' : ', thumbnail_urls'}, classroom_id, teacher_id`;

      const buildPostFilter = (q) => {
        if (this._options.searchTerm) q = q.ilike('content', `%${this._options.searchTerm}%`);
        return q;
      };

      const fetchClassroomPosts = (selectCols, orderOpts) => {
        let q = supabase.from('posts').select(selectCols).order('created_at', orderOpts);
        if (this._options.classroomId) q = q.eq('classroom_id', this._options.classroomId);
        return buildPostFilter(q);
      };

      const fetchGeneralPosts = (selectCols, orderOpts) => {
        let q = supabase.from('posts').select(selectCols).order('created_at', orderOpts).is('classroom_id', null);
        return buildPostFilter(q);
      };

      const mergeClassroomResults = (classData, generalData, pageSize) => {
        const all = [...(classData || []), ...(generalData || [])];
        all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return all.slice(0, pageSize);
      };

      // Ejecuta una query; si falla 400 por likes.reaction_type o posts.thumbnail_urls
      // inexistentes en la BD, desactiva la columna y reintenta una vez.
      const runWithEmbedFallback = async (build) => {
        let res = await withTimeout(() => build(buildEmbedSelect()), POSTS_QUERY_TIMEOUT_MS);
        if (res?.error) {
          if (this._supportsReactionType !== false && _isMissingColumnError(res.error, 'reaction_type')) {
            this._supportsReactionType = false;
            res = await withTimeout(() => build(buildEmbedSelect()), POSTS_QUERY_TIMEOUT_MS);
          } else if (this._supportsThumbStrip !== false && _isMissingColumnError(res.error, 'thumbnail_urls')) {
            this._supportsThumbStrip = false;
            res = await withTimeout(() => build(buildEmbedSelect()), POSTS_QUERY_TIMEOUT_MS);
          }
        }
        return res;
      };

      let posts = null;

      if (this._options.classroomId) {
        const orderOpts = { ascending: false };
        const [classResult, generalResult] = await Promise.all([
          runWithEmbedFallback((sel) => fetchClassroomPosts(sel, orderOpts).range(from, to)),
          runWithEmbedFallback((sel) => fetchGeneralPosts(sel, orderOpts).range(from, to))
        ]);

        if (!classResult.error && !generalResult.error) {
          posts = mergeClassroomResults(classResult.data, generalResult.data, this._pageSize);
        } else {
          const [classFlat, generalFlat] = await Promise.all([
            withTimeout(() => fetchClassroomPosts(buildFlatSelect(), orderOpts).range(from, to), POSTS_QUERY_TIMEOUT_MS),
            withTimeout(() => fetchGeneralPosts(buildFlatSelect(), orderOpts).range(from, to), POSTS_QUERY_TIMEOUT_MS)
          ]);
          if (classFlat.error && generalFlat.error) throw classFlat.error;
          const merged = mergeClassroomResults(classFlat.data, generalFlat.data, this._pageSize);
          posts = merged.map(p => ({
            ...p, is_pinned: p.is_pinned || false, comments_enabled: p.comments_enabled !== false,
            expire_days: p.expire_days || null, views_count: p.views_count || 0,
            tagged_students: p.tagged_students || [], likes: [], comments_count: 0,
            classroom: null, teacher: null, user_reaction: null, reaction_counts: {},
            duration: p.duration ?? null,
          }));
        }
      } else {
        const { data, error } = await runWithEmbedFallback((sel) => {
          let q = supabase.from('posts').select(sel)
            .order('created_at', { ascending: false }).range(from, to);
          return buildPostFilter(q);
        });
        if (error) {
          let fallback = supabase.from('posts').select(buildFlatSelect())
            .order('created_at', { ascending: false }).range(from, to);
          fallback = buildPostFilter(fallback);
          const retry = await withTimeout(() => fallback, POSTS_QUERY_TIMEOUT_MS);
          if (retry.error) throw retry.error;
          posts = (retry.data || []).map(p => ({
            ...p, is_pinned: p.is_pinned || false, comments_enabled: p.comments_enabled !== false,
            expire_days: p.expire_days || null, views_count: p.views_count || 0,
            tagged_students: p.tagged_students || [], likes: [], comments_count: 0,
            classroom: null, teacher: null, user_reaction: null, reaction_counts: {},
            duration: p.duration ?? null,
          }));
        } else {
          posts = data;
        }
      }

      document.getElementById('wall-loader')?.remove();
      document.getElementById('wall-scroll-loader')?.remove();

      // Una carga más reciente reemplazó a esta: descartar resultado sin tocar el DOM
      if (seq !== this._seq) return;

      if ((!posts || posts.length === 0) && !append) {
        container.innerHTML = Helpers.emptyState('No hay publicaciones recientes.', 'layout');
        this._hasMore = false;
        this._autoRetried = false;
        return;
      }

      let processed = (posts || [])
        .map(p => this._processPost(p, user))
        .filter(p => !this._isExpired(p.created_at, p.expire_days));

      if (this._activeFilter === 'videos') processed = processed.filter(p => p.is_video);
      else if (this._activeFilter === 'photos') processed = processed.filter(p => !p.is_video && p.display_media_url);
      else if (this._activeFilter === 'announcements') processed = processed.filter(p => p.media_type === 'announcement');

      processed.sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0));

      const html = (this._page === 0 ? this._renderSlowNetworkBanner() + this._renderFilterTabs() : '') +
                   processed.map(p => this.renderPost(p)).join('');

      if (append) container.insertAdjacentHTML('beforeend', processed.map(p => this.renderPost(p)).join(''));
      else container.innerHTML = html;

      ImageLoader.observe(container);
      this._setupLongPressReactions(container);
      this._setupVideoAutoplay();
      this._setupDoubleTap(container);

      if ((posts || []).length < this._pageSize) {
        this._hasMore = false;
        if (append) container.insertAdjacentHTML('beforeend', '<div class="py-6 text-center text-xs text-slate-300 italic">— Fin del muro —</div>');
      } else {
        this._page++;
        this._setupInfiniteScroll(container);
      }

      // Registrar vistas (throttled, no bloqueante)
      if (processed.length) this._registerViews(processed.map(p => p.id));

      if (window.lucide) lucide.createIcons();
      this._autoRetried = false;
    } catch (err) {
      console.error('[Wall] Error cargando publicaciones:', err?.message || err, err);
      // Una carga más reciente reemplazó a esta: no pintar el error
      if (seq !== this._seq) return;
      if (!append) {
        // Reintento automático único: al arrancar el panel muchas consultas
        // compiten en paralelo y la primera carga puede fallar por red/sesión.
        if (!this._autoRetried) {
          this._autoRetried = true;
          setTimeout(() => {
            if (seq === this._seq) this.loadPosts(container, false).catch(() => {});
          }, 1500);
          return;
        }
        container.innerHTML = `
          <div class="py-10 text-center">
            <i data-lucide="wifi-off" class="w-8 h-8 mx-auto text-slate-300 mb-2"></i>
            <p class="text-slate-400 text-sm font-bold mb-3">No se pudieron cargar las publicaciones</p>
            <button onclick="WallModule.loadPosts('${container.id}')" class="px-4 py-2 bg-orange-500 text-white rounded-xl text-xs font-black hover:bg-orange-600 transition-colors">Reintentar</button>
          </div>`;
        if (window.lucide) lucide.createIcons();
      }
    } finally {
      if (seq === this._seq) this._isLoading = false;
    }
  },

  _renderSlowNetworkBanner() {
    if (!this._detectSlowNetwork()) return '';
    return `<div class="wall-net-slow">📡 Conexión lenta detectada — ajustando calidad de video</div>`;
  },

  _renderFilterTabs() {
    return `
    <div class="flex gap-1.5 mb-5 p-1 bg-slate-100/80 rounded-2xl overflow-x-auto no-scrollbar">
      ${[['all','Todos'],['videos','🎬 Videos'],['photos','📷 Fotos'],['announcements','📢 Anuncios']].map(([key, label]) => `
        <button data-filter="${key}" onclick="WallModule.setFilter('${key}')"
          class="wall-tab-btn flex-shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${this._activeFilter === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}">
          ${label}
        </button>`).join('')}
    </div>`;
  },

  _setupInfiniteScroll(container) {
    if (this._observer) this._observer.disconnect();
    this._observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && this._hasMore && !this._isLoading) this.loadPosts(container, true);
    }, { rootMargin: '200px' });
    const last = container.lastElementChild;
    if (last) this._observer.observe(last);
  },

  /**
   * Reproducción automática inteligente (§8 de la propuesta):
   *  - Un wrapper con poster entra ≥65% al viewport  → monta y reproduce MUTED.
   *  - Un video ya montado cae <65%                  → se pausa.
   *  - Redes lentas / disableAutoplay / reduced-motion → solo por interacción.
   */
  _setupVideoAutoplay() {
    if (this._videoObserver) this._videoObserver.disconnect();
    const isSlow = this._detectSlowNetwork();
    const autoplayEnabled = !this._options.disableAutoplay && !this._prefersReducedMotion();
    this._videoObserver = new IntersectionObserver(entries => {
      entries.forEach(e => {
        const t = e.target;
        const visible = e.intersectionRatio >= 0.65;

        // Modo poster: montar el reproductor al entrar en pantalla
        if (t.classList.contains('wall-video-wrapper')) {
          if (t.dataset.mounted === '1' || t.dataset.userPaused === '1') return;
          if (!visible || isSlow || !autoplayEnabled) return;
          // El puntero ya está encima: lo gestiona _showVideoPreview, no el observer.
          if (t.dataset.hovered === '1') return;
          const postId = t.id.replace('video-wrapper-', '');
          const url = t.dataset.videoUrl;
          if (postId && url) {
            const vid = this._mountVideo(postId, url, { muted: true, autoplay: true });
            if (vid) {
              this._videoObserver.unobserve(t);
              this._videoObserver.observe(vid);
            }
          }
          return;
        }

        // Elemento <video> real
        if (!visible) {
          t.dataset._observerPause = '1';
          t.pause?.();
          return;
        }
        if (t.dataset.userPaused === '1') return;
        // Hover tiene prioridad: si el puntero está encima, no interferir.
        if (t.dataset.hoverStarted === '1') return;
        if (t.paused || t.readyState < 2) t.play().catch(() => {});
      });
    }, { threshold: [0.2, 0.65] });

    document.querySelectorAll('.wall-video-wrapper[data-video-url]').forEach(w => this._videoObserver.observe(w));
    document.querySelectorAll('video.wall-custom-video').forEach(v => this._videoObserver.observe(v));
  },

  /** Doble tap / doble click sobre el video → ❤️ (§19 de la propuesta) */
  _setupDoubleTap(container) {
    container.querySelectorAll('.wall-video-wrapper[data-video-url]').forEach(w => {
      if (w.dataset.dtReady) return;
      w.dataset.dtReady = '1';
      const postId = w.id.replace('video-wrapper-', '');
      let lastTap = 0;
      w.addEventListener('touchend', (e) => {
        const now = Date.now();
        if (now - lastTap < 300) {
          e.preventDefault?.();
          const ch = e.changedTouches[0];
          this._burstHeart(postId, ch.clientX, ch.clientY);
        }
        lastTap = now;
      }, { passive: false });
      w.addEventListener('dblclick', (e) => this._burstHeart(postId, e.clientX, e.clientY));
    });
  },

  /** Explosión de ❤️ en la posición del doble tap + like optimista */
  _burstHeart(postId, clientX, clientY) {
    const wrapper = document.getElementById(`video-wrapper-${postId}`);
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const heart = document.createElement('div');
    heart.className = 'wall-heart-burst';
    heart.textContent = '❤️';
    heart.style.left = `${clientX - rect.left}px`;
    heart.style.top = `${clientY - rect.top}px`;
    wrapper.appendChild(heart);
    setTimeout(() => heart.remove(), 1000);
    if (navigator.vibrate) navigator.vibrate(15);
    const postEl = document.getElementById(`post-${postId}`);
    if (postEl && postEl.dataset.userReaction) return; // ya reaccionó: solo animación
    this.toggleReaction(postId, 'like');
  },

  /** Long-press en el botón ❤️ abre el picker de reacciones (380ms) */
  _setupLongPressReactions(container) {
    container.querySelectorAll('[id^="like-main-"]').forEach(btn => {
      if (btn.dataset.lpReady) return;
      btn.dataset.lpReady = '1';
      let timer     = null;
      let moved     = false;
      let didLongPress = false;

      const start = () => {
        moved = false; didLongPress = false;
        timer = setTimeout(() => {
          if (moved) return;
          didLongPress = true;
          const postId = btn.id.replace('like-main-', '');
          const wrap   = document.getElementById(`like-btn-wrap-${postId}`);
          if (wrap) this.openReactionPicker(postId, wrap);
          if (navigator.vibrate) navigator.vibrate(15);
        }, 380);
      };

      const cancel = () => { clearTimeout(timer); timer = null; };
      const move   = () => { moved = true; cancel(); };

      // Bloquear el click si fue long-press
      btn.addEventListener('click', (e) => {
        if (didLongPress) { e.stopImmediatePropagation(); didLongPress = false; }
      }, true);

      btn.addEventListener('touchstart',  start,  { passive: true });
      btn.addEventListener('touchend',    cancel, { passive: true });
      btn.addEventListener('touchcancel', cancel, { passive: true });
      btn.addEventListener('touchmove',   move,   { passive: true });
      btn.addEventListener('mousedown',   start);
      btn.addEventListener('mouseup',     cancel);
      btn.addEventListener('mouseleave',  cancel);
    });
  },

  /** Registra que el usuario vio los posts (throttled, fire & forget) */
  _registerViews(postIds) {
    const user = this._appState?.get('user');
    if (!user || !postIds.length) return;
    const key = 'karpus_viewed_' + new Date().toDateString();
    let seen;
    try { seen = new Set(JSON.parse(sessionStorage.getItem(key) || '[]')); } catch (_) { seen = new Set(); }
    const newIds = postIds.filter(id => !seen.has(id));
    if (!newIds.length) return;
    newIds.forEach(id => seen.add(id));
    try { sessionStorage.setItem(key, JSON.stringify([...seen])); } catch (e) { console.warn('[Wall] Session storage write failed:', e); }
    // Fire & forget - incrementar vistas en BD
    newIds.forEach(id => {
      Promise.resolve(supabase.rpc('increment_post_views', { p_post_id: id })).catch(() => {});
    });
  },

  _processPost(p, user) {
    const teacher = Array.isArray(p.teacher) ? p.teacher[0] : (p.teacher || {});
    const likes = p.likes || [];
    const reactionCounts = {};
    likes.forEach(l => { const t = l.reaction_type || 'like'; reactionCounts[t] = (reactionCounts[t] || 0) + 1; });
    const userReaction = user ? likes.find(l => l.user_id === user.id) : null;

    const mediaUrl = p.media_url || p.image_url || null;
    const teacherAvatar = this._resolveUrlSync(teacher.avatar_url || p.teacher_avatar, { width: 80, quality: 80 });

    // Álbum de fotos
    const albumUrls = (p.images || []).map(u => this._resolveUrlSync(u, { width: 800, quality: 75 })).filter(Boolean);

    // Media principal: media_url → image_url → primera foto del álbum
    const primaryMedia = mediaUrl || albumUrls[0] || null;
    const publicUrl = this._resolveUrlSync(primaryMedia, { width: 800, quality: 75 });

    return {
      ...p,
      teacher_name: teacher.name || p.teacher_name || 'Maestra',
      teacher_avatar: teacherAvatar,
      like_count: likes.length,
      user_liked: !!userReaction,
      user_reaction: userReaction?.reaction_type || null,
      reaction_counts: reactionCounts,
      original_media_url: primaryMedia,
      display_media_url: publicUrl,
      album_urls: albumUrls,
      is_video: p.media_type === 'video' || (mediaUrl && /\.(mp4|mov|webm|m4v)$/i.test(mediaUrl)),
      is_pinned: p.is_pinned || false,
      comments_enabled: p.comments_enabled !== false,
      expire_days: p.expire_days || null,
      views_count: p.views_count || 0,
      tagged_students: p.tagged_students || [],
    };
  },

  _resolveUrlSync(url, opts = {}) {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return optimizeImageUrl(url, opts);
    const clean = url.replace(/^(posts|karpus-uploads|avatars|classroom_media)\//, '');
    let bucket;
    if (url.includes('avatar')) bucket = 'karpus-uploads';
    else if (url.includes('classroom_media')) bucket = 'classroom_media';
    else bucket = 'posts';
    const path = url.includes('avatar') ? `avatars/${clean}` : clean;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return optimizeImageUrl(data?.publicUrl, opts);
  },

  _getAvatarColor(name) {
    const colors = ['bg-blue-100 text-blue-600','bg-emerald-100 text-emerald-600','bg-purple-100 text-purple-600','bg-amber-100 text-amber-600','bg-rose-100 text-rose-600','bg-indigo-100 text-indigo-600','bg-teal-100 text-teal-600'];
    let h = 0; for (const c of (name || '')) h = c.codePointAt(0) + ((h << 5) - h);
    return colors[Math.abs(h) % colors.length];
  },

  // ── RENDER POST ──────────────────────────────────────────────────────────────
  renderPost(p) {
    const date = this._relativeTimeFromNow(p.created_at);
    const accent = this._options.accentColor || 'indigo';
    const isSlow = this._detectSlowNetwork();
    const profile = this._appState?.get('profile');
    const isStaff = ['directora','maestra','asistente','admin'].includes(profile?.role);
    // Moderación (fijar / eliminar / desactivar comentarios): solo Directora y Admin
    const canPin = ['directora','admin'].includes(profile?.role);
    const canComment = p.comments_enabled !== false && profile?.role;

    // ── Media: álbum, video o imagen ──
    let mediaHtml = '';
    if (p.album_urls && p.album_urls.length > 1) {
      mediaHtml = this._renderAlbum(p);
    } else if (p.is_video && p.display_media_url) {
      mediaHtml = this._renderVideoCard(p, isSlow);
    } else if (p.display_media_url) {
      mediaHtml = this._renderImageCard(p, isSlow);
    }

    // ── Reacciones ──
    const totalReactions = Object.values(p.reaction_counts || {}).reduce((a,b) => a+b, 0);
    const reactionChips = Object.entries(p.reaction_counts || {})
      .sort((a,b) => b[1]-a[1]).slice(0,3)
      .map(([type, count]) => `<span class="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-1.5 py-0.5 cursor-pointer hover:bg-slate-200 transition-colors" onclick="WallModule.showReactionsList('${p.id}')">${type === 'like' ? '❤️' : type} ${count}</span>`)
      .join('');

    // ── Alumnos etiquetados ──
    const taggedHtml = p.tagged_students?.length
      ? `<div class="flex items-center gap-1 mt-2">
          <span class="text-[9px] font-black text-slate-400 uppercase">En este post:</span>
          <div class="wall-tagged-avatars">
            ${p.tagged_students.slice(0,5).map(s =>
              `<div class="wall-tagged-avatar" title="${_sanitizeHTML(s.name || '')}">${(_sanitizeHTML(s.name || '?')).charAt(0)}</div>`
            ).join('')}
            ${p.tagged_students.length > 5 ? `<div class="wall-tagged-avatar">+${p.tagged_students.length - 5}</div>` : ''}
          </div>
        </div>` : '';

    // ── View counter (solo staff) ──
    const viewsHtml = isStaff && p.views_count > 0
      ? `<span class="wall-view-count"><i data-lucide="eye" class="w-3 h-3"></i>${p.views_count}</span>`
      : '';

    // ── Like button label/emoji (extracted to avoid nested ternaries) ──
    const likeEmoji = (p.user_reaction && p.user_reaction !== 'like') ? p.user_reaction : '❤️';
    let likeLabel;
    if (!p.user_reaction) likeLabel = 'Me gusta';
    else if (p.user_reaction === 'like') likeLabel = 'Me gusta';
    else likeLabel = _sanitizeHTML(p.user_reaction);

    // ── Reaction total counter html (extracted to avoid nested ternary) ──
    const reactionTotalHtml = totalReactions > 0
      ? `<span id="reaction-total-${p.id}" class="text-[10px] font-bold text-slate-400 wall-counter">${totalReactions}</span>`
      : `<span id="reaction-total-${p.id}" class="text-[10px] font-bold text-slate-400 wall-counter hidden"></span>`;

    // ── Botones staff ──
    const staffButtons = canPin ? `
      <button onclick="WallModule.togglePin('${p.id}')" class="text-slate-300 hover:text-amber-500 transition-colors p-1.5 rounded-lg hover:bg-amber-50" title="${p.is_pinned ? 'Desfijar' : 'Fijar'}">
        <i data-lucide="pin" class="w-4 h-4 ${p.is_pinned ? 'fill-amber-400 text-amber-400' : ''}"></i>
      </button>
      <button onclick="WallModule.toggleComments('${p.id}', ${p.comments_enabled !== false})" class="text-slate-300 hover:text-blue-500 transition-colors p-1.5 rounded-lg hover:bg-blue-50" title="Comentarios">
        <i data-lucide="message-circle" class="w-4 h-4"></i>
      </button>
      <button onclick="WallModule.deletePost('${p.id}')" class="text-slate-300 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50" title="Eliminar">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>` : '';

    return `
      <div class="bg-white rounded-3xl shadow-sm border ${p.is_pinned ? 'border-amber-200 ring-1 ring-amber-100' : 'border-slate-100'} overflow-hidden mb-6 relative wall-slide-up" id="post-${p.id}" data-classroom-id="${p.classroom_id || 'null'}" data-user-reaction="${_sanitizeHTML(p.user_reaction || '')}">
        ${p.is_pinned ? '<div class="absolute top-0 right-0 z-10"><span class="wall-pinned-badge px-2 py-1 rounded-bl-xl rounded-tr-3xl">📌 Fijada</span></div>' : ''}
        <div class="p-5">
          <div class="flex justify-between items-start mb-4">
            <div class="flex items-center gap-3">
              ${ImageLoader.avatar(p.teacher_avatar, p.teacher_name, { cls: 'shrink-0 shadow-sm border border-slate-100', bgCls: `bg-${accent}-100`, textCls: `text-${accent}-600` })}
              <div>
                <div class="font-bold text-slate-800 text-sm">${_sanitizeHTML(p.teacher_name)}</div>
                <div class="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-2">
                  ${date} • ${_sanitizeHTML(p.classroom?.name || 'General')} ${viewsHtml}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1">${staffButtons}</div>
          </div>

          ${p.content ? `<div class="text-slate-600 text-sm mb-4 whitespace-pre-wrap leading-relaxed">${_sanitizeHTML(p.content)}</div>` : ''}

          ${mediaHtml}
          ${taggedHtml}

          <div class="flex items-center justify-between pt-4 border-t border-slate-50 mt-3">
            <!-- ❤️ Botón principal de reacción + chips -->
            <div class="flex items-center gap-2">
              <div class="relative" id="like-btn-wrap-${p.id}">
                <!-- Botón principal: tap = like rápido, hold = picker -->
                <button id="like-main-${p.id}"
                  class="wall-like-main ${p.user_reaction ? 'active' : ''}"
                  onclick="WallModule._onLikeMainClick('${p.id}', event)"
                  oncontextmenu="event.preventDefault();WallModule.openReactionPicker('${p.id}',document.getElementById('like-btn-wrap-${p.id}'))"
                  aria-label="Me gusta"
                  aria-pressed="${!!p.user_reaction}">
                  <span class="wall-emoji">${likeEmoji}</span>
                  <span class="wall-like-label">${likeLabel}</span>
                </button>
              </div>
              <!-- Chips de conteo clickeables -->
              <div id="reaction-chips-${p.id}"
                data-counts='${JSON.stringify(p.reaction_counts || {})}'
                class="flex items-center gap-1 flex-wrap">
                ${reactionChips}${reactionTotalHtml}
              </div>
            </div>

            <!-- 💬 Comentarios + compartir -->
            <div class="flex items-center gap-2">
              <button onclick="WallModule.shareToChat('${p.id}')" class="text-slate-300 hover:text-indigo-500 transition-colors p-1.5 rounded-lg hover:bg-indigo-50" title="Compartir al chat" aria-label="Compartir">
                <i data-lucide="share-2" class="w-4 h-4"></i>
              </button>
              ${canComment ? `
              <button onclick="WallModule.toggleCommentSection('${p.id}')"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-500 hover:text-blue-500 hover:bg-blue-50 transition-all"
                aria-label="Ver y escribir comentarios">
                <i data-lucide="message-circle" class="w-4 h-4"></i>
                <span id="comment-count-${p.id}" class="wall-counter">${p.comments?.[0]?.count ?? 0}</span>
              </button>` : ''}
            </div>
          </div>

          ${canComment ? `
          <div id="comments-section-${p.id}" class="hidden mt-3 -mx-5">
            <!-- Lista de comentarios -->
            <div id="comments-list-${p.id}" class="space-y-3 px-5 pb-3 max-h-72 overflow-y-auto border-t border-slate-100 pt-3">
              <p class="text-center text-xs text-slate-400 italic py-2">Toca el ícono para cargar comentarios.</p>
            </div>
            <!-- Input fijo al fondo -->
            <div class="flex gap-2 px-4 py-3 border-t border-slate-100 bg-white sticky bottom-0">
              <input type="text" id="comment-input-${p.id}"
                class="flex-1 px-3 py-2.5 text-sm border border-slate-200 rounded-2xl focus:ring-2 focus:ring-${accent}-300 focus:border-${accent}-400 outline-none bg-slate-50"
                placeholder="Escribe un comentario..."
                onkeypress="if(event.key==='Enter')WallModule.sendComment('${p.id}')"
                aria-label="Escribir comentario">
              <button onclick="WallModule.sendComment('${p.id}')"
                class="p-2.5 bg-${accent}-600 text-white rounded-2xl hover:bg-${accent}-700 active:scale-95 transition-all flex-shrink-0"
                aria-label="Enviar comentario">
                <i data-lucide="send" class="w-4 h-4"></i>
              </button>
            </div>
          </div>` : ''}
        </div>
      </div>`;
  },

  // ── Render Media Helpers ─────────────────────────────────────────────────────
  _renderVideoCard(p, isSlow) {
    const thumbUrl = p.thumbnail_url || null;
    const thumbUrls = (p.thumbnail_urls || []).filter(Boolean);
    const hasMultiThumbs = thumbUrls.length >= 3;

    if (hasMultiThumbs) {
      const stripItems = thumbUrls.slice(0, 5).map((url, i) => {
        const timeSec = Math.round(((i + 1) / (thumbUrls.length + 1)) * (p.duration || MAX_VIDEO_DURATION));
        const min = Math.floor(timeSec / 60);
        const sec = String(timeSec % 60).padStart(2, '0');
        return `<div class="wall-thumb-strip-item" data-time-label="${min}:${sec}" style="transition-delay:${i * 0.06}s">
          <img src="${_sanitizeHTML(url)}" alt="Vista previa ${i + 1}" loading="lazy">
        </div>`;
      }).join('');

      return `
        <div class="wall-video-wrapper relative mb-4 shadow-inner" id="video-wrapper-${p.id}"
             data-video-url="${_sanitizeHTML(p.display_media_url)}"
             data-thumb-count="${thumbUrls.length}"${thumbUrl ? ` data-poster="${_sanitizeHTML(thumbUrl)}"` : ''}
             onmouseenter="WallModule._showVideoPreview('${p.id}')"
             onmouseleave="WallModule._hideVideoPreview('${p.id}')"
             onclick="WallModule.playVideoCard('${p.id}','${_sanitizeHTML(p.display_media_url)}')"
             style="background:#0f172a;" role="button" aria-label="Reproducir video" tabindex="0"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();WallModule.playVideoCard('${p.id}','${_sanitizeHTML(p.display_media_url)}')}">
          ${thumbUrl ? `<img src="${_sanitizeHTML(thumbUrl)}" class="w-full h-full object-cover absolute inset-0 wall-video-poster" alt="Vista previa del video" loading="lazy" decoding="async">` : '<div class="wall-shimmer absolute inset-0" style="background:linear-gradient(90deg,#1e293b 25%,#334155 50%,#1e293b 75%);background-size:800px 100%;"></div>'}
          <div class="wall-thumb-strip" id="thumb-strip-${p.id}">${stripItems}</div>
          <div class="wall-play-btn">▶</div>
          <div class="wall-video-duration">${this._formatVideoDuration(p.duration || MAX_VIDEO_DURATION)}</div>
          <div class="wall-watermark">🐾 Karpus Kids</div>
        </div>`;
    }

    const posterStyle = thumbUrl ? `background-image:url('${_sanitizeHTML(thumbUrl)}');background-size:cover;background-position:center;` : 'background:#0f172a;';
    return `
      <div class="wall-video-wrapper relative mb-4 shadow-inner" id="video-wrapper-${p.id}"
           data-video-url="${_sanitizeHTML(p.display_media_url)}"${thumbUrl ? ` data-poster="${_sanitizeHTML(thumbUrl)}"` : ''}
           onmouseenter="WallModule._showVideoPreview('${p.id}')"
           onmouseleave="WallModule._hideVideoPreview('${p.id}')"
           onclick="WallModule.playVideoCard('${p.id}','${_sanitizeHTML(p.display_media_url)}')"
           style="${posterStyle}" role="button" aria-label="Reproducir video" tabindex="0"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();WallModule.playVideoCard('${p.id}','${_sanitizeHTML(p.display_media_url)}')}">
        ${!thumbUrl ? `<div class="wall-shimmer absolute inset-0" style="background:linear-gradient(90deg,#1e293b 25%,#334155 50%,#1e293b 75%);background-size:800px 100%;"></div>` : ''}
        <div class="wall-play-btn">▶</div>
        <div class="wall-video-duration">${this._formatVideoDuration(p.duration || MAX_VIDEO_DURATION)}</div>
        <div class="wall-watermark">🐾 Karpus Kids</div>
      </div>`;
  },

  _renderImageCard(p, isSlow) {
    const original = p.original_media_url || p.display_media_url;
    const optimized = optimizeImageUrl(original, { width: isSlow ? 600 : 1200, quality: isSlow ? 60 : 80 });
    return `
      <div class="rounded-2xl overflow-hidden border border-slate-100 mb-4 cursor-zoom-in bg-slate-50 relative shadow-inner"
           onclick="WallModule.openLightbox('${_sanitizeHTML(p.display_media_url)}','image','${p.id}')" role="button" aria-label="Ver imagen">
        <div class="wall-shimmer absolute inset-0 rounded-2xl" id="img-shimmer-${p.id}"></div>
        <img id="wall-img-${p.id}" src="${_sanitizeHTML(optimized)}" loading="lazy" decoding="async"
             data-fallback-src="${_sanitizeHTML(original)}"
             class="wall-img relative z-10 wall-img-loaded${isSlow ? ' wall-img-compact' : ''}"
             alt="Publicación escolar"
             onload="document.getElementById('img-shimmer-${p.id}')?.remove()"
             onerror="WallModule._imgRetry('${p.id}')">
        <div class="wall-watermark">🐾 Karpus Kids</div>
      </div>`;
  },

  /**
   * Reintenta cargar una imagen del muro cuando la red falla.
   * Cadena: optimizada → original sin params → optimizada de nuevo → placeholder.
   */
  _imgRetry(id) {
    const img = document.getElementById(`wall-img-${id}`);
    if (!img) return;
    const attempt = Number(img.dataset.retryAttempt || 0);
    const fallback = img.dataset.fallbackSrc;
    if (attempt === 0 && fallback && img.src !== fallback) {
      // 1er reintento: URL original sin parámetros de optimización
      img.dataset.retryAttempt = '1';
      setTimeout(() => { img.src = fallback; }, 400);
    } else if (attempt <= 1) {
      // 2do reintento: misma URL con cache-buster (fallos transitorios de red)
      img.dataset.retryAttempt = '2';
      setTimeout(() => {
        try { const u = new URL(img.src); u.searchParams.set('retry', Date.now()); img.src = u.toString(); }
        catch (_) { img.src = fallback || img.src; }
      }, 1500);
    } else {
      // Agotado: placeholder
      img.onerror = null;
      img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80' fill='%2394a3b8'%3E%3Crect width='120' height='80' rx='8' fill='%23f1f5f9'/%3E%3Ctext x='60' y='44' text-anchor='middle' font-size='11' font-family='sans-serif' fill='%2394a3b8'%3EImagen no disponible%3C/text%3E%3C/svg%3E";
      document.getElementById(`img-shimmer-${id}`)?.remove();
    }
  },

  _renderAlbum(p) {
    const urls = p.album_urls.slice(0, MAX_ALBUM_PHOTOS);
    return `
      <div class="wall-album-carousel mb-4 rounded-2xl overflow-hidden border border-slate-100 shadow-inner relative" id="album-${p.id}">
        <div class="wall-album-track" id="album-track-${p.id}">
          ${urls.map((url, i) => `
            <div class="wall-album-slide" onclick="WallModule.openLightbox('${_sanitizeHTML(url)}','image','${p.id}')" role="button" aria-label="Foto ${i+1} de ${urls.length}">
              <img src="${_sanitizeHTML(url)}" loading="${i === 0 ? 'eager' : 'lazy'}" class="wall-album-img" alt="Foto ${i+1}">
            </div>`).join('')}
        </div>
        ${urls.length > 1 ? `
        <div class="flex justify-center gap-1.5 absolute bottom-3 left-0 right-0">
          ${urls.map((_, i) => `<div class="wall-album-dot ${i === 0 ? 'active' : ''}" onclick="WallModule.goToAlbumSlide('${p.id}',${i})"></div>`).join('')}
        </div>
        <button onclick="WallModule.prevAlbumSlide('${p.id}')" class="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 rounded-full text-white text-xs flex items-center justify-center backdrop-blur-sm" aria-label="Anterior">◀</button>
        <button onclick="WallModule.nextAlbumSlide('${p.id}',${urls.length})" class="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 rounded-full text-white text-xs flex items-center justify-center backdrop-blur-sm" aria-label="Siguiente">▶</button>
        <span class="absolute top-3 right-3 bg-black/50 text-white text-[9px] font-black px-2 py-1 rounded-full backdrop-blur-sm">1/${urls.length}</span>` : ''}
      </div>`;
  },

  goToAlbumSlide(postId, index) {
    const track = document.getElementById(`album-track-${postId}`);
    if (!track) return;
    track.style.transform = `translateX(-${index * 100}%)`;
    const album = document.getElementById(`album-${postId}`);
    album?.querySelectorAll('.wall-album-dot').forEach((d, i) => d.classList.toggle('active', i === index));
    const counter = album?.querySelector('span');
    if (counter) counter.textContent = `${index + 1}/${track.children.length}`;
    track.dataset.currentSlide = index;
  },

  nextAlbumSlide(postId, total) {
    const track = document.getElementById(`album-track-${postId}`);
    if (!track) return;
    const cur = Number.parseInt(track.dataset.currentSlide || '0');
    this.goToAlbumSlide(postId, (cur + 1) % total);
  },

  prevAlbumSlide(postId) {
    const track = document.getElementById(`album-track-${postId}`);
    if (!track) return;
    const total = track.children.length;
    const cur = Number.parseInt(track.dataset.currentSlide || '0');
    this.goToAlbumSlide(postId, (cur - 1 + total) % total);
  },

  // ── Reproductor de Video Custom ──────────────────────────────────────────────
  _formatVideoDuration(sec) {
    if (!sec || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  },

  /** El usuario pidió menos movimiento: nada de autoplay ni hover-preview. */
  _prefersReducedMotion() {
    try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; }
    catch (_) { return false; }
  },

  /**
   * ¿Usamos los controles propios en vez de los nativos del <video>?
   * Solo en táctil: ahí los nativos se superponen al pie del video y son
   * difíciles de alcanzar. En escritorio se conservan (teclado, volumen,
   * pantalla completa).
   */
  _useCustomControls() {
    if (this._options.forceNativeControls) return false;
    if (this._options.useCustomControls === true) return true;
    try { return window.matchMedia?.('(hover: none), (pointer: coarse)').matches === true; }
    catch (_) { return false; }
  },

  /**
   * ¿Tiene sentido montar y reproducir un video por hover?
   * No en táctil (no hay hover real), red lenta, ni con reduced-motion.
   */
  _canHoverPreview() {
    if (this._options.disableHoverPreview) return false;
    if (this._prefersReducedMotion()) return false;
    if (this._detectSlowNetwork()) return false;
    const conn = navigator.connection?.effectiveType;
    if (conn && ['slow-2g', 'slower-2g', '2g', '3g'].includes(conn)) return false;
    // (hover:none) cubre móvil/tablet donde onmouseenter se dispara por el primer tap.
    if (window.matchMedia?.('(hover: none)').matches === true) return false;
    return true;
  },

  /**
   * Hover sobre la tarjeta: reproducción muda + vista previa.
   * Monta el <video> si hacía falta y lo reproduce; el poster sigue debajo
   * hasta que hay primer frame decodificado (_mountVideo).
   */
  _showVideoPreview(postId) {
    const wrapper = document.getElementById(`video-wrapper-${postId}`);
    if (!wrapper) return;
    wrapper.classList.add('is-hovering');

    // La tira de miniaturas solo existe en videos con >=3 thumbnails
    const strip = document.getElementById(`thumb-strip-${postId}`);
    if (strip) strip.classList.add('active');

    const poster = wrapper.querySelector('.wall-video-poster:not(.wall-video-poster-overlay)');
    if (poster) { poster.style.transform = 'scale(1.06)'; poster.style.filter = 'brightness(0.75)'; }

    if (!this._canHoverPreview() || wrapper.dataset.hovered === '1') return;
    wrapper.dataset.hovered = '1';

    const url = wrapper.dataset.videoUrl;
    if (!url) return;

    const existing = wrapper.querySelector('video.wall-custom-video');
    if (existing) {
      // Ya montado: el usuario pausó o le quitó el mute a mano → no intervenimos.
      if (existing.dataset.userPaused === '1' || !existing.muted) return;
      existing.dataset.hoverStarted = '1';
      existing.play().catch(() => {});
      return;
    }

    const vid = this._mountVideo(postId, url, { muted: true, autoplay: false });
    if (!vid) return;
    vid.dataset.hoverStarted = '1';
    vid.play().catch(() => {});
    if (this._videoObserver) {
      this._videoObserver.unobserve(wrapper);
      this._videoObserver.observe(vid);
    }
  },

  _hideVideoPreview(postId) {
    const wrapper = document.getElementById(`video-wrapper-${postId}`);
    if (!wrapper) return;
    wrapper.classList.remove('is-hovering');
    wrapper.dataset.hovered = '';

    const strip = document.getElementById(`thumb-strip-${postId}`);
    if (strip) strip.classList.remove('active');

    const poster = wrapper.querySelector('.wall-video-poster:not(.wall-video-poster-overlay)');
    if (poster) { poster.style.transform = ''; poster.style.filter = ''; }

    const vid = wrapper.querySelector('video.wall-custom-video');
    if (!vid || vid.dataset.hoverStarted !== '1') return;
    delete vid.dataset.hoverStarted;
    // Respetar siempre la decisión del usuario: si pausó o activó sonido, no tocar.
    if (vid.dataset.userPaused === '1' || !vid.muted) return;
    try { vid.currentTime = 0; } catch (_) { /* aún sin metadatos */ }
    vid.dataset._hoverPause = '1';   // no la queremos como pausa del usuario
    vid.pause();
  },

  /** Monta el reproductor dentro del wrapper. muted + loop por defecto. */
  _mountVideo(postId, url, { muted = true, autoplay = false, poster = null } = {}) {
    const wrapper = document.getElementById(`video-wrapper-${postId}`);
    if (!wrapper || !url) return null;
    const existing = wrapper.querySelector('video.wall-custom-video');
    if (existing) return existing;

    // El poster vive en data-poster porque innerHTML borra el <img> original.
    const posterUrl = poster || wrapper.dataset.poster || null;

    wrapper.onclick = null;
    wrapper.dataset.mounted = '1';
    wrapper.style.backgroundImage = '';
    wrapper.style.background = '#000';
    wrapper.classList.add('is-loading');
    const preload = autoplay ? 'auto' : 'metadata';
    // En táctil los controles nativos se montan como una barra que tapa el pie
    // del video y compite con la barra de progreso propia. Se sustituyen por
    // los controles del módulo (scrub + tap + mantener presionado).
    const customControls = this._useCustomControls();
    wrapper.innerHTML = `
      <video id="wall-vid-${postId}" class="wall-custom-video w-full" playsinline loop ${customControls ? '' : 'controls'} ${muted ? 'muted' : ''} preload="${preload}"
             ${posterUrl ? `poster="${_sanitizeHTML(posterUrl)}"` : ''}
             style="display:block;"
             onended="document.getElementById('wall-replay-${postId}')?.classList.remove('hidden')"
             onerror="WallModule._onVideoError('${postId}')">
        <source src="${_sanitizeHTML(url)}" type="video/mp4">
      </video>
      <div class="wall-video-loading" id="wall-vspin-${postId}"></div>
      <button id="wall-replay-${postId}" onclick="WallModule._replayVideo('${postId}')"
        class="hidden absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 bg-orange-500/90 rounded-full text-white flex items-center justify-center text-2xl" aria-label="Repetir video">🔁</button>
      <button id="wall-audio-toggle-${postId}"
        class="wall-audio-toggle absolute top-2.5 right-2.5" aria-label="Activar sonido">🔇</button>
      ${posterUrl ? `<img src="${_sanitizeHTML(posterUrl)}" class="wall-video-poster wall-video-poster-overlay" alt="" aria-hidden="true" decoding="async">` : ''}`;

    const vid = document.getElementById(`wall-vid-${postId}`);
    if (!vid) return null;
    vid.dataset.postId = postId;
    vid.dataset.userPaused = '0';

    // El poster (atributo + overlay) se retira solo cuando hay primer frame
    // decodificado. Antes de eso el usuario SIEMPRE ve una imagen, nunca un
    // rectángulo negro mientras carga el video.
    this._revealOnFirstFrame(vid, posterUrl);

    const audioBtn = document.getElementById(`wall-audio-toggle-${postId}`);
    if (audioBtn) audioBtn.onclick = (e) => { e.stopPropagation(); this._toggleAudio(postId); };

    vid.addEventListener('play', () => this._onVideoPlay(postId));
    vid.addEventListener('volumechange', () => this._onVolumeChange(postId));
    vid.addEventListener('pause', () => {
      // Pausas que NO vienen del usuario (observer de scroll o fin de hover)
      // no deben marcar userPaused, o el video quedaría bloqueado para siempre.
      if (vid.dataset._observerPause === '1') { delete vid.dataset._observerPause; return; }
      if (vid.dataset._hoverPause === '1') { delete vid.dataset._hoverPause; return; }
      vid.dataset.userPaused = '1';
    });
    vid.addEventListener('play', () => { delete vid.dataset.userPaused; });

    this._syncAudioBtn(postId, muted);
    if (autoplay) vid.play().catch(() => {});
    this._attachVideoProgress(vid, postId);
    if (this._videoObserver) this._videoObserver.observe(vid);
    return vid;
  },

  /**
   * Quita el overlay de poster y el spinner en cuanto hay primer frame
   * decodificado (readyState >= 2). Si loadeddata nunca llega (codec no
   * soportado, red cortada), el timeout de seguridad lo retira igual para no
   * dejar el poster congelado sobre un video que ya está playing.
   */
  _revealOnFirstFrame(vid, posterUrl) {
    const postId = vid.dataset.postId;
    const done = () => {
      const w = document.getElementById(`video-wrapper-${postId}`);
      w?.classList.remove('is-loading');
      document.getElementById(`wall-vspin-${postId}`)?.remove();
      const overlay = w?.querySelector('.wall-video-poster-overlay');
      if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 320);
      }
    };
    if (vid.readyState >= 2) { done(); return; }
    vid.addEventListener('loadeddata', done, { once: true });
    // El atributo poster ya pinta el frame si el video aún no arrancó.
    if (!posterUrl) { vid.addEventListener('canplay', done, { once: true }); }
    setTimeout(done, 8000);
  },

  /** Click explícito del usuario → monta y reproduce (compatible con onclick inline) */
  playVideoCard(postId, url) {
    // El click es intención explícita: siempre mudo, el audio es opt-in con 🔊.
    this._mountVideo(postId, url, { muted: true, autoplay: true });
  },

  /** Al iniciar reproducción: precarga el siguiente video del muro (§12) */
  _onVideoPlay(postId) {
    const vid = document.getElementById(`wall-vid-${postId}`);
    if (vid && !vid.muted) this._onVolumeChange(postId);
    this._prefetchNextVideo(postId);
  },

  /** Un solo video con audio a la vez (§10 de la propuesta) */
  _onVolumeChange(postId) {
    const vid = document.getElementById(`wall-vid-${postId}`);
    if (!vid) return;
    if (!vid.muted) {
      document.querySelectorAll('video.wall-custom-video').forEach(v => {
        if (v !== vid && !v.muted) { v.muted = true; this._syncAudioBtn(v.dataset.postId, true); }
      });
    }
    this._syncAudioBtn(postId, vid.muted);
  },

  _toggleAudio(postId) {
    const vid = document.getElementById(`wall-vid-${postId}`);
    if (!vid) return;
    if (vid.muted) {
      document.querySelectorAll('video.wall-custom-video').forEach(v => {
        if (v !== vid && !v.muted) { v.muted = true; this._syncAudioBtn(v.dataset.postId, true); }
      });
      vid.muted = false;
    } else {
      vid.muted = true;
    }
    vid.play().catch(() => {});
    this._syncAudioBtn(postId, vid.muted);
    if (navigator.vibrate) navigator.vibrate(10);
  },

  _syncAudioBtn(postId, isMuted) {
    const btn = document.getElementById(`wall-audio-toggle-${postId}`);
    if (btn) {
      btn.textContent = isMuted ? '🔇' : '🔊';
      btn.setAttribute('aria-label', isMuted ? 'Activar sonido' : 'Silenciar');
    }
  },

  /** Precarga limitada del siguiente video (HTTP Range, 1 MB) (§12) */
  _prefetchNextVideo(postId) {
    try {
      const eff = navigator.connection?.effectiveType;
      if (this._detectSlowNetwork() || (eff && ['slower-2g', '2g', '3g'].includes(eff))) return;
      const wrappers = [...document.querySelectorAll('.wall-video-wrapper[data-video-url]')];
      const idx = wrappers.findIndex(w => w.id === `video-wrapper-${postId}`);
      const next = wrappers[idx + 1];
      if (!next || !next.dataset.videoUrl || next.dataset.videoUrl === this._lastPrefetched) return;
      this._lastPrefetched = next.dataset.videoUrl;
      fetch(next.dataset.videoUrl, { headers: { Range: 'bytes=0-1048575' } }).catch(() => {});
    } catch (_) { /* best-effort */ }
  },

  /**
   * Barra de progreso táctil (scrub). En dispositivos sin hover los controles
   * nativos del <video> estorban en un feed vertical, así que se usan los
   * controles propios: barra arrastrable + tap para play/pause + mantener
   * presionado para pausar sin sonido de fondo.
   */
  _attachVideoProgress(vid, postId) {
    if (document.getElementById(`wall-scrub-${postId}`)) return;
    const host = vid.parentElement;
    if (!host) return;

    // En escritorio los controles nativos ya pintan su propia barra y libran
    // gestos; se conserva la barra decorativa anterior (sin interacción).
    if (!this._useCustomControls()) {
      const legacy = document.createElement('div');
      legacy.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,0.2);pointer-events:none;';
      legacy.innerHTML = `<div id="wall-vprog-${postId}" class="wall-progress-bar" style="width:0%"></div>`;
      host.appendChild(legacy);
      vid.addEventListener('timeupdate', () => {
        if (!vid.duration) return;
        const prog = document.getElementById(`wall-vprog-${postId}`);
        if (prog) prog.style.width = `${(vid.currentTime / vid.duration) * 100}%`;
      });
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'wall-scrub';
    wrap.id = `wall-scrub-${postId}`;
    // Videos con >=3 miniaturas traen una tira fija en el pie del wrapper.
    if (document.getElementById(`thumb-strip-${postId}`)) {
      wrap.classList.add('wall-scrub-above-strip');
    }
    wrap.innerHTML = `
      <div class="wall-scrub-track"><div class="wall-scrub-fill" id="wall-vprog-${postId}"></div></div>
      <div class="wall-scrub-knob"></div>
      <div class="wall-scrub-time" id="wall-vtime-${postId}">0:00</div>`;
    host.appendChild(wrap);

    const fill  = document.getElementById(`wall-vprog-${postId}`);
    const knob  = wrap.querySelector('.wall-scrub-knob');
    const label = document.getElementById(`wall-vtime-${postId}`);

    const paint = (ratio) => {
      const pct = Math.max(0, Math.min(100, ratio * 100));
      if (fill) fill.style.width = `${pct}%`;
      if (knob) knob.style.left = `${pct}%`;
      if (label && vid.duration) {
        label.textContent = `${this._formatVideoDuration(ratio * vid.duration)} / ${this._formatVideoDuration(vid.duration)}`;
      }
    };

    vid.addEventListener('timeupdate', () => {
      if (!vid.duration || wrap.dataset.scrubbing === '1') return;
      paint(vid.currentTime / vid.duration);
    });
    vid.addEventListener('loadedmetadata', () => {
      if (vid.duration) paint(vid.currentTime / vid.duration);
    });

    const ratioFrom = (clientX) => {
      const r = wrap.getBoundingClientRect();
      if (!r.width) return 0;
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    };

    // Pointer Events cubre touch, mouse y lápiz con un solo camino de código.
    // touch-action:none (CSS) evita que el scroll de la página robe el gesto.
    const onDown = (e) => {
      if (!vid.duration || !isFinite(vid.duration)) return;
      e.preventDefault();
      e.stopPropagation();
      wrap.dataset.scrubbing = '1';
      wrap.classList.add('wall-scrub-active');
      wrap.setPointerCapture?.(e.pointerId);
      const ratio = ratioFrom(e.clientX);
      paint(ratio);
      vid.currentTime = ratio * vid.duration;
    };
    const onMove = (e) => {
      if (wrap.dataset.scrubbing !== '1') return;
      e.preventDefault();
      const ratio = ratioFrom(e.clientX);
      paint(ratio);
      vid.currentTime = ratio * vid.duration;
    };
    const onUp = (e) => {
      if (wrap.dataset.scrubbing !== '1') return;
      wrap.dataset.scrubbing = '0';
      wrap.classList.remove('wall-scrub-active');
      wrap.releasePointerCapture?.(e.pointerId);
    };

    wrap.addEventListener('pointerdown', onDown);
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerup', onUp);
    wrap.addEventListener('pointercancel', onUp);
    wrap.addEventListener('lostpointercapture', onUp);

    this._setupHoldToPause(vid, postId);
  },

  /**
   * Mantener presionado el video → pausa mientras se sostiene y retoma al
   * soltar (sin dejar el video en pausa si el usuario solo queria ver el
   * momento). El doble tap sigue reservando el gesto para el corazón, así que
   * el primer tap ya encendido no cuenta como "soltar/reanudar".
   */
  _setupHoldToPause(vid, postId) {
    if (vid.dataset.holdReady === '1') return;
    vid.dataset.holdReady = '1';

    const host = vid.parentElement;
    if (!host) return;

    const icon = document.createElement('div');
    icon.className = 'wall-hold-pause';
    icon.id = `wall-hold-${postId}`;
    icon.innerHTML = `<div class="wall-hold-icon">⏸</div><div class="wall-hold-label">Pausado</div>`;
    host.appendChild(icon);

    let timer = null;
    let holding = false;
    let lastTapAt = 0;
    let suppressClickUntil = 0;

    const wasPlayingBefore = () => !vid.paused && !vid.ended;

    const start = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Un tap simple ya quedó como "toggle": no pausamos dos veces.
        if (Date.now() - lastTapAt < 320) return;
        holding = true;
        icon.classList.add('wall-hold-on');
        if (wasPlayingBefore()) vid.pause();
        if (navigator.vibrate) navigator.vibrate(12);
      }, 240);
    };

    const finish = () => {
      clearTimeout(timer);
      timer = null;
      if (!holding) return;
      holding = false;
      icon.classList.remove('wall-hold-on');
      if (vid.paused && !vid.ended) vid.play().catch(() => {});
      // El navegador emite click justo después de touchend/mouseup. Sin esta
      // ventana, ese click invertiría el estado y dejaría el video pausado
      // tras una pulsación larga.
      suppressClickUntil = Date.now() + 350;
    };

    // El scroll cancela la pulsación: no debe pausarse nada.
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
      if (!holding) return;
      holding = false;
      icon.classList.remove('wall-hold-on');
      suppressClickUntil = Date.now() + 350;
    };

    vid.addEventListener('touchstart', start, { passive: true });
    vid.addEventListener('touchend', finish, { passive: true });
    vid.addEventListener('touchcancel', cancel, { passive: true });
    vid.addEventListener('touchmove', cancel, { passive: true });
    vid.addEventListener('mousedown', start);
    // Sin mouseup el video quedaba pausado para siempre tras una pulsación larga.
    vid.addEventListener('mouseup', finish);
    vid.addEventListener('mouseleave', cancel);
    // En touch el click se dispara después del touchend: se filtra para no
    // alternar play/pause al terminar de mantener presionado.
    vid.addEventListener('click', (e) => {
      e.stopPropagation();
      const now = Date.now();
      if (now < suppressClickUntil) return;
      if (now - lastTapAt < 320) return;
      lastTapAt = now;
      if (vid.paused) vid.play().catch(() => {});
      else vid.pause();
      this._flashTapIcon(postId, vid.paused);
    });
  },

  /** Destello del icono play/pause al tocar el video */
  _flashTapIcon(postId, isPaused) {
    const host = document.getElementById(`video-wrapper-${postId}`);
    if (!host) return;
    let icon = document.getElementById(`wall-tap-${postId}`);
    if (!icon) {
      icon = document.createElement('div');
      icon.className = 'wall-tap-icon';
      icon.id = `wall-tap-${postId}`;
      host.appendChild(icon);
    }
    icon.textContent = isPaused ? '▶' : '⏸';
    icon.classList.add('wall-tap-on');
    clearTimeout(icon._t);
    icon._t = setTimeout(() => icon.classList.remove('wall-tap-on'), 520);
  },

  _replayVideo(postId) {
    const vid = document.getElementById(`wall-vid-${postId}`);
    if (vid) { vid.currentTime = 0; vid.play().catch(() => {}); document.getElementById(`wall-replay-${postId}`)?.classList.add('hidden'); }
  },

  _onVideoError(postId) {
    const wrapper = document.getElementById(`video-wrapper-${postId}`);
    if (wrapper) wrapper.innerHTML = `<div class="flex items-center justify-center h-32 text-slate-400 text-xs font-bold">⚠️ Error al cargar el video</div>`;
  },

  // ── Lightbox Inmersivo ───────────────────────────────────────────────────────
  openLightbox(url, type, postId = null) {
    if (!url) return;
    const isVideo = type === 'video' || /\.(mp4|webm|mov|m4v)$/i.test(url);
    const media = isVideo
      ? `<video controls playsinline autoplay muted loop class="wall-lightbox-media" preload="metadata" style="background:#000"><source src="${_sanitizeHTML(url)}" type="video/mp4"></video>`
      : `<img src="${_sanitizeHTML(url)}" class="wall-lightbox-media select-none" alt="Publicación" draggable="false" loading="eager">`;

    const hasPost = !!postId && !!document.getElementById(`post-${postId}`);

    const lb = document.createElement('div');
    lb.id = 'wall-lightbox';
    lb.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
    lb.style.cssText = 'background:rgba(0,0,0,0.92);backdrop-filter:blur(12px);animation:wall-bounce-in 0.3s ease';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Visor de multimedia');
    lb.innerHTML = `
      <button id="wall-lb-close" aria-label="Cerrar"
        class="absolute top-4 right-4 w-10 h-10 bg-white/15 hover:bg-white/30 rounded-full flex items-center justify-center text-white z-50 transition-colors">
        <i data-lucide="x" class="w-5 h-5"></i>
      </button>
      <div class="wall-lb-shell" onclick="event.stopPropagation()">
        <div class="wall-lb-media">${media}</div>
        ${hasPost ? `
        <aside class="wall-lb-side">
          <div class="wall-lb-head">
            <i data-lucide="message-circle" class="w-4 h-4 text-slate-400"></i>
            <span class="wall-lb-head-title">Conversación</span>
            <span id="wall-lb-count-${postId}" class="wall-counter ml-auto"></span>
          </div>
          <div id="wall-lb-list-${postId}" class="wall-lb-list">
            <div class="py-4 text-center"><div class="animate-spin w-5 h-5 border-2 border-slate-200 border-t-slate-400 rounded-full mx-auto"></div></div>
          </div>
          <div id="wall-lb-reactions-${postId}" class="wall-lb-reactions"></div>
          <div class="wall-lb-foot">
            <input type="text" id="wall-lb-input-${postId}" class="wall-lb-input" placeholder="Escribe un comentario..." aria-label="Escribir comentario">
            <button id="wall-lb-send-${postId}" class="wall-lb-send" aria-label="Enviar comentario">
              <i data-lucide="send" class="w-4 h-4"></i>
            </button>
          </div>
        </aside>` : ''}
      </div>`;
    lb.onclick = () => { this.closeLightbox(); };
    document.body.appendChild(lb);
    if (window.lucide) lucide.createIcons();

    document.getElementById('wall-lb-close')?.addEventListener('click', (e) => { e.stopPropagation(); this.closeLightbox(); });
    if (hasPost) this._wireLightboxConversation(postId, lb);

    // Touch swipe para cerrar
    let startY = 0;
    lb.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
    lb.addEventListener('touchend', e => {
      if (Math.abs(e.changedTouches[0].clientY - startY) > 80) this.closeLightbox();
    }, { passive: true });

    // Escape cierra (paridad con el lightbox global)
    this._lbEscHandler = (e) => {
      if (e.key === 'Escape' && document.getElementById('wall-lightbox')) {
        e.stopPropagation();
        this.closeLightbox();
      }
    };
    document.addEventListener('keydown', this._lbEscHandler, true);
  },

  /**
   * Cierre real del lightbox. Antes se relieda en un listener del evento
   * 'remove', que el DOM nunca emite, así que el <video> seguía reproduciendo
   * y el listener de Escape se acumulaba en cada apertura.
   */
  closeLightbox() {
    const lb = document.getElementById('wall-lightbox');
    if (!lb) return;
    const vid = lb.querySelector('video');
    if (vid) { try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch (_) { /* noop */ } }
    lb.remove();
    this._unbindLightboxEsc();
  },

  _unbindLightboxEsc() {
    if (this._lbEscHandler) document.removeEventListener('keydown', this._lbEscHandler, true);
    this._lbEscHandler = null;
  },

  /**
   * Panel lateral del lightbox: reutiliza el hilo de comentarios y las
   * reacciones del post sin duplicar consultas ni marcado.
   */
  async _wireLightboxConversation(postId, lb) {
    const list    = document.getElementById(`wall-lb-list-${postId}`);
    const input   = document.getElementById(`wall-lb-input-${postId}`);
    const sendBtn = document.getElementById(`wall-lb-send-${postId}`);
    const counter = document.getElementById(`wall-lb-count-${postId}`);
    const rxRow   = document.getElementById(`wall-lb-reactions-${postId}`);
    if (!list) return;

    if (counter) counter.textContent = document.getElementById(`comment-count-${postId}`)?.textContent || '';

    if (rxRow) {
      rxRow.innerHTML = `
        <button id="wall-lb-like-${postId}" class="wall-lb-reaction" aria-label="Me gusta">
          ${document.getElementById(`like-main-${postId}`)?.classList.contains('active') ? '❤️' : '🤍'}
        </button>
        <button id="wall-lb-more-${postId}" class="wall-lb-reaction" style="width:auto;padding:0 10px;font-size:11px;font-weight:900;color:#64748b" aria-label="Más reacciones">+</button>`;
      rxRow.querySelector('#wall-lb-like-' + postId)?.addEventListener('click', () => {
        // El botón del lightbox se sincroniza dentro de _refreshReactionUI.
        this.toggleReaction(postId, 'like');
      });
      rxRow.querySelector('#wall-lb-more-' + postId)?.addEventListener('click', (e) => {
        this.openReactionPicker(postId, e.currentTarget);
      });
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', async () => {
        const ok = await this.sendComment(postId, null, { inputEl: input, listEl: list });
        if (!ok) return;
        if (input) input.value = '';
        const fresh = await this._fetchComments(postId);
        if (!document.getElementById('wall-lightbox')) return;
        this.renderComments(postId, fresh, list);
        list.scrollTop = list.scrollHeight;
        const feedList = document.getElementById(`comments-list-${postId}`);
        if (feedList) this.renderComments(postId, fresh, feedList);
      });
    }

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        sendBtn?.click();
      });
    }

    const comments = await this._fetchComments(postId);
    // El overlay pudo cerrarse mientras cargaba el hilo.
    if (!document.getElementById('wall-lightbox')) return;
    this.renderComments(postId, comments, list);
    if (counter) counter.textContent = String(comments.length);
  },

  openLightboxFromPost(postId) {
    const img = document.querySelector(`#post-${postId} img`);
    if (img) this.openLightbox(img.src, 'image', postId);
  },

  // ── Reacciones ───────────────────────────────────────────────────────────────
  async toggleReaction(postId, reactionType) {
    const user = this._appState?.get('user');
    if (!user) return;
    const postEl = document.getElementById(`post-${postId}`);
    if (!postEl) return;
    const current = postEl.dataset.userReaction;
    const isSame = current === reactionType;

    // ── Optimistic update INMEDIATO (no espera Supabase) ──────────────────────
    const newReaction = isSame ? '' : reactionType;
    postEl.dataset.userReaction = newReaction;
    this._refreshReactionUI(postId, isSame ? -1 : current ? 0 : 1, reactionType, isSame ? current : null);

    // ── Animación pop + partículas ────────────────────────────────────────────
    if (!isSame) {
      this._animateLikePop(postId, reactionType);
      if (navigator.vibrate) navigator.vibrate(10);
    }

    // ── Sincronizar con Supabase en segundo plano ────────────────────────────
    try {
      if (isSame) {
        await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', user.id);
      } else {
        if (current) await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', user.id);
        let insertErr = null;
        if (this._supportsReactionType !== false) {
          ({ error: insertErr } = await supabase.from('likes')
            .insert({ post_id: postId, user_id: user.id, reaction_type: reactionType }));
          if (insertErr && _isMissingColumnError(insertErr, 'reaction_type')) this._supportsReactionType = false;
        }
        if (this._supportsReactionType === false) {
          ({ error: insertErr } = await supabase.from('likes').insert({ post_id: postId, user_id: user.id }));
        }
        if (insertErr) throw insertErr;
        // Notificar al autor del post (fire & forget)
        this._notifyPostAuthor(postId, reactionType);
      }
    } catch (_) {
      // Revertir optimistic update si falla
      postEl.dataset.userReaction = current || '';
      this._refreshReactionUI(postId, isSame ? 1 : current ? 0 : -1, reactionType, null);
    }
  },

  _animateLikePop(postId, reactionType) {
    const emoji = reactionType === 'like' ? '❤️' : reactionType;
    // Pop en el botón activo
    const bar = document.getElementById(`reactions-${postId}`);
    const btn = bar?.querySelector(`[data-reaction="${reactionType}"]`);
    if (btn) {
      btn.classList.remove('wall-like-pop');
      btn.offsetWidth; // reflow trigger for animation restart
      btn.classList.add('wall-like-pop');
      setTimeout(() => btn.classList.remove('wall-like-pop'), 450);
    }
    // Partículas voladoras
    const postEl = document.getElementById(`post-${postId}`);
    const reactionBar = document.getElementById(`reactions-${postId}`);
    if (!postEl || !reactionBar) return;
    const rect = reactionBar.getBoundingClientRect();
    const postRect = postEl.getBoundingClientRect();
    for (let i = 0; i < 4; i++) {
      const p = document.createElement('span');
      p.className = 'wall-particle';
      const tx = (Math.random() - 0.5) * 60; // NOSONAR - safe for UI animation
      const ty = -(20 + Math.random() * 40);  // NOSONAR - safe for UI animation
      p.style.cssText = `
        left:${rect.left - postRect.left + rect.width / 2}px;
        top:${rect.top - postRect.top}px;
        --tx:${tx}px;--ty:${ty}px;
        animation-delay:${i * 80}ms;
      `;
      p.textContent = emoji;
      postEl.style.position = 'relative';
      postEl.appendChild(p);
      setTimeout(() => p.remove(), 900);
    }
  },

  /** Notifica al autor del post cuando alguien reacciona (fire & forget) */
  async _notifyPostAuthor(postId, reactionType) {
    try {
      const actor = this._appState?.get('user');
      const actorProfile = this._appState?.get('profile');
      if (!actor) return;
      const { data: post } = await supabase.from('posts').select('teacher_id').eq('id', postId).single();
      if (!post || post.teacher_id === actor.id) return; // no auto-notificar
      const emoji = reactionType === 'like' ? '❤️' : reactionType;
      await supabase.from('wall_notifications').insert({
        user_id:    post.teacher_id,
        actor_id:   actor.id,
        actor_name: actorProfile?.name || 'Alguien',
        type:       'reaction',
        post_id:    postId,
        message:    `${emoji} reaccionó a tu publicación`,
      });
    } catch (_) { /* silencioso */ }
  },

  // ── Reacción UI helpers ───────────────────────────────────────────────────────
  async toggleLike(postId) { await this.toggleReaction(postId, 'like'); },

  /** Tap en el botón principal: like rápido. Long-press abre picker. */
  _onLikeMainClick(postId, event) {
    // Si el picker ya está visible, no hacer nada (lo cierra el click-outside)
    const existingPicker = document.getElementById(`reaction-picker-${postId}`);
    if (existingPicker) { this.closeReactionPicker(); return; }
    // Tap normal = toggle ❤️
    this.toggleReaction(postId, 'like');
  },

  _refreshReactionUI(postId, delta = 0, added = null, removed = null) {
    const postEl = document.getElementById(`post-${postId}`);
    if (!postEl) return;
    const current = postEl.dataset.userReaction;

    // Actualizar botón principal
    const likeMain = document.getElementById(`like-main-${postId}`);
    if (likeMain) {
      const isActive = !!current;
      const emoji    = (current && current !== 'like') ? current : '❤️';
      const label    = current === 'like' ? 'Me gusta' : (current || 'Me gusta');
      likeMain.classList.toggle('active', isActive);
      likeMain.setAttribute('aria-pressed', String(isActive));
      const emojiEl = likeMain.querySelector('.wall-emoji');
      const labelEl = likeMain.querySelector('.wall-like-label');
      if (emojiEl) emojiEl.textContent = emoji;
      if (labelEl) labelEl.textContent = label;
    }

    // Sincroniza el botón del panel lateral del lightbox: es el único punto de
    // paso para tap directo y para el selector de reacciones.
    const likeLb = document.getElementById(`wall-lb-like-${postId}`);
    if (likeLb) {
      likeLb.textContent = (current && current !== 'like') ? current : (current ? '❤️' : '🤍');
      likeLb.setAttribute('aria-pressed', String(!!current));
    }

    this._updateReactionChips(postId, delta, added, removed);
  },

  _updateReactionChips(postId, delta, added, removed) {
    const chipsEl = document.getElementById(`reaction-chips-${postId}`);
    if (!chipsEl) return;
    let counts = {};
    try { counts = JSON.parse(chipsEl.dataset.counts || '{}'); } catch (e) { console.warn('[Wall] Failed to parse reaction counts:', e); }
    if (added)   counts[added]   = (counts[added]   || 0) + 1;
    if (removed) counts[removed] = Math.max(0, (counts[removed] || 0) - 1);
    chipsEl.dataset.counts = JSON.stringify(counts);

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const totalEl = document.getElementById(`reaction-total-${postId}`);

    if (total === 0) {
      chipsEl.innerHTML = '';
      return;
    }

    const top = Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const chips = top.map(([type, count]) =>
      `<span class="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-1.5 py-0.5 cursor-pointer hover:bg-slate-200 transition-colors"
             onclick="WallModule.showReactionsList('${postId}')">${type === 'like' ? '❤️' : type} ${count}</span>`
    ).join('');

    if (totalEl) {
      // Solo reemplazar chips, mantener el span de total
      const existingTotal = totalEl.cloneNode(true);
      chipsEl.innerHTML = chips;
      existingTotal.textContent = total;
      existingTotal.classList.remove('wall-counter-bump');
      chipsEl.appendChild(existingTotal);
      existingTotal.offsetWidth; // reflow trigger for animation restart
      existingTotal.classList.add('wall-counter-bump');
      setTimeout(() => existingTotal.classList.remove('wall-counter-bump'), 400);
    } else {
      chipsEl.innerHTML = chips +
        `<span id="reaction-total-${postId}" class="text-[10px] font-bold text-slate-400">${total}</span>`;
    }
  },

  async showReactionsList(postId) {
    try {
      const { data: likes } = await supabase.from('likes')
        .select('reaction_type, profile:profiles!likes_user_id_fkey(name)')
        .eq('post_id', postId).order('created_at', { ascending: false }).limit(20);
      if (!likes?.length) return;
      const rows = likes.map(l => {
        const name  = Array.isArray(l.profile) ? l.profile[0]?.name : l.profile?.name;
        const emoji = (!l.reaction_type || l.reaction_type === 'like') ? '❤️' : l.reaction_type;
        return `<div class="flex items-center gap-2 py-1.5 px-4 hover:bg-slate-50">
          <span class="text-lg leading-none">${emoji}</span>
          <span class="text-sm font-bold text-slate-700">${_sanitizeHTML(name || 'Usuario')}</span>
        </div>`;
      }).join('');
      window.openGlobalModal(`
        <div class="modal-header bg-gradient-to-r from-rose-500 to-pink-500 text-white p-5 rounded-t-3xl">
          <h3 class="text-base font-black">Reacciones</h3>
        </div>
        <div class="py-2 max-h-64 overflow-y-auto">${rows}</div>
        <div class="p-4 border-t">
          <button onclick="App.ui.closeModal()" class="w-full py-2.5 bg-slate-100 rounded-2xl text-sm font-black text-slate-600">Cerrar</button>
        </div>`);
    } catch (_) { /* silencioso */ }
  },

  openReactionPicker(postId, anchorEl) {
    this.closeReactionPicker();
    const picker = document.createElement('div');
    picker.id = `reaction-picker-${postId}`;
    picker.className = 'wall-reaction-picker';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Selector de reacciones');
    picker.innerHTML = REACTION_EMOJIS.map(emoji => {
      const type = emoji === '❤️' ? 'like' : emoji;
      return `<button class="wall-reaction-picker-btn" title="${type}"
                onclick="WallModule.closeReactionPicker();WallModule.toggleReaction('${postId}','${type}')"
                aria-label="Reaccionar con ${emoji}">${emoji}</button>`;
    }).join('');
    // Fijo al viewport (evita clipping por overflow-hidden del post) y medimos sin animación
    picker.style.animation = 'none';
    document.body.appendChild(picker);

    const r  = anchorEl.getBoundingClientRect();
    const pw = picker.offsetWidth;
    const ph = picker.offsetHeight;
    const margin = 8;

    // Centrar sobre el botón y "clamp" dentro del viewport
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));

    // Preferencia: arriba del botón; si no cabe, abajo
    let top = r.top - ph - 12;
    const flip = top < 60;
    if (flip) top = r.bottom + 12;
    top = Math.max(margin, Math.min(top, window.innerHeight - ph - margin));

    picker.style.left = `${Math.round(left)}px`;
    picker.style.top  = `${Math.round(top)}px`;

    // Flecha apuntando al botón (x relativa al picker ya clampeado)
    let arrowX = r.left + r.width / 2 - left;
    arrowX = Math.max(18, Math.min(arrowX, pw - 18));
    picker.style.setProperty('--arrow-x', `${Math.round(arrowX)}px`);
    if (flip) picker.classList.add('flip');

    picker.style.animation = '';
    setTimeout(() => {
      const close = (e) => {
        if (!picker.contains(e.target)) { this.closeReactionPicker(); document.removeEventListener('click', close); }
      };
      document.addEventListener('click', close);
    }, 50);
  },

  closeReactionPicker() {
    document.querySelectorAll('[id^="reaction-picker-"]').forEach(el => el.remove());
  },

  // ── Comentarios ──────────────────────────────────────────────────────────────
  /**
   * `opts.inputEl` / `opts.listEl` permiten enviar desde el panel lateral del
   * lightbox sin colgarlo del input de la tarjeta del feed. Sin ellos mantiene
   * el comportamiento original.
   */
  async sendComment(postId, parentId = null, opts = {}) {
    const inputId = parentId ? `reply-input-${parentId}` : `comment-input-${postId}`;
    const input = opts.inputEl || document.getElementById(inputId);
    const raw = input?.value.trim();
    if (!raw) return false;

    const now = Date.now();
    if (now - this._lastPostTime < _SPAM_COOLDOWN_MS) {
      Helpers.toast('Espera un momento antes de comentar de nuevo', 'warning');
      return false;
    }

    const content = _sanitizeHTML(raw);
    const user = this._appState?.get('user');
    const profile = this._appState?.get('profile');
    if (!user) return false;

    let userName;
    if (profile?.role === 'padre') {
      const { data: st } = await supabase.from('students').select('name').eq('parent_id', user.id).maybeSingle();
      userName = st?.name || profile.name || 'Padre';
    } else {
      userName = profile?.name || 'Personal';
    }

    const list = opts.listEl || (parentId
      ? document.getElementById(`replies-list-${parentId}`)
      : document.getElementById(`comments-list-${postId}`));

    const tempId = `temp-${Date.now()}`;
    if (list) {
      list.querySelector('.italic')?.remove();
      const colorCls = this._getAvatarColor(userName);
      const el = document.createElement('div');
      el.id = tempId;
      el.className = parentId
        ? 'wall-reply-item flex gap-2 text-xs opacity-60'
        : 'flex gap-2 text-xs opacity-60 wall-slide-up';
      el.innerHTML = `
        <div class="w-6 h-6 rounded-full ${colorCls} flex items-center justify-center font-black text-[9px] shrink-0">${_sanitizeHTML(userName.charAt(0))}</div>
        <div class="bg-white p-2.5 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm flex-1">
          <span class="font-black text-slate-800 text-[11px]">${_sanitizeHTML(userName)}</span>
          <p class="text-slate-600 leading-relaxed mt-0.5">${_sanitizeHTML(content)}</p>
        </div>`;
      list.appendChild(el);
      list.scrollTop = list.scrollHeight;
    }

    input.value = '';
    // Reset reply hint if present
    if (parentId) {
      const hint = document.getElementById(`reply-hint-${parentId}`);
      if (hint) hint.remove();
    }
    this._lastPostTime = now;

    try {
      const payload = {
        post_id:           postId,
        user_id:           user.id,
        user_name:         userName,
        content,
        parent_comment_id: parentId || null,
      };
      const { error, data: newComment } = await supabase.from('comments').insert(payload).select('id').single();
      if (error) throw error;
      document.getElementById(tempId)?.classList.remove('opacity-60');
      if (!parentId) {
        const cnt = document.getElementById(`comment-count-${postId}`);
        if (cnt) {
          cnt.textContent = Number.parseInt(cnt.textContent || '0') + 1;
          cnt.classList.remove('wall-counter-bump');
          cnt.offsetWidth; // reflow trigger for animation restart
          cnt.classList.add('wall-counter-bump');
          setTimeout(() => cnt.classList.remove('wall-counter-bump'), 400);
        }
        // Notificar autor del post
        this._notifyCommentAuthor(postId, newComment?.id, userName, content);
      }
      return true;
    } catch (_) {
      document.getElementById(tempId)?.remove();
      input.value = raw;
      return false;
    }
  },

  /** Muestra/oculta el campo de respuesta bajo un comentario */
  showReplyInput(postId, commentId, replyToName) {
    // Quitar inputs de reply anteriores
    document.querySelectorAll('[id^="reply-input-wrap-"]').forEach(el => el.remove());
    const commentEl = document.getElementById(`comment-item-${commentId}`);
    if (!commentEl) return;

    const wrap = document.createElement('div');
    wrap.id = `reply-input-wrap-${commentId}`;
    wrap.className = 'flex gap-2 mt-2 wall-reply-in';
    wrap.innerHTML = `
      <div id="reply-hint-${commentId}" class="wall-comment-reply-hint text-indigo-400">↩ Respondiendo a ${_sanitizeHTML(replyToName)}</div>
      <div class="flex gap-1.5 flex-1">
        <input type="text" id="reply-input-${commentId}"
          class="flex-1 px-3 py-1.5 text-xs border border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-300 outline-none bg-indigo-50/50"
          placeholder="Responder a ${_sanitizeHTML(replyToName)}..."
          onkeypress="if(event.key==='Enter') WallModule.sendComment('${postId}', '${commentId}')">
        <button onclick="WallModule.sendComment('${postId}', '${commentId}')"
          class="p-1.5 bg-indigo-500 text-white rounded-xl hover:bg-indigo-600 transition-colors" aria-label="Enviar respuesta">
          <i data-lucide="send" class="w-3.5 h-3.5"></i>
        </button>
      </div>`;
    commentEl.appendChild(wrap);
    document.getElementById(`reply-input-${commentId}`)?.focus();
    if (window.lucide) lucide.createIcons();
  },

  /** Notifica al autor del post de un nuevo comentario (fire & forget) */
  async _notifyCommentAuthor(postId, commentId, actorName, content) {
    try {
      const actor = this._appState?.get('user');
      if (!actor) return;
      const { data: post } = await supabase.from('posts').select('teacher_id').eq('id', postId).single();
      if (!post || post.teacher_id === actor.id) return;
      await supabase.from('wall_notifications').insert({
        user_id:    post.teacher_id,
        actor_id:   actor.id,
        actor_name: actorName,
        type:       'comment',
        post_id:    postId,
        comment_id: commentId,
        message:    `💬 comentó: "${content.slice(0, 60)}${content.length > 60 ? '…' : ''}"`,
      });
    } catch (_) { /* silencioso */ }
  },

  /** Abre la sección de comentarios y hace focus en el input (abre teclado en móvil) */
  async openCommentSection(postId) {
    const section = document.getElementById(`comments-section-${postId}`);
    if (!section) return;
    const wasHidden = section.classList.contains('hidden');
    section.classList.remove('hidden');

    const list = document.getElementById(`comments-list-${postId}`);
    if (list && !list.querySelector('.bg-white, [id^="comment-item-"]')) {
      list.innerHTML = `<div class="py-4 text-center"><div class="animate-spin w-5 h-5 border-2 border-slate-200 border-t-slate-400 rounded-full mx-auto"></div></div>`;
      const comments = await this._fetchComments(postId);
      this.renderComments(postId, comments);
    }

    // Focus en el input → abre teclado en móvil
    const input = document.getElementById(`comment-input-${postId}`);
    if (input) {
      setTimeout(() => {
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, wasHidden ? 200 : 50);
    }
    if (window.lucide) lucide.createIcons();
  },

  async toggleCommentSection(postId) {
    const section = document.getElementById(`comments-section-${postId}`);
    if (!section) return;
    if (section.classList.contains('hidden')) {
      await this.openCommentSection(postId);
    } else {
      section.classList.add('hidden');
    }
  },

  async _fetchComments(postId) {
    const { data } = await supabase.from('comments')
      .select('id, content, user_name, created_at, user_id, parent_comment_id, profile:profiles!comments_user_id_fkey(name, avatar_url, role)')
      .eq('post_id', postId).order('created_at', { ascending: true });

    const parentComments = (data || []).filter(c => {
      const p = Array.isArray(c.profile) ? c.profile[0] : c.profile;
      return p?.role === 'padre';
    });
    if (parentComments.length) {
      const ids = [...new Set(parentComments.map(c => c.user_id))];
      const { data: students } = await supabase.from('students').select('parent_id, name').in('parent_id', ids);
      const map = {}; (students || []).forEach(s => { map[s.parent_id] = s.name; });
      return (data || []).map(c => {
        const pr = Array.isArray(c.profile) ? c.profile[0] : c.profile;
        return (pr?.role === 'padre' && map[c.user_id]) ? { ...c, _studentName: map[c.user_id] } : c;
      });
    }
    return data || [];
  },

  renderComments(postId, comments, targetEl = null) {
    // `targetEl` permite renderizar la misma lista dentro del lightbox de dos
    // columnas sin duplicar el markup ni el marcado de respuestas.
    const container = targetEl || document.getElementById(`comments-list-${postId}`);
    if (!container) return;
    if (!comments.length) {
      container.innerHTML = '<p class="text-center text-[10px] text-slate-400 italic py-2">Sé el primero en comentar.</p>';
      return;
    }
    const roots    = comments.filter(c => !c.parent_comment_id);
    const replies  = comments.filter(c => !!c.parent_comment_id);
    const replyMap = {};
    replies.forEach(r => {
      if (!replyMap[r.parent_comment_id]) replyMap[r.parent_comment_id] = [];
      replyMap[r.parent_comment_id].push(r);
    });
    container.innerHTML = roots.map(c => this._renderCommentItem(c, postId, replyMap)).join('');
  },

  _renderCommentItem(c, postId, replyMap = {}) {
    const pr = Array.isArray(c.profile) ? c.profile[0] : (c.profile || null);
    const name = (pr?.role === 'padre' && c._studentName) ? c._studentName : (pr?.name || c.user_name || 'Usuario');
    const colorCls = this._getAvatarColor(name);
    const time = new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const childReplies = replyMap[c.id] || [];
    const canReply = !!this._appState?.get('user');
    const safeName = _sanitizeHTML(name.replace(/'/g, '&#39;'));

    const repliesHtml = childReplies.map(r => {
      const rpr = Array.isArray(r.profile) ? r.profile[0] : (r.profile || null);
      const rname = (rpr?.role === 'padre' && r._studentName) ? r._studentName : (rpr?.name || r.user_name || 'Usuario');
      const rColor = this._getAvatarColor(rname);
      const rTime = new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<div class="wall-reply-item flex gap-1.5 text-xs">
        <div class="w-6 h-6 rounded-full ${rColor} flex items-center justify-center font-black text-[9px] shrink-0">${_sanitizeHTML(rname.charAt(0))}</div>
        <div class="bg-indigo-50 p-2 rounded-2xl rounded-tl-none border border-indigo-100 flex-1">
          <div class="flex justify-between mb-0.5">
            <span class="font-black text-slate-700 text-[11px]">${_sanitizeHTML(rname)}</span>
            <span class="text-[9px] text-slate-400 font-bold">${rTime}</span>
          </div>
          <p class="text-slate-600 leading-relaxed">${_sanitizeHTML(r.content)}</p>
        </div>
      </div>`;
    }).join('');

    return `<div class="flex gap-2 text-xs wall-slide-up" id="comment-item-${c.id}">
      <div class="w-7 h-7 rounded-full ${colorCls} flex items-center justify-center font-black text-[10px] shrink-0">${_sanitizeHTML(name.charAt(0))}</div>
      <div class="flex-1 min-w-0">
        <div class="bg-white p-3 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm">
          <div class="flex justify-between mb-1">
            <span class="font-black text-slate-800 text-[11px]">${_sanitizeHTML(name)}</span>
            <span class="text-[9px] text-slate-400 font-bold">${time}</span>
          </div>
          <p class="text-slate-600 leading-relaxed">${_sanitizeHTML(c.content)}</p>
        </div>
        ${canReply ? `<button class="wall-reply-toggle" onclick="WallModule.showReplyInput('${postId}','${c.id}','${safeName}')" aria-label="Responder">↩ Responder</button>` : ''}
        <div id="replies-list-${c.id}" class="mt-1 space-y-2">${repliesHtml}</div>
      </div>
    </div>`;
  },

  // ── Fijar / Borrar / Toggles ─────────────────────────────────────────────────
  async togglePin(postId) {
    try {
      const el = document.getElementById(`post-${postId}`);
      const pinned = !!el?.querySelector('.wall-pinned-badge');

      if (!pinned) {
        // Verificar límite de 2 posts fijados
        const { count } = await supabase.from('posts').select('id', { count: 'exact', head: true }).eq('is_pinned', true);
        if ((count || 0) >= MAX_PINNED_POSTS) {
          Helpers.toast(`Solo puedes tener ${MAX_PINNED_POSTS} publicaciones fijadas`, 'warning');
          return;
        }
      }
      await supabase.from('posts').update({ is_pinned: !pinned }).eq('id', postId);
      Helpers.toast(pinned ? 'Publicación desfijada' : 'Publicación fijada ✅', 'success');
      const c = document.getElementById(this._containerId);
      if (c) { this._page = 0; this._hasMore = true; this.loadPosts(c); }
    } catch (_) { Helpers.toast('Error al fijar', 'error'); }
  },

  async toggleComments(postId, currentlyEnabled) {
    try {
      await supabase.from('posts').update({ comments_enabled: !currentlyEnabled }).eq('id', postId);
      Helpers.toast(currentlyEnabled ? 'Comentarios desactivados' : 'Comentarios activados', 'success');
    } catch (_) { Helpers.toast('Error', 'error'); }
  },

  async deletePost(postId) {
    // Verificar ventana de 24h para maestra (directora puede siempre)
    const profile = this._appState?.get('profile');
    if (profile?.role === 'maestra') {
      const postEl = document.getElementById(`post-${postId}`);
      const timeEl = postEl?.querySelector('.text-slate-400.font-bold');
      // Simplificado: verificar si el post tiene más de 24h mirando el texto relativo
      const txt = timeEl?.textContent || '';
      if (txt.includes('día') || txt.includes('mes') || txt.includes('año')) {
        Helpers.toast('Solo puedes eliminar publicaciones de las últimas 24 horas', 'warning');
        return;
      }
    }
    if (!confirm('¿Eliminar esta publicación permanentemente?')) return;
    try {
      const el = document.getElementById(`post-${postId}`);
      if (el) { el.style.transition = 'all 0.3s ease'; el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; }
      await supabase.from('posts').delete().eq('id', postId);
      // Audit log
      this._auditLog('delete_post', { post_id: postId });
      setTimeout(() => document.getElementById(`post-${postId}`)?.remove(), 350);
      Helpers.toast('Publicación eliminada', 'info');
    } catch (_) { Helpers.toast('Error al eliminar', 'error'); }
  },

  /** Compartir al chat interno */
  shareToChat(postId) {
    const postEl = document.getElementById(`post-${postId}`);
    const content = postEl?.querySelector('.text-slate-600.text-sm')?.textContent?.trim() || '';
    const mediaUrl = postEl?.querySelector('img')?.src || postEl?.querySelector('video source')?.src || '';
    Helpers.toast('Abriendo chat...', 'info');
    // Dispara evento que chat.js puede escuchar
    document.dispatchEvent(new CustomEvent('wall:share-to-chat', { detail: { postId, content, mediaUrl } }));
  },

  /** Registro de auditoría (fire & forget) */
  _auditLog(action, meta = {}) {
    const user = this._appState?.get('user');
    if (!user) return;
    supabase.from('audit_logs').insert({
      action,
      user_id: user.id,
      metadata: meta,
      created_at: new Date().toISOString()
    }).catch(() => {});
  },

  // ── Realtime ─────────────────────────────────────────────────────────────────
  subscribeRealtime() {
    this._unsubscribeRealtime();
    const classroomId = this._options.classroomId;

    this._realtimeChannel = supabase.channel(`wall_${classroomId || 'global'}_${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (payload) => {
        const post = payload.new;
        // Ignorar posts programados (aún no publicados)
        if (post.status === 'scheduled' || (post.scheduled_at && new Date(post.scheduled_at) > new Date())) return;
        // Respetar el filtro de aula (cuando el muro está filtrando por aula)
        if (classroomId && post.classroom_id && post.classroom_id !== classroomId) return;
        // Si pudimos renderizarlo en vivo, lo insertamos al inicio del feed (realtime real).
        if (!this._prependLivePost(post)) {
          // Fallback: si no aplica al feed actual (búsqueda/filtro activo), mostrar banner.
          this._showNewPostsBanner();
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, (payload) => {
        const post = payload.new;
        const el = document.getElementById(`post-${post.id}`);
        if (!el) return;
        const cnt = document.getElementById(`comment-count-${post.id}`);
        if (cnt && typeof post.comments_count === 'number') cnt.textContent = post.comments_count;
        // Actualizar views
        const viewEl = el.querySelector('.wall-view-count');
        if (viewEl && post.views_count) viewEl.innerHTML = `<i data-lucide="eye" class="w-3 h-3"></i>${post.views_count}`;
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => {
        const el = document.getElementById(`post-${payload.old?.id}`);
        if (el) { el.classList.add('opacity-0'); setTimeout(() => el.remove(), 300); }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'likes' }, (payload) => {
        const uid = this._appState?.get('user')?.id;
        const postId = payload.new.post_id;
        if (uid && payload.new.user_id === uid) {
          this._refreshReactionUI(postId);
        } else {
          // Like de otro usuario — actualizar chips sin cambiar estado activo del usuario actual
          this._updateReactionChips(postId, 1, payload.new.reaction_type || 'like', null);
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'likes' }, (payload) => {
        const uid = this._appState?.get('user')?.id;
        const postId = payload.old?.post_id;
        if (!postId) return;
        if (uid && payload.old?.user_id === uid) {
          this._refreshReactionUI(postId);
        } else {
          this._updateReactionChips(postId, -1, null, payload.old?.reaction_type || 'like');
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') setTimeout(() => { if (this._realtimeChannel) this.subscribeRealtime(); }, 5000);
      });
  },

  _unsubscribeRealtime() {
    if (this._realtimeChannel) { try { supabase.removeChannel(this._realtimeChannel); } catch (e) { console.warn('[Wall] removeChannel failed:', e); } this._realtimeChannel = null; }
    if (this._observer) { this._observer.disconnect(); this._observer = null; }
    if (this._videoObserver) { this._videoObserver.disconnect(); this._videoObserver = null; }
  },

  /**
   * 🔄 Inserta en vivo una publicación recién creada al inicio del feed.
   * Retorna true si se insertó; false si no aplica al feed actual (filtro,
   * búsqueda, ya cargada, etc.) para que el caller muestre el banner.
   */
  _prependLivePost(post) {
    try {
      const container = document.getElementById(this._containerId);
      if (!container) return false;
      // No insertar si el contenedor está mostrando un estado vacío/error/loader
      if (container.querySelector('#wall-loader') || container.querySelector('.empty-state')) return false;
      // Ya existe ese post → no duplicar
      if (document.getElementById(`post-${post.id}`)) return true;
      // Búsqueda activa: respetar coincidencia
      const q = (this._options.searchTerm || '').trim().toLowerCase();
      if (q && !((post.content || '').toLowerCase().includes(q))) return false;
      // Filtros de tab activos (videos/photos/announcements) → no forzar inserción
      if (this._activeFilter === 'videos' && !(post.media_url && /\.(mp4|mov|webm|m4v)$/i.test(post.media_url))) return false;
      if (this._activeFilter === 'photos' && !post.media_url && !post.image_url) return false;
      if (this._activeFilter === 'announcements' && post.media_type !== 'announcement') return false;
      // Expiración
      if (this._isExpired(post.created_at, post.expire_days)) return false;

      const user = this._appState?.get('user');
      const processed = this._processPost(post, user);

      const loaderEl = document.querySelector('#wall-scroll-loader');
      container.insertAdjacentHTML('afterbegin', this.renderPost(processed));
      ImageLoader.observe(container);
      this._setupLongPressReactions(container);
      this._setupVideoAutoplay();
      this._setupDoubleTap(container);
      if (window.lucide) lucide.createIcons();

      // Si el post trae media, registrar vista (no bloqueante)
      if (processed.display_media_url) this._registerViews([processed.id]);
      return true;
    } catch (e) {
      console.warn('[Wall] No se pudo insertar post en vivo:', e);
      return false;
    }
  },

  /** Muestra el banner "nuevas publicaciones disponibles" (fallback). */
  _showNewPostsBanner() {
    const existing = document.getElementById('wall-new-posts-indicator');
    if (existing) return;
    const btn = document.createElement('div');
    btn.id = 'wall-new-posts-indicator';
    btn.className = 'fixed top-24 left-1/2 -translate-x-1/2 bg-orange-500 text-white px-6 py-2.5 rounded-full text-[10px] font-black uppercase shadow-2xl animate-bounce cursor-pointer z-50 flex items-center gap-2 border-2 border-white/20 backdrop-blur-md';
    btn.innerHTML = '⬆ Nuevas publicaciones disponibles';
    btn.onclick = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); this.applyFilters(); btn.remove(); };
    document.body.appendChild(btn);
    setTimeout(() => btn.remove(), 8000);
  },

  destroy() {
    this._unsubscribeRealtime();
    if (this._schedulerTimer) { clearInterval(this._schedulerTimer); this._schedulerTimer = null; }
    if (this._recordStream) { this._recordStream.getTracks().forEach(t => t.stop()); this._recordStream = null; }
    // Limpiar lightbox si queda abierto
    document.getElementById('wall-lightbox')?.remove();
    // Liberar observers de scroll y reproducción (§26: gestión de memoria)
    if (this._observer) { this._observer.disconnect(); this._observer = null; }
    if (this._videoObserver) { this._videoObserver.disconnect(); this._videoObserver = null; }
  },

  // ── Scheduler de publicaciones programadas ───────────────────────────────────
  _startSchedulerChecker() {
    if (this._schedulerTimer) return;
    let delayMs = 60_000; // backoff progresivo si la red falla (máx 5 min)
    const schedule = () => { this._schedulerTimer = setTimeout(run, delayMs); };
    const run = async () => {
      try {
        // Pestaña oculta o sin conexión: no consultar (evita ERR_CONNECTION_CLOSED en background)
        if (document.hidden || !navigator.onLine) return;
        const profile = this._appState?.get('profile');
        if (!['directora','maestra','asistente'].includes(profile?.role)) return;
        const now = new Date().toISOString();
        const { data: due, error: schedErr } = await runWithRetry(async () => await supabase.from('posts')
          .select('id').not('scheduled_at', 'is', null)
          .lte('scheduled_at', now).eq('status', 'scheduled').limit(5), { retries: 2 });
        if (schedErr) {
          // Red inestable: registrar solo el primer fallo y espaciar las consultas
          delayMs = Math.min(5 * 60_000, delayMs + 60_000);
          if (!this._schedFailLogged) {
            console.warn('[Wall] Scheduler en pausa (red):', schedErr.message || schedErr);
            this._schedFailLogged = true;
          }
          schedule();
          return;
        }
        this._schedFailLogged = false;
        delayMs = 60_000;
        if (!due?.length) { schedule(); return; }
        for (const p of due) {
          await runWithRetry(async () => {
            const r = await supabase.from('posts').update({ status: 'published', scheduled_at: null }).eq('id', p.id);
            if (r.error) throw r.error;
          }, { retries: 2 }).catch(() => {});
        }
      } catch (e) {
        if (!this._schedFailLogged) {
          console.warn('[Wall] Scheduler en pausa (red):', e?.message || e);
          this._schedFailLogged = true;
        }
        delayMs = Math.min(5 * 60_000, delayMs + 60_000);
      } finally {
        schedule();
      }
    };
    schedule();
  },

  // ── Video Trimmer Modal ───────────────────────────────────────────────────────
  openVideoTrimmer(file, onTrimmed) {
    const url = URL.createObjectURL(file);
    const modal = document.createElement('div');
    modal.id = 'wall-trimmer';
    modal.className = 'fixed inset-0 z-[10000] flex items-center justify-center p-4';
    modal.style.cssText = 'background:rgba(0,0,0,0.85);backdrop-filter:blur(8px)';
    modal.innerHTML = `
      <div class="bg-white rounded-3xl w-full max-w-md p-6 space-y-5 shadow-2xl">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-orange-100 rounded-2xl flex items-center justify-center text-xl">✂️</div>
          <div>
            <h3 class="font-black text-slate-800">Recortar Video</h3>
            <p class="text-xs text-slate-500">El video excede ${MAX_VIDEO_DURATION}s. Elige el segmento a publicar.</p>
          </div>
        </div>
        <video id="trimmer-preview" src="${_sanitizeHTML(url)}" controls muted class="w-full rounded-2xl max-h-48 bg-black" preload="metadata"></video>
        <div class="space-y-2">
          <div class="flex justify-between text-xs font-bold text-slate-500">
            <span>Inicio: <span id="trim-start-val">0</span>s</span>
            <span>Fin: <span id="trim-end-val">${MAX_VIDEO_DURATION}</span>s (máx ${MAX_VIDEO_DURATION}s)</span>
          </div>
          <input type="range" id="trim-start" min="0" max="0" step="0.5" value="0" class="w-full accent-orange-500"
                 oninput="WallModule._updateTrimmer()" aria-label="Punto de inicio">
          <input type="range" id="trim-end" min="0" max="${MAX_VIDEO_DURATION}" step="0.5" value="${MAX_VIDEO_DURATION}" class="w-full accent-green-500"
                 oninput="WallModule._updateTrimmer()" aria-label="Punto de fin">
        </div>
        <div class="flex gap-3">
          <button onclick="document.getElementById('wall-trimmer')?.remove()" class="flex-1 py-3 border-2 border-slate-200 rounded-2xl text-sm font-black text-slate-500">Cancelar</button>
          <button id="btn-apply-trim" onclick="WallModule._applyTrim('${_sanitizeHTML(url)}')" class="flex-1 py-3 bg-gradient-to-r from-orange-500 to-green-500 text-white rounded-2xl text-sm font-black">Aplicar Recorte</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    const vid = document.getElementById('trimmer-preview');
    vid.onloadedmetadata = () => {
      const endInput = document.getElementById('trim-end');
      const startInput = document.getElementById('trim-start');
      if (endInput) { endInput.max = Math.min(vid.duration, vid.duration); }
      if (startInput) { startInput.max = Math.max(0, vid.duration - MAX_VIDEO_DURATION); }
      document.getElementById('trim-end-val').textContent = Math.min(MAX_VIDEO_DURATION, vid.duration).toFixed(1);
    };
    modal._onTrimmed = onTrimmed;
    modal._originalUrl = url;
  },

  _updateTrimmer() {
    const start = Number.parseFloat(document.getElementById('trim-start')?.value || 0);
    const end = Number.parseFloat(document.getElementById('trim-end')?.value || MAX_VIDEO_DURATION);
    const clamped = Math.min(end, start + MAX_VIDEO_DURATION);
    document.getElementById('trim-start-val').textContent = start.toFixed(1);
    document.getElementById('trim-end-val').textContent = clamped.toFixed(1);
    const vid = document.getElementById('trimmer-preview');
    if (vid) vid.currentTime = start;
  },

  async _applyTrim(originalUrl) {
    const btn = document.getElementById('btn-apply-trim');
    if (btn) { btn.disabled = true; btn.textContent = 'Procesando...'; }
    const start = Number.parseFloat(document.getElementById('trim-start')?.value || 0);
    const end = Number.parseFloat(document.getElementById('trim-end')?.value || MAX_VIDEO_DURATION);
    const modal = document.getElementById('wall-trimmer');

    // Nota: recorte real requiere FFmpeg WASM. Aquí se usa el segmento con nota informativa.
    Helpers.toast(`Segmento ${start.toFixed(1)}s – ${end.toFixed(1)}s seleccionado. El video se subirá completo con inicio en ${start.toFixed(1)}s.`, 'info');
    if (modal?._onTrimmed) modal._onTrimmed({ start, end, originalUrl });
    if (modal?._originalUrl) URL.revokeObjectURL(modal._originalUrl);
    modal?.remove();
  },

  // ── Grabador Directo de Video (30s, vertical 9:16) ───────────────────────────
  async openVideoRecorder(onRecorded) {
    try {
      // El Muro es vertical 9:16. Con la cámara trasera ('environment') el
      // teléfono entrega 16:9 horizontal y el video se rechazaba al validarlo.
      // La frontal con el dispositivo en vertical es la que produce 9:16.
      const constraints = {
        video: { facingMode: 'user', aspectRatio: { ideal: TARGET_ASPECT_RATIO }, width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: true
      };
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (_) {
        // Navegador que no acepta aspectRatio: se reintenta sin el hint.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
      }
      this._recordStream = stream;
    } catch (_) {
      Helpers.toast('No se pudo acceder a la cámara', 'error');
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'wall-recorder';
    modal.className = 'fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/90';
    modal.innerHTML = `
      <div class="bg-black rounded-3xl w-full max-w-sm overflow-hidden relative">
        <video id="recorder-preview" autoplay muted playsinline class="w-full rounded-t-3xl" style="min-height:240px;background:#000;"></video>
        <div class="p-5 space-y-4 bg-slate-900">
          <div class="flex items-center justify-center gap-3">
            <svg class="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="16" fill="none" stroke="#374151" stroke-width="3"/>
              <circle id="record-ring" cx="18" cy="18" r="16" fill="none" stroke="#ef4444" stroke-width="3"
                stroke-dasharray="100.5" stroke-dashoffset="100.5" style="transition:stroke-dashoffset 0.5s linear"/>
            </svg>
            <span id="record-timer" class="text-white font-black text-3xl tabular-nums">2:00</span>
          </div>
          <div class="flex gap-3">
            <button onclick="WallModule._stopRecording()" class="flex-1 py-3 bg-slate-700 text-white rounded-2xl font-black text-xs" aria-label="Cancelar grabación">Cancelar</button>
            <button id="btn-start-rec" onclick="WallModule._startRecording()" class="flex-1 py-3 bg-red-500 text-white rounded-2xl font-black text-xs wall-record-btn" aria-label="Iniciar grabación">⏺ Grabar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const preview = document.getElementById('recorder-preview');
    preview.srcObject = this._recordStream;
    modal._onRecorded = onRecorded;
  },

  _recorderChunks: [],
  _recorderInstance: null,
  _recorderCountdown: null,

  _startRecording() {
    const stream = this._recordStream;
    if (!stream) return;
    this._recorderChunks = [];
    this._recorderInstance = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
    this._recorderInstance.ondataavailable = e => { if (e.data.size > 0) this._recorderChunks.push(e.data); };
    this._recorderInstance.onstop = () => {
      const blob = new Blob(this._recorderChunks, { type: 'video/webm' });
      const modal = document.getElementById('wall-recorder');
      if (modal?._onRecorded) modal._onRecorded(blob);
      modal?.remove();
      this._cleanupRecorder();
    };
    this._recorderInstance.start(1000);

    const startBtn = document.getElementById('btn-start-rec');
    if (startBtn) { startBtn.textContent = '⏹ Detener'; startBtn.onclick = () => this._stopRecording(true); startBtn.classList.add('animate-pulse'); }

    let remaining = MAX_VIDEO_DURATION;
    const ring = document.getElementById('record-ring');
    const circumference = 100.5;
    this._recorderCountdown = setInterval(() => {
      remaining -= 0.5;
      const timer = document.getElementById('record-timer');
      if (timer) { const m = Math.floor(remaining / 60); const s = Math.floor(remaining % 60); timer.textContent = `${m}:${String(s).padStart(2,'0')}`; }
      if (ring) ring.style.strokeDashoffset = circumference * (1 - (MAX_VIDEO_DURATION - remaining) / MAX_VIDEO_DURATION);
      if (remaining <= 0) this._stopRecording(true);
    }, 500);
  },

  _stopRecording(save = false) {
    clearInterval(this._recorderCountdown);
    if (save && this._recorderInstance?.state === 'recording') {
      this._recorderInstance.stop();
    } else {
      this._cleanupRecorder();
      document.getElementById('wall-recorder')?.remove();
    }
  },

  _cleanupRecorder() {
    clearInterval(this._recorderCountdown);
    if (this._recorderInstance?.state === 'recording') this._recorderInstance.stop();
    if (this._recordStream) { this._recordStream.getTracks().forEach(t => t.stop()); this._recordStream = null; }
    this._recorderInstance = null;
  },

  // ── Upload con validación y progreso ─────────────────────────────────────────
  /**
   * Valida, comprime y sube un archivo de media.
   * @param {File|Blob} file
   * @param {Function} onProgress  cb(percent)
   * @returns {Promise<{mediaUrl, mediaType, thumbnailUrl}>}
   */
  async uploadMedia(file, onProgress = null) {
    const isVideo = file.type.startsWith('video/') || (file instanceof Blob && !file.type.startsWith('image/'));
    const mimeWebP = 'image/webp';

    if (isVideo) {
      // 1) Validar tamaño
      if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) throw new Error(`El video supera los ${MAX_VIDEO_SIZE_MB}MB permitidos`);

      // 2) Validar duración y relación de aspecto 9:16 (solo para File; un Blob
      //    grabado en tiempo real ya sale de la cámara en vertical).
      if (file instanceof File) {
        const check = await validateWallVideo(file);
        if (!check.ok) {
          if (check.reason === 'duration') {
            // Abrir trimmer como alternativa
            return new Promise((resolve, reject) => {
              this.openVideoTrimmer(file, async ({ start, end, originalUrl }) => {
                try {
                  const result = await this._uploadVideoFile(file, onProgress);
                  resolve(result);
                } catch (e) { reject(e); }
              });
              reject(new Error('TRIM_REQUESTED'));
            });
          }
          throw new Error(check.message);
        }
      }

      return await this._uploadVideoFile(file, onProgress);
    } else {
      // Imagen
      if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) throw new Error(`La imagen supera los ${MAX_IMAGE_SIZE_MB}MB permitidos`);
      const compressed = await compressImageToWebP(file);
      const path = `wall/${_uuid()}.webp`;
      await uploadWithRetry('posts', path, compressed, mimeWebP, onProgress);
      const { data: urlData } = supabase.storage.from('posts').getPublicUrl(path);
      return { mediaUrl: urlData.publicUrl, mediaType: 'image', thumbnailUrl: null };
    }
  },

  async _uploadVideoFile(file, onProgress) {
    // El video va a classroom_media (bucket de medios del aula, límite 25 MB)
    // y el thumbnail a posts, igual que ImageLoader.uploadVideoWithThumbnails.
    const ext = (file.name || 'video.mp4').split('.').pop()?.toLowerCase() || 'mp4';
    const path = `wall/${_uuid()}.${ext}`;

    // 1) SUBIR EL ARCHIVO. Antes solo se generaba la URL pública sin subir nada:
    //    el post quedaba apuntando a un objeto inexistente (video 404).
    await uploadWithRetry('classroom_media', path, file, file.type || 'video/mp4', onProgress);
    const { data: urlData } = supabase.storage.from('classroom_media').getPublicUrl(path);
    const mediaUrl = urlData.publicUrl;

    // 2) Portada (best-effort: si falla, el post se publica igual sin poster)
    let thumbnailUrl = null;
    try {
      const thumb = await generateVideoThumbnail(file);
      if (thumb) {
        const thumbPath = `wall/thumbs/${_uuid()}.webp`;
        await uploadWithRetry('posts', thumbPath, thumb, 'image/webp', null);
        const { data: tUrl } = supabase.storage.from('posts').getPublicUrl(thumbPath);
        thumbnailUrl = tUrl.publicUrl;
      }
    } catch (e) {
      console.warn('[Wall] Thumbnail generation failed:', e);
    }
    return { mediaUrl, mediaType: 'video', thumbnailUrl };
  },

  /** Subida en segundo plano con notificación al terminar */
  uploadInBackground(file, postData) {
    Helpers.toast('Subida iniciada en segundo plano...', 'info');

    (async () => {
      try {
        const { mediaUrl, mediaType, thumbnailUrl } = await this.uploadMedia(file, null);
        await supabase.from('posts').update({ media_url: mediaUrl, media_type: mediaType, thumbnail_url: thumbnailUrl }).eq('id', postData.id);
        Helpers.toast('📸 Publicación multimedia lista', 'success');
        // Actualizar la UI del post
        const c = document.getElementById(this._containerId);
        if (c) { this._page = 0; this._hasMore = true; this.loadPosts(c); }
      } catch (err) {
        Helpers.toast('Error en subida de fondo: ' + err.message, 'error');
      }
    })();
  },

  // ── Cache PWA IndexedDB ───────────────────────────────────────────────────────
  async _cachePostsLocally(posts) {
    try {
      if (!('indexedDB' in window)) return;
      const req = indexedDB.open('karpus_wall', 1);
      req.onupgradeneeded = e => { e.target.result.createObjectStore('posts', { keyPath: 'id' }); };
      req.onsuccess = e => {
        const db = e.target.result;
        const tx = db.transaction('posts', 'readwrite');
        const store = tx.objectStore('posts');
        posts.forEach(p => store.put({ ...p, _cachedAt: Date.now() }));
      };
    } catch (e) {
      console.warn('[Wall] IndexedDB cache write failed:', e);
    }
  },

  async _getLocalCachedPosts() {
    return new Promise(resolve => {
      try {
        const req = indexedDB.open('karpus_wall', 1);
        req.onsuccess = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('posts')) { resolve([]); return; }
          const tx = db.transaction('posts', 'readonly');
          const all = tx.objectStore('posts').getAll();
          all.onsuccess = () => resolve(all.result || []);
          all.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      } catch (e) { console.warn('[Wall] IndexedDB read failed:', e); resolve([]); }
    });
  },

};

// Exponer globalmente.
// IMPORTANTE: solo asignar si aún no existe un wrapper más completo (p. ej. el de
// js/directora/main.js o js/maestra/main.js, que exponen submitNewPost,
// _scheduleDraftSave, etc.). Si sobreescribimos aquí, esos métodos se pierden y los
// onclick/oninput inline del muro rompen con "WallModule.xxx is not a function".
if (typeof window !== 'undefined') {
  if (!window.WallModule) {
    window.WallModule = WallModule;
  }
  window.openLightbox = (url, type, postId = null) => WallModule.openLightbox(url, type, postId);
}

// Los límites y el validador se exportan para que los tres paneles del Muro
// (directora, maestra, asistente) apliquen exactamente las mismas reglas en vez
// de repetir literales que luego divergen.
const WALL_LIMITS = Object.freeze({
  maxVideoDurationSec: MAX_VIDEO_DURATION,
  maxVideoSizeMB: MAX_VIDEO_SIZE_MB,
  maxImageSizeMB: MAX_IMAGE_SIZE_MB,
  maxAlbumPhotos: MAX_ALBUM_PHOTOS,
  aspectRatio: TARGET_ASPECT_RATIO,
  minAspectRatio: MIN_ASPECT_RATIO,
  maxAspectRatio: MAX_ASPECT_RATIO
});

export {
  WallModule,
  generateVideoThumbnail,
  generateVideoThumbnailsMulti,
  WALL_LIMITS,
  validateWallVideo,
  validateVideoDuration,
  probeVideo
};
