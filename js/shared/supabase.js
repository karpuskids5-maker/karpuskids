import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

export { createClient };
export const SUPABASE_URL = "https://wwnfonkvemimwiqjpkij.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3bmZvbmt2ZW1pbXdpcWpwa2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MzY0MzUsImV4cCI6MjA4MzQxMjQzNX0.n5VW-3U0r2nRlwC8pDstQLowu9MZ3aWHMzXVVNFQaDo";

/**
 * Cliente centralizado de Supabase
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'karpus_auth_token_v2'
  }
});

/**
 * Asegura que el usuario tenga el rol correcto antes de proceder
 */
export async function ensureRole(requiredRoles) {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    window.location.href = 'login.html';
    return null;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, name, email')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !roles.includes(profile.role?.toLowerCase())) {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
    return null;
  }

  return { user, profile };
}

/**
 * Suscripción a notificaciones del sistema
 */
export async function subscribeNotifications(userId, onNotif) {
  if (!userId) return null;
  
  const channel = supabase.channel(`notif_${userId}`)
    .on('postgres_changes', { 
      event: 'INSERT', 
      schema: 'public', 
      table: 'notifications', 
      filter: `user_id=eq.${userId}` 
    }, (payload) => {
      if (onNotif) onNotif(payload.new);
    })
    .subscribe();
    
  return channel;
}

/**
 * Enviar correo vía Edge Function
 */
export async function sendEmail(to, subject, html, text) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`
      },
      body: JSON.stringify({ to, subject, html, text })
    });
    return await res.json();
  } catch (e) {
    console.error('Error enviando correo:', e);
  }
}

/**
 * Enviar notificación push
 */
export async function sendPush(payload) {
  try {
    const { data, error } = await supabase.functions.invoke('send-push', { 
      body: payload
    });
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('Error enviando push:', e);
    return null;
  }
}

/**
 * Emitir evento al sistema de procesamiento
 */
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
    return await res.json();
  } catch (e) {
    console.error('Error emitiendo evento:', e);
  }
}

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
      // Solo inicializar si estamos en el dominio permitido o es localhost
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const isCorrectDomain = window.location.hostname === 'karpuskids.com' || window.location.hostname.endsWith('.karpuskids.com');
      
      if (!isLocal && !isCorrectDomain) {
        console.warn("OneSignal: Domain mismatch, skipping initialization.");
        return;
      }

      await OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        allowLocalhostAsSecureOrigin: true,
        serviceWorkerParam: { scope: "/" },
        serviceWorkerPath: "OneSignalSDKWorker.js",
        notifyButton: { enable: false },
      });

      // Login del usuario
      if (OneSignal.User.externalId !== user.id) {
        await OneSignal.login(user.id);
      }
    } catch (e) {
      console.warn("OneSignal Status:", e);
    }
  });
}
