import { ensureRole, supabase, initOneSignal } from '/js/shared/supabase.js';
import { AppState } from './state.js';
import { AssistantApi } from './api.js';
import { PaymentsModule } from './payments.js';
import { AccessModule } from './access.js';
import { TeachersModule } from './teachers.js';
import { Helpers } from '/js/shared/helpers.js';
import { WallModule } from '/js/shared/wall.js';
import { ChatModule } from '/js/shared/chat.js';
import { StudentsModule } from './modules/students.js';
import { auditLog } from '/js/shared/db-utils.js';
import { RoomsModule } from './modules/rooms.js';
import { DashboardModule } from './modules/dashboard.js';
import { BadgeSystem } from '/js/shared/badges.js';
import { ImageLoader } from '/js/shared/image-loader.js';
import { QueryCache } from '/js/shared/query-cache.js';
import { RealtimeManager } from '/js/shared/realtime-manager.js';
import { Security } from '/js/shared/security.js';

// ?? Definir objeto App globalmente para evitar ReferenceError en onclicks del HTML
// Global close modal fallback � always available even before openNewPostModal is called
window._closeAsistenteModal = () => {
  const gc = document.getElementById('globalModalContainer');
  if (gc) { gc.style.display = 'none'; gc.innerHTML = ''; }
};

// Cierre de modales estáticos al hacer clic fuera del contenido
document.addEventListener('click', (e) => {
  const staticModals = ['roomModal', 'roomStudentsModal', 'paymentDetailModal', 'paymentModal', 'attendanceModal', 'accessModal'];
  for (const id of staticModals) {
    const modal = document.getElementById(id);
    if (modal && e.target === modal && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      break;
    }
  }
});

window.openGlobalModal = (html, wide = false) => {
  const gc = document.getElementById('globalModalContainer');
  if (!gc) return;
  const maxW = wide ? 'max-w-4xl' : 'max-w-2xl';
  gc.innerHTML = `
    <div id="globalModalInner" class="bg-white rounded-3xl shadow-2xl w-full ${maxW} max-h-[92vh] overflow-y-auto mx-3 my-4 relative animate-scaleIn">
      <button onclick="window._closeAsistenteModal()" class="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-all z-[110]">
        <i data-lucide="x" class="w-6 h-6"></i>
      </button>
      ${html}
    </div>`;
  gc.style.cssText = 'display:flex;align-items:flex-start;justify-content:center;padding-top:4vh;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);z-index:9999;overflow-y:auto;';
  
  gc.onmousedown = (e) => {
    if (e.target === gc) window._closeAsistenteModal();
  };

  if (window.lucide) lucide.createIcons();
};

window.App = {
  payments: {
    markPaid:      (id)  => PaymentsModule.markPaid(id),
    rejectPayment: (id, notes)  => PaymentsModule.rejectPayment(id, notes),
    deletePayment: (id)  => PaymentsModule.deletePayment(id),
    openModal:     (sid) => PaymentsModule.openPaymentModal(sid),
    closeModal:    ()    => PaymentsModule.closeModal(),
    filterBy:      (s)   => PaymentsModule.filterBy(s),
    waiveMora:     (id)  => PaymentsModule.waiveMora(id),
    _confirmApproval: (id) => PaymentsModule._confirmApproval(id)
  },
  registerAccess: (sid, type) => window.App._registerAccess(sid, type),
  confirmPayment: (id) => PaymentsModule.markPaid(id),
  rejectPayment:  (id) => PaymentsModule.rejectPayment(id),
  deletePayment:  (id) => PaymentsModule.deletePayment(id),
  registerPayment:(sid) => PaymentsModule.openPaymentModal(sid),
  openTeacherModal: (id) => window.App._openTeacherModal(id),
  toggleCommentSection: (id) => window.App._toggleCommentSection(id),
  deleteComment: (cid, pid) => window.App._deleteComment(cid, pid),
  sendComment: (pid) => window.App._sendComment(pid),
  toggleLike: (pid) => window.App._toggleLike(pid),
  selectChatContact: (uid, name, role) => window.App._selectChatContact(uid, name, role),
  students: StudentsModule,
  rooms: RoomsModule,
  teachers: {
    openModal:     (id)         => TeachersModule.openModal(id),
    deleteTeacher: (id, name)   => TeachersModule.deleteTeacher(id, name)
  }
};

/**
 * Inicializaci�n principal del Panel de Asistente
 */
