import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../shared/supabase.js';
import { logError } from '../shared/db-utils.js';
import {
  MODULES, ROLES, ROLE_LABELS, moduleDefault,
  loadFlags, getFlags, setLocalFlags, normalizeFlags, onFlagsChange
} from '../shared/feature-flags.js';

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
let allWallPosts = [];      // Muro Escolar
let allChatMsgs  = [];      // Chat: mensajes recientes
let allConvos    = [];      // Chat: conversaciones

// Feature flags (Módulos y Visibilidad)
let ffData = null;            // copia editable de los flags
let ffDirty = false;          // hay cambios sin guardar
let ffLoaded = false;
let ffExpandedUser = null;    // uuid del override expandido en la UI
let ffSearchTimer = null;
let _clockInterval = null;    // referencia para limpieza de intervalo del reloj
let _sessionInterval = null;  // referencia para limpieza del refresco periódico de sesión
let _realtimeChannel = null;  // referencia al canal realtime activo (evita duplicados)

// Roles válidos para asignación (whitelist estricta)
const VALID_ROLES = ['padre', 'maestra', 'asistente', 'directora', 'admin'];

// ── Toasts: notificaciones emergentes para cambios administrativos ───────────
window.showToast = function(msg, type = 'info') {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) { alert(msg); return; }
  const icons  = { success: 'bi-check-circle-fill', error: 'bi-x-circle-fill', warn: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };
  const colors = { success: '#22c55e', error: '#ef4444', warn: '#f97316', info: '#6366f1' };
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.innerHTML = `<i class="bi ${icons[type] || icons.info}" style="color:${colors[type] || colors.info};flex-shrink:0;"></i><span>${escH(msg)}</span>`;
  wrap.appendChild(t);
  while (wrap.children.length > 4) wrap.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 3800);
};

// ── Resaltado de coincidencias en búsquedas ──────────────────────────────────
function highlightMatch(text, q) {
  const s = String(text ?? '');
  if (!q) return escH(s);
  const idx = s.toLowerCase().indexOf(String(q).toLowerCase());
  if (idx === -1) return escH(s);
  return escH(s.slice(0, idx)) +
    '<mark class="hl">' + escH(s.slice(idx, idx + String(q).length)) + '</mark>' +
    escH(s.slice(idx + String(q).length));
}

// ── Preferencias del panel persistidas en localStorage ───────────────────────
const PREFS_KEY = 'karpus_panel_control_prefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (_) { return {}; }
}
function savePrefs(patch) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch })); } catch (_) {}
}

// ── Filtros con debounce (300ms) ─────────────────────────────────────────────
let _auditDebounce = null;
let _usersDebounce = null;
window.filterAudit = function() {
  clearTimeout(_auditDebounce);
  _auditDebounce = setTimeout(() => window._applyAuditFilters(), 300);
};
window.filterUsers = function() {
  clearTimeout(_usersDebounce);
  _usersDebounce = setTimeout(() => window._applyUserFilters(), 300);
};

// ── Resiliencia global: promesas rechazadas no críticas ──────────────────────
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e?.reason?.message || e?.reason || '');
  // Filtrar ruido de red/IndexedDB que no afecta la operación
  if (/network|fetch|indexeddb|quota|aborted|timeout/i.test(msg)) {
    console.warn('[Karpus] Promesa rechazada (no crítica):', msg);
    e.preventDefault();
  }
});

// ── Atajos de teclado: "/" o Ctrl+K enfoca el buscador de la sección activa; Esc cierra modal/menú ──
document.addEventListener('keydown', (e) => {
  // Escape: cerrar modal abierto o menú lateral móvil
  if (e.key === 'Escape') {
    const m = document.getElementById('userModal');
    if (m && m.style.display !== 'none' && m.style.display !== '') {
      m.style.display = 'none';
      return;
    }
    document.getElementById('sidebar')?.classList.remove('open');
    return;
  }
  const tag = (e.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const isSearchKey = e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k');
  if (!isSearchKey) return;
  e.preventDefault();
  const active = document.querySelector('.section.active')?.id.replace('sec-', '');
  const targets = { auditoria: 'auditSearch', usuarios: 'userSearch', modulos: 'ffUserSearch' };
  const targetId = targets[active];
  const focusIt = () => {
    const el = document.getElementById(targetId);
    if (el) { el.focus(); el.select?.(); }
  };
  if (targetId) {
    focusIt();
  } else {
    goTo('usuarios');
    setTimeout(focusIt, 80);
  }
});

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
    let profile = null;

    // 1. Cache local
    const CACHE_KEY = 'karpus_ctrl_profile_' + userId;
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && cached.role && cached.ts && (Date.now() - cached.ts) < 3600000) {
        profile = { id: userId, email: userEmail, name: cached.name || userEmail.split('@')[0], role: cached.role, bio: cached.bio || '' };
      }
    } catch (_) {}

    // 2. JWT app_metadata
    if (!profile) {
      const jwtRole = session.user?.app_metadata?.role || session.user?.user_metadata?.role || null;
      if (jwtRole && ['admin', 'directora'].includes(jwtRole)) {
        profile = { id: userId, email: userEmail, name: userEmail.split('@')[0], role: jwtRole };
      }
    }

    // 3. Query a DB
    if (!profile) {
      let timedOut = false;
      const profileTimer = setTimeout(() => {
        timedOut = true;
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
          .select('id, name, email, role, bio')
          .eq('id', userId);

        clearTimeout(profileTimer);
        if (timedOut) return;

        if (!error && data) {
          // Manejar si viene como array o como objeto único
          const rawProfile = Array.isArray(data) ? data[0] : data;
          
          if (rawProfile) {
            profile = rawProfile;
            try {
              localStorage.setItem(CACHE_KEY, JSON.stringify({ role: profile.role, name: profile.name, bio: profile.bio || '', ts: Date.now() }));
            } catch (_) {}
          }
        } else if (error) {
          clearTimeout(loaderTimeout);
          window._karpusInitializing = false;
          const el = document.getElementById('loader');
          console.error('DB init error:', error);
          if (el) el.innerHTML = '<div style="text-align:center;padding:32px"><p style="color:#f87171;font-weight:800">Error al conectar con la base de datos</p><button onclick="window.location.reload()" style="background:#6366f1;color:white;border:none;padding:10px 20px;border-radius:10px;font-weight:800;cursor:pointer;margin-top:12px">Reintentar</button></div>';
          return;
        }
      } catch (e) {
        clearTimeout(profileTimer);
        if (timedOut) return;
        clearTimeout(loaderTimeout);
        window._karpusInitializing = false;
        const el = document.getElementById('loader');
        console.error('Network error:', e);
        if (el) el.innerHTML = '<div style="text-align:center;padding:32px"><p style="color:#f87171;font-weight:800">Error de red: verifica tu conexión</p><button onclick="window.location.reload()" style="background:#6366f1;color:white;border:none;padding:10px 20px;border-radius:10px;font-weight:800;cursor:pointer;margin-top:12px">Reintentar</button></div>';
        return;
      }
    }

    if (!profile) {
      clearTimeout(loaderTimeout);
      window._karpusInitializing = false;
      const el = document.getElementById('loader');
      if (el) el.innerHTML = '<div style="text-align:center;padding:32px;max-width:440px"><div style="font-size:32px;margin-bottom:12px">🔒</div><p style="color:#f87171;font-weight:800;font-size:14px;margin-bottom:8px">Sin perfil configurado</p><p style="color:#94a3b8;font-size:12px;margin-bottom:8px">Tu cuenta no tiene un perfil en la tabla profiles.</p><p style="color:#64748b;font-size:11px;margin-bottom:4px">Email: ' + userEmail + '</p><p style="color:#64748b;font-size:10px;margin-bottom:16px;font-family:monospace">UUID: ' + userId + '</p><div style="background:#1e293b;border:1px solid rgba(99,102,241,.3);border-radius:10px;padding:12px;margin-bottom:16px;text-align:left"><p style="color:#94a3b8;font-size:11px;font-weight:700;margin-bottom:6px">Ejecuta en Supabase SQL Editor:</p><code style="color:#a5b4fc;font-size:10px;line-height:1.6;display:block;white-space:pre-wrap">INSERT INTO public.profiles (id, email, name, role, accepted_terms) VALUES (\'' + userId + '\', \'' + userEmail + '\', \'Administrador\', \'admin\', true) ON CONFLICT (id) DO UPDATE SET role = \'admin\';</code></div><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button onclick="window.location.reload()" style="background:#6366f1;color:white;border:none;padding:10px 20px;border-radius:10px;font-weight:800;cursor:pointer;font-size:12px">Reintentar</button><button onclick="window._signOutAndRedirect()" style="background:rgba(255,255,255,.1);color:#94a3b8;border:1px solid rgba(255,255,255,.1);padding:10px 20px;border-radius:10px;font-weight:800;cursor:pointer;font-size:12px">Cerrar Sesión</button></div></div>';
      return;
    }

    // ── Paso 4: Verificar rol ─────────────────────────────────────────────────
    const allowedRoles = ['admin', 'directora'];
    const userRole = (profile.role || '').toLowerCase();
    
    if (!allowedRoles.includes(userRole)) {
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
    clearTimeout(loaderTimeout);
    window._karpusInitializing = false;
    currentUser = profile;

    const adminName   = document.getElementById('adminName');
    const adminAvatar = document.getElementById('adminAvatar');
    const cfgEmail    = document.getElementById('cfgEmail');
    const cfgName     = document.getElementById('cfgName');
    const cfgBio      = document.getElementById('cfgBio');

    if (adminName)   adminName.textContent   = profile.name || userEmail;
    if (adminAvatar) adminAvatar.textContent = (profile.name || userEmail)[0].toUpperCase();
    if (cfgEmail)    cfgEmail.value          = userEmail || '';
    if (cfgName)     cfgName.value           = profile.name || '';
    if (cfgBio)      cfgBio.value            = profile.bio || '';

    // Restaurar preferencias del módulo de alertas por correo
    const prefs0 = loadPrefs();
    const alertEmailTo = document.getElementById('alertEmailTo');
    if (alertEmailTo) alertEmailTo.value = prefs0.reportEmail || userEmail || '';
    const autoToggle = document.getElementById('autoAlertToggle');
    if (autoToggle) autoToggle.checked = !!prefs0.autoEmailAlerts;
    const autoState = document.getElementById('autoAlertState');
    if (autoState) {
      autoState.textContent = 'Automático: ' + (prefs0.autoEmailAlerts ? 'ON' : 'OFF');
      autoState.style.color = prefs0.autoEmailAlerts ? '#4ade80' : 'var(--muted)';
    }

    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('hidden');

    // Reloj superior (intervalo referenciado para poder limpiarlo)
    if (_clockInterval) clearInterval(_clockInterval);
    _clockInterval = setInterval(() => {
      const clock = document.getElementById('topClock');
      if (clock) clock.textContent = new Date().toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'medium' });
    }, 1000);

    const mobMenuBtn = document.getElementById('mobMenuBtn');
    if (window.innerWidth <= 768 && mobMenuBtn) {
      mobMenuBtn.style.display = 'block';
    }

    await refreshAll();
    _sectionLoadedAt.dashboard = Date.now();

    // Restaurar última sección visitada (preferencias persistidas)
    const lastSection = loadPrefs().lastSection;
    goTo(typeof lastSection === 'string' && document.getElementById('sec-' + lastSection) ? lastSection : 'dashboard');

    updateNotifUI();
    checkEdgeFunctionsHealth();
    startRealtime();

    // Refresco proactivo de sesión: cada 4 min verifica si el JWT vence en <5 min
    if (_sessionInterval) clearInterval(_sessionInterval);
    _sessionInterval = setInterval(async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const exp = data?.session?.expires_at || 0;
        if (exp && (exp - Math.floor(Date.now() / 1000)) < 300) {
          const { error: rErr } = await supabase.auth.refreshSession();
          if (rErr) console.warn('[Karpus] No se pudo refrescar la sesión:', rErr.message);
        }
      } catch (_) {}
    }, 4 * 60 * 1000);

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
// Lazy loading: cada sección recarga sus datos si tienen más de 30s de antigüedad
const STALE_MS = 30000;
const _sectionLoadedAt = {};
const SECTION_LOADERS = {
  auditoria:  [loadAudit],
  usuarios:   [loadUsers],
  muro:       [loadWallPosts, loadClassrooms],
  chat:       [loadChatData],
  pagos:      [loadPayments],
  asistencia: [loadAttendance],
  analytics:  [loadAudit, loadUsers, loadAttendance, loadPunches],
};
function _isSectionStale(id) {
  return !_sectionLoadedAt[id] || (Date.now() - _sectionLoadedAt[id]) > STALE_MS;
}
async function _lazyLoadSection(id) {
  const fns = SECTION_LOADERS[id];
  if (!fns || !_isSectionStale(id)) return;
  _sectionLoadedAt[id] = Date.now();
  await Promise.allSettled(fns.map(f => f()));
}

