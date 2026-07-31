/**
 * Karpus Kids — Service Worker PWA (standalone, solo caché)
 * ⚠️ IMPORTANTE: En producción el worker activo es OneSignalSDKWorker.js
 * (scope '/'), que ya incluye esta misma estrategia de caché. Solo puede
 * existir UN service worker por scope: registrar este sw.js en '/'
 * REEMPLAZARÍA al de OneSignal y rompería las notificaciones push.
 * Este archivo se mantiene como plantilla/fallback de caché.
 *
 * Estrategia:
 *   - Cache versionado (elimina cachés antiguas en activate).
 *   - skipWaiting() + clients.claim() para tomar control al instante.
 *   - Network First para HTML, JS y CSS.
 *   - Cache First (stale-while-revalidate) para imágenes y fuentes.
 *   - Supabase/OneSignal/auth nunca se cachean.
 */

const CACHE_VERSION = 'karpus-v1.0.26';
const CACHE_NAME    = CACHE_VERSION;

const PRECACHE = [
  './',
  'login.html',
  'css/panel-padre.css',
  'css/globals.css',
  'logo/favicon.ico',
  'img/mundo.jpg',
  'https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Inter:wght@400;700;900&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null)))
      .then(() => self.clients.claim())
  );
});

const isNavigate = req => req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html');
const isJSOrCSS  = url => /\.(?:js|mjs|css)$/i.test(url.pathname);
const isImage    = url => /\.(?:png|jpe?g|webp|gif|svg|ico|avif|webmanifest)$/i.test(url.pathname) ||
                          /\.(?:woff2?|ttf|otf|eot)$/i.test(url.pathname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('onesignal.com') ||
    url.pathname.includes('/auth/v1/') ||
    url.pathname.includes('OneSignal') ||
    url.protocol === 'chrome-extension:'
  ) {
    return;
  }

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
