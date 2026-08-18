import { logError } from './db-utils.js';
import { Helpers } from './helpers.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Supabase JS — cargado localmente (js/shared/supabase-js.min.js via script tag en HTML)
// El UMD expone window.supabase.createClient
import { createClient } from "./supabase-wrapper.js";

export { createClient };
export { SUPABASE_URL, SUPABASE_ANON_KEY };

const options = {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'karpus_auth_token_v2'
  },
  global: {
    headers: { 'x-application-name': 'karpus-kids' }
  },
  db: {
    schema: 'public'
  }
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);

// ── Auto-refresh: detectar JWT expirado y refrescar sesión ───────────────────
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED') Helpers.safeLog('log', '✅ JWT Refrescado');
  if (event === 'SIGNED_OUT') {
    // ✅ LIMPIEZA TOTAL DE CANALES AL SALIR
    if (window.RealtimeManager) window.RealtimeManager.unsubscribeAll();
    localStorage.removeItem('karpus_directora_state');
    localStorage.removeItem('karpus_maestra_state');
    localStorage.removeItem('karpus_padre_state');
    localStorage.removeItem('karpus_asistente_state');
    window.location.href = 'login.html';
  }
  if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
    // Guardar rastro de última actividad
    if (session?.user) {
      // Usar then() en lugar de catch() directo sobre el builder para evitar TypeError
      supabase.from('profiles')
        .update({ last_sign_in_at: new Date().toISOString() })
        .eq('id', session.user.id)
        .then(({ error }) => {
          if (error) Helpers.safeLog('warn', '[Auth] No se pudo actualizar last_sign_in_at:', error);
        });
    }
  }
});

// Interceptar errores 401 globalmente y refrescar token
// IMPORTANTE: usar flag para evitar loop infinito
let _refreshing = false;
const _originalFetch = window.fetch;
window.fetch = async function(...args) {
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  const isSupabase = url && url.includes(SUPABASE_URL);
  
  if (isSupabase) {
    const options = args[1] || {};
    options.headers = options.headers || {};
    
    // Inyectar apikey solo si falta (útil para Edge Functions o fetch directo)
    if (!options.headers['apikey']) {
      options.headers['apikey'] = SUPABASE_ANON_KEY;
    }
    // Inyectar Authorization Bearer si no está presente y tenemos sesión (para mayor seguridad)
    if (!options.headers['Authorization']) {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) {
        options.headers['Authorization'] = `Bearer ${data.session.access_token}`;
      } else {
        options.headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
      }
    }
    args[1] = options;
  }

  const res = await _originalFetch.apply(this, args);
  
  // Interceptar 401 para intentar refrescar sesión
  if (res.status === 401 && isSupabase && !_refreshing && !url.includes('/auth/v1/')) {
    _refreshing = true;
    try {
      Helpers.safeLog('warn', '[supabase-js] 401 detectado, intentando refrescar sesión...');
      // Intentar refresh una única vez
      const { data: refreshed, error } = await supabase.auth.refreshSession();
      if (!error && refreshed?.session) {
        Helpers.safeLog('log', '[supabase-js] Sesión refrescada con éxito. Reintentando petición...');
        
        // Clonar opciones y actualizar el header Authorization con el nuevo token
        const retryOptions = args[1] || {};
        retryOptions.headers = { 
          ...retryOptions.headers, 
          'Authorization': `Bearer ${refreshed.session.access_token}` 
        };
        args[1] = retryOptions;

        return _originalFetch.apply(this, args);
      } else {
        Helpers.safeLog('error', '[supabase-js] Falló el refresco de sesión:', error);
        // Si el refresh falla con 401, redirigir a login para evitar loop
        window.location.href = 'login.html';
      }
    } catch (e) {
      Helpers.safeLog('error', '[supabase-js] Error al intentar refrescar sesión:', e);
      window.location.href = 'login.html';
    } finally {
      _refreshing = false;
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
  const panel = window.location.pathname.split('/').pop().replace('.html','') || 'unknown';
  logError(panel, msg, e.error?.stack || '', e.filename || '').catch(() => {});
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
  const panel = window.location.pathname.split('/').pop().replace('.html','') || 'unknown';
  logError(panel, msg, e.reason?.stack || '', window.location.pathname).catch(() => {});
});

// ── Session Timeout por Inactividad (30 min) ──────────────────────────────────
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos
let _sessionTimer = null;
let _sessionOverlay = null;

