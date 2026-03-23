const CACHE_NAME='karpus-pwa-v1';
const ASSETS=[
  './',
  'login.html',
  'panel_padres.html',
  'css/panel-padre.css',
  'js/login.js',
  'js/supabase.js',
  'js/pwa-install.js',
  'js/padre/main.js',
  'js/padre/appState.js',
  'js/padre/helpers.js',
  'js/padre/attendance.js',
  'js/padre/feed.js',
  'js/padre/tasks.js',
  'js/padre/payments.js',
  'js/padre/chat.js',
  'js/padre/grades.js',
  'js/padre/profile.js',
  'logo/favicon.ico',
  'img/mundo.jpg'
];
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
