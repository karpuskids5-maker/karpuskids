document.addEventListener('DOMContentLoaded', ()=>{
  if(!window.KarpusStore) return;
  if(window.lucide) lucide.createIcons();
  const selToCls = (v) => v==='pequenos' ? 'Pequeños' : v==='medianos' ? 'Medianos' : 'Grandes';
  const pickEl = (ids) => ids.map(id=> document.getElementById(id)).find(Boolean);

  const classSelect = document.getElementById('classroomSelectParent');
  let currentClass = selToCls(classSelect?.value || 'pequenos');
  
  // Elementos de las secciones
  const postsEl = document.getElementById('classFeed');
  const tasksEl = document.getElementById('tasksList');
  const notifEl = document.getElementById('notificationsList'); // Para el chat
  const generalFeedEl = document.getElementById('feed');
  
  // --- Avatar Menu ---
  const avatarMenuBtn = document.getElementById('avatarMenuBtn');
  const avatarDropdown = document.getElementById('avatarDropdown');
  const editProfileBtn = document.getElementById('editProfileBtn');

  // --- Navegación ---
  const tabButtons = document.querySelectorAll('.tab-btn');
  const sections = {
    home: document.getElementById('tab-home'),
    attendance: document.getElementById('tab-live-attendance'),
    class: document.getElementById('tab-class'),
    tasks: document.getElementById('tab-tasks'),
    notifications: document.getElementById('tab-notifications'),
    profile: document.getElementById('tab-profile'),
    mejora: document.getElementById('tab-mejora')
  };

  function showTab(name) {
    if (!name || !sections[name]) name = 'home'; // Default a home
    Object.values(sections).forEach(el => el?.classList.add('hidden'));
    sections[name]?.classList.remove('hidden');
    tabButtons.forEach(btn => {
      const isTarget = btn.dataset.tab === name;
      btn.classList.toggle('text-karpus-blue', isTarget);
      btn.classList.toggle('text-slate-500', !isTarget);
    });
    if(window.lucide) lucide.createIcons();
  }

  tabButtons.forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

  // --- Renderizado de Contenido ---
  function renderPosts(){
    if(!postsEl) return;
    const items = KarpusStore.getClassPosts(currentClass);
    postsEl.innerHTML = '';
    if (items.length === 0) {
        postsEl.innerHTML = `<p class="text-center text-sm text-slate-500 p-4">No hay publicaciones en esta aula todavía.</p>`;
    }
    items.forEach(p=>{
      const card = document.createElement('div');
      card.className = 'p-3 rounded-2xl bg-white border';
      const attachments = `
        ${p.photo ? `<img src="${p.photo}" class="w-full h-40 object-cover rounded-xl mt-2" />` : ''}
        ${p.video ? `<video controls class="w-full rounded-xl mt-2"><source src="${p.video}" type="video/mp4"></video>` : ''}
        ${p.docUrl ? `<a href="${p.docUrl}" target="_blank" class="inline-block mt-2 text-[11px] px-2 py-1 rounded-xl bg-slate-100">Documento (${p.docType||'archivo'})</a>` : ''}
      `;
      const comments = (p.comments||[]).map(c=>
        `<div class=\"text-[11px] text-slate-600\"><strong>${c.author}:</strong> ${c.text}</div>`
      ).join('');
      card.innerHTML = `<p class=\"text-sm\"><strong>${p.teacher}</strong> — ${p.text}</p>
        <p class=\"text-xs text-slate-500\">${p.date}</p>
        ${attachments}
        <div class=\"mt-2 flex items-center gap-2\">
          <button class=\"text-[11px] px-2 py-1 rounded-xl bg-karpus-orange text-white\" data-post-id=\"${p.id}\" data-action=\"like\">👍 ${p.reactions?.likes||0}</button>
          <button class=\"text-[11px] px-2 py-1 rounded-xl bg-slate-100\" data-post-id=\"${p.id}\" data-emoji=\"❤️\" data-action=\"react-emoji\">❤️ ${(p.reactions?.emoji||{})['❤️']||0}</button>
        </div>
        <div class=\"mt-2 space-y-1\">${comments}</div>
        <div class=\"mt-2 flex gap-2\">
          <input type=\"text\" class=\"flex-1 border rounded-xl px-2 py-1 text-[11px]\" placeholder=\"Añadir comentario\" data-post-id=\"${p.id}\" />
          <button class=\"text-[11px] px-2 py-1 rounded-xl bg-karpus-blue text-white\" data-post-id=\"${p.id}\" data-action=\"comment\">Comentar</button>
        </div>`;
      postsEl.appendChild(card);
    });
  }

  function renderTasks(){
    if(!tasksEl) return;
    const items = KarpusStore.getTasksForClass(currentClass);
    tasksEl.innerHTML = '';
    if (items.length === 0) {
        tasksEl.innerHTML = `<p class="text-center text-sm text-slate-500 p-4">No hay tareas asignadas.</p>`;
    }
    items.forEach(t=>{
      const card = document.createElement('div');
      card.className = 'p-3 rounded-2xl bg-white border flex items-center justify-between';
      const parentName = 'Juan Pérez'; // Simulación de padre
      const submission = t.submissions.find(s => s.parent === parentName);
      const gradeInfo = t.grades.find(g => g.student === parentName);

      let actionHtml = `<button data-task-id="${t.id}" data-task-title="${t.title}" class="submit-task-btn text-sm px-3 py-1 rounded-xl bg-karpus-green text-white">Entregar</button>`;

      if (gradeInfo && gradeInfo.grade) {
        actionHtml = `<div class="text-right"><p class="text-sm font-bold text-karpus-green">Calificación: ${gradeInfo.grade}/10</p><p class="text-xs text-slate-600">${gradeInfo.comment || 'Sin comentarios.'}</p></div>`;
      } else if (submission) {
        actionHtml = `<div class="text-sm px-3 py-1 rounded-xl bg-slate-200 text-slate-600 text-center">Entregado,<br>pendiente de calificar</div>`;
      }

      card.innerHTML = `<div>
        <p class=\"text-sm font-semibold\">${t.title}</p>
        <p class=\"text-xs text-slate-500\">Entrega: ${t.due}</p>
      </div>
      ${actionHtml}`;

      tasksEl.appendChild(card);
    });
  }

  function renderNotifications(){
    if(!notifEl) return;
    const items = KarpusStore.getNotificationsForClass(currentClass);
    notifEl.innerHTML = '';
    items.forEach(n=>{
      // En este panel, la sección de notificaciones se usa para el chat.
      // Esta función puede adaptarse para mostrar notificaciones en otro lugar si es necesario.
      const card = document.createElement('div');
      card.className = 'p-3 rounded-2xl bg-white border';
      card.innerHTML = `<p class=\"text-sm\">${n.text}</p>`;
      notifEl.appendChild(card);
    });
  }

  function renderGeneralFeed() {
    if (!generalFeedEl) return;
    const items = KarpusStore.getNotificationsForClass('General');
    generalFeedEl.innerHTML = '';
    items.forEach(n => {
      const card = document.createElement('div');
      card.className = 'p-4 rounded-3xl bg-slate-50 shadow-soft';
      card.innerHTML = `<div class='flex justify-between items-center mb-1'><h4 class='text-sm font-semibold'>${n.type}</h4><span class='text-xs text-slate-500'>${n.date}</span></div><p class='text-sm text-slate-700'>${n.text}</p>`;
      generalFeedEl.appendChild(card);
    });
  }

  // --- Gráfico de Asistencia Dinámico ---
  let attendanceChartInstance = null;
  function renderAttendanceChart(period = 'month') {
    const ctx = document.getElementById('attendanceChart')?.getContext('2d');
    if (!ctx) return;

    // Simulación de datos para diferentes periodos
    let labels, data;
    switch (period) {
      case 'week':
        labels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
        data = [1, 1, 0, 1, 1]; // 1=presente, 0=ausente
        break;
      case 'day':
        labels = ['Hoy'];
        data = [1];
        break;
      case 'month':
      default:
        labels = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'];
        data = [4, 5, 4, 3]; // Días presentes por semana
        break;
    }

    if (attendanceChartInstance) {
      attendanceChartInstance.destroy();
    }

    attendanceChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Asistencia',
          data: data,
          backgroundColor: 'rgba(255, 255, 255, 0.6)',
          borderColor: 'rgba(255, 255, 255, 0.9)',
          borderWidth: 1,
          borderRadius: 8,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { color: 'white' } }, x: { ticks: { color: 'white' } } }
      }
    });
  }

  // --- Modal de Perfil (Maestra/Directora) ---
  const modalProfileView = document.getElementById('modalProfileView');
  const closeProfileViewBtn = document.getElementById('closeProfileView');
  const openTeacherProfileBtn = document.getElementById('openTeacherProfileBtn');
  const openDirectorProfileBtn = document.getElementById('openDirectorProfileBtn');
  const sendMessageBtn = document.getElementById('sendMessageToProfile');

  function showProfileModal(profileData) {
    if (!modalProfileView || !profileData) return;
    
    document.getElementById('modalProfileTitle').textContent = `Perfil de ${profileData.role}`;
    document.getElementById('modalProfileName').textContent = profileData.name;
    document.getElementById('modalProfileRole').textContent = profileData.role;
    document.getElementById('modalProfileAvatar').src = profileData.avatar || 'https://placehold.co/200x200';
    document.getElementById('modalProfileBio').textContent = profileData.bio || 'No hay biografía disponible.';

    // Mostrar el botón de mensaje solo para la maestra
    if (sendMessageBtn) {
      const isTeacher = profileData.role === 'Maestra';
      sendMessageBtn.classList.toggle('hidden', !isTeacher);
    }

    modalProfileView.classList.remove('hidden');
  }

  openTeacherProfileBtn?.addEventListener('click', () => {
    const teacherProfile = KarpusStore.getTeacherProfile();
    showProfileModal({ ...teacherProfile, role: 'Maestra' });
  });

  openDirectorProfileBtn?.addEventListener('click', () => {
    const directorProfile = KarpusStore.getDirectorProfile();
    showProfileModal({ ...directorProfile, role: 'Directora' });
  });

  closeProfileViewBtn?.addEventListener('click', () => modalProfileView?.classList.add('hidden'));

  sendMessageBtn?.addEventListener('click', () => {
    modalProfileView?.classList.add('hidden');
    showTab('notifications');
    // Aquí se podría añadir lógica para pre-seleccionar el chat con la maestra
  });

  // Modal de entrega
  const modal = document.getElementById('modalSubmitTask');
  const btnClose = document.getElementById('closeSubmitTask');
  const btnSubmit = document.getElementById('submitTaskParent');
  const fileInput = document.getElementById('taskFile');
  const commentInput = document.getElementById('taskComment');
  const taskTitleModal = document.getElementById('taskTitleModal');
  let selectedTaskId = null;

  tasksEl?.addEventListener('click', (e)=>{
    const btn = e.target.closest('.submit-task-btn');
    if(!btn) return;
    if (btn.disabled || btn.classList.contains('cursor-not-allowed')) return;

    selectedTaskId = parseInt(btn.dataset.taskId, 10);
    if(taskTitleModal) taskTitleModal.textContent = btn.dataset.taskTitle;
    modal?.classList.remove('hidden');
  });

  btnClose?.addEventListener('click', () => {
    modal?.classList.add('hidden');
    selectedTaskId = null;
  });
  
  btnSubmit?.addEventListener('click', ()=>{
    if(!selectedTaskId) return;
    const fileType = fileInput?.value ? fileInput.value.split('.').pop() : 'archivo';
    const comment = commentInput?.value || '';
    KarpusStore.addTaskSubmission(selectedTaskId, {
      parent: 'Juan Pérez',
      fileType,
      date: new Date().toISOString().slice(0,10),
      comment
    });
    if(fileInput) fileInput.value = '';
    if(commentInput) commentInput.value = '';
    modal?.classList.add('hidden');
    renderTasks();
  });

  // Interacciones en posts
  postsEl?.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    const postId = parseInt(btn.dataset.postId, 10);
    const action = btn.dataset.action;
    if(action==='like'){
      KarpusStore.reactToPost(postId, { type:'like' });
      renderPosts();
    } else if(action==='react-emoji'){
      const emoji = btn.dataset.emoji || '❤️';
      KarpusStore.reactToPost(postId, { type:'emoji', emoji });
      renderPosts();
    } else if(action==='comment'){
      const input = document.querySelector(`input[data-post-id="${postId}"]`);
      const text = (input?.value||'').trim();
      if(!text) return;
      KarpusStore.addComment(postId, { author: 'Padre/Madre', text });
      if(input) input.value='';
      renderPosts();
    }
  });

  classSelect?.addEventListener('change', ()=>{
    currentClass = selToCls(classSelect.value);
    renderPosts();
    renderTasks();
    renderNotifications();
  });

  // --- Event Listeners Adicionales ---

  // Menú de Avatar
  avatarMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    avatarDropdown?.classList.toggle('hidden');
  });

  editProfileBtn?.addEventListener('click', () => {
    showTab('profile');
    avatarDropdown?.classList.add('hidden');
  });

  document.addEventListener('click', () => avatarDropdown?.classList.add('hidden'));

  // Botones de período del gráfico
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => renderAttendanceChart(btn.dataset.period));
  });
  
  function renderImprovementPlans(){
    const container = document.getElementById('improvementSection');
    if(!container) return;
    const plans = KarpusStore.getImprovementPlans();
    container.innerHTML = '';
    plans.forEach(plan => {
      const card = document.createElement('div');
      card.className = 'p-4 rounded-3xl bg-white border';
      card.innerHTML = `
        <div class="flex justify-between items-center mb-2">
          <p class="text-sm font-medium">${plan.title}</p>
          <span class="text-xs text-slate-500">${plan.due}</span>
        </div>
        <p class="text-sm">${plan.actions}</p>
        <div class="mt-3 flex items-center gap-2">
          <span class="text-xs px-2 py-1 rounded-xl bg-slate-100">${plan.status}</span>
        </div>
      `;
      container.appendChild(card);
    });
  }

  // Renderizado inicial
  renderPosts();
  renderTasks();
  renderGeneralFeed();
  renderAttendanceChart('month'); // Renderizar gráfico inicial
  renderImprovementPlans();
  showTab('home'); // Mostrar la pestaña de inicio por defecto
});
 