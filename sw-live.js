/**
 * Karpus Kids — Service Worker PWA for Attendance Live (kiosco)
 * Scope propio ('/'), registrado solo por attendance-live.html.
 * Estrategia igual al worker principal:
 *   - Cache versionado + patrón "waiting worker" (SKIP_WAITING)
 *   - Network First para HTML, JS y CSS
 *   - Cache First (stale-while-revalidate) para imágenes/fuentes
 *   - Supabase nunca se cachea
 */

// ⚠️ Handler message requerido (Chrome 120+)
// SKIP_WAITING: la página lo envía solo cuando el usuario acepta actualizar.
self.addEventListener('message', event => {
  const data = event.data;
  if (data && data.type === 'SKIP_WAITING') self.skipWaiting();
});

const CACHE_VERSION = 'karpus-live-v5';
const CACHE_NAME    = CACHE_VERSION;

const PRECACHE = [
  './attendance-live.html',
  'js/shared/html5-qrcode.min.js',
  'css/karpus-tailwind.css',
  'js/shared/supabase-js.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(PRECACHE).catch(() => {}))
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
const isImage    = url => /\.(?:png|jpe?g|webp|gif|svg|ico|avif)$/i.test(url.pathname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('onesignal.com') ||
    url.pathname.includes('/auth/v1/') ||
    url.protocol === 'chrome-extension:'
  ) {
    return;
  }

  if (url.origin !== self.location.origin) return;

  // HTML: Network First
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
        .catch(() => caches.match(req).then(cached => cached || caches.match('./attendance-live.html')))
    );
    return;
  }

  // JS/CSS: Network First
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
        .catch(() => caches.match(req))
    );
    return;
  }

  // Imágenes: Cache First + revalidate
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

  // Otros del mismo origen: Network First
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
});
