// director.js
// Lógica separada para el Panel Directora — Karpus Kids

// --- Utilidades ---
const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

// Inicialización del panel Directora
document.addEventListener('DOMContentLoaded', ()=>{
  // Enforce role without inline script
  // if (window.Auth && !Auth.enforceRole('directora')) return; // REMOVED: Using Supabase Auth in app.js
  initDashboardChart();
  attachPaymentsHandlers();
  attachCommunicationsHandlers();
  initNavDirector();
  initStudentController();
  // initTeacherModule(); // REMOVED: Managed by app.js (Supabase)
  // initRoomsModule();   // REMOVED: Managed by app.js (Supabase)
  adjustMainOffset();
  window.addEventListener('resize', adjustMainOffset);
  const dash = document.getElementById('dashboard');
  if (dash) dash.classList.remove('hidden');
});

// --- Chart demo ---
function initDashboardChart(){
  const canvas = document.getElementById('attendanceChart');
  if(!canvas) return;

  // Destruir instancia previa si existe (para evitar superposiciones al recargar)
  if (window.dashboardChartInstance) {
    window.dashboardChartInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  
  // Crear degradado para el fondo de la línea
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(37, 99, 235, 0.2)'); // Azul intenso transparente
  gradient.addColorStop(1, 'rgba(37, 99, 235, 0)');   // Transparente

  window.dashboardChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
      datasets: [{
        label: 'Asistencia (%)',
        data: [92, 94, 89, 96, 91, 93, 95], // Datos de ejemplo
        borderColor: '#2563eb', // Blue-600
        backgroundColor: gradient,
        borderWidth: 3,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#2563eb',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: true,
        tension: 0.4 // Curva suave (Bezier)
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          padding: 12,
          titleFont: { size: 13, family: "'Nunito', sans-serif" },
          bodyFont: { size: 13, family: "'Nunito', sans-serif" },
          displayColors: false,
          callbacks: {
            label: (context) => ` ${context.parsed.y}% Asistencia`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          min: 80,
          max: 100,
          grid: {
            color: '#f1f5f9',
            borderDash: [5, 5]
          },
          ticks: {
            font: { size: 11, family: "'Nunito', sans-serif" },
            color: '#64748b'
          }
        },
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 11, family: "'Nunito', sans-serif" },
            color: '#64748b'
          }
        }
      }
    }
  });
}

// --- Pagos: handlers ---
function attachPaymentsHandlers(){
  // Recordatorio individual
  qsa('.sendReminder').forEach(btn=> btn.addEventListener('click', (e)=>{
    const tr = e.target.closest('tr');
    if(!tr) return;
    const student = tr.children[0].innerText;
    const parent = tr.children[1].innerText;
    // Simulación: abrir modal para confirmar envío
    openModal(`Recordatorio de pago`, `Enviar recordatorio a <strong>${parent}</strong> por el alumno <strong>${student}</strong>?`, [
      {text:'Cancelar', type:'secondary'},
      {text:'Enviar', type:'primary', onClick: ()=>{ alert(`Recordatorio enviado (simulado) a ${parent}`); closeModal(); }}
    ]);
  }));

  // Marcar pagado
  qsa('.markPaid').forEach(btn=> btn.addEventListener('click', (e)=>{
    const tr = e.target.closest('tr');
    if(!tr) return;
    tr.querySelector('td:nth-child(6)').innerText = 'Pagado';
    tr.querySelector('td:nth-child(6)').className = 'text-green-600';
    alert('Pago marcado como pagado (simulado). Actualiza backend para persistir.');
  }));

  // Filtro por aula
  const filtroAula = qs('#filterPagoAula');
  if (filtroAula) filtroAula.addEventListener('change', (e)=>{
    const val = e.target.value;
    qsa('#paymentsTable tr').forEach(tr=>{
      if(val==='all' || tr.dataset.aula===val) tr.style.display=''; else tr.style.display='none';
    });
  });

  // Recordatorio masivo
  const batchBtn = qs('#sendBatchReminder');
  if (batchBtn) batchBtn.addEventListener('click', ()=>{
    const aula = qs('#filterPagoAula')?.value || 'all';
    openModal('Recordatorio masivo', `Enviar recordatorio de pago a aula: <strong>${aula}</strong>?`, [
      {text:'Cancelar', type:'secondary'},
      {text:'Enviar a todos', type:'primary', onClick: ()=>{ alert('Recordatorios masivos enviados (simulado).'); closeModal(); }}
    ]);
  });
}

