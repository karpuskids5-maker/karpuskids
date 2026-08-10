import { supabase } from '/js/shared/supabase.js';
import { TABLES } from '/js/shared/constants.js';
import { AppState } from './state.js';
import { QueryCache } from '/js/shared/query-cache.js';

/**
 * Helper interno para manejar errores
 */
function handleError(error, context) {
  if (error) throw error;
}

/**
 * API Maestra (nivel producción)
 */
export const MaestraApi = {

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
    // School Engine: auto-assign school_year_id
    if (!record.school_year_id) {
      const year = AppState.get('schoolYear');
      if (year) record.school_year_id = year.id;
    }

    // Vincular autom\u00e1ticamente al periodo activo si la tabla existe (silencioso si falla)
    if (!record.period_id) {
      try {
        const activePeriod = AppState.get('activePeriod');
        if (activePeriod?.id) {
          record.period_id = activePeriod.id;
        }
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
    if (data) QueryCache.invalidatePrefix('maestra_attendance');
    return data;
  },

  /**
   * Tareas — filtradas por período activo del aula
   */
  async getTasksByClassroom(classroomId, periodId = null) {
    let query = supabase
      .from('tasks')
      .select('id, title, description, due_date, grading_system, file_url, created_at, period_id, school_year_id, config_id')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false })
      .limit(50);

    // Filter by period if provided (School Engine)
    const activePeriodId = periodId || AppState.get('activePeriod')?.id;
    if (activePeriodId) {
      query = query.eq('period_id', activePeriodId);
    }

    const { data, error } = await query;
    handleError(error, 'getTasksByClassroom');
    return data || [];
  },

  /**
   * Rutina diaria
   */
  async getDailyRoutine(classroomId) {
    let query = supabase
      .from('daily_logs')
      .select('id, student_id, date, mood, food, nap, eating, sleeping, activities, notes, school_year_id')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false })
      .limit(50);

    // School Engine: filter by active school year
    const activeYearId = AppState.get('schoolYear')?.id;
    if (activeYearId) {
      query = query.eq('school_year_id', activeYearId);
    }

    const { data, error } = await query;
    handleError(error, 'getDailyRoutine');
    return data || [];
  },

  /**
   * Upsert rutina mejorado para bebés
   */
  async upsertDailyLog(payload) {
    const cleanPayload = { ...payload };
    if (!cleanPayload.status) cleanPayload.status = 'published'; // Auto-publicar: padres ven en tiempo real

    // School Engine: auto-assign school_year_id
    if (!cleanPayload.school_year_id) {
      const year = AppState.get('schoolYear');
      if (year) cleanPayload.school_year_id = year.id;
    }

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
        id: crypto.randomUUID(),
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
    if (data) QueryCache.invalidatePrefix('maestra_daily_logs');
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
    if (!error) QueryCache.invalidatePrefix('maestra_daily_logs');
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
      
      const fileName = `${Date.now()}_${crypto.randomUUID()}.webp`;
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
   * Crear tarea — vinculada al período activo del aula
   */
  async createTask(payload) {
    const cleanPayload = {
      ...payload,
      grading_system: 'letter_stars'
    };
    delete cleanPayload.points;

    // School Engine: auto-assign school_year_id
    if (!cleanPayload.school_year_id) {
      const year = AppState.get('schoolYear');
      if (year) cleanPayload.school_year_id = year.id;
    }

    // Lógica Profesional de Período Activo
    if (!cleanPayload.period_id && cleanPayload.classroom_id) {
      // Use active period from School Engine
      const activePeriod = AppState.get('activePeriod');
      if (activePeriod?.id) {
        cleanPayload.period_id = activePeriod.id;
      }
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert([cleanPayload])
      .select()
      .maybeSingle();

    handleError(error, 'createTask');
    if (data) QueryCache.invalidatePrefix('maestra_tasks');
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
    if (data) QueryCache.invalidatePrefix('maestra_tasks');
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
    if (!error) QueryCache.invalidatePrefix('maestra_tasks');
    return { success: !error };
  },

  /**
   * Calificar tarea (letra + estrellas + nota numérica 0-100)
   */
  async gradeTask(taskId, studentId, gradeLetter, stars, feedback, score) {
    if (!taskId || !studentId) throw new Error('Task ID and Student ID are required');

    const starsVal   = parseInt(stars) || null;
    const validStars = (starsVal && starsVal >= 1 && starsVal <= 5) ? starsVal : null;

    const scoreVal = (score != null && score !== '') ? parseFloat(score) : null;
    if (scoreVal != null && (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 100)) {
      throw new Error('La calificación debe ser entre 0 y 100');
    }

    const updates = {
      grade_letter: gradeLetter || null,
      stars:        validStars,
      comment:      feedback || null,
      status:       'graded',
      score_v2:     scoreVal
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
    if (result.data) QueryCache.invalidatePrefix('maestra_grades');
    return result.data;
  },

  /**
   * Guardar nota numérica (0-100) de una tarea para un estudiante.
   * Hace upsert sobre task_evidences (UNIQUE task_id, student_id).
   */
  async saveTaskScoreV2(taskId, studentId, score, comment) {
    if (!taskId || !studentId) throw new Error('Task ID and Student ID are required');
    const scoreVal = parseFloat(score);
    if (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 100) {
      throw new Error('La calificación debe ser entre 0 y 100');
    }

    const { data: existing } = await supabase
      .from('task_evidences')
      .select('id')
      .eq('task_id', taskId)
      .eq('student_id', studentId)
      .maybeSingle();

    let result;
    if (existing?.id) {
      result = await supabase
        .from('task_evidences')
        .update({ score_v2: scoreVal, comment: comment || null, status: 'graded' })
        .eq('id', existing.id)
        .select('id, score_v2')
        .maybeSingle();
    } else {
      result = await supabase
        .from('task_evidences')
        .insert({ task_id: taskId, student_id: studentId, score_v2: scoreVal, comment: comment || null, status: 'graded' })
        .select('id, score_v2')
        .maybeSingle();
    }

    handleError(result.error, 'saveTaskScoreV2');
    if (result.data) QueryCache.invalidatePrefix('maestra_grades');
    return result.data;
  },

  /**
   * Tareas con área asignada (config_id) del período activo.
   * Recibe la lista de configs del período para filtrar tareas de otros períodos.
   */
  async getTasksForPeriod(config) {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, description, config_id, created_at')
      .not('config_id', 'is', null)
      .order('created_at', { ascending: true });
    handleError(error, 'getTasksForPeriod');

    const cfgSet = new Set((config || []).map(c => String(c.id)));
    return (data || []).filter(t => cfgSet.has(String(t.config_id)));
  },

  /**
   * Notas numéricas de tareas por estudiante (task_evidences.score_v2)
   */
  async getTaskScoresForStudents(taskIds) {
    const ids = (taskIds || []).map(Number).filter(Boolean);
    if (!ids.length) return [];
    const { data, error } = await supabase
      .from('task_evidences')
      .select('task_id, student_id, score_v2, comment')
      .in('task_id', ids)
      .not('score_v2', 'is', null);
    handleError(error, 'getTaskScoresForStudents');
    return data || [];
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
    if (data) QueryCache.invalidatePrefix('maestra_incidents');
    return data;
  },

  // ── Sistema de Calificaciones V2 ──────────────────────────

  /**
   * Obtener configuración de materias del período
   */
  async getPeriodConfig(periodId) {
    const { data, error } = await supabase.rpc('get_period_config', { p_period_id: parseInt(periodId) });
    handleError(error, 'getPeriodConfig');
    return data || [];
  },

  /**
   * Obtener actividades con conteo de calificaciones
   */
  async getActivitiesWithGrades(periodId) {
    const { data, error } = await supabase.rpc('get_activities_with_grades', { p_period_id: parseInt(periodId) });
    handleError(error, 'getActivitiesWithGrades');
    return data || [];
  },

  /**
   * Crear nueva actividad evaluable
   */
  async createActivity(configId, title, description, activityNumber, isMandatory) {
    const { data, error } = await supabase
      .from('activities')
      .insert({
        config_id: configId,
        title,
        description: description || null,
        max_score: 100,
        activity_number: activityNumber,
        is_mandatory: isMandatory !== false
      })
      .select()
      .maybeSingle();

    handleError(error, 'createActivity');
    if (data) QueryCache.invalidatePrefix('maestra_activities');
    return data;
  },

  /**
   * Eliminar actividad
   */
  async deleteActivity(activityId) {
    const { error } = await supabase.from('activities').delete().eq('id', activityId);
    handleError(error, 'deleteActivity');
    if (!error) QueryCache.invalidatePrefix('maestra_activities');
    return { success: !error };
  },

  /**
   * Eliminar área del período (borra en cascada actividades y notas asociadas)
   */
  async deletePeriodConfig(configId) {
    const { error } = await supabase.from('period_config').delete().eq('id', configId);
    handleError(error, 'deletePeriodConfig');
    if (!error) {
      QueryCache.invalidatePrefix('maestra_period_config');
      QueryCache.invalidatePrefix('maestra_activities');
    }
    return { success: !error };
  },

  /**
   * Guardar calificación V2 (0-100)
   */
  async saveGradeV2(activityId, studentId, score, comment, teacherId) {
    const scoreVal = parseFloat(score);
    if (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 100) {
      throw new Error('La calificación debe ser entre 0 y 100');
    }

    // Buscar si ya existe calificación para esta actividad+estudiante
    const { data: existing } = await supabase
      .from('grades')
      .select('id')
      .eq('activity_id', activityId)
      .eq('student_id', studentId)
      .maybeSingle();

    let result;
    if (existing?.id) {
      result = await supabase
        .from('grades')
        .update({ score_v2: scoreVal, notes: comment || null, teacher_id: teacherId })
        .eq('id', existing.id)
        .select('id, score_v2')
        .maybeSingle();
    } else {
      // Need period_id from the activity's config
      const { data: activity } = await supabase
        .from('activities')
        .select('config_id')
        .eq('id', activityId)
        .maybeSingle();

      let periodId = null;
      if (activity?.config_id) {
        const { data: config } = await supabase
          .from('period_config')
          .select('period_id')
          .eq('id', activity.config_id)
          .maybeSingle();
        periodId = config?.period_id || null;
      }

      result = await supabase
        .from('grades')
        .insert({
          activity_id: activityId,
          student_id: studentId,
          score_v2: scoreVal,
          notes: comment || null,
          teacher_id: teacherId,
          period_id: periodId,
          school_year_id: AppState.get('schoolYear')?.id || null
        })
        .select('id, score_v2')
        .maybeSingle();
    }

    handleError(result.error, 'saveGradeV2');
    if (result.data) QueryCache.invalidatePrefix('maestra_grades');
    return result.data;
  },

  /**
   * Obtener calificaciones V2 de un estudiante
   */
  async getStudentGradesV2(studentId, periodId) {
    const { data, error } = await supabase.rpc('get_student_grades_v2', {
      p_student_id: parseInt(studentId),
      p_period_id: parseInt(periodId)
    });
    handleError(error, 'getStudentGradesV2');
    return data || [];
  }
};