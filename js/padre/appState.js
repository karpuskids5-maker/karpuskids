import { SafeAppState } from '../shared/state.js';

/**
 * AppState para Panel de Padres
 * Incluye sistema de suscripción y caché reactiva.
 */
export const AppState = new SafeAppState({
  user: null,
  profile: null,
  currentStudent: null,
  students: [],
  feedPosts: [],
  isClassLive: false,
  liveChannel: null,
  currentSection: 'home',
  financeConfig: null,
  financeHistory: null,
  todayAttendance: null,
  loading: false,
  // School Engine
  schoolYear: null,
  activePeriod: null,
  periods: [],
  currentDailyLog: null,
  currentGrades: null,
  currentPayments: null
});

export const TABLES = {
  STUDENTS: 'students',
  PROFILES: 'profiles',
  PAYMENTS: 'payments',
  DAILY_LOGS: 'daily_logs',
  TASK_EVIDENCES: 'task_evidences',
  GRADES: 'grades',
  TASKS: 'tasks',
  POSTS: 'posts',
  PERIODS: 'periods',
  REPORT_CARDS: 'report_cards'
};
