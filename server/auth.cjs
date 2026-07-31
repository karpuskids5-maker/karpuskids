const { supabase } = require('./dbProvider.cjs');
const bcrypt = require('bcryptjs');

// CORS whitelist — only these origins can access the API
const ALLOWED_ORIGINS = [
  'http://localhost:5600',
  'http://localhost:3000',
  'http://127.0.0.1:5600',
  'https://karpus.app',
  'https://www.karpus.app',
  'https://karpuskids.netlify.app',
];

// ── Rate limiting (in-memory store) ───────────────────────────────────
const rateStore = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;   // 15 minutos
const RATE_MAX_LOGIN = 5;                // 5 intentos / ventana (login)
const RATE_MAX_GLOBAL = 300;             // 300 requests / ventana (global)

function pruneRateStore(now = Date.now()) {
  if (rateStore.size > 10000) {
    for (const [key, entry] of rateStore) {
      if (now - entry.resetAt > RATE_WINDOW_MS) rateStore.delete(key);
    }
  }
}

function rateLimit(key, max, windowMs = RATE_WINDOW_MS) {
  const now = Date.now();
  pruneRateStore(now);
  let entry = rateStore.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    rateStore.set(key, entry);
  }
  entry.count += 1;
  const remaining = Math.max(0, max - entry.count);
  return {
    limited: entry.count > max,
    retryAfterSec: Math.ceil((entry.resetAt - now) / 1000),
    remaining
  };
}

function loginRateLimiter(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const username = (req.body?.username || '').toString().toLowerCase();
  const key = `login:${ip}:${username}`;
  const { limited, retryAfterSec, remaining } = rateLimit(key, RATE_MAX_LOGIN);
  res.setHeader('X-RateLimit-Limit', String(RATE_MAX_LOGIN));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  if (limited) {
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo más tarde.',
      retryAfter: retryAfterSec
    });
  }
  next();
}

function globalRateLimiter(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const { limited, remaining, retryAfterSec } = rateLimit(`global:${ip}`, RATE_MAX_GLOBAL);
  res.setHeader('X-RateLimit-Limit', String(RATE_MAX_GLOBAL));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  if (limited) {
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' });
  }
  next();
}

/**
 * CORS middleware with strict origin whitelist.
 */
function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
}

/**
 * Verify Supabase JWT from Authorization header.
 * Attaches req.user (Supabase user object) and req.profile on success.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autorización requerido', code: 'NO_TOKEN' });
  }

  const token = header.slice(7);
  if (!token || token.length < 10) {
    return res.status(401).json({ error: 'Token inválido', code: 'BAD_TOKEN' });
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      const code = error?.message?.includes('expired') ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
      return res.status(401).json({ error: 'Sesión expirada o inválida', code });
    }
    if (!user.email_confirmed_at && !user.confirmed_at) {
      // Aceptar usuarios ya confirmados; exigir confirmación solo si el campo existe y es false
    }
    req.user = user;
    req.token = token;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Error verificando token', code: 'AUTH_ERR' });
  }
}

/**
 * Middleware que carga el perfil (rol) del usuario autenticado.
 * Debe usarse DESPUÉS de requireAuth.
 */
async function loadProfile(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, role, name, email')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: 'Error verificando perfil' });
    req.profile = profile || null;
    next();
  } catch (e) {
    return res.status(500).json({ error: 'Error verificando perfil' });
  }
}

/**
 * Require admin/directora/control role.
 * Must be used AFTER requireAuth.
 */
async function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (!profile) return res.status(403).json({ error: 'Perfil no encontrado' });

    const allowedRoles = ['directora', 'admin', 'control'];
    if (!allowedRoles.includes(profile.role)) {
      return res.status(403).json({ error: 'Acceso restringido a administradores' });
    }

    req.profile = profile;
    next();
  } catch (e) {
    return res.status(403).json({ error: 'Error verificando permisos' });
  }
}

/**
 * Require staff role (directora, asistente, maestra, admin, control).
 * Must be used AFTER requireAuth.
 */
async function requireStaff(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (!profile) return res.status(403).json({ error: 'Perfil no encontrado' });

    const allowedRoles = ['directora', 'asistente', 'maestra', 'admin', 'control'];
    if (!allowedRoles.includes(profile.role)) {
      return res.status(403).json({ error: 'Acceso restringido a personal autorizado' });
    }

    req.profile = profile;
    next();
  } catch (e) {
    return res.status(403).json({ error: 'Error verificando permisos' });
  }
}

/**
 * Hash a password with bcrypt (12 rounds).
 */
async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

/**
 * Compare a plaintext password against a bcrypt hash.
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = {
  corsMiddleware,
  requireAuth,
  requireAdmin,
  requireStaff,
  loadProfile,
  loginRateLimiter,
  globalRateLimiter,
  hashPassword,
  comparePassword,
  ALLOWED_ORIGINS,
};
