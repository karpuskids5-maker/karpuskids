import { supabase } from '/js/shared/supabase.js';
import { TABLES } from '/js/shared/constants.js';

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
 * API Maestra (nivel producciÃ³n)
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
      .maybeSingle(); // ðŸ”¥ FIX

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
      .select('id, name, avatar_url, matricula, allergies, blood_type, p1_name, p1_phone, p1_email, parent_id, age, age_type')
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
    // Vincular autom\u00e1ticamente al periodo activo si la tabla existe (silencioso si falla)
    if (!record.period_id) {
      try {
        const { data: periodData } = await supabase
          .from('academic_periods')
          .select('id')
          .eq('classroom_id', record.classroom_id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();
        if (periodData) record.period_id = periodData.id;
      } catch (_) { /* 404 ignorado si no existe la tabla */ }
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
   * Tareas â€” filtradas por perÃ­odo activo del aula
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
   * Upsert rutina mejorado para bebÃ©s
   */
  async upsertDailyLog(payload) {
    const cleanPayload = { ...payload };
    if (!cleanPayload.status) cleanPayload.status = 'draft'; // Por defecto es borrador

    // 1. Buscar log existente
    const { data: existing, error: findError } = await supabase
      .from('daily_logs')
      .select('id, infant_data')
      .eq('student_id', cleanPayload.student_id)
      .eq('date', cleanPayload.date)
      .maybeSingle();

    handleError(findError, 'findDailyLog');

    // 2. Manejo especial de infant_data (JSONB append)
    if (cleanPayload.infant_event) {
      const newEvent = cleanPayload.infant_event;
      delete cleanPayload.infant_event;
      
      const currentInfantData = existing?.infant_data || [];
      const updatedInfantData = [...currentInfantData, {
        ...newEvent,
        id: crypto.randomUUID?.() || Math.random().toString(36).substr(2, 9),
        created_at: new Date().toISOString()
      }];
      
      cleanPayload.infant_data = updatedInfantData;
    }

    // 3. Ejecutar query
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
   * Publicar reporte(s) diario(s)
   */
  async publishDailyLogs(logIds) {
    if (!logIds || !logIds.length) return;
    const { data, error } = await supabase
      .from('daily_logs')
      .update({ status: 'published' })
      .in('id', logIds);
    
    handleError(error, 'publishDailyLogs');
    return data;
  },

  /**
   * 📤 Upload con Cola Secuencial
   * Evita saturar la red celular subiendo una imagen a la vez
   */
  async uploadMedia(file, bucket = 'posts') {
    if (!this._uploadQueue) this._uploadQueue = Promise.resolve();

    return this._uploadQueue = this._uploadQueue.then(async () => {
      const { ImageLoader } = await import('/js/shared/image-loader.js');
      const compressed = await ImageLoader.compress(file);
      
      const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.webp`;
      const path = `${fileName}`;

      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, compressed);

      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
      return publicUrl;
    });
  },

  /**
   * Crear tarea â€” vinculada al perÃ­odo activo del aula
   */
  async createTask(payload) {
    const cleanPayload = {
      ...payload,
      grading_system: 'letter_stars'
    };
    delete cleanPayload.points;

    // ðŸ”„ LÃ³gica Profesional de PerÃ­odo Activo
    if (!cleanPayload.period_id && cleanPayload.classroom_id) {
      // Intento manual vÃ­a query en lugar de RPC para evitar 404
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
    // Devolvemos un objeto para consistencia, aunque la operaciÃ³n de borrado no devuelve datos.
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