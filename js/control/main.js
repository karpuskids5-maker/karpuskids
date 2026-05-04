import { supabase } from '../shared/supabase.js';

const ADMIN_ID = 'c1e72617-ab8f-44c0-b1eb-cdd92eda62e7';

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
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) { window.location.href = 'login.html'; return; }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, email, role')
    .eq('id', session.user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'admin') {
    alert('Acceso denegado. Solo administradores.');
    await supabase.auth.signOut();
    window.location.href = 'login.html';
    return;
  }

  currentUser = profile;
  document.getElementById('adminName').textContent = profile.name || profile.email;
  document.getElementById('adminAvatar').textContent = (profile.name || profile.email)[0].toUpperCase();
  document.getElementById('cfgEmail').value = profile.email || '';
  document.getElementById('cfgName').value  = profile.name  || '';
  document.getElementById('loader').style.display = 'none';

  setInterval(() => {
    document.getElementById('topClock').textContent =
      new Date().toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'medium' });
  }, 1000);

  if (window.innerWidth <= 768) {
    document.getElementById('mobMenuBtn').style.display = 'block';
  }

  await refreshAll();
  startRealtime();
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
};

// ── Refresh ───────────────────────────────────────────────────────────────────
window.refreshAll = async function() {
  await Promise.allSettled([
    loadUsers(), loadAudit(), loadPayments(),
    loadAttendance(), loadStudents(), loadClassrooms(), loadPunches()
  ]);
  renderDashboard();
};

// ── Load data ─────────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, email, role, created_at, avatar_url, phone, bio')
      .order('created_at', { ascending: false })
      .limit(300);
    allUsers = data || [];
    const kpi = document.getElementById('kpi-users');
    if (kpi) kpi.textContent = allUsers.length;
    const cfgCount = document.getElementById('cfgUserCount');
    if (cfgCount) cfgCount.textContent = allUsers.length;
  } catch (_) { allUsers = []; }
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
  } catch (_) { allPunches = []; }
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
  } catch (_) { allAudit = []; }
}

async function loadPayments() {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('id, amount, status, method, bank, month_paid, created_at, student_id, students:student_id(name, p1_name)')
      .order('created_at', { ascending: false })
      .limit(300);
    allPayments = error ? [] : (data || []);
  } catch (_) { allPayments = []; }
}

async function loadStudents() {
  try {
    const { data } = await supabase
      .from('students')
      .select('id, name, parent_id, classroom_id, is_active, matricula');
    allStudents = data || [];
    const kpi = document.getElementById('kpi-students');
    if (kpi) kpi.textContent = allStudents.filter(s => s.is_active).length;
  } catch (_) { allStudents = []; }
}

async function loadClassrooms() {
  try {
    const { data } = await supabase.from('classrooms').select('id, name, teacher_id');
    allClassrooms = data || [];
  } catch (_) { allClassrooms = []; }
}

async function loadAttendance() {
  const today = new Date().toISOString().split('T')[0];
  try {
    // Fetch attendance with student names
    const { data, error } = await supabase
      .from('attendance')
      .select('id, date, check_in, check_out, status, student_id, classroom_id, students:student_id(name), classrooms:classroom_id(name)')
      .order('date', { ascending: false })
      .limit(300);
    if (error) throw error;
    allAttend = data || [];
    const todayCount = allAttend.filter(a => a.date === today).length;
    const kpi = document.getElementById('kpi-attendance');
    if (kpi) kpi.textContent = todayCount;
  } catch (_) {
    // Fallback without joins
    try {
      const { data } = await supabase
        .from('attendance')
        .select('id, date, check_in, check_out, status, student_id, classroom_id')
        .order('date', { ascending: false })
        .limit(300);
      allAttend = data || [];
    } catch (__) { allAttend = []; }
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
    renderRecentAudit();
    renderFraudAlertsList();
    renderCharts();
  } catch (_) {}
}

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
            datasets: [{ label: 'Usuarios', data: [rc.padre, rc.maestra, rc.directora], backgroundColor: ['rgba(99,102,241,.7)','rgba(34,197,94,.7)','rgba(249,115,22,.7)'], borderRadius: 6 }]
          },
          options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.04)' } } } }
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
            datasets: [{ data: Object.values(rc), backgroundColor: ['#6366f1','#22c55e','#f97316','#3b82f6','#eab308'], borderWidth: 0, hoverOffset: 8 }]
          },
          options: { responsive: true, plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 }, padding: 12 } } }, cutout: '65%' }
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
    return `<tr>
      <td><span style="font-weight:800;">${escH(name)}</span></td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(action)}</td>
      <td style="color:var(--muted);">${time}</td>
      <td><span class="badge ${badge}">${action.split('.')[0]}</span></td>
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
    return `<tr>
      <td style="color:var(--muted);">${i+1}</td>
      <td style="white-space:nowrap;color:var(--muted);font-size:11px;">${dt}</td>
      <td><div style="font-weight:800;font-size:12px;">${escH(name)}</div><div style="font-size:10px;color:var(--muted);">${escH(email)}</div></td>
      <td><span class="badge ${roleBadge[role]||'badge-gray'}">${role}</span></td>
      <td><span class="badge ${badge}">${action}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(JSON.stringify(a.payload || {}))}</td>
      <td style="color:var(--muted);font-size:11px;">Web</td>
      <td><span class="badge badge-gray">Sincronizado</span></td>
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
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;display:flex;align-items:center;gap:12px;">
        <div style="width:44px;height:44px;background:${r.color}22;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="bi ${r.icon}" style="color:${r.color};font-size:18px;"></i>
        </div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:900;color:var(--text);">${r.title}</div>
          <div style="font-size:11px;color:var(--muted);">${r.desc}</div>
        </div>
        <div style="font-size:1.4rem;font-weight:900;color:${r.count > 0 ? r.color : 'var(--muted)'};">${r.count}</div>
      </div>`).join('');
  }
  const tbody = document.getElementById('fraudBody');
  document.getElementById('fraudCount').textContent = fraudEvents.length + ' eventos';
  if (!fraudEvents.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">✅ Sin eventos sospechosos detectados</td></tr>';
    return;
  }
  const riskBadge = { alto: 'badge-red', medio: 'badge-yellow', bajo: 'badge-blue' };
  tbody.innerHTML = fraudEvents.map(f => `<tr>
    <td style="font-size:11px;color:var(--muted);">${f.date ? new Date(f.date).toLocaleString('es-DO') : '—'}</td>
    <td style="font-weight:800;">${escH(f.user)}</td>
    <td><span class="badge badge-orange">${f.type}</span></td>
    <td style="color:var(--muted);">${escH(f.detail)}</td>
    <td><span class="badge ${riskBadge[f.risk]||'badge-gray'}">${f.risk}</span></td>
    <td><button class="btn btn-ghost" style="padding:4px 10px;font-size:10px;" onclick="alert('Investigando: ${escH(f.user)}')"><i class="bi bi-search"></i> Revisar</button></td>
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

