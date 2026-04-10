/**
 * 📡 Karpus Kids — RealtimeManager
 * Gestión centralizada de canales Supabase Realtime.
 * Evita memory leaks por canales huérfanos y limita a MAX_CHANNELS activos.
 *
 * Problema que resuelve:
 *   Con 10k usuarios, cada uno puede abrir múltiples canales si no se limpian.
 *   Supabase tiene un límite de conexiones concurrentes por proyecto.
 *   Este módulo garantiza que cada usuario solo tenga los canales necesarios.
 */

import { supabase } from './supabase.js';

const MAX_CHANNELS = 8; // máximo de canales activos por sesión
const _channels = new Map(); // name → RealtimeChannel

export const RealtimeManager = {
  /**
   * Suscribe a un canal. Si ya existe con el mismo nombre, lo reutiliza.
   * Si se supera MAX_CHANNELS, elimina el más antiguo.
   *
   * @param {string}   name     — nombre único del canal
   * @param {Function} setupFn  — (channel) => channel.on(...).on(...)
   * @returns {RealtimeChannel}
   */
  subscribe(name, setupFn) {
    // Reutilizar si ya existe
    if (_channels.has(name)) return _channels.get(name);

    // Evitar exceder el límite
    if (_channels.size >= MAX_CHANNELS) {
      const oldest = _channels.keys().next().value;
      this.unsubscribe(oldest);
    }

    const channel = supabase.channel(name);
    setupFn(channel);

    // Pequeño delay para evitar "WebSocket closed before connection established"
    // cuando se crean/destruyen canales rápidamente
    setTimeout(() => {
      if (!_channels.has(name)) return; // fue cancelado antes de conectar
      channel.subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn(`[RealtimeManager] Error en canal: ${name}`);
          _channels.delete(name);
        }
      });
    }, 100);

    _channels.set(name, channel);
    return channel;
  },

  /** Elimina un canal por nombre */
  unsubscribe(name) {
    const ch = _channels.get(name);
    if (ch) {
      supabase.removeChannel(ch);
      _channels.delete(name);
    }
  },

  /** Elimina todos los canales (llamar en logout) */
  unsubscribeAll() {
    for (const [name, ch] of _channels) {
      supabase.removeChannel(ch);
    }
    _channels.clear();
    console.log('[RealtimeManager] Todos los canales cerrados');
  },

  /** Retorna los canales activos */
  list() {
    return [..._channels.keys()];
  }
};

// Limpiar canales al cerrar la pestaña
window.addEventListener('beforeunload', () => RealtimeManager.unsubscribeAll());
// Limpiar al perder visibilidad por más de 5 min (ahorro de conexiones)
let _hiddenTimer = null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    _hiddenTimer = setTimeout(() => RealtimeManager.unsubscribeAll(), 5 * 60_000);
  } else {
    clearTimeout(_hiddenTimer);
  }
});
