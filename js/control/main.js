import { supabase, ensureRole } from '../shared/supabase.js';
import { logError, auditLog } from '../shared/db-utils.js';

// Bloquear redirección por SIGNED_OUT desde el primer momento
// (antes de DOMContentLoaded, para que onAuthStateChange no interrumpa el init)
window._karpusInitializing = true;

// Función global para cerrar sesión desde onclick inline
window._signOutAndRedirect = async () => {
  try { await supabase.auth.signOut(); } catch (_) {}
  window.location.href = 'login.html';
};

// ── State ─────────────────────────────────────────────────────────────────────
let allUsers    = [];
let allAudit    = [];
let allPayments = [];
let allStudents = [];
let allClassrooms = [];
let allAttend   = [];
let allPunches  = [];
let fraudEvents = [];
let currentUser = null;

// ── Init ──────────────────────────────────────────────────────────────────────
function _setLoaderMsg(msg) {
  const loader = document.getElementById('loader');
  if (!loader) return;
  const span = loader.querySelector('span');
  if (span) span.textContent = msg;
}

document.addEventListener('DOMContentLoaded', async () => {
  // Timeout de seguridad: si en 15s no carga, mostrar error
  const loaderTimeout = setTimeout(() => {
    window._karpusInitializing = false;
    const loader = document.getElementById('loader');
    if (loader) {
      loader.innerHTML = `
        <div style="text-align:center;padding:32px;">
          <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
          <p style="color:#f87171;font-weight:800;font-size:14px;margin-bottom:8px;">Tiempo de espera agotado</p>
          <p style="color:#94a3b8;font-size:12px;margin-bottom:20px;">No se pudo conectar con el servidor. Verifica tu conexión.</p>
          <button onclick="window.location.href='login.html'" style="background:#6366f1;color:white;border:none;padding:10px 24px;border-radius:10px;font-weight:800;cursor:pointer;font-size:13px;">Volver al Login</button>
          <button onclick="window.location.reload()" style="background:rgba(255,255,255,.1);color:#94a3b8;border:1px solid rgba(255,255,255,.1);padding:10px 24px;border-radius:10px;font-weight:800;cursor:pointer;font-size:13px;margin-left:8px;">Reintentar</button>
        </div>`;
    }
  }, 15000);

  try {
    // ── Paso 1: Sesión local ──────────────────────────────────────────────────
    _setLoaderMsg('Verificando sesión...');
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();

    if (sessionErr || !sessionData?.session?.user) {
      clearTimeout(loaderTimeout);
      window._karpusInitializing = false;
      window.location.href = 'login.html';
      return;
    }

    const session = sessionData.session;
    let userId    = session.user.id;
    let userEmail = session.user.email;

    // ── Paso 2: Refrescar token si está próximo a expirar ────────────────────
    _setLoaderMsg('Validando credenciales...');
    const expiresAt = session.expires_at || 0;
    const nowSec    = Math.floor(Date.now() / 1000);
    const needsRefresh = (expiresAt - nowSec) < 300; // menos de 5 min

    if (needsRefresh) {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr || !refreshed?.session) {
        clearTimeout(loaderTimeout);
        window._karpusInitializing = false;
        window.location.href = 'login.html';
        return;
      }
      userId    = refreshed.session.user.id;
      userEmail = refreshed.session.user.email;
    }

    // ── Paso 3: Obtener perfil ────────────────────────────────────────────────
    _setLoaderMsg('Verificando permisos...');
    console.log('[Paso 3] Iniciando carga de perfil para:', userId);
    let profile = null;

    // 1. Cache local
    const CACHE_KEY = 'karpus_ctrl_profile_' + userId;
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && cached.role && cached.ts && (Date.now() - cached.ts) < 3600000) {
        console.log('[Paso 3] Perfil cargado desde caché:', cached.role);
        profile = { id: userId, email: userEmail, name: cached.name || userEmail.split('@')[0], role: cached.role };
      }
    } catch (_) {}

    // 2. JWT app_metadata
    if (!profile) {
      const jwtRole = session.user?.app_metadata?.role || session.user?.user_metadata?.role || null;
      if (jwtRole && ['admin', 'directora'].includes(jwtRole)) {
        console.log('[Paso 3] Rol detectado en JWT:', jwtRole);
        profile = { id: userId, email: userEmail, name: userEmail.split('@')[0], role: jwtRole };
      }
    }

    // 3. Query a DB
    if (!profile) {
      console.log('[Paso 3] Consultando base de datos para perfil...');
      let timedOut = false;
      const profileTimer = setTimeout(() => {
        timedOut = true;
        console.error('[Paso 3] Timeout al consultar perfil');
        clearTimeout(loaderTimeout);
        window._karpusInitializing = false;
        const el = document.getElementById('loader');
        if (el) el.innerHTML = [
          '<div style="text-align:center;padding:32px">',
          '<div style="font-size:32px;margin-bottom:12px">⚠️</div>',
          '<p style="color:#f87171;font-weight:800;font-size:14px;margin-bottom:8px">Sin conexión con Supabase</p>',
          '<p style="color:#94a3b8;font-size:12px;margin-bottom:16px">El servidor no respondió en 8s.</p>',
          '<p style="color:#64748b;font-size:11px;margin-bottom:16px">Email: ' + userEmail + '</p>',
          '<div style="display:flex;gap:8px;justify-content:center">',
          '<button onclick="window.location.reload()" style="background:#6366f1;color:white;border:none;padding:10px 20px;border-radius:10px;font-weight:800;cursor:pointer;font-size:12px">Reintentar</button>',
          '<button onclick="window._signOutAndRedirect()" style="background:rgba(255,255,255,.1);color:#94a3b8;border:1px solid rgba(255,255,255,.1);padding:10px 20px;border-radius:10px;font-weight:800;cursor:pointer;font-size:12px">Cerrar Sesión</button>',
          '</div></div>'
        ].join('');
      }, 8000);

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, name, email, role')
          .eq('id', userId);

        clearTimeout(profileTimer);
        if (timedOut) return;

        console.log('[Paso 3] Respuesta DB:', { data, error });

        if (!error && data) {
          // Manejar si viene como array o como objeto único
          const rawProfile = Array.isArray(data) ? data[0] : data;
          
          if (rawProfile) {
            profile = rawProfile;
            console.log('[Paso 3] Perfil obtenido:', profile.role);
            // Guardar en cache para próximas cargas
            try {
              localStorage.setItem(CACHE_KEY, JSON.stringify({ role: profile.role, name: profile.name, ts: Date.now() }));
            } catch (_) {}
          } else {
            console.warn('[Paso 3] No se encontró perfil para el ID:', userId);
          }
        } else if (error) {
          console.error('[Paso 3] Error en consulta de perfil:', error);
          clearTimeout(loaderTimeout);
          window._karpusInitializing = false;
          const el = document.getElementById('loader');
          if (el) el.innerHTML = '<div style="text-align:center;padding:32px"><p style="color:#f87171;font-weight:800">Error DB: ' + error.message + '</p><button onclick="window.location.reload()" style="background:#6366f1;color:white;border:none;padding:10px 20px;border-radius:10px;font-weight:800;cursor:pointer;margin-top:12px">Reintentar</button></div>';
          return;
        }
      } catch (e) {
        console.error('[Paso 3] Excepción en consulta de perfil:', e);
        clearTimeout(profileTimer);
        if (timedOut) return;
        clearTimeout(loaderTimeout);
        window._karpusInitializing = false;
        const el = document.getElementById('loader');
        if (el) el.innerHTML = '<div style="text-align:center;padding:32px"><p style="color:#f87171;font-weight:800">Error de red: ' + (e.message || String(e)) + '</p><button onclick="window.location.reload()" style="background:#6366f1;color:white;border:none;padding:10px 20px;border-radius:10px;font-weight:800;cursor:pointer;margin-top:12px">Reintentar</button></div>';
        return;
      }
    }

    if (!profile) {
      console.error('[Paso 3] Fin del proceso: Perfil NO encontrado');
      clearTimeout(loaderTimeout);
      window._karpusInitializing = false;
      const el = document.getElementById('loader');
      if (el) el.innerHTML = '<div style="text-align:center;padding:32px;max-width:440px"><div style="font-size:32px;margin-bottom:12px">🔒</div><p style="color:#f87171;font-weight:800;font-size:14px;margin-bottom:8px">Sin perfil configurado</p><p style="color:#94a3b8;font-size:12px;margin-bottom:8px">Tu cuenta no tiene un perfil en la tabla profiles.</p><p style="color:#64748b;font-size:11px;margin-bottom:4px">Email: ' + userEmail + '</p><p style="color:#64748b;font-size:10px;margin-bottom:16px;font-family:monospace">UUID: ' + userId + '</p><div style="background:#1e293b;border:1px solid rgba(99,102,241,.3);border-radius:10px;padding:12px;margin-bottom:16px;text-align:left"><p style="color:#94a3b8;font-size:11px;font-weight:700;margin-bottom:6px">Ejecuta en Supabase SQL Editor:</p><code style="color:#a5b4fc;font-size:10px;line-height:1.6;display:block;white-space:pre-wrap">INSERT INTO public.profiles (id, email, name, role, accepted_terms) VALUES (\'' + userId + '\', \'' + userEmail + '\', \'Administrador\', \'admin\', true) ON CONFLICT (id) DO UPDATE SET role = \'admin\';</code></div><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button onclick="window.location.reload()" style="background:#6366f1;color:white;border:none;padding:10px 20px;border-radius:10px;font-weight:800;cursor:pointer;font-size:12px">Reintentar</button><button onclick="window._signOutAndRedirect()" style="background:rgba(255,255,255,.1);color:#94a3b8;border:1px solid rgba(255,255,255,.1);padding:10px 20px;border-radius:10px;font-weight:800;cursor:pointer;font-size:12px">Cerrar Sesión</button></div></div>';
      return;
    }

    // ── Paso 4: Verificar rol ─────────────────────────────────────────────────
    console.log('[Paso 4] Verificando rol permitido...');
    const allowedRoles = ['admin', 'directora'];
    const userRole = (profile.role || '').toLowerCase();
    
    if (!allowedRoles.includes(userRole)) {
      console.warn('[Paso 4] Rol NO permitido:', userRole);
      clearTimeout(loaderTimeout);
      window._karpusInitializing = false;
      const loader = document.getElementById('loader');
      if (loader) {
        loader.innerHTML = `
          <div style="text-align:center;padding:32px;">
            <div style="font-size:32px;margin-bottom:12px;">🚫</div>
            <p style="color:#f87171;font-weight:800;font-size:14px;margin-bottom:8px;">Acceso denegado</p>
            <p style="color:#94a3b8;font-size:12px;margin-bottom:4px;">Tu rol: <strong style="color:#f1f5f9;">${userRole || '(sin rol)'}</strong></p>
            <p style="color:#94a3b8;font-size:12px;margin-bottom:20px;">Solo administradores y directoras pueden acceder.</p>
            <div style="background:rgba(0,0,0,0.2);padding:10px;border-radius:8px;font-family:monospace;font-size:10px;color:#64748b;margin-bottom:20px;text-align:left;overflow-x:auto;">
              Profile: ${JSON.stringify(profile)}
            </div>
            <button onclick="window.location.href='login.html'" style="background:#6366f1;color:white;border:none;padding:10px 24px;border-radius:10px;font-weight:800;cursor:pointer;font-size:13px;">Volver al Login</button>
          </div>`;
      }
      return;
    }

    // ── Paso 5: Mostrar panel ─────────────────────────────────────────────────
    console.log('[Paso 5] Inicializando panel para:', profile.name);
    clearTimeout(loaderTimeout);
    window._karpusInitializing = false;
    currentUser = profile;

    const adminName   = document.getElementById('adminName');
    const adminAvatar = document.getElementById('adminAvatar');
    const cfgEmail    = document.getElementById('cfgEmail');
    const cfgName     = document.getElementById('cfgName');

    if (adminName)   adminName.textContent   = profile.name || userEmail;
    if (adminAvatar) adminAvatar.textContent = (profile.name || userEmail)[0].toUpperCase();
    if (cfgEmail)    cfgEmail.value          = userEmail || '';
    if (cfgName)     cfgName.value           = profile.name || '';

    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('hidden');

    setInterval(() => {
      const clock = document.getElementById('topClock');
      if (clock) clock.textContent = new Date().toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'medium' });
    }, 1000);

    const mobMenuBtn = document.getElementById('mobMenuBtn');
    if (window.innerWidth <= 768 && mobMenuBtn) {
      mobMenuBtn.style.display = 'block';
    }

    await refreshAll();
    startRealtime();

  } catch (err) {
    clearTimeout(loaderTimeout);
    window._karpusInitializing = false;
    const loader = document.getElementById('loader');
    if (loader) {
      const msg = err?.message || String(err);
      loader.innerHTML = `
        <div style="text-align:center;padding:32px;">
          <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
          <p style="color:#f87171;font-weight:800;font-size:14px;margin-bottom:8px;">Error inesperado</p>
          <p style="color:#94a3b8;font-size:12px;margin-bottom:20px;">${msg}</p>
          <button onclick="window.location.href='login.html'" style="background:#6366f1;color:white;border:none;padding:10px 24px;border-radius:10px;font-weight:800;cursor:pointer;font-size:13px;">Volver al Login</button>
          <button onclick="window.location.reload()" style="background:rgba(255,255,255,.1);color:#94a3b8;border:1px solid rgba(255,255,255,.1);padding:10px 24px;border-radius:10px;font-weight:800;cursor:pointer;font-size:13px;margin-left:8px;">Reintentar</button>
        </div>`;
    }
    logError('panel_control', err.message || String(err), err.stack || '', 'DOMContentLoaded').catch(() => {});
  }
});

