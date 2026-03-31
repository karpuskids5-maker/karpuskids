/**
 * 🔔 Notification Permission Manager — Karpus Kids
 * Shows a permission request UI when the user visits their profile section.
 * Works on all panels. Call requestIfNeeded() when profile section loads.
 */

const STORAGE_KEY = 'karpus-notif-dismissed';

export const NotifyPermission = {

  /** Returns true if push is already granted */
  isGranted() {
    return 'Notification' in window && Notification.permission === 'granted';
  },

  /** Returns true if the user permanently denied */
  isDenied() {
    return 'Notification' in window && Notification.permission === 'denied';
  },

  /** Returns true if user dismissed our UI recently (7 days) */
  _wasDismissed() {
    const v = localStorage.getItem(STORAGE_KEY);
    if (!v) return false;
    return Date.now() < parseInt(v, 10);
  },

  /**
   * Call this when the profile section becomes visible.
   * Injects a permission card into the given container ID (or body).
   */
  requestIfNeeded(containerId = 'notifPermissionSlot') {
    // Already granted or permanently denied — nothing to do
    if (this.isGranted() || this.isDenied()) return;
    // User dismissed recently
    if (this._wasDismissed()) return;
    // Browser doesn't support notifications
    if (!('Notification' in window)) return;

    this._render(containerId);
  },

  _render(containerId) {
    // Remove any existing banner
    document.getElementById('karpus-notif-banner')?.remove();

    const slot = document.getElementById(containerId);
    const banner = document.createElement('div');
    banner.id = 'karpus-notif-banner';
    banner.className = [
      'flex items-start gap-4 p-5 rounded-2xl border-2 border-amber-200',
      'bg-gradient-to-r from-amber-50 to-orange-50 shadow-sm mb-6'
    ].join(' ');

    banner.innerHTML =
      '<div class="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center text-2xl shrink-0">🔔</div>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="font-black text-slate-800 text-sm leading-tight">Activa las notificaciones</p>' +
        '<p class="text-xs text-slate-500 font-medium mt-0.5 leading-snug">' +
          'Recibe alertas de asistencia, tareas, pagos y mensajes en tiempo real.' +
        '</p>' +
        '<div class="flex gap-2 mt-3">' +
          '<button id="karpus-notif-allow" ' +
            'class="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all active:scale-95 shadow-sm">' +
            'Activar ahora' +
          '</button>' +
          '<button id="karpus-notif-dismiss" ' +
            'class="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-slate-50 transition-all">' +
            'Ahora no' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<button id="karpus-notif-close" class="text-slate-300 hover:text-slate-500 transition-colors shrink-0 p-1">✕</button>';

    // Insert at top of slot, or prepend to body as fallback
    if (slot) {
      slot.insertBefore(banner, slot.firstChild);
    } else {
      document.body.insertBefore(banner, document.body.firstChild);
    }

    // Allow button
    document.getElementById('karpus-notif-allow')?.addEventListener('click', async () => {
      banner.remove();
      try {
        const result = await Notification.requestPermission();
        if (result === 'granted') {
          this._showSuccess();
          // Re-init OneSignal if available
          if (window.OneSignal?.User) {
            const { data } = await (await import('./supabase.js')).supabase.auth.getUser();
            if (data?.user) await window.OneSignal.login(data.user.id).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('[NotifyPermission] requestPermission error:', e);
      }
    });

    // Dismiss for 7 days
    const dismiss = () => {
      banner.remove();
      localStorage.setItem(STORAGE_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
    };
    document.getElementById('karpus-notif-dismiss')?.addEventListener('click', dismiss);
    document.getElementById('karpus-notif-close')?.addEventListener('click', dismiss);
  },

  _showSuccess() {
    const toast = document.createElement('div');
    toast.className = [
      'fixed bottom-6 right-6 z-[9999] flex items-center gap-3',
      'bg-green-600 text-white px-5 py-3 rounded-2xl shadow-xl',
      'text-sm font-black'
    ].join(' ');
    toast.textContent = '🔔 Notificaciones activadas';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }
};
