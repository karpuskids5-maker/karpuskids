import { supabase } from '../../shared/supabase.js';
import { AppState } from '../state.js';
import { PaymentsModule } from '../payments.js';

export const DashboardModule = {
  async init() {
    await this.loadStats();
    if(PaymentsModule.loadIncomeChart) {
        PaymentsModule.loadIncomeChart();
    }
  },

  async loadStats() {
    try {
      // 1. Total estudiantes activos
      const { count: studentsCount } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      // 2. Asistencias de hoy
      const today = new Date().toISOString().split('T')[0];
      const { count: attendanceCount } = await supabase
        .from('attendance_logs')
        .select('*', { count: 'exact', head: true })
        .eq('date', today)
        .eq('status', 'present');

      // 3. Pagos pendientes o en revisión
      const { count: paymentsCount } = await supabase
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'review']);

      const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
      
      setTxt('statStudents', studentsCount || 0);
      setTxt('statAttendance', attendanceCount || 0);
      setTxt('statPayments', paymentsCount || 0);
      
      const profileName = AppState.get('profile')?.name || 'Asistente';
      setTxt('welcomeName', profileName.split(' ')[0]);

    } catch (e) {
      console.error('[DashboardModule] Error loading stats', e);
    }
  }
};
