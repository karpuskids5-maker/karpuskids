import { supabase, ensureRole, initOneSignal } from '../shared/supabase.js';
import { Api } from '../shared/api.js';
import { Helpers } from '../shared/helpers.js';
import { AppState } from '../shared/state.js';
import { VideoCallModule } from '../shared/videocall.js'; // 🔥 Importar módulo unificado

// ============================================================================
// 👨‍👩‍👧 LÓGICA UNIFICADA PANEL PADRES (PRODUCCIÓN REAL)
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Seguridad y Autenticación
  const auth = await ensureRole('padre');
  if (!auth) return;
  const user = auth.user;

  // 🔔 Inicializar Notificaciones Push
  try { initOneSignal(user); } catch(e) { console.error("OneSignal init error:", e); }

  // 2. Obtener hijos vinculados (Fuente de verdad)
  const { data: students } = await supabase
    .from('students')
    .select('*, classrooms(name, teacher_id)')
    .eq('parent_id', user.id);

  if (!students?.length) {
    document.getElementById('dashboardContent').innerHTML = Helpers.emptyState('No hay estudiantes vinculados a esta cuenta.');
    return;
  }

  // Seleccionar primer hijo por defecto (o manejar selector si son varios)
  const currentStudent = students[0];
  AppState.set('currentStudent', currentStudent);

  // Inicializar UI
  updateHeaderProfile(auth.profile, currentStudent);

  // 🚀 CARGA DE DATOS UNIFICADA
  await loadUnifiedDashboard(currentStudent.id);

  // Listeners de UI
  setupNavigation();
});

/**
 * 🔄 Carga centralizada de datos usando Shared API
 * Esto corrige el error de "datos en 0" o "calendario vacío"
 */
async function loadUnifiedDashboard(studentId) {
  try {
    // 0. UI: Estados de Carga (Skeletons)
    const kpiAmt = document.getElementById('kpiDebtAmount');
    const calContainer = document.getElementById('miniCalendarGrid');
    const gradesContainer = document.getElementById('recentGradesList');

    if (kpiAmt) kpiAmt.innerHTML = '<div class="h-8 w-32 bg-slate-200 rounded animate-pulse inline-block"></div>';
    if (calContainer) calContainer.innerHTML = '<div class="h-48 bg-slate-50 rounded-xl animate-pulse w-full"></div>';
    if (gradesContainer) gradesContainer.innerHTML = Helpers.skeleton(3, 'h-10');

    // Cargar todo en paralelo para velocidad
    const [finance, attendanceStats, academic] = await Promise.all([
      Api.getStudentFinancialStatus(studentId), // 💰 Finanzas Reales
      Api.getAttendanceStats(new Date().toISOString().split('T')[0]), // 📅 Asistencia Hoy
      Api.getStudentGrades(studentId) // 🎓 Notas
    ]);

    // 1. RENDERIZAR PAGOS (Corrección del error de monto 0)
    renderFinanceWidget(finance);

    // 2. RENDERIZAR CALENDARIO (Corrección visual)
    // Cargamos el mes actual completo para el calendario
    const now = new Date();
    const monthlyAttendance = await Api.getStudentAttendance(studentId, now.getFullYear(), now.getMonth() + 1);
    renderCalendarWidget(monthlyAttendance);

    // 3. RENDERIZAR TAREAS/NOTAS
    renderGradesWidget(academic);

    // 4. VERIFICAR VIDEOLLAMADAS (NUEVO)
    checkActiveMeetings(studentId);

  } catch (error) {
    console.error('Error cargando dashboard unificado:', error);
    Helpers.toast('Error de conexión al cargar datos', 'error');
  }
}

/**
 * 💰 WIDGET FINANCIERO (Usa datos reales de la Directora)
 */
function renderFinanceWidget(finance) {
  const { debt, config } = finance;

  // Actualizar tarjeta de resumen
  const kpiAmount = document.getElementById('kpiDebtAmount');
  if (kpiAmount) {
    kpiAmount.textContent = Helpers.formatCurrency(debt.total);
    kpiAmount.className = debt.total > 0
      ? 'text-2xl font-black text-rose-600'
      : 'text-2xl font-black text-emerald-600';
  }

  const kpiStatus = document.getElementById('kpiDebtStatus');
  if (kpiStatus) {
    kpiStatus.textContent = debt.total > 0
      ? `${debt.items.length} pago(s) pendiente(s)`
      : 'Al día';
  }

  // Llenar Modal de Pago (para que no salga vacío al hacer clic)
  window.currentDebtItems = debt.items; // Guardar para el modal
}

/**
 * 📅 WIDGET CALENDARIO (Pinta exactamente lo que marcó la maestra)
 */
