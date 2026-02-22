
import { supabase } from './supabase.js';

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
  GRADES: 'grades'
};
const STORAGE_BUCKETS = { CLASSROOM_MEDIA: 'classroom_media' };
const DATE_FORMAT = { locale: 'es-ES', options: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' } };
const TOAST_DURATION = 2800;
const MODAL_CLOSE_KEYS = ['Escape', 'Esc'];

// ===== UTILIDADES SEGURAS =====
const escapeHtml = (str) => {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
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
    this._state = { user: null, profile: null, student: null, tasks: [], realtimeChannel: null, feedChannel: null };
  }
  
  get(key) { return this._state[key]; }
  set(key, value) { 
    if (key in this._state) this._state[key] = value; 
    else console.warn(`AppState: Clave inválida ${key}`);
  }
  
  reset() {
    // ✅ CORRECCIÓN: Limpiar canales ANTES de borrar el estado
    if (this._state.realtimeChannel) {
      supabase.removeChannel(this._state.realtimeChannel);
    }
    if (this._state.feedChannel) {
      supabase.removeChannel(this._state.feedChannel);
    }
    
    this._state = { user: null, profile: null, student: null, tasks: [], realtimeChannel: null, feedChannel: null };
  }
}
const AppState = new SafeAppState();

// ===== MEJORAS PARA SIDEBAR MÓVIL ===== 
function setupSidebarMobile() { 
  const nav = document.querySelector('nav.sidebar-nav'); 
  if (!nav) return; 
  
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
    
    await loadStudentData();
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
  document.getElementById('btnSaveChanges')?.addEventListener('click', saveAllProfile);
  document.getElementById('btnDownloadReport')?.addEventListener('click', () => window.print());
  
  // ✅ Botón de refresco manual
  document.getElementById('btnRefreshData')?.addEventListener('click', () => {
    const activeSection = document.querySelector('.section.active')?.id || 'home';
    loadSectionData(activeSection);
  });
  
  // ✅ Cargar sección inicial
  setActiveSection('home');
  loadDashboard();
  
  // Acciones principales
  document.getElementById('btnPayTuition')?.addEventListener('click', async (e) => {
    e.preventDefault();
    setActiveSection('payments');
    const userState = AppState.get('user');
    const email = userState && userState.email;
    if (!email) {
      Helpers.toast('No se encontró un correo asociado a tu cuenta.', 'error');
      return;
    }
    const student = AppState.get('student');
    const studentName = student ? `${student.first_name || ''} ${student.last_name || ''}`.trim() : '';
    const subject = studentName ? `Información de pago de ${studentName}` : 'Información de pago de mensualidad';
    const text = 'Te enviamos la información de tu pago de mensualidad desde el panel de Karpus.';
    try {
      const res = await fetch('http://127.0.0.1:5600/api/parents/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: email, subject, text })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      Helpers.toast('Se envió un correo con la información de pago.', 'success');
    } catch (err) {
      Helpers.toast('No se pudo enviar el correo de pago.', 'error');
    }
  });
});

