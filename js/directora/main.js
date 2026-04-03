import { ensureRole, supabase, initOneSignal } from '../shared/supabase.js';
import { AppState } from './state.js';
import { Helpers } from '../shared/helpers.js';
import { WallModule } from './wall.module.js';
import { DashboardService } from './dashboard.service.js';
import { UIHelpers, DirectorUI } from './ui.module.js';
import { StudentsModule } from './students.module.js';
import { TeachersModule } from './teachers.module.js';
import { PaymentsModule } from './payments_clean.js';
import { GradesModule } from './grades.module.js';
import { AttendanceModule } from './attendance.module.js';
import { ChatModule } from './chat.module.js';
import { InquiriesModule } from './inquiries.module.js';
import { RoomsModule } from './rooms.module.js';
import { BadgeSystem } from '../shared/badges.js';
import { ImageLoader } from '../shared/image-loader.js';
import { RealtimeManager } from '../shared/realtime-manager.js';
import { QueryCache } from '../shared/query-cache.js';
const debounce = (fn, delay) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
};

window.App = {
  navigation: { goTo: goToSection },
  students: StudentsModule,
  teachers: { ...TeachersModule, edit: (id) => TeachersModule.openModal(id) },
  rooms: RoomsModule,
  payments: PaymentsModule,
  attendance: AttendanceModule,
  grades: GradesModule,
  ui: { ...UIHelpers, ...DirectorUI },
  inquiries: InquiriesModule,
  chat: {
    ...ChatModule,
    toggleMobileView: (show) => {
      const container = document.getElementById('chatAppContainer');
      if (container) container.classList.toggle('show-chat', show);
    }
  },
  wall: {
    toggleCommentSection: (pid) => WallModule.toggleCommentSection(pid),
    sendComment: (pid) => WallModule.sendComment(pid),
    deletePost: (pid) => WallModule.deletePost(pid),
    toggleLike: (pid) => WallModule.toggleLike(pid),
    openNewPostModal: () => WallModule.openNewPostModal(),
    loadPosts: (container) => WallModule.loadPosts(container || 'muroPostsContainer')
  }
};

window.WallModule = WallModule;

window.openGlobalModal = function(html, wide = false) {
  const container = document.getElementById('globalModalContainer');
  if (!container) return;
  const maxW = wide ? 'max-w-4xl' : 'max-w-2xl';
  container.innerHTML = `<div class="bg-white rounded-3xl shadow-2xl w-full ${maxW} max-h-[92vh] overflow-y-auto mx-3 my-4">${html}</div>`;
  container.style.cssText = 'display:flex;align-items:flex-start;justify-content:center;padding-top:4vh;position:fixed;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);z-index:var(--z-modal,100);overflow-y:auto;';
  if (window.lucide) lucide.createIcons();
};

/**
 * 🧭 Navegación Global
 */
export function goToSection(sectionId) {
  if (!sectionId) return;

  // Ocultar todas las secciones — solo con CSS class, sin Tailwind hidden
  document.querySelectorAll('.section').forEach(sec => {
    sec.classList.remove('active');
  });

  const target = document.getElementById(sectionId);
  if (target) {
    target.classList.add('active');
    AppState.set('currentSection', sectionId);
    
    // 2. Carga bajo demanda por módulo
    switch (sectionId) {
      case 'dashboard':
        DashboardService.getFullData(true).then(data => DirectorUI.renderDashboard(data));
        break;
      case 'maestros': TeachersModule.init(); break;
      case 'estudiantes': StudentsModule.init(); break;
      case 'aulas': RoomsModule.init(); break;
      case 'asistencia': AttendanceModule.init(); break;
      case 'calificaciones': GradesModule.init(); break;
      case 'pagos': PaymentsModule.init(); break;
      case 'comunicacion': ChatModule.init(); break;
      case 'muro':
        WallModule.init('muroPostsContainer', { accentColor: 'orange' }, AppState);
        break;
      case 'reportes': InquiriesModule.init(); break;
      case 'configuracion':
        loadProfile();
        import('../shared/notify-permission.js').then(m => m.NotifyPermission.requestIfNeeded());
        break;
    }

    // 🔴 Marcar badge como leído al entrar
    BadgeSystem.mark(sectionId);
  }

  // 3. Actualizar Botones Nav
  document.querySelectorAll('[data-section]').forEach(btn => {
    if (btn.dataset.section === sectionId) {
      btn.classList.add('bg-white/20');
    } else {
      btn.classList.remove('bg-white/20');
    }
  });

  // Cerrar sidebar en móvil si está abierto
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar && window.innerWidth < 768) {
    sidebar.classList.remove('mobile-visible');
    if (overlay) { overlay.style.display = 'none'; }
  }
}

