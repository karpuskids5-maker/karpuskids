import { supabase } from './supabase.js';

const AppState = {
  user: null,
  profile: null,
  student: null
};

const Helpers = {
  toast: (m, t = 'success') => {
    const e = document.createElement('div');
    const map = { success: 'bg-emerald-400', error: 'bg-rose-400', info: 'bg-sky-400' };
    const c = map[t] || map.info;
    e.className = `fixed bottom-6 right-6 ${c} text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2 z-50 transition-all`;
    e.innerHTML = `<span class="text-sm font-semibold">${m}</span>`;
    document.body.appendChild(e);
    setTimeout(() => { e.style.opacity = '0'; e.style.transform = 'translateY(16px)'; setTimeout(() => e.remove(), 300); }, 2800);
  },
  emptyState: (msg) => `<div class="text-center py-12 text-slate-400"><div class="mx-auto mb-4 w-14 h-14 text-sky-300">🙂</div><p class="text-sm font-medium">${msg}</p></div>`,
  skeleton: (n = 3, h = 'h-16') => Array(n).fill(0).map(() => `<div class="animate-pulse bg-sky-100/60 rounded-2xl ${h} w-full mb-3"></div>`).join('')
};

document.addEventListener('DOMContentLoaded', async () => {
  // Inicializar iconos Lucide
  if (window.lucide) lucide.createIcons();

  // --- 1. Verificación de Sesión ---
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  AppState.user = user;

  // Obtener perfil del padre
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profile) {
    // Actualizar nombre en la UI
    document.querySelectorAll('.guardian-name-display').forEach(el => {
      el.textContent = profile.name || 'Familia';
    });
    
    // Cargar datos del estudiante asociado
    await loadStudentData();
  }

  // --- 2. Navegación Sidebar ---
  const navButtons = document.querySelectorAll('[data-target]');
  const sections = document.querySelectorAll('.section');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const menuBtn = document.getElementById('menuBtn');

  function setActiveSection(targetId) {
    // Ocultar todas las secciones
    sections.forEach(sec => {
      sec.classList.add('hidden');
      sec.classList.remove('active');
    });

    // Desactivar todos los botones
    navButtons.forEach(btn => {
      btn.classList.remove('active');
    });

    // Mostrar sección seleccionada
    const targetSection = document.getElementById(targetId);
    if (targetSection) {
      targetSection.classList.remove('hidden');
      targetSection.classList.add('active');
    }
    if (targetId === 'home') loadDashboard();
    if (targetId === 'home') showFloatingNotifications();
    if (targetId === 'live-attendance') loadAttendance();
    if (targetId === 'tasks') loadTasks();
    if (targetId === 'class') loadClassFeed();
    if (targetId === 'grades') loadGrades();
    if (targetId === 'payments') loadPayments();
    if (targetId === 'notifications') loadNotifications();
    if (targetId === 'profile') populateProfile();

    // Activar botón seleccionado
    const targetBtn = document.querySelector(`button[data-target="${targetId}"]`);
    if (targetBtn) {
      targetBtn.classList.add('active');
    }

    // En modo "App" (barra inferior), no necesitamos cerrar el sidebar automáticamente
    // ya que siempre debe estar visible abajo.
  }

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      setActiveSection(target);
    });
  });

  const headerAvatar = document.getElementById('headerAvatar');
  if (headerAvatar) {
    headerAvatar.addEventListener('click', () => {
      setActiveSection('profile');
    });
  }

  // --- 3. Sidebar Móvil ---
  // NOTA: Con el nuevo diseño de barra inferior, estas funciones de toggle ya no se usan en móvil,
  // pero se mantienen por si se requiere compatibilidad o para el overlay en desktop si aplica.
  function openSidebar() {
    sidebar.classList.remove('-translate-x-full');
    overlay.classList.remove('hidden');
  }

  function closeSidebar() {
    sidebar.classList.add('-translate-x-full');
    overlay.classList.add('hidden');
  }

  // Desactivamos los listeners del menú hamburguesa si ya no se usa en el diseño de barra inferior
  // if (menuBtn) menuBtn.addEventListener('click', openSidebar);
  // if (overlay) overlay.addEventListener('click', closeSidebar);

  // --- 4. Logout ---
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      await supabase.auth.signOut();
      window.location.href = 'login.html';
    });
  }

  // --- 5. Fecha Actual ---
  const dateDisplay = document.getElementById('currentDateDisplay');
  if (dateDisplay) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const today = new Date();
    dateDisplay.textContent = today.toLocaleDateString('es-ES', options);
  }
  
  setActiveSection('home');
});

