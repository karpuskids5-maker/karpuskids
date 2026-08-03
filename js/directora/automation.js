/**
 * 🤖 Karpus Kids — Módulo de Automatización Inteligente
 * Detecta anomalías, genera alertas y automatiza análisis para la directora.
 */

import { supabase } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';

export const AutomationModule = {

  // ── 1. DETECCIÓN DE RIESGO DE RETIRO ─────────────────────────────────────
  // Estudiantes con 3+ ausencias consecutivas sin aviso de ausencia
  async getAtRiskStudents() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

      const { data: absences } = await supabase
        .from('attendance')
        .select('student_id, date, status, students:student_id(name, classroom_id, classrooms:classroom_id(name))')
        .in('status', ['absent', 'ausente'])
        .gte('date', sevenDaysAgo)
        .lte('date', today)
        .order('date', { ascending: false });

      if (!absences?.length) return [];

      // Agrupar por estudiante
      const byStudent = {};
      for (const a of absences) {
        const sid = a.student_id;
        if (!byStudent[sid]) byStudent[sid] = { student: a.students, dates: [] };
        byStudent[sid].dates.push(a.date);
      }

      // Detectar 3+ ausencias consecutivas
      const atRisk = [];
      for (const [sid, info] of Object.entries(byStudent)) {
        const sorted = info.dates.sort((a, b) => b.localeCompare(a)); // más reciente primero
        if (sorted.length < 3) continue;

        // Verificar si las últimas 3 son consecutivas
        let consecutive = 1;
        for (let i = 1; i < sorted.length; i++) {
          const prev = new Date(sorted[i - 1]);
          const curr = new Date(sorted[i]);
          const diff = Math.round((prev - curr) / 86400000);
          // Saltar fines de semana (diff puede ser 3 si hay fin de semana)
          if (diff <= 3) {
            consecutive++;
            if (consecutive >= 3) break;
          } else {
            consecutive = 1;
          }
        }

        if (consecutive >= 3) {
          // Verificar si tiene aviso de ausencia para esas fechas
          const { data: requests } = await supabase
            .from('attendance_requests')
            .select('date')
            .eq('student_id', sid)
            .in('date', sorted.slice(0, 3));

          const justifiedDates = new Set((requests || []).map(r => r.date));
          const unjustified = sorted.slice(0, 3).filter(d => !justifiedDates.has(d));

          if (unjustified.length >= 3) {
            atRisk.push({
              id: sid,
              name: info.student?.name || 'Estudiante',
              classroom: info.student?.classrooms?.name || 'Sin aula',
              absences: sorted.length,
              consecutiveAbsences: consecutive,
              lastAbsence: sorted[0]
            });
          }
        }
      }

      return atRisk;
    } catch (_) { return []; }
  },

  // ── 2. SEMÁFORO ACADÉMICO ─────────────────────────────────────────────────
  // Detecta si más del 30% del aula está por debajo del promedio mínimo
  async getAcademicAlerts() {
    try {
      const { data: evidences } = await supabase
        .from('task_evidences')
        .select('student_id, stars, grade_letter, students:student_id(classroom_id, classrooms:classroom_id(name))')
        .eq('status', 'graded')
        .not('grade_letter', 'is', null)
        .order('created_at', { ascending: false })
        .limit(300);

      if (!evidences?.length) return [];

      // Agrupar por aula
      const byClassroom = {};
      for (const ev of evidences) {
        const cid = ev.students?.classroom_id;
        const cname = ev.students?.classrooms?.name || 'Sin aula';
        if (!cid) continue;
        if (!byClassroom[cid]) byClassroom[cid] = { name: cname, scores: [], students: new Set() };

        let score = null;
        if (ev.stars > 0) score = ev.stars;
        else if (ev.grade_letter) {
          const map = { A: 5, B: 4, C: 3, D: 2, E: 1 };
          score = map[ev.grade_letter] ?? null;
        }
        if (score !== null) {
          byClassroom[cid].scores.push({ sid: ev.student_id, score });
          byClassroom[cid].students.add(ev.student_id);
        }
      }

      const alerts = [];
      for (const [cid, info] of Object.entries(byClassroom)) {
        if (info.scores.length < 3) continue;

        // Promedio por estudiante
        const studentScores = {};
        for (const { sid, score } of info.scores) {
          if (!studentScores[sid]) studentScores[sid] = [];
          studentScores[sid].push(score);
        }

        const avgs = Object.values(studentScores).map(scores =>
          scores.reduce((a, b) => a + b, 0) / scores.length
        );

        const belowMin = avgs.filter(avg => avg < 2.5).length;
        const pct = Math.round((belowMin / avgs.length) * 100);

        if (pct >= 30) {
          const globalAvg = avgs.reduce((a, b) => a + b, 0) / avgs.length;
          alerts.push({
            classroom: info.name,
            belowMinCount: belowMin,
            totalStudents: avgs.length,
            percentage: pct,
            globalAvg: globalAvg.toFixed(1),
            severity: pct >= 50 ? 'critical' : 'warning'
          });
        }
      }

      return alerts;
    } catch (_) { return []; }
  },

  // ── 3. ALERTA DE BAJA ASISTENCIA ──────────────────────────────────────────
  // Compara asistencia de hoy vs promedio de los últimos 7 días
  async getAttendanceAlert() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

      const [todayRes, weekRes] = await Promise.all([
        supabase.from('attendance').select('status').eq('date', today),
        supabase.from('attendance').select('date, status').gte('date', sevenDaysAgo).lt('date', today)
      ]);

      const todayData = todayRes.data || [];
      const weekData = weekRes.data || [];

      if (!todayData.length) return null;

      const todayPresent = todayData.filter(a => ['present', 'presente', 'late', 'tarde'].includes(a.status?.toLowerCase())).length;
      const todayTotal = todayData.length;
      const todayRate = todayTotal > 0 ? (todayPresent / todayTotal) * 100 : 0;

      // Calcular promedio semanal por día
      const byDay = {};
      for (const a of weekData) {
        if (!byDay[a.date]) byDay[a.date] = { present: 0, total: 0 };
        byDay[a.date].total++;
        if (['present', 'presente', 'late', 'tarde'].includes(a.status?.toLowerCase())) {
          byDay[a.date].present++;
        }
      }

      const dayRates = Object.values(byDay).map(d => d.total > 0 ? (d.present / d.total) * 100 : 0);
      const avgRate = dayRates.length > 0 ? dayRates.reduce((a, b) => a + b, 0) / dayRates.length : 0;

      const drop = avgRate - todayRate;

      if (drop >= 20 && todayTotal >= 5) {
        return {
          todayRate: Math.round(todayRate),
          avgRate: Math.round(avgRate),
          drop: Math.round(drop),
          todayPresent,
          todayTotal,
          severity: drop >= 30 ? 'critical' : 'warning'
        };
      }

      return null;
    } catch (_) { return null; }
  },

  // ── 4. PRÓXIMOS VENCIMIENTOS ──────────────────────────────────────────────
  async getUpcomingDues(days = 5) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const future = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];

      const { data } = await supabase
        .from('payments')
        .select('id, amount, due_date, month_paid, students:student_id(name)')
        .in('status', ['pending', 'pendiente'])
        .gte('due_date', today)
        .lte('due_date', future)
        .order('due_date', { ascending: true })
        .limit(5);

      return (data || []).map(p => ({
        id: p.id,
        studentName: p.students?.name || 'Estudiante',
        amount: Number(p.amount || 0),
        dueDate: p.due_date,
        monthPaid: p.month_paid,
        daysLeft: Math.round((new Date(p.due_date) - new Date(today)) / 86400000)
      }));
    } catch (_) { return []; }
  },

  // ── 5. TENDENCIA DE ESTUDIANTES ───────────────────────────────────────────
  async getStudentTrend() {
    try {
      const now = new Date();
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const lastMonth = now.getMonth() === 0
        ? `${now.getFullYear() - 1}-12`
        : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;

      const [thisRes, lastRes] = await Promise.all([
        supabase.from('students').select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .gte('created_at', thisMonth + '-01'),
        supabase.from('students').select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .gte('created_at', lastMonth + '-01')
          .lt('created_at', thisMonth + '-01')
      ]);

      const thisCount = thisRes.count || 0;
      const lastCount = lastRes.count || 0;

      return {
        newThisMonth: thisCount,
        newLastMonth: lastCount,
        trend: lastCount > 0 ? Math.round(((thisCount - lastCount) / lastCount) * 100) : 0
      };
    } catch (_) { return { newThisMonth: 0, newLastMonth: 0, trend: 0 }; }
  },

  // ── 6. RESUMEN DIARIO DE ASISTENCIA ──────────────────────────────────────
  // Para enviar a la directora a las 9:30 AM
  async getDailySummary() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('attendance')
        .select('status, students:student_id(name, classroom_id, classrooms:classroom_id(name))')
        .eq('date', today);

      if (!data?.length) return null;

      const present = data.filter(a => ['present', 'presente'].includes(a.status?.toLowerCase())).length;
      const late = data.filter(a => ['late', 'tarde'].includes(a.status?.toLowerCase())).length;
      const absent = data.filter(a => ['absent', 'ausente'].includes(a.status?.toLowerCase())).length;
      const total = data.length;

      // Ausencias sin justificar
      const absentStudents = data
        .filter(a => ['absent', 'ausente'].includes(a.status?.toLowerCase()))
        .map(a => a.students?.name)
        .filter(Boolean);

      const { data: justified } = await supabase
        .from('attendance_requests')
        .select('student_id, students:student_id(name)')
        .eq('date', today)
        .eq('status', 'pending');

      const justifiedNames = new Set((justified || []).map(r => r.students?.name));
      const unjustified = absentStudents.filter(n => !justifiedNames.has(n));

      return {
        date: today,
        present, late, absent, total,
        rate: total > 0 ? Math.round(((present + late) / total) * 100) : 0,
        unjustifiedAbsences: unjustified,
        unjustifiedCount: unjustified.length
      };
    } catch (_) { return null; }
  },

  // ── 7. RENDERIZAR WIDGETS EN EL DASHBOARD ────────────────────────────────
  async renderSmartWidgets(containerId = 'smartAlertsContainer') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<div class="flex items-center gap-2 py-4"><div class="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div><span class="text-xs text-slate-400 font-bold">Analizando datos...</span></div>';

    try {
      const [atRisk, academicAlerts, attAlert, upcomingDues, trend] = await Promise.all([
        this.getAtRiskStudents(),
        this.getAcademicAlerts(),
        this.getAttendanceAlert(),
        this.getUpcomingDues(5),
        this.getStudentTrend()
      ]);

      const widgets = [];

      // Widget: Alerta de baja asistencia
      if (attAlert) {
        const color = attAlert.severity === 'critical' ? 'rose' : 'amber';
        widgets.push(`
          <div class="bg-${color}-50 border border-${color}-200 rounded-2xl p-4 flex items-start gap-3">
            <div class="w-9 h-9 bg-${color}-100 rounded-xl flex items-center justify-center shrink-0 text-lg">⚠️</div>
            <div class="min-w-0">
              <p class="text-xs font-black text-${color}-800 uppercase tracking-wide">Baja Asistencia Detectada</p>
              <p class="text-[11px] text-${color}-700 mt-0.5">Hoy: <strong>${attAlert.todayRate}%</strong> vs promedio semanal: <strong>${attAlert.avgRate}%</strong> (−${attAlert.drop}%)</p>
              <p class="text-[10px] text-${color}-600 mt-0.5">${attAlert.todayPresent} de ${attAlert.todayTotal} estudiantes presentes</p>
            </div>
          </div>`);
      }

      // Widget: Estudiantes en riesgo de retiro
      if (atRisk.length > 0) {
        widgets.push(`
          <div class="bg-rose-50 border border-rose-200 rounded-2xl p-4">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-lg">🚨</span>
              <p class="text-xs font-black text-rose-800 uppercase tracking-wide">Riesgo de Retiro (${atRisk.length})</p>
            </div>
            <div class="space-y-2">
              ${atRisk.slice(0, 3).map(s => `
                <div class="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-rose-100">
                  <div>
                    <p class="text-xs font-bold text-slate-800">${Helpers.escapeHTML(s.name)}</p>
                    <p class="text-[10px] text-slate-400">${s.classroom} · ${s.consecutiveAbsences} ausencias seguidas</p>
                  </div>
                  <span class="text-[9px] font-black text-rose-600 bg-rose-100 px-2 py-0.5 rounded-full uppercase">Llamar</span>
                </div>`).join('')}
            </div>
          </div>`);
      }

      // Widget: Semáforo académico
      if (academicAlerts.length > 0) {
        widgets.push(`
          <div class="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-lg">📊</span>
              <p class="text-xs font-black text-amber-800 uppercase tracking-wide">Alerta Académica</p>
            </div>
            ${academicAlerts.slice(0, 2).map(a => `
              <div class="bg-white rounded-xl px-3 py-2 border border-amber-100 mb-2">
                <p class="text-xs font-bold text-slate-800">${Helpers.escapeHTML(a.classroom)}</p>
                <p class="text-[10px] text-amber-700">${a.belowMinCount} de ${a.totalStudents} estudiantes (${a.percentage}%) por debajo del mínimo · Promedio: ${a.globalAvg}</p>
              </div>`).join('')}
          </div>`);
      }

      // Widget: Próximos vencimientos
      if (upcomingDues.length > 0) {
        widgets.push(`
          <div class="bg-blue-50 border border-blue-200 rounded-2xl p-4">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-lg">💳</span>
              <p class="text-xs font-black text-blue-800 uppercase tracking-wide">Próximos Vencimientos</p>
            </div>
            <div class="space-y-1.5">
              ${upcomingDues.slice(0, 3).map(p => `
                <div class="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-blue-100">
                  <div>
                    <p class="text-xs font-bold text-slate-800">${Helpers.escapeHTML(p.studentName)}</p>
                    <p class="text-[10px] text-slate-400">${p.monthPaid || 'Mensualidad'}</p>
                  </div>
                  <div class="text-right">
                    <p class="text-xs font-black text-blue-700">${p.amount.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p class="text-[9px] font-bold ${p.daysLeft <= 1 ? 'text-rose-600' : 'text-slate-400'}">${p.daysLeft === 0 ? 'Hoy' : p.daysLeft === 1 ? 'Mañana' : `En ${p.daysLeft} días`}</p>
                  </div>
                </div>`).join('')}
            </div>
          </div>`);
      }

      // Widget: Tendencia de estudiantes
      if (trend.newThisMonth > 0 || trend.trend !== 0) {
        const trendColor = trend.trend >= 0 ? 'emerald' : 'rose';
        const trendIcon = trend.trend >= 0 ? '↑' : '↓';
        widgets.push(`
          <div class="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
            <div class="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center text-lg shrink-0">📈</div>
            <div>
              <p class="text-xs font-black text-emerald-800 uppercase tracking-wide">Crecimiento</p>
              <p class="text-[11px] text-emerald-700">${trend.newThisMonth} nuevos este mes <span class="font-black text-${trendColor}-600">${trendIcon}${Math.abs(trend.trend)}% vs mes anterior</span></p>
            </div>
          </div>`);
      }

      if (widgets.length === 0) {
        container.innerHTML = `
          <div class="flex items-center gap-3 py-3 px-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
            <span class="text-lg">✅</span>
            <p class="text-xs font-bold text-emerald-700">Todo en orden — Sin alertas activas</p>
          </div>`;
      } else {
        container.innerHTML = `<div class="space-y-3">${widgets.join('')}</div>`;
      }

      if (window.lucide) lucide.createIcons();
    } catch (_) {
      container.innerHTML = '';
    }
  }
};