window.goTo = async function(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('sec-' + id)?.classList.add('active');
  document.querySelector(`[onclick="goTo('${id}')"]`)?.classList.add('active');

  // Cerrar menú lateral en móvil tras navegar
  document.getElementById('sidebar')?.classList.remove('open');
  _syncSidebarBackdrop();

  const titles = {
    dashboard:    ['Dashboard', 'Vista general del sistema'],
    auditoria:    ['Auditoría', 'Registro completo de movimientos'],
    fraude:       ['Alertas de Fraude', 'Detección automática de patrones sospechosos'],
    usuarios:     ['Usuarios', 'Todos los usuarios del sistema'],
    muro:         ['Muro Escolar', 'Publicaciones, reacciones y comentarios'],
    chat:         ['Chat & Mensajería', 'Conversaciones entre padres y personal'],
    pagos:        ['Pagos', 'Historial financiero completo'],
    asistencia:   ['Asistencia', 'Control de entradas y salidas'],
    analytics:    ['Analítica', 'Eficiencia de maestros y tráfico de usuarios'],
    errores:      ['Errores del Sistema', 'Log de errores y excepciones'],
    modulos:      ['Módulos y Visibilidad', 'Control total de módulos por rol y usuario'],
    seguridad:    ['Seguridad', 'Fuerza bruta y estado del sistema'],
    configuracion:['Configuración', 'Ajustes del panel de control'],
  };
  const [title, sub] = titles[id] || ['Panel', ''];
  document.getElementById('pageTitle').textContent    = title;
  document.getElementById('pageSubtitle').textContent = sub;

  // Persistir preferencia de sección
  savePrefs({ lastSection: id });

  await _lazyLoadSection(id);

  if (id === 'dashboard')   renderDashboard();
  if (id === 'auditoria')   renderAuditTable(allAudit);
  if (id === 'fraude')      renderFraud();
  if (id === 'usuarios')    renderUsers(allUsers);
  if (id === 'muro')        renderWall();
  if (id === 'chat')        renderChat();
  if (id === 'pagos')       renderPayments();
  if (id === 'asistencia')  renderAttendance();
  if (id === 'analytics')   { renderTeacherEfficiency(); renderLoginAnalytics(); renderTrafficAnalytics(); }
  if (id === 'errores')     renderErrors();
  if (id === 'modulos')     initModulesUI();
  if (id === 'configuracion') checkEdgeFunctionsHealth();
  if (id === 'seguridad')   { renderBruteForce(); loadSecurityStats(); loadPaymentAudit(); }
};

// ── Refresh ───────────────────────────────────────────────────────────────────
window.refreshAll = async function() {
  try {
    await Promise.allSettled([
      loadUsers(), loadAudit(), loadPayments(),
      loadAttendance(), loadStudents(), loadClassrooms(), loadPunches(),
      loadWallPosts(), loadChatData()
    ]);
    renderDashboard();
  } catch (err) {
  }
};

// ── Load data ─────────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, email, role, created_at, avatar_url, phone, bio, last_sign_in_at')
      .order('created_at', { ascending: false })
      .limit(300);
    allUsers = data || [];
    const kpi = document.getElementById('kpi-users');
    if (kpi) kpi.textContent = allUsers.length;
    const cfgCount = document.getElementById('cfgUserCount');
    if (cfgCount) cfgCount.textContent = allUsers.length;
  } catch (err) {
    logError('panel_control', err.message || String(err), err.stack || '', 'loadUsers').catch(() => {});
    allUsers = []; 
  }
}

async function loadPunches() {
  try {
    // Last 30 days of door punches — used for "último acceso"
    const since = new Date(); since.setDate(since.getDate() - 30);
    const { data } = await supabase
      .from('door_punches')
      .select('staff_id, student_id, punched_at, punch_type')
      .gte('punched_at', since.toISOString())
      .order('punched_at', { ascending: false });
    allPunches = data || [];
  } catch (err) { 
    logError('panel_control', err?.message || String(err), err?.stack || '', 'loadPunches').catch(() => {});
    allPunches = []; 
  }
}

async function loadAudit() {
  try {
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
    const badge = document.getElementById('badge-audit');
    if (badge) badge.textContent = allAudit.length;
  } catch (err) { 
    logError('panel_control', err?.message || String(err), err?.stack || '', 'loadAudit').catch(() => {});
    allAudit = []; 
  }
}

async function loadPayments() {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('id, amount, status, method, bank, month_paid, created_at, student_id, student:student_id(name, p1_name)')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw error;
    allPayments = data || [];
  } catch (err) { 
    logError('panel_control', err?.message || String(err), err?.stack || '', 'loadPayments').catch(() => {});
    allPayments = []; 
  }
}

async function loadStudents() {
  try {
    const { data } = await supabase
      .from('students')
      .select('id, name, parent_id, classroom_id, is_active, matricula')
      .limit(500);
    allStudents = data || [];
    const kpi = document.getElementById('kpi-students');
    if (kpi) kpi.textContent = allStudents.filter(s => s.is_active).length;
  } catch (err) { 
    logError('panel_control', err?.message || String(err), err?.stack || '', 'loadStudents').catch(() => {});
    allStudents = []; 
  }
}

async function loadClassrooms() {
  try {
    const { data } = await supabase.from('classrooms').select('id, name, teacher_id').limit(200);
    allClassrooms = data || [];
  } catch (err) { 
    logError('panel_control', err?.message || String(err), err?.stack || '', 'loadClassrooms').catch(() => {});
    allClassrooms = []; 
  }
}

// ── Muro Escolar ─────────────────────────────────────────────────────────────
async function loadWallPosts() {
  try {
    const { data, error } = await supabase
      .from('posts')
      .select('id, title, content, teacher_name, classroom_id, likes_count, comments_count, views_count, is_pinned, status, media_type, media_url, image_url, images, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    allWallPosts = data || [];
  } catch (err) {
    try {
      const { data } = await supabase
        .from('posts')
        .select('id, content, teacher_name, classroom_id, likes_count, comments_count, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      allWallPosts = data || [];
    } catch (err2) {
      logError('panel_control', err2?.message || String(err2), err2?.stack || '', 'loadWallPosts_fallback').catch(() => {});
      allWallPosts = [];
    }
  }
  const badge = document.getElementById('badge-wall');
  if (badge) badge.textContent = allWallPosts.length;
}

function _getWallMediaUrl(p) {
  if (p.media_url) return p.media_url;
  if (p.image_url) return p.image_url;
  if (p.images && Array.isArray(p.images) && p.images.length) return p.images[0];
  return null;
}
function _isVideoUrl(url) {
  return /\.(mp4|webm|ogg|mov)($|\?)/i.test(url) || /video/i.test(url);
}

function renderWall() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  set('wall-total', allWallPosts.length);
  set('wall-comments', allWallPosts.reduce((s, p) => s + Number(p.comments_count || 0), 0));
  set('wall-likes', allWallPosts.reduce((s, p) => s + Number(p.likes_count || 0), 0));
  const photoCount = allWallPosts.filter(p => _getWallMediaUrl(p)).length;
  set('wall-photos', photoCount);
  const countEl = document.getElementById('wallCount');
  if (countEl) countEl.textContent = allWallPosts.length + ' publicaciones';

  const tbody = document.getElementById('wallBody');
  if (!tbody) return;
  if (!allWallPosts.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted);">Sin publicaciones en el muro</td></tr>'; return; }
  tbody.innerHTML = allWallPosts.slice(0, 100).map(p => {
    const room = allClassrooms.find(c => c.id === p.classroom_id);
    const dt = p.created_at ? new Date(p.created_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }) : '—';
    const txt = [p.title, p.content].filter(Boolean).join(' — ');
    const media = _getWallMediaUrl(p);
    const mediaBadge = media ? '<span class="badge badge-purple" style="font-size:8px;margin-left:4px;">📷</span>' : '';
    return `<tr>
      <td style="font-size:11px;color:var(--muted);white-space:nowrap;">${dt}</td>
      <td style="font-weight:800;">${escH(p.teacher_name || '—')}</td>
      <td style="color:var(--muted);font-size:12px;">${room ? escH(room.name) : 'General'}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${escH(txt || '—')}${mediaBadge}</td>
      <td style="color:#fb923c;font-weight:900;">${Number(p.likes_count || 0)}</td>
      <td style="color:#60a5fa;font-weight:900;">${Number(p.comments_count || 0)}</td>
      <td style="color:var(--muted);">${Number(p.views_count || 0)}</td>
      <td>${p.is_pinned ? '<span class="badge badge-yellow"><i class="bi bi-pin-angle-fill"></i> Fijado</span>' : '<span class="badge badge-green">Publicado</span>'}</td>
    </tr>`;
  }).join('');
}

