import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { UI } from './ui.module.js';
import { supabase } from '../shared/supabase.js';
import { QueryCache } from '../shared/query-cache.js';

export const RoomsModule = {

  async init() {
    const container = document.getElementById('roomsTable');
    if (!container) return;

    // Invalidar cache para obtener datos frescos
    QueryCache.invalidate('dir_classrooms_occ');

    container.innerHTML = '<tr><td colspan="4" class="text-center py-8"><div class="animate-spin w-6 h-6 border-2 border-purple-500 rounded-full border-t-transparent mx-auto"></div></td></tr>';
    try {
      const res = await DirectorApi.getClassroomsWithOccupancy();
      const classrooms = res?.data || [];
      if (res?.error) throw new Error(res.error);

      if (!classrooms.length) {
        container.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-500">No hay aulas. Crea la primera.</td></tr>';
        return;
      }
      container.innerHTML = classrooms.map(r => UI.renderClassroomRow(r)).join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('Error initClassroomsSection:', e);
      container.innerHTML = '<tr><td colspan="4" class="text-center py-8">' + Helpers.errorState('Error al cargar aulas') + '</td></tr>';
      if (window.lucide) lucide.createIcons();
    }
  },

  async save() {
    const id       = document.getElementById('roomId')?.value?.trim();
    const name     = document.getElementById('roomName')?.value?.trim();
    const capacity = document.getElementById('roomCapacity')?.value;
    const teacher_id = document.getElementById('roomTeacher')?.value || null;

    if (!name) return Helpers.toast('El nombre del aula es requerido', 'warning');

    const btn = document.querySelector('#globalModalContainer button[onclick*="rooms.save"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
      const payload = {
        name,
        capacity: capacity ? parseInt(capacity) : null,
        teacher_id: teacher_id || null
      };

      let error;
      if (id) {
        ({ error } = await supabase.from('classrooms').update(payload).eq('id', parseInt(id)));
      } else {
        ({ error } = await supabase.from('classrooms').insert(payload));
      }
      if (error) throw error;

      Helpers.toast(id ? 'Aula actualizada' : 'Aula creada', 'success');
      UI.closeModal();
      // Recargar tabla sin recargar página
      QueryCache.invalidate('dir_classrooms_occ');
      QueryCache.invalidate('dir_classrooms');
      await this.init();
    } catch (e) {
      console.error('Error saveRoom:', e);
      Helpers.toast('Error al guardar aula: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar Aula'; }
    }
  },

  async deleteRoom(roomId, roomName) {
    const ok = window._karpusConfirmDelete
      ? await window._karpusConfirmDelete('¿Eliminar aula "' + roomName + '"?', 'Los estudiantes quedarán sin aula asignada.')
      : confirm('¿Eliminar aula "' + roomName + '"? Los estudiantes quedarán sin aula.');
    if (!ok) return;

    try {
      const { error } = await supabase.from('classrooms').delete().eq('id', parseInt(roomId));
      if (error) throw error;
      Helpers.toast('Aula eliminada', 'success');
      QueryCache.invalidate('dir_classrooms_occ');
      QueryCache.invalidate('dir_classrooms');
      await this.init();
    } catch (e) {
      Helpers.toast('Error al eliminar: ' + e.message, 'error');
    }
  },

  async openModal(roomId = null) {
    const IC = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium';
    const LC = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';

    const html = `
      <div class="modal-header bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6 rounded-t-3xl flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">🏫</div>
          <div>
            <h3 class="text-xl font-black">${roomId ? 'Editar Aula' : 'Nueva Aula'}</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Gestión de Aulas</p>
          </div>
        </div>
        <button onclick="App.ui.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors">✕</button>
      </div>
      <div class="modal-body p-8 bg-slate-50/30">
        <input type="hidden" id="roomId" value="${roomId || ''}">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="col-span-2">
            <label class="${LC}">Nombre del Aula *</label>
            <input id="roomName" placeholder="Ej: Kinder A" class="${IC}">
          </div>
          <div>
            <label class="${LC}">Capacidad</label>
            <input id="roomCapacity" type="number" placeholder="Ej: 20" min="1" max="100" class="${IC}">
          </div>
          <div>
            <label class="${LC}">Maestra Asignada</label>
            <select id="roomTeacher" class="${IC}">
              <option value="">Sin asignar</option>
            </select>
          </div>
        </div>
      </div>
      <div class="modal-footer bg-white p-6 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">
        <button onclick="App.ui.closeModal()" class="px-8 py-3 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
        <button onclick="App.rooms.save()" class="px-10 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg hover:-translate-y-0.5 transition-all active:scale-95">Guardar Aula</button>
      </div>`;

    window.openGlobalModal(html);

    // Cargar maestras DESPUÉS de que el modal esté en el DOM
    try {
      const { data: teachers } = await DirectorApi.getTeachers();
      const select = document.getElementById('roomTeacher');
      if (select && teachers?.length) {
        select.innerHTML = '<option value="">Sin asignar</option>' +
          teachers.map(t => `<option value="${t.id}">${Helpers.escapeHTML(t.name)}</option>`).join('');
      }
    } catch (e) { console.error('Error cargando maestras:', e); }

    // Pre-llenar si es edición
    if (roomId) {
      try {
        const { data: room } = await supabase.from('classrooms').select('*').eq('id', parseInt(roomId)).single();
        if (room) {
          document.getElementById('roomName').value     = room.name || '';
          document.getElementById('roomCapacity').value = room.capacity || '';
          const sel = document.getElementById('roomTeacher');
          if (sel) sel.value = room.teacher_id || '';
        }
      } catch (e) { console.error('Error cargando aula:', e); }
    }

    if (window.lucide) lucide.createIcons();
  }
};
