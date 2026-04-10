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
        <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
          <td class="px-4 py-3">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-lg bg-teal-100 text-teal-600 flex items-center justify-center font-bold text-sm shrink-0 overflow-hidden">
                ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : (s.name || '?').charAt(0)}
              </div>
              <div>
                <div class="font-bold text-slate-800 text-sm">${Helpers.escapeHTML(s.name)}</div>
                <div class="text-[10px] text-slate-400">${s.matricula || 'Sin matrícula'}</div>
              </div>
            </div>
          </td>
          <td class="px-4 py-3 text-slate-500 text-sm hidden sm:table-cell">${Helpers.escapeHTML(s.classrooms?.name || 'Sin Aula')}</td>
          <td class="px-4 py-3 text-slate-500 text-sm hidden md:table-cell">${Helpers.escapeHTML(s.p1_name || 'N/A')}</td>
          <td class="px-4 py-3">
            <div class="flex items-center gap-1.5">
              <span class="px-2 py-1 rounded-full text-[10px] font-bold ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">${s.is_active ? 'Activo' : 'Inactivo'}</span>
              <button onclick="window.App.students.openModal('${s.id}')" class="p-1.5 bg-teal-50 text-teal-500 rounded-lg hover:bg-teal-100 hover:text-teal-700 transition-all" title="Editar">
                <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
              </button>
              <button onclick="window.App.students.deleteStudent('${s.id}', '${Helpers.escapeHTML(s.name)}')" class="p-1.5 bg-rose-50 text-rose-400 rounded-lg hover:bg-rose-100 hover:text-rose-600 transition-all" title="Eliminar">
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
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8">' + Helpers.errorState('Error al cargar estudiantes', 'App.students.init()') + '</td></tr>';
      if (window.lucide) lucide.createIcons();
    }
  },

  async openModal(studentId = null) {
    const IC = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-teal-100 focus:border-teal-400 bg-slate-50/50 transition-all text-sm font-medium';
    const LC = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';

    const html = `
      <div class="bg-gradient-to-r from-teal-600 to-emerald-600 text-white p-4 rounded-t-3xl flex items-center justify-between shrink-0">
        <div class="flex items-center gap-2">
          <div class="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center text-lg">\ud83d\udc76</div>
          <div>
            <h3 class="text-base font-black">${studentId ? 'Editar Estudiante' : 'Nuevo Estudiante'}</h3>
            <p class="text-[9px] text-white/70 font-bold uppercase tracking-widest">Ficha del Alumno</p>
          </div>
        </div>
        <button onclick="window._closeAsistenteModal()" class="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-all">\u2715</button>
      </div>

      <div class="p-4 space-y-4 overflow-y-auto flex-1" style="max-height: calc(90vh - 120px);">
        <input type="hidden" id="stId" value="${studentId || ''}">

        <!-- \ud83d\udcf7 FOTO Y MATR\u00cdCULA -->
        <div class="flex flex-col sm:flex-row gap-3 items-center bg-slate-50 p-3 rounded-2xl border border-slate-100">
          <div class="relative group cursor-pointer shrink-0">
            <div id="stAvatarPreview" class="w-16 h-16 rounded-xl bg-white border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 group-hover:border-teal-400 transition-all overflow-hidden shadow-sm">
              <span class="text-xl">\ud83d\udcf7</span><span class="text-[8px] font-black uppercase mt-0.5">Foto</span>
            </div>
            <input type="file" id="stAvatarFile" class="absolute inset-0 opacity-0 cursor-pointer" accept="image/*">
          </div>
          <div class="flex-1 w-full space-y-2">
            <div>
              <label class="${LC}">Matr\u00edcula</label>
              <div class="flex gap-1.5">
                <input id="stMatricula" placeholder="Generar..." class="${IC} py-1.5 text-xs">
                <button onclick="window._genMatricula()" class="px-3 py-1.5 bg-teal-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-teal-700 shadow-sm transition-all shrink-0">Gen</button>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div><label class="${LC}">Inscripci\u00f3n</label><input type="date" id="stJoinedDate" class="${IC} py-1.5 text-xs"></div>
              <div class="flex items-center pt-4"><label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="stActive" checked class="w-3.5 h-3.5 rounded accent-teal-600"><span class="text-[10px] font-bold text-teal-700 uppercase">Activo</span></label></div>
            </div>
          </div>
        </div>

        <!-- \ud83d\udc66 INFORMACI\u00d3N DEL ESTUDIANTE -->
        <div class="bg-white rounded-2xl border border-slate-100 p-3 space-y-3">
          <p class="text-[10px] font-black text-teal-600 uppercase tracking-widest flex items-center gap-1.5">\ud83d\udc66 Informaci\u00f3n del Estudiante</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div class="sm:col-span-2"><label class="${LC}">Nombre completo *</label><input id="stName" placeholder="Nombre completo" class="${IC} py-2"></div>
            <div><label class="${LC}">Edad</label><input id="stAge" type="number" min="1" max="18" placeholder="Ej: 5" class="${IC} py-2"></div>
            <div><label class="${LC}">Horario</label><input id="stHorario" placeholder="Ej: 08:00-12:00" class="${IC} py-2"></div>
            <div class="sm:col-span-2"><label class="${LC}">Aula</label>
              <select id="stClassroom" class="${IC} py-2"><option value="">-- Seleccionar Aula --</option></select>
            </div>
          </div>
        </div>

        <!-- \ud83d\udd10 ACCESO Y NOTIFICACIONES -->
        <div class="bg-white rounded-2xl border border-slate-100 p-3 space-y-3">
          <p class="text-[10px] font-black text-teal-600 uppercase tracking-widest flex items-center gap-1.5">\ud83d\udd10 Acceso y Notificaciones</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label class="${LC}">Correo de Usuario (Login)</label><input id="stEmailUser" type="email" placeholder="usuario@karpus.com" class="${IC} py-2"></div>
            <div><label class="${LC}">Correo de Notificaciones</label><input id="stEmailNotif" type="email" placeholder="avisos@ejemplo.com" class="${IC} py-2"></div>
            <div class="sm:col-span-2"><label class="${LC}">Contrase\u00f1a (M\u00edn 6 caracteres)</label><input id="stPassword" type="text" placeholder="********" class="${IC} py-2"></div>
          </div>
        </div>

        <!-- \ud83e\ude7a SALUD Y SEGURIDAD -->
        <div class="bg-white rounded-2xl border border-slate-100 p-3 space-y-3">
          <p class="text-[10px] font-black text-teal-600 uppercase tracking-widest flex items-center gap-1.5">\ud83e\ude7a Salud y Seguridad</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label class="${LC}">Tipo Sangre</label>
              <select id="stBlood" class="${IC} py-2">
                <option value="O+">O+</option><option value="O-">O-</option><option value="A+">A+</option><option value="A-">A-</option>
                <option value="B+">B+</option><option value="B-">B-</option><option value="AB+">AB+</option><option value="AB-">AB-</option>
              </select>
            </div>
            <div><label class="${LC}">Alergias</label><input id="stAllergies" placeholder="Ej: Man\u00ed, Polvo" class="${IC} py-2"></div>
            <div class="sm:col-span-2"><label class="${LC}">Autorizados para recoger</label><textarea id="stPickup" rows="2" placeholder="Ej: Abuela Carmen, T\u00edo Juan" class="${IC} py-2 resize-none"></textarea></div>
          </div>
        </div>

        <!-- \ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc66 TUTOR PRINCIPAL -->
        <div class="bg-white rounded-2xl border border-slate-100 p-3 space-y-3">
          <p class="text-[10px] font-black text-teal-600 uppercase tracking-widest flex items-center gap-1.5">\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc66 Tutor Principal</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label class="${LC}">Nombre</label><input id="p1Name" placeholder="Nombre completo" class="${IC} py-2"></div>
            <div><label class="${LC}">Tel\u00e9fono</label><input id="p1Phone" placeholder="Tel\u00e9fono" class="${IC} py-2"></div>
            <div><label class="${LC}">Profesi\u00f3n</label><input id="p1Profession" placeholder="Ej: Ingeniero" class="${IC} py-2"></div>
            <div><label class="${LC}">Direcci\u00f3n</label><input id="p1Address" placeholder="Direcci\u00f3n completa" class="${IC} py-2"></div>
            <div class="sm:col-span-2"><label class="${LC}">Contacto de Emergencia (Extra)</label><input id="p1Emergency" placeholder="Nombre y Tel\u00e9fono alternativo" class="${IC} py-2"></div>
          </div>
        </div>

        <!-- \ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67 TUTOR SECUNDARIO -->
        <div class="bg-white rounded-2xl border border-slate-100 p-3 space-y-3">
          <p class="text-[10px] font-black text-teal-600 uppercase tracking-widest flex items-center gap-1.5">\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67 Tutor Secundario</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label class="${LC}">Nombre</label><input id="p2Name" placeholder="Nombre" class="${IC} py-2"></div>
            <div><label class="${LC}">Tel\u00e9fono</label><input id="p2Phone" placeholder="Tel\u00e9fono" class="${IC} py-2"></div>
            <div><label class="${LC}">Profesi\u00f3n</label><input id="p2Profession" placeholder="Ej: Abogada" class="${IC} py-2"></div>
            <div><label class="${LC}">Direcci\u00f3n</label><input id="p2Address" placeholder="Direcci\u00f3n opcional" class="${IC} py-2"></div>
          </div>
        </div>

        <!-- \ud83d\udcb3 INFORMACI\u00d3N DE PAGO -->
        <div class="bg-amber-50 rounded-2xl border border-amber-100 p-3 space-y-3">
          <p class="text-[10px] font-black text-amber-700 uppercase tracking-widest flex items-center gap-1.5">\ud83d\udcb3 Informaci\u00f3n de Pago</p>
          <div class="grid grid-cols-2 gap-2">
            <div><label class="${LC}">Mensualidad ($)</label>
              <div class="relative"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-amber-600 font-black text-sm">$</span>
              <input id="stMonthlyFee" type="number" step="0.01" min="0" placeholder="0.00" class="${IC} py-2 pl-7"></div>
            </div>
            <div><label class="${LC}">D\u00eda Vencimiento</label><input id="stDueDay" type="number" min="1" max="31" placeholder="5" class="${IC} py-2"></div>
          </div>
        </div>
      </div>

      <div class="bg-white p-4 rounded-b-3xl border-t border-slate-100 flex justify-end gap-2 shrink-0">
        <button onclick="window._closeAsistenteModal()" class="px-4 py-2 text-slate-500 font-black text-[9px] uppercase hover:bg-slate-50 rounded-xl transition-all">Cancelar</button>
        <button onclick="window._saveStudentNow()" class="px-6 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-xl font-black text-[9px] uppercase shadow-md hover:-translate-y-0.5 transition-all active:scale-95" id="btnSaveStudentModal">Guardar Estudiante</button>
      </div>`;

    const gc = document.getElementById('globalModalContainer');
    if (gc) {
      gc.innerHTML = '<div class="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden mx-3 flex flex-col">' + html + '</div>';
      gc.style.display = 'flex';
      gc.style.alignItems = 'center';
      gc.style.justifyContent = 'center';
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

    // Load classrooms \u2014 critical for the form
    try {
      const sel = document.getElementById('stClassroom') || gc?.querySelector('#stClassroom');
      if (sel) {
        sel.innerHTML = '<option value="">Cargando aulas...</option>';
        const { data, error } = await supabase.from('classrooms').select('id, name').order('name');
        if (error) throw error;
        sel.innerHTML = '<option value="">-- Seleccionar Aula --</option>';
        if (data?.length) {
          data.forEach(c => {
            const o = document.createElement('option');
            o.value = c.id; o.textContent = c.name;
            sel.appendChild(o);
          });
        } else {
          sel.innerHTML = '<option value="">No hay aulas registradas</option>';
        }
      }
    } catch (e) {
      console.error('Error loading classrooms for student modal:', e);
      const sel = document.getElementById('stClassroom') || gc?.querySelector('#stClassroom');
      if (sel) sel.innerHTML = '<option value="">Error al cargar aulas</option>';
    }

    // Prefill if editing
    if (studentId) {
      try {
        const numId = parseInt(studentId, 10);
        if (isNaN(numId)) throw new Error('ID inválido');
        const { data: st, error } = await supabase.from('students').select('*').eq('id', numId).single();
        if (error) throw error;
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

          // Fetch parent email if possible
          if (st.parent_id) {
            const { data: prof } = await supabase.from('profiles').select('email').eq('id', st.parent_id).maybeSingle();
            if (prof) sv('stEmailUser', prof.email);
          }
        }
      } catch (e) {
        console.error('Error loading student for edit:', e);
        Helpers.toast('Error al cargar datos del estudiante', 'error');
      }
    }

    window._saveStudentNow = () => this.saveStudent();
    if (window.lucide) window.lucide.createIcons();
  },

  async saveStudent() {
    const btn = document.getElementById('btnSaveStudentModal');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Guardando...'; if(window.lucide) window.lucide.createIcons(); }

    // Leer valores directamente del DOM \u2014 usar querySelector como fallback
    const gc = document.getElementById('globalModalContainer');
    const getVal = (id) => (gc?.querySelector('#' + id) || document.getElementById(id))?.value?.trim() || '';
    const getChecked = (id) => (gc?.querySelector('#' + id) || document.getElementById(id))?.checked ?? true;

    const id         = getVal('stId');
    const name       = getVal('stName');
    const emailUser  = getVal('stEmailUser');
    const password   = getVal('stPassword');
    const avatarFile = (gc?.querySelector('#stAvatarFile') || document.getElementById('stAvatarFile'))?.files?.[0];

    if (!name || name.length < 2) {
      Helpers.toast('El nombre del estudiante es obligatorio', 'warning');
      if (btn) { btn.disabled = false; btn.innerHTML = 'Guardar Estudiante'; }
      return;
    }

    // Build payload with only columns that exist in the DB
    // Only include fields with actual values to avoid 42703 on missing columns
    const payload = {
      name,
      is_active:   getChecked('stActive'),
      start_date:  getVal('stJoinedDate') || new Date().toISOString().split('T')[0],
      monthly_fee: parseFloat(getVal('stMonthlyFee') || '0') || 0,
      due_day:     parseInt(getVal('stDueDay') || '5') || 5
    };

    // Optional columns \u2014 only add if non-empty
    const optionals = {
      matricula:         getVal('stMatricula') || null,
      classroom_id:      getVal('stClassroom') ? parseInt(getVal('stClassroom'), 10) : null,
      blood_type:        getVal('stBlood') || null,
      allergies:         getVal('stAllergies') || null,
      authorized_pickup: getVal('stPickup') || null,
      p1_name:           getVal('p1Name') || null,
      p1_phone:          getVal('p1Phone') || null,
      p1_email:          getVal('stEmailNotif') || null,
      p1_job:            getVal('p1Profession') || null,
      p1_address:        getVal('p1Address') || null,
      p1_emergency_contact: getVal('p1Emergency') || null,
      p2_name:           getVal('p2Name') || null,
      p2_phone:          getVal('p2Phone') || null,
      p2_job:            getVal('p2Profession') || null,
      p2_address:        getVal('p2Address') || null,
    };
    for (const [k, v] of Object.entries(optionals)) {
      if (v !== null && v !== '') payload[k] = v;
    }
    try {
      // 1. Subir avatar si existe
      if (avatarFile) {
        const ext = avatarFile.name.split('.').pop();
        const path = `students/${Date.now()}_${Math.random().toString(36).substr(2,9)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('karpus-uploads').upload(path, avatarFile);
        if (upErr) throw upErr;
        const { data } = supabase.storage.from('karpus-uploads').getPublicUrl(path);
        payload.avatar_url = data.publicUrl;
      }

      // 2. Manejar creaci\u00f3n/vinculaci\u00f3n de padre
      if (emailUser && (password || !id)) {
        let parentId = null;
        
        // Buscar si el perfil ya existe
        const { data: existingProf } = await supabase.from('profiles').select('id').eq('email', emailUser).maybeSingle();
        
        if (existingProf) {
          parentId = existingProf.id;
          Helpers.toast('Vinculando con usuario existente', 'info');
        } else if (password) {
          // Crear nuevo usuario con cliente temporal para no cerrar sesi\u00f3n actual
          const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
          });
          const { data: authData, error: authError } = await tempClient.auth.signUp({
            email: emailUser, password,
            options: { data: { name: payload.p1_name || 'Padre', role: 'padre' } }
          });

          if (authError) throw authError;
          if (authData?.user) {
            parentId = authData.user.id;
            // Crear perfil manualmente para asegurar rol y datos
            await supabase.from('profiles').upsert({ 
              id: parentId, 
              name: payload.p1_name || 'Padre de ' + payload.name, 
              email: emailUser, 
              phone: payload.p1_phone, 
              role: 'padre' 
            });
          }
        }

        if (parentId) payload.parent_id = parentId;
      }

      // 3. Guardar Estudiante
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
      console.error('[saveStudent] Error:', err);
      Helpers.toast('Error: ' + (err.message || 'No se pudo guardar'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = 'Guardar Estudiante'; if(window.lucide) lucide.createIcons(); }
    }
  },

  async deleteStudent(id, name) {
    const ok = await (window._karpusConfirmDelete || ((t) => Promise.resolve(confirm(t))))(`\u00bfEliminar a ${name}?`, 'Esta acci\u00f3n no se puede deshacer.');
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
