import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

export { createClient };
export const SUPABASE_URL      = "https://wwnfonkvemimwiqjpkij.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3bmZvbmt2ZW1pbXdpcWpwa2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MzY0MzUsImV4cCI6MjA4MzQxMjQzNX0.n5VW-3U0r2nRlwC8pDstQLowu9MZ3aWHMzXVVNFQaDo";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    detectSessionInUrl: false,
    persistSession:     true,
    autoRefreshToken:   true,
    storageKey:         'karpus_auth_token_v2'
  }
});

export const TERMS_VERSION = '1.0';

// ── Autenticación ─────────────────────────────────────────────────────────────
export async function ensureRole(requiredRoles) {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  
  // Usar getSession() primero (más rápido)
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.user) { 
    console.warn('[ensureRole] No session found');
    window.location.href = 'login.html'; 
    return null; 
  }

  const user = session.user;

  // Obtener perfil y aceptación de términos en paralelo
  const [profileRes, termsRes] = await Promise.all([
    supabase.from('profiles').select('id, role, name, email, avatar_url, phone, bio').eq('id', user.id).maybeSingle(),
    supabase.from('terms_acceptance').select('user_id').eq('user_id', user.id).eq('terms_version', TERMS_VERSION).maybeSingle()
  ]);

  if (profileRes.error) console.error('[ensureRole] Profile error:', profileRes.error);
  if (termsRes.error) console.error('[ensureRole] Terms error:', termsRes.error);

  const profile = profileRes.data;
  const terms   = termsRes.data;

  // 1. Si el perfil no existe, intentar crearlo automáticamente
  let resolvedProfile = profile;
  if (!profile && !profileRes.error) {
    console.warn('[ensureRole] Profile not found, creating basic profile for:', user.id);
    const { data: newProfile } = await supabase.from('profiles').insert({
      id:    user.id,
      email: user.email,
      name:  user.user_metadata?.name || user.email?.split('@')[0] || 'Usuario',
      role:  user.user_metadata?.role || 'padre'
    }).select('id, role, name, email, avatar_url, phone, bio').single();
    resolvedProfile = newProfile;
  }

  if (!resolvedProfile) {
    console.warn('[ensureRole] Could not resolve profile for user:', user.id);
    // No redirigir — dejar que el panel maneje el estado sin perfil
  }

  if (resolvedProfile && !roles.includes(resolvedProfile.role?.toLowerCase())) {
    console.warn('[ensureRole] Role mismatch. User has:', resolvedProfile.role, 'Expected one of:', roles);
    await supabase.auth.signOut();
    window.location.href = 'login.html?error=role';
    return null;
  }

  // 2. Verificar aceptación de términos (solo si es panel real, no login)
  // Si termsRes.error existe (ej: tabla no existe), permitimos pasar para no bloquear la app
  if (!terms && !termsRes.error && !window.location.pathname.includes('login.html')) {
    console.warn('[ensureRole] Terms not accepted yet');
    window.location.href = 'login.html?reason=terms';
    return null;
  }

  return { user, profile: resolvedProfile };
}

// ── Notificaciones internas (realtime) ────────────────────────────────────────
export async function subscribeNotifications(userId, onNotif) {
  if (!userId) return null;
  return supabase.channel('notif_' + userId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + userId }, (payload) => {
      if (onNotif) onNotif(payload.new);
    })
    .subscribe();
}

// ── Email via Resend (Edge Function send-email) ───────────────────────────────
export async function sendEmail(to, subject, html, text) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    // En local el CORS puede fallar — silencioso
    const res = await fetch(SUPABASE_URL + '/functions/v1/send-email', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + (session?.access_token || SUPABASE_ANON_KEY)
      },
      body: JSON.stringify({ to, subject, html, text })
    });
    if (!res.ok) {
      console.warn('[sendEmail] HTTP ' + res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[sendEmail] Error (silencioso en local):', e.message);
    return null;
  }
}

// ── Push via OneSignal (Edge Function send-push) ──────────────────────────────
export async function sendPush(payload) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    // Use fetch directly with the anon key — avoids JWT verification issues
    // The Edge Function uses service role internally, so anon key is sufficient for auth header
    const res = await fetch(SUPABASE_URL + '/functions/v1/send-push', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + (session?.access_token || SUPABASE_ANON_KEY),
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.status);
      console.warn('[sendPush] HTTP ' + res.status + ':', errText);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[sendPush] Error (silencioso):', e.message);
    return null;
  }
}

