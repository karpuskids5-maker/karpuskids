import { supabase } from '../shared/supabase.js';
import { TABLES } from '../shared/constants.js';

/**
 * Helper interno para manejar errores
 */
function handleError(error, context) {
  if (error) {
    console.error(`Error en ${context}:`, error);
    throw error;
  }
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
      .select(`
        *,
        classrooms(id, name)
      `)
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
      .select('*')
      .eq('classroom_id', classroomId)
      .eq('is_active', true)
      .order('name');

    handleError(error, 'getStudentsByClassroom');
    return data || [];
  },

  /**
   * Asistencia del día
   */
  async getAttendance(classroomId, date) {
    const { data, error } = await supabase
      .from(TABLES.ATTENDANCE)
      .select('*')
      .eq('classroom_id', classroomId)
      .eq('date', date);

    handleError(error, 'getAttendance');
    return data || [];
  },

  /**
   * Upsert asistencia (optimizado)
   */
  async upsertAttendance(record) {
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
   * Tareas
   */
  async getTasksByClassroom(classroomId) {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false });

    handleError(error, 'getTasksByClassroom');
    return data || [];
  },

  /**
   * Rutina diaria
   */
  async getDailyRoutine(classroomId) {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false });

    handleError(error, 'getDailyRoutine');
    return data || [];
  },

  /**
   * Upsert rutina
   */
  async upsertDailyLog(payload) {
    // Si la DB no tiene 'activities', podemos mapearlo a 'notes' o simplemente enviarlo si existe.
    // Como el error dice que no existe 'activities', vamos a ser precavidos.
    const cleanPayload = { ...payload };
    
    // Si el usuario envió notes, nos aseguramos que se llame notes en la DB.
    // Si en un futuro quieres usar 'activities', puedes añadir la columna a la DB.
    if (cleanPayload.activities) {
      if (!cleanPayload.notes) {
      cleanPayload.notes = payload.activities;
      }
      // 🔥 FIX: Eliminar columna origen para evitar error 400 si no existe en DB
      delete cleanPayload.activities;
    }

    // 🔥 FIX: Mapear 'sleeping' (JS) a 'nap' (DB) para evitar error 400
    if (cleanPayload.sleeping) {
      if (!cleanPayload.nap) cleanPayload.nap = cleanPayload.sleeping;
      delete cleanPayload.sleeping; 
    }

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
   * Crear tarea
   */
  async createTask(payload) {
    const cleanPayload = {
      ...payload,
      grading_system: 'letter_stars'
    };

    delete cleanPayload.points;

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
    if (!taskId || !studentId) {
      throw new Error('Task ID and Student ID are required');
    }

    const { data: existing, error: findError } = await supabase
      .from('task_evidences')
      .select('id')
      .eq('task_id', taskId)
      .eq('student_id', studentId)
      .maybeSingle();

    handleError(findError, 'findTaskEvidence');

    const record = {
      task_id: taskId,
      student_id: studentId,
      grade_letter: gradeLetter,
      stars: parseInt(stars) || 0,
      comment: feedback,
      status: 'graded'
    };

    const query = existing
      ? supabase
          .from('task_evidences')
          .update(record)
          .eq('id', existing.id)
      : supabase
          .from('task_evidences')
          .insert([record]);

    const { data, error } = await query.select();

    handleError(error, 'gradeTask');
    return data;
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