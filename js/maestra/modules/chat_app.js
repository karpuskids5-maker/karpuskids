import { ChatModule } from '/js/shared/chat.js';
import { ScrollModule } from '/js/shared/scroll.module.js';
import { ChatView, ChatListState } from '/js/shared/chat-view.js';
import {
  buildThreadHTML, prependThreadHTML, appendLiveMessage,
  waBubbleHTML, unreadBadgeHTML, chatListItemHTML,
  reactionChipsHTML
} from '/js/shared/chat-render.js';
import {
  bindMessageActions, closeMessageActions,
  showReplyBar, hideReplyBar, openForwardModal, markRowDeleted
} from '/js/shared/chat-actions.js';
import { AppState } from '../state.js';
import { safeToast, safeEscapeHTML } from './ui.js';

let activeChatUserId = null;
let activeConversationId = null;
let _topScrollDestroy = null;
let _pendingReply = null;      // respuesta citada pendiente: { id, senderName, content }
let _lastPreviews = {};        // vista previa del último mensaje por contacto

// ✅ Caché de contactos para el banner global y aperturas por ID
const _contactsCache = new Map();

const _LIST_STATE_KEY = 'maestra';

/** Aplica/actualiza los puntos de presencia en la lista */
function _renderPresenceDots(onlineSet) {
  document.querySelectorAll('#chatContactsList [data-contact-id]').forEach(el => {
    const dot = el.querySelector('.kk-online-dot');
    if (dot) dot.classList.toggle('is-online', onlineSet.has(el.dataset.contactId));
  });
  // Estado "● En línea" del header si hay chat abierto
  if (activeChatUserId) _updateHeaderStatus(activeChatUserId);
}

/** Actualiza el estado "● En línea" del header del chat activo */
function _updateHeaderStatus(userId) {
  const metaEl = document.getElementById('chatActiveMeta');
  if (!metaEl) return;
  const base = metaEl.dataset.baseMeta || metaEl.textContent || '';
  metaEl.dataset.baseMeta = base;
  const online = ChatModule.getOnlineUsers().has(userId);
  metaEl.innerHTML = `<span class="kk-header-status ${online ? 'is-online' : ''}">
    <span class="kk-status-dot"></span>${online ? 'En línea' : _escAttr(base)}</span>`;
}

