/**
 * 💳 PaymentService — Sistema de pagos centralizado y robusto
 *
 * Estados del ciclo de vida:
 *   pending   → generado, dentro del plazo
 *   review    → padre subió voucher, esperando validación
 *   paid      → aprobado por asistente/directora
 *   overdue   → pasó la fecha límite sin pagar
 *   excused   → padre envió excusa, mora suspendida temporalmente
 *   rechazado → voucher rechazado, padre debe reenviar
 *
 * Mora: RD$50/día los primeros 6 días, RD$500 por cada semana completa.
 * Se suspende si el pago tiene excusa activa (excuse_approved = null o true).
 */
import { supabase, sendPush, emitEvent } from './supabase.js';
import { Helpers } from './helpers.js';

const MES = ['enero','febrero','marzo','abril','mayo','junio',
             'julio','agosto','septiembre','octubre','noviembre','diciembre'];

// ── Mora ──────────────────────────────────────────────────────────────────────
export function calcMora(dueDate, condoned = false, excused = false) {
  if (condoned || excused) return 0;
  return Helpers.calculateMora(dueDate);
}

export function getMoraBreakdown(dueDate, condoned = false, excused = false) {
  if (condoned || excused) return null;
  return Helpers.getMoraBreakdown(dueDate);
}

// ── Normalizar estado ─────────────────────────────────────────────────────────
export function normalizeStatus(p) {
  const s = (p.status || '').toLowerCase();
  if (['paid','pagado','confirmado'].includes(s))          return 'paid';
  if (['overdue','vencido'].includes(s))                   return 'overdue';
  if (['excused','excusado'].includes(s))                  return 'excused';
  if (['rechazado','rejected'].includes(s))                return 'rechazado';
  if (['review','revision','en revision'].includes(s))     return 'review';
  if ((s === 'pending' || s === 'pendiente') && p.evidence_url) return 'review';
  return 'pending';
}

// ── Días para vencer ──────────────────────────────────────────────────────────
export function daysUntilDue(dueDate) {
  if (!dueDate) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const due   = new Date(dueDate + 'T00:00:00');
  return Math.round((due - today) / 86400000);
}

