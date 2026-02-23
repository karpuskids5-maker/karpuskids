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
  safeInit(attachCommunicationsHandlers); // legacy simple posts
  safeInit(initTeamsComms); // Teams-like UI
  safeInit(attachGradesHandlers);
  safeInit(attachReportsHandlers);
  // initNavDirector(); // REMOVED: Managed by app.js
  safeInit(initStudentController);
  // initTeacherModule(); // REMOVED: Managed by app.js (Supabase)
  // initRoomsModule();   // REMOVED: Managed by app.js (Supabase)
  safeInit(initAttendanceModule); // Real attendance stats
  
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
        dateFilter.value = new Date().toISOString().split('T')[0];
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
  return el?.value || new Date().toISOString().split('T')[0];
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
  loadPayments(); // Carga inicial

  // Botones principales
  document.getElementById('btnNewPayment')?.addEventListener('click', openPaymentModal);
  document.getElementById('btnPendingTransfers')?.addEventListener('click', () => loadPayments('pending'));
  document.getElementById('cardToApprove')?.addEventListener('click', () => loadPayments('pending'));

  // Filtros
  document.getElementById('searchPaymentStudent')?.addEventListener('input', debounce(() => loadPayments(), 500));
  document.getElementById('filterPaymentStatus')?.addEventListener('change', () => loadPayments());

  // Modales
  document.getElementById('btnCancelPayment')?.addEventListener('click', () => toggleModal('modalPayment', false));
  document.getElementById('btnSavePayment')?.addEventListener('click', savePayment);
  document.getElementById('btnCloseReview')?.addEventListener('click', () => toggleModal('modalReviewTransfer', false));
  
  // Acciones de revisión
  document.getElementById('btnApproveTransfer')?.addEventListener('click', () => processTransferDecision('approve'));
  document.getElementById('btnRejectTransfer')?.addEventListener('click', () => processTransferDecision('reject'));
  document.getElementById('btnExportFinancialPDF')?.addEventListener('click', exportFinancialReportPDF);
}

