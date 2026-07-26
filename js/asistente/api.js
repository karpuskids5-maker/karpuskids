import { supabase } from '../shared/supabase.js';
import { TABLES } from '../shared/constants.js';

/**
 * Consultas específicas del panel de Asistente
 */
export const AssistantApi = {
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
  }
};
