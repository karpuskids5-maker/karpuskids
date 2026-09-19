/**
 * 🔧 AUTO-DETECCIÓN DE AUSENTES — servicio compartido (maestra / asistente / directora)
 *
 * Estrategia en dos niveles:
 *   1. Intenta el RPC `mark_absent_students()` (migración 17, lógica 100% server-side).
 *   2. Si el RPC no existe en la BD (400/404, p. ej. migración sin aplicar en prod),
 *      ejecuta la MISMA lógica en el cliente para que los registros de asistencia
 *      se creen igual → calendario de los padres en rojo, reportes correctos.
 *
 * Reglas idénticas a la función SQL:
 *   - Solo días laborables (school_settings.work_days).
 *   - Solo cuando ya pasó check_in_end + 2 horas (hora de República Dominicana).
 *   - No sobrescribe estados finales (present/late/retirado/absent).
 *   - Idempotente (UNIQUE student_id,date).
 *
 * Formato devuelto: { marked, parents, students } — mismo del RPC.
 */
import { supabase } from './supabase.js';
import { Helpers } from './helpers.js';

const FINAL_STATUSES = new Set(['present', 'presente', 'late', 'tarde', 'retirado', 'absent', 'ausente']);
const DR_TZ = 'America/Santo_Domingo';
const DOW_NAMES = { Lun: 1, Mar: 2, Mie: 3, Mié: 3, Jue: 4, Vie: 5, Sab: 6, Sáb: 6, Dom: 0 };

let _inFlight = null;
let _jsDisabledUntil = 0;

/** Devuelve la fecha/hora local de RD y el día de la semana (0=Dom … 6=Sáb). */
function nowDRInfo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DR_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t)?.value || '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DR_TZ, hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const time = `${timeParts.find(p => p.type === 'hour')?.value}:${timeParts.find(p => p.type === 'minute')?.value}`;
  const dow = new Date(`${date}T12:00:00`).getUTCDay(); // 0=Dom
  return { date, time, dow };
}

const toMin = (hm) => {
  const [h, m] = String(hm || '').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/** ¿Hoy es día laborable según school_settings.work_days? */
function isWorkday(workDays, dow) {
  if (Array.isArray(workDays) && workDays.length) {
    return workDays.some((d) => {
      const key = String(d || '').trim().replace(/\s+/g, '');
      return DOW_NAMES[key] === dow;
    });
  }
  // Por defecto: lunes a viernes
  return dow >= 1 && dow <= 5;
}

function parseResult(d) {
  if (!d || typeof d !== 'object') return { marked: 0, parents: [], students: [] };
  return {
    marked: Number.isFinite(d.marked) ? d.marked : 0,
    parents: Array.isArray(d.parents) ? d.parents : [],
    students: Array.isArray(d.students) ? d.students : []
  };
}

/**
 * Fallback client-side: replica mark_absent_students() cuando el RPC no existe.
 * Devuelve null si aún no corresponde marcar (fuera de umbral / feriado).
 */
async function jsMarkAbsentFallback() {
  const { data: settings } = await supabase
    .from('school_settings')
    .select('check_in_end, open_time, work_days')
    .eq('id', 1)
    .maybeSingle();

  // El límite de entrada se resuelve de check_in_end; si no existe, cae a open_time
  // para que la detección automática trabaje siempre con el horario configurado.
  const limitEnd = settings?.check_in_end || settings?.open_time;
  if (!limitEnd) return null;

  const { date, time, dow } = nowDRInfo();
  const threshold = toMin(limitEnd) + 120; // límite de entrada + 2h
  if (toMin(time) < threshold) return null;
  if (!isWorkday(settings.work_days, dow)) return null;

  const [students, attendance, requests, year] = await Promise.allSettled([
    supabase.from('students').select('id, classroom_id, name, parent_id')
      .eq('is_active', true).not('classroom_id', 'is', null),
    supabase.from('attendance').select('id, student_id, status').eq('date', date),
    supabase.from('attendance_requests').select('student_id, reason, note')
      .eq('date', date).in('status', ['pending', 'approved']),
    supabase.from('school_years').select('id').eq('status', 'active')
      .order('id', { ascending: false }).limit(1)
  ]);
  const get = (r) => r.status === 'fulfilled' ? (r.value?.data || []) : [];

  const studentsList = get(students);
  const attRows = get(attendance);
  const requestRows = get(requests);
  const yearId = year.status === 'fulfilled' ? (year.value?.data?.[0]?.id ?? null) : null;

  const reqMap = new Map();
  requestRows.forEach((r) => { if (!reqMap.has(r.student_id)) reqMap.set(r.student_id, r); });

  const attMap = new Map();
  attRows.forEach((a) => { if (!attMap.has(a.student_id)) attMap.set(a.student_id, a); });

  const toInsert = [];
  const toUpdateIds = [];
  const parentSet = new Set();
  const parents = [];
  const studentsOut = [];

  for (const s of studentsList) {
    const row = attMap.get(s.id);
    if (!row) {
      toInsert.push({
        student_id: s.id,
        classroom_id: s.classroom_id,
        date,
        status: 'absent',
        school_year_id: yearId && Number(yearId) > 0 ? Number(yearId) : null
      });
    } else if (!row.status || !FINAL_STATUSES.has(String(row.status).toLowerCase())) {
      toUpdateIds.push(row.id);
    } else {
      continue; // ya tiene estado final (present/late/retirado/absent)
    }

    const req = reqMap.get(s.id);
    const reason = req?.reason ?? null;
    const note = req?.note ?? null;
    if (s.parent_id && !parentSet.has(s.parent_id)) {
      parentSet.add(s.parent_id);
      parents.push(s.parent_id);
    }
    studentsOut.push({
      student_id: s.id, name: s.name, parent_id: s.parent_id,
      reason, note, absence_reason: reason
    });
  }

  if (toInsert.length) {
    const { error } = await supabase
      .from('attendance')
      .upsert(toInsert, { onConflict: 'student_id,date' });
    if (error) throw error;
  }
  if (toUpdateIds.length) {
    const { error } = await supabase
      .from('attendance')
      .update({ status: 'absent' })
      .in('id', toUpdateIds);
    if (error) throw error;
  }

  return { marked: toInsert.length + toUpdateIds.length, parents, students: studentsOut };
}

/**
 * Marca ausencias automáticamente. RPC primero; fallback JS si no existe.
 * Deduplica llamadas simultáneas y no reintenta el fallback durante 2 min si falla.
 */
export async function autoMarkAbsentStudents() {
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    try {
      const rpc = await supabase.rpc('mark_absent_students');
      if (!rpc.error) return parseResult(rpc.data);

      if (Date.now() < _jsDisabledUntil) return { marked: 0, parents: [], students: [] };
      try {
        const fallback = await jsMarkAbsentFallback();
        if (fallback) return fallback;
      } catch (err) {
        Helpers?.safeLog?.('warn', '[Absentes] Fallback JS fallido:', err?.message || err);
        _jsDisabledUntil = Date.now() + 2 * 60_000;
      }
      return { marked: 0, parents: [], students: [] };
    } catch (_) {
      return { marked: 0, parents: [], students: [] };
    }
  })().finally(() => { _inFlight = null; });
  return _inFlight;
}