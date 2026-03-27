import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { UI } from './ui.module.js';
import { AppState } from './state.js';
import { supabase, createClient, SUPABASE_URL, SUPABASE_ANON_KEY } from '../shared/supabase.js';

export const TeachersModule = {
  async init(renderTargetId = 'teachersTableBody') {
    const container = document.getElementById(renderTargetId);
    if (!container) return;

    const loadingHtml = '<tr><td colspan="5" class="text-center py-8">Cargando...</td></tr>';
    container.innerHTML = loadingHtml;

    try {
      const { data: teachers, error } = await DirectorApi.getTeachers();
      if (error) throw new Error(error);

      const normalized = teachers || [];
      const total = normalized.length;
      const active = normalized.filter(t => t.is_active !== false).length;
      const assistants = normalized.filter(t => t.role === 'asistente').length;
      const inClass = normalized.filter(t => t.classrooms).length;

      const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
      setTxt('kpiStaffTotal', total);
      setTxt('kpiStaffActive', active);
      setTxt('kpiStaffInClass', inClass); 
      setTxt('kpiStaffAssistants', assistants);

      AppState.set('teachers', normalized);
      this.render(normalized, renderTargetId);

      // BUSCADOR EN TIEMPO REAL
      const searchInput = document.getElementById('searchTeacher');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          const term = e.target.value.toLowerCase();
          const allStaff = AppState.get('teachers') || [];
          const filtered = allStaff.filter(t => 
            t.name.toLowerCase().includes(term) || 
            t.email.toLowerCase().includes(term) ||
            (t.classrooms?.name || '').toLowerCase().includes(term)
          );
          this.render(filtered);
        });
      }

      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('Error initTeachersSection:', e);
      container.innerHTML = '<div class="col-span-3 text-center p-8 text-red-500">Error al cargar.</div>';
    }
  },

  render(staff, renderTargetId = 'teachersTableBody') {
    const container = document.getElementById(renderTargetId);
    if (!container) return;

    if (!staff.length) {
      container.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-slate-500">No hay personal que coincida.</td></tr>';
      return;
    }
    container.innerHTML = staff.map(t => `
        <tr>
          <td>${Helpers.escapeHTML(t.name)}</td>
          <td>${t.email}</td>
          <td>${t.classrooms?.name || 'Sin Aula'}</td>
          <td class="capitalize">${t.role}</td>
          <td class="text-right">
            <button onclick="App.teachers.openModal('${t.id}')" class="btn-action btn-edit">Gestionar</button>
          </td>
        </tr>`).join('');
    if (window.lucide) lucide.createIcons();
  },

  async save() {
    const id = document.getElementById('tId')?.value;
    const classroom_id = document.getElementById('tClassroom')?.value || null;
    const payload = {
      name: (document.getElementById('tName').value || '').trim(),
      phone: (document.getElementById('tPhone').value || '').trim(),
      email: (document.getElementById('tEmail').value || '').trim(),
      role: document.getElementById('tRole').value,
      classroom_id, // será separado en updateTeacher
      is_active: document.getElementById('tActive').checked
    };
    
    const password = document.getElementById('tPassword')?.value;

    if (!payload.name || payload.name.length < 3) return Helpers.toast('Nombre inválido (min 3 caracteres)', 'warning');
    if (!payload.email) return Helpers.toast('Correo requerido', 'warning');
    
    UI.setLoading(true);
    try {
      let res;
      if (id) {
        res = await DirectorApi.updateTeacher(id, payload);
      } else {
        if (!password || password.length < 6) throw new Error('Contraseña requerida (mínimo 6 caracteres)');
        
        const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
           auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        
        const { data: authData, error: authError } = await tempClient.auth.signUp({
          email: payload.email,
          password: password,
          options: { data: { name: payload.name, role: payload.role, phone: payload.phone } }
        });
        
        if (authError) throw authError;
        if (authData.user) {
           // Para nuevo usuario, actualizar perfil y asignar aula
           await DirectorApi.updateTeacher(authData.user.id, payload);
           res = { data: authData.user, error: null };
        }
      }
      
      const { error } = res || {};
      if (error) throw new Error(error);
      
      Helpers.toast(id ? 'Maestra actualizada' : 'Maestra creada', 'success');
      UI.closeModal();
      this.init();
    } catch (e) {
      console.error('Error saveTeacher:', e);
      Helpers.toast('Error al guardar: ' + (e.message || e), 'error');
    } finally {
      UI.setLoading(false);
    }
  },

  async openModal(id = null) {
    const inputClass = "w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium";
    const labelClass = "block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1";

    const modalHTML = `
      <div class="modal-header bg-gradient-to-r from-pink-500 to-rose-500 text-white p-6 rounded-t-3xl flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl shadow-inner">👩‍🏫</div>
          <div>
            <h3 class="text-xl font-black">${id ? 'Editar Maestra' : 'Gestión de Personal'}</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Maestras y Asistentes</p>
          </div>
        </div>
        <button onclick="App.ui.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors">
          <i data-lucide="x" class="w-6 h-6"></i>
        </button>
      </div>
      <div class="modal-body p-8 bg-slate-50/30" id="teacherForm">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <input type="hidden" id="tId" value="${id || ''}" />
          <div class="col-span-2">
            <label class="${labelClass}">Nombre completo</label>
            <input id="tName" placeholder="Ej: Maria Lopez" class="${inputClass}">
          </div>
          
          <div>
            <label class="${labelClass}">Correo electrónico</label>
            <input id="tEmail" placeholder="usuario@karpus.com" type="email" class="${inputClass}">
          </div>

          <div>
            <label class="${labelClass}">Teléfono</label>
            <input id="tPhone" placeholder="Opcional" type="tel" class="${inputClass}">
          </div>

          <div class="col-span-2" id="passwordFieldContainer" style="${id ? 'display:none' : ''}">
            <label class="${labelClass}">Contraseña <span class="text-rose-400 normal-case ml-1 font-normal">(Mínimo 6 caracteres)</span></label>
            <div class="relative">
              <i data-lucide="lock" class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"></i>
              <input id="tPassword" placeholder="Crear contraseña de acceso" type="text" class="${inputClass} pl-10">
            </div>
            <p class="text-[10px] text-slate-400 mt-1 ml-1">* Solo requerida para nuevos usuarios</p>
          </div>

          <div>
            <label class="${labelClass}">Rol</label>
            <select id="tRole" class="${inputClass}">
              <option value="maestra">Maestra</option>
              <option value="asistente">Asistente</option>
            </select>
          </div>
          <div>
            <label class="${labelClass}">Aula asignada</label>
            <select id="tClassroom" class="${inputClass}"><option value="">Seleccionar Aula</option></select>
          </div>
          <div class="col-span-2">
            <label class="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-xl cursor-pointer">
              <input type="checkbox" id="tActive" checked class="w-5 h-5 rounded text-rose-500 focus:ring-rose-200">
              <span class="text-sm font-bold text-slate-700">Cuenta Activa</span>
            </label>
          </div>
        </div>
      </div>
      <div class="modal-footer bg-white p-6 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">
        <button onclick="App.ui.closeModal()" class="px-8 py-3 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
        <button onclick="App.teachers.save()" class="px-10 py-3 bg-gradient-to-r from-rose-500 to-pink-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-rose-200 hover:shadow-rose-300 hover:-translate-y-0.5 transition-all active:scale-95">Guardar Personal</button>
      </div>`;

    window.openGlobalModal(modalHTML);

    try {
      const { data: rooms } = await DirectorApi.getClassrooms();
      const select = document.getElementById('tClassroom');
      if (select && rooms?.length) {
        select.innerHTML += rooms.map(r => `<option value="${r.id}">${(r.name || 'Sin nombre').trim()}</option>`).join('');
      }
    } catch (error) { console.error('Error cargando aulas:', error); }

    if (id) {
      const teachers = AppState.get('teachers') || [];
      const teacher = teachers.find(t => t.id == id);
      if (teacher) {
        const setVal = (eid, val) => { const e = document.getElementById(eid); if(e) e.value = val || ''; };
        setVal('tId', teacher.id);
        setVal('tName', teacher.name);
        setVal('tPhone', teacher.phone);
        setVal('tEmail', teacher.email);
        setVal('tRole', teacher.role);
        // classroom_id viene normalizado desde el join classrooms!classrooms_teacher_id_fkey
        const classId = teacher.classroom_id || teacher.classrooms?.id;
        setVal('tClassroom', classId);
        const checkActive = document.getElementById('tActive');
        if(checkActive) checkActive.checked = teacher.is_active !== false;
      }
    }
    if (window.lucide) lucide.createIcons();
  }
};
