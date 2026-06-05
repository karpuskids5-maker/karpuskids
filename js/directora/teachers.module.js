import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { UI } from './ui.module.js';
import { AppState } from './state.js';
import { supabase, createClient, SUPABASE_URL, SUPABASE_ANON_KEY } from '../shared/supabase.js';
import { auditLog } from '../shared/db-utils.js';

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
      container.innerHTML = '<tr><td colspan="5" class="text-center py-8">' + Helpers.errorState('Error al cargar personal', 'App.teachers.init()') + '</td></tr>';
      if (window.lucide) lucide.createIcons();
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
        <tr class="hover:bg-slate-50 transition-colors cursor-pointer" ondblclick="App.teachers.openModal('${t.id}')">
          <td class="p-4 font-bold text-slate-700">${Helpers.escapeHTML(t.name)}</td>
          <td class="p-4 text-slate-500">${t.email}</td>
          <td class="p-4"><span class="px-3 py-1 bg-slate-100 rounded-full text-[10px] font-black uppercase text-slate-500">${t.classrooms?.name || 'Sin Aula'}</span></td>
          <td class="p-4"><span class="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black uppercase tracking-wider">${t.role}</span></td>
          <td class="p-4 text-right">
            <div class="flex justify-end gap-2">
              <button onclick="App.teachers.openModal('${t.id}')" class="w-9 h-9 flex items-center justify-center bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white rounded-xl transition-all" title="Editar">
                <i data-lucide="settings" class="w-4 h-4"></i>
              </button>
              <button onclick="App.teachers.delete('${t.id}')" class="w-9 h-9 flex items-center justify-center bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-xl transition-all" title="Eliminar">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </td>
        </tr>`).join('');
    if (window.lucide) lucide.createIcons();
  },

  async delete(id) {
    const teacher = (AppState.get('teachers') || []).find(t => t.id === id);
    const name = teacher?.name || 'este usuario';
    const role = teacher?.role === 'asistente' ? 'asistente' : 'maestra';
    
    const ok = window.confirm(`¿Eliminar a "${name}" (${role})?\n\nEsta acción no se puede deshacer. El usuario perderá acceso al sistema inmediatamente.`);
    if (!ok) return;

    UI.setLoading(true);
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', id);
      if (error) throw error;
      
      await auditLog('staff.delete', { staff_id: id, name, role });
      Helpers.toast(`${role.charAt(0).toUpperCase() + role.slice(1)} eliminada correctamente`, 'success');
      this.init();
    } catch (e) {
      console.error('[Teachers] Error deleting:', e);
      Helpers.toast('No se pudo eliminar: ' + (e.message || 'Error de base de datos'), 'error');
    } finally {
      UI.setLoading(false);
    }
  },

  async save() {
    const id = document.getElementById('tId')?.value;
    const classroom_id = document.getElementById('tClassroom')?.value || null;
    const payload = {
      name:      (document.getElementById('tName').value || '').trim(),
      phone:     (document.getElementById('tPhone').value || '').trim(),
      role:      document.getElementById('tRole').value,
      classroom_id,
      is_active: document.getElementById('tActive').checked
    };
    // email solo para crear, no para actualizar (Supabase no permite update de email via profiles)
    const emailVal = (document.getElementById('tEmail').value || '').trim();
    if (!id) payload.email = emailVal; // solo en creación

    const matricula = (document.getElementById('tMatricula').value || '').trim();
    if (matricula) payload.access_code = matricula;
    
    const password = document.getElementById('tPassword')?.value;

    if (!payload.name || payload.name.length < 3) return Helpers.toast('Nombre inv�lido (min 3 caracteres)', 'warning');
    if (!id && !emailVal) return Helpers.toast('Correo requerido', 'warning');
    
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
          email: emailVal,
          password: password,
          options: { data: { name: payload.name, role: payload.role, phone: payload.phone } }
        });
        
        if (authError) throw authError;
        if (authData.user) {
           await DirectorApi.updateTeacher(authData.user.id, payload);
           res = { data: authData.user, error: null };
        }
      }
      
      const { error } = res || {};
      if (error) throw new Error(error?.message || error?.details || JSON.stringify(error));
      
      Helpers.toast(id ? 'Maestra actualizada' : 'Maestra creada', 'success');
      UI.closeModal();
      this.init();
    } catch (e) {
      Helpers.toast('Error al guardar: ' + (e.message || e), 'error');
    } finally {
      UI.setLoading(false);
    }
  },

  async openModal(id = null) {
    const inputClass = "w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium";
    const labelClass = "block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1";

    const modalHTML = `
      <div class="modal-header bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6 rounded-t-3xl flex items-center">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shadow-inner"><i data-lucide="users" class="w-6 h-6 text-white"></i></div>
          <div>
            <h3 class="text-xl font-black">${id ? 'Editar Maestra' : 'Gestión de Personal'}</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Maestras y Asistentes</p>
          </div>
        </div>
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

          <div class="col-span-2 bg-gradient-to-br from-orange-50 to-amber-50 p-6 rounded-[2rem] border-2 border-orange-100 space-y-4">
            <h4 class="text-sm font-black text-orange-800 flex items-center gap-2">
              <div class="w-8 h-8 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center"><i data-lucide="qr-code" class="w-4 h-4"></i></div>
              CÓDIGO QR DE ACCESO (PERSONAL)
            </h4>
            <p class="text-xs text-orange-600 font-medium leading-relaxed">Este código permite a la maestra/asistente registrar su propia asistencia en el terminal de ponche.</p>
            
            <div class="bg-white p-6 rounded-3xl border border-orange-100 shadow-sm flex flex-col items-center gap-4">
              <div class="flex gap-2 w-full">
                <div class="relative flex-1">
                  <i data-lucide="hash" class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"></i>
                  <input id="tMatricula" placeholder="Generar ID Empleado..." class="${inputClass} pl-10 bg-white border-orange-50 focus:border-orange-300">
                </div>
                <button type="button" onclick="window.genStaffCode()" class="px-6 py-2 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase hover:bg-orange-700 shadow-md transition-all active:scale-95">Generar</button>
              </div>

              <div id="staff-qr-container" class="bg-white p-3 rounded-2xl border-2 border-slate-100 shadow-sm min-h-[160px] flex items-center justify-center w-full max-w-[180px]">
                <p class="text-[10px] text-slate-400 font-black uppercase text-center leading-tight">Ingresa un ID<br>para ver el QR</p>
              </div>

              <div class="flex gap-2 w-full">
                <button type="button" id="btn-print-staff-qr" onclick="window.printStaffQR()"
                  class="flex-1 py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2">
                  <i data-lucide="printer" class="w-3.5 h-3.5"></i> Imprimir Carnet
                </button>
              </div>
            </div>
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
              <input type="checkbox" id="tActive" checked class="w-5 h-5 rounded text-purple-600 focus:ring-purple-200">
              <span class="text-sm font-bold text-slate-700">Cuenta Activa</span>
            </label>
          </div>
        </div>
      </div>
      <div class="modal-footer bg-white p-6 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">
        <button onclick="App.ui.closeModal()" class="px-8 py-3 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
        <button onclick="App.teachers.save()" class="px-10 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-purple-200 hover:shadow-purple-300 hover:-translate-y-0.5 transition-all active:scale-95">Guardar Personal</button>
      </div>`;

    window.openGlobalModal(modalHTML);

    // Función para generar código de acceso del personal
    window.genStaffCode = async () => {
      const prefix = 'TEA';
      const code = prefix + '-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random() * 9000) + 1000);
      const input = document.getElementById('tMatricula');
      if (input) {
        input.value = code;
        window.renderStaffQR(code);
        // If editing an existing teacher, save immediately
        const teacherId = document.getElementById('tId')?.value;
        if (teacherId) {
          const { error } = await supabase.from('profiles').update({ access_code: code }).eq('id', teacherId);
          if (!error) {
            Helpers.toast('Código de acceso guardado', 'success');
            // Update cache
            const teachers = AppState.get('teachers') || [];
            const idx = teachers.findIndex(t => t.id === teacherId);
            if (idx >= 0) teachers[idx].access_code = code;
          }
        }
      }
    };

    window.renderStaffQR = async (code) => {
      const container = document.getElementById('staff-qr-container');
      if (!container) return;
      
      if (!code) {
        container.innerHTML = '<p class="text-[10px] text-slate-400 font-black uppercase text-center leading-tight">Ingresa un ID<br>para ver el QR</p>';
        return;
      }

      // Cargar librer�a QR si no est�
      if (!window.QRCode) {
        await new Promise(resolve => {
          const s = document.createElement('script');
          s.src = 'js/shared/qrcode.min.js';
          s.onload = resolve;
          document.head.appendChild(s);
        });
      }
      container.innerHTML = '';
      new window.QRCode(container, {
        text: JSON.stringify({ matricula: code, type: 'karpus-staff', v: 1 }),
        width: 140, height: 140,
        colorDark: '#1e293b', colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.H
      });
    };

    window.printStaffQR = () => {
      const matricula = document.getElementById('tMatricula')?.value?.trim();
      const name = document.getElementById('tName')?.value?.trim();
      const role = document.getElementById('tRole')?.value?.trim();
      const container = document.getElementById('staff-qr-container');
      if (!container || !matricula) { Helpers.toast('Genera el QR primero', 'warning'); return; }

      const qrImg = container.querySelector('img')?.src || container.querySelector('canvas')?.toDataURL();
      if (!qrImg) { Helpers.toast('Genera el QR primero', 'warning'); return; }

      const win = window.open('', '_blank');
      win.document.write(`<!DOCTYPE html><html><head><title>Carnet Personal - ${name}</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fff; }
          .card { border: 4px solid #4f46e5; border-radius: 24px; padding: 30px; text-align: center; max-width: 300px; position: relative; }
          .header { background: #4f46e5; color: white; margin: -30px -30px 20px -30px; padding: 15px; border-radius: 20px 20px 0 0; font-weight: 900; text-transform: uppercase; font-size: 14px; }
          img { width: 180px; height: 180px; border: 4px solid #f8fafc; border-radius: 12px; }
          .name { font-size: 18px; font-weight: 900; color: #1e293b; margin-top: 15px; }
          .role { font-size: 12px; color: #4f46e5; font-weight: 800; text-transform: uppercase; margin-top: 2px; }
          .id { font-size: 11px; color: #64748b; font-weight: 700; margin-top: 10px; border-top: 1px solid #eee; pt: 10px; }
        </style>
      </head><body>
        <div class="card">
          <div class="header">STAFF � KARPUS KIDS</div>
          <img src="${qrImg}" alt="QR">
          <div class="name">${name || 'Personal'}</div>
          <div class="role">${role || 'Maestra'}</div>
          <div class="id">ID: ${matricula}</div>
        </div>
        <script>window.onload=()=>{window.print();}<\/script>
      </body></html>`);
      win.document.close();
    };

    // Escuchar cambios en el input de matrícula para actualizar QR
    document.getElementById('tMatricula')?.addEventListener('input', (e) => {
      clearTimeout(window._staffQrDebounce);
      window._staffQrDebounce = setTimeout(() => window.renderStaffQR(e.target.value.trim()), 600);
    });

    try {
      const { data: rooms } = await DirectorApi.getClassrooms();
      const select = document.getElementById('tClassroom');
      if (select && rooms?.length) {
        select.innerHTML += rooms.map(r => `<option value="${r.id}">${(r.name || 'Sin nombre').trim()}</option>`).join('');
      }
    } catch (_) { /* silencioso */ }

    if (id) {
      const teachers = AppState.get('teachers') || [];
      let teacher = teachers.find(t => t.id == id);
      // Fetch from DB to get access_code and notes
      if (!teacher || !teacher.access_code) {
        const { data } = await supabase
          .from('profiles')
          .select('id, name, email, phone, role, is_active, access_code')
          .eq('id', id)
          .maybeSingle();
        if (data) teacher = { ...teacher, ...data };
      }
      if (teacher) {
        const setVal = (eid, val) => { const e = document.getElementById(eid); if(e) e.value = val || ''; };
        setVal('tId', teacher.id);
        setVal('tName', teacher.name);
        setVal('tPhone', teacher.phone);
        setVal('tEmail', teacher.email);
        setVal('tRole', teacher.role);
        // Use access_code first, fallback to notes for legacy
        const code = teacher.access_code || (teacher.notes?.startsWith?.('TEA-') || teacher.notes?.startsWith?.('DIR-') || teacher.notes?.startsWith?.('ASI-') ? teacher.notes : null);
        setVal('tMatricula', code || '');
        const classId = teacher.classroom_id || teacher.classrooms?.id;
        setVal('tClassroom', classId);
        const checkActive = document.getElementById('tActive');
        if(checkActive) checkActive.checked = teacher.is_active !== false;
        // Auto-render QR if has code
        if (code) setTimeout(() => window.renderStaffQR(code), 400);
      }
    }
    if (window.lucide) lucide.createIcons();
  },

  generateLazyQR(id, code) {
    const container = document.getElementById(`qr-placeholder-${id}`);
    if (!container) return;

    container.innerHTML = '<div class="animate-spin w-6 h-6 border-2 border-indigo-500 rounded-full border-t-transparent"></div>';
    
    // Generación diferida para ahorrar recursos
    setTimeout(() => {
      const qrData = JSON.stringify({ id, code, role: 'teacher' });
      container.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}" 
                                  class="w-full h-full border-4 border-white shadow-lg rounded-xl animate-scaleIn" alt="QR Code">`;
      container.classList.remove('border-dashed', 'bg-slate-50', 'cursor-pointer');
      container.onclick = null;
    }, 300);
  }
};
