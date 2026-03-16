import { supabase, sendPush, sendEmail } from './supabase.js';

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

const Helpers = {
  toast: (msg, type='success') => {
      const t = document.createElement('div');
      t.className = `fixed bottom-4 right-4 px-4 py-2 rounded shadow text-white z-50 ${type==='error'?'bg-red-500':'bg-green-500'}`;
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(()=>t.remove(), 3000);
  },
  emptyState: (msg) => `<div class="text-center py-8 text-slate-400">${msg}</div>`,
  skeleton: (cols=10) => `<tr class="animate-pulse"><td colspan="${cols}" class="p-4 bg-slate-50 h-12"></td></tr>`
};

document.addEventListener('DOMContentLoaded', ()=>{
  // Enforce role without inline script
  // if (window.Auth && !Auth.enforceRole('directora')) return; // REMOVED: Using Supabase Auth in app.js
  // initDashboardChart(); // REMOVED: Managed by app.js to avoid canvas conflict
  
  safeInit(attachPaymentsHandlers);
  safeInit(initTeamsComms); // Teams-like UI
  safeInit(attachGradesHandlers);
  safeInit(attachReportsHandlers);
  // initNavDirector(); // REMOVED: Managed by app.js
  safeInit(initStudentController);
  safeInit(initStudentKPIs); // Nueva función para cargar tarjetas
  // initTeacherModule(); // REMOVED: Managed by app.js (Supabase)
  // initRoomsModule();   // REMOVED: Managed by app.js (Supabase)
  safeInit(initAttendanceModule); // Real attendance stats
  
  safeInit(initDirectorVideoCall); // ✅ Módulo de Videollamada
  safeInit(initDirectorWall); // 🚀 Nuevo Muro Global
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

// --- MÓDULO DE VIDEOLLAMADA (Directora) ---
function initDirectorVideoCall() {
  // 1. Inyectar Botón Flotante
  const fab = document.createElement('button');
  fab.className = 'fixed bottom-6 right-6 w-14 h-14 bg-rose-600 hover:bg-rose-700 text-white rounded-full shadow-2xl flex items-center justify-center z-50 transition-transform hover:scale-110';
  fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/></svg>';
  fab.title = "Iniciar Reunión";
  fab.onclick = openDirectorMeeting;
  document.body.appendChild(fab);

  // 2. Inyectar Modal de Video (si no existe)
  if (!document.getElementById('videoModal')) {
    const modal = document.createElement('div');
    modal.id = 'videoModal';
    modal.className = 'fixed inset-0 bg-slate-900/90 hidden items-center justify-center z-[100] backdrop-blur-sm p-4';
    modal.innerHTML = `
      <div class="bg-white w-full max-w-6xl h-[85vh] rounded-3xl overflow-hidden flex flex-col relative shadow-2xl">
        <div class="bg-slate-900 p-4 flex justify-between items-center">
           <h3 class="text-white font-bold flex items-center gap-2"><span class="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span> Sala de Dirección</h3>
           <button id="closeVideoModal" class="bg-slate-700 text-white p-2 rounded-full hover:bg-red-600 transition-colors">
             <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
           </button>
        </div>
        <div id="jitsi-director-container" class="flex-1 bg-black"></div>
      </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById('closeVideoModal').onclick = () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      if (window.jitsiDirectorApi) {
        window.jitsiDirectorApi.dispose();
        window.jitsiDirectorApi = null;
      }
    };
  }
}

window.openDirectorMeeting = function() {
  const modal = document.getElementById('videoModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  
  // Cargar script Jitsi dinámicamente si no está
  if (!window.JitsiMeetExternalAPI) {
    const script = document.createElement('script');
    script.src = 'https://meet.jit.si/external_api.js';
    script.onload = launchJitsi;
    document.head.appendChild(script);
  } else {
    launchJitsi();
  }

  function launchJitsi() {
    if (window.jitsiDirectorApi) window.jitsiDirectorApi.dispose();
    const domain = "meet.jit.si";
    const options = {
      roomName: "KarpusKids_Direccion_General",
      width: "100%",
      height: "100%",
      parentNode: document.getElementById('jitsi-director-container'),
      lang: 'es',
      userInfo: { displayName: 'Directora' },
      configOverwrite: { 
          startWithAudioMuted: false, 
          startWithVideoMuted: false,
          prejoinPageEnabled: false,
          enableLobby: false,
          defaultLanguage: 'es'
      },
      interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          MOBILE_APP_PROMO: false
      }
    };
    window.jitsiDirectorApi = new JitsiMeetExternalAPI(domain, options);
  }
};

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
  document.getElementById('btnGenerateCharges')?.addEventListener('click', generateMonthlyCharges);
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
  document.getElementById('btnSendWeeklySummary')?.addEventListener('click', sendWeeklySummary);

  // Recordatorios y Filtros
  document.getElementById('btnSaveReminder')?.addEventListener('click', saveReminder);
  document.getElementById('btnSendReminders')?.addEventListener('click', sendRemindersNow);
  document.getElementById('paymentMonthFilter')?.addEventListener('change', () => loadPayments());
  document.getElementById('filterPaymentYear')?.addEventListener('change', () => loadPayments());

  // Delegación de eventos para la tabla de pagos
  const tbody = document.getElementById('paymentsTableBody');
  if (tbody) {
    tbody.addEventListener('click', async (e) => {
      const btnRegister = e.target.closest('.btn-register-payment');
      const btnConfirm = e.target.closest('.btn-confirm-payment');
      const btnReject = e.target.closest('.btn-reject-payment');
      const btnDelete = e.target.closest('.btn-delete-payment');
      const btnRemind = e.target.closest('.btn-remind-payment');

      if (btnRegister) {
        openPaymentModal(btnRegister.dataset.studentId);
      }
      if (btnConfirm) {
        await processPaymentAction(btnConfirm.dataset.id, 'confirmado');
      }
      if (btnReject) {
        await processPaymentAction(btnReject.dataset.id, 'rechazado');
      }
      if (btnDelete) {
        await deletePayment(btnDelete.dataset.id);
      }
      if (btnRemind) {
        await sendPaymentReminder(btnRemind.dataset.parentId, btnRemind.dataset.studentName);
      }
    });
  }
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

async function processPaymentAction(id, status) {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  
  const updates = { status, validated_by: user?.id };
  if (status === 'rechazado') {
    const reason = prompt('Motivo del rechazo:');
    if (reason) updates.notes = reason;
  }

  const { data: payment, error } = await supabase
    .from('payments')
    .update(updates)
    .eq('id', id)
    .select('*, student:students(name, p1_email, p1_name, parent_id)')
    .single();

  if (!error && payment) {
    Helpers.toast(`Pago ${status}`);
    loadPayments();

    // Notificación por correo (Resend)
    if (status === 'confirmado' && payment.student?.p1_email) {
      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #16a34a;">¡Pago Confirmado!</h2>
          <p>Hola <b>${payment.student.p1_name || 'familia'}</b>,</p>
          <p>Confirmamos que tu pago de <b>$${payment.amount}</b> correspondiente a <b>${payment.month_paid}</b> ha sido aprobado con éxito.</p>
          <p>Gracias por tu puntualidad y apoyo a Karpus Kids.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">Este es un correo automático, no es necesario responder.</p>
        </div>
      `;
      await sendEmail(payment.student.p1_email, `Recibo de Pago Aprobado - ${payment.month_paid}`, html);
    }
  } else {
    Helpers.toast('Error al actualizar', 'error');
  }
}

// =============================== 
// PAGOS CON SUPABASE (NUEVA ESTRUCTURA)
// ===============================
async function loadPayments(forceFilter = null) {
  const supabase = await getSupabase();
  if (!supabase) return;

  const tbody = document.getElementById('paymentsTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = Helpers.skeleton(10);

  try {
    const selectedMonth = document.getElementById('paymentMonthFilter')?.value || new Date().toLocaleString('es-ES', { month: 'long' });
    const capitalizedMonth = selectedMonth.charAt(0).toUpperCase() + selectedMonth.slice(1);
    const selectedYear = document.getElementById('filterPaymentYear')?.value || new Date().getFullYear();

    // 1. Cargar Estudiantes
    const { data: students, error: stError } = await supabase
      .from('students')
      .select('*, classrooms(name)')
      .eq('is_active', true)
      .order('name');

    if (stError) throw stError;

    // 2. Cargar Pagos del Mes
    const { data: payments, error: payError } = await supabase
      .from('payments')
      .select('*')
      .ilike('month_paid', `%${selectedMonth}%`) // Flexible match
      .gte('created_at', `${selectedYear}-01-01T00:00:00`)
      .lte('created_at', `${selectedYear}-12-31T23:59:59`);

    if (payError) throw payError;

    // 3. Mapear pagos
    const paymentMap = {};
    (payments || []).forEach(p => {
      // Priorizar pagos confirmados si hay múltiples intentos
      if (!paymentMap[p.student_id] || p.status === 'confirmado') {
        paymentMap[p.student_id] = p;
      }
    });
    
    // KPIs
    let kpiIncome = 0;
    let kpiPending = 0;
    let kpiOverdue = 0;
    let kpiConfirmed = 0;
    let kpiToApprove = 0;

    const displayData = students.map(s => {
      const pay = paymentMap[s.id];
      const isPaid = pay && (pay.status === 'confirmado' || pay.status === 'paid' || pay.status === 'efectivo');
      const isPendingReview = pay && pay.status === 'pendiente';
      const isGeneratedPending = pay && pay.status === 'pending'; // Generado por sistema

      if (isPaid) { kpiConfirmed++; kpiIncome += Number(pay.amount); }
      else if (isPendingReview) { kpiToApprove++; }
      else { kpiPending++; } // Asumiendo vencido si no hay pago

      const studentInfo = {
        student_name: s.name,
        classroom_name: s.classrooms?.name || 'Sin Aula',
        parent_id: s.parent_id,
        monthly_fee: s.monthly_fee || 0
      };

      if (pay) {
        return { ...pay, ...studentInfo, is_virtual: false, monthly_fee: studentInfo.monthly_fee };
      } else {
        // Registro virtual para mostrar en tabla aunque no exista en BD
        kpiOverdue++;
        return { 
          id: null, 
          student_id: s.id, 
          ...studentInfo,
          amount: 0, 
          month_paid: capitalizedMonth, 
          method: '-', 
          status: 'no_generado', 
          bank: '-', 
          reference: '-', 
          created_at: null, 
          evidence_url: null,
          is_virtual: true 
        };
      }
    });

    // 3. Renderizar KPIs
    const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    setTxt('kpiIncomeMonth', `$${kpiIncome.toLocaleString()}`);
    setTxt('kpiPendingCount', kpiPending);
    setTxt('kpiOverdueCount', kpiOverdue);
    setTxt('kpiConfirmedCount', kpiConfirmed);
    setTxt('kpiToApproveCount', kpiToApprove);

    loadIncomeChart(); // Cargar gráfica mensual

    // 4. Filtrar y Renderizar Tabla
    const searchTerm = document.getElementById('searchPaymentStudent')?.value.toLowerCase();
    let filteredData = displayData;

    if (searchTerm) {
      filteredData = displayData.filter(p => p.student_name.toLowerCase().includes(searchTerm));
    }

    if (filteredData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center py-12 text-slate-400">No se encontraron registros.</td></tr>';
      return;
    }

    tbody.innerHTML = filteredData.map(p => {
      const badgeClass = (st) => {
        if (st === 'confirmado' || st === 'paid') return 'bg-emerald-100 text-emerald-700';
        if (st === 'pendiente') return 'bg-amber-100 text-amber-700';
        if (st === 'pending') return 'bg-orange-100 text-orange-700'; // Deuda generada
        if (st === 'rechazado') return 'bg-red-100 text-red-700';
        if (st === 'no_generado') return 'bg-slate-100 text-slate-500';
        return 'bg-slate-100 text-slate-500';
      };
      
      const statusLabel = (st) => {
         if (st === 'no_generado') return 'Sin Cargo';
         if (st === 'pending') return 'Por Pagar';
         return st;
      }
      
      const feeStr = `$${Number(p.monthly_fee || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      const paidStr = `$${Number(p.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      const dueDateStr = p.due_date ? new Date(p.due_date).toLocaleDateString() : '-';
      // Deuda es la mensualidad si no está pagado
      const debtStr = (p.status === 'confirmado' || p.status === 'paid' || p.status === 'efectivo') ? '$0.00' : `<span class="text-red-600 font-bold">${feeStr}</span>`;

      return `
        <tr class="hover:bg-slate-50 border-b last:border-0 transition-colors">
          <td class="px-4 py-3 font-medium text-slate-800">
            <div class="flex flex-col">
              <span>${p.student_name}</span>
              <span class="text-[10px] text-slate-400 uppercase tracking-tighter">${p.classroom_name || 'Sin Aula'}</span>
            </div>
          </td>
          <td class="px-4 py-3">
            <span class="${badgeClass(p.status)} px-2 py-1 rounded-full text-xs font-bold uppercase whitespace-nowrap">
              ${statusLabel(p.status)}
            </span>
          </td>
          <td class="px-4 py-3 text-right text-slate-500 font-mono">${feeStr}</td>
          <td class="px-4 py-3 text-right font-medium font-mono">${(p.status === 'confirmado' || p.status === 'paid' || p.status === 'efectivo') ? paidStr : '$0.00'}</td>
          <td class="px-4 py-3 text-xs text-slate-500">${dueDateStr}</td>
          <td class="px-4 py-3 text-right font-mono">${debtStr}</td>
          <td class="px-4 py-3">
            <div class="flex gap-1 justify-end">
              ${(p.status === 'no_generado' || p.status === 'pending') ? `
                <button class="btn-register-payment bg-teal-100 text-teal-700 hover:bg-teal-200 px-3 py-1 rounded text-xs font-bold" data-student-id="${p.student_id}">
                  Registrar
                </button>
                ${p.status === 'pending' ? `
                <button class="btn-remind-payment bg-indigo-100 text-indigo-700 hover:bg-indigo-200 p-1.5 rounded" title="Enviar Recordatorio" data-parent-id="${p.parent_id}" data-student-name="${p.student_name}">
                  <i data-lucide="bell" class="w-4 h-4"></i>
                </button>` : ''}
              ` : `
                ${p.evidence_url ? `<a href="${p.evidence_url}" target="_blank" class="bg-blue-50 text-blue-600 p-1.5 rounded hover:bg-blue-100" title="Ver Comprobante"><i data-lucide="image" class="w-4 h-4"></i></a>` : ''}
                <button class="btn-confirm-payment bg-green-100 text-green-700 hover:bg-green-200 p-1.5 rounded" title="Confirmar" data-id="${p.id}">
                  <i data-lucide="check" class="w-4 h-4"></i>
                </button>
                <button class="btn-reject-payment bg-amber-100 text-amber-700 hover:bg-amber-200 p-1.5 rounded" title="Rechazar" data-id="${p.id}">
                  <i data-lucide="x" class="w-4 h-4"></i>
                </button>
                <button class="btn-delete-payment bg-red-50 text-red-600 hover:bg-red-100 p-1.5 rounded" title="Eliminar" data-id="${p.id}">
                  <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();

  } catch (e) {
    console.error('Error cargando pagos:', e);
    tbody.innerHTML = `
      <tr><td colspan="10" class="text-center py-12 text-red-500">Error cargando datos: ${e.message}</td></tr>
    `;
  }
}

// --- Generar Cuotas Masivas ---
async function generateMonthlyCharges() {
  const month = document.getElementById('paymentMonthFilter')?.value;
  const year = document.getElementById('filterPaymentYear')?.value;
  
  if (!confirm(`¿Generar cargos de mensualidad para ${month} ${year} a todos los estudiantes activos?`)) return;
  
  const btn = document.getElementById('btnGenerateCharges');
  btn.disabled = true; btn.innerHTML = '<i data-lucide="loader" class="animate-spin w-4 h-4"></i> Procesando...';
  if(window.lucide) lucide.createIcons();

  try {
    const supabase = await getSupabase();
    
    // 1. Obtener estudiantes activos
    const { data: students } = await supabase.from('students').select('*').eq('is_active', true);
    
    // 2. Verificar pagos existentes para este mes/año
    const { data: existing } = await supabase.from('payments')
      .select('student_id')
      .ilike('month_paid', `%${month}%`)
      .gte('created_at', `${year}-01-01`)
      .lte('created_at', `${year}-12-31`);
      
    const existingIds = new Set(existing.map(p => p.student_id));
    
    // 3. Filtrar quienes faltan
    const toCreate = students.filter(s => !existingIds.has(s.id)).map(s => ({
      student_id: s.id,
      amount: s.monthly_fee || 0,
      month_paid: `${month} ${year}`,
      status: 'pending', // Estado "Por Pagar"
      method: 'sistema',
      due_date: `${year}-${new Date().getMonth() + 1}-${String(s.due_day || 5).padStart(2,'0')}` // Fecha vencimiento
    }));
    
    if (toCreate.length > 0) {
      const { error } = await supabase.from('payments').insert(toCreate);
      if (error) throw error;
      Helpers.toast(`Se generaron ${toCreate.length} cargos exitosamente.`);
    } else {
      Helpers.toast('Todos los estudiantes ya tienen cargo para este mes.', 'info');
    }
    loadPayments();
  } catch(e) {
    console.error(e);
    Helpers.toast('Error generando cargos: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = '<i data-lucide="layers" class="w-5 h-5"></i> Generar Cuotas';
    if(window.lucide) lucide.createIcons();
  }
}

// --- Lógica de Registro Manual ---
async function openPaymentModal(preSelectedStudentId = null) {
  const select = document.getElementById('payStudentSelect');
  if(!select) return;
  
  // Cargar estudiantes
  const supabase = await getSupabase();
  const { data: students } = await supabase.from('students').select('id, name').eq('is_active', true).order('name');
  
  select.innerHTML = '<option value="">Seleccionar...</option>' + 
    (students || []).map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    
  if (preSelectedStudentId) select.value = preSelectedStudentId;
  toggleModal('modalPayment', true);
}

async function savePayment() {
  const studentId = document.getElementById('payStudentSelect').value;
  const amount = document.getElementById('payAmount').value;
  const method = document.getElementById('payMethod').value;
  const concept = document.getElementById('payConcept').value;
  const year = document.getElementById('filterPaymentYear')?.value || new Date().getFullYear();
  
  if(!studentId || !amount || !concept) { alert('Complete los campos'); return; }
  
  const btn = document.getElementById('btnSavePayment');
  btn.disabled = true; btn.textContent = 'Guardando...';
  
  try {
    const supabase = await getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    
    const { error } = await supabase.from('payments').insert({
      student_id: studentId,
      amount: parseFloat(amount),
      method,
      month_paid: `${concept} ${year}`, // Normalizar con año
      status: 'confirmado', // Pago manual es directo confirmado
      validated_by: user?.id,
      created_at: new Date().toISOString()
    });
    
    if(error) throw error;
    
    toggleModal('modalPayment', false);
    loadPayments();
    Helpers.toast('Pago registrado correctamente');
  } catch(e) {
    Helpers.toast('Error: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar Pago';
  }
}

async function deletePayment(id) {
  if (!confirm('¿Eliminar este pago permanentemente?')) return;
  const supabase = await getSupabase();
  const { error } = await supabase.from('payments').delete().eq('id', id);
  if (error) Helpers.toast('Error al eliminar', 'error');
  else { Helpers.toast('Pago eliminado'); loadPayments(); }
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
  Helpers.toast(`Enviando recordatorio por ${studentName}...`, 'info');
  
  try {
    await sendPush({
      user_id: parentId,
      title: 'Recordatorio de Pago',
      message: `Se le recuerda realizar el pago pendiente de ${studentName}.`,
      type: 'payment_reminder',
      link: '/panel_padres.html'
    });
    
    Helpers.toast('Recordatorio enviado correctamente.');
  } catch (e) {
    console.error(e);
    Helpers.toast('Error enviando recordatorio', 'error');
  }
}

async function sendReminderToAllParents() {
  if (!confirm('¿Enviar recordatorio a TODOS los padres con deuda?')) return;
  
  Helpers.toast('Enviando recordatorios masivos...', 'info');
  
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
      Helpers.toast('No hay deudas pendientes.', 'info');
      return;
    }

    // 3. Enviar notificaciones una por una (OneSignal soporta batch pero sendPush es simple)
    let successCount = 0;
    
    // Optimización: Promise.all para envíos paralelos
    const promises = parentIds.map(pid => 
      sendPush({
        user_id: pid,
        title: 'Aviso de Pago',
        message: 'Estimado padre, tiene pagos pendientes. Por favor revise su estado de cuenta.',
        type: 'payment_reminder',
        link: '/panel_padres.html'
      }).then(() => successCount++).catch(err => console.error(`Error enviando a ${pid}:`, err))
    );

    await Promise.all(promises);

    Helpers.toast(`Se enviaron ${successCount} recordatorios.`);

  } catch (e) {
    Helpers.toast('Error: ' + e.message, 'error');
  }
}

// --- Recordatorios (Sistema Asistente) ---
async function saveReminder() {
  const day = Number(document.getElementById('reminderDay')?.value || '0');
  const msg = document.getElementById('reminderMessage')?.value || '';
  if (!day || !msg) { Helpers.toast('Complete recordatorio', 'error'); return; }
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('payment_reminders').insert({ day_of_month: day, message: msg, created_by: user.id });
  if (error) { Helpers.toast('Error guardando', 'error'); return; }
  Helpers.toast('Recordatorio guardado');
}

async function sendRemindersNow() {
  if (!confirm('¿Enviar recordatorios a todos los padres con deuda?')) return;
  Helpers.toast('Enviando recordatorios...', 'info');
  
  const supabase = await getSupabase();
  const selectedMonth = document.getElementById('paymentMonthFilter')?.value || 'Mes Actual';
  const msg = document.getElementById('reminderMessage')?.value || 'Recuerde realizar su pago.';

  // Obtener pagos ya realizados este mes
  const { data: payments } = await supabase
    .from('payments')
    .select('student_id')
    .eq('month_paid', selectedMonth)
    .in('status', ['confirmado', 'paid', 'efectivo']);
    
  const paidIds = (payments || []).map(p => p.student_id);
  
  const { data: students } = await supabase
    .from('students')
    .select('id, p1_email, p1_name, name')
    .eq('is_active', true);
    
  const debtors = students.filter(s => !paidIds.includes(s.id) && s.p1_email);

  let count = 0;
  for (const s of debtors) {
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ffedd5; border-radius: 10px;">
        <h2 style="color: #ea580c;">Recordatorio de Pago 📅</h2>
        <p>Hola <b>${s.p1_name || 'familia'}</b>,</p>
        <p>Te enviamos este recordatorio amistoso sobre la mensualidad de <b>${s.name}</b> correspondiente al mes de <b>${selectedMonth}</b>.</p>
        <div style="background: #fff7ed; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #ea580c;">
          <p style="margin: 0; color: #9a3412;"><b>Mensaje:</b> ${msg}</p>
        </div>
        <p>Puedes realizar tu pago a través del panel de padres o en las oficinas de la estancia.</p>
        <p>Si ya realizaste tu pago, por favor ignora este mensaje o envíanos tu comprobante.</p>
        <hr style="border: none; border-top: 1px solid #ffedd5; margin: 20px 0;">
        <p style="font-size: 12px; color: #666;">Karpus Kids - Administración</p>
      </div>
    `;
    await sendEmail(s.p1_email, `Recordatorio de Pago: Mensualidad ${selectedMonth} - ${s.name}`, html);
    count++;
  }
  Helpers.toast(`Enviados ${count} recordatorios por correo.`);
}

async function sendWeeklySummary() {
  if (!confirm('¿Enviar resumen semanal con fotos a todos los padres?')) return;
  Helpers.toast('Preparando resumen semanal...', 'info');

  const supabase = await getSupabase();
  const { data: students } = await supabase
    .from('students')
    .select('id, name, p1_email, p1_name, classroom_id')
    .eq('is_active', true);

  if (!students?.length) return;

  // Obtener fotos recientes de la galería
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  
  const { data: photos } = await supabase
    .from('classroom_gallery')
    .select('*')
    .gte('created_at', lastWeek.toISOString());

  let count = 0;
  for (const s of students) {
    if (!s.p1_email) continue;
    
    const classPhotos = (photos || []).filter(p => p.classroom_id === s.classroom_id).slice(0, 3);
    const photosHtml = classPhotos.map(p => `
      <div style="margin-bottom: 10px;">
        <img src="${p.image_url}" style="width: 100%; max-width: 300px; border-radius: 8px;" alt="Actividad">
        <p style="font-size: 12px; color: #666; margin-top: 4px;">${p.caption || 'Actividad del día'}</p>
      </div>
    `).join('');

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #dcfce7; border-radius: 10px;">
        <h2 style="color: #16a34a;">Resumen Semanal Karpus Kids 🌟</h2>
        <p>Hola <b>${s.p1_name || 'familia'}</b>,</p>
        <p>Esperamos que hayan tenido una excelente semana. Aquí les compartimos un pequeño resumen de lo que <b>${s.name}</b> y sus compañeros vivieron estos días:</p>
        
        <div style="background: #f0fdf4; padding: 20px; border-radius: 12px; margin: 20px 0;">
          <h3 style="color: #166534; margin-top: 0;">📸 Momentos Destacados</h3>
          ${photosHtml || '<p>Esta semana nos enfocamos en actividades sensoriales y de lenguaje.</p>'}
        </div>

        <p>Pueden ver más fotos y detalles en su panel de padres.</p>
        <hr style="border: none; border-top: 1px solid #dcfce7; margin: 20px 0;">
        <p style="font-size: 12px; color: #666;">Karpus Kids - Creciendo Juntos</p>
      </div>
    `;

    await sendEmail(s.p1_email, `Resumen Semanal: ¡Mira lo que aprendimos esta semana! ✨`, html);
    count++;
  }
  Helpers.toast(`Resumen enviado a ${count} familias.`);
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

// --- 1️⃣ MURO GLOBAL (DIRECTORA) ---
async function initDirectorWall() {
  const container = document.getElementById('directorWallContainer'); // Necesitas agregar este div en tu HTML
  if (!container) return;

  container.innerHTML = '<div class="text-center p-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div><p class="mt-2 text-slate-500">Cargando Muro Global...</p></div>';

  const supabase = await getSupabase();
  if (!supabase) return;

  try {
    // Obtener posts de TODAS las aulas (la nueva policy lo permite)
    const { data: posts, error } = await supabase
      .from('posts')
      .select(`
        *, 
        classrooms(name),
        likes(count),
        comments(count)
      `)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    if (!posts || posts.length === 0) {
      container.innerHTML = Helpers.emptyState('No hay publicaciones recientes en ninguna aula.');
      return;
    }

    container.innerHTML = posts.map(p => `
      <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-4 hover:shadow-md transition-shadow">
        <div class="flex justify-between items-start mb-3">
          <div class="flex items-center gap-3">
             <div class="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-bold overflow-hidden">
                ${p.teacher_avatar ? `<img src="${p.teacher_avatar}" class="w-full h-full object-cover">` : (p.teacher_name ? p.teacher_name.charAt(0) : 'M')}
             </div>
             <div>
                <div class="font-bold text-slate-800">${escapeHTML(p.teacher_name || 'Maestra')}</div>
                <div class="text-xs text-slate-500">${new Date(p.created_at).toLocaleString()} • <span class="text-purple-600 font-bold">${p.classrooms?.name || 'Aula'}</span></div>
             </div>
          </div>
        </div>
        <div class="text-slate-700 mb-3 whitespace-pre-wrap">${escapeHTML(p.content)}</div>
        ${p.media_url ? `<div class="rounded-xl overflow-hidden mb-3 border border-slate-100"><img src="${p.media_url}" class="w-full max-h-64 object-cover"></div>` : ''}
        <div class="flex items-center gap-4 text-xs text-slate-500 border-t pt-3">
           <span class="flex items-center gap-1"><i data-lucide="heart" class="w-4 h-4"></i> ${p.likes[0]?.count || 0} Likes</span>
           <span class="flex items-center gap-1"><i data-lucide="message-circle" class="w-4 h-4"></i> ${p.comments[0]?.count || 0} Comentarios</span>
        </div>
      </div>
    `).join('');
    
    if (window.lucide) lucide.createIcons();

  } catch (err) {
    console.error('Error cargando muro global:', err);
    container.innerHTML = Helpers.emptyState('Error cargando publicaciones.');
  }
}

// --- 2️⃣ CHAT PROFESIONAL UNIFICADO ---
window.initTeamsComms = async function() {
  const listContainer = document.getElementById('chatContactsList');
  if (!listContainer) return;

  const chatInput = document.getElementById('chatMessageInput');
  const chatSend = document.getElementById('btnSendChatMessage');
  const searchInput = document.getElementById('chatSearchInput');
  const roleFilter = document.getElementById('chatRoleFilter');

  // Variables de estado local para el chat (Directora no usa AppState global igual que maestra)
  let allContacts = [];
  let currentChatUser = null;
  let chatChannel = null;

  // 1. Cargar Usuarios
  async function loadChatUsers() {
    listContainer.innerHTML = Helpers.skeleton(4);
    
    const supabase = await getSupabase();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    // Obtener todos los perfiles excepto el mío
    let query = supabase.from('profiles').select('*').neq('id', currentUser.id);
    
    const roleVal = roleFilter?.value;
    if (roleVal && roleVal !== 'all') {
      query = query.eq('role', roleVal);
    }

    const { data: users, error } = await query.order('name');
    
    if (error) {
      listContainer.innerHTML = Helpers.emptyState('Error al cargar contactos');
      return;
    }

    // Enriquecer con info de aula si son padres
    const parentIds = users.filter(u => u.role === 'parent').map(u => u.id);
    let studentMap = {};
    if (parentIds.length > 0) {
      const { data: students } = await supabase
        .from('students')
        .select('parent_id, name, classrooms(name)')
        .in('parent_id', parentIds);
      
      students?.forEach(s => {
        if (!studentMap[s.parent_id]) {
          studentMap[s.parent_id] = { studentName: s.name, classroomName: s.classrooms?.name || 'Aula' };
        }
      });
    }

    allContacts = users.map(u => ({
      id: u.id,
      name: u.name,
      avatar: u.avatar_url,
      role: u.role === 'teacher' ? 'Maestro/a' : (u.role === 'parent' ? 'Padre/Madre' : 'Asistente'),
      meta: u.role === 'parent' ? `Aula: ${studentMap[u.id]?.classroomName || '---'} (${studentMap[u.id]?.studentName || '---'})` : 'Personal Karpus'
    }));

    renderContacts(allContacts);
  }

  function renderContacts(contacts) {
    const q = searchInput?.value.toLowerCase() || '';
    const filtered = contacts.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.meta.toLowerCase().includes(q) ||
      c.role.toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
      listContainer.innerHTML = Helpers.emptyState('No se encontraron contactos');
      return;
    }

    listContainer.innerHTML = filtered.map(c => `
      <div onclick="window.selectDirectorChat('${c.id}', '${escapeHTML(c.name)}', '${c.role}', '${c.meta}', '${c.avatar || ''}')" 
           class="flex items-center gap-3 p-3 rounded-2xl hover:bg-white hover:shadow-sm cursor-pointer transition-all border border-transparent hover:border-slate-100 group">
        <div class="w-11 h-11 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold overflow-hidden border border-blue-50 flex-shrink-0">
          ${c.avatar ? `<img src="${c.avatar}" class="w-full h-full object-cover">` : c.name.charAt(0)}
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-bold text-slate-700 text-sm truncate group-hover:text-blue-600 transition-colors">${escapeHTML(c.name)}</div>
          <div class="text-[10px] text-slate-400 font-bold uppercase truncate">${c.role}</div>
          <div class="text-[10px] text-slate-500 truncate mt-0.5">${c.meta}</div>
        </div>
      </div>
    `).join('');
  }

  // 2. Seleccionar Chat
  window.selectDirectorChat = async (userId, name, role, meta, avatar) => {
    const supabase = await getSupabase();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    currentChatUser = userId;

    // UI Updates
    document.getElementById('chatActiveHeader').classList.remove('hidden');
    document.getElementById('chatInputArea').classList.remove('hidden');
    document.getElementById('chatActiveName').textContent = name;
    document.getElementById('chatActiveMeta').textContent = `${role} • ${meta}`;
    
    const avatarEl = document.getElementById('chatActiveAvatar');
    avatarEl.innerHTML = avatar ? `<img src="${avatar}" class="w-full h-full object-cover">` : name.charAt(0);

    const msgContainer = document.getElementById('chatMessagesContainer');
    msgContainer.innerHTML = `<div class="flex-1 flex items-center justify-center"><i data-lucide="loader-2" class="w-8 h-8 animate-spin text-blue-400"></i></div>`;
    if(window.lucide) lucide.createIcons();

    // Cargar historial
    const { data: msgs, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${currentUser.id})`)
      .order('created_at', { ascending: true });

    msgContainer.innerHTML = '';
    if (msgs && msgs.length > 0) {
      msgs.forEach(m => appendMessage(m, currentUser.id));
    } else {
      msgContainer.innerHTML = `
        <div class="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-60">
          <i data-lucide="sparkles" class="w-12 h-12 mb-3 text-blue-300"></i>
          <p class="text-sm">¡Inicia la conversación con ${name}!</p>
        </div>
      `;
      if(window.lucide) lucide.createIcons();
    }
    msgContainer.scrollTop = msgContainer.scrollHeight;

    // Realtime Subscription
    if (chatChannel) supabase.removeChannel(chatChannel);

    chatChannel = supabase.channel(`chat_dir_${currentUser.id}_${userId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages',
        filter: `receiver_id=eq.${currentUser.id}` 
      }, payload => {
        if (payload.new.sender_id === userId) {
          if (msgContainer.querySelector('.opacity-60')) msgContainer.innerHTML = '';
          appendMessage(payload.new, currentUser.id);
          msgContainer.scrollTop = msgContainer.scrollHeight;
        }
      })
      .subscribe();
  };

  function appendMessage(msg, myId) {
    const container = document.getElementById('chatMessagesContainer');
    const isMine = msg.sender_id === myId;
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const div = document.createElement('div');
    div.className = `flex ${isMine ? 'justify-end' : 'justify-start'} animate-fade-in`;
    div.innerHTML = `
      <div class="max-w-[85%] md:max-w-[70%] group">
        <div class="px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
          isMine 
            ? 'bg-blue-600 text-white rounded-tr-none' 
            : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none'
        }">
          <div class="whitespace-pre-wrap break-words">${escapeHTML(msg.content)}</div>
          <div class="text-[9px] ${isMine ? 'text-blue-200' : 'text-slate-400'} mt-1 text-right font-bold uppercase tracking-tighter">
            ${time}
          </div>
        </div>
      </div>
    `;
    container.appendChild(div);
  }

  // 3. Enviar Mensaje
  async function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text || !currentChatUser) return;
    
    const supabase = await getSupabase();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    
    // UI Optimista
    const msgContainer = document.getElementById('chatMessagesContainer');
    if (msgContainer.querySelector('.opacity-60')) msgContainer.innerHTML = '';
    appendMessage({ content: text, sender_id: currentUser.id, created_at: new Date().toISOString() }, currentUser.id);
    msgContainer.scrollTop = msgContainer.scrollHeight;
    
    chatInput.value = '';
    chatInput.style.height = 'auto';

    try {
      await supabase.from('messages').insert({
        sender_id: currentUser.id,
        receiver_id: currentChatUser,
        content: text
      });
       
      sendPush({
        user_id: currentChatUser,
        title: 'Nuevo mensaje de Dirección',
        message: text,
        type: 'chat'
      });
    } catch (e) { console.error(e); }
  }

  // Eventos
  chatSend?.addEventListener('click', sendChatMessage);
  chatInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  searchInput?.addEventListener('input', () => renderContacts(allContacts));
  roleFilter?.addEventListener('change', loadChatUsers);

  loadChatUsers();
};

let incomeChartInstance = null;

async function loadIncomeChart() {
  const supabase = await getSupabase();
  if (!supabase) return;

  const { data, error } = await supabase
    .from('payments')
    .select('amount, month_paid, status');

  if (error) return;

  const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const confirmedData = new Array(12).fill(0);
  const pendingData = new Array(12).fill(0);

  (data || []).forEach(p => {
    const idx = months.indexOf(p.month_paid);
    if (idx !== -1) {
      const amount = Number(p.amount) || 0;
      if (p.status === 'confirmado' || p.status === 'paid' || p.status === 'efectivo') {
         confirmedData[idx] += amount;
      } else if (p.status !== 'rechazado') {
         pendingData[idx] += amount;
      }
    }
  });

  const ctx = document.getElementById('incomeMonthlyChart');
  if (!ctx) return;

  if (incomeChartInstance) incomeChartInstance.destroy();

  // Crear gradientes para un look moderno
  const gradientConfirmed = ctx.getContext('2d').createLinearGradient(0, 0, 0, 400);
  gradientConfirmed.addColorStop(0, '#10b981'); // Emerald 500
  gradientConfirmed.addColorStop(1, '#059669'); // Emerald 600

  const gradientPending = ctx.getContext('2d').createLinearGradient(0, 0, 0, 400);
  gradientPending.addColorStop(0, '#94a3b8'); // Slate 400
  gradientPending.addColorStop(1, '#64748b'); // Slate 500

  incomeChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        { 
          label: 'Confirmado', 
          data: confirmedData, 
          backgroundColor: gradientConfirmed, 
          borderRadius: 6,
          borderSkipped: false,
          barPercentage: 0.6,
          categoryPercentage: 0.8
        },
        { 
          label: 'Pendiente', 
          data: pendingData, 
          backgroundColor: '#e2e8f0', 
          borderRadius: 6,
          borderSkipped: false,
          barPercentage: 0.6,
          categoryPercentage: 0.8
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { 
        y: { 
          beginAtZero: true,
          grid: { color: '#f1f5f9', borderDash: [5, 5] },
          ticks: { font: { family: "'Nunito', sans-serif" }, color: '#64748b' }
        }, 
        x: { 
          grid: { display: false },
          ticks: { font: { family: "'Nunito', sans-serif" }, color: '#64748b' }
        } 
      },
      plugins: { 
        legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          backgroundColor: '#1e293b',
          padding: 12,
          titleFont: { size: 13, family: "'Nunito', sans-serif" },
          bodyFont: { size: 13, family: "'Nunito', sans-serif" },
          cornerRadius: 8,
          displayColors: true
        }
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
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
    
    // UNIFICACIÓN: Usar task_evidences en lugar de la tabla grades vacía
    const { data: evidences, error: evError } = await supabase
      .from('task_evidences')
      .select('student_id, grade_letter, created_at')
      .not('grade_letter', 'is', null);
      
    if (evError) throw evError;

    const letterMap = { 'A': 100, 'B': 85, 'C': 70, 'D': 60, 'F': 50 };
    // Calculate averages
    const averages = {}; 
    const lastScores = {};
    (evidences || []).forEach(e => {
      const sid = e.student_id;
      const scoreNum = letterMap[e.grade_letter] || 0;
      const ts = e.created_at ? new Date(e.created_at).getTime() : 0;
      if (!averages[sid]) averages[sid] = { sum: 0, count: 0 };
      averages[sid].sum += scoreNum;
      averages[sid].count++;
      if (!lastScores[sid] || ts > lastScores[sid].ts) lastScores[sid] = { letter: e.grade_letter, ts };
    });
    if (!students || students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center p-4 text-slate-500">No hay estudiantes activos.</td></tr>';
      return;
    }

    tbody.innerHTML = students.map(s => {
      const stats = averages[s.id] || { sum: 0, count: 0 };
      const avg = stats.count > 0 ? Math.round(stats.sum / stats.count) : '-';
      
      // Determine status/color based on average (example logic)
      let statusHtml = '<span class="text-slate-400">-</span>';
      if (avg !== '-') {
        const numAvg = parseFloat(avg);
        if (numAvg >= 90) statusHtml = '<span class="text-green-600 font-bold">Excelente</span>';
        else if (numAvg >= 80) statusHtml = '<span class="text-blue-600 font-bold">Bueno</span>';
        else if (numAvg >= 70) statusHtml = '<span class="text-yellow-600 font-bold">Regular</span>';
        else statusHtml = '<span class="text-red-600 font-bold">Reprobado</span>';
      }

      const last = lastScores[s.id]?.letter || '-';
      return `
        <tr class="border-b hover:bg-slate-50">
          <td class="p-3 font-medium text-slate-700">${s.name}</td>
          <td class="p-3 text-slate-600">${s.classroom?.name || 'Sin Aula'}</td>
          <td class="p-3 text-center">${last}</td> 
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

// ===============================
// KPIs DE ESTUDIANTES (Corrección Tarjetas)
// ===============================
async function initStudentKPIs() {
  // Cargar inmediatamente
  await updateStudentKPIs();

  // Intentar engancharse a la función global de carga si existe (definida en app.js)
  if (typeof window.loadStudents === 'function') {
    const originalLoad = window.loadStudents;
    window.loadStudents = async function(page) {
      await originalLoad(page);
      await updateStudentKPIs(); // Actualizar KPIs cada vez que se recarga la tabla
    };
  }
}

async function updateStudentKPIs() {
  const supabase = await getSupabase();
  if (!supabase) return;

  try {
    // 1. Consultas en paralelo para rendimiento
    const [totalRes, activeRes, incidentRes, classRes] = await Promise.all([
      supabase.from('students').select('*', { count: 'exact', head: true }),
      supabase.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('incidents').select('*', { count: 'exact', head: true }).eq('status', 'received'), // Incidencias activas/nuevas
      supabase.from('classrooms').select('*', { count: 'exact', head: true })
    ]);

    // 2. Actualizar DOM
    const setTxt = (id, val) => { 
      const el = document.getElementById(id); 
      if(el) el.textContent = val; 
    };

    setTxt('stuKpiTotal', totalRes.count || 0);
    setTxt('stuKpiActive', activeRes.count || 0);
    setTxt('stuKpiIncidents', incidentRes.count || 0);
    setTxt('stuKpiByClass', classRes.count || 0);
    
    // Promedios simulados o calcular real si hay tabla grades
    setTxt('stuKpiAvg', '88%'); 
    setTxt('stuKpiAttendance', '95%');

  } catch (e) {
    console.error("Error actualizando KPIs de estudiantes:", e);
  }
}

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
        
        // Reset/Poblar ID y Título
        const idInput = document.getElementById('stId');
        if (idInput) idInput.value = id;
        const titleEl = document.getElementById('stModalTitle');
        if (titleEl) titleEl.textContent = 'Editar Estudiante';

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
      const idInput = document.getElementById('stId');
      if (idInput) idInput.value = '';
      const titleEl = document.getElementById('stModalTitle');
      if (titleEl) titleEl.textContent = 'Crear Estudiante';
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
        .select('*, classrooms(name)')
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
