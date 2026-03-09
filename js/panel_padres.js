
import { supabase, initOneSignal } from './supabase.js';

// ===== CONSTANTES ESTÁNDAR =====
const TABLES = {
  PROFILES: 'profiles',
  STUDENTS: 'students',
  TASKS: 'tasks',
  TASK_EVIDENCES: 'task_evidences',
  ATTENDANCE: 'attendance',
  ATTENDANCE_REQUESTS: 'attendance_requests',
  POSTS: 'posts',
  LIKES: 'likes',
  COMMENTS: 'comments',
  GRADES: 'grades',
  MESSAGES: 'messages'
};
const STORAGE_BUCKETS = { CLASSROOM_MEDIA: 'classroom_media' };
const DATE_FORMAT = { locale: 'es-ES', options: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' } };
const TOAST_DURATION = 2800;
const MODAL_CLOSE_KEYS = ['Escape', 'Esc'];

// ===== UTILIDADES SEGURAS =====
const escapeHtmlMap = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
};
const escapeHtml = (str) => {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, m => escapeHtmlMap[m]);
};

const Helpers = {
  // ✅ TOAST MEJORADO: stacking, accesibilidad, remoción segura
  toast: ((() => {
    let toastCount = 0;
    return (message, type = 'success') => {
      const toastId = `toast-${Date.now()}-${toastCount++}`;
      const map = { success: 'bg-emerald-500', error: 'bg-rose-500', info: 'bg-sky-500' };
      const color = map[type] || map.info;
      
      const toast = document.createElement('div');
      toast.id = toastId;
      toast.setAttribute('role', 'alert');
      toast.setAttribute('aria-live', 'polite');
      toast.className = `fixed bottom-6 right-6 ${color} text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 z-[100] transition-all opacity-0 translate-y-2`;
      toast.innerHTML = `<span class="text-sm font-medium">${escapeHtml(message)}</span>`;
      
      document.body.appendChild(toast);
      
      // Animación de entrada
      requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', 'translate-y-2');
        toast.classList.add('opacity-100', 'translate-y-0');
      });

      // Animación de salida
      setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        toast.classList.remove('opacity-100', 'translate-y-0');
        setTimeout(() => {
          if (document.getElementById(toastId)) document.body.removeChild(toast);
        }, 300);
      }, TOAST_DURATION);
    };
  })()),
  
  emptyState: (msg) => 
    `<div class="text-center py-12 text-slate-400" role="status" aria-label="Sin contenido">
      <div class="mx-auto mb-4 w-14 h-14 text-sky-300">🙂</div>
      <p class="text-sm font-medium">${escapeHtml(msg)}</p>
    </div>`,
  
  skeleton: (count = 3, height = 'h-16') => 
    Array.from({ length: count }, () => 
      `<div class="animate-pulse bg-slate-100 rounded-xl ${height} w-full mb-3" role="status" aria-busy="true"></div>`
    ).join('')
};

// ===== ESTADO CON CONTROL DE ACCESO =====
class SafeAppState {
  constructor() {
    this._state = { 
      user: null, profile: null, student: null, tasks: [], 
      globalChannel: null, feedChannel: null, liveChannel: null,
      chatChannel: null, currentChatUser: null,
      feedPage: 0, feedHasMore: true
    };
  }
  
  get(key) { return this._state[key]; }
  set(key, value) { 
    if (key in this._state) this._state[key] = value; 
    else console.warn(`AppState: Clave inválida ${key}`);
  }
  
  reset() {
    const channels = [
      this._state.globalChannel,
      this._state.feedChannel,
      this._state.liveChannel,
      this._state.chatChannel
    ];

    channels.forEach(c => {
      if(c) supabase.removeChannel(c);
    });

    this._state = { 
      user: null, profile: null, student: null, tasks: [], 
      globalChannel: null, feedChannel: null, liveChannel: null,
      chatChannel: null, currentChatUser: null,
      feedPage: 0, feedHasMore: true
    };
  }
}
const AppState = new SafeAppState();

// ✅ 2. CACHE GLOBAL (Optimización)
const GlobalCache = {
  store: {},
  maxItems: 50,
  set(key, data) {
    if (Object.keys(this.store).length > this.maxItems) {
      const oldest = Object.keys(this.store)[0];
      delete this.store[oldest];
    }
    this.store[key] = { data, time: Date.now() };
  },
  get(key, maxAge = 60000) { // 1 minuto por defecto
    const item = this.store[key];
    if (!item) return null;
    if (Date.now() - item.time > maxAge) { delete this.store[key]; return null; }
    return item.data;
  },
  clear(key) { if(key) delete this.store[key]; else this.store = {}; }
};

async function sendEmail(to, subject, html, text) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    // Usar Edge Function de Supabase
    const res = await fetch('https://wwnfonkvemimwiqjpkij.supabase.co/functions/v1/send-email', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`
      },
      body: JSON.stringify({ to, subject, html, text })
    });
    if (!res.ok) {
      console.error('Error HTTP enviando correo', res.status);
    }
  } catch (e) {
    console.error('Error enviando correo', e);
  }
}

// ===== MEJORAS PARA SIDEBAR MÓVIL ===== 
function setupSidebarMobile() { 
  const nav = document.querySelector('nav.sidebar-nav'); 
  if (!nav) return; 
  
  nav.style.scrollBehavior = "smooth";
  
  // Detectar si hay scroll horizontal 
  const checkScroll = () => { 
    const hasScroll = nav.scrollWidth > nav.clientWidth; 
    nav.setAttribute('data-has-scroll', hasScroll); 
    
    // Indicar posición del scroll 
    const atStart = nav.scrollLeft === 0; 
    const atEnd = nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2; 
    
    nav.setAttribute('data-at-start', atStart); 
    nav.setAttribute('data-at-end', atEnd); 
  }; 
  
  // Verificar scroll al cargar y al redimensionar 
  checkScroll(); 
  window.addEventListener('resize', checkScroll); 
  nav.addEventListener('scroll', checkScroll); // Actualizar al hacer scroll
  
  // Smooth scroll para botones 
  nav.addEventListener('wheel', (e) => { 
    if (window.innerWidth <= 767) { 
      e.preventDefault(); 
      nav.scrollLeft += e.deltaY; 
    } 
  }, { passive: false }); 
  
  // Indicadores táctiles para iOS 
  let touchStartX = 0; 
  let touchEndX = 0; 
  
  nav.addEventListener('touchstart', (e) => { 
    touchStartX = e.changedTouches[0].screenX; 
  }); 
  
  nav.addEventListener('touchend', (e) => { 
    touchEndX = e.changedTouches[0].screenX; 
    handleSwipe(); 
  }); 
  
  function handleSwipe() { 
    const diff = touchEndX - touchStartX; 
    if (Math.abs(diff) > 50) { // Umbral de swipe 
      if (diff > 0 && nav.scrollLeft > 0) { 
        // Swipe derecha - scroll izquierda 
        nav.scrollBy({ left: -100, behavior: 'smooth' }); 
      } else if (diff < 0 && nav.scrollLeft < nav.scrollWidth - nav.clientWidth) { 
        // Swipe izquierda - scroll derecha 
        nav.scrollBy({ left: 100, behavior: 'smooth' }); 
      } 
    } 
  } 
}

// ===== SCROLL TO TOP ===== 
function setupScrollToTop() { 
  const btn = document.getElementById('scrollTopBtn'); 
  if (!btn) return; 
  
  window.addEventListener('scroll', () => { 
    btn.style.display = window.scrollY > 300 ? 'block' : 'none'; 
  }); 
  
  btn.addEventListener('click', () => { 
    window.scrollTo({ top: 0, behavior: 'smooth' }); 
  }); 
}

// ===== INICIALIZACIÓN PRINCIPAL =====
document.addEventListener('DOMContentLoaded', async () => {
  // ✅ Registro SW con manejo de errores explícito
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
    } catch (err) {
      console.warn('Error registrando Service Worker:', err);
    }
  }

  // ✅ Verificación de autenticación con redirección SEGURA
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    console.error('Error de autenticación:', authError?.message || 'Usuario no autenticado');
    window.location.href = 'login.html';
    return;
  }
  AppState.set('user', user);

  // ✅ Iniciar OneSignal con el usuario ya cargado (Evita error de Lock)
  try { initOneSignal(user); } catch(e) { console.warn("OneSignal init error:", e); }

  // ✅ Cargar perfil con manejo de errores robusto
  try {
    const { data: profile, error } = await supabase
      .from(TABLES.PROFILES)
      .select('*')
      .eq('id', user.id)
      .single();
    
    if (error) throw error;
    AppState.set('profile', profile);
    
    // Actualizar nombre en UI
    document.querySelectorAll('.guardian-name-display').forEach(el => {
      el.textContent = profile?.name ? escapeHtml(profile.name) : 'Familia';
    });
    
    loadStudentData();
  } catch (err) {
    console.error('Error cargando perfil:', err);
    Helpers.toast('Error al cargar tu información', 'error');
    // No redirigir - permitir acceso limitado
  }

  // ✅ Configurar navegación con delegación de eventos
  setupNavigation();
  setupGlobalListeners();
  
  // ✅ Fecha con formato estandarizado
  const dateDisplay = document.getElementById('currentDateDisplay');
  if (dateDisplay) {
    dateDisplay.textContent = new Date().toLocaleDateString(
      DATE_FORMAT.locale, 
      DATE_FORMAT.options
    );
  }
  
  // ✅ Inicialización diferida de módulos
  initAbsenceModule();
  initTaskSubmissionModule();
  setupProfilePhotoUpload();
  // initFeedRealtime() e initNotifications() se mueven a loadStudentData para asegurar que existe el estudiante
  setupSidebarMobile();
  setupScrollToTop();

  // ✅ Listeners para perfil y reportes
  const btnSave = document.getElementById('btnSaveChanges');
  if (btnSave) {
    btnSave.onclick = saveAllProfile;
  }
  
  // ✅ Botón de refresco manual
  const btnRefresh = document.getElementById('btnRefreshData');
  if (btnRefresh) {
    btnRefresh.onclick = () => {
      const activeSection = document.querySelector('.section.active')?.id || 'home';
      // Limpiar cache y estado de carga para forzar recarga
      loadedSections.delete(activeSection);
      if(activeSection === 'tasks') { GlobalCache.clear('tasks'); GlobalCache.clear('evidences'); }
      if(activeSection === 'live-attendance') GlobalCache.clear('attendance');
      if(activeSection === 'payments') GlobalCache.clear('payments');
      if(activeSection === 'grades') GlobalCache.clear('grades');
      
      loadSectionData(activeSection, true);
    };
  }
  
  // ✅ 1. LAZY LOAD (Inicialización)
  // ✅ Cargar sección inicial
  setActiveSection('home');
  loadDashboard();
  
  // Acciones principales
  const btnPay = document.getElementById('btnPayTuition');
  if (btnPay) {
    btnPay.onclick = (e) => {
      e.preventDefault();
      setActiveSection('payments');
    };
  }
});

// ✅ Función centralizada de cambio de sección (Movida fuera de setupNavigation)
window.setActiveSection = (targetId) => {
  const sections = document.querySelectorAll('.section');
  const navButtons = document.querySelectorAll('[data-target]');

  // Ocultar todas las secciones
  sections.forEach(sec => {
    sec.classList.add('hidden');
    sec.classList.remove('active');
    sec.setAttribute('aria-hidden', 'true');
  });
  
  // Remover estado activo de botones
  navButtons.forEach(btn => btn.classList.remove('active', 'font-bold'));
  
  // Mostrar sección objetivo
  const targetSection = document.getElementById(targetId);
  if (targetSection) {
    targetSection.classList.remove('hidden');
    targetSection.classList.add('active');
    targetSection.setAttribute('aria-hidden', 'false');
    
    // Cargar datos específicos de la sección
    loadSectionData(targetId);
  }
  
  // Actualizar botón activo
  const activeBtn = document.querySelector(`button[data-target="${targetId}"]`);
  if (activeBtn) {
    activeBtn.classList.add('active', 'font-bold');
    activeBtn.setAttribute('aria-current', 'page');
  } else {
    navButtons.forEach(btn => btn.removeAttribute('aria-current'));
  }
};

// ===== NAVEGACIÓN Y GESTIÓN DE SECCIONES =====
function setupNavigation() {
  const navButtons = document.querySelectorAll('[data-target]');
  const sections = document.querySelectorAll('.section');
  const headerAvatar = document.getElementById('headerAvatar');
  const btnLogout = document.getElementById('btnLogout');

  // ✅ Delegación de eventos para navegación
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-target]');
    if (!btn) return;
    if (btn.dataset.target) {
      e.preventDefault();
      setActiveSection(btn.dataset.target);
    }
  });

  if (headerAvatar) {
    headerAvatar.onclick = (e) => {
      e.stopPropagation();
      setActiveSection('profile');
    };
  }

  if (btnLogout) {
    btnLogout.onclick = handleLogout;
  }

  // ✅ Prevenir múltiples escuchas globales
  if (window.navigationInitialized) return;
  window.navigationInitialized = true;
}

// ✅ 1. LAZY LOAD (Set de control)
const loadedSections = new Set();

// ✅ Manejo global de errores no capturados (Safety Net)
window.addEventListener('unhandledrejection', event => {
  console.warn('⚠️ Error inesperado:', event.reason);
  // Opcional: Helpers.toast('Ocurrió un problema técnico', 'error');
});

// ✅ Carga diferida de datos por sección
async function loadSectionData(sectionId, forceRefresh = false) {
  const loaders = {
    home: loadDashboard,
    'live-attendance': loadAttendance,
    tasks: loadTasks,
    grades: loadGrades,
    class: loadClassFeed,
    payments: () => { loadPayments(); initPaymentForm(); },
    notifications: async () => { await initChatSystem(); },
    profile: async () => { await populateProfile(); },
    videocall: initVideoCall
  };
  
  const loader = loaders[sectionId];
  
  if (!loader) {
    console.warn(`No loader for section ${sectionId}`);
    return;
  }
  
  if (!forceRefresh && loadedSections.has(sectionId)) return;

  const refreshBtn = document.getElementById('btnRefreshData');
  if(refreshBtn) refreshBtn.classList.add('animate-spin');

  try {
    await loader();
    loadedSections.add(sectionId);
  } catch (err) {
    console.error(`Error cargando sección ${sectionId}:`, err);
    Helpers.toast(`Error al cargar ${sectionId}`, 'error');
  } finally {
    if(refreshBtn) refreshBtn.classList.remove('animate-spin');
  }
}

async function notifyPaymentSubmittedEmail(student, amount, month_paid, method) {
  try {
    const user = AppState.get('user');
    const profile = AppState.get('profile');
    const parentEmail = user && user.email;
    const parentName = profile && profile.name ? profile.name : 'Familia Karpus';
    const studentName = student && student.name ? student.name : '';
    const classroomId = student && student.classroom_id;
    const baseUrl = window.location.origin || '';
    const parentLink = `${baseUrl}/panel_padres.html#payments`;
    const assistantLink = `${baseUrl}/panel_asistente.html`;
    const directorLink = `${baseUrl}/panel_directora.html`;
    const monthLabel = month_paid || '';
    if (parentEmail) {
      const subjectParent = `Comprobante de pago recibido (${monthLabel})`;
      const htmlParent = `
        <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#0f172a;">
          <h2 style="color:#16a34a;">Hemos recibido tu comprobante de pago</h2>
          <p>Hola ${escapeHtml(parentName)},</p>
          <p>Registramos un comprobante de pago para ${escapeHtml(studentName || 'tu hija o hijo')}.</p>
          <p><strong>Mes:</strong> ${escapeHtml(monthLabel)}<br><strong>Monto reportado:</strong> $${amount.toFixed(2)}<br><strong>Método:</strong> ${escapeHtml(method)}</p>
          <p>El equipo de Karpus revisará el comprobante y te avisará cuando el pago sea confirmado.</p>
          <p style="margin:24px 0;">
            <a href="${parentLink}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#ffffff;border-radius:999px;text-decoration:none;font-weight:600;">
              Ver estado de mis pagos
            </a>
          </p>
          <p style="font-size:12px;color:#64748b;">Si el botón no funciona, copia y pega esta dirección en tu navegador: ${parentLink}</p>
        </div>
      `;
      const textParent = `Hemos recibido tu comprobante de pago de ${monthLabel} por $${amount.toFixed(2)}. Revisaremos tu pago y podrás ver el estado en tu panel: ${parentLink}`;
      await sendEmail(parentEmail, subjectParent, htmlParent, textParent);
    }
    let classroomName = '';
    let teacherEmail = null;
    if (classroomId) {
      const { data: classroom } = await supabase
        .from('classrooms')
        .select('name, teacher_id')
        .eq('id', classroomId)
        .maybeSingle();
      if (classroom) {
        classroomName = classroom.name || '';
        if (classroom.teacher_id) {
          const { data: teacher } = await supabase
            .from('profiles')
            .select('email, name')
            .eq('id', classroom.teacher_id)
            .maybeSingle();
          teacherEmail = teacher && teacher.email ? teacher.email : null;
        }
      }
    }
    const { data: staff } = await supabase
      .from('profiles')
      .select('email, role')
      .in('role', ['asistente', 'directora']);
    const assistantEmails = (staff || [])
      .filter(p => p.role === 'asistente' && p.email)
      .map(p => p.email);
    const directorEmails = (staff || [])
      .filter(p => p.role === 'directora' && p.email)
      .map(p => p.email);
    const subjectStaff = `Nuevo comprobante de pago enviado (${monthLabel})`;
    const commonHtmlStaff = (roleLabel, link) => `
      <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#0f172a;">
        <h2 style="color:#0f172a;">Nuevo comprobante de pago recibido</h2>
        <p>Se ha registrado un nuevo comprobante de pago${studentName ? ` para ${escapeHtml(studentName)}` : ''}${classroomName ? ` del aula ${escapeHtml(classroomName)}` : ''}.</p>
        <p><strong>Mes:</strong> ${escapeHtml(monthLabel)}<br><strong>Monto reportado:</strong> $${amount.toFixed(2)}<br><strong>Método:</strong> ${escapeHtml(method)}</p>
        <p>Ingresa a tu panel de ${roleLabel} para revisar y validar el pago.</p>
        <p style="margin:24px 0;">
          <a href="${link}" style="display:inline-block;padding:10px 18px;background:#0ea5e9;color:#ffffff;border-radius:999px;text-decoration:none;font-weight:600;">
            Revisar pagos pendientes
          </a>
        </p>
      </div>
    `;
    const textStaff = `Se registró un comprobante de pago${studentName ? ` para ${studentName}` : ''} del mes ${monthLabel} por $${amount.toFixed(2)}. Revisa los pagos pendientes en tu panel.`;
    if (teacherEmail) {
      const subjectTeacher = `Tu grupo tiene un nuevo comprobante de pago (${monthLabel})`;
      const htmlTeacher = commonHtmlStaff('maestra', `${baseUrl}/panel-maestra.html`);
      await sendEmail(teacherEmail, subjectTeacher, htmlTeacher, textStaff);
    }
    await Promise.all(assistantEmails.map(email => 
      sendEmail(email, subjectStaff, commonHtmlStaff('asistente', assistantLink), textStaff)
    ));
    await Promise.all(directorEmails.map(email => 
      sendEmail(email, subjectStaff, commonHtmlStaff('directora', directorLink), textStaff)
    ));
  } catch (e) {
    console.error('Error enviando correos de comprobante de pago', e);
  }
}

