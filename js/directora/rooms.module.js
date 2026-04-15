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

    // Cargar estudiantes sin aula en paralelo
    this.loadUnassigned();
  },

  async loadUnassigned() {
    const list = document.getElementById('unassignedStudentsList');
    const countEl = document.getElementById('unassignedCount');
    if (!list) return;

    list.innerHTML = '<div class="text-center py-6"><div class="animate-spin w-5 h-5 border-2 border-amber-500 rounded-full border-t-transparent mx-auto"></div></div>';

    try {
      const { data: students, error } = await supabase
        .from('students')
        .select('id, name, p1_name, is_active')
        .is('classroom_id', null)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      if (countEl) countEl.textContent = students?.length
        ? `${students.length} estudiante${students.length > 1 ? 's' : ''} sin aula`
        : 'Todos los estudiantes tienen aula asignada';

      if (!students?.length) {
        list.innerHTML = '<div class="flex items-center gap-3 px-6 py-5 text-sm text-emerald-600 font-bold"><span class="text-xl">✅</span> Todos los estudiantes activos tienen aula asignada.</div>';
        return;
      }

      const { data: classrooms } = await supabase
        .from('classrooms')
        .select('id, name')
        .order('name');

      const roomOptions = (classrooms || [])
        .map(r => `<option value="${r.id}">${Helpers.escapeHTML(r.name)}</option>`)
        .join('');

      list.innerHTML = students.map(s => `
        <div class="flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors gap-4" id="unassigned-row-${s.id}">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-black text-sm shrink-0">
              ${(s.name || '?').charAt(0).toUpperCase()}
            </div>
            <div class="min-w-0">
              <p class="font-bold text-slate-800 text-sm truncate">${Helpers.escapeHTML(s.name)}</p>
              <p class="text-xs text-slate-400 truncate">${s.p1_name ? Helpers.escapeHTML(s.p1_name) : 'Sin tutor registrado'}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <select id="select-room-${s.id}" class="text-xs border-2 border-slate-100 rounded-xl px-3 py-2 bg-slate-50 focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none font-medium transition-all">
              <option value="">-- Seleccionar aula --</option>
              ${roomOptions}
            </select>
            <button onclick="App.rooms.assignStudent(${s.id})" class="px-4 py-2 bg-purple-600 text-white rounded-xl text-xs font-black hover:bg-purple-700 active:scale-95 transition-all shadow-sm">
              Asignar
            </button>
          </div>
        </div>`).join('');

      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('[loadUnassigned]', e);
      list.innerHTML = '<div class="px-6 py-5 text-sm text-rose-500">Error al cargar estudiantes sin aula.</div>';
    }
  },

  async assignStudent(studentId) {
    const select = document.getElementById(`select-room-${studentId}`);
    const classroomId = select?.value;
    if (!classroomId) return Helpers.toast('Selecciona un aula primero', 'warning');

    const btn = select?.nextElementSibling;
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    try {
      // Intentar columnas posibles: classroom_id → aula_id → room_id
      const candidates = ['classroom_id', 'aula_id', 'room_id'];
      let result = null;
      let usedCol = null;

      for (const col of candidates) {
        result = await supabase
          .from('students')
          .update({ [col]: parseInt(classroomId) })
          .eq('id', studentId);

        if (!result.error || result.error.code !== '42703') {
          usedCol = col;
          break;
        }
      }

      if (result.error) {
        // Último recurso: RPC si existe
        const rpcResult = await supabase.rpc('assign_student_to_classroom', {
          p_student_id: parseInt(studentId),
          p_classroom_id: parseInt(classroomId)
        });
        if (rpcResult.error) {
          console.error('[assignStudent]', result.error);
          Helpers.toast('No se pudo asignar. Ejecuta en Supabase SQL Editor: ALTER TABLE public.students ADD COLUMN IF NOT EXISTS classroom_id bigint REFERENCES public.classrooms(id) ON DELETE SET NULL;', 'error');
          if (btn) { btn.disabled = false; btn.textContent = 'Asignar'; }
          return;
        }
      }

      const row = document.getElementById(`unassigned-row-${studentId}`);
      if (row) {
        row.style.transition = 'opacity 0.3s, transform 0.3s';
        row.style.opacity = '0';
        row.style.transform = 'translateX(20px)';
        setTimeout(() => row.remove(), 300);
      }

      Helpers.toast('Estudiante asignado al aula', 'success');
      QueryCache.invalidate('dir_students');
      QueryCache.invalidate('dir_classrooms_occ');

      setTimeout(() => {
        const remaining = document.querySelectorAll('[id^="unassigned-row-"]').length;
        const countEl = document.getElementById('unassignedCount');
        if (countEl) countEl.textContent = remaining
          ? `${remaining} estudiante${remaining > 1 ? 's' : ''} sin aula`
          : 'Todos los estudiantes tienen aula asignada';
        if (!remaining) {
          const list = document.getElementById('unassignedStudentsList');
          if (list) list.innerHTML = '<div class="flex items-center gap-3 px-6 py-5 text-sm text-emerald-600 font-bold"><span class="text-xl">✅</span> Todos los estudiantes activos tienen aula asignada.</div>';
        }
        this.init();
      }, 350);
    } catch (e) {
      console.error('[assignStudent]', e);
      Helpers.toast('Error al asignar: ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Asignar'; }
    }
  },

  async save() {
    const id         = document.getElementById('roomId')?.value?.trim();
    const name       = document.getElementById('roomName')?.value?.trim();
    const capacity   = document.getElementById('roomCapacity')?.value;
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

      let savedId = id;
      if (id) {
        const { error } = await supabase.from('classrooms').update(payload).eq('id', parseInt(id));
        if (error) throw error;
      } else {
        const { data: newRoom, error } = await supabase.from('classrooms').insert(payload).select('id').single();
        if (error) throw error;
        savedId = newRoom?.id;
      }

      // Asignar/desasignar estudiantes del checklist
      const checks = document.querySelectorAll('.room-student-check');
      if (checks.length && savedId) {
        const roomIdNum = parseInt(savedId, 10);
        const toAssign   = [...checks].filter(c => c.checked).map(c => parseInt(c.value, 10));
        const toUnassign = [...checks].filter(c => !c.checked).map(c => parseInt(c.value, 10));

        const updateClassroom = async (ids, value) => {
          if (!ids.length) return;
          const updateVal = value === null || value === undefined ? null : value;
          const res = await supabase.from('students').update({ classroom_id: updateVal }).in('id', ids);
          if (res.error && res.error.code === '42703') {
            // Siempre usar 2 parámetros — evita error de overload con función de 1 parámetro
            for (const sid of ids) {
              await supabase.rpc('assign_student_to_classroom', {
                p_student_id: sid,
                p_classroom_id: updateVal
              });
            }
          }
        };
        await updateClassroom(toAssign, roomIdNum);
        await updateClassroom(toUnassign, null);
      }

      Helpers.toast(id ? 'Aula actualizada' : 'Aula creada', 'success');
      UI.closeModal();
      QueryCache.invalidate('dir_classrooms_occ');
      QueryCache.invalidate('dir_classrooms');
      QueryCache.invalidate('dir_students');
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
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Configuración del aula</p>
          </div>
        </div>
        <button onclick="App.ui.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors text-lg">✕</button>
      </div>

      <div class="modal-body p-6 bg-slate-50/30 space-y-5">
        <input type="hidden" id="roomId" value="${roomId || ''}">

        <div>
          <label class="${LC}">Nombre del Aula *</label>
          <input id="roomName" placeholder="Ej: Kinder A" class="${IC}">
        </div>

        <div>
          <label class="${LC}">Maestra Asignada</label>
          <select id="roomTeacher" class="${IC}">
            <option value="">-- Sin asignar --</option>
          </select>
        </div>

        <div>
          <label class="${LC}">Capacidad</label>
          <input id="roomCapacity" type="number" placeholder="Ej: 20" min="1" max="100" class="${IC}">
        </div>

        <div>
          <label class="${LC}">Estudiantes del Aula</label>
          <p class="text-[10px] text-slate-400 mb-2 ml-1">Marca los estudiantes que pertenecen a esta aula</p>
          <div id="roomStudentsChecklist" class="bg-white border-2 border-slate-100 rounded-2xl max-h-52 overflow-y-auto divide-y divide-slate-50">
            <div class="text-center py-6 text-slate-400 text-xs">Cargando estudiantes...</div>
          </div>
        </div>
      </div>

      <div class="modal-footer bg-white p-6 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">
        <button onclick="App.ui.closeModal()" class="px-8 py-3 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
        <button onclick="App.rooms.save()" class="px-10 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg hover:-translate-y-0.5 transition-all active:scale-95">Guardar Aula</button>
      </div>`;

    window.openGlobalModal(html);

    // Cargar maestras
    try {
      const { data: teachers } = await DirectorApi.getTeachers();
      const select = document.getElementById('roomTeacher');
      if (select && teachers?.length) {
        select.innerHTML = '<option value="">-- Sin asignar --</option>' +
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

    // Cargar checklist de estudiantes
    await this._loadStudentsChecklist(roomId);

    if (window.lucide) lucide.createIcons();
  },

  async _loadStudentsChecklist(roomId) {
    const list = document.getElementById('roomStudentsChecklist');
    if (!list) return;

    try {
      // Intentar con classroom_id
      let students = null;
      const res = await supabase.from('students').select('id, name, classroom_id').eq('is_active', true).order('name');
      if (res.error && res.error.code === '42703') {
        // Fallback sin classroom_id
        const res2 = await supabase.from('students').select('id, name').eq('is_active', true).order('name');
        students = res2.data || [];
      } else {
        students = res.data || [];
      }

      if (!students.length) {
        list.innerHTML = '<div class="px-4 py-5 text-xs text-slate-400 italic">No hay estudiantes registrados.</div>';
        return;
      }

      const rid = roomId ? String(roomId) : null;
      list.innerHTML = students.map(s => {
        const inThisRoom = rid && String(s.classroom_id) === rid;
        const inOtherRoom = s.classroom_id && !inThisRoom;
        return `
          <label class="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-purple-50 transition-colors ${inOtherRoom ? 'opacity-50' : ''}">
            <input type="checkbox" value="${s.id}" ${inThisRoom ? 'checked' : ''} ${inOtherRoom ? 'disabled title="Ya está en otra aula"' : ''}
              class="room-student-check w-4 h-4 rounded accent-purple-600 shrink-0">
            <div class="w-7 h-7 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center font-black text-xs shrink-0">
              ${(s.name || '?').charAt(0).toUpperCase()}
            </div>
            <span class="text-sm font-medium text-slate-700 flex-1">${Helpers.escapeHTML(s.name)}</span>
            ${inThisRoom ? '<span class="text-[9px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-black">En esta aula</span>' : ''}
            ${inOtherRoom ? '<span class="text-[9px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-black">Otra aula</span>' : ''}
          </label>`;
      }).join('');
    } catch (e) {
      console.error('[_loadStudentsChecklist]', e);
      list.innerHTML = '<div class="px-4 py-5 text-xs text-rose-400">Error al cargar estudiantes.</div>';
    }
  }
};
