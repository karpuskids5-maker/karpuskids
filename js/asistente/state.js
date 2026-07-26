import { SafeAppState } from '../shared/state.js';

/**
 * Estado específico para el panel de Asistente
 */
export const AppState = new SafeAppState({
  user: null,
  profile: null,
  currentSection: 'dashboard',
  paymentsData: [],
  schoolYear: null,
  activePeriod: null,
  periods: [],
  activeChatUserId: null,
  activeChatName: null,
  activeChatRole: null,
  activeConversationId: null
});
