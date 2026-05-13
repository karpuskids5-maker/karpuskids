// Supabase JS — cargado localmente (js/shared/supabase-js.min.js via script tag en HTML)
// El UMD expone window.supabase.createClient
import { createClient } from "./supabase-wrapper.js";

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

// ── Auto-refresh: detectar JWT expirado y refrescar sesión ───────────────────
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED') {
    // Token refrescado — no hacer nada, las próximas requests usarán el nuevo token
  }
  if (event === 'SIGNED_OUT') {
    // Sesión cerrada — redirigir al login
    if (!window.location.pathname.includes('login.html') &&
        !window.location.pathname.includes('index.html')) {
      window.location.href = 'login.html';
    }
  }
});

// Interceptar errores 401 globalmente y refrescar token
// IMPORTANTE: usar flag para evitar loop infinito
let _refreshing = false;
const _originalFetch = window.fetch;
window.fetch = async function(...args) {
  const res = await _originalFetch.apply(this, args);
  
  if (res.status === 401 && !_refreshing) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    // Solo interceptar requests a Supabase REST/Storage, no a auth endpoints
    if (url.includes('supabase.co') && !url.includes('/auth/') && !url.includes('/token')) {
      _refreshing = true;
      try {
        const { data: refreshed, error } = await supabase.auth.refreshSession();
        if (error || !refreshed?.session) {
          // Refresh falló — redirigir al login
          if (!window.location.pathname.includes('login.html')) {
            window.location.href = 'login.html';
          }
          return res; // retornar la respuesta 401 original
        }
        // Refresh exitoso — reintentar la request original con el nuevo token
        return _originalFetch.apply(this, args);
      } catch (_) {
        return res;
      } finally {
        _refreshing = false;
      }
    }
  }
  return res;
};

// ── Global DB error handler — muestra toast automático en errores de DB ───────
window.addEventListener('karpus:db-error', (e) => {
  const msg = e.detail?.message || 'Error de conexión';
  if (window.Helpers?.toast) {
    window.Helpers.toast('Error: ' + msg, 'error');
  }
});

// ── Email error handler ───────────────────────────────────────────────────────
window.addEventListener('karpus:email-error', (e) => {
  const { message, to, subject } = e.detail || {};
  // Only show toast if Helpers is available (panels)
  if (window.Helpers?.toast) {
    window.Helpers.toast('⚠️ Correo no enviado: ' + (message || 'Error desconocido'), 'warning');
  }
  // Always log to console for debugging
});

// ── Global error → log to DB ─────────────────────────────────────────────────
window.addEventListener('error', (e) => {
  // Don't log if it's a network/connection error (would cause infinite loop)
  const msg = e.message || '';
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to load')) return;
  import('./db-utils.js').then(({ logError }) => {
    const panel = window.location.pathname.split('/').pop().replace('.html','') || 'unknown';
    logError(panel, msg, e.error?.stack || '', e.filename || '').catch(() => {});
  }).catch(() => {});
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason);
  // Skip: network errors, OneSignal, 409 conflicts, IDB errors, lucide — these would loop or are non-actionable
  const SKIP_PATTERNS = [
    'indexeddb','network','fetch','onesignal','409','conflict',
    'failed to load','supabase','connection','lucide',
    'load failed','aborted','cancelled','net::err',
    'the operation was aborted','signal is aborted',
    'resizeobserver loop','script error'
  ];
  const skip = SKIP_PATTERNS.some(k => msg.toLowerCase().includes(k));
  if (skip) return;
  import('./db-utils.js').then(({ logError }) => {
    const panel = window.location.pathname.split('/').pop().replace('.html','') || 'unknown';
    logError(panel, msg, e.reason?.stack || '', window.location.pathname).catch(() => {});
  }).catch(() => {});
});

export const TERMS_VERSION = '1.0';

// ── Session Guard — verificar sesión en cada cambio de sección ───────────────
// Llama esto desde los módulos de navegación para proteger rutas del cliente
export async function guardSession() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      window.location.href = 'login.html';
      return false;
    }
    // Verificar expiración del token
    const expiresAt = session.expires_at || 0;
    const nowSecs   = Math.floor(Date.now() / 1000);
    if (expiresAt - nowSecs < 30) {
      const { error } = await supabase.auth.refreshSession();
      if (error) { window.location.href = 'login.html'; return false; }
    }
    return true;
  } catch (_) {
    window.location.href = 'login.html';
    return false;
  }
}

