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

  async getFullData(refresh = false) {
    if (!refresh && AppState.get('dashboardData')) return AppState.get('dashboardData');

    try {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const [counts, attendance, inquiries, pendingPaymentsData] = await Promise.all([
        DirectorApi.getDashboardKPIs(),
        supabase.from('attendance').select('status').eq('date', today).limit(500),
        supabase.from('inquiries').select('*').eq('status', 'pending').limit(5),
        // Obtener suma de pagos pendientes, vencidos y en revisión
        supabase.from('payments').select('amount, status').in('status', ['pending', 'overdue', 'review']).limit(1000)
      ]);

      const att = attendance.data || [];
      const presentCount = att.filter(a => ['present', 'presente', 'late', 'tarde'].includes(a.status?.toLowerCase())).length;
      const kpis = counts.data || {};

      // Calcular total pendiente (pendientes + vencidos + en revisión)
      const pendingPayments = pendingPaymentsData.data || [];
      const totalPending = pendingPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const dashboardData = {
        stats: {
          students: kpis.total || 0,
          active: kpis.active || 0,
          teachers: kpis.teachers || 0,
          classrooms: kpis.classrooms || 0,
          present: kpis.attendance_today ?? presentCount,
          attendance: kpis.attendance_pct || 0,
          pendingInquiries: kpis.inquiries || 0,
          pending_amount: totalPending,
          pending_payments: totalPending
        },
        recentInquiries: inquiries.data || []
      };
      AppState.set('dashboardData', dashboardData);
      return dashboardData;
    } catch (e) {
      console.error('[DashboardService] Error:', e);
      return null;
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
