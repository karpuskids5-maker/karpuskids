/**
 * 🔔 OneSignal Service Worker - Karpus Kids
 * Este archivo debe estar en la raíz del proyecto.
 * No agregues lógica pesada de cache aquí para evitar que falle el registro de notificaciones.
 */

// Importar el SDK de OneSignal
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// Manejador de mensajes para PWA (opcional, pero ayuda a evitar advertencias)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

