import { ChatModule } from '/js/shared/chat.js';
import { ScrollModule } from '/js/shared/scroll.module.js';
import { AppState } from '../state.js';
import { safeToast, safeEscapeHTML } from './ui.js';

let activeChatUserId = null;
let activeConversationId = null;
let _topScrollDestroy = null;

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
            // Guardar en parentProfiles para el loop principal
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
        // Lo mostramos para que la maestra sepa quién es, aunque el chat sea limitado
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

    container.innerHTML = allContacts.map(c => {
      const unread = unreadMap[c.id] || 0;
      // Para padres: título = nombre del estudiante, subtítulo = nombre del padre
      const displayName = c.childName ? c.childName : (c.name || 'Usuario');
      const parentLine  = c.childName ? ` ${safeEscapeHTML(c.name)}` : null;
      const label       = c.childName ? `${c.roleLabel}  ${safeEscapeHTML(c.name)}` : c.roleLabel;
      const bgColor = c.roleLabel === 'Directora' ? 'bg-indigo-100 text-indigo-600' :
                      c.roleLabel === 'Asistente' ? 'bg-teal-100 text-teal-600' :
                      c.unlinked ? 'bg-slate-100 text-slate-400' :
                      'bg-orange-100 text-orange-600';
      
      const onClickAction = c.unlinked 
        ? `safeToast('Este padre aún no ha creado su cuenta de acceso', 'warning')`
        : `App.selectChatContact('${c.id}', '${safeEscapeHTML(displayName)}', '${safeEscapeHTML(label)}')`;

      return `
      <div onclick="${onClickAction}"
           class="p-3 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors flex items-center gap-3 border-b border-slate-50 last:border-0 relative ${c.unlinked ? 'opacity-60' : ''}">
        <div class="relative">
          <div class="w-10 h-10 rounded-full ${bgColor} flex items-center justify-center font-bold overflow-hidden">
            ${c.avatar ? `<img src="${c.avatar}" class="w-full h-full object-cover" loading="lazy">` : displayName.charAt(0)}
          </div>
          ${unread > 0 ? `<div class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm animate-pulse">${unread}</div>` : ''}
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-bold text-slate-700 text-sm truncate">${safeEscapeHTML(displayName)}</div>
          ${parentLine ? `<div class="text-[10px] ${c.unlinked ? 'text-slate-400' : 'text-orange-600'} font-bold truncate">${parentLine}</div>` : ''}
          <div class="text-[10px] text-slate-400 truncate">${c.childName ? c.roleLabel : label}</div>
        </div>
        ${c.unlinked ? `<i data-lucide="user-minus" class="w-3.5 h-3.5 text-slate-300"></i>` : `<i data-lucide="chevron-right" class="w-3.5 h-3.5 text-slate-200"></i>`}
      </div>`;
    }).join('');

    // Buscador con debounce via ScrollModule
    const searchInput = document.getElementById('chatSearchInput');
    if (searchInput && !searchInput._chatBound) {
      searchInput._chatBound = true;
      const handler = ScrollModule.debounce((e) => {
        const q = e.target.value.toLowerCase().trim();
        container.querySelectorAll('[onclick*="selectChatContact"]').forEach(el => {
          const name = el.querySelector('.font-bold')?.textContent?.toLowerCase() || '';
          const meta = el.querySelector('.text-\\[10px\\]')?.textContent?.toLowerCase() || '';
          el.style.display = (!q || name.includes(q) || meta.includes(q)) ? '' : 'none';
        });
      }, 250);
      searchInput.addEventListener('input', handler);
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

  } catch (_) {
    /* silencioso */
  }
}

export async function selectChatContact(userId, name, meta) {
  activeChatUserId = userId;
  activeConversationId = null;

  // Destruir top-scroll anterior
  _topScrollDestroy?.();
  _topScrollDestroy = null;

  // Reset paginación para este contacto
  ChatModule.resetPagination(null); // se reseteará al cargar

  // Mobile: hide list, show conversation
  const listPanel = document.getElementById('chatListPanel');
  const convPanel = document.getElementById('chatConversationPanel');
  if (listPanel && convPanel) {
    listPanel.classList.add('chat-hidden');
    convPanel.classList.remove('chat-hidden');
    convPanel.classList.add('flex');
  }

  const header = document.getElementById('chatActiveHeader');
  if (header) { header.classList.remove('hidden'); header.classList.add('flex'); }

  const nameEl = document.getElementById('chatActiveName');
  if (nameEl) nameEl.textContent = name;
  const metaEl = document.getElementById('chatActiveMeta');
  if (metaEl) metaEl.textContent = meta;
  const avatarEl = document.getElementById('chatActiveAvatar');
  if (avatarEl) avatarEl.innerHTML = name.charAt(0);

  const inputArea = document.getElementById('chatInputArea');
  if (inputArea) inputArea.classList.remove('hidden');

  const messagesContainer = document.getElementById('chatMessagesContainer');
  if (messagesContainer) {
    messagesContainer.innerHTML = '<div class="flex justify-center p-4"><div class="animate-spin w-6 h-6 border-2 border-orange-500 rounded-full border-t-transparent"></div></div>';
  }

  await loadChatMessages(userId, false);

  // Back button
  const backBtn = document.getElementById('chatBackBtn');
  if (backBtn) {
    const newBackBtn = backBtn.cloneNode(true);
    backBtn.parentNode.replaceChild(newBackBtn, backBtn);
    newBackBtn.addEventListener('click', () => {
      if (listPanel && convPanel) {
        convPanel.classList.add('chat-hidden');
        convPanel.classList.remove('flex');
        listPanel.classList.remove('chat-hidden');
      }
    });
  }
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

    if (!messages.length && !loadMore) {
      container.innerHTML = '<div class="text-center text-xs text-slate-400 mt-4 italic">Inicio de la conversación. Di hola 👋</div>';
      return;
    }

    if (loadMore) {
      // Insertar mensajes anteriores al principio
      _prependMessages(messages, user.id, container);
    } else {
      renderMessages(messages, user.id, container);
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

function _msgBubble(m, myId) {
  const isMe = m.sender_id === myId;
  return `<div class="flex ${isMe ? 'justify-end' : 'justify-start'} mb-2">
    <div class="max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${isMe
      ? 'bg-orange-600 text-white rounded-br-none shadow-md shadow-orange-100'
      : 'bg-white border border-slate-100 text-slate-700 rounded-bl-none shadow-sm'}">
      ${safeEscapeHTML(m.content)}
    </div>
  </div>`;
}

function renderMessages(messages, myId, container) {
  if (!messages.length) return;
  container.innerHTML = messages.map(m => _msgBubble(m, myId)).join('');
}

function _prependMessages(messages, myId, container) {
  if (!messages.length) return;
  const frag = document.createDocumentFragment();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = messages.map(m => _msgBubble(m, myId)).join('');
  while (wrapper.firstChild) frag.appendChild(wrapper.firstChild);
  container.insertBefore(frag, container.firstChild);
}

async function sendChatMessage() {
  if (!activeChatUserId) return;
  const input = document.getElementById('chatMessageInput');
  const text = input?.value.trim();
  if (!text) return;

  const user = AppState.get('user');
  input.value = '';
  input.disabled = true;

  // Optimistic append
  const container = document.getElementById('chatMessagesContainer');
  if (container) {
    container.insertAdjacentHTML('beforeend', _msgBubble({ sender_id: user.id, content: text }, user.id));
    ScrollModule.scrollToBottom(container, true);
  }

  try {
    const { conversationId } = await ChatModule.sendMessage(
      user.id, activeChatUserId, text, activeConversationId
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

function subscribeToChat(conversationId) {
  if (!conversationId) return;
  const user = AppState.get('user');
  
  ChatModule.subscribeToConversation(conversationId, 
    (newMsg) => {
      if (newMsg.sender_id === user?.id) return; // ya está en UI (optimistic)
      const container = document.getElementById('chatMessagesContainer');
      if (container) {
        container.insertAdjacentHTML('beforeend', _msgBubble(newMsg, user?.id));
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
    }
  );

  // Escuchar input para broadcast
  const input = document.getElementById('chatMessageInput');
  let typingTimeout;
  input?.addEventListener('input', () => {
    ChatModule.broadcastTyping(conversationId, user.name, true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      ChatModule.broadcastTyping(conversationId, user.name, false);
    }, 3000);
  });
}
