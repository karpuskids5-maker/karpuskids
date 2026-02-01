import { supabase } from './supabase.js';

const AppState = {
  user: null,
  profile: null,
  student: null,
  tasks: []
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
  if (window.lucide) lucide.createIcons();
  if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register('./sw.js'); } catch(e){} }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }
  AppState.user = user;

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (profile) {
    document.querySelectorAll('.guardian-name-display').forEach(el => el.textContent = profile.name || 'Familia');
    await loadStudentData();
  }

  const navButtons = document.querySelectorAll('[data-target]');
  const sections = document.querySelectorAll('.section');
  
  function setActiveSection(targetId) {
    sections.forEach(sec => { sec.classList.add('hidden'); sec.classList.remove('active'); });
    navButtons.forEach(btn => btn.classList.remove('active'));
    
    const targetSection = document.getElementById(targetId);
    if (targetSection) { targetSection.classList.remove('hidden'); targetSection.classList.add('active'); }
    
    if (targetId === 'home') loadDashboard();
    if (targetId === 'live-attendance') loadAttendance();
    if (targetId === 'tasks') loadTasks();
    if (targetId === 'class') loadClassFeed();
    if (targetId === 'grades') loadGrades();
    if (targetId === 'payments') loadPayments();
    if (targetId === 'notifications') loadNotifications();
    if (targetId === 'profile') populateProfile();

    const targetBtn = document.querySelector(`button[data-target="${targetId}"]`);
    if (targetBtn) targetBtn.classList.add('active');
    if (navigator.vibrate) navigator.vibrate(20);
  }

  navButtons.forEach(btn => btn.addEventListener('click', () => setActiveSection(btn.dataset.target)));
  
  const headerAvatar = document.getElementById('headerAvatar');
  if (headerAvatar) headerAvatar.addEventListener('click', () => setActiveSection('profile'));
  
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', async () => { await supabase.auth.signOut(); window.location.href = 'login.html'; });

  const dateDisplay = document.getElementById('currentDateDisplay');
  if (dateDisplay) dateDisplay.textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  setActiveSection('home');
  initAbsenceModule();
  
  const taskFilters = document.querySelectorAll('.task-filter-btn');
  taskFilters.forEach(btn => {
    btn.addEventListener('click', (e) => {
      taskFilters.forEach(b => { b.classList.remove('bg-white', 'shadow', 'text-slate-700', 'font-bold'); b.classList.add('text-slate-500', 'font-medium'); });
      e.target.classList.remove('text-slate-500', 'font-medium'); e.target.classList.add('bg-white', 'shadow', 'text-slate-700', 'font-bold');
      loadTasks(e.target.dataset.filter);
    });
  });

  initTaskSubmissionModule();
  setupProfilePhotoUpload();
  initNotifications();
});

function initAbsenceModule() {
  const btnQuick = document.getElementById('btnQuickAbsence');
  const modal = document.getElementById('modalAbsence');
  const btnClose = document.getElementById('btnCloseAbsence');
  const form = document.getElementById('formAbsence');

  if (btnQuick) btnQuick.addEventListener('click', () => {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('absenceDate');
    if (dateInput) dateInput.value = today;
    modal.classList.remove('hidden');
  });

  if (btnClose) btnClose.addEventListener('click', () => modal.classList.add('hidden'));

  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = document.getElementById('absenceDate').value;
    const reason = document.getElementById('absenceReason').value;
    const note = document.getElementById('absenceNote').value;
    
    if (!AppState.student?.id) { Helpers.toast('Error: No se identificó al estudiante', 'error'); return; }

    try {
      const { error } = await supabase.from('attendance_requests').insert({
        student_id: AppState.student.id, date, reason, note, status: 'pending'
      });
      if (error) throw error;
      Helpers.toast(`Reporte enviado para el día ${date}`, 'success');
      modal.classList.add('hidden'); form.reset();
    } catch (err) { console.error(err); Helpers.toast('Error al enviar el reporte', 'error'); }
  });
}

async function loadStudentData() {
  const { data, error } = await supabase.from('students').select('*, classrooms(name,level)').eq('parent_id', AppState.user.id).limit(1).maybeSingle();
  if (error || !data) {
    Helpers.toast('No hay estudiante vinculado', 'info');
    document.querySelectorAll('.student-name-display').forEach(el => el.textContent = 'No asignado');
    return;
  }
  AppState.student = data;
  document.querySelectorAll('.student-name-display').forEach(el => el.textContent = data.name);
  document.querySelectorAll('.classroom-name-display').forEach(el => el.textContent = `${data.classrooms?.name || 'Sin aula'} • ${data.classrooms?.level || ''}`);
  const sb = document.getElementById('sidebar-student-name'); if (sb) sb.textContent = data.name;
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
    const da = document.getElementById('dashAttendance'); if (da) da.textContent = `${percent}%`;
    
    const classroomId = AppState.student.classroom_id;
    const { count: pendingCount } = await supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('classroom_id', classroomId).gte('due_date', new Date().toISOString().split('T')[0]);
    const { count: deliveredCount } = await supabase.from('task_evidences').select('*', { count: 'exact', head: true }).eq('student_id', sid);

    const dp = document.getElementById('dashPendingTasks'); if (dp) dp.textContent = String(pendingCount || 0);
    const dd = document.getElementById('dashDeliveredTasks'); if (dd) dd.textContent = String(deliveredCount || 0);
  } catch (err) { console.error(err); }
}

