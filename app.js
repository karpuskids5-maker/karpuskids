import { supabase, createClient, SUPABASE_URL, SUPABASE_ANON_KEY, initOneSignal } from './js/supabase.js';

// ... (rest of imports)

// Inicialización de OneSignal
try { initOneSignal(); } catch(e) { console.error("Error OneSignal:", e); }

/**
 * Lógica principal del Panel de Directora
 * Maneja la carga de datos y la interacción de la interfaz.
 */

// 1. ESTADO GLOBAL CENTRALIZADO
window.DirectorState = {
  currentSection: 'dashboard',
  studentsPage: 1,
  studentsPageSize: 10,
  totalStudents: 0,
  loaded: {
    dashboard: false,
    maestros: false,
    estudiantes: false,
    aulas: false,
    asistencia: false
  }
};

// Helper Debounce
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// 2. HELPER PARA MANEJO DE ERRORES
async function safeExecute(fn, errorMsg = 'Ocurrió un error inesperado') {
  try { await fn(); } 
  catch (e) { console.error(e); alert(errorMsg + ': ' + (e.message || e)); }
}

window.AttendanceCache = {
  ttl: 5 * 60 * 1000,
  key(k) { return `attendance_cache:${k}`; },
  get(k) {
    try {
      const raw = localStorage.getItem(this.key(k));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.ts) return null;
      if (Date.now() - obj.ts > this.ttl) {
        localStorage.removeItem(this.key(k));
        return null;
      }
      return obj.value;
    } catch (_) { return null; }
  },
  set(k, v) {
    try {
      localStorage.setItem(this.key(k), JSON.stringify({ ts: Date.now(), value: v }));
    } catch (_) {}
  },
  invalidateAll() {
    try {
      Object.keys(localStorage).forEach(x => { if (x.startsWith('attendance_cache:')) localStorage.removeItem(x); });
    } catch (_) {}
  }
};

