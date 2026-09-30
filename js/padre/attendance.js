import { supabase } from '../shared/supabase.js';
import { Helpers } from './helpers.js';
import { AppState } from './appState.js';
import { emitEvent, sendPush } from '../shared/supabase.js';

export const AttendanceModule = {
  _studentId: null,
  _attendance: [],
  _requests: [],

  async init(studentId) {
    // Usar el studentId pasado como parámetro — no buscar en auth
    if (studentId) this._studentId = studentId;
    if (!this._studentId) return;

    const filter = document.getElementById('attendanceFilter');
    if (filter && !filter._initialized) {
      filter._initialized = true;
      filter.addEventListener('change', (e) => {
        const now = new Date();
        const val = e.target.value; // 'semana' | 'mes' | 'YYYY-MM'
        if (val === 'semana') {
          // Últimos 7 días — mostrar mes actual
          this.loadAttendance(now.getFullYear(), now.getMonth() + 1);
        } else if (val === 'mes') {
          this.loadAttendance(now.getFullYear(), now.getMonth() + 1);
        } else if (val && val.includes('-')) {
          // Formato "YYYY-MM" para meses específicos
          const [y, m] = val.split('-').map(Number);
          this.loadAttendance(y, m);
        }
      });

      // Poblar opciones de los últimos 6 meses
      const now = new Date();
      for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        const label = d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label.charAt(0).toUpperCase() + label.slice(1);
        if (i === 0) opt.selected = true;
        filter.appendChild(opt);
      }
    }

    // 🔁 Respetar la selección previa del usuario (no reiniciar al mes actual)
    const now = new Date();
    const savedVal = filter?.value || '';
    if (/^\d{4}-\d{2}$/.test(savedVal)) {
      const [y, m] = savedVal.split('-').map(Number);
      await this.loadAttendance(y, m);
    } else {
      await this.loadAttendance(now.getFullYear(), now.getMonth() + 1);
    }

    // ── Inicializar formulario de ausencia ──────────────────────────────────
    this._initAbsenceForm();
  },

  _initAbsenceForm() {
    const form = document.getElementById('formAbsence');
    if (!form || form._initialized) return;
    form._initialized = true;

    // Fecha por defecto: hoy
    const dateInput = document.getElementById('absenceDate');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }

    // Selector visual de motivos
    document.querySelectorAll('.reason-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.reason-btn').forEach(b => {
          b.classList.remove('border-emerald-400', 'bg-emerald-50', 'text-emerald-700');
          b.classList.add('border-slate-50', 'bg-slate-50', 'text-slate-600');
        });
        btn.classList.add('border-emerald-400', 'bg-emerald-50', 'text-emerald-700');
        btn.classList.remove('border-slate-50', 'bg-slate-50', 'text-slate-600');
        const hidden = document.getElementById('absenceReason');
        if (hidden) hidden.value = btn.dataset.value;
      });
    });

    // Cerrar modal
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('modalAbsence')?.classList.add('hidden');
        document.getElementById('modalAbsence')?.classList.remove('flex');
      });
    });

    // Submit
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this._submitAbsence();
    });
  },

  async _submitAbsence() {
    const date   = document.getElementById('absenceDate')?.value;
    const reason = document.getElementById('absenceReason')?.value;
    const note   = document.getElementById('absenceNote')?.value?.trim() || null;
    const btn    = document.querySelector('#formAbsence button[type="submit"]');

    if (!date) { Helpers.toast('Selecciona la fecha', 'warning'); return; }
    if (!reason) { Helpers.toast('Selecciona el motivo', 'warning'); return; }

    const student = AppState.get('currentStudent');
    if (!student) { Helpers.toast('No se encontró el estudiante', 'error'); return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

    try {
      // 1. Guardar en attendance_requests
      const { error } = await supabase.from('attendance_requests').insert({
        student_id: student.id,
        date,
        reason,
        note,
        status: 'pending'
      });
      if (error) throw error;

      // 2. Notificar a la maestra y directora
      const classroomId = student.classroom_id;
      if (classroomId) {
        // Obtener maestra del aula
        const { data: classroom } = await supabase
          .from('classrooms')
          .select('teacher_id, name')
          .eq('id', classroomId)
          .maybeSingle();

        const notifyIds = [];
        if (classroom?.teacher_id) notifyIds.push(classroom.teacher_id);

        // Obtener directoras y asistentes
        const { data: staff } = await supabase
          .from('profiles')
          .select('id')
          .in('role', ['directora', 'asistente']);
        (staff || []).forEach(s => {
          if (!notifyIds.includes(s.id)) notifyIds.push(s.id);
        });

        const msg = `${student.name} no asistirá el ${new Date(date + 'T12:00:00').toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })}. Motivo: ${reason}${note ? '. ' + note : ''}`;

        for (const uid of notifyIds) {
          sendPush({
            user_id: uid,
            title:   `📅 Aviso de Ausencia — ${student.name}`,
            message: msg,
            type:    'attendance',
            link:    'panel-maestra.html'
          }).catch(err => console.warn('No se pudo enviar push de ausencia:', err));
        }

        // Emitir evento para email
        emitEvent('attendance.marked', {
          parent_id:    AppState.get('user')?.id,
          student_name: student.name,
          status:       'absent',
          date,
          reason,
          note
        }).catch(err => console.warn('No se pudo emitir evento de asistencia:', err));
      }

      // 3. Cerrar modal y mostrar confirmación
      document.getElementById('modalAbsence')?.classList.add('hidden');
      document.getElementById('modalAbsence')?.classList.remove('flex');
      document.getElementById('formAbsence')?.reset();
      document.querySelectorAll('.reason-btn').forEach(b => {
        b.classList.remove('border-emerald-400', 'bg-emerald-50', 'text-emerald-700');
        b.classList.add('border-slate-50', 'bg-slate-50', 'text-slate-600');
      });

      Helpers.toast('Aviso enviado a la maestra y dirección ✅', 'success');

    } catch (err) {
      Helpers.toast('Error al enviar: ' + (err.message || ''), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="send" class="w-5 h-5"></i> Enviar a la Maestra'; if(window.lucide) lucide.createIcons(); }
    }
  },

  async loadAttendance(year, month) {
    const calendar     = document.getElementById('calendarGrid');
    const statsPresent = document.getElementById('attPresent');
    const statsLate    = document.getElementById('attLate');
    const statsAbsent  = document.getElementById('attAbsent');

    if (calendar) {
      calendar.innerHTML = Helpers.skeleton(5, 'h-10');
    }

    try {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay   = new Date(year, month, 0).getDate();
      const endDate   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const [attRes, reqRes] = await Promise.all([
        supabase
          .from('attendance')
          .select('id, student_id, date, status, check_in, check_out, absence_reason')
          .eq('student_id', this._studentId)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: true }),
        supabase
          .from('attendance_requests')
          .select('id, date, reason, note, status')
          .eq('student_id', this._studentId)
          .gte('date', startDate)
          .lte('date', endDate)
      ]);

      if (attRes.error) throw attRes.error;

      this._attendance = attRes.data || [];
      this._requests   = reqRes.data || [];

      // KPIs — Normalizar estados para conteo robusto y asegurar que sean números
      const present = this._attendance.filter(a => ['present', 'presente'].includes(a.status?.toLowerCase())).length;
      const late    = this._attendance.filter(a => ['late', 'tarde'].includes(a.status?.toLowerCase())).length;
      const absent  = this._attendance.filter(a => ['absent', 'ausente'].includes(a.status?.toLowerCase())).length;

      if (statsPresent) statsPresent.textContent = present;
      if (statsLate)    statsLate.textContent    = late;
      if (statsAbsent)  statsAbsent.textContent  = absent;

      this.renderTodayBanner();
      this.renderCalendar(year, month);
      this.renderList(this._attendance);

    } catch (err) {
      if (calendar) {
        calendar.innerHTML = Helpers.emptyState('Error al cargar asistencia', '❌');
      }
    }
  },

  renderTodayBanner() {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayAtt = this._attendance.find(a => a.date === todayStr);
    const todayReq = this._requests.find(r => r.date === todayStr);

    let bannerContainer = document.getElementById('todayAbsenceBannerContainer');
    if (!bannerContainer) {
      const attHeader = document.getElementById('sec-asistencia');
      if (attHeader) {
        bannerContainer = document.createElement('div');
        bannerContainer.id = 'todayAbsenceBannerContainer';
        bannerContainer.className = 'mb-6';
        attHeader.prepend(bannerContainer);
      }
    }

    if (!bannerContainer) return;

    const isAbsent = todayAtt && ['absent', 'ausente'].includes(todayAtt.status?.toLowerCase());
    if (!isAbsent && !todayReq) {
      bannerContainer.innerHTML = '';
      return;
    }

    const reason = todayReq?.reason || todayAtt?.absence_reason || 'Sin motivo reportado por los padres';
    const note = todayReq?.note || '';
    const isParentReported = Boolean(todayReq || (todayAtt?.absence_reason && !todayAtt.absence_reason.includes('Automática')));

    const bgClass   = isParentReported ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-rose-50 border-rose-200 text-rose-900';
    const badgeCls  = isParentReported ? 'bg-blue-600 text-white' : 'bg-rose-600 text-white';
    const titleText = isParentReported ? 'Aviso de Ausencia Notificado por Padre' : 'Registro de Ausencia Automática del Día';

    bannerContainer.innerHTML = `
      <div class="p-5 rounded-3xl border ${bgClass} shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-2xl ${badgeCls} flex items-center justify-center shrink-0 text-lg font-black shadow-sm">
            ${isParentReported ? '📋' : '⏰'}
          </div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-black uppercase tracking-wider ${badgeCls} px-2.5 py-0.5 rounded-full">${titleText}</span>
              <span class="text-xs font-bold text-slate-500">${new Date().toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            </div>
            <p class="text-sm font-black mt-1">Motivo: <span class="underline decoration-blue-300">${Helpers.escapeHTML(reason)}</span>${note ? ' — ' + Helpers.escapeHTML(note) : ''}</p>
            <p class="text-xs text-slate-500 font-medium mt-0.5">
              ${isParentReported ? 'Esta ausencia fue enviada por el padre/tutor y aparece resaltada en azul en el calendario.' : 'Regla de estancia: registrado automáticamente al superar la hora de entrada de hoy sin confirmación de asistencia.'}
            </p>
          </div>
        </div>
        <button onclick="document.getElementById('modalAbsence').classList.remove('hidden');document.getElementById('modalAbsence').classList.add('flex');" class="px-4 py-2 rounded-xl ${badgeCls} text-xs font-black hover:opacity-90 transition-opacity shrink-0">
          ${isParentReported ? 'Editar / Justificar' : 'Enviar Justificación'}
        </button>
      </div>`;
  },

  renderCalendar(year, month) {
    const container = document.getElementById('calendarGrid');
    if (!container) return;

    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay    = new Date(year, month - 1, 1).getDay();

    const attMap = new Map();
    this._attendance.forEach(a => {
      if (!a.date || typeof a.date !== 'string') return;
      const parts = a.date.split('-');
      if (parts.length < 3) return;
      const day = parseInt(parts[2], 10);
      if (isNaN(day) || day < 1 || day > 31) return;

      const hasReq = this._requests.some(r => r.date === a.date);
      const isParentReported = hasReq || (a.absence_reason && !a.absence_reason.includes('Automática'));
      attMap.set(day, {
        status: a.status?.toLowerCase(),
        isParentReported
      });
    });

    // Agregar solicitudes que aún no están en la tabla de attendance
    this._requests.forEach(r => {
      if (!r.date || typeof r.date !== 'string') return;
      const parts = r.date.split('-');
      if (parts.length < 3) return;
      const day = parseInt(parts[2], 10);
      if (isNaN(day) || day < 1 || day > 31) return;
      if (!attMap.has(day)) {
        attMap.set(day, { status: 'absent', isParentReported: true });
      }
    });

    const today     = new Date();
    const todayDay  = today.getDate();
    const todayMon  = today.getMonth() + 1;
    const todayYear = today.getFullYear();

    let html = '';

    for (let i = 0; i < firstDay; i++) {
      html += '<div class="aspect-square"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const info    = attMap.get(d);
      const status  = info?.status;
      const isParentReported = info?.isParentReported;
      const isToday = d === todayDay && month === todayMon && year === todayYear;

      let cls = 'aspect-square flex flex-col items-center justify-center rounded-2xl text-xs font-black transition-all ';

      if (status === 'present' || status === 'presente') {
        cls += 'bg-green-500 text-white shadow-lg shadow-green-100 scale-105 z-10';
      } else if ((status === 'absent' || status === 'ausente') && isParentReported) {
        cls += 'bg-blue-500 text-white shadow-lg shadow-blue-100 scale-105 z-10';
      } else if (status === 'absent' || status === 'ausente') {
        cls += 'bg-rose-500 text-white shadow-lg shadow-rose-100';
      } else if (status === 'late' || status === 'tarde') {
        cls += 'bg-amber-500 text-white shadow-lg shadow-amber-100';
      } else {
        cls += 'bg-white text-slate-400 border border-slate-100 hover:bg-slate-50';
      }

      if (isToday && !status) cls += ' ring-2 ring-emerald-400 ring-offset-2';

      html += `
        <div class="${cls}" title="${isParentReported ? 'Ausencia notificada por padre' : (status ? 'Asistencia ' + status : '')}">
          <span>${d}</span>
          ${(status === 'absent' || status === 'ausente') && isParentReported ? '<div class="w-1.5 h-1.5 bg-white rounded-full mt-0.5"></div>' : ''}
          ${status === 'present' || status === 'presente' ? '<div class="w-1 h-1 bg-white rounded-full mt-0.5"></div>' : ''}
        </div>`;
    }

    container.innerHTML = html;
  },

  renderList(data) {
    const container = document.getElementById('attendanceHistoryList');
    if (!container) return;

    if (!data.length) {
      container.innerHTML = Helpers.emptyState('Sin registros este mes', '\uD83D\uDCC5', {
        label: 'Reportar Ausencia',
        action: () => {
          const modal = document.getElementById('modalAbsence');
          if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
          }
        }
      });
      return;
    }

    const statusMap = {
      present:  { label: 'Presente', cls: 'bg-emerald-100 text-emerald-700' },
      presente: { label: 'Presente', cls: 'bg-emerald-100 text-emerald-700' },
      absent:   { label: 'Ausente (Sin aviso)', cls: 'bg-rose-100 text-rose-700' },
      ausente:  { label: 'Ausente (Sin aviso)', cls: 'bg-rose-100 text-rose-700' },
      late:     { label: 'Tarde',    cls: 'bg-amber-100 text-amber-700' },
      tarde:    { label: 'Tarde',    cls: 'bg-amber-100 text-amber-700' }
    };

    container.innerHTML = data.map(a => {
      const statusKey = a.status?.toLowerCase();
      const isAbsent  = statusKey === 'absent' || statusKey === 'ausente';
      const req       = this._requests.find(r => r.date === a.date);
      const isParentReported = Boolean(req || (a.absence_reason && !a.absence_reason.includes('Automática')));

      let st = statusMap[statusKey] || { label: a.status, cls: 'bg-slate-100 text-slate-600' };
      if (isAbsent && isParentReported) {
        st = { label: 'Notificado por Padre', cls: 'bg-blue-100 text-blue-700' };
      }

      const reasonStr = req?.reason || a.absence_reason || '';
      const reasonHtml = (isAbsent && reasonStr)
        ? '<p class="text-[10px] font-bold ' + (isParentReported ? 'text-blue-600' : 'text-rose-500') + ' mt-1 flex items-start gap-1"><span>📝</span><span>' + Helpers.escapeHTML(reasonStr) + '</span></p>'
        : (isAbsent ? '<p class="text-[10px] font-bold text-slate-400 mt-1">Sin motivo registrado</p>' : '');
      const day = parseInt(a.date.split('-')[2], 10);
      return (
        '<div class="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 shadow-sm mb-3 group hover:shadow-md transition-all">' +
          '<div class="flex items-center gap-4">' +
            '<div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-sm font-black text-slate-400 group-hover:bg-rose-50 group-hover:text-rose-500 transition-colors">' + day + '</div>' +
            '<div>' +
              '<p class="text-sm font-black text-slate-800">' + Helpers.formatDate(a.date) + '</p>' +
              '<p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">' + (a.check_in ? 'Ingreso: ' + a.check_in : 'Sin registro de hora') + '</p>' +
              reasonHtml +
            '</div>' +
          '</div>' +
          '<span class="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ' + st.cls + '">' + st.label + '</span>' +
        '</div>'
      );
    }).join('');
  }
};
