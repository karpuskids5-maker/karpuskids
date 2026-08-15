import { SafeAppState } from '/js/shared/state.js';

/**
 * Estado específico para el panel de Maestra
 */
export const AppState = new SafeAppState({
  user: null,
  profile: null,
  classroom: null,
  classrooms: [],
  currentSection: 'dashboard',
  students: [],
  attendance: [],
  // School Engine
  schoolYear: null,
  activePeriod: null,
  periods: [],
  logsMap: {}
});
