/**
 * Karpus Kids — Service Worker PWA
 * IMPORTANTE: Este SW solo maneja caché PWA.
 * Las notificaciones push las maneja OneSignalSDKWorker.js en el mismo scope.
 * NO definir handlers push/notificationclick aquí para no interferir con OneSignal.
 */

const CACHE_NAME = 'karpus-pwa-v3';
const ASSETS = [
  './',
  'login.html',
  'panel_padres.html',
  'css/panel-padre.css',
  'logo/favicon.ico',
  'img/mundo.jpg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS).catch(() => {})) // silencioso si algún asset falla
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

  // No interceptar requests de OneSignal ni de Supabase
  if (
    url.hostname.includes('onesignal.com') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('cdn.jsdelivr') ||
    url.hostname.includes('cdn.tailwindcss') ||
    url.pathname.includes('OneSignal')
  ) {
    return; // dejar pasar sin caché
  }

  // Solo cachear recursos del mismo origen
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Solo cachear respuestas 200 completas (no parciales 206)
        if (res && res.type === 'basic' && res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('login.html'));
    })
  );
});

// ⚠️ NO agregar handlers push/notificationclick aquí.
// OneSignalSDKWorker.js maneja todo lo relacionado con notificaciones push.
// Tener dos handlers en el mismo scope causa que las notificaciones se dupliquen
// o no lleguen correctamente en móvil.