export const PaymentService = {

  // ── Queries ────────────────────────────────────────────────────────────────

  async getByMonth(monthIndex, year, filters = {}) {
    const monthName = MES[monthIndex];
    let q = supabase
      .from('payments')
      .select('id,student_id,amount,concept,status,due_date,created_at,paid_date,method,bank,reference,month_paid,evidence_url,notes,mora_condoned,excuse_text,excuse_approved,students:student_id(name,p1_email,parent_id,classroom_id,classrooms:classroom_id(name))')
      .ilike('month_paid', monthName)
      .order('due_date', { ascending: true });

    if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status);
    const { data, error } = await q;
    if (error) throw error;

    let list = data || [];
    if (filters.search) {
      const q2 = filters.search.toLowerCase();
      list = list.filter(p => p.students?.name?.toLowerCase().includes(q2));
    }
    return list;
  },

  async getPendingValidation() {
    const { data, error } = await supabase
      .from('payments')
      .select('id,student_id,amount,month_paid,due_date,evidence_url,reference,bank,method,created_at,excuse_text,excuse_approved,mora_condoned,students:student_id(name,p1_email,parent_id,classrooms:classroom_id(name))')
      .not('evidence_url', 'is', null)
      .in('status', ['pending','pendiente','review'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getStats() {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01T00:00:00.000Z`;
    const [incomeRes, pendingRes, overdueRes, reviewRes, excusedRes] = await Promise.all([
      supabase.from('payments').select('amount').in('status',['paid','pagado','confirmado']).gte('created_at', monthStart),
      supabase.from('payments').select('*',{count:'exact',head:true}).in('status',['pending','pendiente']),
      supabase.from('payments').select('*',{count:'exact',head:true}).in('status',['overdue','vencido']),
      supabase.from('payments').select('*',{count:'exact',head:true}).not('evidence_url','is',null).in('status',['pending','pendiente','review']),
      supabase.from('payments').select('*',{count:'exact',head:true}).in('status',['excused','excusado'])
    ]);
    return {
      incomeMonth: (incomeRes.data||[]).reduce((s,p) => s + Number(p.amount||0), 0),
      pending:     pendingRes.count  || 0,
      overdue:     overdueRes.count  || 0,
      toApprove:   reviewRes.count   || 0,
      excused:     excusedRes.count  || 0
    };
  },

  // ── Acciones ───────────────────────────────────────────────────────────────

  async approve(id) {
    const { data: p, error: fe } = await supabase
      .from('payments')
      .select('*,students:student_id(name,p1_email,parent_id)')
      .eq('id', id).single();
    if (fe) throw fe;

    const { error } = await supabase
      .from('payments')
      .update({ status: 'paid', paid_date: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;

    const student = p.students;
    const amount  = Helpers.formatCurrency(Number(p.amount||0));
    const month   = p.month_paid || 'Colegiatura';

    if (student?.parent_id) {
      sendPush({ user_id: student.parent_id, title: '✅ Pago Confirmado',
        message: `Tu pago de ${amount} para ${month} fue aprobado.`, type: 'payment', link: 'panel_padres.html'
      }).catch(() => {});
    }
    emitEvent('payment.approved', {
      payment_id: id, parent_email: student?.p1_email, parent_id: student?.parent_id,
      student_name: student?.name, amount, month
    }).catch(() => {});
    return true;
  },

  async reject(id, reason = '') {
    const { error } = await supabase
      .from('payments')
      .update({ status: 'rechazado', notes: reason || null })
      .eq('id', id);
    if (error) throw error;

    const { data: p } = await supabase
      .from('payments').select('students:student_id(parent_id)').eq('id', id).single();
    if (p?.students?.parent_id) {
      sendPush({ user_id: p.students.parent_id, title: '⚠️ Comprobante rechazado',
        message: reason || 'Por favor sube una foto más clara del comprobante.',
        type: 'payment', link: 'panel_padres.html'
      }).catch(() => {});
    }
    return true;
  },

  /** Condonar mora — directora puede perdonar el recargo */
  async condone(id) {
    const { error } = await supabase
      .from('payments')
      .update({ mora_condoned: true })
      .eq('id', id);
    if (error) throw error;
    return true;
  },

  /** Padre envía excusa de pago tardío */
  async submitExcuse(paymentId, excuseText) {
    if (!excuseText?.trim()) throw new Error('La excusa no puede estar vacía');
    const { error } = await supabase
      .from('payments')
      .update({
        excuse_text:     excuseText.trim(),
        excuse_approved: null,   // null = pendiente de revisión
        status:          'excused'
      })
      .eq('id', paymentId);
    if (error) throw error;

    // Notificar al staff
    const { data: p } = await supabase
      .from('payments')
      .select('month_paid,students:student_id(name)')
      .eq('id', paymentId).single();

    const { data: staff } = await supabase
      .from('profiles').select('id').in('role', ['directora','asistente']);
    for (const s of staff || []) {
      sendPush({ user_id: s.id, title: '📝 Nueva excusa de pago',
        message: `${p?.students?.name || 'Un padre'} envió una excusa para ${p?.month_paid || 'su pago'}.`,
        type: 'payment', link: 'panel_directora.html'
      }).catch(() => {});
    }
    return true;
  },

  /** Directora/Asistente aprueba o rechaza la excusa */
  async reviewExcuse(paymentId, approved, staffNote = '') {
    const updates = {
      excuse_approved: approved,
      notes: staffNote || null
    };
    // Si se aprueba la excusa, suspender mora temporalmente
    if (approved) updates.mora_condoned = true;
    // Si se rechaza, volver a overdue
    if (!approved) updates.status = 'overdue';

    const { error } = await supabase
      .from('payments').update(updates).eq('id', paymentId);
    if (error) throw error;

    // Notificar al padre
    const { data: p } = await supabase
      .from('payments')
      .select('month_paid,students:student_id(parent_id,name)')
      .eq('id', paymentId).single();

    if (p?.students?.parent_id) {
      sendPush({
        user_id: p.students.parent_id,
        title:   approved ? '✅ Excusa aprobada' : '❌ Excusa rechazada',
        message: approved
          ? `Tu excusa para ${p.month_paid} fue aceptada. La mora está suspendida.`
          : `Tu excusa para ${p.month_paid} fue rechazada. ${staffNote || 'Comunícate con la dirección.'}`,
        type: 'payment', link: 'panel_padres.html'
      }).catch(() => {});
    }
    return true;
  },

  async checkDuplicate(reference) {
    if (!reference?.trim()) return null;
    const { data } = await supabase
      .from('payments')
      .select('id,student_id,amount,month_paid,students:student_id(name)')
      .eq('reference', reference.trim()).limit(1).maybeSingle();
    return data || null;
  },

  subscribeToNewVouchers(onNew) {
    const enrich = async (id) => {
      const { data: p } = await supabase
        .from('payments')
        .select('*,students:student_id(name,classrooms:classroom_id(name))')
        .eq('id', id).single();
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
