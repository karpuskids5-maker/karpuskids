import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { UI } from './ui.module.js';
import { supabase } from '../shared/supabase.js';

export const RoomsModule = {
  async init() {
    const container = document.getElementById('roomsTable');
    if (!container) return;

    container.innerHTML = '<tr><td colspan="4" class="text-center py-8">Cargando...</td></tr>';
    try {
      const res = await DirectorApi.getClassroomsWithOccupancy();
      const classrooms = res?.data || [];
      const { error } = res || {};
      if (error) throw new Error(error);
      if (!classrooms?.length) {
        container.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-500">No hay aulas.</td></tr>';
        return;
      }
      container.innerHTML = classrooms.map(r => UI.renderClassroomRow(r)).join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('Error initClassroomsSection:', e);
      container.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-red-500">Error al cargar.</td></tr>';
    }
  },

  async save() {
    const id = document.getElementById('roomId')?.value;
    const name = document.getElementById('roomName')?.value?.trim();
    const capacity = document.getElementById('roomCapacity')?.value;
    const teacher_id = document.getElementById('roomTeacher')?.value || null;
    if (!name) return Helpers.toast('El nombre del aula es requerido', 'warning');
    UI.setLoading(true);
    try {
      const payload = { name, capacity: capacity ? parseInt(capacity) : null, teacher_id };
      let error;
      if (id) {
        ({ error } = await supabase.from('classrooms').update(payload).eq('id', id));
      } else {
        ({ error } = await supabase.from('classrooms').insert(payload));
      }
      if (error) throw error;
      Helpers.toast(id ? 'Aula actualizada' : 'Aula creada', 'success');
      UI.closeModal();
      await RoomsModule.init();
    } catch (e) {
      console.error('Error saveRoom:', e);
      Helpers.toast('Error al guardar aula: ' + e.message, 'error');
    } finally {
      UI.setLoading(false);
    }
  },

  async openModal(roomId = null) {
    const inputClass = "w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium";
    const labelClass = "block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1";
    const html = `
      <div class="modal-header bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6 rounded-t-3xl flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">🏫</div>
          <div>
            <h3 id="roomModalTitle" class="text-xl font-black">${roomId ? 'Editar Aula' : 'Nueva Aula'}</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Gestión de Aulas</p>
          </div>
        </div>
        <button onclick="App.ui.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors">✕</button>
      </div>
      <div class="modal-body p-8 bg-slate-50/30">
        <input type="hidden" id="roomId" value="${roomId || ''}">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="col-span-2">
            <label class="${labelClass}">Nombre del Aula</label>
            <input id="roomName" placeholder="Ej: Kinder A" class="${inputClass}">
          </div>
          <div>
            <label class="${labelClass}">Capacidad</label>
            <input id="roomCapacity" type="number" placeholder="Ej: 20" class="${inputClass}">
          </div>
          <div>
            <label class="${labelClass}">Maestra Asignada</label>
            <select id="roomTeacher" class="${inputClass}"><option value="">Sin asignar</option></select>
          </div>
        </div>
      </div>
      <div class="modal-footer bg-white p-6 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">
        <button onclick="App.ui.closeModal()" class="px-8 py-3 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
        <button onclick="App.rooms.save()" class="px-10 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg hover:-translate-y-0.5 transition-all active:scale-95">Guardar Aula</button>
      </div>`;
    window.openGlobalModal(html);
    try {
      const { data: teachers } = await DirectorApi.getTeachers();
      const select = document.getElementById('roomTeacher');
      if (select && teachers?.length) {
        select.innerHTML += teachers.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
      }
    } catch (e) { console.error('Error cargando maestras:', e); }
    if (roomId) {
      try {
        const { data: room } = await supabase.from('classrooms').select('*').eq('id', roomId).single();
        if (room) {
          document.getElementById('roomName').value = room.name || '';
          document.getElementById('roomCapacity').value = room.capacity || '';
          document.getElementById('roomTeacher').value = room.teacher_id || '';
        }
      } catch (e) { console.error('Error cargando aula:', e); }
    }
    if (window.lucide) lucide.createIcons();
  }
};
