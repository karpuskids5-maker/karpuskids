import { supabase } from '../../shared/supabase.js';
import { AppState } from '../state.js';
import { Helpers } from '../../shared/helpers.js';
import { QueryCache } from '../../shared/query-cache.js';
import { getBirthdayInfo } from '../../shared/birthday-utils.js';
import { autoMarkAbsentStudents } from '../../shared/absent-service.js';

const GEN_DAY = 25;
const MONTH_NAMES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function visibleMonthKey() {
  const genDay = Number(AppState.get('schoolSettings')?.generation_day) || GEN_DAY;
  const d = new Date();
  if (d.getDate() >= genDay) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const prevM = d.getMonth() === 0 ? 12 : d.getMonth();
  const prevY = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

function visibleMonthName() {
  const m = Number(visibleMonthKey().split('-')[1] || '0') - 1;
  return MONTH_NAMES_ES[m] || '';
}

function classroomCard(c, teacher, enrolledCount, present, attPct, taken, routinePublished, chip, chipCls, barCls) {
  const name = Helpers.escapeHTML(c.name || 'Aula');
  const teacherName = Helpers.escapeHTML(teacher?.name || 'Sin maestra asignada');
  const barW = Math.max(0, Math.min(100, attPct));
  return `
    <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="min-w-0">
          <p class="font-black text-slate-800 text-sm truncate">${name}</p>
          <p class="text-[10px] text-slate-400 font-bold uppercase truncate">${teacherName}</p>
        </div>
        <span class="text-[9px] font-black px-2 py-1 rounded-full shrink-0 ${chipCls}">${chip}</span>
      </div>
      <div class="flex items-center justify-between text-xs font-bold text-slate-500 mb-1">
        <span>${present}/${enrolledCount} presentes</span>
        <span>${attPct}%</span>
      </div>
      <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div class="h-full ${barCls}" style="width:${barW}%"></div>
      </div>
      <div class="flex items-center gap-3 mt-3 text-[10px] font-bold text-slate-400">
        <span class="flex items-center gap-1"><i data-lucide="${taken ? 'calendar-check' : 'calendar-x'}" class="w-3 h-3"></i>${taken ? 'Lista tomada' : 'Sin lista'}</span>
        <span class="flex items-center gap-1"><i data-lucide="book-open" class="w-3 h-3"></i>${routinePublished ? 'Rutina publicada' : 'Sin rutina'}</span>
      </div>
    </div>`;
}

export const DashboardModule = {
  async init() {
    const dateEl = document.getElementById('dashboardDate');
    const updateDate = () => {
      if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('es-DO', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
      }
    };
    updateDate();
    // Update date at midnight
    const msUntilMidnight = () => {
      const now = new Date();
      const midnight = new Date(now); midnight.setHours(24,0,0,0);
      return midnight - now;
    };
    setTimeout(() => { updateDate(); setInterval(updateDate, 86400000); }, msUntilMidnight());

    await this.loadStats();
    await this._loadClassroomsSummary();
  },

  async loadStats() {
      try {
        const today = new Date().toISOString().split('T')[0];
        const todayStart = today + 'T00:00:00.000Z';
        const todayEnd   = today + 'T23:59:59.999Z';
        const visibleKey = visibleMonthKey();

        // Stale-while-revalidate: mostrar datos cacheados inmediatamente, revalidar en background
        const cachedStats = QueryCache.getStale(
          'asis_dashboard_stats',
          async () => {
            // Auto-detección de ausentes (misma regla: check_in_end + 2h)
            try { await autoMarkAbsentStudents(); } catch (_) {}

            const [studentsRes, attendanceRes, incomeRes, todayPaidRes, absentNotifiedRes, queueRes] = await Promise.allSettled([
              supabase.from('students').select('*', { count: 'exact', head: true })
                .eq('is_active', true).not('classroom_id', 'is', null),
              supabase.from('attendance').select('*', { count: 'exact', head: true })
                .eq('date', today).in('status', ['present', 'presente', 'late', 'tarde']),
              supabase.from('payments').select('amount')
                .eq('status', 'paid').eq('month_paid', visibleKey),
              supabase.from('payments').select('id, amount')
                .eq('status', 'paid')
                .gte('created_at', todayStart).lte('created_at', todayEnd),
              supabase.from('attendance').select('*', { count: 'exact', head: true })
                .eq('date', today).eq('status', 'absent')
                .not('absence_reason', 'is', null),
              // Cobros del MES VISIBLE (regla del día de generación, igual que la
              // directora): monto total_due y conteos por estado del período.
              supabase.from('v_payments_with_mora').select('status,total_due').eq('month_paid', visibleKey),
            ]);
            const get = (r) => r.status === 'fulfilled' ? r.value : {};
            const activeCount = get(studentsRes).count || 0;
            const presentCount = get(attendanceRes).count || 0;
            // Ausentes = estudiantes activos sin registro de presente/tarde hoy
            const absentCount = Math.max(0, activeCount - presentCount);
            const todayPaid = get(todayPaidRes).data || [];
            const todayPaidTotal = todayPaid.reduce((s,p)=>s+Number(p.amount||0), 0);
            const queue = get(queueRes).data || [];
            const isSt = (p, names) => names.includes(String(p.status || '').toLowerCase());
            const isOpen = (p) => isSt(p, ['pending', 'pendiente', 'overdue', 'vencido', 'review', 'revision', 'revisión']);
            const pendingCount = queue.filter(p => isSt(p, ['pending', 'pendiente'])).length;
            const reviewCount  = queue.filter(p => isSt(p, ['review', 'revision', 'revisión'])).length;
            const overdueCount = queue.filter(p => isSt(p, ['overdue', 'vencido'])).length;
            // "Por cobrar" = solo cargos abiertos (sin cobrar, vencidos o en revisión)
            const pendingAmount = queue.filter(isOpen).reduce((s, p) => s + Number(p.total_due || 0), 0);
            return {
              studentsCount:   activeCount,
              attendanceCount: presentCount,
              absentCount:     absentCount,
              paymentsCount:   pendingCount + reviewCount,
              incomeTotal:     (get(incomeRes).data || []).reduce((s, p) => s + Number(p.amount || 0), 0),
              paymentsToday:   todayPaidTotal,
              paymentsTodayCount: todayPaid.length,
              absentNotified:  get(absentNotifiedRes).count || 0,
              overdueCount:    overdueCount,
              pendingAmount:   pendingAmount,
              noPunchCount:    Math.max(0, absentCount - (get(absentNotifiedRes).count || 0)),
            };
          },
          2 * 60_000,
          (fresh) => this._applyStats(fresh)
        );

        if (cachedStats) this._applyStats(cachedStats);

      } catch (e) {
        Helpers.safeLog('error', 'Error loading stats:', e);
      }
    }
,

  _applyStats({ studentsCount, attendanceCount, absentCount, paymentsCount, incomeTotal, paymentsToday, paymentsTodayCount, absentNotified, overdueCount, pendingAmount, noPunchCount }) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('statStudents',   studentsCount);
    set('statAttendance', attendanceCount);
    set('statAbsent',     absentCount);
    set('statPayments',   'RD$' + Number(pendingAmount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    set('statPaymentsPeriod', 'Monto pendiente de ' + visibleMonthName().toLowerCase() + ' (período)');
    set('statIncome',     incomeTotal.toLocaleString('es-DO', { minimumFractionDigits: 2 }));
    set('statPaymentsToday', 'RD$' + Number(paymentsToday || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    set('statPaymentsTodayCount', `${paymentsTodayCount ?? 0} transaccion${paymentsTodayCount === 1 ? '':'es'}`);
    set('statAbsentNotified', absentNotified ?? 0);
    set('welcomeName',    (AppState.get('profile')?.name || 'Asistente').split(' ')[0]);
    this._renderUrgentAlerts({ paymentsReview: paymentsCount, present: attendanceCount, overdue: overdueCount || 0, noPunch: noPunchCount ?? 0 });
    this._renderStaffBirthdayBanner();
  },

  _renderUrgentAlerts({ paymentsReview, overdue, noPunch }) {
    const container = document.getElementById('urgentAlertsWidget');
    if (!container) return;

    const alerts = [];
    
    if (noPunch > 0) {
      alerts.push({
        title: `${noPunch} estudiante${noPunch===1?'':'s'} sin registro de ponche`,
        desc: 'No tienen asistencia registrada ni justificación presentada.',
        icon: 'scan-face',
        color: 'amber',
        section: 'accesos'
      });
    }

    if (overdue > 0) {
      alerts.push({
        title: `${overdue} pago${overdue===1?'':'s'} en mora`,
        desc: 'Cargos vencidos del período requieren seguimiento inmediato.',
        icon: 'alert-octagon',
        color: 'rose',
        section: 'pagos'
      });
    }

    if (paymentsReview > 0) {
      alerts.push({
        title: `${paymentsReview} pago${paymentsReview===1?'':'s'} por validar`,
        desc: 'Cobros del período pendientes de revisión o cobro.',
        icon: 'credit-card',
        color: 'violet',
        section: 'pagos'
      });
    }

    if (alerts.length === 0) {
      // Mostrar widget OK silencioso
      container.classList.remove('hidden');
      container.innerHTML = `
        <div class="md:col-span-3 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-100 p-4 rounded-2xl flex items-center gap-4">
          <div class="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-emerald-200 animate-pulse">
            <i data-lucide="check" class="w-5 h-5"></i>
          </div>
          <div>
            <h4 class="text-sm font-black text-emerald-900">Todo en orden</h4>
            <p class="text-xs text-emerald-700/70 font-bold mt-0.5">Sin alertas urgentes. ¡Buen trabajo!</p>
          </div>
        </div>`;
      if (window.lucide) lucide.createIcons();
      return;
    }

    container.classList.remove('hidden');
    container.innerHTML = alerts.map(a => `
      <div onclick="window.App.navigateTo('${a.section}')" class="bg-${a.color}-50 border border-${a.color}-100 p-4 rounded-2xl flex items-start gap-4 cursor-pointer hover:shadow-md transition-all group">
        <div class="w-10 h-10 rounded-xl bg-${a.color}-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-${a.color}-200 group-hover:scale-110 transition-transform kk-pulse-ring">
          <i data-lucide="${a.icon}" class="w-5 h-5"></i>
        </div>
        <div>
          <h4 class="text-sm font-black text-${a.color}-900">${a.title}</h4>
          <p class="text-xs text-${a.color}-700/70 font-bold mt-0.5">${a.desc}</p>
        </div>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
  },

  async _loadClassroomsSummary() {
    const container = document.getElementById('classroomsSummary');
    if (!container) return;
    try {
      const today = new Date().toISOString().split('T')[0];
      const [crRes, prRes, stRes, atRes, lgRes] = await Promise.all([
        supabase.from('classrooms').select('id,name,level,capacity,teacher_id').order('name'),
        supabase.from('profiles').select('id,name').in('role', ['maestra', 'asistente', 'directora']),
        supabase.from('students').select('id,classroom_id').eq('is_active', true),
        supabase.from('attendance').select('classroom_id,status').eq('date', today),
        supabase.from('daily_logs').select('classroom_id,status').eq('date', today),
      ]);

      const classrooms = crRes.data || [];
      const teachers = {};
      (prRes.data || []).forEach(p => { teachers[p.id] = p; });
      const students = stRes.data || [];
      const att = atRes.data || [];
      const logs = lgRes.data || [];
      const PRESENT = ['present', 'presente', 'late', 'tarde'];

      let totalEnrolled = 0, totalPresent = 0, routinesPublished = 0;

      const cards = classrooms.map(c => {
        const enrolledCount = students.filter(s => s.classroom_id === c.id).length;
        const clsAtt = att.filter(a => a.classroom_id === c.id);
        const present = clsAtt.filter(a => PRESENT.includes((a.status || '').toLowerCase())).length;
        const taken = clsAtt.length > 0;
        const routinePublished = logs.some(l => l.classroom_id === c.id && l.status === 'published');
        const teacher = c.teacher_id ? teachers[c.teacher_id] : null;
        const attPct = enrolledCount ? Math.round((present / enrolledCount) * 100) : 0;

        totalEnrolled += enrolledCount;
        totalPresent += present;
        if (routinePublished) routinesPublished++;

        let state = 'ok', chip = 'Al día';
        if (!teacher) { state = 'bad'; chip = 'Sin maestra'; }
        else if (enrolledCount > 0 && !taken) { state = 'warn'; chip = 'Sin lista'; }
        else if (enrolledCount > 0 && !routinePublished) { state = 'warn'; chip = 'Sin rutina'; }

        const chipCls = state === 'bad' ? 'bg-rose-100 text-rose-700'
          : state === 'warn' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
        const barCls = attPct >= 85 ? 'bg-emerald-500' : attPct >= 60 ? 'bg-amber-500' : 'bg-rose-500';

        return classroomCard(c, teacher, enrolledCount, present, attPct, taken, routinePublished, chip, chipCls, barCls);
      });

      const attPct = totalEnrolled ? Math.round((totalPresent / totalEnrolled) * 100) : 0;
      const kpi = (label, value, color) => `
        <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p class="text-[10px] font-black uppercase tracking-wider text-slate-400">${label}</p>
          <p class="text-2xl font-black ${color}">${value}</p>
        </div>`;

      container.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          ${kpi('Aulas', classrooms.length, 'text-slate-800')}
          ${kpi('Matrícula', totalEnrolled, 'text-slate-800')}
          ${kpi('Asistencia hoy', attPct + '%', attPct >= 85 ? 'text-emerald-600' : attPct >= 60 ? 'text-amber-600' : 'text-rose-600')}
          ${kpi('Rutinas publicadas', `${routinesPublished}/${classrooms.length}`, 'text-slate-800')}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${cards.join('') || '<div class="col-span-full bg-white rounded-2xl border border-slate-100 px-5 py-8 text-center text-slate-400 text-sm">No hay aulas registradas.</div>'}
        </div>`;

      if (window.lucide) lucide.createIcons();
    } catch (e) {
      Helpers.safeLog('warn', 'Classrooms summary failed:', e?.message || e);
      container.innerHTML = '<div class="bg-white rounded-2xl border border-slate-100 px-5 py-8 text-center text-slate-400 text-sm">No se pudo cargar el resumen de aulas.</div>';
    }
  },

  async _renderStaffBirthdayBanner() {
    const banner = document.getElementById('staffBirthdayBanner');
    const listEl = document.getElementById('staffBirthdayList');
    const countEl = document.getElementById('staffBirthdayCount');
    if (!banner || !listEl) return;

    try {
      const { data: students, error } = await supabase
        .from('students')
        .select('id, name, last_name, birth_date')
        .eq('is_active', true)
        .not('birth_date', 'is', null);

      if (error || !students) { banner.classList.add('hidden'); return; }

      const upcoming = students
        .map(s => ({ ...s, bday: getBirthdayInfo(s.birth_date) }))
        .filter(s => s.bday && (s.bday.isToday || s.bday.isUpcoming))
        .sort((a, b) => a.bday.daysUntil - b.bday.daysUntil);

      if (upcoming.length === 0) { banner.classList.add('hidden'); return; }

      listEl.innerHTML = upcoming.map(s => {
        const fullName = [s.name, s.last_name].filter(Boolean).join(' ');
        if (s.bday.isToday) {
          return '<div class="flex items-center gap-3 bg-white/20 backdrop-blur-sm rounded-xl p-2.5">' +
            '<div class="w-8 h-8 rounded-lg bg-white/30 flex items-center justify-center text-sm font-black text-white shrink-0">🎂</div>' +
            '<div class="min-w-0 flex-1">' +
              '<p class="text-xs font-black text-white truncate">' + Helpers.escapeHTML(fullName) + '</p>' +
              '<p class="text-[10px] text-white/80 font-bold">¡Hoy cumple ' + s.bday.ageTurning + ' años!</p>' +
            '</div>' +
          '</div>';
        }
        return '<div class="flex items-center gap-3 bg-white/15 rounded-xl p-2.5">' +
          '<div class="w-8 h-8 rounded-lg bg-white/25 flex items-center justify-center text-sm font-bold text-white/90 shrink-0">' + s.bday.daysUntil + '</div>' +
          '<div class="min-w-0 flex-1">' +
            '<p class="text-xs font-bold text-white truncate">' + Helpers.escapeHTML(fullName) + '</p>' +
            '<p class="text-[10px] text-white/70 font-bold">En ' + s.bday.daysUntil + ' día' + (s.bday.daysUntil === 1 ? '' : 's') + ' cumple ' + s.bday.ageTurning + ' años</p>' +
          '</div>' +
        '</div>';
      }).join('');

      const todayCount = upcoming.filter(s => s.bday.isToday).length;
      const soonCount = upcoming.length - todayCount;
      const parts = [];
      if (todayCount > 0) parts.push(todayCount + ' hoy');
      if (soonCount > 0) parts.push(soonCount + ' pronto');
      if (countEl) countEl.textContent = parts.join(' · ');
      banner.classList.remove('hidden');
    } catch (e) {
      console.warn('staffBirthdayBanner error:', e);
      banner.classList.add('hidden');
    }
  }
};
