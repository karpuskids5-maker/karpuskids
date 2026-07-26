import { supabase } from '../shared/supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';

/**
 * Calificaciones V2 — Vista para Padres
 * Tarjetas de período elegante con promedios por materia
 */
export const GradesModule = {
  async init(studentId) {
    if (!studentId) return;
    await this.loadGrades(studentId);
  },

  async loadGrades(studentId) {
    const container = document.getElementById('gradesContent');
    if (!container) return;

    container.innerHTML = Helpers.skeleton(3, 'h-24');

    try {
      // 1. Get active period for the student's classroom
      const { data: student } = await supabase
        .from(TABLES.STUDENTS)
        .select('classroom_id, classrooms(id, name)')
        .eq('id', studentId)
        .single();

      if (!student?.classroom_id) {
        container.innerHTML = Helpers.emptyState('No hay aula asignada', '🏫');
        return;
      }

      const periodRes = await supabase.rpc('get_active_period', { p_classroom_id: student.classroom_id });
      const period = periodRes?.data;

      if (!period || !period.found) {
        // Try to get the most recent closed period
        const { data: recentPeriods } = await supabase
          .from(TABLES.PERIODS)
          .select('id, name, start_date, end_date, status')
          .eq('classroom_id', student.classroom_id)
          .order('start_date', { ascending: false })
          .limit(1);

        if (!recentPeriods?.length) {
          container.innerHTML = Helpers.emptyState('No hay periodos académicos disponibles', '📋');
          return;
        }

        // Load with the most recent period
        await this._renderPeriodView(container, studentId, recentPeriods[0]);
        return;
      }

      await this._renderPeriodView(container, studentId, period);
    } catch (err) {
      console.error('[GradesModule] Error:', err);
      container.innerHTML = Helpers.emptyState('Error al cargar calificaciones', '❌');
    }
  },

  async _renderPeriodView(container, studentId, period) {
    try {
      // Load subject averages and grades in parallel
      const [averagesRes, gradesRes, reportRes] = await Promise.all([
        supabase.rpc('get_student_subject_averages', {
          p_student_id: parseInt(studentId),
          p_period_id: parseInt(period.id)
        }),
        supabase.rpc('get_student_grades_v2', {
          p_student_id: parseInt(studentId),
          p_period_id: parseInt(period.id)
        }),
        supabase.from(TABLES.REPORT_CARDS)
          .select('final_score, level, teacher_comment')
          .eq('student_id', studentId)
          .eq('period_id', period.id)
          .maybeSingle()
      ]);

      const averages = averagesRes?.data || [];
      const grades = gradesRes?.data || [];
      const report = reportRes?.data;

      // Calculate overall average from subject averages
      let overallAvg = report?.final_score;
      if (overallAvg == null && averages.length > 0) {
        const sum = averages.reduce((s, a) => s + Number(a.average), 0);
        overallAvg = sum / averages.length;
      }

      const levelLabel = this._getLevel(overallAvg);
      const periodStatus = period.status === 'closed' ? 'Cerrado' : 'En curso';

      // Group grades by subject
      const gradesBySubject = {};
      grades.forEach(g => {
        if (!gradesBySubject[g.subject_name]) gradesBySubject[g.subject_name] = [];
        gradesBySubject[g.subject_name].push(g);
      });

      container.innerHTML = `
        <div class="w-full space-y-6 animate-fade-in">
          <!-- Period Header Card -->
          <div class="bg-gradient-to-br from-indigo-600 to-violet-600 p-6 rounded-[2rem] text-white shadow-lg shadow-indigo-100 relative overflow-hidden">
            <div class="absolute -right-8 -bottom-8 w-32 h-32 bg-white/10 rounded-full"></div>
            <div class="absolute right-16 top-4 w-16 h-16 bg-white/5 rounded-full"></div>
            <div class="relative z-10">
              <div class="flex items-center justify-between mb-4">
                <div>
                  <p class="text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Periodo Académico</p>
                  <h2 class="text-2xl font-black mt-1">${escapeHtml(period.name)}</h2>
                </div>
                <span class="px-3 py-1 bg-white/20 rounded-full text-[10px] font-black uppercase">${periodStatus}</span>
              </div>
              <div class="grid grid-cols-3 gap-4 mt-6">
                <div>
                  <p class="text-[10px] font-bold opacity-70 uppercase">Promedio</p>
                  <p class="text-3xl font-black">${overallAvg != null ? Number(overallAvg).toFixed(1) : '—'}</p>
                </div>
                <div>
                  <p class="text-[10px] font-bold opacity-70 uppercase">Nivel</p>
                  <p class="text-lg font-black">${levelLabel}</p>
                </div>
                <div>
                  <p class="text-[10px] font-bold opacity-70 uppercase">Materias</p>
                  <p class="text-lg font-black">${averages.length}</p>
                </div>
              </div>
            </div>
          </div>

          ${averages.length > 0 ? `
            <!-- Subject Averages Grid -->
            <div>
              <h3 class="font-black text-slate-800 text-sm mb-4 flex items-center gap-2 px-1">
                <i data-lucide="bar-chart-3" class="w-4 h-4 text-indigo-500"></i>
                Promedios por Materia
              </h3>
              <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                ${averages.map(avg => {
                  const level = this._getLevel(avg.average);
                  const levelCls = this._getLevelClass(avg.average);
                  const barColor = avg.average >= 80 ? 'bg-emerald-500' : avg.average >= 60 ? 'bg-amber-500' : 'bg-rose-500';
                  return `
                    <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
                      <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">${escapeHtml(avg.subject_name)}</p>
                      <div class="flex items-end justify-between mb-2">
                        <span class="text-2xl font-black text-slate-800">${Number(avg.average).toFixed(1)}</span>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${levelCls}">${level}</span>
                      </div>
                      <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div class="${barColor} h-full rounded-full transition-all" style="width:${Math.min(100, avg.average)}%"></div>
                      </div>
                      <p class="text-[9px] text-slate-400 font-bold mt-2">${avg.graded_count} actividad${avg.graded_count !== 1 ? 'es' : ''}</p>
                    </div>`;
                }).join('')}
              </div>
            </div>
          ` : ''}

          ${grades.length > 0 ? `
            <!-- Activity Detail -->
            <div>
              <h3 class="font-black text-slate-800 text-sm mb-4 flex items-center gap-2 px-1">
                <i data-lucide="list" class="w-4 h-4 text-indigo-500"></i>
                Detalle de Actividades
              </h3>
              <div class="space-y-3">
                ${Object.entries(gradesBySubject).map(([subName, acts]) => `
                  <div class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                    <div class="px-4 py-3 bg-slate-50 border-b border-slate-100">
                      <h4 class="font-black text-slate-700 text-xs uppercase tracking-widest">${escapeHtml(subName)}</h4>
                    </div>
                    <div class="divide-y divide-slate-50">
                      ${acts.map(g => {
                        const score = g.score != null ? Number(g.score) : null;
                        const scoreColor = score != null ? (score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-rose-600') : 'text-slate-400';
                        return `
                          <div class="px-4 py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                            <div class="flex items-center gap-3">
                              <span class="w-7 h-7 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center font-black text-xs">${g.activity_number}</span>
                              <span class="text-sm font-bold text-slate-700">${escapeHtml(g.activity_title)}</span>
                            </div>
                            <span class="text-lg font-black ${scoreColor}">${score != null ? score.toFixed(1) : '—'}</span>
                          </div>`;
                      }).join('')}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${report?.teacher_comment ? `
            <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
              <div class="flex items-center gap-2 mb-3">
                <i data-lucide="message-circle" class="w-4 h-4 text-indigo-500"></i>
                <h4 class="font-black text-slate-700 text-xs uppercase tracking-widest">Comentario de la Maestra</h4>
              </div>
              <p class="text-sm text-slate-600 italic leading-relaxed">"${escapeHtml(report.teacher_comment)}"</p>
            </div>
          ` : ''}

          ${averages.length === 0 && grades.length === 0 ? `
            <div class="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm text-center">
              <div class="w-16 h-16 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">📝</div>
              <h3 class="text-lg font-black text-slate-800 mb-2">Sin calificaciones aún</h3>
              <p class="text-slate-500 text-sm max-w-sm mx-auto">Las calificaciones aparecerán cuando la maestra registre notas en las actividades evaluables.</p>
            </div>
          ` : ''}
        </div>
      `;

      setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 50);
    } catch (err) {
      console.error('[GradesModule] Render error:', err);
      container.innerHTML = Helpers.emptyState('Error al cargar calificaciones', '❌');
    }
  },

  _getLevel(score) {
    if (score == null) return 'Sin calificar';
    if (score >= 90) return 'Excelente';
    if (score >= 80) return 'Bueno';
    if (score >= 70) return 'En proceso';
    return 'Requiere apoyo';
  },

  _getLevelClass(score) {
    if (score == null) return 'bg-slate-100 text-slate-500';
    if (score >= 90) return 'bg-emerald-100 text-emerald-700';
    if (score >= 80) return 'bg-blue-100 text-blue-700';
    if (score >= 70) return 'bg-amber-100 text-amber-700';
    return 'bg-rose-100 text-rose-700';
  }
};
