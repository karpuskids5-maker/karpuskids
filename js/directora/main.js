import { ensureRole, supabase, initOneSignal } from '/js/shared/supabase.js';
import { AppState } from './state.js';
import { Helpers } from '/js/shared/helpers.js';
import { UIPremium } from '/js/shared/ui-premium.js';
import { WallModule } from './wall.module.js';
import { DashboardService } from './dashboard.service.js';
import { UIHelpers, DirectorUI } from './ui.module.js';
import { StudentsModule } from './students.module.js';
import { TeachersModule } from './teachers.module.js';
import { PaymentsModule } from './payments_clean.js';
import { GradesModule } from './grades.module.js';
import { PermitsModule } from './permits.module.js';
import { InquiriesModule } from './inquiries.module.js';
import { ChatModule } from './chat.module.js';
import { RoomsModule } from './rooms.module.js';
import { AutomationModule } from './automation.js';
import { AccessModule } from './access.module.js';
import { AttendanceModule } from './attendance.module.js';
import { BadgeSystem } from '/js/shared/badges.js';
import { RealtimeManager } from '/js/shared/realtime-manager.js';
import { QueryCache } from '/js/shared/query-cache.js';
import { ImageLoader } from '/js/shared/image-loader.js';
import { auditLog } from '/js/shared/db-utils.js';
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
  permits: PermitsModule,
  chat: ChatModule,
  automation: AutomationModule,
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
  container.innerHTML = `
    <div id="globalModalInner" class="bg-white rounded-3xl shadow-2xl w-full ${maxW} max-h-[92vh] overflow-y-auto mx-3 my-4 relative animate-scaleIn">
      <button onclick="App.ui.closeModal()" class="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-all z-[110]">
        <i data-lucide="x" class="w-6 h-6"></i>
      </button>
      ${html}
    </div>`;
  container.style.cssText = 'display:flex;align-items:flex-start;justify-content:center;padding-top:4vh;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);z-index:var(--z-modal,100);overflow-y:auto;';
  
  // Cerrar al hacer clic fuera del contenido (en el overlay)
  container.onmousedown = (e) => {
    if (e.target === container) {
      App.ui.closeModal();
    }
  };

  if (window.lucide) lucide.createIcons();
};

/**
 * ?? Navegaci�n Global
 */
