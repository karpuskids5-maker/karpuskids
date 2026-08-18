import { supabase } from '../shared/supabase.js';
import { QueryCache } from '../shared/query-cache.js';
import { safeHandle } from '../shared/db-utils.js';

const TABLES = {
  PROFILES: 'profiles',
  CLASSROOMS: 'classrooms',
  STUDENTS: 'students',
  PERIODS: 'periods',
  SUBJECTS: 'subjects',
  PERIOD_CONFIG: 'period_config',
  ACTIVITIES: 'activities'
};

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
  async getPeriods() {
    try {
      // get_grade_periods devuelve los períodos con id de legacy "periods"
      // (compatibles con period_config/activities/grades), sincronizando
      // academic_periods → periods automáticamente por nombre y fechas.
      const { data: gradePeriods, error: gpErr } = await supabase.rpc('get_grade_periods');
      if (!gpErr && gradePeriods && gradePeriods.length > 0) {
        return { data: gradePeriods, error: null };
      }

      // Fallback: períodos legacy
      const { data, error } = await supabase
        .from('periods')
        .select('id, name, start_date, end_date, status, is_active, classroom_id')
        .order('start_date', { ascending: true })
        .limit(50);
      if (!error) return { data: data || [], error: null };
      return { data: null, error };
    } catch (e) { return logError('getPeriods', e); }
  },

  async getDashboardKPIs(monthText = '') {
    try {
      const todayDate = new Date();
      const genDay = 25;
      let maxVisibleMonthKey;
      if (todayDate.getDate() >= genDay) {
        maxVisibleMonthKey = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}`;
      } else {
        const prevM = todayDate.getMonth() === 0 ? 12 : todayDate.getMonth();
        const prevY = todayDate.getMonth() === 0 ? todayDate.getFullYear() - 1 : todayDate.getFullYear();
        maxVisibleMonthKey = `${prevY}-${String(prevM).padStart(2, '0')}`;
      }

      const { data: rpcData, error: rpcError } = await supabase.rpc('get_dashboard_kpis', { p_month: monthText || maxVisibleMonthKey });
      
      const { data: pp } = await supabase
        .from('v_payments_with_mora').select('total_due').in('status', ['pending', 'overdue', 'review'])
        .eq('month_paid', maxVisibleMonthKey);
      const pendingAmount = (pp || []).reduce((s, p) => s + Number(p.total_due || 0), 0);

      if (!rpcError && rpcData) {
        return { 
          data: {
            ...rpcData,
            pending_payments: pendingAmount
          }, 
          error: null 
        };
      }

      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      const results = await Promise.allSettled([
        supabase.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).in('role', ['maestra', 'asistente']),
        supabase.from('classrooms').select('*', { count: 'exact', head: true }),
        supabase.from('attendance').select('*', { count: 'exact', head: true }).eq('date', today).in('status', ['present', 'late']),
        supabase.from('inquiries').select('*', { count: 'exact', head: true }).not('status', 'in', '("resolved","closed")')
      ]);

      const get = (r) => r.status === 'fulfilled' ? r.value : { count: 0, data: [] };
      const [totalRes, teachersRes, classroomsRes, attendanceRes, inquiriesRes] = results.map(get);

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

  async getPaymentStats(filterMonth, filterYear) {
    try {
      const now   = new Date();
      const year  = filterYear  ? String(filterYear)  : String(now.getFullYear());
      const month = filterMonth ? String(filterMonth).padStart(2, '0') : String(now.getMonth() + 1).padStart(2, '0');
      const monthKey   = `${year}-${month}`;
      const rangeStart = `${year}-${month}-01`;
      const lastDay    = new Date(parseInt(year), parseInt(month), 0).getDate();
      const rangeEnd   = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

      const [paidData, pendingData, overdueData, reviewData] = await Promise.all([
        supabase.from('payments').select('amount').eq('status', 'paid').gte('created_at', rangeStart).lte('created_at', rangeEnd + 'T23:59:59'),
        supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('month_paid', monthKey),
        supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'overdue').eq('month_paid', monthKey),
        supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'review').eq('month_paid', monthKey)
      ]);

      const income    = (paidData.data || []).reduce((s, p) => s + Number(p.amount || 0), 0);
      const pending   = pendingData.count  || 0;
      const overdue   = overdueData.count  || 0;
      const toApprove = reviewData.count   || 0;

      return { data: { incomeMonth: income, pending, overdue, toApprove }, error: null };
    } catch (e) { return logError('getPaymentStats', e); }
  },

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
    const result = await supabase.from('inquiries').update(updates).eq('id', id);
    if (!result.error) QueryCache.invalidatePrefix('dir_inquiries');
    return result;
  },

  async getSchoolSettings() {
    try {
      return await supabase.from('school_settings').select('id, generation_day, due_day, open_time, close_time, work_days, phone, business_hours').eq('id', 1).maybeSingle();
    } catch (e) { return logError('getSchoolSettings', e); }
  },

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

  async getChatUsers(myId, roleFilter) {
    try {
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
        return { data: [], error: profilesErr };
      }

      let validProfiles = (allProfiles || []).filter(u => u.name && u.name.trim().length > 0);

      const { data: activeStudents } = await supabase
        .from(TABLES.STUDENTS)
        .select('parent_id')
        .is('deleted_at', null)
        .eq('is_active', true);

      const activeParentIds = [...new Set((activeStudents || []).map(s => s.parent_id).filter(Boolean))];

      const finalUsers = validProfiles.filter(u => {
        if (u.role === 'padre') {
          return activeParentIds.includes(u.id);
        }
        return true;
      });

      return { data: finalUsers, error: null };
    } catch (e) { 
      return logError('getChatUsers', e); 
    }
  },

  async getStudentsByParentIds(ids) {
    try {
      if (!ids || ids.length === 0) {
        return { data: [], error: null };
      }
      const { data: students, error } = await supabase
        .from(TABLES.STUDENTS)
        .select('parent_id, name, classroom_id')
        .in('parent_id', ids)
        .is('deleted_at', null)
        .eq('is_active', true);
      if (error) throw error;

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

  async getStudents(filters = {}, range = null) {
    let q = supabase
      .from(TABLES.STUDENTS)
      .select('id, name, avatar_url, matricula, age, age_type, entry_time, exit_time, classrooms(id, name), is_active', { count: 'exact' })
      .order('name');

    if (filters.search) q = q.ilike('name', `%${filters.search}%`);
    if (filters.classroom_id) q = q.eq('classroom_id', filters.classroom_id);
    if (filters.status === 'active') q = q.eq('is_active', true);
    if (filters.status === 'inactive') q = q.eq('is_active', false);
    
    if (range) {
      q = q.range(range.from, range.to);
    } else {
      q = q.limit(100);
    }

    return q;
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

    const ALLOWED_COLUMNS = new Set([
      'name','matricula','classroom_id','age','age_type','schedule','start_date',
      'entry_time','exit_time',
      'is_active','blood_type','allergies','authorized_pickup','authorized_pickup_phone',
      'p1_name','p1_phone','p1_email','p1_job','p1_address','p1_emergency_contact',
      'p2_name','p2_phone','p2_email','p2_job','p2_address','p2_emergency_contact',
      'monthly_fee','prolongado_fee','due_day','avatar_url','parent_id',
      'notes','qr_code','deleted_at'
    ]);

    const clean = {};
    for (const [k, v] of Object.entries(data)) {
      if (!ALLOWED_COLUMNS.has(k)) continue;
      clean[k] = v;
    }

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
          ['Método',     method],
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
              '<h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">Pago Confirmado</h1>' +
              '<p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Karpus Kids - Recibo de Pago</p>' +
            '</div>' +
            '<div style="padding:32px 40px;">' +
              '<p style="margin:0 0 8px;color:#374151;font-size:15px;">Hola,</p>' +
              '<p style="margin:0 0 24px;color:#374151;font-size:15px;">Se ha confirmado el pago de colegiatura para <strong>' + studentName + '</strong>' + classroomLine + '.</p>' +
              '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px 24px;margin-bottom:24px;">' +
                '<table style="width:100%;border-collapse:collapse;font-size:14px;">' + rows + '</table>' +
              '</div>' +
              '<p style="margin:0 0 24px;color:#6b7280;font-size:13px;text-align:center;">Gracias por tu puntualidad y compromiso con la educación de tu hijo/a.</p>' +
              '<div style="text-align:center;">' +
                '<a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none;">Ver mi Panel</a>' +
              '</div>' +
            '</div>' +
            '<div style="background:#f9fafb;border-top:1px solid #f0f0f0;padding:16px 40px;text-align:center;">' +
              '<p style="margin:0;font-size:11px;color:#9ca3af;">Karpus Kids · Correo automático, por favor no respondas.</p>' +
            '</div>' +
          '</div></body></html>';

        const { sendEmail } = await import('../shared/supabase.js');
        const result = await sendEmail(emails, 'Recibo de Pago - ' + month + ' · ' + studentName, html);
        return !!result;
      } catch (e) {
        safeHandle(e, 'DirectorApi.sendPaymentReceipt');
        return false;
      }
    },

  // ── Sistema de Calificaciones V2 ──────────────────────────

  async getSubjects(educationLevel) {
    try {
      let q = supabase.from(TABLES.SUBJECTS)
        .select('id, name, education_level, description, is_active, classroom_id')
        .eq('is_active', true)
        .order('name');
      if (educationLevel) q = q.eq('education_level', educationLevel);
      return await q;
    } catch (e) { return logError('getSubjects', e); }
  },

  async getPeriodConfig(periodId) {
    try {
      return await supabase.rpc('get_period_config', { p_period_id: parseInt(periodId) });
    } catch (e) { return logError('getPeriodConfig', e); }
  },

  async savePeriodConfig(periodId, configs) {
    try {
      // configs = [{ subject_id, activity_count, classroom_id? }]
      const rows = configs.map(c => {
        const row = {
          period_id: parseInt(periodId),
          subject_id: c.subject_id,
          activity_count: Math.min(8, Math.max(5, c.activity_count || 5))
        };
        if (c.classroom_id != null) row.classroom_id = parseInt(c.classroom_id);
        return row;
      });

      // Upsert each config
      const results = await Promise.all(rows.map(row =>
        supabase.from(TABLES.PERIOD_CONFIG)
          .upsert(row, { onConflict: 'period_id,subject_id' })
      ));

      const errors = results.filter(r => r.error);
      if (errors.length) throw errors[0].error;
      QueryCache.invalidatePrefix('dir_period_config');
      return { data: true, error: null };
    } catch (e) { return logError('savePeriodConfig', e); }
  },

  async deletePeriodConfig(configId) {
    try {
      const result = await supabase.from(TABLES.PERIOD_CONFIG).delete().eq('id', configId);
      if (!result.error) QueryCache.invalidatePrefix('dir_period_config');
      return result;
    } catch (e) { return logError('deletePeriodConfig', e); }
  },

  async getActivitiesWithGrades(periodId) {
    try {
      return await supabase.rpc('get_activities_with_grades', { p_period_id: parseInt(periodId) });
    } catch (e) { return logError('getActivitiesWithGrades', e); }
  },

  async createActivity(configId, title, description, activityNumber, isMandatory) {
    try {
      const result = await supabase.from(TABLES.ACTIVITIES).insert({
        config_id: configId,
        title,
        description: description || null,
        max_score: 100,
        activity_number: activityNumber,
        is_mandatory: isMandatory !== false
      }).select().single();
      if (!result.error) QueryCache.invalidatePrefix('dir_activities');
      return result;
    } catch (e) { return logError('createActivity', e); }
  },

  async deleteActivity(activityId) {
    try {
      const result = await supabase.from(TABLES.ACTIVITIES).delete().eq('id', activityId);
      if (!result.error) QueryCache.invalidatePrefix('dir_activities');
      return result;
    } catch (e) { return logError('deleteActivity', e); }
  },

  async getStudentGradesV2(studentId, periodId) {
    try {
      return await supabase.rpc('get_student_grades_v2', {
        p_student_id: parseInt(studentId),
        p_period_id: parseInt(periodId)
      });
    } catch (e) { return logError('getStudentGradesV2', e); }
  },

  async getStudentSubjectAverages(studentId, periodId) {
    try {
      return await supabase.rpc('get_student_subject_averages', {
        p_student_id: parseInt(studentId),
        p_period_id: parseInt(periodId)
      });
    } catch (e) { return logError('getStudentSubjectAverages', e); }
  },

  async getStudentHistory(studentId) {
    try {
      return await supabase.rpc('get_student_history', { p_student_id: parseInt(studentId) });
    } catch (e) { return logError('getStudentHistory', e); }
  }
};
