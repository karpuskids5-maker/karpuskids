import { ensureRole, supabase, initOneSignal } from '/js/shared/supabase.js';
import { AppState } from './state.js';
import { SchoolEngine } from '/js/shared/school-engine.js';
import { SchoolYearModule } from './school-year.module.js';
import { Helpers } from '/js/shared/helpers.js';
import { UIPremium } from '/js/shared/ui-premium.js';
import { DashboardService } from './dashboard.service.js';
import { UIHelpers, DirectorUI } from './ui.module.js';
import { CarnetsModule } from '/js/shared/carnets.module.js';
import { BadgeSystem } from '/js/shared/badges.js';
import { RealtimeManager } from '/js/shared/realtime-manager.js';
import { QueryCache } from '/js/shared/query-cache.js';
import { GradesModule } from './grades.module.js';
import { BackNavigation } from '/js/shared/back-navigation.js';
const debounce = (fn, delay) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
};

window.App = {
  navigation: { goTo: goToSection },
  students: {
    openModal: (id) => import('./students.module.js').then(m => m.StudentsModule.openModal(id)),
    loadStudents: () => import('./students.module.js').then(m => m.StudentsModule.loadStudents()),
    filter: (v) => import('./students.module.js').then(m => m.StudentsModule.filter?.(v)),
    delete: (id) => import('./students.module.js').then(m => m.StudentsModule.delete(id)),
  },
  inscripciones: {
    init: () => import('./inscripciones.module.js').then(m => m.InscripcionesModule.init()),
    openRecord: (id) => import('./inscripciones.module.js').then(m => m.InscripcionesModule.openRecord(id)),
    reject: (id) => import('./inscripciones.module.js').then(m => m.InscripcionesModule.reject(id)),
  },
  teachers: {
    openModal: (id) => import('./teachers.module.js').then(m => m.TeachersModule.openModal(id)),
    delete: (id) => import('./teachers.module.js').then(m => m.TeachersModule.delete(id)),
    save: () => import('./teachers.module.js').then(m => m.TeachersModule.save()),
  },
  rooms: {
    openModal: (id) => import('./rooms.module.js').then(m => m.RoomsModule.openModal(id)),
    deleteRoom: (roomId, roomName) => import('./rooms.module.js').then(m => m.RoomsModule.deleteRoom(roomId, roomName)),
    save: () => import('./rooms.module.js').then(m => m.RoomsModule.save()),
    assignStudent: (studentId) => import('./rooms.module.js').then(m => m.RoomsModule.assignStudent(studentId)),
  },
  payments: {
    init: () => import('./payments_clean.js').then(m => m.PaymentsModule.init()),
    markPaid: (id) => import('./payments_clean.js').then(m => m.PaymentsModule.markPaid(id)),
    filter: (v) => import('./payments_clean.js').then(m => m.PaymentsModule.filterBy?.(v)),
    filterBy: (v) => import('./payments_clean.js').then(m => m.PaymentsModule.filterBy?.(v)),
    delete: (id) => import('./payments_clean.js').then(m => m.PaymentsModule.delete(id)),
    waiveMora: (id) => import('./payments_clean.js').then(m => m.PaymentsModule.waiveMora(id)),
    editPaymentAmount: (id) => import('./payments_clean.js').then(m => m.PaymentsModule.editPaymentAmount(id)),
    applyDiscount: (id) => import('./payments_clean.js').then(m => m.PaymentsModule.applyDiscount(id)),
  },
  attendance: {
    init: () => import('./attendance.module.js').then(m => m.AttendanceModule.init()),
  },
  grades: GradesModule,
  ui: { ...UIHelpers, ...DirectorUI },
  inquiries: {
    init: () => import('./inquiries.module.js').then(m => m.InquiriesModule.init()),
    reply: (id) => import('./inquiries.module.js').then(m => m.InquiriesModule.reply(id)),
  },
  permits: {
    init: () => import('./permits.module.js').then(m => m.PermitsModule.init()),
    loadHistory: () => import('./permits.module.js').then(m => m.PermitsModule.loadHistory?.()),
    updateStatus: (id, newStatus) => import('./permits.module.js').then(m => m.PermitsModule.updateStatus(id, newStatus)),
    viewDetails: (id) => import('./permits.module.js').then(m => m.PermitsModule.viewDetails(id)),
  },
  chat: {
    init: () => import('./chat.module.js').then(m => m.ChatModule.init()),
  },
  automation: {
    init: () => import('./automation.js').then(m => m.AutomationModule.init()),
  },
  reports: { init: () => import('./reports.module.js').then(m => m.ReportsModule.init()) },
  donaciones: {
    init: () => import('./donations.module.js').then(m => m.DonationsModule.init()),
    openCampaignModal: (id) => import('./donations.module.js').then(m => m.DonationsModule.openCampaignModal(id)),
    saveCampaign: () => import('./donations.module.js').then(m => m.DonationsModule.saveCampaign()),
    toggleCampaign: (id) => import('./donations.module.js').then(m => m.DonationsModule.toggleCampaign(id)),
    deleteCampaign: (id) => import('./donations.module.js').then(m => m.DonationsModule.deleteCampaign(id)),
    setFilter: (f) => import('./donations.module.js').then(m => m.DonationsModule.setFilter(f)),
    renderDonations: () => import('./donations.module.js').then(m => m.DonationsModule.renderDonations()),
    approveDonation: (id) => import('./donations.module.js').then(m => m.DonationsModule.approveDonation(id)),
    rejectDonation: (id) => import('./donations.module.js').then(m => m.DonationsModule.rejectDonation(id)),
    certifyDonation: (id) => import('./donations.module.js').then(m => m.DonationsModule.certifyDonation(id)),
    viewDonation: (id) => import('./donations.module.js').then(m => m.DonationsModule.viewDonation(id)),
    pickCampaignImages: () => import('./donations.module.js').then(m => m.DonationsModule.pickCampaignImages()),
    removeCampImage: (kind, idx) => import('./donations.module.js').then(m => m.DonationsModule.removeCampImage(kind, idx)),
    generateCertificate: (id) => import('./donations.module.js').then(m => m.DonationsModule.generateCertificate(id)),
    exportCSV: () => import('./donations.module.js').then(m => m.DonationsModule.exportCSV()),
    exportDonorsCSV: () => import('./donations.module.js').then(m => m.DonationsModule.exportDonorsCSV()),
  },
  wall: {
    toggleCommentSection: (pid) => import('./wall.module.js').then(m => m.WallModule.toggleCommentSection(pid)),
    sendComment: (pid) => import('./wall.module.js').then(m => m.WallModule.sendComment(pid)),
    deletePost: (pid) => import('./wall.module.js').then(m => m.WallModule.deletePost(pid)),
    toggleLike: (pid) => import('./wall.module.js').then(m => m.WallModule.toggleLike(pid)),
    openNewPostModal: () => import('./wall.module.js').then(m => m.WallModule.openNewPostModal()),
    loadPosts: (container) => import('./wall.module.js').then(m => m.WallModule.loadPosts(container || 'muroPostsContainer'))
  },
  carnets: CarnetsModule,
  schoolYear: SchoolYearModule,
};

