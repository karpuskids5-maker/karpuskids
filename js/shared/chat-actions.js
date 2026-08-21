/**
 * 💬 ChatActions — Hoja de acciones de mensaje estilo WhatsApp (compartida)
 *
 * Mantener presionado (móvil) o clic derecho (escritorio) sobre una burbuja:
 *   👍 ❤️ 😂 😮 😢   → reaccionar
 *   Responder / Copiar / Reenviar / Eliminar
 *
 * Uso por panel:
 *   bindMessageActions(container, {
 *     myId, canDelete: (msg) => bool,
 *     onReply(msg), onForward(msg),
 *     onReact: async (msgId, emoji) => updatedMsg|null,
 *     onDelete: async (msgId) => boolean  // true = eliminado en servidor
 *   });
 */

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢'];
const LONG_PRESS_MS = 450;

let _sheetEl = null;
let _hideTimer = null;
let _activeRow = null;

/** Cierra la hoja de acciones */
export function closeMessageActions() {
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
  if (_sheetEl) {
    _sheetEl.classList.remove('kk-actions-open');
    const el = _sheetEl;
    setTimeout(() => el.remove(), 200);
    _sheetEl = null;
  }
  if (_activeRow) {
    _activeRow.classList.remove('kk-msg-selected');
    _activeRow = null;
  }
  document.removeEventListener('scroll', closeMessageActions, true);
}

function _buildSheet(msg, opts) {
  const isMine = msg.sender_id === opts.myId;
  const deleted = !!msg.deleted_at;

  const reactionsHTML = REACTIONS.map(r =>
    `<button type="button" class="kk-action-react" data-react="${r}" aria-label="Reaccionar ${r}">${r}</button>`
  ).join('');

  return `
  <div class="kk-action-sheet" role="menu">
    ${deleted ? '' : `<div class="kk-action-reactions">${reactionsHTML}</div>`}
    <div class="kk-action-list">
      ${deleted ? '' : `
      <button type="button" class="kk-action-item" data-act="reply">
        <span class="kk-action-icon">↩</span><span>Responder</span>
      </button>
      <button type="button" class="kk-action-item" data-act="copy">
        <span class="kk-action-icon">⧉</span><span>Copiar</span>
      </button>
      <button type="button" class="kk-action-item" data-act="forward">
        <span class="kk-action-icon">➤</span><span>Reenviar</span>
      </button>`}
      ${isMine && !deleted ? `
      <button type="button" class="kk-action-item kk-action-danger" data-act="delete">
        <span class="kk-action-icon">🗑</span><span>Eliminar</span>
      </button>` : ''}
    </div>
  </div>`;
}

function _openSheet(row, msg, opts) {
  closeMessageActions();

  _activeRow = row;
  row.classList.add('kk-msg-selected');

  const sheet = document.createElement('div');
  sheet.className = 'kk-message-actions';
  sheet.innerHTML = _buildSheet(msg, opts);
  document.body.appendChild(sheet);
  _sheetEl = sheet;

  // Posicionar cerca de la burbuja (dentro del viewport)
  requestAnimationFrame(() => {
    try {
      const bubble = row.querySelector('.kk-msg-bubble') || row;
      const r = bubble.getBoundingClientRect();
      const sw = sheet.offsetWidth || 240;
      const sh = sheet.offsetHeight || 180;
      let left = r.left + (r.width / 2) - (sw / 2);
      left = Math.max(8, Math.min(left, window.innerWidth - sw - 8));
      let top = r.top - sh - 10;
      if (top < 8) top = Math.min(r.bottom + 10, window.innerHeight - sh - 8);
      sheet.style.left = `${left}px`;
      sheet.style.top = `${top}px`;
    } catch (_) { /* silencioso */ }
    sheet.classList.add('kk-actions-open');
  });

  // Cerrar al tocar fuera / scroll / Escape
  setTimeout(() => {
    document.addEventListener('click', _onDocClick);
    document.addEventListener('keydown', _onKey);
    document.addEventListener('scroll', closeMessageActions, true);
  }, 0);

  // Acciones
  sheet.querySelectorAll('[data-react]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const emoji = btn.dataset.react;
      closeMessageActions();
      if (opts.onReact && msg.id && !String(msg.id).startsWith('temp-')) {
        const updated = await opts.onReact(String(msg.id), emoji);
        if (!updated) _toast('No se pudo reaccionar');
      }
    });
  });

  sheet.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      closeMessageActions();
      if (act === 'reply') {
        opts.onReply?.(msg);
      } else if (act === 'copy') {
        try {
          await navigator.clipboard.writeText(msg.content || '');
          _toast('Mensaje copiado');
        } catch (_) { _toast('No se pudo copiar'); }
      } else if (act === 'forward') {
        opts.onForward?.(msg);
      } else if (act === 'delete') {
        if (opts.onDelete) {
          const okSrv = await opts.onDelete(String(msg.id));
          if (!okSrv) row.remove(); // fallback local si la BD no soporta borrado
          else _markDeleted(row);
        }
      }
    });
  });
}

function _onDocClick(e) {
  if (!_sheetEl) return;
  // Ignorar toques sobre la fila que abrió la hoja (click sintético post-long-press)
  if (_activeRow && e.target.closest?.('.kk-msg-row') === _activeRow) return;
  if (!_sheetEl.contains(e.target)) closeMessageActions();
}
function _onKey(e) {
  if (e.key === 'Escape') closeMessageActions();
}

function _toast(text) {
  try {
    const t = document.createElement('div');
    t.className = 'kk-chat-toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('is-visible'), 10);
    setTimeout(() => { t.classList.remove('is-visible'); setTimeout(() => t.remove(), 300); }, 1800);
  } catch (_) {}
}

