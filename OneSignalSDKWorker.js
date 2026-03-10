// 1. Manejador de mensajes obligatorio al inicio absoluto (evita advertencias de Chrome/ServiceWorker)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 2. Importar OneSignal Service Worker
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// 3. Karpus Kids PWA Logic
const CACHE_NAME = 'karpus-pwa-v2';
const ASSETS = [
  '/',
  '/panel_padres.html',
  '/panel-maestra.html',
  '/panel_directora.html',
  '/js/panel_padres.js',
  '/js/panel_maestra.js',
  '/css/theme.css',
  '/logo/favicon.ico',
  '/img/mundo.jpg'
];

// Caching Logic (from sw.js)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : Promise.resolve()))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(res => {
      if (res) return res;
      return fetch(e.request).then(r => {
        try {
          const isRange = e.request.headers?.get('range');
          if (r && r.type === 'basic' && r.ok && r.status === 200 && !isRange) {
            const copy = r.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, copy)).catch(() => {});
          }
        } catch (_) {}
        return r;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
