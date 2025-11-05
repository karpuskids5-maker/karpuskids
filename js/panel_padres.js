document.addEventListener('DOMContentLoaded', ()=>{ 
  // Init lucide icons
  if(window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
  
  // Load saved theme
  const savedColor = localStorage.getItem('karpus_parent_theme') || 'blue';
  document.getElementById('sidebar').className = 
    document.getElementById('sidebar').className.replace(/sidebar-\w+/, `sidebar-${savedColor}`);
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

// Theme color switching
document.querySelectorAll('[data-color]').forEach(btn => {
  btn.addEventListener('click', ()=>{
    const color = btn.getAttribute('data-color');
    const sb = document.getElementById('sidebar');
    if(sb && color) {
      sb.className = sb.className.replace(/sidebar-\w+/, `sidebar-${color}`);
      localStorage.setItem('karpus_parent_theme', color);
    }
  });
});

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

// Gráfica de asistencia (igual estilo que Maestra)
const ctx = document.getElementById('attendanceChart')?.getContext('2d');
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

// Función para enviar mensaje a la maestra
function enviarMensajeAMaestra() {
  const mensaje = document.getElementById('mensaje-maestra').value;
  if (!mensaje.trim()) {
    mostrarNotificacion('Por favor, escribe un mensaje', 'error');
    return;
  }
  
  // Aquí se enviaría el mensaje a la maestra
  console.log('Mensaje enviado a la maestra:', mensaje);
  
  // Añadir mensaje al historial de comunicación
  const historialMensajes = document.getElementById('historial-mensajes');
  const fechaHora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  
  const nuevoMensaje = document.createElement('div');
  nuevoMensaje.className = 'teams-message teams-message-mine fade-in';
  nuevoMensaje.innerHTML = `
    <div class="teams-message-content">
      <div class="teams-message-sender">Tú</div>
      <div>${mensaje}</div>
      <div class="teams-message-time">${fechaHora}</div>
    </div>
    <div class="teams-message-avatar">
      <img src="img/avatar-padre.jpg" alt="Tu avatar" class="avatar">
    </div>
  `;
  
  historialMensajes.appendChild(nuevoMensaje);
  historialMensajes.scrollTop = historialMensajes.scrollHeight;
  
  // Mostrar notificación
  mostrarNotificacion('Mensaje enviado correctamente', 'success');
  
  // Limpiar campo
  document.getElementById('mensaje-maestra').value = '';
  
  // Simular respuesta de la maestra después de 3 segundos
  setTimeout(() => {
    const respuestaMaestra = document.createElement('div');
    respuestaMaestra.className = 'teams-message fade-in';
    respuestaMaestra.innerHTML = `
      <div class="teams-message-avatar">
        <img src="img/avatar-maestra.jpg" alt="Avatar maestra" class="avatar">
      </div>
      <div class="teams-message-content">
        <div class="teams-message-sender">Maestra Lucía</div>
        <div>Gracias por tu mensaje. Lo revisaré pronto.</div>
        <div class="teams-message-time">${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    `;
    historialMensajes.appendChild(respuestaMaestra);
    historialMensajes.scrollTop = historialMensajes.scrollHeight;
  }, 3000);
}

// Función para mostrar notificaciones
function mostrarNotificacion(mensaje, tipo) {
  const notificacion = document.createElement('div');
  notificacion.className = `fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg z-50 ${
    tipo === 'success' ? 'bg-karpus-green text-white' : 'bg-red-500 text-white'
  }`;
  notificacion.textContent = mensaje;
  document.body.appendChild(notificacion);
  
  setTimeout(() => {
    notificacion.classList.add('opacity-0', 'transition-opacity', 'duration-500');
    setTimeout(() => notificacion.remove(), 500);
  }, 3000);
}

// Abrir en Inicio por defecto
showTab('home');