/**
 * SCHOOL ENGINE — Motor Escolar Inteligente v1.0
 * 
 * El cerebro del sistema. Cada módulo consulta este motor ANTES de mostrar datos.
 * Centraliza: año escolar activo, período vigente, reglas de negocio, historial.
 * 
 * Arquitectura:
 *   SchoolEngine → consulta Supabase → cachea resultado → provee a todos los módulos
 */

import { supabase } from './supabase.js';
import { SafeAppState } from './state.js';

// ── Estado Global del School Engine ──────────────────────────────
const EngineState = new SafeAppState({
  schoolYear: null,      // Año escolar activo actual
  activePeriod: null,    // Período activo actual
  allPeriods: [],        // Todos los períodos del año activo
  yearStatus: null,      // Estado completo del año
  initialized: false,
  lastRefresh: 0,
  selectedHistoricalYear: null  // Para vista histórica (maestra/padre)
}, { persistenceKey: 'karpus_school_engine' });

const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// ── SchoolEngine API ──────────────────────────────────────────────
export const SchoolEngine = {
  // Acceso al estado
  state: EngineState,

  /**
   * Inicializar el School Engine. Llamar al inicio de cada panel.
   * @param {object} options - { forceRefresh: boolean }
   */
  async init(options = {}) {
    const now = Date.now();
    if (!options.forceRefresh && EngineState.get('initialized') && (now - EngineState.get('lastRefresh') < CACHE_TTL)) {
      return EngineState.getAll();
    }

    try {
      const statusRes = await supabase.rpc('get_school_year_status');
      if (statusRes.error) throw statusRes.error;

      const yearStatus = statusRes.data;
      EngineState.set('yearStatus', yearStatus);

      if (yearStatus?.has_active_year) {
        EngineState.set('schoolYear', {
          id: yearStatus.school_year_id,
          name: yearStatus.school_year_name,
          start_date: yearStatus.start_date,
          end_date: yearStatus.end_date,
          status: yearStatus.status,
          enrollment_open: yearStatus.enrollment_open,
          reenrollment_open: yearStatus.reenrollment_open,
          enrollment_window: yearStatus.enrollment_window,
          reenrollment_window: yearStatus.reenrollment_window,
          days_remaining: yearStatus.days_remaining,
          is_school_time: yearStatus.is_school_time
        });

        // Cargar períodos del año activo
        const periodsRes = await supabase.rpc('get_periods_for_year', {
          p_school_year_id: yearStatus.school_year_id
        });
        if (!periodsRes.error) {
          EngineState.set('allPeriods', periodsRes.data || []);
        }

        // El período activo viene del yearStatus
        EngineState.set('activePeriod', yearStatus.active_period || null);
      } else {
        EngineState.set('schoolYear', null);
        EngineState.set('activePeriod', null);
        EngineState.set('allPeriods', []);
      }

      EngineState.set('initialized', true);
      EngineState.set('lastRefresh', now);

      return EngineState.getAll();
    } catch (err) {
      if (window.Helpers?.safeLog) window.Helpers.safeLog('error', '[SchoolEngine] Init error:', err);
      return EngineState.getAll();
    }
  },

  /**
   * Forzar refresh completo del motor
   */
  async refresh() {
    return this.init({ forceRefresh: true });
  },

  // ── Getters Rápidos ──────────────────────────────────────────

  /** ¿Hay un año escolar activo? */
  hasActiveYear() {
    return !!EngineState.get('schoolYear')?.id;
  },

  /** Obtener el año escolar activo */
  getSchoolYear() {
    return EngineState.get('schoolYear');
  },

  /** Obtener el ID del año escolar activo */
  getSchoolYearId() {
    return EngineState.get('schoolYear')?.id || null;
  },

  /** Obtener el período activo actual */
  getActivePeriod() {
    return EngineState.get('activePeriod');
  },

  /** Obtener el ID del período activo */
  getActivePeriodId() {
    return EngineState.get('activePeriod')?.id || null;
  },

  /** Obtener todos los períodos del año */
  getAllPeriods() {
    return EngineState.get('allPeriods') || [];
  },

  /** Obtener el estado del sistema */
  getSystemStatus() {
    return EngineState.get('yearStatus');
  },

  // ── Verificaciones de Estado ─────────────────────────────────

  /** ¿Estamos en horario escolar? */
  isSchoolTime() {
    return EngineState.get('schoolYear')?.is_school_time === true;
  },

  /** ¿Las inscripciones están abiertas? */
  isEnrollmentOpen() {
    return EngineState.get('schoolYear')?.enrollment_open === true;
  },

  /** ¿Las reinscripciones están abiertas? */
  isReenrollmentOpen() {
    return EngineState.get('schoolYear')?.reenrollment_open === true;
  },

  /** ¿El período actual permite registrar calificaciones? */
  canGrade() {
    const period = EngineState.get('activePeriod');
    return period && period.status === 'open' && period.is_active === true;
  },

  /** ¿Se puede crear una actividad en el período actual? */
  canCreateActivity() {
    return this.canGrade();
  },

  /** ¿Se puede registrar asistencia hoy? */
  canTakeAttendance() {
    return this.hasActiveYear() && this.isSchoolTime();
  },

  /** ¿Se pueden inscribir estudiantes? */
  canEnroll() {
    return this.isEnrollmentOpen() || this.isReenrollmentOpen();
  },

  /** Obtener días restantes del año */
  getDaysRemaining() {
    return EngineState.get('schoolYear')?.days_remaining || 0;
  },

  // ── Labels y Formateo ────────────────────────────────────────

  /** Estado del año en texto legible */
  getStatusLabel() {
    const labels = {
      'draft': 'Borrador',
      'enrollment': 'En Inscripción',
      'reenrollment': 'En Reinscripción',
      'active': 'Activo',
      'closed': 'Cerrado',
      'archived': 'Archivado',
      'none': 'Sin Año Escolar'
    };
    const year = EngineState.get('schoolYear');
    return labels[year?.status] || labels['none'];
  },

  /** Color del badge de estado */
  getStatusColor() {
    const colors = {
      'draft': 'bg-slate-100 text-slate-700',
      'enrollment': 'bg-blue-100 text-blue-700',
      'reenrollment': 'bg-amber-100 text-amber-700',
      'active': 'bg-emerald-100 text-emerald-700',
      'closed': 'bg-red-100 text-red-700',
      'archived': 'bg-slate-100 text-slate-500'
    };
    const year = EngineState.get('schoolYear');
    return colors[year?.status] || 'bg-slate-100 text-slate-500';
  },

  /** Resumen del estado actual */
  getStatusSummary() {
    const year = EngineState.get('schoolYear');
    if (!year) return 'No hay año escolar configurado';

    const period = EngineState.get('activePeriod');
    let summary = `${year.name} — ${this.getStatusLabel()}`;

    if (period?.name) {
      summary += ` | ${period.name}`;
    }

    if (year.days_remaining > 0) {
      summary += ` | ${year.days_remaining} días restantes`;
    }

    return summary;
  },

  // ── Consultas Directas ───────────────────────────────────────

  /** Obtener todos los años escolares */
  async getAllSchoolYears() {
    const { data, error } = await supabase
      .from('school_years')
      .select('*')
      .order('start_date', { ascending: false });
    return { data: data || [], error };
  },

  /** Crear un nuevo año escolar */
  async createSchoolYear(yearData) {
    const { data, error } = await supabase
      .rpc('create_school_year', {
        p_name: yearData.name,
        p_start_date: yearData.start_date,
        p_end_date: yearData.end_date,
        p_enrollment_start: yearData.enrollment_start || null,
        p_enrollment_end: yearData.enrollment_end || null,
        p_reenrollment_start: yearData.reenrollment_start || null,
        p_reenrollment_end: yearData.reenrollment_end || null
      });
    if (error) return { data: null, error };
    if (data?.error) return { data: null, error: { message: data.error } };
    return { data, error: null };
  },

  /** Actualizar un año escolar */
  async updateSchoolYear(id, updates) {
    const { data, error } = await supabase
      .rpc('update_school_year', {
        p_id: id,
        p_name: updates.name || null,
        p_start_date: updates.start_date || null,
        p_end_date: updates.end_date || null,
        p_enrollment_start: updates.enrollment_start || null,
        p_enrollment_end: updates.enrollment_end || null,
        p_reenrollment_start: updates.reenrollment_start || null,
        p_reenrollment_end: updates.reenrollment_end || null
      });
    if (error) return { data: null, error };
    if (data?.error) return { data: null, error: { message: data.error } };
    return { data, error: null };
  },

  /** Eliminar un año escolar (solo draft) */
  async deleteSchoolYear(id) {
    const { error } = await supabase
      .from('school_years')
      .delete()
      .eq('id', id)
      .eq('status', 'draft');
    return { error };
  },

  // ── Períodos ─────────────────────────────────────────────────

  /** Crear un período para un año escolar */
  async createPeriod(periodData) {
    const { data, error } = await supabase
      .from('academic_periods')
      .insert({
        school_year_id: periodData.school_year_id,
        name: periodData.name,
        start_date: periodData.start_date,
        end_date: periodData.end_date,
        order_index: periodData.order_index,
        status: periodData.status || 'pending',
        is_active: periodData.is_active || false
      })
      .select()
      .single();
    return { data, error };
  },

  /** Cerrar un período (automáticamente abre el siguiente) */
  async closePeriod(periodId) {
    const { data, error } = await supabase.rpc('close_period', {
      p_period_id: periodId
    });
    if (!error) await this.refresh();
    return { data, error };
  },

  /** Activar un período manualmente */
  async activatePeriod(periodId) {
    // Desactivar todos los demás períodos del mismo año
    const period = EngineState.get('allPeriods')?.find(p => p.id === periodId);
    if (!period) return { error: 'Período no encontrado' };

    await supabase
      .from('academic_periods')
      .update({ is_active: false })
      .eq('school_year_id', period.school_year_id);

    const { data, error } = await supabase
      .from('academic_periods')
      .update({ is_active: true, status: 'open' })
      .eq('id', periodId)
      .select()
      .single();

    if (!error) await this.refresh();
    return { data, error };
  },

  // ── Estados y Transiciones ───────────────────────────────────

  /** Avanzar el estado del año escolar automáticamente */
  async advanceState() {
    const { data, error } = await supabase.rpc('advance_school_year_state');
    if (!error && data?.success) await this.refresh();
    return { data, error };
  },

  /** Cerrar un año escolar */
  async closeSchoolYear(yearId) {
    const { data, error } = await supabase.rpc('close_school_year', {
      p_school_year_id: yearId
    });
    if (!error) await this.refresh();
    return { data, error };
  },

  /** Promover estudiantes */
  async promoteStudents(yearId) {
    const { data, error } = await supabase.rpc('promote_students', {
      p_school_year_id: yearId
    });
    return { data, error };
  },

  // ── Inscripciones ────────────────────────────────────────────

  /** Verificar si un estudiante puede ser inscrito */
  async canEnrollStudent(studentId, schoolYearId) {
    const { data, error } = await supabase.rpc('can_enroll_student', {
      p_student_id: studentId,
      p_school_year_id: schoolYearId || this.getSchoolYearId()
    });
    return { data, error };
  },

  /** Inscribir un estudiante */
  async enrollStudent(studentId, schoolYearId, classroomId) {
    const check = await this.canEnrollStudent(studentId, schoolYearId);
    if (check.data && !check.data.can_enroll) {
      return { error: check.data.error };
    }

    const { data, error } = await supabase
      .from('enrollments')
      .insert({
        student_id: studentId,
        school_year_id: schoolYearId || this.getSchoolYearId(),
        classroom_id: classroomId,
        type: 'new',
        parent_id: (await supabase.from('students').select('parent_id').eq('id', studentId).maybeSingle()).data?.parent_id,
        student_name: check.data?.student_name,
        status: 'pending'
      })
      .select()
      .single();
    return { data, error };
  },

  // ── Historial ────────────────────────────────────────────────

  /** Obtener historial de un estudiante */
  async getStudentHistory(studentId) {
    const { data, error } = await supabase.rpc('get_student_history', {
      p_student_id: studentId
    });
    return { data: data || [], error };
  },

  /** Obtener historial del padre */
  async getParentYearData(parentId) {
    const { data, error } = await supabase.rpc('get_parent_year_data', {
      p_parent_id: parentId
    });
    return { data, error };
  },

  /** Obtener datos del año para la maestra */
  async getTeacherYearData(teacherId) {
    const { data, error } = await supabase.rpc('get_teacher_year_data', {
      p_teacher_id: teacherId
    });
    return { data, error };
  },

  /** Obtener estadísticas de un período */
  async getPeriodStats(periodId) {
    const { data, error } = await supabase.rpc('get_period_stats', {
      p_period_id: periodId
    });
    return { data, error };
  },

  // ── Helpers para Consultas Period-Aware ──────────────────────

  /**
   * Obtener IDs relevantes para filtrar datos según el contexto.
   * @param {string} context - 'current' | 'historical'
   * @param {object} options - { schoolYearId, periodId } para contexto historical
   * @returns {object} { schoolYearId, periodId }
   */
  getContextIds(context = 'current', options = {}) {
    if (context === 'historical') {
      return {
        schoolYearId: options.schoolYearId || null,
        periodId: options.periodId || null
      };
    }

    return {
      schoolYearId: this.getSchoolYearId(),
      periodId: this.getActivePeriodId()
    };
  },

  /**
   * Construir query filtrada por año escolar y período.
   * Uso: SchoolEngine.buildPeriodQuery('grades').eq('student_id', 123)
   */
  buildPeriodQuery(table, options = {}) {
    const ids = options.historical
      ? this.getContextIds('historical', options)
      : this.getContextIds('current');

    let query = supabase.from(table).select('*');

    if (ids.schoolYearId && !options.skipYear) {
      query = query.eq('school_year_id', ids.schoolYearId);
    }
    if (ids.periodId && !options.skipPeriod) {
      query = query.eq('period_id', ids.periodId);
    }

    return query;
  }
};

// ── Exponer globalmente para compatibilidad ───────────────────────
if (typeof window !== 'undefined') {
  window.SchoolEngine = SchoolEngine;
}

export default SchoolEngine;
