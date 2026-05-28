/**
 * 🛡️ Karpus Kids — DB Utils
 * Utilidades para queries robustas a escala:
 *   - safeQuery: interceptor global de errores con toast automático
 *   - withRetry: reintentos con backoff exponencial
 *   - withTimeout: timeout configurable por query
 *   - paginate: paginación cursor-based eficiente
 *   - batchInsert: inserts en lotes para evitar timeouts
 *   - selectColumns: columnas mínimas por tabla (evita SELECT *)
 */

import { supabase } from './supabase.js';

// ── Columnas mínimas por tabla (evitar SELECT *) ──────────────────────────────
export const COLS = {
  profiles:   'id, name, role, avatar_url, phone, bio, email, last_sign_in_at',
  students:   'id, name, is_active, parent_id, classroom_id, p1_name, p1_phone, p1_email, matricula',
  classrooms: 'id, name, level, capacity, teacher_id',
  payments:   'id, student_id, amount, status, month_paid, due_date, paid_date, method, evidence_url',
  posts:      'id, content, image_url, media_url, media_type, created_at, classroom_id, teacher_id',
  messages:   'id, conversation_id, sender_id, content, created_at, is_read',
  attendance: 'id, student_id, classroom_id, date, status, check_in, check_out',
  tasks:      'id, title, description, due_date, classroom_id, created_at, status',
  notifications: 'id, user_id, type, title, body, is_read, created_at',
};

/**
 * 🛡️ safeQuery — Interceptor global de errores de base de datos.
 * Muestra un toast automático en errores y retorna { data, ok, error }.
 *
 * Uso: const { data, ok } = await safeQuery(supabase.from('students').select('id, action, payload, created_at'));
 */
export async function safeQuery(queryPromise, { silent = false, label = '' } = {}) {
  try {
    const { data, error } = await queryPromise;
    if (error) {
      const msg = error.message || JSON.stringify(error);
      if (!silent) {
        window.dispatchEvent(new CustomEvent('karpus:db-error', { detail: { message: msg, label } }));
      }
      return { data: null, ok: false, error: msg };
    }
    return { data, ok: true, error: null };
  } catch (err) {
    const msg = err?.message || String(err);
    if (!silent) {
      window.dispatchEvent(new CustomEvent('karpus:db-error', { detail: { message: msg, label } }));
    }
    return { data: null, ok: false, error: msg };
  }
}

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
 * Ejecuta una query con reintentos y backoff exponencial.
 * Ideal para operaciones críticas (pagos, asistencia).
 *
 * @param {Function} queryFn  — async () => { data, error }
 * @param {number}   retries  — intentos máximos (default 3)
 * @param {number}   baseMs   — delay base en ms (default 300)
 */
export async function withRetry(queryFn, retries = 3, baseMs = 300) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await queryFn();
      if (result?.error) {
        // Errores de red o 5xx → reintentar
        const code = result.error?.code || result.error?.status;
        const isRetryable = !code || code >= 500 || code === 'PGRST301';
        if (!isRetryable) return result; // error de cliente → no reintentar
        lastError = result.error;
      } else {
        return result;
      }
    } catch (e) {
      lastError = e;
    }
    if (attempt < retries - 1) {
      await new Promise(r => setTimeout(r, baseMs * Math.pow(2, attempt)));
    }
  }
  return { data: null, error: lastError };
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
 * Paginación cursor-based eficiente (más rápida que OFFSET para tablas grandes).
 * Usa el campo `created_at` como cursor.
 *
 * @param {string}  table     — nombre de la tabla
 * @param {object}  opts      — { select, filters, pageSize, cursor, ascending }
 */
export async function paginate(table, opts = {}) {
  const {
    select    = '*',
    filters   = {},
    pageSize  = 20,
    cursor    = null,   // ISO timestamp del último item
    ascending = false,
    orderBy   = 'created_at'
  } = opts;

  let query = supabase.from(table).select(select).limit(pageSize);

  // Aplicar filtros
  for (const [col, val] of Object.entries(filters)) {
    if (val !== null && val !== undefined && val !== '') {
      query = query.eq(col, val);
    }
  }

  // Cursor-based pagination
  if (cursor) {
    query = ascending
      ? query.gt(orderBy, cursor)
      : query.lt(orderBy, cursor);
  }

  query = query.order(orderBy, { ascending });

  const { data, error } = await query;
  if (error) throw error;

  const nextCursor = data?.length === pageSize
    ? data[data.length - 1]?.[orderBy]
    : null;

  return { data: data || [], nextCursor, hasMore: !!nextCursor };
}

