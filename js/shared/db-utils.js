/**
 * 🛡️ Karpus Kids — DB Utils
 * Utilidades para queries robustas a escala.
 */

import { supabase } from './supabase.js';

/**
 * 📋 auditLog — Registra acciones críticas del staff en audit_logs.
 * Llama esto después de aprobar pagos, cambiar calificaciones, etc.
 *
 * @param {string} action   — 'payment.approved', 'grade.updated', etc.
 * @param {object} payload  — datos relevantes de la acción
 */
export async function auditLog(action, payload = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Enmascarar datos sensibles antes de guardar en auditoría
    const safePayload = { ...payload };
    if (safePayload.email)        safePayload.email        = maskSensitive(safePayload.email, 'email');
    if (safePayload.target_email) safePayload.target_email = maskSensitive(safePayload.target_email, 'email');
    if (safePayload.phone)        safePayload.phone        = maskSensitive(safePayload.phone, 'phone');
    if (safePayload.parent_email) safePayload.parent_email = maskSensitive(safePayload.parent_email, 'email');

    await supabase.from('audit_logs').insert({
      user_id:    user.id,
      action,
      payload:    safePayload,
      created_at: new Date().toISOString()
    });
  } catch (_) { /* silencioso — no bloquear la acción principal */ }
}

/**
 * 🚨 logError — Registra errores del sistema en la DB (reemplaza localStorage).
 * Se llama automáticamente desde el handler global de errores.
 */
export async function logError(panel, message, stack = '', url = '') {
  // Guard: don't log if message looks like a DB/network error (infinite loop prevention)
  const msgLower = String(message).toLowerCase();
  if (msgLower.includes('supabase') || msgLower.includes('fetch') || msgLower.includes('network') || msgLower.includes('failed to load')) return;
  try {
    // Evitar ruidos de extensiones o errores externos
    if (url && (url.includes('chrome-extension') || url.includes('moz-extension'))) return;

    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('system_errors').insert({
      panel,
      user_id:    user?.id || null,
      message:    String(message).slice(0, 500),
      stack:      String(stack).slice(0, 2000),
      url:        url || window.location.pathname,
      user_agent: navigator.userAgent.slice(0, 200),
      created_at: new Date().toISOString()
    });
  } catch (_) { /* silencioso — no re-lanzar */ }
}

/**
 * 🛠️ safeHandle — Reemplazo para bloques catch vacíos
 */
export function safeHandle(err, context = 'General') {
  console.error(`[${context}] Error capturado:`, err);
  const msg = err?.message || String(err);
  const panel = window.location.pathname.split('/').pop().replace('.html','') || 'shared';
  logError(panel, msg, err?.stack || '', window.location.href);
}

/**
 * Ejecuta una query con timeout.
 * Evita que queries lentas bloqueen la UI.
 *
 * @param {Function} queryFn  — async () => result
 * @param {number}   ms       — timeout en ms (default 8000)
 */
export function withTimeout(queryFn, ms = 8000) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Query timeout (${ms}ms)`)), ms)
  );
  return Promise.race([queryFn(), timeout]);
}

/**
 * 🔒 maskSensitive — Enmascara datos sensibles para logs de auditoría
 * Nunca guardar emails, teléfonos o nombres completos en logs.
 *
 * @param {string} value — valor a enmascarar
 * @param {string} type  — 'email' | 'phone' | 'name'
 * @returns {string}
 */
function maskSensitive(value, type = 'email') {
  if (!value) return '***';
  const s = String(value);
  if (type === 'email') {
    const [local, domain] = s.split('@');
    if (!domain) return s.slice(0, 2) + '***';
    return local.slice(0, 2) + '***@' + domain;
  }
  if (type === 'phone') {
    return s.slice(0, 3) + '****' + s.slice(-2);
  }
  if (type === 'name') {
    const parts = s.split(' ');
    return parts[0] + (parts.length > 1 ? ' ' + parts[1].charAt(0) + '.' : '');
  }
  return s.slice(0, 2) + '***';
}
