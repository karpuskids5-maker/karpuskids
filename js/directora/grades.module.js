import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { AppState } from './state.js';

export const GradesModule = {
  async init() {
    const tableBody = document.getElementById('gradesTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div></td></tr>';
    
    try {
      const { data: grades, error } = await DirectorApi.getTaskGrades();
      if (error) throw error;

      if (!grades?.length) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-12 text-slate-400">No hay calificaciones registradas.</td></tr>';
        this.updateKPIs([]);
        return;
      }

      // Agrupar por estudiante para calcular promedios
      const studentGrades = {};
      grades.forEach(g => {
        if (!g.student) return;
        if (!studentGrades[g.student_id]) {
          studentGrades[g.student_id] = {
            name: g.student.name,
            classroom: g.task?.classroom?.name || g.student.classrooms?.name || 'Sin Aula',
            total: 0,
            count: 0,
            tasks: []
          };
        }
        
        let value = 0;
        if (g.stars) value = (g.stars / 5) * 10;
        else if (g.grade_letter) {
          const letterMap = { 'A': 10, 'B': 8.5, 'C': 7, 'D': 6, 'E': 4 };
          value = letterMap[g.grade_letter] || 0;
        }

        if (value > 0) {
          studentGrades[g.student_id].total += value;
          studentGrades[g.student_id].count++;
        }
        studentGrades[g.student_id].tasks.push(g);
      });

      const studentList = Object.values(studentGrades);
      
      // Renderizar Tabla
      tableBody.innerHTML = studentList.map(s => {
        const avg = s.count > 0 ? (s.total / s.count).toFixed(1) : '—';
        const avgNum = parseFloat(avg) || 0;
        const colorClass = avgNum >= 9 ? 'text-emerald-600 bg-emerald-50' : avgNum >= 7 ? 'text-amber-600 bg-amber-50' : 'text-rose-600 bg-rose-50';
        const taskLabels = s.tasks.slice(0, 3).map(t => `<span class="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-bold text-slate-600 truncate max-w-[80px] inline-block">${Helpers.escapeHTML(t.task?.title || 'Tarea')}</span>`).join('');
        
        return `
          <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
            <td class="px-6 py-4">
              <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm">${s.name.charAt(0)}</div>
                <div>
                  <div class="font-bold text-slate-800 text-sm">${Helpers.escapeHTML(s.name)}</div>
                  <div class="text-[10px] text-slate-400 font-bold uppercase">${s.classroom}</div>
                </div>
              </div>
            </td>
            <td class="px-6 py-4 text-center">
              <span class="px-3 py-1 rounded-lg ${colorClass} font-black text-sm">${avg}</span>
            </td>
            <td class="px-6 py-4 text-center text-sm font-bold text-slate-600">${s.count}</td>
            <td class="px-6 py-4"><div class="flex gap-1 flex-wrap">${taskLabels}</div></td>
          </tr>`;
      }).join('');

      // Actualizar KPIs
      this.updateKPIs(studentList);

      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('Error loading grades:', e);
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-red-500">Error al cargar calificaciones.</td></tr>';
    }
  },

  updateKPIs(studentList) {
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    
    if (!studentList || studentList.length === 0) {
      setTxt('kpiAvgGrade', 'N/A');
      setTxt('kpiApprovalRate', 'N/A');
      setTxt('kpiNeedsSupport', '0');
      setTxt('kpiLowGrades', '0');
      return;
    }

    const totalStudents = studentList.length;
    let sumAvgs = 0;
    let approvedCount = 0;
    let needsSupportCount = 0;
    let lowGradesCount = 0;

    studentList.forEach(s => {
      const avg = s.count > 0 ? s.total / s.count : 0;
      sumAvgs += avg;
      
      if (avg >= 7) approvedCount++;
      if (avg > 0 && avg < 7.5) needsSupportCount++;
      if (avg > 0 && avg < 6) lowGradesCount++;
    });

    const totalAvg = (sumAvgs / totalStudents).toFixed(1);
    const approvalRate = Math.round((approvedCount / totalStudents) * 100);

    setTxt('kpiAvgGrade', totalAvg);
    setTxt('kpiApprovalRate', `${approvalRate}%`);
    setTxt('kpiNeedsSupport', needsSupportCount);
    setTxt('kpiLowGrades', lowGradesCount);
  }
};