function _escAttr(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Renderiza la lista de conversaciones (filas estilo WhatsApp) */
function _renderChatList(container, contacts, unreadMap) {
  container.innerHTML = contacts.map(c => {
    const unread = unreadMap[c.id] || 0;
    const preview = c.id ? (_lastPreviews[c.id] || null) : null;
    const online = c.id ? ChatModule.getOnlineUsers().has(c.id) : false;

    // Para padres: título = nombre del estudiante, subtítulo = nombre del padre
    const displayName = c.childName ? c.childName : (c.name || 'Usuario');
    const sub = c.childName ? `${c.roleLabel} ${c.name}` : (c.roleLabel || '');
    const bgColor = c.roleLabel === 'Directora' ? 'bg-indigo-100 text-indigo-600' :
                    c.roleLabel === 'Asistente' ? 'bg-teal-100 text-teal-600' :
                    c.unlinked ? 'bg-slate-100 text-slate-400' :
                    'bg-orange-100 text-orange-600';

    return chatListItemHTML({
      c: { id: c.id, name: displayName, avatar: c.avatar },
      unread,
      lastMsg: preview,
      online,
      sub,
      avatarBg: bgColor,
      disabled: !!c.unlinked,
      extraAttr: `data-user-id="${c.id || ''}" data-role-kind="${(c.roleLabel || '').toLowerCase().includes('padre') ? 'padre' : 'staff'}" data-unread="${unread > 0 ? 1 : 0}"`
    });
  }).join('');

  // Delegación de clic (una sola vez)
  if (!container._kkClickBound) {
    container._kkClickBound = true;
    container.addEventListener('click', (e) => {
      const row = e.target.closest('.kk-chat-item');
      if (!row || row.classList.contains('is-disabled')) {
        if (row?.classList.contains('is-disabled')) safeToast('Este padre aún no ha creado su cuenta de acceso', 'warning');
        return;
      }
      const id = row.dataset.userId;
      const meta = _contactsCache.get(id);
      if (!meta) return;
      const displayName = meta.childName ? meta.childName : (meta.name || 'Usuario');
      const label = meta.childName ? `${meta.roleLabel} ${meta.name}` : (meta.roleLabel || '');
      window.App?.selectChatContact
        ? App.selectChatContact(meta.id, encodeURIComponent(displayName), encodeURIComponent(label))
        : selectChatContact(meta.id, displayName, label);
    });
  }
}

export function isActiveChatOpen(msg) {
  return !!activeConversationId && msg?.conversation_id === activeConversationId;
}

/**
 * Abre el chat con un usuario aunque no esté en la lista cargada
 * (usado por el banner de mensajes entrantes)
 */
export async function openChatWithUser(userId) {
  if (!userId) return;
  let meta = _contactsCache.get(userId);
  if (!meta) {
    try {
      const { supabase: sb } = await import('../../shared/supabase.js');
      const { data: p } = await sb.from('profiles')
        .select('id, name, role, avatar_url').eq('id', userId).maybeSingle();
      if (p) {
        meta = {
          id: p.id, name: p.name || 'Usuario', childName: null,
          avatar: p.avatar_url || null,
          roleLabel: p.role === 'directora' ? 'Directora' : p.role === 'asistente' ? 'Asistente' : 'Padre/Madre'
        };
      }
    } catch (_) { /* silencioso */ }
  }
  if (!meta) return;
  await selectChatContact(
    meta.id,
    encodeURIComponent(meta.childName || meta.name),
    encodeURIComponent(meta.childName ? `${meta.roleLabel} ${meta.name}` : meta.roleLabel)
  );
}

export async function initChat() {
  const container = document.getElementById('chatContactsList');
  if (!container) return;

  try {
    // Carga paralela de datos iniciales
    const [unreadMap, user] = await Promise.all([
      ChatModule.getUnreadCounts(),
      AppState.get('user')
    ]);

    let students = AppState.get('students') || [];

    // Si no hay estudiantes en AppState, cargarlos directamente
    if (!students.length) {
      const classroom = AppState.get('classroom');
      if (classroom?.id) {
        try {
          const { MaestraApi } = await import('../api.js');
          students = await MaestraApi.getStudentsByClassroom(classroom.id);
          if (students.length) AppState.set('students', students);
        } catch (_) {}
      }
    }

    // Build parent contacts from students — fetch parent names from profiles
    const parentsMap = new Map();
    const parentIds = students.filter(s => s.parent_id).map(s => s.parent_id);

    // Fetch parent profile names if we have parent_ids
    let parentProfiles = {};
    if (parentIds.length > 0) {
      try {
        const { supabase: sb } = await import('../../shared/supabase.js');
        const { data: profiles } = await sb
          .from('profiles')
          .select('id, name, avatar_url')
          .in('id', parentIds);
        (profiles || []).forEach(p => { parentProfiles[p.id] = p; });
      } catch (_) {}
    }

    // Also fetch parents by p1_email for students without parent_id
    const studentsWithoutParent = students.filter(s => !s.parent_id && s.p1_email);
    if (studentsWithoutParent.length > 0) {
      try {
        const { supabase: sb } = await import('../../shared/supabase.js');
        const emails = studentsWithoutParent.map(s => s.p1_email).filter(Boolean);
        const { data: profilesByEmail } = await sb
          .from('profiles')
          .select('id, name, avatar_url, email')
          .in('email', emails);

        // Map email → profile for lookup
        const emailMap = {};
        (profilesByEmail || []).forEach(p => {
          if (p.email) emailMap[p.email.toLowerCase()] = p;
        });

        // Add these as virtual parent_id entries on the student objects
        studentsWithoutParent.forEach(s => {
          const prof = emailMap[s.p1_email.toLowerCase()];
          if (prof) {
            s._resolvedParentId = prof.id;
            parentProfiles[prof.id] = prof;
          }
        });
      } catch (_) {}
    }

    students.forEach(s => {
      const pid = s.parent_id || s._resolvedParentId;
      if (pid) {
        const profile = parentProfiles[pid];
        const displayName = profile?.name || s.p1_name || `Padre de ${s.name}`;
        if (!parentsMap.has(pid)) {
          parentsMap.set(pid, {
            id: pid,
            name: displayName,
            childName: s.name,
            avatar: profile?.avatar_url || null,
            roleLabel: 'Padre/Madre'
          });
        } else {
          const p = parentsMap.get(pid);
          if (!p.childName.includes(s.name)) {
            p.childName += `, ${s.name}`;
          }
        }
      } else if (s.p1_name) {
        // Estudiante con nombre de padre pero sin cuenta de perfil vinculada aún
        const virtualId = `unlinked_${s.id}`;
        parentsMap.set(virtualId, {
          id: null, // No se puede chatear sin ID de perfil
          name: s.p1_name,
          childName: s.name,
          avatar: null,
          roleLabel: 'Padre (Sin Cuenta)',
          unlinked: true
        });
      }
    });

    // Load directora and asistente profiles
    const { data: staff } = await import('../../shared/supabase.js').then(m =>
      m.supabase.from('profiles')
        .select('id, name, avatar_url, role')
        .in('role', ['directora', 'asistente'])
        .neq('id', user?.id || '')
        .order('name')
    );

    const staffContacts = (staff || []).map(s => ({
      id: s.id, name: s.name || s.role, childName: null,
      avatar: s.avatar_url || null,
      roleLabel: s.role === 'directora' ? 'Directora' : 'Asistente'
    }));

    const allContacts = [...staffContacts, ...Array.from(parentsMap.values())];

    if (!allContacts.length) {
      container.innerHTML = '<div class="p-4 text-center text-slate-400 text-sm">No hay contactos disponibles.</div>';
      return;
    }

    // ✅ Contactos con mensajes sin leer primero + caché para el banner
    allContacts.forEach(c => { if (c.id) _contactsCache.set(c.id, c); });

    // ✅ Vista previa del último mensaje + presencia global (en paralelo)
    const contactIds = allContacts.filter(c => c.id).map(c => c.id);
    const [previews] = await Promise.all([
      ChatModule.getLastMessagePreviews(contactIds),
      Promise.resolve(ChatModule.subscribeGlobalPresence(online => _renderPresenceDots(online)))
    ]);
    _lastPreviews = previews;

    // Orden: último mensaje más reciente primero; sin mensajes → por no leídos
    const sorted = [...allContacts].sort((a, b) => {
      const ta = previews[a.id]?.created_at ? new Date(previews[a.id].created_at).getTime() : 0;
      const tb = previews[b.id]?.created_at ? new Date(previews[b.id].created_at).getTime() : 0;
      if (ta !== tb) return tb - ta;
      return (unreadMap[b.id] || 0) - (unreadMap[a.id] || 0);
    });

    _renderChatList(container, sorted, unreadMap);

    // Buscador con debounce via ScrollModule (antes de restaurar estado)
    const searchInput = document.getElementById('chatSearchInput');
    if (searchInput && !searchInput._chatBound) {
      searchInput._chatBound = true;
      const handler = ScrollModule.debounce((e) => {
        const q = e.target.value.toLowerCase().trim();
        container.querySelectorAll('.kk-chat-item').forEach(el => {
          el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? '' : 'none';
        });
      }, 250);
      searchInput.addEventListener('input', handler);
    }

    // Chat filter chips
    const filterChips = document.querySelectorAll('.chatFilterChip');
    filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        filterChips.forEach(c => { c.classList.remove('bg-orange-100', 'text-orange-700'); c.classList.add('bg-slate-100', 'text-slate-500'); });
        chip.classList.remove('bg-slate-100', 'text-slate-500');
        chip.classList.add('bg-orange-100', 'text-orange-700');
        const filter = chip.dataset.filter;
        container.querySelectorAll('.kk-chat-item').forEach(el => {
          const role = el.dataset.roleKind || '';
          const hasUnread = el.dataset.unread === '1';
          let show = true;
          if (filter === 'unread') show = hasUnread;
          else if (filter === 'parents') show = role === 'padre';
          else if (filter === 'staff') show = role === 'staff';
          el.style.display = show ? '' : 'none';
        });
      });
    });

    // ✅ Restaurar búsqueda / filtro / scroll preservados (experiencia PWA)
    ChatListState.restoreUI(_LIST_STATE_KEY, {
      searchEl: searchInput,
      filterSelector: '#chatFilterChips'
    });
    const saved = ChatListState.load(_LIST_STATE_KEY);
    if (saved.scrollTop) requestAnimationFrame(() => { container.scrollTop = saved.scrollTop; });

    // Guardar estado al hacer scroll (throttle suave)
    if (!container._kkScrollSave) {
      container._kkScrollSave = true;
      let tSave = null;
      container.addEventListener('scroll', () => {
        clearTimeout(tSave);
        tSave = setTimeout(() => ChatListState.save(_LIST_STATE_KEY, {
          ...ChatListState.load(_LIST_STATE_KEY),
          scrollTop: container.scrollTop
        }), 300);
      }, { passive: true });
    }

    // Wire send button — clone to remove old listeners
    const btnSend = document.getElementById('btnSendChatMessage');
    const inputMsg = document.getElementById('chatMessageInput');
    if (btnSend && inputMsg) {
      const newBtn = btnSend.cloneNode(true);
      btnSend.parentNode.replaceChild(newBtn, btnSend);
      newBtn.addEventListener('click', () => sendChatMessage());
      inputMsg.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
      });
    }

    // ✅ BOTÓN ATRÁS — móvil y escritorio, una sola vez
    const backBtn = document.getElementById('chatBackBtn');
    if (backBtn && !backBtn._kkBound) {
      backBtn._kkBound = true;
      backBtn.addEventListener('click', () => ChatView.back());
    }

  } catch (_) {
    /* silencioso */
  }
}