async function loadAttendance() {
  const grid = document.getElementById('calendarGrid');
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
      start = new Date(current); start.setDate(current.getDate() - diffToMonday);
      end = new Date(start); end.setDate(start.getDate() + 6);
    } else {
      start = new Date(current.getFullYear(), current.getMonth(), 1);
      end = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    }
    const { data } = await supabase.from('attendance').select('date,status').eq('student_id', sid).gte('date', start.toISOString().split('T')[0]).lte('date', end.toISOString().split('T')[0]);
    const map = new Map((data || []).map(a => [a.date, a.status]));
    const days = filter === 'semana' ? 7 : end.getDate();
    let present = 0, late = 0, absent = 0, html = '';
    for (let i = 0; i < days; i++) {
      const dateObj = filter === 'semana' ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + i) : new Date(current.getFullYear(), current.getMonth(), i + 1);
      const key = dateObj.toISOString().split('T')[0];
      const st = map.get(key);
      let bg = 'bg-sky-50', tx = 'text-slate-600';
      if (st === 'present') { bg = 'bg-emerald-100'; tx = 'text-emerald-700 font-semibold'; present++; }
      else if (st === 'absent') { bg = 'bg-rose-100'; tx = 'text-rose-700 font-semibold'; absent++; }
      else if (st === 'late') { bg = 'bg-amber-100'; tx = 'text-amber-700 font-semibold'; late++; }
      html += `<div class="${bg} ${tx} rounded-lg p-2 text-center text-sm aspect-square flex items-center justify-center">${filter === 'semana' ? dateObj.getDate() : (i + 1)}</div>`;
    }
    grid.innerHTML = html;
    document.getElementById('attPresent').textContent = String(present);
    document.getElementById('attLate').textContent = String(late);
    document.getElementById('attAbsent').textContent = String(absent);
  } catch (err) { console.error(err); grid.innerHTML = Helpers.emptyState('Error cargando asistencia'); }
}
document.addEventListener('change', (e) => { if (e.target?.id === 'attendanceFilter') loadAttendance(); });