// ── Wall Gallery ──────────────────────────────────────────────────────────────
window.renderWallGallery = function() {
  const grid = document.getElementById('wallGalleryGrid');
  if (!grid) return;
  if (!allWallPosts.length) { grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);">Sin publicaciones</div>'; return; }
  grid.innerHTML = allWallPosts.filter(p => _getWallMediaUrl(p)).slice(0, 100).map(p => {
    const url = _getWallMediaUrl(p);
    const isVid = _isVideoUrl(url);
    const dt = p.created_at ? new Date(p.created_at).toLocaleDateString('es-DO') : '';
    const author = p.teacher_name || '';
    const content = [p.title, p.content].filter(Boolean).join(' — ');
    return `<div class="gallery-item" onclick="openLightbox('${escH(url)}','${escH(author + ' — ' + dt)}')">
      ${isVid ? `<video src="${escH(url)}" style="width:100%;height:100%;object-fit:cover;" muted preload="metadata"></video>` : `<img src="${escH(url)}" alt="" loading="lazy">`}
      <div class="overlay"><div class="overlay-text">📷 ${escH(author)} · ${dt}</div></div>
    </div>`;
  }).join('') || '<div style="text-align:center;padding:40px;color:var(--muted);">Sin fotos ni videos</div>';
  const countEl = document.getElementById('galleryCount');
  if (countEl) countEl.textContent = allWallPosts.filter(p => _getWallMediaUrl(p)).length + ' multimedia';
};

window.renderWallMedia = function() {
  const grid = document.getElementById('wallMediaGrid');
  if (!grid) return;
  const allMedia = [];
  allWallPosts.forEach(p => {
    const url = _getWallMediaUrl(p);
    if (url) allMedia.push({ url, author: p.teacher_name || '—', date: p.created_at, likes: p.likes_count || 0, comments: p.comments_count || 0 });
    if (p.images && Array.isArray(p.images)) {
      p.images.slice(1).forEach(u => {
        if (u && u !== url) allMedia.push({ url: u, author: p.teacher_name || '—', date: p.created_at, likes: p.likes_count || 0, comments: p.comments_count || 0 });
      });
    }
  });
  grid.innerHTML = allMedia.slice(0, 150).map(m => {
    const dt = m.date ? new Date(m.date).toLocaleDateString('es-DO') : '';
    const isVid = _isVideoUrl(m.url);
    return `<div class="gallery-item" onclick="openLightbox('${escH(m.url)}','${escH(m.author + ' · ' + dt + ' · ❤' + m.likes)}')">
      ${isVid ? `<video src="${escH(m.url)}" style="width:100%;height:100%;object-fit:cover;" muted preload="metadata"></video>` : `<img src="${escH(m.url)}" alt="" loading="lazy">`}
      <div class="overlay"><div class="overlay-text">📷 ${escH(m.author)} · ${dt}</div></div>
    </div>`;
  }).join('') || '<div style="text-align:center;padding:40px;color:var(--muted);">Sin fotos ni videos en publicaciones</div>';
  const countEl = document.getElementById('mediaCount');
  if (countEl) countEl.textContent = allMedia.length + ' archivos multimedia';
};

// ── Chat & Mensajería ────────────────────────────────────────────────────────
async function loadChatData() {
  try {
    const [msgsRes, convRes] = await Promise.allSettled([
      supabase.from('messages')
        .select('id, sender_name, sender_id, receiver_id, receiver_name, content, attachment_url, attachment_type, is_read, created_at')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('conversations')
        .select('id, type, classroom_id, created_at')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);
    allChatMsgs = msgsRes.status === 'fulfilled' ? (msgsRes.value.data || []) : [];
    allConvos   = convRes.status === 'fulfilled' ? (convRes.value.data || []) : [];
  } catch (err) {
    logError('panel_control', err?.message || String(err), err?.stack || '', 'loadChatData').catch(() => {});
    allChatMsgs = []; allConvos = [];
  }
  const badge = document.getElementById('badge-chatmsg');
  if (badge) badge.textContent = allChatMsgs.length;
}

const CONVO_TYPE_LABELS = {
  direct_message: ['Mensajes Directos', 'badge-blue'],
  private:        ['Privados',          'badge-purple'],
  classroom:      ['Grupales de Aula',  'badge-green'],
  group:          ['Grupos',            'badge-orange'],
};

function renderChat() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const todayStr = new Date().toISOString().slice(0, 10);
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  set('chat-convos', allConvos.length);
  set('chat-today', allChatMsgs.filter(m => (m.created_at || '').startsWith(todayStr)).length);
  set('chat-week', allChatMsgs.filter(m => (m.created_at || '') >= since7).length);
  const mediaCount = allChatMsgs.filter(m => m.attachment_url).length;
  set('chat-media', mediaCount);
  const countEl = document.getElementById('chatMsgCount');
  if (countEl) countEl.textContent = allChatMsgs.length + ' mensajes recientes';

  const tbody = document.getElementById('chatBody');
  if (tbody) {
    if (!allChatMsgs.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted);">Sin mensajes registrados</td></tr>';
    } else {
      tbody.innerHTML = allChatMsgs.slice(0, 80).map(m => {
        const receiverName = m.receiver_name || allUsers.find(u => u.id === m.receiver_id)?.name || m.receiver_id?.slice(0, 8) || '—';
        const hasMedia = m.attachment_url ? ' <span class="badge badge-purple" style="font-size:8px;">📷</span>' : '';
        return `<tr>
          <td style="font-size:11px;color:var(--muted);white-space:nowrap;">${m.created_at ? new Date(m.created_at).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
          <td style="font-weight:800;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(m.sender_name || m.sender_id?.slice(0, 8) || '—')}</td>
          <td style="font-weight:700;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--muted);">→ ${escH(receiverName)}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text);">${escH(m.content || '')}${hasMedia}</td>
          <td>${m.is_read === false ? '<span class="badge badge-yellow">Sin leer</span>' : '<span class="badge badge-gray">Leído</span>'}</td>
        </tr>`;
      }).join('');
    }
  }

  const list = document.getElementById('convTypeList');
  if (list) {
    const counts = {};
    allConvos.forEach(c => { const t = c.type || 'direct_message'; counts[t] = (counts[t] || 0) + 1; });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Sin conversaciones registradas</div>';
      return;
    }
    const max = entries[0][1];
    list.innerHTML = entries.map(([type, n]) => {
      const [label, cls] = CONVO_TYPE_LABELS[type] || [type, 'badge-gray'];
      const pct = allConvos.length ? Math.round((n / allConvos.length) * 100) : 0;
      return `<div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
          <span class="badge ${cls}">${escH(label)}</span>
          <span style="font-size:13px;font-weight:900;color:var(--text);">${n} <span style="color:var(--muted);font-size:10px;">(${pct}%)</span></span>
        </div>
        <div style="height:6px;background:rgba(255,255,255,.06);border-radius:50px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:50px;"></div>
        </div>
      </div>`;
    }).join('');
  }
}

// ── Chat Conversations viewer ─────────────────────────────────────────────────
window.renderChatConversations = function() {
  const container = document.getElementById('convListContainer');
  if (!container) return;
  const countEl = document.getElementById('convoCount');

  // Build conversation pairs: who talked to whom
  const pairs = {};
  allChatMsgs.forEach(m => {
    const sid = m.sender_id || '';
    const rid = m.receiver_id || '';
    if (!sid || !rid) return;
    const key = [sid, rid].sort().join('|');
    if (!pairs[key]) pairs[key] = { user1: sid, user2: rid, msgs: [], count: 0 };
    pairs[key].msgs.push(m);
    pairs[key].count++;
  });

  const sorted = Object.values(pairs).sort((a, b) => b.count - a.count);

  if (!sorted.length) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);">Sin conversaciones registradas</div>';
    if (countEl) countEl.textContent = '0 conversaciones';
    return;
  }

  if (countEl) countEl.textContent = sorted.length + ' conversaciones';

  container.innerHTML = sorted.slice(0, 50).map(p => {
    const u1 = allUsers.find(u => u.id === p.user1);
    const u2 = allUsers.find(u => u.id === p.user2);
    const name1 = u1?.name || u1?.email || p.user1?.slice(0, 8) || '?';
    const name2 = u2?.name || u2?.email || p.user2?.slice(0, 8) || '?';
    const role1 = u1?.role || '?';
    const role2 = u2?.role || '?';
    const lastMsg = p.msgs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
    const lastTime = lastMsg?.created_at ? new Date(lastMsg.created_at).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    const lastContent = lastMsg?.content || '';
    const unread = p.msgs.filter(m => m.is_read === false).length;
    const colors = ['#6366f1', '#22c55e', '#f97316', '#3b82f6', '#8b5cf6', '#ef4444', '#eab308'];
    const c1 = colors[Math.abs(hashStr(p.user1)) % colors.length];
    const c2 = colors[Math.abs(hashStr(p.user2)) % colors.length];

    return `<div class="convo-card">
      <div class="convo-avatar" style="background:${c1};">${(name1[0]||'?').toUpperCase()}</div>
      <div style="font-size:11px;color:var(--muted);">↔</div>
      <div class="convo-avatar" style="background:${c2};">${(name2[0]||'?').toUpperCase()}</div>
      <div class="convo-meta">
        <div class="convo-name">${escH(name1)} <span class="badge badge-gray" style="font-size:8px;">${role1}</span> ↔ ${escH(name2)} <span class="badge badge-gray" style="font-size:8px;">${role2}</span></div>
        <div class="convo-preview">${escH(lastContent.slice(0, 60))}${lastContent.length > 60 ? '...' : ''}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;">Último: ${lastTime}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
        <div class="convo-count">${p.count} msg</div>
        ${unread > 0 ? `<span class="badge badge-red" style="font-size:8px;">${unread} sin leer</span>` : ''}
      </div>
    </div>`;
  }).join('');
};

// ── Chat Media gallery ────────────────────────────────────────────────────────
window.renderChatMedia = function() {
  const grid = document.getElementById('chatMediaGrid');
  if (!grid) return;
  const mediaMsgs = allChatMsgs.filter(m => m.attachment_url);
  grid.innerHTML = mediaMsgs.slice(0, 100).map(m => {
    const dt = m.created_at ? new Date(m.created_at).toLocaleDateString('es-DO') : '';
    const author = m.sender_name || '—';
    const isVid = _isVideoUrl(m.attachment_url);
    return `<div class="gallery-item" onclick="openLightbox('${escH(m.attachment_url)}','${escH(author + ' · ' + dt)}')">
      ${isVid ? `<video src="${escH(m.attachment_url)}" style="width:100%;height:100%;object-fit:cover;" muted preload="metadata"></video>` : `<img src="${escH(m.attachment_url)}" alt="" loading="lazy">`}
      <div class="overlay"><div class="overlay-text">💬 ${escH(author)} · ${dt}</div></div>
    </div>`;
  }).join('') || '<div style="text-align:center;padding:40px;color:var(--muted);">Sin archivos multimedia en chat</div>';
  const countEl = document.getElementById('chatMediaCount');
  if (countEl) countEl.textContent = mediaMsgs.length + ' archivos';
};

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) { h = ((h << 5) - h) + String(s).charCodeAt(i); h |= 0; }
  return h;
}

