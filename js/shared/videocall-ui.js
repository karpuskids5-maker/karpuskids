/**
 * 🎥 Karpus Kids — VideoCall UI
 * Sistema unificado de videollamadas para todos los paneles.
 * Usa meet.jit.si — funciona sin cuenta, sin límite de tiempo en salas privadas.
 */
import { supabase, sendPush } from './supabase.js';
import { Helpers } from './helpers.js';

// meet.jit.si funciona sin tenant y sin límite de tiempo para salas con nombre único
const JITSI_DOMAIN = 'meet.jit.si';
// Prefijo largo y único para evitar colisiones con otras organizaciones
const ROOM_PREFIX = 'karpuskids-edu-2026';

export const VideoCallUI = {
  _api: null,

  /**
   * Renderiza la sección completa de videollamadas según el rol.
   */
  async renderSection(containerId, { role = 'padre', userName = 'Usuario', studentName = '', classroomId = null } = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<div class="flex justify-center py-12"><div class="animate-spin w-8 h-8 border-2 border-violet-500 rounded-full border-t-transparent"></div></div>`;

    try {
      const meetings = await this._getMeetings(role, classroomId);
      const active   = meetings.find(m => m.status === 'live');
      const upcoming = meetings.filter(m => m.status === 'scheduled');

      container.innerHTML = this._buildHTML(role, active, upcoming, userName, studentName, classroomId);

      // Wiring
      this._wireButtons(container, role, userName, classroomId);

      if (window.lucide) lucide.createIcons();
    } catch (e) {
      container.innerHTML = Helpers.emptyState('Error al cargar videollamadas', 'video-off');
    }
  },

  _buildHTML(role, active, upcoming, userName, studentName, classroomId) {
    const isHost = ['maestra', 'directora', 'asistente'].includes(role);

    return `
      <div class="space-y-5">
        <!-- Header -->
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 class="text-2xl font-black text-slate-800 flex items-center gap-2">
              <span class="w-10 h-10 bg-violet-100 text-violet-600 rounded-2xl flex items-center justify-center">🎥</span>
              Videollamadas
            </h2>
            <p class="text-slate-400 text-sm font-medium mt-0.5">
              ${isHost ? 'Inicia o programa reuniones con padres y personal' : 'Únete a clases y reuniones en vivo'}
            </p>
          </div>
          ${isHost ? `
          <div class="flex gap-2 flex-wrap">
            <button id="btn-instant-meeting"
              class="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg shadow-orange-200 active:scale-95 transition-all">
              <i data-lucide="video" class="w-4 h-4"></i> Reunión instantánea
            </button>
            <button id="btn-schedule-meeting"
              class="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg shadow-violet-200 active:scale-95 transition-all">
              <i data-lucide="calendar-plus" class="w-4 h-4"></i> Programar
            </button>
          </div>` : ''}
        </div>

        <!-- Reunión activa -->
        ${active ? `
        <div class="bg-gradient-to-r from-orange-500 to-amber-500 rounded-3xl p-5 text-white shadow-xl shadow-orange-200">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-3 h-3 bg-white rounded-full animate-pulse"></div>
            <span class="font-black text-xs uppercase tracking-wider">🔴 En vivo ahora</span>
          </div>
          <h3 class="text-xl font-black mb-1">${Helpers.escapeHTML(active.title || 'Clase en vivo')}</h3>
          <p class="text-white/80 text-sm mb-4">${active.description || 'Reunión activa — únete ahora'}</p>
          <div class="flex gap-3 flex-wrap">
            <button id="btn-join-active" data-room="${active.room_name}"
              class="flex-1 py-3 bg-white text-orange-600 rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2">
              <i data-lucide="video" class="w-5 h-5"></i> Unirse ahora
            </button>
            ${isHost ? `
            <button data-meeting-id="${active.id}" data-room="${active.room_name}"
              class="btn-copy-link px-4 py-3 bg-white/20 hover:bg-white/30 text-white rounded-2xl font-black text-xs uppercase tracking-wider transition-all flex items-center gap-2">
              <i data-lucide="link" class="w-4 h-4"></i> Copiar enlace
            </button>
            <button data-meeting-id="${active.id}"
              class="btn-end-meeting px-4 py-3 bg-red-600/80 hover:bg-red-700 text-white rounded-2xl font-black text-xs uppercase tracking-wider transition-all flex items-center gap-2">
              <i data-lucide="phone-off" class="w-4 h-4"></i> Terminar
            </button>` : ''}
          </div>
        </div>` : `
        <div class="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-8 text-center">
          <div class="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 text-3xl">📵</div>
          <p class="font-bold text-slate-600">No hay reuniones activas en este momento</p>
          <p class="text-xs text-slate-400 mt-1">Las reuniones programadas aparecerán aquí cuando inicien</p>
        </div>`}

        <!-- Reuniones programadas -->
        ${upcoming.length ? `
        <div>
          <h3 class="font-black text-slate-700 text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
            <i data-lucide="calendar" class="w-4 h-4 text-violet-500"></i> Próximas reuniones (${upcoming.length})
          </h3>
          <div class="space-y-3">
            ${upcoming.map(m => this._meetingCard(m, isHost)).join('')}
          </div>
        </div>` : ''}

        <!-- Sala de reunión feedback -->
        <div id="jitsi-container" class="hidden rounded-3xl overflow-hidden border border-slate-200 shadow-xl" style="height:320px;"></div>

        <!-- Info para padre -->
        ${!isHost ? `
        <div class="bg-violet-50 border border-violet-100 rounded-2xl p-4">
          <p class="text-xs font-black text-violet-700 uppercase tracking-wider mb-2">💡 ¿Cómo funciona?</p>
          <ul class="text-xs text-violet-600 space-y-1.5 font-medium">
            <li>• La maestra inicia la reunión y recibirás una notificación push</li>
            <li>• Haz clic en "Unirse ahora" cuando aparezca la reunión activa</li>
            <li>• La videollamada se abre en una nueva pestaña — necesitas cámara y micrófono</li>
            <li>• Las reuniones son privadas y seguras con sala única</li>
            ${studentName ? `<li>• Aparecerás como <strong>${Helpers.escapeHTML(studentName)}</strong> en la sala</li>` : ''}
          </ul>
        </div>` : `
        <div class="bg-orange-50 border border-orange-100 rounded-2xl p-4">
          <p class="text-xs font-black text-orange-700 uppercase tracking-wider mb-2">💡 Consejos para maestras</p>
          <ul class="text-xs text-orange-600 space-y-1.5 font-medium">
            <li>• <strong>Reunión instantánea</strong>: inicia ahora y notifica a los padres automáticamente</li>
            <li>• <strong>Programar</strong>: agenda con fecha/hora y los padres recibirán recordatorio</li>
            <li>• Comparte el enlace con el botón "Copiar enlace" para invitar manualmente</li>
            <li>• La sala se abre en nueva pestaña para mejor calidad de video</li>
          </ul>
        </div>`}
      </div>`;
  },

  _meetingCard(m, isHost) {
    const date = new Date(m.start_time).toLocaleString('es-DO', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
    const now = new Date();
    const start = new Date(m.start_time);
    const diffMin = Math.round((start - now) / 60000);
    const timeLabel = diffMin <= 0 ? '¡Ahora!' : diffMin < 60 ? `En ${diffMin} min` : date;
    const isImminent = diffMin <= 15;

    return `
      <div class="bg-white rounded-2xl border ${isImminent ? 'border-orange-200 shadow-orange-100' : 'border-slate-100'} shadow-sm p-4 flex items-center gap-4 transition-all hover:shadow-md">
        <div class="w-12 h-12 ${isImminent ? 'bg-orange-50 text-orange-600' : 'bg-violet-50 text-violet-600'} rounded-2xl flex items-center justify-center text-xl shrink-0">
          ${isImminent ? '🔔' : '📅'}
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-bold text-slate-800 text-sm truncate">${Helpers.escapeHTML(m.title || 'Reunión')}</p>
          <p class="text-[10px] ${isImminent ? 'text-orange-500 font-black' : 'text-slate-400 font-bold'} uppercase mt-0.5">${timeLabel}</p>
        </div>
        ${isHost ? `
        <div class="flex gap-2 shrink-0">
          <button data-room="${m.room_name}" data-meeting-id="${m.id}"
            class="btn-start-meeting px-3 py-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl font-black text-xs uppercase hover:from-orange-600 hover:to-amber-600 transition-all active:scale-95 shadow-sm flex items-center gap-1.5">
            <i data-lucide="video" class="w-3.5 h-3.5"></i> Iniciar
          </button>
          <button data-room="${m.room_name}" data-meeting-id="${m.id}"
            class="btn-copy-link p-2 bg-slate-50 text-slate-500 rounded-xl hover:bg-slate-100 transition-all" title="Copiar enlace">
            <i data-lucide="link" class="w-4 h-4"></i>
          </button>
          <button data-meeting-id="${m.id}"
            class="btn-cancel-meeting p-2 bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-100 transition-all" title="Cancelar">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>` : ''}
      </div>`;
  },

  _wireButtons(container, role, userName, classroomId) {
    const isHost = ['maestra', 'directora', 'asistente'].includes(role);

    // Unirse a reunión activa
    container.querySelector('#btn-join-active')?.addEventListener('click', (e) => {
      const room = e.currentTarget.dataset.room;
      this._joinRoom(room, userName);
    });

    // Reunión instantánea (host only)
    container.querySelector('#btn-instant-meeting')?.addEventListener('click', async () => {
      const btn = container.querySelector('#btn-instant-meeting');
      if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Iniciando...'; if (window.lucide) lucide.createIcons(); }
      try {
        const roomName = `${ROOM_PREFIX}_instant_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        const { data: { user } } = await supabase.auth.getUser();
        const { data: meeting, error } = await supabase.from('meetings').insert({
          title: 'Reunión instantánea',
          description: 'Iniciada ahora mismo',
          start_time: new Date().toISOString(),
          room_name: roomName,
          type: 'classroom',
          target_id: classroomId,
          host_id: user?.id,
          status: 'live'
        }).select().single();
        if (error) throw error;
        // Notify parents
        this._notifyParticipants(meeting.id, classroomId);
        Helpers.toast('Reunión iniciada — notificando a los padres...', 'success');
        this._joinRoom(roomName, userName);
        // Reload section after short delay
        setTimeout(() => this.renderSection(container.id, { role, userName, classroomId }), 1500);
      } catch (e) {
        Helpers.toast('Error al iniciar reunión: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="video" class="w-4 h-4"></i> Reunión instantánea'; if (window.lucide) lucide.createIcons(); }
      }
    });

    // Iniciar reunión programada
    container.querySelectorAll('.btn-start-meeting').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const room = e.currentTarget.dataset.room;
        const id   = e.currentTarget.dataset.meetingId;
        await supabase.from('meetings').update({ status: 'live' }).eq('id', id);
        this._joinRoom(room, userName);
        this._notifyParticipants(id, classroomId);
        setTimeout(() => this.renderSection(container.id, { role, userName, classroomId }), 1000);
      });
    });

    // Copiar enlace de sala
    container.querySelectorAll('.btn-copy-link').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const room = e.currentTarget.dataset.room;
        const fullRoom = `${ROOM_PREFIX}_${room}`;
        const url = `https://${JITSI_DOMAIN}/${fullRoom}`;
        navigator.clipboard?.writeText(url).then(() => {
          Helpers.toast('Enlace copiado al portapapeles', 'success');
        }).catch(() => {
          prompt('Copia este enlace:', url);
        });
      });
    });

    // Terminar reunión activa
    container.querySelectorAll('.btn-end-meeting').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        if (!confirm('¿Terminar la reunión para todos?')) return;
        const id = e.currentTarget.dataset.meetingId;
        await supabase.from('meetings').update({ status: 'finished', end_time: new Date().toISOString() }).eq('id', id);
        Helpers.toast('Reunión terminada', 'success');
        this.renderSection(container.id, { role, userName, classroomId });
      });
    });

    // Cancelar reunión programada
    container.querySelectorAll('.btn-cancel-meeting').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        if (!confirm('¿Cancelar esta reunión?')) return;
        const id = e.currentTarget.dataset.meetingId;
        await supabase.from('meetings').update({ status: 'cancelled' }).eq('id', id);
        Helpers.toast('Reunión cancelada', 'success');
        this.renderSection(container.id, { role, userName, classroomId });
      });
    });

    // Programar nueva reunión
    container.querySelector('#btn-schedule-meeting')?.addEventListener('click', () => {
      this._openScheduleModal(role, userName, classroomId, container.id);
    });
  },

  _joinRoom(roomName, userName) {
    const fullRoom = `${ROOM_PREFIX}_${roomName}`;

    // Track meeting attendance in DB
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      // Find meeting by room_name and log attendance
      supabase.from('meetings').select('id').eq('room_name', roomName).maybeSingle()
        .then(({ data: meeting }) => {
          if (!meeting?.id) return;
          supabase.from('meeting_attendance').upsert(
            { meeting_id: meeting.id, user_id: user.id, joined_at: new Date().toISOString() },
            { onConflict: 'meeting_id,user_id' }
          ).catch(() => {});
        }).catch(() => {});
    }).catch(() => {});

    // ALWAYS open in new tab for best experience (no membersOnly lobby, no iframe limits)
    window.open(`https://${JITSI_DOMAIN}/${fullRoom}#userInfo.displayName="${encodeURIComponent(userName)}"&config.startWithAudioMuted=false&config.startWithVideoMuted=false&config.prejoinPageEnabled=false&config.disableDeepLinking=true&interfaceConfig.SHOW_JITSI_WATERMARK=false&interfaceConfig.SHOW_BRAND_WATERMARK=false&interfaceConfig.DEFAULT_BACKGROUND=%231e293b`, '_blank', 'noopener,noreferrer');

    // Show feedback in UI
    const jitsiContainer = document.getElementById('jitsi-container');
    if (jitsiContainer) {
      jitsiContainer.classList.remove('hidden');
      jitsiContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      jitsiContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full bg-gradient-to-br from-violet-600 to-purple-600 text-white gap-4 p-8">
          <div class="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-4xl animate-pulse">🎥</div>
          <p class="font-black text-xl">Videollamada abierta</p>
          <p class="text-sm text-white/80 text-center max-w-sm">La sala se abrió en una nueva pestaña. Si no la ves, verifica que tu navegador no bloqueó ventanas emergentes.</p>
          <button onclick="window.open('https://${JITSI_DOMAIN}/${fullRoom}#userInfo.displayName=${encodeURIComponent(userName)}','_blank')"
            class="px-8 py-3 bg-white/20 hover:bg-white/30 text-white rounded-2xl font-black text-sm uppercase tracking-wider backdrop-blur-sm transition-all flex items-center gap-2">
            <i data-lucide="external-link" class="w-4 h-4"></i> Abrir de nuevo
          </button>
          <button onclick="document.getElementById('jitsi-container').classList.add('hidden')"
            class="text-xs text-white/50 hover:text-white/80 transition-colors mt-2 font-bold">
            Cerrar este mensaje
          </button>
        </div>`;
      if (window.lucide) lucide.createIcons();
    }

    if (this._api) {
      try { this._api.dispose(); } catch (_) {}
      this._api = null;
    }
  },

  _startJitsi(roomName, userName, container) {
    try {
      const fullRoom = `${ROOM_PREFIX}_${roomName}`;

      this._api = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
        roomName:   fullRoom,
        parentNode: container,
        width:      '100%',
        height:     520,
        userInfo:   { displayName: userName },
        configOverwrite: {
          startWithAudioMuted:  false,
          startWithVideoMuted:  false,
          disableDeepLinking:   true,
          prejoinPageEnabled:   false,
          // Desactivar límite de tiempo y características que lo activan
          callStatsID:          '',
          callStatsSecret:      '',
          enableCalendarIntegration: false,
          disableAudioLevels:   true,
          enableNoAudioDetection: false,
          enableNoisyMicDetection: false,
          // Desactivar lobby (requiere moderador para entrar)
          lobby: { autoKnock: false, enableChat: false },
          // Sin límite de participantes
          maxFullResolutionParticipants: -1,
          // Desactivar analytics que pueden causar desconexión
          analytics: { disabled: true },
        },
        interfaceConfigOverwrite: {
          TOOLBAR_BUTTONS: ['microphone','camera','hangup','chat','tileview','fullscreen','raisehand','settings'],
          SHOW_JITSI_WATERMARK:  false,
          SHOW_BRAND_WATERMARK:  false,
          DEFAULT_BACKGROUND:    '#1e293b',
          DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
          HIDE_INVITE_MORE_HEADER: true,
        }
      });

      this._api.addEventListener('videoConferenceLeft', () => {
        container.classList.add('hidden');
        container.innerHTML = '';
      });

      this._api.addEventListener('videoConferenceJoined', () => {
      });

      this._api.addEventListener('connectionFailed', () => {
        container.innerHTML = `
          <div class="flex flex-col items-center justify-center h-full bg-slate-50 gap-4 p-8 text-center">
            <div class="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center text-3xl">📵</div>
            <p class="font-black text-slate-700">No se pudo conectar a la sala</p>
            <p class="text-sm text-slate-400">Verifica tu conexión a internet e intenta de nuevo.</p>
            <button onclick="location.reload()" class="px-6 py-2.5 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase">Reintentar</button>
          </div>`;
      });

    } catch (e) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full bg-slate-50 gap-4 p-8 text-center">
          <div class="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center text-3xl">📵</div>
          <p class="font-black text-slate-700">Error al iniciar la videollamada</p>
          <p class="text-sm text-slate-400">Verifica tu conexión e intenta de nuevo.</p>
          <button onclick="location.reload()" class="px-6 py-2.5 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase">Reintentar</button>
        </div>`;
    }
  },

  async _getMeetings(role, classroomId) {
    try {
      let q = supabase
        .from('meetings')
        .select('id, title, description, room_name, start_time, status, type, target_id, host_id')
        .in('status', ['scheduled', 'live'])
        .order('start_time', { ascending: true });

      if (role === 'padre' && classroomId) {
        q = q.eq('target_id', classroomId);
      }

      const { data } = await q;
      return data || [];
    } catch (_) { return []; }
  },

  async _notifyParticipants(meetingId, classroomId) {
    if (!classroomId) return;
    try {
      const { data: students } = await supabase
        .from('students').select('parent_id, name').eq('classroom_id', classroomId).not('parent_id', 'is', null);
      const pushes = (students || []).map(s =>
        sendPush({
          user_id: s.parent_id,
          title: '🔴 Clase en vivo ahora',
          message: 'Tu maestra inició una videollamada. ¡Únete ahora desde tu panel!',
          type: 'videocall',
          link: 'panel_padres.html'
        }).catch(() => {})
      );
      await Promise.allSettled(pushes);
    } catch (_) {}
  },

  _openScheduleModal(role, userName, classroomId, containerId) {
    const existing = document.getElementById('schedule-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'schedule-modal';
    modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div class="bg-gradient-to-r from-violet-600 to-purple-600 p-5 text-white flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-xl">📅</div>
            <div>
              <h3 class="font-black text-lg">Programar Reunión</h3>
              <p class="text-xs text-white/70 font-bold uppercase">Videollamada Karpus Kids</p>
            </div>
          </div>
          <button onclick="document.getElementById('schedule-modal').remove()" class="w-8 h-8 bg-white/10 hover:bg-white/20 rounded-xl flex items-center justify-center font-black">✕</button>
        </div>
        <div class="p-5 space-y-4">
          <div>
            <label class="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Título de la reunión</label>
            <input id="meeting-title" placeholder="Ej: Reunión de padres — Abril" class="w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:border-violet-400 text-sm font-medium bg-slate-50">
          </div>
          <div>
            <label class="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Fecha y hora</label>
            <input id="meeting-time" type="datetime-local" class="w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:border-violet-400 text-sm font-medium bg-slate-50">
          </div>
          <div>
            <label class="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Descripción (opcional)</label>
            <textarea id="meeting-desc" rows="2" placeholder="Tema a tratar..." class="w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:border-violet-400 text-sm font-medium bg-slate-50 resize-none"></textarea>
          </div>
        </div>
        <div class="p-4 border-t border-slate-100 flex gap-3">
          <button onclick="document.getElementById('schedule-modal').remove()" class="flex-1 py-2.5 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase">Cancelar</button>
          <button id="btn-confirm-schedule" class="flex-1 py-2.5 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg active:scale-95 transition-all">Programar</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    document.getElementById('btn-confirm-schedule')?.addEventListener('click', async () => {
      const title = document.getElementById('meeting-title')?.value?.trim();
      const time  = document.getElementById('meeting-time')?.value;
      const desc  = document.getElementById('meeting-desc')?.value?.trim();

      if (!title || !time) { Helpers.toast('Completa título y fecha', 'warning'); return; }

      const btn = document.getElementById('btn-confirm-schedule');
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

      try {
        const roomName = `${ROOM_PREFIX}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        const { data: { user } } = await supabase.auth.getUser();

        const { error } = await supabase.from('meetings').insert({
          title, description: desc || null,
          start_time: new Date(time).toISOString(),
          room_name: roomName,
          type: 'classroom',
          target_id: classroomId,
          host_id: user?.id,
          status: 'scheduled'
        });

        if (error) throw error;
        modal.remove();
        Helpers.toast('Reunión programada correctamente', 'success');
        // Recargar sección
        const { VideoCallUI } = await import('./videocall-ui.js');
        VideoCallUI.renderSection(containerId, { role, userName, classroomId });
      } catch (e) {
        Helpers.toast('Error: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Programar'; }
      }
    });
  }
};
