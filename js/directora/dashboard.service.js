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