export function goToSection(sectionId) {
  if (!sectionId) return;

  Helpers.vibrate?.('light');

  // ✅ LIMPIEZA DE REALTIME: Eliminar canales al cambiar de sección
  // Excepto notificaciones globales si existieran
  RealtimeManager.unsubscribeAll(['notifications']);

  // Desuscribir muro al salir (ahorro de recursos Realtime)
  const prevSection = AppState.get('currentSection');
  if (prevSection === 'muro' && sectionId !== 'muro') {
    WallModule.destroy?.();
  }

  if (prevSection === 'accesos' && sectionId !== 'accesos') {
    try {
      if (AccessModule?.stopScanner) {
        AccessModule.stopScanner();
      }
      // Lazy QR: Limpiar QRs generados para ahorrar memoria
      const qrContainer = document.getElementById('accesos-content');
      if (qrContainer) qrContainer.innerHTML = '';
    } catch (_) {}
  }

  // Ocultar todas las secciones
  document.querySelectorAll('.section').forEach(sec => {
    sec.classList.remove('active');
  });

  const target = document.getElementById(sectionId);
  if (target) {
    target.classList.add('active');
    AppState.set('currentSection', sectionId);

    // ✨ Transición fluida Premium
    UIPremium.applySectionTransition(sectionId);

    // Carga bajo demanda por módulo (Lazy Loading via import())
    switch (sectionId) {
      case 'dashboard':
        DashboardService.getFullData(true).then(data => DirectorUI.renderDashboard(data));
        break;
      case 'maestros':
        import('./teachers.module.js').then(m => m.TeachersModule.init());
        break;
      case 'estudiantes':
        import('./students.module.js').then(m => m.StudentsModule.init());
        break;
      case 'aulas':
        import('./rooms.module.js').then(m => m.RoomsModule.init());
        break;
      case 'asistencia':
        import('./attendance.module.js').then(m => m.AttendanceModule.init());
        break;
      case 'calificaciones':
        import('./grades.module.js').then(m => m.GradesModule.init());
        break;
      case 'pagos':
        import('./payments_clean.js').then(m => m.PaymentsModule.init());
        break;
      case 'comunicacion':
        import('./chat.module.js').then(m => m.ChatModule.init());
        break;
      case 'videoconferencia': {
        const profile = AppState.get('profile');
        import('../shared/videocall-ui.js').then(({ VideoCallUI }) => {
          VideoCallUI.renderSection('videocall-directora-section', {
            role: 'directora',
            userName: profile?.name || 'Directora',
            classroomId: null
          });
        }).catch(() => {});
        break;
      }
      case 'muro':
        import('./wall.module.js').then(m => {
          m.WallModule.init('muroPostsContainer', { 
            accentColor: 'indigo', 
            likeColor: 'indigo' 
          }, AppState);
        });
        break;
      case 'accesos':
        import('./access.module.js').then(m => m.AccessModule.init());
        break;
      case 'reportes':
        import('./inquiries.module.js').then(m => m.InquiriesModule.init());
        break;
      case 'staff-permits':
        import('./permits.module.js').then(m => m.PermitsModule.init());
        break;
      case 'configuracion':
        loadProfile();
        import('../shared/notify-permission.js').then(m => m.NotifyPermission.requestIfNeeded());
        break;
    }

    // Marcar badge como leído al entrar
    BadgeSystem.mark(sectionId);
  }

  // Actualizar Botones Nav (Sidebar)
  document.querySelectorAll('[data-section]').forEach(btn => {
    if (btn.dataset.section === sectionId) {
      btn.classList.add('bg-white/20');
    } else {
      btn.classList.remove('bg-white/20');
    }
  });

  // Actualizar Bottom Nav si existe
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });

  // Cerrar sidebar en móvil si está abierto
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar && window.innerWidth < 768) {
    sidebar.classList.remove('mobile-visible');
    if (overlay) { overlay.style.display = 'none'; }
  }

  // Re-inicializar iconos Lucide tras cambio de sección
  setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 50);
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

    // Cargar horario desde school_settings (con fallback si columnas nuevas no existen)
    try {
      // Intentar con columnas nuevas primero
      let settings = null;
      const { data: s1, error: e1 } = await supabase
        .from('school_settings')
        .select('id, generation_day, due_day, phone, business_hours, open_time, close_time, work_days')
        .eq('id', 1).single();

      if (e1 && e1.code === '42703') {
        // Columnas nuevas no existen � usar solo las base
        const { data: s2 } = await supabase
          .from('school_settings')
          .select('id, generation_day, due_day, phone, business_hours')
          .eq('id', 1).single();
        settings = s2;
      } else {
        settings = s1;
      }

      if (settings) {
        if (settings.open_time)  { const el = document.getElementById('confOpenTime');  if (el) el.value = settings.open_time; }
        if (settings.close_time) { const el = document.getElementById('confCloseTime'); if (el) el.value = settings.close_time; }
        if (settings.work_days) {
          try {
            const days = typeof settings.work_days === 'string' ? JSON.parse(settings.work_days) : settings.work_days;
            document.querySelectorAll('.work-day-btn').forEach(btn => {
              if (days.includes(btn.dataset.day)) {
                btn.classList.add('bg-violet-600', 'text-white', 'border-violet-600');
                btn.classList.remove('bg-white', 'text-slate-500', 'border-slate-200');
              }
            });
          } catch (_) {}
        }
        _updateSchedulePreview();
      }
    } catch (_) {}

    // Inicializar toggle de d�as y preview
    window.toggleWorkDay = (btn) => {
      const active = btn.classList.contains('bg-violet-600');
      if (active) {
        btn.classList.remove('bg-violet-600', 'text-white', 'border-violet-600');
        btn.classList.add('bg-white', 'text-slate-500', 'border-slate-200');
      } else {
        btn.classList.add('bg-violet-600', 'text-white', 'border-violet-600');
        btn.classList.remove('bg-white', 'text-slate-500', 'border-slate-200');
      }
      _updateSchedulePreview();
    };

    document.getElementById('confOpenTime')?.addEventListener('change', _updateSchedulePreview);
    document.getElementById('confCloseTime')?.addEventListener('change', _updateSchedulePreview);
    
    const nameEl = document.getElementById('sidebarName'); 
    if(nameEl) nameEl.textContent = profile.name || 'Directora';
    
    // Actualizar avatares (usando los nuevos IDs �nicos)
    const sidebarAvatarImg = document.getElementById('sidebarProfileAvatar');
    if (sidebarAvatarImg) {
      sidebarAvatarImg.src = profile.avatar_url || 'img/mundo.jpg';
    }
    
    const configAvatarImg = document.getElementById('configProfileAvatar');
    if (configAvatarImg) {
      configAvatarImg.src = profile.avatar_url || 'img/mundo.jpg';
    }

    // Inicializar ID de acceso QR de la directora
    _initDirectorAccessId(profile);
    
  } catch (err) {
  }
}