function toggleModal(id, show) {
  const el = document.getElementById(id);
  if(el) {
    if(show) { el.classList.remove('hidden'); el.classList.add('flex'); }
    else { el.classList.add('hidden'); el.classList.remove('flex'); }
  }
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// =============================== 
// PAGOS CON SUPABASE (NUEVA ESTRUCTURA)
// ===============================
async function loadPayments(forceFilter = null) {
  const supabase = await getSupabase();
  if (!supabase) return;

  const tbody = document.getElementById('paymentsTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-12 text-slate-400">Cargando información financiera...</td></tr>';

  try {
    // 1. Cargar Estudiantes y sus Pagos
    const { data: students, error } = await supabase
      .from('students')
      .select(`
        id, name, monthly_fee, due_day, classroom:classrooms(name),
        parent:profiles!parent_id(name, email),
        payments(*)
      `)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;

    // 2. Procesar Datos y Calcular KPIs
    const currentMonth = new Date().toLocaleString('es-ES', { month: 'long' });
    const currentMonthCap = currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1);
    
    let kpiIncome = 0;
    let kpiPending = 0;
    let kpiOverdue = 0;
    let kpiConfirmed = 0;
    let kpiToApprove = 0;

    const processedData = students.map(s => {
      // Filtrar pagos del mes actual
      const monthPayments = (s.payments || []).filter(p => 
        (p.month_paid || '').toLowerCase().includes(currentMonth.toLowerCase())
      );
      
      const paidAmount = monthPayments
        .filter(p => p.status === 'paid' || p.status === 'efectivo' || p.status === 'confirmado')
        .reduce((sum, p) => sum + Number(p.amount), 0);

      const pendingTransfers = (s.payments || []).filter(p => p.status === 'pendiente' && p.evidence_url);
      
      // Estado del estudiante
      let status = 'pending';
      const fee = Number(s.monthly_fee) || 0;
      const dueDay = s.due_day || 5;
      const today = new Date().getDate();

      if (paidAmount >= fee && fee > 0) status = 'paid';
      else if (today > dueDay && paidAmount < fee) status = 'overdue';
      
      // Actualizar KPIs Globales
      if (status === 'paid') kpiConfirmed++;
      if (status === 'pending') kpiPending++;
      if (status === 'overdue') kpiOverdue++;
      kpiIncome += paidAmount;
      kpiToApprove += pendingTransfers.length;

      return {
        ...s,
        status,
        paidAmount,
        pendingTransfers,
        lastPayment: (s.payments || []).sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0]
      };
    });

    // 3. Renderizar KPIs
    const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    setTxt('kpiIncomeMonth', `$${kpiIncome.toLocaleString()}`);
    setTxt('kpiPendingCount', kpiPending);
    setTxt('kpiOverdueCount', kpiOverdue);
    setTxt('kpiConfirmedCount', kpiConfirmed);
    setTxt('kpiToApproveCount', kpiToApprove);

    loadIncomeChart(); // Cargar gráfica mensual

    // 4. Filtrar Grid
    let displayData = processedData;
    const searchTerm = document.getElementById('searchPaymentStudent')?.value.toLowerCase();
    const statusFilter = forceFilter || document.getElementById('filterPaymentStatus')?.value;

    if (searchTerm) {
      displayData = displayData.filter(s => s.name.toLowerCase().includes(searchTerm));
    }
    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'pending') {
        // Si filtro es pending, mostrar los que tienen transferencias por aprobar O deuda
        displayData = displayData.filter(s => s.pendingTransfers.length > 0 || s.status === 'pending');
      } else {
        displayData = displayData.filter(s => s.status === statusFilter);
      }
    }

    // 5. Renderizar Grid
    if (displayData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-12 text-slate-400">No se encontraron registros.</td></tr>';
      return;
    }

    tbody.innerHTML = displayData.map(s => {
      const badgeClass = {
        paid: 'bg-emerald-100 text-emerald-700',
        pending: 'bg-amber-100 text-amber-700',
        overdue: 'bg-pink-100 text-pink-700'
      }[s.status];
      
      const statusLabel = {
        paid: 'Al día',
        pending: 'Pendiente',
        overdue: 'Vencido'
      }[s.status];

      const hasReview = s.pendingTransfers.length > 0;

      return `
        <div class="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition-all relative overflow-hidden group">
          ${hasReview ? `<div class="absolute top-0 right-0 bg-purple-600 text-white text-[10px] font-bold px-2 py-1 rounded-bl-xl z-10">Revisión</div>` : ''}
          
          <div class="flex justify-between items-start mb-3">
            <div>
              <h4 class="font-bold text-slate-800 text-lg">${s.name}</h4>
              <p class="text-xs text-slate-500">${s.classroom?.name || 'Sin Aula'}</p>
            </div>
            <span class="${badgeClass} text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">${statusLabel}</span>
          </div>

          <div class="space-y-2 mb-4">
            <div class="flex justify-between text-sm">
              <span class="text-slate-500">Mensualidad:</span>
              <span class="font-bold text-slate-700">$${s.monthly_fee || 0}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-slate-500">Pagado (Mes):</span>
              <span class="font-bold ${s.paidAmount >= s.monthly_fee ? 'text-emerald-600' : 'text-slate-700'}">$${s.paidAmount}</span>
            </div>
            <div class="w-full bg-slate-100 rounded-full h-1.5 mt-2">
              <div class="h-1.5 rounded-full ${s.status === 'paid' ? 'bg-emerald-500' : 'bg-amber-400'}" style="width: ${Math.min(100, (s.paidAmount / (s.monthly_fee||1))*100)}%"></div>
            </div>
          </div>

          <div class="flex gap-2 mt-4 pt-4 border-t border-slate-50">
            ${hasReview ? `
              <button onclick="openReviewModal('${s.pendingTransfers[0].id}')" class="flex-1 py-2 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2">
                <i data-lucide="eye" class="w-4 h-4"></i> Revisar
              </button>
            ` : `
              <button onclick="sendPaymentReminder('${s.parent?.id}', '${s.name}')" class="flex-1 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-bold transition-colors">
                Recordar
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();

  } catch (e) {
    console.error('Error cargando pagos:', e);
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-12 text-red-500">Error cargando datos: ${e.message}</td>
      </tr>
    `;
  }
}

// --- Lógica de Registro Manual ---
async function openPaymentModal() {
  const select = document.getElementById('payStudentSelect');
  if(!select) return;
  
  // Cargar estudiantes
  const supabase = await getSupabase();
  const { data: students } = await supabase.from('students').select('id, name').eq('is_active', true).order('name');
  
  select.innerHTML = '<option value="">Seleccionar...</option>' + 
    (students || []).map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    
  toggleModal('modalPayment', true);
}

async function savePayment() {
  const studentId = document.getElementById('payStudentSelect').value;
  const amount = document.getElementById('payAmount').value;
  const method = document.getElementById('payMethod').value;
  const concept = document.getElementById('payConcept').value;
  
  if(!studentId || !amount || !concept) { alert('Complete los campos'); return; }
  
  const btn = document.getElementById('btnSavePayment');
  btn.disabled = true; btn.textContent = 'Guardando...';
  
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.from('payments').insert({
      student_id: studentId,
      amount: parseFloat(amount),
      method,
      month_paid: concept, // Usamos concept como month_paid para simplificar
      status: 'paid', // Pago manual es directo pagado
      created_at: new Date().toISOString()
    });
    
    if(error) throw error;
    
    toggleModal('modalPayment', false);
    loadPayments();
    alert('Pago registrado correctamente');
  } catch(e) {
    alert('Error: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar Pago';
  }
}

// --- Lógica de Revisión de Transferencias ---
let currentReviewId = null;

window.openReviewModal = async function(paymentId) {
  currentReviewId = paymentId;
  const modal = document.getElementById('modalReviewTransfer');
  const img = document.getElementById('reviewImage');
  
  // Reset UI
  img.src = '';
  document.getElementById('reviewOcrStatus').textContent = 'Analizando comprobante...';
  document.getElementById('reviewDetectedAmount').textContent = '---';
  
  toggleModal('modalReviewTransfer', true);
  
  try {
    const supabase = await getSupabase();
    const { data: p, error } = await supabase
      .from('payments')
      .select('*, student:students(name)')
      .eq('id', paymentId)
      .single();
      
    if(error) throw error;
    
    const imageUrl = p.evidence_url || p.proof_url;
    img.src = imageUrl; 
    document.getElementById('reviewStudentName').textContent = p.student?.name;
    document.getElementById('reviewReportedAmount').textContent = `$${p.amount}`;
    document.getElementById('reviewDate').textContent = new Date(p.created_at).toLocaleDateString();
    
    // --- OCR REAL CON TESSERACT.JS ---
    if (window.Tesseract && imageUrl) {
        document.getElementById('reviewOcrStatus').innerHTML = '<span class="animate-pulse">Procesando imagen...</span>';
        
        Tesseract.recognize(
          imageUrl,
          'eng', // Usar 'spa' si se carga el idioma español, 'eng' es default y funciona bien para números
          { logger: m => console.log(m) }
        ).then(({ data: { text } }) => {
          console.log('OCR Result:', text);
          document.getElementById('reviewOcrStatus').textContent = 'Análisis completado';
          
          // Buscar el monto en el texto (regex simple para precios)
          // Busca patrones como $1,500.00 o 1500.00
          const priceRegex = /(\$?\d{1,3}(?:,\d{3})*(\.\d{2})?)/g;
          const matches = text.match(priceRegex);
          
          if (matches && matches.length > 0) {
              // Intentar encontrar el monto que coincida con el reportado
              const reported = parseFloat(p.amount);
              const found = matches.find(m => {
                  const val = parseFloat(m.replace(/[$,]/g, ''));
                  return Math.abs(val - reported) < 1; // Margen de error pequeño
              });
              
              if (found) {
                  document.getElementById('reviewDetectedAmount').textContent = found;
                  document.getElementById('reviewDetectedAmount').className = 'text-xl font-black text-green-600';
                  document.getElementById('reviewOcrStatus').innerHTML = '<span class="text-green-600 font-bold">¡Monto verificado!</span>';
              } else {
                  document.getElementById('reviewDetectedAmount').textContent = matches[0]; // Mostrar el primero encontrado
                  document.getElementById('reviewDetectedAmount').className = 'text-xl font-black text-amber-600';
                  document.getElementById('reviewOcrStatus').textContent = 'Revisar manualmente';
              }
          } else {
              document.getElementById('reviewOcrStatus').textContent = 'No se detectaron montos claros';
          }
        }).catch(err => {
            console.error(err);
            document.getElementById('reviewOcrStatus').textContent = 'Error en OCR';
        });
    } else {
        document.getElementById('reviewOcrStatus').textContent = 'OCR no disponible';
    }
    
  } catch(e) {
    console.error(e);
    alert('Error cargando datos');
    toggleModal('modalReviewTransfer', false);
  }
}

async function processTransferDecision(decision) {
  if(!currentReviewId) return;
  const btn = decision === 'approve' ? document.getElementById('btnApproveTransfer') : document.getElementById('btnRejectTransfer');
  btn.disabled = true;
  
  try {
    const supabase = await getSupabase();
    const status = decision === 'approve' ? 'paid' : 'rejected';
    
    const { error } = await supabase
      .from('payments')
      .update({ status })
      .eq('id', currentReviewId);
      
    if(error) throw error;
    
    toggleModal('modalReviewTransfer', false);
    loadPayments();
    alert(decision === 'approve' ? 'Pago aprobado' : 'Pago rechazado');

    if (decision === 'approve') {
      generatePaymentReceipt(currentReviewId);
    }
    
  } catch(e) {
    alert('Error: ' + e.message);
  } finally {
    btn.disabled = false;
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
  const container = qs('#postsList');
  if (!container) return;

  const title = post?.title || 'Sin título';
  const body = post?.body || '';
  const when = post?.when || '';
  
  const el = document.createElement('div');
  el.className = 'p-3 border rounded-lg bg-white shadow-sm hover:shadow transition';
  el.innerHTML = `
    <div class="flex items-center justify-between"><strong class="text-slate-700">${escapeHTML(title)}</strong><span class="text-xs text-slate-500">${escapeHTML(when)}</span></div>
    <p class="text-sm text-slate-600 mt-1">${escapeHTML(body)}</p>
    <div class="mt-2 flex gap-2 text-xs"><button class="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded transition">Ver</button><button class="px-3 py-1 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded transition">Compartir</button></div>
  `;
  container.prepend(el);
}

function filterPosts(){
  const val = qs('#filterPubAula')?.value || 'all';
  // Demo: no etiquetas en posts, pero aquí iría la lógica para mostrar u ocultar
  // Para ahora, sólo mostramos un mensaje de filtro aplicado
  console.log('Filtrando publicaciones por:', val);
}

// --- Teams Comms (Chat) ---
window.initTeamsComms = function() {
  const chatInput = document.getElementById('chatInput');
  const chatSend = document.getElementById('chatSend');
  
  if (chatSend && chatInput) {
    chatSend.onclick = () => {
      const text = chatInput.value.trim();
      if (!text) return;
      
      // Simulación de envío
      const container = document.getElementById('chatMessages');
      if (container) {
        container.innerHTML += `<div class="flex justify-end"><div class="bg-purple-600 text-white p-3 rounded-l-xl rounded-tr-xl max-w-[80%] text-sm">${escapeHTML(text)}</div></div>`;
        container.scrollTop = container.scrollHeight;
      }
      chatInput.value = '';
    };
  }
};

let incomeChartInstance = null;

async function loadIncomeChart() {
  const supabase = await getSupabase();
  if (!supabase) return;

  const { data, error } = await supabase
    .from('payments')
    .select('amount, created_at, status')
    .eq('status', 'paid');

  if (error) return;

  const months = {};
  
  data.forEach(p => {
    const date = new Date(p.created_at);
    const month = date.toLocaleString('es-ES', { month: 'short' });
    
    if (!months[month]) months[month] = 0;
    months[month] += parseFloat(p.amount);
  });

  const labels = Object.keys(months);
  const values = Object.values(months);

  const ctx = document.getElementById('incomeMonthlyChart');
  if (!ctx) return;

  if (incomeChartInstance) incomeChartInstance.destroy();

  incomeChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Ingresos Mensuales',
        data: values,
        backgroundColor: '#6366f1',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

async function generatePaymentReceipt(paymentId) {
  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from('payments')
    .select(`*, student:students(name), parent:profiles!student_id(name, email)`) // Adjusted relation hint if needed, or rely on implicit
    .eq('id', paymentId)
    .single();

  if (error || !data) {
    console.error('Error generando recibo', error);
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(18); doc.text("Karpus Kids - Comprobante de Pago", 20, 20);
  doc.setFontSize(12);
  doc.text(`Estudiante: ${data.student?.name || '-'}`, 20, 40);
  doc.text(`Monto: $${data.amount}`, 20, 50);
  doc.text(`Fecha: ${new Date(data.created_at).toLocaleDateString()}`, 20, 60);
  doc.text(`Estado: Aprobado`, 20, 70);
  doc.setFontSize(10); doc.text("Gracias por su pago.", 20, 90);

  doc.save(`Recibo-${paymentId}.pdf`);
}

async function exportFinancialReportPDF() {
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('Librería PDF no cargada'); return; }

  const supabase = await getSupabase();
  const currentMonth = new Date().toLocaleString('es-ES', { month: 'long' });
  const monthCap = currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1);

  const { data: report, error } = await supabase.rpc('get_monthly_financial_report_by_classroom', { p_month: monthCap });

  if (error || !report) {
    alert('Error obteniendo datos para el reporte');
    return;
  }

  const doc = new jsPDF();
  
  // Header
  doc.setFontSize(18);
  doc.text(`Reporte Financiero - ${monthCap} ${new Date().getFullYear()}`, 14, 20);
  doc.setFontSize(10);
  doc.text("Karpus Kids - Estancia Infantil", 14, 28);

  // Table
  const headers = [["Aula", "Esperado", "Recaudado", "Pendiente"]];
  const rows = report.map(r => [
    r.classroom_name,
    `$${r.total_expected}`,
    `$${r.total_paid}`,
    `$${r.total_pending}`
  ]);

  doc.autoTable({
    head: headers,
    body: rows,
    startY: 35,
    theme: 'grid',
    headStyles: { fillColor: [124, 58, 237] } // Purple
  });

  doc.save(`Reporte_Financiero_${monthCap}.pdf`);
}

// --- Fin del archivo ---

//

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
    if (!students || students.length === 0) {
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
        id, message, created_at, status, subject, folio, updated_at, attachment_url,
        parent:profiles(name, email, phone)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    let list = data || [];
    // Filtros por estado y prioridad
    const fStatus = document.getElementById('reportFilter')?.value || 'all';
    const fPrio = document.getElementById('reportPriority')?.value || 'all';

    if (fStatus !== 'all') list = list.filter(x => (x.status || 'received') === fStatus);
    if (fPrio !== 'all') list = list.filter(x => (x.priority || 'medium') === fPrio);

    if (!list.length) {
      container.innerHTML = '<div class="col-span-3 text-center p-8 text-slate-500">Sin incidencias que coincidan con los filtros.</div>';
      const alertBox = document.getElementById('dashboardAlerts');
      if (alertBox) alertBox.classList.add('hidden');
      return;
    }

    const statusBadge = (s)=>{
      const map = {
        received: 'bg-slate-100 text-slate-700',
        review: 'bg-amber-100 text-amber-700',
        in_progress: 'bg-blue-100 text-blue-700',
        resolved: 'bg-emerald-100 text-emerald-700',
        closed: 'bg-slate-200 text-slate-700'
      };
      const label = { received:'Recibida', review:'En revisión', in_progress:'En proceso', resolved:'Resuelta', closed:'Cerrada' }[s] || s;
      return `<span class="px-2 py-0.5 rounded-full text-xs font-bold ${map[s]||'bg-slate-100'}">${label}</span>`;
    };

    const prioBadge = (p)=>{
      const map = { high: 'bg-red-100 text-red-700', medium: 'bg-orange-100 text-orange-700', low: 'bg-slate-100 text-slate-700' };
      const label = { high:'Alta', medium:'Media', low:'Baja' }[p] || p || 'Media';
      return `<span class="px-2 py-0.5 rounded-full text-xs font-bold ${map[p]||map.medium}">${label}</span>`;
    };

    const styles = ['crayon', 'ruler', 'notebook', 'toy'];
    const icons = {'crayon': '🖍️', 'ruler': '📏', 'notebook': '📓', 'toy': '🧸'};

    container.innerHTML = list.map((item, index) => {
      const styleClass = styles[index % styles.length];
      const icon = icons[styleClass];
      const date = new Date(item.created_at).toLocaleDateString();
      const parentName = item.parent?.name || 'Padre';
      const folio = item.folio || `F-${String(item.id).padStart(5,'0')}`;
      const prio = item.priority || 'medium';
      const status = item.status || 'received';
      const hasAttachment = !!item.attachment_url;

      return `
        <div class="child-card ${styleClass}">
          <div class="child-card-header justify-between">
            <div class="flex items-center gap-2">
              <span class="child-card-icon">${icon}</span>
              <div>
                <div class="font-bold text-slate-700">${escapeHTML(item.subject || 'Incidencia')}</div>
                <div class="text-xs text-slate-500">${parentName} • ${date} • Folio: <span class="font-semibold">${folio}</span></div>
              </div>
            </div>
            <div class="flex items-center gap-1">${prioBadge(prio)} ${statusBadge(status)}</div>
          </div>
          <div class="child-card-body">
            <p class="line-clamp-3">${escapeHTML(item.message || '')}</p>
            ${hasAttachment ? `<div class="mt-2 text-xs text-blue-600 font-bold flex items-center gap-1"><i data-lucide="image" class="w-3 h-3"></i> Contiene foto</div>` : ''}
          </div>
          <div class="child-card-footer gap-2">
            <button onclick="openInquiryDetail('${item.id}')" class="px-3 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50">Ver Detalle</button>
            ${status !== 'resolved' && status !== 'closed' 
              ? `<button onclick=\"replyInquiry(${item.id})\" class=\"px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-200\">Responder</button>
                 <button onclick=\"advanceInquiry(${item.id}, '${status}')\" class=\"px-3 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200\">Avanzar estado</button>`
              : `<span class=\"px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-bold\">Cerrado</span>`
            }
          </div>
        </div>
      `;
    }).join('');

    // Alerta en dashboard si hay casos en curso
    const pendingCount = (data||[]).filter(d => (d.status||'received') === 'received' || d.status==='review' || d.status==='in_progress').length;
    const alertBox = document.getElementById('dashboardAlerts');
    if (alertBox) {
      if (pendingCount > 0) {
        alertBox.classList.remove('hidden');
        alertBox.innerHTML = `
          <div class=\"bg-orange-100 text-orange-800 rounded-2xl p-4 shadow flex items-center gap-3\">\n            <i data-lucide=\"alert-triangle\" class=\"w-6 h-6\"></i>\n            <div>\n              <div class=\"font-bold\">Incidencias por gestionar</div>\n              <div class=\"text-sm\">Tienes ${pendingCount} caso(s) en curso</div>\n            </div>\n            <button id=\"refreshReports\" class=\"ml-auto px-3 py-2 bg-orange-500 text-white rounded hover:bg-orange-600\">Actualizar</button>\n          </div>
        `;
        if (window.lucide) lucide.createIcons();
        document.getElementById('refreshReports')?.addEventListener('click', loadInquiries);
      } else {
        alertBox.classList.add('hidden');
      }
    }

  } catch (e) {
    console.error('Error loading inquiries:', e);
    container.innerHTML = `<div class=\"col-span-3 text-center p-4 text-red-500\">Error: ${e.message}</div>`;
  }
}

