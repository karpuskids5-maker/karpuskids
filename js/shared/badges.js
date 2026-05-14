/**
 * 🔴 Karpus Kids — Badge System
 * Muestra indicadores numéricos en botones de navegación cuando hay contenido nuevo.
 * Al entrar a la sección, el badge desaparece y se marca como leído en DB.
 */

const STORAGE_PREFIX = 'karpus_badge_';

export const BadgeSystem = {
  _userId: null,
  _channel: null,

  async init(userId) {
    if (!userId) return;
    this._userId = userId;
    await this._loadCounts();
    this._subscribeRealtime();
  },

  async _loadCounts() {
    try {
      const { supabase } = await import('./supabase.js');

      // Solo mostrar badges en secciones relevantes — no en maestros/estudiantes/aulas/dashboard
      const BADGE_SECTIONS = ['pagos', 'chat', 'comunicacion', 'muro', 'reportes', 'asistencia', 't-chat', 'notifications'];

      // 1. Notificaciones no leídas → badges por sección
      const { data: notifs } = await supabase
        .from('notifications')
        .select('type')
        .eq('user_id', this._userId)
        .eq('is_read', false)
        .limit(200);

      if (notifs?.length) {
        const counts = {};
        for (const n of notifs) {
          const section = this._typeToSection(n.type);
          if (section && BADGE_SECTIONS.includes(section)) {
            counts[section] = (counts[section] || 0) + 1;
          }
        }
        for (const [section, count] of Object.entries(counts)) {
          this._renderBadge(section, count);
        }
        window.dispatchEvent(new CustomEvent('karpus:badges-updated', { detail: counts }));
      }

      // 2. Mensajes no leídos → badge en chat/comunicacion
      const { data: unreadData } = await supabase.rpc('get_unread_counts');
      if (unreadData) {
        const totalUnread = Object.values(unreadData).reduce((a, b) => a + Number(b), 0);
        if (totalUnread > 0) {
          this._renderBadge('comunicacion', totalUnread);
          this._renderBadge('chat', totalUnread);
        }
      }

    } catch (e) {
      
    }
  },

  _subscribeRealtime() {
    if (!this._userId) return;
    import('./supabase.js').then(() => {
      import('./realtime-manager.js').then(({ RealtimeManager }) => {
        RealtimeManager.subscribe('badges_' + this._userId, (channel) => {
          // Nuevas notificaciones
          channel.on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${this._userId}`
          }, (payload) => {
            const section = this._typeToSection(payload.new?.type);
            if (!section) return;
            const current = document.querySelector('.section.active')?.id;
            if (current === section) { this._markReadInDB(section); return; }
            const badge = document.getElementById('badge-' + section);
            this._applyGlow(section);
            const prev = parseInt(badge?.textContent) || 0;
            this._renderBadge(section, prev + 1);
          });

          // Nuevos mensajes → badge en chat (filtrado por receiver para evitar error de canal)
          channel.on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `sender_id=neq.${this._userId}`
          }, () => {
            if (payload.new?.sender_id === this._userId) return;
            const current = document.querySelector('.section.active')?.id;
            if (current === 'chat' || current === 'comunicacion') return;
            ['chat', 'comunicacion'].forEach(s => {
              const badge = document.getElementById('badge-' + s);
              this._applyGlow('notifications'); // Para el dashboard del padre
              this._applyGlow('chat'); // Para el staff
              if (!badge) return;
              const prev = parseInt(badge.textContent) || 0;
              this._renderBadge(s, prev + 1);
            });
          });

          // Nuevos posts/comunicados → badge en muro o class
          channel.on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'posts'
          }, (payload) => {
            if (payload.new?.teacher_id === this._userId) return;
            // Determinar sección según el panel (muro para staff, class para padre)
            const section = document.getElementById('badge-class') ? 'class' : 'muro';
            const current = document.querySelector('.section.active')?.id;
            if (current === section) return;
            
            const badge = document.getElementById('badge-' + section);
            const prev = parseInt(badge?.textContent) || 0;
            this._renderBadge(section, prev + 1);
            this._applyGlow(section);
          });

          // Nuevas misiones/tareas (Panel Padre)
          channel.on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'tasks'
          }, (payload) => {
            const current = document.querySelector('.section.active')?.id;
            if (current === 'tasks') return;
            const badge = document.getElementById('badge-tasks');
            if (!badge) return;
            const prev = parseInt(badge.textContent) || 0;
            this._renderBadge('tasks', prev + 1);
            this._applyGlow('tasks');
          });

          // Nuevas entregas de estudiantes (Panel Maestra)
          channel.on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'task_evidences'
          }, (payload) => {
            const current = document.querySelector('.section.active')?.id;
            if (current === 't-home') return;
            const badge = document.getElementById('badge-t-home');
            if (!badge) return;
            const prev = parseInt(badge.textContent) || 0;
            this._renderBadge('t-home', prev + 1);
            this._applyGlow('t-home');
          });
        });
      });
    });
  },

  _applyGlow(section) {
    // Busca el botón del sidebar o la tarjeta del dashboard que coincida con la sección
    const selector = `[data-target="${section}"], [data-section="${section}"], .node-${section}`;
    const targets = document.querySelectorAll(selector);
    targets.forEach(el => {
      el.classList.add('animate-glow');
      setTimeout(() => el.classList.remove('animate-glow'), 6000);
    });
    // Glow en tarjeta del dashboard + sonido
    this._glowCard(section, 'orange');
    this._playSound('orange');
  },

  mark(section) {
    this._renderBadge(section, 0);
    this._markReadInDB(section);
    // Limpiar también el alias (chat ↔ comunicacion)
    if (section === 'chat') this._renderBadge('comunicacion', 0);
    if (section === 'comunicacion') this._renderBadge('chat', 0);
  },

  set(section, count) {
    this._renderBadge(section, count);
  },

  _renderBadge(section, count) {
    const badge = document.getElementById('badge-' + section);
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.remove('hidden');
      badge.classList.add('flex');
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('flex');
    }
  },

  async _markReadInDB(section) {
    if (!this._userId) return;
    try {
      const { supabase } = await import('./supabase.js');
      const types = this._sectionToTypes(section);
      if (!types.length) return;
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', this._userId)
        .in('type', types)
        .eq('is_read', false);
    } catch (e) {
      
    }
  },

  _typeToSection(type) {
    const map = {
      // Padre
      task:              'tasks',
      post:              'class',
      muro:              'class',
      comment:           'class',
      like:              'class',
      attendance:        'live-attendance',
      payment:           'payments',
      grade:             'grades',
      chat:              'notifications',
      // Maestra
      submission:        't-home',
      'task-submission': 't-home',
      'post-feedback':   't-home',
      // Directora / Asistente
      inquiry:           'reportes',
      receipt:           'pagos',
      'new-student':     'estudiantes',
      'new-teacher':     'maestros',
      alert:             'pagos',
      info:              'dashboard',
    };
    return map[type] || null;
  },

  _sectionToTypes(section) {
    const map = {
      tasks:             ['task', 'submission'],
      class:             ['post', 'muro'],
      'live-attendance': ['attendance'],
      payments:          ['payment', 'receipt', 'alert'],
      grades:            ['grade'],
      notifications:     ['chat'],
      't-home':          ['submission', 'task-submission'],
      't-chat':          ['chat'],
      't-grades':        ['grade'],
      reportes:          ['inquiry'],
      pagos:             ['receipt', 'payment', 'alert'],
      estudiantes:       ['new-student'],
      maestros:          ['new-teacher'],
      muro:              ['post', 'muro'],
      chat:              ['chat'],
      comunicacion:      ['chat'],
    };
    return map[section] || [];
  },

  // ── Glow en tarjeta del dashboard ─────────────────────────────────────────
  _glowCard(target, color = 'orange') {
    const card = document.querySelector(`[data-target="${target}"]`);
    if (!card) return;
    const cls = `card-glow-${color}`;
    card.classList.remove('card-glow-orange','card-glow-blue','card-glow-green','card-glow-red');
    void card.offsetWidth;
    card.classList.add(cls);
    setTimeout(() => card.classList.remove(cls), 2000);
  },

  // ── Dot badge en tarjeta del dashboard ────────────────────────────────────
  _setDotBadge(badgeId, show, color = 'red') {
    const el = document.getElementById(badgeId);
    if (!el) return;
    if (show) {
      el.textContent = '●';
      el.classList.remove('hidden');
      el.classList.add('flex');
      el.style.cssText = `background:${
        color === 'green' ? '#22c55e' :
        color === 'blue'  ? '#3b82f6' :
        color === 'orange'? '#f97316' : '#ef4444'
      };font-size:8px;min-width:10px;height:10px;`;
      // Glow en la tarjeta padre
      const card = el.closest('[data-target]');
      if (card) this._glowCard(card.dataset.target, color);
      // Sonido
      this._playSound(color);
    } else {
      el.classList.add('hidden');
      el.classList.remove('flex');
    }
  },

  _clearDotBadge(badgeId) { this._setDotBadge(badgeId, false); },

  // ── Sonido de notificación (Web Audio API) ─────────────────────────────────
  _audioCtx: null,
  _playSound(priority = 'orange') {
    if (document.hidden) return;
    try {
      if (!this._audioCtx) {
        this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = this._audioCtx;
      if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return; }

      // Configuración por prioridad: red=urgente, orange=medio, blue=info, green=éxito
      const cfg = {
        red:    [{ f: 880, t: 0 }, { f: 1100, t: 0.13 }],
        orange: [{ f: 660, t: 0 }, { f: 880,  t: 0.12 }],
        blue:   [{ f: 523, t: 0 }],
        green:  [{ f: 440, t: 0 }, { f: 554,  t: 0.10 }],
      }[priority] || [{ f: 660, t: 0 }];

      const vol = priority === 'red' ? 0.10 : 0.06;
      cfg.forEach(({ f, t }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(vol, ctx.currentTime + t);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.14);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + 0.15);
      });
    } catch (_) {}
  },

  // ── Mini-toast discreto ────────────────────────────────────────────────────
  _showMiniToast(msg) {
    if (document.hidden) return;
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(20px);background:rgba(15,23,42,0.92);color:white;padding:8px 16px;border-radius:20px;font-size:12px;font-weight:700;z-index:9990;pointer-events:none;backdrop-filter:blur(8px);box-shadow:0 4px 16px rgba(0,0,0,0.3);transition:all 0.3s ease;opacity:0;white-space:nowrap;';
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity='1'; toast.style.transform='translateX(-50%) translateY(0)'; });
    setTimeout(() => { toast.style.opacity='0'; toast.style.transform='translateX(-50%) translateY(10px)'; setTimeout(() => toast.remove(), 300); }, 3000);
  }
};
