// Data simulada
const teacherData = {
  name: 'Ana Pérez',
  classroom: 'Pequeños',
  students: [
    { id: 1, name: 'Carlos M.', attendance: true },
    { id: 2, name: 'María P.', attendance: true },
    { id: 3, name: 'Juan R.', attendance: false }
  ]
};

// Navegación
document.querySelectorAll('.t-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('[id^="t-"]').forEach(section => {
      section.classList.add('hidden');
    });
    document.getElementById(`t-${tab}`).classList.remove('hidden');
    
    // Actualizar botones
    document.querySelectorAll('.t-btn').forEach(b => {
      b.classList.remove('text-karpus-blue');
    });
    btn.classList.add('text-karpus-blue');
  });
});

// Dashboard
function updateDashboard() {
  const summary = [
    { title: 'Niños presentes', value: '15/18', color: 'green' },
    { title: 'Tareas pendientes', value: '3', color: 'orange' },
    { title: 'Mensajes nuevos', value: '2', color: 'pink' }
  ];
  
  const dashboardEl = document.getElementById('dashboardSummary');
  dashboardEl.innerHTML = summary.map(item => `
    <div class="p-3 rounded-2xl bg-white border">
      <p class="text-sm text-slate-600">${item.title}</p>
      <p class="text-lg font-semibold text-karpus-${item.color}">${item.value}</p>
    </div>
  `).join('');
}

// Gráfica de asistencia
function initAttendanceChart() {
  const ctx = document.getElementById('attendanceChartTeacher')?.getContext('2d');
  if (ctx) {
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['Lun', 'Mar', 'Mie', 'Jue', 'Vie'],
        datasets: [{
          label: 'Asistencia',
          data: [15, 16, 14, 15, 15],
          borderColor: '#2196F3',
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, max: 20 } }
      }
    });
  }
}

// Posts del aula
function loadClassroomPosts() {
  const posts = [
    { text: 'Actividad de pintura', photo: 'foto1.jpg', date: '24 Oct' },
    { text: 'Juegos matemáticos', photo: 'foto2.jpg', date: '23 Oct' }
  ];
  
  const feedEl = document.getElementById('classroomFeed');
  feedEl.innerHTML = posts.map(post => `
    <div class="p-4 rounded-3xl bg-white border">
      <div class="flex justify-between items-center mb-2">
        <p class="text-sm font-medium">${teacherData.name}</p>
        <span class="text-xs text-slate-500">${post.date}</span>
      </div>
      <p class="text-sm">${post.text}</p>
      ${post.photo ? `<img src="${post.photo}" class="w-full h-40 object-cover rounded-xl mt-2" />` : ''}
    </div>
  `).join('');
}

// Tareas
function loadTasks() {
  const tasks = [
    { title: 'Colorear formas', due: '28 Oct', status: 'pendiente' },
    { title: 'Números del 1-10', due: '27 Oct', status: 'completada' }
  ];
  
  const tasksEl = document.getElementById('taskList');
  tasksEl.innerHTML = tasks.map(task => `
    <div class="p-4 rounded-3xl bg-white border">
      <div class="flex justify-between items-center">
        <div>
          <h4 class="text-sm font-medium">${task.title}</h4>
          <p class="text-xs text-slate-500">Entrega: ${task.due}</p>
        </div>
        <span class="text-xs px-2 py-1 rounded-xl ${
          task.status === 'completada' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
        }">${task.status}</span>
      </div>
    </div>
  `).join('');
}

// Asistencia
function loadAttendance() {
  const attendanceEl = document.getElementById('attendanceList');
  attendanceEl.innerHTML = teacherData.students.map(student => `
    <div class="p-3 rounded-2xl bg-white border flex justify-between items-center">
      <p class="text-sm">${student.name}</p>
      <label class="relative inline-flex items-center cursor-pointer">
        <input type="checkbox" class="sr-only peer" ${student.attendance ? 'checked' : ''}>
        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
      </label>
    </div>
  `).join('');
}

// Modal handlers
function setupModals() {
  const modals = {
    'addPost': ['openAddPost', 'closeAddPost', 'modalAddPost'],
    'createTask': ['openCreateTask', 'closeCreateTask', 'modalCreateTask'],
    'sendNotification': ['openSendNotification', 'closeSendNotification', 'modalSendNotification'],
    'viewParents': ['openViewParents', 'closeViewParents', 'modalViewParents'],
    'calendar': ['openCalendar', 'closeCalendar', 'modalCalendar'],
    'message': ['openMessage', 'closeMessage', 'modalMessage'],
    'export': ['openExport', 'closeExport', 'modalExport']
  };
  
  Object.entries(modals).forEach(([key, [openId, closeId, modalId]]) => {
    const openBtn = document.getElementById(openId);
    const closeBtn = document.getElementById(closeId);
    const modal = document.getElementById(modalId);
    
    if (openBtn && closeBtn && modal) {
      openBtn.onclick = () => modal.classList.remove('hidden');
      closeBtn.onclick = () => modal.classList.add('hidden');
    }
  });
}

// Submit handlers
document.getElementById('submitPost')?.addEventListener('click', () => {
  const text = document.getElementById('postText').value;
  if (text) {
    // Agregar post al feed
    const feedEl = document.getElementById('classroomFeed');
    const newPost = document.createElement('div');
    newPost.className = 'p-4 rounded-3xl bg-white border';
    newPost.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <p class="text-sm font-medium">${teacherData.name}</p>
        <span class="text-xs text-slate-500">Ahora</span>
      </div>
      <p class="text-sm">${text}</p>
    `;
    feedEl.prepend(newPost);
    
    // Limpiar y cerrar modal
    document.getElementById('postText').value = '';
    document.getElementById('modalAddPost').classList.add('hidden');
  }
});

document.getElementById('submitTask')?.addEventListener('click', () => {
  const title = document.getElementById('taskTitle').value;
  const due = document.getElementById('taskDue').value;
  if (title && due) {
    // Agregar tarea a la lista
    const tasksEl = document.getElementById('taskList');
    const newTask = document.createElement('div');
    newTask.className = 'p-4 rounded-3xl bg-white border';
    newTask.innerHTML = `
      <div class="flex justify-between items-center">
        <div>
          <h4 class="text-sm font-medium">${title}</h4>
          <p class="text-xs text-slate-500">Entrega: ${due}</p>
        </div>
        <span class="text-xs px-2 py-1 rounded-xl bg-orange-100 text-orange-700">pendiente</span>
      </div>
    `;
    tasksEl.prepend(newTask);
    
    // Limpiar y cerrar modal
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDue').value = '';
    document.getElementById('modalCreateTask').classList.add('hidden');
  }
});

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
  updateDashboard();
  initAttendanceChart();
  loadClassroomPosts();
  loadTasks();
  loadAttendance();
  setupModals();
});