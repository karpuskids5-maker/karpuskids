/**
 * 💳 PaymentService — Capa centralizada de pagos
 * Solo usa columnas que existen en la DB real.
 */
import { supabase, sendPush, emitEvent } from './supabase.js';
import { Helpers } from './helpers.js';

export const MES = ['enero','febrero','marzo','abril','mayo','junio',
             'julio','agosto','septiembre','octubre','noviembre','diciembre'];

export const MES_LABEL = MES.map(m => m.charAt(0).toUpperCase() + m.slice(1));

// ── Helpers exportados ────────────────────────────────────────────────────────
export function calcMora(dueDate) {
  return Helpers.calculateMora(dueDate);
}
export function getMoraBreakdown(dueDate) {
  return Helpers.getMoraBreakdown(dueDate);
}
export function normalizeStatus(p) {
  const s = (p.status || '').toLowerCase();
  if (['paid','pagado','confirmado','approved'].includes(s)) return 'paid';
  if (['overdue','vencido'].includes(s))                return 'overdue';
  if (['rechazado','rejected'].includes(s))             return 'rejected';
  if (['review','revision','en revision'].includes(s))  return 'review';
  if ((s === 'pending' || s === 'pendiente') && p.evidence_url) return 'review';
  return 'pending';
}
export function daysUntilDue(dueDate) {
  if (!dueDate) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((new Date(dueDate + 'T00:00:00') - today) / 86400000);
}

// ── Regla: no se facturan meses futuros ──────────────────────────────────────
/**
 * Un cargo solo puede existir para el mes en curso o uno anterior. Los cargos
 * se crean el día de generación de SU mes (día 25 por school_settings), así que
 * un '2026-10' un 27 de septiembre es un cargo adelantado: el padre ve un cobro
 * que todavía no corresponde y el 'pendiente' se descuadra.
 *
 * Acepta los dos formatos de month_paid ('2026-10' y 'octubre'). Si el mes no
 * se puede interpretar devuelve null = no bloquea, para no impedir el registro
 * de cargos antiguos sin año.
 */
export function futureMonthKey(mp, refDate) {
  const s = String(mp || '').toLowerCase().trim();
  if (!s) return null;
  const ymd = s.match(/^(\d{4})-(\d{1,2})$/);
  if (ymd) return ymd[1] + '-' + ymd[2].padStart(2, '0');
  const i = MES.indexOf(s);
  if (i === -1) return null;
  const d = refDate ? new Date(refDate) : new Date();
  return d.getFullYear() + '-' + String(i + 1).padStart(2, '0');
}

export function isFutureMonth(mp, refDate) {
  const key = futureMonthKey(mp, refDate);
  if (!key) return false;
  const today = new Date();
  const now = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
  return key > now;
}

// ── KPIs de la gestión financiera ─────────────────────────────────────────────
/**
 * Calcula los contadores de un mes sobre un array de pagos YA filtrado por
 * deleted_at en la query. Lo usan directora y asistente: antes cada panel tenía
 * su propia copia y por eso mostraban cifras distintas.
 *
 * - month_paid acepta los dos formatos que hay en la base: '2026-09' y
 *   'septiembre'. Comparar solo contra 'YYYY-MM' dejaba fuera la mitad.
 * - Los contadores son de CARGOS, no de estudiantes (un alumno puede tener
 *   Mensualidad + Materiales + Día Prolongado). Se devuelven ambos.
 * - 'overdue' se deriva de due_date, no del status: el status solo lo actualiza
 *   el cron karpus-mark-overdue (10:00) y entre ejecuciones iba desfasado.
 * - 'rejected' cuenta como pendiente: el dinero no se cobró.
 * - El ingreso se atribuye al MES que se cobró (month_paid normalizado), igual
 *   que financial_summary_month() en SQL; no al día en que se registró la
 *   aprobación (paid_date). Antes se atribuía por paid_date y septiembre sumaba
 *   los pagos de mayo/agosto aprobados el 23/09 como si fueran ingreso de
 *   septiembre ($176,738), cuando nadie había pagado septiembre todavía.
 * - Un cargo sin month_paid (materiales sueltos, etc.) cae a fecha de cobro.
 */
