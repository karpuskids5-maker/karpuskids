self.addEventListener('message', (event) => {
  // Manejador preventivo para evitar el error de registro tardío (sw.ts:21)
});

/**
 * Karpus Kids — Service Worker PWA
 * IMPORTANTE: Este SW solo maneja caché PWA.
 * Las notificaciones push las maneja OneSignalSDKWorker.js en el mismo scope.
 * NO definir handlers push/notificationclick aquí para no interferir con OneSignal.
 */

const CACHE_NAME = 'karpus-pwa-v5'; // ✅ Nueva versión
const ASSETS = [
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
      .then(c => c.addAll(ASSETS).catch(() => {}))
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

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // ✅ CACHÉ DE FUENTES Y CDN (Stale-while-revalidate)
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(networkResponse => {
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, networkResponse.clone()));
          return networkResponse;
        });
        return cached || fetchPromise;
      })
    );
    return;
  }

  // No interceptar requests críticos de OneSignal ni Auth de Supabase
  if (
    url.hostname.includes('onesignal.com') ||
    url.pathname.includes('/auth/v1/') ||
    url.pathname.includes('OneSignal')
  ) {
    return;
  }

  // ✅ CACHÉ DE ASSETS ESTÁTICOS CORE
  const isCoreAsset = url.pathname.endsWith('.css') || 
                     url.pathname.endsWith('.js') || 
                     url.pathname.endsWith('.png') || 
                     url.pathname.endsWith('.jpg') ||
                     url.pathname.endsWith('.svg');

  if (isCoreAsset || url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res && res.type === 'basic' && res.ok && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        }).catch(() => caches.match('login.html'));
      })
    );
  }
});

// ⚠️ NO agregar handlers push/notificationclick aquí.
// OneSignalSDKWorker.js maneja todo lo relacionado con notificaciones push.
// Tener dos handlers en el mismo scope causa que las notificaciones se dupliquen
// o no lleguen correctamente en móvil.