async function loadStudentData() {
  const { data, error } = await supabase
    .from('students')
    .select('*, classrooms(name,level)')
    .eq('parent_id', AppState.user.id)
    .single();

  if (error || !data) {
    Helpers.toast('No hay estudiante vinculado', 'info');
    document.querySelectorAll('.student-name-display').forEach(el => el.textContent = 'No asignado');
    return;
  }

  AppState.student = data;

  document.querySelectorAll('.student-name-display')
    .forEach(el => el.textContent = data.name);

  document.querySelectorAll('.classroom-name-display')
    .forEach(el => el.textContent =
      `${data.classrooms?.name || 'Sin aula'} • ${data.classrooms?.level || ''}`
    );

  const sb = document.getElementById('sidebar-student-name');
  if (sb) sb.textContent = data.name;

  loadDashboard();
}

async function loadDashboard() {
  try {
    const sid = AppState.student?.id;
    if (!sid) return;

    const { data: att } = await supabase.from('attendance').select('status').eq('student_id', sid);
    const total = (att || []).length;
    const present = (att || []).filter(a => a.status === 'present' || a.status === 'late').length;
    const percent = total ? Math.round((present / total) * 100) : 0;
    const da = document.getElementById('dashAttendance');
    if (da) da.textContent = `${percent}%`;
    
    const classroomId = AppState.student.classroom_id;
    const { count } = await supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('classroom_id', classroomId).gte('due_date', new Date().toISOString());
    const dp = document.getElementById('dashPendingTasks'); if (dp) dp.textContent = String(count || 0);
  } catch {}
}

async function loadAttendance() {
  const grid = document.getElementById('calendarGrid');
  const pEl = document.getElementById('attPresent');
  const lEl = document.getElementById('attLate');
  const aEl = document.getElementById('attAbsent');
  if (!grid) return;
  grid.innerHTML = Helpers.skeleton(5, 'h-10');
  try {
    const sid = AppState.student?.id;
    if (!sid) { grid.innerHTML = Helpers.emptyState('Sin datos'); return; }

    const current = new Date();
    const filter = document.getElementById('attendanceFilter')?.value || 'mes';
    let start, end;
    if (filter === 'semana') {
      const day = current.getDay();
      const diffToMonday = (day + 6) % 7;
      start = new Date(current);
      start.setDate(current.getDate() - diffToMonday);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
    } else {
      start = new Date(current.getFullYear(), current.getMonth(), 1);
      end = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    }
    const { data } = await supabase.from('attendance')
      .select('date,status')
      .eq('student_id', sid)
      .gte('date', start.toISOString().split('T')[0])
      .lte('date', end.toISOString().split('T')[0]);
    const map = new Map((data || []).map(a => [a.date, a.status]));
    const days = filter === 'semana' ? 7 : end.getDate();
    let present = 0, late = 0, absent = 0;
    let html = '';
    for (let i = 0; i < days; i++) {
      const dateObj = filter === 'semana' ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + i) : new Date(current.getFullYear(), current.getMonth(), i + 1);
      const key = dateObj.toISOString().split('T')[0];
      const st = map.get(key);
      let bg = 'bg-sky-50', tx = 'text-slate-600';
      if (st === 'present') { bg = 'bg-emerald-100'; tx = 'text-emerald-700 font-semibold'; present++; }
      else if (st === 'absent') { bg = 'bg-rose-100'; tx = 'text-rose-700 font-semibold'; absent++; }
      else if (st === 'late') { bg = 'bg-amber-100'; tx = 'text-amber-700 font-semibold'; late++; }
      const dayNum = filter === 'semana' ? dateObj.getDate() : (i + 1);
      html += `<div class="${bg} ${tx} rounded-lg p-2 text-center text-sm transition-colors flex items-center justify-center aspect-square">${dayNum}</div>`;
    }
    grid.innerHTML = html;
    if (pEl) pEl.textContent = String(present);
    if (lEl) lEl.textContent = String(late);
    if (aEl) aEl.textContent = String(absent);
  } catch { grid.innerHTML = Helpers.emptyState('Error cargando asistencia'); }
}

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'attendanceFilter') {
    loadAttendance();
  }
});

