/**
 * 🛡️ Karpus Kids — DB Utils
 * Utilidades para queries robustas a escala:
 *   - withRetry: reintentos con backoff exponencial
 *   - withTimeout: timeout configurable por query
 *   - paginate: paginación cursor-based eficiente
 *   - batchInsert: inserts en lotes para evitar timeouts
 *   - selectColumns: columnas mínimas por tabla (evita SELECT *)
 */

import { supabase } from './supabase.js';

// ── Columnas mínimas por tabla (evitar SELECT *) ──────────────────────────────
export const COLS = {
  profiles:   'id, name, role, avatar_url, phone, bio, email',
  students:   'id, name, is_active, parent_id, classroom_id, p1_name, p1_phone, p1_email',
  classrooms: 'id, name, level, capacity, teacher_id',
  payments:   'id, student_id, amount, status, month_paid, due_date, paid_date, method, evidence_url',
  posts:      'id, content, image_url, media_url, media_type, created_at, classroom_id, teacher_id',
  messages:   'id, conversation_id, sender_id, content, created_at, is_read',
  attendance: 'id, student_id, classroom_id, date, status, check_in, check_out',
  tasks:      'id, title, description, due_date, classroom_id, created_at, status',
  notifications: 'id, user_id, type, title, body, is_read, created_at',
};

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
  console.error('[withRetry] Agotados los reintentos:', lastError);
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
      console.error(`[batchInsert] Error en lote ${i / chunkSize}:`, error);
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