async function loadAttendance() {
  const today = new Date().toISOString().split('T')[0];
  try {
    // Fetch attendance with student names
    const { data, error } = await supabase
      .from('attendance')
      .select('id, date, check_in, check_out, status, student_id, classroom_id, student:student_id(name), classroom:classroom_id(name)')
      .order('date', { ascending: false })
      .limit(300);
    
    if (error) throw error;
    allAttend = data || [];
    const todayCount = allAttend.filter(a => a.date === today).length;
    const kpi = document.getElementById('kpi-attendance');
    if (kpi) kpi.textContent = todayCount;
  } catch (err) {
    // Fallback without joins
    try {
      const { data } = await supabase
        .from('attendance')
        .select('id, date, check_in, check_out, status, student_id, classroom_id')
        .order('date', { ascending: false })
        .limit(300);
      allAttend = data || [];
    } catch (err2) { 
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
    if (kpiRevenue) kpiRevenue.textContent = fmtMoney(revenue).replace('RD$', '');
    detectFraud();
    maybeSendAutoAlert();
    const kpiAlerts = document.getElementById('kpi-alerts');
    if (kpiAlerts) kpiAlerts.textContent = fraudEvents.length;
    const badgeFraud = document.getElementById('badge-fraud');
    if (badgeFraud) badgeFraud.textContent = fraudEvents.length;
    
    // ✅ HEALTHCHECK: Estado del Ciclo de Pagos (con captura de error amigable)
    const { data: health, error: healthErr } = await supabase.rpc('check_payment_cycle_health');
    const healthWidget = document.getElementById('paymentHealthWidget');
    if (healthWidget) {
      const isMissing = healthErr && (
        /could not find the function|schema cache|404/i.test(healthErr.message || '') ||
        (healthErr.code || '') === '42883'
      );
      const isOk = !isMissing && !healthErr && health?.status === 'ok';
      // Preservar las clases base del KPI (antes se pisaban con clases inexistentes)
      healthWidget.className = 'kpi ' + (isOk ? 'k-blue' : 'k-red');
      let msg, badge;
      if (isMissing) {
        msg = 'Función check_payment_cycle_health no instalada. Ejecuta el SQL de migración para activar el monitoreo.';
        badge = '<span class="badge badge-yellow">N/D</span>';
      } else if (healthErr) {
        msg = 'No se pudo verificar el ciclo de pagos: ' + (healthErr.message || 'error desconocido');
        badge = '<span class="badge badge-red">ERROR</span>';
      } else {
        msg = health?.message || (isOk ? 'Ciclo de pagos operando normalmente' : 'Revisar estado del ciclo');
        badge = `<span class="badge ${isOk ? 'badge-green' : 'badge-red'}">${isOk ? 'OK' : 'ERROR'}</span>`;
      }
      healthWidget.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div class="kpi-lbl">Salud del Ciclo</div>
          ${badge}
        </div>
        <p style="font-size:11px;color:var(--muted);margin-bottom:${!isOk && !isMissing ? '12px' : '0'};">${escH(msg)}</p>
        ${!isOk && !isMissing ? `<button onclick="App.runEmergencyCycle()" class="btn btn-danger" style="width:100%;justify-content:center;font-size:10px;padding:8px;">Reparar Ahora</button>` : ''}
      `;
    }

    renderRecentAudit();
    renderFraudAlertsList();
    renderCharts();
  } catch (_) {}
}

window.App = window.App || {};
window.App.runEmergencyCycle = async function() {
  if (!confirm('¿Ejecutar ciclo de pagos de emergencia?')) return;
  const { data, error } = await supabase.rpc('run_payment_cycle');
  if (error) { showToast('Error al ejecutar ciclo: ' + error.message, 'error'); return; }
  showToast(`✅ Ciclo ejecutado: ${data?.generated ?? '?'} cobros generados. Recargando...`, 'success');
  setTimeout(() => window.location.reload(), 1200);
};

// Restauración de estado inicial: recupera el panel ante cambios bruscos de conexión
window.App.resetState = async function() {
  try {
    // Invalidar caché local del perfil para forzar revalidación contra DB
    if (currentUser?.id) localStorage.removeItem('karpus_ctrl_profile_' + currentUser.id);
  } catch (_) {}
  await refreshAll();
  if (_sectionActive('auditoria'))  renderAuditTable(allAudit);
  if (_sectionActive('usuarios'))   renderUsers(allUsers);
  if (_sectionActive('pagos'))      renderPayments();
  if (_sectionActive('asistencia')) renderAttendance();
};

// ── Charts ────────────────────────────────────────────────────────────────────
let chartActivity = null, chartRoles = null, chartPaymentsChart = null, chartAttendChart = null;

// Espera pasiva por Chart.js (se carga con defer y puede llegar después del módulo)
let _chartWaiter = null;
function onChartReady(cb) {
  if (typeof window.Chart !== 'undefined') { cb(); return; }
  if (_chartWaiter) return; // ya hay una espera en curso
  let tries = 0;
  _chartWaiter = setInterval(() => {
    tries++;
    if (typeof window.Chart !== 'undefined') {
      clearInterval(_chartWaiter); _chartWaiter = null;
      cb();
    } else if (tries > 40) { // ~10s máximo, luego desistir en silencio
      clearInterval(_chartWaiter); _chartWaiter = null;
    }
  }, 250);
}

function renderCharts() {
  // Guard: la librería se carga con defer y puede no estar lista → reintentar cuando llegue
  if (typeof Chart === 'undefined') { console.warn('[Karpus] Chart.js no disponible aún'); onChartReady(renderCharts); return; }
  const canvasActivity = document.getElementById('chartActivity');
  if (canvasActivity) {
    const actCtx = canvasActivity.getContext('2d');
    if (actCtx) {
      if (chartActivity) chartActivity.destroy();
      try {
        // Actividad real: logins por rol en los últimos 7 días (desde audit_logs)
        const days7 = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(); d.setDate(d.getDate() - (6 - i));
          return d.toISOString().slice(0, 10);
        });
        const roleDefs = [
          ['padre', 'Padres', '#6366f1'],
          ['maestra', 'Maestras', '#22c55e'],
          ['directora', 'Directoras', '#f97316'],
        ];
        const datasets = roleDefs.map(([role, label, color]) => ({
          label,
          backgroundColor: color,
          borderRadius: 6,
          barThickness: 12,
          data: days7.map(d => allAudit.filter(a =>
            (a.action || '').toLowerCase().includes('login') &&
            (a.created_at || '').startsWith(d) &&
            (allUsers.find(u => u.id === a.user_id)?.role === role)
          ).length)
        }));
        chartActivity = new Chart(actCtx, {
          type: 'bar',
          data: { labels: days7.map(d => d.slice(5)), datasets },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, usePointStyle: true } } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } } } }
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
      const totalRoles = Object.values(rc).reduce((s, v) => s + v, 0);
      try {
        chartRoles = new Chart(roleCtx, {
          type: 'doughnut',
          data: {
            labels: ['Padres','Maestras','Directoras','Asistentes','Admin'],
            datasets: [{ data: [rc.padre, rc.maestra, rc.directora, rc.asistente, rc.admin], backgroundColor: ['#6366f1','#22c55e','#f97316','#3b82f6','#eab308'], borderWidth: 2, borderColor: '#ffffff' }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, padding: 15, usePointStyle: true } },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const pct = totalRoles ? Math.round((ctx.parsed / totalRoles) * 100) : 0;
                    return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
                  }
                }
              }
            },
            cutout: '70%'
          }
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
      <td class="py-3 px-4 text-slate-400 text-[10px] font-bold">${escH(a.payload?.ip || a.payload?.device || 'Cloud')}</td>
      <td class="py-3 px-4"><span class="w-2 h-2 rounded-full bg-emerald-400 inline-block shadow-[0_0_8px_rgba(52,211,153,0.6)]"></span></td>
    </tr>`;
  }).join('');
}

window._applyAuditFilters = function() {
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

// CSV seguro: escapa comillas y envuelve cada campo para no desalinear columnas en Excel
function csvField(v) {
  const s = String(v ?? '');
  return '"' + s.replace(/"/g, '""') + '"';
}

window.exportAudit = function() {
  if (!allAudit.length) { showToast('No hay registros de auditoría para exportar.', 'warn'); return; }
  const rows = [['Fecha','Usuario','Email','Rol','Acción','Detalle','Estado']];
  allAudit.forEach(a => {
    const user = allUsers.find(u => u.id === a.user_id);
    rows.push([
      a.created_at ? new Date(a.created_at).toLocaleString('es-DO') : '',
      user?.name || '', user?.email || '', user?.role || '',
      a.action || '',
      JSON.stringify(a.payload || {}),
      'ok'
    ].map(csvField));
  });
  // Punto y coma como separador: compatible con Excel configurado en es-DO
  const csv = '\ufeff' + rows.map(r => r.join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url; a.download = 'auditoria_karpus.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast(`Exportados ${allAudit.length} registros a CSV.`, 'success');
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
      fraudEvents.push({ type: 'Pago inusual', user: p.students?.p1_name || p.students?.name || '—', detail: `Monto: ${fmtMoney(p.amount)}`, risk: 'alto', date: p.created_at });
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
  tbody.innerHTML = fraudEvents.map((f, i) => `<tr class="border-b border-rose-50 hover:bg-rose-50/20 transition-colors">
    <td class="py-3 px-4 text-[10px] text-slate-400 font-mono">${f.date ? new Date(f.date).toLocaleString('es-DO') : '—'}</td>
    <td class="py-3 px-4 font-black text-slate-700 uppercase text-xs">${escH(f.user)}</td>
    <td class="py-3 px-4 font-bold text-orange-600 text-xs">${escH(f.type)}</td>
    <td class="py-3 px-4 text-slate-400 text-xs italic">${escH(f.detail)}</td>
    <td class="py-3 px-4"><span class="badge ${riskBadge[f.risk]||'badge-gray'} uppercase text-[9px] font-black">${escH(f.risk)}</span></td>
    <td class="py-3 px-4 text-right"><button class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[10px] font-black uppercase transition-colors" onclick="investigateFraud(${i})">Investigar</button></td>
  </tr>`).join('');
}

// Investigación por índice: nunca interpolar datos del usuario dentro del onclick
window.investigateFraud = function(i) {
  const f = fraudEvents[i];
  if (!f) return;
  alert('Investigando evento:\n\nTipo: ' + f.type + '\nUsuario: ' + f.user + '\nDetalle: ' + f.detail);
};

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
    `<div class="alert ${riskColor[f.risk]||'alert-yellow'}"><i class="bi bi-exclamation-triangle-fill"></i><div><div style="font-weight:900;">${escH(f.type)}</div><div style="font-size:12px;opacity:.8;">${escH(f.user)} — ${escH(f.detail)}</div></div></div>`
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
  // Query actual para resaltar coincidencias en tiempo real
  const q = document.getElementById('userSearch')?.value.trim() || '';
  tbody.innerHTML = data.map(u => {
    const created = u.created_at ? new Date(u.created_at).toLocaleDateString('es-DO') : '—';
    const lastAccess = getLastAccess(u.id);
    const initials = (u.name || u.email || '?')[0].toUpperCase();
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:8px;">
        <div style="width:32px;height:32px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:white;flex-shrink:0;">${initials}</div>
        <div><div style="font-weight:800;font-size:12px;">${highlightMatch(u.name || 'Sin nombre', q)}</div><div style="font-size:10px;color:var(--muted);">${highlightMatch(u.phone || '', q)}</div></div>
      </div></td>
      <td style="font-size:12px;color:var(--muted);">${highlightMatch(u.email || '—', q)}</td>
      <td><span class="badge ${roleBadge[u.role]||'badge-gray'}">${u.role||'—'}</span></td>
      <td style="font-size:11px;color:var(--muted);">${created}</td>
      <td style="font-size:11px;color:var(--muted);">${lastAccess}</td>
      <td><span class="badge badge-green">Activo</span></td>
      <td style="display:flex;gap:4px;">
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:10px;" onclick="viewUser('${u.id}')"><i class="bi bi-eye"></i></button>
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:10px;" onclick="resetPassword('${u.id}')"><i class="bi bi-key"></i></button>
      </td>
    </tr>`;
  }).join('');
}

window._applyUserFilters = function() {
  const q    = document.getElementById('userSearch')?.value.toLowerCase() || '';
  const role = document.getElementById('userRoleFilter')?.value || '';
  const filtered = allUsers.filter(u =>
    (!q    || (u.name||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q) || (u.phone||'').toLowerCase().includes(q)) &&
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
        <button class="btn btn-primary" onclick="resetPassword('${u.id}');document.getElementById('userModal').style.display='none'">
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
  // Resolver email desde la caché de usuarios: evita inyectar strings con
  // apóstrofes/comillas dentro del atributo onclick (XSS + SyntaxError)
  const u = allUsers.find(x => x.id === userId);
  email = email || u?.email || '';
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
  // Generación criptográficamente segura
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nums  = '0123456789';
  const syms  = '!@#$%&*?';
  const all   = lower + upper + nums + syms;
  let pwd = '';
  try {
    const rnd = new Uint32Array(14);
    crypto.getRandomValues(rnd);
    for (let i = 0; i < 14; i++) pwd += all.charAt(rnd[i] % all.length);
    // Garantizar al menos un carácter de cada tipo
    if (!/[a-z]/.test(pwd)) pwd = pwd.slice(1) + lower.charAt(crypto.getRandomValues(new Uint32Array(1))[0] % lower.length);
    if (!/[A-Z]/.test(pwd)) pwd = pwd.slice(1) + upper.charAt(crypto.getRandomValues(new Uint32Array(1))[0] % upper.length);
    if (!/[0-9]/.test(pwd)) pwd = pwd.slice(1) + nums.charAt(crypto.getRandomValues(new Uint32Array(1))[0] % nums.length);
    if (!/[!@#$%&*?]/.test(pwd)) pwd = pwd.slice(1) + syms.charAt(crypto.getRandomValues(new Uint32Array(1))[0] % syms.length);
  } catch (_) {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
    pwd = "";
    for (let i = 0; i < 12; i++) pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
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
    showToast('Contraseña actualizada para ' + email, 'success');
    setTimeout(() => { document.getElementById('userModal').style.display = 'none'; }, 1500);
  } catch (e) {
    msg.style.color = '#f87171'; msg.textContent = '❌ Error: ' + e.message;
    showToast('Error al resetear contraseña: ' + e.message, 'error');
    logError('panel_control', e.message, e.stack || '', 'doResetPassword').catch(() => {});
  }
};

// ── Payments ──────────────────────────────────────────────────────────────────
// Normalización unificada de estados de pago (paid/approved/pagado/confirmado)
function isPaidStatus(s) {
  return ['paid', 'approved', 'pagado', 'confirmado'].includes(String(s || '').toLowerCase());
}

function renderPayments() {
  const approved = allPayments.filter(p => isPaidStatus(p.status)).length;
  const pending  = allPayments.filter(p => ['pending','pendiente','review'].includes((p.status||'').toLowerCase())).length;
  const rejected = allPayments.filter(p => !isPaidStatus(p.status) && !['pending','pendiente','review'].includes((p.status||'').toLowerCase())).length;
  const total    = allPayments.filter(p => isPaidStatus(p.status)).reduce((s,p) => s + Number(p.amount||0), 0);
  document.getElementById('pay-approved').textContent = approved;
  document.getElementById('pay-pending').textContent  = pending;
  document.getElementById('pay-rejected').textContent = rejected;
  document.getElementById('pay-total').textContent    = fmtMoney(total);

  const months = {};
  allPayments.filter(p => isPaidStatus(p.status)).forEach(p => {
    const m = p.month_paid || p.created_at?.slice(0,7) || '—';
    months[m] = (months[m] || 0) + Number(p.amount || 0);
  });
  const labels = Object.keys(months).sort().slice(-6);
  const values = labels.map(l => months[l]);
  const drawPaymentsChart = () => {
    const ctx = document.getElementById('chartPayments')?.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return;
    try {
      if (chartPaymentsChart) chartPaymentsChart.destroy();
      chartPaymentsChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Ingresos RD$', data: values, backgroundColor: 'rgba(34,197,94,.7)', borderRadius: 8 }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.04)' } } } }
      });
    } catch (_) {}
  };
  if (typeof Chart !== 'undefined') drawPaymentsChart();
  else onChartReady(drawPaymentsChart);

  const tbody = document.getElementById('paymentsBody');
  if (!tbody) return;
  const statusBadge = { paid: 'badge-green', approved: 'badge-green', pagado: 'badge-green', confirmado: 'badge-green', pending: 'badge-yellow', pendiente: 'badge-yellow', rejected: 'badge-red', review: 'badge-blue', overdue: 'badge-red' };
  tbody.innerHTML = allPayments.slice(0, 100).map(p => `<tr>
    <td style="font-size:11px;color:var(--muted);">${p.created_at ? new Date(p.created_at).toLocaleDateString('es-DO') : '—'}</td>
    <td style="font-weight:800;">${escH(p.student?.name||'—')}</td>
    <td style="color:var(--muted);">${escH(p.student?.p1_name||'—')}</td>
    <td style="font-weight:900;color:#4ade80;">${fmtMoney(p.amount)}</td>
    <td>${escH(p.method||'—')}</td>
    <td>${escH(p.bank||'—')}</td>
    <td><span class="badge ${statusBadge[(p.status||'').toLowerCase()]||'badge-gray'}">${escH(p.status||'—')}</span></td>
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
  const drawAttendChart = () => {
    const ctx = document.getElementById('chartAttendance')?.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return;
    try {
      if (chartAttendChart) chartAttendChart.destroy();
      chartAttendChart = new Chart(ctx, {
        type: 'line',
        data: { labels: days.map(d => d.slice(5)), datasets: [{ label: 'Asistencias', data: counts, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.1)', fill: true, tension: .4, pointRadius: 4, pointBackgroundColor: '#3b82f6' }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.04)' } } } }
      });
    } catch (_) {}
  };
  if (typeof Chart !== 'undefined') drawAttendChart();
  else onChartReady(drawAttendChart);

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

// ── Analytics: Teacher Efficiency + Login Tracking ────────────────────────────
let _chartTeacherTime = null, _chartLoginHeat = null, _chartTraffic = null;

// Teacher efficiency: ranking by average check-in time
window.renderTeacherEfficiency = function() {
  const container = document.getElementById('teacherRanking');
  if (!container) return;

  // Group attendance by teacher/classroom and calculate avg check-in time
  const teacherStats = {};
  allAttend.forEach(a => {
    if (!a.check_in) return;
    const teacherId = a.classroom?.teacher_id || a.classroom_id || null;
    const teacherName = a.classroom?.name || allClassrooms.find(c => c.id === a.classroom_id)?.name || 'Sin aula';
    if (!teacherStats[teacherName]) teacherStats[teacherName] = { name: teacherName, checkIns: [], count: 0 };
    const d = new Date(a.check_in);
    const mins = d.getHours() * 60 + d.getMinutes();
    teacherStats[teacherName].checkIns.push(mins);
    teacherStats[teacherName].count++;
  });

  // Calculate average and sort by earliest
  const ranked = Object.values(teacherStats)
    .filter(t => t.checkIns.length > 0)
    .map(t => {
      const avg = t.checkIns.reduce((s, v) => s + v, 0) / t.checkIns.length;
      t.avgMinutes = avg;
      t.avgTime = `${String(Math.floor(avg / 60)).padStart(2, '0')}:${String(Math.round(avg % 60)).padStart(2, '0')}`;
      return t;
    })
    .sort((a, b) => a.avgMinutes - b.avgMinutes);

  if (!ranked.length) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);">Sin datos de asistencia para calcular eficiencia</div>';
    return;
  }

  const best = ranked[0].avgMinutes;
  const worst = ranked[ranked.length - 1].avgMinutes;
  const range = worst - best || 1;
  const rankColors = ['#22c55e', '#4ade80', '#facc15', '#fb923c', '#ef4444'];

  container.innerHTML = ranked.map((t, i) => {
    const pct = Math.max(10, Math.round(100 - ((t.avgMinutes - best) / range) * 90));
    const color = rankColors[Math.min(i, rankColors.length - 1)];
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
    return `<div class="eff-row">
      <div class="eff-rank" style="background:${color};">${medal}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:900;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escH(t.name)}</div>
        <div style="font-size:11px;color:var(--muted);">${t.count} registros · Entrada promedio: <strong style="color:${color};">${t.avgTime}</strong></div>
        <div class="eff-bar" style="margin-top:4px;"><div class="eff-bar-fill" style="width:${pct}%;background:${color};"></div></div>
      </div>
    </div>`;
  }).join('');

  // Chart: average check-in times
  const canvas = document.getElementById('chartTeacherTime');
  if (canvas && typeof Chart !== 'undefined') {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (_chartTeacherTime) _chartTeacherTime.destroy();
      try {
        _chartTeacherTime = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: ranked.map(t => t.name.slice(0, 12)),
            datasets: [{
              label: 'Hora promedio entrada',
              data: ranked.map(t => t.avgMinutes),
              backgroundColor: ranked.map((_, i) => rankColors[Math.min(i, rankColors.length - 1)] + 'cc'),
              borderRadius: 8,
              barThickness: 24
            }]
          },
          options: {
            responsive: true,
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
              x: {
                ticks: { color: '#94a3b8', callback: v => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}` },
                grid: { color: 'rgba(255,255,255,.04)' }
              },
              y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { display: false } }
            }
          }
        });
      } catch (_) {}
    }
  }

  // KPI: most punctual
  const kpiEl = document.getElementById('an-punctual');
  if (kpiEl && ranked.length) kpiEl.textContent = ranked[0].name.slice(0, 12);
};

// Login analytics from audit_logs
window.renderLoginAnalytics = function() {
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const loginLogs = allAudit.filter(a => (a.action || '').toLowerCase().includes('login') && (a.created_at || '') >= since7);

  // KPI: logins today
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayLogins = loginLogs.filter(l => (l.created_at || '').startsWith(todayStr));
  const kpiEl = document.getElementById('an-logins-today');
  if (kpiEl) kpiEl.textContent = todayLogins.length;

  // Per-user login count (7 days)
  const userLogins = {};
  loginLogs.forEach(l => {
    if (!l.user_id) return;
    if (!userLogins[l.user_id]) userLogins[l.user_id] = { count: 0, last: l.created_at, hours: {} };
    userLogins[l.user_id].count++;
    if (l.created_at > userLogins[l.user_id].last) userLogins[l.user_id].last = l.created_at;
    const h = new Date(l.created_at).getHours();
    userLogins[l.user_id].hours[h] = (userLogins[l.user_id].hours[h] || 0) + 1;
  });

  // Table
  const tbody = document.getElementById('loginUserBody');
  const countEl = document.getElementById('loginUserCount');
  if (tbody) {
    const sorted = Object.entries(userLogins).sort((a, b) => b[1].count - a[1].count);
    if (countEl) countEl.textContent = sorted.length + ' usuarios activos (7d)';
    tbody.innerHTML = sorted.map(([uid, stats]) => {
      const user = allUsers.find(u => u.id === uid);
      const name = user?.name || '—';
      const role = user?.role || '—';
      const roleBadge = { padre: 'badge-blue', maestra: 'badge-green', directora: 'badge-orange', asistente: 'badge-purple', admin: 'badge-yellow' };
      const peakHour = Object.entries(stats.hours || {}).sort((a, b) => b[1] - a[1])[0];
      const peakLabel = peakHour ? `${String(peakHour[0]).padStart(2, '0')}:00` : '—';
      const lastTime = stats.last ? new Date(stats.last).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
      return `<tr>
        <td style="font-weight:800;">${escH(name)}</td>
        <td><span class="badge ${roleBadge[role] || 'badge-gray'}">${role}</span></td>
        <td style="font-weight:900;color:#6366f1;">${stats.count}</td>
        <td style="font-size:11px;color:var(--muted);">${lastTime}</td>
        <td><span class="badge badge-indigo" style="background:rgba(99,102,241,.15);color:#a5b4fc;">🕐 ${peakLabel}</span></td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted);">Sin logins en 7 días</td></tr>';
  }

  // Chart: logins by day (7d) per role
  const canvas = document.getElementById('chartLoginHeat');
  if (canvas && typeof Chart !== 'undefined') {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (_chartLoginHeat) _chartLoginHeat.destroy();
      const days7 = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d.toISOString().slice(0, 10); });
      const roleDefs = [['padre', 'Padres', '#6366f1'], ['maestra', 'Maestras', '#22c55e'], ['directora', 'Directoras', '#f97316']];
      try {
        _chartLoginHeat = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: days7.map(d => d.slice(5)),
            datasets: roleDefs.map(([role, label, color]) => ({
              label, backgroundColor: color, borderRadius: 6, barThickness: 14,
              data: days7.map(d => loginLogs.filter(l => (l.created_at || '').startsWith(d) && allUsers.find(u => u.id === l.user_id)?.role === role).length)
            }))
          },
          options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, usePointStyle: true } } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { color: '#94a3b8' } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' } } } }
        });
      } catch (_) {}
    }
  }
};

