import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// ⚠️ REEMPLAZA ESTOS VALORES CON LOS DE TU PROYECTO EN SUPABASE.COM
const SUPABASE_URL = "https://wwnfonkvemimwiqjpkij.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3bmZvbmt2ZW1pbXdpcWpwa2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MzY0MzUsImV4cCI6MjA4MzQxMjQzNX0.n5VW-3U0r2nRlwC8pDstQLowu9MZ3aWHMzXVVNFQaDo";

export const supabase = window.supabase || createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'karpus_auth_token_v2',
    lock: false
  }
});
if (!window.supabase) window.supabase = supabase;

export async function ensureRole(requiredRole) {
  const session = await supabase.auth.getUser();
  const user = session?.data?.user;
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  const { data: profile } = await supabase.from('profiles').select('id, role, name, email').eq('id', user.id).maybeSingle();
  if (!profile || profile.role !== requiredRole) {
    try { await supabase.auth.signOut(); } catch (_) {}
    window.location.href = 'login.html';
    return null;
  }
  return { user, profile };
}

export async function subscribeNotifications(onNotif) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  
  try {
    const channel = supabase.channel('notif_' + user.id);
    if (!channel) {
      console.warn('No se pudo crear el canal de notificaciones');
      return null;
    }
    
    channel.on('postgres_changes', { 
      event: 'INSERT', 
      schema: 'public', 
      table: 'notifications', 
      filter: `user_id=eq.${user.id}` 
    }, (payload) => {
      const n = payload.new;
      if (onNotif) onNotif(n);
    })
    .subscribe();
    
    return channel;
  } catch (err) {
    console.error('Error al suscribir notificaciones:', err);
    return null;
  }
}

export async function sendEmail(to, subject, html, text) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('https://wwnfonkvemimwiqjpkij.supabase.co/functions/v1/send-email', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`
      },
      body: JSON.stringify({ to, subject, html, text })
    });
    if (!res.ok) {
      console.error('Error HTTP enviando correo', res.status);
    }
    return await res.json();
  } catch (e) {
    console.error('Error enviando correo', e);
  }
}
if (!window.sendEmail) window.sendEmail = sendEmail;

export async function sendPush(payload) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('send-push', { 
      body: payload,
      headers: {
        'Authorization': `Bearer ${session?.access_token || ''}`
      }
    });
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('Error enviando push:', e);
    throw e;
  }
}
if (!window.sendPush) window.sendPush = sendPush;

export async function emitEvent(type, data) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/process-event`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`
      },
      body: JSON.stringify({ type, data })
    });
    if (!res.ok) {
      console.error('Error emitiendo evento', res.status);
    }
    return await res.json();
  } catch (e) {
    console.error('Error emitiendo evento', e);
  }
}
if (!window.emitEvent) window.emitEvent = emitEvent;

export async function initOneSignal(currentUser = null) {
  let user = currentUser;
  
  // Si no se pasa usuario, intentar obtenerlo (fallback)
  if (!user) {
    const { data } = await supabase.auth.getUser();
    user = data?.user;
  }
  if (!user) return;

  const ONESIGNAL_APP_ID = "47ce2d1e-152e-4ea7-9ddc-8e2142992989";
  
  // 1. Cargar el script de OneSignal si no existe
  if (!document.getElementById('onesignal-sdk')) {
    const script = document.createElement('script');
    script.id = 'onesignal-sdk';
    script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    script.defer = true;
    document.head.appendChild(script);
  }

  window.OneSignal = window.OneSignal || [];
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  
  // Evitar múltiples inicializaciones
  if (window.OneSignalInitialized) return;
  window.OneSignalInitialized = true;

  // 2. Inicialización profesional
  OneSignalDeferred.push(async function(OneSignal) {
    try {
      // Verificar si ya está inicializado para evitar 400 errors de re-suscripción
      if (OneSignal.initialized) {
        await OneSignal.login(user.id);
        return;
      }

      await OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        allowLocalhostAsSecureOrigin: true,
        notifyButton: { enable: false },
        promptOptions: {
          slidedown: {
            enabled: true,
            autoPrompt: true,
            timeDelay: 10,
            pageViews: 1,
            actionMessage: "¿Deseas recibir notificaciones sobre tareas, pagos y avisos de Karpus Kids?",
            acceptButtonText: "Sí, recibir",
            cancelButtonText: "Ahora no"
          }
        }
      });

      // 3. Sincronización Profesional de Usuario (External ID)
      // En v16 se usa .login() para asociar el ID de Supabase
      await OneSignal.login(user.id);
      
      // 4. Tagueo por roles para envíos segmentados
      const { data: profile } = await supabase.from('profiles').select('role, name').eq('id', user.id).maybeSingle();
      if (profile) {
        OneSignal.User.addTag("role", profile.role);
        OneSignal.User.addTag("user_name", profile.name);
        
        // Si es padre, taguear con los IDs de sus hijos para notificaciones específicas
        if (profile.role === 'padre') {
          const { data: children } = await supabase.from('students').select('id').eq('parent_id', user.id);
          if (children && children.length > 0) {
            const childrenIds = children.map(c => c.id).join(',');
            OneSignal.User.addTag("children_ids", childrenIds);
          }
        }
      }

      console.log("OneSignal: Inicialización exitosa para usuario", user.id);
    } catch (e) {
      // Manejo silencioso en desarrollo para evitar ruidos en consola
      if (e.message.includes('Can only be used on') || e.message.includes('Service Worker')) {
        console.warn("OneSignal: Notificaciones desactivadas. Para probarlas, usa http://localhost o un dominio HTTPS.");
      } else {
        console.error("OneSignal Error:", e);
      }
    }
  });
}
if (!window.initOneSignal) window.initOneSignal = initOneSignal;

export { createClient, SUPABASE_URL, SUPABASE_ANON_KEY };
