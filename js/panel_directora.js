// director.js
// Lógica separada para el Panel Directora — Karpus Kids

// --- Utilidades ---
const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

// Inicializar iconos lucide cuando DOM cargue
document.addEventListener('DOMContentLoaded', ()=>{
  if(window.lucide) lucide.replace();
  initNavigation();
  initDashboardChart();
  attachPaymentsHandlers();
  attachCommunicationsHandlers();
});

// --- Navegación entre secciones ---
function initNavigation(){
  // Aceptar tanto '.nav-button' como '.nav-btn' por compatibilidad
  qsa('.nav-button, .nav-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const target = btn.getAttribute('data-section');
      document.querySelectorAll('.section').forEach(s=> s.classList.add('hidden'));
      const el = document.getElementById(target);
      if(el) el.classList.remove('hidden');
      // close mobile sidebar
      const sb = document.getElementById('sidebar');
      if(window.innerWidth < 768 && sb) sb.classList.add('hidden');
    });
  });
}

// --- Chart demo ---
function initDashboardChart(){
  const ctx = document.getElementById('attendanceChart')?.getContext('2d');
  if(!ctx) return;
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['8 sem','7 sem','6 sem','5 sem','4 sem','3 sem','2 sem','Últ. semana'],
      datasets: [{ label: 'Asistencia %', data: [92,90,88,94,91,89,93,95], tension:0.3, fill:false }]
    },
    options: { responsive:true, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true, max:100}} }
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
  qs('#filterPagoAula')?.addEventListener('change', (e)=>{
    const val = e.target.value;
    qsa('#paymentsTable tr').forEach(tr=>{
      if(val==='all' || tr.dataset.aula===val) tr.style.display=''; else tr.style.display='none';
    });
  });

  // Recordatorio masivo
  qs('#sendBatchReminder')?.addEventListener('click', ()=>{
    const aula = qs('#filterPagoAula')?.value || 'all';
    openModal('Recordatorio masivo', `Enviar recordatorio de pago a aula: <strong>${aula}</strong>?`, [
      {text:'Cancelar', type:'secondary'},
      {text:'Enviar a todos', type:'primary', onClick: ()=>{ alert('Recordatorios masivos enviados (simulado).'); closeModal(); }}
    ]);
  });
}

// --- Comunicaciones / publicaciones ---
function attachCommunicationsHandlers(){
  qs('#newPostBtn')?.addEventListener('click', ()=> openPostModal());
  qs('#newMessageBtn')?.addEventListener('click', ()=> openMessageModal());
  qs('#filterPubAula')?.addEventListener('change', ()=> filterPosts());
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

function addPostToList({title, body, target, when}){
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

// --- Modal genérico ---
function openModal(title, htmlBody, actions=[]){
  const mc = qs('#modalContainer');
  mc.innerHTML = '';
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50';
  const modal = document.createElement('div');
  modal.className = 'bg-white rounded-lg p-6 w-full max-w-xl mx-4';
  modal.innerHTML = `<h3 class="font-semibold mb-3">${title}</h3><div class="mb-4">${htmlBody}</div><div class="flex justify-end gap-3" id="modalActions"></div>`;
  overlay.appendChild(modal);
  mc.appendChild(overlay);
  const actionsContainer = qs('#modalActions');
  actions.forEach(a=>{
    const btn = document.createElement('button');
    btn.innerText = a.text;
    btn.className = a.type==='primary'? 'px-3 py-2 bg-blue-600 text-white rounded':'px-3 py-2 border rounded';
    btn.addEventListener('click', ()=>{
      if(typeof a.onClick === 'function') a.onClick();
      else closeModal();
    });
    actionsContainer.appendChild(btn);
  });
}
function closeModal(){
  qs('#modalContainer').innerHTML = '';
}

// --- Util: cerrar modal con ESC ---
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeModal(); });

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