// Traffic analytics: logins by hour of day
window.renderTrafficAnalytics = function() {
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const loginLogs = allAudit.filter(a => (a.action || '').toLowerCase().includes('login') && (a.created_at || '') >= since7);

  // Peak hour
  const hourCounts = {};
  for (let h = 0; h < 24; h++) hourCounts[h] = 0;
  loginLogs.forEach(l => {
    const h = new Date(l.created_at).getHours();
    hourCounts[h] = (hourCounts[h] || 0) + 1;
  });
  const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
  const kpiEl = document.getElementById('an-peak-hour');
  if (kpiEl) kpiEl.textContent = peakHour ? `${String(peakHour[0]).padStart(2, '0')}:00` : '—';

  // KPI: active now (last 30 min)
  const now30m = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const activeNow = allAudit.filter(a => (a.action || '').toLowerCase().includes('login') && (a.created_at || '') >= now30m);
  const kpiActive = document.getElementById('an-active-now');
  if (kpiActive) kpiActive.textContent = new Set(activeNow.map(a => a.user_id)).size;

  // Traffic chart
  const canvas = document.getElementById('chartTraffic');
  if (canvas && typeof Chart !== 'undefined') {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (_chartTraffic) _chartTraffic.destroy();
      try {
        const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
        _chartTraffic = new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets: [{
              label: 'Logins',
              data: labels.map((_, i) => hourCounts[i] || 0),
              borderColor: '#f97316',
              backgroundColor: 'rgba(249,115,22,.1)',
              fill: true, tension: .4, pointRadius: 3, pointBackgroundColor: '#f97316'
            }]
          },
          options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#64748b', maxRotation: 0 }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { beginAtZero: true, ticks: { precision: 0, color: '#64748b' }, grid: { color: 'rgba(255,255,255,.04)' } } } }
        });
      } catch (_) {}
    }
  }

  // Top users list
  const topEl = document.getElementById('topUsersList');
  if (topEl) {
    const userCounts = {};
    loginLogs.forEach(l => { if (l.user_id) userCounts[l.user_id] = (userCounts[l.user_id] || 0) + 1; });
    const sorted = Object.entries(userCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxC = sorted[0]?.[1] || 1;
    topEl.innerHTML = sorted.map(([uid, count]) => {
      const user = allUsers.find(u => u.id === uid);
      const name = user?.name || user?.email || uid?.slice(0, 8) || '—';
      const pct = Math.round((count / maxC) * 100);
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="width:28px;height:28px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:white;flex-shrink:0;">${(name[0]||'?').toUpperCase()}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escH(name)}</div>
          <div style="height:4px;background:rgba(255,255,255,.06);border-radius:50px;margin-top:3px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#f97316,#fb923c);border-radius:50px;"></div>
          </div>
        </div>
        <span style="font-size:12px;font-weight:900;color:#f97316;">${count}</span>
      </div>`;
    }).join('') || '<div style="text-align:center;padding:20px;color:var(--muted);">Sin actividad</div>';
  }
};

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
  if (!confirm('¿Limpiar todos los errores registrados?\n\nEsta acción truncará la tabla system_errors y no se puede deshacer.')) return;
  try {
    const { error } = await supabase.from('system_errors').delete().lt('created_at', new Date().toISOString());
    if (error) throw error;
    showToast('Registro de errores limpiado.', 'success');
    await renderErrors();
  } catch (e) {
    showToast('No se pudieron borrar los errores: ' + (e?.message || e), 'error');
    logError('panel_control', e?.message || String(e), e?.stack || '', 'clearErrors').catch(() => {});
  }
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
  const bio  = document.getElementById('cfgBio')?.value.trim() || '';
  if (!name) { showToast('El nombre no puede estar vacío.', 'warn'); return; }
  const { error } = await supabase.from('profiles').update({ name, bio }).eq('id', currentUser.id);
  if (error) { showToast('Error al guardar perfil: ' + error.message, 'error'); return; }
  document.getElementById('adminName').textContent = name;
  document.getElementById('adminAvatar').textContent = name[0].toUpperCase();
  try {
    localStorage.setItem('karpus_ctrl_profile_' + currentUser.id,
      JSON.stringify({ role: currentUser.role, name, bio, ts: Date.now() }));
  } catch (_) {}
  showToast('✅ Perfil actualizado correctamente.', 'success');
};

window.changeUserRole = async function() {
  const email = document.getElementById('roleChangeEmail')?.value.trim();
  const role  = document.getElementById('roleChangeVal')?.value;
  const msg   = document.getElementById('roleChangeMsg');
  if (!email || !role) { msg.style.color = '#f87171'; msg.textContent = 'Completa todos los campos.'; return; }
  // Validación estricta: el rol debe estar en la whitelist
  if (!VALID_ROLES.includes(role)) { msg.style.color = '#f87171'; msg.textContent = 'Rol no válido.'; return; }

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
    showToast(`Rol de ${email} cambiado a "${role}".`, 'success');
    await loadUsers();
  } catch (e) {
    msg.style.color = '#f87171';
    msg.textContent = 'Error: ' + e.message;
    showToast('Error al cambiar rol: ' + e.message, 'error');
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
    if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    document.getElementById('emailTestResult').innerHTML =
      '<span style="color:#4ade80;font-weight:900;">✅ Correo enviado (ID: ' + escH(data?.id || 'ok') + ')</span>';
  } catch (e) {
    // Traducir fallos del proveedor/Edge Function a mensajes accionables
    const raw = String(e?.message || e || '');
    let friendly;
    if (/function not found|not deployed|404|nonexistent|non existent/i.test(raw)) {
      friendly = 'La Edge Function "send-email" no está desplegada en este entorno.';
    } else if (/provider|smtp|bounce|reject|quota|api.?key|unauthorized|domain|sender/i.test(raw)) {
      friendly = 'El proveedor de correo reportó una falla. Revisa la configuración SMTP/API de la Edge Function "send-email".';
    } else if (/failed to fetch|network/i.test(raw)) {
      friendly = 'Sin conexión con el servidor de funciones. Verifica tu red.';
    } else {
      friendly = raw;
    }
    document.getElementById('emailTestResult').innerHTML =
      '<span style="color:#f87171;font-weight:900;">❌ ' + escH(friendly) + '</span>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📧 Probar correo'; }
  }
};

// ══ MÓDULOS Y VISIBILIDAD (Feature Flags) ════════════════════════════════════
async function initModulesUI() {
  if (!ffLoaded) {
    await loadFlags();
    ffData = JSON.parse(JSON.stringify(getFlags()));
    ffDirty = false;
    ffLoaded = true;
    subscribeFlagsRemote();
  }
  renderFFToggles();
  renderFFMatrix();
  renderFFOverrides();
}

// Sincronización en vivo: otro dispositivo guardó cambios → reflejar aquí
function subscribeFlagsRemote() {
  onFlagsChange((flags) => {
    if (!ffLoaded || ffDirty) return; // no pisar cambios sin guardar del admin
    ffData = JSON.parse(JSON.stringify(flags));
    if (document.getElementById('sec-modulos')?.classList.contains('active')) {
      renderFFToggles();
      renderFFMatrix();
      renderFFOverrides();
    }
  });
}

function updateFFStatus() {
  const el  = document.getElementById('ffStatus');
  const btn = document.getElementById('ffSaveBtn');
  if (ffDirty) {
    if (el)  { el.textContent = '● Cambios sin guardar'; el.style.color = '#fb923c'; }
    if (btn) btn.disabled = false;
  } else {
    if (el)  { el.textContent = '✓ Sincronizado'; el.style.color = '#4ade80'; }
    if (btn) btn.disabled = true;
  }
}

function _modCfg(key) {
  if (!ffData.modules[key]) ffData.modules[key] = moduleDefault();
  return ffData.modules[key];
}

window.ffToggleModule = function(key, checked) {
  _modCfg(key).enabled = !!checked;
  ffDirty = true;
  renderFFToggles();
  renderFFMatrix();
  updateFFStatus();
};

window.ffRolePerm = function(key, role, checked) {
  const cfg = _modCfg(key);
  if (!cfg.roles) cfg.roles = {};
  cfg.roles[role] = !!checked;
  ffDirty = true;
  renderFFToggles();
  renderFFMatrix();
  updateFFStatus();
};

function renderFFToggles() {
  const grid = document.getElementById('ffToggles');
  if (!grid || !ffData) return;
  grid.innerHTML = MODULES.map(m => {
    const enabled = (ffData.modules[m.key] || {}).enabled !== false;
    return `<div class="ff-card">
      <div class="ff-icon" style="background:${m.color}1f;"><i class="bi ${m.icon}" style="color:${m.color};"></i></div>
      <div style="min-width:0;">
        <div style="font-size:12px;font-weight:900;color:var(--text);">${escH(m.label)}</div>
        <div style="font-size:10px;font-weight:800;color:${enabled ? '#4ade80' : '#f87171'};">${enabled ? 'Activo' : 'Desactivado globalmente'}</div>
      </div>
      <label class="ff-switch" title="${enabled ? 'Desactivar' : 'Activar'} ${escH(m.label)}">
        <input type="checkbox" ${enabled ? 'checked' : ''} onchange="ffToggleModule('${m.key}', this.checked)">
        <span class="ff-slider"></span>
      </label>
    </div>`;
  }).join('');
}

function renderFFMatrix() {
  const tbody = document.getElementById('ffMatrixBody');
  if (!tbody || !ffData) return;
  tbody.innerHTML = MODULES.map(m => {
    const cfg = ffData.modules[m.key] || {};
    const enabled = cfg.enabled !== false;
    const cells = ROLES.map(r =>
      `<td style="text-align:center;"><input type="checkbox" class="ff-chk" ${cfg.roles?.[r] !== false ? 'checked' : ''} ${enabled ? '' : 'disabled'} onchange="ffRolePerm('${m.key}','${r}', this.checked)" title="${escH(m.label)} — ${ROLE_LABELS[r]}"></td>`
    ).join('');
    return `<tr class="${enabled ? '' : 'ff-off-row'}">
      <td><span class="badge" style="background:${m.color}1f;color:${m.color};"><i class="bi ${m.icon}" style="margin-right:4px;"></i>${escH(m.label)}</span></td>
      ${cells}
    </tr>`;
  }).join('');
}

window.ffSearchUsers = function() {
  clearTimeout(ffSearchTimer);
  ffSearchTimer = setTimeout(async () => {
    const q   = document.getElementById('ffUserSearch')?.value.trim() || '';
    const box = document.getElementById('ffSearchResults');
    if (!box) return;
    if (q.length < 2) { box.innerHTML = ''; return; }
    box.innerHTML = '<div style="text-align:center;padding:10px;color:var(--muted);font-size:12px;">Buscando...</div>';
    try {
      // Sanitizar comodines/caracteres reservados del filtro .or()
      const safe = q.replace(/[%_,()]/g, '');
      const { data, error } = await supabase.from('profiles')
        .select('id, name, email, role')
        .or(`name.ilike.%${safe}%,email.ilike.%${safe}%`)
        .limit(6);
      if (error) throw error;
      if (!data?.length) {
        box.innerHTML = '<div style="text-align:center;padding:10px;color:var(--muted);font-size:12px;">Sin resultados para esa búsqueda.</div>';
        return;
      }
      box.innerHTML = data.map(u => `
        <div style="display:flex;align-items:center;gap:10px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:8px 12px;">
          <div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:white;flex-shrink:0;">${escH((u.name||u.email||'?')[0].toUpperCase())}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escH(u.name||u.email)}</div>
            <div style="font-size:10px;color:var(--muted);">${escH(u.email||'')} · ${escH(u.role||'sin rol')}</div>
          </div>
          ${ffData.overrides[u.id] ? '<span class="badge badge-orange" style="flex-shrink:0;">con override</span>' : ''}
          <button class="btn btn-ghost" style="padding:4px 10px;font-size:10px;flex-shrink:0;" onclick="ffAddOverride('${u.id}')">Configurar</button>
        </div>`).join('');
    } catch (e) {
      box.innerHTML = `<div class="alert alert-red"><i class="bi bi-x-circle-fill"></i> Error al buscar: ${escH(e.message)}</div>`;
    }
  }, 300);
};

window.ffAddOverride = function(userId) {
  if (!userId || !ffData) return;
  if (!ffData.overrides[userId]) ffData.overrides[userId] = {};
  ffExpandedUser = userId;
  const inp = document.getElementById('ffUserSearch'); if (inp) inp.value = '';
  const res = document.getElementById('ffSearchResults'); if (res) res.innerHTML = '';
  ffDirty = true;
  renderFFOverrides();
  updateFFStatus();
};

window.ffRemoveOverride = function(userId) {
  if (!userId || !ffData) return;
  delete ffData.overrides[userId];
  if (ffExpandedUser === userId) ffExpandedUser = null;
  ffDirty = true;
  renderFFOverrides();
  updateFFStatus();
};

window.ffSetOverride = function(userId, modKey, value) {
  if (!userId || !modKey || !ffData) return;
  if (!ffData.overrides[userId]) ffData.overrides[userId] = {};
  if (value === 'inherit') delete ffData.overrides[userId][modKey];
  else ffData.overrides[userId][modKey] = value;
  ffDirty = true;
  updateFFStatus();
};

window.ffToggleExpand = function(userId) {
  ffExpandedUser = ffExpandedUser === userId ? null : userId;
  renderFFOverrides();
};

function _overrideUserCard(userId, ov) {
  const u = allUsers.find(x => x.id === userId);
  const name  = u?.name  || u?.email || (userId.slice(0, 8) + '…');
  const email = u?.email || userId;
  const activeKeys = Object.keys(ov || {});
  const expanded = ffExpandedUser === userId;
  let detail = '';
  if (expanded) {
    detail = `<div style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px;">
      ${MODULES.map(m => {
        const val = ov[m.key] || 'inherit';
        return `<div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;min-width:0;font-size:11px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escH(m.label)}</div>
          <select class="inp" style="width:auto;padding:4px 8px;font-size:11px;" onchange="ffSetOverride('${userId}','${m.key}', this.value)">
            <option value="inherit" ${val === 'inherit' ? 'selected' : ''}>Heredar matriz</option>
            <option value="allow"   ${val === 'allow'   ? 'selected' : ''}>✅ Permitir siempre</option>
            <option value="deny"    ${val === 'deny'    ? 'selected' : ''}>🚫 Bloquear siempre</option>
          </select>
        </div>`;
      }).join('')}
    </div>`;
  }
  return `<div style="background:var(--surface2);border:1px solid ${expanded ? 'rgba(99,102,241,.4)' : 'var(--border)'};border-radius:12px;padding:10px 14px;">
    <div style="display:flex;align-items:center;gap:10px;">
      <button onclick="ffToggleExpand('${userId}')" style="background:none;border:none;cursor:pointer;font-size:13px;color:#a5b4fc;padding:0;width:16px;">${expanded ? '▾' : '▸'}</button>
      <div style="min-width:0;flex:1;">
        <div style="font-size:12px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escH(name)} ${activeKeys.length ? `<span class="badge badge-purple" style="margin-left:4px;">${activeKeys.length} regla${activeKeys.length > 1 ? 's' : ''}</span>` : ''}</div>
        <div style="font-size:10px;color:var(--muted);">${escH(email)}</div>
      </div>
      <button class="btn btn-danger" style="padding:4px 10px;font-size:10px;" onclick="ffRemoveOverride('${userId}')"><i class="bi bi-trash"></i></button>
    </div>
    ${detail}
  </div>`;
}

function renderFFOverrides() {
  const list  = document.getElementById('ffOverrideList');
  const count = document.getElementById('ffOverrideCount');
  if (!list || !ffData) return;
  const ids = Object.keys(ffData.overrides || {});
  if (count) count.textContent = ids.length;
  if (!ids.length) {
    list.innerHTML = '<div style="text-align:center;padding:14px;color:var(--muted);font-size:12px;">Sin overrides individuales. Busca un usuario arriba para crear uno.</div>';
    return;
  }
  list.innerHTML = ids.map(id => _overrideUserCard(id, ffData.overrides[id])).join('');
}

window.saveFlags = async function() {
  const btn = document.getElementById('ffSaveBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Guardando...'; }
  try {
    // Limpieza: descartar overrides que quedaron sin reglas efectivas
    Object.keys(ffData.overrides).forEach(uid => {
      if (!Object.keys(ffData.overrides[uid]).length) delete ffData.overrides[uid];
    });
    const payload = normalizeFlags(ffData);
    const { error } = await supabase.from('school_settings')
      .update({ feature_flags: payload })
      .eq('id', 1);
    if (error) throw error;

    setLocalFlags(payload);
    ffData = JSON.parse(JSON.stringify(payload));
    ffDirty = false;
    updateFFStatus();
    renderFFToggles();
    renderFFMatrix();
    renderFFOverrides();

    // Auditoría inmutable del cambio de configuración
    supabase.from('audit_logs').insert({
      user_id: currentUser.id,
      action: 'admin.update_feature_flags',
      payload: {
        changed_by: currentUser.email,
        modules_configured: Object.keys(payload.modules),
        users_with_overrides: Object.keys(payload.overrides).length
      }
    }).then(() => {}).catch(() => {});

    const st = document.getElementById('ffStatus');
    if (st) { st.textContent = '✓ Guardado — sincronizado en todos los dispositivos'; st.style.color = '#4ade80'; }
    showToast('Permisos guardados y sincronizados en vivo.', 'success');
  } catch (e) {
    showToast('Error al guardar flags: ' + (e.message || e), 'error');
    logError('panel_control', e?.message || String(e), e?.stack || '', 'saveFlags').catch(() => {});
    updateFFStatus();
  } finally {
    if (btn) btn.innerHTML = '<i class="bi bi-cloud-arrow-up-fill"></i> Guardar cambios';
  }
};

// ── Alertas por Correo Electrónico (resumen de fraude/errores) ───────────────
const AUTO_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // máx. 1 correo automático por hora
let _lastAutoReportAt = 0;
let _emailAlertBusy = false;

window.toggleAutoAlerts = function(enabled) {
  savePrefs({ autoEmailAlerts: !!enabled });
  const st = document.getElementById('autoAlertState');
  if (st) {
    st.textContent = 'Automático: ' + (enabled ? 'ON' : 'OFF');
    st.style.color = enabled ? '#4ade80' : 'var(--muted)';
  }
  showToast(enabled ? 'Alertas automáticas por correo activadas.' : 'Alertas automáticas desactivadas.', enabled ? 'success' : 'info');
};

function _buildReportHtml() {
  const high = fraudEvents.filter(f => f.risk === 'alto');
  const now = new Date().toLocaleString('es-DO', { dateStyle: 'full', timeStyle: 'short' });
  const rows = fraudEvents.slice(0, 10).map(f =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${escH(f.type)}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${escH(f.user)}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:${f.risk === 'alto' ? '#dc2626' : '#d97706'};font-weight:bold;">${escH(f.risk)}</td></tr>`
  ).join('') || '<tr><td colspan="3" style="padding:10px;color:#16a34a;">Sin eventos sospechosos ✅</td></tr>';
  return `<div style="font-family:Arial,sans-serif;padding:24px;background:#f8fafc;">
    <h2 style="color:#4338ca;margin:0 0 4px;">🛡️ Karpus Kids — Reporte del Panel de Control</h2>
    <p style="color:#64748b;font-size:12px;margin:0 0 18px;">Generado: ${now}</p>
    <div style="display:flex;gap:12px;margin-bottom:20px;">
      <div style="flex:1;background:white;border-radius:12px;padding:14px;text-align:center;border:1px solid #e5e7eb;"><div style="font-size:22px;font-weight:900;color:${fraudEvents.length ? '#dc2626' : '#16a34a'};">${fraudEvents.length}</div><div style="font-size:11px;color:#64748b;">Alertas de fraude</div></div>
      <div style="flex:1;background:white;border-radius:12px;padding:14px;text-align:center;border:1px solid #e5e7eb;"><div style="font-size:22px;font-weight:900;color:#dc2626;">${high.length}</div><div style="font-size:11px;color:#64748b;">Riesgo alto</div></div>
      <div style="flex:1;background:white;border-radius:12px;padding:14px;text-align:center;border:1px solid #e5e7eb;"><div style="font-size:22px;font-weight:900;color:#4338ca;">${allUsers.filter(u => !u.role).length}</div><div style="font-size:11px;color:#64748b;">Usuarios sin rol</div></div>
      <div style="flex:1;background:white;border-radius:12px;padding:14px;text-align:center;border:1px solid #e5e7eb;"><div style="font-size:22px;font-weight:900;color:#4338ca;">${allUsers.length}</div><div style="font-size:11px;color:#64748b;">Usuarios totales</div></div>
    </div>
    <h3 style="color:#334155;font-size:14px;">Eventos detectados</h3>
    <table style="width:100%;border-collapse:collapse;background:white;border-radius:10px;overflow:hidden;font-size:12px;">
      <thead><tr style="background:#eef2ff;"><th style="text-align:left;padding:8px 10px;">Tipo</th><th style="text-align:left;padding:8px 10px;">Usuario</th><th style="text-align:left;padding:8px 10px;">Riesgo</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#94a3b8;font-size:11px;margin-top:18px;">Correo automático del Panel de Control — Karpus Kids</p>
  </div>`;
}

async function _resolveReportRecipient() {
  // Prioridad: campo del formulario → email del admin → buzón institucional
  const input = document.getElementById('alertEmailTo')?.value.trim();
  if (input && /.+@.+\..+/.test(input)) {
    try { savePrefs({ reportEmail: input }); } catch (_) {}
    return input;
  }
  try { if (loadPrefs().reportEmail) return loadPrefs().reportEmail; } catch (_) {}
  if (currentUser?.email) return currentUser.email;
  return 'impulsodigital@gmail.com';
}

window.sendAdminReport = async function(manual = false) {
  if (_emailAlertBusy) return;
  const to = await _resolveReportRecipient();
  const msgEl = document.getElementById('reportEmailMsg');
  const btn = document.getElementById('btnSendReport');
  if (!to) { if (manual) showToast('Configura un correo destinatario.', 'warn'); return; }
  _emailAlertBusy = true;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Enviando...'; }
  if (manual && msgEl) { msgEl.style.color = '#94a3b8'; msgEl.textContent = 'Enviando reporte a ' + to + '...'; }
  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: {
        to,
        subject: '🛡️ Karpus Kids — Reporte del Panel (' + new Date().toLocaleDateString('es-DO') + ')',
        html: _buildReportHtml(),
      }
    });
    if (error) throw new Error(error.message || JSON.stringify(error));
    if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    _lastAutoReportAt = Date.now();
    if (manual) {
      if (msgEl) { msgEl.style.color = '#4ade80'; msgEl.textContent = '✅ Reporte enviado correctamente a ' + to; }
      showToast('Reporte enviado a ' + to, 'success');
    } else {
      console.info('[Karpus] Alerta automática enviada a', to);
    }
  } catch (e) {
    const raw = String(e?.message || e || '');
    const friendly = /function not found|not deployed|404/i.test(raw)
      ? 'La Edge Function "send-email" no está desplegada.'
      : /provider|smtp|reject|quota|api.?key|unauthorized/i.test(raw)
        ? 'El proveedor de correo rechazó el envío.'
        : raw;
    if (manual) {
      if (msgEl) { msgEl.style.color = '#f87171'; msgEl.textContent = '❌ ' + friendly; }
      showToast('No se pudo enviar el reporte: ' + friendly, 'error');
    } else {
      console.warn('[Karpus] Falló alerta automática:', friendly);
    }
  } finally {
    _emailAlertBusy = false;
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-send-fill"></i> Enviar reporte ahora'; }
  }
};