// Ver detalle de reporte (Modal)
window.openInquiryDetail = async function(id) {
  const modal = document.getElementById('inquiryDetailModal');
  if (!modal) return;

  const supabase = await getSupabase();
  const { data: item } = await supabase.from('inquiries').select('*, parent:profiles(name)').eq('id', id).single();
  
  if (!item) return;

  document.getElementById('inqDetailSubject').textContent = item.subject || 'Sin asunto';
  document.getElementById('inqDetailMeta').textContent = `${new Date(item.created_at).toLocaleString()} • ${item.parent?.name || 'Padre'}`;
  document.getElementById('inqDetailMessage').textContent = item.message;

  const attContainer = document.getElementById('inqDetailAttachment');
  const img = document.getElementById('inqDetailImage');
  const link = document.getElementById('inqDetailLink');

  if (item.attachment_url) {
    attContainer.classList.remove('hidden');
    img.src = item.attachment_url;
    link.href = item.attachment_url;
  } else {
    attContainer.classList.add('hidden');
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  
  // Cerrar modal
  const closeBtn = document.getElementById('btnCloseInquiryDetail');
  if(closeBtn) {
      closeBtn.onclick = () => {
          modal.classList.add('hidden');
          modal.classList.remove('flex');
      };
  }
};

// Avanzar estado de incidencia
window.advanceInquiry = async function(id, current) {
  const flow = ['received','review','in_progress','resolved','closed'];
  const idx = flow.indexOf(current);
  const next = flow[Math.min(flow.length-1, Math.max(0, idx+1))];
  const supabase = await getSupabase();
  const { error } = await supabase.from('inquiries').update({ status: next, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) alert('No se pudo actualizar estado'); else loadInquiries();
};

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
  
  // EDITAR PERFIL DESDE PERFIL MODAL
  const editBtn = document.getElementById('editStudentProfile');
  if (editBtn) {
    editBtn.addEventListener('click', async () => {
      const supabase = await getSupabase();
      if (!supabase) return;
      const profileModal = qs('#studentProfileModal');
      const id = profileModal?.dataset?.studentId;
      if (!id) {
        openModal('Aviso', 'No se pudo identificar el estudiante para editar.');
        return;
      }
      try {
        const { data: s, error } = await supabase.from('students').select('*').eq('id', id).single();
        if (error) throw error;
        // Abrir modal de edición/creación
        const modal = qs('#modalAddStudent');
        if (!modal) return;
        modal.classList.remove('hidden');
        // Poblar campos
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        setVal('stName', s.name);
        setVal('stAge', ''); // no en esquema
        setVal('stSchedule', ''); // no en esquema
        setVal('p1Name', s.p1_name);
        setVal('p1Phone', s.p1_phone);
        setVal('p1Email', s.p1_email);
        setVal('p1Password', ''); // no mostrar
        setVal('p2Name', s.p2_name);
        setVal('p2Phone', s.p2_phone);
        setVal('stAllergies', s.allergies);
        setVal('stBlood', s.blood_type);
        setVal('stMonthlyFee', s.monthly_fee);
        setVal('stDueDay', s.due_day);
        setVal('stPickup', s.authorized_pickup);
        const activeChk = document.getElementById('stActive');
        if (activeChk) activeChk.checked = !!s.is_active;
        // Aulas
        const sel = document.getElementById('stClassroom');
        if (sel) {
          const { data: rooms } = await supabase.from('classrooms').select('id,name').order('name');
          sel.innerHTML = '<option value="">-- Seleccionar Aula --</option>' + (rooms||[]).map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
          sel.value = s.classroom_id || '';
        }
      } catch (e) {
        console.error(e);
        openModal('Error', e.message || 'No se pudo abrir la edición');
      }
    });
  }

  // DELEGACIÓN PARA BOTÓN EDITAR EN GRID (NUEVO)
  const studentsGrid = document.getElementById('studentsGrid');
  if (studentsGrid) {
    studentsGrid.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.edit-student-btn');
      if (editBtn) {
        const id = editBtn.dataset.studentId;
        openEditStudentModal(id);
      }
      
      const viewBtn = e.target.closest('.view-profile-btn');
      if (viewBtn) {
         const id = viewBtn.dataset.studentId;
         if (window.openStudentProfile) window.openStudentProfile(id);
      }
    });
  }

  // Helper para abrir modal de edición
  async function openEditStudentModal(id) {
      const supabase = await getSupabase();
      if (!supabase) return;
      
      try {
        const { data: s, error } = await supabase.from('students').select('*').eq('id', id).single();
        if (error) throw error;
        
        const modal = document.getElementById('modalAddStudent');
        if (!modal) return;
        modal.classList.remove('hidden');
        
        // Poblar campos
        const setVal = (eid, val) => { const el = document.getElementById(eid); if (el) el.value = val || ''; };
        setVal('stName', s.name);
        setVal('stAge', ''); 
        setVal('stSchedule', '');
        setVal('p1Name', s.p1_name);
        setVal('p1Phone', s.p1_phone);
        setVal('p1Email', s.p1_email);
        setVal('p1Password', ''); 
        setVal('p2Name', s.p2_name);
        setVal('p2Phone', s.p2_phone);
        setVal('stAllergies', s.allergies);
        setVal('stBlood', s.blood_type);
        setVal('stMonthlyFee', s.monthly_fee);
        setVal('stDueDay', s.due_day);
        setVal('stPickup', s.authorized_pickup);
        
        const activeChk = document.getElementById('stActive');
        if (activeChk) activeChk.checked = !!s.is_active;
        
        const sel = document.getElementById('stClassroom');
        if (sel) sel.value = s.classroom_id || '';
        
      } catch (e) {
        console.error(e);
        alert('Error al cargar datos del estudiante');
      }
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

  // EXPORTAR ESTUDIANTES A EXCEL (CSV)
  const btnExport = document.getElementById('btnExportStudents');
  if (btnExport) {
    btnExport.addEventListener('click', async () => {
      const supabase = await getSupabase();
      const { data: students } = await supabase
        .from('students')
        .select('id, name, classrooms(name), p1_name, p1_email, p1_phone, is_active, monthly_fee, due_day')
        .order('name');
      
      if (!students || !students.length) { alert('No hay datos para exportar'); return; }
      
      const csvContent = [
        ['ID', 'Nombre', 'Aula', 'Padre/Tutor', 'Email', 'Teléfono', 'Estado', 'Mensualidad', 'Día Pago'].join(','),
        ...students.map(s => [
          s.id,
          `"${s.name}"`,
          `"${s.classrooms?.name || ''}"`,
          `"${s.p1_name || ''}"`,
          s.p1_email || '',
          s.p1_phone || '',
          s.is_active ? 'Activo' : 'Inactivo',
          s.monthly_fee || 0,
          s.due_day || 5
        ].join(','))
      ].join('\n');
      
      const blob = new Blob(["\uFEFF"+csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `estudiantes_karpus_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  // GUARDAR NUEVO ESTUDIANTE (ya implementado en app.js, no se duplica aquí)
}

function clearStudentModal(){
  ['stName','stAge','stSchedule','p1Name','p1Phone','p2Name','p2Phone', 'stAllergies', 'stBlood', 'stPickup'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  const sel = document.getElementById('stClassroom');
  if (sel) sel.value = '';
  const ch = document.getElementById('stActive'); 
  if(ch) ch.checked = true;
  const prev = document.getElementById('stPhotoPreview');
  const ico = document.getElementById('stPhotoIcon');
  if (prev) prev.classList.add('hidden');
  if (ico) ico.classList.remove('hidden');
  const enr = document.getElementById('stEnrollment');
  if (enr) enr.textContent = '—';
}

//

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