export function computePaymentStats(rows, year, month) {
  const y = String(year);
  const m = String(month).padStart(2, '0');
  const monthKey  = `${y}-${m}`;
  const monthName = MES[Number(m) - 1] || '';
  const lastDay   = new Date(Number(y), Number(m), 0).getDate();
  // Instantes, no strings: comparar ISO con offsets distintos rompe el borde
  // de mes (30/09 21:00 -04:00 es 01/10 en UTC).
  const fromTs = new Date(`${y}-${m}-01T00:00:00`).getTime();
  const toTs   = new Date(`${y}-${m}-${String(lastDay).padStart(2, '0')}T23:59:59`).getTime();

  const inMonth = (mp) => {
    const s = String(mp || '').toLowerCase().trim();
    return !!s && (s === monthKey || s === monthName);
  };

  const today = new Date(); today.setHours(0, 0, 0, 0);
  let income = 0, pending = 0, overdue = 0, review = 0;
  const pendingStudents = new Set(), overdueStudents = new Set(), reviewStudents = new Set();

  for (const p of rows || []) {
    const sk = normalizeStatus(p);

    if (sk === 'paid') {
      // Ingreso por mes cobrado (month_paid normalizado por futureMonthKey; p.ej.
      // '2026-08' y 'agosto' dan la misma clave). Un pago aprobado hoy pero del
      // mes de agosto cuenta en agosto, no en el mes en que se aprobó.
      const mk = futureMonthKey(p.month_paid, p.paid_date || p.created_at);
      if (mk) {
        if (mk === monthKey) income += Number(p.amount || 0);
        continue;
      }
      // Cargo sin mes interpretable: atribuir por fecha de cobro (base caja).
      const t = new Date(p.paid_date || p.created_at).getTime();
      if (Number.isFinite(t) && t >= fromTs && t <= toTs) income += Number(p.amount || 0);
      continue;
    }
    if (!inMonth(p.month_paid)) continue;
    if (sk === 'review') { review++; reviewStudents.add(p.student_id); continue; }
    // Usar el status real de BD para overdue (ya sincronizado por la migración 33)
    // Solo recalcular como overdue si el status en BD sigue siendo pending pero due_date pasó
    const isOverdue = sk === 'overdue' || (sk === 'pending' && p.due_date && new Date(p.due_date + 'T00:00:00') < today);
    if (isOverdue) { overdue++; overdueStudents.add(p.student_id); continue; }
    pending++; pendingStudents.add(p.student_id);
  }

  return {
    income, pending, overdue, review,
    pendingStudents: pendingStudents.size,
    overdueStudents: overdueStudents.size,
    reviewStudents:  reviewStudents.size
  };
}

// ── Columnas seguras ──────────────────────────────────────────────────────────
const PAYMENT_COLS = 'id,student_id,amount,concept,status,due_date,created_at,paid_date,method,bank,reference,month_paid,evidence_url,notes';
const PAYMENT_COLS_WITH_STUDENT = PAYMENT_COLS + ',students:student_id(name,p1_email,parent_id,classroom_id,classrooms:classroom_id(name))';

export const PaymentService = {

  async getPendingValidation() {
    const { data, error } = await supabase
      .from('payments')
      .select(PAYMENT_COLS + ',students:student_id(name,p1_email,parent_id,classrooms:classroom_id(name))')
      .not('evidence_url', 'is', null)
      .in('status', ['pending','pendiente','review'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async approve(id, note = '') {
    // Use server-side RPC (approve_payment) which enforces role + proof checks
    const { data, error } = await supabase.rpc('approve_payment', {
      p_payment_id: id,
      p_notes: note || null
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    const { data: p, error: fe } = await supabase
      .from('payments').select(PAYMENT_COLS_WITH_STUDENT).eq('id', id).single();
    if (fe) throw fe;

    const student = p?.students;
    const amount  = Helpers.formatCurrency(Number(p?.amount||0));
    const month   = p?.month_paid || 'Colegiatura';

    if (student?.parent_id) {
      sendPush({
        user_id: student.parent_id,
        title:   '✅ Pago Confirmado',
        message: `Tu pago de ${amount} para ${month} fue aprobado.`,
        type:    'payment',
        link:    'panel_padres.html'
      }).catch(() => {});
    }
    emitEvent('payment.approved', {
      payment_id:   id,
      parent_email: student?.p1_email,
      parent_id:    student?.parent_id,
      student_name: student?.name,
      amount,
      month
    }).catch(() => {});
    return true;
  },

  async reject(id, reason = '') {
    const { data: p, error: fe } = await supabase
      .from('payments').select('students:student_id(parent_id)').eq('id', id).single();
    if (fe) throw fe;

    const { error } = await supabase
      .from('payments')
      .update({ status: 'rejected', notes: reason || null })
      .eq('id', id);
    if (error) throw error;

    if (p?.students?.parent_id) {
      sendPush({
        user_id: p.students.parent_id,
        title:   '⚠️ Comprobante rechazado',
        message: reason || 'Por favor sube una foto más clara del comprobante.',
        type:    'payment',
        link:    'panel_padres.html'
      }).catch(() => {});
    }
    return true;
  },

  async checkDuplicate(reference) {
    if (!reference?.trim()) return null;
    const { data } = await supabase
      .from('payments')
      .select('id,student_id,amount,month_paid,students:student_id(name)')
      .eq('reference', reference.trim())
      .limit(1)
      .maybeSingle();
    return data || null;
  },

  subscribeToNewVouchers(onNew) {
    const enrich = async (id) => {
      const { data: p } = await supabase
        .from('payments')
        .select(PAYMENT_COLS + ',students:student_id(name,classrooms:classroom_id(name))')
        .eq('id', id)
        .single();
      if (p) onNew(p);
    };
    return supabase.channel('payment_vouchers')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payments' },
        (pl) => { if (pl.new?.evidence_url) enrich(pl.new.id); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payments' },
        (pl) => { if (pl.new?.evidence_url && !pl.old?.evidence_url) enrich(pl.new.id); })
      .subscribe();
  }
};
