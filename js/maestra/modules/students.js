import { supabase, sendPush } from '../../shared/supabase.js';
import { AppState } from '../state.js';
import { MaestraApi } from '../api.js';
import { safeToast, safeEscapeHTML, Modal } from './ui.js';

export function openStudentProfile(studentId) {
  const student = AppState.get('students').find(s => s.id == studentId);
  if (!student) return safeToast('Estudiante no encontrado', 'error');
  
  const modalId = 'studentProfileModal';
  const content = `
    <div class="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden p-8 animate-fadeIn flex flex-col max-h-[90vh]">
      <div class="flex justify-between items-start mb-8">
        <div class="flex items-center gap-6">
          <div class="w-24 h-24 rounded-3xl bg-orange-50 flex items-center justify-center text-4xl font-black text-orange-500 overflow-hidden shadow-inner">
            ${student.avatar_url ? `<img src="${student.avatar_url}" class="w-full h-full object-cover">` : student.name.charAt(0)}
          </div>
          <div>
            <h3 class="text-3xl font-black text-slate-800">${safeEscapeHTML(student.name)}</h3>
            <p class="text-xs font-black text-orange-500 uppercase tracking-widest mt-1">Ficha del Alumno</p>
          </div>
        </div>
        <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
          <i data-lucide="x" class="w-6 h-6 text-slate-400"></i>
        </button>
      </div>
      
      <div class="space-y-6 overflow-y-auto pr-2">
        <div class="bg-slate-50 p-6 rounded-3xl border border-slate-100">
          <h4 class="font-bold text-sm text-slate-400 uppercase tracking-wider mb-4">Datos del Alumno</h4>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">Alergias</span> <span class="text-rose-500 font-bold">${safeEscapeHTML(student.allergies || 'Ninguna')}</span></div>
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">Tipo de Sangre</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.blood_type || 'N/A')}</span></div>
            <div class="flex flex-col col-span-2"><span class="font-bold text-slate-400 text-xs">Personas Autorizadas para Recoger</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.authorized_pickup || 'N/A')}</span></div>
          </div>
        </div>

        <div class="bg-slate-50 p-6 rounded-3xl border border-slate-100">
          <h4 class="font-bold text-sm text-slate-400 uppercase tracking-wider mb-4">Contacto Principal (Tutor 1)</h4>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">Nombre</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p1_name || 'N/A')}</span></div>
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">Teléfono</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p1_phone || 'N/A')}</span></div>
            <div class="flex flex-col col-span-2"><span class="font-bold text-slate-400 text-xs">Email</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p1_email || 'N/A')}</span></div>
          </div>
        </div>

        ${(student.p2_name || student.p2_phone) ? `
        <div class="bg-slate-50 p-6 rounded-3xl border border-slate-100">
          <h4 class="font-bold text-sm text-slate-400 uppercase tracking-wider mb-4">Contacto Secundario (Tutor 2)</h4>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">Nombre</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p2_name || 'N/A')}</span></div>
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">Teléfono</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p2_phone || 'N/A')}</span></div>
          </div>
        </div>` : ''}
      </div>
      
      <button onclick="Modal.close('${modalId}')" class="mt-8 w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-colors">Cerrar</button>
    </div>
  `;
  Modal.open(modalId, content);
}

export function registerIncidentModal(studentId) {
  const student = AppState.get('students').find(s => s.id == studentId);
  if (!student) return safeToast('Estudiante no encontrado', 'error');
  
  const modalId = 'incidentModal';
  const content = `
    <div class="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col">
      <div class="flex justify-between items-start mb-6">
        <h3 class="text-2xl font-black text-slate-800 flex items-center gap-3">
          <span class="text-rose-500">⚠️</span>
          <span>Reportar Incidente</span>
        </h3>
        <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
          <i data-lucide="x" class="w-6 h-6 text-slate-400"></i>
        </button>
      </div>
      
      <form id="incidentForm" class="space-y-5">
        <p class="text-sm text-slate-600 bg-slate-50 p-3 rounded-xl">Reportando a: <span class="font-black text-slate-800">${safeEscapeHTML(student.name)}</span></p>
        
        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Severidad</label>
          <select id="incSeverity" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-rose-400 outline-none">
            <option value="leve">Leve</option>
            <option value="media">Media</option>
            <option value="alta">Alta</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Descripción del incidente</label>
          <textarea id="incDesc" rows="4" class="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-rose-400 outline-none resize-none" placeholder="Detalla lo sucedido de forma clara y objetiva..." required></textarea>
        </div>

        <div class="flex justify-end gap-3 pt-4">
          <button type="button" onclick="Modal.close('${modalId}')" class="px-6 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-colors">Cancelar</button>
          <button type="submit" class="px-6 py-3 rounded-xl font-bold bg-rose-500 text-white hover:bg-rose-600 shadow-lg shadow-rose-200 transition-transform active:scale-95 flex items-center gap-2">
            <i data-lucide="send" class="w-4 h-4"></i> Enviar Reporte
          </button>
        </div>
      </form>
    </div>
  `;
  Modal.open(modalId, content);

  const form = document.getElementById('incidentForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Enviando...';
    if(window.lucide) window.lucide.createIcons();
    
    try {
      const payload = {
        student_id: student.id,
        classroom_id: AppState.get('classroom').id,
        teacher_id: AppState.get('user').id,
        severity: document.getElementById('incSeverity').value,
        description: document.getElementById('incDesc').value
      };

      await MaestraApi.registerIncident(payload);
      safeToast('Incidente reportado correctamente');
      Modal.close(modalId);

      if (student.parent_id) {
        sendPush({
          user_id: student.parent_id,
          title: 'Aviso de Incidente ⚠️',
          message: `Se ha registrado un reporte de conducta sobre ${student.name}.`,
          link: 'panel_padres.html#incidents'
        }).catch(err => console.warn('Error notificando incidente:', err));
      }

      const statEl = document.getElementById('statIncidents');
      if (statEl) {
        const current = parseInt(statEl.textContent || '0', 10);
        statEl.textContent = current + 1;
      }
    } catch (err) {
      console.error('Error reporting incident:', err);
      safeToast('Error al reportar incidente.', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i> Enviar Reporte';
      if(window.lucide) window.lucide.createIcons();
    }
  };
}
