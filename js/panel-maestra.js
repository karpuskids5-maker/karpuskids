document.addEventListener('DOMContentLoaded', () => {
  // =========================
  // Icons (use createIcons for lucide UMD)
  // =========================
  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  } else if (window.lucide && typeof lucide.replace === 'function') {
    // fallback for older builds
  if(window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
  }

  // =========================
  // Tabs navegación
  // =========================
  const tabButtons = document.querySelectorAll('.t-btn');
  const tabs = {
    home: document.getElementById('t-home'),
    classroom: document.getElementById('t-classroom'),
    tasks: document.getElementById('t-tasks'),
    attendance: document.getElementById('t-attendance'),
    notifications: document.getElementById('t-notifications'),
    profile: document.getElementById('t-profile')
  };

  function showTab(name) {
    Object.values(tabs).forEach(el => el.classList.add('hidden'));
    tabs[name].classList.remove('hidden');

    tabButtons.forEach(btn => {
      if(btn.dataset.tab === name) {
        btn.classList.add('text-karpus-blue', 'font-semibold');
        btn.classList.remove('text-slate-500');
      } else {
        btn.classList.remove('text-karpus-blue', 'font-semibold');
        btn.classList.add('text-slate-500');
      }
    });
  }

  tabButtons.forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

  showTab('home'); // Abrir home por defecto

  // =========================
  // Datos simulados
  // =========================
  const dashboardSummary = [
    { title: 'Alumnos', value: 15, color: 'karpus-blue' },
    { title: 'Asistencias', value: 18, color: 'karpus-green' },
    { title: 'Tareas pendientes', value: 3, color: 'karpus-orange' }
  ];

  const latestPosts = [
    { teacher: 'Ana Pérez', date: '28 Oct', text: 'Actividad de pintura sensorial.', photo: 'https://placehold.co/600x300' },
    { teacher: 'Ana Pérez', date: '27 Oct', text: 'Canción de vocales grabada.', photo: 'https://placehold.co/600x300' }
  ];

  const tasks = [
    { title: 'Colorear formas', due: '28 Oct', submitted: 12, total: 15 },
    { title: 'Canción de vocales', due: '29 Oct', submitted: 10, total: 15 }
  ];

  const notifications = [
    { type: 'task', text: 'Nueva tarea publicada', color: 'karpus-orange' },
    { type: 'class', text: 'Nueva publicación en aula', color: 'karpus-green' },
    { type: 'attendance', text: 'Falta asistencia', color: 'karpus-blue' }
  ];

  // =========================
  // Dashboard Home
  // =========================
  const dashEl = document.getElementById('dashboardSummary');
  dashEl.innerHTML = '';
  dashboardSummary.forEach(d => {
    const card = document.createElement('div');
    card.className = `p-4 rounded-3xl bg-white border flex flex-col items-center justify-center shadow-soft`;
    card.innerHTML = `<p class="text-sm text-slate-500">${d.title}</p><p class="text-lg font-semibold text-${d.color}">${d.value}</p>`;
    dashEl.appendChild(card);
  });

  const ctx = document.getElementById('attendanceChartTeacher');
  if (ctx) {
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Lun', 'Mar', 'Mie', 'Jue', 'Vie'],
        datasets: [
          {
            label: 'Asistencia',
            data: [0.93, 0.87, 0.95, 0.91, 0.89],
            backgroundColor: '#4CAF50',
            borderRadius: 6
          },
          {
            label: 'Participación',
            data: [0.85, 0.82, 0.88, 0.80, 0.86],
            backgroundColor: '#2196F3',
            borderRadius: 6
          }
        ]
      },
      options: { 
        responsive: true, 
        scales: {
          y: { 
            beginAtZero: true,
            max: 1,
            ticks: {
              callback: value => value * 100 + '%'
            }
          }
        },
        plugins: {
          legend: { display: true, position: 'top' }
        } 
      }
    });
  }
  
  // Monthly attendance chart
  const ctxMonthly = document.getElementById('attendanceMonthlyChart');
  if (ctxMonthly) {
    new Chart(ctxMonthly, {
      type: 'line',
      data: {
        labels: ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'],
        datasets: [
          {
            label: 'Asistencia promedio',
            data: [0.91, 0.89, 0.93, 0.90],
            borderColor: '#4CAF50',
            tension: 0.4,
            fill: false
          },
          {
            label: 'Participación promedio',
            data: [0.85, 0.83, 0.87, 0.84],
            borderColor: '#2196F3',
            tension: 0.4,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            max: 1,
            ticks: {
              callback: value => value * 100 + '%'
            }
          }
        },
        plugins: {
          legend: { display: true, position: 'top' }
        }
      }
    });
  }

  // =========================
  // Latest posts
  // =========================
  const postsEl = document.getElementById('latestPosts');
  postsEl.innerHTML = '';
  latestPosts.forEach(p => {
    const card = document.createElement('div');
    card.className = 'rounded-3xl overflow-hidden bg-white border shadow-soft';
    card.innerHTML = `
      <img src="${p.photo}" class="w-full h-40 object-cover" />
      <div class="p-3">
        <div class="flex justify-between mb-1">
          <p class="text-sm font-semibold">${p.teacher}</p>
          <span class="text-xs text-slate-500">${p.date}</span>
        </div>
        <p class="text-sm text-slate-700">${p.text}</p>
      </div>`;
    postsEl.appendChild(card);
  });

  // =========================
  // Tasks
  // =========================
  const tasksEl = document.getElementById('taskList');
  tasksEl.innerHTML = '';
  tasks.forEach(t => {
    const card = document.createElement('div');
    card.className = 'p-4 rounded-3xl bg-white border shadow-soft flex justify-between items-center';
    card.innerHTML = `<div>
      <p class="text-sm font-semibold">${t.title}</p>
      <p class="text-xs text-slate-500">Entrega: ${t.due} | Enviados: ${t.submitted}/${t.total}</p>
    </div>
    <button class="text-sm px-3 py-1 rounded-xl bg-karpus-blue text-white">Ver entregas</button>`;
    tasksEl.appendChild(card);
  });

  // =========================
  // Notifications
  // =========================
  const notifEl = document.getElementById('notificationList');
  if(notifEl){
    notifEl.innerHTML = '';
    notifications.forEach(n => {
      const card = document.createElement('div');
      card.className = `p-3 rounded-2xl bg-white border flex items-center justify-between`;
      card.innerHTML = `<p class="text-sm">${n.text}</p><span class="w-3 h-3 rounded-full bg-${n.color}"></span>`;
      notifEl.appendChild(card);
    });
  }

  // =========================
  // Modales
  // =========================
  function setupModal(openBtnId, modalId, closeBtnId) {
    const modal = document.getElementById(modalId);
    const openBtn = document.getElementById(openBtnId);
    const closeBtn = document.getElementById(closeBtnId);

    if(modal && openBtn && closeBtn) {
      openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
      closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
      modal.addEventListener('click', e => { if(e.target === modal) modal.classList.add('hidden'); });
    }
  }

  // Función para responder a mensajes de padres
  function responderMensaje(id) {
    // Abrir modal de respuesta en lugar de usar prompt
    const modal = document.getElementById('modal-respuesta');
    if (!modal) {
      // Crear modal si no existe
      const nuevoModal = document.createElement('div');
      nuevoModal.id = 'modal-respuesta';
      nuevoModal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
      nuevoModal.innerHTML = `
        <div class="bg-white rounded-xl p-6 max-w-md w-full">
          <h3 class="text-xl font-bold mb-4">Responder al mensaje</h3>
          <textarea id="texto-respuesta" class="w-full border rounded-lg p-3 mb-4" rows="4" placeholder="Escribe tu respuesta..."></textarea>
          <div class="flex justify-end gap-2">
            <button id="cancelar-respuesta" class="px-4 py-2 rounded-lg bg-gray-200">Cancelar</button>
            <button id="enviar-respuesta" class="px-4 py-2 rounded-lg bg-karpus-blue text-white">Enviar</button>
          </div>
        </div>
      `;
      document.body.appendChild(nuevoModal);
      
      // Configurar eventos
      document.getElementById('cancelar-respuesta').addEventListener('click', () => {
        document.getElementById('modal-respuesta').remove();
      });
      
      document.getElementById('enviar-respuesta').addEventListener('click', () => {
        const respuesta = document.getElementById('texto-respuesta').value;
        if (respuesta.trim()) {
          console.log(`Respuesta enviada al mensaje ${id}: ${respuesta}`);
          // Mostrar notificación en lugar de alert
          const notificacion = document.createElement('div');
          notificacion.className = 'fixed bottom-4 right-4 bg-karpus-green text-white px-4 py-2 rounded-lg shadow-lg z-50';
          notificacion.textContent = 'Respuesta enviada correctamente';
          document.body.appendChild(notificacion);
          
          setTimeout(() => {
            notificacion.classList.add('opacity-0', 'transition-opacity', 'duration-500');
            setTimeout(() => notificacion.remove(), 500);
          }, 3000);
          
          document.getElementById('modal-respuesta').remove();
        }
      });
    } else {
      // Si ya existe, solo mostrar
      modal.style.display = 'flex';
    }
  }

  // Publicaciones
  setupModal('openAddPost', 'modalAddPost', 'closeAddPost');
  setupModal('openHistory', 'modalHistory', 'closeHistory');
  // Tareas
  setupModal('openCreateTask', 'modalCreateTask', 'closeCreateTask');
  setupModal('closeGradeTask', 'modalGradeTask', 'closeGradeTask');
  // Envío notificaciones
  setupModal('openSendNotification', 'modalSendNotification', 'closeSendNotification');
  // Perfil
  setupModal('openViewParents', 'modalViewParents', 'closeViewParents');
  setupModal('openCalendar', 'modalCalendar', 'closeCalendar');
  setupModal('openMessage', 'modalMessage', 'closeMessage');
  setupModal('openExport', 'modalExport', 'closeExport');

  // =========================
  // Botones placeholder
  // =========================
  const sendMessage = document.getElementById('sendMessage');
  if(sendMessage) sendMessage.onclick = () => alert('Mensaje enviado (simulado)');
  const submitNotification = document.getElementById('submitNotification');
  if(submitNotification) submitNotification.onclick = () => alert('Notificación enviada (simulado)');
  const submitPost = document.getElementById('submitPost');
  if(submitPost) submitPost.onclick = () => alert('Publicación guardada (simulado)');
  const submitTask = document.getElementById('submitTask');
  if(submitTask) submitTask.onclick = () => alert('Tarea creada (simulado)');

  // =========================
  // Sidebar collapse / responsive behavior
  // =========================
  const sidebar = document.getElementById('sidebar');
  const toggleSidebarBtn = document.getElementById('toggleSidebar');
  function setSidebarCollapsed(collapsed) {
    if (!sidebar) return;
    sidebar.classList.toggle('collapsed', !!collapsed);
    // persist state in localStorage for desktop
    try { localStorage.setItem('sidebarCollapsed', !!collapsed); } catch(e){}
  }
  // initialize from storage
  try {
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved === 'true') setSidebarCollapsed(true);
  } catch(e){}

  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => {
      const isCollapsed = sidebar.classList.contains('collapsed');
      setSidebarCollapsed(!isCollapsed);
    });
  }

  // reposition logic: on small screens ensure sidebar hidden (we use bottom nav), on larger show it
  function handleResize() {
    const w = window.innerWidth;
    if (!sidebar) return;
    if (w < 768) {
      // hide sidebar visually on mobile
      sidebar.classList.add('hidden-mobile');
    } else {
      sidebar.classList.remove('hidden-mobile');
    }
  }
  handleResize();
  window.addEventListener('resize', handleResize);

  // =========================
  // Sidebar nav (buttons inside aside) and color switch
  // =========================
  const sidebarNavBtns = document.querySelectorAll('#sidebar [data-section]');
  if (sidebarNavBtns && sidebarNavBtns.length) {
    sidebarNavBtns.forEach(b => {
      b.addEventListener('click', () => {
        const target = b.dataset.section || '';
        // if target includes 't-' prefix, normalize to name expected by showTab
        if (target.startsWith('t-')) {
          const name = target.replace(/^t-/, '');
          if (typeof showTab === 'function') showTab(name);
        } else if (typeof showTab === 'function') {
          showTab(target);
        }
      });
    });
  }

  // Color switch
  const colorBtns = document.querySelectorAll('#sidebar [data-color]');
  function applySidebarColor(color) {
    if (!sidebar) return;
    sidebar.classList.remove('sidebar-green','sidebar-yellow','sidebar-pink');
    if (color === 'green') sidebar.classList.add('sidebar-green');
    else if (color === 'yellow') sidebar.classList.add('sidebar-yellow');
    else if (color === 'pink') sidebar.classList.add('sidebar-pink');
    try { localStorage.setItem('sidebarColor', color); } catch(e){}
  }
  if (colorBtns && colorBtns.length) {
    colorBtns.forEach(b => b.addEventListener('click', () => applySidebarColor(b.dataset.color)));
    // init from storage
    try {
      const savedColor = localStorage.getItem('sidebarColor') || 'green';
      applySidebarColor(savedColor);
    } catch(e) { applySidebarColor('green'); }
  }
});
