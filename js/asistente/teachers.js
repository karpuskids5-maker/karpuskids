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
              <button onclick="window.openTeacherModal('${t.id}')" class="px-2 py-1 rounded-lg bg-slate-50 text-slate-400 text-[10px] font-black uppercase hover:bg-teal-50 hover:text-teal-600 transition-all border border-slate-100 hover:border-teal-100 flex items-center gap-1">
                  <i data-lucide="edit-2" class="w-3 h-3"></i>Editar
              </button>
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
    const modal = document.getElementById('modalAddTeacher');
    if (!modal) return;
    
    // Reset fields
    document.getElementById('teacherId').value = '';
    document.getElementById('teacherName').value = '';
    document.getElementById('teacherEmail').value = '';
    document.getElementById('teacherPassword').value = '';
    document.getElementById('teacherPhone').value = '';
    document.getElementById('teacherModalTitle').textContent = 'Agregar Maestro';
    document.getElementById('passHint').textContent = '(Requerida para nuevos)';

    if (id) {
        document.getElementById('teacherModalTitle').textContent = 'Editar Maestro';
        document.getElementById('passHint').textContent = '(Dejar en blanco para mantener)';
        const { data: t } = await supabase.from('profiles').select('*').eq('id', id).single();
        if (t) {
            document.getElementById('teacherId').value = t.id;
            document.getElementById('teacherName').value = t.name;
            document.getElementById('teacherEmail').value = t.email;
            document.getElementById('teacherPhone').value = t.phone;
        }
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  },

  async saveTeacher() {
    const id = document.getElementById('teacherId').value;
    const name = document.getElementById('teacherName').value;
    const email = document.getElementById('teacherEmail').value;
    const password = document.getElementById('teacherPassword').value;
    const phone = document.getElementById('teacherPhone').value;

    if (!name || !email) { Helpers.toast('Nombre y correo son obligatorios', 'error'); return; }

    const btn = document.getElementById('btnSaveTeacher');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      if (id) {
        // Actualizar perfil existente
        const { error } = await supabase.from('profiles').update({ name, phone, email }).eq('id', id);
        if (error) throw error;
        Helpers.toast('Maestro actualizado correctamente');
      } else {
        // Crear nuevo maestro (Usa Edge Function o signUp normal)
        if (!password || password.length < 6) throw new Error('Contraseña requerida (min 6 caracteres)');
        
        const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) throw authError;
        
        if (authData.user) {
          const { error: profError } = await supabase.from('profiles').insert({
              id: authData.user.id,
              name, email, phone, role: 'maestra'
          });
          if (profError) throw profError;
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
      document.getElementById('modalAddTeacher').classList.add('hidden');
      await this.loadTeachers();
    } catch (e) {
      console.error(e);
      Helpers.toast(e.message || 'Error al guardar', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  }
};