// ── Eventos del sistema (process-event) ──────────────────────────────────────
export async function emitEvent(type, data) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/process-event', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + (session?.access_token || SUPABASE_ANON_KEY)
      },
      body: JSON.stringify({ type, data })
    });
    if (!res.ok) { console.warn('[emitEvent] HTTP ' + res.status); return null; }
    return await res.json();
  } catch (e) {
    console.warn('[emitEvent] Error:', e.message);
    return null;
  }
}

// ── Helpers de eventos específicos ───────────────────────────────────────────

/** Notificar pago aprobado al padre */
export async function notifyPaymentApproved(paymentId, parentEmail, studentName, amount, month) {
  return Promise.all([
    sendPush({ user_id: parentEmail, title: 'Pago Aprobado ✅', message: 'Tu pago de ' + amount + ' para ' + month + ' fue aprobado.', type: 'payment', link: '/panel_padres.html' }),
    emitEvent('payment.approved', { payment_id: paymentId, parent_email: parentEmail, student_name: studentName, amount, month })
  ]);
}

/** Notificar entrada/salida al padre */
export async function notifyAttendance(parentEmail, studentName, type, time) {
  return emitEvent('attendance.' + type, { parent_email: parentEmail, student_name: studentName, time });
}

/** Notificar incidente al padre */
export async function notifyIncident(parentEmail, studentName, severity, description) {
  return emitEvent('incident.reported', { parent_email: parentEmail, student_name: studentName, severity, description });
}

/** Notificar nueva tarea a los padres del aula */
export async function notifyTaskCreated(classroomId, title, dueDate) {
  return emitEvent('task.created', { classroom_id: classroomId, title, due_date: dueDate });
}

/** Notificar comprobante subido al staff */
export async function notifyReceiptUploaded(studentId, amount, month) {
  return emitEvent('payment.receipt_uploaded', { student_id: studentId, amount, month });
}

// ── OneSignal ─────────────────────────────────────────────────────────────────
export async function initOneSignal(currentUser = null) {
  let user = currentUser;
  if (!user) {
    const { data } = await supabase.auth.getUser();
    user = data?.user;
  }
  if (!user) return;

  // No inicializar OneSignal si no estamos en el dominio de producción
  if (window.location.hostname !== 'karpuskids.com' && window.location.hostname !== 'www.karpuskids.com') {
    console.info('[OneSignal] Omitiendo inicialización en entorno local/desarrollo');
    return;
  }

  const ONESIGNAL_APP_ID = "47ce2d1e-152e-4ea7-9ddc-8e2142992989";

  if (!document.getElementById('onesignal-sdk')) {
    const s = document.createElement('script');
    s.id = 'onesignal-sdk';
    s.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    s.defer = true;
    document.head.appendChild(s);
  }

  window.OneSignal = window.OneSignal || [];
  window.OneSignalDeferred = window.OneSignalDeferred || [];

  if (window.OneSignalInitialized) return;
  window.OneSignalInitialized = true;

  OneSignalDeferred.push(async function(OneSignal) {
    try {
      const host = window.location.hostname;
      const isLocal   = host === 'localhost' || host === '127.0.0.1';
      const isProd    = host === 'karpuskids.com' || host.endsWith('.karpuskids.com');
      if (!isLocal && !isProd) { console.warn('[OneSignal] Dominio no permitido, omitiendo.'); return; }

      await OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        allowLocalhostAsSecureOrigin: true,
        serviceWorkerParam: { scope: '/' },
        serviceWorkerPath: 'OneSignalSDKWorker.js',
        notifyButton: { enable: false }
      });

      // Vincular usuario externo para targeting por user_id
      if (OneSignal.User?.externalId !== user.id) {
        await OneSignal.login(user.id);
      }

      console.log('[OneSignal] Inicializado para usuario:', user.id);
    } catch (e) {
      console.warn('[OneSignal] Error de inicialización:', e.message || e);
    }
  });
}
