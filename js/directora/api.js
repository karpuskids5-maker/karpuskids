import { supabase, sendEmail } from '../shared/supabase.js';
import { TABLES } from '../shared/constants.js';
import { Helpers } from '../shared/helpers.js';

/**
 * 🛠️ Helpers de Producción
 */
function logError(context, error) {
  console.error(`[DirectorApi:${context}]`, error);
  // Aquí podrías integrar Sentry / LogRocket
}

/**
 * Agrega un tiempo límite a cualquier promesa
 */
async function withTimeout(promise, ms = 20000) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout tras ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

/**
 * Estandariza la respuesta de Supabase
 */
function handleResponse({ data, error, count }, context = 'API') {
  if (error) {
    logError(context, error);
    return { data: null, error: error.message || 'Error inesperado', count: 0 };
  }
  return { data, error: null, count: count || 0 };
}

/**
 * Orquestador central de consultas
 */
async function queryBuilder(query, context = 'Query') {
  try {
    const res = await withTimeout(query);
    return handleResponse(res, context);
  } catch (error) {
    logError(context, error);
    return { data: null, error: error.message, count: 0 };
  }
}

/**
 * Consultas del panel Directora
 */
export const DirectorApi = {
  async getDashboardKPIs() {
    const today = new Date().toISOString().split('T')[0];

    const results = await Promise.allSettled([
      supabase.from(TABLES.STUDENTS).select('*', { count: 'exact', head: true }),
      supabase.from(TABLES.STUDENTS).select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from(TABLES.INQUIRIES).select('*', { count: 'exact', head: true }).in('status', ['received', 'review', 'in_progress']),
      supabase.from(TABLES.CLASSROOMS).select('*', { count: 'exact', head: true }),
      supabase.from(TABLES.PROFILES).select('*', { count: 'exact', head: true }).eq('role', 'maestra'),
      supabase.from(TABLES.PAYMENTS).select('*', { count: 'exact', head: true }).eq('status', 'pending').lt('created_at', today),
      supabase.from(TABLES.PAYMENTS).select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from(TABLES.PAYMENTS).select('*', { count: 'exact', head: true }).eq('status', 'paid'),
      supabase.from(TABLES.ATTENDANCE).select('*', { count: 'exact', head: true }).eq('date', today).in('status', ['present', 'late'])
    ]);

    const getCount = (r) => (r.status === 'fulfilled' && r.value?.count) ? r.value.count : 0;

    return {
      data: {
        total: getCount(results[0]),
        active: getCount(results[1]),
        inquiries: getCount(results[2]),
        classrooms: getCount(results[3]),
        teachers: getCount(results[4]),
        overdue_payments: getCount(results[5]),
        pending_payments: getCount(results[6]),
        paid_payments: getCount(results[7]),
        attendance_today: getCount(results[8])
      },
      error: null
    };
  },

  async getTaskGrades(filters = {}) {
    let query = supabase
      .from(TABLES.TASK_EVIDENCES)
      // Traemos tarea, aula Y maestra (anidado)
      .select('*, student:student_id(name, avatar_url, classroom_id), task:task_id(title, classroom:classroom_id(name, teacher:teacher_id(name)))')
      .order('created_at', { ascending: false });

    // Filtrado en cliente para simplificar queries complejas
    const { data, error } = await queryBuilder(query, 'getTaskGrades');
    
    if (data) {
      // 1. Filtrar solo los calificados (Letra O Estrellas)
      let filtered = data.filter(item => item.grade_letter || (item.stars !== null && item.stars !== undefined));

      // 2. Filtro por Aula
      if (filters.classroom_id && filters.classroom_id !== 'all') {
        filtered = filtered.filter(item => item.student?.classroom_id == filters.classroom_id);
      }

      // 3. Filtro por Búsqueda
      if (filters.search) {
        const q = filters.search.toLowerCase();
        filtered = filtered.filter(item => item.student?.name?.toLowerCase().includes(q) || item.task?.title?.toLowerCase().includes(q));
      }

      return { data: filtered, error };
    }
    return { data, error };
  },

  async getGrades(filters = {}) {
    let query = supabase
      .from('grades')
      .select('*, student:student_id(name, avatar_url), classroom:classroom_id(name), teacher:teacher_id(name)')
      .order('created_at', { ascending: false });

    if (filters.classroom_id) query = query.eq('classroom_id', filters.classroom_id);
    if (filters.subject) query = query.eq('subject', filters.subject);
    if (filters.search) query = query.ilike('students.name', `%${filters.search}%`);

    return await queryBuilder(query, 'getGrades');
  },

  async getStudents() {
    return await queryBuilder(
      supabase.from(TABLES.STUDENTS)
        .select('id, name, matricula, is_active, p1_name, p1_phone, p1_email, classroom_id, avatar_url, classrooms:classroom_id(name)')
        .order('name'),
      'getStudents'
    );
  },

  async importStudentsBatch(studentsData) {
    return await queryBuilder(
      supabase.from(TABLES.STUDENTS).insert(studentsData).select(),
      'importStudentsBatch'
    );
  },

  async createStudent(payload) {
    if (!payload.name) return { data: null, error: 'Nombre requerido' };
    return await queryBuilder(
      supabase.from(TABLES.STUDENTS).insert([payload]).select().single(),
      'createStudent'
    );
  },

  async updateStudent(id, payload) {
    return await queryBuilder(
      supabase.from(TABLES.STUDENTS).update(payload).eq('id', id).select().single(),
      'updateStudent'
    );
  },

  async deleteStudent(id) {
    return await queryBuilder(
      supabase.from(TABLES.STUDENTS).delete().eq('id', id),
      'deleteStudent'
    );
  },

  async getTeachers() {
    return await queryBuilder(
      supabase.from(TABLES.PROFILES).select('*').eq('role', 'maestra').order('name'),
      'getTeachers'
    );
  },

  async createTeacher(payload) {
    return await queryBuilder(
      supabase.from(TABLES.PROFILES).insert([payload]).select().single(),
      'createTeacher'
    );
  },

  async updateTeacher(id, payload) {
    return await queryBuilder(
      supabase.from(TABLES.PROFILES).update(payload).eq('id', id).select().single(),
      'updateTeacher'
    );
  },

  async createManualPayment(data) {
    return await queryBuilder(
      supabase.from(TABLES.PAYMENTS).insert([data]).select().single(),
      'createManualPayment'
    );
  },

  async deletePayment(id) {
    return await queryBuilder(
      supabase.from(TABLES.PAYMENTS).delete().eq('id', id),
      'deletePayment'
    );
  },

  async generateMonthlyCharges(month, year) {
    return await queryBuilder(
      supabase.rpc('generate_monthly_charges', { p_month: month, p_year: year }),
      'generateMonthlyCharges'
    );
  },

  async getInquiries(filters = {}) {
    let query = supabase
      .from(TABLES.INQUIRIES)
      .select('*, parent:profiles(name, email)')
      .order('created_at', { ascending: false });

    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }

    return await queryBuilder(query, 'getInquiries');
  },

  async getClassrooms() {
    return await queryBuilder(
      supabase.from(TABLES.CLASSROOMS).select('*, teacher:teacher_id(name,email)').order('name'),
      'getClassrooms'
    );
  },

  async getAttendanceByDate(date) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    return await queryBuilder(
      supabase.from(TABLES.ATTENDANCE)
        .select('*, students(name, classroom_id, p1_email, p2_email), classrooms(name)')
        .eq('date', targetDate)
        .order('classroom_id', { ascending: true }),
      'getAttendanceByDate'
    );
  },

  async getPaymentById(id) {
    return await queryBuilder(
      supabase.from(TABLES.PAYMENTS)
        .select('*, students:student_id(name, classroom_id, p1_email, p2_email, p1_name, p2_name, classrooms:classroom_id(name))')
        .eq('id', id)
        .single(),
      'getPaymentById'
    );
  },

  async updatePayment(id, updates) {
    return await queryBuilder(
      supabase.from(TABLES.PAYMENTS).update(updates).eq('id', id).select().single(),
      'updatePayment'
    );
  },

  async getPayments(filters = {}) {
    let query = supabase
      .from(TABLES.PAYMENTS)
      .select('*, students:student_id(name, classroom_id, p1_email, p2_email, classrooms:classroom_id(name))')
      .order('due_date', { ascending: true });

    if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
    
    // Filtro por periodo (Mes y Año) sobre FECHA DE VENCIMIENTO, no created_at
    if (filters.year && filters.month) {
      const month = String(parseInt(filters.month, 10)).padStart(2, '0');
      const lastDay = new Date(filters.year, parseInt(month, 10), 0).getDate();
      const startDate = `${filters.year}-${month}-01`;
      const endDate = `${filters.year}-${month}-${String(lastDay).padStart(2, '0')}`;
      query = query.gte('due_date', startDate).lte('due_date', endDate);
    } else if (filters.year) {
      query = query.gte('due_date', `${filters.year}-01-01`).lte('due_date', `${filters.year}-12-31`);
    }

    if (filters.startDate) query = query.gte('created_at', filters.startDate);
    if (filters.endDate) query = query.lte('created_at', filters.endDate);
    if (filters.search) query = query.ilike('students.name', `%${filters.search}%`);

    return await queryBuilder(query, 'getPayments');
  },

  // 💰 Estadísticas para Tarjetas de Pagos
  async getPaymentStats() {
    const today = new Date();
    // Usar el nombre del mes actual en español como filtro para month_paid
    const currentMonthName = today.toLocaleString('es-ES', { month: 'long' });
    
    try {
      const results = await Promise.all([
        // Ingresos del mes (pagados) - Intentamos con paid_date, si falla usaremos created_at
        supabase.from(TABLES.PAYMENTS).select('amount').eq('status', 'paid').gte('created_at', `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`),
        // Pendientes (total)
        supabase.from(TABLES.PAYMENTS).select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        // Vencidos
        supabase.from(TABLES.PAYMENTS).select('*', { count: 'exact', head: true }).eq('status', 'overdue'),
        // Confirmados (total histórico)
        supabase.from(TABLES.PAYMENTS).select('*', { count: 'exact', head: true }).eq('status', 'paid'),
        // Por Aprobar (Transferencias pendientes)
        supabase.from(TABLES.PAYMENTS).select('*', { count: 'exact', head: true }).filter('status', 'in', '("pending","review")').eq('method', 'transferencia')
      ]);

      const income = (results[0].data || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);

      return {
        data: {
          incomeMonth: income,
          pending: results[1].count || 0,
          overdue: results[2].count || 0,
          confirmed: results[3].count || 0,
          toApprove: results[4].count || 0
        },
        error: null
      };
    } catch (e) {
      console.error('Error fetching payment stats:', e);
      return { data: { incomeMonth: 0, pending: 0, overdue: 0, confirmed: 0, toApprove: 0 }, error: e };
    }
  },

  async sendPaymentReceipt(paymentId, extraNotes = '') {
    const { data: payment, error } = await this.getPaymentById(paymentId);
    if (error || !payment) return { data: null, error: error || 'Pago no encontrado' };

    const student = payment.students;
    const parents = [student?.p1_email, student?.p2_email].filter(Boolean);
    if (!parents.length) return { data: null, error: 'No hay correos registrados' };

    const subject = `Recibo de pago Karpus - ${student.name}`;
    const body = `<p>Hola,</p><p>Se ha registrado un pago para <strong>${Helpers.escapeHTML(student.name)}</strong>...</p>`;
    const text = `Pago registrado para ${student.name}. Monto: ${payment.amount}.`;

    const results = await Promise.allSettled(
      parents.map(email => sendEmail(email, subject, body, text))
    );

    return {
      data: results.map(r => ({ success: r.status === 'fulfilled', error: r.status === 'rejected' ? r.reason : null })),
      error: null
    };
  },

  async updateInquiry(id, payload) {
    return await queryBuilder(
      supabase.from(TABLES.INQUIRIES).update(payload).eq('id', id).select().single(),
      'updateInquiry'
    );
  },

  async sendMessage(senderId, receiverId, content) {
    return await queryBuilder(
      supabase.from(TABLES.MESSAGES).insert([{ sender_id: senderId, receiver_id: receiverId, content }]).select().single(),
      'sendMessage'
    );
  },

  async getChatUsers(currentUserId, roleFilter) {
    let query = supabase.from(TABLES.PROFILES).select('id, name, avatar_url, role').neq('id', currentUserId);
    if (roleFilter && roleFilter !== 'all') query = query.eq('role', roleFilter);
    return await queryBuilder(query, 'getChatUsers');
  },

  async getStudentsByParentIds(parentIds) {
    if (!parentIds.length) return { data: [], error: null };
    return await queryBuilder(
      supabase.from(TABLES.STUDENTS).select('parent_id, name, classrooms(name)').in('parent_id', parentIds),
      'getStudentsByParentIds'
    );
  },

  async getChatHistory(otherUserId) {
    return await queryBuilder(
      supabase.rpc('get_direct_messages', { p_other_user_id: otherUserId }),
      'getChatHistory'
    );
  },

  async getClassroomsWithOccupancy() {
    const { data: classrooms, error } = await this.getClassrooms();
    if (error) return { data: null, error };
    
    const enriched = await Promise.all(classrooms.map(async (c) => {
      const { count } = await supabase.from(TABLES.STUDENTS).select('*', { count: 'exact', head: true }).eq('classroom_id', c.id).eq('is_active', true);
      const current = count || 0;
      const capacity = c.capacity || 20;
      const percent = capacity ? (current / capacity) * 100 : 0;
      return { ...c, current_capacity: current, occupancyStatus: percent > 80 ? 'red' : percent > 50 ? 'yellow' : 'green' };
    }));
    
    return { data: enriched, error: null };
  },

  async getAttendanceLast7Days() {
    try {
      const res = await withTimeout(supabase.rpc('attendance_last_7_days'));
      if (!res.error) return { data: res.data, error: null };
    } catch (e) { logError('attendance_last_7_days', e); }

    const today = new Date();
    const startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data, error } = await queryBuilder(
      supabase.from(TABLES.ATTENDANCE).select('date, status').gte('date', startDate).lte('date', today.toISOString().split('T')[0]),
      'getAttendanceLast7DaysFallback'
    );

    if (error) return { data: null, error };
    const trend = {};
    data.forEach(r => {
      if (!trend[r.date]) trend[r.date] = { present: 0, absent: 0, late: 0, total: 0 };
      if (r.status === 'present') trend[r.date].present++;
      else if (r.status === 'absent') trend[r.date].absent++;
      else if (r.status === 'late') trend[r.date].late++;
      trend[r.date].total++;
    });
    return { data: trend, error: null };
  },

  async getFinancialSummary(year = new Date().getFullYear(), month = new Date().getMonth() + 1) {
    try {
      const res = await withTimeout(supabase.rpc('financial_summary_month', { p_year: year, p_month: month }));
      if (!res.error) return { data: res.data, error: null };
    } catch (e) { logError('financial_summary_month', e); }

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const { data, error } = await queryBuilder(
      supabase.from(TABLES.PAYMENTS).select('amount, status').gte('created_at', startDate).lt('created_at', endDate),
      'getFinancialSummaryFallback'
    );

    if (error) return { data: null, error };
    const summary = { total_invoiced: 0, total_paid: 0, total_pending: 0, percentagePaid: 0 };
    data.forEach(p => {
      summary.total_invoiced += p.amount || 0;
      if (p.status === 'paid') summary.total_paid += p.amount || 0;
      else summary.total_pending += p.amount || 0;
    });
    summary.percentagePaid = summary.total_invoiced > 0 ? Math.round((summary.total_paid / summary.total_invoiced) * 100) : 0;
    return { data: summary, error: null };
  }
};