// ── Navigation ────────────────────────────────────────────────────────────────
window.goTo = function(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('sec-' + id)?.classList.add('active');
  document.querySelector(`[onclick="goTo('${id}')"]`)?.classList.add('active');

  const titles = {
    dashboard:    ['Dashboard', 'Vista general del sistema'],
    auditoria:    ['Auditoría', 'Registro completo de movimientos'],
    fraude:       ['Alertas de Fraude', 'Detección automática de patrones sospechosos'],
    usuarios:     ['Usuarios', 'Todos los usuarios del sistema'],
    padres:       ['Padres', 'Gestión de padres de familia'],
    maestras:     ['Maestras y Asistentes', 'Personal docente'],
    directoras:   ['Directoras', 'Administración escolar'],
    pagos:        ['Pagos', 'Historial financiero completo'],
    asistencia:   ['Asistencia', 'Control de entradas y salidas'],
    errores:      ['Errores del Sistema', 'Log de errores y excepciones'],
    configuracion:['Configuración', 'Ajustes del panel de control'],
  };
  const [title, sub] = titles[id] || ['Panel', ''];
  document.getElementById('pageTitle').textContent    = title;
  document.getElementById('pageSubtitle').textContent = sub;

  if (id === 'auditoria')   renderAuditTable(allAudit);
  if (id === 'fraude')      renderFraud();
  if (id === 'usuarios')    renderUsers(allUsers);
  if (id === 'padres')      renderPadres();
  if (id === 'maestras')    renderMaestras();
  if (id === 'directoras')  renderRoleTable('directoras', allUsers.filter(u => u.role === 'directora'));
  if (id === 'pagos')       renderPayments();
  if (id === 'asistencia')  renderAttendance();
  if (id === 'errores')     renderErrors();
  if (id === 'seguridad')   { renderBruteForce(); loadSecurityStats(); loadPaymentAudit(); }
};

// ── Refresh ───────────────────────────────────────────────────────────────────
window.refreshAll = async function() {
  console.log('[refreshAll] Iniciando carga de datos...');
  try {
    await Promise.allSettled([
      loadUsers(), loadAudit(), loadPayments(),
      loadAttendance(), loadStudents(), loadClassrooms(), loadPunches()
    ]);
    console.log('[refreshAll] Datos cargados, renderizando dashboard...');
    renderDashboard();
  } catch (err) {
    console.error('[refreshAll] Error crítico:', err);
  }
};