document.addEventListener('DOMContentLoaded', async () => {
  
  // 1. Verificar Rol
  const auth = await ensureRole(['asistente', 'admin', 'directora']);
  if (!auth) return;
  
  AppState.set('user', auth.user);
  AppState.set('profile', auth.profile);

  // ?? Sistema de badges por secci�n
  BadgeSystem.init(auth.user.id);

  // Sidebar profile
  const profile = auth.profile;
  const nameEl = document.getElementById('sidebarUserName');
  if (nameEl) nameEl.textContent = profile?.name || 'Asistente';
  const avatarEl = document.getElementById('sidebarAvatar');
  if (avatarEl && profile?.avatar_url) avatarEl.src = profile.avatar_url;

  // Logout
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    RealtimeManager.unsubscribeAll();
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  });
  
  // 2. Inicializar m�dulos ligeros y navegaci�n
  // La navegaci�n ahora se encargar� de la carga perezosa (lazy loading) de las secciones.
  WallModule.init('muroPostsContainer', { accentColor: 'teal', likeColor: 'emerald' }, AppState);
  
  // ? FIX OneSignal: Solo inicializar en el dominio correcto para evitar errores de consola
  if (window.location.hostname === 'karpuskids.com' || window.location.hostname === 'localhost') {
    try { initOneSignal(auth.user); } catch(_) { /* silencioso */ }
  } else {
  }
  
  initNavigation(); // Esto cargar� el dashboard y configurar� los listeners

  // Asignar funciones internas al objeto global App
  Object.assign(window.App, {
    _registerAccess: (sid, type) => AccessModule.register(sid, type),
    _confirmPayment: (id) => PaymentsModule.confirmPayment(id),
    _rejectPayment: (id) => PaymentsModule.rejectPayment(id),
    _deletePayment: (id) => PaymentsModule.deletePayment(id),
    _registerPayment: (sid) => PaymentsModule.openModal(sid),
    _openTeacherModal: (id) => TeachersModule.openModal(id),
    _toggleCommentSection: (id) => WallModule.toggleCommentSection(id),
    _deleteComment: (cid, pid) => WallModule.deleteComment(cid, pid),
    _sendComment: (pid) => sendComment(pid),
    _toggleLike: (pid) => WallModule.toggleLike(pid),
    _selectChatContact: (uid, name, role) => selectAssistantChat(uid, name, role),
    selectChatContact: (uid, name, role) => selectAssistantChat(uid, name, role),
    // Estudiantes
    _openStudentModal: (id) => StudentsModule.openModal(id),
    _deleteStudent: (id, name) => StudentsModule._deleteStudent(id, name),
    _genMatricula: () => window._genMatricula?.(),
    _openRoomModal: (id) => RoomsModule.openModal(id),
    openNewPostModal,
    submitNewPost
  });

  // Exponer WallModule globalmente
  window.WallModule = WallModule;
  window.openTeacherModal = (id) => TeachersModule.openModal(id);

  // Mantener compatibilidad temporal para onclick en HTML que no use App.
  Object.assign(window, window.App);

  if (window.lucide) lucide.createIcons();
});

/**
 * Carga inicial del dashboard de asistente
 */
async function initDashboard() {
  // Obsoleto, delegado a DashboardModule
}

/**
 * Navegaci�n lateral
 */
const loadedSections = new Set();

