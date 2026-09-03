// ═══════════════════════════════════════════════════════════════
// Karpus Kids — Service Worker (OneSignal + Caché PWA unificados)
// ═══════════════════════════════════════════════════════════════
// Este worker combina:
//   1. Los handlers de notificaciones push de OneSignal (importScripts)
//   2. La estrategia de caché PWA de Karpus (abajo)
//
// SOLO puede haber UN service worker por scope ('/'), por eso la
// caché vive aquí junto a OneSignal. No crear otro worker con scope '/' 
// (p.ej. sw.js) o reemplazará este y romperá las notificaciones push.
//
// Estrategia de actualización:
//   - Cache versionado: al cambiar CACHE_VERSION el navegador descarta
//     la caché anterior automáticamente.
//   - Patrón profesional "waiting worker": el nuevo worker NO se activa solo.
//     Espera en "waiting" detrás del worker actual (la app sigue funcionando
//     con la versión vieja sin interrupciones). Solo cuando la página le envía
//     el mensaje SKIP_WAITING (usuario aceptó "Actualizar ahora") activa,
//     toma el control con clients.claim() y la página recarga UNA vez.
//   - Network First para HTML, JS y CSS: siempre se descarga la versión
//     más reciente cuando hay internet.
//   - Cache First (stale-while-revalidate) solo para imágenes/fuentes.
//   - Las peticiones a Supabase, OneSignal y auth NUNCA se cachean.
// ═══════════════════════════════════════════════════════════════

importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

// ⚠️ Handler message requerido (Chrome 120+)
// Atiende SKIP_WAITING: la página lo envía solo cuando el usuario acepta la
// actualización. Sin mensaje, el worker espera y NUNCA interrumpe al usuario.
self.addEventListener('message', event => {
  const data = event.data;
  if (data && data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── VERSIÓN DE CACHÉ ────────────────────────────────────────────────────────
// ⚠️ INCREMENTAR en cada deploy: karpus-v1.0.38 → karpus-v1.0.39 ...
const CACHE_VERSION = 'karpus-v1.0.42';
const CACHE_NAME    = CACHE_VERSION;

// Assets precacheados en la instalación (mínimos, network-first en runtime)
const PRECACHE = [
  './',
  'login.html',
  'css/panel-padre.css',
  'logo/favicon.ico',
  'img/mundo.jpg',
  'https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Inter:wght@400;700;900&display=swap'
];

// ── INSTALL ─────────────────────────────────────────────────────
// ⚠️ NO llamar a skipWaiting() aquí: activar de forma automática forzaba
// recargas en todas las pestañas abiertas. La activación la pide la página
// vía el mensaje SKIP_WAITING (ver handler message arriba).
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(PRECACHE).catch(() => {}))
  );
});

// ── ACTIVATE ────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    // Eliminar automáticamente TODAS las cachés de versiones anteriores
    caches.keys()
      .then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null)))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ───────────────────────────────────────────────────────
const isNavigate   = req => req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html');
const isJSOrCSS    = url => /\.(?:js|mjs|css)$/i.test(url.pathname);
const isImage      = url => /\.(?:png|jpe?g|webp|gif|svg|ico|avif|webmanifest)$/i.test(url.pathname) ||
                           /\.(?:woff2?|ttf|otf|eot)$/i.test(url.pathname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ── NUNCA cachear: Supabase API, OneSignal, auth, no-http ──────
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('onesignal.com') ||
    url.pathname.includes('/auth/v1/') ||
    url.pathname.includes('OneSignal') ||
    url.protocol === 'chrome-extension:'
  ) {
    return;
  }

  // ── Fonts/CDN: stale-while-revalidate ─────────────────────────
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(req).then(cached => {
        const fetchPromise = fetch(req).then(networkResponse => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
          }
          return networkResponse;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // ── HTML (navegación): Network First, fallback a caché ────────
  if (isNavigate(req)) {
    e.respondWith(
      fetch(req)
        .then(networkResponse => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
          }
          return networkResponse;
        })
        .catch(() =>
          caches.match(req).then(cached =>
            cached || caches.match('./').then(root => root || caches.match('login.html'))
          )
        )
    );
    return;
  }

  // ── JS/CSS: Network First (siempre la versión más nueva) ──────
  if (isJSOrCSS(url)) {
    e.respondWith(
      fetch(req)
        .then(networkResponse => {
          if (networkResponse && networkResponse.ok && networkResponse.type === 'basic') {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
          }
          return networkResponse;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match('login.html')))
    );
    return;
  }

  // ── Imágenes / íconos / fuentes: Cache First + revalidate ────
  if (isImage(url)) {
    e.respondWith(
      caches.match(req).then(cached => {
        const fetchPromise = fetch(req).then(networkResponse => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
          }
          return networkResponse;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // ── Cualquier otro recurso del mismo origen: network-first ────
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then(networkResponse => {
          if (networkResponse && networkResponse.ok && networkResponse.type === 'basic') {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
          }
          return networkResponse;
        })
        .catch(() => caches.match(req))
    );
  }
});

// ⚠️ NO agregar handlers push/notificationclick aquí.
// OneSignalSDK.sw.js (importado arriba) maneja las notificaciones push.
// Agregar handlers propios duplicaría o rompería las notificaciones en móvil.
