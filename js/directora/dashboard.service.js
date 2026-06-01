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
   * Con timeout de 10s para evitar bloqueo infinito
   */
  async getFullData(forceRefresh = false) {
    if (this.isLoading) {
      return AppState.get('dashboardData') || this.getEmptyState();
    }

    if (!forceRefresh && this.lastFetch && (Date.now() - this.lastFetch) < this.CACHE_TTL) {
      return AppState.get('dashboardData') || this.getEmptyState();
    }

    this.isLoading = true;

    // Helper: envolver cada query con timeout individual de 6s
    const withTimeout = (promise, fallback = { data: null, error: null }) =>
      Promise.race([
        promise,
        new Promise(resolve => setTimeout(() => resolve(fallback), 6000))
      ]);

    try {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const year = d.getFullYear();
      const month = d.getMonth() + 1;

      const monthName = new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(d);
      const formattedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);

      // Ejecutar en grupos pequeños para evitar net::ERR_CONNECTION_CLOSED
      const group1 = await Promise.allSettled([
        withTimeout(DirectorApi.getDashboardKPIs(formattedMonth)),
        withTimeout(DirectorApi.getStudents()),
        withTimeout(DirectorApi.getClassroomsWithOccupancy())
      ]);

      await new Promise(r => setTimeout(r, 100)); // Pequeña pausa

      const group2 = await Promise.allSettled([
        withTimeout(DirectorApi.getPayments({ status: 'pending', year })),
        withTimeout(DirectorApi.getInquiries({ status: 'all' })),
        withTimeout(DirectorApi.getAttendanceByDate(today))
      ]);

      await new Promise(r => setTimeout(r, 100)); // Pequeña pausa

      const group3 = await Promise.allSettled([
        withTimeout(DirectorApi.getAttendanceLast7Days()),
        withTimeout(DirectorApi.getFinancialSummary(year, month)),
        withTimeout(DirectorApi.getTeachers())
      ]);

      const results = [...group1, ...group2, ...group3];

      const [
        kpisRes,
        studentsRes,
        classroomsRes,
        paymentsRes,
        inquiriesRes,
        attendanceTodayRes,
        attendanceTrendRes,
        financialSummaryRes,
        teachersRes
      ] = results.map((r, i) => {
        if (r.status === 'rejected') {
          return { data: null, error: r.reason };
        }
        return r.value;
      });

      // 🔒 SAFE DATA — si el RPC devuelve 0 para students, usar el count real de la query
      const realStudentCount = studentsRes?.data?.length ?? 0;
      const realTeacherCount = teachersRes?.data?.length ?? 0;
      const realClassroomCount = classroomsRes?.data?.length ?? 0;
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
      // Corregir si el RPC devolvió 0 pero tenemos datos reales
      if (!kpis.total && realStudentCount > 0)       kpis.total      = realStudentCount;
      if (!kpis.active && realStudentCount > 0)      kpis.active     = realStudentCount;
      if (!kpis.teachers && realTeacherCount > 0)    kpis.teachers   = realTeacherCount;
      if (!kpis.classrooms && realClassroomCount > 0) kpis.classrooms = realClassroomCount;

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

      // Calculate pending amount directly from fetched payments (more reliable than RPC)
      const allPendingPayments = paymentsRes?.data || [];
      const directPendingAmount = allPendingPayments
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);
      if (directPendingAmount > 0) {
        financialSummarySafe.total_pending = directPendingAmount;
      }

      const inquiries = inquiriesRaw
        .filter(x => !['resolved', 'closed'].includes(x.status))
        .slice(0, 5);

      const dashboardData = {
        kpis,
        teacherCount: realTeacherCount,
        students: {
          recent: students,
          totalStudents: kpis.total || kpis.active || realStudentCount,
          activeStudents: kpis.active || kpis.total || realStudentCount
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

      AppState.set('dashboardData', dashboardData);
      this.lastFetch = Date.now();

      return dashboardData;

    } catch (error) {
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
    this.notifyListeners(); // 🔔 Avisar a la UI que debe recargar
  },

  /**
   * Escuchar cambios en tiempo real
   */
  subscribeToChanges() {
    this.cleanupRealtime();

    // Debounce: batch multiple rapid changes into a single refresh (max 1 per 10s)
    let debounceTimer = null;
    const debouncedInvalidate = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.invalidateCache();
        this.notifyListeners();
      }, 10_000); // 10 second debounce — prevents CPU spike on mass QR punches
    };

    const tables = ['attendance', 'payments', 'students'];
    tables.forEach(table => {
      const channel = supabase
        .channel(`${table}_changes`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, debouncedInvalidate)
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
