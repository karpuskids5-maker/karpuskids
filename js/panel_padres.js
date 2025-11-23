document.addEventListener('DOMContentLoaded', ()=>{ 
  // Init lucide icons
  if(window.lucide) lucide.replace(); 
});

// Toggle sidebar collapse
let isSidebarCollapsed = false;
document.getElementById('toggleSidebar')?.addEventListener('click', ()=>{
  const sb = document.getElementById('sidebar');
  if(sb) {
    isSidebarCollapsed = !isSidebarCollapsed;
    sb.classList.toggle('collapsed', isSidebarCollapsed);
  }
});

// Lógica de cambio de color eliminada: sidebar único

// Navegación por secciones
document.querySelectorAll('[data-section]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const target = btn.getAttribute('data-section');
    document.querySelectorAll('section').forEach(s=> s.classList.add('hidden'));
    document.querySelectorAll('[data-section]').forEach(b => 
      b.classList.toggle('text-blue-600', b.getAttribute('data-section') === target));
    const el = document.getElementById('tab-' + target);
    if(el) el.classList.remove('hidden');
  });
});

// Navegación móvil
const tabButtons = document.querySelectorAll('.tab-btn');
const tabs = {
  home: document.getElementById('tab-home'),
  class: document.getElementById('tab-class'),
  tasks: document.getElementById('tab-tasks'),
  notifications: document.getElementById('tab-notifications'),
  profile: document.getElementById('tab-profile')
};
function showTab(name) {
  Object.values(tabs).forEach(el => el.classList.add('hidden'));
  tabs[name].classList.remove('hidden');
  tabButtons.forEach(btn => btn.classList.toggle('text-slate-500', btn.dataset.tab !== name));
}
tabButtons.forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

// Mobile menu
document.getElementById('menuBtn')?.addEventListener('click', ()=>{
  const sb = document.getElementById('sidebar');
  if(sb) sb.classList.toggle('hidden');
});