// ── Load data ─────────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    console.log('[loadUsers] Cargando usuarios...');
    const { data } = await supabase
      .from('profiles')
      .select('id, name, email, role, created_at, avatar_url, phone, bio, last_sign_in_at')
      .order('created_at', { ascending: false })
      .limit(300);
    allUsers = data || [];
    console.log('[loadUsers] OK:', allUsers.length);
    const kpi = document.getElementById('kpi-users');
    if (kpi) kpi.textContent = allUsers.length;
    const cfgCount = document.getElementById('cfgUserCount');
    if (cfgCount) cfgCount.textContent = allUsers.length;
  } catch (err) { 
    console.error('[loadUsers] Error:', err);
    logError('panel_control', err.message || String(err), err.stack || '', 'loadUsers').catch(() => {});
    allUsers = []; 
  }
}

async function loadPunches() {
  try {
    console.log('[loadPunches] Cargando accesos...');
    // Last 30 days of door punches — used for "último acceso"
    const since = new Date(); since.setDate(since.getDate() - 30);
    const { data } = await supabase
      .from('door_punches')
      .select('staff_id, student_id, punched_at, punch_type')
      .gte('punched_at', since.toISOString())
      .order('punched_at', { ascending: false });
    allPunches = data || [];
    console.log('[loadPunches] OK:', allPunches.length);
  } catch (err) { 
    console.error('[loadPunches] Error:', err);
    logError('panel_control', err?.message || String(err), err?.stack || '', 'loadPunches').catch(() => {});
    allPunches = []; 
  }
}

async function loadAudit() {
  try {
    console.log('[loadAudit] Cargando auditoría...');
    // Try audit_logs first, fallback to system_events
    let data = null;
    const { data: d1, error: e1 } = await supabase
      .from('audit_logs')
      .select('id, user_id, action, payload, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (!e1) {
      data = d1;
    } else {
      console.warn('[loadAudit] audit_logs falló, usando system_events...');
      // Fallback: system_events
      const { data: d2 } = await supabase
        .from('system_events')
        .select('id, user_id:payload->user_id, action:type, payload, created_at')
        .order('created_at', { ascending: false })
        .limit(500);
      data = (d2 || []).map(e => ({
        id: e.id,
        user_id: e.payload?.user_id || null,
        action: e.action || e.type || '—',
        payload: e.payload,
        created_at: e.created_at
      }));
    }
    allAudit = data || [];
    console.log('[loadAudit] OK:', allAudit.length);
    const badge = document.getElementById('badge-audit');
    if (badge) badge.textContent = allAudit.length;
  } catch (err) { 
    console.error('[loadAudit] Error:', err);
    logError('panel_control', err?.message || String(err), err?.stack || '', 'loadAudit').catch(() => {});
    allAudit = []; 
  }
}

async function loadPayments() {
  try {
    console.log('[loadPayments] Cargando pagos...');
    const { data, error } = await supabase
      .from('payments')
      .select('id, amount, status, method, bank, month_paid, created_at, student_id, student:student_id(name, p1_name)')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw error;
    allPayments = data || [];
    console.log('[loadPayments] OK:', allPayments.length);
  } catch (err) { 
    console.error('[loadPayments] Error:', err);
    logError('panel_control', err?.message || String(err), err?.stack || '', 'loadPayments').catch(() => {});
    allPayments = []; 
  }
}

async function loadStudents() {
  try {
    console.log('[loadStudents] Cargando estudiantes...');
    const { data } = await supabase
      .from('students')
      .select('id, name, parent_id, classroom_id, is_active, matricula');
    allStudents = data || [];
    console.log('[loadStudents] OK:', allStudents.length);
    const kpi = document.getElementById('kpi-students');
    if (kpi) kpi.textContent = allStudents.filter(s => s.is_active).length;
  } catch (err) { 
    console.error('[loadStudents] Error:', err);
    logError('panel_control', err?.message || String(err), err?.stack || '', 'loadStudents').catch(() => {});
    allStudents = []; 
  }
}

async function loadClassrooms() {
  try {
    console.log('[loadClassrooms] Cargando aulas...');
    const { data } = await supabase.from('classrooms').select('id, name, teacher_id');
    allClassrooms = data || [];
    console.log('[loadClassrooms] OK:', allClassrooms.length);
  } catch (err) { 
    console.error('[loadClassrooms] Error:', err);
    logError('panel_control', err?.message || String(err), err?.stack || '', 'loadClassrooms').catch(() => {});
    allClassrooms = []; 
  }
}

