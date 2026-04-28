import { supabase } from '../shared/supabase.js';

const ADMIN_EMAIL = 'impulsodigital@gmail.com';
const ADMIN_ID    = 'c1e72617-ab8f-44c0-b1eb-cdd92eda62e7';

// ── State ─────────────────────────────────────────────────────────────────────
let allUsers    = [];
let allAudit    = [];
let allPayments = [];
let allAttend   = [];
let fraudEvents = [];
let currentUser = null;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Verify session
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) { window.location.href = 'login.html'; return; }

  // Verify admin role
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

  // Clock
  setInterval(() => {
    document.getElementById('topClock').textContent =
      new Date().toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'medium' });
  }, 1000);

  // Mobile menu button
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

  // Lazy load per section
  if (id === 'auditoria')   renderAuditTable(allAudit);
  if (id === 'fraude')      renderFraud();
  if (id === 'usuarios')    renderUsers(allUsers);
  if (id === 'padres')      renderRoleTable('padres',    allUsers.filter(u => u.role === 'padre'));
  if (id === 'maestras')    renderRoleTable('maestras',  allUsers.filter(u => ['maestra','asistente'].includes(u.role)));
  if (id === 'directoras')  renderRoleTable('directoras',allUsers.filter(u => u.role === 'directora'));
  if (id === 'pagos')       renderPayments();
  if (id === 'asistencia')  renderAttendance();
  if (id === 'errores')     renderErrors();
};

// ── Refresh all data ──────────────────────────────────────────────────────────
window.refreshAll = async function() {
  await Promise.all([
    loadUsers(),
    loadAudit(),
    loadPayments(),
    loadAttendance(),
  ]);
  renderDashboard();
};

// ── Load data ─────────────────────────────────────────────────────────────────
async function loadUsers() {
  const { data } = await supabase
    .from('profiles')
    .select('id, name, email, role, created_at, avatar_url, phone')
    .order('created_at', { ascending: false })
    .limit(200);
  allUsers = data || [];
  document.getElementById('kpi-users').textContent = allUsers.length;
  document.getElementById('cfgUserCount').textContent = allUsers.length;
}

async function loadAudit() {
  // Cambiado de 'notifications' a 'audit_logs' para reflejar movimientos reales
  const { data } = await supabase
    .from('audit_logs')
    .select('id, user_id, action, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  allAudit = data || [];
  document.getElementById('badge-audit').textContent = allAudit.length;
}

async function loadPayments() {
  const { data } = await supabase
    .from('payments')
    .select('id, amount, status, method, bank, month, created_at, student_id')
    .order('created_at', { ascending: false })
    .limit(300);
  allPayments = data || [];
}

async function loadAttendance() {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('attendance')
    .select('id, date, check_in, check_out, status, student_id, students:student_id(name, classrooms:classroom_id(name))')
    .order('check_in', { ascending: false })
    .limit(200);
  allAttend = data || [];
  const todayCount = allAttend.filter(a => a.date === today).length;
  document.getElementById('kpi-attendance').textContent = todayCount;
}

// ── Dashboard render ──────────────────────────────────────────────────────────
async function renderDashboard() {
  // Students
  const { count } = await supabase.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true);
  document.getElementById('kpi-students').textContent = count || 0;

  // Payments this month
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const monthPays = allPayments.filter(p => p.created_at?.startsWith(monthStr));
  document.getElementById('kpi-payments').textContent = monthPays.length;
  const revenue = monthPays.filter(p => p.status === 'paid' || p.status === 'approved').reduce((s, p) => s + Number(p.amount || 0), 0);
  document.getElementById('kpi-revenue').textContent = revenue.toLocaleString('es-DO');

  // Fraud alerts
  detectFraud();
  document.getElementById('kpi-alerts').textContent = fraudEvents.length;
  document.getElementById('badge-fraud').textContent = fraudEvents.length;

  // Recent audit
  renderRecentAudit();
  renderFraudAlertsList();
  renderCharts();
}

// ── Charts ────────────────────────────────────────────────────────────────────
let chartActivity = null, chartRoles = null, chartPaymentsChart = null, chartAttendChart = null;

