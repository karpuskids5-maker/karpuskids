/**
 * DASHBOARD SERVICE — Sincronización centralizada de datos
 * 
 * Responsabilidad: Orquestar carga de TODOS los datos del dashboard
 * en paralelo desde Supabase con RPC, para evitar múltiples queries.
 */

import { supabase } from '../shared/supabase.js';
import { SchoolEngine } from '../shared/school-engine.js';
import { DirectorApi } from './api.js';
import { AppState } from './state.js';

export const DashboardService = {
  async getFullData(refresh = true) { // Force refresh by default!
    // Always clear previous state to ensure freshness
    AppState.set('dashboardData', null);
    
    try {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      // Calculate maxVisibleMonthKey (same logic as payments_clean.js)
      const todayDate = new Date();
      const genDay = 25; // default, same as payments_clean.js
      let maxVisibleMonthKey;
      if (todayDate.getDate() >= genDay) {
        maxVisibleMonthKey = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}`;
      } else {
        const prevM = todayDate.getMonth() === 0 ? 12 : todayDate.getMonth();
        const prevY = todayDate.getMonth() === 0 ? todayDate.getFullYear() - 1 : todayDate.getFullYear();
        maxVisibleMonthKey = `${prevY}-${String(prevM).padStart(2, '0')}`;
      }

      // getDashboardKPIs already includes pending_payments — not repeating that query
      const [counts, inquiries] = await Promise.all([
        DirectorApi.getDashboardKPIs(),
        supabase.from('inquiries').select('id, subject, message, status, created_at, parent:parent_id(name)').eq('status', 'pending').order('created_at', { ascending: false }).limit(5)
      ]);

      const kpis = counts.data || {};

      // FORCE: Calculate pending amount manually with ONLY current month and total_due (to be 100% correct!)
      const { data: pp } = await supabase
        .from('v_payments_with_mora').select('total_due').in('status', ['pending', 'overdue', 'review'])
        .eq('month_paid', maxVisibleMonthKey);
      const totalPending = (pp || []).reduce((s, p) => s + Number(p.total_due || 0), 0);

      const dashboardData = {
        stats: {
          students:        kpis.total || 0,
          active:          kpis.active || 0,
          teachers:        kpis.teachers || 0,
          classrooms:      kpis.classrooms || 0,
          present:         kpis.attendance_today ?? 0,
          attendance:      kpis.attendance_pct || 0,
          pendingInquiries: kpis.inquiries || 0,
          pending_amount:  totalPending,
          pending_payments: totalPending
        },
        recentInquiries: inquiries.data || [],
        // School Engine data
        schoolYear: SchoolEngine.getSchoolYear(),
        activePeriod: SchoolEngine.getActivePeriod(),
        systemStatus: SchoolEngine.getStatusSummary(),
        yearStatusLabel: SchoolEngine.getStatusLabel(),
        yearStatusColor: SchoolEngine.getStatusColor()
      };
      AppState.set('dashboardData', dashboardData);
      return dashboardData;
    } catch (e) {
      console.error('[DashboardService] Error:', e);
      return null;
    }
  }
};