function _createSessionLockOverlay() {
  if (_sessionOverlay) return _sessionOverlay;
  const overlay = document.createElement('div');
  overlay.id = 'sessionLockOverlay';
  overlay.className = 'fixed inset-0 z-[9999] bg-slate-900/95 flex items-center justify-center backdrop-blur-sm';
  overlay.innerHTML = `
    <div class="text-center p-8 max-w-sm mx-4">
      <div class="w-20 h-20 mx-auto mb-6 bg-slate-700/50 rounded-full flex items-center justify-center">
        <svg class="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
        </svg>
      </div>
      <h2 class="text-xl font-black text-white mb-2">Sesión Bloqueada</h2>
      <p class="text-slate-400 text-sm mb-6">Tu sesión expiró por inactividad. Por seguridad, se cerró automáticamente.</p>
      <button onclick="window._sessionUnlock()" class="px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white font-black rounded-2xl transition-colors text-sm">
        Volver a Iniciar Sesión
      </button>
    </div>`;
  document.body.appendChild(overlay);
  _sessionOverlay = overlay;
  return overlay;
}

function _resetSessionTimer() {
  clearTimeout(_sessionTimer);
  _sessionTimer = setTimeout(() => {
    supabase.auth.signOut().catch(() => {});
    _createSessionLockOverlay();
  }, SESSION_TIMEOUT_MS);
}

window._sessionUnlock = () => {
  window.location.href = 'login.html';
};

export function initSessionTimeout() {
  if (_sessionTimer) return;
  ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(evt => {
    document.addEventListener(evt, _resetSessionTimer, { passive: true });
  });
  _resetSessionTimer();
}

// ── Sanitizar payloads de notificaciones push ──────────────────────────────────
export function sanitizePushPayload(payload) {
  if (!payload) return payload;
  const strip = (str) => typeof str === 'string'
    ? str.replace(/<[^>]*>/g, '').replace(/javascript:/gi, '').replace(/on\w+\s*=/gi, '').trim().substring(0, 200)
    : str;
  return { ...payload, title: strip(payload.title), message: strip(payload.message) };
}

// ── Validación de archivos subidos ─────────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
const BLOCKED_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.sh', '.php', '.js', '.html', '.svg', '.scr', '.com', '.pif', '.vbs', '.wsf']);

export function validateFileUpload(file) {
  if (!file) return { ok: false, error: 'No se seleccionó archivo' };
  if (file.size > 50 * 1024 * 1024) return { ok: false, error: 'El archivo supera el límite de 50MB' };
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) return { ok: false, error: `Tipo de archivo no permitido: ${ext}` };
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    return { ok: false, error: `Tipo MIME no permitido: ${file.type}` };
  }
  return { ok: true };
}

export function safeFileName(originalName) {
  const ext = originalName.split('.').pop().toLowerCase();
  return `${crypto.randomUUID()}.${ext}`;
}

// ── Validación de inputs numéricos ─────────────────────────────────────────────
export function validateTemperature(temp) {
  const t = parseFloat(temp);
  if (isNaN(t) || t < 30 || t > 45) return { ok: false, error: 'Temperatura inválida (30-45°C)' };
  return { ok: true, value: t };
}

export function validateOz(oz) {
  const o = parseFloat(oz);
  if (isNaN(o) || o < 0 || o > 32) return { ok: false, error: 'Onzas inválidas (0-32oz)' };
  return { ok: true, value: o };
}

export function sanitizeText(text, maxLength = 500) {
  if (typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '').replace(/javascript:/gi, '').replace(/on\w+\s*=/gi, '').trim().substring(0, maxLength);
}

export const TERMS_VERSION = '1.0';

/**
 * ensureRole: Verifica el rol del usuario actual y retorna {user, profile}
 */
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
    const sanitized = sanitizePushPayload(payload);
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: sanitized
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
    return resData;
  } catch (e) {
    return null;
  }
}