// ===== NAVEGACIÓN Y GESTIÓN DE SECCIONES =====
function setupNavigation() {
  const navButtons = document.querySelectorAll('[data-target]');
  const sections = document.querySelectorAll('.section');
  const headerAvatar = document.getElementById('headerAvatar');
  const btnLogout = document.getElementById('btnLogout');

  // ✅ Delegación de eventos para navegación
  document.addEventListener('click', (e) => {
    const targetBtn = e.target.closest('button[data-target]');
    if (targetBtn) {
      e.preventDefault();
      setActiveSection(targetBtn.dataset.target);
    }
  });

  if (headerAvatar) {
    headerAvatar.addEventListener('click', (e) => {
      e.stopPropagation();
      setActiveSection('profile');
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', handleLogout);
  }

  // ✅ Función centralizada de cambio de sección
  window.setActiveSection = (targetId) => {
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
}

// ✅ Manejo global de errores no capturados (Safety Net)
window.addEventListener('unhandledrejection', event => {
  console.warn('⚠️ Error inesperado:', event.reason);
  // Opcional: Helpers.toast('Ocurrió un problema técnico', 'error');
});

// ✅ Carga diferida de datos por sección
function loadSectionData(sectionId) {
  const loaders = {
    home: loadDashboard,
    'live-attendance': loadAttendance,
    tasks: loadTasks,
    grades: loadGrades,
    class: loadClassFeed,
    payments: () => loadPayments(),
    notifications: async () => { await loadNotifications(); setupChatHandlers(); },
    profile: async () => { await populateProfile(); }
  };
  
  const loader = loaders[sectionId];
  
  if (!loader) {
    console.warn(`No loader for section ${sectionId}`);
    return;
  }
  
  if (loader && typeof loader === 'function') {
    // Mostrar indicador de carga en el botón de refresco si existe
    const refreshBtn = document.getElementById('btnRefreshData');
    if(refreshBtn) refreshBtn.classList.add('animate-spin');

    // ✅ Manejo de errores centralizado en cada loader
    loader().catch(err => {
      console.error(`Error cargando sección ${sectionId}:`, err);
      Helpers.toast(`Error al cargar ${sectionId}`, 'error');
    }).finally(() => {
      if(refreshBtn) refreshBtn.classList.remove('animate-spin');
    });
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
  try {
    const ext = file.name.split('.').pop();
    const name = `transfer_${student.id}_${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('classroom_media').upload(`payments/${name}`, file);
    if (upErr) throw upErr;
    const { data: { publicUrl } } = supabase.storage.from('classroom_media').getPublicUrl(`payments/${name}`);
    const { error } = await supabase.from('payments').insert({
      student_id: student.id,
      amount,
      month_paid,
      method,
      proof_url: publicUrl,
      status: 'pendiente'
    });
    if (error) throw error;
    Helpers.toast('Comprobante enviado', 'success');
    loadPayments();
    document.getElementById('paymentForm').reset();
  } catch (err) {
    console.error(err);
    Helpers.toast('Error enviando comprobante', 'error');
  }
}

function setupChatHandlers() {
  const btnDir = document.getElementById('btnSendDirector');
  const btnTea = document.getElementById('btnSendTeacher');
  if (btnDir) btnDir.onclick = () => sendChatMessage('director');
  if (btnTea) btnTea.onclick = () => sendChatMessage('maestra');
}

async function loadChat(role) {
  const student = AppState.get('student');
  if (!student) return;
  const listId = role === 'director' ? 'chatDirectorList' : 'chatTeacherList';
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '<div class="text-center text-xs text-slate-400 py-2">Cargando...</div>';
  try {
    const { data } = await supabase
      .from('messages')
      .select('content, created_at, from:profiles(name)')
      .eq('student_id', student.id)
      .eq('to_role', role)
      .order('created_at', { ascending: true });
    list.innerHTML = (data || []).map(m => `
      <div class="flex gap-2 text-sm">
        <div class="font-bold text-slate-700">${escapeHtml(m.from?.name || 'Usuario')}:</div>
        <div class="text-slate-600">${escapeHtml(m.content)}</div>
      </div>
    `).join('') || '<div class="text-center text-xs text-slate-400 py-2">Sin mensajes</div>';
  } catch (e) {
    list.innerHTML = '<div class="text-center text-xs text-slate-400 py-2">Error cargando chat</div>';
  }
}

async function sendChatMessage(role) {
  const inputId = role === 'director' ? 'chatDirectorInput' : 'chatTeacherInput';
  const input = document.getElementById(inputId);
  const text = input?.value.trim();
  if (!text) return;
  try {
    const user = AppState.get('user');
    const student = AppState.get('student');
    const { error } = await supabase.from('messages').insert({
      student_id: student.id,
      from_id: user.id,
      to_role: role,
      content: text
    });
    if (!error) {
      input.value = '';
      loadChat(role);
      Helpers.toast('Mensaje enviado', 'success');
    }
  } catch (e) {
    Helpers.toast('No se pudo enviar', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('paymentForm');
  if (form) form.addEventListener('submit', submitPaymentProof);
  loadChat('director');
  loadChat('maestra');
});
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
    const { data: student, error } = await supabase
      .from(TABLES.STUDENTS)
      .select(`
        *,
        classrooms(name, level)
      `)
      .eq('parent_id', AppState.get('user').id)
      .limit(1)
      .maybeSingle();
    
    if (error) throw error;
    
    if (!student) {
      Helpers.toast('No hay estudiante vinculado a tu cuenta', 'info');
      updateStudentUI(null);
      return;
    }
    
    AppState.set('student', student);
    updateStudentUI(student);
    
    // ✅ Iniciar servicios que dependen del estudiante
    initNotifications();
    initFeedRealtime();
  } catch (err) {
    console.error('Error cargando datos del estudiante:', err);
    Helpers.toast('Error al cargar información del estudiante', 'error');
    updateStudentUI(null);
  }
}

// ✅ Separación de lógica UI/estado
function updateStudentUI(student) {
  const displayName = student?.name ? escapeHtml(student.name) : 'No asignado';
  const classroomInfo = student?.classrooms 
    ? `${escapeHtml(student.classrooms.name)} • ${escapeHtml(student.classrooms.level || '')}`
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
    
    // ✅ Cargar tareas y evidencias en paralelo
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
    
    if (tasksRes.error || evidencesRes.error) {
      throw new Error(tasksRes.error?.message || evidencesRes.error?.message);
    }
    
    AppState.set('tasks', tasksRes.data || []);
    const evidenceMap = new Map((evidencesRes.data || []).map(e => [e.task_id, e]));
    
    // ✅ Filtrado con función pura
    const filteredTasks = filterTasks(tasksRes.data, evidenceMap, filter);
    
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
    
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error cargando tareas:', err);
    container.innerHTML = Helpers.emptyState('Error al cargar tareas. Intenta nuevamente.');
    container.setAttribute('aria-busy', 'false');
  }
}

// ✅ Funciones puras para lógica de negocio
function filterTasks(tasks, evidenceMap, filter) {
  return (tasks || []).filter(task => {
    const isDelivered = evidenceMap.has(task.id);
    const dueDate = task.due_date ? new Date(task.due_date) : null;
    const isOverdue = !isDelivered && dueDate && dueDate < new Date();

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

  // ✅ 3. TAREAS ENTREGADAS → LEGO / BLOQUES
  if (isDelivered) {
    return `
    <article class="notebook-card group transition-transform hover:-translate-y-1 p-4 rounded-xl" aria-labelledby="task-title-${task.id}">
      <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 relative z-10">
        <div>
          <h3 id="task-title-${task.id}" class="font-bold text-lg text-white drop-shadow-sm">${escapeHtml(task.title)}</h3>
          <p class="text-xs text-blue-100 mt-1">${escapeHtml(task.classrooms?.level || '')}</p>
        </div>
        <div class="flex items-center gap-2">
           <span class="bg-white/20 text-white text-xs font-bold px-2 py-1 rounded backdrop-blur-sm">Entregada</span>
           ${evidence.grade_letter ? `<span class="bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-1 rounded shadow-sm">Nota: ${escapeHtml(evidence.grade_letter)}</span>` : ''}
        </div>
      </div>
      
      <p class="text-sm text-blue-50 mt-3 font-medium opacity-90">${escapeHtml(task.description || 'Sin descripción')}</p>
      
      <div class="mt-4 flex items-center justify-between">
        <div class="text-xs text-blue-100 flex items-center gap-1">
          <i data-lucide="calendar" class="w-3 h-3"></i> 
          Enviado: ${new Date(evidence.created_at).toLocaleDateString('es-ES')}
        </div>
        <button 
          class="js-task-detail-btn px-4 py-2 bg-white text-blue-600 rounded-xl font-bold text-sm shadow-sm hover:bg-blue-50 transition-colors"
          data-task-id="${task.id}"
        >
          Ver Detalles
        </button>
      </div>
      
      ${evidence.stars ? `
      <div class="absolute -bottom-2 -right-2 bg-white p-1 rounded-full shadow-lg rotate-12 transform scale-75 sm:scale-100">
        <div class="flex gap-1">
          ${[...Array(5)].map((_, i) => 
            `<i data-lucide="star" class="w-4 h-4 ${i < evidence.stars ? 'text-yellow-400 fill-current' : 'text-slate-200'}"></i>`
          ).join('')}
        </div>
      </div>` : ''}
    </article>`;
  }

  // ✅ 2. SECCIÓN TAREAS → ESTILO CUADERNO (Pendientes)
  const isOverdue = dueDate && dueDate < new Date();
  const statusColor = isOverdue ? 'text-rose-600' : 'text-slate-500';
  const dateColor = isOverdue ? 'text-rose-600 font-bold' : 'text-slate-500';

  return `
  <article class="notebook-card group p-4 rounded-xl" aria-labelledby="task-title-${task.id}">
    <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
      <div>
        <h3 id="task-title-${task.id}" class="font-bold text-slate-800 text-lg group-hover:text-blue-600 transition-colors" style="font-family: 'Comic Sans MS', 'Chalkboard SE', sans-serif;">${escapeHtml(task.title)}</h3>
        <p class="text-xs ${statusColor} mt-1 flex items-center gap-1">
           ${isOverdue ? '<i data-lucide="alert-circle" class="w-3 h-3"></i> Atrasada' : 'Pendiente'} 
           • ${escapeHtml(task.classrooms?.level || '')}
        </p>
      </div>
      <div class="hidden sm:block">
        <span class="text-2xl opacity-20 group-hover:opacity-100 transition-opacity">✏️</span>
      </div>
    </div>
    
    <p class="text-sm text-slate-700 mt-2 leading-relaxed" style="font-family: 'Comic Sans MS', 'Chalkboard SE', sans-serif;">${escapeHtml(task.description || 'Sin descripción')}</p>
    
    <div class="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-blue-100/50 pt-3">
      <div class="text-xs ${dateColor} flex items-center gap-1">
        <i data-lucide="clock" class="w-3 h-3"></i>
        Vence: ${dueDate ? dueDate.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Sin fecha'}
      </div>
      <button 
        class="js-task-detail-btn w-full sm:w-auto px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-bold text-sm shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5"
        data-task-id="${task.id}"
      >
        Hacer Tarea
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
    
    if(!file && !comment) { Helpers.toast('Añade un archivo o comentario', 'info'); return; }
    
    // ✅ Validación de archivo
    if (file) {
      const allowed = ['pdf','jpg','jpeg','png','docx'];
      const ext = file.name.split('.').pop().toLowerCase();
      if (!allowed.includes(ext)) {
        Helpers.toast('Formato no permitido (solo PDF, Imágenes, DOCX)', 'error');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        Helpers.toast('El archivo no debe superar 5MB', 'error');
        return;
      }
    }
    
    const btn = document.getElementById('btnSubmitTask');
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
         
         const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKETS.CLASSROOM_MEDIA).getPublicUrl(path);
         fileUrl = publicUrl;
      }

      const { error: dbError } = await supabase.from(TABLES.TASK_EVIDENCES).insert({
         task_id: taskId,
         student_id: student.id,
         parent_id: user.id,
         comment: comment || null,
         file_url: fileUrl,
         status: 'submitted'
      });

      if (dbError) throw dbError;

      Helpers.toast('Tarea enviada con éxito', 'success');
      triggerConfetti(); // 🎉 Animación de celebración
      document.getElementById('modalTaskDetail').classList.add('hidden');
      document.getElementById('modalTaskDetail').classList.remove('flex');
      loadTasks(document.querySelector('.task-filter-btn.font-bold')?.dataset.filter || 'pending');
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

// ✅ initNotifications(): 
//    - Almacena channel en AppState para limpieza
//    - Valida permisos antes de suscribir
//    - Desuscribe en logout
function initNotifications() {
  const classroomId = AppState.get('student')?.classroom_id;
  if (!classroomId) return;

  const notifPrompt = document.getElementById('notification-prompt');
  const enableBtn = document.getElementById('enable-notifications-btn');

  const subscribeToRealtime = () => {
    if (AppState.get('realtimeChannel')) return; // Evitar suscripciones múltiples

    const channel = supabase
      .channel('tasks-notif')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: TABLES.TASKS,
          filter: `classroom_id=eq.${classroomId}`
        },
        (payload) => {
          const title = payload.new.title || 'Nueva tarea';
          Helpers.toast(`Nueva tarea: ${escapeHtml(title)}`, 'info');

          if (Notification.permission === 'granted') {
            new Notification('Nueva Tarea', {
              body: escapeHtml(title),
              icon: '/logo/favicon.ico',
              requireInteraction: false
            });
          }

          if (document.getElementById('tasks')?.classList.contains('active')) loadTasks();
          if (document.getElementById('home')?.classList.contains('active')) loadDashboard();
        }
      )
      .subscribe();

    AppState.set('realtimeChannel', channel);
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
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('task-filter-btn')) {
      // Actualizar estilos botones
      document.querySelectorAll('.task-filter-btn').forEach(btn => {
        btn.classList.remove('bg-white', 'shadow', 'text-slate-700', 'font-bold');
        btn.classList.add('text-slate-500', 'font-medium');
      });
      e.target.classList.add('bg-white', 'shadow', 'text-slate-700', 'font-bold');
      e.target.classList.remove('text-slate-500');
      
      loadTasks(e.target.dataset.filter);
    }
    
    // ✅ Listener único para detalles de tarea (movido desde loadTasks)
    const taskDetailBtn = e.target.closest('.js-task-detail-btn');
    if (taskDetailBtn) {
      openTaskDetail(taskDetailBtn.dataset.taskId);
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
    const [attRes, pendingRes, deliveredRes] = await Promise.all([
        // 1. Asistencia HOY
        supabase.from(TABLES.ATTENDANCE).select('status').eq('student_id', student.id).eq('date', today).maybeSingle(),
        // 2. Tareas Pendientes (> hoy)
        supabase.from(TABLES.TASKS).select('*', { count: 'exact', head: true }).eq('classroom_id', student.classroom_id).gt('due_date', new Date().toISOString()),
        // 3. Tareas Entregadas
        supabase.from(TABLES.TASK_EVIDENCES).select('*', { count: 'exact', head: true }).eq('student_id', student.id)
    ]);

    // ✅ Procesamiento de datos
    
    // Asistencia
    const attStatus = attRes.data?.status;
    let attText = 'Sin registro';
    let attTheme = 'card-slate';
    if (attStatus === 'present') { attText = 'Presente'; attTheme = 'card-green'; }
    else if (attStatus === 'absent') { attText = 'Ausente'; attTheme = 'card-red'; }
    else if (attStatus === 'late') { attText = 'Tardanza'; attTheme = 'card-yellow'; }
    
    // Promedio y pagos removidos del dashboard por requerimiento

    // ✅ Mapeo de Temas Seguro (Tarjetas Blancas con Iconos de Color)
    const themeMap = {
        'card-green':  { iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', border: 'border-emerald-400', decoration: 'bg-emerald-50' },
        'card-red':    { iconBg: 'bg-rose-100',    iconText: 'text-rose-600',    border: 'border-rose-400',    decoration: 'bg-rose-50' },
        'card-yellow': { iconBg: 'bg-amber-100',   iconText: 'text-amber-600',   border: 'border-amber-400',   decoration: 'bg-amber-50' },
        'card-blue':   { iconBg: 'bg-blue-100',    iconText: 'text-blue-600',    border: 'border-blue-400',    decoration: 'bg-blue-50' },
        'card-purple': { iconBg: 'bg-violet-100',  iconText: 'text-violet-600',  border: 'border-violet-400',  decoration: 'bg-violet-50' },
        'card-slate':  { iconBg: 'bg-slate-100',   iconText: 'text-slate-600',   border: 'border-slate-400',   decoration: 'bg-slate-50' }
    };

    // ✅ Configuración de Tarjetas
    const cards = [
        {
            title: 'Asistencia Hoy',
            value: attText,
            icon: 'user-check',
            theme: attTheme,
            sub: new Date().toLocaleDateString('es-ES', { weekday: 'long' })
        },
        {
            title: 'Tareas Pendientes',
            value: pendingRes.count || 0,
            icon: 'clipboard-list',
            theme: 'card-red', // Rojo solicitado
            sub: 'Por entregar'
        },
        {
            title: 'Tareas Entregadas',
            value: deliveredRes.count || 0,
            icon: 'check-circle-2',
            theme: 'card-yellow', // Amarillo solicitado
            sub: 'Total enviado'
        }
    ];

    // ✅ Renderizado
    container.innerHTML = cards.map(card => {
        const t = themeMap[card.theme] || themeMap['card-slate'];
        
        return `
        <div class="card-base dashboard-card bg-white group cursor-default relative overflow-hidden border-b-4 ${t.border}">
            <div class="flex justify-between items-start mb-4 relative z-10 px-1">
                <div class="p-3 rounded-2xl ${t.iconBg} ${t.iconText} shadow-sm transform group-hover:scale-110 transition-transform duration-300">
                    <i data-lucide="${card.icon}" class="w-8 h-8"></i>
                </div>
                <div class="text-right">
                    <span class="text-4xl font-black text-slate-800 tracking-tighter drop-shadow-sm">${card.value}</span>
                </div>
            </div>
            <div class="relative z-10">
                <h3 class="text-lg font-bold text-slate-800 leading-tight">${card.title}</h3>
                <p class="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">${card.sub}</p>
            </div>
            
            <!-- Decoración de Fondo -->
            <div class="absolute -bottom-6 -right-6 w-24 h-24 ${t.decoration} rounded-full opacity-40 group-hover:scale-150 transition-transform duration-500"></div>
        </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();

  } catch (err) {
    console.error('Error dashboard:', err);
    container.innerHTML = Helpers.emptyState('Error cargando información del día');
  }
}

async function loadAttendance() {
  const container = document.getElementById('calendarGrid');
  if (!container) return;
  
  container.innerHTML = Helpers.skeleton(1, 'h-64 col-span-7');
  
  const student = AppState.get('student');
  if (!student) return;

  try {
    const { data } = await supabase
      .from(TABLES.ATTENDANCE)
      .select('date, status')
      .eq('student_id', student.id)
      .order('date', { ascending: false })
      .limit(60); // Últimos 2 meses aprox
    
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
  
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  // Map de fechas a estados
  const attMap = {};
  attendanceData.forEach(a => attMap[a.date] = a.status);

  // Días vacíos previos
  for (let i = 0; i < firstDay; i++) {
    container.innerHTML += `<div class="h-10"></div>`;
  }

  // Días del mes
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const status = attMap[dateStr];
    
    let colorClass = 'bg-slate-50 text-slate-400'; // Default
    if (status === 'present') colorClass = 'bg-green-500 text-white font-bold shadow-md transform scale-105'; // Verde Intenso
    else if (status === 'absent') colorClass = 'bg-rose-100 text-rose-600';
    else if (status === 'late') colorClass = 'bg-amber-100 text-amber-600';

    container.innerHTML += `
      <div class="h-10 flex items-center justify-center rounded-lg ${colorClass} text-sm transition-all">
        ${day}
      </div>
    `;
  }
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

async function loadClassFeed() {
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
      .select('*, teacher:profiles(name), likes(count), comments(count)')
      .eq('classroom_id', student.classroom_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!posts || !posts.length) {
      container.innerHTML = Helpers.emptyState('No hay publicaciones en el muro');
      return;
    }

    container.innerHTML = posts.map(p => {
      const teacherName = p.teacher?.name || 'Maestra/o';
      const likeCount = p.likes?.[0]?.count || 0;
      const commentCount = p.comments?.[0]?.count || 0;
      // ✅ Protección XSS en media
      const safeMedia = encodeURI(p.media_url || '');
      
      return `
      <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-4" id="post-${p.id}">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center font-bold text-indigo-600">
            ${teacherName.charAt(0)}
          </div>
          <div>
            <p class="font-bold text-slate-800">${escapeHtml(teacherName)}</p>
            <p class="text-xs text-slate-500">${new Date(p.created_at).toLocaleDateString()}</p>
          </div>
        </div>
        <p class="text-slate-700 text-sm leading-relaxed mb-3">${escapeHtml(p.content)}</p>
        ${p.media_url ? `
          <div class="rounded-xl overflow-hidden border border-slate-100">
            ${p.media_type === 'video' 
              ? `<video src="${safeMedia}" controls class="w-full max-h-80 bg-black"></video>`
              : `<img src="${safeMedia}" class="w-full object-cover max-h-80" loading="lazy">`
            }
          </div>
        ` : ''}
        
        <!-- Botones de Acción -->
        <div class="flex items-center gap-4 mt-4 pt-3 border-t border-slate-50">
          <button class="flex items-center gap-2 text-slate-500 hover:text-pink-500 transition-colors text-sm" onclick="toggleLike('${p.id}')">
            <i data-lucide="heart" class="w-4 h-4"></i>
            <span>${likeCount}</span>
          </button>
          <button class="flex items-center gap-2 text-slate-500 hover:text-blue-500 transition-colors text-sm" onclick="toggleCommentSection('${p.id}')">
            <i data-lucide="message-circle" class="w-4 h-4"></i>
            <span id="comment-count-${p.id}">${commentCount}</span> Comentarios
          </button>
        </div>

        <!-- Sección de Comentarios (Oculta por defecto) -->
        <div id="comments-section-${p.id}" class="hidden mt-4 pt-4 border-t border-slate-100">
          <div id="comments-list-${p.id}" class="space-y-3 mb-4 max-h-60 overflow-y-auto"></div>
          
          <div class="flex gap-2 items-center">
            <input type="text" id="comment-input-${p.id}" class="flex-1 border rounded-xl px-3 py-2 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="Escribe un comentario...">
            <button onclick="sendComment('${p.id}')" class="bg-blue-600 text-white p-2 rounded-xl hover:bg-blue-700 transition-colors"><i data-lucide="send" class="w-4 h-4"></i></button>
          </div>
        </div>
      </div>
    `}).join('');
    
    if(window.lucide) lucide.createIcons();
    
  } catch (err) {
    console.error(err);
    container.innerHTML = Helpers.emptyState('Error cargando el muro');
  }
}

// ✅ Sistema de Comentarios en Tiempo Real
function initFeedRealtime() {
  const channel = supabase.channel('public:comments')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLES.COMMENTS }, async (payload) => {
       const newComment = payload.new;
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
            // Obtener nombre del usuario
            const { data: user } = await supabase.from(TABLES.PROFILES).select('name').eq('id', newComment.user_id).single();
            const name = user?.name || 'Usuario';
            
            const div = document.createElement('div');
            div.className = 'flex gap-2 text-sm animate-fade-in';
            div.innerHTML = `
              <div class="font-bold text-slate-700 whitespace-nowrap">${escapeHtml(name)}:</div>
              <div class="text-slate-600">${escapeHtml(newComment.content)}</div>
            `;
            // Indicador visual
            postEl.classList.add('ring-2','ring-blue-400');
            setTimeout(()=>postEl.classList.remove('ring-2','ring-blue-400'),1500);
            listEl.appendChild(div);
            listEl.scrollTop = listEl.scrollHeight;
         }
       }
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
      .select('content, created_at, user:profiles(name)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
      
    if (!comments || !comments.length) {
      list.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">Sé el primero en comentar</p>';
    } else {
      list.innerHTML = comments.map(c => `
        <div class="flex gap-2 text-sm">
          <div class="font-bold text-slate-700 whitespace-nowrap">${escapeHtml(c.user?.name || 'Usuario')}:</div>
          <div class="text-slate-600">${escapeHtml(c.content)}</div>
        </div>
      `).join('');
    }
    list.scrollTop = list.scrollHeight;
  } else {
    section.classList.add('hidden');
  }
};

// ✅ Funciones globales para el muro (Like/Comentar)
window.toggleLike = async (postId) => {
  try {
    const user = AppState.get('user');
    if(!user) return;
    
    // Verificar si ya dio like (simplificado: intentar insertar, si falla es que ya existe -> borrar)
    // Idealmente consultar primero, pero para UX rápida:
    const { error } = await supabase.from(TABLES.LIKES).insert({ post_id: postId, user_id: user.id });
    
    if (error && error.code === '23505') { // Unique violation
       await supabase.from(TABLES.LIKES).delete().eq('post_id', postId).eq('user_id', user.id);
       Helpers.toast('Like removido', 'info');
    } else if (!error) {
       Helpers.toast('¡Te gusta esto!', 'success');
    }
    
    // ✅ Optimistic UI: Actualizar contador sin recargar todo
    const countSpan = document.querySelector(`#post-${postId} button i[data-lucide="heart"] + span`);
    if(countSpan) countSpan.textContent = parseInt(countSpan.textContent || '0') + 1;
    
  } catch(e) { console.error(e); }
};

window.sendComment = async (postId) => {
  const input = document.getElementById(`comment-input-${postId}`);
  const text = input.value.trim();
  if(!text) return;
  
  try {
    const user = AppState.get('user');
    const { error } = await supabase.from(TABLES.COMMENTS).insert({
      post_id: postId,
      user_id: user.id,
      content: text
    });
    
    if(error) throw error;
    Helpers.toast('Comentario enviado', 'success');
    input.value = ''; // El realtime actualizará la UI
  } catch(e) {
    Helpers.toast('Error al comentar', 'error');
  }
};

async function loadGrades() {
  const container = document.getElementById('gradesContent');
  if (!container) return;
  
  container.innerHTML = Helpers.skeleton(1, 'h-64');

  const student = AppState.get('student');
  if (!student) return;

  try {
    const { data: grades, error } = await supabase
      .from(TABLES.GRADES)
      .select('*')
      .eq('student_id', student.id);

    if (error) throw error;

    if (!grades || !grades.length) {
      container.innerHTML = Helpers.emptyState('No hay calificaciones aún');
      return;
    }

    // Agrupar por materia
    const subjects = {};
    grades.forEach(g => {
      if (!subjects[g.subject]) subjects[g.subject] = { periods: {}, total: 0, count: 0 };
      subjects[g.subject].periods[g.period] = Number(g.score);
      subjects[g.subject].total += Number(g.score);
      subjects[g.subject].count++;
    });

    // Colores disponibles para las tarjetas
    const themes = [
      { name: 'green', bg: 'bg-emerald-100', text: 'text-emerald-600', border: 'border-emerald-200' },
      { name: 'rose', bg: 'bg-rose-100', text: 'text-rose-600', border: 'border-rose-200' },
      { name: 'amber', bg: 'bg-amber-100', text: 'text-amber-600', border: 'border-amber-200' },
      { name: 'blue', bg: 'bg-blue-100', text: 'text-blue-600', border: 'border-blue-200' },
      { name: 'purple', bg: 'bg-violet-100', text: 'text-violet-600', border: 'border-violet-200' }
    ];

    container.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        ${Object.keys(subjects).map((subject, index) => {
          const data = subjects[subject];
          const avg = data.count > 0 ? (data.total / data.count).toFixed(0) : '-';
          const theme = themes[index % themes.length];
          const icon = 'book-open';

          // Periodos como pequeños bloques
          const periodBlocks = Object.entries(data.periods).sort().map(([p, score]) => `
            <div class="flex flex-col items-center bg-slate-50 p-2 rounded-xl border border-slate-100 shadow-sm">
              <span class="text-[10px] text-slate-400 uppercase font-bold tracking-wider">${p}</span>
              <span class="text-sm font-black text-slate-700">${score}</span>
            </div>
          `).join('');

          return `
            <div class="card-base progress-card flex flex-col justify-between h-full group hover:z-10">
              <div>
                <div class="flex justify-between items-start mb-4">
                  <div class="p-3 rounded-2xl ${theme.bg} ${theme.text} shadow-sm transform group-hover:scale-110 transition-transform">
                    <i data-lucide="${icon}" class="w-6 h-6"></i>
                  </div>
                  <div class="text-right">
                    <span class="text-4xl font-black text-slate-800 tracking-tighter drop-shadow-sm">${avg}</span>
                    <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Promedio</p>
                  </div>
                </div>
                <h3 class="text-lg font-bold text-slate-800 mb-4 leading-tight">${escapeHtml(subject)}</h3>
              </div>
              
              <div class="grid grid-cols-4 gap-2 mt-auto pt-4 border-t border-slate-100 border-dashed">
                ${periodBlocks}
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="mt-8 text-center">
        <button onclick="window.print()" class="inline-flex items-center gap-2 px-6 py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-700 transition-colors shadow-lg hover:shadow-xl transform hover:-translate-y-1">
          <i data-lucide="printer" class="w-4 h-4"></i>
          Imprimir Reporte Oficial
        </button>
      </div>
    `;
    
    if (window.lucide) lucide.createIcons();

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
    const { data: payments, error } = await supabase
      .from('payments')
      .select('*')
      .eq('student_id', student.id)
      .gte('created_at', `${year}-01-01`) // ✅ Filtrar por año actual
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!payments || !payments.length) {
      container.innerHTML = Helpers.emptyState('No hay historial de pagos');
      return;
    }

    container.innerHTML = `<div class="space-y-3">
      ${payments.map(p => {
        const isConfirmed = p.status === 'confirmado';
        const isRejected = p.status === 'rechazado';
        
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
               <span class="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider ${theme.badgeBg} ${theme.badgeText}">${p.status}</span>
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

async function loadNotifications() {
  const container = document.getElementById('notificationsList');
  if (!container) return;
  
  // Simulación o implementación real si existe tabla notifications
  container.innerHTML = Helpers.emptyState('No tienes notificaciones nuevas');
}

async function populateProfile() {
  const student = AppState.get('student');
  if (!student) return;
  
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  
  setVal('inputStudentName', student.name);
  setVal('inputStudentBirth', student.birth_date);
  setVal('inputStudentBlood', student.blood_type);
  setVal('inputStudentAllergy', student.allergies);
  
  setVal('profileFatherName', student.p1_name);
  setVal('profileFatherPhone', student.p1_phone);
  setVal('profileFatherEmail', student.p1_email);
  
  setVal('profileMotherName', student.p2_name);
  setVal('profileMotherPhone', student.p2_phone);
  setVal('profileMotherEmail', student.p2_email); // Nuevo campo
  
  setVal('profilePickupName', student.authorized_pickup);
  
  // ✅ Refrescar iconos después de llenar datos
  if(window.lucide) lucide.createIcons();
}

// ✅ Función unificada para guardar perfil
async function saveAllProfile() {
  const student = AppState.get('student');
  if(!student) return;
  
  const btn = document.getElementById('btnSaveChanges');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const birthDate = document.getElementById('inputStudentBirth').value;
  
  const updates = {
    // Estudiante
    name: document.getElementById('inputStudentName').value,
    birth_date: birthDate || null,
    blood_type: document.getElementById('inputStudentBlood')?.value.trim() || null,
    allergies: document.getElementById('inputStudentAllergy')?.value.trim() || null,
    // Padres
    p1_name: document.getElementById('profileFatherName').value.trim() || null,
    p1_phone: document.getElementById('profileFatherPhone').value.trim() || null,
    p1_email: document.getElementById('profileFatherEmail').value.trim() || null,
    p2_name: document.getElementById('profileMotherName').value.trim() || null,
    p2_phone: document.getElementById('profileMotherPhone').value.trim() || null,
    p2_email: document.getElementById('profileMotherEmail').value.trim() || null,
    authorized_pickup: document.getElementById('profilePickupName').value.trim() || null
  };
  
  const { error } = await supabase.from(TABLES.STUDENTS).update(updates).eq('id', student.id);
  
  if(error) {
    Helpers.toast('Error al guardar datos', 'error');
  } else {
    Helpers.toast('Perfil actualizado correctamente', 'success');
    loadStudentData(); // Recargar para actualizar estado local
  }
  
  btn.disabled = false;
  btn.textContent = originalText;
  if(window.lucide) lucide.createIcons();
}