function initNavigation() {
  const navLinks = document.querySelectorAll('[data-section]');
  const sections = document.querySelectorAll('section[id]');

  const showSection = async (target) => {
    // Desuscribir muro al salir (ahorro de recursos Realtime)
    const prevSection = AppState.get('currentSection');
    if (prevSection === 'muro' && target !== 'muro') {
      WallModule.destroy?.();
      // Permitir re-inicializar el muro la próxima vez
      loadedSections.delete('muro');
    }

    // 1. Limpiar clases activas en botones de navegación�n
    navLinks.forEach(l => {
      l.classList.remove('bg-white/20', 'bg-teal-50', 'text-teal-600', 'active');
      // Si el bot�n est� en el sidebar y no es el activo, restaurar su estilo original de texto blanco
      if (!l.classList.contains('active')) {
        l.classList.add('text-white');
      }
    });

    const activeLink = document.querySelector(`[data-section="${target}"]`);
    if (activeLink) {
      activeLink.classList.add('bg-white/20', 'active');
      activeLink.classList.remove('text-white');
    }
    
    // 2. Manejo de visibilidad de secciones (ESCENARIO)
    sections.forEach(s => {
      s.classList.add('hidden');
      s.classList.remove('active');
    });

    const sectionEl = document.getElementById(target);
    if (sectionEl) {
      sectionEl.classList.remove('hidden');
      sectionEl.classList.add('active'); 
    } else {

    }
    
    AppState.set('currentSection', target);

    // ?? Marcar badge como le�do al entrar a la secci�n
    BadgeSystem.mark(target);

    // 3. Cerrar sidebar en m�vil autom�ticamente al cambiar de secci�n
    const sidebar = document.getElementById('sidebar');
    if (sidebar && window.innerWidth < 768) {
      sidebar.classList.remove('mobile-visible');
      const ov = document.getElementById('sidebarOverlay');
      if (ov) ov.style.display = 'none';
    }

    // ? --- L�GICA DE CARGA PEREZOSA (LAZY LOADING) ---
    if (!loadedSections.has(target)) {
      try {
        switch (target) {
          case 'pagos':
            await PaymentsModule.init();
            import('../shared/payment-queue.js').then(m =>
              m.PaymentQueue.init('payment-queue-container')
            ).catch(() => {});
            break;
          case 'accesos':
            await AccessModule.init();
            document.getElementById('btnExteriorMode')?.addEventListener('click', () => AccessModule.toggleExteriorMode());
            break;
          case 'maestros':
            await TeachersModule.init();
            break;
          case 'estudiantes':
            await StudentsModule.init();
            break;
          case 'aulas':
            await RoomsModule.init();
            break;
          case 'muro':
            WallModule.init('muroPostsContainer', { accentColor: 'teal', likeColor: 'emerald' }, AppState);
            break;
          case 'staff-permits':
            import('../directora/permits.module.js').then(m => {
              window.App.permits = m.PermitsModule;
              m.PermitsModule.init();
            });
            break;
          case 'chat':
            await initAssistantChat();
            break;
          case 'videocall': {
            const vcProfile = AppState.get('profile') || {};
            import('../shared/videocall-ui.js').then(({ VideoCallUI }) => {
              VideoCallUI.renderSection('videocall-asistente-section', {
                role: 'asistente',
                userName: vcProfile?.name || 'Asistente',
                classroomId: null
              });
            }).catch(() => {});
            break;
          }
          case 'perfil':
            initProfile();
            import('../shared/notify-permission.js').then(m => m.NotifyPermission.requestIfNeeded());
            break;
        }
        loadedSections.add(target);
      } catch (err) {

        Helpers.toast(`Error al cargar ${target}`, 'error');
      }
    } else {
      // Re-cargar datos frescos al volver a una secci�n ya visitada
      switch (target) {
        case 'maestros':   TeachersModule.loadTeachers?.(); break;
        case 'estudiantes': StudentsModule.loadStudents?.(); break;
        case 'aulas':      RoomsModule.loadRooms?.(); break;
        case 'pagos':      PaymentsModule.loadPayments?.(); break;
      }
    }
  };

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      showSection(link.dataset.section);
    });
  });

  // Carga inicial del dashboard
  DashboardModule.init().then(() => loadedSections.add('dashboard'));
  showSection('dashboard');

  // -- Hamburger m�vil ------------------------------------------------------
  const menuBtn = document.getElementById('menuBtn');
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebarOverlay');

  const _openSidebar = () => {
    sidebar?.classList.add('mobile-visible');
    if (overlay) overlay.style.display = 'block';
  };
  const _closeSidebar = () => {
    sidebar?.classList.remove('mobile-visible');
    if (overlay) overlay.style.display = 'none';
  };

  if (menuBtn) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar?.classList.contains('mobile-visible') ? _closeSidebar() : _openSidebar();
    });
  }
  if (overlay) {
    overlay.addEventListener('click', _closeSidebar);
  }

  // Cerrar sidebar al hacer click en el main (m�vil)
  document.getElementById('layoutShell')?.addEventListener('click', () => {
    if (window.innerWidth < 768 && sidebar?.classList.contains('mobile-visible')) {
      _closeSidebar();
    }
  });

  // -- Colapsar sidebar desktop ---------------------------------------------
  const toggleBtn   = document.getElementById('toggleSidebar');
  const wrapper     = sidebar?.closest('.app-content-wrapper') || document.querySelector('.app-content-wrapper');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      wrapper?.classList.toggle('sidebar-collapsed');
    });
  }
}



/**
 * Perfil del Asistente
 */
