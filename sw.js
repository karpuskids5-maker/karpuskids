const CACHE_NAME='karpus-pwa-v1';
const ASSETS=['/','/panel_padres.html','/js/panel_padres.js','/css/theme.css','/logo/favicon.ico'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE_NAME?caches.delete(k):Promise.resolve()))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin){
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(res=>{
      if(res)return res;
      return fetch(e.request).then(r=>{
        // Solo cachear respuestas completas 200 (no parciales 206) y mismas origen
        try{
          const isRange = e.request.headers && e.request.headers.get && e.request.headers.get('range');
          if(r && r.type==='basic' && r.ok && r.status===200 && !isRange){
            const copy=r.clone();
            caches.open(CACHE_NAME).then(c=>c.put(e.request,copy)).catch(()=>{});
          }
        }catch(_){}
        return r;
      }).catch(()=>caches.match('/panel_padres.html'))
    })
  )
});

// Notificaciones Push (Simuladas/Realtime)
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Nueva Notificación';
  const options = {
    body: data.message || 'Tienes una nueva actualización en Karpus Kids',
    icon: '/logo/favicon.ico',
    badge: '/logo/favicon.ico',
    data: { url: data.url || '/panel_padres.html' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) {
            client = clientList[i];
          }
        }
        return client.focus();
      }
      return clients.openWindow(event.notification.data.url);
    })
  );
});
