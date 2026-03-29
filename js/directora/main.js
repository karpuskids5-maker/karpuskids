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
  chat: ChatModule,
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
  container.style.display = 'flex';
  container.style.alignItems = 'flex-start';
  container.style.justifyContent = 'center';
  container.style.paddingTop = '4vh';
  container.style.zIndex = '9999';
  if (window.lucide) lucide.createIcons();
};

/**
 * 🧭 Navegación Global
 */
export function goToSection(sectionId) {
  if (!sectionId) return;

  // 1. Manejo de Clases Active/Hidden
  document.querySelectorAll('.section').forEach(sec => {
    sec.classList.add('hidden');
    sec.classList.remove('active');
  });

  const target = document.getElementById(sectionId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
    AppState.set('currentSection', sectionId);
    
    // 2. Carga bajo demanda por módulo
    switch(sectionId) {
      case 'dashboard': 
        DashboardService.getFullData(true).then(data => DirectorUI.renderDashboard(data)); 
        break;
      case 'maestros': TeachersModule.init(); break;
      case 'estudiantes': StudentsModule.init(); break;
      case 'aulas': RoomsModule.init(); break; // No hay cambios en aulas
      case 'asistencia': AttendanceModule.init(); break; // No hay cambios en asistencia
      case 'calificaciones': GradesModule.init(); break;
      case 'pagos': PaymentsModule.init(); break;
      case 'comunicacion': ChatModule.init(); break;
      case 'muro': 
        WallModule.init('muroPostsContainer', { accentColor: 'orange' }, AppState); 
        break;
      case 'reportes': InquiriesModule.init(); break;
      case 'configuracion': loadProfile(); break;
    }
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
  if (sidebar && window.innerWidth < 768) {
    sidebar.classList.add('-translate-x-full');
  }
}

async function loadProfile() {
  try {
    const profile = AppState.get('profile');
    if (!profile) return;
    
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('confDirName', profile.name);
    setVal('confDirTitle', profile.title);
    setVal('confDirBio', profile.bio);
    setVal('confPhone', profile.phone);
    setVal('confEmail', profile.email);
    setVal('confAddress', profile.address);
    
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
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Verificar Rol
    const auth = await ensureRole('directora');
    if (!auth) return;

    // 2. Guardar en Estado
    AppState.set('user', auth.user);
    AppState.set('profile', auth.profile);

    // 3. Inicializar OneSignal
    initOneSignal();

    // 4. Cargar Perfil Inicial
    loadProfile();

    // 5. Iniciar Dashboard por defecto
    goToSection('dashboard');

    // 5b. Botón refresh dashboard
    document.getElementById('btnRefreshDashboard')?.addEventListener('click', () => {
      DashboardService.invalidateCache();
      DashboardService.getFullData(true).then(data => DirectorUI.renderDashboard(data));
    });

    // 5c. Badge de mensajes no leídos (directora)
    loadUnreadMessageBadge(auth.user.id);

    // 6. Configurar Logout
    document.getElementById('btnLogout')?.addEventListener('click', async () => {
      await supabase.auth.signOut();
      window.location.href = 'index.html';
    });

    // 7. Configurar guardado de perfil
    document.getElementById('btnSaveMainConfig')?.addEventListener('click', async () => {
      const updates = {
        name: document.getElementById('confDirName').value,
        title: document.getElementById('confDirTitle').value,
        bio: document.getElementById('confDirBio').value,
        phone: document.getElementById('confPhone').value,
        email: document.getElementById('confEmail').value,
        address: document.getElementById('confAddress').value
      };
      
      const { error } = await supabase.from('profiles').update(updates).eq('id', auth.user.id);
      if (error) Helpers.toast('Error al guardar perfil', 'error');
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

// ── Badge mensajes no leídos (directora) ─────────────────────────────────────
async function loadUnreadMessageBadge(userId) {
  try {
    // Contar mensajes recibidos en las últimas 24h como proxy de "no leídos"
    // (is_read no existe en la tabla — usar created_at como alternativa)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('receiver_id', userId)
      .gte('created_at', since);

    if (error) return; // Silencioso si falla

    const card = document.getElementById('cardComunicaciones');
    if (card && count > 0) {
      let badge = card.querySelector('.msg-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'msg-badge absolute -top-2 -right-2 w-5 h-5 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center shadow-sm z-10';
        card.style.position = 'relative';
        card.appendChild(badge);
      }
      badge.textContent = count > 9 ? '9+' : String(count);
    }

    // Suscripción realtime — solo una vez
    if (!window._dirUnreadChannel) {
      window._dirUnreadChannel = supabase.channel('dir_unread_' + userId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'receiver_id=eq.' + userId }, () => {
          loadUnreadMessageBadge(userId);
        })
        .subscribe();
    }
  } catch (_) {}
}
