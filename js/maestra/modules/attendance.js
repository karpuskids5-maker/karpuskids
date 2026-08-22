import { supabase, emitEvent } from '/js/shared/supabase.js';
import { AppState } from '../state.js';
import { MaestraApi } from '../api.js';
import { UI } from './ui.js';
import { notifyParents } from '/js/shared/notify-feedback.js';
import { OfflineQueue } from '/js/shared/offline-queue.js';
import { Helpers } from '/js/shared/helpers.js';

const { safeToast, safeEscapeHTML, Modal } = UI;

// Start auto-sync when online
OfflineQueue.startAutoSync(({ synced }) => {
  safeToast(`✅ ${synced} registro(s) de asistencia sincronizados`, 'success');
});

/**
 * 📅 Asistencia — carga el panel y las solicitudes de ausencia pendientes
 */
export async function initAttendance(options = {}) {
  const classroom = AppState.get('classroom');
  const students = AppState.get('students') || []; // Usamos estudiantes ya cargados
  const today = new Date().toISOString().split('T')[0];

  const listContainer = document.getElementById('attendanceList');
  
  if (!listContainer) return;

  // Feedback visual inmediato (omitido en refrescos silenciosos)
  if (!options.silent) {
    listContainer.innerHTML = `
      <div class="hidden md:block bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden mb-20">
        <table class="w-full">
          <tbody class="divide-y divide-slate-50">
            ${UI.Skeleton.render('tableRow', 6)}
          </tbody>
        </table>
      </div>
      <div class="md:hidden grid grid-cols-2 gap-3 mb-20">
        ${UI.Skeleton.render('card', 4)}
      </div>
    `;
  }

  try {
    // 1. Cargar solicitudes y asistencia en paralelo
    const [_, attendance] = await Promise.all([
      _loadAbsenceRequests(classroom?.id, students),
      MaestraApi.getAttendance(classroom.id, today)
    ]);

    // ✅ Sync AppState so the routine module detects present students
    AppState.set('attendance', attendance || []);

    const attMap = {};
    (attendance || []).forEach(a => attMap[a.student_id] = a.status);
    
    listContainer.innerHTML = `
        <div class="flex justify-between items-center mb-6 bg-white p-5 rounded-[2rem] shadow-sm border border-slate-100">
          <div>
            <h4 class="font-black text-slate-800 text-lg">Control de Asistencia</h4>
            <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Gestión diaria de presencia en aula</p>
          </div>
          <button onclick="App.markAllPresent()" class="px-6 py-3 bg-emerald-500 text-white rounded-2xl text-xs font-black uppercase shadow-lg shadow-emerald-100 hover:bg-emerald-600 transition-all flex items-center gap-2 active:scale-95">
            <i data-lucide="check-check" class="w-4 h-4"></i> Marcar Todos
          </button>
        </div>

        <!-- 🖥️ VISTA TABLA (DESKTOP) -->
        <div class="hidden md:block bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden mb-20">
          <table class="w-full">
            <thead>
              <tr class="bg-slate-50/50 border-b border-slate-100">
                <th class="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Estudiante</th>
                <th class="px-6 py-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Estado Actual</th>
                <th class="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Acciones Rápidas</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-50">
              ${students.map(s => {
                const currentStatus = attMap[s.id] || null;
                const statusMap = {
                  'present': { l: 'Presente', c: 'bg-emerald-100 text-emerald-700', i: 'check' },
                  'late':    { l: 'Tardanza', c: 'bg-amber-100 text-amber-700',   i: 'clock' },
                  'absent':  { l: 'Ausente',  c: 'bg-rose-100 text-rose-700',     i: 'x' }
                };
                const st = statusMap[currentStatus] || { l: 'Sin marcar', c: 'bg-slate-100 text-slate-400', i: 'minus' };

                return `
                  <tr class="hover:bg-slate-50/50 transition-colors">
                    <td class="px-6 py-4">
                      <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center font-black text-sm border-2 border-white shadow-sm overflow-hidden">
                          ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
                        </div>
                        <div class="font-bold text-slate-700 text-sm">${safeEscapeHTML(s.name)}</div>
                      </div>
                    </td>
                    <td class="px-6 py-4 text-center">
                      <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase ${st.c}">
                        <i data-lucide="${st.i}" class="w-3 h-3"></i> ${st.l}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-right">
                      <div class="flex justify-end gap-2">
                        <button id="btn-${s.id}-present" onclick="App.registerAttendance('${s.id}', 'present')" class="w-9 h-9 rounded-xl flex items-center justify-center transition-all ${currentStatus === 'present' ? 'bg-emerald-500 text-white shadow-lg' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}" title="Presente">
                          <i data-lucide="check" class="w-4 h-4"></i>
                        </button>
                        <button id="btn-${s.id}-late" onclick="App.registerAttendance('${s.id}', 'late')" class="w-9 h-9 rounded-xl flex items-center justify-center transition-all ${currentStatus === 'late' ? 'bg-amber-500 text-white shadow-lg' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}" title="Tardanza">
                          <i data-lucide="clock" class="w-4 h-4"></i>
                        </button>
                        <button id="btn-${s.id}-absent" onclick="App.registerAttendance('${s.id}', 'absent')" class="w-9 h-9 rounded-xl flex items-center justify-center transition-all ${currentStatus === 'absent' ? 'bg-rose-500 text-white shadow-lg' : 'bg-rose-50 text-rose-600 hover:bg-rose-100'}" title="Falta">
                          <i data-lucide="user-x" class="w-4 h-4"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- 📱 VISTA TARJETAS (MÓVIL) -->
        <div class="md:hidden grid grid-cols-2 gap-3 mb-20">
          ${students.map(s => {
            const currentStatus = attMap[s.id] || null;
            const statusColor = currentStatus === 'present' ? 'ring-emerald-500 ring-4' : currentStatus === 'late' ? 'ring-amber-500 ring-4' : currentStatus === 'absent' ? 'opacity-40 grayscale' : 'ring-slate-100 ring-2';
            
            return `
              <div class="bg-white p-4 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col items-center text-center gap-3 transition-all active:scale-95" onclick="App.registerAttendance('${s.id}', '${currentStatus === 'present' ? 'late' : currentStatus === 'late' ? 'absent' : 'present'}')">
                <div class="relative w-20 h-20 rounded-[1.5rem] overflow-hidden ${statusColor} transition-all duration-300">
                  ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : `<div class="w-full h-full flex items-center justify-center bg-orange-50 text-orange-500 font-black text-2xl">${s.name.charAt(0)}</div>`}
                  ${currentStatus === 'present' ? '<div class="absolute inset-0 bg-emerald-500/20 flex items-center justify-center"><i data-lucide="check" class="text-white w-8 h-8 drop-shadow-md"></i></div>' : ''}
                  ${currentStatus === 'late' ? '<div class="absolute inset-0 bg-amber-500/20 flex items-center justify-center"><i data-lucide="clock" class="text-white w-8 h-8 drop-shadow-md"></i></div>' : ''}
                </div>
                <div class="min-w-0">
                  <p class="font-black text-slate-800 text-xs truncate w-full px-2 uppercase tracking-tight">${safeEscapeHTML(s.name.split(' ')[0])}</p>
                  <p class="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">${currentStatus || 'Sin marcar'}</p>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    Helpers.safeLog('error', 'Error en initAttendance:', err);
    listContainer.innerHTML = Helpers.errorState('Error al cargar asistencia');
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

      // 1. Obtener asistencia actual para no sobrescribir "Tardanza"
      const currentAttendance = await MaestraApi.getAttendance(classroom.id, today);
      const attMap = {};
      (currentAttendance || []).forEach(a => attMap[a.student_id] = a.status);

      const records = [];
      const studentsToNotify = [];

      students.forEach(s => {
        const existingStatus = attMap[s.id];
        // Solo registrar si NO hay asistencia o si estaba marcado como Ausente
        if (!existingStatus || existingStatus === 'absent') {
          records.push({ 
            student_id: Number(s.id), 
            classroom_id: Number(classroom.id), 
            date: today, 
            status: 'present' 
          });
        }
        // Siempre notificar presencia en aula si no es Ausente
        if (existingStatus !== 'absent') {
          studentsToNotify.push(s);
        }
      });

      if (records.length > 0) {
      if (navigator.onLine) {
        await Promise.allSettled(records.map(r => MaestraApi.upsertAttendance(r)));
      } else {
        // Encolar todos los registros individualmente
        for (const r of records) {
          await OfflineQueue.enqueue('attendance', 'upsert', { ...r, onConflict: 'student_id,date' });
        }
        safeToast(`${records.length} registros guardados sin conexión — se sincronizarán pronto`, 'info');
      }
      // ✅ Sync AppState so routine module detects all present students immediately
      const bulkAtt = AppState.get('attendance') || [];
      const updatedBulkAtt = [...bulkAtt];
      records.forEach(r => {
        const rid = Number(r.student_id);
        const idx = updatedBulkAtt.findIndex(a => Number(a.student_id) === rid);
        if (idx >= 0) updatedBulkAtt[idx] = { ...updatedBulkAtt[idx], status: r.status };
        else updatedBulkAtt.push({ student_id: rid, status: r.status });
      });
      AppState.set('attendance', updatedBulkAtt);
    }

      safeToast('Asistencia masiva completada');
      
      // Notificar a los padres (Presence in classroom)
      if (studentsToNotify.length > 0) {
        notifyParents({
          students: studentsToNotify,
          title:   'Karpus Kids ✅',
          message: 'Tu hijo/a ya se encuentra presente en su aula con su maestra.',
          type:    'attendance',
          link:    'panel_padres.html',
          label:   'Presencia en aula'
        });
      }

      await initAttendance();
    } catch (e) {
      safeToast('Error crítico en asistencia masiva', 'error');
    }
  };
}

// 👆 Handlers para experiencia de asistencia Premium (Tocar/Mantener)
let attendanceLongPressTimer = null;
const _pendingAttendance = new Set();

export function handleAttendancePointerDown(e, studentId) {
  attendanceLongPressTimer = setTimeout(() => {
    attendanceLongPressTimer = null;
    Helpers.vibrate('heavy');
    registerAttendance(studentId, 'late');
  }, 600); // 600ms para marcar como tarde
}

export function handleAttendancePointerUp(e, studentId) {
  if (attendanceLongPressTimer) {
    clearTimeout(attendanceLongPressTimer);
    attendanceLongPressTimer = null;
    Helpers.vibrate('light');
    registerAttendance(studentId, 'present');
  }
}

export async function registerAttendance(studentId, status) {
  if (_pendingAttendance.has(studentId)) return;
  _pendingAttendance.add(studentId);
  const classroom = AppState.get('classroom');
  const today = new Date().toISOString().split('T')[0];
  if (!studentId || !status) return;

  // ✅ OPTIMISTIC UI: Feedback visual inmediato
  const btnPresent = document.getElementById(`btn-${studentId}-present`);
  const btnLate = document.getElementById(`btn-${studentId}-late`);
  const btnAbsent = document.getElementById(`btn-${studentId}-absent`);
  const prevStates = [btnPresent, btnLate, btnAbsent].map(b => ({ cls: b?.className, id: b?.id }));

  const updateUI = (newStatus) => {
    [btnPresent, btnLate, btnAbsent].forEach(b => {
      if (b) {
        b.className = b.className.replace(/bg-\w+-500 text-white shadow-lg/g, '');
        b.classList.add('bg-slate-50', 'text-slate-600');
      }
    });
    if (newStatus === 'present') {
      btnPresent?.classList.remove('bg-slate-50', 'text-slate-600');
      btnPresent?.classList.add('bg-emerald-500', 'text-white', 'shadow-lg');
    } else if (newStatus === 'late') {
      btnLate?.classList.remove('bg-slate-50', 'text-slate-600');
      btnLate?.classList.add('bg-amber-500', 'text-white', 'shadow-lg');
    } else if (newStatus === 'absent') {
      btnAbsent?.classList.remove('bg-slate-50', 'text-slate-600');
      btnAbsent?.classList.add('bg-rose-500', 'text-white', 'shadow-lg');
    }
  };

  updateUI(status);

  try {
    let statusLiteral = status === 'present' ? 'Presente' : status === 'late' ? 'Tarde' : 'Ausente';
    const now = new Date().toISOString();

    const attRecord = { student_id: studentId, classroom_id: classroom?.id, date: today, status };
    // Record real arrival/departure time
    if (status === 'present' || status === 'late') {
      attRecord.check_in = now;
    } else if (status === 'absent') {
      attRecord.check_out = now;
    }
    if (!attRecord.classroom_id) {
      safeToast('Error: no hay aula asignada', 'error');
      return;
    }
    if (navigator.onLine) {
      await MaestraApi.upsertAttendance(attRecord);
    } else {
      await OfflineQueue.enqueue('attendance', 'upsert', { ...attRecord, onConflict: 'student_id,date' });
      safeToast(`${statusLiteral} guardado sin conexión`, 'info');
    }

    const student = (AppState.get('students') || []).find(s => s.id === studentId);

    // 🔔 PUSH a las cuentas de padres vinculadas + banner de confirmación
    //    (mismo patrón que publicaciones y tareas)
    notifyParents({
      students: student ? [student] : [],
      title: 'Asistencia Karpus',
      message: `${student?.name || 'El estudiante'} fue marcado como ${statusLiteral} hoy.`,
      type: 'attendance',
      link: '/panel_padres.html#attendance',
      label: student?.name || ''
    }).catch(() => {});

    // 📧 EMAIL a los correos de notificación del estudiante vía process-event.
    //    Se envía SIEMPRE (con o sin cuenta de padre vinculada): el backend
    //    resuelve p1_email/p2_email desde student_id.
    emitEvent('attendance.marked', {
      student_id: studentId,
      student_name: student?.name || '',
      status
    }).catch(() => {});

    // ✅ Sync AppState so routine module detects the presence change immediately
    const currentAtt = AppState.get('attendance') || [];
    const numStudentId = Number(studentId);
    const updatedAtt = currentAtt.filter(a => Number(a.student_id) !== numStudentId);
    updatedAtt.push({ student_id: numStudentId, status, check_in: status !== 'absent' ? now : null });
    AppState.set('attendance', updatedAtt);

    safeToast(`Asistencia: ${statusLiteral}`);
    await initAttendance({ silent: true });
  } catch (e) {
    // Revertir UI si falla
    prevStates.forEach(s => {
      const b = document.getElementById(s.id);
      if (b) b.className = s.cls;
    });
    const msg = e?.message || e?.error?.message || 'Error desconocido';
    Helpers.safeLog('error', 'Error al registrar asistencia:', e);
    safeToast('Error al registrar asistencia: ' + msg, 'error');
    await initAttendance();
  } finally {
    _pendingAttendance.delete(studentId);
  }
}

/**
 * 📋 Cargar solicitudes de ausencia pendientes de los padres
 */
async function _loadAbsenceRequests(classroomId, students) {
  if (!classroomId) return;

  try {
    const studentIds = students.map(s => s.id);
    if (!studentIds.length) return;

    const { data: requests, error } = await supabase
      .from('attendance_requests')
      .select('*, student:student_id(name)')
      .in('student_id', studentIds)
      .eq('status', 'pending')
      .order('date', { ascending: true });

    if (error || !requests?.length) return;

    // Mostrar banner de avisos pendientes
    const container = document.getElementById('attendanceList');
    if (!container) return;

    const banner = document.createElement('div');
    banner.id = 'absence-requests-banner';
    banner.className = 'mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-4';
    banner.innerHTML = `
      <div class="flex items-center gap-2 mb-3">
        <span class="text-lg">📋</span>
        <h4 class="font-black text-amber-800 text-sm uppercase tracking-wider">Avisos de Ausencia (${requests.length})</h4>
      </div>
      <div class="space-y-2">
        ${requests.map(r => `
          <div class="bg-white rounded-xl p-3 border border-amber-100 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="font-bold text-slate-800 text-sm truncate">${safeEscapeHTML(r.student?.name || 'Estudiante')}</p>
              <p class="text-[10px] text-slate-500 font-bold">
                ${new Date(r.date + 'T12:00:00').toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'short' })}
                · ${safeEscapeHTML(r.reason)}
                ${r.note ? ' · ' + safeEscapeHTML(r.note) : ''}
              </p>
            </div>
            <button
              onclick="window._approveAbsence('${r.id}', '${r.student_id}', '${r.date}')"
              class="shrink-0 px-3 py-1.5 bg-emerald-500 text-white rounded-xl text-[10px] font-black uppercase hover:bg-emerald-600 transition-all active:scale-95">
              Registrar
            </button>
          </div>
        `).join('')}
      </div>`;

    // Insertar antes del contenido de asistencia
    const existing = document.getElementById('absence-requests-banner');
    if (existing) existing.remove();
    container.parentElement?.insertBefore(banner, container);

    // Función global para aprobar ausencia
    window._approveAbsence = async (requestId, studentId, date) => {
      try {
        const classroom = AppState.get('classroom');
        // Registrar como ausente en attendance
        await MaestraApi.upsertAttendance({
          student_id:   Number(studentId),
          classroom_id: Number(classroom.id),
          date,
          status:       'absent'
        });
        // Marcar solicitud como aprobada
        await supabase.from('attendance_requests').update({ status: 'approved' }).eq('id', requestId);
        safeToast('Ausencia registrada correctamente');
        // Recargar
        await initAttendance();
      } catch (e) {
        safeToast('Error al registrar ausencia: ' + e.message, 'error');
      }
    };

    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
  }
}

/**
 * 📋 Reporte del día — resumen de asistencia en modal
 */
export async function openDailyReport() {
  const modalId = 'dailyReportModal';
  const classroom = AppState.get('classroom');
  const students = AppState.get('students') || [];
  const today = new Date().toISOString().split('T')[0];

  Modal.open(modalId, `
    <div class="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl p-8 animate-fadeIn flex flex-col max-h-[90vh]">
      <div class="flex justify-between items-start mb-6">
        <div class="min-w-0">
          <h3 class="text-2xl font-black text-slate-800 flex items-center gap-2"><i data-lucide="clipboard-list" class="w-6 h-6 text-orange-500"></i> Reporte del Día</h3>
          <p class="text-xs font-bold text-slate-400 mt-1 truncate">${safeEscapeHTML(classroom?.name || 'Aula')} — ${new Date(today + 'T12:00:00').toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <button onclick="Modal.close('${modalId}')" class="p-2 hover:bg-slate-100 rounded-full transition-colors shrink-0"><i data-lucide="x" class="w-6 h-6 text-slate-400"></i></button>
      </div>
      <div data-report-body class="flex-1 overflow-y-auto pr-1 space-y-4">
        <div class="grid grid-cols-4 gap-2 animate-pulse">
          <div class="h-16 bg-slate-50 rounded-2xl"></div>
          <div class="h-16 bg-slate-50 rounded-2xl"></div>
          <div class="h-16 bg-slate-50 rounded-2xl"></div>
          <div class="h-16 bg-slate-50 rounded-2xl"></div>
        </div>
        <div class="space-y-2 animate-pulse">
          <div class="h-12 bg-slate-50 rounded-2xl"></div>
          <div class="h-12 bg-slate-50 rounded-2xl"></div>
          <div class="h-12 bg-slate-50 rounded-2xl"></div>
        </div>
      </div>
    </div>
  `);

  try {
    const attendance = await MaestraApi.getAttendance(classroom.id, today);
    const attMap = {};
    (attendance || []).forEach(a => attMap[a.student_id] = a.status);

    const counts = { present: 0, late: 0, absent: 0, unmarked: 0 };
    students.forEach(s => {
      const st = attMap[s.id];
      if (st === 'present') counts.present++;
      else if (st === 'late') counts.late++;
      else if (st === 'absent') counts.absent++;
      else counts.unmarked++;
    });

    const statusMap = {
      'present': { l: 'Presente', c: 'bg-emerald-100 text-emerald-700', i: 'check' },
      'late':    { l: 'Tardanza', c: 'bg-amber-100 text-amber-700',   i: 'clock' },
      'absent':  { l: 'Ausente',  c: 'bg-rose-100 text-rose-700',     i: 'x' }
    };

    const rowsHtml = students.map(s => {
      const st = statusMap[attMap[s.id]] || { l: 'Sin marcar', c: 'bg-slate-100 text-slate-400', i: 'minus' };
      return `
        <div class="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-9 h-9 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center font-black text-sm overflow-hidden shrink-0">
              ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : safeEscapeHTML((s.name || '?').charAt(0))}
            </div>
            <div class="min-w-0">
              <p class="font-black text-slate-800 text-sm truncate">${safeEscapeHTML(s.name)}</p>
              <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest">${safeEscapeHTML(s.matricula || '')}</p>
            </div>
          </div>
          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase shrink-0 ${st.c}"><i data-lucide="${st.i}" class="w-3 h-3"></i> ${st.l}</span>
        </div>`;
    }).join('');

    const inner = document.getElementById(`${modalId}-inner`);
    const body = inner?.querySelector('[data-report-body]');
    if (body) {
      body.innerHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div class="p-3 bg-emerald-50 rounded-2xl text-center">
            <p class="text-2xl font-black text-emerald-600">${counts.present}</p>
            <p class="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Presentes</p>
          </div>
          <div class="p-3 bg-amber-50 rounded-2xl text-center">
            <p class="text-2xl font-black text-amber-600">${counts.late}</p>
            <p class="text-[9px] font-black text-amber-600 uppercase tracking-widest">Tardanzas</p>
          </div>
          <div class="p-3 bg-rose-50 rounded-2xl text-center">
            <p class="text-2xl font-black text-rose-600">${counts.absent}</p>
            <p class="text-[9px] font-black text-rose-600 uppercase tracking-widest">Ausentes</p>
          </div>
          <div class="p-3 bg-slate-100 rounded-2xl text-center">
            <p class="text-2xl font-black text-slate-500">${counts.unmarked}</p>
            <p class="text-[9px] font-black text-slate-500 uppercase tracking-widest">Sin marcar</p>
          </div>
        </div>
        <div class="space-y-2">${rowsHtml}</div>`;
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (e) {
    safeToast('Error al generar el reporte: ' + (e.message || ''), 'error');
  }
}