// ── Notificador de pago aprobado (usado por directora/payments_clean.js) ──────
export async function notifyPaymentApproved(paymentId, parentEmail, studentName, amount, month) {
  return Promise.all([
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

// ── PWA: actualización profesional ───────────────────────────────────────────
// La detección de versiones y la UI (banner obligatorio + pantalla de
// instalación tipo app nativa) viven en js/pwa-updater.js
// (window.KarpusPwaUpdater). Aquí solo:
//   - Registra el Service Worker (mismo archivo que usa OneSignal → mismo
//     scope, el navegador deduplica el registro). No interfiere con las push.
//   - Delega la detección de versiones y el flujo de actualización a la UI
//     profesional. El patrón "waiting worker" (ver OneSignalSDKWorker.js)
//     garantiza que NUNCA se fuerce una recarga sin que el usuario acepte.
//   - Si el script de la UI aún no cargó (página vieja en caché), usa el
//     mecanismo legacy de recarga controlada para nunca quedarse atascado.
// Idempotente: seguro de llamar desde cualquier panel y coexistir con OneSignal.
function initPwaUpdater() {
  try {
    if (window.__karpusPwaStarted) return;
    if (!('serviceWorker' in navigator)) return;
    window.__karpusPwaStarted = true;

    // Registrar el worker (mismo archivo que usa OneSignal → mismo scope)
    navigator.serviceWorker.register('OneSignalSDKWorker.js', { scope: '/' }).catch(() => {});

    // Delegar la detección de versiones a la UI profesional.
    let tries = 0;
    const startUpdater = () => {
      if (window.KarpusPwaUpdater) { window.KarpusPwaUpdater.start(); return; }
      if (++tries < 40) setTimeout(startUpdater, 250);
      else legacyAutoReload();
    };
    startUpdater();
  } catch (_) {}
}

// Fallback para páginas viejas en caché sin js/pwa-updater.js
// Respetuoso: nunca recarga automáticamente. Solo guarda la versión nueva y,
// si el usuario ya aceptó una actualización en esta sesión, recarga una vez.
function legacyAutoReload() {
  const VERSION_KEY = 'karpus_pwa_version';
  const ACCEPT_KEY  = 'karpus_pwa_accepted';
  const checkVersion = async () => {
    try {
      const res = await fetch('/version.json', { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.version) return;
      const known = localStorage.getItem(VERSION_KEY);
      if (known && known !== data.version) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.filter(k => k.startsWith('karpus-')).map(k => caches.delete(k)));
        } catch (_) {}
        localStorage.setItem(VERSION_KEY, data.version);
        // Solo recarga si el usuario aceptó explícitamente el flujo
        let accepted = false;
        try { accepted = !!sessionStorage.getItem(ACCEPT_KEY); sessionStorage.removeItem(ACCEPT_KEY); } catch (_) {}
        if (accepted) window.location.reload();
      } else if (!known) {
        localStorage.setItem(VERSION_KEY, data.version);
      }
    } catch (_) {}
  };
  checkVersion();
  setInterval(checkVersion, 60000);
}

// ── OneSignal ─────────────────────────────────────────────────────────────────
export function initOneSignal(currentUser = null) {
  // PWA: registro + auto-update (independiente de OneSignal)
  initPwaUpdater();
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

        // Vincular usuario — esperar a que el external_id quede enlazado
        if (user?.id) {
          await OneSignal.login(String(user.id)).catch(e => {
            Helpers.safeLog('warn', '[OneSignal] Login deferred error:', e);
          });
        }

        // Re-vincular suscripción si el permiso ya estaba concedido.
        // Después de borrar suscripciones desde el dashboard de OneSignal, el SDK
        // pierde la suscripción interna. OptIn explícito la recrea SIN pedir permiso
        // al navegador (usa el permiso granted existente).
        if ('Notification' in window && Notification.permission === 'granted') {
          await OneSignal.User.PushSubscription?.optIn?.().catch(() => {});
        }

        // Guardar el player_id cuando la suscripción exista o cambie.
        // Evita el bug de carrera: antes se leía PushSubscription.id con un
        // setTimeout fijo, cuando el usuario aún no había hecho opt-in.
        const saveSubscriptionId = async () => {
          try {
            const subId = OneSignal.User?.PushSubscription?.id;
            if (subId && user?.id) {
              await supabase.from('profiles').update({ onesignal_player_id: subId }).eq('id', user.id);
            }
          } catch (_) {}
        };
        OneSignal.User?.PushSubscription?.addEventListener?.('change', saveSubscriptionId);
        setTimeout(saveSubscriptionId, 1500);
        setTimeout(saveSubscriptionId, 6000);

      } catch (_) {}
    });
  } catch (_) {}
}