/**
 * ?? Inicializaci�n Principal
 */

// Global error handler � captura errores no manejados
window.addEventListener('unhandledrejection', (e) => {
  // Ignorar errores de IndexedDB (OneSignal) y errores de red silenciosos
  const msg = e.reason?.message?.toLowerCase() ?? '';
  if (msg.includes('indexeddb') || msg.includes('network') || msg.includes('fetch')) return;
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
    // ? FIX: Solo inicializar en el dominio correcto para evitar errores de consola
    const host = window.location.hostname;
    const isProd = host === 'karpuskids.com' || host === 'www.karpuskids.com' || host.endsWith('.karpuskids.com') || host === 'localhost';
    
    if (isProd) {
      try { initOneSignal(auth.user); } catch(e) {
      }
    } else {
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

    // 5c. Badge de mensajes no le�dos (directora)
    loadUnreadMessageBadge(auth.user.id);

    // Badge de posts nuevos en muro
    loadNewPostsBadge();

    // ?? Sistema de badges por secci�n
    BadgeSystem.init(auth.user.id);

    // ?? Realtime: alertar cuando un padre sube un comprobante
    // Se elimin� la importaci�n de payment-service.js (404)
    // El monitoreo de pagos se maneja ahora dentro del PaymentsModule o v�a Supabase directamente si es necesario.

    // 6. Configurar Logout
    document.getElementById('btnLogout')?.addEventListener('click', async () => {
      RealtimeManager.unsubscribeAll();
      QueryCache.clear();
      await supabase.auth.signOut();
      window.location.href = 'login.html';
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

    // Cerrar sidebar al hacer click en cualquier link (m�vil)
    sidebar?.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.innerWidth <= 768) closeSidebar();
      });
    });

    // 7. Configurar guardado de perfil
    document.getElementById('btnSaveMainConfig')?.addEventListener('click', async () => {
      // Solo actualizar columnas que existen en profiles (name, bio, phone)
      // title y address no existen � causan 400
      const updates = {};
      const nameVal  = document.getElementById('confDirName')?.value?.trim();
      const bioVal   = document.getElementById('confDirBio')?.value?.trim();
      const phoneVal = document.getElementById('confPhone')?.value?.trim();
      if (nameVal)  updates.name  = nameVal;
      if (bioVal)   updates.bio   = bioVal;
      if (phoneVal) updates.phone = phoneVal;

      // Guardar ID de acceso QR de la directora
      const accessId = document.getElementById('confDirAccessId')?.value?.trim();
      if (accessId) updates.access_code = accessId;

      const { error } = await supabase.from('profiles').update(updates).eq('id', auth.user.id);
      if (error) Helpers.toast('Error al guardar perfil: ' + error.message, 'error');
      else {
        // Guardar horario en school_settings
        const openTime  = document.getElementById('confOpenTime')?.value;
        const closeTime = document.getElementById('confCloseTime')?.value;
        const workDays  = [...document.querySelectorAll('.work-day-btn.bg-violet-600')].map(b => b.dataset.day);
        const scheduleUpdates = {};
        if (openTime)  scheduleUpdates.open_time  = openTime;
        if (closeTime) scheduleUpdates.close_time = closeTime;
        if (workDays.length) scheduleUpdates.work_days = JSON.stringify(workDays);
        if (Object.keys(scheduleUpdates).length) {
          await supabase.from('school_settings').update(scheduleUpdates).eq('id', 1);
        }
        Helpers.toast('Configuraci�n guardada correctamente', 'success');
        AppState.set('profile', { ...auth.profile, ...updates });
        loadProfile();
      }
    });

    // Make sidebar avatar clickable
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    const configAvatarInput = document.getElementById('configAvatarInput');
    if (sidebarAvatar && configAvatarInput) {
      sidebarAvatar.style.cursor = 'pointer';
      sidebarAvatar.addEventListener('click', () => {
        configAvatarInput.click();
      });
    }

    // 7b. Avatar upload — preview inmediato + guardar en Supabase
    configAvatarInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        Helpers.toast('Imagen muy grande (máx 5MB)', 'error');
        return;
      }
      if (!file.type.startsWith('image/')) {
        Helpers.toast('Solo se permiten imágenes', 'error');
        return;
      }

      const img       = document.getElementById('configProfileAvatar');
      const sidebarImg = document.getElementById('sidebarProfileAvatar');

      // Preview INMEDIATO con ObjectURL
      const objectUrl = URL.createObjectURL(file);
      if (img)       { img.src = objectUrl; img.style.opacity = '0.6'; }
      if (sidebarImg) sidebarImg.src = objectUrl;
      Helpers.toast('Subiendo foto...', 'info');

      try {
        const ext  = file.name.split('.').pop().toLowerCase().replace('jpeg','jpg');
        const path = `directors/${auth.user.id}_${Date.now()}.${ext}`;

        // Intentar con los buckets disponibles en orden de preferencia
        let publicUrl = null;
        for (const bucket of ['avatars', 'karpus-uploads', 'classroom_media']) {
          const { error: upErr } = await supabase.storage
            .from(bucket)
            .upload(path, file, { upsert: true, contentType: file.type });
          if (!upErr) {
            const { data } = supabase.storage.from(bucket).getPublicUrl(path);
            publicUrl = data.publicUrl;
            break;
          }
        }

        if (!publicUrl) throw new Error('No se pudo subir la imagen. Verifica los permisos de storage en Supabase.');

        const { error: dbErr } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', auth.user.id);
        if (dbErr) throw dbErr;

        // Actualizar estado
        const currentProfile = AppState.get('profile') || {};
        AppState.set('profile', { ...currentProfile, avatar_url: publicUrl });

        // UI: mostrar URL real con cache-buster
        const bustedUrl = publicUrl + '?t=' + Date.now();
        if (img)       { img.src = bustedUrl; img.style.opacity = '1'; }
        if (sidebarImg) sidebarImg.src = bustedUrl;
        URL.revokeObjectURL(objectUrl);

        // Limpiar input para permitir re-seleccionar el mismo archivo
        configAvatarInput.value = '';
        Helpers.toast('Foto de perfil actualizada ✅', 'success');
      } catch (err) {
        if (img) img.style.opacity = '1';
        URL.revokeObjectURL(objectUrl);
        Helpers.toast('Error al subir la foto: ' + (err.message || err), 'error');
      }
    });

    // 8. Quitar loader inicial
    const loader = document.getElementById('initial-loading');
    if (loader) {
      loader.style.opacity = '0';
      setTimeout(() => loader.remove(), 500);
    }

    // 9. Inicializar iconos Lucide
    if (window.lucide) lucide.createIcons();

  } catch (err) {
    // Quitar loader siempre
    const loader = document.getElementById('initial-loading');
    if (loader) { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 300); }

    // Solo redirigir al login si es error de autenticación, no por cualquier error
    const msg = (err?.message || '').toLowerCase();
    const isAuthError = msg.includes('session') || msg.includes('auth') || msg.includes('jwt') || msg.includes('token');
    if (isAuthError) {
      window.location.href = 'login.html';
    }
    // Para otros errores: mostrar el panel vacío en vez de redirigir
  }
});