// Envío automático silencioso: riesgo alto detectado + cooldown de 1 hora
function maybeSendAutoAlert() {
  try { if (!loadPrefs().autoEmailAlerts) return; } catch (_) { return; }
  if (_emailAlertBusy) return;
  if ((Date.now() - _lastAutoReportAt) < AUTO_ALERT_COOLDOWN_MS) return;
  const hasHighRisk = fraudEvents.some(f => f.risk === 'alto');
  if (hasHighRisk) sendAdminReport(false);
}

// ── Realtime ──────────────────────────────────────────────────────────────────
function _sectionActive(id) {
  return document.getElementById('sec-' + id)?.classList.contains('active');
}

function startRealtime() {
  // Desduplicación: cancelar y limpiar cualquier canal previo antes de re-suscribir
  if (_realtimeChannel) {
    try { supabase.removeChannel(_realtimeChannel); } catch (_) {}
    _realtimeChannel = null;
  }
  _realtimeChannel = supabase.channel('admin-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, async () => {
      await loadPayments();
      detectFraud();
      const bf = document.getElementById('badge-fraud');
      if (bf) bf.textContent = fraudEvents.length;
      if (_sectionActive('dashboard')) renderDashboard();
      if (_sectionActive('pagos'))     renderPayments();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, async () => {
      await loadAttendance();
      // KPI de asistencia del día + tabla si está visible
      const today = new Date().toISOString().split('T')[0];
      const kpi = document.getElementById('kpi-attendance');
      if (kpi) kpi.textContent = allAttend.filter(a => a.date === today).length;
      if (_sectionActive('asistencia')) renderAttendance();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'door_punches' }, async () => {
      await loadPunches();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, async () => {
      await loadWallPosts();
      if (_sectionActive('muro')) renderWall();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async () => {
      await loadChatData();
      if (_sectionActive('chat')) renderChat();
    })
    .subscribe();
}

// ── Menú lateral móvil (hamburguesa + backdrop) ──────────────────────────────
function _syncSidebarBackdrop() {
  const bd = document.getElementById('sidebarBackdrop');
  const open = document.getElementById('sidebar')?.classList.contains('open');
  if (bd) bd.classList.toggle('show', !!open && window.innerWidth <= 768);
}
window.toggleSidebar = function() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  sb.classList.toggle('open');
  _syncSidebarBackdrop();
};
window.closeSidebar = function() {
  document.getElementById('sidebar')?.classList.remove('open');
  _syncSidebarBackdrop();
};
window.addEventListener('resize', () => {
  if (window.innerWidth > 768) window.closeSidebar();
});// ── Limpieza al abandonar el panel (canales realtime + intervalos) ───────────
// Nota: este panel usa UN único canal persistente ('admin-realtime') compartido
// por todas las secciones — no hay canales por sección que desduplicar.
window.addEventListener('pagehide', () => {
  if (_clockInterval) { clearInterval(_clockInterval); _clockInterval = null; }
  if (_sessionInterval) { clearInterval(_sessionInterval); _sessionInterval = null; }
  try { supabase.removeAllChannels(); } catch (_) {}
  _realtimeChannel = null;
});

// ── Logout con limpieza total: suscripciones realtime, intervalos y caché local ──
window.doLogout = async function() {
  try {
    // 1. Cancelar todas las suscripciones realtime
    try { supabase.removeAllChannels(); } catch (_) {}
    _realtimeChannel = null;
    // 2. Detener intervalos activos (reloj + refresco de sesión)
    if (_clockInterval)   { clearInterval(_clockInterval);   _clockInterval = null; }
    if (_sessionInterval) { clearInterval(_sessionInterval); _sessionInterval = null; }
    // 3. Limpiar caché local del panel (perfiles cacheados)
    Object.keys(localStorage)
      .filter(k => k.startsWith('karpus_ctrl_'))
      .forEach(k => localStorage.removeItem(k));
  } catch (_) {}
  await supabase.auth.signOut();
  window.location.href = 'login.html';
};

// ── Notificaciones del navegador: estado y solicitud de permiso ──────────────
function updateNotifUI(perm) {
  const btn = document.getElementById('notifPermBtn');
  if (!btn) return;
  const p = perm || ('Notification' in window ? Notification.permission : 'unsupported');
  const map = {
    granted:     ['badge-green',  '✅ Activadas'],
    denied:      ['badge-red',    '🚫 Bloqueadas'],
    default:     ['badge-yellow', '⚠️ Clic para activar'],
    unsupported: ['badge-gray',   'No soportadas'],
  };
  const [cls, label] = map[p] || map.unsupported;
  btn.className = 'badge ' + cls;
  btn.textContent = label;
}

window.requestNotifPermission = async function() {
  if (!('Notification' in window)) { showToast('Este navegador no soporta notificaciones.', 'warn'); return; }
  if (Notification.permission === 'granted') { showToast('Las notificaciones ya están activadas.', 'info'); return; }
  try {
    const perm = await Notification.requestPermission();
    updateNotifUI(perm);
    showToast(
      perm === 'granted' ? 'Notificaciones del navegador activadas.' :
      perm === 'denied'  ? 'Permiso de notificaciones bloqueado.' : 'Permiso pendiente.',
      perm === 'granted' ? 'success' : 'warn'
    );
  } catch (_) { /* usuario canceló */ }
};

// ── Monitoreo de salud de Edge Functions ─────────────────────────────────────
// Un gateway de Supabase responde 401/400 si la función existe (exige JWT) y
// 404 si no está desplegada — sin efectos secundarios ni envíos reales.
async function checkEdgeFunctionsHealth() {
  const el = document.getElementById('funcStatus');
  if (!el) return;
  el.className = 'badge badge-gray';
  el.textContent = 'Verificando...';
  const names = ['send-email', 'admin-reset-password'];
  const base = String(SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) { el.className = 'badge badge-yellow'; el.textContent = 'N/D'; return; }
  try {
    const statuses = await Promise.all(names.map(n =>
      fetch(`${base}/functions/v1/${n}`, { method: 'GET', headers: { apikey: SUPABASE_ANON_KEY } })
        .then(r => r.status)
        .catch(() => 0)
    ));
    const deployed = statuses.filter(s => s === 401 || s === 400 || s === 200).length;
    const missing  = statuses.filter(s => s === 404).length;
    const unknown  = statuses.filter(s => s === 0).length;
    if (deployed === names.length) {
      el.className = 'badge badge-green';
      el.innerHTML = '<i class="bi bi-circle-fill" style="font-size:6px;"></i> Activas';
    } else if (missing === names.length) {
      el.className = 'badge badge-red';
      el.innerHTML = '<i class="bi bi-circle-fill" style="font-size:6px;"></i> No desplegadas';
    } else if (unknown === names.length) {
      el.className = 'badge badge-yellow'; el.textContent = 'N/D';
    } else {
      el.className = 'badge badge-yellow';
      el.textContent = `${deployed}/${names.length} activas`;
    }
  } catch (_) {
    el.className = 'badge badge-yellow';
    el.textContent = 'N/D';
  }
}

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

function fmtMoney(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { maximumFractionDigits: 2 });
}