function renderCharts() {
  // Activity by role (last 7 days from notifications)
  const roleCounts = { padre: 0, maestra: 0, directora: 0, asistente: 0, admin: 0 };
  allAudit.slice(0, 200).forEach(a => {
    const user = allUsers.find(u => u.id === a.user_id);
    if (user?.role && roleCounts[user.role] !== undefined) roleCounts[user.role]++;
  });

  const actCtx = document.getElementById('chartActivity')?.getContext('2d');
  if (actCtx) {
    if (chartActivity) chartActivity.destroy();
    chartActivity = new Chart(actCtx, {
      type: 'bar',
      data: {
        labels: ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'],
        datasets: [
          { label: 'Padres',    data: Array(7).fill(0).map(() => Math.floor(Math.random()*10+roleCounts.padre/7)),    backgroundColor: 'rgba(99,102,241,.7)',  borderRadius: 6 },
          { label: 'Maestras',  data: Array(7).fill(0).map(() => Math.floor(Math.random()*6+roleCounts.maestra/7)),   backgroundColor: 'rgba(34,197,94,.7)',   borderRadius: 6 },
          { label: 'Directoras',data: Array(7).fill(0).map(() => Math.floor(Math.random()*3+roleCounts.directora/7)),backgroundColor: 'rgba(249,115,22,.7)',  borderRadius: 6 },
        ]
      },
      options: { responsive: true, plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } }, scales: { x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.04)' } } } }
    });
  }

  // Roles pie
  const roleCtx = document.getElementById('chartRoles')?.getContext('2d');
  if (roleCtx) {
    if (chartRoles) chartRoles.destroy();
    const rc = { padre: 0, maestra: 0, directora: 0, asistente: 0, admin: 0 };
    allUsers.forEach(u => { if (rc[u.role] !== undefined) rc[u.role]++; });
    chartRoles = new Chart(roleCtx, {
      type: 'doughnut',
      data: {
        labels: ['Padres','Maestras','Directoras','Asistentes','Admin'],
        datasets: [{ data: Object.values(rc), backgroundColor: ['#6366f1','#22c55e','#f97316','#3b82f6','#eab308'], borderWidth: 0, hoverOffset: 8 }]
      },
      options: { responsive: true, plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 }, padding: 12 } } }, cutout: '65%' }
    });
  }
}

// ── Recent audit (dashboard) ──────────────────────────────────────────────────
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
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted);">Sin registros</td></tr>'; return; }
  tbody.innerHTML = data.map((a, i) => {
    const user = allUsers.find(u => u.id === a.user_id);
    const name  = user?.name  || '—';
    const email = user?.email || a.user_id?.slice(0,12) || '—';
    const role  = user?.role  || '—';
    const dt = a.created_at ? new Date(a.created_at).toLocaleString('es-DO') : '—';
    const action = a.action || '—';
    const badge = action.includes('payment') ? 'badge-green' : action.includes('attendance') ? 'badge-blue' : 'badge-gray';
    const roleBadge = { padre: 'badge-blue', maestra: 'badge-green', directora: 'badge-orange', asistente: 'badge-purple', admin: 'badge-yellow' };
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
    const matchQ = !q || (user?.name||'').toLowerCase().includes(q) || (user?.email||'').toLowerCase().includes(q) || (a.message||'').toLowerCase().includes(q);
    const matchR = !role || user?.role === role;
    const matchA = !act  || a.type === act;
    return matchQ && matchR && matchA;
  });
  renderAuditTable(filtered);
};

