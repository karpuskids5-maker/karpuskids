import { SafeAppState } from '../shared/state.js';

/**
 * Estado especÃ­fico para el panel de Maestra
 */
export const AppState = new SafeAppState({
  user: null,
  profile: null,
  classroom: null,
  currentSection: 'dashboard',
  students: [],
  attendance: [],
  posts: [],
  tasks: []
});