// --- Comunicaciones / publicaciones ---
function attachCommunicationsHandlers(){
  const newPostBtn = qs('#newPostBtn');
  if (newPostBtn) newPostBtn.addEventListener('click', ()=> openPostModal());
  const newMsgBtn = qs('#newMessageBtn');
  if (newMsgBtn) newMsgBtn.addEventListener('click', ()=> openMessageModal());
  const filterPub = qs('#filterPubAula');
  if (filterPub) filterPub.addEventListener('change', ()=> filterPosts());
}

function openPostModal(){
  const body = `
    <div class="grid gap-3">
      <input id="postTitle" placeholder="Título" class="border rounded px-3 py-2" />
      <textarea id="postBody" placeholder="Descripción" class="border rounded px-3 py-2" rows="4"></textarea>
      <label class="text-sm">Adjuntar archivo (foto/video/pdf/doc/excel)</label>
      <input id="postFile" type="file" class="border rounded px-2 py-1" />
      <label class="text-sm">Enviar a:</label>
      <select id="postTarget" class="border rounded px-2 py-1">
        <option value="all">Todos los padres</option>
        <option value="A1">Aula A1</option>
        <option value="A2">Aula A2</option>
      </select>
    </div>
  `;
  openModal('Crear publicación', body, [
    {text:'Cancelar', type:'secondary'},
    {text:'Publicar', type:'primary', onClick: ()=>{
      // tomar datos (simulado)
      const title = qs('#postTitle').value || 'Sin título';
      const body = qs('#postBody').value || '';
      const target = qs('#postTarget').value || 'all';
      // Agregar a lista local
      addPostToList({title, body, target, when:'Ahora'});
      closeModal();
    }}
  ]);
}

function openMessageModal(){
  const body = `
    <div class="grid gap-3">
      <textarea id="msgBody" placeholder="Escribe tu mensaje..." class="border rounded px-3 py-2" rows="4"></textarea>
      <label class="text-sm">Enviar a:</label>
      <select id="msgTarget" class="border rounded px-2 py-1">
        <option value="all">Todos los padres</option>
        <option value="A1">Aula A1</option>
        <option value="A2">Aula A2</option>
        <option value="parent1">Padre Rosa P.</option>
        <option value="parent2">Padre Carlos R.</option>
      </select>
    </div>
  `;
  openModal('Nuevo mensaje', body, [
    {text:'Cancelar', type:'secondary'},
    {text:'Enviar', type:'primary', onClick: ()=>{
      const msg = qs('#msgBody').value || '';
      const target = qs('#msgTarget').value || 'all';
      alert(`Mensaje enviado (simulado) a ${target}: ${msg.substring(0,80)}${msg.length>80? '...':''}`);
      closeModal();
    }}
  ]);
}

function addPostToList(post){
  const title = post?.title || 'Sin título';
  const body = post?.body || '';
  const target = post?.target || 'all';
  const when = post?.when || '';
  const container = qs('#postsList');
  const el = document.createElement('div');
  el.className = 'p-3 border rounded';
  el.innerHTML = `<div class="flex items-center justify-between"><strong>${title}</strong><span class="text-xs text-slate-500">${when}</span></div><p class="text-sm text-slate-600 mt-1">${body}</p><div class="mt-2 flex gap-2 text-xs"><button class="px-2 py-1 border rounded">Ver</button><button class="px-2 py-1 border rounded">Compartir</button></div>`;
  container.prepend(el);
}

function filterPosts(){
  const val = qs('#filterPubAula')?.value || 'all';
  // Demo: no etiquetas en posts, pero aquí iría la lógica para mostrar u ocultar
  // Para ahora, sólo mostramos un mensaje de filtro aplicado
  console.log('Filtrando publicaciones por:', val);
}

// --- Responsive improvement: collapse long tables into cards on small screens (simple example) ---
window.addEventListener('resize', ()=> adaptTablesToMobile());
function adaptTablesToMobile(){
  const isMobile = window.innerWidth < 640;
  qsa('#paymentsTable tr').forEach(tr=>{
    if(isMobile){
      tr.style.display = 'block';
      tr.style.borderBottom = '1px solid #eee';
      tr.querySelectorAll('td').forEach(td=> td.style.display='block');
    } else {
      tr.style.display = '';
      tr.querySelectorAll('td').forEach(td=> td.style.display='');
    }
  });
}
adaptTablesToMobile();

// --- Fin del archivo ---

// =============================
// Navegación lateral de secciones
// =============================
function initNavDirector(){
  const buttons = qsa('#sidebar .nav-btn[data-section]');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-section');
      if (!id) return;
      // marcar activo
      buttons.forEach(b => b.classList.toggle('active', b === btn));
      // show/hide sections
      qsa('main .section').forEach(s => s.classList.add('hidden'));
      const target = document.getElementById(id);
      if (target) target.classList.remove('hidden');
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(e){}
    });
  });
}

