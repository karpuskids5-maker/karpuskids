import { supabase, sendPush } from '/js/shared/supabase.js';
import { TABLES } from '/js/shared/constants.js';
import { AppState } from '../state.js';
import { MaestraApi } from '../api.js';
import { UI } from './ui.js';
import { Helpers } from '/js/shared/helpers.js';

const { safeToast, safeEscapeHTML, Modal } = UI;

export function openStudentProfile(studentId) {
  const student = AppState.get('students').find(s => s.id == studentId);
  if (!student) return safeToast('Estudiante no encontrado', 'error');
  
  const modalId = 'studentProfileModal';
  const content = `
    <div class="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden p-8 animate-fadeIn flex flex-col max-h-[90vh]">
      <div class="flex justify-between items-start mb-8">
        <div class="flex items-center gap-6">
          <div class="w-24 h-24 rounded-3xl bg-orange-50 flex items-center justify-center text-4xl font-black text-orange-500 overflow-hidden shadow-inner border-2 border-white">
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
        <!-- SECCIÃƒâ€œN QR CORPORATIVO -->
        <div class="bg-gradient-to-br from-orange-50 to-amber-50 p-6 rounded-[2rem] border-2 border-orange-100 space-y-4">
          <h4 class="text-sm font-black text-orange-800 flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center"><i data-lucide="qr-code" class="w-4 h-4"></i></div>
            CARNET DIGITAL KARPUS KIDS
          </h4>
          <div class="flex flex-col sm:flex-row items-center gap-6 bg-white p-6 rounded-3xl border border-orange-100 shadow-sm">
            <div id="student-qr-container" class="bg-white p-2 rounded-2xl border-2 border-slate-50 shadow-inner">
               <!-- El QR se genera aquÃƒ­ -->
            </div>
            <div class="flex-1 space-y-3 w-full">
              <div class="bg-slate-50 p-3 rounded-xl">
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">MatrÃƒ­cula</p>
                <p class="text-sm font-black text-slate-700">${student.matricula || 'PENDIENTE'}</p>
              </div>
              <button onclick="window._printStudentQRMaestra('${student.id}')" class="w-full py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-2">
                <i data-lucide="printer" class="w-4 h-4"></i> Imprimir Credencial
              </button>
            </div>
          </div>
        </div>

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
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">TelÃƒ©fono</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p1_phone || 'N/A')}</span></div>
            <div class="flex flex-col col-span-2"><span class="font-bold text-slate-400 text-xs">Email</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p1_email || 'N/A')}</span></div>
          </div>
        </div>

        ${(student.p2_name || student.p2_phone) ? `
        <div class="bg-slate-50 p-6 rounded-3xl border border-slate-100">
          <h4 class="font-bold text-sm text-slate-400 uppercase tracking-wider mb-4">Contacto Secundario (Tutor 2)</h4>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">Nombre</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p2_name || 'N/A')}</span></div>
            <div class="flex flex-col"><span class="font-bold text-slate-400 text-xs">TelÃƒ©fono</span> <span class="text-slate-700 font-medium">${safeEscapeHTML(student.p2_phone || 'N/A')}</span></div>
          </div>
        </div>` : ''}
      </div>
      
      <button onclick="Modal.close('${modalId}')" class="mt-8 w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-colors">Cerrar Ficha</button>
    </div>
  `;
  Modal.open(modalId, content);

  // Generar QR en el modal
  setTimeout(() => {
    const container = document.getElementById('student-qr-container');
    if (container && student.matricula && window.QRCode) {
      new QRCode(container, {
        text: student.matricula,
        width: 120,
        height: 120,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });
    }
  }, 100);

  // FunciÃƒ³n global para imprimir desde el panel maestra
  window._printStudentQRMaestra = (id) => {
    const s = AppState.get('students').find(x => x.id == id);
    const canvas = document.querySelector('#student-qr-container canvas');
    if (!canvas || !s) return;
    const imgData = canvas.toDataURL("image/png");
    const win = window.open('', '_blank');
    win.document.write(Helpers.getQRPrintTemplate(imgData, s.name, s.matricula));
    win.document.close();
  };
}

export function registerIncidentModal(studentId) {
  const student = AppState.get('students').find(s => s.id == studentId);
  if (!student) return safeToast('Estudiante no encontrado', 'error');
  
  const modalId = 'incidentModal';
  const content = `
    <div class="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col">
      <div class="flex justify-between items-start mb-6">
        <h3 class="text-2xl font-black text-slate-800 flex items-center gap-3">
          <span class="text-rose-500">Ã¢Å¡ Ã¯¸</span>
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
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">DescripciÃƒ³n del incidente</label>
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
          title: 'Aviso de Incidente Ã¢Å¡ Ã¯¸',
          message: `Se ha registrado un reporte de conducta sobre ${student.name}.`,
          link: 'panel_padres.html#incidents'
        }).catch(() => {});
      }

      const statEl = document.getElementById('statIncidents');
      if (statEl) {
        const current = parseInt(statEl.textContent || '0', 10);
        statEl.textContent = current + 1;
      }
    } catch (err) {
      safeToast('Error al reportar incidente.', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i> Enviar Reporte';
      if(window.lucide) window.lucide.createIcons();
    }
  };
}
