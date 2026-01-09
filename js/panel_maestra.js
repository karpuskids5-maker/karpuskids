import { supabase } from './supabase.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Verificar Sesión y Cargar Perfil
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  // Cargar datos del perfil
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  
  // Mostrar nombre y correo en el sidebar/header si existen los elementos
  const userNameEls = document.querySelectorAll('.user-name-display, .label h3, #sidebar .label h3');
  const userEmailEls = document.querySelectorAll('.user-email-display');
  
  if (profile) {
    userNameEls.forEach(el => el.textContent = profile.name || 'Maestra');
    userEmailEls.forEach(el => el.textContent = profile.email || user.email);
  }

  // --- Global State ---
  let currentClass = null;

  // --- Sidebar & Mobile Menu Logic ---
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('toggleSidebar');
  const layoutShell = document.getElementById('layoutShell');
  const menuBtn = document.getElementById('menuBtn');
  const sidebarOverlay = document.getElementById('sidebarOverlay');

  if(toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      layoutShell.classList.toggle('sidebar-collapsed');
      const iconEl = document.getElementById('toggleSidebarIcon');
      if(iconEl){
        const next = sidebar.classList.contains('collapsed') ? 'chevrons-right' : 'chevrons-left';
        iconEl.setAttribute('data-lucide', next);
        if(window.lucide) lucide.createIcons();
      }
    });
  }

  function toggleMobileMenu() {
    sidebar.classList.toggle('mobile-visible');
    if (sidebarOverlay) sidebarOverlay.classList.toggle('active');
    document.body.classList.toggle('no-scroll');
  }

  if(menuBtn) menuBtn.addEventListener('click', toggleMobileMenu);
  if(sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => {
       if(sidebar.classList.contains('mobile-visible')) toggleMobileMenu();
    });
  }// Inicializar vista por defecto
  renderClassesGrid();
  if(window.lucide) lucide.createIcons();
  // SE ELIMINA EL CIERRE PREMATURO AQUI PARA QUE EL SCOPE ABARQUE TODO EL ARCHIVO

