/**
 * Karpus Kids - Badge System v2
 * Indicadores visuales en tiempo real para todos los paneles.
 * Compatible con: panel_padres, panel_directora, panel_asistente, panel-maestra
 */

export const BadgeSystem = {
  _userId: null,
  _role: null,
  _counts: {},   // conteos en memoria para re-aplicar en tarjetas dinámicas

  async init(userId) {
    if (!userId) return;
    this._userId = userId;
    this._role = this._detectRole();
    this._initTimestamps();
    await this._loadCounts();
    this._subscribeRealtime();
  },

  // Detecta el panel activo por elementos unicos en el DOM
  _detectRole() {
    if (document.getElementById('badge-class'))   return 'padre';
    if (document.getElementById('badge-t-chat'))  return 'maestra';
    // Asistente tiene badge-muro, directora no
    if (document.getElementById('badge-muro'))    return 'asistente';
    if (document.getElementById('badge-pagos'))   return 'directora';
    return 'unknown';
  },

  _initTimestamps() {
    ['last_muro_view', 'last_class_view'].forEach(key => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, new Date().toISOString());
      }
    });
  },

  // Obtiene la seccion activa — compatible con todos los paneles
  _getActiveSection() {
    const el = document.querySelector('.section.active');
    return el ? el.id : '';
  },

  _getBadgeCount(section) {
    const el = document.getElementById('badge-' + section);
    return el ? (parseInt(el.textContent) || 0) : 0;
  },

  async _loadCounts() {
    try {
      const { supabase } = await import('./supabase.js');

      // Notificaciones no leidas
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
        for (const section in counts) {
          this._renderBadge(section, counts[section]);
          this._renderCardBadge(section, counts[section]);
        }
      }

      // Mensajes no leidos
      try {
        const { data: unreadData } = await supabase.rpc('get_unread_counts');
        if (unreadData) {
          const total = Object.values(unreadData).reduce(function(a, b) { return a + Number(b); }, 0);
          if (total > 0) {
            // Panel padre
            this._renderBadge('notifications', total);
            this._renderCardBadge('notifications', total);
            // Panel staff
            this._renderBadge('chat', total);
            this._renderBadge('comunicacion', total);
            this._renderCardBadge('comunicacion', total);
          }
        }
      } catch (_) {}

    } catch (_) {}
  },

  _subscribeRealtime() {
    if (!this._userId) return;
    const self = this;
    import('./supabase.js').then(function(mod) {
      import('./realtime-manager.js').then(function(rtMod) {
        rtMod.RealtimeManager.subscribe('badges_' + self._userId, function(channel) {
          self._setupChannelListeners(channel);
        });
      }).catch(function() {
        // Fallback sin RealtimeManager
        const channel = mod.supabase.channel('badges_direct_' + self._userId);
        self._setupChannelListeners(channel);
        channel.subscribe();
      });
    });
  },

  async _loadTimeBasedBadge(section, table) {
    try {
      const { supabase } = await import('./supabase.js');
      const lastView = localStorage.getItem('last_' + section + '_view') || new Date(0).toISOString();
      
      const { count } = await supabase.from(table).select('id', { count: 'exact', head: true }).gt('created_at', lastView);
      if (count > 0) {
        this._renderBadge(section, count);
        this._renderCardBadge(section, count);
      }
    } catch (_) {}
  },

  _setupChannelListeners(channel) {
    const self = this;

    // 1. Nuevas notificaciones del usuario
    channel.on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: 'user_id=eq.' + self._userId
    }, function(payload) {
      const type = payload.new && payload.new.type;
      const section = self._typeToSection(type);
      if (!section) return;
      const active = self._getActiveSection();
      if (active === section) { self._markReadInDB(section); return; }
      const prev = self._getBadgeCount(section);
      self._renderBadge(section, prev + 1);
      self._renderCardBadge(section, prev + 1);
      self._applyGlow(section);
      self._showMiniToast(self._toastMsg(type));
    });

    // 2. Nuevos mensajes directos
    channel.on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages'
    }, function(payload) {
      if (payload.new && payload.new.sender_id === self._userId) return;
      
      // ✅ REGLA DE NO DUPLICACIÓN: Ignorar si el chat con esta conversación ya está abierto
      const activeConvId = (window.AppState && AppState.get('activeConversationId'));
      if (activeConvId && payload.new.conversation_id === activeConvId) return;

      const active = self._getActiveSection();
      if (active === 'notifications' || active === 'chat' || active === 'comunicacion') return;
      // Panel padre
      const prevN = self._getBadgeCount('notifications');
      self._renderBadge('notifications', prevN + 1);
      self._renderCardBadge('notifications', prevN + 1);
      // Panel staff
      const prevC = self._getBadgeCount('chat');
      self._renderBadge('chat', prevC + 1);
      self._renderBadge('comunicacion', prevC + 1);
      self._renderCardBadge('comunicacion', prevC + 1);
      self._applyGlow('notifications');
      self._applyGlow('comunicacion');
      self._showMiniToast('Nuevo mensaje');
    });

    // 3. Nuevos posts en el muro
    channel.on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'posts'
    }, function(payload) {
      if (payload.new && payload.new.teacher_id === self._userId) return;
      // Panel padre: badge-class | Panel staff: badge-muro
      const section = document.getElementById('badge-class') ? 'class' : 'muro';
      const active = self._getActiveSection();
      if (active === section) return;
      const prev = self._getBadgeCount(section);
      self._renderBadge(section, prev + 1);
      self._renderCardBadge(section, prev + 1);
      self._applyGlow(section);
      self._showMiniToast('Nueva publicacion en el muro');
    });

    // 4. Nuevas tareas (panel padre y maestra)
    channel.on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'tasks'
    }, function() {
      const active = self._getActiveSection();
      if (active === 'tasks') return;
      const prev = self._getBadgeCount('tasks');
      self._renderBadge('tasks', prev + 1);
      self._renderCardBadge('tasks', prev + 1);
      self._applyGlow('tasks');
      self._showMiniToast('Nueva tarea asignada');
    });

    // 5. Entregas de tareas (panel maestra)
    channel.on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'task_evidences'
    }, function() {
      const active = self._getActiveSection();
      if (active === 't-home') return;
      const prev = self._getBadgeCount('t-home');
      self._renderBadge('t-home', prev + 1);
      self._applyGlow('t-home');
      self._showMiniToast('Nueva entrega de tarea');
    });

    // 6. Comprobantes de pago subidos (panel directora/asistente)
    channel.on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'payments'
    }, function(payload) {
      const ns = ((payload.new && payload.new.status) || '').toLowerCase();
      const os = ((payload.old && payload.old.status) || '').toLowerCase();
      if (ns === os) return;
      // Padre: pago aprobado
      if (ns === 'paid' || ns === 'pagado' || ns === 'approved') {
        const active = self._getActiveSection();
        if (active !== 'payments') {
          self._applyGlow('payments');
          self._showMiniToast('Pago confirmado');
        }
      }
      // Staff: nuevo comprobante para revisar
      if (ns === 'review' || ns === 'revision' || (ns === 'pending' && payload.new.evidence_url)) {
        const active = self._getActiveSection();
        if (active !== 'pagos') {
          const prev = self._getBadgeCount('pagos');
          self._renderBadge('pagos', prev + 1);
          self._applyGlow('pagos');
          self._showMiniToast('Nuevo comprobante de pago');
        }
      }
    });

    // 7. Nuevas consultas/inquiries (panel directora)
    channel.on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'inquiries'
    }, function() {
      const active = self._getActiveSection();
      if (active === 'reportes') return;
      const prev = self._getBadgeCount('reportes');
      self._renderBadge('reportes', prev + 1);
      self._applyGlow('reportes');
      self._showMiniToast('Nueva consulta recibida');
    });

    // 8. Solicitudes de permisos (personal)
    channel.on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'staff_permits'
    }, function() {
      if (self._role === 'directora' || self._role === 'asistente') {
        const section = 'permits';
        const prev = self._getBadgeCount(section);
        self._renderBadge(section, prev + 1);
        self._showMiniToast('Nueva solicitud de permiso');
      }
    });
  },

  async mark(section) {
    this._counts[section] = 0;
    this._renderBadge(section, 0);
    this._renderCardBadge(section, 0);
    
    // ✅ Triple Acción: UI (arriba), DB, State
    await this._markReadInDB(section);

    // Lógica por tiempo
    if (section === 'muro' || section === 'class') {
      localStorage.setItem('last_' + section + '_view', new Date().toISOString());
    }

    // Lógica especial Chat
    if (['chat', 'notifications', 'comunicacion'].includes(section)) {
      const activeConvId = (window.AppState && AppState.get('activeConversationId'));
      if (activeConvId) {
        const { ChatModule } = await import('./chat.js');
        await ChatModule.markAsRead(activeConvId);
      }
    }

    // State Update (Dashboard Sync)
    if (window.AppState) {
      const dashboardData = AppState.get('dashboardData');
      if (dashboardData && dashboardData.stats) {
        const statKey = this._sectionToStatKey(section);
        if (statKey) {
          dashboardData.stats[statKey] = 0;
          AppState.set('dashboardData', { ...dashboardData });
        }
      }
    }

    // Limpiar aliases
    if (section === 'chat' || section === 'notifications' || section === 'comunicacion') {
      this._counts['chat'] = 0;
      this._counts['comunicacion'] = 0;
      this._counts['notifications'] = 0;
      this._renderBadge('chat', 0);
      this._renderBadge('comunicacion', 0);
      this._renderBadge('notifications', 0);
      this._renderCardBadge('comunicacion', 0);
      this._renderCardBadge('notifications', 0);
    }
    // Limpiar muro y sus aliases
    if (section === 'muro' || section === 'class') {
      this._counts['muro'] = 0;
      this._counts['class'] = 0;
      this._renderBadge('muro', 0);
      this._renderBadge('class', 0);
      this._renderCardBadge('muro', 0);
      this._renderCardBadge('class', 0);
    }
  },

  _sectionToStatKey(section) {
    const map = {
      reportes: 'pendingInquiries',
      pagos: 'pending_payments',
      class: 'newPosts',
      muro: 'newPosts'
    };
    return map[section];
  },

  // ✅ Reactividad externa para cambios en memoria
  setCount(section, count, type = 'default') {
    this._renderBadge(section, count, type);
    this._renderCardBadge(section, count, type);
  },

  set(section, count) {
    this._renderBadge(section, count);
    this._renderCardBadge(section, count);
  },

  // Badge en el sidebar (badge-class, badge-tasks, badge-pagos, etc.)
  _renderBadge(section, count, type = 'default') {
    this._counts[section] = count; // guardar en memoria
    const badge = document.getElementById('badge-' + section);
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.remove('hidden');
      badge.classList.add('flex');
      
      // Estilos por tipo
      badge.classList.toggle('bg-rose-600', type === 'urgent');
      badge.classList.toggle('bg-blue-600', type === 'new');
      if (type === 'default') badge.classList.add('bg-rose-500');
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('flex');
    }
  },

  // Badge en tarjeta del dashboard (badge-card-tasks, badge-card-comunicacion, etc.)
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

  // Re-aplica badges en tarjetas del dashboard después de que se re-rendericen
  // Llamar después de refreshDashboard() en panel padre
  _reapplyCardBadges() {
    for (const section in this._counts) {
      const count = this._counts[section];
      if (count > 0) this._renderCardBadge(section, count);
    }
  },

  async _markReadInDB(section) {
    if (!this._userId) return;
    try {
      const { supabase } = await import('./supabase.js');
      const types = this._sectionToTypes(section);
      if (!types.length) return;
      await supabase.from('notifications')
        .update({ is_read: true })
        .eq('user_id', this._userId)
        .in('type', types)
        .eq('is_read', false);
    } catch (_) {}
  },

  _typeToSection(type) {
    const map = {
      // Panel padre
      task:              'tasks',
      post:              'class',
      muro:              'class',
      comment:           'class',
      like:              'class',
      attendance:        'live-attendance',
      payment:           'payments',
      grade:             'grades',
      chat:              'notifications',
      message:           'notifications',
      // Panel maestra
      submission:        't-home',
      'task-submission': 't-home',
      'post-feedback':   't-home',
      // Panel directora / asistente
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
      tasks:             ['task'],
      class:             ['post', 'muro', 'comment', 'like'],
      'live-attendance': ['attendance'],
      payments:          ['payment', 'receipt', 'alert'],
      grades:            ['grade'],
      notifications:     ['chat', 'message'],
      't-home':          ['submission', 'task-submission'],
      't-chat':          ['chat', 'message'],
      reportes:          ['inquiry'],
      pagos:             ['receipt', 'payment', 'alert'],
      muro:              ['post', 'muro'],
      chat:              ['chat', 'message'],
      comunicacion:      ['chat', 'message'],
      maestros:          ['new-teacher'],
      estudiantes:       ['new-student'],
    };
    return map[section] || [];
  },

  _toastMsg(type) {
    const msgs = {
      task:       'Nueva tarea asignada',
      post:       'Nueva publicacion en el muro',
      muro:       'Nueva publicacion en el muro',
      chat:       'Nuevo mensaje',
      message:    'Nuevo mensaje',
      attendance: 'Asistencia registrada',
      payment:    'Actualizacion de pago',
      grade:      'Nueva calificacion',
      inquiry:    'Nueva consulta recibida',
      receipt:    'Nuevo comprobante de pago',
      submission: 'Nueva entrega de tarea',
    };
    return msgs[type] || 'Nueva notificacion';
  },

  // Glow en boton del sidebar Y en tarjeta del dashboard
  // Compatible con data-target (padre) y data-section (directora/asistente/maestra)
  _applyGlow(section) {
    // Sidebar: buscar por data-target O data-section
    const sidebarBtn = document.querySelector(
      '[data-target="' + section + '"], [data-section="' + section + '"], .node-' + section
    );
    if (sidebarBtn) {
      sidebarBtn.classList.add('animate-glow');
      const btn = sidebarBtn;
      setTimeout(function() { btn.classList.remove('animate-glow'); }, 4000);
    }

    // Tarjeta del dashboard: buscar por data-target O data-section O data-action
    const card = document.querySelector(
      '[data-target="' + section + '"], [data-section="' + section + '"]'
    );
    if (card && card !== sidebarBtn) {
      card.classList.remove('card-glow-orange', 'card-glow-blue', 'card-glow-green', 'card-glow-red');
      void card.offsetWidth;
      card.classList.add('card-glow-orange');
      const c = card;
      setTimeout(function() { c.classList.remove('card-glow-orange'); }, 2000);
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