import { supabase } from '../../shared/supabase.js';
import { Helpers } from '../../shared/helpers.js';

export const StudentsModule = {
  async init() {
    await this.loadStudents();
    this.setupListeners();
  },

  setupListeners() {
    const btnAdd = document.getElementById('btnAddStudent');
    if (btnAdd) {
      btnAdd.onclick = () => this.openModal();
    }

    const btnSave = document.getElementById('btnSaveStudent');
    if (btnSave) {
      btnSave.onclick = () => this.saveStudent();
    }

    const btnCancel = document.getElementById('btnCancelStudent');
    if (btnCancel) {
      btnCancel.onclick = () => this.closeModal();
    }
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

      if (!students || students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-400">No hay estudiantes registrados.</td></tr>';
        return;
      }

      tbody.innerHTML = students.map(s => `
        <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors cursor-pointer" onclick="window.App.students.openModal('${s.id}')">
          <td class="px-6 py-3 font-bold text-slate-800 text-sm">${Helpers.escapeHTML(s.name)}</td>
          <td class="px-6 py-3 text-slate-500 text-sm">${s.classrooms?.name || 'Sin Aula'}</td>
          <td class="px-6 py-3 text-slate-500 text-sm">${Helpers.escapeHTML(s.p1_name || 'N/A')}</td>
          <td class="px-6 py-3">
            <span class="px-2 py-1 rounded-full text-[10px] font-bold ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">
              ${s.is_active ? 'Activo' : 'Inactivo'}
            </span>
          </td>
        </tr>`).join('');

      // Buscador
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
    const modal = document.getElementById('modalAddStudent');
    const title = document.getElementById('modalStudentTitle');
    
    // Limpiar formulario
    ['stId', 'stName', 'stAge', 'stSchedule', 'stClassroom', 'p1Name', 'p1Phone', 'p1Email', 'p1Password', 'p2Name', 'p2Phone', 'stAllergies', 'stBlood', 'stPickup'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.value = '';
    });
    document.getElementById('stActive').checked = true;

    // Llenar select de aulas
    await this.populateClassroomsSelect();

    if (studentId) {
      title.textContent = 'Editar Estudiante';
      try {
        const { data: st, error } = await supabase.from('students').select('*').eq('id', studentId).single();
        if (error) throw error;
        
        document.getElementById('stId').value = st.id;
        document.getElementById('stName').value = st.name || '';
        document.getElementById('stAge').value = st.age || '';
        document.getElementById('stSchedule').value = st.schedule || '';
        document.getElementById('stClassroom').value = st.classroom_id || '';
        document.getElementById('stActive').checked = !!st.is_active;

        document.getElementById('p1Name').value = st.p1_name || '';
        document.getElementById('p1Phone').value = st.p1_phone || '';
        document.getElementById('p1Email').value = st.p1_email || '';
        document.getElementById('p2Name').value = st.p2_name || '';
        document.getElementById('p2Phone').value = st.p2_phone || '';

        document.getElementById('stAllergies').value = st.allergies || '';
        document.getElementById('stBlood').value = st.blood_type || '';
        document.getElementById('stPickup').value = st.authorized_pickup || '';

        // Ocultar campo password al editar (se envía push de reseteo si el padre necesita acceso)
        const pwdInput = document.getElementById('p1Password');
        if (pwdInput) {
            pwdInput.value = '********';
            pwdInput.disabled = true;
        }
      } catch (err) {
        console.error(err);
        Helpers.toast('Error cargando estudiante', 'error');
        return;
      }
    } else {
      title.textContent = 'Agregar Estudiante';
      const pwdInput = document.getElementById('p1Password');
      if (pwdInput) {
          pwdInput.value = '';
          pwdInput.disabled = false;
      }
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  },

  closeModal() {
    const modal = document.getElementById('modalAddStudent');
    if (modal) {
      modal.classList.remove('flex');
      modal.classList.add('hidden');
    }
  },

  async populateClassroomsSelect() {
    const select = document.getElementById('stClassroom');
    if (!select) return;
    try {
      const { data, error } = await supabase.from('classrooms').select('id, name').order('name');
      if (!error && data) {
        select.innerHTML = '<option value="">-- Sin Aula --</option>' + data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      }
    } catch(e) {}
  },

  async saveStudent() {
    const btn = document.getElementById('btnSaveStudent');
    btn.disabled = true;
    btn.innerHTML = '<i class="lucide-loader-2 animate-spin w-4 h-4"></i> Guardando...';

    const id = document.getElementById('stId').value;
    const name = document.getElementById('stName').value.trim();
    const classroom_id = document.getElementById('stClassroom').value || null;
    const is_active = document.getElementById('stActive').checked;
    const p1_email = document.getElementById('p1Email').value.trim();
    const p1_password = document.getElementById('p1Password').value.trim();

    if (!name) {
      Helpers.toast('El nombre del estudiante es obligatorio', 'warning');
      this.resetBtn(btn);
      return;
    }

    const payload = {
      name,
      classroom_id,
      age: document.getElementById('stAge').value || null,
      schedule: document.getElementById('stSchedule').value || null,
      is_active,
      p1_name: document.getElementById('p1Name').value.trim(),
      p1_phone: document.getElementById('p1Phone').value.trim(),
      p1_email,
      p2_name: document.getElementById('p2Name').value.trim(),
      p2_phone: document.getElementById('p2Phone').value.trim(),
      allergies: document.getElementById('stAllergies').value.trim(),
      blood_type: document.getElementById('stBlood').value.trim(),
      authorized_pickup: document.getElementById('stPickup').value.trim()
    };

    try {
      // Si es nuevo estudiante y hay correo/contraseña, idealmente creamos el usuario en auth (req admin edge function).
      // Aquí insertamos los datos en "students" sin cuenta en Auth debido a limitaciones de cliente.
      // Advertencia en produccion: El padre tendria que registrarse y la app lo enlaza despues, 
      // o el servidor edge lo crea. Se guarda p1_email referencialmente.
      
      if (id) {
        payload.updated_at = new Date().toISOString();
        const { error } = await supabase.from('students').update(payload).eq('id', id);
        if (error) throw error;
        Helpers.toast('Estudiante actualizado correctamente');
      } else {
        const { error } = await supabase.from('students').insert([payload]);
        if (error) throw error;
        Helpers.toast('Estudiante registrado correctamente');
      }

      this.closeModal();
      await this.loadStudents();

    } catch (err) {
      console.error(err);
      Helpers.toast('Error al guardar estudiante', 'error');
    } finally {
      this.resetBtn(btn);
    }
  },

  resetBtn(btn) {
    btn.disabled = false;
    btn.innerHTML = 'Guardar';
  }
};
