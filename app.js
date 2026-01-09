import { supabase, createClient, SUPABASE_URL, SUPABASE_ANON_KEY } from './js/supabase.js';

/**
 * Lógica principal del Panel de Directora
 * Maneja la carga de datos y la interacción de la interfaz.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 0. Verificar Sesión y Mostrar Usuario
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (profile) {
    // Buscar elementos donde mostrar el nombre (ej: sidebar)
    const sidebarLabel = document.querySelector('#sidebar .label p');
    if(sidebarLabel) sidebarLabel.innerHTML = `Usuario: <span class="font-medium">${profile.name}</span><br><span class="text-[10px] opacity-75">${profile.email}</span>`;
  }

  initDashboard();
  initEventListeners();
});

function initDashboard() {
  console.log('Inicializando Dashboard de Directora...');
  
  // 1. Cargar contadores del Dashboard (Simulación de llamada a API)
  loadDashboardStats();

  // 2. Cargar lista de maestros
  loadTeachers();

  // 3. Cargar lista de estudiantes
  loadStudents();

  // 4. Cargar lista de aulas
  loadRooms();

  // 2. Limpiar y mostrar estado vacío en listas
  renderEmptyState('eventsList', 'No hay eventos próximos programados.');
  renderEmptyState('biometricLog', 'No hay actividad biométrica reciente.');
  renderEmptyState('evaluacionesList', '<tr><td colspan="3" class="text-center py-4 text-slate-500">No hay evaluaciones recientes</td></tr>', true);
  renderEmptyState('studentsTable', '<tr><td colspan="2" class="text-center py-8 text-slate-500">No se encontraron estudiantes registrados.</td></tr>', true);
  renderEmptyState('reportsList', '<div class="text-center py-8 text-slate-500 bg-white rounded shadow">No hay reportes pendientes.</div>', true);
}

async function loadDashboardStats() {
  try {
    // Contar estudiantes activos
    const { count: studentsCount } = await supabase.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true);
    
    // Contar maestros (perfiles con rol maestra)
    const { count: teachersCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'maestra');

    // Contar aulas (si existe la tabla, sino 0)
    const { count: roomsCount } = await supabase.from('classrooms').select('*', { count: 'exact', head: true });

    updateDashboardCounters({
      presentes: studentsCount || 0, // Por ahora igual a inscritos
      maestros: teachersCount || 0,
      solicitudes: 0,
      aulas: roomsCount || 0
    });
  } catch (e) { console.error('Error cargando stats:', e); }
}

function updateDashboardCounters(stats) {
  const safeSet = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  safeSet('ninosPresentes', stats.presentes);
  safeSet('maestrosActivos', stats.maestros);
  safeSet('solicitudesHoy', stats.solicitudes);
  safeSet('aulasOcupadas', stats.aulas);
}

function renderEmptyState(elementId, messageHtml, isHtml = false) {
  const el = document.getElementById(elementId);
  if (!el) return;
  
  if (isHtml) el.innerHTML = messageHtml;
  else el.textContent = messageHtml;
}

function initEventListeners() {
  // 1. Navegación del Sidebar
  const navButtons = document.querySelectorAll('.nav-btn[data-section]');
  
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const sectionId = btn.dataset.section;
      
      // Ocultar todas las secciones
      document.querySelectorAll('.section').forEach(sec => sec.classList.add('hidden'));
      
      // Mostrar la sección seleccionada
      const targetSection = document.getElementById(sectionId);
      if (targetSection) {
        targetSection.classList.remove('hidden');
      }

      // (Opcional) Resaltar botón activo visualmente
      navButtons.forEach(b => b.classList.remove('bg-white/20'));
      btn.classList.add('bg-white/20');

      if (sectionId === 'asistencia') {
        loadAttendanceAnalytics();
      }
    });
  }); // Cierre correcto del forEach de navegación

  // 1.1 Buscador de Maestros en tiempo real
  const searchTeacherInput = document.getElementById('searchTeacher');
  if (searchTeacherInput) {
    searchTeacherInput.addEventListener('input', (e) => {
      filterTeachers(e.target.value);
    });
  }

  // 2. Modal de Maestros (Agregar Maestro)
  const btnAddTeacher = document.getElementById('btnAddTeacher');
  const teacherModal = document.getElementById('teacherModal');
  const btnCancelTeacher = document.getElementById('btnCancelTeacher');
  const btnSaveTeacher = document.getElementById('btnSaveTeacher');

  if (btnAddTeacher && teacherModal) {
    btnAddTeacher.addEventListener('click', () => {
      // Limpiar formulario
      document.getElementById('teacherModalTitle').textContent = 'Crear Maestro';
      document.getElementById('tmId').value = ''; // Limpiar ID para modo creación
      document.getElementById('tmName').value = '';
      document.getElementById('tmPhone').value = '';
      document.getElementById('tmEmail').value = '';
      document.getElementById('tmUsername').value = '';
      document.getElementById('tmSpecialty').value = '';
      document.getElementById('tmPassword').value = '';
      document.getElementById('tmStatus').value = 'Activo';
      
      // Mostrar modal
      teacherModal.classList.remove('hidden');
    });
  }

  if (btnCancelTeacher && teacherModal) {
    btnCancelTeacher.addEventListener('click', () => {
      teacherModal.classList.add('hidden');
    });
  }

  if (btnSaveTeacher) {
    btnSaveTeacher.addEventListener('click', saveTeacher);
  }

  // 3. Modal de Estudiantes (Agregar Estudiante)
  const btnAddStudent = document.getElementById('btnAddStudent');
  const studentModal = document.getElementById('modalAddStudent');
  const btnCancelStudent = document.getElementById('btnCancelStudent');
  const btnSaveStudent = document.getElementById('btnSaveStudent');

  if (btnAddStudent && studentModal) {
    btnAddStudent.addEventListener('click', () => {
      // Limpiar formulario
      const inputs = ['stName', 'stAge', 'stSchedule', 'p1Name', 'p1Phone', 'p1Email', 'p2Name', 'p2Phone', 'stAllergies', 'stBlood', 'stPickup'];
      inputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = '';
      });
      document.getElementById('stClassroom').value = '';
      
      // Cargar opciones de aulas
      loadClassroomOptions();
      
      studentModal.classList.remove('hidden');
    });
  }

  if (btnCancelStudent && studentModal) {
    btnCancelStudent.addEventListener('click', () => {
      studentModal.classList.add('hidden');
    });
  }

  if (btnSaveStudent) {
    btnSaveStudent.addEventListener('click', saveStudent);
  }

  // 4. Modal de Aulas (Agregar Aula)
  const btnAddRoom = document.getElementById('btnAddRoom');
  const roomModal = document.getElementById('roomModal');
  const btnCancelRoom = document.getElementById('btnCancelRoom');
  const btnSaveRoom = document.getElementById('btnSaveRoom');

  if (btnAddRoom && roomModal) {
    btnAddRoom.addEventListener('click', () => {
      // Limpiar formulario
      const inputs = ['roomName', 'roomTeacher', 'roomCapacity'];
      inputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = '';
      });
      roomModal.classList.remove('hidden');
    });
  }

  if (btnCancelRoom && roomModal) {
    btnCancelRoom.addEventListener('click', () => {
      roomModal.classList.add('hidden');
    });
  }

  if (btnSaveRoom) {
    btnSaveRoom.addEventListener('click', saveRoom);
  }

  // 5. Filtros de Asistencia
  const dateFilter = document.getElementById('attendanceDateFilter');
  const btnRefreshAtt = document.getElementById('btnRefreshAttendance');
  
  if (dateFilter) {
    dateFilter.valueAsDate = new Date(); // Hoy por defecto
    dateFilter.addEventListener('change', loadAttendanceAnalytics);
  }
  if (btnRefreshAtt) btnRefreshAtt.addEventListener('click', loadAttendanceAnalytics);
}

// Variable global para almacenar maestros y filtrar localmente
let allTeachers = [];

async function loadTeachers() {
  try {
    // Cargar perfiles con rol 'maestra'
    const { data: teachers, error } = await supabase.from('profiles').select('*').eq('role', 'maestra');
    if (error) throw error;

    allTeachers = teachers || [];
    renderTeachers(allTeachers);
  } catch (error) {
    console.error(error);
    const tableBody = document.getElementById('teachersTable');
    if(tableBody) tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-red-500">Error de conexión al cargar maestros.</td></tr>';
  }
}

function renderTeachers(teachersList) {
  const tableBody = document.getElementById('teachersTable');
  if (!tableBody) return;

  if (teachersList.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-500">No hay maestros registrados.</td></tr>';
      return;
    }

    tableBody.innerHTML = teachersList.map(t => {
      const initial = t.name ? t.name.charAt(0).toUpperCase() : 'M';
      return `
      <tr class="hover:bg-slate-50 transition-colors group">
        <td class="px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-sm shadow-sm border border-purple-200">
              ${initial}
            </div>
            <div>
              <p class="font-semibold text-slate-800 text-sm">${t.name || 'Sin nombre'}</p>
              <p class="text-xs text-slate-500">Maestra Titular</p>
            </div>
          </div>
        </td>
        <td class="px-6 py-4">
          <div class="flex flex-col gap-1">
            <span class="text-sm text-slate-700 flex items-center gap-2">
              <i data-lucide="mail" class="w-3.5 h-3.5 text-slate-400"></i> ${t.email || '-'}
            </span>
            <span class="text-xs text-slate-500 flex items-center gap-2">
              <i data-lucide="phone" class="w-3.5 h-3.5 text-slate-400"></i> ${t.phone || 'Sin teléfono'}
            </span>
          </div>
        </td>
        <td class="px-6 py-4">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
            <span class="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5"></span>
            Activo
          </span>
        </td>
        <td class="px-6 py-4 text-right">
          <div class="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onclick="window.openEditTeacher('${t.id}')" class="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-blue-600 transition-colors" title="Editar">
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button class="p-2 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600 transition-colors" title="Eliminar">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      </tr>
    `}).join('');
    
    if (window.lucide) lucide.createIcons();

  } catch (error) {
    console.error(error);
    tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-red-500">Error de conexión al cargar maestros.</td></tr>';
  }
}

async function saveTeacher() {
  const name = document.getElementById('tmName').value;
  const email = document.getElementById('tmEmail').value;
  const password = document.getElementById('tmPassword').value;
  const confirm = document.getElementById('tmConfirmPassword')?.value; // Si existe campo de confirmar

  if (!name || !email || !password) {
    alert('Por favor complete todos los campos (Nombre, Email, Contraseña).');
    return;
  }

  if (confirm && password !== confirm) {
    alert('Las contraseñas no coinciden.');
    return;
  }

  if (password.length < 6) {
    alert('La contraseña debe tener al menos 6 caracteres.');
    return;
  }

  const btnSave = document.getElementById('btnSaveTeacher');
  if (btnSave) {
    btnSave.textContent = 'Guardando...';
    btnSave.disabled = true;
  }

  try {
    // 1. Crear usuario en Auth usando un cliente temporal (para no cerrar sesión de Directora)
    // Usamos las credenciales exportadas
    
    // Cliente temporal SIN persistencia de sesión
    const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false, // ¡Crucial! No guardar sesión en localStorage
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });

    const { data: authData, error: authError } = await tempClient.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          name: name,
          role: 'maestra' // Asignar rol automáticamente en metadatos
        }
      }
    });

    if (authError) throw authError;

    // Nota: El trigger 'handle_new_user' en la base de datos debería crear el perfil automáticamente.
    // Sin embargo, si queremos asegurar datos extra o si el trigger falla, podríamos insertar aquí,
    // pero como usamos un cliente anónimo temporal, no tendremos permiso para insertar en 'profiles' directamente
    // a menos que el trigger lo haga con privilegios de sistema (Security Definer).
    // Asumiremos que el trigger (creado en schema.sql) funciona correctamente.

    alert(`Maestro creado exitosamente.\n\nUsuario: ${email}\nContraseña: ${password}\n\n(El usuario puede iniciar sesión inmediatamente)`);
    
    document.getElementById('teacherModal').classList.add('hidden');
    loadTeachers(); // Recargar la lista
  } // <--- ESTA LLAVE FALTABA

  catch (error) {
    console.error('Error al crear maestro:', error);
    alert('Error al crear maestro: ' + error.message);
  } finally {
    if (btnSave) {
      btnSave.textContent = 'Guardar';
      btnSave.disabled = false;
    }
  }
}

async function loadStudents() {
  const tableBody = document.getElementById('studentsTable');
  if (!tableBody) return;

  try {
    const { data: students, error } = await supabase.from('students').select('*').order('created_at', { ascending: false });
    if (error) throw error;

    if (students.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="2" class="text-center py-8 text-slate-500">No se encontraron estudiantes registrados.</td></tr>';
      return;
    }

    tableBody.innerHTML = students.map(s => `
      <tr class="hover:bg-slate-50">
        <td class="py-4 px-4">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
              <i data-lucide="user" class="w-4 h-4 text-indigo-600"></i>
            </div>
            <span class="font-medium text-slate-800">${s.name}</span>
          </div>
        </td>
        <td class="py-4 px-4 text-center">
          <button class="view-profile-btn px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-sm font-medium" data-student-id="${s.id}">
            Ver Perfil
          </button>
        </td>
      </tr>
    `).join('');
    if (window.lucide) lucide.createIcons();
    
    // Removed broken event listeners here. Handled by delegation in panel_directora.js via window.openStudentProfile

  } catch (error) {
    console.error('Error:', error.message);
    tableBody.innerHTML = `<tr><td colspan="2" class="text-center py-4 text-red-500">Error: ${error.message}</td></tr>`;
  }
}

async function saveStudent() {
  const fullName = document.getElementById('stName').value;
  const classroomId = document.getElementById('stClassroom').value;
  const parentName = document.getElementById('p1Name').value;
  const parentEmail = document.getElementById('p1Email').value;
  const parentPhone = document.getElementById('p1Phone').value;

  if (!fullName) {
    alert('Por favor ingrese el nombre del estudiante.');
    return;
  }

  if (!parentEmail) {
    alert('El correo del padre es obligatorio para crear su usuario de acceso.');
    return;
  }
  
  try {
    // 1. Crear Usuario para el Padre (Auth)
    // Usamos cliente temporal para no cerrar sesión de directora
    const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    // Contraseña por defecto para el padre
    const defaultPassword = "karpus" + Math.floor(1000 + Math.random() * 9000);

    const { data: authData, error: authError } = await tempClient.auth.signUp({
      email: parentEmail,
      password: defaultPassword,
      options: {
        data: {
          name: parentName || 'Padre/Tutor',
          role: 'padre' // Importante para el trigger
        }
      }
    });

    if (authError) throw authError;
    const parentId = authData.user?.id;

    // 2. Insertar Estudiante vinculado al Padre
    const studentData = {
      name: fullName,
      classroom_id: classroomId || null,
      is_active: true,
      parent_id: parentId, // Vinculación clave
      p1_name: parentName,
      p1_email: parentEmail,
      p1_phone: parentPhone
    };

    const { error } = await supabase.from('students').insert([studentData]);
    if (error) throw error;

    alert(`Estudiante guardado exitosamente.\n\nUsuario Padre Creado:\nEmail: ${parentEmail}\nContraseña: ${defaultPassword}\n\nPor favor comparta estas credenciales con el padre.`);
    document.getElementById('modalAddStudent').classList.add('hidden');
    loadStudents(); // Recargar
    loadDashboardStats(); // Actualizar contadores

  } catch (error) {
    console.error('Error:', error.message);
    alert(error.message);
  }
}

async function loadClassroomOptions() {
  const select = document.getElementById('stClassroom');
  if (!select) return;

  try {
    const { data: rooms, error } = await supabase.from('classrooms').select('id, name');
    if (error) throw error;

    // Preserve the first option (default)
    select.innerHTML = '<option value="">-- Seleccionar Aula --</option>';
    
    rooms.forEach(room => {
      const option = document.createElement('option');
      option.value = room.id;
      option.textContent = room.name;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading classrooms for select:', error);
  }
}

async function loadRooms() {
  const tableBody = document.getElementById('roomsTable');
  if (!tableBody) return;

  try {
    const { data: rooms, error } = await supabase.from('classrooms').select('*');
    if (error) { /* Si la tabla no existe, fallará silenciosamente o mostrará vacío */ console.log('Tabla classrooms no encontrada o vacía'); return; }

    if (rooms.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-slate-500">No hay aulas registradas.</td></tr>';
      return;
    }

    tableBody.innerHTML = rooms.map(r => `
      <tr class="border-b hover:bg-slate-50">
        <td class="py-3 px-2 font-medium">${r.name}</td>
        <td class="py-3 px-2 hidden md:table-cell text-slate-600">-</td>
        <td class="py-3 px-2 text-slate-600">-</td>
        <td class="py-3 px-2 text-center"><span class="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">Activo</span></td>
        <td class="py-3 px-2">
          <button class="text-blue-600 hover:text-blue-800 text-sm">Editar</button>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error(error);
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-500">Error de conexión.</td></tr>';
  }
}

async function saveRoom() {
  const name = document.getElementById('roomName').value;
  if (!name) {
    alert('Por favor ingrese el nombre del aula.');
    return;
  }

  const roomData = {
    name: name,
    level: 'Pequeños'
  };

  try {
    const { error } = await supabase.from('classrooms').insert([roomData]);
    if (error) throw error;

    alert('Aula creada exitosamente.');
    document.getElementById('roomModal').classList.add('hidden');
    loadRooms();
  } catch (error) {
    console.error(error);
    alert('Error al guardar aula: ' + error.message);
  }
}

// --- Lógica de Estadísticas de Asistencia ---
let attendanceChartInstance = null;

async function loadAttendanceAnalytics() {
  const dateInput = document.getElementById('attendanceDateFilter');
  const date = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
  
  const statPresent = document.getElementById('statPresent');
  const statAbsent = document.getElementById('statAbsent');
  const statLate = document.getElementById('statLate');
  const tableBody = document.getElementById('attendanceByRoomBody');

  try {
    // 1. Obtener asistencia del día seleccionado
    // Necesitamos join con classrooms para agrupar
    const { data: attendanceData, error } = await supabase
      .from('attendance')
      .select(`
        status,
        classroom_id,
        classrooms ( name )
      `)
      .eq('date', date);

    if (error) throw error;

    // 2. Procesar datos
    let present = 0, absent = 0, late = 0;
    const roomStats = {};

    attendanceData.forEach(record => {
      // Totales generales
      if (record.status === 'present') present++;
      else if (record.status === 'absent') absent++;
      else if (record.status === 'late') late++;

      // Por aula
      const roomName = record.classrooms?.name || 'Sin Aula';
      if (!roomStats[roomName]) roomStats[roomName] = { present: 0, absent: 0, total: 0 };
      
      roomStats[roomName].total++;
      if (record.status === 'present' || record.status === 'late') roomStats[roomName].present++;
      else roomStats[roomName].absent++;
    });

    // 3. Actualizar UI - Tarjetas
    if(statPresent) statPresent.textContent = present;
    if(statAbsent) statAbsent.textContent = absent;
    if(statLate) statLate.textContent = late;

    // 4. Actualizar UI - Tabla
    if (tableBody) {
      if (Object.keys(roomStats).length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-slate-500">No hay registros para esta fecha.</td></tr>';
      } else {
        tableBody.innerHTML = Object.entries(roomStats).map(([room, stats]) => {
          const percentage = Math.round((stats.present / stats.total) * 100) || 0;
          return `
            <tr class="border-b last:border-0">
              <td class="py-2 font-medium text-slate-700">${room}</td>
              <td class="py-2 text-center text-green-600">${stats.present}</td>
              <td class="py-2 text-center text-red-600">${stats.absent}</td>
              <td class="py-2 text-center">
                <span class="px-2 py-0.5 rounded text-xs font-bold ${percentage >= 80 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                  ${percentage}%
                </span>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // 5. Actualizar UI - Gráfico (Chart.js)
    const ctx = document.getElementById('attendancePieChart');
    if (ctx) {
      if (attendanceChartInstance) attendanceChartInstance.destroy();
      
      // Si no hay datos, mostrar gráfico vacío o mensaje (aquí mostramos 0s)
      attendanceChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Presentes', 'Ausentes', 'Tardanzas'],
          datasets: [{
            data: [present, absent, late],
            backgroundColor: ['#22c55e', '#ef4444', '#eab308'],
            borderWidth: 0
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
      });
    }

  } catch (err) {
    console.error('Error cargando estadísticas:', err);
  }
}

