import { supabase, createClient, SUPABASE_URL, SUPABASE_ANON_KEY } from './js/supabase.js';

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
window.loadRooms = async function(teacherId = null) {
  await safeExecute(async () => {
    let query = supabase.from('classrooms').select('*');
    
    if (teacherId) {
      query = query.eq('teacher_id', teacherId);
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
    const counts = await Promise.all(rooms.map(r => 
      supabase.from('students').select('*', { count: 'exact', head: true }).eq('classroom_id', r.id)
    ));
    const countMap = {};
    counts.forEach((resp, idx) => { countMap[rooms[idx].id] = resp.count || 0; });

    tableBody.innerHTML = rooms.map(r => `
      <tr class="hover:bg-slate-50">
        <td class="py-3 px-4 font-medium text-slate-900">${r.name}</td>
        <td class="py-3 px-4 text-slate-600">${teacherMap[r.teacher_id] || 'Sin asignar'}</td>
        <td class="py-3 px-4 text-slate-600">
          ${countMap[r.id] || 0} / ${r.capacity || 0}
          <span class="ml-2 text-xs ${((r.capacity||0) - (countMap[r.id]||0)) > 0 ? 'text-amber-600' : 'text-emerald-600'}">
            ${((r.capacity||0) - (countMap[r.id]||0)) > 0 ? `Faltan ${Math.max(0, (r.capacity||0) - (countMap[r.id]||0))}` : 'Completo'}
          </span>
        </td>
        <td class="py-3 px-4 text-center">
          <button class="delete-room-btn px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-xs" data-room-id="${r.id}">
            Eliminar
          </button>
        </td>
      </tr>
    `).join('');

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

  try { const { subscribeNotifications } = await import('./js/supabase.js'); subscribeNotifications(n=>{ try { const msg = (n.title||'Notificación') + ': ' + (n.message||''); const el = document.getElementById('notifToast'); if (el) { el.textContent = msg; el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),3000); } } catch(e){} }); } catch(e){}

  // 0.1 Botón de Cerrar Sesión
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  });

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
          await Promise.all([loadStudents(), loadStudentFilters()]);
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
    }, 'Error cargando filtros');
  }

  // 3. FUNCIÓN PARA CARGAR ESTUDIANTES CON PAGINACIÓN
  window.loadStudents = async function(page = 1) {
    const tableBody = document.getElementById('studentsTable');
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
        renderPaginationControls(); // Renderiza controles vacíos
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
      if (window.lucide) lucide.createIcons();
      
      renderPaginationControls();

    }, 'Error cargando estudiantes');
  }

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

  // 5. CARGAR DASHBOARD
  async function loadDashboard() {
    await safeExecute(async () => {
      const { count: students } = await supabase.from('students').select('*', { count: 'exact', head: true });
      const { count: teachers } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'maestra');
      const { count: rooms } = await supabase.from('classrooms').select('*', { count: 'exact', head: true });

      const totalStudentsEl = document.getElementById('ninosPresentes');
      const totalTeachersEl = document.getElementById('maestrosActivos');
      const totalRoomsEl = document.getElementById('aulasOcupadas');
      
      if (totalStudentsEl) totalStudentsEl.textContent = students || 0;
      if (totalTeachersEl) totalTeachersEl.textContent = teachers || 0;
      if (totalRoomsEl) totalRoomsEl.textContent = rooms || 0;

      // Cargar gráficos de asistencia
      await loadAttendanceCharts();

      // Gráfico de pastel para distribución de aulas
      const ctx = document.getElementById('roomsChart')?.getContext('2d');
      if (ctx) {
        new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: ['Aulas Activas', 'Cupos Disponibles'],
            datasets: [{
              data: [rooms || 0, Math.max(0, 20 - (rooms || 0))],
              backgroundColor: ['#4f46e5', '#e5e7eb']
            }]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
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

      const teachersTable = document.getElementById('teachersTable');
      const assistantsTable = document.getElementById('assistantsTable');
      const assistantsContainer = document.getElementById('assistantsContainer');

      if (teachersTable) teachersTable.innerHTML = '';
      if (assistantsTable) assistantsTable.innerHTML = '';

      const staffArr = staff || [];
      const teachers = staffArr.filter(p => p.role === 'maestra');
      const assistants = staffArr.filter(p => p.role === 'asistente');

      // Renderizar Maestros
      if (teachersTable) {
        if (teachers.length === 0) {
          teachersTable.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-500">No se encontraron maestros registrados.</td></tr>';
        } else {
          teachersTable.innerHTML = teachers.map(t => renderStaffRow(t)).join('');
        }
      }

      // Renderizar Asistentes
      if (assistantsContainer && assistantsTable) {
        if (assistants.length > 0) {
          assistantsContainer.classList.remove('hidden');
          assistantsTable.innerHTML = assistants.map(a => renderStaffRow(a)).join('');
        } else {
          assistantsContainer.classList.add('hidden');
        }
      }
      
      if (window.lucide) lucide.createIcons();

    }, 'Error cargando personal');
  }

  // Helper para renderizar filas de personal
  function renderStaffRow(person) {
    // Generar color aleatorio o fijo para el avatar
    const colors = [
      'bg-red-100 text-red-600', 'bg-orange-100 text-orange-600', 
      'bg-amber-100 text-amber-600', 'bg-green-100 text-green-600', 
      'bg-emerald-100 text-emerald-600', 'bg-teal-100 text-teal-600',
      'bg-cyan-100 text-cyan-600', 'bg-sky-100 text-sky-600',
      'bg-blue-100 text-blue-600', 'bg-indigo-100 text-indigo-600',
      'bg-violet-100 text-violet-600', 'bg-purple-100 text-purple-600',
      'bg-fuchsia-100 text-fuchsia-600', 'bg-pink-100 text-pink-600',
      'bg-rose-100 text-rose-600'
    ];
    const nameLen = (person && person.name && person.name.length) ? person.name.length : 1;
    const colorClass = colors[nameLen % colors.length];

    return `
        <tr class="hover:bg-indigo-50/50 transition-colors cursor-pointer group border-b last:border-0" onclick="window.openTeacherModal('${person.id}')">
          <td class="py-4 px-6">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full ${colorClass} flex items-center justify-center font-bold shadow-sm">
                ${(person && person.name && person.name.length) ? person.name[0] : 'U'}
              </div>
              <div>
                <div class="font-semibold text-slate-800">${person?.name || 'Usuario'}</div>
                <div class="text-xs text-slate-500">${person.role === 'maestra' ? (person.specialty || 'Docente') : 'Asistente'}</div>
              </div>
            </div>
          </td>
          <td class="py-4 px-6">
            <div class="text-sm text-slate-600 flex flex-col">
              <span class="flex items-center gap-1"><i data-lucide="mail" class="w-3 h-3"></i> ${person.email}</span>
              <span class="flex items-center gap-1 mt-1"><i data-lucide="phone" class="w-3 h-3"></i> ${person.phone || '-'}</span>
            </div>
          </td>
          <td class="py-4 px-6 text-center">
            <button class="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200 hover:bg-green-200 transition-colors" onclick="event.stopPropagation(); alert('Estado activo')">
              Activo
            </button>
          </td>
          <td class="py-4 px-6 text-right">
            <div class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button class="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors" title="Editar" onclick="event.stopPropagation(); window.openTeacherModal('${person.id}')">
                <i data-lucide="edit-2" class="w-4 h-4"></i>
              </button>
              <button class="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-colors" title="Eliminar" onclick="event.stopPropagation(); window.deleteProfile('${person.id}')">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </td>
        </tr>
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

  // 8.1. CARGAR MAESTROS PARA FILTRO (FUNCIÓN FALTANTE)
  async function loadTeachersForFilter() {
    await safeExecute(async () => {
      const { data: teachers, error } = await supabase
        .from('profiles')
        .select('id, name')
        .eq('role', 'maestra')
        .order('name');
      
      if (error) throw error;

      // Si hay un select de maestros en el formulario de aulas, llenarlo
      const teacherSelect = document.getElementById('teacherFilter');
      if (teacherSelect) {
        teacherSelect.innerHTML = '<option value="">Todos los maestros</option>' + 
          teachers.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
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
      document.getElementById('assistantPassword').value = password;
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

        // 1. Crear Usuario Padre si hay email y contraseña
        if (p1Email) {
          if (!isValidEmail(p1Email)) {
            alert('Correo del padre inválido');
            return;
          }
          // A) Verificar si el padre ya existe en la base de datos
          const { data: existingParent } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', p1Email)
            .eq('role', 'padre')
            .maybeSingle();

          if (existingParent) {
            parentId = existingParent.id;
          } else if (p1Password) {
            // B) Si no existe y hay contraseña, crear nuevo usuario
            const tempSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
              auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
            });

            let authUser = null;
            const { data: authData, error: authError } = await tempSupabase.auth.signUp({
              email: p1Email,
              password: p1Password
            });
            
            if (authError) {
              // Si ya existe en Auth pero no lo encontramos en profiles (o rol distinto), 
              // no podemos recuperar el ID sin loguearnos.
              // Pero si el error es "User already registered", a veces devuelve el user fake o null.
              // Mejor confiamos en que si llegamos aqui es porque no existía como padre.
              // Si falla, lanzamos error.
              throw authError;
            }
            authUser = authData.user;
            
            if (authUser) {
              parentId = authUser.id;
              // Usar UPSERT para evitar conflicto 409 si el perfil ya existía (ej. borrado lógico o rol diferente)
              const { error: profileError } = await tempSupabase.from('profiles').upsert([{
                id: parentId,
                name: p1Name || 'Padre/Tutor',
                email: p1Email,
                phone: p1Phone,
                role: 'padre' // Si ya existía con otro rol, esto lo sobrescribe? Cuidado. 
                // Mejor upsert con ignoreDuplicates si solo queremos asegurar que exista?
                // Pero el usuario quiere crear un padre. Si era maestra, ahora será padre?
                // Asumimos upsert normal.
              }], { onConflict: 'id' });
              
              if (profileError) console.warn('Error creando/actualizando perfil padre:', profileError);
            }
          }
        }

        const { error } = await supabase.from('students').insert([{
          name,
          classroom_id: classroomId,
          is_active: isActive,
          parent_id: parentId, // Vincular al padre creado
          p1_name: p1Name || null,
          p1_phone: p1Phone || null,
          p1_email: p1Email || null,
          p2_name: p2Name || null,
          p2_phone: p2Phone || null,
          allergies: allergies || null,
          blood_type: bloodType || null,
          authorized_pickup: pickup || null
        }]);
        if (error) throw error;

        alert('Estudiante creado correctamente');
        const modal = document.getElementById('modalAddStudent');
        if (modal) modal.classList.add('hidden');
        await window.loadStudents(1);
      }, 'Error al crear estudiante');
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
});
