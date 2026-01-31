// director.js
// Lógica separada para el Panel Directora — Karpus Kids

// --- Utilidades ---
const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));
const escapeHTML = (str = '') => {
  return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
  }[tag]));
};

// Inicialización del panel Directora
document.addEventListener('DOMContentLoaded', ()=>{
  // Enforce role without inline script
  // if (window.Auth && !Auth.enforceRole('directora')) return; // REMOVED: Using Supabase Auth in app.js
  // initDashboardChart(); // REMOVED: Managed by app.js to avoid canvas conflict
  
  safeInit(attachPaymentsHandlers);
  safeInit(attachCommunicationsHandlers);
  safeInit(attachGradesHandlers);
  safeInit(attachReportsHandlers);
  // initNavDirector(); // REMOVED: Managed by app.js
  safeInit(initStudentController);
  // initTeacherModule(); // REMOVED: Managed by app.js (Supabase)
  // initRoomsModule();   // REMOVED: Managed by app.js (Supabase)
  safeInit(initAttendanceModule); // New module for real attendance stats
  
  adjustMainOffset();
  window.addEventListener('resize', adjustMainOffset);
  const dash = document.getElementById('dashboard');
  if (dash) dash.classList.remove('hidden');
});

function safeInit(fn){
  try {
    if (typeof fn === 'function') fn();
  } catch (e) {
    console.error(`Error inicializando ${fn.name}:`, e);
  }
}

// --- Real Attendance Logic ---
function initAttendanceModule() {
    const dateFilter = document.getElementById('attendanceDateFilter');
    const refreshBtn = document.getElementById('btnRefreshAttendance');
    
    // Modal close handler
    const closeBtn = document.getElementById('closeAttendanceModal');
    const modal = document.getElementById('attendanceModal');
    if(closeBtn && modal) {
        closeBtn.onclick = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        };
    }

    // Event Delegation for Attendance Details
    const tbody = document.getElementById('attendanceByRoomBody');
    if(tbody) {
      tbody.onclick = (e) => {
        const tr = e.target.closest('tr[data-room-id]');
        if(!tr) return;
        const roomId = tr.dataset.roomId;
        const roomName = tr.dataset.roomName;
        openAttendanceDetail(roomId, roomName);
      };
    }
    
    if(dateFilter) {
        dateFilter.value = new Date().toLocaleDateString('sv-SE');
        dateFilter.onchange = loadAttendanceStats;
    }
    
    if(refreshBtn) {
        refreshBtn.onclick = loadAttendanceStats;
    }
    
    // Initial load
    loadAttendanceStats();
}

let loadingAttendance = false;

function getAttendanceDate() {
  const el = document.getElementById('attendanceDateFilter');
  return el?.value || new Date().toLocaleDateString('sv-SE');
}

async function getSupabase() {
  if (window.supabase) return window.supabase;
  console.error('Supabase no está inicializado. app.js debe cargarlo primero.');
  return null;
}

