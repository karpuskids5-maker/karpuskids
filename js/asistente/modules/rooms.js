import { supabase } from '../../shared/supabase.js';
import { Helpers } from '../../shared/helpers.js';

export const RoomsModule = {
  async init() {
    await this.loadRooms();
    this.setupListeners();
  },

  setupListeners() {
    const btnAdd = document.getElementById('btnAddRoom');
    if (btnAdd) btnAdd.onclick = () => this.openModal();

    const btnSave = document.getElementById('btnSaveRoom');
    if (btnSave) btnSave.onclick = () => this.saveRoom();

    const btnCancel = document.getElementById('btnCancelRoom');
    if (btnCancel) btnCancel.onclick = () => this.closeModal();
  },

  async loadRooms() {
    const tbody = document.getElementById('roomsTable');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8"><div class="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600 mx-auto"></div></td></tr>';

    try {
      const { data: rooms, error } = await supabase
        .from('classrooms')
        .select('id, name, level, capacity, teacher:teacher_id(name), students(count)')
        .order('name');
      if (error) throw error;

      if (!rooms || rooms.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-slate-400">No hay aulas registradas.</td></tr>';
        return;
      }

      tbody.innerHTML = rooms.map(r => {
        const count = r.students?.[0]?.count || 0;
        const cap   = r.capacity || 20;
        const pct   = Math.round((count / cap) * 100);
        const barColor = pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500';
        
        return \`
          <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors cursor-pointer" onclick="window.App.rooms.openModal('\${r.id}')">
            <td class="px-4 py-3 font-bold text-slate-800 text-sm">\${Helpers.escapeHTML(r.name)}</td>
            <td class="px-4 py-3 text-slate-500 text-sm hidden md:table-cell">\${r.teacher?.name || 'Sin asignar'}</td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-2">
                <div class="flex-1 bg-slate-100 rounded-full h-2 max-w-[80px]">
                  <div class="\${barColor} h-full rounded-full" style="width:\${Math.min(pct, 100)}%"></div>
                </div>
                <span class="text-xs font-bold text-slate-500">\${count}/\${cap}</span>
              </div>
            </td>
            <td class="px-4 py-3 text-center">
              <span class="px-2 py-1 rounded-full text-[10px] font-bold \${pct < 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">
                \${pct < 100 ? 'Disponible' : 'Llena'}
              </span>
            </td>
            <td class="px-4 py-3 text-right text-slate-400 text-xs text-teal-600 hover:underline">
              Editar
            </td>
          </tr>\`;
      }).join('');
      
    } catch (e) {
      console.error('[loadRooms]', e);
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-rose-500 font-bold text-sm">Error al cargar aulas.</td></tr>';
    }
  },

  async openModal(roomId = null) {
    const modal = document.getElementById('roomModal');
    const title = document.getElementById('roomModalTitle');
    
    // Configurar campos por defecto
    document.getElementById('roomId').value = '';
    document.getElementById('roomName').value = '';
    document.getElementById('roomCapacity').value = '15';
    
    // Cargar select de maestras
    await this.populateTeachersSelect();

    if (roomId) {
      title.textContent = 'Editar Aula';
      try {
        const { data: rm, error } = await supabase.from('classrooms').select('*').eq('id', roomId).single();
        if (error) throw error;

        document.getElementById('roomId').value = rm.id;
        document.getElementById('roomName').value = rm.name || '';
        document.getElementById('roomTeacher').value = rm.teacher_id || '';
        document.getElementById('roomCapacity').value = rm.capacity || 15;
      } catch (e) {
        console.error(e);
        Helpers.toast('Error cargando aula', 'error');
        return;
      }
    } else {
      title.textContent = 'Nueva Aula';
      document.getElementById('roomTeacher').value = '';
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Cargar lista de estudiantes (para asignar masivamente, omitido del guardado simple, futuro scope)
    const list = document.getElementById('roomStudentsChecklist');
    if (list) {
      list.innerHTML = '<div class="text-[10px] text-slate-400 p-2 italic">Solo disponible para edición futura. Use vista individual.</div>';
    }
  },

  closeModal() {
    const modal = document.getElementById('roomModal');
    if (modal) {
      modal.classList.remove('flex');
      modal.classList.add('hidden');
    }
  },

  async populateTeachersSelect() {
    const select = document.getElementById('roomTeacher');
    if (!select) return;
    try {
      const { data, error } = await supabase.from('profiles').select('id, name').eq('role', 'maestra').order('name');
      if (!error && data) {
        select.innerHTML = '<option value="">-- Sin asignar --</option>' + data.map(t => \`<option value="\${t.id}">\${t.name}</option>\`).join('');
      }
    } catch (e) {}
  },

  async saveRoom() {
    const btn = document.getElementById('btnSaveRoom');
    btn.disabled = true;
    btn.innerHTML = '<i class="lucide-loader-2 animate-spin w-4 h-4"></i> Guardando...';

    const id = document.getElementById('roomId').value;
    const name = document.getElementById('roomName').value.trim();
    const capacity = parseInt(document.getElementById('roomCapacity').value || '0', 10);
    const teacher_id = document.getElementById('roomTeacher').value || null;

    if (!name) {
      Helpers.toast('Se requiere nombre de aula', 'warning');
      this.resetBtn(btn);
      return;
    }

    const payload = {
      name,
      capacity,
      teacher_id,
      level: 'General'
    };

    try {
      if (id) {
        payload.updated_at = new Date().toISOString();
        const { error } = await supabase.from('classrooms').update(payload).eq('id', id);
        if (error) throw error;
        Helpers.toast('Aula actualizada correctamente');
      } else {
        const { error } = await supabase.from('classrooms').insert([payload]);
        if (error) throw error;
        Helpers.toast('Aula creada correctamente');
      }

      this.closeModal();
      await this.loadRooms();
    } catch (e) {
      console.error(e);
      Helpers.toast('Error al guardar aula', 'error');
    } finally {
      this.resetBtn(btn);
    }
  },

  resetBtn(btn) {
    btn.disabled = false;
    btn.innerHTML = 'Guardar';
  }
};