// Alias: el módulo de donaciones usa `App.donations` (inglés) en sus
// manejadores inline, mientras que la API pública se expone como
// `App.donaciones`. Mantenemos ambos para evitar errores de "not defined".
window.App.donations = window.App.donaciones;

window.WallModule = {
  init: (...a) => import('./wall.module.js').then(m => m.WallModule.init(...a)),
  loadPosts: (...a) => import('./wall.module.js').then(m => m.WallModule.loadPosts(...a)),
  destroy: (...a) => import('./wall.module.js').then(m => m.WallModule.destroy(...a)),
  toggleCommentSection: (...a) => import('./wall.module.js').then(m => m.WallModule.toggleCommentSection(...a)),
  sendComment: (...a) => import('./wall.module.js').then(m => m.WallModule.sendComment(...a)),
  deletePost: (...a) => import('./wall.module.js').then(m => m.WallModule.deletePost(...a)),
  toggleLike: (...a) => import('./wall.module.js').then(m => m.WallModule.toggleLike(...a)),
  openNewPostModal: (...a) => import('./wall.module.js').then(m => m.WallModule.openNewPostModal(...a)),
  submitNewPost: (...a) => import('./wall.module.js').then(m => m.WallModule.submitNewPost(...a)),
  loadClassroomsForPost: (...a) => import('./wall.module.js').then(m => m.WallModule.loadClassroomsForPost(...a)),
};

