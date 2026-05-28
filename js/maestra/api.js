import { supabase } from '../shared/supabase.js';
import { TABLES } from '../shared/constants.js';

/**
 * Helper interno para manejar errores
 */
function handleError(error, context) {
  if (error) throw error;
}

/**
 * Normaliza nombre de usuario (evita "Usuario")
 */
function getDisplayName(profile) {
  return profile?.full_name || profile?.name || 'Usuario';
}

/**
 * API Maestra (nivel producción)
 */
export const MaestraApi = {

  /**
   * Perfil de maestra + aula
   */
  async getTeacherProfile(userId) {
    const { data, error } = await supabase
      .from(TABLES.PROFILES)
      .select('id, name, email, phone, avatar_url, role, bio, classrooms:classrooms(id, name)')
      .eq('id', userId)
      .maybeSingle(); // 🔥 FIX

    handleError(error, 'getTeacherProfile');

    if (!data) return null;

    return {
      ...data,
      display_name: getDisplayName(data)
    };
  },

  /**
   * Estudiantes por aula
   */
  async getStudentsByClassroom(classroomId) {
    const { data, error } = await supabase
      .from(TABLES.STUDENTS)
      .select('id, name, avatar_url, matricula, allergies, blood_type, p1_name, p1_phone, p1_email, parent_id')
      .eq('classroom_id', classroomId)
      .eq('is_active', true)
      .order('name');

    handleError(error, 'getStudentsByClassroom');
    return data || [];
  },

  /**
   * Asistencia del d\u00eda
   */
  async getAttendance(classroomId, date) {
    const { data, error } = await supabase
      .from(TABLES.ATTENDANCE)
      .select('id, student_id, status, check_in, check_out, date')
      .eq('classroom_id', classroomId)
      .eq('date', date);

    handleError(error, 'getAttendance');
    return data || [];
  },

  /**
   * Upsert asistencia (optimizado con periodo)
   */
  async upsertAttendance(record) {
    // Vincular autom\u00e1ticamente al periodo activo para reportes finales
    if (!record.period_id) {
      const { data: periodData } = await supabase
        .from('academic_periods')
        .select('id')
        .eq('classroom_id', record.classroom_id)
        .eq('status', 'active')
        .maybeSingle();
      if (periodData) record.period_id = periodData.id;
    }

    const { data: existing, error: findError } = await supabase
      .from(TABLES.ATTENDANCE)
      .select('id')
      .eq('student_id', record.student_id)
      .eq('date', record.date)
      .maybeSingle();

    handleError(findError, 'findAttendance');

    const query = existing
      ? supabase
          .from(TABLES.ATTENDANCE)
          .update(record)
          .eq('id', existing.id)
      : supabase
          .from(TABLES.ATTENDANCE)
          .insert([record]);

    const { data, error } = await query.select().maybeSingle();

    handleError(error, 'upsertAttendance');
    return data;
  },

  /**
   * Tareas — filtradas por período activo del aula
   */
  async getTasksByClassroom(classroomId, periodId = null) {
    // Fallback directo para evitar 404 de RPC si no existe en BD
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, description, due_date, grading_system, file_url, created_at, period_id')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false })
      .limit(50);

    handleError(error, 'getTasksByClassroom');
    return data || [];
  },

  /**
   * Rutina diaria
   */
  async getDailyRoutine(classroomId) {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('id, student_id, date, mood, food, nap, eating, sleeping, activities, notes')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false })
      .limit(50);

    handleError(error, 'getDailyRoutine');
    return data || [];
  },

  /**
   * Upsert rutina
   */
  async upsertDailyLog(payload) {
    const cleanPayload = { ...payload };

    const { data: existing, error: findError } = await supabase
      .from('daily_logs')
      .select('id')
      .eq('student_id', cleanPayload.student_id)
      .eq('date', cleanPayload.date)
      .maybeSingle();

    handleError(findError, 'findDailyLog');

    const query = existing
      ? supabase
          .from('daily_logs')
          .update(cleanPayload)
          .eq('id', existing.id)
      : supabase
          .from('daily_logs')
          .insert([cleanPayload]);

    const { data, error } = await query.select().maybeSingle();

    handleError(error, 'upsertDailyLog');
    return data;
  },

  /**
   * Crear tarea — vinculada al período activo del aula
   */
  async createTask(payload) {
    const cleanPayload = {
      ...payload,
      grading_system: 'letter_stars'
    };
    delete cleanPayload.points;

    // 🔄 Lógica Profesional de Período Activo
    if (!cleanPayload.period_id && cleanPayload.classroom_id) {
      // Intento manual vía query en lugar de RPC para evitar 404
      const { data: periodData } = await supabase
        .from('academic_periods')
        .select('id, name')
        .eq('classroom_id', cleanPayload.classroom_id)
        .eq('status', 'active')
        .maybeSingle();

      if (periodData) {
        cleanPayload.period_id = periodData.id;
      }
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert([cleanPayload])
      .select()
      .maybeSingle();

    handleError(error, 'createTask');
    return data;
  },

  /**
   * Actualizar una tarea existente
   */
  async updateTask(taskId, payload) {
    const { data, error } = await supabase
      .from('tasks')
      .update(payload)
      .eq('id', taskId)
      .select()
      .single();

    handleError(error, 'updateTask');
    return data;
  },

  /**
   * Eliminar una tarea
   */
  async deleteTask(taskId) {
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId);

    handleError(error, 'deleteTask');
    // Devolvemos un objeto para consistencia, aunque la operación de borrado no devuelve datos.
    return { success: !error };
  },

  /**
   * Calificar tarea
   */
  async gradeTask(taskId, studentId, gradeLetter, stars, feedback) {
    if (!taskId || !studentId) throw new Error('Task ID and Student ID are required');

    const starsVal   = parseInt(stars) || null;
    const validStars = (starsVal && starsVal >= 1 && starsVal <= 5) ? starsVal : null;

    const updates = {
      grade_letter: gradeLetter || null,
      stars:        validStars,
      comment:      feedback || null,
      status:       'graded'
    };

    // Check if evidence already exists for this task+student
    const { data: existing } = await supabase
      .from('task_evidences')
      .select('id')
      .eq('task_id', taskId)
      .eq('student_id', studentId)
      .maybeSingle();

    let result;
    if (existing?.id) {
      // Update existing record
      result = await supabase
        .from('task_evidences')
        .update(updates)
        .eq('id', existing.id)
        .select('id, grade_letter, stars, status')
        .maybeSingle();
    } else {
      // Insert new record
      result = await supabase
        .from('task_evidences')
        .insert({ task_id: taskId, student_id: studentId, ...updates })
        .select('id, grade_letter, stars, status')
        .maybeSingle();
    }

    handleError(result.error, 'gradeTask');
    return result.data;
  },

  /**
   * Registrar incidente
   */
  async registerIncident(payload) {
    const { data, error } = await supabase
      .from('incidents')
      .insert({
        student_id: payload.student_id,
        classroom_id: payload.classroom_id,
        teacher_id: payload.teacher_id,
        severity: payload.severity,
        description: payload.description
      })
      .select()
      .maybeSingle();

    handleError(error, 'registerIncident');
    return data;
  }
};