// ── Helper: last access from door_punches ─────────────────────────────────────
function getLastAccess(userId) {
  const punch = allPunches.find(p => p.staff_id === userId || p.student_id === userId);
  if (!punch) return '—';
  return new Date(punch.punched_at).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' });
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
        <label style="font-size:11px;font-weight:900;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;display:block;margin-bottom:6px;">Nueva contraseña</label>
        <input class="inp" id="newPwdInput" type="password" placeholder="Mínimo 6 caracteres" autocomplete="new-password">
      </div>
      <div style="margin-bottom:16px;">
        <label style="font-size:11px;font-weight:900;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;display:block;margin-bottom:6px;">Confirmar contraseña</label>
        <input class="inp" id="newPwdConfirm" type="password" placeholder="Repite la contraseña" autocomplete="new-password">
      </div>
      <div id="pwdMsg" style="font-size:12px;font-weight:700;margin-bottom:12px;"></div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" onclick="doResetPassword('${userId}')"><i class="bi bi-check-lg"></i> Guardar contraseña</button>
        <button class="btn btn-ghost" onclick="document.getElementById('userModal').style.display='none'">Cancelar</button>
      </div>
    </div>`;
  modal.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;align-items:center;justify-content:center;';
};

window.doResetPassword = async function(userId) {
  const pwd  = document.getElementById('newPwdInput')?.value || '';
  const pwd2 = document.getElementById('newPwdConfirm')?.value || '';
  const msg  = document.getElementById('pwdMsg');
  if (pwd.length < 6) { msg.style.color = '#f87171'; msg.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
  if (pwd !== pwd2)   { msg.style.color = '#f87171'; msg.textContent = 'Las contraseñas no coinciden.'; return; }
  msg.style.color = '#94a3b8'; msg.textContent = 'Guardando...';
  try {
    // Use Supabase admin API via Edge Function to update password
    const { data, error } = await supabase.functions.invoke('admin-reset-password', {
      body: { user_id: userId, new_password: pwd }
    });
    if (error || data?.error) throw new Error(error?.message || data?.error || 'Error desconocido');
    msg.style.color = '#4ade80'; msg.textContent = '✅ Contraseña actualizada correctamente.';
    setTimeout(() => { document.getElementById('userModal').style.display = 'none'; }, 1500);
  } catch (e) {
    msg.style.color = '#f87171'; msg.textContent = '❌ Error: ' + e.message;
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
    <td style="font-weight:800;">${escH(p.students?.name||'—')}</td>
    <td style="color:var(--muted);">${escH(p.students?.p1_name||'—')}</td>
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
    const studentName = a.students?.name || allStudents.find(s => s.id === a.student_id)?.name || String(a.student_id || '—');
    const classroomName = a.classrooms?.name || allClassrooms.find(c => c.id === a.classroom_id)?.name || '—';
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
  } catch (_) {}
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted);">✅ Sin errores registrados</td></tr>';
}

window.clearErrors = async function() {
  if (!confirm('¿Limpiar todos los errores registrados?')) return;
  await supabase.from('system_errors').delete().lt('created_at', new Date().toISOString());
  renderErrors();
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
  const { error } = await supabase.from('profiles').update({ role }).eq('email', email);
  if (error) { msg.style.color = '#f87171'; msg.textContent = 'Error: ' + error.message; return; }
  msg.style.color = '#4ade80';
  msg.textContent = `✅ Rol de ${email} cambiado a "${role}" correctamente.`;
  await loadUsers();
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function escH(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
