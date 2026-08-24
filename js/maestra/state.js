import { SafeAppState } from '/js/shared/state.js';

/**
 * Estado específico para el panel de Maestra
 * - classrooms: array de todas las aulas asignadas a la maestra
 * - currentClassroom: el aula actualmente seleccionada (la que se muestra)
 * - classroom: alias que devuelve currentClassroom (backward-compatible con los módulos que ya usan AppState.get('classroom'))
 */
const _state = new SafeAppState({
  user: null,
  profile: null,
  classrooms: [],
  currentClassroom: null,
  currentSection: 'dashboard',
  students: [],
  attendance: [],
  // Chat: conversación abierta (para suprimir badge de lo que ya se está leyendo)
  activeConversationId: null,
  // School Engine
  schoolYear: null,
  activePeriod: null,
  periods: [],
  logsMap: {}
});

// Wrapper que intercepta get('classroom') → devuelve currentClassroom
export const AppState = {
  get(key) {
    if (key === 'classroom') return _state.get('currentClassroom');
    return _state.get(key);
  },
  set(key, value) {
    if (key === 'classroom') {
      _state.set('currentClassroom', value);
      // Sincronizar array de aulas: si el aula no está, agregarla
      const arr = _state.get('classrooms') || [];
      if (value && value.id && !arr.find(c => c.id === value.id)) {
        _state.set('classrooms', [...arr, value]);
      }
      return;
    }
    _state.set(key, value);
  },
  getAll() { return _state.getAll(); }
};
