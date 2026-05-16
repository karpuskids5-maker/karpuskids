/**
 * Karpus Kids - Badge System v2
 * Indicadores visuales en tiempo real para todos los paneles.
 */

export const BadgeSystem = {
  _userId: null,
  _role: null,

  async init(userId) {
    if (!userId) return;
    this._userId = userId;
    this._role = this._detectRole();
    await this._loadCounts();
    this._subscribeRealtime();
  },

  _detectRole() {
    if (document.getElementById('badge-class'))  return 'padre';
    if (document.getElementById('badge-t-chat')) return 'maestra';
    if (document.getElementById('badge-pagos'))  return 'directora';
    return 'unknown';
  },

  async _loadCounts() {
    try {
      const { supabase } = await import('./supabase.js');
      const { data: notifs } = await supabase
        .from('notifications')
        .select('type')
        .eq('user_id', this._userId)
        .eq('is_read', false)
        .limit(200);

      if (notifs && notifs.length) {
        const counts = {};
        for (const n of notifs) {
          const section = this._typeToSection(n.type);
          if (section) counts[section] = (counts[section] || 0) + 1;
        }
        for (const [section, count] of Object.entries(counts)) {
          this._renderBadge(section, count);
          this._renderCardBadge(section, count);
        }
      }

      try {
        const { data: unreadData } = await supabase.rpc('get_unread_counts');
        if (unreadData) {
          const total = Object.values(unreadData).reduce((a, b) => a + Number(b), 0);
          if (total > 0) {
            this._renderBadge('notifications', total);
            this._renderCardBadge('notifications', total);
            this._renderBadge('chat', total);
            this._renderBadge('comunicacion', total);
          }
        }
      } catch (_) {}
    } catch (_) {}
  },

  _subscribeRealtime() {
    if (!this._userId) return;
    const uid = this._userId;
    import('./supabase.js').then(({ supabase }) => {
      import('./realtime-manager.js').then(({ RealtimeManager }) => {
        RealtimeManager.subscribe('badges_' + uid, (channel) => {
          this._setupChannelListeners(channel);
        });
      }).catch(() => {
        import('./supabase.js').then(({ supabase: sb }) => {
          const channel = sb.channel('badges_direct_' + uid);
          this._setupChannelListeners(channel);
          channel.subscribe();
        });
      });
    });
  },

  _setupChannelListeners(channel) {
    const self = this;

    channel.on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'notifications',
      filter: 'user_id=eq.' + self._userId
    }, function(payload) {
      const section = self._typeToSection(payload.new && payload.new.type);
      if (!section) return;
      if (self._getActiveSection() === section) { self._markReadInDB(section); return; }
      const prev = self._getBadgeCount(section);
      self._renderBadge(section, prev + 1);
      self._renderCardBadge(section, prev + 1);
      self._applyGlow(section);
      self._showMiniToast(self._toastMsg(payload.new && payload.new.type));
    });

    channel.on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages'
    }, function(payload) {
      if (payload.new && payload.new.sender_id === self._userId) return;
      const active = self._getActiveSection();
      if (active === 'notifications' || active === 'chat' || active === 'comunicacion') return;
      const prev = self._getBadgeCount('notifications');
      self._renderBadge('notifications', prev + 1);
      self._renderCardBadge('notifications', prev + 1);
      self._renderBadge('chat', prev + 1);
      self._renderBadge('comunicacion', prev + 1);
      self._applyGlow('notifications');
      self._applyGlow('chat');
      self._showMiniToast('Nuevo mensaje');
    });

    channel.on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'posts'
    }, function(payload) {
      if (payload.new && payload.new.teacher_id === self._userId) return;
      const section = document.getElementById('badge-class') ? 'class' : 'muro';
      if (self._getActiveSection() === section) return;
      const prev = self._getBadgeCount(section);
      self._renderBadge(section, prev + 1);
      self._renderCardBadge(section, prev + 1);
      self._applyGlow(section);
      self._showMiniToast('Nueva publicacion en el muro');
    });

    channel.on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'tasks'
    }, function() {
      if (self._getActiveSection() === 'tasks') return;
      const prev = self._getBadgeCount('tasks');
      self._renderBadge('tasks', prev + 1);
      self._renderCardBadge('tasks', prev + 1);
      self._applyGlow('tasks');
      self._showMiniToast('Nueva tarea asignada');
    });

    channel.on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'task_evidences'
    }, function() {
      if (self._getActiveSection() === 't-home') return;
      const prev = self._getBadgeCount('t-home');
      self._renderBadge('t-home', prev + 1);
      self._applyGlow('t-home');
    });

    channel.on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'payments'
    }, function(payload) {
      const ns = ((payload.new && payload.new.status) || '').toLowerCase();
      const os = ((payload.old && payload.old.status) || '').toLowerCase();
      if (ns === os) return;
      if (ns === 'paid' || ns === 'pagado' || ns === 'approved') {
        if (self._getActiveSection() === 'payments') return;
        self._applyGlow('payments');
        self._showMiniToast('Pago confirmado');
      }
    });
  },

  _getActiveSection() {
    const el = document.querySelector('.section.active');
    return el ? el.id : '';
  },

  _getBadgeCount(section) {
    const el = document.getElementById('badge-' + section);
    return el ? (parseInt(el.textContent) || 0) : 0;
  },

  _toastMsg(type) {
    const msgs = {
      task: 'Nueva tarea asignada', post: 'Nueva publicacion',
      muro: 'Nueva publicacion', chat: 'Nuevo mensaje',
      message: 'Nuevo mensaje', attendance: 'Asistencia registrada',
      payment: 'Actualizacion de pago', grade: 'Nueva calificacion',
    };
    return msgs[type] || 'Nueva notificacion';
  },

  mark(section) {
    this._renderBadge(section, 0);
    this._renderCardBadge(section, 0);
    this._markReadInDB(section);
    if (section === 'chat' || section === 'notifications') {
      this._renderBadge('chat', 0);
      this._renderBadge('comunicacion', 0);
      this._renderBadge('notifications', 0);
      this._renderCardBadge('notifications', 0);
    }
  },

  set(section, count) {
    this._renderBadge(section, count);
    this._renderCardBadge(section, count);
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

  _renderCardBadge(section, count) {
    const badge = document.getElementById('badge-card-' + section);
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
      await supabase.from('notifications').update({ is_read: true })
        .eq('user_id', this._userId).in('type', types).eq('is_read', false);
    } catch (_) {}
  },

  _typeToSection(type) {
    const map = {
      task: 'tasks', post: 'class', muro: 'class', comment: 'class', like: 'class',
      attendance: 'live-attendance', payment: 'payments', grade: 'grades',
      chat: 'notifications', message: 'notifications',
      submission: 't-home', 'task-submission': 't-home', 'post-feedback': 't-home',
      inquiry: 'reportes', receipt: 'pagos', 'new-student': 'estudiantes',
      'new-teacher': 'maestros', alert: 'pagos', info: 'dashboard',
    };
    return map[type] || null;
  },

  _sectionToTypes(section) {
    const map = {
      tasks: ['task'],
      class: ['post', 'muro', 'comment', 'like'],
      'live-attendance': ['attendance'],
      payments: ['payment', 'receipt', 'alert'],
      grades: ['grade'],
      notifications: ['chat', 'message'],
      't-home': ['submission', 'task-submission'],
      't-chat': ['chat', 'message'],
      reportes: ['inquiry'],
      pagos: ['receipt', 'payment', 'alert'],
      muro: ['post', 'muro'],
      chat: ['chat', 'message'],
      comunicacion: ['chat', 'message'],
    };
    return map[section] || [];
  },

  _applyGlow(section) {
    const btn = document.querySelector('[data-target="' + section + '"], .node-' + section);
    if (btn) {
      btn.classList.add('animate-glow');
      setTimeout(function() { btn.classList.remove('animate-glow'); }, 4000);
    }
    const card = document.querySelector('[data-target="' + section + '"]');
    if (card) {
      card.classList.remove('card-glow-orange', 'card-glow-blue', 'card-glow-green', 'card-glow-red');
      void card.offsetWidth;
      card.classList.add('card-glow-orange');
      setTimeout(function() { card.classList.remove('card-glow-orange'); }, 2000);
    }
    this._playSound('orange');
  },

  _audioCtx: null,
  _playSound(priority) {
    if (priority === undefined) priority = 'orange';
    if (document.hidden) return;
    try {
      if (!this._audioCtx) {
        this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = this._audioCtx;
      if (ctx.state === 'suspended') { ctx.resume().catch(function() {}); return; }
      const cfgMap = {
        red:    [{f:880,t:0},{f:1100,t:0.13}],
        orange: [{f:660,t:0},{f:880,t:0.12}],
        blue:   [{f:523,t:0}],
        green:  [{f:440,t:0},{f:554,t:0.10}],
      };
      const cfg = cfgMap[priority] || [{f:660,t:0}];
      const vol = priority === 'red' ? 0.10 : 0.06;
      cfg.forEach(function(item) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = item.f;
        gain.gain.setValueAtTime(vol, ctx.currentTime + item.t);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + item.t + 0.14);
        osc.start(ctx.currentTime + item.t);
        osc.stop(ctx.currentTime + item.t + 0.15);
      });
    } catch (_) {}
  },

  _showMiniToast(msg) {
    if (document.hidden) return;
    const existing = document.getElementById('karpus-mini-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'karpus-mini-toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:80px', 'left:50%',
      'transform:translateX(-50%) translateY(20px)',
      'background:rgba(15,23,42,0.92)', 'color:white',
      'padding:8px 16px', 'border-radius:20px',
      'font-size:12px', 'font-weight:700', 'z-index:9990',
      'pointer-events:none', 'backdrop-filter:blur(8px)',
      'box-shadow:0 4px 16px rgba(0,0,0,0.3)',
      'transition:all 0.3s ease', 'opacity:0', 'white-space:nowrap'
    ].join(';');
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(function() {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  }
};