async function loadProfile() {
  try {
    const profile = AppState.get('profile');
    if (!profile) return;
    
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('confDirName', profile.name);
    setVal('confDirBio', profile.bio);
    setVal('confPhone', profile.phone);
    setVal('confEmail', profile.email);
    
    const nameEl = document.getElementById('sidebarName'); 
    if(nameEl) nameEl.textContent = profile.name || 'Directora';
    
    // Actualizar avatares (usando los nuevos IDs únicos)
    const sidebarAvatarImg = document.getElementById('sidebarProfileAvatar');
    if (sidebarAvatarImg) {
      sidebarAvatarImg.src = profile.avatar_url || 'img/mundo.jpg';
    }
    
    const configAvatarImg = document.getElementById('configProfileAvatar');
    if (configAvatarImg) {
      configAvatarImg.src = profile.avatar_url || 'img/mundo.jpg';
    }
    
  } catch (err) {
    console.error('Error loading profile:', err);
  }
}

/**
 * 🚀 Inicialización Principal
 */

// Global error handler — captura errores no manejados
window.addEventListener('unhandledrejection', (e) => {
  // Ignorar errores de IndexedDB (OneSignal) y errores de red silenciosos
  const msg = e.reason?.message?.toLowerCase() ?? '';
  if (msg.includes('indexeddb') || msg.includes('network') || msg.includes('fetch')) return;
  console.error('[Directora] Unhandled rejection:', e.reason);
});

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Verificar Rol
    const auth = await ensureRole('directora');
    if (!auth) return;

    // 2. Guardar en Estado
    AppState.set('user', auth.user);
    AppState.set('profile', auth.profile);

    // 3. Inicializar OneSignal
    // ✅ FIX: Solo inicializar en el dominio correcto para evitar errores de consola
    const host = window.location.hostname;
    const isProd = host === 'karpuskids.com' || host === 'www.karpuskids.com' || host.endsWith('.karpuskids.com') || host === 'localhost';
    
    if (isProd) {
      try { initOneSignal(auth.user); } catch(e) {
        console.warn('⚠️ OneSignal error:', e);
      }
    } else {
      console.log('ℹ️ OneSignal skipping: restricted domain');
    }

    // 4. Cargar Perfil Inicial
    loadProfile();

    // 5. Iniciar Dashboard por defecto
    goToSection('dashboard');

    // 5b. Buscadores en tiempo real (Debounced)
    const setupSearch = (id, module) => {
      const el = document.getElementById(id);
      if (!el) return;

      el.addEventListener('input', debounce((e) => {
        const value = e.target.value.toLowerCase();
        if (window.App[module] && window.App[module].filter) {
          window.App[module].filter(value);
        }
      }, 300));
    };

    setupSearch('searchTeacher', 'teachers');
    setupSearch('searchStudent', 'students');
    setupSearch('searchGradeStudent', 'grades');
    setupSearch('searchPaymentStudent', 'payments');
    setupSearch('wallSearch', 'wall');
    setupSearch('chatSearchInput', 'chat');

    // 5c. Interacciones de Chat en Móvil
    document.getElementById('chatBackBtn')?.addEventListener('click', () => {
      window.App.chat.toggleMobileView(false);
    });
    document.getElementById('chatContactsList')?.addEventListener('click', (e) => {
      if (e.target.closest('.chat-contact-item') || e.target.closest('[onclick*="chat.select"]')) {
        window.App.chat.toggleMobileView(true);
      }
    });

    // 5c. Badge de mensajes no leídos (directora)
    loadUnreadMessageBadge(auth.user.id);

    // 🔴 Sistema de badges por sección
    BadgeSystem.init(auth.user.id);

    // 💳 Realtime: alertar cuando un padre sube un comprobante
    // Se eliminó la importación de payment-service.js (404)
    // El monitoreo de pagos se maneja ahora dentro del PaymentsModule o vía Supabase directamente si es necesario.

    // 6. Configurar Logout
    document.getElementById('btnLogout')?.addEventListener('click', async () => {
      RealtimeManager.unsubscribeAll();
      QueryCache.clear();
      await supabase.auth.signOut();
      window.location.href = 'index.html';
    });

    // 7. Mobile sidebar hamburger
    const menuBtn = document.getElementById('menuBtn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');

    const openSidebar = () => {
      if (sidebar) sidebar.classList.add('mobile-visible');
      if (overlay) overlay.style.display = 'block';
    };
    const closeSidebar = () => {
      if (sidebar) sidebar.classList.remove('mobile-visible');
      if (overlay) overlay.style.display = 'none';
    };

    // Remove any previous listener to avoid duplicates
    const newMenuBtn = menuBtn?.cloneNode(true);
    if (menuBtn && newMenuBtn) menuBtn.parentNode.replaceChild(newMenuBtn, menuBtn);

    newMenuBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const sb = document.getElementById('sidebar');
      const ov = document.getElementById('sidebarOverlay');
      if (sb?.classList.contains('mobile-visible')) {
        sb.classList.remove('mobile-visible');
        if (ov) ov.style.display = 'none';
      } else {
        sb?.classList.add('mobile-visible');
        if (ov) ov.style.display = 'block';
      }
    });

    overlay?.addEventListener('click', closeSidebar);

    // Cerrar sidebar al hacer click en cualquier link (móvil)
    sidebar?.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.innerWidth <= 768) closeSidebar();
      });
    });

    // 7. Configurar guardado de perfil
    document.getElementById('btnSaveMainConfig')?.addEventListener('click', async () => {
      // Solo actualizar columnas que existen en profiles (name, bio, phone)
      // title y address no existen — causan 400
      const updates = {};
      const nameVal  = document.getElementById('confDirName')?.value?.trim();
      const bioVal   = document.getElementById('confDirBio')?.value?.trim();
      const phoneVal = document.getElementById('confPhone')?.value?.trim();
      if (nameVal)  updates.name  = nameVal;
      if (bioVal)   updates.bio   = bioVal;
      if (phoneVal) updates.phone = phoneVal;

      const { error } = await supabase.from('profiles').update(updates).eq('id', auth.user.id);
      if (error) Helpers.toast('Error al guardar perfil: ' + error.message, 'error');
      else {
        Helpers.toast('Perfil actualizado correctamente');
        AppState.set('profile', { ...auth.profile, ...updates });
        loadProfile();
      }
    });

  } catch (err) {
    console.error('Error during initialization:', err);
    window.location.href = 'index.html';
  }
});

/**
 * 📩 Notificaciones de Mensajes No Leídos
 */
async function loadUnreadMessageBadge(userId) {
  if (!userId) return;
  try {
    let total = 0;

    // Intentar RPC primero
    const { data, error } = await supabase.rpc('get_unread_counts');
    if (!error && data) {
      total = Object.values(data).reduce((a, b) => a + Number(b), 0);
    }
    // Si el RPC falla, simplemente mostrar 0 — no hacer fallback a tablas que pueden no existir

    updateBadgeUI(total);
  } catch (_) {
    updateBadgeUI(0);
  }
}

function updateBadgeUI(total) {
  const badge = document.getElementById('unreadMessagesBadge');
  if (badge) {
    if (total > 0) {
      badge.textContent = total > 99 ? '99+' : total;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}