async function loadAttendanceStats() {
    if (loadingAttendance) return;
    loadingAttendance = true;
    
    // Show loader
    const loader = document.getElementById('attendanceLoader');
    if(loader) loader.classList.remove('hidden');

    try {
      const date = getAttendanceDate();
      const supabase = await getSupabase();
      if (!supabase) { console.error('Supabase no está inicializado'); return; }

      const { data: attendanceData, error } = await supabase
        .from('attendance')
        .select('status, classroom_id, classroom:classrooms(name)')
        .eq('date', date);
        
    if(error) {
        console.error('Error fetching attendance stats:', error);
        return;
    }
    
    // 2. Aggregate Stats
    let present = 0, absent = 0, late = 0;
    const byRoom = {};
    
    (attendanceData || []).forEach(r => {
        if(r.status === 'present') present++;
        if(r.status === 'absent') absent++;
        if(r.status === 'late') late++;
        
        const roomId = r.classroom_id || 'unknown';
        const roomName = r.classroom?.name || 'Sin Aula';
        
        if(!byRoom[roomId]) byRoom[roomId] = { name: roomName, present: 0, absent: 0, late: 0, total: 0 };
        
        byRoom[roomId].total++;
        if(r.status === 'present') byRoom[roomId].present++;
        if(r.status === 'absent') byRoom[roomId].absent++;
        if(r.status === 'late') byRoom[roomId].late++;
    });
    
    // 3. Update DOM Stats
    const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    set('statPresent', present);
    set('statAbsent', absent);
    set('statLate', late);
    set('ninosPresentes', present);
    
    // 4. Update Room Table
    const tbody = document.getElementById('attendanceByRoomBody');
    if(tbody) {
        if(Object.keys(byRoom).length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-slate-500">No hay registros para esta fecha.</td></tr>';
        } else {
            tbody.innerHTML = Object.keys(byRoom).map(roomId => {
                const stats = byRoom[roomId];
                const percent = Math.round((stats.present / stats.total) * 100) || 0;
                return `
                    <tr data-room-id="${roomId}" data-room-name="${stats.name}" class="cursor-pointer hover:bg-slate-50 transition-colors border-b last:border-0" title="Ver detalle">
                        <td class="py-3 px-2 font-medium">${stats.name}</td>
                        <td class="py-3 px-2 text-center text-green-600 font-bold">${stats.present}</td>
                        <td class="py-3 px-2 text-center text-red-600">${stats.absent}</td>
                        <td class="py-3 px-2 text-center">
                            <div class="flex items-center justify-center gap-2">
                                <span class="text-xs font-bold">${percent}%</span>
                                <div class="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div class="h-full bg-blue-500" style="width: ${percent}%"></div>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }
    
    // 5. Update Pie Chart
    updatePieChart(present, absent, late);
    } finally {
      loadingAttendance = false;
      if(loader) loader.classList.add('hidden');
    }
}

async function openAttendanceDetail(classroomId, classroomName) {
    const modal = document.getElementById('attendanceModal');
    const title = document.getElementById('attModalTitle');
    const tbody = document.getElementById('attModalBody');
    const date = getAttendanceDate();
    
    if(!modal || !tbody) return;
    
    title.textContent = `Asistencia - ${classroomName}`;
    document.getElementById('attModalDate').textContent = `Fecha: ${date}`;
    tbody.innerHTML = '<tr><td colspan="3" class="text-center p-4">Cargando...</td></tr>';
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    try {
        const supabase = await getSupabase();
        if (!supabase) return;

        // Fetch Students
        const { data: students, error: stError } = await supabase
            .from('students')
            .select('id, name')
            .eq('classroom_id', classroomId)
            .eq('is_active', true)
            .order('name');
            
        if(stError) throw stError;
        
        // Fetch Attendance
        const { data: attendance, error: attError } = await supabase
            .from('attendance')
            .select('student_id, status, created_at')
            .eq('classroom_id', classroomId)
            .eq('date', date);
            
        if(attError) throw attError;
        
        const attMap = {};
        (attendance || []).forEach(a => attMap[a.student_id] = a);
        
        if(!(students || []).length) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center p-4 text-slate-500">No hay estudiantes en esta aula.</td></tr>';
            return;
        }
        
        tbody.innerHTML = students.map(s => {
            const att = attMap[s.id];
            const status = att ? att.status : 'pending';
            const time = att ? new Date(att.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-';
            
            let statusBadge = '';
            switch(status) {
                case 'present': statusBadge = '<span class="px-2 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">Presente</span>'; break;
                case 'absent': statusBadge = '<span class="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">Ausente</span>'; break;
                case 'late': statusBadge = '<span class="px-2 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700">Tardanza</span>'; break;
                default: statusBadge = '<span class="px-2 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500">Pendiente</span>';
            }
            
            return `
            <tr class="hover:bg-slate-50 transition-colors border-b last:border-0">
                <td class="p-3 font-medium text-slate-800">${s.name}</td>
                <td class="p-3 text-center">${statusBadge}</td>
                <td class="p-3 text-center text-slate-500 text-xs">${time}</td>
            </tr>
            `;
        }).join('');
        
    } catch(error) {
        console.error('Error loading detail:', error);
        tbody.innerHTML = '<tr><td colspan="3" class="text-center p-4 text-red-500">Error al cargar detalle.</td></tr>';
    }
}

let attendancePieChartInstance = null;
function updatePieChart(present, absent, late) {
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js no cargado');
        return;
    }
    const canvas = document.getElementById('attendancePieChart');
    if(!canvas) return;
    
    if(attendancePieChartInstance) {
        // Update existing instance
        attendancePieChartInstance.data.datasets[0].data = [present, absent, late];
        attendancePieChartInstance.update();
        return;
    }
    
    const ctx = canvas.getContext('2d');
    attendancePieChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Presentes', 'Ausentes', 'Tardanzas'],
            datasets: [{
                data: [present, absent, late],
                backgroundColor: ['#22c55e', '#ef4444', '#eab308'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

// --- Chart demo ---
window.initDashboardChart = function(){
  const canvas = document.getElementById('attendanceChart');
  if(!canvas) return;

  // Asegurar contenedor estable
  if (canvas.parentElement) {
    canvas.parentElement.style.position = 'relative';
    canvas.parentElement.style.height = '260px';
  }

  // Destruir instancia previa si existe (para evitar superposiciones al recargar)
  if (window.DirectorState && window.DirectorState.chartInstance) {
    window.DirectorState.chartInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  
  // Crear degradado para el fondo de la línea
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(37, 99, 235, 0.2)'); // Azul intenso transparente
  gradient.addColorStop(1, 'rgba(37, 99, 235, 0)');   // Transparente

  const chart = new Chart(ctx, {
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

  if (window.DirectorState) window.DirectorState.chartInstance = chart;
  else window.dashboardChartInstance = chart; // Fallback
}

// --- Pagos: handlers ---
function attachPaymentsHandlers(){
  // Cargar pagos al inicio
  loadPayments();

  // Event Delegation para la tabla de pagos
  const table = document.getElementById('paymentsTable');
  if (table) {
    table.addEventListener('click', async (e) => {
      // Botón Marcar Pagado
      const payBtn = e.target.closest('.approve-payment-btn');
      if (payBtn) {
        const id = payBtn.dataset.id;
        await approvePayment(id);
      }
      
      // Botón Recordatorio
      const remBtn = e.target.closest('.send-reminder-btn');
      if (remBtn) {
        const parentId = remBtn.dataset.parentId;
        const studentName = remBtn.dataset.studentName;
        await sendPaymentReminder(parentId, studentName);
      }
    });
  }

  // Filtros
  const filtroAula = document.getElementById('paymentsClassFilter');
  if (filtroAula) filtroAula.addEventListener('change', loadPayments);

  // Recordatorio masivo
  const batchBtn = document.getElementById('btnRecordatorioMasivo');
  if (batchBtn) batchBtn.addEventListener('click', sendReminderToAllParents);
}

// =============================== 
// PAGOS CON SUPABASE 
// ===============================
async function loadPayments() {
  const supabase = await getSupabase();
  if (!supabase) return;

  const tbody = document.getElementById('paymentsTable');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4">Cargando pagos...</td></tr>';

  // Obtener filtro
  const aulaId = document.getElementById('paymentsClassFilter')?.value || 'all';

  try {
    let query = supabase
      .from('payments')
      .select(`
        id, amount, concept, status, due_date,
        student:students (
          id, name, classroom_id,
          classroom:classrooms(name),
          parent:profiles!inner(id, name, email, phone)
        )
      `)
      .order('due_date', { ascending: false });

    // Nota: El filtrado por classroom_id anidado es complejo en una sola query si no es !inner
    // Si queremos filtrar por aula:
    if (aulaId !== 'all') {
      // Opción A: Filtrar en cliente (más fácil si son pocos datos)
      // Opción B: Usar !inner en students y eq('student.classroom_id', aulaId)
      // Usaremos filtrado cliente por simplicidad inicial, o query compleja si hay muchos datos.
    }

    const { data, error } = await query;
    
    if (error) throw error;

    let pagos = data || [];
    
    // Filtrado cliente por aula
    if (aulaId !== 'all') {
      pagos = pagos.filter(p => p.student?.classroom_id == aulaId);
    }

    if (pagos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4 text-slate-500">No hay pagos registrados.</td></tr>';
      return;
    }

    tbody.innerHTML = pagos.map(p => {
      const isPaid = p.status === 'paid';
      // Lógica de estado
      let statusColor = 'bg-yellow-100 text-yellow-800';
      let statusText = 'Pendiente';
      
      if (isPaid) {
        statusColor = 'bg-green-100 text-green-800';
        statusText = 'Pagado';
      } else {
        const isOverdue = p.due_date && new Date(p.due_date) < new Date();
        if (isOverdue) {
          statusColor = 'bg-red-100 text-red-800';
          statusText = 'Vencido';
        }
      }

      return `
        <tr class="border-b hover:bg-slate-50 transition-colors">
          <td class="p-3">
            <div class="font-bold text-slate-700">${p.student?.name || 'S/N'}</div>
            <div class="text-xs text-slate-500">${p.student?.classroom?.name || 'Aula ?'}</div>
          </td>
          <td class="p-3 text-sm text-slate-600">
            ${p.student?.parent?.name || 'S/P'}
          </td>
          <td class="p-3 text-right font-mono text-slate-700">
            $${parseFloat(p.amount).toFixed(2)}
          </td>
          <td class="p-3 text-center text-sm">
            ${p.concept}
            <div class="text-xs text-slate-400">${p.due_date || ''}</div>
          </td>
          <td class="p-3 text-center">
            <span class="px-2 py-1 rounded-full text-xs font-bold ${statusColor}">
              ${statusText}
            </span>
          </td>
          <td class="p-3 text-center">
            ${!isPaid ? `
              <div class="flex justify-center gap-2">
                <button class="p-1.5 bg-green-50 text-green-600 rounded hover:bg-green-100 approve-payment-btn" data-id="${p.id}" title="Marcar como Pagado">
                  <i data-lucide="check" class="w-4 h-4"></i>
                </button>
                <button class="p-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 send-reminder-btn" data-parent-id="${p.student?.parent?.id}" data-student-name="${p.student?.name}" title="Enviar Recordatorio">
                  <i data-lucide="bell" class="w-4 h-4"></i>
                </button>
              </div>
            ` : '<span class="text-xs text-slate-400">Completado</span>'}
          </td>
        </tr>
      `;
    }).join('');
    
    if (window.lucide) lucide.createIcons();

  } catch (e) {
    console.error('Error cargando pagos:', e);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-red-500">Error: ${e.message}</td></tr>`;
  }
}

async function approvePayment(id) {
  if (!confirm('¿Confirmar pago recibido?')) return;
  
  const supabase = await getSupabase();
  const { error } = await supabase.from('payments').update({
    status: 'paid',
    paid_date: new Date().toISOString()
  }).eq('id', id);

  if (error) {
    alert('Error actualizando pago: ' + error.message);
  } else {
    loadPayments(); // Recargar tabla
    loadFinanceReport(); // Actualizar reporte financiero si existe
  }
}

async function sendPaymentReminder(parentId, studentName) {
  // Simulación o implementación real de notificación
  // Aquí podríamos insertar en la tabla notifications si existiera
  openModal('Enviando...', `Enviando recordatorio por ${studentName}...`);
  
  try {
    const supabase = await getSupabase();
    // Ejemplo: Insertar notificación
    const { error } = await supabase.from('notifications').insert([{
      user_id: parentId,
      title: 'Recordatorio de Pago',
      message: `Se le recuerda realizar el pago pendiente de ${studentName}.`,
      type: 'payment_reminder',
      is_read: false
    }]);

    if (error) throw error;
    
    closeModal();
    openModal('Éxito', 'Recordatorio enviado correctamente.');
  } catch (e) {
    closeModal();
    alert('Error enviando recordatorio: ' + e.message);
  }
}

async function sendReminderToAllParents() {
  if (!confirm('¿Enviar recordatorio a TODOS los padres con deuda?')) return;
  
  openModal('Procesando', 'Enviando recordatorios masivos...');
  
  try {
    const supabase = await getSupabase();
    // 1. Obtener pagos pendientes
    const { data: debts, error } = await supabase
      .from('payments')
      .select('student_id, student:students(parent_id)')
      .eq('status', 'pending');
      
    if (error) throw error;
    
    // 2. Extraer IDs de padres únicos
    const parentIds = [...new Set(debts.map(d => d.student?.parent_id).filter(Boolean))];
    
    if (parentIds.length === 0) {
      closeModal();
      alert('No hay deudas pendientes.');
      return;
    }

    // 3. Crear notificaciones (batch)
    const notifs = parentIds.map(pid => ({
      user_id: pid,
      title: 'Aviso de Pago',
      message: 'Estimado padre, tiene pagos pendientes. Por favor revise su estado de cuenta.',
      type: 'payment_reminder'
    }));

    const { error: insError } = await supabase.from('notifications').insert(notifs);
    if (insError) throw insError;

    closeModal();
    openModal('Completado', `Se enviaron ${parentIds.length} recordatorios.`);

  } catch (e) {
    closeModal();
    alert('Error: ' + e.message);
  }
}

// ===============================
// CALIFICACIONES (GRADES)
// ===============================

// Guardar nota (llamada desde celdas editables o modal)
async function saveGrade(studentId, subject, period, score, classroomId) {
  const supabase = await getSupabase();
  
  // Upsert: busca por student_id + subject + period (necesitaríamos constraint unique)
  // O borramos y creamos. O buscamos ID.
  // Supongamos que queremos guardar el registro.
  
  const { error } = await supabase.from('grades').upsert({
    student_id: studentId,
    classroom_id: classroomId, // Opcional si lo tenemos
    subject: subject,
    period: period,
    score: parseFloat(score)
  }, { onConflict: 'student_id, subject, period' }); // Requiere índice único en DB

  if (error) {
    console.error('Error guardando nota:', error);
    return false;
  }
  return true;
}

async function loadStudentGrades(studentId) {
  // Implementación para ver notas de un alumno específico
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('grades')
    .select('*')
    .eq('student_id', studentId);
    
  return data || [];
}

// ===============================
// REPORTE FINANCIERO
// ===============================
async function loadFinanceReport() {
  const supabase = await getSupabase();
  if (!supabase) return;

  const { data, error } = await supabase
    .from('payments')
    .select('amount, status');

  if (error) return;

  let totalEsperado = 0;
  let totalRecaudado = 0;
  let pendientes = 0;

  data.forEach(p => {
    const m = parseFloat(p.amount) || 0;
    totalEsperado += m;
    if (p.status === 'paid') totalRecaudado += m;
    else pendientes += m;
  });

  // Actualizar DOM si existen elementos
  const elTotal = document.getElementById('finTotal');
  const elRecaudado = document.getElementById('finRecaudado');
  const elPendiente = document.getElementById('finPendiente');

  if (elTotal) elTotal.textContent = `$${totalEsperado.toFixed(2)}`;
  if (elRecaudado) elRecaudado.textContent = `$${totalRecaudado.toFixed(2)}`;
  if (elPendiente) elPendiente.textContent = `$${pendientes.toFixed(2)}`;
}

// Inicializar reporte al cargar (opcional)
// loadFinanceReport(); // Se puede llamar en init o al abrir pestaña reportes

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
      closeModal();
      openModal('Enviado', `Mensaje enviado a ${target}`);
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
  el.innerHTML = `<div class="flex items-center justify-between"><strong>${escapeHTML(title)}</strong><span class="text-xs text-slate-500">${escapeHTML(when)}</span></div><p class="text-sm text-slate-600 mt-1">${escapeHTML(body)}</p><div class="mt-2 flex gap-2 text-xs"><button class="px-2 py-1 border rounded">Ver</button><button class="px-2 py-1 border rounded">Compartir</button></div>`;
  container.prepend(el);
}

function filterPosts(){
  const val = qs('#filterPubAula')?.value || 'all';
  // Demo: no etiquetas en posts, pero aquí iría la lógica para mostrar u ocultar
  // Para ahora, sólo mostramos un mensaje de filtro aplicado
  console.log('Filtrando publicaciones por:', val);
}



// --- Fin del archivo ---

// =============================
// Navegación lateral de secciones
// =============================
// REMOVED: Logic moved to app.js to coordinate with data loading

// ===============================
// VISTA DE CALIFICACIONES (Director)
// ===============================
function attachGradesHandlers() {
  loadGradesView();
}

async function loadGradesView() {
  const tbody = document.getElementById('gradesTable');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="5" class="text-center p-4">Cargando calificaciones...</td></tr>';

  const supabase = await getSupabase();
  if (!supabase) return;

  try {
    const { data: students, error: stError } = await supabase
      .from('students')
      .select('id, name, classroom:classrooms(name)')
      .eq('is_active', true)
      .order('name');
      
    if (stError) throw stError;
    
    const { data: grades, error: grError } = await supabase
      .from('grades')
      .select('student_id, score, created_at');
      
    if (grError) throw grError;

    // Calculate averages
    const averages = {}; 
    const lastScores = {};
    (grades || []).forEach(g => {
      const sid = g.student_id;
      const scoreNum = parseFloat(g.score) || 0;
      const ts = g.created_at ? new Date(g.created_at).getTime() : 0;
      if (!averages[sid]) averages[sid] = { sum: 0, count: 0 };
      averages[sid].sum += scoreNum;
      averages[sid].count++;
      if (!lastScores[sid] || ts > lastScores[sid].ts) lastScores[sid] = { score: scoreNum, ts };
    });

    if (students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center p-4 text-slate-500">No hay estudiantes activos.</td></tr>';
      return;
    }

    tbody.innerHTML = students.map(s => {
      const stats = averages[s.id] || { sum: 0, count: 0 };
      const avg = stats.count > 0 ? (stats.sum / stats.count).toFixed(1) : '-';
      
      // Determine status/color based on average (example logic)
      let statusHtml = '<span class="text-slate-400">-</span>';
      if (avg !== '-') {
        const numAvg = parseFloat(avg);
        if (numAvg >= 90) statusHtml = '<span class="text-green-600 font-bold">Excelente</span>';
        else if (numAvg >= 80) statusHtml = '<span class="text-blue-600 font-bold">Bueno</span>';
        else if (numAvg >= 70) statusHtml = '<span class="text-yellow-600 font-bold">Regular</span>';
        else statusHtml = '<span class="text-red-600 font-bold">Reprobado</span>';
      }

      const last = lastScores[s.id]?.score;
      return `
        <tr class="border-b hover:bg-slate-50">
          <td class="p-3 font-medium text-slate-700">${s.name}</td>
          <td class="p-3 text-slate-600">${s.classroom?.name || 'Sin Aula'}</td>
          <td class="p-3 text-center">${last != null ? Number(last).toFixed(1) : '-'}</td> 
          <td class="p-3 text-center font-bold text-slate-800">${avg}</td>
          <td class="p-3 text-center text-sm">${statusHtml}</td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    console.error('Error loading grades view:', e);
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4 text-red-500">Error: ${e.message}</td></tr>`;
  }
}

// ===============================
// REPORTES E INQUIETUDES (Child Theme Cards)
// ===============================
function attachReportsHandlers() {
  loadInquiries();
  const refreshBtn = document.getElementById('refreshReports');
  if (refreshBtn) refreshBtn.addEventListener('click', loadInquiries);
}

async function loadInquiries() {
  const container = document.getElementById('reportsList');
  if (!container) return;
  
  container.innerHTML = '<div class="col-span-3 text-center p-4">Cargando reportes...</div>';

  const supabase = await getSupabase();
  if (!supabase) return;

  try {
    const { data, error } = await supabase
      .from('inquiries')
      .select(`
        id, message, created_at, status, subject,
        parent:profiles(name, email, phone)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = '<div class="col-span-3 text-center p-8 text-slate-500">No hay reportes o inquietudes pendientes.</div>';
      return;
    }

    const styles = ['crayon', 'ruler', 'notebook', 'toy'];
    const icons = {'crayon': '🖍️', 'ruler': '📏', 'notebook': '📓', 'toy': '🧸'};

    container.innerHTML = data.map((item, index) => {
      const styleClass = styles[index % styles.length];
      const icon = icons[styleClass];
      const date = new Date(item.created_at).toLocaleDateString();
      const parentName = item.parent?.name || 'Padre';

      return `
        <div class="child-card ${styleClass}">
          <div class="child-card-header">
            <span class="child-card-icon">${icon}</span>
            <div>
              <div class="font-bold text-slate-700">${item.subject || 'Inquietud'}</div>
              <div class="text-xs text-slate-500">${parentName} • ${date}</div>
            </div>
          </div>
          <div class="child-card-body">
            "${escapeHTML(item.message)}"
          </div>
          <div class="child-card-footer">
            ${item.status === 'pending' 
              ? `<button onclick="replyInquiry(${item.id})" class="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-200">Responder</button>`
              : `<span class="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-bold">Resuelto</span>`
            }
          </div>
        </div>
      `;
    }).join('');

  } catch (e) {
    console.error('Error loading inquiries:', e);
    container.innerHTML = `<div class="col-span-3 text-center p-4 text-red-500">Error: ${e.message}</div>`;
  }
}

window.replyInquiry = async function(id) {
  const reply = prompt('Escribe tu respuesta para el padre:');
  if (!reply) return;

  const supabase = await getSupabase();
  const { error } = await supabase.from('inquiries').update({
    response: reply,
    status: 'resolved',
    responded_at: new Date().toISOString()
  }).eq('id', id);

  if (error) {
    alert('Error al responder: ' + error.message);
  } else {
    alert('Respuesta enviada.');
    loadInquiries();
  }
};

// =============================
// Estudiantes: perfil, búsqueda y alta
// =============================
function initStudentController(){
  // ABRIR PERFIL DE ESTUDIANTE
  const studentsTable = document.getElementById('studentsTable');
  if (studentsTable) {
    studentsTable.addEventListener('click', (event) => {
      const viewButton = event.target.closest('.view-profile-btn');
      if (viewButton) {
        const studentId = viewButton.getAttribute('data-student-id');
        if (studentId) {
          if (typeof window.openStudentProfile === 'function') {
            window.openStudentProfile(studentId);
          } else {
            console.error('Error: openStudentProfile no está definida en window. Asegúrese de que app.js se ha cargado correctamente.');
            openModal('Error', 'Error interno: No se pudo abrir el perfil. Función no encontrada.');
          }
        }
      }
    });
  }

  // CERRAR PERFIL
  const closeModalButtons = qsa('#closeStudentProfile, #closeStudentProfileModal');
  closeModalButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = qs('#studentProfileModal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      document.body.classList.remove('no-scroll');
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
  const addStudentBtn = document.getElementById('btnAddStudent');
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
  document.getElementById('stClassroom').value = '';
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
  if (window.USE_LOCAL_DEMO !== true) return;
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
  if (window.USE_LOCAL_DEMO !== true) return;
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
