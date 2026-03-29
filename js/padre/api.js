import { supabase } from '../shared/supabase.js';
import { TABLES } from './appState.js';

/**
 * 🔥 Helper de manejo de errores centralizado
 */
async function handle(queryPromise, context = 'API') {
  const { data, error } = await queryPromise;
  if (error) {
    console.error(`❌ [${context}]`, { message: error.message, details: error.details });
    throw new Error(error.message);
  }
  return data;
}

/**
 * 🚀 API Específica para el Panel de Padres
 */
export const Api = {
  /**
   * 👶 Obtener datos detallados del estudiante
   */
  async getStudent(studentId) {
    return await handle(
      supabase
        .from(TABLES.STUDENTS)
        .select(`*, classrooms(id, name, teacher_id, level)`)
        .eq('id', studentId)
        .single(),
      'getStudent'
    );
  },

  /**
   * 💰 Estado financiero completo
   */
  async getStudentFinancialStatus(studentId) {
    const [student, allPending, history] = await Promise.all([
      handle(supabase.from(TABLES.STUDENTS).select('monthly_fee, due_day').eq('id', studentId).single(), 'getStudentFee'),
      handle(supabase.from(TABLES.PAYMENTS).select('*').eq('student_id', studentId).in('status', ['pending', 'overdue']).order('due_date', { ascending: true }), 'getPendingPayments'),
      handle(supabase.from(TABLES.PAYMENTS).select('*').eq('student_id', studentId).eq('status', 'paid').order('created_at', { ascending: false }).limit(5), 'getPaymentHistory')
    ]);

    // Filtrar: si hay un pago con evidencia, ese mes está "en revisión" y no cuenta como deuda exigible
    // pero si hay un cargo sin evidencia para el mismo mes, ese es el que cuenta si no hay abono.
    // Lógica PRO: Solo sumamos los que NO tienen evidencia (son cargos puros)
    const trueDebt = (allPending || []).filter(p => !p.evidence_url && !p.proof_url);
    const totalDebt = trueDebt.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    return {
      config: { monthly_fee: student?.monthly_fee || 0, due_day: student?.due_day || 5 },
      debt: { total: totalDebt, items: allPending || [] }, // Enviamos todos para que la UI decida qué mostrar
      history: history || []
    };
  },

  /**
   * 📅 Historial de asistencia por mes
   */
  async getStudentAttendance(studentId, year, month) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

    return await handle(
      supabase.from('attendance')
        .select('date, status, check_in, notes')
        .eq('student_id', studentId)
        .gte('date', startDate)
        .lte('date', endDate),
      'getStudentAttendance'
    );
  },

  /**
   * 🎓 Notas y Evidencias
   */
  async getStudentGrades(studentId) {
    const [evidences, reports] = await Promise.all([
      handle(
        supabase.from(TABLES.TASK_EVIDENCES)
          .select('*, task:task_id(title, description, due_date)')
          .eq('student_id', studentId)
          .not('grade_letter', 'is', null)
          .order('created_at', { ascending: false }), 
        'getTaskGrades'
      ),
      handle(supabase.from(TABLES.GRADES).select('*').eq('student_id', studentId).order('created_at', { ascending: false }), 'getReportGrades')
    ]);

    return { evidences: evidences || [], reports: reports || [] };
  },

  /**
   * 📝 Rutina diaria (Daily Logs)
   */
  async getDailyLog(studentId, date) {
    return await handle(
      supabase.from(TABLES.DAILY_LOGS)
        .select('*')
        .eq('student_id', studentId)
        .eq('date', date)
        .maybeSingle(),
      'getDailyLog'
    );
  },

  /**
   * 🎒 Tareas pendientes y entregadas
   */
  async getStudentTasks(classroomId, studentId) {
    const [tasks, evidences] = await Promise.all([
      handle(supabase.from(TABLES.TASKS).select('*').eq('classroom_id', classroomId).order('due_date', { ascending: true }), 'getTasks'),
      handle(supabase.from(TABLES.TASK_EVIDENCES).select('*').eq('student_id', studentId), 'getEvidences')
    ]);

    return { tasks: tasks || [], evidences: evidences || [] };
  }
};