// --- Navigation Logic ---
  const navBtns = document.querySelectorAll('[data-section]');
  const sections = document.querySelectorAll('main .section');

  function showSection(id) {
    sections.forEach(s => {
      s.classList.add('hidden');
      s.classList.remove('section-visible');
    });
    
    const target = document.getElementById(id);
    if (target) {
      target.classList.remove('hidden');
      requestAnimationFrame(() => target.classList.add('section-visible'));
    }
  }

  navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = btn.getAttribute('data-section');
      if (!id) return;

      // Update global nav state
      navBtns.forEach(b => {
        b.classList.remove('bg-white/20', 'active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('bg-white/20', 'active');
      btn.setAttribute('aria-selected', 'true');

      // Logic: if clicking "Home/Mis Clases", reset class view
      if(id === 't-home') {
        currentClass = null;
        renderClassesGrid();
      }

      showSection(id);
      
      if(window.innerWidth < 768 && sidebar.classList.contains('mobile-visible')) {
        toggleMobileMenu();
      }
      
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(e){}
    });
  });

  // --- Class Dashboard Logic (New) ---
  const classesGrid = document.getElementById('classesGrid');
  const backToClassesBtn = document.getElementById('backToClasses');
  const currentClassNameLabel = document.getElementById('currentClassName');

  async function renderClassesGrid() {
    if(!classesGrid) return;
    
    // Cargar aulas asignadas a esta maestra
    const { data: classes, error } = await supabase
      .from('classrooms')
      .select('*')
      .eq('teacher_id', user.id);

    if (error) {
      console.error('Error cargando aulas:', error);
      classesGrid.innerHTML = `<div class="col-span-full text-center py-10 text-red-500">Error cargando aulas: ${error.message} (Código: ${error.code || 'N/A'})</div>`;
      return;
    }

    // Mock colors/icons for variety
    const colors = ['bg-orange-100 text-orange-600', 'bg-blue-100 text-blue-600', 'bg-pink-100 text-pink-600', 'bg-green-100 text-green-600'];
    
    if (!classes || classes.length === 0) {
      classesGrid.innerHTML = '<div class="col-span-full text-center py-10 text-slate-500">No tienes aulas asignadas.</div>';
      return;
    }

    classesGrid.innerHTML = classes.map((cls, idx) => {
      const colorClass = colors[idx % colors.length];
      return `
        <div class="bg-white rounded-3xl p-6 border shadow-sm hover:shadow-md transition-all cursor-pointer group" onclick="window.openClass('${cls.id}', '${cls.name}')">
          <div class="flex items-start justify-between mb-4">
            <div class="h-12 w-12 rounded-2xl ${colorClass} flex items-center justify-center">
              <i data-lucide="users" class="w-6 h-6"></i>
            </div>
            <button class="p-2 hover:bg-slate-50 rounded-full text-slate-400"><i data-lucide="more-horizontal" class="w-5 h-5"></i></button>
          </div>
          <h3 class="text-xl font-bold text-slate-800 mb-1 group-hover:text-karpus-blue transition-colors">${cls.name}</h3>
          <p class="text-sm text-slate-500 mb-4">${cls.level || 'Nivel'}</p>
          <div class="flex items-center gap-3 text-sm text-slate-500 border-t pt-4">
            <span class="flex items-center gap-1"><i data-lucide="user" class="w-4 h-4"></i> Ver Estudiantes</span>
          </div>
        </div>
      `;
    }).join('');
    
    if(window.lucide) lucide.createIcons();
  }

  // Expose to window for onclick
  window.openClass = function(classId, className) {
    currentClass = { id: classId, name: className };
    if(currentClassNameLabel) currentClassNameLabel.textContent = className;
    
    // Hide Home, Show Class Detail
    showSection('t-class-detail');
    
    // Default to Feed tab
    activateClassTab('feed');
  };

  if(backToClassesBtn) {
    backToClassesBtn.addEventListener('click', () => {
      currentClass = null;
      // Trigger click on "Mis Clases" nav button to handle state consistently
      const homeBtn = document.querySelector('[data-section="t-home"]');
      if(homeBtn) homeBtn.click();
    });
  }

  // --- Class Detail Internal Navigation (Tabs) ---
  const classTabBtns = document.querySelectorAll('.class-tab-btn');
  const classTabContents = document.querySelectorAll('.class-tab-content');

  function activateClassTab(tabName) {
    // Update buttons
    classTabBtns.forEach(btn => {
      if(btn.dataset.tab === tabName) {
        btn.classList.add('active', 'bg-karpus-blue', 'text-white');
        btn.classList.remove('text-slate-600', 'hover:bg-slate-100');
      } else {
        btn.classList.remove('active', 'bg-karpus-blue', 'text-white');
        btn.classList.add('text-slate-600', 'hover:bg-slate-100');
      }
    });

    // Update content
    classTabContents.forEach(content => {
      if(content.id === `tab-${tabName}`) {
        content.classList.remove('hidden');
      } else {
        content.classList.add('hidden');
      }
    });

    // Load data for the tab
     if(tabName === 'feed') renderClassFeed();
     if(tabName === 'tasks') renderClassTasks();
     if(tabName === 'grades') renderClassGrades();
     if(tabName === 'private-chat') renderClassPrivateChat();
     if(tabName === 'attendance') renderClassAttendance();
   }
 
   classTabBtns.forEach(btn => {
    btn.addEventListener('click', () => activateClassTab(btn.dataset.tab));
  });

  // --- Tab Logic: Feed ---
  async function renderClassFeed() {
    const feedContainer = document.getElementById('classroomFeed');
    if(!feedContainer || !currentClass) return;
    
    // Cargar posts reales
    const { data: posts, error } = await supabase
      .from('posts')
      .select('*, profiles(name)')
      .eq('classroom_id', currentClass.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error cargando posts:', error);
      feedContainer.innerHTML = '<p class="text-red-500 text-center">Error al cargar publicaciones.</p>';
      return;
    }
    
    if(!posts || posts.length === 0) {
      feedContainer.innerHTML = `
        <div class="text-center py-12 bg-slate-50 rounded-3xl border border-dashed">
          <div class="h-16 w-16 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
            <i data-lucide="message-square" class="w-8 h-8 text-slate-300"></i>
          </div>
          <h3 class="text-slate-600 font-semibold">No hay publicaciones aún</h3>
          <p class="text-sm text-slate-400">Sé el primero en publicar algo para el aula ${currentClass.name}.</p>
        </div>
      `;
    } else {
      feedContainer.innerHTML = posts.map(post => `
        <div class="bg-white p-4 rounded-3xl border shadow-sm space-y-3">
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm">
              ${post.profiles?.name?.charAt(0) || 'M'}
            </div>
            <div>
              <div class="font-bold text-slate-800">${post.profiles?.name || 'Maestra'}</div>
              <div class="text-xs text-slate-500">${new Date(post.created_at).toLocaleString()}</div>
            </div>
          </div>
          <div class="text-sm text-slate-700 whitespace-pre-line">${post.content || ''}</div>
          
          ${post.media_url && post.media_type === 'image' ? `<img src="${post.media_url}" class="rounded-2xl w-full h-auto object-cover max-h-80 mt-2 border" />` : ''}
          ${post.media_url && post.media_type === 'video' ? `<video src="${post.media_url}" controls class="rounded-2xl w-full max-h-80 mt-2 bg-black"></video>` : ''}
          ${post.media_url && post.media_type === 'document' ? `<a href="${post.media_url}" target="_blank" class="flex items-center gap-3 p-3 bg-slate-50 rounded-xl mt-2 hover:bg-slate-100 border transition-colors"><div class="p-2 bg-white rounded-lg border"><i data-lucide="file-text" class="w-5 h-5 text-blue-600"></i></div><span class="text-sm text-slate-700 font-medium">Ver documento adjunto</span></a>` : ''}

          <div class="flex items-center gap-4 pt-2 border-t text-sm text-slate-500">
             <button class="flex items-center gap-1 hover:text-pink-500"><i data-lucide="heart" class="w-4 h-4"></i> Me gusta</button>
             <button class="flex items-center gap-1 hover:text-blue-500"><i data-lucide="message-circle" class="w-4 h-4"></i> Comentar</button>
          </div>
        </div>
      `).join('');
    }
    if(window.lucide) lucide.createIcons();
  }

  // --- Tab Logic: Tasks ---
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
      renderClassTasks();
    });
  });

  function renderClassTasks() {
    const taskContainer = document.getElementById('taskList');
    if(!taskContainer || !currentClass) return;

    let tasks = []; // Implementar tabla 'tasks' en futuro
    
    // Filter logic (mocked for now as we don't have full student list in store to check all submissions)
    // In a real app, you'd check if all students submitted or if due date passed.
    
    if(tasks.length === 0) {
      taskContainer.innerHTML = `<div class="text-center py-8 text-slate-400">No hay tareas asignadas para esta clase.</div>`;
    } else {
      taskContainer.innerHTML = tasks.map(task => `
        <div class="bg-white p-4 rounded-3xl border hover:shadow-md transition-all flex items-start gap-4 cursor-pointer" onclick="openTaskGrade('${task.id}')">
          <div class="h-12 w-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
            <i data-lucide="file-text" class="w-6 h-6"></i>
          </div>
          <div class="flex-1">
            <h4 class="font-bold text-slate-800">${task.title}</h4>
            <p class="text-xs text-slate-500 mb-2">Vence: ${task.due}</p>
            <div class="flex items-center gap-2">
              <span class="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700 font-medium">Pendiente</span>
              <span class="text-xs text-slate-400">${task.submissions?.length || 0} Entregas</span>
            </div>
          </div>
        </div>
      `).join('');
    }
    if(window.lucide) lucide.createIcons();
  }

  window.openTaskGrade = async function(taskId) {
    // Logic to open grading modal
    const task = await KarpusStore.getTaskById(Number(taskId));
    if(task) {
      const modal = document.getElementById('modalGradeTask');
      const title = document.getElementById('gradeTaskTitle');
      const gradeList = document.getElementById('gradeList');
      
      if(title) title.textContent = task.title;
      
      // Populate grade list with mock submissions
      if(gradeList) {
         // Mock submissions data
         const submissions = [
            { student: 'Andrea Flores', status: 'entregado', file: 'tarea_mat.pdf', grade: '', feedback: '' },
            { student: 'Juan Pérez', status: 'pendiente', file: null, grade: '', feedback: '' },
            { student: 'Sofía López', status: 'entregado', file: 'ejercicios.jpg', grade: '20', feedback: 'Excelente trabajo' },
            { student: 'Carlos Ruiz', status: 'entregado', file: 'tarea_carlos.pdf', grade: '', feedback: '' }
         ];
         
         gradeList.innerHTML = submissions.map((sub, idx) => `
            <div class="border-b pb-3 last:border-0">
              <div class="flex justify-between items-start mb-2">
                <div>
                  <p class="font-bold text-slate-800 text-sm">${sub.student}</p>
                  <span class="text-xs px-2 py-0.5 rounded ${sub.status === 'entregado' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                    ${sub.status === 'entregado' ? 'Entregado' : 'Pendiente'}
                  </span>
                </div>
                ${sub.file ? `<a href="#" class="text-xs text-blue-600 hover:underline flex items-center gap-1"><i data-lucide="download" class="w-3 h-3"></i> ${sub.file}</a>` : ''}
              </div>
              
              ${sub.status === 'entregado' ? `
              <div class="grid grid-cols-3 gap-2 mt-2">
                <div class="col-span-1">
                  <label class="block text-xs text-slate-500 mb-1">Nota</label>
                  <input type="number" class="w-full border rounded p-1 text-sm" placeholder="0-20" value="${sub.grade}">
                </div>
                <div class="col-span-2">
                  <label class="block text-xs text-slate-500 mb-1">Comentario</label>
                  <input type="text" class="w-full border rounded p-1 text-sm" placeholder="Feedback..." value="${sub.feedback}">
                </div>
              </div>
              ` : '<p class="text-xs text-slate-400 italic">No se puede calificar aún.</p>'}
            </div>
         `).join('');
         
         if(window.lucide) lucide.createIcons();
      }
      
      if(modal) {
        modal.classList.add('active');
        document.body.classList.add('no-scroll');
      }
    }
  };

  // --- Tab Logic: Grades (Mock) ---
  async function renderClassGrades() {
    const tbody = document.getElementById('gradesTableBody');
    if(!tbody || !currentClass) return;

    // Cargar estudiantes reales de la base de datos para esta aula
    const { data: students, error } = await supabase
      .from('students')
      .select('*')
      .eq('classroom_id', currentClass.id);

    if (error) {
      console.error('Error cargando estudiantes para notas:', error);
      alert('Error de conexión al cargar estudiantes para notas: ' + error.message);
      return;
    }

    if (!students || students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">No hay estudiantes registrados en esta aula.</td></tr>';
      return;
    }

    tbody.innerHTML = students.map(s => {
      return `
        <tr class="hover:bg-slate-50">
          <td class="p-4 font-medium text-slate-800">${s.name}</td>
          <td class="p-4 text-center text-sm text-slate-600">-</td>
          <td class="p-4 text-center font-bold text-slate-600">-</td>
          <td class="p-4 text-sm text-slate-500">Sin notas registradas</td>
          <td class="p-4 text-right">
            <button class="text-slate-400 hover:text-karpus-blue"><i data-lucide="edit-3" class="w-4 h-4"></i></button>
            <button class="text-slate-400 hover:text-karpus-orange ml-2" title="Reportar comportamiento" onclick="openBehaviorReport('${s.name}')"><i data-lucide="alert-circle" class="w-4 h-4"></i></button>
          </td>
        </tr>
      `;
    }).join('');
    if(window.lucide) lucide.createIcons();
  }

  // --- Behavior Report Logic ---
  window.openBehaviorReport = function(studentName) {
      const modal = document.getElementById('modalBehaviorReport');
      const nameEl = document.getElementById('behaviorStudentName');
      if(nameEl) nameEl.textContent = studentName;
      // Limpiar campos
      document.getElementById('behaviorDesc').value = '';
      
      if(modal) {
          modal.classList.add('active');
          document.body.classList.add('no-scroll');
      }
  };

  document.getElementById('sendBehaviorReport')?.addEventListener('click', () => {
      const student = document.getElementById('behaviorStudentName').textContent;
      const type = document.getElementById('behaviorType').value;
      const desc = document.getElementById('behaviorDesc').value;
      
      alert(`Reporte enviado a los padres de ${student}.\nTipo: ${type}\nDetalle: ${desc}`);
      
      document.getElementById('modalBehaviorReport').classList.remove('active');
      document.body.classList.remove('no-scroll');
  });

  // --- Tab Logic: Private Chat (Dynamic) ---
  async function renderClassPrivateChat() {
    const listContainer = document.getElementById('privateChatList');
    if(!listContainer) return;

    // Implementar lógica de chat real con tabla 'messages'
    const parents = []; 

    listContainer.innerHTML = parents.map(p => `
       <div class="p-3 rounded-xl hover:bg-slate-50 cursor-pointer flex items-center gap-3 transition-colors" onclick="openPrivateChat('${p.id}')">
         <div class="relative">
           <div class="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
             ${(p.name || 'P').charAt(0)}
           </div>
           <span class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></span>
         </div>
         <div>
           <div class="font-bold text-slate-800 text-sm">${p.name}</div>
           <div class="text-xs text-slate-500 truncate w-32">Padre/Madre</div>
         </div>
       </div>
    `).join('');
    
    if(window.lucide) lucide.createIcons();
  }

  window.openPrivateChat = async function(contactId) {
    const contacts = await KarpusStore.getContacts();
    const contact = (contacts||[]).find(c => c.id === contactId);
    if(!contact) return;
    
    // Actualizar cabecera del chat
    const headerName = document.getElementById('privateChatHeaderName');
    const avatar = document.getElementById('privateChatAvatar');
    if(headerName) headerName.textContent = `${contact.name}`;
    if(avatar) avatar.textContent = (contact.name || 'C').charAt(0);
    
    // Guardar contacto actual globalmente para el envío
    window.currentChatContactId = contactId;

    // Cargar mensajes
    const thread = await KarpusStore.getThread(['maestra', contactId]);
    const chatArea = document.getElementById('privateChatMessages');
    
    if(chatArea) {
        chatArea.innerHTML = thread.messages.map(m => {
            const isMe = m.from === 'maestra';
            return `
                <div class="flex ${isMe ? 'justify-end' : 'justify-start'}">
                  <div class="${isMe ? 'bg-karpus-blue text-white rounded-tr-none' : 'bg-white border text-slate-700 rounded-tl-none'} rounded-2xl px-4 py-2 max-w-[80%] text-sm shadow-sm">
                    ${m.text}
                  </div>
                </div>
            `;
        }).join('');
        // Scroll al final
        chatArea.scrollTop = chatArea.scrollHeight;
    }
  };

  // Listener para enviar mensaje en el chat privado
  const privateChatSendBtn = document.getElementById('privateChatSendBtn');
  if(privateChatSendBtn) {
      privateChatSendBtn.addEventListener('click', async () => {
          const input = document.getElementById('privateChatInput');
          const text = input.value.trim();
          if(text && window.currentChatContactId) {
              await KarpusStore.sendMessage(['maestra', window.currentChatContactId], { from: 'maestra', text });
              input.value = '';
              await window.openPrivateChat(window.currentChatContactId);
          }
      });
  }

  // --- Tab Logic: Attendance (Mock) ---
  async function renderClassAttendance() {
    const container = document.getElementById('attendanceInterface');
    const dateDisplay = document.querySelector('.today-date-display');
    if(dateDisplay) dateDisplay.textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    if(!container) return;

    // Cargar estudiantes reales
    const { data: students, error } = await supabase
      .from('students')
      .select('*')
      .eq('classroom_id', currentClass.id);
    
    if (error) {
      console.error('Error cargando estudiantes para asistencia:', error);
      alert('Error de conexión al cargar estudiantes para asistencia: ' + error.message);
      return;
    }

    if (!students || students.length === 0) {
      container.innerHTML = '<div class="text-center py-8 text-slate-500">No hay estudiantes para tomar asistencia.</div>';
      return;
    }
    
    container.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-left" id="attendanceList">
        ${students.map(s => `
          <div class="flex items-center justify-between p-3 border rounded-xl bg-white shadow-sm student-row" data-student-id="${s.id}" data-status="present">
            <div class="flex items-center gap-3">
               <div class="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">
                 ${s.name.charAt(0)}
               </div>
               <span class="text-sm font-medium">${s.name}</span>
            </div>
            <div class="flex gap-1">
               <button class="att-btn p-1 rounded bg-green-100 text-green-600 ring-2 ring-green-500 ring-offset-1" data-type="present" title="Presente"><i data-lucide="check" class="w-4 h-4"></i></button>
               <button class="att-btn p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-600" data-type="absent" title="Ausente"><i data-lucide="x" class="w-4 h-4"></i></button>
               <button class="att-btn p-1 rounded hover:bg-yellow-50 text-slate-400 hover:text-yellow-600" data-type="late" title="Tardanza"><i data-lucide="clock" class="w-4 h-4"></i></button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="mt-6 flex justify-end">
         <button id="saveAttendanceBtn" class="px-6 py-2 bg-karpus-green text-white rounded-xl shadow-lg hover:shadow-xl transition-all font-semibold flex items-center gap-2">
           <i data-lucide="save" class="w-4 h-4"></i> Guardar Asistencia
         </button>
      </div>
    `;
    
    // Lógica de selección de estado
    const list = document.getElementById('attendanceList');
    if(list) {
      list.addEventListener('click', (e) => {
        const btn = e.target.closest('.att-btn');
        if(!btn) return;
        
        const row = btn.closest('.student-row');
        const type = btn.dataset.type;
        
        // Actualizar estado en el dataset
        row.dataset.status = type;
        
        // Actualizar estilos visuales
        const buttons = row.querySelectorAll('.att-btn');
        buttons.forEach(b => {
          // Resetear estilos base
          b.className = 'att-btn p-1 rounded text-slate-400 hover:bg-slate-100 transition-all';
          
          // Aplicar estilo activo si corresponde
          if(b.dataset.type === type) {
             if(type === 'present') b.className = 'att-btn p-1 rounded bg-green-100 text-green-600 ring-2 ring-green-500 ring-offset-1';
             if(type === 'absent') b.className = 'att-btn p-1 rounded bg-red-100 text-red-600 ring-2 ring-red-500 ring-offset-1';
             if(type === 'late') b.className = 'att-btn p-1 rounded bg-yellow-100 text-yellow-600 ring-2 ring-yellow-500 ring-offset-1';
          }
        });
      });
    }

    // Lógica del botón Guardar
    const saveBtn = document.getElementById('saveAttendanceBtn');
    if(saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const rows = document.querySelectorAll('.student-row');
        const attendanceData = [];
        
        rows.forEach(r => {
          attendanceData.push({
            student_id: r.dataset.studentId,
            classroom_id: currentClass.id,
            date: new Date().toISOString().split('T')[0],
            status: r.dataset.status
          });
        });
        
        // Guardar en Supabase (upsert para actualizar si ya existe hoy)
        const { error } = await supabase
          .from('attendance')
          .upsert(attendanceData, { onConflict: 'student_id, date' });

        if (error) {
          console.error('Error al guardar asistencia:', error);
          alert('Error de conexión al guardar asistencia: ' + error.message);
        } else {
          const present = attendanceData.filter(a => a.status === 'present').length;
          const absent = attendanceData.filter(a => a.status === 'absent').length;
          const late = attendanceData.filter(a => a.status === 'late').length;
          alert(`Asistencia guardada.\nPresentes: ${present}, Ausentes: ${absent}, Tardanzas: ${late}`);
        }
      });
    }

    if(window.lucide) lucide.createIcons();
  }

  // --- Action Handlers (New Post & Task) ---
  const submitPostBtn = document.getElementById('submitPost');
  if(submitPostBtn) {
    submitPostBtn.addEventListener('click', async () => {
      const contentInput = document.getElementById('postContent');
      const fileInput = document.getElementById('postFile'); // Asegúrate de agregar <input type="file" id="postFile"> en tu HTML
      
      const text = contentInput ? contentInput.value.trim() : '';
      const file = fileInput?.files[0];

      if ((!text && !file) || !currentClass) {
        alert('Escribe algo o adjunta un archivo para publicar.');
        return;
      }

      submitPostBtn.disabled = true;
      submitPostBtn.textContent = 'Publicando...';

      try {
        let mediaUrl = null;
        let mediaType = null;

        // 1. Subir archivo si existe
        if (file) {
          const fileExt = file.name.split('.').pop();
          const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
          const filePath = `${currentClass.id}/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from('classroom_media')
            .upload(filePath, file);

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from('classroom_media')
            .getPublicUrl(filePath);

          mediaUrl = publicUrl;
          
          if (file.type.startsWith('image/')) mediaType = 'image';
          else if (file.type.startsWith('video/')) mediaType = 'video';
          else mediaType = 'document';
        }

        // 2. Crear Post
        const { error: insertError } = await supabase.from('posts').insert({
          classroom_id: currentClass.id,
          teacher_id: user.id,
          content: text,
          media_url: mediaUrl,
          media_type: mediaType
        });

        if (insertError) throw insertError;

        // 3. Limpiar y recargar
        if(contentInput) contentInput.value = '';
        if(fileInput) fileInput.value = '';
      const modal = document.getElementById('modalAddPost');
      if(modal) { modal.classList.remove('active'); document.body.classList.remove('no-scroll'); }
      renderClassFeed();

      } catch (error) {
        console.error(error);
        alert('Error al publicar: ' + error.message);
      } finally {
        submitPostBtn.disabled = false;
        submitPostBtn.textContent = 'Publicar';
      }
    });
  }

  const submitTaskBtn = document.getElementById('submitTask');
  if(submitTaskBtn) {
    submitTaskBtn.addEventListener('click', () => {
      alert('Creación de tareas aún no disponible con datos reales.');
      const modal = document.getElementById('modalCreateTask');
      if(modal) { modal.classList.remove('active'); document.body.classList.remove('no-scroll'); }
      renderClassTasks();
    });
  }

  // --- Initial Render ---
  renderClassesGrid();
  // Ensure we start at home
  const homeBtn = document.querySelector('[data-section="t-home"]');
  if(homeBtn) {
    homeBtn.classList.add('bg-white/20', 'active');
    homeBtn.setAttribute('aria-selected', 'true');
  }

  // --- Modal Helpers (Preserved) ---
  function bindModal(openId, modalId, closeIds = []) {
    const openBtn = document.getElementById(openId);
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const closeButtons = closeIds.map(id => document.getElementById(id)).filter(Boolean);

    function open() {
      modal.classList.add('active');
      document.body.classList.add('no-scroll');
    }
    function close() {
      modal.classList.remove('active');
      document.body.classList.remove('no-scroll');
    }
    if (openBtn) openBtn.addEventListener('click', open);
    closeButtons.forEach(btn => btn.addEventListener('click', close));
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  }

  bindModal('openAddPost', 'modalAddPost', ['closeAddPost']);
  bindModal('openCreateTask', 'modalCreateTask', ['closeCreateTask']);
  bindModal('openViewParents', 'modalViewParents', ['closeViewParents']);
  bindModal('openCalendar', 'modalCalendar', ['closeCalendar']);
  bindModal('openMessage', 'modalMessage', ['closeMessage']);
  bindModal('openExport', 'modalExport', ['closeExport']);
  
  bindModal(undefined, 'modalBehaviorReport', ['closeBehaviorReport']);
  // Grade modal logic handled by window.openTaskGrade
  bindModal(undefined, 'modalGradeTask', ['closeGradeTask']);

  if(window.lucide) lucide.createIcons();
}); // Fin de DOMContentLoaded
