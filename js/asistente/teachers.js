import { supabase, sendEmail } from '../shared/supabase.js';
import { AssistantApi } from './api.js';
import { Helpers } from '../shared/helpers.js';

/**
 * Módulo de Gestión de Maestros para Asistente
 */
export const TeachersModule = {
  async init() {
    const btnAdd = document.getElementById('btnAddTeacher');
    if (btnAdd) btnAdd.onclick = () => this.openModal();
    
    const search = document.getElementById('teacherSearch');
    if (search) search.oninput = (e) => this.loadTeachers(e.target.value);

    const btnSave = document.getElementById('btnSaveTeacher');
    if (btnSave) btnSave.onclick = () => this.saveTeacher();

    await this.loadTeachers();
  },

  async loadTeachers(searchTerm = '') {
    const tbody = document.getElementById('teachersTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="4" class="p-8">${Helpers.skeleton(3, 'h-12')}</td></tr>`;
    
    try {
      const teachers = await AssistantApi.getTeachersDetail(searchTerm);
      if (!teachers.length) {
        tbody.innerHTML = `<tr><td colspan="4">${Helpers.emptyState('No hay maestros registrados')}</td></tr>`;
        return;
      }

      tbody.innerHTML = teachers.map(t => `
        <tr class="hover:bg-slate-50 transition-colors border-b border-slate-50">
          <td class="px-6 py-4 font-bold text-slate-700 text-sm">${Helpers.escapeHTML(t.name)}</td>
          <td class="px-6 py-4 text-slate-500 text-xs font-medium uppercase tracking-wider">${t.email || '-'}</td>
          <td class="px-6 py-4 text-slate-500 text-xs font-bold">${t.phone || '-'}</td>
          <td class="px-6 py-4">
            <div class="flex gap-1.5">
              <button onclick="window.openTeacherModal('${t.id}')" class="px-2 py-1 rounded-lg bg-teal-50 text-teal-600 text-[10px] font-black uppercase hover:bg-teal-100 transition-all border border-teal-100 flex items-center gap-1">
                <i data-lucide="edit-2" class="w-3 h-3"></i>Editar
              </button>
              <button onclick="window.App.teachers.deleteTeacher('${t.id}','${Helpers.escapeHTML(t.name)}')" class="px-2 py-1 rounded-lg bg-rose-50 text-rose-500 text-[10px] font-black uppercase hover:bg-rose-100 transition-all border border-rose-100 flex items-center gap-1">
                <i data-lucide="trash-2" class="w-3 h-3"></i>Eliminar
              </button>
            </div>
          </td>
        </tr>
      `).join('');
      
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-rose-500 py-8 font-bold text-sm">Error cargando maestros</td></tr>`;
    }
  },

  async openModal(id = null) {
    const IC = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-teal-100 focus:border-teal-400 bg-slate-50/50 transition-all text-sm font-medium';
    const LC = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';

    const html = `
      <div class="bg-gradient-to-r from-teal-600 to-emerald-600 text-white p-4 rounded-t-3xl flex items-center justify-between shrink-0">
        <div class="flex items-center gap-2">
          <div class="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center text-lg">👩‍🏫</div>
          <div>
            <h3 class="text-base font-black">${id ? 'Editar Personal' : 'Nuevo Personal'}</h3>
            <p class="text-[9px] text-white/70 font-bold uppercase tracking-widest">Maestras y Asistentes</p>
          </div>
        </div>
        <button onclick="window._closeAsistenteModal()" class="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-all">✕</button>
      </div>

      <div class="p-4 space-y-4 overflow-y-auto flex-1 custom-scrollbar" style="max-height: calc(90vh - 120px);">
        <input type="hidden" id="teacherId" value="${id || ''}">

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="sm:col-span-2">
            <label class="${LC}">Nombre completo *</label>
            <input id="teacherName" placeholder="Ej: Maria Lopez" class="${IC} py-2">
          </div>
          <div class="sm:col-span-2">
            <label class="${LC}">Correo electrónico *</label>
            <input id="teacherEmail" type="email" placeholder="usuario@karpus.com" class="${IC} py-2">
          </div>
          <div>
            <label class="${LC}">Teléfono</label>
            <input id="teacherPhone" type="tel" placeholder="Opcional" class="${IC} py-2">
          </div>
          <div>
            <label class="${LC}">Rol</label>
            <select id="teacherRole" class="${IC} py-2">
              <option value="maestra">Maestra</option>
              <option value="asistente">Asistente</option>
            </select>
          </div>
          <div class="sm:col-span-2">
            <label class="${LC}">Aula asignada</label>
            <select id="teacherClassroom" class="${IC} py-2"><option value="">-- Sin Aula --</option></select>
          </div>
          <div class="sm:col-span-2">
            <label class="${LC}">Contraseña ${id ? '(Solo si desea cambiarla)' : '(Mínimo 6 caracteres) *'}</label>
            <input id="teacherPassword" type="text" placeholder="********" class="${IC} py-2">
          </div>
          <div class="sm:col-span-2">
            <label class="flex items-center gap-3 p-3 bg-white border-2 border-slate-100 rounded-2xl cursor-pointer">
              <input type="checkbox" id="teacherActive" checked class="w-4 h-4 rounded accent-teal-600">
              <span class="text-[11px] font-black text-slate-700 uppercase">Cuenta Activa</span>
            </label>
          </div>
        </div>
      </div>

      <div class="bg-white p-4 rounded-b-3xl border-t border-slate-100 flex justify-end gap-2 shrink-0">
        <button onclick="window._closeAsistenteModal()" class="px-4 py-2 text-slate-500 font-black text-[9px] uppercase hover:bg-slate-50 rounded-xl transition-all">Cancelar</button>
        <button onclick="window._saveTeacherNow()" class="px-6 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-xl font-black text-[9px] uppercase shadow-md hover:-translate-y-0.5 transition-all active:scale-95" id="btnSaveTeacherModal">Guardar</button>
      </div>`;

    const gc = document.getElementById('globalModalContainer');
    if (gc) {
      gc.innerHTML = '<div class="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-hidden mx-3 flex flex-col">' + html + '</div>';
      gc.style.display = 'flex';
      gc.style.alignItems = 'center';
      gc.style.justifyContent = 'center';
      gc.style.zIndex = '9999';
    }

    window._closeAsistenteModal = () => {
      if (gc) { gc.style.display = 'none'; gc.innerHTML = ''; }
    };

    // Load classrooms
    try {
      const { data } = await supabase.from('classrooms').select('id, name').order('name');
      const sel = document.getElementById('teacherClassroom');
      if (sel && data) data.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); });
    } catch (_) {}

    // Prefill if editing
    if (id) {
      try {
        const { data: t } = await supabase.from('profiles').select('*').eq('id', id).single();
        if (t) {
          const sv = (eid, v) => { const el = document.getElementById(eid); if (el) el.value = v || ''; };
          sv('teacherName', t.name); sv('teacherEmail', t.email); sv('teacherPhone', t.phone);
          if (document.getElementById('teacherRole')) document.getElementById('teacherRole').value = t.role || 'maestra';
          const cb = document.getElementById('teacherActive');
          if (cb) cb.checked = t.is_active !== false;
          // Find classroom
          const { data: cls } = await supabase.from('classrooms').select('id').eq('teacher_id', id).maybeSingle();
          if (cls) document.getElementById('teacherClassroom').value = cls.id;
        }
      } catch (_) {}
    }

    window._saveTeacherNow = () => this.saveTeacher();
    // Exponer globalmente para los onclick del HTML
    window.openTeacherModal = (id) => this.openModal(id);
    if (window.lucide) window.lucide.createIcons();
  },

  async saveTeacher() {
    const gc = document.getElementById('globalModalContainer');
    const getVal = (id) => (gc?.querySelector('#' + id) || document.getElementById(id))?.value?.trim() || '';
    const getChecked = (id) => (gc?.querySelector('#' + id) || document.getElementById(id))?.checked ?? true;

    const id          = getVal('teacherId');
    const name        = getVal('teacherName');
    const email       = getVal('teacherEmail');
    const password    = getVal('teacherPassword');
    const phone       = getVal('teacherPhone');
    const role        = getVal('teacherRole') || 'maestra';
    const classroomId = getVal('teacherClassroom') || null;
    const isActive    = getChecked('teacherActive');

    if (!name || name.length < 2) { Helpers.toast('El nombre es obligatorio', 'warning'); return; }
    if (!email || !email.includes('@')) { Helpers.toast('El correo es obligatorio', 'warning'); return; }

    const btn = document.getElementById('btnSaveTeacherModal');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
      if (id) {
        const { error } = await supabase.from('profiles').update({ name, phone, email, role, is_active: isActive }).eq('id', id);
        if (error) throw error;
        // Update classroom assignment
        await supabase.from('classrooms').update({ teacher_id: null }).eq('teacher_id', id);
        if (classroomId) await supabase.from('classrooms').update({ teacher_id: id }).eq('id', classroomId);
        Helpers.toast('Maestra actualizada correctamente');
      } else {
        // Crear nuevo maestro (Usa signUp normal con persistSession: false)
        if (!password || password.length < 6) throw new Error('Contraseña requerida (min 6 caracteres)');
        
        // Use temp client to avoid logging out the current asistente session
        const { createClient: _cc } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
        const { SUPABASE_URL: _url, SUPABASE_ANON_KEY: _key } = await import('../shared/supabase.js');
        const tempClient = _cc(_url, _key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
        const { data: authData, error: authError } = await tempClient.auth.signUp({
          email: email,
          password: password,
          options: { data: { full_name: name, role: role } }
        });

        if (authError) {
          if (authError.status === 422 || authError.message?.toLowerCase().includes('already registered')) {
            // User exists — just upsert the profile with maestra role
            const { data: existing } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle();
            if (existing?.id) {
              await supabase.from('profiles').update({ name, phone, role: 'maestra' }).eq('id', existing.id);
              Helpers.toast('Perfil de maestra actualizado (usuario ya existía)');
              window._closeAsistenteModal?.();
              await this.loadTeachers();
              return;
            }
          }
          throw authError;
        }
        
        if (authData.user) {
          const { error: profError } = await supabase.from('profiles').upsert({
            id: authData.user.id,
            name, email, phone, role
          }, { onConflict: 'id' });
          if (profError) throw profError;
          // Assign classroom
          if (classroomId) await supabase.from('classrooms').update({ teacher_id: authData.user.id }).eq('id', classroomId);
          Helpers.toast('Maestro creado exitosamente');

          const html = `
            <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0f2fe; border-radius: 10px;">
              <h2 style="color: #0369a1;">¡Bienvenida al Equipo de Karpus Kids! 🍎</h2>
              <p>Hola <b>${name}</b>,</p>
              <p>Estamos emocionados de tenerte con nosotros. Se ha creado tu cuenta de acceso al Panel de Maestra.</p>
              <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <p><b>Usuario (Email):</b> ${email}</p>
                <p><b>Contraseña Temporal:</b> ${password}</p>
              </div>
              <p>Puedes acceder desde aquí: <a href="${window.location.origin}/login.html" style="color: #0369a1; font-weight: bold;">Iniciar Sesión</a></p>
              <hr style="border: none; border-top: 1px solid #e0f2fe; margin: 20px 0;">
              <p style="font-size: 12px; color: #666;">Karpus Kids - Administración</p>
            </div>
          `;
          await sendEmail(email, `Bienvenida a Karpus Kids - Credenciales de Acceso`, html);
        }
      }
      window._closeAsistenteModal?.();
      await this.loadTeachers();
    } catch (e) {
      console.error(e);
      Helpers.toast(e.message || 'Error al guardar', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar Personal'; }
    }
  },

  async deleteTeacher(id, name) {
    const ok = await (window._karpusConfirmDelete || ((t) => Promise.resolve(confirm(t))))(`¿Eliminar a ${name}?`, 'Esta acción no se puede deshacer.');
    if (!ok) return;
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', id);
      if (error) throw error;
      Helpers.toast('Maestra eliminada correctamente');
      await this.loadTeachers();
    } catch (e) {
      Helpers.toast('Error al eliminar: ' + e.message, 'error');
    }
  }
};
