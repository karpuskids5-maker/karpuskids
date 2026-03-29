import { ChatModule } from '../../shared/chat.js';
import { AppState } from '../state.js';
import { safeToast, safeEscapeHTML } from './ui.js';

let activeChatUserId = null;
let activeConversationId = null;

export async function initChat() {
  const container = document.getElementById('chatContactsList');
  if (!container) return;

  try {
    const unreadMap = await ChatModule.getUnreadCounts();
    const students = AppState.get('students') || [];
    const parentsMap = new Map();
    
    students.forEach(s => {
      if (s.parent_id) {
        if (!parentsMap.has(s.parent_id)) {
          parentsMap.set(s.parent_id, {
            id: s.parent_id,
            name: s.name,
            childName: s.name,
            avatar: s.avatar_url || null
          });
        } else {
          const p = parentsMap.get(s.parent_id);
          if (!p.childName.includes(s.name)) {
            p.childName += `, ${s.name}`;
          }
        }
      }
    });

    const contacts = Array.from(parentsMap.values());

    if (contacts.length === 0) {
      container.innerHTML = `<div class="p-4 text-center text-slate-400 text-sm">No hay padres registrados aún.</div>`;
      return;
    }

    container.innerHTML = contacts.map(c => {
      const unread = unreadMap[c.id] || 0;
      return `
      <div onclick="App.selectChatContact('${c.id}', '${safeEscapeHTML(c.name)}', '${safeEscapeHTML(c.childName)}')" 
           class="p-3 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors flex items-center gap-3 border-b border-slate-50 last:border-0 relative">
        <div class="relative">
          <div class="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
            ${c.name.charAt(0)}
          </div>
          ${unread > 0 ? `<div class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm animate-pulse">${unread}</div>` : ''}
        </div>
        <div class="min-w-0">
          <div class="font-bold text-slate-700 text-sm truncate">${safeEscapeHTML(c.name)}</div>
          <div class="text-[10px] text-slate-400 truncate">Hijo/a: ${safeEscapeHTML(c.childName)}</div>
        </div>
      </div>
    `}).join('');

    const btnSend = document.getElementById('btnSendChatMessage');
    const inputMsg = document.getElementById('chatMessageInput');
    
    if (btnSend && inputMsg) {
      const newBtn = btnSend.cloneNode(true);
      btnSend.parentNode.replaceChild(newBtn, btnSend);
      
      newBtn.addEventListener('click', () => sendChatMessage());
      inputMsg.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage();
        }
      });
    }

  } catch (err) {
    console.error('Error initChat:', err);
  }
}

export async function selectChatContact(userId, name, meta) {
  activeChatUserId = userId;
  activeConversationId = null;
  
  const header = document.getElementById('chatActiveHeader');
  if (header) {
    header.classList.remove('hidden');
    header.classList.add('flex');
  }
  
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

  await loadChatMessages(userId);
}

async function loadChatMessages(otherUserId) {
  const user = AppState.get('user');
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;
  let messages = [];
  
  try {
    const { messages: loadedMsgs, conversationId } = await ChatModule.loadConversation(otherUserId);
    messages = loadedMsgs;
    activeConversationId = conversationId;

    if (messages.length > 0) {
      renderMessages(messages, user.id);
      subscribeToChat(activeConversationId);
      
      ChatModule.markAsRead(activeConversationId);
      return;
    }
    
    activeConversationId = null; 
    container.innerHTML = '<div class="text-center text-xs text-slate-400 mt-4 italic">Inicio de la conversación. Di hola 👋</div>';

  } catch (err) {
    console.error("Error cargando chat:", err);
    container.innerHTML = '<div class="text-center text-xs text-red-400 mt-4">Error cargando mensajes.</div>';
  }

  renderMessages(messages, user.id);
}

function renderMessages(messages, myId) {
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;
  if (!messages.length) {
    container.innerHTML = '<div class="text-center text-xs text-slate-400 mt-4 italic">Inicio de la conversación. Di hola 👋</div>';
    return;
  }

  container.innerHTML = messages.map(m => {
    const isMe = m.sender_id === myId;
    return `
      <div class="flex ${isMe ? 'justify-end' : 'justify-start'} mb-2">
        <div class="max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${isMe ? 'bg-orange-600 text-white rounded-br-none shadow-md shadow-orange-100' : 'bg-white border border-slate-100 text-slate-700 rounded-bl-none shadow-sm'}">
          ${safeEscapeHTML(m.content)}
        </div>
      </div>
    `;
  }).join('');
  
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  if (!activeChatUserId) return;
  const input = document.getElementById('chatMessageInput');
  const text = input.value.trim();
  if (!text) return;

  const user = AppState.get('user');
  
  input.value = '';
  input.disabled = true;
  
  try {
    const { message, conversationId } = await ChatModule.sendMessage(
      user.id,
      activeChatUserId,
      text,
      activeConversationId
    );

    if (!activeConversationId && conversationId) {
      activeConversationId = conversationId;
      subscribeToChat(activeConversationId);
    }

    await loadChatMessages(activeChatUserId);
  
  } catch (err) {
    console.error('Error enviando mensaje:', err);
    safeToast('Error al enviar mensaje', 'error');
  } finally {
    input.disabled = false;
    input.focus();
  }
}

async function subscribeToChat(conversationId) {
  if (!conversationId) return;
  ChatModule.subscribeToConversation(conversationId, (newMsg) => {
    loadChatMessages(activeChatUserId); 
  });
}