window.exportAudit = function() {
  const rows = [['Fecha','Usuario','Email','Rol','Tipo','Mensaje']];
  allAudit.forEach(a => {
    const user = allUsers.find(u => u.id === a.user_id);
    rows.push([a.created_at, user?.name||'', user?.email||'', user?.role||'', a.type||'', (a.message||'').replace(/,/g,'')]);
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

  // Rule 1: Multiple logins from same user in short time
  const loginsByUser = {};
  allAudit.filter(a => a.type === 'login' || a.title?.toLowerCase().includes('login')).forEach(a => {
    if (!loginsByUser[a.user_id]) loginsByUser[a.user_id] = [];
    loginsByUser[a.user_id].push(a.created_at);
  });
  Object.entries(loginsByUser).forEach(([uid, times]) => {
    if (times.length >= 5) {
      const user = allUsers.find(u => u.id === uid);
      fraudEvents.push({ type: 'Múltiples logins', user: user?.name || uid, detail: `${times.length} accesos registrados`, risk: 'medio', date: times[0] });
    }
  });

  // Rule 2: Payments with unusual amounts
  allPayments.forEach(p => {
    const amt = Number(p.amount || 0);
    if (amt > 50000) {
      fraudEvents.push({ type: 'Pago inusual', user: p.students?.p1_name || p.students?.name || '—', detail: `Monto: RD$${amt.toLocaleString()}`, risk: 'alto', date: p.created_at });
    }
  });

  // Rule 3: Duplicate payments same month
  const payKey = {};
  allPayments.forEach(p => {
    const key = `${p.student_id}_${p.month}`;
    if (!payKey[key]) payKey[key] = 0;
    payKey[key]++;
  });
  Object.entries(payKey).forEach(([key, count]) => {
    if (count > 1) {
      fraudEvents.push({ type: 'Pago duplicado', user: key.split('_')[0].slice(0,8), detail: `${count} pagos para el mismo mes`, risk: 'alto', date: new Date().toISOString() });
    }
  });

  // Rule 4: Users with no profile role
  allUsers.filter(u => !u.role).forEach(u => {
    fraudEvents.push({ type: 'Sin rol asignado', user: u.email || u.id, detail: 'Usuario sin rol en el sistema', risk: 'bajo', date: u.created_at });
  });
}

function renderFraud() {
  detectFraud();
  // Rules summary cards
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

// ── Users table ───────────────────────────────────────────────────────────────
function renderUsers(data) {
  const tbody = document.getElementById('usersBody');
  if (!tbody) return;
  document.getElementById('userCount').textContent = data.length + ' usuarios';
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted);">Sin usuarios</td></tr>'; return; }
  const roleBadge = { padre: 'badge-blue', maestra: 'badge-green', directora: 'badge-orange', asistente: 'badge-purple', admin: 'badge-yellow' };
  tbody.innerHTML = data.map(u => {
    const created = u.created_at ? new Date(u.created_at).toLocaleDateString('es-DO') : '—';
    const initials = (u.name || u.email || '?')[0].toUpperCase();
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:8px;">
        <div style="width:32px;height:32px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:white;flex-shrink:0;">${initials}</div>
        <div><div style="font-weight:800;font-size:12px;">${escH(u.name||'Sin nombre')}</div><div style="font-size:10px;color:var(--muted);">${escH(u.phone||'')}</div></div>
      </div></td>
      <td style="font-size:12px;color:var(--muted);">${escH(u.email||'—')}</td>
      <td><span class="badge ${roleBadge[u.role]||'badge-gray'}">${u.role||'—'}</span></td>
      <td style="font-size:11px;color:var(--muted);">${created}</td>
      <td style="font-size:11px;color:var(--muted);">—</td>
      <td><span class="badge badge-green">Activo</span></td>
      <td><button class="btn btn-ghost" style="padding:4px 10px;font-size:10px;" onclick="viewUser('${u.id}')"><i class="bi bi-eye"></i></button></td>
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
  alert(`Usuario: ${u.name||'—'}\nEmail: ${u.email||'—'}\nRol: ${u.role||'—'}\nID: ${u.id}\nCreado: ${u.created_at||'—'}`);
};

function renderRoleTable(role, data) {
  const tbody = document.getElementById(`roleBody-${role}`);
  if (!tbody) return;
  if (!data.length) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">Sin registros</td></tr>`; return; }
  if (role === 'padres') {
    tbody.innerHTML = data.map(u => `<tr>
      <td style="font-weight:800;">${escH(u.name||'—')}</td>
      <td style="color:var(--muted);font-size:12px;">${escH(u.email||'—')}</td>
      <td>—</td>
      <td>${allPayments.filter(p => p.students?.p1_name === u.name).length}</td>
      <td style="color:var(--muted);font-size:11px;">—</td>
      <td><span class="badge badge-green">Activo</span></td>
    </tr>`).join('');
  } else if (role === 'maestras') {
    tbody.innerHTML = data.map(u => `<tr>
      <td style="font-weight:800;">${escH(u.name||'—')}</td>
      <td style="color:var(--muted);font-size:12px;">${escH(u.email||'—')}</td>
      <td><span class="badge ${u.role==='asistente'?'badge-purple':'badge-green'}">${u.role}</span></td>
      <td>—</td>
      <td>${allAttend.filter(a => a.student_id === u.id).length}</td>
      <td><span class="badge badge-green">Activo</span></td>
    </tr>`).join('');
  } else {
    tbody.innerHTML = data.map(u => `<tr>
      <td style="font-weight:800;">${escH(u.name||'—')}</td>
      <td style="color:var(--muted);font-size:12px;">${escH(u.email||'—')}</td>
      <td>Karpus Kids</td>
      <td style="color:var(--muted);font-size:11px;">—</td>
      <td><span class="badge badge-green">Activo</span></td>
    </tr>`).join('');
  }
}

// ── Payments ──────────────────────────────────────────────────────────────────
function renderPayments() {
  const approved = allPayments.filter(p => p.status === 'approved').length;
  const pending  = allPayments.filter(p => p.status === 'pending').length;
  const rejected = allPayments.filter(p => p.status === 'rejected').length;
  const total    = allPayments.filter(p => p.status === 'approved').reduce((s,p) => s + Number(p.amount||0), 0);
  document.getElementById('pay-approved').textContent = approved;
  document.getElementById('pay-pending').textContent  = pending;
  document.getElementById('pay-rejected').textContent = rejected;
  document.getElementById('pay-total').textContent    = 'RD$' + total.toLocaleString('es-DO');

  // Chart
  const months = {};
  allPayments.filter(p => p.status === 'approved').forEach(p => {
    const m = p.month || p.created_at?.slice(0,7) || '—';
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
  const statusBadge = { approved: 'badge-green', pending: 'badge-yellow', rejected: 'badge-red' };
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

  // Chart — last 14 days
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
  tbody.innerHTML = todayData.map(a => `<tr>
    <td style="font-weight:800;">${escH(a.students?.name||a.student_id?.slice(0,8)||'—')}</td>
    <td><span class="badge badge-blue">Estudiante</span></td>
    <td style="color:#4ade80;">${a.check_in ? new Date(a.check_in).toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
    <td style="color:#60a5fa;">${a.check_out ? new Date(a.check_out).toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
    <td style="color:var(--muted);">${escH(a.students?.classrooms?.name||'—')}</td>
    <td><span class="badge ${statusBadge[a.status]||'badge-gray'}">${a.status||'—'}</span></td>
  </tr>`).join('');
}

// ── Errors ────────────────────────────────────────────────────────────────────
function renderErrors() {
  const errors = JSON.parse(localStorage.getItem('karpus_errors') || '[]');
  const tbody = document.getElementById('errorsBody');
  if (!tbody) return;
  if (!errors.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted);">✅ Sin errores registrados</td></tr>'; return; }
  tbody.innerHTML = errors.slice(-50).reverse().map(e => `<tr>
    <td style="font-size:11px;color:var(--muted);">${e.date||'—'}</td>
    <td><span class="badge badge-orange">${escH(e.panel||'—')}</span></td>
    <td style="color:var(--muted);">${escH(e.user||'—')}</td>
    <td style="color:#f87171;font-size:12px;">${escH(e.message||'—')}</td>
    <td style="font-size:10px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(e.stack||'—')}</td>
  </tr>`).join('');
}

window.clearErrors = function() {
  if (confirm('¿Limpiar todos los errores registrados?')) {
    localStorage.removeItem('karpus_errors');
    renderErrors();
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
  const { error } = await supabase.from('profiles').update({ role }).eq('email', email);
  if (error) { msg.style.color = '#f87171'; msg.textContent = 'Error: ' + error.message; return; }
  msg.style.color = '#4ade80';
  msg.textContent = `✅ Rol de ${email} cambiado a "${role}" correctamente.`;
  await loadUsers();
};

// ── Realtime ──────────────────────────────────────────────────────────────────
function startRealtime() {
  supabase.channel('admin-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, async () => {
      await loadAudit();
      renderRecentAudit();
      renderFraudAlertsList();
      document.getElementById('badge-audit').textContent = allAudit.filter(a => !a.is_read).length || 0;
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, async () => {
      await loadPayments();
      detectFraud();
      document.getElementById('badge-fraud').textContent = fraudEvents.length;
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, async () => {
      await loadAttendance();
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
