import { supabase } from '../shared/supabase.js';
import { TABLES } from '../shared/constants.js';
import { withRetry } from '../shared/db-utils.js';

/**
 * Consultas específicas del panel de Asistente
 */
export const AssistantApi = {
  /**
   * Obtiene lista de maestros detallada para el asistente
   */
  async getTeachersDetail(searchTerm = '') {
    let query = supabase
      .from(TABLES.PROFILES)
      .select('id, name, email, phone, avatar_url')
      .eq('role', 'maestra')
      .order('name');
      
    if (searchTerm) query = query.ilike('name', `%${searchTerm}%`);
    
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Obtiene la configuración de recordatorios de pago
   */
  async getReminderConfig() {
    const { data, error } = await supabase
      .from('payment_reminders')
      .select('id, amount, status, month_paid, due_date, paid_date, method, bank, reference, proof_url, created_at')
      .limit(1)
      .maybeSingle();
      
    if (error) throw error;
    return data;
  },

  /**
   * Registra un pago nuevo
   */
  async createPayment(payload) {
    const { data, error } = await supabase
      .from(TABLES.PAYMENTS)
      .insert(payload)
      .select()
      .single();
      
    if (error) throw error;
    return data;
  },

  /**
   * Obtiene el historial de asistencia del día (Accesos recientes)
   * ✅ SOLUCIÓN PROFESIONAL: Filtra por rango created_at para evitar error 400
   */
  async getTodayAttendance() {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    
    const { data, error } = await supabase
      .from(TABLES.ATTENDANCE)
      .select(`
        id,
        created_at,
        check_in,
        check_out,
        status,
        student:student_id (
          name,
          avatar_url
        )
      `)
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      throw new Error('Error cargando asistencia');
    }
    return data || [];
  },

  /**
   * Verifica si ya existe registro para hoy
   */
  async getAttendanceStatus(studentId, date) {
    const { data, error } = await supabase
      .from(TABLES.ATTENDANCE)
      .select(`
        id, 
        check_out, 
        student:student_id (
          name, p1_email, p1_name
        )
      `)
      .eq('student_id', studentId)
      .eq('date', date)
      .maybeSingle();
      
    if (error) throw error;
    return data;
  },

  /**
   * Registrar Entrada
   */
  async checkIn(studentId, classroomId, date) {
    return await withRetry(() => supabase.from(TABLES.ATTENDANCE).insert({
      student_id: studentId,
      classroom_id: classroomId,
      date: date,
      status: 'present',
      check_in: new Date().toISOString()
    }));
  },

  /**
   * Registrar Salida
   */
  async checkOut(attendanceId) {
    return await withRetry(() => supabase.from(TABLES.ATTENDANCE)
      .update({ check_out: new Date().toISOString() })
      .eq('id', attendanceId));
  }
};
