/**
 * 📣 KarpusEventBanner — Banner de novedades en el Dashboard (todos los paneles)
 *
 * Sistema de información precisa: TODO evento relevante queda informado y
 * NINGUNO se pierde.
 *
 *   - Escucha Supabase Realtime (canal propio, independiente del BadgeSystem).
 *   - Cola PERSISTENTE (localStorage por usuario): si el usuario recarga o
 *     estaba en otra sección, la novedad sigue ahí esperando ser vista.
 *   - Se muestra SOLO en el inicio/dashboard del panel (#home / #t-home /
 *     #dashboard). Vive DENTRO de la sección (flujo normal del documento):
 *     abre su espacio y empuja el contenido hacia abajo — nunca tapa nada.
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

    // 3) Publicaciones del muro
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' },
      p => self._onPost(p.new));

    // 4) Tareas nuevas (padre)
    if (self._role === 'padre') {
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' },
        p => self._push({
          id: 'tasks:' + p.new.id, icon: '📝',
          title: 'Nueva tarea' + (p.new.title ? ': ' + p.new.title : ''),
          sub: p.new.due_date ? 'Entrega: ' + p.new.due_date : '',
          target: 'tasks'
        }));
    }

    // 5) Entregas de tareas (maestra)
    if (self._role === 'maestra') {
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_evidences' },
        p => self._push({
          id: 'task_evidences:' + p.new.id, icon: '📥',
          title: 'Nueva entrega de tarea',
          sub: '', target: 't-home'
        }));
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

  // ── Visibilidad (solo en el inicio del panel) ─────────────────────────────
  _activeId() {
    const el = document.querySelector('.section.active:not(.hidden)') ||
               document.querySelector('.section.active');
    return el ? el.id : '';
  },

  _startWatch() {
    if (this._watchTimer) return;
    this._watchTimer = setInterval(() => {
      const on = this._activeId() === this._homeId;
      const state = on ? 'on' : 'off';
      if (state === this._lastState) return;
      this._lastState = state;
      this._render();
    }, 500);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { this._lastState = ''; }
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
    const onHome = this._lastState === 'on' || this._activeId() === this._homeId;

    if (!onHome || !this._queue.length) {
      if (bar) bar.remove();
      clearTimeout(this._collapseTimer);
      return;
    }

    const host = document.getElementById(this._homeId);
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
