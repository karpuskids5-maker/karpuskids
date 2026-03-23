import { SafeAppState } from '../shared/state.js';

/**
 * Estado específico para el panel de Asistente
 */
export const AppState = new SafeAppState({
  user: null,
  profile: null,
  currentSection: 'dashboard',
  paymentsData: [],
  selectedStudent: null,
  teachers: [],
  classrooms: []
});
