document.addEventListener('DOMContentLoaded', () => {
  if (window.Auth && !Auth.enforceRole('padre')) return;
  if (!window.KarpusStore) return;
  const CURRENT_PARENT = (window.Auth && Auth.user) ? { id: Auth.user.id || 'padre_demo', name: Auth.user.name || Auth.user.fullName || 'Padre Demo' } : { id: 'padre_demo', name: 'Padre Demo' };
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
  const sections = {
    home: document.getElementById('tab-home'),
    'live-attendance': document.getElementById('tab-live-attendance'),
    class: document.getElementById('tab-class'),
    tasks: document.getElementById('tab-tasks'),
    grades: document.getElementById('tab-grades'),
    notifications: document.getElementById('tab-notifications'),
    profile: document.getElementById('tab-profile')
  };

  // Preparar secciones para animación
  Object.values(sections).forEach(el => el?.classList.add('section-anim', 'pb-16')); // Padding bottom para que el nav no tape contenido

  function showTab(name) {
    if (!name || !sections[name]) name = 'home'; // Default a home
    Object.values(sections).forEach(el => {
      if (!el) return;
      el.classList.remove('section-visible');
      el.classList.add('hidden');
    });
    const target = sections[name];
    if (target) {
      target.classList.remove('hidden');
      requestAnimationFrame(() => target.classList.add('section-visible'));
    }
    // Activar el botón del sidebar correspondiente (desktop)
    document.querySelectorAll('.sidebar-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.section === name);
    });
    // Auto-scroll en móvil
    if (window.innerWidth < 768) {
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(e) { window.scrollTo(0,0); }
    }
    // Renderizar gráfico de asistencia al entrar en la sección
    if (name === 'live-attendance') {
      renderAttendanceChart();
      setTimeout(initCalendar, 100); // Init calendar after render
    }
  }

  // Gráfico simple de asistencia (donut SVG) sin dependencias externas
  function renderAttendanceChart() {
    const container = sections['live-attendance'];
    if (!container) return;

    let chartWrap = container.querySelector('#attendance-chart');
    if (!chartWrap) {
      chartWrap = document.createElement('div');
      chartWrap.id = 'attendance-chart';
      chartWrap.className = 'attendance-chart';
      container.prepend(chartWrap);
    }

    // Obtener porcentaje de asistencia (si existe), por defecto 92
    const rateAttr = container.getAttribute('data-attendance-rate');
    const rate = Math.max(0, Math.min(100, Number(rateAttr ?? 92)));

    const size = 140;
    const stroke = 16;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - rate / 100);

    chartWrap.innerHTML = `
      <div class="attendance-inner">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <circle cx="${size/2}" cy="${size/2}" r="${radius}" stroke="#e5e7eb" stroke-width="${stroke}" fill="none"/>
          <circle cx="${size/2}" cy="${size/2}" r="${radius}" stroke="#0ea5e9" stroke-width="${stroke}" fill="none"
                  stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
                  transform="rotate(-90 ${size/2} ${size/2})"/>
          <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#0f172a" font-size="20" font-weight="600">${rate}%</text>
        </svg>
        <div class="attendance-legend">
          <span class="block text-sm text-slate-600">Asistencia del período</span>
          <div class="flex justify-center gap-4 mt-2 text-xs">
             <span class="text-green-600 font-semibold">18 Asistencias</span>
             <span class="text-red-500 font-semibold">2 Faltas</span>
          </div>
        </div>
      </div>
    `;
  }

  // Inicialización diferida al final del archivo para evitar doble render

  // Navegación desde el sidebar (data-section)
  const sidebarNavBtns = document.querySelectorAll('#sidebar [data-section]');
  const sectionMap = {
    home: 'home',
    'live-attendance': 'live-attendance',
    class: 'class',
    tasks: 'tasks',
    grades: 'grades',
    notifications: 'notifications',
    profile: 'profile'
  };
  sidebarNavBtns.forEach(b => {
    b.addEventListener('click', () => {
      const target = sectionMap[b.dataset.section] || b.dataset.section;
      showTab(target);
      // Cerrar sidebar en móvil
      const overlay = document.getElementById('sidebarOverlay');
      const sb = document.getElementById('sidebar');
      if (sb?.classList.contains('mobile-visible')) {
        sb.classList.add('hidden'); sb.classList.remove('mobile-visible');
        if (overlay) overlay.style.display = 'none';
      }
      // Actualizar íconos después de cambios en el DOM
      try { window.lucide && window.lucide.createIcons(); } catch(e) {}
    });
  });

  // Marcar activo el botón del sidebar en cada click (redundante pero seguro)
  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // CTA amarillo: Ver Actividades
  const ctaBtn = document.getElementById('ctaPendingBtn');
  if(ctaBtn){
    ctaBtn.addEventListener('click', ()=>{
      showTab('tasks');
      try { window.lucide && window.lucide.createIcons(); } catch(e) {}
    });
  }

  // --- Dashboard Logic (New) ---
  function renderDashboard() {
    const dateEl = document.getElementById('currentDateDisplay');
    if(dateEl) dateEl.textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

    // Próxima clase (lógica simple: mañana 8:30 AM, usa config si existe)
    const nextClassEl = document.getElementById('nextClassInfo');
    if (nextClassEl) {
      const cfg = KarpusStore.getConfig ? KarpusStore.getConfig() : {};
      const hour = (cfg.schedule && /\d{1,2}:\d{2}/.test(cfg.schedule)) ? cfg.schedule.match(/\d{1,2}:\d{2}/)[0] : '8:30';
      const now = new Date();
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const dayStr = tomorrow.toLocaleDateString('es-ES', { weekday: 'long' });
      nextClassEl.textContent = `Próxima clase • ${dayStr} • ${hour} AM`;
    }

    // Asistencia: calcular % desde registros, fallback 95%
    try {
      const att = (KarpusStore.getState && KarpusStore.getState().attendance) || [];
      let percent = 95;
      if (att.length) {
        const rec = att[att.length - 1];
        if (rec && rec.total > 0) {
          percent = Math.round((Number(rec.present) / Number(rec.total)) * 100);
        }
      }
      const attEl = document.getElementById('dashAttendance');
      if (attEl) attEl.textContent = `${percent}%`;
    } catch(e) { /* noop */ }

    const alertsContainer = document.getElementById('dashboardAlerts');
    if(!alertsContainer) return;
    alertsContainer.innerHTML = '';

    // 1. Alerta Roja: Tareas Vencidas
    const tasks = KarpusStore.getTasksForClass(currentClass);
    const overdue = tasks.filter(t => {
        const isSubmitted = t.submissions.some(s => s.parent === CURRENT_PARENT.name);
        return !isSubmitted && new Date(t.due) < new Date();
    });
    
    if(overdue.length > 0) {
        alertsContainer.innerHTML += `
            <div class="p-3 bg-red-50 border-l-4 border-red-500 rounded-r-xl flex items-start gap-3">
                <i data-lucide="alert-circle" class="text-red-600 w-5 h-5 mt-0.5"></i>
                <div>
                    <h4 class="text-sm font-bold text-red-700">¡Atención! Tarea Vencida</h4>
                    <p class="text-xs text-red-600">Tienes ${overdue.length} tarea(s) sin entregar.</p>
                </div>
            </div>
        `;
    }

    // 2. Alerta Amarilla: Tareas Pendientes (Próximas)
    const pending = tasks.filter(t => {
        const isSubmitted = t.submissions.some(s => s.parent === CURRENT_PARENT.name);
        return !isSubmitted && new Date(t.due) >= new Date();
    });
    document.getElementById('dashPendingTasks').textContent = pending.length;

    if(pending.length > 0) {
        alertsContainer.innerHTML += `
            <div class="p-3 bg-yellow-50 border-l-4 border-yellow-500 rounded-r-xl flex items-start gap-3">
                <i data-lucide="clock" class="text-yellow-600 w-5 h-5 mt-0.5"></i>
                <div>
                    <h4 class="text-sm font-bold text-yellow-700">Tareas Pendientes</h4>
                    <p class="text-xs text-yellow-600">Recuerda entregar "${pending[0].title}" antes del ${pending[0].due}.</p>
                </div>
            </div>
        `;
    }

    // 3. Alerta Verde: Reconocimiento (Mock)
    alertsContainer.innerHTML += `
        <div class="p-3 bg-green-50 border-l-4 border-green-500 rounded-r-xl flex items-start gap-3">
            <i data-lucide="star" class="text-green-600 w-5 h-5 mt-0.5"></i>
            <div>
                <h4 class="text-sm font-bold text-green-700">¡Excelente Trabajo!</h4>
                <p class="text-xs text-green-600">Andrea ha participado activamente en clase hoy.</p>
            </div>
        </div>
    `;
  }

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
      card.innerHTML = `<p class=\"text-sm\"><span class="text-xs bg-slate-100 px-1 rounded text-slate-500 mr-1">Publicado por:</span> <strong>${p.teacher}</strong></p><p class="mt-1 text-sm">${p.text}</p>
        <p class=\"text-xs text-slate-500\">${p.date}</p>
        ${attachments}
        <div class=\"mt-2 space-y-1\">${comments || '<span class=\"text-[11px] text-slate-400\">(Sin comentarios)</span>'}</div>
        <p class=\"text-[11px] text-slate-500 mt-2\">Vista de solo lectura para padres/tutores.</p>`;
      postsEl.appendChild(card);
    });
  }

  function updateTasksBadge() {
    const badge = document.getElementById('tasksBadge');
    if (!badge) return;
    const items = KarpusStore.getTasksForClass(currentClass);
    const parentName = CURRENT_PARENT.name;
    // Contar tareas sin entrega
    const pendingCount = items.filter(t => !t.submissions.find(s => s.parent === parentName)).length;
    
    if (pendingCount > 0) badge.classList.remove('hidden');
    else badge.classList.add('hidden');
  }

  // Filtros de tareas
  let currentTaskFilter = 'all';
  document.querySelectorAll('.task-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
          document.querySelectorAll('.task-filter-btn').forEach(b => {
              b.classList.remove('bg-slate-800', 'text-white', 'active');
              b.classList.add('bg-slate-100', 'text-slate-600');
          });
          btn.classList.remove('bg-slate-100', 'text-slate-600');
          btn.classList.add('bg-slate-800', 'text-white', 'active');
          currentTaskFilter = btn.dataset.filter;
          renderTasks();
      });
  });

  function renderTasks(){
    if(!tasksEl) return;
    let items = KarpusStore.getTasksForClass(currentClass);
    const parentName = CURRENT_PARENT.name;

    // Aplicar filtro
    if(currentTaskFilter === 'pending') items = items.filter(t => !t.submissions.find(s => s.parent === parentName));
    else if(currentTaskFilter === 'submitted') items = items.filter(t => t.submissions.find(s => s.parent === parentName));
    else if(currentTaskFilter === 'overdue') items = items.filter(t => !t.submissions.find(s => s.parent === parentName) && new Date(t.due) < new Date());

    tasksEl.innerHTML = '';
    if (items.length === 0) {
        tasksEl.innerHTML = `<p class="text-center text-sm text-slate-500 p-4">No hay tareas en esta categoría.</p>`;
    }
    items.forEach(t=>{
      const card = document.createElement('div');
      card.className = 'p-4 rounded-2xl bg-white border flex items-center justify-between shadow-sm';
      const submission = t.submissions.find(s => s.parent === parentName);
      const gradeInfo = t.grades.find(g => g.student === parentName);

      const dueDate = new Date(t.due);
      const now = new Date();
      const isSubmitted = !!submission;
      const isOverdue = !isSubmitted && dueDate < now;
      const statusLabel = isSubmitted ? 'Evidencia cargada' : (isOverdue ? 'Vencida' : 'Pendiente');
      const statusClass = isSubmitted ? 'bg-green-100 text-green-700' : (isOverdue ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-800');

      let actionHtml = `<button data-task-id="${t.id}" data-task-title="${t.title}" class="submit-task-btn text-sm px-3 py-1 rounded-xl bg-karpus-green text-white">Subir evidencia</button>`;

      if (gradeInfo && (gradeInfo.comment || gradeInfo.grade)) {
        actionHtml = `<div class="text-right"><p class="text-sm font-bold text-karpus-green">Observación</p><p class="text-xs text-slate-600">${gradeInfo.comment || 'En revisión.'}</p></div>`;
      } else if (submission) {
        actionHtml = `<div class="text-sm px-3 py-1 rounded-xl bg-slate-200 text-slate-600 text-center">Evidencia enviada,<br>observación pendiente</div>`;
      }

      const detailBtn = `<button class="ml-2 text-sm px-3 py-1 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50" data-task-id="${t.id}" data-action="view-detail">Ver detalle</button>`;

      card.innerHTML = `<div>
        <p class=\"text-sm font-semibold\">${t.title}</p>
        <p class=\"text-xs text-slate-500\">Fecha sugerida: ${t.due}</p>
        <span class=\"text-[11px] px-2 py-0.5 rounded-full ${statusClass}\">${statusLabel}</span>
        ${isSubmitted ? '<p class=\"text-[11px] text-slate-600 mt-1\">Evidencia cargada por el estudiante</p>' : ''}
      </div>
      ${actionHtml}${detailBtn}`;

      tasksEl.appendChild(card);
    });
    updateTasksBadge();
  }

  // Abrir modal de detalle de tarea
  function openTaskDetailModal(taskId){
    const modal = document.getElementById('modalTaskDetail');
    if(!modal) return;
    const t = KarpusStore.getTaskById(Number(taskId));
    if(!t) return;
    const parentName = CURRENT_PARENT.name;
    const submission = t.submissions.find(s => s.parent === parentName);
    const gradeInfo = t.grades.find(g => g.student === parentName);
    const dueDate = new Date(t.due);
    const now = new Date();
    const isSubmitted = !!submission;
    const isOverdue = !isSubmitted && dueDate < now;
    const statusLabel = isSubmitted ? 'Evidencia cargada' : (isOverdue ? 'Vencida' : 'Pendiente');

    const titleEl = document.getElementById('taskDetailTitle');
    const dueEl = document.getElementById('taskDetailDue');
    const statusEl = document.getElementById('taskDetailStatus');
    const noteEl = document.getElementById('taskDetailNote');

    if(titleEl) titleEl.textContent = t.title;
    if(dueEl) dueEl.textContent = t.due;
    if(statusEl){
      statusEl.textContent = statusLabel;
      statusEl.className = `text-xs px-2 py-1 rounded ${isSubmitted ? 'bg-green-100 text-green-700' : (isOverdue ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-800')}`;
    }
    if(noteEl){
      noteEl.textContent = gradeInfo ? `Observación: ${gradeInfo.comment||'En revisión'}` : (isSubmitted ? 'En revisión' : 'Sin evidencia');
    }
    modal.classList.remove('hidden');
  }

  if(tasksEl){
    tasksEl.addEventListener('click', (e)=>{
      const btn = e.target.closest('[data-action]');
      if(!btn) return;
      const action = btn.getAttribute('data-action');
      if(action === 'view-detail'){
        const id = btn.getAttribute('data-task-id');
        openTaskDetailModal(id);
      }
    });
  }

  const closeTaskDetailBtn = document.getElementById('closeTaskDetail');
  if(closeTaskDetailBtn){
    closeTaskDetailBtn.addEventListener('click', ()=>{
      const modal = document.getElementById('modalTaskDetail');
      if(modal) modal.classList.add('hidden');
    });
  }

  // --- Grades Logic ---
  function renderGrades() {
      const tbody = document.getElementById('gradesTableBody');
      if(!tbody) return;
      
      // Mock data if store is empty for demo
      const grades = [
          { subject: 'Matemáticas - Tarea 1', grade: 95, comment: 'Excelente trabajo' },
          { subject: 'Lenguaje - Lectura', grade: 88, comment: 'Buena comprensión' },
          { subject: 'Arte - Pintura', grade: 100, comment: 'Muy creativo' },
          { subject: 'Ciencias - Proyecto', grade: 92, comment: 'Bien presentado' }
      ];
      
      tbody.innerHTML = grades.map(g => `
          <tr class="hover:bg-slate-50 transition-colors">
              <td class="p-4 font-medium text-slate-700">${g.subject}</td>
              <td class="p-4 text-center">
                  <span class="px-2 py-1 rounded-lg font-bold text-xs ${g.grade >= 90 ? 'bg-green-100 text-green-700' : (g.grade >= 70 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700')}">
                      ${g.grade}
                  </span>
              </td>
              <td class="p-4 text-slate-500 text-xs">${g.comment}</td>
          </tr>
      `).join('');

      // Promedio visible con código de color Rojo < 70, Verde ≥ 70
      const avg = Math.round(grades.reduce((sum, g) => sum + g.grade, 0) / grades.length);
      const avgEl = document.getElementById('gradesAverageBadge');
      if(avgEl){
        avgEl.textContent = `${avg}`;
        avgEl.className = `px-2 py-1 rounded-full ${avg < 70 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`;
      }
  }

  // --- Notificaciones / Chat ---
  window.handleNotificationClick = function(contactId) {
    showTab('notifications');
    try {
      if (typeof contacts === 'undefined' || !contacts.length) loadContacts();
    } catch(e) {
      // Si aún no existen las funciones/arrays, no romper
    }
    const contactList = (typeof contacts !== 'undefined' && Array.isArray(contacts)) ? contacts : [];
    const contact = contactList.find(c => c.id === contactId);
    if (contact) openChatWith(contact);
  };

  document.getElementById('downloadGradesBtn')?.addEventListener('click', () => {
      const content = document.getElementById('gradesTable').outerHTML;
      const studentName = "Andrea Flores";
      const date = new Date().toLocaleDateString();
      
      const win = window.open('', '_blank');
      win.document.write(`
          <html>
          <head>
              <title>Reporte de Desarrollo - ${studentName}</title>
              <style>
                  body { font-family: sans-serif; padding: 40px; color: #334155; }
                  .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; }
                  .header h1 { color: #2563eb; margin: 0 0 10px 0; font-size: 24px; }
                  .info { margin-bottom: 20px; font-size: 14px; }
                  table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
                  th { background: #f8fafc; text-align: left; padding: 12px; border-bottom: 2px solid #e2e8f0; color: #64748b; font-weight: 600; }
                  td { padding: 12px; border-bottom: 1px solid #e2e8f0; }
                  .footer { margin-top: 50px; font-size: 10px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 20px; }
              </style>
          </head>
          <body>
              <div class="header">
                  <h1>Karpus Kids</h1>
                  <p>Reporte de Desarrollo Infantil</p>
              </div>
              <div class="info">
                  <p><strong>Estudiante:</strong> ${studentName}</p>
                  <p><strong>Fecha de emisión:</strong> ${date}</p>
                  <p><strong>Aula:</strong> Pequeños</p>
              </div>
              ${content}
              <div class="footer">
                  <p>Este documento es un reporte informativo generado automáticamente por la plataforma Karpus Kids.</p>
              </div>
              <script>window.print();</script>
          </body>
          </html>
      `);
      win.document.close();
  });

  // --- Calendar Logic ---
  let calendarDate = new Date();

  function initCalendar() {
    const prevBtn = document.getElementById('calPrevBtn');
    const nextBtn = document.getElementById('calNextBtn');
    // Evitar múltiples listeners si se llama varias veces
    if(prevBtn) prevBtn.onclick = () => changeMonth(-1);
    if(nextBtn) nextBtn.onclick = () => changeMonth(1);
    renderCalendar();
  }

  function changeMonth(delta) {
    const grid = document.getElementById('calendarGrid');
    if(grid) {
        grid.style.opacity = '0';
        setTimeout(() => {
            calendarDate.setMonth(calendarDate.getMonth() + delta);
            renderCalendar();
            grid.style.opacity = '1';
        }, 200);
    }
  }

  function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const label = document.getElementById('calMonthLabel');
    if (!grid || !label) return;

    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    
    label.textContent = new Date(year, month).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let html = '';
    for (let i = 0; i < firstDay; i++) html += `<div class="h-10"></div>`;

    let presentCount = 0, absentCount = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      // Mock status logic
      const hash = day + month; 
      let status = 'present';
      let colorClass = 'bg-green-100 text-green-700';
      if (hash % 12 === 0) { status = 'absent'; colorClass = 'bg-red-100 text-red-700'; }
      else if (hash % 18 === 0) { status = 'late'; colorClass = 'bg-yellow-100 text-yellow-700'; }
      if (new Date(year, month, day) > new Date()) { status = ''; colorClass = 'text-slate-400 hover:bg-slate-100'; }

      if(status === 'present') presentCount++;
      else if(status === 'absent') absentCount++;

      html += `<div class="h-10 flex items-center justify-center rounded-lg text-xs font-medium transition-colors ${colorClass}" title="${status}">${day}</div>`;
    }
    grid.innerHTML = html;

    // Resumen mensual visible
    const presEl = document.getElementById('attendancePresentCount');
    const absEl = document.getElementById('attendanceAbsentCount');
    if(presEl) presEl.textContent = presentCount;
    if(absEl) absEl.textContent = absentCount;
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

  // Inicialización general: íconos
  try { window.lucide && window.lucide.createIcons(); } catch(e) {}

  function renderGeneralFeed() {
    if (!generalFeedEl) return;
    const items = KarpusStore.getNotificationsForClass('General');
    
    // Simulación: Agregar notificación de mensaje si no existe para probar la funcionalidad
    if(!items.find(i => i.type === 'message')) {
        items.unshift({ id: 999, class: 'General', type: 'message', text: 'La Maestra Ana te ha enviado un mensaje nuevo.', date: new Date().toISOString().slice(0,10), senderId: 'maestra' });
    }

    generalFeedEl.innerHTML = '';
    items.forEach(n => {
      const card = document.createElement('div');
      card.className = 'p-4 rounded-3xl bg-slate-50 shadow-soft';
      
      let actionBtn = '';
      if (n.type === 'message' && n.senderId) {
          actionBtn = `<button class="mt-2 text-xs px-3 py-1 bg-karpus-blue text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-1" onclick="handleNotificationClick('${n.senderId}')"><i data-lucide="message-circle" class="w-3 h-3"></i> Responder</button>`;
      }

      card.innerHTML = `<div class='flex justify-between items-center mb-1'><h4 class='text-sm font-semibold capitalize'>${n.type}</h4><span class='text-xs text-slate-500'>${n.date}</span></div><p class='text-sm text-slate-700'>${n.text}</p>${actionBtn}`;
      generalFeedEl.appendChild(card);
    });
    if(window.lucide) lucide.createIcons();
  }

  // (Se mantiene la versión segura de handleNotificationClick definida más arriba)

  // (Eliminado el gráfico dinámico de Chart.js; se usa donut SVG ligero definido arriba)

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

  // (Eliminado listener vacío de posts)

  classSelect?.addEventListener('change', ()=>{
    currentClass = selToCls(classSelect.value);
    renderPosts();
    renderTasks();
    renderDashboard();
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

  // --- Chat institucional (solo con adultos) ---
  const contactListEl = document.getElementById('contactList');
  const contactFilterEl = document.getElementById('contactFilter');
  const chatHeaderEl = document.getElementById('chatHeader');
  const chatMessagesEl = document.getElementById('chatMessages');
  const chatInputEl = document.getElementById('chatInput');
  const chatSendEl = document.getElementById('chatSend');
  const parentId = 'padre_andrea';
  let contacts = [];
  let filteredContacts = [];
  let activeContact = null;

  function loadContacts(){
    try {
      contacts = (KarpusStore.getContacts()||[]).filter(c => c.id==='maestra' || c.id==='directora');
      filteredContacts = contacts.slice();
      renderContacts();
      if(chatHeaderEl) chatHeaderEl.textContent = 'Mensajes Privados';
    } catch(e){ /* noop */ }
  }

  function renderContacts(){
    if(!contactListEl) return;
    contactListEl.innerHTML = '';
    filteredContacts.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 text-sm';
      const role = c.id==='maestra' ? 'Maestra' : (c.id==='directora' ? 'Directora' : 'Contacto');
      btn.textContent = `${c.name || c.id} (${role})`;
      btn.addEventListener('click', () => openChatWith(c));
      contactListEl.appendChild(btn);
    });
  }

  function openChatWith(contact){
    activeContact = contact;
    if(chatHeaderEl) chatHeaderEl.textContent = `Mensajes Privados — ${contact.name || contact.id}`;
    const thread = KarpusStore.getThread([parentId, contact.id]);
    renderMessages(thread);
  }

  function renderMessages(thread){
    if(!chatMessagesEl) return;
    chatMessagesEl.innerHTML = '';
    (thread.messages||[]).forEach(m => {
      const row = document.createElement('div');
      const isMine = m.from === parentId;
      row.className = `flex ${isMine ? 'justify-end' : 'justify-start'}`;
      row.innerHTML = `<div class="max-w-[70%] px-3 py-2 rounded-2xl text-sm ${isMine ? 'bg-karpus-pink text-white' : 'bg-slate-100 text-slate-800'}">${m.text}</div>`;
      chatMessagesEl.appendChild(row);
    });
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  chatSendEl?.addEventListener('click', () => {
    if(!activeContact || !chatInputEl) return;
    const text = (chatInputEl.value||'').trim();
    if(!text) return;
    const thread = KarpusStore.sendMessage([parentId, activeContact.id], { from: parentId, text });
    chatInputEl.value = '';
    renderMessages(thread);
  });

  contactFilterEl?.addEventListener('input', () => {
    const q = (contactFilterEl.value||'').toLowerCase();
    filteredContacts = contacts.filter(c => (c.name||c.id).toLowerCase().includes(q));
    renderContacts();
  });

  // Botón "Solicitar reunión": abrir chat con maestra
  const requestMeetingBtn = document.getElementById('requestMeetingBtn');
  requestMeetingBtn?.addEventListener('click', () => {
    showTab('notifications');
    try { if (typeof contacts === 'undefined' || !contacts.length) loadContacts(); } catch(e) {}
    const teacher = (contacts||[]).find(c => c.id==='maestra');
    if(teacher) openChatWith(teacher);
  });

  // --- Lógica de Perfil del Padre (Editable) ---
  const profileNameInput = document.getElementById('profileName');
  const profilePhoneInput = document.getElementById('profilePhone');
  const profileEmailInput = document.getElementById('profileEmail');
  const profileJobInput = document.getElementById('profileJob');
  const profileBioInput = document.getElementById('profileBio');
  const profileAvatarInput = document.getElementById('profileAvatarInput');
  const profileAvatarPreview = document.getElementById('profileAvatarPreview');
  const saveProfileBtn = document.getElementById('saveProfileBtn');

  // Cargar datos (simulado desde localStorage o defaults)
  function loadParentProfile() {
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem('karpus_parent_profile') || '{}'); } catch(e) { saved = {}; }
      if(profileNameInput) profileNameInput.value = saved.name || 'Juan Pérez';
      if(profilePhoneInput) profilePhoneInput.value = saved.phone || '+1 829 555 0101';
      if(profileEmailInput) profileEmailInput.value = saved.email || 'juan.perez@email.com';
      if(profileJobInput) profileJobInput.value = saved.job || 'Empresa S.A.';
      if(profileBioInput) profileBioInput.value = saved.bio || '';
      if(profileAvatarPreview && saved.avatar) profileAvatarPreview.src = saved.avatar;
  }

  saveProfileBtn?.addEventListener('click', () => {
      const profile = {
          name: profileNameInput.value,
          phone: profilePhoneInput.value,
          email: profileEmailInput.value,
          job: profileJobInput.value,
          bio: profileBioInput.value,
          avatar: profileAvatarPreview.src
      };
      try { localStorage.setItem('karpus_parent_profile', JSON.stringify(profile)); } catch(e) {}
      alert('Perfil actualizado correctamente.');
  });

  profileAvatarInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (e) => profileAvatarPreview.src = e.target.result;
          reader.readAsDataURL(file);
      }
  });

  // Listeners para ver perfiles de equipo
  document.getElementById('viewTeacherProfile')?.addEventListener('click', () => {
      const teacherProfile = KarpusStore.getTeacherProfile();
      showProfileModal({ ...teacherProfile, role: 'Maestra', id: 'maestra' });
  });
  document.getElementById('viewDirectorProfile')?.addEventListener('click', () => {
      const directorProfile = KarpusStore.getDirectorProfile();
      showProfileModal({ ...directorProfile, role: 'Directora', id: 'directora' });
  });

  // Renderizado inicial
  renderPosts();
  renderTasks();
  renderDashboard();
  renderGrades();
  renderGeneralFeed();
  loadContacts();
  loadParentProfile();
  showTab('home'); // Mostrar la pestaña de inicio por defecto
});
 
