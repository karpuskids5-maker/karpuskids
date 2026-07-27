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

/**
 * CORS middleware with strict origin whitelist.
 */
function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // Same-origin / server-to-server requests (no Origin header)
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
}

/**
 * Verify Supabase JWT from Authorization header.
 * Attaches req.user (Supabase user object) on success.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autorización requerido' });
  }

  const token = header.slice(7);
  if (!token || token.length < 10) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Token expirado o inválido' });
    }
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Error verificando token' });
  }
}

/**
 * Require admin/directora/control role.
 * Must be used AFTER requireAuth.
 */
async function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (!profile) {
      return res.status(403).json({ error: 'Perfil no encontrado' });
    }

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
 * Hash a password with bcrypt (10 rounds).
 */
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
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
  hashPassword,
  comparePassword,
  ALLOWED_ORIGINS,
};