// ── Autenticación ─────────────────────────────────────────────────────────────
export async function ensureRole(requiredRoles) {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  
  // Paso 1: Verificar sesión local (rápido, sin red)
  let session;
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('session_timeout')), 5000))
    ]);
    session = result.data?.session;
    if (result.error || !session?.user) {
      window.location.href = 'login.html';
      return null;
    }
  } catch (_) {
    window.location.href = 'login.html';
    return null;
  }

  // Paso 2: Si el token está próximo a expirar (< 5 min), refrescarlo
  const expiresAt = session.expires_at || 0;
  const nowSecs   = Math.floor(Date.now() / 1000);
  if (expiresAt - nowSecs < 300) {
    try {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr || !refreshed?.session) {
        window.location.href = 'login.html';
        return null;
      }
      // Usar el token refrescado
      session = refreshed.session;
    } catch (_) {
      window.location.href = 'login.html';
      return null;
    }
  }

  // Paso 3: Validar token contra el servidor (detecta tokens revocados)
  // Solo si el token parece válido localmente pero queremos confirmar
  let user = session.user;
  try {
    const { data: { user: serverUser }, error: userErr } = await Promise.race([
      supabase.auth.getUser(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('getUser_timeout')), 4000))
    ]);
    if (userErr || !serverUser) {
      // Token inválido en el servidor — limpiar sesión y redirigir
      await supabase.auth.signOut();
      window.location.href = 'login.html';
      return null;
    }
    user = serverUser;
  } catch (_) {
    // Timeout de red — continuar con sesión local (mejor UX que redirigir)
  }

  // Obtener perfil y aceptación de términos en paralelo — con timeout de 8s
  const TIMEOUT = 8000;
  const withTimeout = (promise) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT))
  ]);

  const [profileRes, termsRes] = await Promise.all([
    withTimeout(supabase.from('profiles').select('id, role, name, email, avatar_url, phone, bio').eq('id', user.id).maybeSingle()),
    withTimeout(supabase.from('terms_acceptance').select('user_id').eq('user_id', user.id).eq('terms_version', TERMS_VERSION).maybeSingle())
  ]).catch(() => [{ data: null, error: new Error('timeout') }, { data: null, error: new Error('timeout') }]);

  if (profileRes.error) { /* profile error — handled below */ }
  if (termsRes.error)   { /* terms error — handled below */ }

  const profile = profileRes.data;
  const terms   = termsRes.data;

  // 1. Si el perfil no existe, intentar crearlo automáticamente
  let resolvedProfile = profile;
  if (!profile && !profileRes.error) {
    const { data: newProfile } = await supabase.from('profiles').insert({
      id:    user.id,
      email: user.email,
      name:  user.user_metadata?.name || user.email?.split('@')[0] || 'Usuario',
      role:  user.user_metadata?.role || 'padre'
    }).select('id, role, name, email, avatar_url, phone, bio').single();
    resolvedProfile = newProfile;
  }

  if (!resolvedProfile) {
    // No redirigir — dejar que el panel maneje el estado sin perfil
  }

  if (resolvedProfile && !roles.includes(resolvedProfile.role?.toLowerCase())) {
    // Admin can access any panel (they have their own panel_control.html)
    if (resolvedProfile.role?.toLowerCase() === 'admin') {
      window.location.href = 'panel_control.html';
      return null;
    }
    await supabase.auth.signOut();
    window.location.href = 'login.html?error=role';
    return null;
  }

  // 2. Verificar aceptación de términos (solo si es panel real, no login)
  // Si termsRes.error existe (ej: tabla no existe), permitimos pasar para no bloquear la app
  if (!terms && !termsRes.error && !window.location.pathname.includes('login.html')) {
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
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to, subject, html, text }
    });

    if (error) {
      // Log to console so it's visible in browser devtools
      const errMsg = error?.message || JSON.stringify(error);
      window.dispatchEvent(new CustomEvent('karpus:email-error', {
        detail: { message: errMsg, to, subject }
      }));
      return null;
    }

    if (data?.error) {
      window.dispatchEvent(new CustomEvent('karpus:email-error', {
        detail: { message: data.error, to, subject }
      }));
      return null;
    }

    return data;
  } catch (e) {
    window.dispatchEvent(new CustomEvent('karpus:email-error', {
      detail: { message: e?.message || String(e), to, subject }
    }));
    return null;
  }
}



