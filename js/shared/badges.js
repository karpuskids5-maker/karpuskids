/**
 * 🔴 Karpus Kids — Badge System
 * Muestra puntos rojos en botones de navegación cuando hay contenido nuevo.
 * Al entrar a la sección, el badge desaparece y se marca como leído en localStorage.
 *
 * Uso:
 *   BadgeSystem.init(userId)          — inicializa y suscribe realtime
 *   BadgeSystem.mark(section)         — marca sección como leída
 *   BadgeSystem.set(section, count)   — fuerza un conteo
 */

const STORAGE_PREFIX = 'karpus_badge_';

export const BadgeSystem = {
  _userId: null,
  _channel: null,

  /** Inicializa el sistema para un usuario */
  async init(userId) {
    if (!userId) return;
    this._userId = userId;
    await this._loadCounts();
    this._subscribeRealtime();
  },

  /** Carga conteos desde Supabase notifications table */
  async _loadCounts() {
    try {
      const { supabase } = await import('./supabase.js');
      const { data } = await supabase
        .from('notifications')
        .select('type, created_at')
        .eq('user_id', this._userId)
        .eq('is_read', false)
        .limit(100); // ✅ límite para evitar queries pesadas

      if (!data) return;

      // Agrupar por tipo → sección
      const counts = {};
      for (const n of data) {
        const section = this._typeToSection(n.type);
        if (section) counts[section] = (counts[section] || 0) + 1;
      }

      // Aplicar badges
      for (const [section, count] of Object.entries(counts)) {
        this._renderBadge(section, count);
      }
    } catch (e) {
      console.warn('[BadgeSystem] loadCounts error:', e.message);
    }
  },

  /** Suscripción realtime a nuevas notificaciones */
  _subscribeRealtime() {
    if (!this._userId) return;
    import('./supabase.js').then(() => {
      import('./realtime-manager.js').then(({ RealtimeManager }) => {
        RealtimeManager.subscribe('badges_' + this._userId, (channel) => {
          channel.on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${this._userId}`
          }, (payload) => {
            const section = this._typeToSection(payload.new?.type);
            if (!section) return;
            const current = document.querySelector('.section.active')?.id;
            if (current === section) {
              this._markReadInDB(section);
              return;
            }
            const badge = document.getElementById('badge-' + section);
            if (!badge) return;
            const prev = parseInt(badge.textContent) || 0;
            this._renderBadge(section, prev + 1);
          });
        });
      });
    });
  },

  /** Marca una sección como leída: oculta badge y actualiza DB */
  mark(section) {
    this._renderBadge(section, 0);
    this._markReadInDB(section);
  },

  /** Fuerza un conteo específico */
  set(section, count) {
    this._renderBadge(section, count);
  },

  /** Renderiza o esconde el badge */
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

  /** Marca notificaciones de un tipo como leídas en Supabase */
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
      console.warn('[BadgeSystem] markRead error:', e.message);
    }
  },

  /** Mapea tipo de notificación → sección del panel */
  _typeToSection(type) {
    const map = {
      // Panel padre
      task:       'tasks',
      post:       'class',
      muro:       'class',
      attendance: 'live-attendance',
      payment:    'payments',
      grade:      'grades',
      chat:       'notifications',
      // Panel maestra (prefijo t-)
      submission: 't-home',
      'task-submission': 't-home',
      // Panel directora / asistente
      inquiry:    'reportes',
      receipt:    'pagos',
      'new-student': 'estudiantes',
      'new-teacher': 'maestros',
    };
    return map[type] || null;
  },

  /** Mapea sección → tipos de notificación */
  _sectionToTypes(section) {
    const map = {
      // Padre
      tasks:             ['task', 'submission'],
      class:             ['post', 'muro'],
      'live-attendance': ['attendance'],
      payments:          ['payment'],
      grades:            ['grade'],
      notifications:     ['chat'],
      // Maestra
      't-home':          ['submission', 'task-submission'],
      't-chat':          ['chat'],
      't-grades':        ['grade'],
      // Directora / Asistente
      reportes:          ['inquiry'],
      pagos:             ['receipt', 'payment'],
      estudiantes:       ['new-student'],
      maestros:          ['new-teacher'],
    };
    return map[section] || [];
  }
};
