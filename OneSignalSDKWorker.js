/**
 * 🔔 OneSignal Service Worker - Karpus Kids
 */

// 1. IMPORTANTE: Los importScripts deben ir al inicio absoluto
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// 2. Manejador de mensajes para PWA (después del import)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

