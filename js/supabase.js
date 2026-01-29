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

export { createClient, SUPABASE_URL, SUPABASE_ANON_KEY };