/**
 * Insert en lotes para evitar timeouts con muchos registros.
 * Divide el array en chunks y los inserta secuencialmente.
 *
 * @param {string}  table     — nombre de la tabla
 * @param {Array}   records   — registros a insertar
 * @param {number}  chunkSize — tamaño del lote (default 50)
 */
export async function batchInsert(table, records, chunkSize = 50) {
  if (!records?.length) return { inserted: 0, errors: [] };

  const errors = [];
  let inserted = 0;

  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) {
      errors.push({ chunk: i / chunkSize, error });
    } else {
      inserted += chunk.length;
    }
  }

  return { inserted, errors };
}

/**
 * Upsert en lotes.
 */
export async function batchUpsert(table, records, onConflict = 'id', chunkSize = 50) {
  if (!records?.length) return { upserted: 0, errors: [] };

  const errors = [];
  let upserted = 0;

  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) {
      errors.push({ chunk: i / chunkSize, error });
    } else {
      upserted += chunk.length;
    }
  }

  return { upserted, errors };
}

/**
 * Cuenta registros de forma eficiente (HEAD request, sin traer datos).
 */
export async function countRows(table, filters = {}) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  for (const [col, val] of Object.entries(filters)) {
    if (val !== null && val !== undefined) query = query.eq(col, val);
  }
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

/**
 * 📊 ensureChart — Lazy loading de Chart.js
 * Solo inicializa el gráfico cuando el canvas es visible en el viewport.
 * Evita inicializar Chart.js en secciones que el usuario nunca visita.
 *
 * @param {string}   canvasId  — ID del elemento canvas
 * @param {Function} initFn    — función que crea el Chart (recibe el canvas)
 * @returns {Promise<void>}
 */
export function ensureChart(canvasId, initFn) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Si ya está inicializado, no hacer nada
  if (canvas._chartInitialized) return;

  // Si Chart.js no está disponible, esperar
  if (!window.Chart) {
    const wait = setInterval(() => {
      if (window.Chart) { clearInterval(wait); _initWhenVisible(canvas, initFn); }
    }, 200);
    return;
  }

  _initWhenVisible(canvas, initFn);
}

function _initWhenVisible(canvas, initFn) {
  if (!('IntersectionObserver' in window)) {
    // Fallback: inicializar directamente
    canvas._chartInitialized = true;
    initFn(canvas);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !canvas._chartInitialized) {
        canvas._chartInitialized = true;
        observer.disconnect();
        initFn(canvas);
      }
    });
  }, { threshold: 0.1 });

  observer.observe(canvas);
}

/**
 * 🔒 maskSensitive — Enmascara datos sensibles para logs de auditoría
 * Nunca guardar emails, teléfonos o nombres completos en logs.
 *
 * @param {string} value — valor a enmascarar
 * @param {string} type  — 'email' | 'phone' | 'name'
 * @returns {string}
 */
export function maskSensitive(value, type = 'email') {
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

/**
 * 🌐 friendlyAuditMessage — Convierte un action de auditoría en texto legible
 * Para que la directora no tenga que interpretar JSON.
 *
 * @param {string} action  — 'payment.approved', 'grade.updated', etc.
 * @param {object} payload — datos del evento
 * @returns {string}
 */
export function friendlyAuditMessage(action, payload = {}) {
  const map = {
    'payment.approved':    `Pago aprobado — ${payload.month || ''}`,
    'payment.deleted':     `Pago eliminado`,
    'payment.mora_waived': `Mora exonerada`,
    'period.closed':       `Período cerrado: ${payload.period_name || ''}`,
    'period.activated':    `Período activado: ${payload.new_period_name || ''}`,
    'admin.reset_password':'Contraseña cambiada por admin',
    'admin.change_role':   `Rol cambiado a "${payload.new_role || ''}"`,
    'grade.updated':       `Calificación actualizada`,
    'student.created':     `Nuevo estudiante registrado`,
    'teacher.created':     `Nuevo maestro registrado`,
    'payment.created':     `Cobro generado — ${payload.month || ''}`,
    'payment.overdue':     `Pago marcado como vencido`,
  };
  return map[action] || action.replace(/\./g, ' → ');
}
