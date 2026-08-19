import { supabase } from '../shared/supabase.js';
import { TABLES } from '../shared/constants.js';

/**
 * Consultas específicas del panel de Asistente
 */
export const AssistantApi = {
  async getTeachersDetail(searchTerm = '') {
    let query = supabase
      .from(TABLES.PROFILES)
      .select('id, name, email, phone, avatar_url, classrooms!classrooms_teacher_id_fkey(id, name)')
      .in('role', ['maestra', 'asistente'])
      .order('name');
      
    if (searchTerm) query = query.ilike('name', `%${searchTerm}%`);
    
    const { data, error } = await query;
    if (error) throw error;

    // Normalizar: asegurar que classrooms sea array
    return (data || []).map(t => {
      const classroomArr = Array.isArray(t.classrooms)
        ? t.classrooms
        : t.classrooms ? [t.classrooms] : [];
      return {
        ...t,
        classrooms: classroomArr,
        classroom_ids: classroomArr.map(c => c.id),
        classroom_name: classroomArr.map(c => c.name).join(', ') || ''
      };
    });
  }
};
