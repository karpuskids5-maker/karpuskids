/**
 * 💬 ChatRender — Utilidades de render estilo WhatsApp (compartidas)
 * Burbujas, separadores de día (Hoy / Ayer / fecha), badges y placeholders.
 * Todo el styling vive en css/layout.css con clases kk-* (CSS plano,
 * independiente del Tailwind compilado).
 */

/** Etiqueta de día: Hoy / Ayer / "12 ago" / "12 ago 2025" */
export function formatDayLabel(input) {
  const date = (input instanceof Date) ? input : new Date(input);
  if (!date || isNaN(date)) return '';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  if (date >= startToday) return 'Hoy';
  if (date >= startYesterday) return 'Ayer';
  return date.toLocaleDateString('es', {
    day: 'numeric', month: 'short',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {})
  });
}

export function formatTime(input) {
  const date = (input instanceof Date) ? input : new Date(input);
  if (!date || isNaN(date)) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Píldora central con el día — se inserta entre grupos de fechas distintas */
export function daySeparatorHTML(label) {
  if (!label) return '';
  return `<div class="kk-day-separator"><span class="kk-day-pill">${label}</span></div>`;
}

/**
 * Construye un hilo completo (HTML) insertando separadores de día
 * @param {Array}    messages  — orden cronológico
 * @param {Function} bubbleFn  — (msg) => html de la burbuja
 */
export function buildThreadHTML(messages, bubbleFn) {
  let html = '', lastDay = '';
  (messages || []).forEach(m => {
    const day = m.created_at ? formatDayLabel(m.created_at) : '';
    if (day && day !== lastDay) { html += daySeparatorHTML(day); lastDay = day; }
    html += bubbleFn(m);
  });
  return html;
}

/** Inserta HTML de mensajes antiguos al inicio del contenedor (paginación) */
export function prependThreadHTML(container, messages, bubbleFn) {
  if (!container || !messages?.length) return;
  container.insertAdjacentHTML('afterbegin', buildThreadHTML(messages, bubbleFn));
}

/**
 * Añade un mensaje nuevo en tiempo real, insertando separador de día
 * si cambió la fecha respecto al último mensaje del hilo.
 * @returns {boolean} true si se añadió algo
 */
export function appendLiveMessage(container, msg, bubbleFn) {
  if (!container || !msg) return false;
  try {
    const tsEls = container.querySelectorAll('[data-ts]');
    const lastTs = tsEls.length ? Number(tsEls[tsEls.length - 1].dataset.ts) : NaN;
    const newDay = msg.created_at ? formatDayLabel(msg.created_at) : '';
    const lastDay = !isNaN(lastTs) && lastTs ? formatDayLabel(new Date(lastTs)) : '';
    if (newDay && newDay !== lastDay) {
      container.insertAdjacentHTML('beforeend', daySeparatorHTML(newDay));
    }
  } catch (_) { /* silencioso */ }
  container.insertAdjacentHTML('beforeend', bubbleFn(msg));
  return true;
}

/**
 * Burbuja estilo WhatsApp.
 * @param {Object}  o
 * @param {Object}  o.m             — mensaje { sender_id, content, created_at, is_read, read_at, id?, reactions?, reply_to?, deleted_at?, _replyPreview? }
 * @param {string}  o.myId          — id del usuario actual
 * @param {string}  o.senderName    — nombre visible del remitente
 * @param {string}  o.avatarUrl     — avatar del remitente (null → inicial)
 * @param {boolean} o.showName      — mostrar nombre sobre burbuja (entrantes)
 * @param {boolean} o.showAvatar    — mostrar avatar lateral
 * @param {string}  o.side          — 'in' | 'out'
 */
export function waBubbleHTML({ m, myId, senderName = '', avatarUrl = null, showName = false, showAvatar = true }) {
  const isMine = m.sender_id === myId;
  const side = isMine ? 'out' : 'in';
  const msgId = m.id || `temp-${Date.now()}`;
  const ts = m.created_at ? new Date(m.created_at) : null;
  const valid = ts && !isNaN(ts);
  const timeTxt = valid ? formatTime(ts) : 'Enviando…';
  const dayTxt = valid ? formatDayLabel(ts) : '';
  const initial = (senderName || '?').trim().charAt(0).toUpperCase();
  const deleted = !!m.deleted_at;

  const checks = isMine
    ? `<span class="kk-checks ${(m.read_at || m.is_read) ? 'is-read' : ''}">${(m.read_at || m.is_read) ? '✓✓' : '✓'}</span>`
    : '';

  const nameLine = (showName && senderName)
    ? `<div class="kk-sender-name ${isMine ? 'text-right opacity-70' : ''}">${_esc(senderName)}</div>` : '';

  const avatar = showAvatar
    ? `<div class="kk-msg-avatar">${avatarUrl
        ? `<img src="${_esc(avatarUrl)}" alt="" loading="lazy">`
        : `<span>${initial}</span>`}</div>`
    : '';

  const bodyHTML = deleted
    ? `<p class="kk-msg-text"><em class="kk-msg-deleted">⊘ Mensaje eliminado</em></p>`
    : `${_replyQuoteHTML(m)}<p class="kk-msg-text">${_esc(m.content || '')}</p>`;

  return `
  <div id="msg-${_esc(String(msgId))}" data-ts="${valid ? ts.getTime() : ''}"
       data-sender="${_esc(String(m.sender_id || ''))}"
       class="kk-msg-row ${isMine ? 'is-out' : 'is-in'} ${deleted ? 'is-deleted' : ''}">
    ${avatar}
    <div class="kk-msg-bubble kk-${side}">
      ${nameLine}
      ${bodyHTML}
      <div class="kk-msg-meta">
        <span class="kk-msg-time">${dayTxt ? `${dayTxt} · ` : ''}${timeTxt}</span>
        ${checks}
      </div>
      ${_reactionChipsHTML(m.reactions, myId)}
    </div>
  </div>`;
}

function _esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Badge rojo de no leídos para listas de contactos */
export function unreadBadgeHTML(count) {
  const n = Number(count) || 0;
  if (n <= 0) return '';
  return `<span class="kk-unread-badge">${n > 99 ? '99+' : n}</span>`;
}

/**
 * Hora compacta para listas de chats: HH:MM hoy · "Ayer" · dd/mm/aa
 */
export function formatListTime(input) {
  const date = (input instanceof Date) ? input : new Date(input);
  if (!date || isNaN(date)) return '';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  if (date >= startToday) return formatTime(date);
  if (date >= startYesterday) return 'Ayer';
  return date.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/**
 * Fila de lista de conversaciones estilo WhatsApp.
 * @param {Object}  o
 * @param {Object}  o.c          — contacto { id, name, avatar, roleLabel, childName?... }
 * @param {number}  o.unread     — mensajes sin leer
 * @param {Object}  o.lastMsg    — { content, created_at, mine } | null
 * @param {boolean} o.online     — estado de presencia
 * @param {string}  o.sub        — subtítulo (rol / padre) si no hay preview
 * @param {string}  o.avatarBg   — clases tailwind del fondo del avatar
 * @param {string}  o.extraAttr  — atributos extra para el elemento raíz
 * @param {boolean} o.disabled   — contacto no chateable
 */
export function chatListItemHTML({ c, unread = 0, lastMsg = null, online = false, sub = '', avatarBg = 'bg-slate-100 text-slate-500', extraAttr = '', disabled = false }) {
  const name = c.name || 'Usuario';
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const time = lastMsg?.created_at ? formatListTime(lastMsg.created_at) : '';

  let preview;
  if (lastMsg) {
    const prefix = lastMsg.mine ? '<span class="kk-preview-you">Tú:</span> ' : '';
    preview = `${prefix}<span class="kk-preview-text">${_esc(lastMsg.content || '')}</span>`;
  } else {
    preview = `<span class="kk-preview-sub">${_esc(sub || '')}</span>`;
  }

  return `
  <div data-contact-id="${_esc(String(c.id || ''))}" ${extraAttr}
       class="kk-chat-item ${disabled ? 'is-disabled' : ''}">
    <div class="kk-chat-item-avatar-wrap">
      <div class="kk-chat-item-avatar ${avatarBg}">
        ${c.avatar ? `<img src="${_esc(c.avatar)}" alt="" loading="lazy">` : `<span>${initial}</span>`}
      </div>
      <span class="kk-online-dot ${online ? 'is-online' : ''}"></span>
      ${unreadBadgeHTML(unread)}
    </div>
    <div class="kk-chat-item-body">
      <div class="kk-chat-item-top">
        <span class="kk-chat-item-name">${_esc(name)}</span>
        ${time ? `<span class="kk-chat-item-time">${time}</span>` : ''}
      </div>
      <div class="kk-chat-item-bottom">
        <span class="kk-chat-item-preview">${preview}</span>
        ${unread > 0 ? `<span class="kk-unread-badge is-static">${unread > 99 ? '99+' : unread}</span>` : ''}
      </div>
    </div>
  </div>`;
}

/**
 * Chips de reacciones agregadas sobre una burbuja.
 * @param {Object} reactions — { [userId]: emoji }
 */
export function reactionChipsHTML(reactions, myId) {
  return _reactionChipsHTML(reactions, myId);
}

function _reactionChipsHTML(reactions, myId) {
  if (!reactions || typeof reactions !== 'object') return '';
  const counts = {};
  Object.values(reactions).forEach(emoji => {
    if (emoji) counts[emoji] = (counts[emoji] || 0) + 1;
  });
  const entries = Object.entries(counts);
  if (!entries.length) return '';
  const mine = myId ? reactions[myId] : null;
  const chips = entries.map(([emoji, n]) =>
    `<span class="kk-reaction-chip ${emoji === mine ? 'is-mine' : ''}">${emoji}${n > 1 ? `<b>${n}</b>` : ''}</span>`
  ).join('');
  return `<div class="kk-reaction-chips">${chips}</div>`;
}

/** Cita de mensaje respondido dentro de la burbuja */
function _replyQuoteHTML(m) {
  const q = m._replyPreview;
  if (!q) return '';
  return `
  <div class="kk-reply-quote">
    <div class="kk-reply-quote-name">${_esc(q.sender_name || 'Mensaje')}</div>
    <div class="kk-reply-quote-text">${_esc((q.content || '').slice(0, 120))}</div>
  </div>`;
}
