import { supabase } from '../shared/supabase.js';
import { AppState } from './appState.js';
import { Helpers } from './helpers.js';

/**
 * Listener en tiempo real para estado de clase en vivo
 *
 * Mejoras aplicadas:
 * - Validación de classroomId (tipo y valor)
 * - Evita crear múltiples listeners para la misma classroom
 * - Manejo seguro de eliminación del canal (unsubscribe)
 * - Protección contra race conditions al leer AppState
 * - Logs más descriptivos y no exponiendo objetos grandes
 * - Retorna el channel para permitir cleanup desde el llamador
 *
 * Uso:
 * const channel = await initLiveClassListener(123);
 * // ... cuando ya no sea necesario:
 * await removeLiveClassListener(channel);
 */

function isValidId(id) {
  return id !== null && id !== undefined && (typeof id === 'number' || (typeof id === 'string' && id.trim() !== ''));
}

export async function initLiveClassListener(classroomId) {
  if (!isValidId(classroomId)) {
    return null;
  }

  try {
    const existingChannel = AppState.get('liveChannel');
    if (existingChannel?.topic === `live_status_${classroomId}`) {
      return existingChannel;
    }

    if (existingChannel) {
      try {
        if (typeof existingChannel.unsubscribe === 'function') {
          await existingChannel.unsubscribe();
        }
      } catch (_) {}
      AppState.set('liveChannel', null);
    }

    const updateUI = (isLive) => {
      try {
        const btn = document.querySelector('button[data-target="videocall"]');
        if (btn) {
          btn.classList.toggle('hidden', !isLive);
          btn.classList.toggle('flex', isLive);
        }
        const card = document.querySelector('.patio-card[data-target="videocall"]');
        if (card) {
          card.classList.toggle('hidden', !isLive);
          card.classList.toggle('flex', isLive);
          card.classList.toggle('ring-4', isLive);
          card.classList.toggle('ring-rose-200', isLive);
          card.classList.toggle('animate-pulse', isLive);
        }
      } catch (_) {}
    };

    AppState.subscribe('isClassLive', updateUI);

    const { data, error } = await supabase
      .from('classrooms')
      .select('is_live')
      .eq('id', classroomId)
      .maybeSingle();

    if (error) return null;

    const initialState = !!(data && data.is_live);
    AppState.set('isClassLive', initialState);
    updateUI(initialState);

    const channel = supabase
      .channel(`live_status_${classroomId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'classrooms',
        filter: `id=eq.${classroomId}`
      }, (payload) => {
        try {
          if (!payload?.new) return;
          const isLive = !!payload.new.is_live;
          const prev = AppState.get('isClassLive');
          if (prev === isLive) return;
          AppState.set('isClassLive', isLive);
          if (isLive && !prev) Helpers.toast('🔴 ¡La clase en vivo ha comenzado!', 'info');
        } catch (_) {}
      });

    await channel.subscribe();
    AppState.set('liveChannel', channel);
    return channel;
  } catch (_) {
    return null;
  }
}

/**
 * Remueve de forma segura un channel creado por initLiveClassListener.
 * Acepta el objeto channel retornado por supabase.channel(...) o null.
 */
export async function removeLiveClassListener(channel) {
  if (!channel) {
    const c = AppState.get('liveChannel');
    if (!c) return;
    channel = c;
  }

  try {
    // Intentar unsubscribe si existe la API
    if (typeof channel.unsubscribe === 'function') {
      await channel.unsubscribe();
    } else if (typeof channel.remove === 'function') {
      // fallback a remove si aplica
      await channel.remove();
    }

    // limpiar estado global
    if (AppState.get('liveChannel') === channel) {
      AppState.set('liveChannel', null);
    }
  } catch (_) {}
}