/** Marca visualmente una burbuja como eliminada */
export function markRowDeleted(row) {
  _markDeleted(row);
}

function _markDeleted(row) {
  try {
    const bubble = row.querySelector('.kk-msg-bubble');
    if (!bubble) return;
    bubble.querySelector('.kk-msg-text').innerHTML =
      '<em class="kk-msg-deleted">⊘ Mensaje eliminado</em>';
    bubble.querySelector('.kk-reaction-chips')?.remove();
  } catch (_) {}
}

/**
 * Barra "Respondiendo a…" sobre el composer.
 * @param {HTMLElement} anchorEl — contenedor del input (se inserta arriba)
 * @param {Object} msg — { sender_name, content }
 * @param {Function} onCancel — callback al cancelar
 */
export function showReplyBar(anchorEl, { senderName = '', content = '' }, onCancel) {
  hideReplyBar();
  if (!anchorEl) return;
  const bar = document.createElement('div');
  bar.id = 'kk-reply-bar';
  bar.className = 'kk-reply-bar';
  bar.innerHTML = `
    <span style="color:#0d9488;font-size:14px;">↩</span>
    <div class="kk-reply-bar-body">
      <div class="kk-reply-bar-title">Respondiendo a ${_fwdEsc(senderName || 'mensaje')}</div>
      <div class="kk-reply-bar-text">${_fwdEsc(content)}</div>
    </div>
    <button type="button" class="kk-reply-bar-cancel" aria-label="Cancelar respuesta">✕</button>`;
  bar.querySelector('.kk-reply-bar-cancel').addEventListener('click', () => {
    hideReplyBar();
    onCancel?.();
  });
  anchorEl.insertBefore(bar, anchorEl.firstChild);
}

/** Elimina la barra de respuesta activa */
export function hideReplyBar() {
  document.getElementById('kk-reply-bar')?.remove();
}

/**
 * Modal de reenvío: elige un contacto y reenvía el mensaje.
 * @param {Array}   contacts — [{ id, name, avatar }]
 * @param {Function} onPick  — (contact) => Promise|void
 */
export function openForwardModal(contacts, onPick) {
  if (!contacts?.length) return;
  document.getElementById('kk-forward-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'kk-forward-overlay';
  overlay.className = 'kk-forward-overlay';
  overlay.innerHTML = `
    <div class="kk-forward-modal" role="dialog" aria-label="Reenviar mensaje">
      <div class="kk-forward-head">
        <span>Reenviar a…</span>
        <button type="button" class="kk-reply-bar-cancel" data-close aria-label="Cerrar">✕</button>
      </div>
      <div class="kk-forward-list">
        ${contacts.map(c => `
          <div class="kk-chat-item" data-pick="${String(c.id || '')}">
            <div class="kk-chat-item-avatar-wrap">
              <div class="kk-chat-item-avatar bg-slate-100 text-slate-500">
                ${c.avatar ? `<img src="${_fwdEsc(c.avatar)}" alt="">` : `<span>${(c.name || '?').charAt(0).toUpperCase()}</span>`}
              </div>
            </div>
            <div class="kk-chat-item-body">
              <div class="kk-chat-item-top"><span class="kk-chat-item-name">${_fwdEsc(c.name || 'Usuario')}</span></div>
            </div>
          </div>`).join('')}
      </div>
      <div class="kk-forward-foot">
        <button type="button" class="kk-forward-cancel" data-close>Cancelar</button>
      </div>
    </div>`;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) { overlay.remove(); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const contact = contacts.find(c => String(c.id) === pick.dataset.pick);
      overlay.remove();
      if (contact) {
        Promise.resolve(onPick?.(contact)).then(() => _toast('Mensaje reenviado')).catch(() => {});
      }
    }
  });

  document.body.appendChild(overlay);
}

function _fwdEsc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Delegación de eventos sobre el contenedor de mensajes.
 * Idempotente: puede llamarse en cada render sin duplicar listeners.
 */
export function bindMessageActions(container, opts) {
  if (!container || container._kkActionsBound) return;
  container._kkActionsBound = true;

  let pressTimer = null;
  let pressedRow = null;

  const findMsgRow = (target) => target?.closest?.('.kk-msg-row');

  const getMsgFromRow = (row) => {
    if (!row || !row.id || !row.id.startsWith('msg-')) return null;
    const id = row.id.slice(4);
    return {
      id,
      sender_id: row.dataset.sender || '',
      content: row.querySelector('.kk-msg-text')?.textContent || '',
      created_at: row.dataset.ts ? new Date(Number(row.dataset.ts)).toISOString() : null,
      deleted_at: row.classList.contains('is-deleted') ? true : null
    };
  };

  const openFor = (row, x, y) => {
    const msg = getMsgFromRow(row);
    if (!msg) return;
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
    _openSheet(row, msg, opts);
  };

  // Long-press táctil
  container.addEventListener('touchstart', (e) => {
    const row = findMsgRow(e.target);
    if (!row) return;
    pressedRow = row;
    pressTimer = setTimeout(() => openFor(row), LONG_PRESS_MS);
  }, { passive: true });

  const cancelPress = () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressedRow = null;
  };
  container.addEventListener('touchend', cancelPress, { passive: true });
  container.addEventListener('touchmove', cancelPress, { passive: true });
  container.addEventListener('touchcancel', cancelPress, { passive: true });

  // Clic derecho (escritorio)
  container.addEventListener('contextmenu', (e) => {
    const row = findMsgRow(e.target);
    if (!row) return;
    e.preventDefault();
    openFor(row);
  });
}
