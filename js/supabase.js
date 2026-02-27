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
  const channel = supabase
    .channel('notif_' + user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (payload) => {
      const n = payload.new;
      if (onNotif) onNotif(n);
    })
    .subscribe();
  return channel;
}

export async function sendPush(payload) {
  const { data, error } = await supabase.functions.invoke('send-push', { body: payload });
  if (error) throw error;
  return data;
}
if (!window.sendPush) window.sendPush = sendPush;

export async function initOneSignal() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const ONESIGNAL_APP_ID = "47ce2d1e-152e-4ea7-9ddc-8e2142992989";
  
  if (!window.OneSignal) {
    const script = document.createElement('script');
    script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignal.JS";
    script.async = true;
    document.head.appendChild(script);
  }

  window.OneSignal = window.OneSignal || [];
  OneSignal.push(async function() {
    await OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      safari_web_id: "web.onesignal.auto.10425e70-6593-4a12-8758-69279093e878", // Opcional si se requiere Safari
      allowLocalhostAsSecureOrigin: true,
      notifyButton: {
        enable: false, // Usaremos el slidedown para mayor profesionalismo
      },
      promptOptions: {
        slidedown: {
          enabled: true,
          autoPrompt: true,
          timeDelay: 5, // Aparece tras 5 segundos
          pageViews: 1,
          actionMessage: "¿Deseas recibir notificaciones sobre tareas, pagos y avisos de Karpus Kids?",
          acceptButtonText: "Sí, recibir",
          cancelButtonText: "Ahora no",
          categories: {
            tags: [
              { tag: "user_type", label: "Tipo de Usuario" }
            ]
          }
        }
      }
    });

    // Vincular al usuario de Supabase con OneSignal
    await OneSignal.login(user.id);
    
    // Obtener el perfil para taguear al usuario
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile) {
      OneSignal.User.addTag("role", profile.role);
    }
  });
}
if (!window.initOneSignal) window.initOneSignal = initOneSignal;

export { createClient, SUPABASE_URL, SUPABASE_ANON_KEY };
