/**
 * 📣 KarpusEventBanner — Banner de novedades en el Dashboard (todos los paneles)
 *
 * Sistema de información precisa: TODO evento relevante queda informado y
 * NINGUNO se pierde.
 *
 *   - Escucha Supabase Realtime (canal propio, independiente del BadgeSystem).
 *   - Cola PERSISTENTE (localStorage por usuario): si el usuario recarga o
 *     estaba en otra sección, la novedad sigue ahí esperando ser vista.
 *   - Se muestra SIEMPRE como banner sticky en la parte superior del contenido,
 *     visible en todas las secciones del panel (no solo en el inicio).
 *   - Cada tarjeta: icono + título claro ("Ana te escribió", "Nueva tarea…",
 *     "Nuevo comprobante de pago") + hora. Clic → navega a la sección.
 *   - Tras 15 s sin interacción colapsa a una pastilla compacta con el
 *     contador (no estorba), y se re-expande al tocarla.
 *   - Si el usuario ya está viendo esa sección en vivo, no lo duplica.
 */
import { supabase } from './supabase.js';
import { RealtimeManager } from './realtime-manager.js';

const MAX_QUEUE    = 8;              // eventos guardados máximo
const MAX_VISIBLE  = 3;              // tarjetas expandidas a la vez
const STALE_MS     = 30 * 60 * 1000; // novedades de más de 30 min no reaparecen
const COLLAPSE_MS  = 15000;          // colapsar tras 15 s sin interacción

const _profiles = new Map();

