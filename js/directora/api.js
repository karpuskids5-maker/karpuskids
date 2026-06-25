import { supabase } from '../shared/supabase.js';
import { QueryCache } from '../shared/query-cache.js';
import { safeHandle } from '../shared/db-utils.js';

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

// Local timeout helper â€” accepts a promise OR a function returning a promise
const withTimeout = (promiseOrFn, ms = 10000) => {
  const p = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
  return Promise.race([p, timeout]);
};

const logError = (context, err) => {
  safeHandle(err, `DirectorApi.${context}`);
  return { data: null, error: err.message || err };
};

export const DirectorApi = {
  // --- PERIODS ---
  async getPeriods() {
    try {
      const res = await withTimeout(supabase.from(TABLES.PERIODS).select('id, name, start_date, end_date, status, is_active, classroom_id, created_at').limit(10).order('start_date', { ascending: false }));
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
    if (score >= 4.5) return 'ðŸŒŸ Excelente';
    if (score >= 3.5) return 'ðŸ‘ Bueno';
    if (score >= 2.5) return 'âš ï¸ En proceso';
    return 'â— Requiere apoyo';
  },

  // --- TASKS & GRADES ---
  async getTaskGrades(filters = {}) {
    // Simplified select to avoid N+1 triple join
    let query = supabase
      .from(TABLES.TASK_EVIDENCES)
      .select('id, status, grade_letter, stars, created_at, student:student_id(name, classroom_id), task:task_id(title, classroom_id)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (filters.classroom_id) query = query.eq('task.classroom_id', filters.classroom_id);
    
    try {
      const res = await withTimeout(query);
      return res;
    } catch (e) { return logError('getTaskGrades', e); }
  },

  async getFormalGrades(periodId) {
    try {
      const res = await withTimeout(supabase.from(TABLES.GRADES)
        .select('id, subject, score, period, created_at, student:student_id(name, classroom_id)')
        .eq('period_id', periodId)
        .limit(200));
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
        return { 
          data: {
            ...rpcData,
            pending_payments: rpcData.pending_amount || rpcData.pending_payments || 0
          }, 
          error: null 
        };
      }

      // Optimización: Usar head: true para conteos rápidos (evita descargar toda la tabla)
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      const results = await Promise.allSettled([
        supabase.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).in('role', ['maestra', 'asistente']),
        supabase.from('classrooms').select('*', { count: 'exact', head: true }),
        supabase.from('attendance').select('*', { count: 'exact', head: true }).eq('date', today).in('status', ['present', 'late']),
        supabase.from('inquiries').select('*', { count: 'exact', head: true }).not('status', 'in', '("resolved","closed")'),
        // Para pagos pendientes, vencidos y en revisión, necesitamos la suma de montos
        supabase.from('payments').select('amount').in('status', ['pending', 'overdue', 'review']).limit(1000)
      ]);

      const get = (r) => r.status === 'fulfilled' ? r.value : { count: 0, data: [] };
      const [totalRes, teachersRes, classroomsRes, attendanceRes, inquiriesRes, pendingPayRes] = results.map(get);

      const pendingAmount = (pendingPayRes.data || []).reduce((s, p) => s + Number(p.amount || 0), 0);

      return {
        data: {
          active:           totalRes.count || 0,
          total:            totalRes.count || 0,
          teachers:         teachersRes.count    || 0,
          classrooms:       classroomsRes.count  || 0,
          attendance_today: attendanceRes.count  || 0,
          pending_payments: pendingAmount,
          inquiries:        inquiriesRes.count   || 0
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
        .select('id, date, check_in, check_out, status, student_id, classroom_id, student:student_id(name), classroom:classroom_id(name)')
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
      let query = supabase.from('payments')
        .select('id, amount, status, month_paid, due_date, paid_date, method, bank, reference, proof_url, evidence_url, created_at, students:student_id(name, classrooms:classroom_id(name))', { count: 'exact' });
      
      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
      if (filters.year) {
        const yr = String(filters.year);
        query = query.like('month_paid', yr + '-%');
      }
      if (filters.month_paid) query = query.eq('month_paid', filters.month_paid);

      if (filters.range) {
        query = query.range(filters.range.from, filters.range.to);
      } else {
        query = query.limit(filters.limit || 200);
      }

      return await query.order('created_at', { ascending: false });
    } catch (e) { return logError('getPayments', e); }
  },

  async getPaymentStats(filterMonth, filterYear) {
    try {
      const now   = new Date();
      const year  = filterYear  ? String(filterYear)  : String(now.getFullYear());
      const month = filterMonth ? String(filterMonth).padStart(2, '0') : String(now.getMonth() + 1).padStart(2, '0');
      const monthKey   = `${year}-${month}`;
      const rangeStart = `${year}-${month}-01`;
      // Calculate real last day of month â€” avoids invalid dates like 04-31
      const lastDay    = new Date(parseInt(year), parseInt(month), 0).getDate();
      const rangeEnd   = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

      // Helper: count payments by status for this month (handles both YYYY-MM and Spanish formats)
      const countByStatus = async (status) => {
        const [r1, r2] = await Promise.all([
          supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', status).eq('month_paid', monthKey),
          supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', status).gte('created_at', rangeStart).lte('created_at', rangeEnd + 'T23:59:59')
        ]);
        return Math.max(r1.count || 0, r2.count || 0);
      };

      const sumPaid = async () => {
        const [r1, r2] = await Promise.all([
          supabase.from('payments').select('amount').eq('status', 'paid').eq('month_paid', monthKey),
          supabase.from('payments').select('amount').eq('status', 'paid').gte('created_at', rangeStart).lte('created_at', rangeEnd + 'T23:59:59')
        ]);
        const d1 = r1.data || []; const d2 = r2.data || [];
        const combined = d1.length >= d2.length ? d1 : d2;
        return combined.reduce((s, p) => s + Number(p.amount || 0), 0);
      };

      const [income, pending, overdue, toApprove] = await Promise.all([
        sumPaid(),
        countByStatus('pending'),
        countByStatus('overdue'),
        countByStatus('review')
      ]);

      return { data: { incomeMonth: income, pending, overdue, toApprove }, error: null };
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
      let query = supabase.from('inquiries')
        .select('id, subject, message, status, priority, created_at, parent:parent_id(name, email)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
      return await query;
    } catch (e) { return logError('getInquiries', e); }
  },

  async updateInquiry(id, updates) {
    return await supabase.from('inquiries').update(updates).eq('id', id);
  },

  // --- CONFIGURACIÃ“N ---
  async getSchoolSettings() {
    try {
      // .maybeSingle() devuelve null si no hay fila, en lugar de Error 406
      return await supabase.from('school_settings').select('id, generation_day, due_day, open_time, close_time, work_days, phone, business_hours').eq('id', 1).maybeSingle();
    } catch (e) { return logError('getSchoolSettings', e); }
  },

  async updateSchoolSettings(updates) {
    return await supabase.from('school_settings').update(updates).eq('id', 1);
  },

  // --- CLASSROOMS ---
  async getClassroomsWithOccupancy() {
    return QueryCache.get('dir_classrooms_occ', async () => {
      try {
        const { data, error } = await supabase
          .from(TABLES.CLASSROOMS)
          .select('id, name, level, capacity, profiles:teacher_id(name), students(count)')
          .order('name');
        if (error) throw error;
        const normalized = (data || []).map(r => ({
          ...r,
          student_count: r.students?.[0]?.count || 0
        }));
        return { data: normalized, error: null };
      } catch (e) { return logError('getClassroomsWithOccupancy', e); }
    }, 3 * 60_000);
  },

  // --- CHAT ---
  async getChatUsers(myId, roleFilter) {
    try {
      console.log('getChatUsers called with myId:', myId, 'roleFilter:', roleFilter);
      
      // Primero: obtener TODOS perfiles activos
      let query = supabase
        .from('profiles')
        .select('id, name, role, avatar_url, email, phone')
        .neq('id', myId)
        .is('deleted_at', null)
        .order('name')
        .limit(200);
      
      if (roleFilter && roleFilter !== 'all') {
        query = query.eq('role', roleFilter);
      }

      const { data: allProfiles, error: profilesErr } = await query;
      
      if (profilesErr) {
        console.error('Error fetching profiles:', profilesErr);
        return { data: [], error: profilesErr };
      }
      
      console.log('getChatUsers: allProfiles count:', (allProfiles || []).length);

      // Filtrar perfiles con nombre válido
      let validProfiles = (allProfiles || []).filter(u => u.name && u.name.trim().length > 0);
      console.log('getChatUsers: validProfiles count:', validProfiles.length);

      // Obtener IDs de padres con estudiantes activos
      const { data: activeStudents } = await supabase
        .from(TABLES.STUDENTS)
        .select('parent_id')
        .is('deleted_at', null)
        .eq('is_active', true);

      const activeParentIds = [...new Set((activeStudents || []).map(s => s.parent_id).filter(Boolean))];
      console.log('getChatUsers: activeParentIds count:', activeParentIds.length, 'IDs:', activeParentIds);

      // Filtrar perfiles finales:
      // - Padres: solo si están en activeParentIds
      // - Personal (directora, maestra, asistente): todos válidos
      const finalUsers = validProfiles.filter(u => {
        if (u.role === 'padre') {
          return activeParentIds.includes(u.id);
        }
        return true;
      });

      console.log('getChatUsers: finalUsers count:', finalUsers.length, 'finalUsers:', finalUsers);

      return { data: finalUsers, error: null };
    } catch (e) { 
      console.error('getChatUsers complete error:', e);
      return logError('getChatUsers', e); 
    }
  },

  async getStudentsByParentIds(ids) {
    try {
      if (!ids || ids.length === 0) {
        return { data: [], error: null };
      }
      // Sin join de classrooms para evitar error 400 por FK hint incorrecto
      const { data: students, error } = await supabase
        .from(TABLES.STUDENTS)
        .select('parent_id, name, classroom_id')
        .in('parent_id', ids)
        .is('deleted_at', null)
        .eq('is_active', true);
      if (error) throw error;

      // Enriquecer con nombre de aula en query separada si hay classroom_ids
      const classroomIds = [...new Set((students || []).map(s => s.classroom_id).filter(Boolean))];
      let classroomMap = {};
      if (classroomIds.length > 0) {
        const { data: rooms } = await supabase
          .from('classrooms')
          .select('id, name')
          .in('id', classroomIds);
        (rooms || []).forEach(r => { classroomMap[r.id] = r.name; });
      }

      const enriched = (students || []).map(s => ({
        ...s,
        classrooms: s.classroom_id ? { name: classroomMap[s.classroom_id] || '' } : null
      }));

      return { data: enriched, error: null };
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
  async getStudents(filters = {}, range = null) {
    let q = supabase
      .from(TABLES.STUDENTS)
      .select('id, name, avatar_url, matricula, age, age_type, classrooms(id, name), is_active', { count: 'exact' })
      .order('name');

    if (filters.search) q = q.ilike('name', `%${filters.search}%`);
    if (filters.classroom_id) q = q.eq('classroom_id', filters.classroom_id);
    if (filters.status === 'active') q = q.eq('is_active', true);
    if (filters.status === 'inactive') q = q.eq('is_active', false);
    
    if (range) {
      q = q.range(range.from, range.to);
    } else {
      q = q.limit(100); // Default safety limit
    }

    return q;
  },

  async getQuickCounts() {
    // Ya optimizado con head: true
    const [students, teachers, classrooms, inquiries] = await Promise.all([
      supabase.from(TABLES.STUDENTS).select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from(TABLES.PROFILES).select('*', { count: 'exact', head: true }).in('role', ['maestra', 'asistente']),
      supabase.from(TABLES.CLASSROOMS).select('*', { count: 'exact', head: true }),
      supabase.from('inquiries').select('*', { count: 'exact', head: true }).eq('status', 'pending')
    ]);
    return {
      students: students.count || 0,
      teachers: teachers.count || 0,
      classrooms: classrooms.count || 0,
      inquiries: inquiries.count || 0
    };
  },
  async createStudent(data) {
    try {
      const result = await withTimeout(() => supabase.from(TABLES.STUDENTS).insert(data).select().single());
      QueryCache.invalidate('dir_students');
      return result;
    } catch (e) { return logError('createStudent', e); }
  },
  async updateStudent(id, data) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { data: null, error: 'ID de estudiante inválido' };

    // Whitelist explícito de columnas válidas en la tabla students
    const ALLOWED_COLUMNS = new Set([
      'name','matricula','classroom_id','age','age_type','schedule','start_date',
      'is_active','blood_type','allergies','authorized_pickup','authorized_pickup_phone',
      'p1_name','p1_phone','p1_email','p1_job','p1_address','p1_emergency_contact',
      'p2_name','p2_phone','p2_email','p2_job','p2_address','p2_emergency_contact',
      'monthly_fee','prolongado_fee','due_day','avatar_url','parent_id',
      'notes','qr_code','deleted_at'
    ]);

    const clean = {};
    for (const [k, v] of Object.entries(data)) {
      if (!ALLOWED_COLUMNS.has(k)) continue; // descartar campos desconocidos
      clean[k] = v;
    }

    // Conversiones de tipo
    if ('horario'        in data) { clean.schedule      = data.horario || null; }
    if ('classroom_id'  in clean) clean.classroom_id   = clean.classroom_id   ? parseInt(clean.classroom_id)   : null;
    if ('age'           in clean) clean.age            = clean.age            ? parseInt(clean.age)            : null;
    if ('monthly_fee'   in clean) clean.monthly_fee    = clean.monthly_fee    != null ? parseFloat(clean.monthly_fee)   : 0;
    if ('prolongado_fee' in clean) clean.prolongado_fee = clean.prolongado_fee != null ? parseFloat(clean.prolongado_fee) : 0;
    if ('due_day'       in clean) clean.due_day        = clean.due_day        ? parseInt(clean.due_day)        : 5;

    const result = await withTimeout(() =>
      supabase.from(TABLES.STUDENTS).update(clean).eq('id', numId).select().single()
    );
    QueryCache.invalidate('dir_students');
    return result;
  },
  async deleteStudent(id) {
    const result = await supabase.from(TABLES.STUDENTS).delete().eq('id', id);
    QueryCache.invalidate('dir_students');
    return result;
  },

  // --- PERSONAL (MAESTROS/ASISTENTES) ---
  async getTeachers() {
    return QueryCache.get('dir_teachers', async () => {
      try {
        const { data, error } = await withTimeout(() =>
          supabase.from(TABLES.PROFILES)
            .select('id, name, role, email, phone, avatar_url, classrooms!classrooms_teacher_id_fkey(id, name)')
            .in('role', ['maestra', 'asistente'])
            .order('name')
        );
        if (error) throw error;
        const normalized = (data || []).map(t => ({
          ...t,
          classroom_id: t.classrooms?.[0]?.id || t.classrooms?.id || null,
          classrooms: t.classrooms?.[0] || t.classrooms || null
        }));
        return { data: normalized, error: null };
      } catch (e) { return logError('getTeachers', e); }
    }, 5 * 60_000);
  },

  async updateTeacher(id, data) {
    const { classroom_id, ...profileData } = data;
    if (classroom_id !== undefined) {
      await supabase.from(TABLES.CLASSROOMS).update({ teacher_id: null }).eq('teacher_id', id);
      if (classroom_id) {
        await supabase.from(TABLES.CLASSROOMS).update({ teacher_id: id }).eq('id', classroom_id);
      }
    }
    // Only send columns that exist in profiles table â€” exclude email (can't update via profiles)
    const ALLOWED = ['name', 'phone', 'role', 'bio', 'notes', 'access_code', 'avatar_url', 'onesignal_player_id'];
    const safeData = Object.fromEntries(Object.entries(profileData).filter(([k]) => ALLOWED.includes(k)));
    const result = await supabase.from(TABLES.PROFILES).update(safeData).eq('id', id);
    QueryCache.invalidate('dir_teachers');
    QueryCache.invalidate('classrooms_list');
    return result;
  },

  async getClassrooms() {
    return QueryCache.get('dir_classrooms', async () =>
      supabase.from(TABLES.CLASSROOMS).select('id, name, level, capacity, teacher:teacher_id(name)').order('name'),
      5 * 60_000
    );
  },

  async generateMonthlyCharges(month, year) {
    try {
      return await supabase.rpc('generate_monthly_charges', { 
        p_month: Number(month), 
        p_year: Number(year) 
      });
    } catch (e) { return logError('generateMonthlyCharges', e); }
  },

  async getPaymentById(id) {
    try {
      return await supabase.from('payments')
        .select('*, students:student_id(name, p1_email, p2_email, parent_id, classrooms:classroom_id(name))')
        .eq('id', id).single();
    } catch (e) { return logError('getPaymentById', e); }
  },

  async sendPaymentReceipt(paymentId) {
      try {
        const { data: p, error } = await this.getPaymentById(paymentId);
        if (error || !p) { return false; }

        const emails = [p.students?.p1_email, p.students?.p2_email].filter(e => e && e.includes('@'));
        if (!emails.length) { return false; }

        const studentName = p.students?.name || 'Estudiante';
        const amount  = 'RD$' + Number(p.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const month   = p.month_paid || 'Colegiatura';
        const method  = (p.method || 'efectivo').charAt(0).toUpperCase() + (p.method || 'efectivo').slice(1);
        const dateStr = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        const classroom = p.students?.classrooms?.name || '';

        const rows = [
          ['Estudiante', studentName],
          ['Concepto',   month],
          ['Monto',      amount],
          ['MÃ©todo',     method],
          ['Fecha',      dateStr]
        ].map(([label, value], i) => {
          const border = i < 4 ? 'border-bottom:1px solid #d1fae5;' : '';
          const valueStyle = label === 'Monto'
            ? 'text-align:right;font-weight:800;color:#16a34a;font-size:16px;padding:6px 0;' + border
            : 'text-align:right;font-weight:700;color:#111827;padding:6px 0;' + border;
          return '<tr><td style="color:#6b7280;padding:6px 0;' + border + '">' + label + '</td>' +
                 '<td style="' + valueStyle + '">' + value + '</td></tr>';
        }).join('');

        const classroomLine = classroom ? ' (' + classroom + ')' : '';

        const html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>' +
          '<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">' +
          '<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">' +
            '<div style="background:linear-gradient(135deg,#16a34a,#15803d);padding:32px 40px;text-align:center;">' +
              '<h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">âœ… Pago Confirmado</h1>' +
              '<p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Karpus Kids â€” Recibo de Pago</p>' +
            '</div>' +
            '<div style="padding:32px 40px;">' +
              '<p style="margin:0 0 8px;color:#374151;font-size:15px;">Hola,</p>' +
              '<p style="margin:0 0 24px;color:#374151;font-size:15px;">Se ha confirmado el pago de colegiatura para <strong>' + studentName + '</strong>' + classroomLine + '.</p>' +
              '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px 24px;margin-bottom:24px;">' +
                '<table style="width:100%;border-collapse:collapse;font-size:14px;">' + rows + '</table>' +
              '</div>' +
              '<p style="margin:0 0 24px;color:#6b7280;font-size:13px;text-align:center;">Gracias por tu puntualidad y compromiso con la educaciÃ³n de tu hijo/a.</p>' +
              '<div style="text-align:center;">' +
                '<a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none;">Ver mi Panel â†’</a>' +
              '</div>' +
            '</div>' +
            '<div style="background:#f9fafb;border-top:1px solid #f0f0f0;padding:16px 40px;text-align:center;">' +
              '<p style="margin:0;font-size:11px;color:#9ca3af;">Karpus Kids Â· Correo automÃ¡tico, por favor no respondas.</p>' +
            '</div>' +
          '</div></body></html>';

        const { sendEmail } = await import('../shared/supabase.js');
        const result = await sendEmail(emails, 'Recibo de Pago â€” ' + month + ' Â· ' + studentName, html);
        return !!result;
      } catch (e) {

        return false;
      }
    }
};