async function initProfile() {
  const profile = AppState.get('profile');
  if (!profile) return;

  // Fetch fresh profile with access_code from DB
  const { data: freshProfile } = await supabase
    .from('profiles')
    .select('id, name, email, phone, bio, avatar_url, access_code, role')
    .eq('id', profile.id)
    .maybeSingle();
  const p = freshProfile || profile;

  const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };
  setVal('profileName', p.name);
  setVal('profilePhone', p.phone);
  setVal('profileEmail', p.email);
  setVal('profileBio', p.bio || '');

  // Avatar
  const avatarInput   = document.getElementById('profileAvatarInput');
  const avatarPreview = document.getElementById('profileAvatarPreview');
  if (avatarPreview && p.avatar_url) {
    avatarPreview.src = p.avatar_url;
  }
  if (avatarInput) {
    avatarInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file && avatarPreview) {
        const reader = new FileReader();
        reader.onload = (ev) => { avatarPreview.src = ev.target.result; };
        reader.readAsDataURL(file);
      }
    };
  }

  // -- QR de Acceso Personal --------------------------------------------------
  const code = p.access_code || (p.notes?.startsWith?.('TEA-') || p.notes?.startsWith?.('ASI-') ? p.notes : null);
  const codeInput = document.getElementById('profileAccessCode');
  if (codeInput && code) codeInput.value = code;

  const _loadQR = () => new Promise(r => {
    if (window.QRCode) { r(); return; }
    const s = document.createElement('script');
    s.src = 'js/shared/qrcode.min.js';
    s.onload = r; document.head.appendChild(s);
  });

  const _renderProfileQR = async (c) => {
    const container = document.getElementById('profileQrContainer');
    if (!container || !c) return;
    await _loadQR();
    container.innerHTML = '';
    new window.QRCode(container, {
      text: JSON.stringify({ matricula: c, name: p.name, type: 'karpus-staff', v: 1 }),
      width: 130, height: 130, colorDark: '#1e293b', colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.H
    });
  };

  if (code) setTimeout(() => _renderProfileQR(code), 300);

  window._genProfileAccessCode = async () => {
    const prefix = p.role === 'directora' ? 'DIR' : p.role === 'asistente' ? 'ASI' : 'TEA';
    const newCode = `${prefix}-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    if (codeInput) codeInput.value = newCode;
    // Save immediately
    const { error } = await supabase.from('profiles').update({ access_code: newCode }).eq('id', p.id);
    if (!error) {
      Helpers.toast('C�digo de acceso guardado', 'success');
      AppState.set('profile', { ...AppState.get('profile'), access_code: newCode });
      _renderProfileQR(newCode);
    } else {
      Helpers.toast('Error al guardar c�digo: ' + error.message, 'error');
    }
  };

  window._printProfileQR = () => {
    const c = document.getElementById('profileAccessCode')?.value?.trim();
    const container = document.getElementById('profileQrContainer');
    const img = container?.querySelector('img')?.src || container?.querySelector('canvas')?.toDataURL();
    if (!img || !c) { Helpers.toast('Genera el QR primero', 'warning'); return; }
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>Carnet ${p.name}</title>
      <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
      .card{border:4px solid #0d9488;border-radius:20px;padding:24px;text-align:center;max-width:260px;}
      .hdr{background:#0d9488;color:white;margin:-24px -24px 16px;padding:12px;border-radius:16px 16px 0 0;font-weight:900;font-size:12px;text-transform:uppercase;}
      img{width:160px;height:160px;border-radius:8px;}.name{font-size:16px;font-weight:900;color:#1e293b;margin-top:12px;}
      .role{font-size:11px;color:#0d9488;font-weight:800;text-transform:uppercase;margin-top:2px;}
      .code{font-size:10px;color:#64748b;font-weight:700;margin-top:8px;}</style>
    </head><body><div class="card">
      <div class="hdr">STAFF � KARPUS KIDS</div>
      <img src="${img}">
      <div class="name">${p.name || 'Personal'}</div>
      <div class="role">${p.role || 'Asistente'}</div>
      <div class="code">ID: ${c}</div>
    </div><script>window.onload=()=>window.print()<\/script></body></html>`);
    win.document.close();
  };

  // -- Form submit ------------------------------------------------------------
  const form = document.getElementById('profileForm');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
      try {
        const updates = {
          name:  document.getElementById('profileName')?.value?.trim(),
          phone: document.getElementById('profilePhone')?.value?.trim(),
          bio:   document.getElementById('profileBio')?.value?.trim()
        };
        const file = avatarInput?.files[0];
        if (file) {
          const ext  = file.name.split('.').pop();
          const path = `avatars/${p.id}_${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage.from('karpus-uploads').upload(path, file);
          if (upErr) throw upErr;
          const { data: { publicUrl } } = supabase.storage.from('karpus-uploads').getPublicUrl(path);
          updates.avatar_url = publicUrl;
          const sidebarAvatar = document.getElementById('sidebarAvatar');
          if (sidebarAvatar) sidebarAvatar.src = publicUrl;
          if (avatarPreview) avatarPreview.src = publicUrl;
        }
        const { error } = await supabase.from('profiles').update(updates).eq('id', p.id);
        if (error) throw error;
        Helpers.toast('Perfil actualizado correctamente', 'success');
        AppState.set('profile', { ...AppState.get('profile'), ...updates });
        const nameDisplay = document.getElementById('profileNameDisplay');
        const sidebarName = document.getElementById('sidebarUserName');
        if (nameDisplay) nameDisplay.textContent = updates.name;
        if (sidebarName)  sidebarName.textContent  = updates.name;
      } catch (err) {
        Helpers.toast('Error al guardar perfil: ' + (err.message || ''), 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar Cambios'; }
      }
    };
  }

  if (window.lucide) lucide.createIcons();
}

// --- Funciones Globales de Ventana ---
