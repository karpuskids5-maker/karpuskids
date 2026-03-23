/**
 * 💬 ChatModule for Director Panel
 * Separación de responsabilidades:
 * - Data Layer: Maneja API calls y Supabase
 * - Rendering Layer: Actualiza el DOM
 * - Realtime Layer: Escucha cambios en tiempo real
 */

import { supabase } from '../supabase.js';
import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';

/**
 * 🔌 Data Layer - Manejo de datos y API
 */
class ChatDataLayer {
  constructor() {
    this.currentUserId = null;
    this.currentChatUserId = null;
    this.allContacts = [];
    this.messageCache = {};
    this.chatChannel = null;
  }

  /**
   * Cargar lista de contactos desde la API
   * @param {string} currentUserId - ID del usuario actual
   * @param {string} roleFilter - Filtro de rol ('all', 'maestra', 'padre', etc)
   */
  async loadContacts(currentUserId, roleFilter = 'all') {
    try {
      console.log(`📥 Cargando contactos (filtro: ${roleFilter})...`);
      this.currentUserId = currentUserId;

      const { data: users, error } = await DirectorApi.getChatUsers(currentUserId, roleFilter);
      if (error) throw new Error(error);
      
      // Enriquecer datos de padres con información de estudiantes
      const parentIds = (users || []).filter(u => u.role === 'padre').map(u => u.id);
      let studentMap = {};
      
      if (parentIds.length > 0) {
        const { data: students, error: sError } = await DirectorApi.getStudentsByParentIds(parentIds);
        if (!sError) {
          students?.forEach(s => {
            if (!studentMap[s.parent_id]) {
              studentMap[s.parent_id] = { 
                studentName: s.name, 
                classroomName: s.classrooms?.name || 'Aula' 
              };
            }
          });
        }
      }

      // Transformar a formato de contacto
      this.allContacts = (users || []).map(u => {
        const studentInfo = studentMap[u.id];
        const studentName = studentInfo?.studentName;
        
        // 🛡️ Fallback inteligente para nombres profesionales
        const profileName = u.name || u.full_name || u.p1_name || 'Usuario';
        
        return {
          id: u.id,
          // 🛡️ Priorizar nombre del estudiante para padres, fallback al nombre del perfil
          name: u.role === 'padre' && studentName ? studentName : profileName,
          avatar: u.avatar_url || u.avatar || u.photo_url || null,
          role: {
            maestra: 'Maestra',
            padre: 'Padre/Madre',
            asistente: 'Asistente',
            directora: 'Dirección'
          }[u.role] || u.role,
          meta: u.role === 'padre' 
            ? `Estudiante: ${studentName || 'N/A'} • Aula: ${studentInfo?.classroomName || 'Sin asignar'} (${profileName})` 
            : 'Personal Administrativo'
        };
      });

      console.log(`✅ ${this.allContacts.length} contactos cargados`);
      return this.allContacts;
    } catch (error) {
      console.error('❌ Error cargando contactos:', error);
      throw error;
    }
  }

