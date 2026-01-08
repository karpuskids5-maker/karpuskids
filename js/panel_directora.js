// director.js
// Lógica separada para el Panel Directora — Karpus Kids

// --- Utilidades ---
const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

// Inicialización del panel Directora
document.addEventListener('DOMContentLoaded', ()=>{
  // Enforce role without inline script
  if (window.Auth && !Auth.enforceRole('directora')) return;
  initDashboardChart();
  attachPaymentsHandlers();
  attachCommunicationsHandlers();
  initNavDirector();
  initStudentController();
  initTeacherModule();
  initRoomsModule();
  adjustMainOffset();
  window.addEventListener('resize', adjustMainOffset);
  const dash = document.getElementById('dashboard');
  if (dash) dash.classList.remove('hidden');
});

// --- Chart demo ---
function initDashboardChart(){
  const canvas = document.getElementById('attendanceChart');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  if(!ctx) return;
  // Ensure canvas sizing
  const width = canvas.width || canvas.clientWidth || 600;
  const height = canvas.height || canvas.clientHeight || 160;
  if (!canvas.width) canvas.width = width;
  if (!canvas.height) canvas.height = height;

  // Data
  const labels = ['8 sem','7 sem','6 sem','5 sem','4 sem','3 sem','2 sem','Últ. semana'];
  const data = [92,90,88,94,91,89,93,95];

  // Chart area padding
  const pad = { left: 40, right: 10, top: 10, bottom: 25 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  // Clear
  ctx.clearRect(0, 0, width, height);
  // Axes
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Y-axis
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + chartH);
  // X-axis
  ctx.lineTo(pad.left + chartW, pad.top + chartH);
  ctx.stroke();

  // Horizontal grid lines (every 20%)
  ctx.strokeStyle = '#f1f5f9';
  for(let y=20; y<=100; y+=20){
    const gy = pad.top + chartH * (1 - y/100);
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(pad.left + chartW, gy);
    ctx.stroke();
  }

  // Plot line
  const stepX = chartW / (data.length - 1);
  ctx.strokeStyle = '#2196F3';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = pad.left + i * stepX;
    const y = pad.top + chartH * (1 - v/100);
    if(i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Draw points
  ctx.fillStyle = '#2196F3';
  data.forEach((v, i) => {
    const x = pad.left + i * stepX;
    const y = pad.top + chartH * (1 - v/100);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Labels (x)
  ctx.fillStyle = '#64748b';
  ctx.font = '10px sans-serif';
  labels.forEach((lab, i) => {
    const x = pad.left + i * stepX;
    const y = pad.top + chartH + 15;
    ctx.textAlign = 'center';
    ctx.fillText(lab, x, y);
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
const studentParentData = {
  'María Fernanda Pérez': {
    parent1: { name: 'Ana María Pérez González', phone: '+57 300 123 4567', email: 'ana.perez@email.com', job: 'Ingeniera de Sistemas', address: 'Calle 123 #45-67, Bogotá', emergency: '+57 301 987 6543' },
    parent2: { name: 'Carlos Eduardo Pérez', phone: '+57 310 456 7890', email: 'carlos.perez@email.com', job: 'Contador Público', address: 'Calle 123 #45-67, Bogotá', emergency: '+57 320 111 2233' },
    extra: { room: 'Aula Pequeños A1', startDate: '15 de Febrero, 2024', allergies: 'Ninguna conocida', pickup: 'Padres y Abuela Materna' }
  },
  'Javier Alejandro Rodríguez': {
    parent1: { name: 'María Teresa Rodríguez', phone: '+57 302 111 2233', email: 'maria.rodriguez@email.com', job: 'Docente', address: 'Cra 45 #10-20, Bogotá', emergency: '+57 300 987 0011' },
    parent2: { name: 'Eduardo Rodríguez', phone: '+57 315 555 6677', email: 'edu.rodriguez@email.com', job: 'Técnico Electricista', address: 'Cra 45 #10-20, Bogotá', emergency: '+57 310 222 3344' },
    extra: { room: 'Aula Pequeños A2', startDate: '10 de Marzo, 2024', allergies: 'Alergia leve al polvo', pickup: 'Padres' }
  },
  'Ana Sofía González': {
    parent1: { name: 'Laura González', phone: '+57 320 000 1122', email: 'laura.gonzalez@email.com', job: 'Arquitecta', address: 'Av. 7 #23-90, Bogotá', emergency: '+57 311 222 3345' },
    parent2: { name: 'Marco González', phone: '+57 321 777 8899', email: 'marco.gonzalez@email.com', job: 'Diseñador', address: 'Av. 7 #23-90, Bogotá', emergency: '+57 321 555 6677' },
    extra: { room: 'Aula Pequeños A1', startDate: '1 de Abril, 2024', allergies: 'Intolerancia a lactosa', pickup: 'Padres y Tía' }
  },
  'Carlos Eduardo Martínez': {
    parent1: { name: 'Patricia Martínez', phone: '+57 312 333 4455', email: 'patricia.martinez@email.com', job: 'Odontóloga', address: 'Calle 9 #30-12, Bogotá', emergency: '+57 313 444 5566' },
    parent2: { name: 'Ricardo Martínez', phone: '+57 314 666 7788', email: 'ricardo.martinez@email.com', job: 'Administrador', address: 'Calle 9 #30-12, Bogotá', emergency: '+57 314 999 0001' },
    extra: { room: 'Aula Pequeños A3', startDate: '20 de Enero, 2024', allergies: 'Ninguna', pickup: 'Padres' }
  }
};

function initStudentController(){
  // abrir perfil
  window.viewStudentProfile = function(button){
    const row = button.closest('tr');
    const nameEl = row?.querySelector('td .font-medium');
    const name = nameEl ? nameEl.textContent.trim() : 'Estudiante';
    openStudentProfile(name);
  };

  // cerrar perfil
  const closeSt1 = document.getElementById('closeStudentProfile');
  if (closeSt1) closeSt1.addEventListener('click', ()=>{
    const m = document.getElementById('studentProfileModal');
    if (m) m.classList.add('hidden');
  });
  const closeSt2 = document.getElementById('closeStudentProfileModal');
  if (closeSt2) closeSt2.addEventListener('click', ()=>{
    const m = document.getElementById('studentProfileModal');
    if (m) m.classList.add('hidden');
  });

  // búsqueda
  const searchInput = document.getElementById('searchStudent');
  if (searchInput) searchInput.addEventListener('input', function(){
    const q = this.value.toLowerCase();
    qsa('#studentsTable tr').forEach(r => {
      const name = r.querySelector('.font-medium')?.textContent.toLowerCase() || '';
      r.style.display = name.includes(q) ? '' : 'none';
    });
  });

  // agregar estudiante: abrir/cerrar modal
  const addStudentBtn = document.getElementById('addStudentBtn');
  if (addStudentBtn) addStudentBtn.addEventListener('click', ()=>{
    const m = document.getElementById('modalAddStudent');
    if (m) m.classList.remove('hidden');
  });
  const closeAddSt = document.getElementById('closeAddStudent');
  if (closeAddSt) closeAddSt.addEventListener('click', ()=>{
    const m = document.getElementById('modalAddStudent');
    if (m) m.classList.add('hidden');
    clearStudentModal();
  });

  // guardar nuevo estudiante
  const saveAddSt = document.getElementById('saveAddStudent');
  if (saveAddSt) saveAddSt.addEventListener('click', ()=>{
    const name = (document.getElementById('stName')?.value || '').trim();
    if(!name) { alert('Ingrese el nombre del estudiante'); return; }
    const age = (document.getElementById('stAge')?.value || '').trim();
    const schedule = (document.getElementById('stSchedule')?.value || '').trim();
    const p1Name = (document.getElementById('p1Name')?.value || '').trim();
    const p1Phone = (document.getElementById('p1Phone')?.value || '').trim();
    const p2Name = (document.getElementById('p2Name')?.value || '').trim();
    const p2Phone = (document.getElementById('p2Phone')?.value || '').trim();
    const active = !!document.getElementById('stActive')?.checked;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50';
    tr.innerHTML = `
      <td class="py-4 px-4">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center">👤</div>
          <div>
            <div class="font-medium text-slate-800">${name}</div>
            <div class="text-xs text-slate-500">${age? age + ' años' : ''} ${schedule? '• '+schedule : ''}</div>
          </div>
        </div>
      </td>
      <td class="py-4 px-4 text-center">
        <button onclick="viewStudentProfile(this)" class="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-sm font-medium">Ver Perfil</button>
      </td>
    `;

    // guardar datos básicos de padres para la vista rápida
    studentParentData[name] = {
      parent1: { name: p1Name || '', phone: p1Phone || '' },
      parent2: { name: p2Name || '', phone: p2Phone || '' },
      extra: { room: '', startDate: '', allergies: '', pickup: '', schedule: schedule || '' }
    };

    const stTable = document.getElementById('studentsTable');
    if (stTable) stTable.appendChild(tr);
    const m = document.getElementById('modalAddStudent');
    if (m) m.classList.add('hidden');
    clearStudentModal();
    alert(`Estudiante "${name}" agregado.`);
  });
}

function clearStudentModal(){
  ['stName','stAge','stSchedule','p1Name','p1Phone','p2Name','p2Phone'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.value = '';
  });
  const ch = document.getElementById('stActive'); if(ch) ch.checked = true;
}

function openStudentProfile(name){
  const modal = document.getElementById('studentProfileModal');
  const data = studentParentData[name] || null;
  const nameEl = document.getElementById('studentProfileName');
  if (nameEl) nameEl.textContent = name;

  const safe = (val, def='No registrado') => (val && String(val).trim()) ? val : def;
  const p1 = data?.parent1 || {};
  const p2 = data?.parent2 || {};
  const ex = data?.extra   || {};
  const p1n = document.getElementById('parent1Name'); if (p1n) p1n.textContent = safe(p1.name);
  const p1ph = document.getElementById('parent1Phone'); if (p1ph) p1ph.textContent = safe(p1.phone);
  const p1em = document.getElementById('parent1Email'); if (p1em) p1em.textContent = safe(p1.email);
  const p1job = document.getElementById('parent1Job'); if (p1job) p1job.textContent = safe(p1.job);
  const p1addr = document.getElementById('parent1Address'); if (p1addr) p1addr.textContent = safe(p1.address);
  const p1emer = document.getElementById('parent1Emergency'); if (p1emer) p1emer.textContent = safe(p1.emergency);

  const p2n = document.getElementById('parent2Name'); if (p2n) p2n.textContent = safe(p2.name);
  const p2ph = document.getElementById('parent2Phone'); if (p2ph) p2ph.textContent = safe(p2.phone);
  const p2em = document.getElementById('parent2Email'); if (p2em) p2em.textContent = safe(p2.email);
  const p2job = document.getElementById('parent2Job'); if (p2job) p2job.textContent = safe(p2.job);
  const p2addr = document.getElementById('parent2Address'); if (p2addr) p2addr.textContent = safe(p2.address);
  const p2emer = document.getElementById('parent2Emergency'); if (p2emer) p2emer.textContent = safe(p2.emergency);

  const stRoom = document.getElementById('studentRoom'); if (stRoom) stRoom.textContent = safe(ex.room);
  const stStart = document.getElementById('studentStartDate'); if (stStart) stStart.textContent = safe(ex.startDate);
  const stAll = document.getElementById('studentAllergies'); if (stAll) stAll.textContent = safe(ex.allergies);
  const stPick = document.getElementById('studentPickup'); if (stPick) stPick.textContent = safe(ex.pickup);

  if (modal) modal.classList.remove('hidden');
}

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
