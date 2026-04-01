/**
 * 💳 PaymentService — Capa centralizada de pagos
 * Todos los paneles usan este servicio. Nunca acceden a Supabase directamente.
 */
import { supabase, sendPush, emitEvent } from './supabase.js';
import { Helpers } from './helpers.js';

const MES = ['enero','febrero','marzo','abril','mayo','junio',
             'julio','agosto','septiembre','octubre','noviembre','diciembre'];

export const PaymentService = {

  // ── Queries ────────────────────────────────────────────────────────────────

  /** Pagos del mes con datos del estudiante */
  async getByMonth(monthIndex, year, filters = {}) {
    const monthName = MES[monthIndex];
    let q = supabase
      .from('payments')
      .select('id,student_id,amount,concept,status,due_date,created_at,paid_date,method,bank,reference,month_paid,evidence_url,notes,students:student_id(name,p1_email,parent_id,classroom_id,classrooms:classroom_id(name))')
      .ilike('month_paid', monthName)
      .order('due_date', { ascending: true });

    if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status);
    if (filters.search) q = q.ilike('students.name', `%${filters.search}%`);

    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  /** Pagos pendientes de validación (voucher subido, sin aprobar) */
  async getPendingValidation() {
    const { data, error } = await supabase
      .from('payments')
      .select('id,student_id,amount,month_paid,due_date,evidence_url,reference,bank,method,created_at,students:student_id(name,p1_email,parent_id,classrooms:classroom_id(name))')
      .not('evidence_url', 'is', null)
      .in('status', ['pending', 'pendiente', 'review'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  /** KPIs financieros del mes actual */
  async getStats() {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01T00:00:00.000Z`;
    const [incomeRes, pendingRes, overdueRes, reviewRes] = await Promise.all([
      supabase.from('payments').select('amount').in('status', ['paid','pagado','confirmado']).gte('created_at', monthStart),
      supabase.from('payments').select('*', { count: 'exact', head: true }).in('status', ['pending','pendiente']),
      supabase.from('payments').select('*', { count: 'exact', head: true }).in('status', ['overdue','vencido']),
      supabase.from('payments').select('*', { count: 'exact', head: true }).not('evidence_url','is',null).in('status',['pending','pendiente','review'])
    ]);
    return {
      incomeMonth: (incomeRes.data||[]).reduce((s,p) => s + Number(p.amount||0), 0),
      pending:     pendingRes.count || 0,
      overdue:     overdueRes.count || 0,
      toApprove:   reviewRes.count  || 0
    };
  },

  // ── Acciones ───────────────────────────────────────────────────────────────

  /** Aprobar pago — actualiza DB, envía email + push al padre */
  async approve(id) {
    const { data: p, error: fetchErr } = await supabase
      .from('payments')
      .select('*,students:student_id(name,p1_email,parent_id)')
      .eq('id', id).single();
    if (fetchErr) throw fetchErr;

    const { error } = await supabase
      .from('payments')
      .update({ status: 'paid', paid_date: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;

    // Notificaciones en paralelo — silenciosas si fallan
    const student = p.students;
    const amount  = Helpers.formatCurrency(Number(p.amount||0));
    const month   = p.month_paid || 'Colegiatura';

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

  /** Rechazar pago con nota */
  async reject(id, reason = '') {
    const { error } = await supabase
      .from('payments')
      .update({ status: 'rechazado', notes: reason || null })
      .eq('id', id);
    if (error) throw error;

    // Notificar al padre para que suba mejor foto
    const { data: p } = await supabase
      .from('payments')
      .select('students:student_id(parent_id,name)')
      .eq('id', id).single();

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

  /** Condonar mora (directora) */
  async condone(id) {
    const { error } = await supabase
      .from('payments')
      .update({ mora_condoned: true, mora_amount: 0 })
      .eq('id', id);
    if (error) throw error;
    return true;
  },

  /** Verificar si una referencia bancaria ya existe (anti-duplicados) */
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

  // ── Realtime ───────────────────────────────────────────────────────────────

  /**
   * Suscribirse a nuevos vouchers subidos por padres.
   * Llama onNew(payment) cuando un padre sube un comprobante.
   */
  subscribeToNewVouchers(onNew) {
    const channel = supabase
      .channel('payment_vouchers')
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'payments',
        filter: 'evidence_url=not.is.null'
      }, async (payload) => {
        if (!payload.new?.evidence_url) return;
        // Enriquecer con datos del estudiante
        const { data: p } = await supabase
          .from('payments')
          .select('*,students:student_id(name,classrooms:classroom_id(name))')
          .eq('id', payload.new.id).single();
        if (p) onNew(p);
      })
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'payments'
      }, async (payload) => {
        // Detectar cuando se sube voucher en un pago existente
        if (payload.new?.evidence_url && !payload.old?.evidence_url) {
          const { data: p } = await supabase
            .from('payments')
            .select('*,students:student_id(name,classrooms:classroom_id(name))')
            .eq('id', payload.new.id).single();
          if (p) onNew(p);
        }
      })
      .subscribe();
    return channel;
  },

  /** Calcular mora del lado del cliente (fallback si no hay Edge Function) */
  calcMora(dueDate) {
    return Helpers.calculateMora(dueDate);
  },

  /** Normalizar estado */
  normalizeStatus(p) {
    const s = (p.status || '').toLowerCase();
    if (['paid','pagado','confirmado'].includes(s)) return 'paid';
    if (['overdue','vencido'].includes(s)) return 'overdue';
    if (['review','revision','en revision'].includes(s)) return 'review';
    if ((s === 'pending' || s === 'pendiente') && p.evidence_url) return 'review';
    return 'pending';
  }
};