  /**
   * Obtener contactos filtrados por búsqueda
   * @param {string} searchTerm - Término de búsqueda
   * @returns {Array} Contactos que coinciden
   */
  getFilteredContacts(searchTerm = '') {
    const q = searchTerm.toLowerCase();
    return this.allContacts.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.meta.toLowerCase().includes(q)
    );
  }

  /**
   * Cargar historial de mensajes
   * @param {string} userId - ID del otro usuario
   * @returns {Array} Mensajes del historial
   */
  async loadMessages(userId) {
    try {
      console.log(`📥 Cargando historial con ${userId}...`);
      
      // Verificar caché primero (5 minutos)
      if (this.messageCache[userId]) {
        const { messages, timestamp } = this.messageCache[userId];
        const age = Date.now() - timestamp;
        if (age < 5 * 60 * 1000) {
          console.log(`✅ Historial en caché (${Math.round(age / 1000)}s atrás)`);
          return messages;
        }
      }

      // Obtener del API
      const { data: messages, error } = await DirectorApi.getChatHistory(userId);
      if (error) throw new Error(error);
      
      // Guardar en caché
      this.messageCache[userId] = {
        messages: messages || [],
        timestamp: Date.now()
      };

      console.log(`✅ ${messages?.length || 0} mensajes cargados`);
      return messages || [];
    } catch (error) {
      console.error('❌ Error cargando mensajes:', error);
      return [];
    }
  }

  /**
   * Enviar mensaje
   * @param {string} receiverId - ID del receptor
   * @param {string} content - Contenido del mensaje
   */
  async sendMessage(receiverId, content) {
    try {
      if (!content.trim() || !receiverId) {
        throw new Error('Contenido o receptor vacío');
      }

      console.log('📤 Enviando mensaje...');
      
      await DirectorApi.sendMessage(this.currentUserId, receiverId, content);
      
      // Invalidar caché del historial
      this.invalidateMessageCache(receiverId);
      
      console.log('✅ Mensaje enviado');
    } catch (error) {
      console.error('❌ Error enviando mensaje:', error);
      throw error;
    }
  }

  /**
   * Invalidar caché de mensajes
   */
  invalidateMessageCache(userId) {
    delete this.messageCache[userId];
  }

  /**
   * Limpiar caché completamente
   */
  clearCache() {
    this.messageCache = {};
    console.log('🗑️ Caché de mensajes limpiado');
  }

  /**
   * Preparar suscripción a cambios en tiempo real
   */
  setupRealtimeChannel(userId) {
    if (this.chatChannel) {
      supabase.removeChannel(this.chatChannel);
    }

    this.chatChannel = supabase.channel(`chat_dir_${this.currentUserId}_${userId}`);
    return this.chatChannel;
  }

  /**
   * Limpiar canal de tiempo real
   */
  cleanupRealtime() {
    if (this.chatChannel) {
      supabase.removeChannel(this.chatChannel);
      this.chatChannel = null;
    }
  }
}

/**
 * 🎨 Rendering Layer - Actualización del DOM
 */
class ChatUILayer {
  constructor(containerId) {
    this.containerIds = {
      contacts: 'chatContactsList',
      header: 'chatActiveHeader',
      messages: 'chatMessagesContainer',
      input: 'chatInputArea',
      nameEl: 'chatActiveName',
      metaEl: 'chatActiveMeta',
      avatarEl: 'chatActiveAvatar',
      searchInput: 'chatSearchInput',
      roleFilter: 'chatRoleFilter',
      messageInput: 'chatMessageInput'
    };
  }

  /**
   * Renderizar lista de contactos
   */
  renderContacts(contacts) {
    const container = document.getElementById(this.containerIds.contacts);
    if (!container) return;

    if (contacts.length === 0) {
      container.innerHTML = Helpers.emptyState('No se encontraron contactos');
      return;
    }

    container.innerHTML = contacts
      .map(c => this._createContactHTML(c))
      .join('');
  }

  /**
   * HTML de un contacto individual
   */
  _createContactHTML(contact) {
    return `
      <div onclick="window.App.chat.select('${contact.id}', '${Helpers.escapeHTML(contact.name)}', '${contact.role}', '${Helpers.escapeHTML(contact.meta)}', '${contact.avatar || ''}')" 
           class="flex items-center gap-3 p-3 rounded-2xl hover:bg-white hover:shadow-sm cursor-pointer transition-all border border-transparent hover:border-slate-100 group">
        <div class="w-11 h-11 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold overflow-hidden border border-blue-50 shrink-0">
          ${contact.avatar ? `<img src="${contact.avatar}" class="w-full h-full object-cover">` : contact.name.charAt(0)}
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-bold text-slate-700 text-sm truncate group-hover:text-blue-600">${Helpers.escapeHTML(contact.name)}</div>
          <div class="text-[10px] text-slate-400 font-bold uppercase truncate">${contact.role}</div>
          <div class="text-[10px] text-slate-500 truncate mt-0.5">${Helpers.escapeHTML(contact.meta)}</div>
        </div>
      </div>`;
  }