function _esc(s) {
  try { if (window.Helpers && Helpers.escapeHTML) return Helpers.escapeHTML(s); } catch (_) {}
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function _ago(ts) {
  const d = Math.max(0, Date.now() - ts);
  if (d < 60000) return 'ahora';
  if (d < 3600000) return Math.floor(d / 60000) + ' min';
  return Math.floor(d / 3600000) + ' h';
}

async function _profile(id) {
  if (!id) return null;
  if (_profiles.has(id)) return _profiles.get(id);
  try {
    const { data } = await supabase.from('profiles').select('name, avatar_url').eq('id', id).maybeSingle();
    if (data) _profiles.set(id, data);
    return data || null;
  } catch (_) { return null; }
}

export const EventBanner = {
  _uid: null,
  _role: null,
  _homeId: null,
  _queue: [],
  _expanded: true,
  _showAll: false,
  _collapseTimer: null,
  _watchTimer: null,
  _lastState: '',

  // Alcance para filtrar eventos por aula (evita falsos avisos cruzados):
  //   padre   → Set con las aulas de SUS hijos (null = sin datos, no filtra)
  //   maestra → Set con los student_id de SU(S) aula(s)
  _scopeReady: null,
  _classroomIds: null,
  _studentIds: null,

  // ── Ciclo de vida ─────────────────────────────────────────────────────────
  init(userId) {
    if (!userId || this._uid) return;
    this._uid = userId;
    this._role = this._detectRole();
    this._homeId =
      document.getElementById('home')   ? 'home'   :
      document.getElementById('t-home') ? 't-home' : 'dashboard';
    this._loadQueue();
    this._subscribe();
    this._startWatch();
    this._loadScope();
  },

  /** Resuelve el alcance por aula del usuario (fire & forget, una sola vez) */
  _loadScope() {
    if (this._scopeReady) return;
    const self = this;
    this._scopeReady = (async () => {
      try {
        if (self._role === 'padre') {
          const { data } = await supabase.from('students')
            .select('classroom_id').eq('parent_id', self._uid);
          self._classroomIds = new Set((data || []).map(s => s.classroom_id).filter(Boolean));
        } else if (self._role === 'maestra') {
          const { data: rooms } = await supabase.from('classrooms')
            .select('id').eq('teacher_id', self._uid);
          const roomIds = (rooms || []).map(r => r.id);
          if (roomIds.length) {
            const { data } = await supabase.from('students')
              .select('id').in('classroom_id', roomIds);
            self._studentIds = new Set((data || []).map(s => s.id));
          } else {
            self._studentIds = new Set();
          }
        }
      } catch (_) { /* sin alcance: los handlers caen al modo "sin filtro" */ }
    })();
  },

  /** true si el evento aplica al alcance del usuario (null = no se pudo saber → sí) */
  _inScope(kind, id) {
    if (kind === 'classroom') {
      if (this._classroomIds === null) return true;
      return id == null ? true : this._classroomIds.has(id); // posts generales pasan
    }
    if (kind === 'student') {
      if (this._studentIds === null) return true;
      return this._studentIds.has(id);
    }
    return true;
  },

  _detectRole() {
    if (document.getElementById('badge-class'))  return 'padre';
    if (document.getElementById('badge-t-chat')) return 'maestra';
    if (document.getElementById('badge-muro'))   return 'asistente';
    if (document.getElementById('badge-pagos'))  return 'directora';
    return 'unknown';
  },

  // ── Persistencia ──────────────────────────────────────────────────────────
  _key() { return 'karpus_eb_queue_' + this._uid; },

  _loadQueue() {
    try {
      const raw = localStorage.getItem(this._key());
      const arr = raw ? JSON.parse(raw) : [];
      const now = Date.now();
      this._queue = arr.filter(e => e && e.id && now - (e.ts || 0) < STALE_MS);
    } catch (_) { this._queue = []; }
  },

  _saveQueue() {
    try { localStorage.setItem(this._key(), JSON.stringify(this._queue.slice(0, MAX_QUEUE))); }
    catch (_) {}
  },

  // ── Realtime ──────────────────────────────────────────────────────────────
  _subscribe() {
    const self = this;
    RealtimeManager.subscribe('eventbanner_' + this._uid, channel => {
      self._wire(channel);
    });
  },

  _wire(ch) {
    const self = this;

    // 1) Notificaciones dirigidas al usuario
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + self._uid },
      p => self._onNotification(p.new));

    // 2) Mensajes nuevos (de otro usuario)
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
      p => self._onMessage(p.new));

    // 3) Publicaciones del muro (padre: solo su aula o generales)
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' },
      p => {
        self._loadScope();
        self._scopeReady.then(() => {
          if (self._role === 'padre' && !self._inScope('classroom', p.new.classroom_id)) return;
          self._onPost(p.new);
        });
      });

    // 4) Tareas nuevas (padre, filtradas por las aulas de sus hijos)
    if (self._role === 'padre') {
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' },
        p => {
          self._loadScope();
          self._scopeReady.then(() => {
            if (!self._inScope('classroom', p.new.classroom_id)) return;
            self._push({
              id: 'tasks:' + p.new.id, icon: '📝',
              title: 'Nueva tarea' + (p.new.title ? ': ' + p.new.title : ''),
              sub: p.new.due_date ? 'Entrega: ' + p.new.due_date : '',
              target: 'tasks'
            });
          });
        });
    }

    // 5) Entregas de tareas (maestra, solo estudiantes de su aula)
    if (self._role === 'maestra') {
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_evidences' },
        p => {
          self._loadScope();
          self._scopeReady.then(() => {
            if (!self._inScope('student', p.new.student_id)) return;
            self._push({
              id: 'task_evidences:' + p.new.id, icon: '📥',
              title: 'Nueva entrega de tarea',
              sub: '', target: 't-home'
            });
          });
        });
    }

    // 6) Pagos: comprobante nuevo (personal) / confirmado (padre)
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payments' }, p => {
      const ns = ((p.new && p.new.status) || '').toLowerCase();
      const os = ((p.old && p.old.status) || '').toLowerCase();
      if (!ns || ns === os) return;
      const isStaff = self._role === 'directora' || self._role === 'asistente';
      if (isStaff && (ns === 'review' || ns === 'revision' || (ns === 'pending' && p.new.evidence_url))) {
        self._push({ id: 'payments:' + p.new.id + ':' + ns, icon: '💳',
          title: 'Nuevo comprobante de pago', sub: 'Pendiente de revisión', target: 'pagos' });
      }
      if (self._role === 'padre' && ['paid', 'pagado', 'approved'].includes(ns)) {
        self._push({ id: 'payments:' + p.new.id + ':' + ns, icon: '✅',
          title: 'Pago confirmado', sub: 'Tu pago fue aprobado', target: 'payments' });
      }
    });

    // 7) Consultas (directora)
    if (self._role === 'directora') {
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inquiries' },
        p => self._push({
          id: 'inquiries:' + p.new.id, icon: '🆕',
          title: 'Nueva consulta recibida',
          sub: p.new.subject || '', target: 'reportes'
        }));
    }

    // 8) Solicitudes de permiso (dirección / asistente)
    if (self._role === 'directora' || self._role === 'asistente') {
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'staff_permits' },
        p => self._push({
          id: 'staff_permits:' + p.new.id, icon: '🏖️',
          title: 'Nueva solicitud de permiso',
          sub: '', target: 'staff-permits'
        }));
    }

    // 9) Comentarios y reacciones en publicaciones propias (wall.js → autor)
    ch.on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'wall_notifications',
      filter: 'user_id=eq.' + self._uid
    }, p => self._onWallNotification(p.new));
  },

  async _onWallNotification(n) {
    if (!n) return;
    const isComment = n.type === 'comment';
    this._push({
      id: 'wall_notifications:' + n.id,
      icon: isComment ? '💬' : '❤️',
      title: (n.actor_name || 'Alguien') +
             (isComment ? ' comentó en tu publicación' : ' reaccionó a tu publicación'),
      sub: isComment ? String(n.message || '').replace(/^.*?comentó:\s*/i, '').slice(0, 80) : '',
      target: this._role === 'padre' ? 'class' : 'muro',
    });
  },

  async _onNotification(n) {
    if (!n) return;
    const t = n.type;
    const map = {
      task:       { i: '📝', s: this._role === 'maestra' ? 't-home' : 'tasks',      t: 'Nueva tarea asignada' },
      post:       { i: '🖼️', s: this._role === 'padre' ? 'class' : 'muro',           t: 'Nueva publicación' },
      muro:       { i: '🖼️', s: this._role === 'padre' ? 'class' : 'muro',           t: 'Nueva publicación' },
      comment:    { i: '💬', s: this._role === 'padre' ? 'class' : 'muro',           t: 'Nuevo comentario' },
      like:       { i: '❤️', s: this._role === 'padre' ? 'class' : 'muro',           t: 'Nueva reacción' },
      payment:    { i: '💳', s: 'payments',                                          t: 'Actualización de pago' },
      grade:      { i: '⭐', s: this._role === 'maestra' ? 't-grades' : 'grades',    t: 'Nueva calificación' },
      attendance: { i: '🎒', s: 'live-attendance',                                   t: 'Asistencia registrada' },
      chat:       { i: '💬', s: this._chatTarget(),                                  t: 'Nuevo mensaje' },
      message:    { i: '💬', s: this._chatTarget(),                                  t: 'Nuevo mensaje' },
      receipt:    { i: '💳', s: 'pagos',                                             t: 'Nuevo comprobante' },
      inquiry:    { i: '🆕', s: 'reportes',                                          t: 'Nueva consulta' },
      // Tipos producidos por el sistema que antes se descartaban:
      alert:           { i: '💳', s: 'payments',   t: 'Actualización de pagos' },      // ← trigger notify_parent_on_new_charge
      report_received: { i: '📋', s: 'reportes',   t: 'Nuevo reporte' },               // ← directora/reports.module.js
    };
    const meta = map[t];
    if (!meta) return;
    this._push({
      id: 'notifications:' + n.id, icon: meta.i,
      title: n.title || meta.t, sub: n.body || '', target: meta.s,
    });
  },

  async _onMessage(m) {
    if (!m || m.sender_id === this._uid) return;
    const activeConv = window.AppState && AppState.get('activeConversationId');
    if (activeConv && m.conversation_id === activeConv) return;
    const prof = await _profile(m.sender_id);
    const name = (prof && prof.name) || '';
    this._push({
      id: 'messages:' + m.id, icon: '💬',
      title: name ? name + ' te escribió' : 'Tienes un mensaje nuevo',
      sub: String(m.content || '').slice(0, 80),
      target: this._chatTarget(),
    });
  },

  _onPost(p) {
    if (!p) return;
    if (p.teacher_id === this._uid || p.author_id === this._uid || p.user_id === this._uid) return;
    this._push({
      id: 'posts:' + p.id, icon: '🖼️',
      title: 'Nueva publicación en el muro',
      sub: String(p.content || p.title || '').slice(0, 80),
      target: this._role === 'padre' ? 'class' : 'muro',
    });
  },

  _chatTarget() {
    if (this._role === 'maestra') return 't-chat';
    if (document.getElementById('comunicacion')) return 'comunicacion';
    if (document.getElementById('chat')) return 'chat';
    return 'notifications';
  },

  // ── Cola ──────────────────────────────────────────────────────────────────
  _push(item) {
    if (!item || !item.target) return;
    // Si el usuario ya está viendo esa sección en vivo, no hace falta avisar
    if (this._activeId() === item.target) return;
    if (this._queue.some(q => q.id === item.id)) {
      // Ya estaba: mover arriba y refrescar hora
      this._queue = [this._queue.find(q => q.id === item.id), ...this._queue.filter(q => q.id !== item.id)];
      this._saveQueue(); this._render(); return;
    }
    item.ts = Date.now();
    this._queue.unshift(item);
    this._queue = this._queue.slice(0, MAX_QUEUE);
    this._saveQueue();
    this._expanded = true;
    this._resetCollapse();
    this._render();
  },

  _remove(id) {
    this._queue = this._queue.filter(q => q.id !== id);
    this._saveQueue();
    if (!this._queue.length) { this._expanded = true; this._showAll = false; }
    this._render();
  },

  _clearAll() {
    this._queue = [];
    this._showAll = false;
    this._saveQueue();
    this._render();
  },

  // ── Visibilidad (banner siempre visible en todas las secciones) ───────────
  _activeId() {
    const el = document.querySelector('.section.active:not(.hidden)') ||
               document.querySelector('.section.active');
    return el ? el.id : '';
  },

  _startWatch() {
    if (this._watchTimer) return;
    this._watchTimer = setInterval(() => {
      if (!this._queue.length) return;
      this._render();
    }, 2000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { this._render(); }
    });
  },

  // ── Render ────────────────────────────────────────────────────────────────
  _injectStyles() {
    if (document.getElementById('kk-event-banner-css')) return;
    const link = document.createElement('link');
    link.id = 'kk-event-banner-css';
    link.rel = 'stylesheet';
    link.href = 'css/event-banner.css';
    document.head.appendChild(link);
  },

  _resetCollapse() {
    clearTimeout(this._collapseTimer);
    this._collapseTimer = setTimeout(() => {
      this._expanded = false;
      this._render();
    }, COLLAPSE_MS);
  },

  _render() {
    this._injectStyles();
    const bar = document.getElementById('kk-event-banner');

    if (!this._queue.length) {
      if (bar) bar.remove();
      clearTimeout(this._collapseTimer);
      return;
    }

    // Insertar en #layoutShell como primer hijo (sticky, visible en todas las secciones)
    const host = document.getElementById('layoutShell') ||
                 document.getElementById(this._homeId);
    if (!host) return;
    let el = bar;
    if (!el) {
      el = document.createElement('div');
      el.id = 'kk-event-banner';
      host.insertBefore(el, host.firstChild);
    }

    if (!this._expanded) {
      const n = this._queue.length;
      el.innerHTML =
        '<button type="button" id="eb-pill" class="eb-pill">' +
          '<span class="eb-pill-icon">🔔</span>' +
          '<span class="eb-pill-txt">Tienes ' + n + ' novedade' + (n === 1 ? 's' : '') + ' sin ver</span>' +
          '<span class="eb-pill-dot">' + (n > 9 ? '9+' : n) + '</span>' +
        '</button>';
      el.querySelector('#eb-pill').addEventListener('click', () => {
        this._expanded = true;
        this._resetCollapse();
        this._render();
      });
      return;
    }

    const items = this._showAll ? this._queue : this._queue.slice(0, MAX_VISIBLE);
    const extra = this._queue.length - items.length;
    el.innerHTML = items.map(it =>
      '<div class="eb-card" role="button" tabindex="0" data-eb-id="' + _esc(it.id) + '" data-eb-target="' + _esc(it.target) + '">' +
        '<span class="eb-icon">' + (it.icon || '🔔') + '</span>' +
        '<span class="eb-txt">' +
          '<span class="eb-title">' + _esc(it.title) + '</span>' +
          (it.sub ? '<span class="eb-sub">' + _esc(it.sub) + '</span>' : '') +
        '</span>' +
        '<span class="eb-meta"><span class="eb-time">' + _ago(it.ts) + '</span>' +
        '<button type="button" class="eb-x" aria-label="Descartar" data-eb-close="' + _esc(it.id) + '">✕</button></span>' +
      '</div>'
    ).join('') +
    (extra > 0 ? '<button type="button" id="eb-more" class="eb-more">+' + extra + ' novedad' + (extra === 1 ? '' : 'es') + ' más</button>' : '') +
    '<button type="button" id="eb-clear" class="eb-clear">Marcar todo como visto</button>';

    // Clic en tarjeta → navegar y descartar
    el.querySelectorAll('.eb-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.eb-x')) return;
        const id = card.dataset.ebId;
        this._navigate(card.dataset.ebTarget);
        this._remove(id);
      });
    });
    el.querySelectorAll('[data-eb-close]').forEach(btn => {
      btn.addEventListener('click', () => this._remove(btn.dataset.ebClose));
    });
    el.querySelector('#eb-more')?.addEventListener('click', () => {
      this._showAll = true;
      this._resetCollapse();
      this._render();
    });
    el.querySelector('#eb-clear')?.addEventListener('click', () => this._clearAll());

    this._resetCollapse();
  },

  _navigate(target) {
    if (!target) return;
    try {
      if (window.App && typeof App.navigateTo === 'function') { App.navigateTo(target); return; }
    } catch (_) {}
    const btn = document.querySelector(
      '[data-target="' + target + '"],[data-section="' + target + '"],.node-' + target);
    if (btn) btn.click();
  }
};

export default EventBanner;
