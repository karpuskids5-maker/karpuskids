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
    if (!session) {
      console.warn('No hay sesión activa para enviar notificaciones push');
      return null;
    }

    const { data, error } = await supabase.functions.invoke('send-push', { 
      body: payload,
      // No incluimos el header manualmente para dejar que el SDK use el de la sesión actual
    });
    
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('Error enviando push:', e);
    // No relanzamos el error para evitar que rompa el flujo principal (ej. calificar tarea)
    return null;
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
      // Sincronizar ID si ya está inicializado
      if (OneSignal.initialized) {
        if (OneSignal.User.externalId !== user.id) {
          await OneSignal.login(user.id);
        }
        return;
      }

      await OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        allowLocalhostAsSecureOrigin: true,
        serviceWorkerParam: { scope: "/" },
        serviceWorkerPath: "OneSignalSDKWorker.js",
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

      // 3. Sincronización de Usuario (External ID)
      try {
        // En v16, OneSignal.login(externalId) es la forma correcta.
        // Verificamos si ya está logueado para evitar el ruido del error 409 en consola si es posible,
        // aunque OneSignal a veces lo lanza igual internamente.
        if (OneSignal.User.externalId !== user.id) {
          await OneSignal.login(user.id);
        }
      } catch (loginErr) {
        // Silenciamos el error 409 Conflict que ocurre si el ID ya está vinculado
        if (loginErr.message?.includes('409') || String(loginErr).includes('409')) {
          console.info("OneSignal: Usuario ya sincronizado.");
        } else {
          console.warn("OneSignal Login Note:", loginErr.message || loginErr);
        }
      }
      
      // 4. Tagueo por roles
      const { data: profile } = await supabase.from('profiles').select('role, name').eq('id', user.id).maybeSingle();
      if (profile) {
        OneSignal.User.addTag("role", profile.role);
        OneSignal.User.addTag("user_name", profile.name);
        
        if (profile.role === 'padre') {
          const { data: children } = await supabase.from('students').select('id').eq('parent_id', user.id);
          if (children && children.length > 0) {
            OneSignal.User.addTag("children_ids", children.map(c => c.id).join(','));
          }
        }
      }

      console.log("OneSignal: Inicialización exitosa");
    } catch (e) {
      const msg = e.message || '';
      // Silenciar errores comunes de comunicación SW en desarrollo
      if (msg.includes('Can only be used on') || msg.includes('Service Worker') || msg.includes('not available') || msg.includes('postMessage') || msg.includes('pending')) {
        // Silencio en consola para no confundir al usuario
      } else {
        console.warn("OneSignal Status:", msg);
      }
    }
  });
}
if (!window.initOneSignal) window.initOneSignal = initOneSignal;

export { createClient, SUPABASE_URL, SUPABASE_ANON_KEY };