// ── Push via OneSignal (Edge Function send-push) ──────────────────────────────
export async function sendPush(payload) {
  try {
    // Usamos invoke sin headers manuales para que el SDK use el token de sesión actual.
    // Esto evita errores 401 si la anon key no es suficiente para la función.
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: payload
    });

    if (error) {
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

// ── Eventos del sistema (process-event) ──────────────────────────────────────
export async function emitEvent(type, data) {
  try {
    const { data: resData, error } = await supabase.functions.invoke('process-event', {
      body: { type, data }
    });
    
    if (error) {
      return null;
    }
    
    // ✅ Log de éxito para que la Maestra vea la confirmación
    if (resData?.ok) {
    }
    
    return resData;
  } catch (e) {
    return null;
  }
}

// ── Helpers de eventos específicos ───────────────────────────────────────────

/** Notificar pago aprobado al padre */
export async function notifyPaymentApproved(paymentId, parentEmail, studentName, amount, month) {
  return Promise.all([
    // sendPush needs parent UUID — fetch it from the payment record
    (async () => {
      try {
        const { data: p } = await supabase
          .from('payments')
          .select('students:student_id(parent_id)')
          .eq('id', paymentId)
          .maybeSingle();
        const parentId = p?.students?.parent_id;
        if (parentId) {
          return sendPush({ user_id: parentId, title: 'Pago Aprobado ✅', message: 'Tu pago de ' + amount + ' para ' + month + ' fue aprobado.', type: 'payment', link: '/panel_padres.html' });
        }
      } catch (_) {}
    })(),
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
export function initOneSignal(currentUser = null) {
  // Ejecutar completamente en background — NUNCA bloquear el hilo principal
  _initOneSignalAsync(currentUser).catch(() => {});
}

async function _initOneSignalAsync(currentUser) {
  try {
    const host = window.location.hostname;
    const isProd = host === 'karpuskids.com' || host === 'www.karpuskids.com' || host.endsWith('.karpuskids.com');
    if (!isProd) return; // No inicializar en localhost

    if (window.OneSignalInitialized) return;
    window.OneSignalInitialized = true;

    let user = currentUser;
    if (!user) {
      const { data } = await supabase.auth.getUser();
      user = data?.user;
    }
    if (!user) return;

    // Verificar IndexedDB con timeout corto
    const idbOk = await Promise.race([
      new Promise(resolve => {
        try {
          if (!window.indexedDB) return resolve(false);
          const req = indexedDB.open('_karpus_idb_test', 1);
          req.onsuccess = () => { req.result.close(); resolve(true); };
          req.onerror   = () => resolve(false);
        } catch (_) { resolve(false); }
      }),
      new Promise(resolve => setTimeout(() => resolve(false), 500))
    ]);
    if (!idbOk) return;

    const ONESIGNAL_APP_ID = "47ce2d1e-152e-4ea7-9ddc-8e2142992989";

    if (!document.getElementById('onesignal-sdk')) {
      const s = document.createElement('script');
      s.id = 'onesignal-sdk';
      s.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
      s.defer = true;
      document.head.appendChild(s);
    }

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async function(OneSignal) {
      try {
        await OneSignal.init({
          appId: ONESIGNAL_APP_ID,
          allowLocalhostAsSecureOrigin: false,
          serviceWorkerParam: { scope: '/' },
          serviceWorkerPath: 'OneSignalSDKWorker.js',
          notifyButton: { enable: false },
          welcomeNotification: { disable: false }
        });

        // Vincular usuario — sin await largo
        OneSignal.login(user.id).catch(() => {});

        // Guardar subscription ID cuando esté disponible
        setTimeout(async () => {
          try {
            const subId = OneSignal.User?.PushSubscription?.id;
            if (subId) {
              await supabase.from('profiles').update({ onesignal_player_id: subId }).eq('id', user.id);
            }
          } catch (_) {}
        }, 3000);

      } catch (_) {}
    });
  } catch (_) {}
}
