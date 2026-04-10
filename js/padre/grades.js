import { supabase } from '../shared/supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';

/**
 * 🎓 MÓDULO DE CALIFICACIONES (PADRES)
 */
export const GradesModule = {
  /**
   * Inicializa el módulo
   */
  async init(studentId) {
    if (!studentId) return;
    await this.loadGrades(studentId);
  },

  /**
   * Carga calificaciones y evidencias
   */
  async loadGrades(studentId) {
    const container = document.getElementById('gradesContent');
    if (!container) return;

    container.innerHTML = Helpers.skeleton(3, 'h-24');

    try {
      const [gradesRes, taskRes] = await Promise.all([
        supabase
          .from(TABLES.GRADES)
          .select('*')
          .eq('student_id', studentId)
          .order('created_at', { ascending: false }),
        supabase
          .from(TABLES.TASK_EVIDENCES)
          .select(`*, tasks:task_id (title, description)`)
          .eq('student_id', studentId)
          .not('grade_letter', 'is', null)
          .order('created_at', { ascending: false })
      ]);

      if (gradesRes.error) throw gradesRes.error;
      if (taskRes.error) throw taskRes.error;

      const grades = gradesRes.data || [];
      const taskEvidences = taskRes.data || [];

      if (grades.length === 0 && taskEvidences.length === 0) {
        container.innerHTML = Helpers.emptyState('No hay registros académicos aún.', '🏆');
        return;
      }
      const { label: gpaLabel, color: gpaLabelColor } = this.getGPALabel(gpa);

      container.innerHTML = `
        <div class="w-full space-y-8 animate-fade-in">
          <!-- Dashboard de Rendimiento -->
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <!-- Stats Rápidas -->
            <div class="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="bg-gradient-to-br from-emerald-500 to-green-600 p-6 rounded-[2rem] text-white shadow-lg shadow-emerald-100 relative overflow-hidden group">
                <div class="absolute -right-4 -bottom-4 w-24 h-24 bg-white/10 rounded-full group-hover:scale-110 transition-transform"></div>
                <p class="text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Promedio General</p>
                <div class="text-4xl font-black mt-2">${gpa}</div>
                <div class="mt-4 flex items-center gap-2 bg-white/20 px-3 py-1 rounded-full w-fit">
                  <i data-lucide="sparkles" class="w-3.5 h-3.5 text-yellow-300"></i>
                  <span class="text-[10px] font-bold ${gpaLabelColor}">${gpaLabel}</span>
                </div>
              </div>
              <div class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between">
                <div>
                  <p class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Tareas Listas</p>
                  <div class="text-3xl font-black text-slate-700 mt-1">${taskEvidences.length}</div>
                </div>
                <div class="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-500 flex items-center justify-center text-2xl">🎒</div>
              </div>
            </div>
          </div>

          <!-- Desglose -->
          <div class="grid grid-cols-1 gap-8">
            <div class="space-y-4">
              <h4 class="font-black text-slate-800 text-sm px-4 flex items-center gap-2">
                <i data-lucide="check-circle" class="w-4 h-4 text-emerald-500"></i> Tareas Calificadas
              </h4>
              <div class="space-y-3">
                ${taskEvidences.length > 0 ? taskEvidences.map(t => this.renderTaskEvidenceCard(t)).join('') : Helpers.emptyState('Sin tareas aún', '📝')}
              </div>
            </div>
          </div>
        </div>
      `;

      // Solo inicializar lucide, ya no hay gráfico
      setTimeout(() => {
        if (window.lucide) lucide.createIcons();
      }, 50);

    } catch (err) {
      console.error('Error loadGrades:', err);
      container.innerHTML = Helpers.emptyState('Error al cargar calificaciones', '❌');
    }
  },

  calculateGPA(grades, taskEvidences) {
    // Calcular promedio combinando grades + task_evidences con grade_letter
    const letterToScore = { 'A': 100, 'B': 85, 'C': 70, 'D': 55 };
    const scores = [];
    grades.forEach(g => { if (parseFloat(g.score)) scores.push(parseFloat(g.score)); });
    taskEvidences.forEach(t => { if (t.grade_letter && letterToScore[t.grade_letter]) scores.push(letterToScore[t.grade_letter]); });
    if (!scores.length) return '—';
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return avg.toFixed(1);
  },

  getGPALabel(gpa) {
    if (gpa === '—') return { label: 'Sin datos aún', color: 'text-slate-400' };
    const n = parseFloat(gpa);
    if (n >= 90) return { label: '\u00a1Excelente progreso!', color: 'text-emerald-200' };
    if (n >= 75) return { label: 'Muy buen desempe\u00f1o', color: 'text-emerald-200' };
    if (n >= 60) return { label: 'Progreso aceptable', color: 'text-yellow-200' };
    return { label: 'Necesita mejorar', color: 'text-red-200' };
  },

  renderGradeCard(g) {
    const score = parseFloat(g.score) || 0;
    const color = score >= 90 ? 'text-emerald-500' : (score >= 70 ? 'text-blue-500' : 'text-amber-500');
    const bg = score >= 90 ? 'bg-emerald-50' : (score >= 70 ? 'bg-blue-50' : 'bg-amber-50');
    
    return `
      <div class="bg-white p-4 rounded-3xl border-2 border-slate-50 shadow-sm hover:shadow-md transition-all flex items-center justify-between group">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl ${bg} flex items-center justify-center group-hover:scale-110 transition-transform">
            <i data-lucide="book" class="w-5 h-5 ${color}"></i>
          </div>
          <div>
            <h4 class="font-bold text-slate-700 text-sm">${escapeHtml(g.subject || 'Materia')}</h4>
            <p class="text-[9px] text-slate-400 font-bold uppercase tracking-widest">${Helpers.formatDate(g.created_at)}</p>
          </div>
        </div>
        <div class="text-right">
          <div class="text-xl font-black ${color}">${score}</div>
          <p class="text-[8px] font-bold uppercase text-slate-300">Puntaje</p>
        </div>
      </div>
    `;
  },

  renderTaskEvidenceCard(t) {
    const gradeColors = {
      'A': { bg: 'bg-emerald-500', text: 'text-white', ring: 'ring-emerald-200', icon: 'bg-emerald-50 text-emerald-600', label: 'Excelente' },
      'B': { bg: 'bg-blue-500',    text: 'text-white', ring: 'ring-blue-200',    icon: 'bg-blue-50 text-blue-600',    label: 'Bien' },
      'C': { bg: 'bg-amber-500',   text: 'text-white', ring: 'ring-amber-200',   icon: 'bg-amber-50 text-amber-600',  label: 'Suficiente' },
      'D': { bg: 'bg-rose-500',    text: 'text-white', ring: 'ring-rose-200',    icon: 'bg-rose-50 text-rose-600',    label: 'Mejorable' },
    };
    const grade = t.grade_letter || 'A';
    const c = gradeColors[grade] || gradeColors['A'];
    const starsHtml = t.stars
      ? `<div class="flex items-center gap-0.5 mt-1 justify-end">${Array(t.stars).fill('<span class="text-amber-400 text-xs">\u2605</span>').join('')}</div>`
      : '';
    return `
      <div class="bg-white p-4 rounded-3xl border-2 border-slate-50 shadow-sm hover:shadow-lg transition-all flex items-center justify-between group ring-2 ${c.ring}">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-2xl ${c.icon} flex items-center justify-center group-hover:scale-110 transition-transform shrink-0">
            <i data-lucide="file-check" class="w-5 h-5"></i>
          </div>
          <div class="min-w-0">
            <h5 class="font-bold text-slate-700 text-sm truncate">${escapeHtml(t.tasks?.title || 'Tarea')}</h5>
            <p class="text-[9px] text-slate-400 font-bold uppercase">${Helpers.formatDate(t.created_at)}</p>
            ${t.comment ? `<p class="text-[10px] text-slate-500 mt-0.5 italic truncate">"${escapeHtml(t.comment)}"</p>` : ''}
          </div>
        </div>
        <div class="text-right shrink-0 ml-3">
          <span class="px-3 py-1.5 rounded-xl ${c.bg} ${c.text} text-xs font-black uppercase tracking-tight shadow-sm">
            ${grade}
          </span>
          <p class="text-[8px] font-bold text-slate-400 mt-1 uppercase">${c.label}</p>
          ${starsHtml}
        </div>
      </div>
    `;
  },

  renderChart(grades) {
    const canvas = document.getElementById('gradesChart');
    if (!canvas || !window.Chart || grades.length === 0) return;

    const chartData = [...grades].slice(0, 8).reverse();
    const labels = chartData.map(g => g.subject || 'Materia');
    const scores = chartData.map(g => parseFloat(g.score) || 0);

    new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Puntaje',
          data: scores,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.05)',
          borderWidth: 3,
          tension: 0.4,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#6366f1',
          pointBorderWidth: 2,
          pointRadius: 4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b',
            titleFont: { family: 'Nunito', size: 12, weight: 'bold' },
            bodyFont: { family: 'Nunito', size: 11 },
            padding: 10,
            cornerRadius: 12,
            displayColors: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: '#f1f5f9', drawBorder: false },
            ticks: { font: { family: 'Nunito', weight: '700', size: 10 }, color: '#94a3b8' }
          },
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Nunito', weight: '700', size: 9 }, color: '#94a3b8' }
          }
        }
      }
    });
  }
};
