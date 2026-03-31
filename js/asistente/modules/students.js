import { supabase } from '../../shared/supabase.js';
import { Helpers } from '../../shared/helpers.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../shared/supabase.js';

const IC = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-teal-100 focus:border-teal-400 bg-slate-50/50 transition-all text-sm font-medium';
const LC = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';

export const StudentsModule = {
  async init() {
    await this.loadStudents();
    document.getElementById('btnAddStudent')?.addEventListener('click', () => this.openModal());
  },

  async loadStudents() {
    const tbody = document.getElementById('studentsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8"><div class="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600 mx-auto"></div></td></tr>';

    try {
      const { data: students, error } = await supabase
        .from('students')
        .select('id, name, is_active, p1_name, p1_phone, classroom_id, classrooms:classroom_id(name)')
        .order('name');
      if (error) throw error;

      if (!students?.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-400">No hay estudiantes registrados.</td></tr>';
        return;
      }

      tbody.innerHTML = students.map(s => `
        <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors cursor-pointer">
          <td class="px-6 py-3 font-bold text-slate-800 text-sm" onclick="window.App.students.openModal('${s.id}')">${Helpers.escapeHTML(s.name)}</td>
          <td class="px-6 py-3 text-slate-500 text-sm" onclick="window.App.students.openModal('${s.id}')">${s.classrooms?.name || 'Sin Aula'}</td>
          <td class="px-6 py-3 text-slate-500 text-sm" onclick="window.App.students.openModal('${s.id}')">${Helpers.escapeHTML(s.p1_name || 'N/A')}</td>
          <td class="px-6 py-3">
            <div class="flex items-center gap-1.5">
              <span class="px-2 py-1 rounded-full text-[10px] font-bold ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">${s.is_active ? 'Activo' : 'Inactivo'}</span>
              <button onclick="window.App.students.deleteStudent('${s.id}','${Helpers.escapeHTML(s.name)}')" class="p-1.5 bg-rose-50 text-rose-400 rounded-lg hover:bg-rose-100 hover:text-rose-600 transition-all" title="Eliminar">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </td>
        </tr>`).join('');

      const search = document.getElementById('searchStudentInput');
      if (search && !search.hasAttribute('data-bound')) {
        search.setAttribute('data-bound', 'true');
        search.addEventListener('input', (e) => {
          const q = e.target.value.toLowerCase();
          tbody.querySelectorAll('tr').forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
          });
        });
      }
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      console.error('[loadStudents]', e);
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-rose-500 font-bold text-sm">Error al cargar estudiantes.</td></tr>';
    }
  },

  async openModal(studentId = null) {
    const html = `
      <div class="bg-gradient-to-r from-teal-600 to-emerald-600 text-white p-6 rounded-t-3xl flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">👶</div>
          <div>
            <h3 class="text-xl font-black">${studentId ? 'Editar Estudiante' : 'Crear Estudiante'}</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">${studentId ? 'Actualizar Registro' : 'Nuevo Registro'}</p>
          </div>
        </div>
        <button onclick="window._closeAsistenteModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20">✕</button>
      </div>

      <div class="p-6 space-y-5 overflow-y-auto" style="max-height:70vh">
        <input type="hidden" id="stId" value="${studentId || ''}">

        <!-- Foto y Matrícula -->
        <div class="flex flex-col sm:flex-row gap-5 items-center bg-white p-5 rounded-2xl border-2 border-slate-100">
          <div class="relative group cursor-pointer shrink-0">
            <div id="stAvatarPreview" class="w-20 h-20 rounded-2xl bg-slate-100 border-4 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 group-hover:border-teal-400 transition-all overflow-hidden">
              <span class="text-2xl">📷</span>
              <span class="text-[9px] font-black uppercase mt-1">Foto</span>
            </div>
            <input type="file" id="stAvatarFile" class="absolute inset-0 opacity-0 cursor-pointer" accept="image/*">
          </div>
          <div class="flex-1 w-full">
            <p class="text-[11px] font-black text-slate-500 uppercase tracking-wider mb-2">📷 FOTO Y MATRÍCULA</p>
            <div class="flex gap-2 mb-3">
              <input id="stMatricula" placeholder="Generar automática..." class="${IC} flex-1" readonly>
              <button onclick="window._genMatricula()" class="px-4 py-2 bg-teal-600 text-white rounded-xl font-black text-xs uppercase hover:bg-teal-700 transition-all">Generar</button>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="${LC}">Fecha inscripción</label><input type="date" id="stJoinedDate" class="${IC}"></div>
              <div class="flex items-end pb-1"><label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="stActive" checked class="w-4 h-4 rounded accent-teal-600"><span class="text-sm font-bold text-teal-700">Estado Activo</span></label></div>
            </div>
          </div>
        </div>

        <!-- Info del estudiante -->
        <div class="bg-white p-5 rounded-2xl border-2 border-slate-100 space-y-3">
          <p class="text-[11px] font-black text-slate-500 uppercase tracking-wider">👦 INFORMACIÓN DEL ESTUDIANTE</p>
          <div><label class="${LC}">Nombre completo</label><input id="stName" placeholder="Nombre completo" class="${IC}"></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${LC}">Aula</label>
              <select id="stClassroom" class="${IC}"><option value="">-- Seleccionar Aula --</option></select>
            </div>
            <div class="flex items-end pb-1"><label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="stActiveAlt" class="w-4 h-4 rounded accent-teal-600 hidden"></label></div>
          </div>
        </div>

        <!-- Acceso -->
        <div class="bg-white p-5 rounded-2xl border-2 border-slate-100 space-y-3">
          <p class="text-[11px] font-black text-slate-500 uppercase tracking-wider">🔐 ACCESO Y NOTIFICACIONES</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class="${LC}">Correo de Usuario (Login)</label><input id="stEmailUser" type="email" placeholder="usuario@karpus.com" class="${IC}"></div>
            <div><label class="${LC}">Correo de Notificaciones</label><input id="stEmailNotif" type="email" placeholder="avisos@ejemplo.com" class="${IC}"></div>
            <div><label class="${LC}">Contraseña (Min 6 caracteres)</label><input id="stPassword" type="text" placeholder="********" class="${IC}"></div>
          </div>
        </div>

        <!-- Salud -->
        <div class="bg-white p-5 rounded-2xl border-2 border-slate-100 space-y-3">
          <p class="text-[11px] font-black text-slate-500 uppercase tracking-wider">🩺 SALUD Y SEGURIDAD</p>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${LC}">Tipo Sangre</label>
              <select id="stBlood" class="${IC}">
                <option value="O+">O+</option><option value="O-">O-</option><option value="A+">A+</option><option value="A-">A-</option>
                <option value="B+">B+</option><option value="B-">B-</option><option value="AB+">AB+</option><option value="AB-">AB-</option>
              </select>
            </div>
            <div><label class="${LC}">Alergias</label><input id="stAllergies" placeholder="Ej: Maní, Polvo" class="${IC}"></div>
          </div>
          <div><label class="${LC}">Autorizados para recoger</label><textarea id="stPickup" rows="2" placeholder="Ej: Abuela Carmen, Tío Juan" class="${IC} resize-none"></textarea></div>
        </div>

        <!-- Tutor Principal -->
        <div class="bg-white p-5 rounded-2xl border-2 border-slate-100 space-y-3">
          <p class="text-[11px] font-black text-slate-500 uppercase tracking-wider">👨‍👩‍👦 TUTOR PRINCIPAL</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class="${LC}">Nombre</label><input id="p1Name" placeholder="Nombre completo" class="${IC}"></div>
            <div><label class="${LC}">Teléfono</label><input id="p1Phone" placeholder="Teléfono" class="${IC}"></div>
            <div><label class="${LC}">Profesión</label><input id="p1Profession" placeholder="Ej: Ingeniero" class="${IC}"></div>
            <div><label class="${LC}">Dirección</label><input id="p1Address" placeholder="Dirección completa" class="${IC}"></div>
            <div class="sm:col-span-2"><label class="${LC}">Contacto de Emergencia (Extra)</label><input id="p1Emergency" placeholder="Nombre y Teléfono alternativo" class="${IC}"></div>
          </div>
        </div>

        <!-- Tutor Secundario -->
        <div class="bg-white p-5 rounded-2xl border-2 border-slate-100 space-y-3">
          <p class="text-[11px] font-black text-slate-500 uppercase tracking-wider">👨‍👩‍👧 TUTOR SECUNDARIO</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class="${LC}">Nombre</label><input id="p2Name" placeholder="Nombre" class="${IC}"></div>
            <div><label class="${LC}">Teléfono</label><input id="p2Phone" placeholder="Teléfono" class="${IC}"></div>
            <div><label class="${LC}">Profesión</label><input id="p2Profession" placeholder="Ej: Abogada" class="${IC}"></div>
            <div><label class="${LC}">Dirección</label><input id="p2Address" placeholder="Dirección opcional" class="${IC}"></div>
          </div>
        </div>

        <!-- Pago -->
        <div class="bg-amber-50 p-5 rounded-2xl border-2 border-amber-100 space-y-3">
          <p class="text-[11px] font-black text-amber-700 uppercase tracking-wider">💳 INFORMACIÓN DE PAGO</p>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${LC}">Mensualidad $</label><input id="stMonthlyFee" type="number" step="0.01" placeholder="0.00" class="${IC} bg-white"></div>
            <div><label class="${LC}">Día Vencimiento</label><input id="stDueDay" type="number" min="1" max="31" placeholder="5" class="${IC} bg-white"></div>
          </div>
        </div>
      </div>

      <div class="bg-white p-5 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">
        <button onclick="window._closeAsistenteModal()" class="px-6 py-2.5 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
        <button id="btnSaveStudentModal" class="px-8 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg hover:-translate-y-0.5 transition-all active:scale-95">Guardar Estudiante</button>
      </div>`;

    // Show in globalModalContainer if available, else fallback modal
    const gc = document.getElementById('globalModalContainer');
    if (gc) {
      gc.innerHTML = '<div class="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden mx-3">' + html + '</div>';
      gc.style.display = 'flex';
      gc.style.alignItems = 'flex-start';
      gc.style.justifyContent = 'center';
      gc.style.paddingTop = '4vh';
      gc.style.zIndex = '9999';
    }

    window._closeAsistenteModal = () => {
      if (gc) { gc.style.display = 'none'; gc.innerHTML = ''; }
    };
    window._genMatricula = () => {
      const el = document.getElementById('stMatricula');
      if (el) el.value = 'KK-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random() * 9000) + 1000);
    };

    // Avatar preview
    document.getElementById('stAvatarFile')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const p = document.getElementById('stAvatarPreview');
        if (p) p.innerHTML = '<img src="' + ev.target.result + '" class="w-full h-full object-cover">';
      };
      reader.readAsDataURL(file);
    });

    // Load classrooms
    try {
      const { data } = await supabase.from('classrooms').select('id, name').order('name');
      const sel = document.getElementById('stClassroom');
      if (sel && data) {
        data.forEach(c => {
          const o = document.createElement('option');
          o.value = c.id; o.textContent = c.name;
          sel.appendChild(o);
        });
      }
    } catch (_) {}

    // Prefill if editing
    if (studentId) {
      try {
        const { data: st } = await supabase.from('students').select('*').eq('id', studentId).single();
        if (st) {
          const sv = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
          sv('stId', st.id); sv('stMatricula', st.matricula); sv('stName', st.name);
          sv('stClassroom', st.classroom_id); sv('stJoinedDate', st.start_date?.split('T')[0]);
          sv('stEmailNotif', st.p1_email); sv('stBlood', st.blood_type);
          sv('stAllergies', st.allergies); sv('stPickup', st.authorized_pickup);
          sv('p1Name', st.p1_name); sv('p1Phone', st.p1_phone);
          sv('p1Profession', st.p1_job); sv('p1Address', st.p1_address);
          sv('p1Emergency', st.p1_emergency_contact);
          sv('p2Name', st.p2_name); sv('p2Phone', st.p2_phone);
          sv('p2Profession', st.p2_job); sv('p2Address', st.p2_address);
          sv('stMonthlyFee', st.monthly_fee); sv('stDueDay', st.due_day);
          const cb = document.getElementById('stActive');
          if (cb) cb.checked = !!st.is_active;
          if (st.avatar_url) {
            const p = document.getElementById('stAvatarPreview');
            if (p) p.innerHTML = '<img src="' + st.avatar_url + '" class="w-full h-full object-cover">';
          }
        }
      } catch (_) {}
    }

    document.getElementById('btnSaveStudentModal')?.addEventListener('click', () => this.saveStudent());
    if (window.lucide) window.lucide.createIcons();
  },

  async saveStudent() {
    const btn = document.getElementById('btnSaveStudentModal');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    const id         = document.getElementById('stId')?.value;
    const name       = document.getElementById('stName')?.value?.trim();
    const emailUser  = document.getElementById('stEmailUser')?.value?.trim();
    const password   = document.getElementById('stPassword')?.value?.trim();

    if (!name) { Helpers.toast('El nombre es obligatorio', 'warning'); if (btn) { btn.disabled = false; btn.textContent = 'Guardar Estudiante'; } return; }

    const payload = {
      name,
      classroom_id:         document.getElementById('stClassroom')?.value || null,
      start_date:           document.getElementById('stJoinedDate')?.value || new Date().toISOString().split('T')[0],
      is_active:            document.getElementById('stActive')?.checked ?? true,
      blood_type:           document.getElementById('stBlood')?.value || null,
      allergies:            document.getElementById('stAllergies')?.value?.trim() || null,
      authorized_pickup:    document.getElementById('stPickup')?.value?.trim() || null,
      p1_name:              document.getElementById('p1Name')?.value?.trim() || null,
      p1_phone:             document.getElementById('p1Phone')?.value?.trim() || null,
      p1_job:               document.getElementById('p1Profession')?.value?.trim() || null,
      p1_address:           document.getElementById('p1Address')?.value?.trim() || null,
      p1_emergency_contact: document.getElementById('p1Emergency')?.value?.trim() || null,
      p1_email:             document.getElementById('stEmailNotif')?.value?.trim() || null,
      p2_name:              document.getElementById('p2Name')?.value?.trim() || null,
      p2_phone:             document.getElementById('p2Phone')?.value?.trim() || null,
      p2_job:               document.getElementById('p2Profession')?.value?.trim() || null,
      p2_address:           document.getElementById('p2Address')?.value?.trim() || null,
      monthly_fee:          parseFloat(document.getElementById('stMonthlyFee')?.value || 0) || 0,
      due_day:              parseInt(document.getElementById('stDueDay')?.value || 5) || 5
    };

    try {
      // Handle auth user creation/linking
      if (!id && emailUser && password) {
        // Use temp client to avoid logging out the current asistente session
        const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        const { data: authData, error: authError } = await tempClient.auth.signUp({
          email: emailUser, password,
          options: { data: { name: payload.p1_name, role: 'padre', phone: payload.p1_phone } }
        });

        let parentId = null;
        if (authError) {
          if (authError.status === 422 || authError.message?.toLowerCase().includes('already registered')) {
            const { data: ex } = await supabase.from('profiles').select('id').eq('email', emailUser).maybeSingle();
            if (ex?.id) { 
              parentId = ex.id; 
              Helpers.toast('Usuario ya existe — vinculando', 'info'); 
            } else {
              throw new Error('El correo ya está registrado pero no tiene un perfil asociado.');
            }
          } else {
            throw authError;
          }
        } else if (authData?.user) {
          parentId = authData.user.id;
        }

        if (parentId) {
          payload.parent_id = parentId;
          // El perfil se crea por trigger o manualmente si no existe
          await supabase.from('profiles').upsert({ 
            id: parentId, 
            name: payload.p1_name || payload.name + ' Parent', 
            email: emailUser, 
            phone: payload.p1_phone, 
            role: 'padre' 
          }, { onConflict: 'id' });
        }
      }

      if (id) {
        const { error } = await supabase.from('students').update(payload).eq('id', id);
        if (error) throw error;
        Helpers.toast('Estudiante actualizado correctamente');
      } else {
        const { error } = await supabase.from('students').insert([payload]);
        if (error) throw error;
        Helpers.toast('Estudiante registrado correctamente');
      }

      window._closeAsistenteModal?.();
      await this.loadStudents();
    } catch (err) {
      console.error(err);
      Helpers.toast('Error: ' + (err.message || err), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar Estudiante'; }
    }
  },

  async deleteStudent(id, name) {
    const ok = await (window._karpusConfirmDelete || ((t) => Promise.resolve(confirm(t))))(`¿Eliminar a ${name}?`, 'Esta acción no se puede deshacer.');
    if (!ok) return;
    try {
      const { error } = await supabase.from('students').delete().eq('id', id);
      if (error) throw error;
      Helpers.toast('Estudiante eliminado correctamente');
      await this.loadStudents();
    } catch (e) {
      Helpers.toast('Error al eliminar: ' + e.message, 'error');
    }
  }
};
