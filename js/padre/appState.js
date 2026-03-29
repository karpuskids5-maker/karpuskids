import { SafeAppState } from '../shared/state.js';

/**
 * 🧠 AppState para Panel de Padres
 * Incluye sistema de suscripción y caché reactiva.
 */
export const AppState = new SafeAppState({
  user: null,
  profile: null,
  currentStudent: null,
  students: [],
  dashboardData: null,
  feedPosts: [],
  isClassLive: false,
  liveChannel: null,
  currentSection: 'home',
  financeConfig: null,
  todayAttendance: null,
  loading: false,
  error: null
});

/**
 * 🔒 Claves de Caché Seguras
 * Genera claves que dependen del usuario/estudiante para evitar leaks de datos.
 */
export const CacheKeys = {
  payments: (studentId) => `payments_${studentId}`,
  grades: (studentId) => `grades_${studentId}`,
  attendance: (studentId, month, year) => `attendance_${studentId}_${year}_${month}`,
  routine: (studentId, date) => `routine_${studentId}_${date}`
};

/**
 * 🧹 Helper para invalidar caché
 */
export const invalidateCache = (key) => {
  AppState.clearCache(key);
};

export const TABLES = {
  STUDENTS: 'students',
  PROFILES: 'profiles',
  PAYMENTS: 'payments',
  DAILY_LOGS: 'daily_logs',
  TASK_EVIDENCES: 'task_evidences',
  GRADES: 'grades',
  TASKS: 'tasks',
  POSTS: 'posts'
};