async function loadTasks() {
  const list = document.getElementById('tasksList');
  if (!list) return;
  list.innerHTML = Helpers.skeleton(3, 'h-24');
  try {
    const s = AppState.student;
    if (!s) { list.innerHTML = Helpers.emptyState('Sin tareas'); return; }

    const subject = s.classrooms?.level || 'General';
    const { data: tasks } = await supabase.from('tasks').select('*').eq('classroom_id', s.classroom_id).order('due_date');
    const { data: evidences } = await supabase.from('task_evidences').select('task_id').eq('student_id', s.id);
    const delivered = new Set((evidences || []).map(e => e.task_id));
    if (!tasks || !tasks.length) { list.innerHTML = Helpers.emptyState('No hay tareas'); return; }
    list.innerHTML = tasks.map(t => {
      const due = t.due_date ? new Date(t.due_date) : null;
      const now = new Date();
      const st = delivered.has(t.id) ? 'Entregada' : (due && due < now ? 'Atrasada' : 'Pendiente');
      const stCls = st === 'Entregada' ? 'bg-emerald-100 text-emerald-700' : (st === 'Atrasada' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700');
      const dueTxt = due ? due.toLocaleDateString() : '-';
      return `<div class="card-clean p-4">
        <div class="flex justify-between items-start">
          <div>
            <h4 class="font-bold text-[#1E293B]">${t.title}</h4>
            <p class="text-xs text-slate-500">${subject}</p>
          </div>
          <span class="px-3 py-1 rounded-full text-xs font-bold ${stCls}">${st}</span>
        </div>
        <p class="text-sm text-[#1E293B]/70 mt-2">${t.description || ''}</p>
        <div class="mt-2 text-xs text-slate-500">Entrega: ${dueTxt}</div>
        <div class="mt-3 flex gap-2">
          <button class="px-4 py-2 rounded-xl bg-sky-400 text-white text-xs font-semibold hover:bg-sky-500 transition">Ver detalle</button>
        </div>
      </div>`;
    }).join('');
  } catch { list.innerHTML = Helpers.emptyState('Error cargando tareas'); }
}

async function loadClassFeed() {
  const container = document.getElementById('classFeed');
  if (!container) return;
  container.innerHTML = Helpers.skeleton(3, 'h-32');
  try {
    const classroomId = AppState.student?.classroom_id;
    if (!classroomId) { container.innerHTML = Helpers.emptyState('Sin aula asignada'); return; }

    const { data: posts } = await supabase.from('posts').select('*, profiles:teacher_id(name,avatar_url)').eq('classroom_id', classroomId).order('created_at', { ascending: false });
    if (!posts || !posts.length) { container.innerHTML = Helpers.emptyState('No hay publicaciones'); return; }
    const { data: likes } = await supabase.from('likes').select('post_id,user_id').in('post_id', posts.map(p=>p.id));
    const { data: comments } = await supabase.from('comments').select('post_id,content,created_at, profiles:user_id(name,avatar_url)').in('post_id', posts.map(p=>p.id)).order('created_at', { ascending: true });
    const { data: { user } } = await supabase.auth.getUser();
    const likeMap = new Map();
    (likes||[]).forEach(l => {
      const arr = likeMap.get(l.post_id) || [];
      arr.push(l);
      likeMap.set(l.post_id, arr);
    });
    const commentMap = new Map();
    (comments||[]).forEach(c => {
      const arr = commentMap.get(c.post_id) || [];
      arr.push(c);
      commentMap.set(c.post_id, arr);
    });
    container.innerHTML = posts.map(p => {
      const postLikes = likeMap.get(p.id) || [];
      const youLike = !!postLikes.find(l => l.user_id === user.id);
      const postComments = commentMap.get(p.id) || [];
      const avatarEl = p.profiles?.avatar_url ? `<img src="${p.profiles.avatar_url}" class="w-10 h-10 rounded-full object-cover" alt="${p.profiles?.name||''}" onerror="this.src='img/mundo.jpg'">` : `<div class="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center text-sky-700 font-bold">${p.profiles?.name?.charAt(0) || 'D'}</div>`;
      return `
      <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-4 mb-4" data-post="${p.id}">
        <div class="flex items-center gap-3 mb-4">
          <div class="relative">
            ${avatarEl}
            <div class="absolute -bottom-1 -right-1 bg-green-500 w-3 h-3 rounded-full border-2 border-white"></div>
          </div>
          <div>
            <p class="font-bold text-slate-800 text-sm">${p.profiles?.name || 'Docente'}</p>
            <p class="text-xs text-slate-500">${new Date(p.created_at).toLocaleDateString()} • Muro de Clase</p>
          </div>
        </div>
        <p class="text-sm text-slate-700 mb-4 leading-relaxed">${p.content || ''}</p>
        ${p.media_url ? `<div class="mb-4 rounded-xl overflow-hidden border border-slate-100"><img src="${p.media_url}" class="w-full object-cover max-h-80" alt="Media"></div>` : ''}
        <div class="flex items-center justify-between pt-3 border-t border-slate-50">
          <button class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${youLike ? 'bg-pink-50 text-pink-600' : 'hover:bg-slate-50 text-slate-600'}" data-action="like" data-post="${p.id}">
            <i data-lucide="heart" class="w-4 h-4 ${youLike ? 'fill-current' : ''}"></i> ${postLikes.length} Likes
          </button>
          <span class="text-xs text-slate-500 flex items-center gap-1"><i data-lucide="message-circle" class="w-4 h-4"></i> ${postComments.length} comentarios</span>
        </div>
        <div class="mt-3 space-y-2">
          ${postComments.slice(-3).map(c => `
            <div class="flex items-start gap-2">
              ${c.profiles?.avatar_url ? `<img src="${c.profiles.avatar_url}" class="w-8 h-8 rounded-full object-cover" onerror="this.src='img/mundo.jpg'">` : `<div class="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 text-xs">${c.profiles?.name?.charAt(0) || 'P'}</div>`}
              <div class="bg-slate-50 rounded-xl px-3 py-2">
                <p class="text-xs font-semibold text-slate-700">${c.profiles?.name || 'Padre'}</p>
                <p class="text-sm text-slate-700">${c.content}</p>
              </div>
            </div>
          `).join('')}
          <div class="flex items-center gap-2">
            <input type="text" class="flex-1 border rounded-xl px-3 py-2 text-sm" placeholder="Escribe un comentario..." data-post-input="${p.id}">
            <button class="px-3 py-2 rounded-xl bg-sky-500 text-white text-xs font-semibold" data-action="comment" data-post="${p.id}">Comentar</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch { container.innerHTML = Helpers.emptyState('Error cargando muro'); }
}

document.addEventListener('click', async (e) => {
  const likeBtn = e.target.closest('[data-action="like"]');
  if (likeBtn) {
    const postId = Number(likeBtn.dataset.post);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: existing } = await supabase.from('likes').select('id').eq('post_id', postId).eq('user_id', user.id).limit(1);
    if (existing && existing.length) {
      await supabase.from('likes').delete().eq('id', existing[0].id);
    } else {
      await supabase.from('likes').insert({ post_id: postId, user_id: user.id });
    }
    loadClassFeed();
    return;
  }
  const commentBtn = e.target.closest('[data-action="comment"]');
  if (commentBtn) {
    const postId = Number(commentBtn.dataset.post);
    const input = document.querySelector(`[input][data-post-input="${postId}"]`) || document.querySelector(`[data-post-input="${postId}"]`);
    const content = input?.value?.trim();
    if (!content) return;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('comments').insert({ post_id: postId, user_id: user.id, content });
    input.value = '';
    loadClassFeed();
    return;
  }
});

async function loadGrades() {
  const container = document.getElementById('gradesContent');
  if (!container) return;
  container.innerHTML = Helpers.skeleton(3, 'h-16');
  try {
    const sid = AppState.student?.id;
    if (!sid) { container.innerHTML = Helpers.emptyState('Sin datos'); return; }

    const { data: grades } = await supabase.from('grades').select('*, profiles:teacher_id(name)').eq('student_id', sid).order('created_at', { ascending: false });
    if (!grades || !grades.length) { container.innerHTML = Helpers.emptyState('No hay calificaciones'); return; }
    const avgBySubject = {}; let totalSum = 0, totalCount = 0;
    grades.forEach(g => { if (typeof g.score === 'number') { totalSum += g.score; totalCount += 1; avgBySubject[g.subject] = avgBySubject[g.subject] || { sum: 0, count: 0 }; avgBySubject[g.subject].sum += g.score; avgBySubject[g.subject].count += 1; } });
    const generalAvg = totalCount ? (totalSum / totalCount).toFixed(2) : '-';
    container.innerHTML = `
      <div class="card-clean overflow-hidden">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 border-b">
            <tr>
              <th class="px-4 py-3 font-semibold text-slate-600">Materia</th>
              <th class="px-4 py-3 font-semibold text-slate-600">Periodo</th>
              <th class="px-4 py-3 font-semibold text-slate-600">Nota</th>
              <th class="px-4 py-3 font-semibold text-slate-600">Maestro</th>
              <th class="px-4 py-3 font-semibold text-slate-600">Fecha</th>
              <th class="px-4 py-3 font-semibold text-slate-600">Observación</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${grades.map(g => `
              <tr class="hover:bg-slate-50">
                <td class="px-4 py-3 font-medium text-slate-800">${g.subject}</td>
                <td class="px-4 py-3 text-slate-600">${g.period || '-'}</td>
                <td class="px-4 py-3 font-bold ${g.score >= 70 ? 'text-green-600' : 'text-red-600'}">${g.score}</td>
                <td class="px-4 py-3 text-slate-600">${g.profiles?.name || '-'}</td>
                <td class="px-4 py-3 text-slate-500 text-xs">${new Date(g.created_at).toLocaleDateString()}</td>
                <td class="px-4 py-3 text-slate-600">${g.teacher_comment || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="p-4 rounded-xl bg-sky-50">
          <p class="text-xs text-slate-600">Promedio General</p>
          <p class="text-xl font-bold text-slate-800">${generalAvg}</p>
        </div>
        <div class="p-4 rounded-xl bg-slate-50">
          <p class="text-xs text-slate-600 mb-2">Promedio por Materia</p>
          <div class="grid grid-cols-2 gap-2">
            ${Object.entries(avgBySubject).map(([s,v]) => `<div class="bg-white border rounded-lg p-2 text-xs flex items-center justify-between"><span class="text-slate-600">${s}</span><span class="font-bold text-slate-800">${(v.sum / v.count).toFixed(2)}</span></div>`).join('')}
          </div>
        </div>
      </div>
    `;
  } catch { container.innerHTML = Helpers.emptyState('Error cargando calificaciones'); }
}

async function loadPayments() {
  const container = document.getElementById('paymentsHistory');
  if (!container) return;
  container.innerHTML = Helpers.skeleton(3, 'h-20');
  try {
    const sid = AppState.student?.id;
    if (!sid) { container.innerHTML = Helpers.emptyState('Sin datos'); return; }

    const { data: payments } = await supabase.from('payments').select('*').eq('student_id', sid).order('created_at', { ascending: false });
    if (!payments || !payments.length) { container.innerHTML = Helpers.emptyState('No hay pagos'); return; }
    const balance = payments.filter(p => p.status === 'confirmado' || p.status === 'efectivo').reduce((acc, p) => acc + Number(p.amount || 0), 0);
    const bEl = document.getElementById('paymentsBalance'); if (bEl) bEl.textContent = `$${balance.toFixed(2)}`;
    const vEl = document.getElementById('paymentsVerification'); if (vEl) { const pending = payments.some(p => p.status === 'pendiente'); vEl.textContent = pending ? 'Pendiente' : 'Completado'; }
    container.innerHTML = payments.map(p => `
      <div class="card-clean p-4 flex justify-between items-center">
        <div>
          <p class="font-bold text-slate-800">$${p.amount}</p>
          <p class="text-xs text-slate-500">${new Date(p.created_at).toLocaleDateString()} • ${p.method}</p>
        </div>
        <span class="px-3 py-1 rounded-full text-xs font-bold ${
          p.status === 'confirmado' ? 'bg-emerald-100 text-emerald-700' : 
          (p.status === 'rechazado' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700')
        }">${p.status.toUpperCase()}</span>
        <div class="text-right">
          ${p.evidence_url ? `<a href="${p.evidence_url}" target="_blank" class="text-xs text-sky-600 underline">Comprobante</a>` : `<button class="text-xs text-sky-600 underline" onclick="printReceipt(${p.id})">Generar recibo</button>`}
        </div>
      </div>
    `).join('');
  } catch { container.innerHTML = Helpers.emptyState('Error cargando pagos'); }
}

async function loadNotifications() {
  const list = document.getElementById('notificationsList');
  if (!list) return;
  list.innerHTML = Helpers.skeleton(3, 'h-12');
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (!data || !data.length) { list.innerHTML = Helpers.emptyState('No hay notificaciones'); return; }
    list.innerHTML = data.map(n => {
      const typeCls = n.type === 'pago' ? 'bg-emerald-100 text-emerald-700' : (n.type === 'asistencia' ? 'bg-amber-100 text-amber-700' : (n.type === 'academica' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-700'));
      return `<div class="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex items-start justify-between">
        <div>
          <p class="font-semibold text-slate-800">${n.title}</p>
          <p class="text-sm text-slate-600">${n.message}</p>
          <p class="text-xs text-slate-500 mt-1">${new Date(n.created_at).toLocaleString()}</p>
        </div>
        <span class="px-3 py-1 rounded-full text-xs font-bold ${typeCls}">${n.type || 'general'}</span>
      </div>`;
    }).join('');
  } catch { list.innerHTML = Helpers.emptyState('Error cargando notificaciones'); }
}

const FloatingNotifs = {
  rendered: new Set(),
  container: null
};

async function showFloatingNotifications() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('notifications').select('*').eq('user_id', user.id).eq('is_read', false).order('created_at', { ascending: true });
    if (!data || !data.length) return;
    if (!FloatingNotifs.container) {
      const c = document.createElement('div');
      c.className = 'fixed bottom-24 right-6 md:bottom-6 md:right-6 flex flex-col gap-2 z-50';
      document.body.appendChild(c);
      FloatingNotifs.container = c;
    }
    data.forEach(n => {
      if (FloatingNotifs.rendered.has(n.id)) return;
      FloatingNotifs.rendered.add(n.id);
      const el = document.createElement('div');
      el.className = 'bg-white/95 backdrop-blur-sm border border-slate-200 shadow-xl rounded-2xl p-4 max-w-xs';
      const typeCls = n.type === 'pago' ? 'text-emerald-600' : (n.type === 'asistencia' ? 'text-amber-600' : (n.type === 'academica' ? 'text-sky-600' : 'text-slate-600'));
      el.innerHTML = `<p class="text-sm font-bold ${typeCls}">${n.title}</p><p class="text-sm text-slate-700">${n.message}</p><p class="text-xs text-slate-400 mt-1">${new Date(n.created_at).toLocaleString()}</p>`;
      el.addEventListener('click', async () => {
        await supabase.from('notifications').update({ is_read: true }).eq('id', n.id);
        el.remove();
        FloatingNotifs.rendered.delete(n.id);
      });
      FloatingNotifs.container.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '0.9';
      }, 10);
    });
  } catch {}
}

function populateProfile() {
  const s = AppState.student;
  if (!s) return;

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  const setImg = (id, url) => { const el = document.getElementById(id); if (el) el.src = url || ''; };
  
  setImg('profileStudentPhoto', s.avatar_url || '');
  setVal('inputStudentName', s.name || '');
  setVal('inputStudentBirth', s.start_date || '');
  setVal('inputStudentAddress', s.p1_address || '');
  setVal('profileFatherName', s.p1_name || '');
  setVal('profileFatherPhone', s.p1_phone || '');
  setVal('profileFatherEmail', s.p1_email || '');
  setVal('profileMotherName', s.p2_name || '');
  setVal('profileMotherPhone', s.p2_phone || '');
  setVal('profileMotherEmail', s.p2_email || '');
  setVal('profileTutorName', s.tutor_name || '');
  setVal('profileTutorPhone', s.tutor_phone || '');
  setVal('profileTutorRelation', s.tutor_relation || '');
  setImg('profilePickupPhoto', s.pickup_photo || '');
  setVal('profilePickupName', s.pickup_person_name || '');
  setVal('profilePickupPhone', s.pickup_person_phone || '');
  setVal('profilePickupRelation', s.pickup_person_relation || '');
}

document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'btnUploadStudentPhoto') {
    document.getElementById('uploadStudentPhotoInput')?.click();
  }
  
  if (e.target && e.target.id === 'btnSavePhoto') {
    const fileInput = document.getElementById('uploadStudentPhotoInput');
    const file = fileInput?.files[0];
    if (!file || !AppState.student) return;
    
    try {
      e.target.disabled = true;
      e.target.textContent = 'Subiendo...';
      const ext = file.name.split('.').pop();
      const fileName = `${AppState.student.id}/avatar.${ext}`;
      
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });
        
      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
      
      const { error: updateError } = await supabase
        .from('students')
        .update({ avatar_url: publicUrl })
        .eq('id', AppState.student.id);
        
      if (updateError) throw updateError;
      
      Helpers.toast('Foto actualizada correctamente', 'success');
      document.getElementById('profileStudentPhoto').src = publicUrl;
      e.target.classList.add('hidden');
    } catch (err) {
      console.error(err);
      Helpers.toast('Error al subir foto', 'error');
    } finally {
      e.target.disabled = false;
      e.target.textContent = 'Guardar Foto';
    }
  }

  if (e.target && e.target.id === 'btnSaveStudent') {
    const updates = {
      p1_address: document.getElementById('inputStudentAddress')?.value,
      start_date: document.getElementById('inputStudentBirth')?.value
    };
    const { error } = await supabase.from('students').update(updates).eq('id', AppState.student.id);
    if (error) Helpers.toast('Error al guardar', 'error');
    else Helpers.toast('Datos del estudiante guardados', 'success');
  }

  if (e.target && e.target.id === 'btnSaveGuardian') {
    const updates = {
      p1_name: document.getElementById('profileFatherName')?.value,
      p1_phone: document.getElementById('profileFatherPhone')?.value,
      p1_email: document.getElementById('profileFatherEmail')?.value,
      p2_name: document.getElementById('profileMotherName')?.value,
      p2_phone: document.getElementById('profileMotherPhone')?.value,
      p2_email: document.getElementById('profileMotherEmail')?.value,
      tutor_name: document.getElementById('profileTutorName')?.value,
      tutor_phone: document.getElementById('profileTutorPhone')?.value,
      tutor_relation: document.getElementById('profileTutorRelation')?.value,
      pickup_person_name: document.getElementById('profilePickupName')?.value,
      pickup_person_phone: document.getElementById('profilePickupPhone')?.value,
      pickup_person_relation: document.getElementById('profilePickupRelation')?.value
    };
    const { error } = await supabase.from('students').update(updates).eq('id', AppState.student.id);
    if (error) Helpers.toast('Error al guardar', 'error');
    else Helpers.toast('Datos del perfil guardados', 'success');
  }
});

document.getElementById('uploadStudentPhotoInput')?.addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('profileStudentPhoto').src = ev.target.result;
      document.getElementById('btnSavePhoto').classList.remove('hidden');
    };
    reader.readAsDataURL(e.target.files[0]);
  }
});

function printReceipt(id) {
  const w = window.open('', '_blank'); if (!w) return;
  w.document.write(`<html><head><title>Recibo</title><style>body{font-family: Nunito, sans-serif;padding:20px}</style></head><body><h3>Recibo de Pago</h3><p>ID: ${id}</p></body></html>`);
  w.document.close(); w.focus(); w.print(); w.close();
}