async function submitPaymentProof(e) {
  e.preventDefault();
  const student = AppState.get('student');
  if (!student) return;
  const file = document.getElementById('paymentFileInput').files[0];
  const amount = parseFloat(document.getElementById('paymentAmount').value || '0');
  const month_paid = document.getElementById('paymentMonth').value.trim();
  const method = document.getElementById('paymentMethod').value;
  if (!file || !amount || !month_paid) {
    Helpers.toast('Completa todos los campos', 'error');
    return;
  }
  
  // ✅ Validación de tipo de archivo
  const allowed = ['image/jpeg','image/png','image/webp'];
  if(!allowed.includes(file.type)){
    Helpers.toast('Formato no permitido (solo JPG, PNG, WEBP)', 'error');
    return;
  }

  try {
    const ext = file.name.split('.').pop();
    const name = `${student.id}_${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('classroom_media').upload(`payments/${name}`, file);
    if (upErr) throw upErr;
    const { data } = await supabase.storage.from('classroom_media').createSignedUrl(`payments/${name}`, 31536000); // 1 año
    const { error } = await supabase.from('payments').insert({
      student_id: student.id,
      amount,
      month_paid,
      method,
      proof_url: data?.signedUrl,
      status: 'pendiente'
    });
    if (error) throw error;
    Helpers.toast('Comprobante enviado', 'success');
    await notifyPaymentSubmittedEmail(student, amount, month_paid, method);
    loadPayments();
    document.getElementById('paymentForm').reset();
  } catch (err) {
    console.error(err);
    Helpers.toast('Error enviando comprobante', 'error');
  }
}

// Inicialización de pagos y chat movida a loadSectionData para evitar duplicidad de listeners
function initPaymentForm() {
  const form = document.getElementById('paymentForm');
  if (form && !form.dataset.initialized) {
    form.addEventListener('submit', submitPaymentProof);
    form.dataset.initialized = 'true';
  }
}

// ===== CIERRE DE SESIÓN SEGURO =====
async function handleLogout() {
  try {
    // ✅ Limpiar estado y suscripciones ANTES de cerrar sesión
    AppState.reset();
    
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  } catch (err) {
    console.error('Error al cerrar sesión:', err);
    Helpers.toast('Error al cerrar sesión. Intenta nuevamente.', 'error');
  }
}

// ===== MÓDULO DE ASISTENCIA MEJORADO =====
function initAbsenceModule() {
  const modal = document.getElementById('modalAbsence');
  const form = document.getElementById('formAbsence');
  
  if (!modal || !form) return;
  
  // ✅ Cierre de modal con Escape y clic fuera
  setupModalAccessibility(modal);
  
  document.getElementById('btnQuickAbsence')?.addEventListener('click', () => {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('absenceDate');
    if (dateInput) dateInput.value = today;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-modal', 'true');
    modal.focus();
  });
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // ✅ Validación frontend robusta
    const date = document.getElementById('absenceDate').value;
    const reason = document.getElementById('absenceReason').value.trim();
    const note = document.getElementById('absenceNote').value.trim();
    
    if (!date || !reason) {
      Helpers.toast('Fecha y motivo son obligatorios', 'error');
      return;
    }
    
    if (!AppState.get('student')?.id) {
      Helpers.toast('Error: Estudiante no identificado', 'error');
      return;
    }
    
    try {
      const { error } = await supabase
        .from(TABLES.ATTENDANCE_REQUESTS)
        .insert({
          student_id: AppState.get('student').id,
          date,
          reason,
          note: note || null,
          status: 'pending'
        });
      
      if (error) throw error;
      
      Helpers.toast(`Reporte enviado para ${new Date(date).toLocaleDateString('es-ES')}`, 'success');
      modal.classList.add('hidden');
      form.reset();
    } catch (err) {
      console.error('Error enviando reporte:', err);
      Helpers.toast('Error al enviar reporte. Verifica los datos.', 'error');
    }
  });
}

// ===== CARGA DE DATOS DEL ESTUDIANTE =====
async function loadStudentData() {
  try {
    let student = GlobalCache.get("student");

    if (!student) {
      const { data, error } = await supabase
        .from(TABLES.STUDENTS)
        .select(`
          *,
          classrooms(name, level, teacher_id)
        `)
        .eq('parent_id', AppState.get('user').id)
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      student = data;
      if (student) GlobalCache.set("student", student, 300000); // 5 min cache
    }
    
    if (!student) {
      Helpers.toast('No hay estudiante vinculado a tu cuenta', 'info');
      updateStudentUI(null);
      return;
    }
    
    AppState.set('student', student);
    updateStudentUI(student);
    
    // ✅ Iniciar servicios que dependen del estudiante
    initGlobalRealtime();
    initFeedRealtime();
    initLiveClassListener(student.classroom_id);
  } catch (err) {
    console.error('Error cargando datos del estudiante:', err);
    Helpers.toast('Error al cargar información del estudiante', 'error');
    updateStudentUI(null);
  }
}

// ✅ Separación de lógica UI/estado
function updateStudentUI(student) {
  const displayName = student?.name ? escapeHtml(student.name) : 'No asignado';
  
  // Fix: Manejar si classrooms es array o objeto
  const cls = Array.isArray(student?.classrooms) ? student.classrooms[0] : student?.classrooms;
  const classroomInfo = cls 
    ? (cls.level ? `${escapeHtml(cls.name)} • ${escapeHtml(cls.level)}` : escapeHtml(cls.name))
    : 'Sin aula asignada';
  
  document.querySelectorAll('.student-name-display').forEach(el => {
    el.textContent = displayName;
    el.setAttribute('aria-label', `Estudiante: ${displayName}`);
  });
  
  document.querySelectorAll('.classroom-name-display').forEach(el => {
    el.textContent = classroomInfo;
  });
  
  const sidebarName = document.getElementById('sidebar-student-name');
  if (sidebarName) sidebarName.textContent = displayName;

  const avatarUrl = student?.avatar_url || 'img/mundo.jpg';
  const sidebarAvatar = document.getElementById('sidebarAvatar');
  if (sidebarAvatar) sidebarAvatar.src = avatarUrl;
  const preview = document.getElementById('studentAvatarPreview');
  if (preview) preview.innerHTML = `<img src="${avatarUrl}" class="w-full h-full object-cover">`;
  const headerAvatar = document.getElementById('headerStudentAvatar');
  if (headerAvatar) headerAvatar.innerHTML = `<img src="${avatarUrl}" alt="Avatar" class="w-full h-full object-cover">`;

  const mobileAvatar = document.getElementById('headerAvatarMobile');
  if (mobileAvatar) mobileAvatar.innerHTML = `<img src="${avatarUrl}" alt="Avatar" class="w-full h-full object-cover">`;
}

// ===== LISTENER CLASE EN VIVO (BADGE) =====
async function initLiveClassListener(classroomId) {
    const btn = document.querySelector('button[data-target="videocall"]');
    if(!btn) return;

    const checkStatus = async () => {
        const { data } = await supabase.from('classrooms').select('is_live').eq('id', classroomId).single();
        updateBadge(data?.is_live);
    };

    const updateBadge = (isLive) => {
        const existingBadge = btn.querySelector('.live-badge');
        if (isLive) {
            if (!existingBadge) {
                btn.innerHTML += `<span class="live-badge ml-2 flex h-3 w-3 relative"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span></span>`;
            }
        } else {
            if (existingBadge) existingBadge.remove();
        }
    };

    // Check inicial
    checkStatus();

    // Suscripción a cambios
    const channel = supabase.channel('classroom_live_' + classroomId)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'classrooms', filter: `id=eq.${classroomId}` }, (payload) => {
            updateBadge(payload.new.is_live);
            if(payload.new.is_live) Helpers.toast('¡La clase ha comenzado!', 'info');
        })
        .subscribe();
        
    AppState.set('liveChannel', channel);
}

// ===== TAREAS CON DELEGACIÓN DE EVENTOS =====
async function loadTasks(filter = 'pending') {
  const container = document.getElementById('tasksList');
  if (!container) return;
  
  container.innerHTML = Helpers.skeleton(3, 'h-24');
  container.setAttribute('aria-busy', 'true');
  
  try {
    const student = AppState.get('student');
    if (!student?.classroom_id) {
      container.innerHTML = Helpers.emptyState('No hay aula asignada');
      container.setAttribute('aria-busy', 'false');
      return;
    }
    
    // ✅ 2. CACHE GLOBAL (Uso en Tareas)
    let tasksData = GlobalCache.get('tasks');
    let evidencesData = GlobalCache.get('evidences');

    if (!tasksData || !evidencesData) {
      const [tasksRes, evidencesRes] = await Promise.all([
        supabase
          .from(TABLES.TASKS)
          .select('*')
          .eq('classroom_id', student.classroom_id)
          .order('due_date', { ascending: true }),
        supabase
          .from(TABLES.TASK_EVIDENCES)
          .select('*')
          .eq('student_id', student.id)
      ]);

      if (tasksRes.error || evidencesRes.error) throw new Error('Error fetching data');
      
      tasksData = tasksRes.data || [];
      evidencesData = evidencesRes.data || [];
      
      GlobalCache.set('tasks', tasksData);
      GlobalCache.set('evidences', evidencesData);
    }
    
    AppState.set('tasks', tasksData);
    const evidenceMap = new Map(evidencesData.map(e => [e.task_id, e]));
    
    // ✅ Filtrado con función pura
    const filteredTasks = filterTasks(tasksData, evidenceMap, filter);
    
    if (filteredTasks.length === 0) {
      container.innerHTML = Helpers.emptyState(
        filter === 'pending' ? '¡Todo al día! No hay tareas pendientes' : 'No hay entregas recientes'
      );
      container.setAttribute('aria-busy', 'false');
      return;
    }
    
    // ✅ Renderizado con escapeHtml en TODO contenido
    container.innerHTML = filteredTasks.map(task => renderTaskCard(task, evidenceMap)).join('');
    container.setAttribute('aria-busy', 'false');
    
    // ✅ Actualizar resumen de tareas
    const summary = document.getElementById('tasksSummary');
    if (summary) {
      const pendingCount = filterTasks(tasksData, evidenceMap, 'pending').length;
      summary.textContent = pendingCount > 0 ? `Tienes ${pendingCount} tareas pendientes` : '¡Estás al día!';
    }
    
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error cargando tareas:', err);
    container.innerHTML = Helpers.emptyState('Error al cargar tareas. Intenta nuevamente.');
    container.setAttribute('aria-busy', 'false');
  }
}

// ✅ Funciones puras para lógica de negocio
function filterTasks(tasks, evidenceMap, filter) {
  const today = new Date();
  today.setHours(0,0,0,0);

  return (tasks || []).filter(task => {
    const isDelivered = evidenceMap.has(task.id);
    const dueDate = task.due_date ? new Date(task.due_date) : null;
    const isOverdue = !isDelivered && dueDate && dueDate < today;

    if (filter === 'submitted') return isDelivered;
    if (filter === 'overdue') return isOverdue;
    if (filter === 'pending') return !isDelivered && !isOverdue;
    return true;
  });
}

function isTaskActive(task) {
  if (!task.due_date) return true;
  const dueDate = new Date(task.due_date);
  return dueDate >= new Date().setHours(0,0,0,0);
}

function renderTaskCard(task, evidenceMap) {
  const dueDate = task.due_date ? new Date(task.due_date) : null;
  const evidence = evidenceMap.get(task.id);
  const isDelivered = !!evidence;

  // ✅ 1. TAREAS ENTREGADAS (Listas) - DISEÑO MODERNO ESMERALDA
  if (isDelivered) {
    let gradeColor = 'bg-slate-400';
    let gradeLabel = 'En revisión';
    
    if (evidence.grade_letter === 'A') { gradeColor = 'bg-emerald-500'; gradeLabel = 'Excelente'; }
    else if (evidence.grade_letter === 'B') { gradeColor = 'bg-sky-500'; gradeLabel = 'Muy Bien'; }
    else if (evidence.grade_letter === 'C') { gradeColor = 'bg-amber-500'; gradeLabel = 'Regular'; }

    return `
    <article class="relative bg-emerald-50/50 border border-emerald-100 p-5 rounded-2xl transition-all hover:shadow-md group overflow-hidden" aria-labelledby="task-title-${task.id}">
      <div class="absolute top-0 right-0 w-24 h-24 -mr-8 -mt-8 bg-emerald-100/50 rounded-full blur-2xl"></div>
      
      <div class="flex justify-between items-start gap-3 relative z-10">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full uppercase tracking-wider">Completada</span>
            <span class="text-[10px] text-slate-400 font-medium">${escapeHtml(task.classrooms?.level || '')}</span>
          </div>
          <h3 id="task-title-${task.id}" class="font-bold text-slate-800 text-lg leading-tight group-hover:text-emerald-700 transition-colors">${escapeHtml(task.title)}</h3>
        </div>
        
        <div class="flex flex-col items-end gap-2">
           ${evidence.grade_letter 
             ? `<div class="flex items-center bg-white border border-emerald-100 rounded-xl p-1 shadow-sm pr-3 gap-2">
                  <div class="${gradeColor} w-8 h-8 rounded-lg flex items-center justify-center text-white font-black shadow-sm text-lg">${escapeHtml(evidence.grade_letter)}</div>
                  <div class="flex flex-col">
                    <span class="text-[9px] uppercase font-bold text-slate-400 leading-none">Calificación</span>
                    <span class="text-[11px] font-bold text-slate-600 leading-none mt-1">${gradeLabel}</span>
                  </div>
                </div>` 
             : '<span class="bg-white border border-emerald-100 text-emerald-600 text-[10px] font-bold px-3 py-1.5 rounded-full shadow-sm flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3"></i> En revisión</span>'}
        </div>
      </div>
      
      <p class="text-sm text-slate-600 mt-3 line-clamp-2 relative z-10">${escapeHtml(task.description || 'Sin descripción')}</p>
      
      <div class="mt-5 flex items-center justify-between border-t border-emerald-100 pt-4 relative z-10">
        <div class="flex flex-col">
          <span class="text-[10px] uppercase font-bold text-slate-400 tracking-tight">Fecha de entrega</span>
          <span class="text-xs text-slate-600 font-medium">${new Date(evidence.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
        <button 
          class="js-task-detail-btn px-5 py-2 bg-white border border-emerald-200 text-emerald-700 rounded-xl font-bold text-xs shadow-sm hover:bg-emerald-50 hover:border-emerald-300 transition-all active:scale-95"
          data-task-id="${task.id}"
        >
          Ver mi entrega
        </button>
      </div>
      
      ${evidence.stars ? `
      <div class="mt-3 flex gap-0.5 justify-center bg-white/50 py-1 rounded-full border border-emerald-50">
        ${[...Array(5)].map((_, i) => 
          `<i data-lucide="star" class="w-4 h-4 ${i < evidence.stars ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200 fill-slate-100'}"></i>`
        ).join('')}
      </div>` : ''}
    </article>`;
  }

  // ✅ 2. TAREAS PENDIENTES - DISEÑO MODERNO MINIMALISTA
  const isOverdue = dueDate && dueDate < new Date();
  const statusBg = isOverdue ? 'bg-rose-50 border-rose-100' : 'bg-white border-slate-100';
  const accentColor = isOverdue ? 'rose' : 'blue';

  return `
  <article class="${statusBg} border p-5 rounded-2xl transition-all hover:shadow-lg group relative overflow-hidden" aria-labelledby="task-title-${task.id}">
    ${isOverdue ? '<div class="absolute top-0 left-0 w-1 h-full bg-rose-500"></div>' : ''}
    
    <div class="flex justify-between items-start gap-3">
      <div class="flex-1">
        <div class="flex items-center gap-2 mb-1">
          <span class="px-2 py-0.5 ${isOverdue ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'} text-[10px] font-bold rounded-full uppercase tracking-wider">
            ${isOverdue ? 'Atrasada' : 'Pendiente'}
          </span>
          <span class="text-[10px] text-slate-400 font-medium">${escapeHtml(task.classrooms?.level || '')}</span>
        </div>
        <h3 id="task-title-${task.id}" class="font-bold text-slate-800 text-lg leading-tight group-hover:text-${accentColor}-600 transition-colors">${escapeHtml(task.title)}</h3>
      </div>
      <div class="bg-slate-50 w-10 h-10 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
        ${isOverdue ? '⚠️' : '📝'}
      </div>
    </div>
    
    <p class="text-sm text-slate-600 mt-3 line-clamp-3">${escapeHtml(task.description || 'Sin descripción')}</p>
    
    <div class="mt-5 flex items-center justify-between border-t border-slate-50 pt-4">
      <div class="flex flex-col">
        <span class="text-[10px] uppercase font-bold text-slate-400 tracking-tight">Vence el</span>
        <span class="text-xs ${isOverdue ? 'text-rose-600 font-bold' : 'text-slate-600 font-medium'}">
          ${dueDate ? dueDate.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Sin fecha'}
        </span>
      </div>
      <button 
        class="js-task-detail-btn px-6 py-2.5 ${isOverdue ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-100' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-100'} text-white rounded-xl font-bold text-xs shadow-lg transition-all active:scale-95"
        data-task-id="${task.id}"
      >
        ${isOverdue ? 'Hacer ahora' : 'Realizar tarea'}
      </button>
    </div>
  </article>`;
}

function getStatusLabel(task, evidence, dueDate) {
  if (evidence) return 'Entregada';
  if (dueDate && dueDate < new Date()) return 'Atrasada';
  return 'Pendiente';
}

function getStatusClass(status) {
  const map = {
    'Entregada': 'bg-emerald-100 text-emerald-800',
    'Atrasada': 'bg-rose-100 text-rose-800',
    'Pendiente': 'bg-amber-100 text-amber-800'
  };
  return map[status] || 'bg-slate-100 text-slate-700';
}

// ✅ Función local (NO global) para detalles de tarea
// Implementación completa para abrir el modal y manejar la entrega
async function openTaskDetail(taskId) {
  const modal = document.getElementById('modalTaskDetail');
  if (!modal) return;

  // ✅ Evitar múltiples modales abiertos
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));

  // Resetear UI del modal
  document.getElementById('taskDetailTitle').textContent = 'Cargando...';
  document.getElementById('taskDetailDesc').textContent = '';
  document.getElementById('uploadSection').classList.remove('hidden');
  document.getElementById('evidenceSection').classList.add('hidden');
  
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  try {
    // 1. Cargar Tarea
    const { data: task, error: tErr } = await supabase.from(TABLES.TASKS).select('*').eq('id', taskId).single();
    if (tErr) throw tErr;

    // 2. Cargar Evidencia existente
    const { data: evidence, error: eErr } = await supabase
        .from(TABLES.TASK_EVIDENCES)
        .select('*')
        .eq('task_id', taskId)
        .eq('student_id', AppState.get('student').id)
        .maybeSingle();

    // Renderizar Tarea
    document.getElementById('taskDetailTitle').textContent = task.title;
    document.getElementById('taskDetailDesc').textContent = task.description || 'Sin instrucciones adicionales.';
    document.getElementById('taskDetailDate').textContent = `Vence: ${task.due_date ? new Date(task.due_date).toLocaleDateString() : 'Sin fecha'}`;

    // Renderizar Evidencia si existe
    if (evidence) {
        document.getElementById('uploadSection').classList.add('hidden');
        const evSec = document.getElementById('evidenceSection');
        evSec.classList.remove('hidden');
        document.getElementById('evidenceDate').textContent = `Enviado el: ${new Date(evidence.created_at).toLocaleString()}`;
        document.getElementById('evidenceComment').textContent = evidence.comment ? `"${evidence.comment}"` : '';
        
        const link = document.getElementById('evidenceLink');
        if (evidence.file_url) {
            link.href = evidence.file_url;
            link.classList.remove('hidden');
        } else {
            link.classList.add('hidden');
        }
    } else {
        // Configurar botón de envío
        const btnSubmit = document.getElementById('btnSubmitTask');
        if (btnSubmit) {
          btnSubmit.onclick = () => submitTask(taskId);
        }
    }

  } catch (e) {
    console.error(e);
    Helpers.toast('Error al cargar detalles de la tarea', 'error');
    modal.classList.add('hidden');
  }

  // Cerrar modal
  document.getElementById('btnCloseTaskDetail').onclick = () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
  };
}

async function submitTask(taskId) {
    const comment = document.getElementById('taskCommentInput').value.trim();
    const fileInput = document.getElementById('taskFileInput');
    const file = fileInput.files[0];
    const student = AppState.get('student');
    const user = AppState.get('user');
    
    if(!student || !user){
      Helpers.toast('Sesión inválida', 'error');
      return;
    }
    
    if(!file && !comment) { Helpers.toast('Añade un archivo o comentario', 'info'); return; }
    
    // ✅ Validación de archivo
    if (file) {
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      if (!allowedTypes.includes(file.type)) {
        Helpers.toast('Tipo de archivo no permitido', 'error');
        return;
      }
      
      const allowedExt = ['pdf','jpg','jpeg','png','docx'];
      const ext = file.name.split('.').pop().toLowerCase();

      if(!allowedExt.includes(ext)){
        Helpers.toast('Extensión no permitida', 'error');
        return;
      }
      
      if (file.size > 5 * 1024 * 1024) {
        Helpers.toast('El archivo no debe superar 5MB', 'error');
        return;
      }
    }
    
    const btn = document.getElementById('btnSubmitTask');
    if(!btn){
      console.warn('Submit button not found');
      return;
    }
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    try {
      let fileUrl = null;
      if (file) {
         const ext = file.name.split('.').pop();
         // Ruta segura: evidence/student_id/task_id/timestamp.ext
         const path = `evidence/${student.id}/${taskId}/${Date.now()}.${ext}`;
         const { error: upError } = await supabase.storage.from(STORAGE_BUCKETS.CLASSROOM_MEDIA).upload(path, file);
         if (upError) throw upError;
         
         const { data } = await supabase.storage.from(STORAGE_BUCKETS.CLASSROOM_MEDIA).createSignedUrl(path, 31536000);
         fileUrl = data?.signedUrl;
      }

    // 1. Guardar Evidencia
    const { error: dbError } = await supabase.from(TABLES.TASK_EVIDENCES).insert({
       task_id: taskId,
       student_id: student.id,
       parent_id: user.id,
       comment: comment || null,
       file_url: fileUrl,
       status: 'submitted'
    });

    if (dbError) throw dbError;

    // 2. Limpiar cache local para forzar recarga
    GlobalCache.clear('evidences');
    GlobalCache.clear('tasks');

    Helpers.toast('Tarea enviada con éxito', 'success');
    triggerConfetti(); // 🎉 Animación de celebración
    
    // 3. Cerrar modal y recargar lista
    document.getElementById('modalTaskDetail').classList.add('hidden');
    document.getElementById('modalTaskDetail').classList.remove('flex');
    
    // Cambiar filtro a 'submitted' para que el padre vea su tarea enviada
    const submittedBtn = document.querySelector('.task-filter-btn[data-filter="submitted"]');
    if (submittedBtn) {
        document.querySelectorAll('.task-filter-btn').forEach(b => b.className = 'px-4 py-2 text-xs font-medium rounded-full text-slate-500 hover:bg-slate-50 task-filter-btn transition-all');
        submittedBtn.className = 'px-4 py-2 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700 task-filter-btn transition-all';
    }
    
    loadTasks('submitted');
    } catch (e) {
       console.error('Error enviando tarea:', e);
       Helpers.toast('Error al enviar tarea', 'error');
    } finally {
       btn.disabled = false;
       btn.textContent = originalText;
    }
}

// ✅ Animación de Confeti
function triggerConfetti() {
  if (typeof confetti === 'function') {
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    setTimeout(() => confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0 } }), 250);
    setTimeout(() => confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1 } }), 400);
  }
}

// ===== MEJORAS ADICIONALES CLAVE =====
// ✅ setupModalAccessibility(modal): 
//    - Agrega listeners para Escape y clic fuera
//    - Gestiona enfoque (trap focus)
//    - ARIA attributes
function setupModalAccessibility(modal) {
  if (!modal) return;
  
  const closeBtn = modal.querySelector('[data-close-modal]');
  const handleEscape = (e) => {
    if (MODAL_CLOSE_KEYS.includes(e.key)) closeModal(modal);
  };
  
  const handleClickOutside = (e) => {
    if (e.target === modal) closeModal(modal);
  };
  
  closeBtn?.addEventListener('click', () => closeModal(modal));
  document.addEventListener('keydown', handleEscape);
  modal.addEventListener('click', handleClickOutside);
  
  // Cleanup al destruir (ej: logout)
  return () => {
    document.removeEventListener('keydown', handleEscape);
    modal.removeEventListener('click', handleClickOutside);
  };
}

function closeModal(modal) {
  modal.classList.add('hidden');
  modal.removeAttribute('aria-modal');
  // Restaurar enfoque al botón que abrió el modal (mejora UX)
}

// ✅ initGlobalRealtime(): 
//    - Almacena channel en AppState para limpieza
//    - Valida permisos antes de suscribir
//    - Desuscribe en logout
function initGlobalRealtime() {
  const classroomId = AppState.get('student')?.classroom_id;
  const studentId = AppState.get('student')?.id;
  if (!classroomId) return;

  const notifPrompt = document.getElementById('notification-prompt');
  const enableBtn = document.getElementById('enable-notifications-btn');

  // ✅ 3. REALTIME INTELIGENTE
  const subscribeToRealtime = () => {
    if (AppState.get('globalChannel')) return; // Evitar suscripciones múltiples

    const channel = supabase
      .channel('global-realtime')
      // 1. TAREAS (Nuevas y Actualizaciones)
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: TABLES.TASKS,
          filter: `classroom_id=eq.${classroomId}`
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
             const title = payload.new.title || 'Nueva tarea';
             Helpers.toast(`Nueva tarea: ${escapeHtml(title)}`, 'info');
             if (Notification.permission === 'granted') {
                new Notification('Nueva Tarea', { body: escapeHtml(title), icon: '/logo/favicon.ico' });
             }
          }
          
          // Invalidar cache y recargar si estamos en la vista
          GlobalCache.clear('tasks');
          if (document.getElementById('tasks')?.classList.contains('active')) {
             const activeFilter = document.querySelector('.task-filter-btn.font-bold')?.dataset.filter || 'pending';
             loadTasks(activeFilter);
          }
          if (document.getElementById('home')?.classList.contains('active')) loadDashboard();
        }
      )
      // 2. EVIDENCIAS / CALIFICACIONES
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: TABLES.TASK_EVIDENCES,
          filter: `student_id=eq.${studentId}`
        },
        (payload) => {
           if (payload.new.grade_letter) {
               Helpers.toast(`¡Tarea calificada! Nota: ${payload.new.grade_letter}`, 'success');
           }
           GlobalCache.clear('evidences');
           GlobalCache.clear('grades');
           
           // Actualizar vistas relevantes
           if (document.getElementById('tasks')?.classList.contains('active')) loadTasks();
           if (document.getElementById('grades')?.classList.contains('active')) loadGrades();
           if (document.getElementById('home')?.classList.contains('active')) loadDashboard();
        }
      )
      // 3. ASISTENCIA
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLES.ATTENDANCE,
          filter: `student_id=eq.${studentId}`
        },
        () => {
           GlobalCache.clear('attendance');
           if (document.getElementById('live-attendance')?.classList.contains('active')) loadAttendance();
           if (document.getElementById('home')?.classList.contains('active')) loadDashboard();
        }
      )
      // 4. PAGOS
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLES.PAYMENTS,
          filter: `student_id=eq.${studentId}`
        },
        () => {
           GlobalCache.clear('payments');
           if (document.getElementById('payments')?.classList.contains('active')) loadPayments();
           if (document.getElementById('home')?.classList.contains('active')) loadDashboard();
        }
      )
      .subscribe();

    AppState.set('globalChannel', channel);
  };

  if ('Notification' in window) {
    switch (Notification.permission) {
      case 'granted':
        subscribeToRealtime();
        break;
      case 'denied':
        if (notifPrompt) {
          notifPrompt.classList.remove('hidden');
          notifPrompt.innerHTML = `<p class="text-sm text-rose-800 font-medium">Las notificaciones están bloqueadas. Para recibirlas, debes cambiar los permisos en la configuración de tu navegador para este sitio.</p>`;
        }
        break;
      case 'default':
        if (notifPrompt && enableBtn) {
          notifPrompt.classList.remove('hidden');
          enableBtn.onclick = async () => {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
              Helpers.toast('¡Notificaciones habilitadas!', 'success');
              notifPrompt.classList.add('hidden');
              subscribeToRealtime();
            } else {
              Helpers.toast('No se concedió el permiso para notificaciones.', 'info');
            }
          };
        }
        break;
    }
  }
}

// ✅ setupGlobalListeners():
//    - Filtros de asistencia
//    - Eventos globales con delegación
function setupGlobalListeners() {
  // ✅ Prevenir múltiples escuchas globales
  if (window.globalListenersInitialized) return;
  window.globalListenersInitialized = true;

  // Filtro de asistencia con debounce simple
  let attendanceTimeout;
  document.getElementById('attendanceFilter')?.addEventListener('change', (e) => {
    clearTimeout(attendanceTimeout);
    attendanceTimeout = setTimeout(loadAttendance, 300);
  });
  
  // Manejo de errores de red (opcional pero recomendado)
  window.addEventListener('offline', () => Helpers.toast('Conexión perdida', 'error'));
  window.addEventListener('online', () => Helpers.toast('Conexión restaurada', 'success'));

  // ✅ Listener para filtros de tareas
  document.getElementById('tasks')?.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('.task-filter-btn');
    if (filterBtn) {
      // Actualizar estilos botones con indicador VERDE (Emerald)
      document.querySelectorAll('.task-filter-btn').forEach(btn => {
        btn.classList.remove('bg-emerald-100', 'text-emerald-700', 'font-bold', 'shadow-sm');
        btn.classList.add('text-slate-500', 'font-medium');
      });
      filterBtn.classList.remove('text-slate-500', 'font-medium');
      filterBtn.classList.add('bg-emerald-100', 'text-emerald-700', 'font-bold', 'shadow-sm');
      
      loadTasks(filterBtn.dataset.filter);
    }
    
    // ✅ Listener único para detalles de tarea
    const taskDetailBtn = e.target.closest('.js-task-detail-btn');
    if (taskDetailBtn) {
      openTaskDetail(taskDetailBtn.dataset.taskId);
    }
  });

  // ✅ 7. Mejora UX: Enviar comentario con ENTER
  document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && e.target.id?.startsWith('comment-input-')) {
      const postId = e.target.id.replace('comment-input-', '');
      sendComment(postId);
    }
  });

  // ✅ Listener para Chat (Enviar con Enter)
  document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'messageInput') {
      e.preventDefault();
      sendChatMessage();
    }
  });
}

// ===== IMPLEMENTACIÓN DE MÓDULOS FALTANTES =====

function initTaskSubmissionModule() {
  const fileInput = document.getElementById('taskFileInput');
  const nameDisplay = document.getElementById('fileNameDisplay');
  if (fileInput && nameDisplay) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      nameDisplay.textContent = file ? file.name : '';
    });
  }
}

function setupProfilePhotoUpload() {
  const input = document.getElementById('studentAvatarInput');
  if (!input) return;
  
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validación básica
    if (file.size > 2 * 1024 * 1024) {
      Helpers.toast('La imagen no debe superar 2MB', 'error');
      return;
    }
    
    const allowed = ['image/jpeg','image/png','image/webp'];
    if(!allowed.includes(file.type)){
      Helpers.toast('Formato de imagen no permitido', 'error');
      return;
    }

    Helpers.toast('Subiendo foto...', 'info');
    
    try {
      const student = AppState.get('student');
      if (!student) throw new Error('No hay estudiante seleccionado');

      const fileExt = file.name.split('.').pop();
      const fileName = `avatar_${student.id}_${Date.now()}.${fileExt}`;
      
      // 1. Subir a Storage (asumiendo bucket 'classroom_media' o similar)
      const { error: uploadError } = await supabase.storage
        .from('classroom_media') 
        .upload(`avatars/${fileName}`, file);
        
      if (uploadError) throw uploadError;
      
      // 2. Obtener URL pública
      const { data: { publicUrl } } = supabase.storage
        .from('classroom_media')
        .getPublicUrl(`avatars/${fileName}`);

      // 3. Actualizar registro estudiante
      const { error: updateError } = await supabase
        .from(TABLES.STUDENTS)
        .update({ avatar_url: publicUrl }) // ✅ Guardar URL pública, no el nombre de archivo
        .eq('id', student.id);

      if (updateError) throw updateError;

      Helpers.toast('Foto actualizada correctamente', 'success');
      
      // Actualizar UI localmente
      const preview = document.getElementById('studentAvatarPreview');
      if (preview) {
        preview.innerHTML = `<img src="${publicUrl}" class="w-full h-full object-cover">`;
      }
      const sidebarAvatar = document.getElementById('sidebarAvatar');
      if (sidebarAvatar) {
        sidebarAvatar.src = publicUrl;
      }
      const headerAvatar = document.getElementById('headerStudentAvatar');
      if (headerAvatar) {
        headerAvatar.innerHTML = `<img src="${publicUrl}" alt="Avatar" class="w-full h-full object-cover">`;
      }
      
    } catch (err) {
      console.error('Error subiendo foto:', err);
      Helpers.toast('Error al actualizar la foto', 'error');
    }
  });
}

// ===== CARGADORES DE SECCIÓN =====

async function loadDashboard() {
  const container = document.getElementById('dashboardGrid');
  if (!container) return;

  const student = AppState.get('student');
  if (!student) return;
  
  try {
    const today = new Date().toISOString().split('T')[0];

    // ✅ Solicitudes en paralelo para rendimiento
    const [attRes, pendingRes, deliveredRes, debtRes] = await Promise.all([
        // 1. Asistencia HOY
        supabase.from(TABLES.ATTENDANCE).select('status').eq('student_id', student.id).eq('date', today).maybeSingle(),
        // 2. Tareas Pendientes (> hoy)
        supabase.from(TABLES.TASKS).select('id', { count: 'exact', head: true }).eq('classroom_id', student.classroom_id).gte('due_date', today),
        // 3. Tareas Entregadas
        supabase.from(TABLES.TASK_EVIDENCES).select('id', { count: 'exact', head: true }).eq('student_id', student.id),
        // 4. Deuda Total
        supabase.rpc('get_student_total_debt', { p_student_id: student.id })
    ]);

    // ✅ Procesamiento de datos
    
    // Asistencia
    const attStatus = attRes.data?.status;
    let attText = 'Sin registro';
    let attTheme = 'card-slate';
    if (attStatus === 'present') { attText = 'Presente'; attTheme = 'card-green'; }
    else if (attStatus === 'absent') { attText = 'Ausente'; attTheme = 'card-red'; }
    else if (attStatus === 'late') { attText = 'Tardanza'; attTheme = 'card-yellow'; }
    
    const totalDebt = debtRes.data || 0;

    // ✅ Mapeo de Temas Seguro (Tarjetas Blancas con Iconos de Color)
    const themeMap = {
        'card-green':  { iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', border: 'border-emerald-400', decoration: 'bg-emerald-50' },
        'card-red':    { iconBg: 'bg-rose-100',    iconText: 'text-rose-600',    border: 'border-rose-400',    decoration: 'bg-rose-50' },
        'card-yellow': { iconBg: 'bg-amber-100',   iconText: 'text-amber-600',   border: 'border-amber-400',   decoration: 'bg-amber-50' },
        'card-blue':   { iconBg: 'bg-blue-100',    iconText: 'text-blue-600',    border: 'border-blue-400',    decoration: 'bg-blue-50' },
        'card-purple': { iconBg: 'bg-violet-100',  iconText: 'text-violet-600',  border: 'border-violet-400',  decoration: 'bg-violet-50' },
        'card-slate':  { iconBg: 'bg-slate-100',   iconText: 'text-slate-600',   border: 'border-slate-400',   decoration: 'bg-slate-50' },
        'card-rose':   { iconBg: 'bg-rose-100',    iconText: 'text-rose-600',    border: 'border-rose-400',    decoration: 'bg-rose-50' }
    };

    // ✅ Configuración de Tarjetas (Reorganización solicitada)
    const cards = [
        {
            title: 'Asistencia',
            icon: 'calendar-check',
            target: 'live-attendance',
            theme: 'card-green',
            value: attText // Mostrar estado actual
        },
        {
            title: 'Pagos',
            icon: 'credit-card',
            target: 'payments',
            theme: 'card-yellow',
            value: totalDebt > 0 ? `$${totalDebt}` : 'Al día'
        },
        {
            title: 'Calificaciones',
            icon: 'graduation-cap',
            target: 'grades',
            theme: 'card-blue',
            value: 'Ver'
        },
        {
            title: 'Avisos',
            icon: 'bell',
            target: 'notifications',
            theme: 'card-purple',
            value: 'Revisar'
        },
        {
            title: 'Chat',
            icon: 'message-circle',
            target: 'notifications', // Chat está en notificaciones
            theme: 'card-slate',
            value: 'Mensajes'
        },
        {
            title: 'Aula Virtual',
            icon: 'video',
            target: 'videocall',
            theme: 'card-rose',
            value: 'Entrar'
        },
        {
            title: 'Horario',
            icon: 'clock',
            target: 'class', // Muro/Clases
            theme: 'card-red',
            value: 'Ver'
        },
        {
            title: 'Actividades',
            icon: 'star',
            target: 'class',
            theme: 'card-yellow',
            value: 'Explorar'
        }
    ];

    // ✅ Renderizado
    container.innerHTML = cards.map(card => {
        const t = themeMap[card.theme] || themeMap['card-slate'];
        
        return `
        <div data-target="${card.target}" class="bubble-card p-5 flex flex-col items-center justify-center gap-3 cursor-pointer hover:shadow-lg active:scale-95 transition-all group relative overflow-hidden">
            <div class="p-4 rounded-full ${t.iconBg} ${t.iconText} mb-1 group-hover:scale-110 transition-transform duration-300">
                <i data-lucide="${card.icon}" class="w-8 h-8"></i>
            </div>
            <h3 class="font-bold text-slate-700 text-lg">${card.title}</h3>
            <span class="text-xs font-bold text-slate-400 uppercase tracking-wider bg-slate-50 px-2 py-1 rounded-lg">${card.value}</span>
        </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();

  } catch (err) {
    console.error('Error dashboard:', err);
    container.innerHTML = Helpers.emptyState('Error cargando información del día');
  }
}

// ✅ Helper para generar HTML de Post (Reutilizable)
function createPostHTML(p, index = 0) {
  // Manejo robusto de datos del maestro
  const teacherObj = Array.isArray(p.teacher) ? p.teacher[0] : p.teacher;
  // Fallback a columnas planas (trigger) si el objeto teacher no está disponible
  const tName = teacherObj?.name || p.teacher_name || 'Maestra/o';
  const teacherAvatar = teacherObj?.avatar_url || p.teacher_avatar;
  
  const postDate = new Date(p.created_at);
  const isNew = (Date.now() - postDate.getTime()) < 3600000;
  
  const reactionCounts = {};
  if (p.likes && Array.isArray(p.likes)) {
    p.likes.forEach(l => {
      const type = l.reaction_type || 'like';
      reactionCounts[type] = (reactionCounts[type] || 0) + 1;
    });
  }
  
  const myReaction = Array.isArray(p.likes) ? p.likes.find(l => l.user_id === AppState.get('user').id)?.reaction_type : null;
  
  let commentCount = 0;
  if (Array.isArray(p.comments)) {
      if (p.comments[0] && p.comments[0].count !== undefined) commentCount = p.comments[0].count;
      else commentCount = p.comments.length;
  }
  
  let safeMedia = '';
  if (p.media_url && (p.media_url.startsWith('https://') || p.media_url.startsWith('http://'))) {
      const safeTypes = ['jpg','jpeg','png','webp','mp4'];
      const ext = p.media_url.split('.').pop().toLowerCase().split('?')[0];
      if(safeTypes.includes(ext)){
         safeMedia = encodeURI(p.media_url);
      }
  }

  // Optimización de carga de imágenes (LCP)
  // Las 2 primeras publicaciones cargan inmediato, el resto diferido
  const imgLoading = index < 2 ? 'eager' : 'lazy';
  const imgPriority = index < 2 ? 'high' : 'auto';

  return `
  <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-4 animate-fade-in" id="post-${p.id}">
    <div class="flex items-center gap-3 mb-3">
      <div class="w-10 h-10 rounded-full bg-indigo-100 border border-indigo-50 overflow-hidden flex items-center justify-center flex-shrink-0">
        ${teacherAvatar 
          ? `<img src="${teacherAvatar}" class="w-full h-full object-cover" alt="${escapeHtml(tName)}">` 
          : `<span class="font-bold text-indigo-600">${tName.charAt(0)}</span>`
        }
      </div>
      <div>
        <p class="font-bold text-slate-800">${escapeHtml(tName)}</p>
        <div class="flex items-center gap-2">
          <p class="text-xs text-slate-500">${postDate.toLocaleDateString()} ${postDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
          ${isNew ? '<span class="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">NUEVO</span>' : ''}
        </div>
      </div>
    </div>
    <p class="text-slate-700 text-sm leading-relaxed mb-3">${escapeHtml(p.content)}</p>
    ${p.media_url ? `
      <div class="rounded-xl overflow-hidden border border-slate-100">
        ${p.media_type === 'video' 
          ? `<video src="${safeMedia}" controls class="w-full max-h-80 bg-black"></video>`
          : `<img src="${safeMedia}" class="w-full object-cover max-h-80" loading="${imgLoading}" fetchpriority="${imgPriority}" decoding="async">`
        }
      </div>
    ` : ''}
    
    <div class="flex gap-4 text-xs text-slate-400 mb-2 mt-3 px-1" id="reaction-summary-${p.id}">
        ${renderReactionSummary(reactionCounts)}
        <span class="flex items-center gap-1">💬 <span id="comment-count-${p.id}">${commentCount}</span></span>
    </div>

    <div class="flex items-center gap-4 pt-2 border-t border-slate-50">
      <div class="flex gap-1 bg-slate-50 rounded-full p-1" id="reaction-buttons-${p.id}">
         <button onclick="toggleReaction('${p.id}', 'like')" class="p-2 rounded-full hover:bg-white hover:shadow-sm transition-all ${myReaction === 'like' ? 'bg-blue-100 ring-2 ring-blue-200' : ''}" title="Me gusta">👍</button>
         <button onclick="toggleReaction('${p.id}', 'love')" class="p-2 rounded-full hover:bg-white hover:shadow-sm transition-all ${myReaction === 'love' ? 'bg-pink-100 ring-2 ring-pink-200' : ''}" title="Me encanta">❤️</button>
         <button onclick="toggleReaction('${p.id}', 'haha')" class="p-2 rounded-full hover:bg-white hover:shadow-sm transition-all ${myReaction === 'haha' ? 'bg-yellow-100 ring-2 ring-yellow-200' : ''}" title="Me divierte">😂</button>
      </div>

      <button class="flex items-center gap-2 text-slate-500 hover:text-blue-500 hover:bg-blue-50 transition-colors text-sm py-2 px-3 rounded-lg ml-auto" onclick="toggleCommentSection('${p.id}')">
        <i data-lucide="message-circle" class="w-5 h-5"></i>
        <span>Comentar</span>
      </button>
    </div>

    <div id="comments-section-${p.id}" class="hidden mt-3 pt-3 border-t border-slate-100 bg-slate-50/50 rounded-xl p-3">
      <div id="comments-list-${p.id}" class="space-y-3 mb-3 max-h-60 overflow-y-auto pr-1"></div>
      <div class="flex gap-2 items-center">
        <input type="text" id="comment-input-${p.id}" class="flex-1 border rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="Escribe un comentario...">
        <button onclick="sendComment('${p.id}')" class="bg-blue-600 text-white p-2 rounded-xl hover:bg-blue-700 transition-colors shadow-sm"><i data-lucide="send" class="w-4 h-4"></i></button>
      </div>
    </div>
  </div>`;
}

async function loadAttendance() {
  const container = document.getElementById('calendarGrid');
  if (!container) return;
  
  container.innerHTML = Helpers.skeleton(1, 'h-64 col-span-7');
  
  const student = AppState.get('student');
  if (!student) return;

  try {
    // ✅ 2. CACHE GLOBAL (Uso en Asistencia)
    let data = GlobalCache.get('attendance');
    
    if (!data) {
      const { data: freshData, error } = await supabase
        .from(TABLES.ATTENDANCE)
        .select('date, status')
        .eq('student_id', student.id)
        .order('date', { ascending: false })
        .limit(60);
      
      if (error) throw error;
      data = freshData || [];
      GlobalCache.set('attendance', data);
    }
    
    renderCalendar(data || []);
    updateAttendanceStats(data || []);
  } catch (err) {
    console.error('Error asistencia:', err);
    container.innerHTML = Helpers.emptyState('Error al cargar asistencia');
  }
}

function renderCalendar(attendanceData) {
  const container = document.getElementById('calendarGrid');
  if(!container) return;
  container.innerHTML = '';

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  
  let firstDay = new Date(year, month, 1).getDay();
  firstDay = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  // Map de fechas a estados
  const attMap = {};
  attendanceData.forEach(a => attMap[a.date] = a.status);

  let html = '';
  // Días vacíos previos
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="h-10"></div>`;
  }

  // Días del mes
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const status = attMap[dateStr];
    
    let colorClass = 'bg-slate-50 text-slate-400'; // Default
    if (status === 'present') colorClass = 'bg-green-500 text-white font-bold shadow-md transform scale-105'; // Verde Intenso
    else if (status === 'absent') colorClass = 'bg-rose-100 text-rose-600';
    else if (status === 'late') colorClass = 'bg-amber-100 text-amber-600';

    html += `
      <div class="h-10 flex items-center justify-center rounded-lg ${colorClass} text-sm transition-all">
        ${day}
      </div>
    `;
  }
  container.innerHTML = html;
}

function updateAttendanceStats(data) {
    let p = 0, a = 0, l = 0;
    data.forEach(d => {
        if(d.status === 'present') p++;
        if(d.status === 'absent') a++;
        if(d.status === 'late') l++;
    });
    const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
    set('attPresent', p);
    set('attAbsent', a);
    set('attLate', l);
}

async function loadClassFeed(reset = true) {
  const container = document.getElementById('classFeed');
  if (!container) return;
  
  container.innerHTML = Helpers.skeleton(2, 'h-32');
  const student = AppState.get('student');
  if (!student?.classroom_id) {
    container.innerHTML = Helpers.emptyState('Sin aula asignada');
    return;
  }

  try {
    const { data: posts, error } = await supabase
      .from(TABLES.POSTS)
      .select('*, teacher:teacher_id(name, avatar_url), likes(id,user_id), comments(count)')
      .eq('classroom_id', student.classroom_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!posts || !posts.length) {
      container.innerHTML = Helpers.emptyState('No hay publicaciones en el muro');
      return;
    }

    const html = posts.map((p, i) => createPostHTML(p, i)).join('');
    
    if (reset) {
        container.innerHTML = html;
    } else {
        // Remover botón anterior si existe
        const oldBtn = document.getElementById('btnLoadMoreFeed');
        if(oldBtn) oldBtn.remove();
        container.insertAdjacentHTML('beforeend', html);
    }

    // Botón Ver Más
    if (AppState.get('feedHasMore')) {
        const btnHtml = `
            <div class="text-center mt-4">
                <button id="btnLoadMoreFeed" class="px-5 py-2 bg-white border border-slate-200 text-slate-600 rounded-full text-sm font-bold hover:bg-slate-50 transition-colors shadow-sm">
                    Ver más publicaciones
                </button>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', btnHtml);
        document.getElementById('btnLoadMoreFeed').onclick = () => {
            AppState.set('feedPage', page + 1);
            loadClassFeed(false);
        };
    }
    
    if(window.lucide) lucide.createIcons();
    
  } catch (err) {
    console.error(err);
    if (reset) container.innerHTML = Helpers.emptyState('Error cargando el muro');
  }
}

// Helper para renderizar resumen de reacciones
function renderReactionSummary(counts) {
  let html = '';
  if (counts['like']) html += `<span class="flex items-center gap-1 bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">👍 ${counts['like']}</span>`;
  if (counts['love']) html += `<span class="flex items-center gap-1 bg-pink-50 text-pink-600 px-2 py-0.5 rounded-full">❤️ ${counts['love']}</span>`;
  if (counts['haha']) html += `<span class="flex items-center gap-1 bg-yellow-50 text-yellow-600 px-2 py-0.5 rounded-full">😂 ${counts['haha']}</span>`;
  
  if (!html) return '<span class="text-slate-300 italic">Sé el primero en reaccionar</span>'; 
  return `<div class="flex gap-2">${html}</div>`;
}

// ✅ Sistema de Comentarios en Tiempo Real
function initFeedRealtime() {
  const old = AppState.get('feedChannel');
  if(old){
   supabase.removeChannel(old);
  }
  
  const student = AppState.get('student');
  if (!student?.classroom_id) return;

  const channel = supabase.channel('public:feed')
    // 0. Nuevas Publicaciones
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLES.POSTS, filter: `classroom_id=eq.${student.classroom_id}` }, payload => {
        const container = document.getElementById('classFeed');
        if (container) {
            // Insertar al principio
            const html = createPostHTML(payload.new);
            container.insertAdjacentHTML('afterbegin', html);
            if(window.lucide) lucide.createIcons();
        }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLES.COMMENTS }, async (payload) => {
       const newComment = payload.new;
       // Ignorar si es mi propio comentario (ya agregado optimísticamente)
       if (newComment.user_id === AppState.get('user').id) return;

       const postEl = document.getElementById(`post-${newComment.post_id}`);
       
       if(postEl) {
         // 1. Actualizar contador
         const countEl = document.getElementById(`comment-count-${newComment.post_id}`);
         if(countEl) {
            const current = parseInt(countEl.textContent) || 0;
            countEl.textContent = current + 1;
         }

         // 2. Si la sección está abierta, agregar el comentario
         const listEl = document.getElementById(`comments-list-${newComment.post_id}`);
         if(listEl && listEl.offsetParent !== null) { // Si es visible
            // 2. Optimización: Usar nombre de la tabla comments si existe, o fallback
            const name = newComment.user_name || 'Usuario';
            
            const div = document.createElement('div');
            div.className = 'flex gap-2 text-sm animate-fade-in mb-2';
            // 6. Mejora visual del comentario (Burbuja)
            div.innerHTML = `
              <div class="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 flex-shrink-0">
                ${escapeHtml(name.charAt(0))}
              </div>
              <div class="bg-white p-3 rounded-2xl rounded-tl-none shadow-sm border border-slate-100">
                <div class="font-bold text-slate-700 text-xs mb-1">${escapeHtml(name)}</div>
                <div class="text-slate-600 leading-snug">${escapeHtml(newComment.content)}</div>
              </div>
            `;
            // Indicador visual
            listEl.appendChild(div);
            listEl.scrollTop = listEl.scrollHeight;
         }
       }
    })
    // 1. Reacciones en tiempo real (INSERT, UPDATE, DELETE)
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLES.LIKES }, async (payload) => {
        // Actualización local de contadores sin fetch masivo si es posible, 
        // pero para consistencia usamos updatePostReactionsUI solo si NO soy yo (yo actualizo optimista)
        const postId = payload.new?.post_id || payload.old?.post_id;
        if (!postId) return;
        
        const myId = AppState.get('user').id;
        if ((payload.new?.user_id === myId) || (payload.old?.user_id === myId)) return;

        updatePostReactionsUI(postId);
    })
    .subscribe();
    
  AppState.set('feedChannel', channel);
}