async function loadAttendance() {
  const today = new Date().toISOString().split('T')[0];
  try {
    console.log('[loadAttendance] Cargando asistencia de hoy...');
    // Fetch attendance with student names
    const { data, error } = await supabase
      .from('attendance')
      .select('id, date, check_in, check_out, status, student_id, classroom_id, student:student_id(name), classroom:classroom_id(name)')
      .order('date', { ascending: false })
      .limit(300);
    
    if (error) throw error;
    allAttend = data || [];
    console.log('[loadAttendance] OK:', allAttend.length);
    const todayCount = allAttend.filter(a => a.date === today).length;
    const kpi = document.getElementById('kpi-attendance');
    if (kpi) kpi.textContent = todayCount;
  } catch (err) {
    console.error('[loadAttendance] Error primary:', err);
    // Fallback without joins
    try {
      console.log('[loadAttendance] Intentando fallback sin joins...');
      const { data } = await supabase
        .from('attendance')
        .select('id, date, check_in, check_out, status, student_id, classroom_id')
        .order('date', { ascending: false })
        .limit(300);
      allAttend = data || [];
      console.log('[loadAttendance] Fallback OK:', allAttend.length);
    } catch (err2) { 
      console.error('[loadAttendance] Error total:', err2);
      logError('panel_control', err2?.message || String(err2), err2?.stack || '', 'loadAttendance_fallback').catch(() => {});
      allAttend = []; 
    }
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function renderDashboard() {
  try {
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const monthPays = allPayments.filter(p => p.created_at?.startsWith(monthStr));
    const kpiPayments = document.getElementById('kpi-payments');
    if (kpiPayments) kpiPayments.textContent = monthPays.length;
    const revenue = monthPays
      .filter(p => ['paid','pagado','confirmado','approved'].includes((p.status||'').toLowerCase()))
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const kpiRevenue = document.getElementById('kpi-revenue');
    if (kpiRevenue) kpiRevenue.textContent = revenue.toLocaleString('es-DO');
    detectFraud();
    const kpiAlerts = document.getElementById('kpi-alerts');
    if (kpiAlerts) kpiAlerts.textContent = fraudEvents.length;
    const badgeFraud = document.getElementById('badge-fraud');
    if (badgeFraud) badgeFraud.textContent = fraudEvents.length;
    
    // ✅ HEALTHCHECK: Estado del Ciclo de Pagos
    const { data: health } = await supabase.rpc('check_payment_cycle_health');
    const healthWidget = document.getElementById('paymentHealthWidget');
    if (healthWidget) {
      const isOk = health?.status === 'ok';
      healthWidget.className = `card ${isOk ? 'border-l-emerald-500' : 'border-l-rose-500'} border-l-4`;
      healthWidget.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 class="card-title">Salud del Ciclo</h3>
          <span class="badge ${isOk ? 'badge-green' : 'badge-red'}">${isOk ? 'OK' : 'ERROR'}</span>
        </div>
        <p style="font-size:11px;color:var(--muted);margin-bottom:12px;">${health?.message || 'Verificando...'}</p>
        ${!isOk ? `<button onclick="App.runEmergencyCycle()" class="btn-primary" style="width:100%;background:#ef4444;font-size:10px;padding:8px;">Reparar Ahora</button>` : ''}
      `;
    }

    renderRecentAudit();
    renderFraudAlertsList();
    renderCharts();
  } catch (_) {}
}

window.App.runEmergencyCycle = async function() {
  if (!confirm('¿Ejecutar ciclo de pagos de emergencia?')) return;
  const { data, error } = await supabase.rpc('run_payment_cycle');
  if (error) alert('Error: ' + error.message);
  else alert('Éxito: ' + data.generated + ' cobros generados.');
  window.location.reload();
};

// ── Charts ────────────────────────────────────────────────────────────────────
let chartActivity = null, chartRoles = null, chartPaymentsChart = null, chartAttendChart = null;

function renderCharts() {
  const canvasActivity = document.getElementById('chartActivity');
  if (canvasActivity) {
    const actCtx = canvasActivity.getContext('2d');
    if (actCtx) {
      if (chartActivity) chartActivity.destroy();
      try {
        const rc = { padre: 0, maestra: 0, directora: 0 };
        allUsers.forEach(u => { if (rc[u.role] !== undefined) rc[u.role]++; });
        chartActivity = new Chart(actCtx, {
          type: 'bar',
          data: {
            labels: ['Padres','Maestras','Directoras'],
            datasets: [{ label: 'Usuarios', data: [rc.padre, rc.maestra, rc.directora], backgroundColor: ['#6366f1','#22c55e','#f97316'], borderRadius: 6, barThickness: 20 }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } }, y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } } } }
        });
      } catch (_) {}
    }
  }
  const canvasRoles = document.getElementById('chartRoles');
  if (canvasRoles) {
    const roleCtx = canvasRoles.getContext('2d');
    if (roleCtx) {
      if (chartRoles) chartRoles.destroy();
      const rc = { padre: 0, maestra: 0, directora: 0, asistente: 0, admin: 0 };
      allUsers.forEach(u => { if (rc[u.role] !== undefined) rc[u.role]++; });
      try {
        chartRoles = new Chart(roleCtx, {
          type: 'doughnut',
          data: {
            labels: ['Padres','Maestras','Directoras','Asistentes','Admin'],
            datasets: [{ data: [rc.padre, rc.maestra, rc.directora, rc.asistente, rc.admin], backgroundColor: ['#6366f1','#22c55e','#f97316','#3b82f6','#eab308'], borderWidth: 2, borderColor: '#ffffff' }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, padding: 15, usePointStyle: true } } }, cutout: '70%' }
        });
      } catch (_) {}
    }
  }
}

// ── Recent audit ──────────────────────────────────────────────────────────────
function renderRecentAudit() {
  const tbody = document.getElementById('recentAuditBody');
  if (!tbody) return;
  const recent = allAudit.slice(0, 8);
  if (!recent.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--muted);">Sin registros</td></tr>'; return; }
  tbody.innerHTML = recent.map(a => {
    const user = allUsers.find(u => u.id === a.user_id);
    const name = user?.name || user?.email || a.user_id?.slice(0,8) || '—';
    const time = a.created_at ? new Date(a.created_at).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }) : '—';
    const action = a.action || 'movimiento';
    const typeBadge = { 'payment.approved': 'badge-green', 'attendance.check_in': 'badge-blue', 'error': 'badge-red' };
    const badge = typeBadge[action] || 'badge-gray';
    return `<tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
      <td class="py-3 px-4"><span class="font-bold text-slate-800 text-sm">${escH(name)}</span></td>
      <td class="py-3 px-4"><div class="max-w-[150px] truncate text-slate-500 text-xs">${escH(action)}</div></td>
      <td class="py-3 px-4 text-slate-400 text-[10px] uppercase font-bold">${time}</td>
      <td class="py-3 px-4 text-right"><span class="badge ${badge}">${action.split('.')[0]}</span></td>
    </tr>`;
  }).join('');
}

// ── Full audit table ──────────────────────────────────────────────────────────
function renderAuditTable(data) {
  const tbody = document.getElementById('auditBody');
  if (!tbody) return;
  document.getElementById('auditCount').textContent = data.length + ' registros';
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted);">Sin registros de auditoría</td></tr>'; return; }
  const roleBadge = { padre: 'badge-blue', maestra: 'badge-green', directora: 'badge-orange', asistente: 'badge-purple', admin: 'badge-yellow' };
  tbody.innerHTML = data.map((a, i) => {
    const user = allUsers.find(u => u.id === a.user_id);
    const name  = user?.name  || '—';
    const email = user?.email || a.user_id?.slice(0,12) || '—';
    const role  = user?.role  || '—';
    const dt = a.created_at ? new Date(a.created_at).toLocaleString('es-DO') : '—';
    const action = a.action || '—';
    const badge = action.includes('payment') ? 'badge-green' : action.includes('attendance') ? 'badge-blue' : 'badge-gray';
    return `<tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
      <td class="py-3 px-4 text-slate-400 text-xs font-bold">${i+1}</td>
      <td class="py-3 px-4 whitespace-nowrap text-slate-500 text-[10px] uppercase font-black">${dt}</td>
      <td class="py-3 px-4">
        <div class="font-bold text-slate-800 text-sm">${escH(name)}</div>
        <div class="text-[10px] text-slate-400">${escH(email)}</div>
      </td>
      <td class="py-3 px-4"><span class="badge ${roleBadge[role]||'badge-gray'} text-[9px] uppercase">${role}</span></td>
      <td class="py-3 px-4"><span class="badge ${badge} text-[9px] uppercase">${action}</span></td>
      <td class="py-3 px-4"><div class="max-w-[180px] truncate text-slate-400 text-[10px] font-mono">${escH(JSON.stringify(a.payload || {}))}</div></td>
      <td class="py-3 px-4 text-slate-400 text-[10px] font-bold">Cloud</td>
      <td class="py-3 px-4"><span class="w-2 h-2 rounded-full bg-emerald-400 inline-block shadow-[0_0_8px_rgba(52,211,153,0.6)]"></span></td>
    </tr>`;
  }).join('');
}

window.filterAudit = function() {
  const q    = document.getElementById('auditSearch')?.value.toLowerCase() || '';
  const role = document.getElementById('auditRole')?.value || '';
  const act  = document.getElementById('auditAction')?.value || '';
  const filtered = allAudit.filter(a => {
    const user = allUsers.find(u => u.id === a.user_id);
    const matchQ = !q || (user?.name||'').toLowerCase().includes(q) || (user?.email||'').toLowerCase().includes(q) || (a.action||'').toLowerCase().includes(q);
    const matchR = !role || user?.role === role;
    const matchA = !act  || (a.action||'').includes(act);
    return matchQ && matchR && matchA;
  });
  renderAuditTable(filtered);
};

window.exportAudit = function() {
  const rows = [['Fecha','Usuario','Email','Rol','Acción','Detalle']];
  allAudit.forEach(a => {
    const user = allUsers.find(u => u.id === a.user_id);
    rows.push([a.created_at, user?.name||'', user?.email||'', user?.role||'', a.action||'', JSON.stringify(a.payload || {}).replace(/,/g,';')]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url; a.download = 'auditoria_karpus.csv'; a.click();
  URL.revokeObjectURL(url);
};

// ── Fraud detection ───────────────────────────────────────────────────────────
function detectFraud() {
  fraudEvents = [];
  const loginsByUser = {};
  allAudit.filter(a => (a.action||'').toLowerCase().includes('login')).forEach(a => {
    if (!loginsByUser[a.user_id]) loginsByUser[a.user_id] = [];
    loginsByUser[a.user_id].push(a.created_at);
  });
  Object.entries(loginsByUser).forEach(([uid, times]) => {
    if (times.length >= 5) {
      const user = allUsers.find(u => u.id === uid);
      fraudEvents.push({ type: 'Múltiples logins', user: user?.name || uid, detail: `${times.length} accesos registrados`, risk: 'medio', date: times[0] });
    }
  });
  allPayments.forEach(p => {
    if (Number(p.amount || 0) > 50000) {
      fraudEvents.push({ type: 'Pago inusual', user: p.students?.p1_name || p.students?.name || '—', detail: `Monto: RD$${Number(p.amount).toLocaleString()}`, risk: 'alto', date: p.created_at });
    }
  });
  const payKey = {};
  allPayments.forEach(p => {
    const key = `${p.student_id}_${p.month_paid}`;
    payKey[key] = (payKey[key] || 0) + 1;
  });
  Object.entries(payKey).forEach(([key, count]) => {
    if (count > 1) {
      const sid = key.split('_')[0];
      const st = allStudents.find(s => String(s.id) === sid);
      fraudEvents.push({ type: 'Pago duplicado', user: st?.name || sid, detail: `${count} pagos para el mismo mes`, risk: 'alto', date: new Date().toISOString() });
    }
  });
  allUsers.filter(u => !u.role).forEach(u => {
    fraudEvents.push({ type: 'Sin rol asignado', user: u.email || u.id, detail: 'Usuario sin rol en el sistema', risk: 'bajo', date: u.created_at });
  });
}

function renderFraud() {
  detectFraud();
  const rulesEl = document.getElementById('fraudRules');
  if (rulesEl) {
    const rules = [
      { icon: 'bi-person-x-fill', color: '#ef4444', title: 'Múltiples logins', desc: 'Detecta +5 accesos del mismo usuario', count: fraudEvents.filter(f => f.type === 'Múltiples logins').length },
      { icon: 'bi-cash-coin',     color: '#f97316', title: 'Pagos inusuales',  desc: 'Montos superiores a RD$50,000',       count: fraudEvents.filter(f => f.type === 'Pago inusual').length },
      { icon: 'bi-files',         color: '#eab308', title: 'Pagos duplicados', desc: 'Mismo estudiante, mismo mes',          count: fraudEvents.filter(f => f.type === 'Pago duplicado').length },
      { icon: 'bi-person-dash',   color: '#6366f1', title: 'Sin rol asignado', desc: 'Usuarios sin rol en el sistema',       count: fraudEvents.filter(f => f.type === 'Sin rol asignado').length },
    ];
    rulesEl.innerHTML = rules.map(r => `
      <div class="bg-white border-2 border-slate-50 rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-all">
        <div class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style="background:${r.color}15">
          <i class="bi ${r.icon}" style="color:${r.color};font-size:20px;"></i>
        </div>
        <div class="flex-1">
          <div class="text-xs font-black text-slate-800 uppercase tracking-wider">${r.title}</div>
          <div class="text-[10px] text-slate-400 font-bold">${r.desc}</div>
        </div>
        <div class="text-xl font-black" style="color:${r.count > 0 ? r.color : '#e2e8f0'}">${r.count}</div>
      </div>`).join('');
  }
  const tbody = document.getElementById('fraudBody');
  document.getElementById('fraudCount').textContent = fraudEvents.length + ' eventos';
  if (!fraudEvents.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">✅ Sin eventos sospechosos detectados</td></tr>';
    return;
  }
  const riskBadge = { alto: 'badge-red', medio: 'badge-yellow', bajo: 'badge-blue' };
  tbody.innerHTML = fraudEvents.map(f => `<tr class="border-b border-rose-50 hover:bg-rose-50/20 transition-colors">
    <td class="py-3 px-4 text-[10px] text-slate-400 font-mono">${f.date ? new Date(f.date).toLocaleString('es-DO') : '—'}</td>
    <td class="py-3 px-4 font-black text-slate-700 uppercase text-xs">${escH(f.user)}</td>
    <td class="py-3 px-4 font-bold text-orange-600 text-xs">${f.type}</td>
    <td class="py-3 px-4 text-slate-400 text-xs italic">${escH(f.detail)}</td>
    <td class="py-3 px-4"><span class="badge ${riskBadge[f.risk]||'badge-gray'} uppercase text-[9px] font-black">${f.risk}</span></td>
    <td class="py-3 px-4 text-right"><button class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[10px] font-black uppercase transition-colors" onclick="alert('Investigando: ${escH(f.user)}')">Investigar</button></td>
  </tr>`).join('');
}

function renderFraudAlertsList() {
  detectFraud();
  const el = document.getElementById('fraudAlertsList');
  if (!el) return;
  if (!fraudEvents.length) {
    el.innerHTML = '<div class="alert alert-green"><i class="bi bi-shield-check-fill"></i> Sin alertas activas. Sistema seguro.</div>';
    return;
  }
  const riskColor = { alto: 'alert-red', medio: 'alert-yellow', bajo: 'alert-green' };
  el.innerHTML = fraudEvents.slice(0, 5).map(f =>
    `<div class="alert ${riskColor[f.risk]||'alert-yellow'}"><i class="bi bi-exclamation-triangle-fill"></i><div><div style="font-weight:900;">${f.type}</div><div style="font-size:12px;opacity:.8;">${f.user} — ${f.detail}</div></div></div>`
  ).join('');
}

// ── Helper: last access (session or physical punch) ──────────────────────────
function getLastAccess(userId) {
  const user = allUsers.find(u => u.id === userId);
  const sessionAccess = user?.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
  
  const punch = allPunches.find(p => p.staff_id === userId || p.student_id === userId);
  const punchAccess = punch ? new Date(punch.punched_at).getTime() : 0;
  
  const mostRecent = Math.max(sessionAccess, punchAccess);
  if (mostRecent === 0) return '—';
  
  return new Date(mostRecent).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' });
}

// ── Users table ───────────────────────────────────────────────────────────────
function renderUsers(data) {
  const tbody = document.getElementById('usersBody');
  if (!tbody) return;
  document.getElementById('userCount').textContent = data.length + ' usuarios';
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted);">Sin usuarios</td></tr>'; return; }
  const roleBadge = { padre: 'badge-blue', maestra: 'badge-green', directora: 'badge-orange', asistente: 'badge-purple', admin: 'badge-yellow' };
  tbody.innerHTML = data.map(u => {
    const created = u.created_at ? new Date(u.created_at).toLocaleDateString('es-DO') : '—';
    const lastAccess = getLastAccess(u.id);
    const initials = (u.name || u.email || '?')[0].toUpperCase();
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:8px;">
        <div style="width:32px;height:32px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:white;flex-shrink:0;">${initials}</div>
        <div><div style="font-weight:800;font-size:12px;">${escH(u.name||'Sin nombre')}</div><div style="font-size:10px;color:var(--muted);">${escH(u.phone||'')}</div></div>
      </div></td>
      <td style="font-size:12px;color:var(--muted);">${escH(u.email||'—')}</td>
      <td><span class="badge ${roleBadge[u.role]||'badge-gray'}">${u.role||'—'}</span></td>
      <td style="font-size:11px;color:var(--muted);">${created}</td>
      <td style="font-size:11px;color:var(--muted);">${lastAccess}</td>
      <td><span class="badge badge-green">Activo</span></td>
      <td style="display:flex;gap:4px;">
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:10px;" onclick="viewUser('${u.id}')"><i class="bi bi-eye"></i></button>
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:10px;" onclick="resetPassword('${u.id}','${escH(u.email||'')}')"><i class="bi bi-key"></i></button>
      </td>
    </tr>`;
  }).join('');
}

window.filterUsers = function() {
  const q    = document.getElementById('userSearch')?.value.toLowerCase() || '';
  const role = document.getElementById('userRoleFilter')?.value || '';
  const filtered = allUsers.filter(u =>
    (!q    || (u.name||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q)) &&
    (!role || u.role === role)
  );
  renderUsers(filtered);
};

window.viewUser = function(id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;
  const students = allStudents.filter(s => s.parent_id === id);
  const lastAccess = getLastAccess(id);
  const modal = document.getElementById('userModal') || _createModal();
  modal.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:28px;width:min(90vw,480px);max-height:90vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="font-size:16px;font-weight:900;color:var(--text);">Detalle de usuario</h3>
        <button onclick="document.getElementById('userModal').style.display='none'" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;">✕</button>
      </div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
        <div style="width:52px;height:52px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:white;flex-shrink:0;">${(u.name||u.email||'?')[0].toUpperCase()}</div>
        <div>
          <div style="font-size:16px;font-weight:900;color:var(--text);">${escH(u.name||'Sin nombre')}</div>
          <div style="font-size:12px;color:var(--muted);">${escH(u.email||'—')}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">
        ${_infoRow('Rol', u.role||'—')}
        ${_infoRow('Teléfono', u.phone||'—')}
        ${_infoRow('Creado', u.created_at ? new Date(u.created_at).toLocaleDateString('es-DO') : '—')}
        ${_infoRow('Último acceso', lastAccess)}
        ${_infoRow('ID', u.id?.slice(0,16)+'...')}
        ${students.length ? _infoRow('Estudiantes', students.map(s=>s.name).join(', ')) : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="resetPassword('${u.id}','${escH(u.email||'')}');document.getElementById('userModal').style.display='none'">
          <i class="bi bi-key"></i> Cambiar contraseña
        </button>
        <button class="btn btn-ghost" onclick="document.getElementById('userModal').style.display='none'">Cerrar</button>
      </div>
    </div>`;
  modal.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;align-items:center;justify-content:center;';
};

function _infoRow(label, value) {
  return `<div style="background:var(--surface2);border-radius:10px;padding:10px 12px;">
    <div style="font-size:10px;font-weight:900;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;">${label}</div>
    <div style="font-size:13px;font-weight:700;color:var(--text);">${escH(String(value))}</div>
  </div>`;
}

function _createModal() {
  const el = document.createElement('div');
  el.id = 'userModal';
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) el.style.display = 'none'; });
  return el;
}

// ── Password reset ────────────────────────────────────────────────────────────
window.resetPassword = function(userId, email) {
  const modal = document.getElementById('userModal') || _createModal();
  modal.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:28px;width:min(90vw,400px);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="font-size:16px;font-weight:900;color:var(--text);">Cambiar contraseña</h3>
        <button onclick="document.getElementById('userModal').style.display='none'" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;">✕</button>
      </div>
      <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">Usuario: <strong style="color:var(--text);">${escH(email)}</strong></p>
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <label style="font-size:11px;font-weight:900;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;">Nueva contraseña</label>
          <button class="btn btn-ghost" style="padding:2px 8px;font-size:9px;" onclick="generateRandomPassword()">
            <i class="bi bi-magic"></i> Generar segura
          </button>
        </div>
        <div style="position:relative;">
          <input class="inp" id="newPwdInput" type="text" placeholder="Mínimo 6 caracteres" autocomplete="off">
          <i class="bi bi-eye-fill" style="position:absolute;right:12px;top:12px;color:var(--muted);cursor:pointer;" onclick="togglePwdVisibility()"></i>
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <label style="font-size:11px;font-weight:900;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;display:block;margin-bottom:6px;">Confirmar contraseña</label>
        <input class="inp" id="newPwdConfirm" type="text" placeholder="Repite la contraseña" autocomplete="off">
      </div>
      <div id="pwdMsg" style="font-size:12px;font-weight:700;margin-bottom:12px;"></div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" onclick="doResetPassword('${userId}')"><i class="bi bi-check-lg"></i> Guardar contraseña</button>
        <button class="btn btn-ghost" onclick="document.getElementById('userModal').style.display='none'">Cancelar</button>
      </div>
    </div>`;
  modal.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;align-items:center;justify-content:center;';
};

window.generateRandomPassword = function() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
  let pwd = "";
  for (let i = 0; i < 10; i++) pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  document.getElementById('newPwdInput').value = pwd;
  document.getElementById('newPwdConfirm').value = pwd;
  const msg = document.getElementById('pwdMsg');
  msg.style.color = '#6366f1';
  msg.textContent = '💡 Clave generada. Cópiala y dásela al usuario.';
};

window.togglePwdVisibility = function() {
  const input = document.getElementById('newPwdInput');
  const confirm = document.getElementById('newPwdConfirm');
  const type = input.type === 'password' ? 'text' : 'password';
  input.type = confirm.type = type;
};

window.doResetPassword = async function(userId) {
  const pwd  = document.getElementById('newPwdInput')?.value || '';
  const pwd2 = document.getElementById('newPwdConfirm')?.value || '';
  const msg  = document.getElementById('pwdMsg');
  if (pwd.length < 6) { msg.style.color = '#f87171'; msg.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
  if (pwd !== pwd2)   { msg.style.color = '#f87171'; msg.textContent = 'Las contraseñas no coinciden.'; return; }

  // Confirmación antes de ejecutar
  if (!confirm('¿Confirmas el cambio de contraseña para este usuario?\n\nEsta acción quedará registrada en el historial de auditoría.')) return;

  msg.style.color = '#94a3b8'; msg.textContent = 'Guardando...';
  try {
    const { data, error } = await supabase.functions.invoke('admin-reset-password', {
      body: { user_id: userId, new_password: pwd }
    });
    if (error || data?.error) throw new Error(error?.message || data?.error || 'Error desconocido');

    // Auditoría inmutable
    await supabase.from('audit_logs').insert({
      user_id: currentUser.id,
      action: 'admin.reset_password',
      payload: { target_id: userId, changed_by: currentUser.email }
    });

    msg.style.color = '#4ade80'; msg.textContent = '✅ Contraseña actualizada correctamente.';
    setTimeout(() => { document.getElementById('userModal').style.display = 'none'; }, 1500);
  } catch (e) {
    msg.style.color = '#f87171'; msg.textContent = '❌ Error: ' + e.message;
    logError('panel_control', e.message, e.stack || '', 'doResetPassword').catch(() => {});
  }
};

// ── Padres table (with student count + last access) ───────────────────────────
function renderPadres() {
  const tbody = document.getElementById('roleBody-padres');
  if (!tbody) return;
  const data = allUsers.filter(u => u.role === 'padre');
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">Sin registros</td></tr>'; return; }
  tbody.innerHTML = data.map(u => {
    const students = allStudents.filter(s => s.parent_id === u.id);
    const payments = allPayments.filter(p => students.some(s => s.id === p.student_id));
    const lastAccess = getLastAccess(u.id);
    return `<tr>
      <td style="font-weight:800;">${escH(u.name||'—')}</td>
      <td style="color:var(--muted);font-size:12px;">${escH(u.email||'—')}</td>
      <td>${students.length ? students.map(s => escH(s.name)).join(', ') : '<span style="color:var(--muted);">—</span>'}</td>
      <td style="font-weight:800;color:#4ade80;">${payments.length}</td>
      <td style="font-size:11px;color:var(--muted);">${lastAccess}</td>
      <td><span class="badge badge-green">Activo</span></td>
    </tr>`;
  }).join('');
}

// ── Maestras table (with classroom + last access) ─────────────────────────────
function renderMaestras() {
  const tbody = document.getElementById('roleBody-maestras');
  if (!tbody) return;
  const data = allUsers.filter(u => ['maestra','asistente'].includes(u.role));
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">Sin registros</td></tr>'; return; }
  tbody.innerHTML = data.map(u => {
    const classroom = allClassrooms.find(c => c.teacher_id === u.id);
    const lastAccess = getLastAccess(u.id);
    return `<tr>
      <td style="font-weight:800;">${escH(u.name||'—')}</td>
      <td style="color:var(--muted);font-size:12px;">${escH(u.email||'—')}</td>
      <td><span class="badge ${u.role==='asistente'?'badge-purple':'badge-green'}">${u.role}</span></td>
      <td style="color:var(--muted);">${classroom ? escH(classroom.name) : '—'}</td>
      <td style="font-size:11px;color:var(--muted);">${lastAccess}</td>
      <td><span class="badge badge-green">Activo</span></td>
    </tr>`;
  }).join('');
}

function renderRoleTable(role, data) {
  const tbody = document.getElementById(`roleBody-${role}`);
  if (!tbody) return;
  if (!data.length) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted);">Sin registros</td></tr>`; return; }
  tbody.innerHTML = data.map(u => {
    const lastAccess = getLastAccess(u.id);
    return `<tr>
      <td style="font-weight:800;">${escH(u.name||'—')}</td>
      <td style="color:var(--muted);font-size:12px;">${escH(u.email||'—')}</td>
      <td>Karpus Kids</td>
      <td style="font-size:11px;color:var(--muted);">${lastAccess}</td>
      <td><span class="badge badge-green">Activo</span></td>
    </tr>`;
  }).join('');
}

// ── Payments ──────────────────────────────────────────────────────────────────
function renderPayments() {
  const approved = allPayments.filter(p => p.status === 'paid' || p.status === 'approved').length;
  const pending  = allPayments.filter(p => p.status === 'pending').length;
  const rejected = allPayments.filter(p => p.status === 'rejected').length;
  const total    = allPayments.filter(p => p.status === 'paid' || p.status === 'approved').reduce((s,p) => s + Number(p.amount||0), 0);
  document.getElementById('pay-approved').textContent = approved;
  document.getElementById('pay-pending').textContent  = pending;
  document.getElementById('pay-rejected').textContent = rejected;
  document.getElementById('pay-total').textContent    = 'RD$' + total.toLocaleString('es-DO');

  const months = {};
  allPayments.filter(p => p.status === 'paid' || p.status === 'approved').forEach(p => {
    const m = p.month_paid || p.created_at?.slice(0,7) || '—';
    months[m] = (months[m] || 0) + Number(p.amount || 0);
  });
  const labels = Object.keys(months).sort().slice(-6);
  const values = labels.map(l => months[l]);
  const ctx = document.getElementById('chartPayments')?.getContext('2d');
  if (ctx) {
    if (chartPaymentsChart) chartPaymentsChart.destroy();
    chartPaymentsChart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Ingresos RD$', data: values, backgroundColor: 'rgba(34,197,94,.7)', borderRadius: 8 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.04)' } } } }
    });
  }

  const tbody = document.getElementById('paymentsBody');
  if (!tbody) return;
  const statusBadge = { paid: 'badge-green', approved: 'badge-green', pending: 'badge-yellow', rejected: 'badge-red', review: 'badge-blue', overdue: 'badge-red' };
  tbody.innerHTML = allPayments.slice(0, 100).map(p => `<tr>
    <td style="font-size:11px;color:var(--muted);">${p.created_at ? new Date(p.created_at).toLocaleDateString('es-DO') : '—'}</td>
    <td style="font-weight:800;">${escH(p.student?.name||'—')}</td>
    <td style="color:var(--muted);">${escH(p.student?.p1_name||'—')}</td>
    <td style="font-weight:900;color:#4ade80;">RD$${Number(p.amount||0).toLocaleString()}</td>
    <td>${escH(p.method||'—')}</td>
    <td>${escH(p.bank||'—')}</td>
    <td><span class="badge ${statusBadge[p.status]||'badge-gray'}">${p.status||'—'}</span></td>
  </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted);">Sin pagos</td></tr>';
}

// ── Attendance ────────────────────────────────────────────────────────────────
function renderAttendance() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('attendanceDate').textContent = new Date().toLocaleDateString('es-DO', { dateStyle: 'full' });

  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    return d.toISOString().split('T')[0];
  });
  const counts = days.map(d => allAttend.filter(a => a.date === d).length);
  const ctx = document.getElementById('chartAttendance')?.getContext('2d');
  if (ctx) {
    if (chartAttendChart) chartAttendChart.destroy();
    chartAttendChart = new Chart(ctx, {
      type: 'line',
      data: { labels: days.map(d => d.slice(5)), datasets: [{ label: 'Asistencias', data: counts, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.1)', fill: true, tension: .4, pointRadius: 4, pointBackgroundColor: '#3b82f6' }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.04)' } } } }
    });
  }

  const tbody = document.getElementById('attendanceBody');
  if (!tbody) return;
  const todayData = allAttend.filter(a => a.date === today);
  if (!todayData.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">Sin registros hoy</td></tr>'; return; }
  const statusBadge = { present: 'badge-green', absent: 'badge-red', late: 'badge-yellow', retirado: 'badge-blue' };
  tbody.innerHTML = todayData.map(a => {
    // Resolve student name: from join or from allStudents
    const studentName = a.student?.name || allStudents.find(s => s.id === a.student_id)?.name || String(a.student_id || '—');
    const classroomName = a.classroom?.name || allClassrooms.find(c => c.id === a.classroom_id)?.name || '—';
    const checkIn  = a.check_in  ? new Date(a.check_in).toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit'}) : '—';
    const checkOut = a.check_out ? new Date(a.check_out).toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit'}) : '—';
    return `<tr>
      <td style="font-weight:800;">${escH(studentName)}</td>
      <td><span class="badge badge-blue">Estudiante</span></td>
      <td style="color:#4ade80;">${checkIn}</td>
      <td style="color:#60a5fa;">${checkOut}</td>
      <td style="color:var(--muted);">${escH(classroomName)}</td>
      <td><span class="badge ${statusBadge[a.status]||'badge-gray'}">${a.status||'—'}</span></td>
    </tr>`;
  }).join('');
}

// ── Errors ────────────────────────────────────────────────────────────────────
async function renderErrors() {
  const tbody = document.getElementById('errorsBody');
  if (!tbody) return;
  try {
    const { data: dbErrors } = await supabase
      .from('system_errors')
      .select('created_at, panel, message, stack, url, user_id')
      .order('created_at', { ascending: false })
      .limit(100);
    if (dbErrors?.length) {
      tbody.innerHTML = dbErrors.map(e => `<tr>
        <td style="font-size:11px;color:var(--muted);">${e.created_at ? new Date(e.created_at).toLocaleString('es-DO') : '—'}</td>
        <td><span class="badge badge-orange">${escH(e.panel||'—')}</span></td>
        <td style="color:var(--muted);font-size:11px;">${escH(e.user_id?.slice(0,8)||'—')}</td>
        <td style="color:#f87171;font-size:12px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(e.message||'—')}</td>
        <td style="font-size:10px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(e.url||'—')}</td>
      </tr>`).join('');
      return;
    }
  } catch (err) {
    logError('panel_control', err?.message || String(err), err?.stack || '', 'renderErrors').catch(() => {});
  }
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted);">✅ Sin errores registrados</td></tr>';
}

window.clearErrors = async function() {
  if (!confirm('¿Limpiar todos los errores registrados?')) return;
  await supabase.from('system_errors').delete().lt('created_at', new Date().toISOString());
  renderErrors();
};

// ── Brute Force Monitor ───────────────────────────────────────────────────────
window.renderBruteForce = async function() {
  const container = document.getElementById('bruteForceList');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">Cargando...</div>';
  try {
    // Intentar usar la vista v_brute_force_attempts
    const { data, error } = await supabase
      .from('v_brute_force_attempts')
      .select('*')
      .order('failed_attempts', { ascending: false })
      .limit(50);

    if (error) throw error;

    if (!data?.length) {
      container.innerHTML = '<div class="alert alert-green"><i class="bi bi-shield-check-fill"></i> Sin intentos sospechosos en las últimas 24 horas.</div>';
      return;
    }

    container.innerHTML = data.map(r => {
      const suspicious = r.is_suspicious;
      const rowStyle = suspicious ? 'background:rgba(239,68,68,0.08);' : '';
      return `<div style="${rowStyle}display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-size:13px;font-weight:800;color:var(--text);">${escH(r.email || '—')}</div>
          <div style="font-size:10px;color:var(--muted);">Último intento: ${r.last_attempt ? new Date(r.last_attempt).toLocaleString('es-DO') : '—'}</div>
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <span class="badge ${r.failed_attempts > 0 ? 'badge-red' : 'badge-gray'}">${r.failed_attempts} fallidos</span>
          <span class="badge badge-green">${r.successful_logins} exitosos</span>
          ${suspicious ? '<span class="badge badge-red" style="animation:pulse 1s infinite;">⚠️ SOSPECHOSO</span>' : ''}
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    // Fallback: query directa a login_attempts
    try {
      const { data: raw } = await supabase
        .from('login_attempts')
        .select('email, success, created_at')
        .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(200);

      if (!raw?.length) {
        container.innerHTML = '<div class="alert alert-green"><i class="bi bi-shield-check-fill"></i> Sin intentos en las últimas 24 horas.</div>';
        return;
      }

      // Agrupar por email
      const grouped = {};
      raw.forEach(r => {
        if (!grouped[r.email]) grouped[r.email] = { failed: 0, success: 0, last: r.created_at };
        if (r.success) grouped[r.email].success++;
        else grouped[r.email].failed++;
        if (r.created_at > grouped[r.email].last) grouped[r.email].last = r.created_at;
      });

      const sorted = Object.entries(grouped).sort((a, b) => b[1].failed - a[1].failed);
      container.innerHTML = sorted.map(([email, stats]) => {
        const suspicious = stats.failed >= 5;
        return `<div style="${suspicious ? 'background:rgba(239,68,68,0.08);' : ''}display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border);">
          <div>
            <div style="font-size:13px;font-weight:800;color:var(--text);">${escH(email)}</div>
            <div style="font-size:10px;color:var(--muted);">Último: ${new Date(stats.last).toLocaleString('es-DO')}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="badge ${stats.failed > 0 ? 'badge-red' : 'badge-gray'}">${stats.failed} fallidos</span>
            <span class="badge badge-green">${stats.success} exitosos</span>
            ${suspicious ? '<span class="badge badge-red">⚠️ SOSPECHOSO</span>' : ''}
          </div>
        </div>`;
      }).join('');
    } catch (e2) {
      container.innerHTML = '<div class="alert alert-yellow">Vista v_brute_force_attempts no disponible. Ejecuta fix_production_final.sql</div>';
    }
  }
};

