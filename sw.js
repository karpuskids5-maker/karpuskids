const CACHE_NAME='karpus-pwa-v1';
const ASSETS=['/','/panel_padres.html','/js/panel_padres.js','/css/theme.css','/logo/favicon.ico'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE_NAME?caches.delete(k):Promise.resolve()))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(
    caches.match(e.request).then(res=>{
      if(res)return res;
      return fetch(e.request).then(r=>{
        const copy=r.clone();
        caches.open(CACHE_NAME).then(c=>c.put(e.request,copy));
        return r;
      }).catch(()=>caches.match('/panel_padres.html'))
    })
  )
});