/**
 * ?? Notificaciones de Mensajes No Le�dos
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
    // Si el RPC falla, simplemente mostrar 0 � no hacer fallback a tablas que pueden no existir

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

  // Solo actualizar tarjeta del dashboard (no sidebar)
  const cardBadge = document.getElementById('badge-card-comunicacion');
  if (cardBadge) {
    if (total > 0) {
      cardBadge.textContent = total > 99 ? '99+' : String(total);
      cardBadge.classList.remove('hidden');
      cardBadge.classList.add('flex');
    } else {
      cardBadge.classList.add('hidden');
      cardBadge.classList.remove('flex');
    }
  }
}

async function loadNewPostsBadge() {
  try {
    // Guardar timestamp de �ltima visita al muro en localStorage
    const lastVisit = localStorage.getItem('karpus_muro_last_visit') || new Date(0).toISOString();
    const { count } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', lastVisit);

    const total = count || 0;
    // Solo actualizar tarjeta del dashboard (no sidebar)
    const cardBadge = document.getElementById('badge-card-muro');
    if (cardBadge) {
      if (total > 0) {
        cardBadge.textContent = total > 99 ? '99+' : String(total);
        cardBadge.classList.remove('hidden');
        cardBadge.classList.add('flex');
      } else {
        cardBadge.classList.add('hidden');
        cardBadge.classList.remove('flex');
      }
    }

    // Limpiar badge al entrar a muro
    document.querySelector('[data-section="muro"]')?.addEventListener('click', () => {
      localStorage.setItem('karpus_muro_last_visit', new Date().toISOString());
      if (cardBadge) { cardBadge.classList.add('hidden'); cardBadge.classList.remove('flex'); }
    }, { once: false });

  } catch (_) {}
}

// -- Secci�n de Accesos (QR + Asistencia en vivo) -----------------------------
function _initAccesosSection() {
  const container = document.getElementById('accesos-content');
  if (!container) return;

  // Cargar librer�a QR si no est�
  const loadQR = () => new Promise(resolve => {
    if (window.QRCode) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'js/shared/qrcode.min.js';
    s.onload = resolve;
    document.head.appendChild(s);
  });

  // Cargar estudiantes y generar QRs
  const loadStudentsQR = async () => {
    container.innerHTML = '<div class="flex justify-center py-12"><div class="animate-spin w-8 h-8 border-2 border-orange-500 rounded-full border-t-transparent"></div></div>';
    await loadQR();

    const { data: students } = await supabase
      .from('students')
      .select('id, name, matricula, classrooms:classroom_id(name)')
      .eq('is_active', true)
      .not('matricula', 'is', null)
      .order('name');

    if (!students?.length) {
      container.innerHTML = '<div class="text-center py-12 text-slate-400"><p class="font-bold">No hay estudiantes con matr�cula asignada.</p><p class="text-xs mt-1">Asigna matr�culas desde la secci�n Estudiantes.</p></div>';
      return;
    }

    container.innerHTML = students.map(s => `
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 flex flex-col items-center gap-3 hover:shadow-md transition-all">
        <div id="qr-${s.id}" class="bg-slate-50 w-[140px] h-[140px] rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer group hover:bg-orange-50 hover:border-orange-200 transition-all"
             onclick="window._generateLazyStudentQR('${s.id}', '${s.matricula}')">
          <div class="text-center">
            <i data-lucide="qr-code" class="w-6 h-6 text-slate-300 group-hover:text-orange-400 mx-auto mb-1"></i>
            <span class="text-[9px] font-bold text-slate-400 group-hover:text-orange-500 uppercase">Generar QR</span>
          </div>
        </div>
        <div class="text-center">
          <p class="font-black text-slate-800 text-sm">${s.name}</p>
          <p class="text-[10px] font-bold text-orange-600 uppercase tracking-widest">${s.matricula}</p>
          <p class="text-[10px] text-slate-400">${s.classrooms?.name || 'Sin aula'}</p>
        </div>
        <button onclick="window._printStudentQR('${s.id}','${s.name}','${s.matricula}')"
          class="w-full py-2 bg-slate-800 text-white rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-slate-900 transition-all flex items-center justify-center gap-1.5">
          <i data-lucide="printer" class="w-3 h-3"></i> Imprimir
        </button>
      </div>`).join('');

    if (window.lucide) lucide.createIcons();
  };

  // Función global para generar QR solo cuando sea necesario (Lazy)
  window._generateLazyStudentQR = (id, matricula) => {
    const el = document.getElementById(`qr-${id}`);
    if (!el || el.querySelector('img')) return;

    el.innerHTML = '<div class="animate-spin w-5 h-5 border-2 border-orange-500 rounded-full border-t-transparent"></div>';
    
    setTimeout(() => {
      const qrData = JSON.stringify({ id, matricula, role: 'student' });
      el.innerHTML = '';
      new QRCode(el, {
        text: qrData,
        width: 120,
        height: 120,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });
      el.classList.remove('bg-slate-50', 'border-dashed', 'cursor-pointer');
      el.classList.add('p-2', 'bg-white', 'border-slate-100');
      el.onclick = null;
    }, 200);
  };

  // Funci�n global para imprimir QR individual
  window._printStudentQR = (id, name, matricula) => {
    const el = document.getElementById(`qr-${id}`);
    const img = el?.querySelector('img')?.src || el?.querySelector('canvas')?.toDataURL();
    if (!img) return;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>QR ${matricula}</title>
      <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
      .card{border:2px solid #e2e8f0;border-radius:16px;padding:20px;text-align:center;max-width:240px;}
      .logo{font-size:11px;font-weight:900;color:#f97316;text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;}
      img{width:160px;height:160px;}.name{font-size:14px;font-weight:900;color:#1e293b;margin-top:10px;}
      .mat{font-size:10px;color:#64748b;font-weight:700;margin-top:3px;}.hint{font-size:8px;color:#94a3b8;margin-top:6px;}</style>
    </head><body><div class="card">
      <div class="logo">?? Karpus Kids</div>
      <img src="${img}">
      <div class="name">${name}</div>
      <div class="mat">${matricula}</div>
      <div class="hint">Escanea para registrar entrada/salida</div>
    </div><script>window.onload=()=>window.print()<\/script></body></html>`);
    win.document.close();
  };

  loadStudentsQR();
}

// -- Preview din�mico del horario ----------------------------------------------
function _updateSchedulePreview() {
  const preview = document.getElementById('schedulePreview');
  if (!preview) return;

  const days = [...document.querySelectorAll('.work-day-btn.bg-violet-600')].map(b => b.dataset.day);
  const open  = document.getElementById('confOpenTime')?.value  || '';
  const close = document.getElementById('confCloseTime')?.value || '';

  if (!days.length && !open) { preview.classList.add('hidden'); return; }

  const daysText = days.length ? days.join(' � ') : 'Sin d�as seleccionados';
  const timeText = open && close ? `${open} � ${close}` : '';

  preview.classList.remove('hidden');
  preview.innerHTML = `<span class="text-violet-600">?? ${daysText}</span>${timeText ? `<span class="mx-2 text-violet-300">|</span><span class="text-violet-800">?? ${timeText}</span>` : ''}`;
}

// -- ID de Acceso QR de la Directora ------------------------------------------
async function _initDirectorAccessId(profile) {
  const input = document.getElementById('confDirAccessId');
  if (!input) return;

  // Always fetch fresh from DB to get access_code (not in AppState profile)
  const { data: freshProfile } = await supabase
    .from('profiles')
    .select('id, name, access_code')
    .eq('id', profile.id)
    .maybeSingle();

  const p = freshProfile || profile;
  const code = p.access_code || (p.notes?.startsWith?.('DIR-') ? p.notes : null);
  if (code) input.value = code;

  const _loadQR = () => new Promise(r => {
    if (window.QRCode) { r(); return; }
    const s = document.createElement('script');
    s.src = 'js/shared/qrcode.min.js';
    s.onload = r; document.head.appendChild(s);
  });

  const _renderQR = async (code) => {
    const container = document.getElementById('dir-qr-container');
    if (!container || !code) return;
    await _loadQR();
    container.innerHTML = '';
    new window.QRCode(container, {
      text: JSON.stringify({ matricula: code, name: p?.name || 'Directora', type: 'karpus-staff', v: 1 }),
      width: 100, height: 100, colorDark: '#1e293b', colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.H
    });
  };

  window._genDirectorId = async () => {
    const newCode = 'DIR-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random() * 9000) + 1000);
    input.value = newCode;
    // Save immediately to access_code using fresh profile id
    const { error } = await supabase.from('profiles').update({ access_code: newCode }).eq('id', p.id);
    if (!error) {
      Helpers.toast('ID de directora guardado', 'success');
    }
    await _renderQR(newCode);
  };

  window._printDirectorQR = () => {
    const code = input.value.trim();
    const container = document.getElementById('dir-qr-container');
    const img = container?.querySelector('img')?.src || container?.querySelector('canvas')?.toDataURL();
    if (!img || !code) { Helpers.toast('Genera el QR primero', 'warning'); return; }
    const name = p?.name || 'Directora';
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>Carnet ${name}</title><style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}.card{border:4px solid #7c3aed;border-radius:20px;padding:24px;text-align:center;max-width:260px;}.hdr{background:#7c3aed;color:white;margin:-24px -24px 16px;padding:12px;border-radius:16px 16px 0 0;font-weight:900;font-size:12px;text-transform:uppercase;}img{width:160px;height:160px;border-radius:8px;}.name{font-size:16px;font-weight:900;color:#1e293b;margin-top:12px;}.code{font-size:10px;color:#64748b;font-weight:700;margin-top:4px;}</style></head><body><div class="card"><div class="hdr">DIRECTORA � KARPUS KIDS</div><img src="${img}"><div class="name">${name}</div><div class="code">ID: ${code}</div></div><script>window.onload=()=>window.print()<\/script></body></html>`);
    win.document.close();
  };

  // Auto-render si ya tiene ID
  if (code) setTimeout(() => _renderQR(code), 400);

  input.addEventListener('input', (e) => {
    clearTimeout(window._dirQrDebounce);
    window._dirQrDebounce = setTimeout(() => _renderQR(e.target.value.trim()), 600);
  });
}