// ── Config ────────────────────────────────────────────────────────────────────
window.saveAdminProfile = async function() {
  const name = document.getElementById('cfgName')?.value.trim();
  if (!name) return;
  const { error } = await supabase.from('profiles').update({ name }).eq('id', currentUser.id);
  if (error) { alert('Error: ' + error.message); return; }
  document.getElementById('adminName').textContent = name;
  document.getElementById('adminAvatar').textContent = name[0].toUpperCase();
  alert('Perfil actualizado correctamente.');
};

window.changeUserRole = async function() {
  const email = document.getElementById('roleChangeEmail')?.value.trim();
  const role  = document.getElementById('roleChangeVal')?.value;
  const msg   = document.getElementById('roleChangeMsg');
  if (!email || !role) { msg.style.color = '#f87171'; msg.textContent = 'Completa todos los campos.'; return; }

  // Confirmación antes de ejecutar
  if (!confirm(`¿Confirmas cambiar el rol de "${email}" a "${role}"?\n\nEsta acción es sensible y quedará registrada en auditoría.`)) return;

  try {
    const { data: targetUser } = await supabase.from('profiles').select('id, role').eq('email', email).maybeSingle();
    if (!targetUser) { msg.style.color = '#f87171'; msg.textContent = 'Usuario no encontrado.'; return; }

    const { error } = await supabase.from('profiles').update({ role }).eq('email', email);
    if (error) throw error;

    // Auditoría inmutable
    await supabase.from('audit_logs').insert({
      user_id: currentUser.id,
      action: 'admin.change_role',
      payload: {
        target_email: email,
        target_id:    targetUser.id,
        old_role:     targetUser.role,
        new_role:     role,
        changed_by:   currentUser.email
      }
    });

    msg.style.color = '#4ade80';
    msg.textContent = `✅ Rol de ${email} cambiado a "${role}" correctamente.`;
    await loadUsers();
  } catch (e) {
    msg.style.color = '#f87171';
    msg.textContent = 'Error: ' + e.message;
    logError('panel_control', e.message, e.stack || '', 'changeUserRole').catch(() => {});
  }
};

