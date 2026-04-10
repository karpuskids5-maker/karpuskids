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

// ── Global DB error handler — muestra toast automático en errores de DB ───────
window.addEventListener('karpus:db-error', (e) => {
  const msg = e.detail?.message || 'Error de conexión';
  // Usar Helpers.toast si está disponible, sino fallback simple
  if (window.Helpers?.toast) {
    window.Helpers.toast('Error: ' + msg, 'error');
  } else {
    console.error('[Karpus DB Error]', msg);
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
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to, subject, html, text }
    });
    
    if (error) {
      console.warn('[sendEmail] Function error:', error);
      return null;
    }
    return data;
  } catch (e) {
    console.warn('[sendEmail] Catch error (silencioso en local):', e.message);
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
      console.warn('[sendPush] Function error:', error);
      return null;
    }
    console.log('[sendPush] Success:', data);
    return data;
  } catch (e) {
    console.warn('[sendPush] Catch error (silencioso):', e.message);
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
      console.warn('[emitEvent] Function error:', error);
      return null;
    }
    
    // ✅ Log de éxito para que la Maestra vea la confirmación
    if (resData?.ok) {
      console.log(`[emitEvent] Success (${type}):`, resData);
    }
    
    return resData;
  } catch (e) {
    console.warn('[emitEvent] Catch error:', e.message);
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
  try {
    let user = currentUser;
    if (!user) {
      const { data } = await supabase.auth.getUser();
      user = data?.user;
    }
    if (!user) return;

    // No inicializar OneSignal si no estamos en el dominio de producción
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const isProd = host === 'karpuskids.com' || host === 'www.karpuskids.com' || host.endsWith('.karpuskids.com');
    
    if (!isProd && !isLocal) {
      console.info('[OneSignal] Omitiendo inicialización en dominio no permitido:', host);
      return;
    }

    if (window.OneSignalInitialized) return;
    window.OneSignalInitialized = true;

    // 🛡️ FIX: Verificar IndexedDB disponible ANTES de inyectar el script
    // OneSignal v16 intenta abrir IndexedDB apenas se carga, si falla lanza error incapturable.
    const isIndexedDBAvailable = await new Promise(resolve => {
      try {
        if (!window.indexedDB) return resolve(false);
        // Intentar una operación real para confirmar acceso (algunos navegadores bloquean el open)
        const req = indexedDB.open('_karpus_idb_test', 1);
        req.onsuccess = () => { req.result.close(); resolve(true); };
        req.onerror   = () => resolve(false);
        req.onblocked = () => resolve(false);
        setTimeout(() => resolve(false), 2000);
      } catch (_) { resolve(false); }
    });

    if (!isIndexedDBAvailable) {
      console.info('[OneSignal] IndexedDB no disponible (modo incógnito/privado) — omitiendo carga del SDK.');
      return;
    }

    // 🛡️ FIX: Silenciar errores internos de OneSignal si fallan promesas nativas
    // Este handler debe estar activo ANTES de cargar el script
    const idbErrorHandler = function(event) {
      if (event.reason && (
        event.reason.message?.toLowerCase().includes('indexeddb') || 
        event.reason.name === 'UnknownError' ||
        event.reason.message?.toLowerCase().includes('backing store')
      )) {
        console.warn('[OneSignal] Error de almacenamiento silenciado (incógnito):', event.reason.message);
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('unhandledrejection', idbErrorHandler);

    const ONESIGNAL_APP_ID = "47ce2d1e-152e-4ea7-9ddc-8e2142992989";

    // Pre-register service worker before loading OneSignal SDK
    // This prevents the "[WM] No SW registration for postMessage" warning
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/OneSignalSDKWorker.js', { scope: '/' });
      } catch (_) { /* silencioso — puede ya estar registrado */ }
    }

    // Inyectar script dinámicamente solo si pasó la prueba de IndexedDB
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
        if (typeof OneSignal.isInitialized === 'function' && OneSignal.isInitialized()) {
          return;
        }

        await OneSignal.init({
          appId: ONESIGNAL_APP_ID,
          allowLocalhostAsSecureOrigin: true,
          serviceWorkerParam: { scope: '/' },
          serviceWorkerPath: 'OneSignalSDKWorker.js',
          notifyButton: { enable: false },
          welcomeNotification: { disable: false }
        });

        // Esperar a que el SDK esté listo
        await new Promise(r => setTimeout(r, 800));

        // Pedir permiso si no se ha dado aún — en móvil y desktop
        try {
          const perm = OneSignal.Notifications?.permissionNative;
          if (perm === 'default') {
            const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
            if (isMobile) {
              // En móvil: pedir permiso tras interacción del usuario (click/touch)
              // para cumplir con la política de browsers móviles
              const askOnInteraction = () => {
                document.removeEventListener('click', askOnInteraction);
                document.removeEventListener('touchend', askOnInteraction);
                OneSignal.Notifications.requestPermission().catch(() => {});
              };
              document.addEventListener('click', askOnInteraction, { once: true });
              document.addEventListener('touchend', askOnInteraction, { once: true });
            } else {
              // Desktop: pedir directamente
              await OneSignal.Notifications.requestPermission().catch(() => {});
            }
          }
        } catch (_) { /* silencioso — el usuario puede rechazar el permiso */ }

        // Vincular usuario externo
        try {
          // Wait a bit more for SDK to fully initialize before checking identity
          await new Promise(r => setTimeout(r, 1500));

          if (!OneSignal.User) {
            console.warn('[OneSignal] User object not available yet');
            return;
          }

          const currentExtId = await OneSignal.User.getExternalId?.();
          if (currentExtId === user.id) {
            // Already linked — just ensure push subscription is active
            console.log('[OneSignal] ✅ Ya vinculado:', user.id);
          } else {
            // Not linked yet or linked to someone else — safe to call login
            console.log('[OneSignal] Vinculando usuario:', user.id, '(era:', currentExtId || 'nadie', ')');
            await OneSignal.login(user.id).catch((e) => {
              const msg = (e?.message || '').toLowerCase();
              if (!msg.includes('409') && !msg.includes('conflict')) {
                console.info('[OneSignal] login info:', e?.message ?? e);
              }
            });
            await new Promise(r => setTimeout(r, 1500));
          }

          // Activar suscripción push si el permiso está concedido
          try {
            const hasPermission = OneSignal.Notifications?.permission === true;
            const isOptedIn     = OneSignal.User?.PushSubscription?.optedIn;
            if (hasPermission && isOptedIn === false) {
              await OneSignal.User.PushSubscription.optIn().catch(() => {});
            }
          } catch (_) { /* silencioso */ }

          const subId = OneSignal.User?.PushSubscription?.id;
          if (subId) {
            console.log('[OneSignal] ✅ Listo para:', user.id, '| SubID:', subId);
            // Guardar subscription_id en profiles para fallback en send-push
            supabase.from('profiles')
              .update({ onesignal_player_id: subId })
              .eq('id', user.id)
              .then(({ error }) => {
                if (error) console.warn('[OneSignal] No se pudo guardar player_id:', error.message);
                else console.log('[OneSignal] player_id guardado en profiles:', subId);
              })
              .catch(() => {});
          } else {
            console.log('[OneSignal] ✅ Listo para:', user.id, '| SubID: pendiente');
            // Reintentar obtener subId después de un momento
            setTimeout(async () => {
              try {
                const retrySubId = OneSignal.User?.PushSubscription?.id;
                if (retrySubId) {
                  await supabase.from('profiles')
                    .update({ onesignal_player_id: retrySubId })
                    .eq('id', user.id);
                  console.log('[OneSignal] player_id guardado (retry):', retrySubId);
                }
              } catch (_) {}
            }, 3000);
          }

          // Escuchar cambios de suscripción (cuando el usuario acepta el permiso después)
          try {
            OneSignal.User?.PushSubscription?.addEventListener('change', async (event) => {
              const newSubId = event?.current?.id;
              if (newSubId) {
                console.log('[OneSignal] Suscripción activada:', newSubId);
                await supabase.from('profiles')
                  .update({ onesignal_player_id: newSubId })
                  .eq('id', user.id)
                  .catch(() => {});
              }
            });
          } catch (_) { /* silencioso */ }

        } catch (loginErr) {
          const msg = loginErr?.message?.toLowerCase() ?? '';
          if (msg.includes('409') || loginErr?.status === 409 || msg.includes('conflict')) return;
          console.info('[OneSignal] login omitido:', loginErr?.message ?? loginErr);
        }

      } catch (e) {
        console.info('[OneSignal] SDK error (no crítico):', e?.message ?? e);
      }
    });
  } catch (globalErr) {
    console.warn('[OneSignal] Error global en initOneSignal:', globalErr.message);
  }
}