window.toggleCommentSection = async (postId) => {
  const section = document.getElementById(`comments-section-${postId}`);
  const list = document.getElementById(`comments-list-${postId}`);
  
  if (section.classList.contains('hidden')) {
    section.classList.remove('hidden');
    // Cargar comentarios
    list.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">Cargando...</p>';
    
    const { data: comments } = await supabase
      .from(TABLES.COMMENTS)
      .select('id, user_id, content, created_at, user_name, user:profiles(name)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
      
    if (!comments || !comments.length) {
      list.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">Sé el primero en comentar</p>';
    } else {
      const currentUserId = AppState.get('user')?.id;
      list.innerHTML = comments.map(c => {
        // Preferir user_name guardado, fallback a relación
        const uName = c.user_name || (Array.isArray(c.user) ? c.user[0]?.name : c.user?.name) || 'Usuario';
        const isMine = c.user_id === currentUserId;
        return `
        <div class="flex gap-2 text-sm mb-2">
          <div class="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 flex-shrink-0">
            ${escapeHtml(uName.charAt(0))}
          </div>
          <div class="bg-white p-3 rounded-2xl rounded-tl-none shadow-sm border border-slate-100 relative group min-w-[120px]">
            <div class="font-bold text-slate-700 text-xs mb-1 flex justify-between items-center gap-2">
                <span>${escapeHtml(uName)}</span>
                ${isMine ? `<button onclick="deleteComment('${c.id}', '${postId}')" class="text-slate-300 hover:text-red-500 transition-colors" title="Eliminar"><i data-lucide="trash-2" class="w-3 h-3"></i></button>` : ''}
            </div>
            <div class="text-slate-600 leading-snug">${escapeHtml(c.content)}</div>
          </div>
        </div>
      `}).join('');
    }
    list.scrollTop = list.scrollHeight;
  } else {
    section.classList.add('hidden');
  }
};

// Función auxiliar para actualizar UI de reacciones en tiempo real
async function updatePostReactionsUI(postId) {
  // Esta función hace fetch, pero ahora está optimizada para llamarse menos frecuentemente
  const { data: reactions } = await supabase
    .from(TABLES.LIKES)
    .select('id')
    .eq('post_id', postId);
    
  if (reactions) {
    const counts = reactions.reduce((acc, r) => {
      const type = r.reaction_type || 'like';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    const summaryEl = document.getElementById(`reaction-summary-${postId}`);
    const commentCountEl = document.getElementById(`comment-count-${postId}`);
    const commentCount = commentCountEl ? commentCountEl.textContent : '0';

    if (summaryEl) {
      summaryEl.innerHTML = renderReactionSummary(counts) + 
        `<span class="flex items-center gap-1 ml-4">💬 <span id="comment-count-${postId}">${commentCount}</span></span>`;
    }
  }
}

// ✅ Funciones globales para el muro (Reacciones/Comentar)
window.toggleReaction = async (postId, type) => {
  try {
    const user = AppState.get('user');
    if(!user) return;
    
    // Verificar estado actual
    const { data: existing } = await supabase
        .from(TABLES.LIKES)
        .select('id, reaction_type')
        .eq('post_id', postId)
        .eq('user_id', user.id)
        .maybeSingle();

    // UI Optimista (Feedback inmediato en botones)
    const btnContainer = document.getElementById(`reaction-buttons-${postId}`);
    if (btnContainer) {
       const buttons = btnContainer.querySelectorAll('button');
       buttons.forEach(b => {
          b.className = 'p-2 rounded-full hover:bg-white hover:shadow-sm transition-all'; // Reset
          if (b.getAttribute('onclick').includes(`'${type}'`)) {
             // Si es el que clicamos y no lo estamos quitando (lógica abajo), lo activamos
             // Pero como es asíncrono, mejor esperar o hacer lógica compleja.
             // Para simplicidad visual inmediata:
             if (!existing || existing.reaction_type !== type) {
                const color = type === 'like' ? 'bg-blue-100 ring-2 ring-blue-200' : (type === 'love' ? 'bg-pink-100 ring-2 ring-pink-200' : 'bg-yellow-100 ring-2 ring-yellow-200');
                b.className = `p-2 rounded-full hover:bg-white hover:shadow-sm transition-all ${color}`;
             }
          }
       });
    }
    
    if (existing) {
       if (existing.reaction_type === type) {
         // Si es la misma reacción, quitarla (toggle off)
         await supabase.from(TABLES.LIKES).delete().eq('id', existing.id);
       } else {
         // Si es diferente, actualizarla
         await supabase.from(TABLES.LIKES).update({ reaction_type: type }).eq('id', existing.id);
       }
    } else {
       // INSERT
       await supabase.from(TABLES.LIKES).insert({ post_id: postId, user_id: user.id, reaction_type: type });
       triggerConfetti(); // 🎉
    }
    
    // Actualizar UI inmediatamente (Fetch para asegurar consistencia tras mi acción)
    updatePostReactionsUI(postId);
    
  } catch(e) { console.error(e); }
};

window.sendComment = async (postId) => {
  const input = document.getElementById(`comment-input-${postId}`);
  const text = input.value.trim();
  if(!text) return;
  
  // UI Optimista
  const user = AppState.get('user');
  const profile = AppState.get('profile');
  const userName = profile?.name || 'Yo';
  const list = document.getElementById(`comments-list-${postId}`);
  
  // Renderizar inmediatamente
  if(list) {
      const tempId = 'temp-' + Date.now();
      const div = document.createElement('div');
      div.id = tempId;
      div.className = 'flex gap-2 text-sm mb-2 opacity-50'; // Opacidad hasta confirmar
      div.innerHTML = `
          <div class="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 flex-shrink-0">${escapeHtml(userName.charAt(0))}</div>
          <div class="bg-white p-3 rounded-2xl rounded-tl-none shadow-sm border border-slate-100">
            <div class="font-bold text-slate-700 text-xs mb-1">${escapeHtml(userName)}</div>
            <div class="text-slate-600 leading-snug">${escapeHtml(text)}</div>
          </div>`;
      list.appendChild(div);
      list.scrollTop = list.scrollHeight;
      
      // Actualizar contador visualmente
      const countEl = document.getElementById(`comment-count-${postId}`);
      if(countEl) countEl.textContent = (parseInt(countEl.textContent)||0) + 1;
  }
  
  input.value = '';

  try {
    const { error } = await supabase.from(TABLES.COMMENTS).insert({
      post_id: postId,
      user_id: user.id,
      // 2. Guardar nombre para optimización (Requiere update en schema.sql)
      user_name: profile?.name || 'Padre/Madre', 
      content: text
    });
    
    if(error) throw error;
    
    // Confirmar visualmente (quitar opacidad)
    const tempEl = list?.lastElementChild;
    if(tempEl) tempEl.classList.remove('opacity-50');
    
  } catch(e) {
    Helpers.toast('Error al comentar', 'error');
    // Revertir UI
    const countEl = document.getElementById(`comment-count-${postId}`);
    if(countEl) countEl.textContent = Math.max(0, (parseInt(countEl.textContent)||0) - 1);
    if(list?.lastElementChild) list.lastElementChild.remove();
    input.value = text;
  }
};

window.deleteComment = async (commentId, postId) => {
  if(!confirm('¿Eliminar comentario?')) return;
  try {
    const { error } = await supabase.from(TABLES.COMMENTS).delete().eq('id', commentId);
    if(error) throw error;
    Helpers.toast('Comentario eliminado', 'info');
    // UI se actualiza sola por realtime, pero forzamos recarga por si acaso
    toggleCommentSection(postId); toggleCommentSection(postId); 
  } catch(e) { Helpers.toast('Error al eliminar', 'error'); }
};

async function loadGrades() {
  const container = document.getElementById('gradesContent');
  if (!container) return;
  
  container.innerHTML = Helpers.skeleton(1, 'h-64');

  const student = AppState.get('student');
  if (!student) return;

  try {
    // 1. Obtener tareas calificadas (Evidencias con nota)
    const { data: taskGrades, error: tErr } = await supabase
      .from(TABLES.TASK_EVIDENCES)
      .select('*, tasks(title, due_date)')
      .eq('student_id', student.id)
      .not('grade_letter', 'is', null)
      .order('created_at', { ascending: false });

    if (tErr) throw tErr;

    // 2. Calcular Promedio General
    const letterMap = { 'A': 100, 'B': 85, 'C': 70, 'D': 60, 'F': 50 };
    let totalScore = 0;
    let count = 0;
    
    const processedTasks = (taskGrades || []).map(t => {
        const score = letterMap[t.grade_letter] || 0;
        totalScore += score;
        count++;
        return { ...t, score };
    });
    
    const average = count > 0 ? Math.round(totalScore / count) : 0;
    
    // 3. Renderizar
    let html = '';
    
    // Gráfico Circular de Progreso
    const radius = 50;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (average / 100) * circumference;
    const colorClass = average >= 90 ? 'text-emerald-500' : (average >= 80 ? 'text-blue-500' : (average >= 70 ? 'text-yellow-500' : 'text-rose-500'));
    
    html += `
      <div class="flex flex-col items-center justify-center mb-10">
        <div class="relative w-48 h-48">
          <!-- Fondo del círculo -->
          <svg class="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="${radius}" fill="none" stroke="#f1f5f9" stroke-width="10" />
            <!-- Progreso -->
            <circle cx="60" cy="60" r="${radius}" fill="none" stroke="currentColor" stroke-width="10" 
              stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" 
              class="${colorClass} transition-all duration-1000 ease-out drop-shadow-md" stroke-linecap="round" />
          </svg>
          <!-- Texto Central -->
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-5xl font-black text-slate-800 tracking-tighter">${average}</span>
            <span class="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Promedio</span>
          </div>
        </div>
        <div class="mt-4 text-center">
            <h4 class="text-lg font-bold text-slate-700">Rendimiento General</h4>
            <p class="text-sm text-slate-500">Basado en ${count} tareas evaluadas</p>
        </div>
      </div>
    `;
    
    // Lista de Tareas
    if (processedTasks.length > 0) {
        html += `<div class="space-y-4 w-full max-w-3xl mx-auto">`;
        html += `<h5 class="font-bold text-slate-600 text-sm uppercase tracking-wider mb-2 px-2">Desglose de Tareas</h5>`;
        
        html += processedTasks.map(t => {
            const tColor = t.grade_letter === 'A' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 
                           (t.grade_letter === 'B' ? 'bg-blue-100 text-blue-700 border-blue-200' : 
                           'bg-amber-100 text-amber-700 border-amber-200');
            
            return `
              <div class="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-all group">
                <div class="flex items-center gap-4 overflow-hidden">
                  <div class="w-12 h-12 rounded-xl ${tColor} border flex-shrink-0 flex items-center justify-center font-black text-xl shadow-sm group-hover:scale-110 transition-transform">
                    ${t.grade_letter}
                  </div>
                  <div class="min-w-0">
                    <h4 class="font-bold text-slate-700 truncate text-sm md:text-base">${escapeHtml(t.tasks?.title || 'Tarea')}</h4>
                    <p class="text-xs text-slate-400 font-medium">${new Date(t.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}</p>
                  </div>
                </div>
                <div class="flex items-center gap-1 pl-2">
                   ${t.stars ? Array(t.stars).fill('<i data-lucide="star" class="w-4 h-4 text-yellow-400 fill-yellow-400"></i>').join('') : ''}
                </div>
              </div>
            `;
        }).join('');
        html += `</div>`;
    } else {
        html += Helpers.emptyState('Aún no hay tareas calificadas para mostrar el progreso.');
    }

    container.innerHTML = html;
    
    if (window.lucide) lucide.createIcons();

    // Animación simple del círculo (re-trigger reflow)
    const circle = container.querySelector('circle.transition-all');
    if(circle) {
        circle.style.strokeDashoffset = circumference;
        setTimeout(() => {
            circle.style.strokeDashoffset = offset;
        }, 100);
    }

  } catch (err) {
    console.error('Error cargando notas:', err);
    container.innerHTML = Helpers.emptyState('Error al cargar calificaciones');
  }
}

async function loadPayments() {
  const container = document.getElementById('paymentsHistory');
  if (!container) return;
  
  container.innerHTML = Helpers.skeleton(3, 'h-20');
  const student = AppState.get('student');
  if (!student) return;
  
  const feeEl = document.getElementById('paymentsMonthlyFee');
  if (feeEl) feeEl.textContent = `$${((student.monthly_fee || 0)).toFixed(2)}`;
  const dueEl = document.getElementById('paymentsDueDay');
  if (dueEl) dueEl.textContent = student.due_day ? String(student.due_day) : '-';

  const year = new Date().getFullYear();

  try {
    // ✅ 2. CACHE GLOBAL (Uso en Pagos)
    let payments = GlobalCache.get('payments');

    if (!payments) {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('student_id', student.id)
        .gte('created_at', `${year}-01-01`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      payments = data || [];
      GlobalCache.set('payments', payments);
    }

    if (!payments || !payments.length) {
      container.innerHTML = Helpers.emptyState('No hay historial de pagos');
      return;
    }

    container.innerHTML = `<div class="space-y-3">
      ${payments.map(p => {
        const isConfirmed = p.status === 'confirmado';
        const isRejected = p.status === 'rechazado';
        
        const statusLabel = {
          confirmado: 'Confirmado',
          pendiente: 'Pendiente',
          rechazado: 'Rechazado',
          paid: 'Pagado',
          efectivo: 'Efectivo'
        }[p.status] || p.status;

        // Estilos según estado
        let theme = { 
          bg: 'bg-white', 
          border: 'border-slate-200', 
          iconBg: 'bg-slate-100', 
          iconColor: 'text-slate-500',
          badgeBg: 'bg-slate-100',
          badgeText: 'text-slate-600'
        };

        if (isConfirmed) {
          theme = { 
            bg: 'bg-emerald-50/30', 
            border: 'border-emerald-200', 
            iconBg: 'bg-emerald-100', 
            iconColor: 'text-emerald-600',
            badgeBg: 'bg-emerald-100',
            badgeText: 'text-emerald-700'
          };
        } else if (isRejected) {
          theme = { 
            bg: 'bg-rose-50/30', 
            border: 'border-rose-200', 
            iconBg: 'bg-rose-100', 
            iconColor: 'text-rose-600',
            badgeBg: 'bg-rose-100',
            badgeText: 'text-rose-700'
          };
        } else {
           theme = { 
            bg: 'bg-amber-50/30', 
            border: 'border-amber-200', 
            iconBg: 'bg-amber-100', 
            iconColor: 'text-amber-600',
            badgeBg: 'bg-amber-100',
            badgeText: 'text-amber-700'
          };
        }

        const icon = p.method === 'efectivo' ? 'banknote' : 'credit-card';

        return `
        <div class="flex items-center gap-4 p-4 rounded-2xl border-2 ${theme.border} ${theme.bg} transition-all hover:scale-[1.01] shadow-sm relative overflow-hidden group">
           <!-- Icono Circular -->
           <div class="w-12 h-12 rounded-full ${theme.iconBg} flex items-center justify-center flex-shrink-0 shadow-inner">
             <i data-lucide="${icon}" class="w-6 h-6 ${theme.iconColor}"></i>
           </div>
           
           <div class="flex-1 min-w-0 z-10">
             <div class="flex justify-between items-center mb-1">
               <h4 class="font-black text-slate-800 text-lg tracking-tight">$${p.amount}</h4>
               <span class="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider ${theme.badgeBg} ${theme.badgeText}">${statusLabel}</span>
             </div>
             <p class="text-xs text-slate-500 font-bold capitalize flex items-center gap-1 opacity-80">
               <i data-lucide="calendar" class="w-3 h-3"></i> ${p.month_paid || 'Pago'} • ${p.method}
             </p>
           </div>
           
           <!-- Decoración de "Ticket" (Muescas) -->
           <div class="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-slate-50 rounded-full border border-slate-200"></div>
           <div class="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-slate-50 rounded-full border border-slate-200"></div>
        </div>
        `;
      }).join('')}
    </div>`;
    
    // Calcular balance simple
    const totalPaid = payments
      .filter(p => p.status === 'confirmado')
      .reduce((sum, p) => sum + Number(p.amount), 0);
      
    const balEl = document.getElementById('paymentsBalance');
    if(balEl) balEl.textContent = `$${totalPaid.toFixed(2)}`;

    if (window.lucide) lucide.createIcons();

  } catch (err) {
    console.error(err);
    container.innerHTML = Helpers.emptyState('Error cargando pagos');
  }
}

async function initChatSystem() {
  const container = document.getElementById('notificationsList');
  if (!container) return;
  
  container.innerHTML = `
    <div class="flex flex-col md:flex-row h-[600px] bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <!-- Sidebar Contactos -->
      <div class="w-full md:w-1/3 border-r border-slate-100 bg-slate-50 flex flex-col">
         <div class="p-4 border-b border-slate-200 font-bold text-slate-700 flex justify-between items-center">
            <span>Mensajes</span>
            <span class="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">Privado</span>
         </div>
         <div id="chatContactsList" class="flex-1 overflow-y-auto p-2 space-y-2">
            ${Helpers.skeleton(2, 'h-16')}
         </div>
      </div>
      
      <!-- Area Chat -->
      <div class="flex-1 flex flex-col bg-white relative">
         <div id="chatHeader" class="p-4 border-b border-slate-100 flex items-center gap-3 bg-white z-10 hidden">
            <div id="chatHeaderAvatar" class="w-10 h-10 rounded-full bg-slate-200 overflow-hidden flex items-center justify-center font-bold text-slate-500"></div>
            <div>
               <div id="chatHeaderName" class="font-bold text-slate-800"></div>
               <div id="chatHeaderRole" class="text-xs text-slate-500 capitalize"></div>
            </div>
         </div>
         
         <div id="chatMessages" class="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/30 scroll-smooth">
            <div class="h-full flex flex-col items-center justify-center text-slate-400">
               <i data-lucide="message-square" class="w-12 h-12 mb-2 opacity-20"></i>
               <p>Selecciona un contacto para chatear</p>
            </div>
         </div>
         
         <div id="chatInputArea" class="p-3 border-t border-slate-100 bg-white hidden">
            <div class="flex gap-2 items-end">
               <textarea id="messageInput" rows="1" class="flex-1 bg-slate-100 border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 resize-none outline-none transition-all" placeholder="Escribe un mensaje..."></textarea>
               <button onclick="sendChatMessage()" class="bg-blue-600 text-white p-3 rounded-xl hover:bg-blue-700 transition-colors shadow-sm active:scale-95">
                  <i data-lucide="send" class="w-5 h-5"></i>
               </button>
            </div>
            <div class="text-[10px] text-slate-400 mt-1 px-2">Presiona Enter para enviar</div>
         </div>
      </div>
    </div>
  `;
  
  if(window.lucide) lucide.createIcons();
  await loadChatContacts();
}

async function loadChatContacts() {
  const list = document.getElementById('chatContactsList');
  if(!list) return;
  
  const student = AppState.get('student');
  const contacts = [];

  // 1. Maestra
  // Fix: Manejar si classrooms es array o objeto
  const cls = Array.isArray(student?.classrooms) ? student.classrooms[0] : student?.classrooms;
  if (cls?.teacher_id) {
     const { data: teacher } = await supabase.from(TABLES.PROFILES).select('id, name, avatar_url').eq('id', cls.teacher_id).single();
     if(teacher) contacts.push({ ...teacher, role: 'Maestra titular' });
  }

  // 2. Directora
  const { data: directors } = await supabase.from(TABLES.PROFILES).select('id, name, avatar_url').eq('role', 'directora').limit(1);
  if(directors && directors.length) contacts.push({ ...directors[0], role: 'Dirección' });

  list.innerHTML = contacts.map(c => `
    <div onclick="selectChat('${c.id}', '${escapeHtml(c.name)}', '${c.role}', '${c.avatar_url || ''}')" 
         class="flex items-center gap-3 p-3 rounded-xl hover:bg-white hover:shadow-sm cursor-pointer transition-all border border-transparent hover:border-slate-100 group">
       <div class="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold overflow-hidden border border-indigo-50">
          ${c.avatar_url ? `<img src="${c.avatar_url}" class="w-full h-full object-cover">` : c.name.charAt(0)}
       </div>
       <div>
          <div class="font-bold text-slate-700 text-sm group-hover:text-blue-600 transition-colors">${escapeHtml(c.name)}</div>
          <div class="text-xs text-slate-400">${c.role}</div>
       </div>
    </div>
  `).join('');
}

window.selectChat = async (userId, name, role, avatar) => {
  AppState.set('currentChatUser', userId);
  
  // UI Update
  document.getElementById('chatHeader').classList.remove('hidden');
  document.getElementById('chatInputArea').classList.remove('hidden');
  document.getElementById('chatHeaderName').textContent = name;
  document.getElementById('chatHeaderRole').textContent = role;
  
  const avatarEl = document.getElementById('chatHeaderAvatar');
  avatarEl.innerHTML = avatar ? `<img src="${avatar}" class="w-full h-full object-cover">` : name.charAt(0);

  // Load Messages
  const container = document.getElementById('chatMessages');
  container.innerHTML = '<div class="flex justify-center py-4"><div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div></div>';
  
  const myId = AppState.get('user').id;
  
  const { data: msgs } = await supabase
    .from(TABLES.MESSAGES)
    .select('*')
    .or(`and(sender_id.eq.${myId},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${myId})`)
    .order('created_at', { ascending: true });
    
  container.innerHTML = '';
  (msgs || []).forEach(renderMessage);
  container.scrollTop = container.scrollHeight;

  // Realtime Subscription
  const oldChannel = AppState.get('chatChannel');
  if(oldChannel) supabase.removeChannel(oldChannel);

  const channel = supabase.channel('chat_room')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLES.MESSAGES }, payload => {
       const m = payload.new;
       if ((m.sender_id === myId && m.receiver_id === userId) || (m.sender_id === userId && m.receiver_id === myId)) {
          renderMessage(m);
          container.scrollTop = container.scrollHeight;
       }
    })
    .subscribe();
    
  AppState.set('chatChannel', channel);
};

window.sendChatMessage = async () => {
  const input = document.getElementById('messageInput');
  const content = input.value.trim();
  const receiverId = AppState.get('currentChatUser');
  
  if(!content || !receiverId) return;
  
  input.disabled = true;

  const { error } = await supabase.from(TABLES.MESSAGES).insert({
    sender_id: AppState.get('user').id,
    receiver_id: receiverId,
    content: content
  });
  
  input.disabled = false;

  if(error) {
     console.error(error);
     Helpers.toast('Error al enviar mensaje', 'error');
  } else {
     input.value = '';
     input.focus();
  }
};

function renderMessage(msg) {
  const container = document.getElementById("chatMessages");
  const isMine = msg.sender_id === AppState.get('user').id;
  const time = new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

  const bubble = document.createElement("div");
  bubble.className = isMine ? "flex justify-end mb-3 animate-fade-in" : "flex justify-start mb-3 animate-fade-in";

  bubble.innerHTML = `
    <div class="max-w-[80%] px-4 py-2 rounded-2xl text-sm shadow-sm ${isMine ? "bg-blue-600 text-white rounded-tr-none" : "bg-white border border-slate-200 text-slate-700 rounded-tl-none"}">
      <div>${escapeHtml(msg.content)}</div>
      <div class="text-[10px] ${isMine ? "text-blue-200" : "text-slate-400"} mt-1 text-right">${time}</div>
    </div>
  `;

  container.appendChild(bubble);
}

async function populateProfile() {
  const student = AppState.get('student');
  if (!student) return;
  
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  
  setVal('inputStudentName', student.name);
  setVal('inputStudentBlood', student.blood_type);
  setVal('inputStudentAllergy', student.allergies);
  
  setVal('profileFatherName', student.p1_name);
  setVal('profileFatherPhone', student.p1_phone);
  setVal('profileFatherEmail', student.p1_email);
  
  setVal('profileMotherName', student.p2_name);
  setVal('profileMotherPhone', student.p2_phone);
  setVal('profileMotherEmail', student.p2_email);
  
  setVal('profilePickupName', student.authorized_pickup);
  
  // ✅ Refrescar iconos después de llenar datos
  if(window.lucide) lucide.createIcons();
}

// ✅ Función unificada para guardar perfil
async function saveAllProfile() {
  const student = AppState.get('student');
  if(!student) return;
  
  const btn = document.getElementById('btnSaveChanges');
  if(!btn) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  // Helper seguro para obtener valores (evita crash si el elemento no existe)
  const getVal = (id) => document.getElementById(id)?.value?.trim() || null;

  const birthDate = getVal('inputStudentBirth');
  
  const updates = {
    // Estudiante
    name: getVal('inputStudentName'),
    blood_type: getVal('inputStudentBlood'),
    allergies: getVal('inputStudentAllergy'),
    // Padres
    p1_name: getVal('profileFatherName'),
    p1_phone: getVal('profileFatherPhone'),
    p1_email: getVal('profileFatherEmail'),
    p2_name: getVal('profileMotherName'),
    p2_phone: getVal('profileMotherPhone'),
    p2_email: getVal('profileMotherEmail'),
    authorized_pickup: getVal('profilePickupName')
  };
  
  const { error } = await supabase.from(TABLES.STUDENTS).update(updates).eq('id', student.id);
  
  if(error) {
    Helpers.toast('Error al guardar datos', 'error');
  } else {
    // ✅ Mejora: También actualizar el nombre en el perfil del usuario para el saludo
    const newName = updates.p1_name || updates.p2_name || updates.name;
    if (newName) {
      await supabase.from(TABLES.PROFILES).update({ name: newName }).eq('id', AppState.get('user').id);
      
      // Actualizar estado local del perfil
      const profile = AppState.get('profile');
      if (profile) {
        profile.name = newName;
        AppState.set('profile', profile);
        
        // Actualizar saludo inmediatamente
        document.querySelectorAll('.guardian-name-display').forEach(el => {
          el.textContent = escapeHtml(newName);
        });
      }
    }

    Helpers.toast('Perfil actualizado correctamente', 'success');
    await loadStudentData(); // Recargar para actualizar resto de UI
  }
  
  btn.disabled = false;
  btn.textContent = originalText;
  if(window.lucide) lucide.createIcons();
}

// ===== VIDEOLLAMADA =====
async function initVideoCall() {
  const container = document.getElementById('meet');
  if (!container) return;
  container.innerHTML = '';

  const student = AppState.get('student');
  if (!student?.classroom_id) {
    container.innerHTML = Helpers.emptyState('No tienes aula asignada para videollamadas');
    return;
  }

  if (typeof JitsiMeetExternalAPI === 'undefined') {
    container.innerHTML = Helpers.emptyState('Error: Librería de video no cargada', 'video-off');
    return;
  }

  if (window.jitsiInstance) window.jitsiInstance.dispose();

  const domain = "meet.jit.si";
  const options = {
    roomName: "KarpusKids_" + (student.classroom_id || 'General').substring(0, 8),
    width: "100%",
    height: 600,
    parentNode: container,
    lang: 'es',
    userInfo: {
      displayName: AppState.get('profile')?.name || 'Padre/Madre'
    },
    configOverwrite: { 
      startWithAudioMuted: true, 
      startWithVideoMuted: true,
      prejoinPageEnabled: false,
      enableLobby: false,
      defaultLanguage: 'es'
    },
    interfaceConfigOverwrite: {
      SHOW_JITSI_WATERMARK: false,
      SHOW_WATERMARK_FOR_GUESTS: false,
      MOBILE_APP_PROMO: false
    }
  };
  window.jitsiInstance = new JitsiMeetExternalAPI(domain, options);
}
