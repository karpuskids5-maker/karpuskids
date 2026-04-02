/**
 * 💳 PaymentService — Capa centralizada de pagos
 * Solo usa columnas que existen en la DB real.
 */
import { supabase, sendPush, emitEvent } from './supabase.js';
import { Helpers } from './helpers.js';

const MES = ['enero','febrero','marzo','abril','mayo','junio',
             'julio','agosto','septiembre','octubre','noviembre','diciembre'];

// ── Helpers exportados ────────────────────────────────────────────────────────
export function calcMora(dueDate) {
  return Helpers.calculateMora(dueDate);
}
export function getMoraBreakdown(dueDate) {
  return Helpers.getMoraBreakdown(dueDate);
}
export function normalizeStatus(p) {
  const s = (p.status || '').toLowerCase();
  if (['paid','pagado','confirmado'].includes(s))      return 'paid';
  if (['overdue','vencido'].includes(s))               return 'overdue';
  if (['rechazado','rejected'].includes(s))            return 'rechazado';
  if (['review','revision','en revision'].includes(s)) return 'review';
  if ((s === 'pending' || s === 'pendiente') && p.evidence_url) return 'review';
  return 'pending';
}
export function daysUntilDue(dueDate) {
  if (!dueDate) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((new Date(dueDate + 'T00:00:00') - today) / 86400000);
}

// ── Columnas seguras (sin columnas inexistentes) ───────────────────────────────
const PAYMENT_COLS = 'id,student_id,amount,concept,status,due_date,created_at,paid_date,method,bank,reference,month_paid,evidence_url,notes';
const PAYMENT_COLS_WITH_STUDENT = PAYMENT_COLS + ',students:student_id(name,p1_email,parent_id,classroom_id,classrooms:classroom_id(name))';

export const PaymentService = {

  async getByMonth(monthIndex, _year, filters = {}) {
    const monthName = MES[monthIndex];
    let q = supabase
      .from('payments')
      .select(PAYMENT_COLS_WITH_STUDENT)
      .ilike('month_paid', monthName)
      .order('due_date', { ascending: true });

    if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status);
    const { data, error } = await q;
    if (error) throw error;

    let list = data || [];
    if (filters.search) {
search.toLowerCase();
      list = list.filter(p => p.students?.name?.toLowerCase().includes(sq));
    }
    return list;
  },

  async getPendingValidation() {
    const { data, error } = await supabase
      .from('payments')
      .select(PAYMENT_COLS + ',students:student_id(name,p1_email,parent_id,classrooms:classroom_id(name))')
      .not('evidence_url', 'is', null)
      .in('status', ['pending','pendiente','review'])
      .order('created_at', { ascending: false });
    if (error) throw error;
rn data || [];
  },

  async getStats() {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01T00:00:00.000Z`;
    const [incomeRes, pendingRes, overdueRes, reviewRes] = await Promise.all([
      supabase.from('payments').select('amount').in('status',['paid','pagado','confirmado']).gte('created_at', monthStart),
      supabase.from('payments').select('*',{count:'exact',head:true}).in('status',['pending','pendiente']),
      supabase.from('payments').select('*',{count:'exact',head:true}).in('status',['overdue','vencido']),
      supabase.from('payments').select('*',{count:'exact',head:true}).not('evidence_url','is',null).in('status',['pending','pendiente','review'])
    ]);
    return {
      incomeMonth: (incomeRes.data||[]).reduce((s,p) => s + Number(p.amount||0), 0),
      pending:     pendingRes.count || 0,
      overdue:     overdueRes.count || 0,
      toApprove:   reviewRes.count  || 0
    };
  },

  async approve(id) {
    const { data: p, error: fe } = await supabase
      .from('payments').select(PAYMENT_COLS_WITH_STUDENT).eq('id', id).single();
    if (fe) throw fe;

    const { error } = await supabase
      .from('payments').update({ status: 'paid', paid_date: new Date().toISOString() }).eq('id', id);
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
hazado', notes: reason || null }).eq('id', id);
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
        .from('payments').select(PAYMENT_COLS + ',students:st).eq('id', id).single();
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
