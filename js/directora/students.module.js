import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { UI } from './ui.module.js';
import { AppState } from './state.js';

// Vista activa: 'table' | 'grid'
let _view = 'table';

function avg(arr) {
  const valid = arr.filter(v => v != null && !isNaN(v));
  if (!valid.length) return '—';
  return (valid.reduce((a, b) => a + Number(b), 0) / valid.length).toFixed(1);
}

export const StudentsModule = {

  async init() {
    try {
      // 1. Obtener datos de estudiantes
      const { data: students, error } = await DirectorApi.getStudents();
      if (error) throw error;

      AppState.set('students', students || []);

      // 2. Obtener datos globales del dashboard para KPIs complementarios
      let dashboardData = AppState.get('dashboardData');
      if (!dashboardData) {
        const { DashboardService } = await import('./dashboard.service.js');
        dashboardData = await DashboardService.getFullData();
      }
      
      const kpis = dashboardData?.kpis || {};
      const attToday = dashboardData?.attendance?.today || { present: 0, late: 0, total: 0 };

      // 3. Actualizar tarjetas KPI
      const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
      
      setTxt('totalStudents', students.length);
      setTxt('activeStudents', students.filter(s => s.is_active || s.status === 'activo').length);
      setTxt('incidents', kpis.inquiries || 0);
      
      // Aulas con estudiantes asignados
      const classroomsWithStudents = new Set(students.map(s => s.classroom_id).filter(Boolean)).size;
      setTxt('classroomsCount', classroomsWithStudents);
      
      // Promedio y Asistencia (Valores reales calculados o mock si no existen columnas)
      const grades = students.map(s => s.average_grade).filter(v => v != null && !isNaN(v));
      setTxt('avgGrade', grades.length ? avg(grades) : '0.0');

      const attPct = attToday.total > 0 ? Math.round(((attToday.present + attToday.late) / attToday.total) * 100) : 0;
      setTxt('avgAttendance', attPct + '%');

      // 4. Renderizar vista actual
      const tableWrapper = document.getElementById('studentsTableWrapper');
      const gridWrapper = document.getElementById('studentsGrid');
      
      if (_view === 'grid') {
        tableWrapper?.classList.add('hidden');
        gridWrapper?.classList.remove('hidden');
      } else {
        tableWrapper?.classList.remove('hidden');
        gridWrapper?.classList.add('hidden');
      }
      this.render(students);

      // Filtros
      const searchInput = document.getElementById('searchStudent');
      if (searchInput && !searchInput._bound) {
        searchInput._bound = true;
        searchInput.addEventListener('input', () => this.applyFilters());
      }

      const filterClassroom = document.getElementById('filterClassroom');
      if (filterClassroom && !filterClassroom._bound) {
        filterClassroom._bound = true;
        // Poblar opciones de aulas
        const { data: rooms } = await DirectorApi.getClassrooms();
        if (rooms) {
          // Limpiar antes de poblar (excepto la opción "Todas")
          filterClassroom.innerHTML = '<option value="all">Todas las aulas</option>';
          rooms.forEach(r => {
            const o = document.createElement('option');
            o.value = r.id; o.textContent = r.name;
            filterClassroom.appendChild(o);
          });
        }
        filterClassroom.addEventListener('change', () => this.applyFilters());
      }

      const filterStatus = document.getElementById('filterStStatus');
      if (filterStatus && !filterStatus._bound) {
        filterStatus._bound = true;
        filterStatus.addEventListener('change', () => this.applyFilters());
      }

      const filterLevel = document.getElementById('filterLevel');
      if (filterLevel && !filterLevel._bound) {
        filterLevel._bound = true;
        // Poblar niveles únicos de los estudiantes
        const levels = [...new Set(students.map(s => s.level).filter(Boolean))];
        if (levels.length) {
          filterLevel.innerHTML = '<option value="all">Todos los niveles</option>';
          levels.forEach(l => {
            const o = document.createElement('option');
            o.value = l; o.textContent = l;
            filterLevel.appendChild(o);
          });
        }
        filterLevel.addEventListener('change', () => this.applyFilters());
      }

      const btnToggleView = document.getElementById('btnToggleStuView');
      if (btnToggleView && !btnToggleView._bound) {
        btnToggleView._bound = true;
        btnToggleView.onclick = () => {
          _view = _view === 'grid' ? 'table' : 'grid';
          btnToggleView.textContent = _view === 'grid' ? 'Tabla' : 'Grid';
          
          const tableWrapper = document.getElementById('studentsTableWrapper');
          const gridWrapper = document.getElementById('studentsGrid');
          
          if (_view === 'grid') {
            tableWrapper?.classList.add('hidden');
            gridWrapper?.classList.remove('hidden');
          } else {
            tableWrapper?.classList.remove('hidden');
            gridWrapper?.classList.add('hidden');
          }
          this.render(AppState.get('students') || []);
        };
      }

      const btnExport = document.getElementById('btnExportStudents');
      if (btnExport && !btnExport._bound) {
        btnExport._bound = true;
        btnExport.onclick = () => {
          Helpers.toast('Generando lista...', 'info');
          Helpers.exportToCSV(AppState.get('students') || [], 'Estudiantes.csv');
        };
      }

      const btnAdd = document.getElementById('btnAddStudent');
      if (btnAdd && !btnAdd._bound) {
        btnAdd._bound = true;
        btnAdd.onclick = () => this.openModal();
      }

      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('[StudentsModule] init error:', e);
      const container = document.getElementById('studentsTable') || document.getElementById('studentsGrid');
      if (container) container.innerHTML = '<div class="col-span-3 text-center p-8 text-red-500">Error al cargar estudiantes.</div>';
    }
  },

  render(students) {
    const tableContainer = document.getElementById('studentsTable');
    const gridContainer = document.getElementById('studentsGrid');
    
    if (!students?.length) {
      if (tableContainer) tableContainer.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-500">No hay estudiantes.</td></tr>';
      if (gridContainer) gridContainer.innerHTML = '<div class="col-span-3 text-center py-8 text-slate-500">No hay estudiantes.</div>';
      return;
    }

    // Render Table
    if (tableContainer) {
      tableContainer.innerHTML = students.map(s => `
        <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100">
          <td class="p-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-sm font-black text-purple-600">
                ${(s.name || '?').charAt(0)}
              </div>
              <div>
                <div class="font-bold text-slate-800">${Helpers.escapeHTML(s.name)}</div>
                <div class="text-[10px] text-slate-400 font-black uppercase tracking-widest">${s.matricula || 'SIN MATRÍCULA'}</div>
              </div>
            </div>
          </td>
          <td class="p-4 text-sm font-medium text-slate-600">
            ${s.classrooms?.name || '<span class="text-slate-300 italic">No asignada</span>'}
          </td>
          <td class="p-4 text-right">
            <div class="flex justify-end gap-2">
              <button onclick="App.students.openModal('${s.id}')" class="w-9 h-9 flex items-center justify-center bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white rounded-xl transition-all shadow-sm" title="Editar">
                <i data-lucide="edit-3" class="w-4 h-4"></i>
              </button>
              <button onclick="App.students.delete('${s.id}')" class="w-9 h-9 flex items-center justify-center bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-xl transition-all shadow-sm" title="Eliminar">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </td>
        </tr>`).join('');
    }

    // Render Grid
    if (gridContainer) {
      gridContainer.innerHTML = students.map(s => `
        <div class="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
          <div class="absolute top-0 right-0 w-24 h-24 bg-purple-50 rounded-bl-[4rem] -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
          
          <div class="flex items-start gap-4 mb-4 relative">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-2xl shadow-lg shadow-purple-100">
              👶
            </div>
            <div class="flex-1">
              <h3 class="font-black text-slate-800 text-lg leading-tight mb-1">${Helpers.escapeHTML(s.name)}</h3>
              <p class="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <i data-lucide="home" class="w-3 h-3"></i> ${s.classrooms?.name || 'Sin Aula'}
              </p>
            </div>
            <div class="flex flex-col gap-1">
               <span class="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">
                 ${s.is_active ? 'Activo' : 'Inactivo'}
               </span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-6 relative">
            <div class="bg-slate-50 p-3 rounded-2xl">
              <p class="text-[10px] font-black text-slate-400 uppercase mb-1">Promedio</p>
              <p class="text-xl font-black text-indigo-600">${s.average_grade || '—'}</p>
            </div>
            <div class="bg-slate-50 p-3 rounded-2xl">
              <p class="text-[10px] font-black text-slate-400 uppercase mb-1">Asistencia</p>
              <p class="text-xl font-black text-emerald-600">${s.attendance || 0}%</p>
            </div>
          </div>

          <div class="flex items-center justify-between pt-4 border-t border-slate-50">
            <div class="flex -space-x-2">
               <div class="w-8 h-8 rounded-full border-2 border-white bg-blue-100 flex items-center justify-center text-[10px]" title="Padre: ${Helpers.escapeHTML(s.p1_name || 'N/A')}">👤</div>
            </div>
            <div class="flex gap-2">
              <button onclick="App.students.openModal('${s.id}')" class="p-2.5 bg-slate-100 text-slate-600 hover:bg-purple-600 hover:text-white rounded-xl transition-all">
                <i data-lucide="edit-3" class="w-4 h-4"></i>
              </button>
              <button onclick="App.students.delete('${s.id}')" class="p-2.5 bg-slate-100 text-slate-600 hover:bg-rose-600 hover:text-white rounded-xl transition-all">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </div>
        </div>`).join('');
    }

    if (window.lucide) lucide.createIcons();
  },

  applyFilters() {
    const term = document.getElementById('searchStudent')?.value.toLowerCase() || '';
    const classroomId = document.getElementById('filterClassroom')?.value || 'all';
    const status = document.getElementById('filterStStatus')?.value || '';
    const level = document.getElementById('filterLevel')?.value || 'all';

    const all = AppState.get('students') || [];
    const filtered = all.filter(s => {
      const matchSearch = s.name.toLowerCase().includes(term) || 
                         (s.classrooms?.name || '').toLowerCase().includes(term) ||
                         (s.p1_name || '').toLowerCase().includes(term);
      
      const matchClassroom = classroomId === 'all' || String(s.classroom_id) === classroomId;
      
      let matchStatus = true;
      if (status === 'activo' || status === 'true') {
        matchStatus = s.is_active === true || s.status === 'activo';
      } else if (status === 'inactivo' || status === 'false') {
        matchStatus = s.is_active === false || s.status === 'inactivo';
      }

      const matchLevel = level === 'all' || s.level === level;

      return matchSearch && matchClassroom && matchStatus && matchLevel;
    });

    this.render(filtered);
  },

  async save() {
    const id = document.getElementById('stId')?.value;
    const payload = this.getFormData();

    if (!payload.name || payload.name.trim().length < 3) return Helpers.toast('Nombre inválido (min 3 caracteres)', 'warning');
    if (!payload.p1_name || !payload.p1_phone || !payload.p1_email) return Helpers.toast('Datos del padre/madre 1 incompletos', 'warning');
    
    UI.setLoading(true);
    try {
      const res = id 
        ? await DirectorApi.updateStudent(id, payload)
        : await DirectorApi.createStudent(payload);
      
      const { error } = res || {};
      if (error) throw new Error(error);
      
      Helpers.toast(id ? 'Estudiante actualizado' : 'Estudiante creado', 'success');
      UI.closeModal();
      this.init();
    } catch (e) {
      console.error('Error saveStudent:', e);
      Helpers.toast('Error al guardar: ' + (e.message || e), 'error');
    } finally {
      UI.setLoading(false);
    }
  },

  async delete(id) {
    if (!confirm('¿Seguro que desea eliminar a este estudiante?')) return;
    try {
      const res = await DirectorApi.deleteStudent(id);
      const { error } = res || {};
      if (error) throw new Error(error);
      Helpers.toast('Estudiante eliminado con éxito.', 'success');
      this.init();
    } catch (e) {
      Helpers.toast('Error al eliminar estudiante.', 'error');
      console.error('Error deleteStudent:', e);
    }
  },

  getFormData() {
    return {
      name: document.getElementById('stName')?.value,
      classroom_id: document.getElementById('stClassroom')?.value || null,
      start_date: document.getElementById('stJoinedDate')?.value || new Date().toISOString().split('T')[0],
      is_active: document.getElementById('active')?.checked,
      blood_type: document.getElementById('bloodType')?.value,
      allergies: document.getElementById('allergies')?.value,
      authorized_pickup: document.getElementById('authorized')?.value,
      p1_name: document.getElementById('p1Name')?.value,
      p1_phone: document.getElementById('p1Phone')?.value,
      p1_job: document.getElementById('p1Profession')?.value,
      p1_address: document.getElementById('p1Address')?.value,
      p1_emergency_contact: document.getElementById('p1Emergency')?.value,
      p1_email: document.getElementById('stEmailNotif')?.value,
      p2_name: document.getElementById('p2Name')?.value,
      p2_phone: document.getElementById('p2Phone')?.value,
      p2_job: document.getElementById('p2Profession')?.value,
      p2_address: document.getElementById('p2Address')?.value,
      monthly_fee: parseFloat(document.getElementById('monthlyFee')?.value || 0),
      due_day: parseInt(document.getElementById('dueDay')?.value || 5)
    };
  },

  async openModal(id = null) {
    const inputClass = "w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium";
    const labelClass = "block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1";
    
    const modalHTML = `
      <div class="modal-header bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6 rounded-t-3xl flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl shadow-inner">👶</div>
          <div>
            <h3 class="text-xl font-black">${id ? 'Editar Estudiante' : 'Crear Estudiante'}</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">${id ? 'Actualizar Registro' : 'Nuevo Registro'}</p>
          </div>
        </div>
        <button onclick="App.ui.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors">
          <i data-lucide="x" class="w-6 h-6"></i>
        </button>
      </div>
      
      <div class="modal-body p-8 bg-slate-50/30" id="studentForm">
        <div class="grid grid-cols-1 gap-8">
          <input type="hidden" id="stId" value="${id || ''}" />
          
          <!-- 1. FOTO Y MATRÍCULA -->
          <div class="flex flex-col md:flex-row gap-6 items-center bg-white p-6 rounded-3xl border-2 border-slate-100 shadow-sm">
            <div class="relative group cursor-pointer">
              <div id="stAvatarPreview" class="w-24 h-24 rounded-[2rem] bg-slate-100 border-4 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 group-hover:border-purple-400 group-hover:bg-purple-50 transition-all overflow-hidden">
                <i data-lucide="camera" class="w-8 h-8 mb-1"></i>
                <span class="text-[9px] font-black uppercase">Foto</span>
              </div>
              <input type="file" id="stAvatarFile" class="absolute inset-0 opacity-0 cursor-pointer" accept="image/*">
            </div>
            
            <div class="flex-1 w-full">
              <h4 class="text-sm font-black text-slate-800 mb-3">📷 FOTO Y MATRÍCULA</h4>
              <div class="flex gap-2">
                <div class="relative flex-1">
                  <i data-lucide="hash" class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"></i>
                  <input id="stMatricula" placeholder="Generar automática..." class="${inputClass} pl-10 bg-white" readonly>
                </div>
                <button onclick="window.generateMatricula()" class="px-6 py-2 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase hover:bg-indigo-700 shadow-md transition-all active:scale-95">Generar</button>
              </div>
              <div class="grid grid-cols-2 gap-4 mt-3">
                 <div><label class="${labelClass}">Fecha inscripción</label><input type="date" id="stJoinedDate" class="${inputClass}"></div>
                 <div class="flex items-center pt-6">
                    <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="active" checked class="w-5 h-5 rounded text-emerald-600"><span class="text-sm font-black text-emerald-700 uppercase">Estado Activo</span></label>
                 </div>
              </div>
            </div>
          </div>

          <!-- 2. INFORMACIÓN DEL ESTUDIANTE -->
          <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
            <h4 class="text-sm font-black text-slate-800 flex items-center gap-2 mb-4">
              <span class="w-8 h-8 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center"><i data-lucide="user" class="w-4 h-4"></i></span>
              👦 INFORMACIÓN DEL ESTUDIANTE
            </h4>
            <div>
              <label class="${labelClass}">Nombre completo</label>
              <input id="stName" placeholder="Ej: Juan Pérez" class="${inputClass}">
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div><label class="${labelClass}">Edad</label><input id="stAge" placeholder="Ej: 5" type="number" class="${inputClass}"></div>
              <div><label class="${labelClass}">Horario</label><input id="stHorario" placeholder="08:00-12:00" class="${inputClass}"></div>
            </div>
            <div>
              <label class="${labelClass}">Aula</label>
              <div class="relative">
                <i data-lucide="home" class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"></i>
                <select id="stClassroom" class="${inputClass} pl-10 appearance-none">
                  <option value="">-- Seleccionar Aula --</option>
                </select>
              </div>
            </div>
          </div>

          <!-- 3. ACCESO DEL ESTUDIANTE -->
          <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
            <h4 class="text-sm font-black text-slate-800 flex items-center gap-2 mb-4">
              <span class="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center"><i data-lucide="lock" class="w-4 h-4"></i></span>
              🔐 ACCESO Y NOTIFICACIONES
            </h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label class="${labelClass}">Correo de Usuario (Login)</label><input id="stEmailUser" placeholder="usuario@karpus.com" type="email" class="${inputClass}"></div>
              <div><label class="${labelClass}">Correo de Notificaciones</label><input id="stEmailNotif" placeholder="avisos@ejemplo.com" type="email" class="${inputClass}"></div>
              <div><label class="${labelClass}">Contraseña (Min 6 caracteres)</label><input id="stPassword" type="text" placeholder="********" class="${inputClass}"></div>
            </div>
          </div>

          <!-- 4. SALUD Y SEGURIDAD -->
          <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
            <h4 class="text-sm font-black text-slate-800 flex items-center gap-2 mb-4">
              <span class="w-8 h-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center"><i data-lucide="heart-pulse" class="w-4 h-4"></i></span>
              🩺 SALUD Y SEGURIDAD
            </h4>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="${labelClass}">Tipo Sangre</label>
                <select id="bloodType" class="${inputClass}">
                  <option value="O+">O+</option><option value="O-">O-</option><option value="A+">A+</option><option value="A-">A-</option>
                  <option value="B+">B+</option><option value="B-">B-</option><option value="AB+">AB+</option><option value="AB-">AB-</option>
                </select>
              </div>
              <div><label class="${labelClass}">Alergias</label><input id="allergies" placeholder="Ej: Maní, Polvo" class="${inputClass}"></div>
            </div>
            <div>
              <label class="${labelClass}">Autorizados para recoger</label>
              <textarea id="authorized" rows="2" placeholder="Ej: Abuela Carmen, Tío Juan" class="${inputClass} resize-none"></textarea>
            </div>
          </div>

          <!-- 5. TUTOR PRINCIPAL -->
          <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
            <h4 class="text-sm font-black text-slate-800 flex items-center gap-2">
              <div class="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center"><i data-lucide="user" class="w-4 h-4"></i></div>
              👨‍👩‍👦 TUTOR PRINCIPAL
            </h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label class="${labelClass}">Nombre</label><input id="p1Name" placeholder="Nombre completo" class="${inputClass}"></div>
              <div><label class="${labelClass}">Teléfono</label><input id="p1Phone" placeholder="Teléfono" class="${inputClass}"></div>
              <div><label class="${labelClass}">Profesión</label><input id="p1Profession" placeholder="Ej: Ingeniero" class="${inputClass}"></div>
              <div class="md:col-span-2"><label class="${labelClass}">Dirección</label><input id="p1Address" placeholder="Dirección completa" class="${inputClass}"></div>
              <div class="md:col-span-2"><label class="${labelClass}">Contacto de Emergencia (Extra)</label><input id="p1Emergency" placeholder="Nombre y Teléfono alternativo" class="${inputClass}"></div>
            </div>
          </div>

          <!-- 6. TUTOR SECUNDARIO -->
          <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
              <h4 class="text-sm font-black text-slate-800 flex items-center gap-2">
                <div class="w-8 h-8 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center"><i data-lucide="user-plus" class="w-4 h-4"></i></div>
                👨‍👩‍👧 TUTOR SECUNDARIO
              </h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label class="${labelClass}">Nombre</label><input id="p2Name" placeholder="Nombre" class="${inputClass}"></div>
                <div><label class="${labelClass}">Teléfono</label><input id="p2Phone" placeholder="Teléfono" class="${inputClass}"></div>
                <div><label class="${labelClass}">Profesión</label><input id="p2Profession" placeholder="Ej: Abogada" class="${inputClass}"></div>
                <div><label class="${labelClass}">Dirección</label><input id="p2Address" placeholder="Dirección opcional" class="${inputClass}"></div>
              </div>
          </div>

          <!-- 7. INFORMACIÓN DE PAGO -->
          <div class="bg-amber-50 p-6 rounded-[2rem] border-2 border-amber-100 space-y-4">
              <h4 class="text-sm font-black text-amber-800 flex items-center gap-2">
                <div class="w-8 h-8 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center"><i data-lucide="credit-card" class="w-4 h-4"></i></div>
                💳 INFORMACIÓN DE PAGO
              </h4>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="${labelClass}">Mensualidad</label>
                  <div class="relative">
                    <span class="absolute left-4 top-1/2 -translate-y-1/2 text-amber-600 font-black text-sm">$</span>
                    <input id="monthlyFee" placeholder="0.00" type="number" step="0.01" class="${inputClass} pl-8 bg-white">
                  </div>
                </div>
                <div><label class="${labelClass}">Día Vencimiento</label><input id="dueDay" placeholder="5" type="number" min="1" max="31" class="${inputClass} bg-white"></div>
              </div>
            </div>
        </div>
      </div>
      
      <div class="modal-footer bg-white p-6 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">
        <button onclick="App.ui.closeModal()" class="px-8 py-3 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
        <button onclick="App.students.save()" class="px-10 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-purple-200 hover:shadow-purple-300 hover:-translate-y-0.5 transition-all active:scale-95">Guardar Estudiante</button>
      </div>`;
      
    window.openGlobalModal(modalHTML, true);

    // Generar matrícula automática
    window.generateMatricula = () => {
      const el = document.getElementById('stMatricula');
      if (el) el.value = 'KK-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random() * 9000) + 1000);
    };

    // Handler de avatar
    const avatarFile = document.getElementById('stAvatarFile');
    const avatarPreview = document.getElementById('stAvatarPreview');
    if (avatarFile && avatarPreview) {
      avatarFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          avatarPreview.innerHTML = '<img src="' + ev.target.result + '" class="w-full h-full object-cover">';
        };
        reader.readAsDataURL(file);
      };
    }
    
    // Cargar aulas en el select
    try {
      const { data: rooms } = await DirectorApi.getClassrooms();
      const select = document.getElementById('stClassroom');
      if(select && rooms?.length) {
        rooms.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = (r.name || 'Sin nombre').trim();
          select.appendChild(opt);
        });
      }
    } catch (e) { console.error('Error cargando aulas:', e); }

    if (id) {
      const students = AppState.get('students') || [];
      const student = students.find(s => s.id == id);
      if (student) {
        const setVal = (eid, val) => { const e = document.getElementById(eid); if(e) e.value = val || ''; };
        setVal('stId', student.id);
        setVal('stMatricula', student.matricula);
        setVal('stName', student.name);
        setVal('stAge', student.age);
        setVal('stHorario', student.horario);
        setVal('stClassroom', student.classroom_id);
        setVal('p1Name', student.p1_name);
        setVal('p1Phone', student.p1_phone);
        setVal('stEmailUser', student.parent?.email || '');
        setVal('stEmailNotif', student.p1_email);
        setVal('p1Profession', student.p1_job);
        setVal('p1Address', student.p1_address);
        setVal('p1Emergency', student.p1_emergency_contact);
        setVal('p2Name', student.p2_name);
        setVal('p2Phone', student.p2_phone);
        setVal('p2Profession', student.p2_job);
        setVal('p2Address', student.p2_address);
        setVal('allergies', student.allergies);
        setVal('bloodType', student.blood_type);
        setVal('monthlyFee', student.monthly_fee);
        setVal('dueDay', student.due_day);
        setVal('authorized', student.authorized_pickup);
        setVal('stJoinedDate', student.start_date ? student.start_date.split('T')[0] : '');
        const checkActive = document.getElementById('active');
        if(checkActive) checkActive.checked = student.is_active;
      }
    }
    if (window.lucide) lucide.createIcons();
  }
};
