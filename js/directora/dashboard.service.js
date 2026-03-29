/**
 * 🎯 DASHBOARD SERVICE — Sincronización centralizada de datos
 * 
 * Responsabilidad: Orquestar carga de TODOS los datos del dashboard
 * en paralelo desde Supabase con RPC, para evitar múltiples queries.
 */

import { supabase } from '../shared/supabase.js';
import { DirectorApi } from './api.js';
import { AppState } from './state.js';

export const DashboardService = {
  // Control de carga para evitar race conditions
  isLoading: false,
  lastFetch: null,
  CACHE_TTL: 5 * 60 * 1000, // 5 minutos de caché
  channels: [], // Para limpiar subscripciones realtime
  listeners: [], // 🔔 Lista de funciones a avisar cuando haya cambios

  /**
   * Obtener TODOS los datos del dashboard en una sola llamada paralela
   */
  async getFullData(forceRefresh = false) {
    if (this.isLoading) {
      return AppState.get('dashboardData') || this.getEmptyState();
    }

    if (!forceRefresh && this.lastFetch && (Date.now() - this.lastFetch) < this.CACHE_TTL) {
      return AppState.get('dashboardData') || this.getEmptyState();
    }

    this.isLoading = true;

    try {
      const today = new Date().toISOString().split('T')[0];
      const year = new Date().getFullYear();
      const month = new Date().getMonth() + 1;

      // Usar mes en formato texto para el RPC get_dashboard_kpis
      const monthName = new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(new Date());
      const formattedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);

      const results = await Promise.allSettled([
        DirectorApi.getDashboardKPIs(formattedMonth),
        DirectorApi.getStudents(),
        DirectorApi.getClassroomsWithOccupancy(),
        DirectorApi.getPayments({ status: 'pending', year }),
        DirectorApi.getInquiries({ status: 'all' }),
        DirectorApi.getAttendanceByDate(today),
        DirectorApi.getAttendanceLast7Days(),
        DirectorApi.getFinancialSummary(year, month)
      ]);

      const [
        kpisRes,
        studentsRes,
        classroomsRes,
        paymentsRes,
        inquiriesRes,
        attendanceTodayRes,
        attendanceTrendRes,
        financialSummaryRes
      ] = results.map((r, i) => {
        if (r.status === 'rejected') {
          console.error(`❌ Error en request ${i}:`, r.reason);
          return { data: null, error: r.reason };
        }
        return r.value;
      });

      // 🔒 SAFE DATA
      const kpis = {
        total: 0,
        active: 0,
        teachers: 0,
        classrooms: 0,
        attendance_today: 0,
        pending_payments: 0,
        inquiries: 0,
        ...(kpisRes?.data || {})
      };

      const students = (studentsRes?.data || []).slice(0, 10);
      const classrooms = classroomsRes?.data || [];
      const payments = (paymentsRes?.data || []).slice(0, 5);
      const inquiriesRaw = inquiriesRes?.data || [];
      const attendanceList = attendanceTodayRes?.data || [];
      const attendanceTrend = attendanceTrendRes?.data || {};

      const financialSummarySafe = {
        total_pending: 0,
        total_paid: 0,
        total_invoiced: 0,
        ...(financialSummaryRes?.data || {})
      };

      const inquiries = inquiriesRaw
        .filter(x => !['resolved', 'closed'].includes(x.status))
        .slice(0, 5);

      const dashboardData = {
        kpis,
        students: {
          recent: students,
          totalStudents: kpis.total,
          activeStudents: kpis.active
        },
        classrooms,
        payments: {
          pending: payments,
          summary: {
            // Usar kpis.pending_payments que viene de queries directas confiables
            total_pending: kpis.pending_payments || financialSummarySafe.total_pending,
            total_paid: financialSummarySafe.total_paid,
            percentagePaid:
              financialSummarySafe.total_invoiced > 0
                ? Math.round((financialSummarySafe.total_paid / financialSummarySafe.total_invoiced) * 100)
                : 0
          }
        },
        inquiries: {
          active: inquiries,
          count: kpis.inquiries || inquiries.length
        },
        attendance: {
          today: {
            present: attendanceList.filter(a => a.status === 'present').length,
            late: attendanceList.filter(a => a.status === 'late').length,
            absent: attendanceList.filter(a => a.status === 'absent').length,
            total: attendanceList.length
          },
          trend7days: attendanceTrend || {}
        }
      };

      console.log('📊 DashboardData:', dashboardData);
      AppState.set('dashboardData', dashboardData);
      this.lastFetch = Date.now();

      return dashboardData;

    } catch (error) {
      console.error('❌ Dashboard error:', error);
      return AppState.get('dashboardData') || this.getEmptyState();
    } finally {
      this.isLoading = false;
    }
  },

  /**
   * Estado vacío seguro para fallbacks
   */
  getEmptyState() {
    return {
      kpis: {},
      students: { recent: [], total: 0, active: 0 },
      classrooms: [],
      payments: { pending: [], summary: {} },
      inquiries: { active: [], count: 0 },
      attendance: {
        today: { present: 0, late: 0, absent: 0, total: 0 },
        trend7days: {}
      }
    };
  },

  /**
   * Invalidar caché forzando recarga
   */
  invalidateCache() {
    this.lastFetch = null;
    AppState.set('dashboardData', null); // Limpiar estado global para forzar skeletons si es necesario
    console.log('🔄 Caché de dashboard invalidado');
    this.notifyListeners(); // 🔔 Avisar a la UI que debe recargar
  },

  /**
   * Escuchar cambios en tiempo real
   */
  subscribeToChanges() {
    this.cleanupRealtime();

    const tables = ['attendance', 'payments', 'students'];

    tables.forEach(table => {
      const channel = supabase
        .channel(`${table}_changes`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table
        }, () => {
          // Cuando hay un cambio en la BD, invalidamos y notificamos
          this.invalidateCache();
        })
        .subscribe();

      this.channels.push(channel);
    });
  },

  /**
   * Limpiar subscripciones realtime para evitar duplicados
   */
  cleanupRealtime() {
    this.channels?.forEach(ch => supabase.removeChannel(ch));
    this.channels = [];
    this.listeners = []; // Limpiar oyentes
  },

  /**
   * 🔔 Permite a main.js suscribirse a actualizaciones automáticas
   * @param {Function} callback Función a ejecutar cuando cambian los datos
   */
  onUpdate(callback) {
    this.listeners.push(callback);
  },

  /**
   * 🔔 Ejecuta todos los callbacks registrados
   */
  async notifyListeners() {
    // Opcional: Recargar los datos automáticamente antes de avisar
    // const newData = await this.getFullData(true); 
    
    // Avisar a los suscriptores (main.js)
    this.listeners.forEach(callback => callback());
  }
};
