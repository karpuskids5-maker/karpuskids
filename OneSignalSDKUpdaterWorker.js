self.addEventListener('message', (event) => {
  // Manejador preventivo para evitar el error de registro tardío (sw.ts:21)
});

importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

/**
 * Karpus Kids — Service Worker PWA + OneSignal (Updater)
 */

const CACHE_NAME = 'karpus-pwa-v5';
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
  if (
    url.hostname.includes('onesignal.com') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('cdn.jsdelivr') ||
    url.hostname.includes('cdn.tailwindcss') ||
    url.pathname.includes('OneSignal')
  ) return;
  if (url.origin !== self.location.origin) return;
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
});