window.openGlobalModal = function(html, wide = false) {
  const container = document.getElementById('globalModalContainer');
  if (!container) return;
  const maxW = wide ? 'max-w-4xl' : 'max-w-2xl';
  container.innerHTML = `
    <div id="globalModalInner" style="background:#fff;border-radius:1.5rem;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);width:100%;${wide ? 'max-width:56rem' : 'max-width:42rem'};max-height:92vh;overflow-y:auto;margin:0.75rem auto;position:relative">
      <button onclick="App.ui.closeModal()" style="position:absolute;top:1rem;right:1rem;width:2.5rem;height:2.5rem;display:flex;align-items:center;justify-content:center;border-radius:9999px;background:#f1f5f9;color:#94a3b8;border:none;cursor:pointer;z-index:110;transition:all 0.2s">
        <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
      ${html}
    </div>`;
  container.style.cssText = 'display:flex;align-items:flex-start;justify-content:center;padding-top:4vh;position:fixed;inset:0;background:rgba(15,23,42,0.75);z-index:var(--z-modal,100);overflow-y:auto;';
  
  // Cerrar al hacer clic fuera del contenido (en el overlay)
  container.onmousedown = (e) => {
    if (e.target === container) {
      App.ui.closeModal();
    }
  };

  // Hover effects for close button
  const closeBtn = container.querySelector('button');
  if (closeBtn) {
    closeBtn.onmouseenter = () => { closeBtn.style.background = '#fef2f2'; closeBtn.style.color = '#f43f5e'; };
    closeBtn.onmouseleave = () => { closeBtn.style.background = '#f1f5f9'; closeBtn.style.color = '#94a3b8'; };
  }

  if (window.lucide) lucide.createIcons();
};

/**
 * ?? Navegación Global
 */
export function goToSection(sectionId, opts = {}) {
  if (!sectionId) return;

  // Navegación de usuario (default): colapsa capas de historial abiertas
  // (conversaciones de chat) y trunca el historial hacia adelante antes de
  // aplicar la sección → ATRÁS del móvil nunca queda "muerto".
  // Llamadas internas/arranque pasan { pushHistory: false }.
  if (opts.pushHistory !== false) {
    BackNavigation.reset().then(() => _applySection(sectionId, opts));
    return;
  }
  _applySection(sectionId, opts);
}

function _applySection(sectionId, opts = {}) {
  if (!sectionId) return;

  Helpers.vibrate?.('light');

  // ✅ LIMPIEZA DE REALTIME: Eliminar canales al cambiar de sección
  // (proteger banner de actividades + badges: sobreviven la navegación)
  RealtimeManager.unsubscribeAll(['notifications', 'eventbanner_*', 'badges_*']);

  // Desuscribir muro al salir (ahorro de recursos Realtime)
  const prevSection = AppState.get('currentSection');
  if (prevSection === 'muro' && sectionId !== 'muro') {
    import('./wall.module.js').then(m => m.WallModule.destroy?.()).catch(() => {});
  }

  if (prevSection === 'accesos' && sectionId !== 'accesos') {
    try {
      import('./access.module.js').then(m => m.AccessModule?.stopScanner?.()).catch(() => {});
      const qrContainer = document.getElementById('accesos-content');
      if (qrContainer) qrContainer.innerHTML = '';
    } catch (_) {}
  }

  // Limpiar realtime + charts de asistencia al salir
  if (prevSection === 'asistencia' && sectionId !== 'asistencia') {
    try { import('./attendance.module.js').then(m => m.AttendanceModule.destroy?.()).catch(() => {}); } catch (_) {}
  }

  // Ocultar todas las secciones
  document.querySelectorAll('.section').forEach(sec => {
    sec.classList.remove('active');
  });

  const target = document.getElementById(sectionId);
  if (target) {
    target.classList.add('active');
    AppState.set('currentSection', sectionId);

    // ✅ HISTORIAL (PWA): ATRÁS físico → regresa a la sección anterior sin recargar
    if (opts.pushHistory !== false && prevSection && prevSection !== sectionId) {
      BackNavigation.push(() => goToSection(prevSection, { pushHistory: false }), { kind: 'section' });
    }

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
      case 'inscripciones':
        import('./inscripciones.module.js').then(m => m.InscripcionesModule.init());
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
        import('./reports.module.js').then(m => m.ReportsModule.init());
        break;
      case 'staff-permits':
        import('./permits.module.js').then(m => m.PermitsModule.init());
        break;
      case 'tienda':
        import('../shared/store.js').then(m => m.initStoreAsistente('store-directora-container'));
        break;
      case 'donaciones':
        import('./donations.module.js').then(m => m.DonationsModule.init());
        break;
      case 'configuracion':
        loadProfile();
        import('../shared/notify-permission.js').then(m => m.NotifyPermission.requestIfNeeded());
        break;
      case 'anio-escolar':
        SchoolYearModule.init();
        break;
    }

    // Marcar badge como leído al entrar
    BadgeSystem.mark(sectionId);

    // Abrir automáticamente el grupo del sidebar al que pertenece la sección
    const GROUP_OF_SECTION = {
      dashboard: 'principal',
      maestros: 'gestion', estudiantes: 'gestion', inscripciones: 'gestion', aulas: 'gestion',
      asistencia: 'academico', calificaciones: 'academico',
      pagos: 'finanzas', tienda: 'finanzas', donaciones: 'finanzas',
      'anio-escolar': 'sistema', configuracion: 'sistema'
    };
    if (window.__kkOpenSectionGroup && GROUP_OF_SECTION[sectionId]) {
      window.__kkOpenSectionGroup(GROUP_OF_SECTION[sectionId], false);
    }
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
    
    const configAvatarSidebarImg = document.getElementById('configProfileAvatarSidebar');
    if (configAvatarSidebarImg) {
      configAvatarSidebarImg.src = profile.avatar_url || 'img/mundo.jpg';
    }

    // Inicializar ID de acceso QR de la directora
    _initDirectorAccessId(profile);
    
  } catch (err) {
  }
}

