import { supabase } from '../shared/supabase.js';

const TABLES = {
  PROFILES: 'profiles',
  CLASSROOMS: 'classrooms',
  STUDENTS: 'students',
  ATTENDANCE: 'attendance',
  TASKS: 'tasks',
  TASK_EVIDENCES: 'task_evidences',
  GRADES: 'grades',
  PERIODS: 'periods',
  REPORT_CARDS: 'report_cards'
};

const withTimeout = (promise, ms = 10000) => {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
  return Promise.race([promise, timeout]);
};

const logError = (context, err) => {
  console.error(`[DirectorApi:${context}]`, err);
  return { data: null, error: err.message || err };
};

export const DirectorApi = {
  // --- PERIODS ---
  async getPeriods() {
    try {
      const res = await withTimeout(supabase.from(TABLES.PERIODS).select('*').order('start_date', { ascending: false }));
      return res;
    } catch (e) { return logError('getPeriods', e); }
  },

  async closePeriod(periodId) {
    try {
      const { data: period, error: pError } = await supabase.from(TABLES.PERIODS).update({ status: 'closed' }).eq('id', periodId).select().single();
      if (pError) throw pError;
      return { data: period, error: null };
    } catch (e) { return logError('closePeriod', e); }
  },

  // --- GRADING LOGIC ---
  calculateGradeFromStars(stars) {
    return stars || 0; // Escala 1-5
  },

  calculateGradeFromLetter(letter) {
    const map = { 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1 };
    return map[letter] || 0;
  },

  getDescriptor(score) {
    if (score >= 4.5) return '🌟 Excelente';
    if (score >= 3.5) return '👍 Bueno';
    if (score >= 2.5) return '⚠️ En proceso';
    return '❗ Requiere apoyo';
  },

  // --- TASKS & GRADES ---
  async getTaskGrades(filters = {}) {
    let query = supabase
      .from(TABLES.TASK_EVIDENCES)
      .select('*, student:student_id(name, avatar_url, classroom_id, classrooms:classroom_id(name)), task:task_id(title, classroom:classroom_id(name, teacher:teacher_id(name)))')
      .order('created_at', { ascending: false });

    if (filters.classroom_id) query = query.eq('task.classroom_id', filters.classroom_id);
    
    try {
      const res = await withTimeout(query);
      return res;
    } catch (e) { return logError('getTaskGrades', e); }
  },

  async getFormalGrades(periodId) {
    try {
      const res = await withTimeout(supabase.from(TABLES.GRADES).select('*, student:student_id(name, classroom_id)').eq('period_id', periodId));
      return res;
    } catch (e) { return logError('getFormalGrades', e); }
  },

  // --- REPORT CARDS ---
  async generateReportCard(payload) {
    try {
      const res = await withTimeout(supabase.from(TABLES.REPORT_CARDS).upsert(payload).select().single());
      return res;
    } catch (e) { return logError('generateReportCard', e); }
  },

  async getReportCards(filters = {}) {
    let query = supabase.from(TABLES.REPORT_CARDS).select('*, student:student_id(name), period:period_id(name)');
    if (filters.student_id) query = query.eq('student_id', filters.student_id);
    if (filters.period_id) query = query.eq('period_id', filters.period_id);
    
    try {
      const res = await withTimeout(query);
      return res;
    } catch (e) { return logError('getReportCards', e); }
  },

  // --- DASHBOARD & KPIs ---
  async getDashboardKPIs(monthText = '') {
    try {
      // Intentar usar el RPC si existe
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_dashboard_kpis', { p_month: monthText || '%' });
      
      if (!rpcError && rpcData) {
        return { data: rpcData, error: null };
      }

      // Fallback manual si el RPC falla o no está disponible
      const today = new Date().toISOString().split('T')[0];
      const results = await Promise.allSettled([
        supabase.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('students').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).in('role', ['maestra', 'asistente']),
        supabase.from('classrooms').select('*', { count: 'exact', head: true }),
        supabase.from('attendance').select('*', { count: 'exact', head: true }).eq('date', today).in('status', ['present', 'late']),
        supabase.from('payments').select('amount').eq('status', 'pending'),
        supabase.from('inquiries').select('*', { count: 'exact', head: true }).not('status', 'in', '("resolved","closed")')
      ]);

      const get = (r) => r.status === 'fulfilled' ? r.value : { count: 0, data: [] };
      const [activeRes, totalRes, teachersRes, classroomsRes, attendanceRes, pendingPayRes, inquiriesRes] = results.map(get);

      const pendingAmount = (pendingPayRes.data || []).reduce((s, p) => s + Number(p.amount || 0), 0);

      return {
        data: {
          active:      activeRes.count      || 0,
          total:       totalRes.count       || 0,
          teachers:    teachersRes.count    || 0,
          classrooms:  classroomsRes.count  || 0,
          attendance_today: attendanceRes.count || 0,
          pending_payments:   pendingAmount, // Ajustado a pending_payments para consistencia con RPC
          inquiries:   inquiriesRes.count   || 0
        },
        error: null
      };
    } catch (e) { return logError('getDashboardKPIs', e); }
  },

  // --- ATTENDANCE ---
  async getAttendanceByDate(date) {
    try {
      return await supabase
        .from(TABLES.ATTENDANCE)
        .select('*, student:student_id(name), classroom:classroom_id(name)')
        .eq('date', date);
    } catch (e) { return logError('getAttendanceByDate', e); }
  },

  async getAttendanceLast7Days() {
    try {
      return await supabase.rpc('attendance_last_7_days');
    } catch (e) { return logError('getAttendanceLast7Days', e); }
  },

  // --- FINANCES & PAYMENTS ---
  async getFinancialSummary(year, month) {
    try {
      return await supabase.rpc('financial_summary_month', { 
        p_year: parseInt(year), 
        p_month: parseInt(month) 
      });
    } catch (e) { return logError('getFinancialSummary', e); }
  },

  async getPayments(filters = {}) {
    try {
      let query = supabase.from('payments').select('*, students(name, classrooms:classroom_id(name))');
      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
      if (filters.year) {
        query = query.gte('due_date', `${filters.year}-01-01`).lte('due_date', `${filters.year}-12-31`);
      }
      if (filters.search) query = query.ilike('students.name', `%${filters.search}%`);
      return await query.order('created_at', { ascending: false });
    } catch (e) { return logError('getPayments', e); }
  },

  async getPaymentStats() {
    try {
      const now = new Date();
      const month = now.toLocaleString('es-ES', { month: 'long' });
      const formattedMonth = month.charAt(0).toUpperCase() + month.slice(1);
      
      const [incomeRes, pendingRes, overdueRes, reviewRes] = await Promise.all([
        supabase.from('payments').select('amount').eq('status', 'paid').ilike('month_paid', formattedMonth),
        supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'overdue'),
        supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'review')
      ]);

      const income = (incomeRes.data || []).reduce((sum, p) => sum + Number(p.amount), 0);

      return {
        data: {
          incomeMonth: income,
          pending: pendingRes.count || 0,
          overdue: overdueRes.count || 0,
          toApprove: reviewRes.count || 0
        },
        error: null
      };
    } catch (e) { return logError('getPaymentStats', e); }
  },

  async createManualPayment(data) {
    return await supabase.from('payments').insert(data).select().single();
  },

  async updatePayment(id, updates) {
    return await supabase.from('payments').update(updates).eq('id', id);
  },

  async deletePayment(id) {
    return await supabase.from('payments').delete().eq('id', id);
  },

  async runPaymentCycle() {
    try {
      return await supabase.rpc('run_payment_cycle');
    } catch (e) { return logError('runPaymentCycle', e); }
  },

  // --- INQUIRIES / REPORTES ---
  async getInquiries(filters = {}) {
    try {
      let query = supabase.from('inquiries').select('*, parent:parent_id(name, email)').order('created_at', { ascending: false });
      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
      return await query;
    } catch (e) { return logError('getInquiries', e); }
  },

  async updateInquiry(id, updates) {
    return await supabase.from('inquiries').update(updates).eq('id', id);
  },

  // --- CONFIGURACIÓN ---
  async getSchoolSettings() {
    try {
      // .maybeSingle() devuelve null si no hay fila, en lugar de Error 406
      return await supabase.from('school_settings').select('*').eq('id', 1).maybeSingle();
    } catch (e) { return logError('getSchoolSettings', e); }
  },

  async updateSchoolSettings(updates) {
    return await supabase.from('school_settings').update(updates).eq('id', 1);
  },

  // --- CLASSROOMS ---
  async getClassroomsWithOccupancy() {
    try {
      const { data, error } = await supabase
        .from(TABLES.CLASSROOMS)
        .select(`
          *,
          profiles:teacher_id(name),
          students(count)
        `)
        .order('name');
      if (error) throw error;
      const normalized = (data || []).map(r => ({
        ...r,
        student_count: r.students?.[0]?.count || 0
      }));
      return { data: normalized, error: null };
    } catch (e) { return logError('getClassroomsWithOccupancy', e); }
  },

  // --- CHAT ---
  async getChatUsers(myId, roleFilter) {
    try {
      let query = supabase.from('profiles').select('*').neq('id', myId);
      if (roleFilter && roleFilter !== 'all') query = query.eq('role', roleFilter);
      return await query.order('name');
    } catch (e) { return logError('getChatUsers', e); }
  },

  async getStudentsByParentIds(ids) {
    try {
      return await supabase.from(TABLES.STUDENTS).select('parent_id, name, classrooms:classroom_id(name)').in('parent_id', ids);
    } catch (e) { return logError('getStudentsByParentIds', e); }
  },

  async getChatHistory(otherId) {
    try {
      return await supabase.rpc('get_direct_messages', { p_other_user_id: otherId });
    } catch (e) { return logError('getChatHistory', e); }
  },

  async sendMessage(sender_id, receiver_id, content) {
    return await supabase.from('messages').insert({ sender_id, receiver_id, content });
  },

  // --- ESTUDIANTES ---
  async getStudents() {
    try {
      return await supabase.from(TABLES.STUDENTS).select('*, classrooms:classroom_id(name)').order('name');
    } catch (e) { return logError('getStudents', e); }
  },
  async createStudent(data) {
    return await supabase.from(TABLES.STUDENTS).insert(data);
  },
  async updateStudent(id, data) {
    return await supabase.from(TABLES.STUDENTS).update(data).eq('id', id);
  },
  async deleteStudent(id) {
    return await supabase.from(TABLES.STUDENTS).delete().eq('id', id);
  },

  // --- PERSONAL (MAESTROS/ASISTENTES) ---
  async getTeachers() {
    try {
      const { data, error } = await supabase
        .from(TABLES.PROFILES)
        .select('*, classrooms!classrooms_teacher_id_fkey(id, name)')
        .in('role', ['maestra', 'asistente'])
        .order('name');
      if (error) throw error;
      // Normalizar classroom join
      const normalized = (data || []).map(t => ({
        ...t,
        classroom_id: t.classrooms?.[0]?.id || t.classrooms?.id || null,
        classrooms: t.classrooms?.[0] || t.classrooms || null
      }));
      return { data: normalized, error: null };
    } catch (e) { return logError('getTeachers', e); }
  },

  async updateTeacher(id, data) {
    const { classroom_id, ...profileData } = data;
    if (classroom_id !== undefined) {
      await supabase.from(TABLES.CLASSROOMS).update({ teacher_id: null }).eq('teacher_id', id);
      if (classroom_id) {
        await supabase.from(TABLES.CLASSROOMS).update({ teacher_id: id }).eq('id', classroom_id);
      }
    }
    return await supabase.from(TABLES.PROFILES).update(profileData).eq('id', id);
  },

  async getClassrooms() {
    return await supabase.from(TABLES.CLASSROOMS).select('*, teacher:teacher_id(name)').order('name');
  },

  async generateMonthlyCharges(month, year) {
    try {
      return await supabase.rpc('generate_monthly_charges', { p_month: month, p_year: year });
    } catch (e) { return logError('generateMonthlyCharges', e); }
  },

  async getPaymentById(id) {
    try {
      return await supabase.from('payments')
        .select('*, students:student_id(name, p1_email, p2_email, classrooms:classroom_id(name))')
        .eq('id', id).single();
    } catch (e) { return logError('getPaymentById', e); }
  },

  async sendPaymentReceipt(paymentId) {
    try {
      const { data: p } = await this.getPaymentById(paymentId);
      if (!p) return;
      const emails = [p.students?.p1_email, p.students?.p2_email].filter(Boolean);
      if (!emails.length) return;

      const { sendEmail } = await import('../shared/supabase.js');
      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 30px; border: 1px solid #f0f0f0; border-radius: 20px;">
          <h2 style="color: #16a34a; text-align: center;">Recibo de Pago — Karpus Kids ✅</h2>
          <p>Hola,</p>
          <p>Se ha confirmado el pago de colegiatura para el estudiante <b>${p.students?.name}</b>.</p>
          
          <div style="background: #f9fafb; padding: 20px; border-radius: 15px; margin: 25px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="color: #6b7280; padding: 5px 0;">Concepto:</td><td style="text-align: right; font-weight: bold;">${p.month_paid || 'Colegiatura'}</td></tr>
              <tr><td style="color: #6b7280; padding: 5px 0;">Monto:</td><td style="text-align: right; font-weight: bold;">$${Number(p.amount).toFixed(2)}</td></tr>
              <tr><td style="color: #6b7280; padding: 5px 0;">Método:</td><td style="text-align: right; font-weight: bold; text-transform: capitalize;">${p.method || 'Transferencia'}</td></tr>
              <tr><td style="color: #6b7280; padding: 5px 0;">Fecha:</td><td style="text-align: right; font-weight: bold;">${new Date().toLocaleDateString()}</td></tr>
            </table>
          </div>

          <p style="font-size: 14px; color: #4b5563; text-align: center;">Gracias por tu puntualidad y compromiso con la educación de tu hijo.</p>
          <div style="text-align: center; margin-top: 30px;">
             <a href="https://karpuskids.com/panel_padres.html" style="background: #16a34a; color: white; padding: 12px 25px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 14px;">Abrir Panel de Padres</a>
          </div>
          <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 30px 0;">
          <p style="font-size: 11px; color: #9ca3af; text-align: center;">Karpus Kids System — Este es un correo automático, por favor no respondas.</p>
        </div>
      `;

      await sendEmail(emails, `Recibo de Pago: ${p.month_paid} — ${p.students?.name}`, html);
      return true;
    } catch (e) { 
      console.error('[sendPaymentReceipt] Error:', e);
      return false; 
    }
  }
};