  /**
   * Mostrar estado de carga en mensajes
   */
  showLoadingMessages() {
    const container = document.getElementById(this.containerIds.messages);
    if (container) {
      container.innerHTML = `<div class="flex-1 flex items-center justify-center"><i data-lucide="loader-2" class="w-8 h-8 animate-spin text-blue-400"></i></div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  /**
   * Mostrar estado vacío de mensajes
   */
  showEmptyMessages(userName) {
    const container = document.getElementById(this.containerIds.messages);
    if (container) {
      container.innerHTML = `
        <div class="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-60">
          <i data-lucide="sparkles" class="w-12 h-12 mb-3 text-blue-300"></i>
          <p class="text-sm">Inicia la conversación con ${Helpers.escapeHTML(userName)}</p>
        </div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  /**
   * Renderizar historial de mensajes
   */
  renderMessages(messages, currentUserId) {
    const container = document.getElementById(this.containerIds.messages);
    if (!container) return;

    container.innerHTML = '';

    if (!messages || messages.length === 0) {
      container.innerHTML = `
        <div class="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-60">
          <i data-lucide="message-circle" class="w-12 h-12 mb-3 text-slate-300"></i>
          <p class="text-sm">Sin mensajes aún</p>
        </div>`;
      return;
    }

    messages.forEach(msg => {
      this.appendMessage(msg, currentUserId);
    });

    // Scroll al final
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 100);
  }

  /**
   * Agregar un mensaje individual al contenedor
   */
  appendMessage(message, currentUserId) {
    const container = document.getElementById(this.containerIds.messages);
    if (!container) return;

    const isMine = message.sender_id === currentUserId;
    const time = new Date(message.created_at).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    const div = document.createElement('div');
    div.className = `flex ${isMine ? 'justify-end' : 'justify-start'} animate-fade-in`;
    div.innerHTML = `
      <div class="max-w-[85%] md:max-w-[70%] group">
        <div class="px-4 py-2.5 rounded-2xl text-xs shadow-sm ${
          isMine 
            ? 'bg-blue-600 text-white rounded-tr-none' 
            : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none'
        }">
          <div class="whitespace-pre-wrap break-words">${Helpers.escapeHTML(message.content)}</div>
          <div class="text-[9px] ${isMine ? 'text-blue-200' : 'text-slate-400'} mt-1 text-right font-bold uppercase">
            ${time}
          </div>
        </div>
      </div>`;
    
    container.appendChild(div);
  }

  /**
   * Actualizar header del chat
   */
  updateHeader(name, role, meta, avatar) {
    document.getElementById(this.containerIds.header)?.classList.remove('hidden');
    document.getElementById(this.containerIds.input)?.classList.remove('hidden');
    
    const nameEl = document.getElementById(this.containerIds.nameEl);
    const metaEl = document.getElementById(this.containerIds.metaEl);
    const avatarEl = document.getElementById(this.containerIds.avatarEl);

    if (nameEl) nameEl.textContent = name;
    if (metaEl) metaEl.textContent = `${role} • ${meta}`;
    if (avatarEl) {
      avatarEl.innerHTML = avatar 
        ? `<img src="${avatar}" class="w-full h-full object-cover">` 
        : name.charAt(0);
    }
  }

  /**
   * Limpiar input de mensaje
   */
  clearMessageInput() {
    const input = document.getElementById(this.containerIds.messageInput);
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }
  }

  /**
   * Obtener valor del input de mensaje
   */
  getMessageInput() {
    return document.getElementById(this.containerIds.messageInput)?.value.trim() || '';
  }

  /**
   * Obtener valor del filtro de rol
   */
  getRoleFilter() {
    return document.getElementById(this.containerIds.roleFilter)?.value || 'all';
  }

  /**
   * Obtener valor de búsqueda
   */
  getSearchTerm() {
    return document.getElementById(this.containerIds.searchInput)?.value || '';
  }
}

/**
 * 🧠 ChatManager - Orquestador principal
 */
export class ChatManager {
  constructor() {
    this.dataLayer = new ChatDataLayer();
    this.uiLayer = new ChatUILayer();
    this.currentChatUser = null;
  }

  /**
   * Inicializar el módulo de chat
   */
  async init() {
    console.log('🚀 Inicializando ChatManager...');
    
    // Configurar event listeners
    document.getElementById('btnSendChatMessage')?.addEventListener('click', 
      () => this.sendMessage());
    
    document.getElementById('chatMessageInput')?.addEventListener('keypress', 
      e => (e.key === 'Enter' && !e.shiftKey) && (e.preventDefault(), this.sendMessage()));
    
    document.getElementById('chatSearchInput')?.addEventListener('input', 
      () => this.updateContactsList());
    
    document.getElementById('chatRoleFilter')?.addEventListener('change', 
      () => this.loadContacts());

    // Cargar contactos iniciales
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await this.loadContacts();
    }