// 3. FUNCIÓN PARA CARGAR AULAS
window.loadRooms = async function(teacherId = null, searchTerm = '') {
  await safeExecute(async () => {
    let query = supabase.from('classrooms').select('*');
    
    if (teacherId && teacherId !== 'all') {
      query = query.eq('teacher_id', teacherId);
    }

    if (searchTerm) {
      query = query.ilike('name', `%${searchTerm}%`);
    }
    
    const { data: rooms, error } = await query.order('name');
    if (error) throw error;

    const tableBody = document.getElementById('roomsTable');
    if (!tableBody) return;

    if (rooms.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-500">No se encontraron aulas registradas.</td></tr>';
      return;
    }

    const { data: teachers } = await supabase.from('profiles').select('id, name').eq('role', 'maestra');
    const teacherMap = teachers.reduce((acc, t) => ({ ...acc, [t.id]: t.name }), {});
    
    // Contar estudiantes por aula
    const counts = await Promise.all(rooms.map(r => 
      supabase.from('students').select('*', { count: 'exact', head: true }).eq('classroom_id', r.id)
    ));
    const countMap = {};
    counts.forEach((resp, idx) => { countMap[rooms[idx].id] = resp.count || 0; });

    tableBody.innerHTML = rooms.map(r => {
      const current = countMap[r.id] || 0;
      const capacity = r.capacity || 0;
      const isFull = capacity > 0 && current >= capacity;
      
      return `
        <tr class="hover:bg-slate-50 border-b last:border-0 transition-colors">
          <td class="py-4 px-6 font-bold text-slate-800">${r.name}</td>
          <td class="py-4 px-6 text-slate-600 font-medium">
             <div class="flex items-center gap-2">
               <div class="w-8 h-8 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center"><i data-lucide="user" class="w-4 h-4"></i></div>
               ${teacherMap[r.teacher_id] || '<span class="text-slate-400 italic">Sin asignar</span>'}
             </div>
          </td>
          <td class="py-4 px-6">
             <div class="flex flex-col gap-1">
               <div class="flex justify-between text-xs font-bold mb-1">
                 <span class="${isFull ? 'text-red-500' : 'text-emerald-600'}">${current} / ${capacity}</span>
                 <span class="text-slate-400">${Math.round((current/capacity)*100) || 0}%</span>
               </div>
               <div class="w-full bg-slate-100 rounded-full h-2">
                 <div class="h-full rounded-full ${isFull ? 'bg-red-500' : 'bg-emerald-500'}" style="width: ${Math.min(100, (current/capacity)*100) || 0}%"></div>
               </div>
             </div>
          </td>
          <td class="py-4 px-6 text-center">
            <div class="flex justify-center gap-2">
              <button class="edit-room-btn p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-colors" data-room-id="${r.id}" title="Editar">
                <i data-lucide="edit-3" class="w-4 h-4"></i>
              </button>
              <button class="delete-room-btn p-2 bg-pink-50 text-pink-600 rounded-xl hover:bg-pink-100 transition-colors" data-room-id="${r.id}" title="Eliminar">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();

  }, 'Error cargando aulas');
};

document.addEventListener('DOMContentLoaded', async () => {
  // 0. Verificar Sesión y Mostrar Usuario
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (!profile || profile.role !== 'directora') {
    try { await supabase.auth.signOut(); } catch (_) {}
    window.location.href = 'login.html';
    return;
  } else {
    // Buscar elementos donde mostrar el nombre (ej: sidebar)
    const userNameElements = document.querySelectorAll('[data-username]');
    userNameElements.forEach(el => el.textContent = profile.name || 'Usuario');
  }

  // Listener para filtro de mes global en Dashboard
  document.getElementById('globalMonthFilter')?.addEventListener('change', () => {
    loadDashboard();
  });
  document.getElementById('btnRefreshDashboard')?.addEventListener('click', () => {
    loadDashboard();
  });

  try { const { subscribeNotifications } = await import('./js/supabase.js'); subscribeNotifications(n=>{ try { const msg = (n.title||'Notificación') + ': ' + (n.message||''); const el = document.getElementById('notifToast'); if (el) { el.textContent = msg; el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),3000); } } catch(e){} }); } catch(e){}

  // 0.1 Botón de Cerrar Sesión
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  });

  // Inicializar gestión de aulas
  initRoomManagement();

  // 1. NAVEGACIÓN ENTRE SECCIONES
  const navButtons = document.querySelectorAll('[data-section]');
  const sections = document.querySelectorAll('section[id]');

  function showSection(sectionId) {
    sections.forEach(s => {
      s.classList.remove('active');
      s.classList.add('hidden');
    });
    const target = document.getElementById(sectionId);
    if (target) {
      target.classList.remove('hidden');
      target.classList.add('active');
      window.DirectorState.currentSection = sectionId;
      loadSectionData(sectionId);
    }
  }

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
  });

  // 2. CARGAR DATOS SEGÚN SECCIÓN
  async function loadSectionData(section) {
    switch (section) {
      case 'dashboard':
        if (!window.DirectorState.loaded.dashboard) {
          await Promise.all([loadDashboard(), window.loadRooms(), window.loadStudents()]);
          window.DirectorState.loaded.dashboard = true;
        }
        break;
      case 'maestros':
        if (!window.DirectorState.loaded.maestros) {
          await loadTeachers();
          window.DirectorState.loaded.maestros = true;
        }
        break;
      case 'estudiantes':
        if (!window.DirectorState.loaded.estudiantes) {
          await Promise.all([window.loadStudents(), loadStudentFilters()]);
          window.DirectorState.loaded.estudiantes = true;
        }
        break;
      case 'aulas':
        if (!window.DirectorState.loaded.aulas) {
          await Promise.all([window.loadRooms(), loadTeachersForFilter()]);
          window.DirectorState.loaded.aulas = true;
        }
        break;
      case 'asistencia':
        if (!window.DirectorState.loaded.asistencia) {
          await loadAttendance();
          window.DirectorState.loaded.asistencia = true;
        }
        break;
    }
  }

  // 2.1 CARGAR FILTROS DE ESTUDIANTES
  async function loadStudentFilters() {
    await safeExecute(async () => {
      const { data: classrooms } = await supabase.from('classrooms').select('id, name').order('name');
      const select = document.getElementById('filterStClassroom');
      if (select && classrooms) {
        select.innerHTML = '<option value="">Todas las aulas</option>' + 
          classrooms.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      }
      
      document.getElementById('btnApplyStudentFilters')?.addEventListener('click', () => loadStudents(1));
      
      // Listeners en tiempo real para filtros
      const nameInput = document.getElementById('filterStName');
      if (nameInput) nameInput.addEventListener('input', debounce(() => loadStudents(1), 500));

      const classSelect = document.getElementById('filterStClassroom');
      if (classSelect) classSelect.addEventListener('change', () => loadStudents(1));

      const statusSelect = document.getElementById('filterStStatus');
      if (statusSelect) statusSelect.addEventListener('change', () => loadStudents(1));

      const levelSelect = document.getElementById('filterStLevel');
      if (levelSelect) levelSelect.addEventListener('change', () => loadStudents(1));

    }, 'Error cargando filtros');
  }

  // 3. FUNCIÓN PARA CARGAR ESTUDIANTES CON PAGINACIÓN
  window.loadStudents = async function(page = 1) {
    const tableBody = document.getElementById('studentsTable');
    const gridContainer = document.getElementById('studentsGrid'); // Support for Grid View
    if (!tableBody) return;

    window.DirectorState.studentsPage = page;
    const { studentsPageSize } = window.DirectorState;
    const from = (page - 1) * studentsPageSize;
    const to = from + studentsPageSize - 1;

    await safeExecute(async () => {
      // Construir Query Base
      let query = supabase
        .from('students')
        .select('*, classrooms(name)', { count: 'exact' });

      // Aplicar Filtros
      const name = document.getElementById('filterStName')?.value;
      if (name) query = query.ilike('name', `%${name}%`);

      const classId = document.getElementById('filterStClassroom')?.value;
      if (classId) query = query.eq('classroom_id', classId);

      const status = document.getElementById('filterStStatus')?.value;
      if (status) query = query.eq('is_active', status === 'true');

      const age = document.getElementById('filterStAge')?.value;
      if (age) {
      }

      // Ejecutar Query con Paginación
      const { data: students, count, error } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      const countError = error; // Supabase devuelve error en la misma respuesta
      if (countError) throw countError;
      window.DirectorState.totalStudents = count;


      if (students.length === 0 && page === 1) {
        tableBody.innerHTML = '<tr><td colspan="2" class="text-center py-8 text-slate-500">No se encontraron estudiantes registrados.</td></tr>';
        if(gridContainer) gridContainer.innerHTML = '<div class="col-span-full text-center py-8 text-slate-500">No se encontraron estudiantes.</div>';
        renderPaginationControls(); // Renderiza controles vacíos
        return;
      }

      // Render Table
      tableBody.innerHTML = students.map(s => `
        <tr class="hover:bg-slate-50">
          <td class="py-4 px-4">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                <i data-lucide="user" class="w-4 h-4 text-indigo-600"></i>
              </div>
              <span class="font-medium text-slate-800">${s.name}</span>
              <span class="ml-2 text-xs px-2 py-0.5 rounded-full ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                ${s.is_active ? 'Activo' : 'Inactivo'}
              </span>
              <span class="ml-2 text-xs text-slate-500">${s.classrooms?.name || 'Sin aula'}</span>
            </div>
          </td>
          <td class="py-4 px-4 text-center">
            <button class="view-profile-btn px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-sm font-medium" data-student-id="${s.id}">
              Ver Perfil
            </button>
          </td>
        </tr>
      `).join('');

      // Render Grid (Cards)
      if (gridContainer) {
        const colors = ['bg-blue-50 border-blue-100', 'bg-pink-50 border-pink-100', 'bg-purple-50 border-purple-100', 'bg-orange-50 border-orange-100', 'bg-green-50 border-green-100'];
        
        gridContainer.innerHTML = students.map((s, index) => {
          const colorClass = colors[index % colors.length];
          const avatar = s.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(s.name)}&background=random&color=fff`;
          
          return `
          <div class="${colorClass} border-2 rounded-3xl p-5 shadow-sm hover:shadow-xl transition-all duration-300 group relative flex flex-col items-center text-center">
            <div class="absolute top-4 right-4">
               <span class="text-[10px] font-black px-2 py-1 rounded-full ${s.is_active ? 'bg-green-200 text-green-700' : 'bg-red-200 text-red-700'} uppercase tracking-wider">
                 ${s.is_active ? 'Activo' : 'Inactivo'}
               </span>
            </div>
            
            <div class="w-20 h-20 rounded-full border-4 border-white shadow-md overflow-hidden mb-3">
              <img src="${avatar}" class="w-full h-full object-cover" alt="${s.name}">
            </div>
            
            <h4 class="font-black text-slate-800 text-lg mb-1">${s.name}</h4>
            <p class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">${s.classrooms?.name || 'Sin Aula'}</p>
            
            <div class="flex gap-2 w-full mt-auto">
              <button class="view-profile-btn flex-1 py-2 bg-white text-slate-600 rounded-xl font-bold text-xs shadow-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2" data-student-id="${s.id}">
                <i data-lucide="eye" class="w-4 h-4"></i> Perfil
              </button>
              <button class="edit-student-btn flex-1 py-2 bg-indigo-600 text-white rounded-xl font-bold text-xs shadow-md hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2" data-student-id="${s.id}">
                <i data-lucide="edit" class="w-4 h-4"></i> Editar
              </button>
              <button class="delete-student-btn p-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl transition-colors" title="Eliminar Estudiante" data-student-id="${s.id}">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </div>
        `}).join('');
      }

      if (window.lucide) lucide.createIcons();
      
      renderPaginationControls();

    }, 'Error cargando estudiantes');
  }

  // Función para eliminar estudiante
  window.deleteStudent = async function(studentId) {
    const confirmDelete = confirm('¿Está seguro de que desea eliminar este estudiante? Esta acción es irreversible.');
    if (!confirmDelete) return;

    await safeExecute(async () => {
      const { error } = await supabase
        .from('students')
        .delete()
        .eq('id', studentId);

      if (error) throw error;

      alert('Estudiante eliminado exitosamente.');
      window.loadStudents(window.DirectorState.studentsPage); // Recargar la lista de estudiantes
    }, 'Error al eliminar estudiante');
  };

  // 4. FUNCIÓN PARA RENDERIZAR CONTROLES DE PAGINACIÓN
  function renderPaginationControls() {
    let container = document.getElementById('student-pagination-controls');
    if (!container) {
      container = document.createElement('div');
      container.id = 'student-pagination-controls';
      container.className = 'flex justify-between items-center mt-4 px-4';
      const studentSection = document.getElementById('estudiantes');
      studentSection.querySelector('.bg-white.rounded-lg.shadow').appendChild(container);
    }

    const { studentsPage, studentsPageSize, totalStudents } = window.DirectorState;
    const totalPages = Math.ceil(totalStudents / studentsPageSize);

    const from = (studentsPage - 1) * studentsPageSize + 1;
    const to = Math.min(studentsPage * studentsPageSize, totalStudents);

    container.innerHTML = `
      <div>
        <p class="text-sm text-slate-600">
          Mostrando <span class="font-medium">${from}</span> a <span class="font-medium">${to}</span> de <span class="font-medium">${totalStudents}</span> resultados
        </p>
      </div>
      <div class="flex gap-2">
        <button id="prevPageBtn" class="px-3 py-1 border rounded-md text-sm bg-white hover:bg-slate-50" ${studentsPage === 1 ? 'disabled' : ''}>
          Anterior
        </button>
        <button id="nextPageBtn" class="px-3 py-1 border rounded-md text-sm bg-white hover:bg-slate-50" ${studentsPage >= totalPages ? 'disabled' : ''}>
          Siguiente
        </button>
      </div>
    `;

    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
      if (window.DirectorState.studentsPage > 1) {
        loadStudents(window.DirectorState.studentsPage - 1);
      }
    });

    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
      const { studentsPage, studentsPageSize, totalStudents } = window.DirectorState;
      const totalPages = Math.ceil(totalStudents / studentsPageSize);
      if (studentsPage < totalPages) {
        loadStudents(window.DirectorState.studentsPage + 1);
      }
    });
  }

  // Event listener para los botones de eliminar estudiante (delegación)
  document.addEventListener('click', async (e) => {
    if (e.target.closest('.delete-student-btn')) {
      const studentId = e.target.closest('.delete-student-btn').dataset.studentId;
      if (studentId) {
        await window.deleteStudent(studentId);
      }
    }
  });

  // 5. CARGAR DASHBOARD
  async function loadDashboard() {
    await safeExecute(async () => {
      // Calcular mes actual para filtros
      const filterVal = document.getElementById('globalMonthFilter')?.value || 'current';
      const date = new Date();
      if (filterVal === 'last') date.setMonth(date.getMonth() - 1);
      const currentMonth = date.toLocaleString('es-ES', { month: 'long' });
      const monthCap = currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1);

      // 1. Cargar KPIs usando RPC optimizado CON PARÁMETRO
      const { data: kpis, error: kpiError } = await supabase.rpc('get_dashboard_kpis', { p_month: monthCap });
      if (kpiError) throw kpiError;

      // Actualizar DOM con animación simple
      const animateValue = (id, val, prefix = '') => {
        const el = document.getElementById(id);
        if (el) el.textContent = prefix + (val || 0);
      };

      animateValue('kpiStudents', kpis.total_students);
      animateValue('kpiTeachers', kpis.total_teachers);
      animateValue('kpiClassrooms', kpis.active_classrooms);
      animateValue('kpiAttendance', kpis.attendance_today);
      animateValue('kpiPendingMoney', kpis.pending_payments, '$');
      animateValue('kpiIncidents', kpis.active_incidents);

      // 2. Cargar Reporte Financiero por Aula (RPC)
      
      const { data: finReport, error: finError } = await supabase.rpc('get_monthly_financial_report_by_classroom', { p_month: monthCap });
      
      if (!finError && finReport) {
        const tbody = document.getElementById('financialReportBody');
        if (tbody) {
          tbody.innerHTML = finReport.map(r => {
            const percent = r.total_expected > 0 ? Math.round((r.total_paid / r.total_expected) * 100) : 0;
            return `
              <tr class="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                <td class="py-3 font-medium text-slate-700">${r.classroom_name}</td>
                <td class="py-3 text-right text-slate-500">$${r.total_expected}</td>
                <td class="py-3 text-right text-emerald-600 font-bold">$${r.total_paid}</td>
                <td class="py-3 text-right text-amber-600">$${r.total_pending}</td>
                <td class="py-3 px-2">
                  <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div class="bg-purple-500 h-full rounded-full" style="width: ${percent}%"></div>
                  </div>
                </td>
              </tr>
            `;
          }).join('');
        }
      }

      // 3. Inicializar Gráficas Modernas (Delegar a panel_directora.js si existe, o hacerlo aquí)
      if (window.initDashboardCharts) {
        window.initDashboardCharts(kpis, finReport);
      }

    }, 'Error cargando dashboard');
  }

  // Utilidad: validar correo
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
  
  // 7. CARGAR MAESTROS
  async function loadTeachers() {
    await safeExecute(async () => {
      // Cargar Maestros y Asistentes
      const { data: staff, error } = await supabase
        .from('profiles')
        .select('*')
        .in('role', ['maestra', 'asistente'])
        .order('name');
      
      if (error) throw error;
      
      // Contenedores Grid
      const teachersGrid = document.getElementById('teachersGrid');
      const assistantsGrid = document.getElementById('assistantsGrid');
      const assistantsContainer = document.getElementById('assistantsContainer');

      if (teachersGrid) teachersGrid.innerHTML = '';
      if (assistantsGrid) assistantsGrid.innerHTML = '';

      const staffArr = staff || [];
      const teachers = staffArr.filter(p => p.role === 'maestra');
      const assistants = staffArr.filter(p => p.role === 'asistente');

      // Actualizar KPIs de la sección
      const setKpi = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
      setKpi('kpiStaffTotal', staffArr.length);
      setKpi('kpiStaffActive', staffArr.length); // Simulado, agregar campo is_active si existe
      setKpi('kpiStaffInClass', teachers.length);
      setKpi('kpiStaffAssistants', assistants.length);

      // Renderizar Maestros
      if (teachersGrid) {
        if (teachers.length === 0) {
          teachersGrid.innerHTML = '<div class="col-span-full text-center py-12 text-slate-400">No se encontraron maestros registrados.</div>';
        } else {
          teachersGrid.innerHTML = teachers.map(t => renderStaffCard(t, 'teacher')).join('');
        }
      }

      // Renderizar Asistentes
      if (assistantsContainer && assistantsGrid) {
        if (assistants.length > 0) {
          assistantsContainer.classList.remove('hidden');
          assistantsGrid.innerHTML = assistants.map(a => renderStaffCard(a, 'assistant')).join('');
        } else {
          assistantsContainer.classList.add('hidden');
        }
      }
      
      if (window.lucide) lucide.createIcons();

    }, 'Error cargando personal');
  }

  // Helper para renderizar CARDS de personal
  function renderStaffCard(person, type) {
    const isTeacher = type === 'teacher';
    
    // Estilos diferenciados
    const cardBg = isTeacher ? 'bg-white' : 'bg-indigo-50/50 border border-indigo-100';
    const avatarBg = isTeacher ? 'bg-purple-100 text-purple-600' : 'bg-indigo-100 text-indigo-600';
    const badgeBg = isTeacher ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700';
    const roleLabel = isTeacher ? (person.specialty || 'Docente Titular') : 'Apoyo / Asistente';

    return `
      <div class="${cardBg} rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 p-6 group relative overflow-hidden">
        <div class="flex items-start justify-between mb-4">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 ${avatarBg} rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
              <i data-lucide="user" class="w-7 h-7"></i>
            </div>
            <div>
              <h4 class="font-bold text-slate-800 text-lg leading-tight">${person.name || 'Sin Nombre'}</h4>
              <p class="text-xs font-medium text-slate-500 mt-1">${roleLabel}</p>
            </div>
          </div>
          <span class="${badgeBg} text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider">Activo</span>
        </div>

        <div class="space-y-2 mb-6">
          <div class="flex items-center gap-2 text-sm text-slate-600">
            <i data-lucide="mail" class="w-4 h-4 text-slate-400"></i>
            <span class="truncate">${person.email}</span>
          </div>
          <div class="flex items-center gap-2 text-sm text-slate-600">
            <i data-lucide="phone" class="w-4 h-4 text-slate-400"></i>
            <span>${person.phone || 'Sin teléfono'}</span>
          </div>
        </div>

        <div class="pt-4 border-t border-slate-100 flex gap-2">
          <button onclick="window.openTeacherModal('${person.id}')" class="flex-1 py-2 bg-slate-50 hover:bg-purple-50 text-slate-600 hover:text-purple-700 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2">
            <i data-lucide="edit-2" class="w-4 h-4"></i> Editar
          </button>
          <button onclick="window.deleteProfile('${person.id}')" class="p-2 bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-xl transition-colors" title="Eliminar">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;
  }

  window.openTeacherModal = async function(id) {
    const modal = document.getElementById('teacherModal');
    const title = document.getElementById('teacherModalTitle');
    const inputId = document.getElementById('tmId');
    const nameInput = document.getElementById('tmName');
    const phoneInput = document.getElementById('tmPhone');
    const emailInput = document.getElementById('tmEmail');
    const usernameInput = document.getElementById('tmUsername');
    const specialtyInput = document.getElementById('tmSpecialty');
    const statusSelect = document.getElementById('tmStatus');
    const passInput = document.getElementById('tmPassword'); // Asegurarse de tener este campo en HTML si no existe
    
    if (!modal) return;
    modal.classList.remove('hidden');
    
    if (window.lucide) lucide.createIcons();

    if (id) {
      // MODO EDICIÓN
      title && (title.textContent = 'Editar Usuario');
      inputId && (inputId.value = id);
      // Limpiar campos antes de cargar
      nameInput && (nameInput.value = 'Cargando...');
      phoneInput && (phoneInput.value = '');
      emailInput && (emailInput.value = '');
      specialtyInput && (specialtyInput.value = '');
      
      try {
        const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
        if (error) throw error;
        nameInput && (nameInput.value = data?.name || '');
        phoneInput && (phoneInput.value = data?.phone || '');
        emailInput && (emailInput.value = data?.email || '');
        // Usar specialty si existe, o notes, o dejar vacío. Evitamos error de columna notes si no existe en DB.
        // Asumimos que notes NO existe si da error, pero si existe en data, lo usamos.
        specialtyInput && (specialtyInput.value = data?.specialty || ''); 
      } catch (e) {
        console.error(e);
        nameInput && (nameInput.value = '');
      }
    } else {
      // MODO CREACIÓN
      title && (title.textContent = 'Nuevo Maestro');
      inputId && (inputId.value = '');
      nameInput && (nameInput.value = '');
      phoneInput && (phoneInput.value = '');
      emailInput && (emailInput.value = '');
      usernameInput && (usernameInput.value = '');
      specialtyInput && (specialtyInput.value = '');
      statusSelect && (statusSelect.value = 'Activo');
    }
  };

  const btnSaveTeacher = document.getElementById('btnSaveTeacher');
  if (btnSaveTeacher) {
    btnSaveTeacher.addEventListener('click', async () => {
      const inputId = document.getElementById('tmId');
      const nameInput = document.getElementById('tmName');
      const phoneInput = document.getElementById('tmPhone');
      const emailInput = document.getElementById('tmEmail');
      const specialtyInput = document.getElementById('tmSpecialty');
      // Necesitamos un campo de contraseña para nuevos usuarios
      let passInput = document.getElementById('tmPassword');
      if (!passInput) {
         // Si no existe en el HTML, intentamos buscarlo o alertar
         passInput = { value: '123456' }; // Fallback temporal o error
      }
      
      const id = inputId?.value;
      const name = nameInput?.value || '';
      const email = emailInput?.value || '';
      const phone = phoneInput?.value || '';
      const specialty = specialtyInput?.value || '';
      
      if (!name || !email) {
        alert('Nombre y correo son obligatorios');
        return;
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert('Correo inválido');
        return;
      }

      btnSaveTeacher.disabled = true;
      btnSaveTeacher.textContent = 'Guardando...';

      try {
        if (id) {
          // ACTUALIZAR
          const updates = {
            name: name,
            phone: phone,
            email: email
          };

          const { error } = await supabase.from('profiles').update(updates).eq('id', id);
          if (error) throw error;
          alert('Usuario actualizado');
        } else {
          // CREAR NUEVO (SignUp + Profile)
          // Usamos cliente temporal para no cerrar sesión de directora
          const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
             auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
          });
          
          let password = passInput?.value;
          if (!password) {
             password = prompt('Ingrese contraseña para el nuevo maestro (min 6 caracteres):');
          }
          if (!password || password.length < 6) {
            throw new Error('Contraseña requerida (mínimo 6 caracteres)');
          }

          const { data: authData, error: authError } = await tempClient.auth.signUp({
            email: email,
            password: password,
            options: {
              data: { name: name, role: 'maestra', phone: phone } // Trigger handle_new_user usará esto
            }
          });
          
          if (authError) throw authError;
          
          if (authData.user) {
             // Si el trigger no inserta phone o specialty, actualizamos
             const { error: profError } = await supabase.from('profiles').update({
               phone: phone,
               // specialty: specialty
             }).eq('id', authData.user.id);
             
             if (profError) console.warn('Error actualizando detalles del perfil:', profError);
          }
          alert('Maestro creado exitosamente');
        }
        
        document.getElementById('teacherModal').classList.add('hidden');
        await loadTeachers();
      } catch (e) {
        console.error(e);
        alert('Error al guardar: ' + (e.message || e));
      } finally {
        btnSaveTeacher.disabled = false;
        btnSaveTeacher.textContent = 'Guardar';
      }
    });
  }

  // Listener para el botón de crear maestro
  document.getElementById('btnAddTeacher')?.addEventListener('click', () => {
    window.openTeacherModal(); // Sin ID = Crear
  });

  const btnCancelTeacher = document.getElementById('btnCancelTeacher');
  if (btnCancelTeacher) {
    btnCancelTeacher.addEventListener('click', () => {
      const modal = document.getElementById('teacherModal');
      modal && modal.classList.add('hidden');
    });
  }

  // 8. CARGAR ASISTENCIA
  async function loadAttendance() {
    await safeExecute(async () => {
      const today = new Date().toISOString().split('T')[0];
      const cacheKey = `list:${today}`;
      let data = AttendanceCache.get(cacheKey);
      if (!data) {
        const { data: fresh, error } = await supabase.from('attendance').select('*').eq('date', today);
        if (error) throw error;
        data = fresh || [];
        AttendanceCache.set(cacheKey, data);
      }

      const tableBody = document.getElementById('attendanceTable');
      if (!tableBody) return;

      if (data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" class="text-center py-8 text-slate-500">No hay registros de asistencia para hoy.</td></tr>';
        return;
      }

      tableBody.innerHTML = data.map(r => `
        <tr class="hover:bg-slate-50">
          <td class="py-3 px-4">${r.student_name}</td>
          <td class="py-3 px-4">${r.room_name}</td>
          <td class="py-3 px-4">
            <span class="px-2 py-1 text-xs rounded-full ${r.status === 'present' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
              ${r.status === 'present' ? 'Presente' : 'Ausente'}
            </span>
          </td>
        </tr>
      `).join('');

    }, 'Error cargando asistencia');
  }

  // 8.1. CARGAR MAESTROS PARA FILTRO
  async function loadTeachersForFilter() {
    await safeExecute(async () => {
      const { data: teachers, error } = await supabase
        .from('profiles')
        .select('id, name')
        .eq('role', 'maestra')
        .order('name');
      
      if (error) throw error;

      // Select en el panel de aulas (Directora)
      const roomSelect = document.getElementById('filterRoomByTeacher');
      if (roomSelect) {
        roomSelect.innerHTML = '<option value="all">Todas las maestras</option>' + 
          (teachers || []).map(t => `<option value="${t.id}">${t.name}</option>`).join('');
      }

      // Select genérico (usado en otros lugares)
      const teacherSelect = document.getElementById('teacherFilter');
      if (teacherSelect) {
        teacherSelect.innerHTML = '<option value="">Todos los maestros</option>' + 
          (teachers || []).map(t => `<option value="${t.id}">${t.name}</option>`).join('');
      }
    }, 'Error cargando maestros para filtro');
  }

  // 8.2. CARGAR GRÁFICOS DE ASISTENCIA
  async function loadAttendanceCharts() {
    await safeExecute(async () => {
      const canvas = document.getElementById('attendanceChart');
      if (!canvas) return;

      // Obtener datos de asistencia de los últimos 7 días
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 6);

      const startIso = startDate.toISOString().split('T')[0];
      const endIso = endDate.toISOString().split('T')[0];
      const rangeKey = `range:${startIso}:${endIso}`;
      let attendanceData = AttendanceCache.get(rangeKey);
      if (!attendanceData) {
        const { data: fresh, error } = await supabase
          .from('attendance')
          .select('date, status')
          .gte('date', startIso)
          .lte('date', endIso);
        if (error) throw error;
        attendanceData = fresh || [];
        AttendanceCache.set(rangeKey, attendanceData);
      }

      // Procesar datos para el gráfico
      const dailyStats = {};
      const days = [];
      const presentData = [];
      const absentData = [];

      // Inicializar todos los días
      for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        const dateStr = date.toISOString().split('T')[0];
        dailyStats[dateStr] = { present: 0, absent: 0 };
        days.push(date.toLocaleDateString('es-ES', { weekday: 'short' }));
      }

      // Contar asistencias por día
      attendanceData.forEach(record => {
        if (dailyStats[record.date]) {
          if (record.status === 'present') {
            dailyStats[record.date].present++;
          } else if (record.status === 'absent') {
            dailyStats[record.date].absent++;
          }
        }
      });

      // Preparar datos para el gráfico
      Object.values(dailyStats).forEach(stats => {
        presentData.push(stats.present);
        absentData.push(stats.absent);
      });

      // Destruir gráfico existente si hay uno
      const existingChart = Chart.getChart(canvas);
      if (existingChart) {
        existingChart.destroy();
      }
      window.attendanceChartInstance = null;

      // Crear nuevo gráfico
      const ctx = canvas.getContext('2d');
      window.attendanceChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: days,
          datasets: [
            {
              label: 'Presentes',
              data: presentData,
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              tension: 0.4,
              fill: true
            },
            {
              label: 'Ausentes',
              data: absentData,
              borderColor: '#ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              tension: 0.4,
              fill: true
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
            },
            title: {
              display: true,
              text: 'Asistencia de los últimos 7 días'
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                stepSize: 1
              }
            }
          }
        }
      });

    }, 'Error cargando gráficos de asistencia');
  }

  // 9. MANEJAR ELIMINACIÓN DE AULAS
  window.handleDeleteRoom = async function(roomId) {
    const confirmDelete = confirm('¿Está seguro de que desea eliminar esta aula?');
    if (!confirmDelete) return;

    await safeExecute(async () => {
      // Verificar si hay estudiantes en el aula
      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select('id, name')
        .eq('room_id', roomId);

      if (studentsError) throw studentsError;

      if (students.length > 0) {
        const moveStudents = confirm(`Esta aula tiene ${students.length} estudiante(s). ¿Desea moverlos a otra aula antes de eliminarla?`);
        
        if (moveStudents) {
          // Obtener lista de aulas disponibles (excluyendo la actual)
          const { data: availableRooms, error: roomsError } = await supabase
            .from('rooms')
            .select('id, name')
            .neq('id', roomId);

          if (roomsError) throw roomsError;

          if (availableRooms.length === 0) {
            alert('No hay otras aulas disponibles para mover los estudiantes.');
            return;
          }

          // Crear lista de opciones para el prompt
          const roomOptions = availableRooms.map(r => `${r.id}: ${r.name}`).join('\n');
          const targetRoomId = prompt(`Seleccione el ID del aula destino:\n${roomOptions}`);

          if (!targetRoomId) return; // Usuario canceló

          // Validar que el ID ingresado sea válido
          const validRoom = availableRooms.find(r => r.id === targetRoomId);
          if (!validRoom) {
            alert('ID de aula inválido.');
            return;
          }

          // Mover estudiantes al aula seleccionada
          const { error: updateError } = await supabase
            .from('students')
            .update({ room_id: targetRoomId })
            .eq('room_id', roomId);

          if (updateError) throw updateError;

          alert(`Se han movido ${students.length} estudiante(s) al aula ${validRoom.name}.`);
        } else {
          // Eliminar estudiantes del aula (establecer room_id como null)
          const { error: updateError } = await supabase
            .from('students')
            .update({ room_id: null })
            .eq('room_id', roomId);

          if (updateError) throw updateError;
        }
      }

      // Eliminar el aula
      const { error: deleteError } = await supabase
        .from('rooms')
        .delete()
        .eq('id', roomId);

      if (deleteError) throw deleteError;

      alert('Aula eliminada exitosamente.');
      window.loadRooms(); // Recargar lista de aulas

    }, 'Error al eliminar el aula');
  }

  // 10. Delegación de eventos para tablas dinámicas
  const roomsTable = document.getElementById('roomsTable');
  if (roomsTable) {
    roomsTable.addEventListener('click', (e) => {
      const deleteButton = e.target.closest('.delete-room-btn');
      if (deleteButton) {
        const roomId = deleteButton.dataset.roomId;
        handleDeleteRoom(roomId);
      }
      const editButton = e.target.closest('.edit-room-btn');
      if (editButton) {
        const roomId = editButton.dataset.roomId;
        openRoomModal(roomId);
      }
    });
  }

  // Mostrar dashboard por defecto (Al final, cuando todo está definido)
  showSection('dashboard');

  // Event listeners para los botones de período del gráfico
  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-chart-period]')) {
      // Remover clase activa de todos los botones
      document.querySelectorAll('[data-chart-period]').forEach(btn => {
        btn.classList.remove('bg-white', 'shadow-sm', 'text-slate-700');
        btn.classList.add('text-slate-500');
      });
      
      // Agregar clase activa al botón clickeado
      e.target.classList.add('bg-white', 'shadow-sm', 'text-slate-700');
      e.target.classList.remove('text-slate-500');
      
      // Recargar gráficos con el nuevo período
      loadAttendanceCharts();
    }
  });

  // FUNCIONALIDAD PARA CREAR ASISTENTES
  const modalCreateAssistant = document.getElementById('modalCreateAssistant');
  const btnAddAssistant = document.getElementById('btnAddAssistant');
  const btnCloseAssistantModal = document.getElementById('btnCloseAssistantModal');
  const btnCancelAssistant = document.getElementById('btnCancelAssistant');
  const btnGeneratePassword = document.getElementById('btnGeneratePassword');
  const formCreateAssistant = document.getElementById('formCreateAssistant');
  const btnSaveAssistant = document.getElementById('btnSaveAssistant');

  // Abrir modal
  if (btnAddAssistant) {
    btnAddAssistant.addEventListener('click', () => {
      modalCreateAssistant.classList.add('active');
    });
  }

  // Cerrar modal
  function closeAssistantModal() {
    modalCreateAssistant.classList.remove('active');
    formCreateAssistant.reset();
  }

  if (btnCloseAssistantModal) btnCloseAssistantModal.addEventListener('click', closeAssistantModal);
  if (btnCancelAssistant) btnCancelAssistant.addEventListener('click', closeAssistantModal);

  // Cerrar modal al hacer clic fuera
  if (modalCreateAssistant) {
    modalCreateAssistant.addEventListener('click', (e) => {
      if (e.target === modalCreateAssistant) {
        closeAssistantModal();
      }
    });
  }

  // Generar contraseña aleatoria
  if (btnGeneratePassword) {
    btnGeneratePassword.addEventListener('click', () => {
      const password = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
      passInput.value = password;
      passInput.type = 'text'; // Mostrar temporalmente
      setTimeout(() => passInput.type = 'password', 3000); // Ocultar después de 3s
    });
  }

  // Manejar envío del formulario
  if (formCreateAssistant) {
    formCreateAssistant.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const name = document.getElementById('assistantName').value;
      const email = document.getElementById('assistantEmail').value;
      const password = document.getElementById('assistantPassword').value;
      const phone = document.getElementById('assistantPhone').value;
      const notes = document.getElementById('assistantNotes').value;

      if (!name || !email || !password) {
        alert('Por favor complete los campos obligatorios');
        return;
      }
      if (!isValidEmail(email)) {
        alert('Correo inválido');
        return;
      }

      if (password.length < 6) {
        alert('La contraseña debe tener al menos 6 caracteres');
        return;
      }

      // Bloquear botón
      const originalText = btnSaveAssistant.textContent;
      btnSaveAssistant.disabled = true;
      btnSaveAssistant.innerHTML = '<i class="animate-spin" data-lucide="loader"></i> Creando...';

      try {
        const { data: existingRows, error: existingError } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', email)
          .limit(1);
        if (existingError) throw existingError;
        if (existingRows && existingRows.length > 0) {
          alert('El correo ya está registrado');
          return;
        }

        // Crear usuario en Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: email,
          password: password,
          options: { data: { role: 'asistente', name: name } }
        });

        if (authError) {
          if ((authError.message || '').toLowerCase().includes('already')) {
            alert('El correo ya está registrado');
            return;
          }
          throw authError;
        }

        if (authData.user) {
          // Crear perfil en la tabla profiles
          const { error: profileError } = await supabase
            .from('profiles')
            .upsert([{
              id: authData.user.id,
              name: name,
              email: email,
              phone: phone || null,
              role: 'asistente',
              created_at: new Date().toISOString()
            }], { onConflict: 'id' });

          if (profileError) throw profileError;

          alert('Asistente creado exitosamente');
          closeAssistantModal();
          
          // Recargar la tabla de maestros si está visible
          if (window.DirectorState.currentSection === 'maestros') {
            await loadTeachers();
          }
        }
      } catch (error) {
        console.error('Error creando asistente:', error);
        alert('Error al crear el asistente: ' + error.message);
      } finally {
        // Restaurar botón
        btnSaveAssistant.disabled = false;
        btnSaveAssistant.textContent = originalText;
      }
    });
  }

  // VALIDACIÓN Y ALTA DE ESTUDIANTE
  function markFieldError(id, hasError) {
    const el = document.getElementById(id);
    if (!el) return;
    if (hasError) {
      el.classList.add('border-red-500');
    } else {
      el.classList.remove('border-red-500');
    }
  }

  async function populateStudentClassrooms() {
    const select = document.getElementById('stClassroom');
    if (!select) return;
    await safeExecute(async () => {
      const { data: classrooms, error } = await supabase
        .from('classrooms')
        .select('id, name')
        .order('name');
      if (error) throw error;
      select.innerHTML = '<option value="">-- Seleccionar Aula --</option>' +
        (classrooms || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }, 'Error cargando aulas');
  }

  const btnSaveStudent = document.getElementById('btnSaveStudent');
  if (btnSaveStudent) {
    // Prepopulate classrooms when opening modal
    populateStudentClassrooms();

    // Clear error on input
    ['stName','stClassroom'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => markFieldError(id, false));
      if (el) el.addEventListener('change', () => markFieldError(id, false));
    });

    btnSaveStudent.addEventListener('click', async () => {
      const studentId = document.getElementById('stId')?.value;
      const name = (document.getElementById('stName')?.value || '').trim();
      const classroomId = document.getElementById('stClassroom')?.value || '';
      const isActive = !!document.getElementById('stActive')?.checked;

      const p1Name = (document.getElementById('p1Name')?.value || '').trim();
      const p1Phone = (document.getElementById('p1Phone')?.value || '').trim();
      const p1Email = (document.getElementById('p1Email')?.value || '').trim();
      const p1Password = (document.getElementById('p1Password')?.value || '').trim();
      const p2Name = (document.getElementById('p2Name')?.value || '').trim();
      const p2Phone = (document.getElementById('p2Phone')?.value || '').trim();
      const allergies = (document.getElementById('stAllergies')?.value || '').trim();
      const bloodType = (document.getElementById('stBlood')?.value || '').trim();
      const pickup = (document.getElementById('stPickup')?.value || '').trim();
      const monthlyFee = parseFloat(document.getElementById('stMonthlyFee')?.value || '0');
      const dueDay = parseInt(document.getElementById('stDueDay')?.value || '0', 10);

      const missing = [];
      if (!name) missing.push('Nombre del niño');
      if (!classroomId) missing.push('Aula asignada');

      markFieldError('stName', !name);
      markFieldError('stClassroom', !classroomId);

      if (missing.length) {
        alert('Complete los campos obligatorios: ' + missing.join(', '));
        return;
      }

      await safeExecute(async () => {
        let parentId = null;

        // 1. Crear/Vincular Usuario Padre
        if (p1Email) {
          if (!isValidEmail(p1Email)) {
            alert('Correo del padre inválido');
            return;
          }
          const { data: existingParent } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', p1Email)
            .eq('role', 'padre')
            .maybeSingle();

          if (existingParent) {
            parentId = existingParent.id;
          } else if (p1Password) {
            const tempSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
              auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
            });

            const { data: authData, error: authError } = await tempSupabase.auth.signUp({
              email: p1Email,
              password: p1Password
            });
            
            if (authError) throw authError;
            if (authData.user) {
              parentId = authData.user.id;
              await tempSupabase.from('profiles').upsert([{
                id: parentId,
                name: p1Name || 'Padre/Tutor',
                email: p1Email,
                phone: p1Phone,
                role: 'padre'
              }], { onConflict: 'id' });
            }
          }
        }

        const studentData = {
          name,
          classroom_id: classroomId,
          is_active: isActive,
          parent_id: parentId,
          p1_name: p1Name || null,
          p1_phone: p1Phone || null,
          p1_email: p1Email || null,
          p2_name: p2Name || null,
          p2_phone: p2Phone || null,
          allergies: allergies || null,
          blood_type: bloodType || null,
          authorized_pickup: pickup || null,
          monthly_fee: monthlyFee,
          due_day: dueDay
        };

        let result;
        if (studentId) {
          // ACTUALIZAR
          result = await supabase.from('students').update(studentData).eq('id', studentId);
        } else {
          // INSERTAR
          result = await supabase.from('students').insert([studentData]);
        }

        if (result.error) throw result.error;

        alert(studentId ? 'Estudiante actualizado correctamente' : 'Estudiante creado correctamente');
        const modal = document.getElementById('modalAddStudent');
        if (modal) modal.classList.add('hidden');
        if (window.loadStudents) await window.loadStudents(1);
      }, studentId ? 'Error al actualizar estudiante' : 'Error al crear estudiante');
    });
  }

  // 11. ABRIR PERFIL DE ESTUDIANTE (Global)
  window.openStudentProfile = async function(studentId) {
    await safeExecute(async () => {
      const modal = document.getElementById('studentProfileModal');
      if (!modal) return;

      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.body.classList.add('no-scroll');
      modal.dataset.studentId = String(studentId);

      // Resetear campos visuales
      const ids = ['studentProfileName', 'studentDOB', 'studentClassroom', 'studentAllergies', 
                   'parent1Name', 'parent1Phone', 'parent1Email', 'studentRoom', 'studentPickup', 'studentBlood'];
      ids.forEach(id => { const el = document.getElementById(id); if(el) el.textContent = '...'; });

      // Consultar datos
      const { data: student, error } = await supabase
        .from('students')
        .select(`*, classrooms(name), parent:parent_id(*)`)
        .eq('id', studentId)
        .single();

      if (error) throw error;

      const setText = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val || '-'; };

      setText('studentProfileName', student.name);
      setText('studentDOB', student.birth_date);
      setText('studentClassroom', student.classrooms?.name);
      setText('studentRoom', student.classrooms?.name);
      setText('studentAllergies', student.allergies);
      setText('studentPickup', student.authorized_pickup);
      setText('studentBlood', student.blood_type);

      if (student.parent) {
        setText('parent1Name', student.parent.name);
        setText('parent1Phone', student.parent.phone);
        setText('parent1Email', student.parent.email);
      }
    }, 'Error al abrir perfil');
  };
  
  // Eliminar perfil (maestra/asistente)
  window.deleteProfile = async function(id) {
    if (!id) return;
    const ok = confirm('¿Seguro que desea eliminar este usuario?');
    if (!ok) return;
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', id);
      if (error) throw error;
      alert('Usuario eliminado');
      await loadTeachers();
    } catch (e) {
      console.error(e);
      alert('No se pudo eliminar el usuario');
    }
  };

  // 12. GESTIÓN DE AULAS (Crear/Editar)
  function initRoomManagement() {
    const btnAdd = document.getElementById('btnAddRoom');
    const btnSave = document.getElementById('btnSaveRoom');
    const btnCancel = document.getElementById('btnCancelRoom');
    const modal = document.getElementById('roomModal');
    const filterTeacher = document.getElementById('filterRoomByTeacher');
    const filterSearch = document.getElementById('filterRoomSearch');
    
    if (btnAdd) {
      btnAdd.addEventListener('click', () => openRoomModal());
    }
    
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        modal.classList.add('hidden');
      });
    }
    
    if (btnSave) {
      btnSave.addEventListener('click', saveRoom);
    }

    if (filterTeacher) {
      filterTeacher.addEventListener('change', () => {
        const val = filterTeacher.value === 'all' ? null : filterTeacher.value;
        window.loadRooms(val);
      });
    }

    if (filterSearch) {
      filterSearch.addEventListener('input', debounce(() => {
        window.loadRooms(filterTeacher?.value === 'all' ? null : filterTeacher?.value, filterSearch.value);
      }, 500));
    }
  }

  async function openRoomModal(roomId = null) {
    const modal = document.getElementById('roomModal');
    const title = document.getElementById('roomModalTitle');
    const nameInput = document.getElementById('roomName');
    const capacityInput = document.getElementById('roomCapacity');
    const teacherSelect = document.getElementById('roomTeacher');
    const idInput = document.getElementById('roomId');
    
    if (!modal) return;

    // Populate teachers
    await safeExecute(async () => {
       const { data: teachers } = await supabase.from('profiles').select('id, name').eq('role', 'maestra').order('name');
       if (teacherSelect) {
           teacherSelect.innerHTML = '<option value="">Seleccionar maestro...</option>' + 
              (teachers || []).map(t => `<option value="${t.id}">${t.name}</option>`).join('');
       }
    }, 'Error cargando maestros');

    if (roomId) {
       title.textContent = 'Editar Aula';
       idInput.value = roomId;
       const { data: room } = await supabase.from('classrooms').select('*').eq('id', roomId).single();
       if (room) {
          nameInput.value = room.name || '';
          capacityInput.value = room.capacity || '';
          teacherSelect.value = room.teacher_id || '';
       }
    } else {
       title.textContent = 'Nueva Aula';
       idInput.value = '';
       nameInput.value = '';
       capacityInput.value = '';
       teacherSelect.value = '';
    }
    
    modal.classList.remove('hidden');
  }

  async function saveRoom() {
    const id = document.getElementById('roomId').value;
    const name = document.getElementById('roomName').value;
    const capacity = document.getElementById('roomCapacity').value;
    const teacherId = document.getElementById('roomTeacher').value;
    const btnSave = document.getElementById('btnSaveRoom');
    
    if (!name) { alert('El nombre es obligatorio'); return; }
    
    btnSave.disabled = true;
    btnSave.textContent = 'Guardando...';

    const payload = {
        name,
        capacity: capacity ? parseInt(capacity) : null,
        teacher_id: teacherId || null
    };
    
    try {
        let error;
        if (id) {
            const { error: err } = await supabase.from('classrooms').update(payload).eq('id', id);
            error = err;
        } else {
            const { error: err } = await supabase.from('classrooms').insert([payload]);
            error = err;
        }
        
        if (error) throw error;
        
        alert('Aula guardada correctamente');
        document.getElementById('roomModal').classList.add('hidden');
        window.loadRooms();
    } catch (e) {
        console.error(e);
        alert('Error al guardar aula: ' + e.message);
    } finally {
        btnSave.disabled = false;
        btnSave.textContent = 'Guardar';
    }
  }
});
