import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { UI } from './ui.module.js';
import { AppState } from './state.js';
import { supabase, createClient, SUPABASE_URL, SUPABASE_ANON_KEY } from '../shared/supabase.js';
import { auditLog } from '../shared/db-utils.js';
import { QueryCache } from '../shared/query-cache.js';

// Vista activa: 'table' | 'grid'
let _view = 'table';

function avg(arr) {
  const valid = arr.filter(v => v != null && !isNaN(v));
  if (!valid.length) return '-';
  return (valid.reduce((a, b) => a + Number(b), 0) / valid.length).toFixed(1);
}

export const StudentsModule = {

  async init() {
    try {
      if (!this._dirPage) this._dirPage = 1;
      const pageSize = 10;
      const range = { 
        from: (this._dirPage - 1) * pageSize, 
        to: this._dirPage * pageSize - 1 
      };

      // 1. Obtener datos de estudiantes paginados desde el servidor
      const { data: students, error, count } = await DirectorApi.getStudents({}, range);
      if (error) throw error;

      AppState.set('students', students || []);
      this._totalStudentsCount = count || 0;

      // 2. Obtener datos globales del dashboard para KPIs complementarios
      let dashboardData = AppState.get('dashboardData');
      if (!dashboardData) {
        const { DashboardService } = await import('./dashboard.service.js');
        dashboardData = await DashboardService.getFullData();
      }
      
      const kpis = dashboardData?.stats || {}; // DashboardService usa 'stats'

      // 3. Actualizar tarjetas KPI
      const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
      
      setTxt('totalStudents', count || 0);
      setTxt('activeStudents', kpis.active || 0);
      setTxt('incidents', kpis.pendingInquiries || 0);
      setTxt('classroomsCount', kpis.classrooms || 0);
      setTxt('avgAttendance', (kpis.attendance || 0) + '%');

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

      // Renderizar paginación
      this._renderDirPagination(this._dirPage, Math.ceil((count || 0) / pageSize), count || 0, students);
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
      const container = document.getElementById('studentsTable') || document.getElementById('studentsGrid');
      if (container) {
        container.innerHTML = '<div class="col-span-3 text-center p-8">' + Helpers.errorState('Error al cargar estudiantes', 'App.students.init()') + '</div>';
        if (window.lucide) lucide.createIcons();
      }
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

    const pageStudents = students; // Ya vienen paginados desde el servidor

    // Render Table
    if (tableContainer) {
      tableContainer.innerHTML = pageStudents.map(s => `
        <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 cursor-pointer" ondblclick="App.students.openModal('${s.id}')">
          <td class="p-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-sm font-black text-purple-600 overflow-hidden">
                ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : (s.name || '?').charAt(0)}
              </div>
              <div>
                <div class="font-bold text-slate-800">${Helpers.escapeHTML(s.name)}</div>
                <div class="text-[10px] text-slate-400 font-black uppercase tracking-widest">${s.matricula || 'SIN MATRÍCULA'}</div>
              </div>
            </div>
          </td>
          <td class="p-4 text-sm font-medium text-slate-600">
            <span class="px-3 py-1 bg-slate-100 rounded-full text-[10px] font-black uppercase text-slate-500">
              ${s.classrooms?.name || 'No asignada'}
            </span>
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
      gridContainer.innerHTML = pageStudents.map(s => `
        <div class="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
          <div class="absolute top-0 right-0 w-24 h-24 bg-purple-50 rounded-bl-[4rem] -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
          
          <div class="flex items-start gap-4 mb-4 relative">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-100">
              <i data-lucide="user" class="w-8 h-8 text-white"></i>
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
              <p class="text-xl font-black text-indigo-600">${s.average_grade || '-'}</p>
            </div>
            <div class="bg-slate-50 p-3 rounded-2xl">
              <p class="text-[10px] font-black text-slate-400 uppercase mb-1">Asistencia</p>
              <p class="text-xl font-black text-emerald-600">${s.attendance || 0}%</p>
            </div>
          </div>

          <div class="flex items-center justify-between pt-4 border-t border-slate-50">
            <div class="flex -space-x-2">
               <div class="w-8 h-8 rounded-full border-2 border-white bg-blue-100 flex items-center justify-center text-[10px]" title="Padre: ${Helpers.escapeHTML(s.p1_name || 'N/A')}"><i data-lucide="user" class="w-3.5 h-3.5 text-blue-500"></i></div>
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

  _renderDirPagination(page, totalPages, total, students) {
    let container = document.getElementById('dirStudentsPagination');
    if (!container) {
      const tableWrapper = document.getElementById('studentsTableWrapper');
      const gridWrapper = document.getElementById('studentsGrid');
      const parent = tableWrapper || gridWrapper?.parentElement;
      if (!parent) return;
      container = document.createElement('div');
      container.id = 'dirStudentsPagination';
      parent.insertAdjacentElement('afterend', container);
    }
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    const start = (page - 1) * 10 + 1;
    const end = Math.min(page * 10, total);
    container.className = 'flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-white rounded-b-3xl';
    container.innerHTML = `
      <span class="text-xs font-bold text-slate-400">${start}–${end} de ${total} estudiantes</span>
      <div class="flex gap-2">
        <button id="dirBtnPrev" class="px-3 py-1.5 text-xs font-black rounded-xl border border-slate-200 text-slate-500 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed" ${page <= 1 ? 'disabled' : ''}>← Ant</button>
        <span class="px-3 py-1.5 text-xs font-black text-purple-600 bg-purple-50 rounded-xl">${page} / ${totalPages}</span>
        <button id="dirBtnNext" class="px-3 py-1.5 text-xs font-black rounded-xl border border-slate-200 text-slate-500 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed" ${page >= totalPages ? 'disabled' : ''}>Sig →</button>
      </div>`;
    document.getElementById('dirBtnPrev')?.addEventListener('click', () => { this._dirPage--; this.init(); });
    document.getElementById('dirBtnNext')?.addEventListener('click', () => { this._dirPage++; this.init(); });
  },

  async applyFilters() {
    this._dirPage = 1;
    const term = document.getElementById('searchStudent')?.value.toLowerCase() || '';
    const classroomId = document.getElementById('filterClassroom')?.value || 'all';
    const status = document.getElementById('filterStStatus')?.value || '';
    // const level = document.getElementById('filterLevel')?.value || 'all'; // Comentado si no se usa

    const filters = {};
    if (term) filters.search = term;
    if (classroomId !== 'all') filters.classroom_id = classroomId;
    if (status) filters.status = status;

    const pageSize = 10;
    const range = { from: 0, to: pageSize - 1 };

    UI.setLoading(true);
    try {
      const { data, count } = await DirectorApi.getStudents(filters, range);
      this._totalStudentsCount = count || 0;
      this.render(data);
      this._renderDirPagination(1, Math.ceil((count || 0) / pageSize), count || 0, data);
    } catch (e) {
      Helpers.toast('Error al filtrar', 'error');
    } finally {
      UI.setLoading(false);
    }
  },

  async save() {
    const id = document.getElementById('stId')?.value;
    const payload = this.getFormData();
    
    // Capturar datos de Auth para nuevo estudiante
    const emailUser = document.getElementById('stEmailUser')?.value?.trim();
    const password = document.getElementById('stPassword')?.value?.trim();

    if (!payload.name || payload.name.trim().length < 3) return Helpers.toast('Nombre inválido (min 3 caracteres)', 'warning');
    // Solo validar datos del padre en creación sin hermano seleccionado
    const hasSibling = !!payload._inheritedParentId;
    if (!id && !hasSibling && (!payload.p1_name || !payload.p1_phone || !payload.p1_email)) return Helpers.toast('Datos del padre/madre 1 incompletos (o selecciona un hermano)', 'warning');
    
    UI.setLoading(true);
    try {
      let res;
      if (id) {
        // Limpiar campos auxiliares que no existen en la DB
        const { _inheritedParentId, ...cleanPayload } = payload;
        res = await DirectorApi.updateStudent(id, cleanPayload);
        if (res?.error && (res.error.message?.includes('classroom_id') || res.error.code === '42703')) {
          const { classroom_id, ...payloadWithout } = cleanPayload;
          res = await DirectorApi.updateStudent(id, payloadWithout);
        }
      } else {
        // Extraer y limpiar el campo auxiliar antes de enviar a DB
        const inheritedParentId = payload._inheritedParentId;
        delete payload._inheritedParentId;

        // Si se seleccionó un hermano, heredar su parent_id directamente
        if (inheritedParentId) {
          payload.parent_id = inheritedParentId;
          // Validación de padre menos estricta cuando hay hermano
        } else if (emailUser && password) {
          const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
          });

          const { data: authData, error: authError } = await tempClient.auth.signUp({
            email: emailUser,
            password: password,
            options: { data: { name: payload.p1_name, role: 'padre', phone: payload.p1_phone } }
          });

          let parentId = null;

          if (authError) {
            // User already exists – look up their profile by email
            if (authError.message?.toLowerCase().includes('already registered') ||
                authError.status === 422) {
              const { data: existing } = await supabase
                .from('profiles')
                .select('id')
                .eq('email', emailUser)
                .maybeSingle();
              if (existing?.id) {
                parentId = existing.id;
                Helpers.toast('Usuario ya existe – vinculando al estudiante', 'info');
              } else {
                throw new Error('El correo ya está registrado pero no tiene perfil. Contacta al administrador.');
              }
            } else {
              throw authError;
            }
          } else if (authData?.user) {
            parentId = authData.user.id;
          }

          if (parentId) {
            payload.parent_id = parentId;
            // Upsert profile to ensure role is set correctly
            await supabase.from('profiles').upsert({
              id:    parentId,
              name:  payload.p1_name,
              email: emailUser,
              phone: payload.p1_phone,
              role:  'padre'
            }, { onConflict: 'id' });
          }
        }

        // Validar que el padre quedó asignado
        if (!payload.parent_id && !inheritedParentId) {
          // Si no se eligió hermano ni usuario, aún puede crear sin parent_id (padre se asignará luego)
        }
        
        res = await DirectorApi.createStudent(payload);
        // Si falla por classroom_id, reintentar sin esa columna
        if (res?.error && (res.error.message?.includes('classroom_id') || res.error.code === '42703')) {
          const { classroom_id, _inheritedParentId: _aux, ...payloadWithout } = payload;
          res = await DirectorApi.createStudent(payloadWithout);
        }
      }
      
      const { error } = res || {};
      if (error) {
        const msg = typeof error === 'string' ? error : (error.message || error.details || JSON.stringify(error));
        throw new Error(msg);
      }
      
      Helpers.toast(id ? 'Estudiante actualizado' : 'Estudiante creado', 'success');
      UI.closeModal();
      QueryCache.invalidate('dir_students');
      this.init();
    } catch (e) {
      Helpers.toast('Error al guardar: ' + (e.message || e), 'error');
    } finally {
      UI.setLoading(false);
    }
  },

  async delete(id) {
    const student = (AppState.get('students') || []).find(s => String(s.id) === String(id));
    const name = student?.name || 'este estudiante';
    const ok = window.confirm(`¿Eliminar a "${name}"?\n\nEsta acción no se puede deshacer. Se perderán todos los datos del estudiante.`);
    if (!ok) return;
    UI.setLoading(true);
    try {
      const res = await DirectorApi.deleteStudent(id);
      const { error } = res || {};
      if (error) throw new Error(typeof error === 'string' ? error : (error.message || JSON.stringify(error)));
      Helpers.toast('Estudiante eliminado correctamente', 'success');
      QueryCache.invalidate('dir_students');
      this.init();
    } catch (e) {
      Helpers.toast('Error al eliminar: ' + (e.message || e), 'error');
    } finally {
      UI.setLoading(false);
    }
  },

  getFormData() {
    const v = (id) => document.getElementById(id)?.value?.trim() || null;
    const n = (id, def = null) => { const val = parseFloat(document.getElementById(id)?.value); return isNaN(val) ? def : val; };
    const i = (id, def = 5) => { const val = parseInt(document.getElementById(id)?.value); return isNaN(val) ? def : val; };

    // Si se seleccionó un hermano, heredar el parent_id de ese estudiante
    const siblingId = v('stSiblingId');
    let inheritedParentId = null;
    if (siblingId) {
      const sibSel = document.getElementById('stSiblingId');
      const opt = sibSel?.options[sibSel?.selectedIndex];
      inheritedParentId = opt?.dataset?.parentId || null;
    }

    return {
      name:                  v('stName'),
      matricula:             v('stMatricula') || null,
      classroom_id:          v('stClassroom') ? parseInt(v('stClassroom')) : null,
      age:                   i('stAge', null),
      age_type:              v('stAgeType') || 'años',
      schedule:              v('stHorario'),
      start_date:            v('stJoinedDate') || new Date().toISOString().split('T')[0],
      is_active:             document.getElementById('active')?.checked ?? true,
      blood_type:            v('bloodType'),
      allergies:             v('allergies'),
      authorized_pickup:     v('authorized'),
      authorized_pickup_phone: v('authorizedPhone'),
      p1_name:               v('p1Name'),
      p1_phone:              v('p1Phone'),
      p1_job:                v('p1Profession'),
      p1_address:            v('p1Address'),
      p1_emergency_contact:  v('p1Emergency'),
      p1_email:              v('stEmailNotif'),
      p2_name:               v('p2Name'),
      p2_phone:              v('p2Phone'),
      p2_job:                v('p2Profession'),
      p2_address:            v('p2Address'),
      monthly_fee:           n('monthlyFee', 0),
      prolongado_fee:        n('prolongadoFee', 0),
      due_day:               i('dueDay', 5),
      // Si hay hermano seleccionado, el parent_id se fuerza en save()
      _inheritedParentId:    inheritedParentId
    };
  },

  async openModal(id = null) {
    const inputClass = "w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium";
    const labelClass = "block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1";
    
    const modalHTML = `
      <div class="modal-header bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6 rounded-t-3xl flex items-center">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shadow-inner"><i data-lucide="user-plus" class="w-6 h-6 text-white"></i></div>
          <div>
            <h3 class="text-xl font-black">${id ? 'Editar Estudiante' : 'Crear Estudiante'}</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">${id ? 'Actualizar Registro' : 'Nuevo Registro'}</p>
          </div>
        </div>
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
              <h4 class="text-sm font-black text-slate-800 mb-3">\ud83d\udcf7 FOTO Y MATR\u00cdCULA</h4>
              <div class="flex gap-2">
                <div class="relative flex-1">
                  <i data-lucide="hash" class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"></i>
              <input id="stMatricula" placeholder="Generar autom\u00e1tica..." class="${inputClass} pl-10 bg-white">
                </div>
                <button onclick="window.generateMatricula()" class="px-6 py-2 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase hover:bg-indigo-700 shadow-md transition-all active:scale-95">Generar</button>
              </div>
              <div class="grid grid-cols-2 gap-4 mt-3">
                 <div><label class="${labelClass}">Fecha inscripci\u00f3n</label><input type="date" id="stJoinedDate" class="${inputClass}"></div>
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
              INFORMACIÓN DEL ESTUDIANTE
            </h4>
            <div>
              <label class="${labelClass}">Nombre completo</label>
              <input id="stName" placeholder="Ej: Juan Pérez" class="${inputClass}">
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div class="flex flex-col">
                <label class="${labelClass}">Edad</label>
                <div class="flex gap-2">
                  <input id="stAge" placeholder="Ej: 5" type="number" class="${inputClass} flex-1">
                  <select id="stAgeType" class="w-24 px-2 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-black">
                    <option value="años">Años</option>
                    <option value="meses">Meses</option>
                  </select>
                </div>
              </div>
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

            <!-- 🔗 HERMANOS — vincular al mismo padre -->
            <div class="pt-2 border-t border-slate-100">
              <label class="${labelClass} flex items-center gap-1.5">
                <i data-lucide="users" class="w-3.5 h-3.5 text-indigo-500"></i>
                ¿Tiene hermano(s) en la estancia?
              </label>
              <p class="text-[10px] text-slate-400 font-medium mb-2 ml-1">Al seleccionar un hermano, este estudiante compartirá el acceso del padre.</p>
              <select id="stSiblingId" class="${inputClass} appearance-none">
                <option value="">-- Sin hermanos (nuevo padre) --</option>
              </select>
              <p id="stSiblingInfo" class="text-[10px] text-indigo-600 font-bold mt-1.5 ml-1 hidden"></p>
            </div>
          </div>

          <!-- 3. ACCESO DEL ESTUDIANTE -->
          <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
            <h4 class="text-sm font-black text-slate-800 flex items-center gap-2 mb-4">
              <span class="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center"><i data-lucide="lock" class="w-4 h-4"></i></span>
              ACCESO Y NOTIFICACIONES
            </h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label class="${labelClass}">Correo de Usuario (Login)</label><input id="stEmailUser" placeholder="usuario@karpus.com" type="email" class="${inputClass}"></div>
              <div><label class="${labelClass}">Correo de Notificaciones</label><input id="stEmailNotif" placeholder="avisos@ejemplo.com" type="email" class="${inputClass}"></div>
              <div><label class="${labelClass}">Contrase\u00f1a (Min 6 caracteres)</label><input id="stPassword" type="text" placeholder="********" class="${inputClass}"></div>
            </div>
          </div>

          <!-- 4. SALUD Y SEGURIDAD -->
          <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
            <h4 class="text-sm font-black text-slate-800 flex items-center gap-2 mb-4">
              <span class="w-8 h-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center"><i data-lucide="heart-pulse" class="w-4 h-4"></i></span>
              SALUD Y SEGURIDAD
            </h4>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="${labelClass}">Tipo Sangre</label>
                <select id="bloodType" class="${inputClass}">
                  <option value="O+">O+</option><option value="O-">O-</option><option value="A+">A+</option><option value="A-">A-</option>
                  <option value="B+">B+</option><option value="B-">B-</option><option value="AB+">AB+</option><option value="AB-">AB-</option>
                </select>
              </div>
              <div><label class="${labelClass}">Alergias</label><input id="allergies" placeholder="Ej: Man\u00ed, Polvo" class="${inputClass}"></div>
            </div>
            <div>
              <label class="${labelClass}">Autorizados para recoger</label>
              <textarea id="authorized" rows="2" placeholder="Ej: Abuela Carmen, T\u00edo Juan" class="${inputClass} resize-none mb-3"></textarea>
            </div>
            <div>
              <label class="${labelClass}">Teléfono del contacto autorizado</label>
              <input id="authorizedPhone" placeholder="Ej: 829-000-0000" class="${inputClass}">
            </div>
          </div>

          <!-- 5. TUTOR PRINCIPAL -->
          <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
            <h4 class="text-sm font-black text-slate-800 flex items-center gap-2">
              <div class="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center"><i data-lucide="user" class="w-4 h-4"></i></div>
              TUTOR PRINCIPAL
            </h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label class="${labelClass}">Nombre</label><input id="p1Name" placeholder="Nombre completo" class="${inputClass}"></div>
              <div><label class="${labelClass}">Tel\u00e9fono</label><input id="p1Phone" placeholder="Tel\u00e9fono" class="${inputClass}"></div>
              <div><label class="${labelClass}">Profesi\u00f3n</label><input id="p1Profession" placeholder="Ej: Ingeniero" class="${inputClass}"></div>
              <div class="md:col-span-2"><label class="${labelClass}">Direcci\u00f3n</label><input id="p1Address" placeholder="Direcci\u00f3n completa" class="${inputClass}"></div>
              <div class="md:col-span-2"><label class="${labelClass}">Contacto de Emergencia (Extra)</label><input id="p1Emergency" placeholder="Nombre y Tel\u00e9fono alternativo" class="${inputClass}"></div>
            </div>
          </div>

          <!-- 6. TUTOR SECUNDARIO -->
          <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
              <h4 class="text-sm font-black text-slate-800 flex items-center gap-2">
                <div class="w-8 h-8 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center"><i data-lucide="user-plus" class="w-4 h-4"></i></div>
                TUTOR SECUNDARIO
              </h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label class="${labelClass}">Nombre</label><input id="p2Name" placeholder="Nombre" class="${inputClass}"></div>
                <div><label class="${labelClass}">Tel\u00e9fono</label><input id="p2Phone" placeholder="Tel\u00e9fono" class="${inputClass}"></div>
                <div><label class="${labelClass}">Profesi\u00f3n</label><input id="p2Profession" placeholder="Ej: Abogada" class="${inputClass}"></div>
                <div><label class="${labelClass}">Direcci\u00f3n</label><input id="p2Address" placeholder="Direcci\u00f3n opcional" class="${inputClass}"></div>
              </div>
          </div>

          <!-- 7. INFORMACI\u00d3N DE PAGO -->
          <div class="bg-amber-50 p-6 rounded-[2rem] border-2 border-amber-100 space-y-4">
              <h4 class="text-sm font-black text-amber-800 flex items-center gap-2">
                <div class="w-8 h-8 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center"><i data-lucide="credit-card" class="w-4 h-4"></i></div>
                INFORMACI\u00d3N DE PAGO
              </h4>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label class="${labelClass}">Mensualidad</label>
                  <div class="relative">
                    <span class="absolute left-4 top-1/2 -translate-y-1/2 text-amber-600 font-black text-sm">$</span>
                    <input id="monthlyFee" placeholder="0.00" type="number" step="0.01" class="${inputClass} pl-8 bg-white">
                  </div>
                </div>
                <div>
                  <label class="${labelClass}">D\u00eda Prolongado</label>
                  <div class="relative">
                    <span class="absolute left-4 top-1/2 -translate-y-1/2 text-amber-600 font-black text-sm">$</span>
                    <input id="prolongadoFee" placeholder="0.00" type="number" step="0.01" class="${inputClass} pl-8 bg-white">
                  </div>
                </div>
                <div><label class="${labelClass}">D\u00eda Vencimiento</label><input id="dueDay" placeholder="5" type="number" min="1" max="31" class="${inputClass} bg-white"></div>
              </div>
          </div>

          <!-- 8. C\u00d3DIGO QR DE ASISTENCIA -->
          <div class="bg-gradient-to-br from-orange-50 to-amber-50 p-6 rounded-[2rem] border-2 border-orange-100 space-y-4">
            <h4 class="text-sm font-black text-orange-800 flex items-center gap-2">
              <div class="w-8 h-8 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center"><i data-lucide="qr-code" class="w-4 h-4"></i></div>
              C\u00d3DIGO QR DE ASISTENCIA
            </h4>
            <p class="text-xs text-orange-600 font-medium">El QR se genera autom\u00e1ticamente con la matr\u00edcula. El padre puede escanearlo para registrar entrada/salida.</p>
            <div id="qr-section" class="flex flex-col items-center gap-4 bg-white p-6 rounded-3xl border border-orange-100 shadow-sm">
              <div id="qr-container" class="bg-white p-3 rounded-2xl border-2 border-slate-100 shadow-sm min-h-[160px] flex items-center justify-center">
                <p class="text-xs text-slate-400 font-bold text-center">Genera o ingresa una matr\u00edcula<br>para ver el QR</p>
              </div>
              <div class="text-center w-full">
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Matr\u00edcula vinculada</p>
                <p id="qr-matricula-label" class="text-lg font-black text-slate-700">--</p>
              </div>
              <div class="flex gap-2 w-full">
                <button type="button" id="btn-generate-qr" onclick="window.generateStudentQR()"
                  class="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2">
                  <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Generar QR
                </button>
                <button type="button" id="btn-print-qr" onclick="window.printStudentQR()"
                  class="flex-1 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2">
                  <i data-lucide="printer" class="w-3.5 h-3.5"></i> Imprimir
                </button>
              </div>
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
      if (el) {
        el.value = 'KK-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random() * 9000) + 1000);
        // Auto-generar QR al generar matrícula
        window.generateStudentQR();
      }
    };

    // Cargar librería QR si no está disponible
    const _loadQRLib = () => new Promise((resolve) => {
      if (window.QRCode) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'js/shared/qrcode.min.js';
      s.onload = resolve;
      document.head.appendChild(s);
    });

    // Generar QR del estudiante
    window.generateStudentQR = async () => {
      const matricula = document.getElementById('stMatricula')?.value?.trim();
      const container = document.getElementById('qr-container');
      const label = document.getElementById('qr-matricula-label');
      if (!container) return;

      if (!matricula) {
        Helpers.toast('Genera o ingresa una matrícula primero', 'warning');
        return;
      }

      await _loadQRLib();
      container.innerHTML = '';
      label && (label.textContent = matricula);

      // QR just contains the matricula (super short, no overflow!)
      const qrData = matricula;

      try {
        new window.QRCode(container, {
          text: qrData,
          width: 160,
          height: 160,
          colorDark: '#1e293b',
          colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel.L // Low ECC allows more capacity
        });
      } catch (error) {
        console.error('Error generando QR:', error);
        container.innerHTML = '<p class="text-xs text-red-500 font-bold text-center">Error al generar QR</p>';
        Helpers.toast('Error al generar QR: texto demasiado largo', 'error');
      }
    };

    // Imprimir QR
    window.printStudentQR = () => {
      const matricula = document.getElementById('stMatricula')?.value?.trim();
      const name = document.getElementById('stName')?.value?.trim();
      const container = document.getElementById('qr-container');
      if (!container || !matricula) { Helpers.toast('Genera el QR primero', 'warning'); return; }

      const qrImg = container.querySelector('img')?.src || container.querySelector('canvas')?.toDataURL();
      if (!qrImg) { Helpers.toast('Genera el QR primero', 'warning'); return; }

      const win = window.open('', '_blank');
      win.document.write(Helpers.getQRPrintTemplate(qrImg, name, matricula));
      win.document.close();
    };

    // Auto-generar QR si ya hay matrícula (modo edición)
    const existingMatricula = document.getElementById('stMatricula')?.value?.trim();
    if (existingMatricula) setTimeout(() => window.generateStudentQR(), 300);

    // Escuchar cambios en matrícula para actualizar QR en tiempo real
    document.getElementById('stMatricula')?.addEventListener('input', () => {
      clearTimeout(window._qrDebounce);
      window._qrDebounce = setTimeout(() => window.generateStudentQR(), 600);
    });

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
      if (select && rooms?.length) {
        rooms.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = (r.name || 'Sin nombre').trim();
          select.appendChild(opt);
        });
      }
    } catch (_) { /* silencioso */ }

    // Cargar lista de estudiantes activos para el selector de hermanos
    try {
      const { data: allStudents } = await supabase
        .from('students')
        .select('id, name, p1_name, parent_id, classrooms:classroom_id(name)')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name')
        .limit(200);

      const sibSel = document.getElementById('stSiblingId');
      if (sibSel && allStudents?.length) {
        // Excluir el estudiante actual si estamos editando
        const currentId = id ? parseInt(id, 10) : null;
        allStudents.filter(s => s.id !== currentId).forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          const aula = s.classrooms?.name || 'sin aula';
          const padre = s.p1_name ? ' · ' + s.p1_name : '';
          opt.textContent = s.name + ' (' + aula + padre + ')';
          opt.dataset.parentId = s.parent_id || '';
          sibSel.appendChild(opt);
        });

        // Evento: al seleccionar un hermano, mostrar info del padre compartido
        sibSel.addEventListener('change', function() {
          const infoEl = document.getElementById('stSiblingInfo');
          const selectedOpt = sibSel.options[sibSel.selectedIndex];
          if (sibSel.value && selectedOpt) {
            const parentId = selectedOpt.dataset.parentId;
            if (infoEl) {
              infoEl.textContent = parentId
                ? '✅ Compartirá el acceso del padre: ' + selectedOpt.text.split('·').slice(-1)[0].trim()
                : '⚠️ Este estudiante no tiene padre asignado aún.';
              infoEl.classList.remove('hidden');
            }
            // Pre-llenar datos del padre si hay parent_id
            if (parentId) {
              supabase.from('profiles').select('email, name, phone').eq('id', parentId).maybeSingle().then(({ data: prof }) => {
                if (prof) {
                  const setIfEmpty = (elId, val) => { const el = document.getElementById(elId); if (el && !el.value) el.value = val || ''; };
                  setIfEmpty('stEmailUser', prof.email);
                  setIfEmpty('p1Name', prof.name);
                  setIfEmpty('p1Phone', prof.phone);
                }
              });
            }
          } else {
            if (infoEl) infoEl.classList.add('hidden');
          }
        });
      }
    } catch (_) { /* silencioso */ }

    if (id) {
      // Fetch completo desde DB - convertir id a número para evitar error 400 (bigint vs string)
      try {
        const numericId = parseInt(id, 10);
        if (isNaN(numericId)) throw new Error('ID inválido');

        const { data: student, error } = await supabase
          .from('students')
          .select('*, parent:parent_id(email)')
          .eq('id', numericId)
          .single();

        if (error) throw error;
        if (student) {
          const setVal = (eid, val) => {
            const el = document.getElementById(eid);
            if (el) el.value = (val !== null && val !== undefined) ? val : '';
          };
          setVal('stId',         student.id);
          setVal('stMatricula',  student.matricula);
          setVal('stName',       student.name);
          setVal('stClassroom',  student.classroom_id);
          setVal('stJoinedDate', student.start_date ? student.start_date.split('T')[0] : '');
          setVal('stAge',        student.age);
          setVal('stAgeType',    student.age_type || 'años');
          setVal('stHorario',    student.schedule);
          setVal('p1Name',       student.p1_name);
          setVal('p1Phone',      student.p1_phone);
          setVal('stEmailNotif', student.p1_email);
          setVal('stEmailUser',  student.parent?.email || '');
          setVal('p1Profession', student.p1_job);
          setVal('p1Address',    student.p1_address);
          setVal('p1Emergency',  student.p1_emergency_contact);
          setVal('p2Name',       student.p2_name);
          setVal('p2Phone',      student.p2_phone);
          setVal('p2Profession', student.p2_job);
          setVal('p2Address',    student.p2_address);
          setVal('allergies',    student.allergies);
          setVal('bloodType',    student.blood_type);
          setVal('authorized',   student.authorized_pickup);
          setVal('authorizedPhone', student.authorized_pickup_phone);
          setVal('monthlyFee',   student.monthly_fee);
          setVal('prolongadoFee', student.prolongado_fee);
          setVal('dueDay',       student.due_day);

          const checkActive = document.getElementById('active');
          if (checkActive) checkActive.checked = student.is_active !== false;

          // Avatar preview
          if (student.avatar_url) {
            const preview = document.getElementById('stAvatarPreview');
            if (preview) preview.innerHTML = `<img src="${student.avatar_url}" class="w-full h-full object-cover">`;
          }

          // Generar QR si tiene matrícula
          if (student.matricula) {
            setTimeout(() => window.generateStudentQR(), 500);
          }

          // ── HERMANOS ──────────────────────────────────────────────
          // Si el estudiante tiene parent_id, buscar hermanos del mismo padre
          if (student.parent_id) {
            supabase
              .from('students')
              .select('id, name, avatar_url, classrooms:classroom_id(name)')
              .eq('parent_id', student.parent_id)
              .eq('is_active', true)
              .is('deleted_at', null)
              .neq('id', numericId)
              .order('name')
              .then(({ data: siblings }) => {
                if (!siblings?.length) return;
                // Inyectar sección hermanos en el modal
                const form = document.getElementById('studentForm');
                if (!form) return;
                const siblingsHTML = `
                  <div class="bg-indigo-50 p-5 rounded-[2rem] border-2 border-indigo-100">
                    <h4 class="text-sm font-black text-indigo-800 flex items-center gap-2 mb-4">
                      <span class="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                        <i data-lucide="users" class="w-4 h-4"></i>
                      </span>
                      HERMANOS EN LA ESTANCIA (${siblings.length})
                    </h4>
                    <div class="flex flex-wrap gap-3">
                      ${siblings.map(sib => `
                        <button type="button"
                          onclick="App.students.openModal('${sib.id}')"
                          class="flex items-center gap-2.5 px-4 py-2.5 bg-white rounded-2xl border border-indigo-100 hover:border-indigo-400 hover:bg-indigo-50 transition-all shadow-sm active:scale-95 group">
                          <div class="w-8 h-8 rounded-full bg-indigo-100 overflow-hidden flex items-center justify-center shrink-0">
                            ${sib.avatar_url
                              ? `<img src="${sib.avatar_url}" class="w-full h-full object-cover">`
                              : `<span class="text-xs font-black text-indigo-600">${(sib.name || '?').charAt(0)}</span>`}
                          </div>
                          <div class="text-left">
                            <div class="text-xs font-black text-slate-700 group-hover:text-indigo-700">${Helpers.escapeHTML(sib.name)}</div>
                            <div class="text-[9px] font-bold text-slate-400 uppercase">${sib.classrooms?.name || 'Sin aula'}</div>
                          </div>
                          <i data-lucide="arrow-right" class="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-500"></i>
                        </button>`).join('')}
                    </div>
                  </div>`;
                // Insertar antes del modal-footer
                form.insertAdjacentHTML('beforeend', siblingsHTML);
                if (window.lucide) lucide.createIcons();
              })
              .catch(() => {}); // silencioso si falla
          }
          // ─────────────────────────────────────────────────────────
        }
      } catch (e) {
        Helpers.toast('Error al cargar datos del estudiante', 'error');
      }
    }
    if (window.lucide) lucide.createIcons();
  }
};
