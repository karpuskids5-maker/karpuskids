import { supabase } from './js/supabase.js';

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
    const userNameElements = document.querySelectorAll('[data-username]');
    userNameElements.forEach(el => el.textContent = profile.name || 'Usuario');
  }

  // 1. NAVEGACIÓN ENTRE SECCIONES
  const navButtons = document.querySelectorAll('[data-section]');
  const sections = document.querySelectorAll('section[id]');

  function showSection(sectionId) {
    sections.forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(sectionId);
    if (target) {
      target.classList.remove('hidden');
      window.DirectorState.currentSection = sectionId;
      loadSectionData(sectionId);
    }
  }

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
  });

  // Mostrar dashboard por defecto
  showSection('dashboard');

  // 2. CARGAR DATOS SEGÚN SECCIÓN
  async function loadSectionData(section) {
    switch (section) {
      case 'dashboard':
        if (!window.DirectorState.loaded.dashboard) {
          await Promise.all([loadDashboard(), loadRooms(), loadStudents()]);
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
          await loadStudents();
          window.DirectorState.loaded.estudiantes = true;
        }
        break;
      case 'aulas':
        if (!window.DirectorState.loaded.aulas) {
          await Promise.all([loadRooms(), loadTeachersForFilter()]);
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

  // 3. FUNCIÓN PARA CARGAR ESTUDIANTES CON PAGINACIÓN
  window.loadStudents = async function(page = 1) {
    const tableBody = document.getElementById('studentsTable');
    if (!tableBody) return;

    window.DirectorState.studentsPage = page;
    const { studentsPageSize } = window.DirectorState;
    const from = (page - 1) * studentsPageSize;
    const to = from + studentsPageSize - 1;

    await safeExecute(async () => {
      // Obtener el total de estudiantes para la paginación
      const { count, error: countError } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true });

      if (countError) throw countError;
      window.DirectorState.totalStudents = count;

      // Obtener la página actual de estudiantes
      const { data: students, error } = await supabase
        .from('students')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to);
        
      if (error) throw error;

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
      const { count: teachers } = await supabase.from('teachers').select('*', { count: 'exact', head: true });
      const { count: rooms } = await supabase.from('rooms').select('*', { count: 'exact', head: true });

      document.getElementById('totalStudents').textContent = students || 0;
      document.getElementById('totalTeachers').textContent = teachers || 0;
      document.getElementById('totalRooms').textContent = rooms || 0;

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

  // 6. CARGAR AULAS
  window.loadRooms = async function(teacherId = null) {
    await safeExecute(async () => {
      let query = supabase.from('rooms').select('*');
      
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

      // Obtener información de las maestras para mostrar nombres en lugar de IDs
      const { data: teachers } = await supabase.from('teachers').select('id, name');
      const teacherMap = teachers.reduce((acc, t) => ({ ...acc, [t.id]: t.name }), {});

      tableBody.innerHTML = rooms.map(r => `
        <tr class="hover:bg-slate-50">
          <td class="py-3 px-4 font-medium text-slate-900">${r.name}</td>
          <td class="py-3 px-4 text-slate-600">${teacherMap[r.teacher_id] || 'Sin asignar'}</td>
          <td class="py-3 px-4 text-slate-600">${r.capacity || '-'}</td>
          <td class="py-3 px-4 text-center">
            <button class="delete-room-btn px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-xs" data-room-id="${r.id}">
              Eliminar
            </button>
          </td>
        </tr>
      `).join('');

    }, 'Error cargando aulas');
  }

  // 7. CARGAR MAESTROS
  async function loadTeachers() {
    await safeExecute(async () => {
      const { data: teachers, error } = await supabase.from('teachers').select('*').order('name');
      if (error) throw error;

      const tableBody = document.getElementById('teachersTable');
      if (!tableBody) return;

      if (teachers.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" class="text-center py-8 text-slate-500">No se encontraron maestros registrados.</td></tr>';
        return;
      }

      tableBody.innerHTML = teachers.map(t => `
        <tr class="hover:bg-slate-50">
          <td class="py-3 px-4 font-medium text-slate-900">${t.name}</td>
          <td class="py-3 px-4 text-slate-600">${t.email}</td>
          <td class="py-3 px-4 text-slate-600">${t.specialty || '-'}</td>
        </tr>
      `).join('');

    }, 'Error cargando maestros');
  }

  // 8. CARGAR ASISTENCIA
  async function loadAttendance() {
    await safeExecute(async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase.from('attendance').select('*').eq('date', today);
      if (error) throw error;

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
      loadRooms(); // Recargar lista de aulas

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
});