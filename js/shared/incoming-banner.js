/**
 * 🔔 IncomingBanner — Aviso global de mensajes entrantes (todos los paneles)
 *
 * Escucha en tiempo real los mensajes dirigidos al usuario actual y muestra
 * un banner fijo arriba con quién escribió y el preview, desde CUALQUIER
 * sección del panel. Al hacer clic abre el chat con ese contacto.
 */
import { supabase } from './supabase.js';
import { formatTime } from './chat-render.js';

let _channel = null;
let _bannerEl = null;
let _hideTimer = null;
let _currentSender = null;
const _profileCache = new Map();

async function _getProfile(userId) {
  if (!userId) return null;
  if (_profileCache.has(userId)) return _profileCache.get(userId);
  try {
    const { data } = await supabase
      .from('profiles')
      .select('name, avatar_url')
      .eq('id', userId)
      .maybeSingle();
    if (data) _profileCache.set(userId, data);
    return data || null;
  } catch (_) {
    return null;
  }
}

function _ensureBannerEl() {
  if (_bannerEl && document.body.contains(_bannerEl)) return _bannerEl;
  _bannerEl = document.createElement('div');
  _bannerEl.id = 'karpusIncomingBanner';
  _bannerEl.className = 'kk-chat-banner';
  _bannerEl.setAttribute('role', 'alert');
  _bannerEl.innerHTML = `
    <div class="kk-chat-banner-avatar"><span>💬</span></div>
    <div class="kk-chat-banner-body">
      <div class="kk-chat-banner-name">Nuevo mensaje</div>
      <div class="kk-chat-banner-preview"></div>
      <div class="kk-banner-quick-reply" style="display:flex;gap:6px;margin-top:6px;">
        <button data-qr="Entendido 👍" style="font-size:10px;padding:3px 8px;border-radius:10px;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;cursor:pointer;font-weight:700;">Entendido 👍</button>
        <button data-qr="Gracias 🙏" style="font-size:10px;padding:3px 8px;border-radius:10px;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;cursor:pointer;font-weight:700;">Gracias 🙏</button>
        <button data-qr="Voy a revisarlo 📋" style="font-size:10px;padding:3px 8px;border-radius:10px;background:#fefce8;color:#ca8a04;border:1px solid #fef08a;cursor:pointer;font-weight:700;">Voy a revisarlo 📋</button>
      </div>
    </div>
    <button class="kk-chat-banner-close" aria-label="Cerrar">✕</button>`;
  document.body.appendChild(_bannerEl);

  // Click en el banner → abrir chat con el remitente
  _bannerEl.addEventListener('click', (e) => {
    if (e.target.closest('.kk-chat-banner-close')) return;
    // Quick reply → enviar mensaje directamente
    const qrBtn = e.target.closest('[data-qr]');
    if (qrBtn && _currentSender && _cfg?.onOpen) {
      const text = qrBtn.dataset.qr;
      _sendQuickReplyFromBanner(_currentSender, text);
      _dismiss();
      return;
    }
    const senderId = _currentSender;
    _dismiss();
    if (senderId && _cfg?.onOpen) {
      try { _cfg.onOpen(senderId); } catch (_) { /* silencioso */ }
    }
  });
  _bannerEl.querySelector('.kk-chat-banner-close')?.addEventListener('click', _dismiss);
  return _bannerEl;
}

async function _sendQuickReplyFromBanner(senderId, text) {
  try {
    const { ChatModule } = await import('./chat.js');
    const { supabase: sb } = await import('./supabase.js');
    const { data: { user } } = await sb.auth.getUser();
    if (user) await ChatModule.sendMessage(user.id, senderId, text, null, null);
  } catch (_) {}
}

function _show({ name, avatarUrl, preview, timeTxt }) {
  const el = _ensureBannerEl();
  _bannerEl.querySelector('.kk-chat-banner-name').textContent = name;
  _bannerEl.querySelector('.kk-chat-banner-preview').textContent =
    `${timeTxt ? timeTxt + ' · ' : ''}${preview}`;
  const av = _bannerEl.querySelector('.kk-chat-banner-avatar');
  av.innerHTML = avatarUrl
    ? `<img src="${avatarUrl}" alt="">`
    : `<span>${(name || '💬').charAt(0).toUpperCase()}</span>`;

  el.classList.add('is-visible');
  clearTimeout(_hideTimer);
  _hideTimer = setTimeout(_dismiss, 6000);
}

function _dismiss() {
  clearTimeout(_hideTimer);
  _bannerEl?.classList.remove('is-visible');
  _currentSender = null;
}

let _cfg = null;

export const IncomingBanner = {
  /**
   * @param {Object}   opts
   * @param {string}   opts.uid               — id del usuario autenticado
   * @param {Function} [opts.isActiveChat]    — (msg) => true si ese chat ya está abierto y visible
   * @param {Function} opts.onOpen            — (senderId) => abre el chat con ese contacto
   */
  init({ uid, isActiveChat, onOpen }) {
    if (!uid || _channel) return;
    _cfg = { uid, isActiveChat, onOpen };

    try {
      _channel = supabase
        .channel(`kk_incoming_banner_${uid.slice(0, 8)}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${uid}` },
          (payload) => this._handle(payload.new)
        )
        .subscribe();
    } catch (_) { /* silencioso */ }
  },

  async _handle(msg) {
    if (!msg || msg.sender_id === _cfg?.uid) return;
    try {
      // Si el usuario ya tiene ese chat abierto y la pestaña visible, no molestar
      if (_cfg?.isActiveChat?.(msg) && !document.hidden) return;

      const profile = await _getProfile(msg.sender_id);
      _currentSender = msg.sender_id;
      _show({
        name: profile?.name || 'Nuevo mensaje',
        avatarUrl: profile?.avatar_url || null,
        preview: String(msg.content || '').slice(0, 90),
        timeTxt: msg.created_at ? formatTime(msg.created_at) : ''
      });

      // Vibración sutil (móvil)
      try { navigator.vibrate?.([60, 40, 60]); } catch (_) {}

      // Evento global por si otros módulos quieren refrescar badges
      window.dispatchEvent(new CustomEvent('karpus:incoming-message', { detail: msg }));
    } catch (_) { /* silencioso */ }
  },

  /** Cierra el canal y el banner (logout / limpieza) */
  destroy() {
    try { if (_channel) supabase.removeChannel(_channel); } catch (_) {}
    _channel = null;
    _dismiss();
  }
};