// =============================
// Estudiantes: perfil, búsqueda y alta
// =============================
function initStudentController(){
  // ABRIR PERFIL DE ESTUDIANTE
  document.getElementById('studentsTable').addEventListener('click', (event) => {
    const viewButton = event.target.closest('.view-profile-btn');
    if (viewButton) {
      const studentId = viewButton.getAttribute('data-student-id');
      if (studentId) {
        if (typeof window.openStudentProfile === 'function') {
          window.openStudentProfile(studentId);
        } else {
          console.error('Error: openStudentProfile no está definida en window. Asegúrese de que app.js se ha cargado correctamente.');
          alert('Error interno: No se pudo abrir el perfil. Función no encontrada.');
        }
      }
    }
  });

  // CERRAR PERFIL
  const closeModalButtons = qsa('#closeStudentProfile, #closeStudentProfileModal');
  closeModalButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      qs('#studentProfileModal').classList.add('hidden');
    });
  });

  // LÓGICA DE BÚSQUEDA
  const searchInput = document.getElementById('searchStudent');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      const query = this.value.toLowerCase().trim();
      qsa('#studentsTable tr').forEach(row => {
        const name = row.querySelector('.font-medium')?.textContent.toLowerCase() || '';
        row.style.display = name.includes(query) ? '' : 'none';
      });
    });
  }

  // GESTIÓN DEL MODAL PARA AGREGAR ESTUDIANTE
  const addStudentBtn = document.getElementById('addStudentBtn');
  if (addStudentBtn) {
    addStudentBtn.addEventListener('click', () => {
      qs('#modalAddStudent').classList.remove('hidden');
    });
  }

  const cancelStudentBtn = document.getElementById('btnCancelStudent');
  if (cancelStudentBtn) {
    cancelStudentBtn.addEventListener('click', () => {
      qs('#modalAddStudent').classList.add('hidden');
      clearStudentModal();
    });
  }

  // GUARDAR NUEVO ESTUDIANTE (ya implementado en app.js, no se duplica aquí)
}