async function loadTasks(filter = 'pending') {
  const list = document.getElementById('tasksList');
  if (!list) return;
  list.innerHTML = Helpers.skeleton(3, 'h-24');
  try {
    const s = AppState.student;
    if (!s) { list.innerHTML = Helpers.emptyState('Sin tareas'); return; }
    const { data: tasks } = await supabase.from('tasks').select('*').eq('classroom_id', s.classroom_id).order('due_date');
    AppState.tasks = tasks || [];
    const { data: evidences } = await supabase.from('task_evidences').select('*').eq('student_id', s.id);
    const evidenceMap = new Map((evidences || []).map(e => [e.task_id, e]));
    
    const filteredTasks = (tasks || []).filter(t => {
      const isDelivered = evidenceMap.has(t.id);
      return filter === 'pending' ? !isDelivered : isDelivered;
    });

    if (!filteredTasks.length) { list.innerHTML = Helpers.emptyState(filter === 'pending' ? '¡Todo al día!' : 'No hay entregas.'); return; }
    
    list.innerHTML = filteredTasks.map(t => {
      const due = t.due_date ? new Date(t.due_date) : null;
      const ev = evidenceMap.get(t.id);
      const st = ev ? 'Entregada' : (due && due < new Date() ? 'Atrasada' : 'Pendiente');
      const stCls = st === 'Entregada' ? 'bg-emerald-100 text-emerald-700' : (st === 'Atrasada' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700');
      const grade = ev?.grade_letter ? `<span class="bg-pink-100 text-pink-700 px-2 py-1 rounded text-xs font-bold">${ev.grade_letter}</span>` : '';
      const stars = ev?.stars ? `<div class="flex">${[1,2,3,4,5].map(n => `<i data-lucide="star" class="w-3 h-3 ${n<=ev.stars?'text-yellow-500':'text-slate-300'}"></i>`).join('')}</div>` : '';
      
      return `
      <div class="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-lg transition">
        <div class="flex justify-between items-start">
          <div><h4 class="font-bold text-slate-800">${t.title}</h4><p class="text-xs text-slate-500">${s.classrooms?.level || ''}</p></div>
          <span class="px-3 py-1 rounded-full text-xs font-bold ${stCls}">${st}</span>
        </div>
        <p class="text-sm text-slate-600 mt-2">${t.description || ''}</p>
        <div class="mt-2 text-xs text-slate-500">Entrega: ${due ? due.toLocaleDateString() : '-'}</div>
        <div class="mt-3 flex items-center justify-between">
          <button class="px-4 py-2 bg-sky-400 text-white rounded-xl text-xs font-bold hover:bg-sky-500 transition" onclick="openTaskDetail('${t.id}')">Ver / Entregar</button>
          <div class="flex gap-2 items-center">${grade}${stars}</div>
        </div>
      </div>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
  } catch (err) { console.error(err); list.innerHTML = Helpers.emptyState('Error cargando tareas'); }
}

async function loadClassFeed() {
  const container = document.getElementById('classFeed');
  if (!container) return;
  container.innerHTML = Helpers.skeleton(3, 'h-32');
  try {
    const cid = AppState.student?.classroom_id;
    if (!cid) { container.innerHTML = Helpers.emptyState('Sin aula asignada'); return; }
    const { data: posts } = await supabase.from('posts').select('*, profiles:teacher_id(name,avatar_url)').eq('classroom_id', cid).order('created_at', { ascending: false });
    if (!posts?.length) { container.innerHTML = Helpers.emptyState('No hay publicaciones'); return; }
    
    container.innerHTML = posts.map(p => `
      <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100 mb-4">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-bold">${p.profiles?.name?.charAt(0) || 'D'}</div>
          <div><p class="font-bold text-slate-800 text-sm">${p.profiles?.name || 'Docente'}</p><p class="text-xs text-slate-500">${new Date(p.created_at).toLocaleDateString()}</p></div>
        </div>
        <p class="text-sm text-slate-700 mb-3">${p.content || ''}</p>
        ${p.media_url ? `<img src="${p.media_url}" class="w-full rounded-xl mb-3 object-cover max-h-64">` : ''}
      </div>
    `).join('');
  } catch (err) { console.error(err); container.innerHTML = Helpers.emptyState('Error cargando muro'); }
}

async function loadGrades() {
  const c = document.getElementById('gradesList');
  if (!c) return;
  c.innerHTML = Helpers.skeleton(2);
  try {
    const sid = AppState.student?.id;
    const { data: grades } = await supabase.from('task_evidences').select('*, tasks(title)').eq('student_id', sid).not('grade_letter', 'is', null);
    if (!grades?.length) { c.innerHTML = Helpers.emptyState('Aún no hay calificaciones'); return; }
    c.innerHTML = grades.map(g => `
      <div class="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-100 mb-2">
        <div><h4 class="font-bold text-slate-700">${g.tasks?.title || 'Tarea'}</h4><p class="text-xs text-slate-500">${new Date(g.created_at).toLocaleDateString()}</p></div>
        <div class="text-right"><span class="text-lg font-bold text-pink-500">${g.grade_letter}</span><div class="flex">${[1,2,3,4,5].map(n => `<i data-lucide="star" class="w-3 h-3 ${n<=g.stars?'text-yellow-500':'text-slate-200'}"></i>`).join('')}</div></div>
      </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
  } catch (e) { c.innerHTML = Helpers.emptyState('Error'); }
}

async function loadPayments() {
  const c = document.getElementById('paymentsList');
  if(c) c.innerHTML = Helpers.emptyState('Módulo de pagos próximamente');
}

async function loadNotifications() {
  const c = document.getElementById('notifList');
  if(c) c.innerHTML = Helpers.emptyState('No hay notificaciones nuevas');
}

async function populateProfile() {
  if (!AppState.student) return;
  const s = AppState.student;
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '-'; };
  setText('profileStudentName', s.name);
  setText('profileStudentClass', s.classrooms?.name);
  
  // Mostrar foto si existe
  const preview = document.getElementById('studentAvatarPreview');
  if (preview && s.avatar_url) {
    preview.innerHTML = `<img src="${s.avatar_url}" class="w-full h-full object-cover">`;
  }
}

let currentTaskId = null;

function initTaskSubmissionModule() {
  const modal = document.getElementById('taskDetailModal');
  const btnClose = document.getElementById('btnCloseTaskDetail');
  const btnSubmit = document.getElementById('btnSubmitTask');
  const fileInput = document.getElementById('taskFileInput');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  
  if (btnClose) btnClose.addEventListener('click', () => modal.classList.add('hidden'));
  if (fileInput) fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) fileNameDisplay.textContent = e.target.files[0].name;
  });

  if (btnSubmit) btnSubmit.addEventListener('click', async () => {
    const file = fileInput.files[0];
    const comment = document.getElementById('taskCommentInput').value;
    
    if (!file && !comment) { Helpers.toast('Adjunta un archivo o escribe un comentario', 'info'); return; }
    
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Enviando...';
    
    try {
      let fileUrl = null;
      if (file) {
        const ext = file.name.split('.').pop();
        const fileName = `submissions/${AppState.student.id}_${currentTaskId}_${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('classroom_media').upload(fileName, file);
        if (upErr) throw upErr;
        const { data } = supabase.storage.from('classroom_media').getPublicUrl(fileName);
        fileUrl = data.publicUrl;
      }
      
      const { error } = await supabase.from('task_evidences').insert({
        task_id: currentTaskId,
        student_id: AppState.student.id,
        file_url: fileUrl,
        comment: comment,
        status: 'submitted'
      });
      
      if (error) throw error;
      
      Helpers.toast('Tarea entregada', 'success');
      showCompleteAnimation();
      modal.classList.add('hidden');
      loadTasks();
      loadDashboard();
      
    } catch (e) { console.error(e); Helpers.toast('Error al entregar', 'error'); } 
    finally { btnSubmit.disabled = false; btnSubmit.textContent = 'Enviar Tarea'; }
  });
}

window.openTaskDetail = async (id) => {
  currentTaskId = id;
  const modal = document.getElementById('taskDetailModal');
  const task = AppState.tasks.find(t => t.id == id);
  if (!task || !modal) return;
  
  document.getElementById('taskDetailTitle').textContent = task.title;
  document.getElementById('taskDetailDesc').textContent = task.description;
  
  const { data: ev } = await supabase.from('task_evidences').select('*').eq('task_id', id).eq('student_id', AppState.student.id).maybeSingle();
  
  const uploadSec = document.getElementById('uploadSection');
  const evidenceSec = document.getElementById('evidenceSection');
  
  if (ev) {
    uploadSec.classList.add('hidden');
    evidenceSec.classList.remove('hidden');
    document.getElementById('evidenceDate').textContent = new Date(ev.created_at).toLocaleDateString();
    document.getElementById('evidenceLink').href = ev.file_url || '#';
  } else {
    uploadSec.classList.remove('hidden');
    evidenceSec.classList.add('hidden');
    document.getElementById('taskFileInput').value = '';
    document.getElementById('fileNameDisplay').textContent = '';
    document.getElementById('taskCommentInput').value = '';
  }
  
  modal.classList.remove('hidden');
};

function showCompleteAnimation() {
  const el = document.createElement('div');
  el.className = 'fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm';
  el.innerHTML = `<div class="bg-white p-6 rounded-3xl shadow-2xl animate-bounce flex flex-col items-center"><div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-2"><i data-lucide="check" class="w-8 h-8"></i></div><h3 class="font-bold text-xl text-slate-800">¡Tarea Enviada!</h3><p class="text-slate-500">Sigue así 🌟</p></div>`;
  document.body.appendChild(el);
  if (window.lucide) lucide.createIcons();
  setTimeout(() => el.remove(), 2000);
}

function setupProfilePhotoUpload() {
  const input = document.getElementById('studentAvatarInput');
  const preview = document.getElementById('studentAvatarPreview');
  if (!input || !preview) return;
  
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const oldHtml = preview.innerHTML;
    preview.innerHTML = `<div class="animate-spin rounded-full h-6 w-6 border-b-2 border-sky-500"></div>`;
    try {
      if (!AppState.student?.id) throw new Error('No hay estudiante');
      const ext = file.name.split('.').pop();
      const fileName = `avatars/${AppState.student.id}_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('classroom_media').upload(fileName, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('classroom_media').getPublicUrl(fileName);
      await supabase.from('students').update({ avatar_url: publicUrl }).eq('id', AppState.student.id);
      preview.innerHTML = `<img src="${publicUrl}" class="w-full h-full object-cover">`;
      Helpers.toast('Foto actualizada', 'success');
      AppState.student.avatar_url = publicUrl;
    } catch (e) { console.error(e); Helpers.toast('Error al subir', 'error'); preview.innerHTML = oldHtml; }
  });
}

function initNotifications() {
  if ('Notification' in window && Notification.permission !== 'granted') Notification.requestPermission();
  if (!AppState.student?.classroom_id) return;
  supabase.channel('tasks-notif').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: `classroom_id=eq.${AppState.student.classroom_id}` }, (payload) => {
    Helpers.toast(`Nueva tarea: ${payload.new.title}`, 'info');
    if (Notification.permission === 'granted') new Notification('Nueva Tarea', { body: payload.new.title, icon: '/logo/favicon.ico' });
    loadTasks(); loadDashboard();
  }).subscribe();
}
