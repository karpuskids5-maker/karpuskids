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
      console.error('[VideoCallUI]', e);
      container.innerHTML = Helpers.emptyState('Error al cargar videollamadas', 'video-off');
    }
  },

  _buildHTML(role, active, upcoming, userName, studentName, classroomId) {
    const isHost = ['maestra', 'directora', 'asistente'].includes(role);

    return `
      <div class="space-y-6">
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
          <button id="btn-schedule-meeting"
            class="flex items-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg active:scale-95 transition-all">
            <i data-lucide="calendar-plus" class="w-4 h-4"></i> Programar reunión
          </button>` : ''}
        </div>

        <!-- Reunión activa -->
        ${active ? `
        <div class="bg-gradient-to-r from-orange-500 to-amber-500 rounded-3xl p-5 text-white shadow-xl">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-3 h-3 bg-white rounded-full animate-pulse"></div>
            <span class="font-black text-sm uppercase tracking-wider">En vivo ahora</span>
          </div>
          <h3 class="text-xl font-black mb-1">${Helpers.escapeHTML(active.title || 'Clase en vivo')}</h3>
          <p class="text-white/80 text-sm mb-4">${active.description || 'Reunión activa'}</p>
          <button id="btn-join-active"
            data-room="${active.room_name}"
            class="w-full py-3.5 bg-white text-orange-600 rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2">
            <i data-lucide="video" class="w-5 h-5"></i> Unirse ahora
          </button>
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
            <i data-lucide="calendar" class="w-4 h-4 text-violet-500"></i> Próximas reuniones
          </h3>
          <div class="space-y-3">
            ${upcoming.map(m => this._meetingCard(m, isHost)).join('')}
          </div>
        </div>` : ''}

        <!-- Sala de reunión embebida -->
        <div id="jitsi-container" class="hidden rounded-3xl overflow-hidden border border-slate-200 shadow-xl" style="height:520px;"></div>

        <!-- Instrucciones para padre -->
        ${!isHost ? `
        <div class="bg-violet-50 border border-violet-100 rounded-2xl p-4">
          <p class="text-xs font-bold text-violet-700 uppercase tracking-wider mb-2">💡 ¿Cómo funciona?</p>
          <ul class="text-xs text-violet-600 space-y-1 font-medium">
            <li>• La maestra inicia la reunión y tú recibirás una notificación</li>
            <li>• Haz clic en "Unirse ahora" cuando aparezca la reunión activa</li>
            <li>• Necesitas cámara y micrófono para participar</li>
            <li>• Las reuniones son privadas y seguras</li>
            ${studentName ? `<li>• Aparecerás como <strong>${Helpers.escapeHTML(studentName)}</strong> en la sala</li>` : ''}
          </ul>
        </div>` : ''}
      </div>`;
  },

  _meetingCard(m, isHost) {
    const date = new Date(m.start_time).toLocaleString('es-DO', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
    return `
      <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-4">
        <div class="w-12 h-12 bg-violet-50 text-violet-600 rounded-2xl flex items-center justify-center text-xl shrink-0">📅</div>
        <div class="flex-1 min-w-0">
          <p class="font-bold text-slate-800 text-sm truncate">${Helpers.escapeHTML(m.title || 'Reunión')}</p>
          <p class="text-[10px] text-slate-400 font-bold uppercase mt-0.5">${date}</p>
        </div>
        ${isHost ? `
        <div class="flex gap-2 shrink-0">
          <button data-room="${m.room_name}" data-meeting-id="${m.id}"
            class="btn-start-meeting px-3 py-2 bg-orange-600 text-white rounded-xl font-black text-xs uppercase hover:bg-orange-700 transition-all active:scale-95">
            Iniciar
          </button>
          <button data-meeting-id="${m.id}"
            class="btn-cancel-meeting p-2 bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-100 transition-all">
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

    // Iniciar reunión programada
    container.querySelectorAll('.btn-start-meeting').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const room = e.currentTarget.dataset.room;
        const id   = e.currentTarget.dataset.meetingId;
        // Marcar como live
        await supabase.from('meetings').update({ status: 'live' }).eq('id', id);
        this._joinRoom(room, userName);
        // Notificar participantes
        this._notifyParticipants(id, classroomId);
      });
    });

    // Cancelar reunión
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
    const jitsiContainer = document.getElementById('jitsi-container');
    if (!jitsiContainer) return;

    jitsiContainer.classList.remove('hidden');
    jitsiContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Loading state
    jitsiContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full bg-slate-900 text-white gap-4">
        <div class="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
        <p class="font-bold text-sm">Conectando a la sala...</p>
        <p class="text-xs text-white/50">Esto puede tomar unos segundos</p>
      </div>`;

    if (this._api) {
      try { this._api.dispose(); } catch (_) {}
      this._api = null;
    }

    // Suppress cosmetic errors from Jitsi
    const origConsoleError = console.error;
    console.error = (...args) => {
      const msg = args.join(' ');
      if (msg.includes('WakeLock') || msg.includes('wake lock') || msg.includes('ERR_FAILED') ||
          msg.includes('No SW registration') || msg.includes('postMessage')) return;
      origConsoleError.apply(console, args);
    };
    // Suppress speaker-selection warning
    const origConsoleWarn = console.warn;
    console.warn = (...args) => {
      const msg = args.join(' ');
      if (msg.includes('speaker-selection') || msg.includes('Unrecognized feature')) return;
      origConsoleWarn.apply(console, args);
    };

    const loadJitsi = () => {
      if (window.JitsiMeetExternalAPI) {
        this._startJitsi(roomName, userName, jitsiContainer);
      } else {
        const script = document.createElement('script');
        script.src = `https://${JITSI_DOMAIN}/external_api.js`;
        script.onload = () => this._startJitsi(roomName, userName, jitsiContainer);
        script.onerror = () => {
          jitsiContainer.innerHTML = `
              <div class="flex flex-col items-center justify-center h-full bg-slate-50 gap-4 p-8 text-center">
                <div class="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center text-3xl">📵</div>
                <p class="font-black text-slate-700">No se pudo cargar la videollamada</p>
                <p class="text-sm text-slate-400">Verifica tu conexión a internet e intenta de nuevo.</p>
                <button onclick="location.reload()" class="px-6 py-2.5 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase">Reintentar</button>
              </div>`;
        };
        document.head.appendChild(script);
      }
    };

    // Small delay to let the loading UI render
    setTimeout(loadJitsi, 300);
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
        console.log('[VideoCallUI] ✅ Conectado a sala:', fullRoom);
      });

      this._api.addEventListener('connectionFailed', () => {
        console.error('[VideoCallUI] Conexión fallida a meet.jit.si');
        container.innerHTML = `
          <div class="flex flex-col items-center justify-center h-full bg-slate-50 gap-4 p-8 text-center">
            <div class="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center text-3xl">📵</div>
            <p class="font-black text-slate-700">No se pudo conectar a la sala</p>
            <p class="text-sm text-slate-400">Verifica tu conexión a internet e intenta de nuevo.</p>
            <button onclick="location.reload()" class="px-6 py-2.5 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase">Reintentar</button>
          </div>`;
      });

    } catch (e) {
      console.error('[VideoCallUI] Error al iniciar Jitsi:', e.message);
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
        .select('*')
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
        .from('students').select('parent_id').eq('classroom_id', classroomId).not('parent_id', 'is', null);
      for (const s of students || []) {
        sendPush({ user_id: s.parent_id, title: '🔴 Clase en vivo ahora', message: 'Tu maestra inició una videollamada. ¡Únete ahora!', type: 'videocall', link: 'panel_padres.html' }).catch(() => {});
      }
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