function renderCalendarWidget(attendanceData) {
  // Convertir array de BD a mapa fácil de leer: { '2023-10-05': 'present', ... }
  const attMap = attendanceData.reduce((acc, item) => {
    acc[item.date] = item.status;
    return acc;
  }, {});

  const calendarContainer = document.getElementById('miniCalendarGrid');
  if (!calendarContainer) return;

  // 1. Calcular Geometría del Mes
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 (Domingo) - 6 (Sábado)

  // 2. Construir HTML
  let html = `<div class="grid grid-cols-7 gap-1 text-center mb-2">`;
  ['D','L','M','X','J','V','S'].forEach(d => 
    html += `<div class="text-[10px] font-bold text-slate-400">${d}</div>`
  );
  html += `</div><div class="grid grid-cols-7 gap-1">`;

  // Espacios vacíos
  for(let i=0; i<firstDayIndex; i++) {
    html += `<div></div>`;
  }

  // Días
  for(let i=1; i<=daysInMonth; i++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    const status = attMap[dateStr];
    
    let classes = "aspect-square flex items-center justify-center rounded-lg text-xs font-medium text-slate-500 bg-slate-50";
    
    if(status === 'present') classes = "aspect-square flex items-center justify-center rounded-lg text-xs font-bold text-emerald-600 bg-emerald-100 ring-1 ring-emerald-200";
    else if(status === 'absent') classes = "aspect-square flex items-center justify-center rounded-lg text-xs font-bold text-rose-600 bg-rose-100";
    else if(status === 'late') classes = "aspect-square flex items-center justify-center rounded-lg text-xs font-bold text-amber-600 bg-amber-100";
    
    if (i === now.getDate()) classes += " ring-2 ring-indigo-400 ring-offset-1 z-10";

    html += `<div class="${classes}" title="${dateStr}">${i}</div>`;
  }

  html += `</div>`;
  calendarContainer.innerHTML = html;
}

/**
 * 🎓 WIDGET NOTAS
 */
function renderGradesWidget(academic) {
  const { tasks } = academic; // Evidencias calificadas
  const recentGrades = tasks.slice(0, 3);

  const container = document.getElementById('recentGradesList');
  if (!container) return;

  if (recentGrades.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-400 text-center py-2">Sin calificaciones recientes</div>';
    return;
  }

  container.innerHTML = recentGrades.map(t => `
    <div class="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
      <div class="text-xs font-bold text-slate-700 truncate w-32">${t.task?.title || 'Tarea'}</div>
      <div class="text-xs font-black px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-lg">
        ${t.grade_letter || (t.stars ? t.stars + '⭐' : '-')}
      </div>
    </div>
  `).join('');
}

async function checkActiveMeetings(studentId) {
    const meetings = await VideoCallModule.getMyMeetings('padre');
    const active = meetings.find(m => m.status === 'live');
    
    const navBtn = document.querySelector('.node-videocall');
    
    if (active) {
        if(navBtn) {
            navBtn.classList.remove('hidden');
            navBtn.querySelector('span').textContent = '🔴 En Vivo';
            navBtn.onclick = () => joinMeeting(active);
        }
        Helpers.toast(`📹 Videollamada en curso: ${active.title}`, 'info');
    } else {
        // Ocultar o mostrar como "Aula Virtual" normal
        if(navBtn) {
            navBtn.classList.add('hidden'); // O dejar visible si quieres acceso al historial
        }
    }
}

window.joinMeeting = (meeting) => {
    const container = document.getElementById('meet'); 
    if(container) {
        // Cambiar a tab videocall
        document.querySelector('[data-target="videocall"]')?.click();
        VideoCallModule.joinMeeting(meeting, 'meet', AppState.get('profile'));
    }
};

function updateHeaderProfile(profile, student) {
  // Actualizar nombre del padre/tutor (usando clases para múltiples instancias)
  document.querySelectorAll('.guardian-name-display').forEach(el => {
    el.textContent = profile.name || 'Familia';
  });

  // Actualizar nombre del estudiante
  document.querySelectorAll('.student-name-display').forEach(el => {
    el.textContent = student.name;
  });

  // Actualizar aula
  document.querySelectorAll('.classroom-name-display').forEach(el => {
    el.textContent = student.classrooms?.name || 'Sin aula asignada';
  });

  // Actualizar avatar del estudiante si existe contenedor
  if (student.avatar_url) {
    const avatarContainer = document.getElementById('headerStudentAvatar');
    if (avatarContainer) {
      avatarContainer.innerHTML = `<img src="${student.avatar_url}" class="w-full h-full object-cover">`;
    }
  }
}

function setupNavigation() {
  // Configurar botones del menú inferior para cambiar vistas
  // ...
}