/** Restaura la vista inicial (placeholder) tras cerrar una conversación */
function closeConversationUI() {
  activeChatUserId = null;
  activeConversationId = null;
  ChatModule.unsubscribe();
  closeMessageActions();
  hideReplyBar();
  _pendingReply = null;

  const header = document.getElementById('chatActiveHeader');
  const inputArea = document.getElementById('chatInputArea');
  const messagesContainer = document.getElementById('chatMessagesContainer');
  const typingEl = document.getElementById('chatTypingIndicator');

  if (header) header.style.display = 'none';
  if (inputArea) inputArea.style.display = 'none';
  if (typingEl) typingEl.classList.add('hidden');

  if (messagesContainer) {
    messagesContainer.classList.add('wa-wallpaper');
    messagesContainer.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-40 py-12">
        <i data-lucide="messages-square" class="w-14 h-14 mb-3"></i>
        <p class="font-medium text-sm">Selecciona un chat</p>
      </div>`;
    if (window.lucide) lucide.createIcons();
  }

  _topScrollDestroy?.();
  _topScrollDestroy = null;
}

export async function selectChatContact(userId, name, meta) {
  try { name = decodeURIComponent(name || ''); } catch (_) {}
  try { meta = decodeURIComponent(meta || ''); } catch (_) {}

  // ✅ VISTA MÓVIL/DESKTOP + HISTORIAL (botón atrás sin recargar)
  const listPanel = document.getElementById('chatListPanel');
  const convPanel = document.getElementById('chatConversationPanel');
  ChatView.open({
    apply: () => {
      if (listPanel) listPanel.style.display = 'none';
      if (convPanel) convPanel.style.display = 'flex';
    },
    revert: () => {
      if (convPanel) convPanel.style.display = '';
      if (listPanel) listPanel.style.display = '';
      closeConversationUI();
    }
  });

  activeChatUserId = userId;
  activeConversationId = null;

  // Office hours banner
  const officeEl = document.getElementById('chatOfficeHours');
  if (officeEl) {
    const now = new Date();
    const h = now.getHours();
    const isWorkHours = h >= 8 && h < 16;
    const days = now.getDay();
    const isWorkDay = days >= 1 && days <= 5;
    const span = officeEl.querySelector('span');
    if (!isWorkDay || !isWorkHours) {
      officeEl.classList.remove('hidden');
      if (span) span.textContent = `🕐 Fuera de horario laboral (L-V 8:00–16:00). El mensaje se enviará al volver.`;
      officeEl.className = 'px-4 py-2 bg-amber-50 border-b border-amber-100 text-center';
      if (span) span.className = 'text-[10px] font-bold text-amber-600';
    } else {
      officeEl.classList.remove('hidden');
      if (span) span.textContent = `✅ Horario activo — Responderé lo antes posible`;
      officeEl.className = 'px-4 py-2 bg-teal-50 border-b border-teal-100 text-center';
      if (span) span.className = 'text-[10px] font-bold text-teal-600';
    }
  }

  // Destruir top-scroll anterior
  _topScrollDestroy?.();
  _topScrollDestroy = null;

  // Reset paginación para este contacto
  ChatModule.resetPagination(null);

  // Header (estilos inline: inmune al orden del Tailwind compilado)
  const header = document.getElementById('chatActiveHeader');
  const inputArea = document.getElementById('chatInputArea');
  if (header) header.style.display = 'flex';
  if (inputArea) inputArea.style.display = '';

  const nameEl = document.getElementById('chatActiveName');
  if (nameEl) nameEl.textContent = name;
  const metaEl = document.getElementById('chatActiveMeta');
  if (metaEl) {
    metaEl.textContent = meta;
    metaEl.dataset.baseMeta = meta;
    _updateHeaderStatus(userId);
  }
  const avatarEl = document.getElementById('chatActiveAvatar');
  if (avatarEl) {
    const contact = _contactsCache.get(userId);
    avatarEl.innerHTML = contact?.avatar
      ? `<img src="${_escAttr(contact.avatar)}" class="w-full h-full object-cover">`
      : name.charAt(0);
  }

  // ✅ Limpiar badge de no leídos del contacto abierto
  document.querySelector(`#chatContactsList [data-user-id="${userId}"] .kk-unread-badge`)?.remove();

  // ✅ Limpiar respuesta pendiente anterior
  hideReplyBar();
  _pendingReply = null;

  const messagesContainer = document.getElementById('chatMessagesContainer');
  if (messagesContainer) {
    messagesContainer.innerHTML = '<div class="flex justify-center p-4"><div class="animate-spin w-6 h-6 border-2 border-orange-500 rounded-full border-t-transparent"></div></div>';

    // ✅ Acciones de mensaje: mantener presionado / clic derecho
    bindMessageActions(messagesContainer, {
      myId: AppState.get('user')?.id,
      onReply: (msg) => {
        const senderName = msg.sender_id === AppState.get('user')?.id
          ? 'ti' : (_contactsCache.get(activeChatUserId)?.name || 'Contacto');
        _pendingReply = { id: msg.id, senderName, content: msg.content };
        showReplyBar(document.getElementById('chatInputArea'), { senderName, content: msg.content }, () => { _pendingReply = null; });
      },
      onForward: (msg) => {
        const targets = [..._contactsCache.values()].filter(c => c.id && !c.unlinked);
        openForwardModal(targets, async (contact) => {
          await ChatModule.sendMessage(AppState.get('user')?.id, contact.id, msg.content);
        });
      },
      onReact: async (msgId, emoji) => ChatModule.toggleReaction(msgId, emoji),
      onDelete: async (msgId) => ChatModule.deleteMessage(msgId)
    });
  }

  await loadChatMessages(userId, false);
}

/**
 * Carga mensajes — primera carga o "cargar más" (scroll arriba)
 */
async function loadChatMessages(otherUserId, loadMore = false) {
  const user = AppState.get('user');
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;

  try {
    const { messages, conversationId, hasMore } = await ChatModule.loadConversation(
      otherUserId,
      activeConversationId,
      loadMore
    );

    if (!activeConversationId && conversationId) {
      activeConversationId = conversationId;
      subscribeToChat(activeConversationId);
      ChatModule.markAsRead(activeConversationId);
    }

    _resolveReplyPreviews(messages);

    if (!messages.length && !loadMore) {
      container.classList.add('wa-wallpaper');
      container.innerHTML = '<div class="text-center text-xs text-slate-400 mt-4 italic">Inicio de la conversación. Di hola 👋</div>';
      return;
    }

    if (loadMore) {
      prependThreadHTML(container, messages, (m) => _msgBubble(m, user?.id));
    } else {
      renderMessages(messages, user?.id, container);
      ScrollModule.scrollToBottom(container);
      // Activar top-scroll para cargar más
      if (hasMore !== false) {
        const { destroy } = ScrollModule.topScroll({
          container,
          loadFn: () => loadChatMessages(otherUserId, true)
        });
        _topScrollDestroy = destroy;
      }
    }

    subscribeToChat(activeConversationId);

  } catch (_) {
    if (!loadMore) container.innerHTML = '<div class="text-center text-xs text-red-400 mt-4">Error cargando mensajes.</div>';
  }
}

/** Resuelve las citas de respuesta contra los mensajes ya cargados */
function _resolveReplyPreviews(messages) {
  if (!messages?.length) return;
  const byId = new Map(messages.filter(m => m.id).map(m => [String(m.id), m]));
  messages.forEach(m => {
    if (m.reply_to && !m._replyPreview) {
      const src = byId.get(String(m.reply_to));
      if (src) m._replyPreview = { sender_name: src.sender_name || '', content: src.content || '' };
    }
  });
}

function _msgBubble(m, myId) {
  const isMe = m.sender_id === myId;
  const contact = !isMe && activeChatUserId ? _contactsCache.get(activeChatUserId) : null;
  const profile = AppState.get('profile');
  const senderName = isMe ? (profile?.name || '') : (m.sender_name || contact?.name || 'Contacto');
  const avatarUrl = isMe ? (profile?.avatar_url || null) : (m.sender_avatar || contact?.avatar || null);

  return waBubbleHTML({
    m, myId,
    senderName,
    avatarUrl,
    showName: true,
    showAvatar: true
  });
}

function renderMessages(messages, myId, container) {
  if (!messages.length) return;
  container.classList.add('wa-wallpaper');
  container.innerHTML = buildThreadHTML(messages, (m) => _msgBubble(m, myId));
}

async function sendChatMessage() {
  if (!activeChatUserId) return;
  const input = document.getElementById('chatMessageInput');
  const text = input?.value.trim();
  if (!text) return;

  const user = AppState.get('user');
  const reply = _pendingReply;
  input.value = '';
  input.disabled = true;
  hideReplyBar();
  _pendingReply = null;

  // Optimistic append (con cita si es respuesta)
  const container = document.getElementById('chatMessagesContainer');
  if (container) {
    container.insertAdjacentHTML('beforeend', _msgBubble({
      sender_id: user?.id, content: text,
      _replyPreview: reply ? { sender_name: reply.senderName, content: reply.content } : null
    }, user?.id));
    ScrollModule.scrollToBottom(container, true);
  }

  try {
    const { conversationId } = await ChatModule.sendMessage(
      user?.id, activeChatUserId, text, activeConversationId, reply?.id || null
    );
    if (!activeConversationId && conversationId) {
      activeConversationId = conversationId;
      subscribeToChat(activeConversationId);
    }
  } catch (err) {

    safeToast('Error al enviar mensaje', 'error');
    // Revertir optimistic
    container?.lastElementChild?.remove();
  } finally {
    input.disabled = false;
    input.focus();
  }
}

/** Aplica reacciones/eliminado recibidos por realtime a una burbuja del DOM */
function _applyMsgUpdate(msg, myId) {
  const row = document.getElementById(`msg-${msg.id}`);
  if (!row) return;
  const bubble = row.querySelector('.kk-msg-bubble');
  if (!bubble) return;

  if (msg.deleted_at && !row.classList.contains('is-deleted')) {
    markRowDeleted(row);
    row.classList.add('is-deleted');
    return;
  }

  bubble.querySelector('.kk-reaction-chips')?.remove();
  if (msg.reactions && Object.keys(msg.reactions).length) {
    bubble.insertAdjacentHTML('beforeend', reactionChipsHTML(msg.reactions, myId));
  }
}

function subscribeToChat(conversationId) {
  if (!conversationId) return;
  const user = AppState.get('user');

  ChatModule.subscribeToConversation(conversationId,
    (newMsg) => {
      if (newMsg.sender_id === user?.id) return; // ya está en UI (optimistic)
      const container = document.getElementById('chatMessagesContainer');
      if (container) {
        appendLiveMessage(container, newMsg, (m) => _msgBubble(m, user?.id));
        ScrollModule.scrollToBottom(container, true);
      }
    },
    (typingData) => {
      // ✅ TYPING INDICATOR
      const typingEl = document.getElementById('chatTypingIndicator');
      if (!typingEl) return;

      if (typingData.isTyping && typingData.userName !== user.name) {
        typingEl.textContent = `${typingData.userName} está escribiendo...`;
        typingEl.classList.remove('hidden');
      } else {
        typingEl.classList.add('hidden');
      }
    },
    null,
    (receipt) => {
      // ✅ READ RECEIPTS (✓ → ✓✓) en tiempo real
      if (!receipt?.id || !receipt.is_read) return;
      const msgEl = document.getElementById(`msg-${receipt.id}`);
      const checks = msgEl?.querySelector('.kk-checks');
      if (checks) { checks.textContent = '✓✓'; checks.classList.add('is-read'); }
    },
    (updated) => {
      // ✅ REACCIONES / ELIMINADOS en tiempo real
      if (updated?.id) _applyMsgUpdate(updated, user?.id);
    }
  );

  // Escuchar input para broadcast
  const input = document.getElementById('chatMessageInput');
  let typingTimeout;

  // Remover listener previo para evitar leak
  if (input && input._typingHandler) input.removeEventListener('input', input._typingHandler);
  const handler = () => {
    ChatModule.broadcastTyping(conversationId, user.name, true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      ChatModule.broadcastTyping(conversationId, user.name, false);
    }, 3000);
  };
  input?.addEventListener('input', handler);
  if (input) input._typingHandler = handler;
}