    console.log('✅ ChatManager iniciado');
  }

  /**
   * Cargar lista de contactos
   */
  async loadContacts() {
    try {
      this.uiLayer.renderContacts([]);
      
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const roleFilter = this.uiLayer.getRoleFilter();
      
      await this.dataLayer.loadContacts(currentUser.id, roleFilter);
      this.updateContactsList();
    } catch (error) {
      console.error('Error cargando contactos:', error);
      Helpers.toast('Error al cargar contactos', 'error');
    }
  }

  /**
   * Actualizar vista de contactos con filtro de búsqueda
   */
  updateContactsList() {
    const searchTerm = this.uiLayer.getSearchTerm();
    const filtered = this.dataLayer.getFilteredContacts(searchTerm);
    this.uiLayer.renderContacts(filtered);
  }

  /**
   * Seleccionar un chat
   */
  async select(userId, name, role, meta, avatar) {
    try {
      console.log(`💬 Seleccionando chat con ${name}...`);
      
      this.currentChatUser = userId;
      this.uiLayer.updateHeader(name, role, meta, avatar);
      this.uiLayer.showLoadingMessages();

      // Cargar historial
      const messages = await this.dataLayer.loadMessages(userId);
      
      if (messages.length === 0) {
        this.uiLayer.showEmptyMessages(name);
      } else {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        this.uiLayer.renderMessages(messages, currentUser.id);
      }

      // Configurar suscripción a tiempo real
      this.setupRealtime(userId);

    } catch (error) {
      console.error('Error seleccionando chat:', error);
      Helpers.toast('Error al cargar chat', 'error');
    }
  }

  async setupRealtime(userId) {
    this.dataLayer.cleanupRealtime();
    const channel = this.dataLayer.setupRealtimeChannel(userId);
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    if (!currentUser) return;

    channel
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'messages', 
          filter: `or(sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id})` 
        }, 
        payload => {
          const msg = payload.new;
          if (msg.sender_id === userId || msg.receiver_id === userId) {
            const container = document.getElementById('chatMessagesContainer');
            if (container?.querySelector('.opacity-60')) {
              container.innerHTML = '';
            }
            this.uiLayer.appendMessage(msg, currentUser.id);
            container.scrollTop = container.scrollHeight;
          }
        }
      )
      .subscribe();

    console.log('✅ Realtime activado');
  }

  /**
   * Enviar mensaje
   */
  async sendMessage() {
    try {
      const content = this.uiLayer.getMessageInput();
      if (!content || !this.currentChatUser) return;

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) return;

      // 🛡️ Optimistic UI
      const tempId = 'temp_' + Date.now();
      this.uiLayer.appendMessage(
        { 
          id: tempId,
          content, 
          sender_id: currentUser.id, 
          created_at: new Date().toISOString(),
          status: 'pending'
        }, 
        currentUser.id
      );

      this.uiLayer.clearMessageInput();
      const container = document.getElementById('chatMessagesContainer');
      if (container) container.scrollTop = container.scrollHeight;

      // 🛡️ Enviar al servidor (Verificando RLS directamente)
      const { error } = await supabase
        .from('messages')
        .insert([{ 
          sender_id: currentUser.id, 
          receiver_id: this.currentChatUser, 
          content: content.trim() 
        }]);

      if (error) {
        if (error.code === '42501') {
          throw new Error('No tienes permisos para enviar mensajes (RLS Policy Error).');
        }
        throw error;
      }

      // Enviar notificación push
      try {
        const { sendPush } = await import('../shared/helpers.js');
        sendPush({ 
          user_id: this.currentChatUser, 
          title: 'Nuevo mensaje de Dirección', 
          message: content, 
          type: 'chat' 
        });
      } catch (e) { console.warn('Push notification error:', e); }

    } catch (error) {
      console.error('Error enviando mensaje:', error);
      Helpers.toast(error.message || 'Error al enviar mensaje', 'error');
    }
  }

  /**
   * Limpiar recursos
   */
  cleanup() {
    this.dataLayer.cleanupRealtime();
    console.log('🧹 ChatManager limpiado');
  }
}