function clearStudentModal(){
  ['stName','stAge','stSchedule','p1Name','p1Phone','p2Name','p2Phone', 'stAllergies', 'stBlood', 'stPickup'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  const ch = document.getElementById('stActive'); 
  if(ch) ch.checked = true;
}

// La función openStudentProfile se ha movido a app.js para usar la conexión Supabase

// Ajuste dinámico del offset superior para evitar espacio vacío cuando hay header fijo
function adjustMainOffset(){
  const mainEl = document.querySelector('main');
  if(!mainEl) return;
  const fixedTop = document.querySelector('.fixed.top-0, header.fixed, .md\\:hidden.fixed, .mobile-fixed-top');
  if(fixedTop && fixedTop.offsetHeight){
    mainEl.style.marginTop = fixedTop.offsetHeight + 'px';
  } else {
    mainEl.style.marginTop = '';
  }
}

function initTeacherModule(){
  const openBtn = document.getElementById('openTeacherModalBtn');
  const modal = document.getElementById('teacherModal');
  const overlay = document.getElementById('teacherModalOverlay');
  const closeBtn = document.getElementById('closeTeacherModalBtn');
  const saveBtn = document.getElementById('saveTeacherBtn');
  const nameInput = document.getElementById('teacherName');
  const emailInput = document.getElementById('teacherEmail');
  const passInput = document.getElementById('teacherPassword');
  const confirmInput = document.getElementById('teacherConfirmPassword');
  const table = document.getElementById('teachersTable');

  if(!table) return;
  const state = (window.DirectorData ||= {});
  state.teachers ||= [];
  let editingId = null;

  const open = ()=>{ if(modal){ modal.classList.remove('hidden'); } if(overlay){ overlay.classList.remove('hidden'); } };
  const close = ()=>{ if(modal){ modal.classList.add('hidden'); } if(overlay){ overlay.classList.add('hidden'); } clear(); editingId=null; };
  const clear = ()=>{ [nameInput,emailInput,passInput,confirmInput].forEach(el=>{ if(el) el.value=''; }); };
  const render = ()=>{
    if(!table) return;
    const oldTbody = table.querySelector('tbody');
    if(oldTbody) oldTbody.remove();
    const tbody = document.createElement('tbody');
    state.teachers.forEach(t=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-3 py-2 text-sm">${t.name}</td>
        <td class="px-3 py-2 text-sm">${t.email}</td>
        <td class="px-3 py-2 text-right">
          <button class="px-2 py-1 border rounded text-xs" onclick="editTeacher('${t.id}')">Editar</button>
          <button class="px-2 py-1 border rounded text-xs" onclick="deleteTeacher('${t.id}')">Eliminar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  };

  const save = ()=>{
    const name = nameInput?.value?.trim();
    const email = emailInput?.value?.trim();
    const pass = passInput?.value || '';
    const confirm = confirmInput?.value || '';
    if(!name || !email) return;
    if(pass !== confirm){ return; }
    if(editingId){
      const idx = state.teachers.findIndex(x=>x.id===editingId);
      if(idx>=0){ state.teachers[idx] = { ...state.teachers[idx], name, email }; }
    } else {
      const id = 't_'+Date.now();
      state.teachers.push({ id, name, email });
    }
    render();
    close();
  };

  if(openBtn) openBtn.addEventListener('click', open);
  if(closeBtn) closeBtn.addEventListener('click', close);
  if(overlay) overlay.addEventListener('click', close);
  if(saveBtn) saveBtn.addEventListener('click', save);

  window.editTeacher = function(id){
    const t = state.teachers.find(x=>x.id===id);
    if(!t) return;
    editingId = id;
    if(nameInput) nameInput.value = t.name || '';
    if(emailInput) emailInput.value = t.email || '';
    open();
  };
  window.deleteTeacher = function(id){
    state.teachers = state.teachers.filter(x=>x.id!==id);
    render();
  };

  render();
}

function initRoomsModule(){
  const openBtn = document.getElementById('openRoomModalBtn');
  const modal = document.getElementById('roomModal');
  const overlay = document.getElementById('roomModalOverlay');
  const closeBtn = document.getElementById('closeRoomModalBtn');
  const saveBtn = document.getElementById('saveRoomBtn');
  const nameInput = document.getElementById('roomName');
  const teacherInput = document.getElementById('roomTeacher');
  const capacityInput = document.getElementById('roomCapacity');
  const table = document.getElementById('roomsTable');

  if(!table) return;
  const state = (window.DirectorData ||= {});
  state.rooms ||= [];
  let editingId = null;

  const open = ()=>{ if(modal){ modal.classList.remove('hidden'); } if(overlay){ overlay.classList.remove('hidden'); } };
  const close = ()=>{ if(modal){ modal.classList.add('hidden'); } if(overlay){ overlay.classList.add('hidden'); } clear(); editingId=null; };
  const clear = ()=>{ [nameInput,teacherInput,capacityInput].forEach(el=>{ if(el) el.value=''; }); };
  const render = ()=>{
    if(!table) return;
    const oldTbody = table.querySelector('tbody');
    if(oldTbody) oldTbody.remove();
    const tbody = document.createElement('tbody');
    state.rooms.forEach(r=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-3 py-2 text-sm">${r.name}</td>
        <td class="px-3 py-2 text-sm">${r.teacher}</td>
        <td class="px-3 py-2 text-sm">${r.capacity}</td>
        <td class="px-3 py-2 text-right">
          <button class="px-2 py-1 border rounded text-xs" onclick="viewRoomStudents('${r.id}')">Alumnos</button>
          <button class="px-2 py-1 border rounded text-xs" onclick="editRoom('${r.id}')">Editar</button>
          <button class="px-2 py-1 border rounded text-xs" onclick="deleteRoom('${r.id}')">Eliminar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  };

  const save = ()=>{
    const name = nameInput?.value?.trim();
    const teacher = teacherInput?.value?.trim();
    const capacity = parseInt(capacityInput?.value || '0', 10);
    if(!name || !teacher || !capacity) return;
    if(editingId){
      const idx = state.rooms.findIndex(x=>x.id===editingId);
      if(idx>=0){ state.rooms[idx] = { ...state.rooms[idx], name, teacher, capacity }; }
    } else {
      const id = 'r_'+Date.now();
      state.rooms.push({ id, name, teacher, capacity });
    }
    render();
    close();
  };

  if(openBtn) openBtn.addEventListener('click', open);
  if(closeBtn) closeBtn.addEventListener('click', close);
  if(overlay) overlay.addEventListener('click', close);
  if(saveBtn) saveBtn.addEventListener('click', save);

  window.editRoom = function(id){
    const r = state.rooms.find(x=>x.id===id);
    if(!r) return;
    editingId = id;
    if(nameInput) nameInput.value = r.name || '';
    if(teacherInput) teacherInput.value = r.teacher || '';
    if(capacityInput) capacityInput.value = String(r.capacity || '');
    open();
  };
  window.viewRoomStudents = function(id){
    open();
  };
  window.deleteRoom = function(id){
    state.rooms = state.rooms.filter(x=>x.id!==id);
    render();
  };

  render();
}