// ── Test email ────────────────────────────────────────────────────────────────
window.testEmail = async function() {
  const btn = document.getElementById('btnTestEmail');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: {
        to: 'impulsodigital@gmail.com',
        subject: '✅ Test de correo — Karpus Kids',
        html: '<div style="font-family:Arial;padding:20px;"><h2 style="color:#16a34a;">✅ Sistema de correo funcionando</h2><p>Correo de prueba desde el Panel de Control de Karpus Kids.</p><p style="color:#6b7280;font-size:12px;">Enviado: ' + new Date().toLocaleString('es-DO') + '</p></div>'
      }
    });
    if (error) throw new Error(error.message || JSON.stringify(error));
    if (data?.error) throw new Error(data.error);
    document.getElementById('emailTestResult').innerHTML =
      '<span style="color:#4ade80;font-weight:900;">✅ Correo enviado (ID: ' + (data?.id || 'ok') + ')</span>';
  } catch (e) {
    document.getElementById('emailTestResult').innerHTML =
      '<span style="color:#f87171;font-weight:900;">❌ Error: ' + escH(e.message) + '</span>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📧 Probar correo'; }
  }
};

// ── Realtime ──────────────────────────────────────────────────────────────────
function startRealtime() {
  supabase.channel('admin-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, async () => {
      await loadPayments(); detectFraud();
      document.getElementById('badge-fraud').textContent = fraudEvents.length;
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, async () => {
      await loadAttendance();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'door_punches' }, async () => {
      await loadPunches();
    })
    .subscribe();
}

