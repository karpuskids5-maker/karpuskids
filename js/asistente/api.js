import { supabase } from '../shared/supabase.js';
import { TABLES } from '../shared/constants.js';

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
      .select('*')
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
  }
};
