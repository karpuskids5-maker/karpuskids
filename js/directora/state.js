import { SafeAppState } from '../shared/state.js';

/**
 * 🧠 FACTORY PARA ESTADO INICIAL
 * (Evita bugs con fechas y referencias)
 */
function createInitialState() {
  return {
    user: null,
    profile: null,
    currentSection: 'dashboard',
    dashboardData: {
      stats: {},
      recentInquiries: []
    },
    students: {
      all: [],
      selected: null,
      filters: { search: '', classroom: '', status: 'all' }
    },
    classrooms: {
      all: [],
      selected: null
    },
    teachers: {
      all: [],
      selected: null
    },
    payments: {
      all: [],
      filters: { status: 'all', year: new Date().getFullYear(), search: '' },
      selected: null
    },
    attendance: {
      entries: [],
      selectedDate: new Date().toISOString().split('T')[0],
      stats: { present: 0, absent: 0, late: 0 }
    },
    inquiries: {
      all: [],
      filters: { status: 'all' },
      selected: null
    },
    chat: {
      contacts: [],
      selectedUser: null,
      messages: [],
      unreadCount: 0
    },
    wall: {
      posts: [],
      page: 1,
      hasMore: true
    },
    // School Engine
    schoolYear: null,
    activePeriod: null
  };
}

/**
 * 🧠 INSTANCIA GLOBAL
 */
export const AppState = new SafeAppState(createInitialState(), { 
  persistenceKey: 'karpus_directora_state' 
});