// ── Logout ────────────────────────────────────────────────────────────────────
window.doLogout = async function() {
  await supabase.auth.signOut();
  window.location.href = 'login.html';
};

// ── Security Stats ────────────────────────────────────────────────────────────
window.loadSecurityStats = async function() {
  try {
    const since24h = new Date(Date.now() - 24*60*60*1000).toISOString();
    const sinceToday = new Date(); sinceToday.setHours(0,0,0,0);

    const [activeRes, errorsRes, cronRes] = await Promise.allSettled([
      supabase.from('login_attempts').select('*', { count: 'exact', head: true })
        .eq('success', true).gte('created_at', sinceToday.toISOString()),
      supabase.from('system_errors').select('*', { count: 'exact', head: true })
        .gte('created_at', since24h),
      supabase.from('cron.job').select('jobname, active').in('jobname', [
        'karpus-payment-cycle','karpus-mora-reminders','karpus-mark-overdue'
      ])
    ]);

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('activeUsersToday', activeRes.status === 'fulfilled' ? (activeRes.value.count || 0) : '—');
    set('errorsToday', errorsRes.status === 'fulfilled' ? (errorsRes.value.count || 0) : '—');

    const cronEl = document.getElementById('cronStatus');
    if (cronEl) {
      if (cronRes.status === 'fulfilled' && cronRes.value.data?.length > 0) {
        cronEl.textContent = '✅ Activo';
        cronEl.className = 'badge badge-green';
      } else {
        cronEl.textContent = '⚠️ No configurado';
        cronEl.className = 'badge badge-yellow';
      }
    }
  } catch (_) {}
};