/**
 * ?? Inicializaci�n Principal
 */

// Global error handler � captu// Global error handler captura errores no manejados
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message?.toLowerCase() ?? '';
  // Ignorar ruido conocido
  if (msg.includes('indexeddb') || msg.includes('network') || msg.includes('fetch') || msg.includes('aborted')) return;
  console.warn('[Karpus] Error no manejado:', e.reason?.message || e.reason);
  e.preventDefault();
});

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Verificar Rol
    const auth = await ensureRole('directora');
    if (!auth) return;

    // 2. Guardar en Estado
    AppState.set('user', auth.user);
    AppState.set('profile', auth.profile);

    // 🔔 Banner global de mensajes entrantes (visible en todo el panel)
    import('./chat.module.js').then(({ ChatModule }) => {
      import('/js/shared/incoming-banner.js').then(({ IncomingBanner }) => {
        IncomingBanner.init({
          uid: auth.user.id,
          isActiveChat: (msg) => ChatModule.isActiveChatOpen?.(msg),
          onOpen: (senderId) => {
            goToSection('comunicacion');
            setTimeout(() => { ChatModule.openChatWithUser?.(senderId); }, 400);
          }
        });
      }).catch(() => {});
    }).catch(() => {});

    // 2b. Inicializar School Engine (Motor Escolar)
    await SchoolEngine.init({ forceRefresh: true });
    AppState.set('schoolYear', SchoolEngine.getSchoolYear());
    AppState.set('activePeriod', SchoolEngine.getActivePeriod());

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
    goToSection('dashboard', { pushHistory: false });

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

    // 5c. Badge de mensajes no le�dos (directora)
    loadUnreadMessageBadge(auth.user.id);

    // Badge de posts nuevos en muro
    loadNewPostsBadge();

    // ?? Sistema de badges por secci�n
    BadgeSystem.init(auth.user.id);

    // ?? Sincronización en vivo: cuando cambia un estudiante (modal, asignación de aulas,
    // eliminación), refrescar la tabla de estudiantes y la sección de aulas sin recargar.
    window.addEventListener('karpus:students-changed', () => {
      try {
        QueryCache.invalidate('dir_students');
        QueryCache.invalidate('dir_classrooms');
        QueryCache.invalidate('dir_classrooms_occ');
      } catch (_) {}
      import('./rooms.module.js').then(m => m.RoomsModule.init()).catch(() => {});
      import('./students.module.js').then(m => m.StudentsModule.applyFilters()).catch(() => {});
    });

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

    // Event delegation para evitar listeners duplicados en el boton del menu
    document.addEventListener('click', (e) => {
      if (e.target.closest('#menuBtn')) {
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
      }
    }, { capture: false });

    overlay?.addEventListener('click', closeSidebar);

    // Cerrar sidebar al hacer click en cualquier link (m�vil)
    sidebar?.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.innerWidth <= 768) closeSidebar();
      });
    });

    // 7c. Colapsar sidebar en escritorio (botón #toggleSidebar)
    const sidebarCollapseBtn = document.getElementById('toggleSidebar');
    const contentWrapper = document.querySelector('.app-content-wrapper');
    function setDesktopCollapsed(collapsed, persist = true) {
      if (!sidebar) return;
      sidebar.classList.toggle('collapsed', collapsed);
      contentWrapper?.classList.toggle('sidebar-collapsed', collapsed);
      if (persist) { try { localStorage.setItem('kk_directora_sidebar_collapsed', collapsed ? '1' : '0'); } catch (_) {} }
    }
    sidebarCollapseBtn?.addEventListener('click', () => {
      setDesktopCollapsed(!sidebar.classList.contains('collapsed'));
    });

    // 7d. Secciones colapsables del sidebar (móvil + escritorio)
    const SIDEBAR_SECTIONS_KEY = 'kk_directora_sections_state';
    let sectionState = {};
    try { sectionState = JSON.parse(localStorage.getItem(SIDEBAR_SECTIONS_KEY) || '{}'); } catch (_) { sectionState = {}; }

    function applySidebarGroupState(toggle) {
      const key = toggle.dataset.sectionToggle;
      const group = document.getElementById('kk-navgroup-' + key);
      if (!group) return;
      const isCollapsed = sectionState[key] === false;
      group.classList.toggle('collapsed', isCollapsed);
      toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    }

    function openSidebarGroup(key, save = true) {
      if (!key) return;
      sectionState[key] = true;
      if (save) { try { localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(sectionState)); } catch (_) {} }
      const group = document.getElementById('kk-navgroup-' + key);
      if (group) group.classList.remove('collapsed');
      const toggle = document.querySelector(`.kk-nav-section-toggle[data-section-toggle="${key}"]`);
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }

    document.querySelectorAll('.kk-nav-section-toggle').forEach(toggle => {
      applySidebarGroupState(toggle);
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = toggle.dataset.sectionToggle;
        if (!key) return;
        const group = document.getElementById('kk-navgroup-' + key);
        if (!group) return;
        const willCollapse = !group.classList.contains('collapsed');
        group.classList.toggle('collapsed', willCollapse);
        toggle.setAttribute('aria-expanded', willCollapse ? 'false' : 'true');
        sectionState[key] = !willCollapse;
        try { localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(sectionState)); } catch (_) {}
      });
    });

    // Exponer para que _applySection abra el grupo de la sección activa
    window.__kkOpenSectionGroup = openSidebarGroup;

    // Estado inicial: en escritorio restaurar colapso del sidebar; en móvil expandido
    if (window.innerWidth >= 768) {
      try { setDesktopCollapsed(localStorage.getItem('kk_directora_sidebar_collapsed') === '1', false); } catch (_) {}
    } else {
      sidebar?.classList.remove('collapsed');
    }

    // 7b. Navegación global: dashboard cards + sidebar nav buttons
    document.addEventListener('click', (e) => {
      // Dashboard shortcut cards
      const card = e.target.closest('[data-action="go-section"]');
      if (card) {
        const section = card.dataset.section;
        if (section) goToSection(section);
        return;
      }
      // Sidebar nav buttons (kk-nav-item)
      const navBtn = e.target.closest('#sidebar [data-section]');
      if (navBtn) {
        const section = navBtn.dataset.section;
        if (section) goToSection(section);
      }
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
          const { error: schedErr } = await supabase.from('school_settings').update(scheduleUpdates).eq('id', 1);
          if (schedErr) { Helpers.toast('Error al guardar horario: ' + schedErr.message, 'error'); return; }
        }
        Helpers.toast('Configuración guardada correctamente', 'success');
        AppState.set('profile', { ...(AppState.get('profile') || auth.profile), ...updates });
        loadProfile();
      }
    });

    // Make sidebar avatar clickable
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    const configAvatarInput = document.getElementById('configAvatarInput');
    const configAvatarInputSidebar = document.getElementById('configAvatarInputSidebar');
    if (sidebarAvatar && configAvatarInput) {
      sidebarAvatar.style.cursor = 'pointer';
      sidebarAvatar.addEventListener('click', () => {
        configAvatarInput.click();
      });
    }

    // 7b. Avatar upload — preview inmediato + guardar en Supabase (función reutilizable)
    const handleAvatarUpload = async (e) => {
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
      const imgSidebar = document.getElementById('configProfileAvatarSidebar');
      const sidebarImg = document.getElementById('sidebarProfileAvatar');

      // Preview INMEDIATO con ObjectURL
      const objectUrl = URL.createObjectURL(file);
      if (img)       { img.src = objectUrl; img.style.opacity = '0.6'; }
      if (imgSidebar) { imgSidebar.src = objectUrl; imgSidebar.style.opacity = '0.6'; }
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
        if (imgSidebar) { imgSidebar.src = bustedUrl; imgSidebar.style.opacity = '1'; }
        if (sidebarImg) sidebarImg.src = bustedUrl;
        URL.revokeObjectURL(objectUrl);

        // Limpiar inputs para permitir re-seleccionar el mismo archivo
        if (configAvatarInput) configAvatarInput.value = '';
        if (configAvatarInputSidebar) configAvatarInputSidebar.value = '';
        Helpers.toast('Foto de perfil actualizada ✅', 'success');
      } catch (err) {
        if (img) img.style.opacity = '1';
        if (imgSidebar) imgSidebar.style.opacity = '1';
        URL.revokeObjectURL(objectUrl);
        Helpers.toast('Error al subir la foto: ' + (err.message || err), 'error');
      }
    };

    configAvatarInput?.addEventListener('change', handleAvatarUpload);
    configAvatarInputSidebar?.addEventListener('change', handleAvatarUpload);

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
  preview.innerHTML = `<span class="text-violet-600">📅 ${daysText}</span>${timeText ? `<span class="mx-2 text-violet-300">|</span><span class="text-violet-800">🕐 ${timeText}</span>` : ''}`;
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
    container.innerHTML = '<div class="flex items-center justify-center p-4"><div class="w-6 h-6 border-2 border-violet-400 border-t-transparent rounded-full animate-spin"></div></div>';
    try {
      const qrUrl = await Helpers.generateQRWithLogo(
        JSON.stringify({ matricula: code, name: p?.name || 'Directora', type: 'karpus-staff', v: 1 }),
        { width: 100, colorDark: '#7c3aed' }
      );
      if (qrUrl) {
        container.innerHTML = '';
        const qi = document.createElement('img');
        qi.src = qrUrl;
        qi.style.cssText = 'width:100px;height:100px;border-radius:1.5mm;display:block;margin:auto;';
        container.appendChild(qi);
      } else {
        container.innerHTML = '<p class="text-[9px] text-red-500 font-bold text-center">Error al generar QR</p>';
      }
    } catch (e) {
      container.innerHTML = '<p class="text-[9px] text-red-500 font-bold text-center">Error al generar QR</p>';
    }
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
    const img = container?.querySelector('img')?.src;
    if (!img || !code) { Helpers.toast('Genera el QR primero', 'warning'); return; }
    const name = p?.name || 'Directora';
    const phone = p?.phone || '';
    const win = window.open('', '_blank');
    win.document.write(Helpers.getStaffCarnetTemplate(name, 'Directora', phone, { accessCode: code, qrImg: img }));
    win.document.close();
  };

  window._printStaffCredential = () => {
    const name = p?.name || 'Directora';
    const phone = p?.phone || '';
    const win = window.open('', '_blank');
    win.document.write(Helpers.getStaffCarnetTemplate(name, 'Directora', phone, { accessCode: p?.access_code }));
    win.document.close();
  };

  // Auto-render si ya tiene ID
  if (code) setTimeout(() => _renderQR(code), 400);

  input.addEventListener('input', (e) => {
    clearTimeout(window._dirQrDebounce);
    window._dirQrDebounce = setTimeout(() => _renderQR(e.target.value.trim()), 600);
  });
}
