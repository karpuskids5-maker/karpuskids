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
      <div class="bg-gradient-to-r from-teal-600 to-emerald-600 text-white p-6 rounded-t-3xl flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">👩‍🏫</div>
          <div>
            <h3 class="text-xl font-black">${id ? 'Editar Maestra' : 'Gestión de Personal'}</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Maestras y Asistentes</p>
          </div>
        </div>
        <button onclick="window._closeAsistenteModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20">✕</button>
      </div>

      <div class="p-6 space-y-4">
        <input type="hidden" id="teacherId" value="${id || ''}">

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="sm:col-span-2"><label class="${LC}">Nombre completo</label><input id="teacherName" placeholder="Ej: Maria Lopez" class="${IC}"></div>
          <div><label class="${LC}">Correo electrónico</label><input id="teacherEmail" type="email" placeholder="usuario@karpus.com" class="${IC}"></div>
          <div><label class="${LC}">Teléfono</label><input id="teacherPhone" type="tel" placeholder="Opcional" class="${IC}"></div>
          <div class="sm:col-span-2">
            <label class="${LC}">Contraseña (Mínimo 6 caracteres) <span class="normal-case font-normal text-slate-300">* Solo requerida para nuevos usuarios</span></label>
            <input id="teacherPassword" type="text" placeholder="Crear contraseña de acceso" class="${IC}">
          </div>
          <div><label class="${LC}">Rol</label>
            <select id="teacherRole" class="${IC}">
              <option value="maestra">Maestra</option>
              <option value="asistente">Asistente</option>
            </select>
          </div>
          <div><label class="${LC}">Aula asignada</label>
            <select id="teacherClassroom" class="${IC}"><option value="">Seleccionar Aula</option></select>
          </div>
          <div class="sm:col-span-2">
            <label class="flex items-center gap-3 p-3 bg-white border-2 border-slate-100 rounded-2xl cursor-pointer">
              <input type="checkbox" id="teacherActive" checked class="w-5 h-5 rounded accent-rose-500">
              <span class="text-sm font-bold text-slate-700">Cuenta Activa</span>
            </label>
          </div>
        </div>
      </div>

      <div class="bg-white p-5 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">
        <button onclick="window._closeAsistenteModal()" class="px-6 py-2.5 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
        <button id="btnSaveTeacherModal" class="px-8 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg hover:-translate-y-0.5 transition-all active:scale-95">Guardar Personal</button>
      </div>`;

    const gc = document.getElementById('globalModalContainer');
    if (gc) {
      gc.innerHTML = '<div class="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden mx-3">' + html + '</div>';
      gc.style.display = 'flex';
      gc.style.alignItems = 'flex-start';
      gc.style.justifyContent = 'center';
      gc.style.paddingTop = '5vh';
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

    document.getElementById('btnSaveTeacherModal')?.addEventListener('click', () => this.saveTeacher());
    if (window.lucide) window.lucide.createIcons();
  },

  async saveTeacher() {
    const id       = document.getElementById('teacherId')?.value;
    const name     = document.getElementById('teacherName')?.value?.trim();
    const email    = document.getElementById('teacherEmail')?.value?.trim();
    const password = document.getElementById('teacherPassword')?.value?.trim();
    const phone    = document.getElementById('teacherPhone')?.value?.trim();
    const role     = document.getElementById('teacherRole')?.value || 'maestra';
    const classroomId = document.getElementById('teacherClassroom')?.value || null;
    const isActive = document.getElementById('teacherActive')?.checked ?? true;

    if (!name || !email) { Helpers.toast('Nombre y correo son obligatorios', 'error'); return; }

    const btn = document.getElementById('btnSaveTeacherModal');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
      if (id) {
        const { error } = await supabase.from('profiles').update({ name, phone, email, role }).eq('id', id);
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