// ── Payment Audit ─────────────────────────────────────────────────────────────
window.loadPaymentAudit = async function() {
  const tbody = document.getElementById('paymentAuditBody');
  if (!tbody) return;
  try {
    const { data } = await supabase
      .from('audit_logs')
      .select('id, action, payload, created_at, user_id, profiles:user_id(name, email)')
      .like('action', 'payment.%')
      .order('created_at', { ascending: false })
      .limit(30);

    if (!data?.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--muted);">Sin registros de auditoría de pagos</td></tr>';
      return;
    }

    const actionLabels = {
      'payment.approved':    { label: 'Aprobado',    cls: 'badge-green' },
      'payment.deleted':     { label: 'Eliminado',   cls: 'badge-red' },
      'payment.mora_waived': { label: 'Mora exonerada', cls: 'badge-purple' },
      'payment.created':     { label: 'Creado',      cls: 'badge-blue' },
      'payment.overdue':     { label: 'Vencido',     cls: 'badge-orange' },
    };

    tbody.innerHTML = data.map(a => {
      const al = actionLabels[a.action] || { label: a.action, cls: 'badge-gray' };
      const adminName = a.profiles?.name || a.profiles?.email || a.user_id?.slice(0,8) || '—';
      const detail = a.payload?.month || a.payload?.period_name || a.payload?.payment_id || '—';
      return `<tr>
        <td style="font-size:11px;color:var(--muted);">${a.created_at ? new Date(a.created_at).toLocaleString('es-DO') : '—'}</td>
        <td><span class="badge ${al.cls}">${al.label}</span></td>
        <td style="font-size:12px;font-weight:700;">${escH(adminName)}</td>
        <td style="font-size:11px;color:var(--muted);">${escH(String(detail))}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--muted);">Error al cargar auditoría</td></tr>';
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function escH(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
