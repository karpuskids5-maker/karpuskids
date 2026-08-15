/**
 * 🔔 Notification Permission Manager — Karpus Kids
 * Requests push notification permission.
 * - requestIfNeeded(): shows banner if not yet granted (no dismiss timeout)
 * - requestSilent(): auto-requests without UI (for app startup)
 */

export const NotifyPermission = {

  isGranted() {
    return 'Notification' in window && Notification.permission === 'granted';
  },

  isDenied() {
    return 'Notification' in window && Notification.permission === 'denied';
  },

  /** Show banner if permission not yet granted. Always shows until user decides. */
  requestIfNeeded(containerId = 'notifPermissionSlot') {
    if (!('Notification' in window)) return;
    // Tras una actualización de la app se restablece/re-pide la suscripción
    // para que la nueva versión quede vinculada a OneSignal.
    this.consumeUpdateReset(containerId);
    if (this.isDenied()) return;
    if (this.isGranted()) { this._ensureOneSignalLinked(false); return; }
    this._render(containerId);
  },

  /**
   * Re-pide/reestablece notificaciones tras una actualización del sistema.
   * El PWA Updater guarda karpus_notif_reask='1' antes de recargar con la
   * versión nueva. Aquí se consume el flag, se re-vincula la suscripción
   * (optOut + optIn → player_id fresco) y se confirma con un push.
   */
  consumeUpdateReset(containerId = 'notifPermissionSlot') {
    let flag = null;
    try { flag = localStorage.getItem('karpus_notif_reask'); } catch (_) {}
    if (flag !== '1') return;
    try { localStorage.removeItem('karpus_notif_reask'); } catch (_) {}
    if (this.isGranted()) {
      // Ya tiene permiso → re-vincular con la nueva versión y confirmar
      this._ensureOneSignalLinked(true);
      this._showSuccess();
      return;
    }
    this._render(containerId);
  },

  /** Auto-request without banner — use on app startup */
  async requestSilent() {
    if (!('Notification' in window)) return;
    this.consumeUpdateReset();
    if (this.isGranted()) { this._ensureOneSignalLinked(false); return; }
    if (this.isDenied()) return;
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        await this._ensureOneSignalLinked(true);
        this._showSuccess();
      }
    } catch (_) {}
  },

  async _ensureOneSignalLinked(sendWelcome = false) {
    try {
      const { supabase, sendPush } = await import('./supabase.js');
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) return;

      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async function(OneSignal) {
        if (!OneSignal || !OneSignal.User) return;
        const currentExtId = await OneSignal.User.getExternalId?.();
        if (currentExtId !== userId) {
          await OneSignal.login(userId).catch(() => {});
        }
        await OneSignal.User.PushSubscription?.optIn?.().catch(() => {});

        // Esperar a que la suscripción se cree y guardar el player_id.
        // Antes se leía PushSubscription.id afuera del callback (sincrónico),
        // cuando optIn aún no había corrido → siempre null.
        let subId = OneSignal.User?.PushSubscription?.id;
        if (!subId) {
          for (let i = 0; i < 12 && !subId; i++) {
            await new Promise(r => setTimeout(r, 300));
            subId = OneSignal.User?.PushSubscription?.id;
          }
        }
        if (subId) {
          try {
            await supabase.from('profiles')
              .update({ onesignal_player_id: subId })
              .eq('id', userId);
          } catch (_) {}
        }

        // Notificación de confirmación cuando el usuario ACTIVA las notificaciones.
        // El welcomeNotification de OneSignal solo se envía UNA vez por dispositivo,
        // por eso enviamos un push explícito y confiable vía send-push.
        if (sendWelcome) {
          try {
            await sendPush({
              user_id: userId,
              title: '🔔 Notificaciones activadas',
              message: 'Ya recibirás alertas de asistencia, tareas, pagos y mensajes de Karpus Kids en tiempo real.',
              type: 'info',
              link: '/panel_padres.html'
            });
          } catch (_) {}
        }
      });
    } catch (_) {}
  },

  _render(containerId) {
    document.getElementById('karpus-notif-banner')?.remove();
    const slot = document.getElementById(containerId);
    const banner = document.createElement('div');
    banner.id = 'karpus-notif-banner';
    banner.className = 'flex items-start gap-4 p-5 rounded-2xl border-2 border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 shadow-sm mb-6';
    banner.innerHTML =
      '<div class="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center text-2xl shrink-0">\uD83D\uDD14</div>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="font-black text-slate-800 text-sm">Activa las notificaciones</p>' +
        '<p class="text-xs text-slate-500 font-medium mt-0.5">Recibe alertas de asistencia, tareas, pagos y mensajes en tiempo real.</p>' +
        '<button id="karpus-notif-allow" class="mt-3 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all active:scale-95 shadow-sm">Activar ahora</button>' +
      '</div>' +
      '<button id="karpus-notif-close" class="text-slate-300 hover:text-slate-500 transition-colors shrink-0 p-1" title="Cerrar">\u2715</button>';

    if (slot) slot.insertBefore(banner, slot.firstChild);
    else document.body.insertBefore(banner, document.body.firstChild);

    document.getElementById('karpus-notif-allow')?.addEventListener('click', async () => {
      banner.remove();
      try {
        const result = await Notification.requestPermission();
        if (result === 'granted') {
          await this._ensureOneSignalLinked(true);
          this._showSuccess();
        }
      } catch (e) { /* silencioso */ }
    });

    // Close just hides — will show again next visit (no permanent dismiss)
    document.getElementById('karpus-notif-close')?.addEventListener('click', () => banner.remove());
  },

  _showSuccess() {
    const t = document.createElement('div');
    t.className = 'fixed bottom-6 right-6 z-[9999] flex items-center gap-3 bg-green-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-black';
    t.textContent = '\uD83D\uDD14 Notificaciones activadas';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }
};