// Chart de asistencia y progreso
const ctx = document.getElementById('attendanceChart');
if (ctx) {
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Lun', 'Mar', 'Mie', 'Jue', 'Vie'],
      datasets: [
        {
          label: 'Asistencia',
          data: [1, 1, 1, 0, 1],
          backgroundColor: '#2196F3',
          borderRadius: 6
        },
        {
          label: 'Participación',
          data: [0.8, 0.9, 0.7, 0, 0.85],
          backgroundColor: '#4CAF50',
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

// Modal estadísticas
const openStats = document.getElementById('openStats');
const closeStats = document.getElementById('closeStats');
const modalStats = document.getElementById('modalStats');
if (openStats && closeStats && modalStats) {
  openStats.onclick = () => modalStats.classList.remove('hidden');
  closeStats.onclick = () => modalStats.classList.add('hidden');
}

// Feed general
const feed = [
  { title: 'Día de juegos', content: 'Mañana tendremos actividades al aire libre.', date: '24 Oct', from: 'Dirección' },
  { title: 'Recordatorio de pago', content: 'El pago vence el 30 de Oct.', date: '23 Oct', from: 'Administración' }
];
const feedEl = document.getElementById('feed');
if (feedEl) {
  feedEl.innerHTML = '';
  feed.forEach(m => {
    const card = document.createElement('div');
    card.className = 'p-4 rounded-3xl bg-slate-50 shadow-soft';
    card.innerHTML = `<div class='flex justify-between items-center mb-1'><h4 class='text-sm font-semibold'>${m.title}</h4><span class='text-xs text-slate-500'>${m.date}</span></div><p class='text-sm text-slate-700'>${m.content}</p><p class='text-xs text-slate-500 mt-2'>${m.from}</p>`;
    feedEl.appendChild(card);
  });
}

// Aula publicaciones
const classPosts = [
  { teacher: 'Sofía Gómez', date: '24 Oct', photo: 'https://placehold.co/600x400', text: 'Actividad sensorial con colores.' }
];
const classFeedEl = document.getElementById('classFeed');
if (classFeedEl) {
  classFeedEl.innerHTML = '';
  classPosts.forEach(p => {
    const card = document.createElement('div');
    card.className = 'rounded-3xl overflow-hidden bg-white border';
    card.innerHTML = `
      <img src='${p.photo}' class='w-full h-40 object-cover' />
      <div class='p-3'>
        <div class='flex items-center justify-between mb-1'>
          <p class='text-sm font-semibold'>${p.teacher}</p>
          <span class='text-xs text-slate-500'>${p.date}</span>
        </div>
        <p class='text-sm text-slate-700 mb-2'>${p.text}</p>
        <div class='flex gap-2'>
          <button class='text-xs px-3 py-1 rounded-xl bg-pink-50 text-karpus-pink'>❤️ Me gusta</button>
          <button class='text-xs px-3 py-1 rounded-xl bg-pink-50 text-karpus-pink'>💖 Me encanta</button>
        </div>
      </div>`;
    classFeedEl.appendChild(card);
  });
}

// Tareas
const tasks = [
  { title: 'Colorear formas', desc: 'Usar colores primarios.', due: '28 Oct', score: null },
  { title: 'Canción de vocales', desc: 'Grabar un video corto.', due: '29 Oct', score: 9 }
];
const tasksEl = document.getElementById('tasksList');
if (tasksEl) {
  tasksEl.innerHTML = '';
  tasks.forEach(t => {
    const card = document.createElement('div');
    card.className = 'p-4 rounded-3xl bg-slate-50 shadow-soft';
    card.innerHTML = `
      <div class='flex justify-between items-center mb-1'>
        <h4 class='text-sm font-semibold'>${t.title}</h4>
        <span class='text-xs text-slate-500'>Entrega: ${t.due}</span>
      </div>
      <p class='text-sm text-slate-700 mb-2'>${t.desc}</p>
      <div class='flex items-center justify-between'>
        <button class='text-xs px-3 py-1 rounded-xl bg-karpus-orange text-white'>Enviar tarea</button>
        <span class='text-xs ${t.score? 'text-green-600' : 'text-slate-500'}'>${t.score? 'Calificación: '+t.score+'/10' : 'Pendiente de calificar'}</span>
      </div>`;
    tasksEl.appendChild(card);
  });
}

// Notificaciones
const notifications = [
  { type: 'task', text: 'Nueva tarea publicada', action: 'Ir a tarea', color: '#FF9800' },
  { type: 'class', text: 'Publicación nueva en el aula', action: 'Ver publicación', color: '#4CAF50' },
  { type: 'payment', text: 'Pago pendiente', action: 'Ir a pagos', color: '#2196F3' }
];
const notifEl = document.getElementById('notificationsList');
if (notifEl) {
  notifEl.innerHTML = '';
  notifications.forEach(n => {
    const card = document.createElement('div');
    card.className = 'p-3 rounded-2xl bg-white border flex items-center justify-between';
    card.innerHTML = `
      <div class='flex items-center gap-3'>
        <div class='w-8 h-8 rounded-xl' style='background:${n.color}20'></div>
        <p class='text-sm'>${n.text}</p>
      </div>
      <button class='text-xs px-3 py-1 rounded-xl bg-slate-100'>${n.action}</button>`;
    notifEl.appendChild(card);
  });
}

// Modales de tareas y aula
const modalSubmitTask = document.getElementById('modalSubmitTask');
const openSubmitTask = document.getElementById('openSubmitTask');
const closeSubmitTask = document.getElementById('closeSubmitTask');
if (modalSubmitTask && openSubmitTask && closeSubmitTask) {
  openSubmitTask.onclick = () => modalSubmitTask.classList.remove('hidden');
  closeSubmitTask.onclick = () => modalSubmitTask.classList.add('hidden');
}

const modalClassInfo = document.getElementById('modalClassInfo');
const openClassInfo = document.getElementById('openClassInfo');
const closeClassInfo = document.getElementById('closeClassInfo');
if (modalClassInfo && openClassInfo && closeClassInfo) {
  openClassInfo.onclick = () => modalClassInfo.classList.remove('hidden');
  closeClassInfo.onclick = () => modalClassInfo.classList.add('hidden');
}

// Logout (placeholder)
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.onclick = () => alert('Sesión cerrada (placeholder)');
}

// Abrir en Inicio por defecto
showTab('home');