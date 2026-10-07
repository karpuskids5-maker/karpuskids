/**
 * KARPUS KIDS — App Service Worker
 * ─────────────────────────────────────────────────────────────
 * Objetivo: permitir abrir los paneles en modo offline leve y acelerar la
 * carga, SIN comprometer la seguridad de la app.
 *
 * Reglas de seguridad aplicadas deliberadamente:
 *  1. NUNCA se cachean peticiones a Supabase (auth, REST, realtime).
 *     Cachear respuestas autenticadas serviría datos de otro usuario.
 *  2. NUNCA se cachean HTML de paneles: cada panel decide su propio render
 *     tras validar sesión; servir HTML cacheado podría mostrar una UI
 *     desactualizada o de otro rol.
 *  3. Solo se cachea el "shell" estático (JS/CSS/img del propio repo) con
 *     estrategia stale-while-revalidate, y solo bajo GET same-origin.
 *
 * Nota: el worker de OneSignal (/OneSignalSDKWorker.js) se registra aparte y
 * este SW no lo intercepta (ver IGNORE_PATHS).
 */

const VERSION = 'kk-v2';
const SHELL_CACHE = `kk-shell-${VERSION}`;

/** Rutas que jamás se tocan. */
const IGNORE_PATHS = [
  '/OneSignalSDKWorker.js',
  '/sw.js',
  '/manifest.json',
  '/manifest.webmanifest',
];

/** Hosts externos / APIs que jamás se cachean. */
const IGNORE_HOSTS = [
  'supabase.co',
  'supabase.in',
  'onesignal.com',
  'googleapis.com',
  'gstatic.com',
  'api.qrserver.com',
  'cdn.onesignal.com',
];

/**
 * Recursos estáticos propios del proyecto. Lista corta y conservadora:
 * si un archivo no está aquí, se sirve de red sin cachear.
 */
const PRECACHE = [
  '/offline.html',
  '/manifest.json',
  '/css/karpus-tailwind.css',
  '/js/shared/supabase.js',
  '/js/shared/helpers.js',
  '/js/shared/badges.js',
  '/js/shared/birthday-utils.js',
  '/js/shared/notify-feedback.js',
];

/** ¿Esta petición es cacheable de forma segura? */
function isCacheable(request, url) {
  if (request.method !== 'GET') return false;

  // Mismo origen únicamente.
  if (url.origin !== self.location.origin) return false;

  // Rutas excluidas.
  if (IGNORE_PATHS.some(p => url.pathname === p)) return false;

  // APIs de datos, auth y tiempo real: siempre directo a la red.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/functions/') ||
    url.pathname.includes('/supabase') ||
    IGNORE_HOSTS.some(h => url.hostname.endsWith(h))
  ) {
    return false;
  }

  // Solo estáticos del repo.
  return /\.(?:js|mjs|css|woff2?|png|jpe?g|svg|webp|ico|json)$/i.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll es atómico: si un recurso falta, no se instala nada.
      .then(cache => Promise.allSettled(PRECACHE.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('kk-shell-') && k !== SHELL_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Nunca interferir con peticiones que no son GET simple.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }

  if (!isCacheable(request, url)) return; // pasa directo a la red

  // Stale-While-Revalidate para estáticos.
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        // Refresca en segundo plano; si falla la red, se sirve el caché.
        event.waitUntil(network);
        return cached;
      }

      const fresh = await network;
      if (fresh) return fresh;

      // Navegación offline sin recurso previo → página de cortesía.
      if (request.mode === 'navigate') {
        const fallback = await cache.match('/offline.html');
        if (fallback) return fallback;
      }

      return new Response(
        '<!doctype html><meta charset="utf-8"><title>Sin conexión</title>'
        + '<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0">'
        + '<div style="text-align:center"><h1 style="font-size:1.5rem">Sin conexión</h1>'
        + '<p style="opacity:.75">Reconéctate para volver a cargar el panel.</p></div>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    })
  );
});
