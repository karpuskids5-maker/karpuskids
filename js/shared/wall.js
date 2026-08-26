/**
 * 🏫 WALL MODULE v4 — Muro Escolar Karpus Kids
 * 50 mejoras: seguridad, multimedia 30s, UX, performance, moderación
 */
import { supabase } from './supabase.js';
import { Helpers } from './helpers.js';
import { ImageLoader } from './image-loader.js';
import { QueryCache } from './query-cache.js';
import { withTimeout } from './db-utils.js';

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
const MAX_VIDEO_DURATION = 30;       // segundos máximo
const MAX_VIDEO_SIZE_MB = 25;        // MB
const MAX_IMAGE_SIZE_MB = 5;         // MB
const MAX_IMAGE_WIDTH = 1920;        // px
const SIGNED_URL_EXPIRY_SEC = 3600;  // 1 hora
const MAX_PINNED_POSTS = 2;
const MAX_ALBUM_PHOTOS = 5;

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

/** Genera thumbnail (poster) de video en canvas */
const generateVideoThumbnail = (file) => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.onloadeddata = () => {
      video.currentTime = 1;
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(video.videoWidth, 640);
      canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob), 'image/webp', 0.7);
    };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    video.src = url;
  });
};

/** Valida duración de video (retorna promesa con {ok, duration}) */
const validateVideoDuration = (file) => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ ok: video.duration <= MAX_VIDEO_DURATION, duration: video.duration });
    };
    video.onerror = () => { URL.revokeObjectURL(url); resolve({ ok: false, duration: -1 }); };
    video.src = url;
  });
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
  _pendingUploads: [],       // cola de subidas en segundo plano
  _schedulerTimer: null,
  _recordStream: null,       // MediaStream de grabación

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
      .wall-video-wrapper{position:relative;cursor:pointer;border-radius:1rem;overflow:hidden;background:#0f172a}
      .wall-play-btn{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:60px;height:60px;background:rgba(255,138,0,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:22px;transition:all 0.2s;backdrop-filter:blur(4px);pointer-events:none;box-shadow:0 4px 24px rgba(255,138,0,0.4)}
      .wall-video-wrapper:hover .wall-play-btn{transform:translate(-50%,-50%) scale(1.12);background:rgba(255,138,0,1)}
      .wall-video-duration{position:absolute;bottom:8px;right:10px;background:rgba(0,0,0,0.65);color:white;font-size:9px;font-weight:900;padding:2px 7px;border-radius:8px;backdrop-filter:blur(4px)}
      .wall-custom-video{width:100%;max-height:420px;background:#000;border-radius:0}
      .wall-progress-bar{height:3px;background:linear-gradient(90deg,#f97316,#22c55e);border-radius:2px;transition:width 0.1s linear}
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
        id, content, media_url, media_type, image_url, images, title, created_at, updated_at,
        teacher_name, teacher_avatar, is_pinned, comments_enabled, expire_days,
        scheduled_at, views_count, tagged_students,
        classroom:classrooms(name),
        teacher:profiles(name, avatar_url),
        likes(user_id${this._supportsReactionType === false ? '' : ', reaction_type'}),
        comments(count)`;
      const FLAT_SELECT = `
        id, content, media_url, media_type, image_url, images, title, created_at, updated_at,
        teacher_name, teacher_avatar, is_pinned, comments_enabled, expire_days,
        views_count, tagged_students, classroom_id, teacher_id`;

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

      // Ejecuta una query; si falla 400 por likes.reaction_type inexistente,
      // desactiva la columna y reintenta una vez manteniendo los joins.
      const runWithReactionFallback = async (build) => {
        let res = await withTimeout(() => build(buildEmbedSelect()), 10_000);
        if (res?.error && this._supportsReactionType !== false && _isMissingColumnError(res.error, 'reaction_type')) {
          this._supportsReactionType = false;
          res = await withTimeout(() => build(buildEmbedSelect()), 10_000);
        }
        return res;
      };

      let posts = null;

      if (this._options.classroomId) {
        const orderOpts = { ascending: false };
        const [classResult, generalResult] = await Promise.all([
          runWithReactionFallback((sel) => fetchClassroomPosts(sel, orderOpts).range(from, to)),
          runWithReactionFallback((sel) => fetchGeneralPosts(sel, orderOpts).range(from, to))
        ]);

        if (!classResult.error && !generalResult.error) {
          posts = mergeClassroomResults(classResult.data, generalResult.data, this._pageSize);
        } else {
          const [classFlat, generalFlat] = await Promise.all([
            withTimeout(() => fetchClassroomPosts(FLAT_SELECT, orderOpts).range(from, to), 10_000),
            withTimeout(() => fetchGeneralPosts(FLAT_SELECT, orderOpts).range(from, to), 10_000)
          ]);
          if (classFlat.error && generalFlat.error) throw classFlat.error;
          const merged = mergeClassroomResults(classFlat.data, generalFlat.data, this._pageSize);
          posts = merged.map(p => ({
            ...p, is_pinned: p.is_pinned || false, comments_enabled: p.comments_enabled !== false,
            expire_days: p.expire_days || null, views_count: p.views_count || 0,
            tagged_students: p.tagged_students || [], likes: [], comments_count: 0,
            classroom: null, teacher: null, user_reaction: null, reaction_counts: {},
          }));
        }
      } else {
        const { data, error } = await runWithReactionFallback((sel) => {
          let q = supabase.from('posts').select(sel)
            .order('created_at', { ascending: false }).range(from, to);
          return buildPostFilter(q);
        });
        if (error) {
          let fallback = supabase.from('posts').select(FLAT_SELECT)
            .order('created_at', { ascending: false }).range(from, to);
          fallback = buildPostFilter(fallback);
          const retry = await withTimeout(() => fallback, 10_000);
          if (retry.error) throw retry.error;
          posts = (retry.data || []).map(p => ({
            ...p, is_pinned: p.is_pinned || false, comments_enabled: p.comments_enabled !== false,
            expire_days: p.expire_days || null, views_count: p.views_count || 0,
            tagged_students: p.tagged_students || [], likes: [], comments_count: 0,
            classroom: null, teacher: null, user_reaction: null, reaction_counts: {},
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
    this._setupVideoAutoplay();
  },

  _setupVideoAutoplay() {
    if (this._videoObserver) this._videoObserver.disconnect();
    this._videoObserver = new IntersectionObserver(entries => {
      entries.forEach(e => { if (!e.isIntersecting) e.target.pause?.(); });
    }, { threshold: 0.5 });
    document.querySelectorAll('video.wall-custom-video').forEach(v => this._videoObserver.observe(v));
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
    const posterStyle = thumbUrl ? `background-image:url('${_sanitizeHTML(thumbUrl)}');background-size:cover;background-position:center;` : 'background:#0f172a;';
    const maxH = isSlow ? 'max-h-[280px]' : 'max-h-[420px]';
    return `
      <div class="wall-video-wrapper ${maxH} relative mb-4 shadow-inner" id="video-wrapper-${p.id}"
           onclick="WallModule.playVideoCard('${p.id}','${_sanitizeHTML(p.display_media_url)}')"
           style="${posterStyle}min-height:180px;" role="button" aria-label="Reproducir video">
        ${!thumbUrl ? `<div class="wall-shimmer absolute inset-0" style="background:linear-gradient(90deg,#1e293b 25%,#334155 50%,#1e293b 75%);background-size:800px 100%;"></div>` : ''}
        <div class="wall-play-btn">▶</div>
        <div class="wall-video-duration">0:30</div>
        <div class="wall-watermark">🐾 Karpus Kids</div>
      </div>`;
  },

  _renderImageCard(p, isSlow) {
    const maxH = isSlow ? 'max-h-[280px]' : 'max-h-[480px]';
    const original = p.original_media_url || p.display_media_url;
    const optimized = optimizeImageUrl(original, { width: isSlow ? 600 : 1200, quality: isSlow ? 60 : 80 });
    return `
      <div class="rounded-2xl overflow-hidden border border-slate-100 mb-4 cursor-zoom-in bg-slate-50 relative shadow-inner"
           onclick="WallModule.openLightbox('${_sanitizeHTML(p.display_media_url)}','image')" role="button" aria-label="Ver imagen">
        <div class="wall-shimmer absolute inset-0 rounded-2xl" id="img-shimmer-${p.id}"></div>
        <img id="wall-img-${p.id}" src="${_sanitizeHTML(optimized)}" loading="lazy" decoding="async"
             data-fallback-src="${_sanitizeHTML(original)}"
             class="w-full ${maxH} object-contain relative z-10 wall-img-loaded"
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
            <div class="wall-album-slide" onclick="WallModule.openLightbox('${_sanitizeHTML(url)}','image')" role="button" aria-label="Foto ${i+1} de ${urls.length}">
              <img src="${_sanitizeHTML(url)}" loading="${i === 0 ? 'eager' : 'lazy'}" class="w-full max-h-[420px] object-cover" alt="Foto ${i+1}">
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
  playVideoCard(postId, url) {
    const wrapper = document.getElementById(`video-wrapper-${postId}`);
    if (!wrapper || !url) return;
    wrapper.onclick = null;
    wrapper.style.backgroundImage = '';
    wrapper.style.background = '#000';
    const isSlow = this._detectSlowNetwork();
    wrapper.innerHTML = `
      <video id="wall-vid-${postId}" class="wall-custom-video w-full" controls playsinline muted preload="metadata"
             style="max-height:${isSlow ? '280px' : '420px'};display:block;"
             onended="document.getElementById('wall-replay-${postId}')?.classList.remove('hidden')"
             onerror="WallModule._onVideoError('${postId}')">
        <source src="${_sanitizeHTML(url)}" type="video/mp4">
      </video>
      <button id="wall-replay-${postId}" onclick="WallModule._replayVideo('${postId}')"
        class="hidden absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 bg-orange-500/90 rounded-full text-white flex items-center justify-center text-2xl" aria-label="Repetir video">🔁</button>`;

    const vid = document.getElementById(`wall-vid-${postId}`);
    if (vid) {
      vid.play().catch(() => {});
      this._attachVideoProgress(vid, postId);
      if (this._videoObserver) this._videoObserver.observe(vid);
    }
  },

  _attachVideoProgress(vid, postId) {
    // Append progress bar
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,0.2);pointer-events:none;';
    bar.innerHTML = `<div id="wall-vprog-${postId}" class="wall-progress-bar" style="width:0%"></div>`;
    vid.parentElement?.appendChild(bar);
    vid.addEventListener('timeupdate', () => {
      if (!vid.duration) return;
      const prog = document.getElementById(`wall-vprog-${postId}`);
      if (prog) prog.style.width = `${(vid.currentTime / vid.duration) * 100}%`;
    });
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
  openLightbox(url, type) {
    if (!url) return;
    const isVideo = type === 'video' || /\.(mp4|webm|mov|m4v)$/i.test(url);
    const content = isVideo
      ? `<video controls playsinline autoplay muted class="w-full max-h-[85vh] object-contain rounded-xl" preload="metadata" style="background:#000"><source src="${_sanitizeHTML(url)}" type="video/mp4"></video>`
      : `<img src="${_sanitizeHTML(url)}" class="w-full max-h-[85vh] object-contain rounded-xl select-none" alt="Publicación" draggable="false" loading="eager">`;

    const lb = document.createElement('div');
    lb.id = 'wall-lightbox';
    lb.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
    lb.style.cssText = 'background:rgba(0,0,0,0.92);backdrop-filter:blur(12px);animation:wall-bounce-in 0.3s ease';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Visor de multimedia');
    lb.innerHTML = `
      <button onclick="document.getElementById('wall-lightbox')?.remove()" class="absolute top-4 right-4 w-10 h-10 bg-white/15 hover:bg-white/30 rounded-full flex items-center justify-center text-white z-50 transition-colors" aria-label="Cerrar">
        <i data-lucide="x" class="w-5 h-5"></i>
      </button>
      <div class="relative max-w-5xl w-full" onclick="event.stopPropagation()">${content}</div>`;
    lb.onclick = () => { lb.remove(); };
    // Liberación de memoria al cerrar
    lb.addEventListener('remove', () => {
      const vid = lb.querySelector('video');
      if (vid) { vid.pause(); vid.src = ''; }
    });
    document.body.appendChild(lb);
    if (window.lucide) lucide.createIcons();

    // Touch swipe para cerrar
    let startY = 0;
    lb.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
    lb.addEventListener('touchend', e => {
      if (Math.abs(e.changedTouches[0].clientY - startY) > 80) lb.remove();
    }, { passive: true });
  },

  openLightboxFromPost(postId) {
    const img = document.querySelector(`#post-${postId} img`);
    if (img) this.openLightbox(img.src, 'image');
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
  async sendComment(postId, parentId = null) {
    const inputId = parentId ? `reply-input-${parentId}` : `comment-input-${postId}`;
    const input = document.getElementById(inputId);
    const raw = input?.value.trim();
    if (!raw) return;

    const now = Date.now();
    if (now - this._lastPostTime < _SPAM_COOLDOWN_MS) {
      Helpers.toast('Espera un momento antes de comentar de nuevo', 'warning');
      return;
    }

    const content = _sanitizeHTML(raw);
    const user = this._appState?.get('user');
    const profile = this._appState?.get('profile');
    if (!user) return;

    let userName;
    if (profile?.role === 'padre') {
      const { data: st } = await supabase.from('students').select('name').eq('parent_id', user.id).maybeSingle();
      userName = st?.name || profile.name || 'Padre';
    } else {
      userName = profile?.name || 'Personal';
    }

    const list = parentId
      ? document.getElementById(`replies-list-${parentId}`)
      : document.getElementById(`comments-list-${postId}`);

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
    } catch (_) {
      document.getElementById(tempId)?.remove();
      input.value = raw;
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

  renderComments(postId, comments) {
    const container = document.getElementById(`comments-list-${postId}`);
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
        if (classroomId && post.classroom_id && post.classroom_id !== classroomId) return;
        const existing = document.getElementById('wall-new-posts-indicator');
        if (!existing) {
          const btn = document.createElement('div');
          btn.id = 'wall-new-posts-indicator';
          btn.className = 'fixed top-24 left-1/2 -translate-x-1/2 bg-orange-500 text-white px-6 py-2.5 rounded-full text-[10px] font-black uppercase shadow-2xl animate-bounce cursor-pointer z-50 flex items-center gap-2 border-2 border-white/20 backdrop-blur-md';
          btn.innerHTML = '⬆ Nuevas publicaciones disponibles';
          btn.onclick = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); this.applyFilters(); btn.remove(); };
          document.body.appendChild(btn);
          setTimeout(() => btn.remove(), 8000);
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

  destroy() {
    this._unsubscribeRealtime();
    if (this._schedulerTimer) { clearInterval(this._schedulerTimer); this._schedulerTimer = null; }
    if (this._recordStream) { this._recordStream.getTracks().forEach(t => t.stop()); this._recordStream = null; }
    // Limpiar lightbox si queda abierto
    document.getElementById('wall-lightbox')?.remove();
  },

  // ── Scheduler de publicaciones programadas ───────────────────────────────────
  _startSchedulerChecker() {
    if (this._schedulerTimer) return;
    this._schedulerTimer = setInterval(async () => {
      try {
        if (!navigator.onLine) return; // sin conexión: reintentar en el próximo ciclo
        const profile = this._appState?.get('profile');
        if (!['directora','maestra','asistente'].includes(profile?.role)) return;
        const now = new Date().toISOString();
        const { data: due, error: schedErr } = await supabase.from('posts')
          .select('id').not('scheduled_at', 'is', null)
          .lte('scheduled_at', now).eq('status', 'scheduled').limit(5);
        if (schedErr) {
          // Red inestable: registrar solo el primer fallo para no llenar la consola
          if (!this._schedFailLogged) {
            console.warn('[Wall] Scheduler en pausa (red):', schedErr.message);
            this._schedFailLogged = true;
          }
          return;
        }
        this._schedFailLogged = false;
        if (!due?.length) return;
        for (const p of due) {
          await supabase.from('posts').update({ status: 'published', scheduled_at: null }).eq('id', p.id);
        }
      } catch (e) {
        console.warn('[Wall] Scheduler error:', e);
      }
    }, 60_000); // cada minuto
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
            <p class="text-xs text-slate-500">El video excede 30 segundos. Elige el segmento a publicar.</p>
          </div>
        </div>
        <video id="trimmer-preview" src="${_sanitizeHTML(url)}" controls muted class="w-full rounded-2xl max-h-48 bg-black" preload="metadata"></video>
        <div class="space-y-2">
          <div class="flex justify-between text-xs font-bold text-slate-500">
            <span>Inicio: <span id="trim-start-val">0</span>s</span>
            <span>Fin: <span id="trim-end-val">30</span>s (máx 30s)</span>
          </div>
          <input type="range" id="trim-start" min="0" max="0" step="0.5" value="0" class="w-full accent-orange-500"
                 oninput="WallModule._updateTrimmer()" aria-label="Punto de inicio">
          <input type="range" id="trim-end" min="0" max="30" step="0.5" value="30" class="w-full accent-green-500"
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
      if (startInput) { startInput.max = Math.max(0, vid.duration - 30); }
      document.getElementById('trim-end-val').textContent = Math.min(30, vid.duration).toFixed(1);
    };
    modal._onTrimmed = onTrimmed;
    modal._originalUrl = url;
  },

  _updateTrimmer() {
    const start = Number.parseFloat(document.getElementById('trim-start')?.value || 0);
    const end = Number.parseFloat(document.getElementById('trim-end')?.value || 30);
    const clamped = Math.min(end, start + 30);
    document.getElementById('trim-start-val').textContent = start.toFixed(1);
    document.getElementById('trim-end-val').textContent = clamped.toFixed(1);
    const vid = document.getElementById('trimmer-preview');
    if (vid) vid.currentTime = start;
  },

  async _applyTrim(originalUrl) {
    const btn = document.getElementById('btn-apply-trim');
    if (btn) { btn.disabled = true; btn.textContent = 'Procesando...'; }
    const start = Number.parseFloat(document.getElementById('trim-start')?.value || 0);
    const end = Number.parseFloat(document.getElementById('trim-end')?.value || 30);
    const modal = document.getElementById('wall-trimmer');

    // Nota: recorte real requiere FFmpeg WASM. Aquí se usa el segmento con nota informativa.
    Helpers.toast(`Segmento ${start.toFixed(1)}s – ${end.toFixed(1)}s seleccionado. El video se subirá completo con inicio en ${start.toFixed(1)}s.`, 'info');
    if (modal?._onTrimmed) modal._onTrimmed({ start, end, originalUrl });
    if (modal?._originalUrl) URL.revokeObjectURL(modal._originalUrl);
    modal?.remove();
  },

  // ── Grabador Directo de Video 30s ────────────────────────────────────────────
  async openVideoRecorder(onRecorded) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true });
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
            <span id="record-timer" class="text-white font-black text-3xl tabular-nums">0:30</span>
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

      // 2) Validar duración (solo para File, no para Blob grabado en tiempo real)
      if (file instanceof File) {
        const { ok } = await validateVideoDuration(file);
        if (!ok) {
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
    const path = `wall/${_uuid()}.mp4`;
    // Generar thumbnail
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
    const { data: urlData } = supabase.storage.from('posts').getPublicUrl(path);
    return { mediaUrl: urlData.publicUrl, mediaType: 'video', thumbnailUrl };
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

// Exponer globalmente
if (typeof window !== 'undefined') {
  window.WallModule = WallModule;
  window.openLightbox = (url, type) => WallModule.openLightbox(url, type);
}

export { WallModule };
