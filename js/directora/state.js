import { SafeAppState } from '../shared/state.js';

/**
 * 🧠 FACTORY PARA ESTADO INICIAL
 * (Evita bugs con fechas y referencias)
 */
function createInitialState() {
  return {
    // 👤 Autenticación
    user: null,
    profile: null,

    // 🎯 Navegación
    currentSection: 'dashboard',

    // 📊 DASHBOARD
    dashboardData: {
      kpis: {
        total: 0,
        active: 0,
        inquiries: 0,
        classrooms: 0,
        teachers: 0,
        overdue_payments: 0,
        pending_payments: 0,
        paid_payments: 0,
        attendance_today: 0
      },

      students: {
        recent: [],
        total: 0,
        active: 0
      },

      classrooms: {
        all: [] // 🔥 consistente con el resto
      },

      payments: {
        pending: [],
        summary: {
          total_pending: 0,
          total_paid: 0,
          percentagePaid: 0
        }
      },

      inquiries: {
        active: [],
        count: 0
      },

      attendance: {
        today: {
          present: 0,
          late: 0,
          absent: 0,
          total: 0
        },
        trend7days: {}
      }
    },

    // 📈 ESTADÍSTICAS
    stats: {},

    // 👨‍🎓 ESTUDIANTES
    students: {
      all: [],
      selected: null,
      filters: {
        search: '',
        classroom: '',
        status: 'all'
      }
    },

    // 🏫 AULAS
    classrooms: {
      all: [],
      selected: null
    },

    // 👩‍🏫 MAESTROS
    teachers: {
      all: [],
      selected: null
    },

    // 💳 PAGOS
    payments: {
      all: [],
      filters: {
        status: 'all',
        year: new Date().getFullYear(), // OK aquí (factory)
        search: ''
      },
      selected: null
    },

    // 📅 ASISTENCIA
    attendance: {
      entries: [],
      selectedDate: new Date().toISOString().split('T')[0], // OK aquí
      stats: {
        present: 0,
        absent: 0,
        late: 0
      }
    },

    // 📋 REPORTES
    inquiries: {
      all: [],
      filters: {
        status: 'all'
      },
      selected: null
    },

    // 💬 CHAT
    chat: {
      contacts: [],
      selectedUser: null,
      messages: [],
      unreadCount: 0
    },

    // 📰 MURO
    wall: {
      posts: [],
      page: 1,
      hasMore: true // 🔥 útil para paginación real
    }
  };
}

/**
 * 🧠 INSTANCIA GLOBAL
 */
export const AppState = new SafeAppState(createInitialState());

/**
 * 🔄 RESET COMPLETO (CLAVE para logout)
 */
export function resetAppState() {
  AppState.setState(createInitialState());
}