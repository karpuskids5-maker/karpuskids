const express = require('express');
const path    = require('path');
try { require('dotenv').config(); } catch(e) {}

// Compression — reduces payload 60-80%
let compress;
try { compress = require('compression'); } catch(_) { compress = null; }

// Helmet — set of hardened security headers
let helmet;
try { helmet = require('helmet'); } catch(_) { helmet = null; }

const app = express();

if (compress) app.use(compress());
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false, // CSP se controla por página (metas) por compatibilidad
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 15552000, includeSubDomains: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  }));
}

// ── Security headers (refuerzo manual además de Helmet) ──────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
});

// ── Bloquear archivos y rutas sensibles ───────────────────────────────
const BLOCKED_PATTERNS = [
  /\.env(\..*)?$/i,
  /^\/data\//i,
  /^\/\.git\//i,
  /^\/node_modules\//i,
  /^\/server\//i,
  /^\/migraciones\//i,
  /^\/supabase\//i,
  /^\/scripts\//i,
  /\.db(-wal|-shm)?$/i,
  /\.sql$/i,
  /\.log$/i,
  /\.key$/i,
  /\.pem$/i,
  /\.crt$/i,
  /package-lock\.json$/i,
];

app.use((req, res, next) => {
  const urlPath = decodeURIComponent(req.path);
  if (BLOCKED_PATTERNS.some(p => p.test(urlPath))) {
    return res.status(404).send('Not found');
  }
  // Bloquear archivos que comienzan con punto (ocultos)
  const segs = urlPath.split('/').filter(Boolean);
  if (segs.some(s => s.startsWith('.') && s !== '.well-known')) {
    return res.status(404).send('Not found');
  }
  next();
});

// ── Cache headers ──────────────────────────────────────────────────
// JS/CSS: NO-cache (ETag revalida cada visita → 304). Así el Service
// Worker siempre obtiene la versión más reciente (SaaS en evolución).
// Service Workers y version.json: nunca en caché HTTP.
app.use(express.static(path.join(__dirname, '..'), {
  maxAge: '1d',
  index: false,
  setHeaders(res, filePath) {
    const name = path.basename(filePath);
    if (name === 'OneSignalSDKWorker.js' || name === 'sw.js' || name === 'sw-live.js') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ── 404 para todo lo demás ────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send('Not found');
});

const port = process.env.PORT || 5800;
app.listen(port);
console.log(`[WEB] Servidor seguro en http://localhost:${port}`);
