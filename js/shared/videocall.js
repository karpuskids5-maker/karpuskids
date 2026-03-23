import { supabase, sendPush } from './supabase.js';
import { Helpers } from './helpers.js';

export const VideoCallModule = {
  _domain: 'meet.jit.si',
  _api: null,

  /**
   * 📅 Programar una reunión profesional
   * @param {Object} data { title, description, start_time, type, target_id, host_id }
   */
  async scheduleMeeting(data) {
    // Generar sala única y segura
    const roomName = `karpus_${data.type}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const { data: meeting, error } = await supabase
      .from('meetings')
      .insert({
        ...data,
        room_name: roomName,
        status: 'scheduled'
      })
      .select()
      .single();

    if (error) throw error;

    // 🚀 Enviar Invitaciones Automáticas
    await this._notifyParticipants(meeting);

    return meeting;
  },

  /**
   * 🔔 Sistema de Invitación Inteligente
   */
  async _notifyParticipants(meeting) {
    let userIds = [];
    const timeStr = new Date(meeting.start_time).toLocaleString('es-DO', { 
      weekday: 'long', hour: '2-digit', minute:'2-digit', day: 'numeric', month: 'short' 
    });

    try {
      if (meeting.type === 'classroom') {
        const { data: students } = await supabase
          .from('students')
          .select('parent_id')
          .eq('classroom_id', meeting.target_id)
          .not('parent_id', 'is', null);
        userIds = students?.map(s => s.parent_id) || [];
      } else if (meeting.type === 'private') {
        userIds = [meeting.target_id];
      } else if (meeting.type === 'staff') {
        const { data: staff } = await supabase.from('profiles').select('id').eq('role', 'maestra');
        userIds = staff?.map(s => s.id) || [];
      }

      const notifications = userIds.map(uid => sendPush({
        user_id: uid,
        title: '🎥 Invitación a Videollamada',
        message: `${meeting.title} - ${timeStr}`,
        link: 'videocall'
      }));

      await Promise.allSettled(notifications);
    } catch (e) {
      console.error('Error enviando invitaciones:', e);
    }
  },

  /**
   * 📥 Obtener mis reuniones (Lógica Unificada)
   */
  async getMyMeetings() {
    const { data, error } = await supabase
      .from('meetings')
      .select('*, host:host_id(name)')
      .or(`status.eq.scheduled,status.eq.live`) 
      .order('start_time', { ascending: true });
    
    if (error) throw error;
    return data || [];
  },

  async startMeeting(meetingId) {
    await supabase.from('meetings').update({ status: 'live' }).eq('id', meetingId);
  },

  async endMeeting(meetingId) {
    await supabase.from('meetings').update({ status: 'finished', end_time: new Date().toISOString() }).eq('id', meetingId);
    if (this._api) {
      this._api.dispose();
      this._api = null;
    }
  },

  joinMeeting(meeting, containerId, userInfo) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (this._api) this._api.dispose();
    container.innerHTML = '';

    const options = {
      roomName: meeting.room_name,
      width: '100%',
      height: '100%',
      parentNode: container,
      userInfo: {
        displayName: userInfo?.name || 'Usuario Karpus',
        email: userInfo?.email
      },
      configOverwrite: { 
        startWithAudioMuted: true, 
        prejoinPageEnabled: false 
      },
      interfaceConfigOverwrite: { 
        SHOW_JITSI_WATERMARK: false,
        TOOLBAR_BUTTONS: [
           'microphone', 'camera', 'desktop', 'fullscreen',
           'fodeviceselection', 'hangup', 'profile', 'chat',
           'raisehand', 'videoquality', 'tileview'
        ]
      },
      lang: 'es'
    };

    if (!window.JitsiMeetExternalAPI) {
      const script = document.createElement('script');
      script.src = `https://${this._domain}/external_api.js`;
      script.onload = () => {
        this._api = new JitsiMeetExternalAPI(this._domain, options);
        this._setupListeners(container, meeting.id);
      };
      document.head.appendChild(script);
    } else {
      this._api = new JitsiMeetExternalAPI(this._domain, options);
      this._setupListeners(container, meeting.id);
    }
  },

  _setupListeners(container, meetingId) {
    this._api.addEventListeners({
      videoConferenceLeft: () => {
        container.innerHTML = `<div class="flex flex-col items-center justify-center h-full bg-slate-50 text-slate-500"><i data-lucide="video-off" class="w-12 h-12 mb-2"></i><p>Has salido de la videollamada.</p><button onclick="location.reload()" class="mt-4 px-4 py-2 bg-slate-200 rounded-lg text-sm font-bold">Volver</button></div>`;
        if(window.lucide) lucide.createIcons();
      }
    });
  },

  async init() {
     console.log('✅ VideoCallModule initialized');
  }
};

// Exponer globalmente para onclicks HTML
window.VideoCallModule = VideoCallModule;