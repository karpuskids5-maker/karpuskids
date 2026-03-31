import { supabase, sendPush } from '../../shared/supabase.js';
import { AppState } from '../state.js';
import { MaestraApi } from '../api.js';
import { safeToast, safeEscapeHTML, Modal } from './ui.js';
import { notifyParents, showNotifyFeedback } from '../../shared/notify-feedback.js';

/**
 * 📅 Asistencia
 */
export async function initAttendance() {
  const classroom = AppState.get('classroom');
  const students = AppState.get('students') || [];
  const today = new Date().toISOString().split('T')[0];
  
  try {
    const attendance = await MaestraApi.getAttendance(classroom.id, today);
    const attMap = {};
    (attendance || []).forEach(a => attMap[a.student_id] = a.status);
    
    const container = document.getElementById('attendanceList');
    if (container) {
      container.innerHTML = `
        <div class="flex justify-between items-center mb-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
          <h4 class="font-black text-slate-800">Control de Asistencia</h4>
          <button onclick="App.markAllPresent()" class="px-4 py-2 bg-emerald-500 text-white rounded-xl text-xs font-black uppercase shadow-lg hover:bg-emerald-600 transition-all flex items-center gap-2">
            <i data-lucide="check-check" class="w-4 h-4"></i> Marcar Todos
          </button>
        </div>
        <div class="space-y-3">
          ${students.map(s => {
            const currentStatus = attMap[s.id] || null;
            return `
              <div class="flex items-center justify-between p-4 bg-white rounded-3xl border border-slate-100 shadow-sm transition-all">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center font-bold text-slate-400 overflow-hidden">
                    ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
                  </div>
                  <div class="font-bold text-slate-700 text-sm">${safeEscapeHTML(s.name)}</div>
                </div>
                <div class="flex gap-2">
                  <button id="btn-${s.id}-present" onclick="App.registerAttendance('${s.id}', 'present')" class="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${currentStatus === 'present' ? 'bg-emerald-500 text-white shadow-lg' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}">Presente</button>
                  <button id="btn-${s.id}-late" onclick="App.registerAttendance('${s.id}', 'late')" class="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${currentStatus === 'late' ? 'bg-amber-500 text-white shadow-lg' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}">Tarde</button>
                  <button id="btn-${s.id}-absent" onclick="App.registerAttendance('${s.id}', 'absent')" class="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${currentStatus === 'absent' ? 'bg-rose-500 text-white shadow-lg' : 'bg-rose-50 text-rose-600 hover:bg-rose-100'}">Falta</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (err) {
    console.error(err);
  }
}

export async function markAllPresent() {
  const students = AppState.get('students') || [];
  const classroom = AppState.get('classroom');
  const today = new Date().toISOString().split('T')[0];
  
  if (!students.length) return safeToast('No hay estudiantes', 'warning');

  // Custom Confirm Modal
  const modalId = 'confirmAttendanceModal';
  const content = `
    <div class="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl p-8 animate-fadeIn text-center">
      <div class="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
        <i data-lucide="check-check" class="w-8 h-8"></i>
      </div>
      <h3 class="text-xl font-black text-slate-800 mb-2">Asistencia Masiva</h3>
      <p class="text-sm text-slate-500 mb-6 font-medium">¿Marcar a todos los alumnos como presentes hoy?</p>
      <div class="flex gap-3">
        <button onclick="Modal.close('${modalId}')" class="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold uppercase text-xs hover:bg-slate-200 transition-colors">Cancelar</button>
        <button id="btnConfirmMassAtt" class="flex-[2] py-3 bg-emerald-500 text-white rounded-xl font-bold uppercase text-xs hover:bg-emerald-600 shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2">Confirmar</button>
      </div>
    </div>
  `;
  
  Modal.open(modalId, content);
  
  document.getElementById('btnConfirmMassAtt').onclick = async () => {
    try {
      Modal.close(modalId);
      safeToast('Registrando asistencia...', 'info');

      const records = students.map(s => ({ 
        student_id: s.id, 
        classroom_id: classroom.id, 
        date: today, 
        status: 'present' 
      }));

      const results = await Promise.allSettled(
        records.map(r => MaestraApi.upsertAttendance(r))
      );

      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.error('Algunas asistencias fallaron:', failures);
        safeToast(`Se registraron ${results.length - failures.length} asistencias, ${failures.length} fallaron`, 'warning');
      } else {
        safeToast('Asistencia masiva completada');
        
        // Push with visual feedback
        notifyParents({
          students,
          title:   'Asistencia Karpus ✅',
          message: 'Tu hijo/a fue marcado como Presente hoy.',
          type:    'attendance',
          link:    'panel_padres.html',
          label:   'Asistencia del día'
        });
      }

      await initAttendance();
    } catch (e) {
      console.error('Error masivo:', e);
      safeToast('Error crítico en asistencia masiva', 'error');
    }
  };
}

export async function registerAttendance(studentId, status) {
  const classroom = AppState.get('classroom');
  const today = new Date().toISOString().split('T')[0];
  if (!studentId || !status) return;

  try {
    const btnPresent = document.getElementById(`btn-${studentId}-present`);
    const btnLate = document.getElementById(`btn-${studentId}-late`);
    const btnAbsent = document.getElementById(`btn-${studentId}-absent`);
    
    // reset visual
    [btnPresent, btnLate, btnAbsent].forEach(b => {
      if (b) {
        b.className = b.className.replace(/bg-\\w+-500 text-white shadow-lg/g, '');
        b.classList.add('bg-slate-50', 'text-slate-600');
      }
    });

    let statusLiteral = 'Ausente';
    if (status === 'present') {
      btnPresent?.classList.remove('bg-slate-50', 'text-slate-600');
      btnPresent?.classList.add('bg-emerald-500', 'text-white', 'shadow-lg');
      statusLiteral = 'Presente';
    } else if (status === 'late') {
      btnLate?.classList.remove('bg-slate-50', 'text-slate-600');
      btnLate?.classList.add('bg-amber-500', 'text-white', 'shadow-lg');
      statusLiteral = 'Tarde';
    } else {
      btnAbsent?.classList.remove('bg-slate-50', 'text-slate-600');
      btnAbsent?.classList.add('bg-rose-500', 'text-white', 'shadow-lg');
    }

    await MaestraApi.upsertAttendance({ 
      student_id: studentId, 
      classroom_id: classroom.id, 
      date: today, 
      status 
    });
    
    const student = (AppState.get('students') || []).find(s => s.id === studentId);
    if (student?.parent_id) {
      const { sendPush } = await import('../../shared/supabase.js');
      sendPush({
        user_id: student.parent_id,
        title: 'Asistencia Karpus',
        message: `${student.name} ha sido marcado como ${statusLiteral} hoy.`,
        link: 'panel_padres.html#attendance'
      }).then(res => {
        if (res?.ok !== false) showNotifyFeedback({ sent: 1, type: 'attendance', label: student.name });
      }).catch(() => {});
    }
    
    safeToast(`Asistencia: ${statusLiteral}`);
  } catch (e) {
    console.error('Error attendance:', e);
    safeToast('Error al registrar asistencia', 'error');
    await initAttendance();
  }
}