// --- Función Global para abrir perfil de estudiante ---
window.openStudentProfile = async function(studentId) {
  const modal = document.getElementById('studentProfileModal');
  if (!modal) return;

  try {
    const { data: student, error } = await supabase
      .from('students')
      .select(`
        *,
        classrooms ( name )
      `)
      .eq('id', studentId)
      .single();

    if (error) throw error;
    if (!student) throw new Error('Estudiante no encontrado');

    const safe = (val, def = 'No registrado') => (val && String(val).trim()) ? val : def;

    // Poblar el modal con los datos del estudiante
    document.getElementById('studentProfileName').textContent = safe(student.name);
    
    // Datos del padre/madre 1 (Nuevas columnas)
    document.getElementById('parent1Name').textContent = safe(student.p1_name);
    document.getElementById('parent1Phone').textContent = safe(student.p1_phone);
    document.getElementById('parent1Email').textContent = safe(student.p1_email);
    document.getElementById('parent1Job').textContent = safe(student.p1_job);
    document.getElementById('parent1Address').textContent = safe(student.p1_address);
    document.getElementById('parent1Emergency').textContent = safe(student.p1_emergency_contact);

    // Datos del padre/madre 2 (Nuevas columnas)
    document.getElementById('parent2Name').textContent = safe(student.p2_name);
    document.getElementById('parent2Phone').textContent = safe(student.p2_phone);
    document.getElementById('parent2Email').textContent = safe(student.p2_email);
    document.getElementById('parent2Job').textContent = safe(student.p2_job);
    document.getElementById('parent2Address').textContent = safe(student.p2_address);
    document.getElementById('parent2Emergency').textContent = safe(student.p2_emergency_contact);

    // Información adicional del estudiante
    document.getElementById('studentRoom').textContent = safe(student.classrooms?.name, 'Sin aula asignada');
    document.getElementById('studentStartDate').textContent = student.start_date ? new Date(student.start_date).toLocaleDateString() : 'No registrada';
    document.getElementById('studentAllergies').textContent = safe(student.allergies, 'Ninguna');
    document.getElementById('studentPickup').textContent = safe(student.authorized_pickup);
    document.getElementById('studentBlood').textContent = safe(student.blood_type);

    modal.classList.remove('hidden');

  } catch (error) {
    console.error("Error al abrir el perfil del estudiante:", error);
    alert('No se pudo cargar la información del estudiante: ' + error.message);
  }
};
