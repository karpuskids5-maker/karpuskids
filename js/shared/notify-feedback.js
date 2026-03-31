/**
 * 🔔 Notification Feedback — Karpus Kids
 * Shows a green confirmation card after push/email notifications are sent.
 * Usage: showNotifyFeedback({ sent: 3, type: 'task', label: 'Nueva Tarea' })
 */

export function showNotifyFeedback({ sent = 0, type = 'info', label = '', containerId = null }) {
  if (sent === 0) return;

  const icons = {
    task:       '📚',
    post:       '📢',
    attendance: '📅',
    payment:    '💳',
    grade:      '🏆',
    routine:    '📝',
    info:       '🔔'
  };

  const icon = icons[type] || icons.info;
  const msg  = sent === 1
    ? `${icon} Notificación enviada a 1 padre`
    : `${icon} Notificaciones enviadas a ${sent} padres`;

  const card = document.createElement('div');
  card.className = [
    'flex items-center gap-3 px-5 py-3.5',
    'bg-emerald-50 border border-emerald-200 rounded-2xl',
    'text-emerald-800 text-sm font-bold shadow-sm',
    'animate-fade-in'
  ].join(' ');
  card.style.cssText = 'animation: notifSlideIn 0.4s ease both';
  card.innerHTML =
    '<div class="w-8 h-8 bg-emerald-100 rounded-xl flex items-center justify-center text-base shrink-0">' + icon + '</div>' +
    '<div class="flex-1 min-w-0">' +
      '<p class="font-black text-emerald-800 text-sm">' + msg + '</p>' +
      (label ? '<p class="text-[11px] text-emerald-600 font-bold truncate">' + label + '</p>' : '') +
    '</div>' +
    '<div class="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center shrink-0">' +
      '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' +
    '</div>';

  // Insert into container or append to body as toast
  const target = containerId ? document.getElementById(containerId) : null;
  if (target) {
    target.insertBefore(card, target.firstChild);
    setTimeout(() => { card.style.opacity = '0'; setTimeout(() => card.remove(), 400); }, 4000);
  } else {
    // Floating toast at bottom
    card.style.cssText += ';position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9998;min-width:280px;max-width:90vw';
    document.body.appendChild(card);
    setTimeout(() => {
      card.style.transition = 'opacity 0.4s, transform 0.4s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(() => card.remove(), 400);
    }, 4000);
  }
}

/**
 * Send push to multiple parents and show feedback.
 * Returns count of successful sends.
 */
export async function notifyParents({ students, title, message, type, link, label = '' }) {
  const targets = (students || []).filter(s => s.parent_id);
  if (!targets.length) return 0;

  const { sendPush } = await import('./supabase.js');

  const results = await Promise.allSettled(
    targets.map(s => sendPush({ user_id: s.parent_id, title, message, type, link }))
  );

  const sent = results.filter(r => r.status === 'fulfilled' && r.value?.ok !== false).length;
  showNotifyFeedback({ sent, type, label });
  return sent;
}

// CSS animation
const style = document.createElement('style');
style.textContent = '@keyframes notifSlideIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}';
document.head.appendChild(style);
