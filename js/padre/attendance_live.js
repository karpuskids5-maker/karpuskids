import { supabase } from '../supabase.js';
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
    console.warn('[Live] classroomId inválido, se omite la inicialización.');
    return null;
  }

  try {
    // Evitar múltiples canales activos para la misma classroom
    const existingChannel = AppState.get('liveChannel');
    if (existingChannel?.topic === `live_status_${classroomId}`) {
      console.log('[Live] Ya existe un canal activo para esta classroom, reutilizando.');
      return existingChannel;
    }

    // Si existe otro canal (de otra classroom), removerlo primero
    if (existingChannel) {
      try {
        await AppState.removeChannelSafe(existingChannel);
      } catch (e) {
        console.warn('[Live] Error al remover canal anterior:', e?.message || e);
      }
      AppState.set('liveChannel', null);
    }

    // ============================
    // UI UPDATE CENTRALIZADO
    // ============================
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
      } catch (uiErr) {
        // No debería romper todo el listener si falla la actualización de UI
        console.warn('[Live] Error actualizando UI:', uiErr?.message || uiErr);
      }
    };

    // REACTIVIDAD GLOBAL: suscribimos la función de UI
    AppState.subscribe('isClassLive', updateUI);

    // ESTADO INICIAL desde supabase
    const { data, error } = await supabase
      .from('classrooms')
      .select('is_live')
      .eq('id', classroomId)
      .maybeSingle();

    if (error) {
      console.warn('[Live] Error consultando estado inicial:', error.message || error);
      // no throw para evitar romper la app; retorna null para indicar fallo
      return null;
    }

    const initialState = !!(data && data.is_live);
    AppState.set('isClassLive', initialState);

    // Aplicar UI inicial de forma segura
    updateUI(initialState);

    // REALTIME LISTENER
    const channel = supabase
      .channel(`live_status_${classroomId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'classrooms',
          filter: `id=eq.${classroomId}`
        },
        (payload) => {
          try {
            if (!payload || !payload.new) return;

            // Normalizar valor booleano
            const isLive = !!payload.new.is_live;
            const prev = AppState.get('isClassLive');

            // Evitar ejecuciones duplicadas
            if (prev === isLive) return;

            console.log(`[Live] classroom=${classroomId} isLive=${isLive}`);

            AppState.set('isClassLive', isLive);

            // Notificación solo cuando inicia
            if (isLive && !prev) {
              Helpers.toast('🔴 ¡La clase en vivo ha comenzado!', 'info');
            }
          } catch (handlerErr) {
            console.warn('[Live] Error manejando payload realtime:', handlerErr?.message || handlerErr);
          }
        }
      );

    // Subscribe separado para poder manejar el status (subscribe devuelve una promesa en algunos SDKs)
    const subscribeResult = await channel.subscribe();
    // subscribeResult puede ser string o un objeto dependiendo del SDK
    // Registramos logs según el resultado
    if (subscribeResult === 'SUBSCRIBED' || (subscribeResult && subscribeResult.status === 'SUBSCRIBED')) {
      console.log('[Live] Conectado a live class realtime');
    } else if (subscribeResult === 'CHANNEL_ERROR' || (subscribeResult && subscribeResult.status === 'CHANNEL_ERROR')) {
      console.error('[Live] Error en canal realtime', subscribeResult);
    } else if (subscribeResult === 'TIMED_OUT' || (subscribeResult && subscribeResult.status === 'TIMED_OUT')) {
      console.warn('[Live] Reintentando conexión...');
    } else {
      // valor inesperado, pero guardamos el channel de todas formas
      console.log('[Live] Resultado de suscripción:', subscribeResult);
    }

    // Guardar canal en AppState para que otros módulos puedan limpiarlo
    AppState.set('liveChannel', channel);

    return channel;
  } catch (err) {
    console.warn('[Live] Listener error:', err?.message || err);
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
    } else if (typeof AppState.removeChannelSafe === 'function') {
      await AppState.removeChannelSafe(channel);
    }

    // limpiar estado global
    if (AppState.get('liveChannel') === channel) {
      AppState.set('liveChannel', null);
    }

    console.log('[Live] Canal eliminado correctamente.');
  } catch (err) {
    console.warn('[Live] Error eliminando canal:', err?.message || err);
  }
}