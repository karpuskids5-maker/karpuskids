import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { supabase } from '../shared/supabase.js';
import { AppState } from './state.js';

function scoreFromEvidence(g) {
  if (g.stars != null) return Number(g.stars);
  if (g.grade_letter) {
    const map = { A: 5, B: 4, C: 3, D: 2, E: 1 };
    return map[g.grade_letter] || 0;
  }
  return 0;
}

function getLevel(score) {
  if (score >= 4.5) return { label: 'Excelente',     cls: 'bg-emerald-100 text-emerald-700' };
  if (score >= 3.5) return { label: 'Bueno',          cls: 'bg-blue-100 text-blue-700' };
  if (score >= 2.5) return { label: 'En proceso',     cls: 'bg-amber-100 text-amber-700' };
  return              { label: 'Requiere apoyo', cls: 'bg-rose-100 text-rose-700' };
}

export const GradesModule = {
  _currentPeriodId: null,
  _periods: [],
  _allData: [], // Store processed data for modals

  async init() {
    const container = document.getElementById('gradesTableBody');
    if (!container) return;

    await this._loadPeriods();
    await this.loadGrades();

    document.getElementById('gradesFilterPeriod')?.addEventListener('change', (e) => {
      this._currentPeriodId = e.target.value || null;
      this.loadGrades();
    });
    
    const searchInput = document.getElementById('searchGradeStudent');
    if (searchInput && !searchInput._bound) {
      searchInput._bound = true;
      searchInput.addEventListener('input', () => this.applyFilters());
    }

    const classFilter = document.getElementById('gradesFilterClassroom');
    if (classFilter && !classFilter._bound) {
      classFilter._bound = true;
      classFilter.addEventListener('change', () => this.applyFilters());
      
      // Poblar opciones de aulas en el filtro de calificaciones si están disponibles
      const { data: rooms } = await DirectorApi.getClassrooms();
      if (rooms) {
        classFilter.innerHTML = '<option value="all">Todas las aulas</option>' +
          rooms.map(r => `<option value="${r.id}">${Helpers.escapeHTML(r.name)}</option>`).join('');
      }
    }

    document.getElementById('btnClosePeriod')?.addEventListener('click', () => this._closePeriod());
    document.getElementById('btnNewPeriod')?.addEventListener('click', () => this._openPeriodModal());
    document.getElementById('btnExportGrades')?.addEventListener('click', () => this._exportGrades());
  },

  async _loadPeriods() {
    try {
      const { data: periods } = await DirectorApi.getPeriods();
      this._periods = periods || [];
      const sel = document.getElementById('gradesFilterPeriod');
      if (!sel) return;

      sel.innerHTML = '<option value="">Todos los periodos</option>' +
        this._periods.map(p =>
          '<option value="' + p.id + '">' + Helpers.escapeHTML(p.name) + ' ' + (p.status === 'closed' ? '🔒' : '🟢') + '</option>'
        ).join('');

      const active = this._periods.find(p => p.is_active) || this._periods.find(p => p.status === 'open');
      if (active) {
        sel.value = active.id;
        this._currentPeriodId = String(active.id);
      } else if (this._periods.length > 0) {
        // Si no hay ninguno activo/abierto, seleccionar el más reciente por defecto
        sel.value = this._periods[0].id;
        this._currentPeriodId = String(this._periods[0].id);
      }
      
      const btnClose = document.getElementById('btnClosePeriod');
      if (btnClose) btnClose.style.display = active && active.status === 'open' ? 'flex' : 'none';
    } catch (e) { console.error('[GradesModule] _loadPeriods:', e); }
  },

  async loadGrades() {
    const tableBody = document.getElementById('gradesTableBody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-12"><div class="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mx-auto"></div><p class="mt-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Calculando promedios...</p></td></tr>';
    
    try {
      // 1. Obtener todos los estudiantes activos
      const { data: students, error: sError } = await DirectorApi.getStudents();
      if (sError) throw sError;

      // 2. Obtener evidencias calificadas
      let query = supabase
        .from('task_evidences')
        .select(`
          id, stars, grade_letter, status, comment, file_url, created_at, student_id,
          tasks:task_id(id, title, created_at)
        `)
        .eq('status', 'graded')
        .order('created_at', { ascending: false });

      // Filtrar por periodo si hay uno seleccionado
      if (this._currentPeriodId) {
        const period = this._periods.find(p => String(p.id) === String(this._currentPeriodId));
        if (period) {
          query = query.gte('created_at', period.start_date).lte('created_at', period.end_date);
        }
      }

      const { data: evidences, error } = await query;
      if (error) throw error;

      // 3. Inicializar mapa con TODOS los estudiantes para asegurar que aparezcan aunque no tengan notas
      const grouped = {};
      (students || []).forEach(s => {
        grouped[s.id] = {
          sid: s.id,
          name: s.name,
          classroom: s.classrooms?.name || 'Sin aula',
          classroom_id: s.classroom_id,
          evidences: []
        };
      });

      // 4. Poblar evidencias en los estudiantes correspondientes
      (evidences || []).forEach(ev => {
        const sid = ev.student_id;
        if (grouped[sid]) {
          const score = scoreFromEvidence(ev);
          grouped[sid].evidences.push({ ...ev, score });
        }
      });

      // Procesar datos finales
      this._allData = Object.values(grouped).map(s => {
        const scores = s.evidences.map(e => e.score).filter(sc => sc > 0);
        const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        
        // La última tarea calificada es la primera del array (ya ordenado DESC por created_at)
        const lastTask = s.evidences[0];

        return {
          ...s,
          avg,
          lastTask
        };
      });

      this.applyFilters();
      this._updateKPIs(this._allData);

    } catch (e) {
      console.error('[GradesModule] loadGrades:', e);
      tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-12 text-rose-500 font-bold">Error al conectar con el centro de calificaciones.</td></tr>';
    }
  },

  applyFilters() {
    const tableBody = document.getElementById('gradesTableBody');
    if (!tableBody) return;

    const search = (document.getElementById('searchGradeStudent')?.value || '').toLowerCase();
    const classFilter = document.getElementById('gradesFilterClassroom')?.value || 'all';

    let filtered = this._allData;
    if (search) filtered = filtered.filter(s => s.name.toLowerCase().includes(search));
    if (classFilter !== 'all') filtered = filtered.filter(s => String(s.classroom_id) === classFilter);

    if (!filtered.length) {
      tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-16 text-slate-400 font-medium">No se encontraron registros con los filtros aplicados.</td></tr>';
      return;
    }

    // Ordenar por última actividad (created_at de la última tarea)
    filtered.sort((a, b) => new Date(b.lastTask?.created_at) - new Date(a.lastTask?.created_at));

    tableBody.innerHTML = filtered.map(s => {
      const level = getLevel(s.avg);
      const taskCount = s.evidences.length;
      const rateBar = taskCount > 0 ? Math.min(100, Math.round((s.avg / 5) * 100)) : 0;
      const barColor = rateBar >= 80 ? 'bg-emerald-500' : rateBar >= 60 ? 'bg-amber-500' : 'bg-rose-500';

      return `
        <tr class="hover:bg-slate-50 border-b border-slate-100 transition-all cursor-pointer group" 
            ondblclick="App.grades.openStudentDetail('${s.sid}')">
          <td class="px-6 py-4">
            <div class="flex items-center gap-4">
              <div class="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm group-hover:scale-110 transition-transform">
                ${s.name.charAt(0)}
              </div>
              <div>
                <div class="font-black text-slate-800 text-sm">${Helpers.escapeHTML(s.name)}</div>
                <div class="text-[10px] text-slate-400 font-black uppercase tracking-tighter">${s.classroom}</div>
              </div>
            </div>
          </td>
          <td class="px-6 py-4 text-center">
            <div class="flex flex-col items-center gap-1">
              <span class="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-black text-sm border border-slate-200">
                ${s.avg.toFixed(1)}
              </span>
              <div class="w-16 bg-slate-100 rounded-full h-1 overflow-hidden">
                <div class="${barColor} h-full rounded-full" style="width:${rateBar}%"></div>
              </div>
            </div>
          </td>
          <td class="px-6 py-4 text-center">
            <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase shadow-sm ${level.cls}">
              ${level.label}
            </span>
          </td>
          <td class="px-6 py-4">
            <div class="flex items-center gap-3">
              <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-indigo-50 text-indigo-600 border border-indigo-100 shrink-0">
                <i data-lucide="file-check" class="w-3 h-3"></i>${taskCount} tarea${taskCount !== 1 ? 's' : ''}
              </span>
              <div class="min-w-0">
                <div class="text-xs font-bold text-slate-700 truncate max-w-[160px]">${Helpers.escapeHTML(s.lastTask?.tasks?.title || 'Sin tareas')}</div>
                <div class="text-[9px] text-slate-400 font-bold uppercase">${s.lastTask ? new Date(s.lastTask.created_at).toLocaleDateString() : '—'}</div>
              </div>
            </div>
          </td>
        </tr>`;
    }).join('');

    if (window.lucide) lucide.createIcons();
  },

  _updateKPIs(list) {
    const valid = list.filter(s => s.avg > 0);
    const globalAvg = valid.length ? valid.reduce((a, b) => a + b.avg, 0) / valid.length : 0;
    const approvalRate = valid.length ? Math.round((valid.filter(s => s.avg >= 2.5).length / valid.length) * 100) : 0;
    
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    
    set('kpiAvgGrade', globalAvg > 0 ? globalAvg.toFixed(1) : '0.0');
    set('kpiApprovalRate', approvalRate + '%');
    set('kpiNeedsSupport', valid.filter(s => s.avg < 2.5).length);
    set('kpiLowGrades', valid.filter(s => s.avg < 2).length);
  },

  openStudentDetail(studentId) {
    const data = this._allData.find(s => String(s.sid) === String(studentId));
    if (!data) return;

    const modalHtml = `
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div class="bg-indigo-600 p-6 text-white flex justify-between items-center">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center text-2xl">🎓</div>
            <div>
              <h3 class="text-2xl font-black">${Helpers.escapeHTML(data.name)}</h3>
              <p class="text-sm font-bold text-indigo-100 uppercase tracking-widest">${data.classroom} • Promedio: ${data.avg.toFixed(1)}</p>
            </div>
          </div>
          <button onclick="App.ui.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors">
            <i data-lucide="x" class="w-6 h-6"></i>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-6 bg-slate-50">
          <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <table class="w-full text-left">
              <thead class="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                <tr>
                  <th class="px-6 py-4">Tarea / Evidencia</th>
                  <th class="px-6 py-4 text-center">Nota</th>
                  <th class="px-6 py-4 text-center">Fecha</th>
                  <th class="px-6 py-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-50">
                ${data.evidences.map(ev => `
                  <tr class="hover:bg-indigo-50/30 transition-colors">
                    <td class="px-6 py-4">
                      <div class="font-bold text-slate-800 text-sm">${Helpers.escapeHTML(ev.tasks?.title || 'Tarea')}</div>
                      <div class="text-[10px] text-slate-400 font-medium truncate max-w-xs">${Helpers.escapeHTML(ev.comment || 'Sin comentarios')}</div>
                    </td>
                    <td class="px-6 py-4 text-center">
                      <span class="px-3 py-1 rounded-lg bg-white border border-slate-200 font-black text-indigo-600 shadow-sm">
                        ${ev.score.toFixed(1)}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-center text-xs font-bold text-slate-500">
                      ${new Date(ev.created_at).toLocaleDateString()}
                    </td>
                    <td class="px-6 py-4 text-right">
                      <button onclick="App.grades.viewEvidence('${ev.id}')" class="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-xs hover:bg-indigo-600 hover:text-white transition-all shadow-sm">
                        Ver Evidencia
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    window.openGlobalModal(modalHtml, true);
    if (window.lucide) lucide.createIcons();
  },

  viewEvidence(evidenceId) {
    // Buscar la evidencia en todos los datos
    let evidence = null;
    for (const student of this._allData) {
      evidence = student.evidences.find(e => String(e.id) === String(evidenceId));
      if (evidence) break;
    }

    if (!evidence) return;

    const modalHtml = `
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div class="relative h-64 bg-slate-900">
          <img src="${evidence.file_url || 'img/placeholder-task.jpg'}" class="w-full h-full object-contain" alt="Evidencia">
          <button onclick="App.ui.closeModal()" class="absolute top-4 right-4 w-10 h-10 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-black/70 transition-all">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>
        <div class="p-6">
          <div class="flex justify-between items-start mb-4">
            <div>
              <h4 class="text-xl font-black text-slate-800">${Helpers.escapeHTML(evidence.tasks?.title || 'Tarea')}</h4>
              <p class="text-xs font-bold text-slate-400 uppercase tracking-widest">${new Date(evidence.created_at).toLocaleDateString()}</p>
            </div>
            <div class="text-right">
               <div class="text-[10px] font-black text-slate-400 uppercase mb-1">Nota</div>
               <div class="text-2xl font-black text-indigo-600">${evidence.score.toFixed(1)}</div>
            </div>
          </div>
          <div class="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-6">
            <p class="text-xs font-black text-slate-400 uppercase mb-2">Comentario de la Maestra</p>
            <p class="text-sm text-slate-700 leading-relaxed italic">"${Helpers.escapeHTML(evidence.comment || 'No hay comentarios para esta tarea.')}"</p>
          </div>
          <button onclick="App.ui.closeModal()" class="w-full py-3 bg-slate-800 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-900 transition-all shadow-lg">
            Cerrar Vista
          </button>
        </div>
      </div>
    `;

    // Usamos el contenedor de modales global si existe, o creamos un overlay temporal
    window.openGlobalModal(modalHtml);
    if (window.lucide) lucide.createIcons();
  },

  async _closePeriod() {
    const periodId = this._currentPeriodId;
    if (!periodId) return Helpers.toast('Selecciona un periodo abierto', 'warning');
    const period = this._periods.find(p => String(p.id) === String(periodId));
    if (!period || period.status === 'closed') return Helpers.toast('Este periodo ya esta cerrado', 'warning');
    
    if (!confirm('¿Cerrar el periodo "' + period.name + '"?\n\nEsta acción bloqueará las calificaciones actuales. ¿Deseas continuar?')) return;

    try {
      const { error } = await supabase.from('periods').update({ status: 'closed', is_active: false }).eq('id', periodId);
      if (error) throw error;
      
      Helpers.toast('Periodo cerrado correctamente', 'success');
      await this._loadPeriods();
      await this.loadGrades();
    } catch (e) {
      console.error(e);
      Helpers.toast('Error al cerrar periodo', 'error');
    }
  },

  _openPeriodModal() {
    const ic = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 bg-slate-50/50 transition-all text-sm font-medium';
    const lc = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';
    const y = new Date().getFullYear();
    
    const modalHtml = `
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div class="bg-indigo-600 p-6 text-white flex justify-between items-center">
          <h3 class="text-xl font-black">Nuevo Trimestre</h3>
          <button onclick="App.ui.closeModal()" class="text-white/70 hover:text-white"><i data-lucide="x"></i></button>
        </div>
        <div class="p-6 space-y-4">
          <div><label class="${lc}">Nombre del Periodo</label><input id="periodName" class="${ic}" placeholder="Ej: 1er Trimestre ${y}"></div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="${lc}">Fecha Inicio</label><input id="periodStart" type="date" class="${ic}"></div>
            <div><label class="${lc}">Fecha Fin</label><input id="periodEnd" type="date" class="${ic}"></div>
          </div>
          <div class="flex items-center gap-2 px-1">
            <input type="checkbox" id="periodIsActive" class="w-4 h-4 text-indigo-600 rounded border-slate-300">
            <label for="periodIsActive" class="text-xs font-bold text-slate-600 uppercase">Establecer como activo</label>
          </div>
        </div>
        <div class="p-6 bg-slate-50 flex justify-end gap-3">
          <button onclick="App.ui.closeModal()" class="px-6 py-2.5 text-xs font-black uppercase text-slate-400">Cancelar</button>
          <button id="btnSavePeriod" class="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase shadow-lg shadow-indigo-200">Crear Trimestre</button>
        </div>
      </div>
    `;
    
    window.openGlobalModal(modalHtml);
    document.getElementById('btnSavePeriod')?.addEventListener('click', () => this._savePeriod());
    if (window.lucide) lucide.createIcons();
  },

  async _savePeriod() {
    const name = document.getElementById('periodName')?.value;
    const start = document.getElementById('periodStart')?.value;
    const end = document.getElementById('periodEnd')?.value;
    const isActive = document.getElementById('periodIsActive')?.checked;

    if (!name || !start || !end) return Helpers.toast('Completa todos los campos', 'warning');

    try {
      // Si el nuevo periodo es activo, desactivamos los demás
      if (isActive) {
        await supabase.from('periods').update({ is_active: false }).eq('is_active', true);
      }

      const { error } = await supabase.from('periods').insert({
        name,
        start_date: start,
        end_date: end,
        status: 'open',
        is_active: isActive
      });

      if (error) throw error;
      
      Helpers.toast('Periodo creado correctamente', 'success');
      App.ui.closeModal();
      await this._loadPeriods();
      await this.loadGrades();
    } catch (e) {
      console.error(e);
      Helpers.toast('Error al crear periodo', 'error');
    }
  },

  _exportGrades() {
    if (!this._allData.length) return Helpers.toast('No hay datos para exportar', 'warning');
    
    const periodName = document.getElementById('gradesFilterPeriod')?.options[document.getElementById('gradesFilterPeriod')?.selectedIndex]?.text || 'Reporte';

    // 1. Preguntar formato (Simple Confirm para elegir)
    const choice = confirm('¿Deseas exportar en formato PDF?\n\n(Aceptar para PDF, Cancelar para CSV)');
    
    if (choice) {
      this._exportToPDF(periodName);
    } else {
      this._exportToCSV();
    }
  },

  _exportToCSV() {
    const csv = ['Estudiante,Aula,Promedio,Nivel,Tareas Calificadas'];
    this._allData.forEach(s => {
      const level = getLevel(s.avg);
      csv.push(`"${s.name}","${s.classroom}",${s.avg.toFixed(1)},"${level.label}",${s.evidences.length}`);
    });
    
    const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `calificaciones_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  _exportToPDF(periodName) {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      // Header
      doc.setFontSize(20);
      doc.setTextColor(79, 70, 229); // Indigo 600
      doc.text('Karpus Kids — Reporte de Calificaciones', 14, 22);
      
      doc.setFontSize(12);
      doc.setTextColor(100);
      doc.text(`Periodo: ${periodName}`, 14, 32);
      doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 14, 38);

      const tableData = this._allData.map(s => {
        const level = getLevel(s.avg);
        return [
          s.name,
          s.classroom,
          s.avg.toFixed(1),
          level.label,
          s.evidences.length
        ];
      });

      doc.autoTable({
        startY: 45,
        head: [['Estudiante', 'Aula', 'Promedio', 'Nivel', 'Tareas']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 9, font: 'helvetica' },
        columnStyles: {
          2: { halign: 'center', fontStyle: 'bold' },
          3: { halign: 'center' },
          4: { halign: 'center' }
        }
      });

      doc.save(`reporte_calificaciones_${new Date().toISOString().split('T')[0]}.pdf`);
      Helpers.toast('PDF generado correctamente', 'success');
    } catch (err) {
      console.error('Error generando PDF:', err);
      Helpers.toast('Error al generar PDF. Asegúrate de que las librerías cargaron correctamente.', 'error');
    }
  }
};
