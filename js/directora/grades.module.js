import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { supabase } from '../shared/supabase.js';
import { AppState } from './state.js';
import { auditLog } from '../shared/db-utils.js';

const LEVEL_LABELS = {
  estancia:   'Estancia',
  preescolar: 'Preescolar',
  primaria:   'Primaria'
};

function getLevel(score) {
  if (score === null || score === undefined) return { label: 'Sin calificar', cls: 'bg-slate-100 text-slate-500' };
  if (score >= 90) return { label: 'Excelente',      cls: 'bg-emerald-100 text-emerald-700' };
  if (score >= 80) return { label: 'Bueno',           cls: 'bg-blue-100 text-blue-700' };
  if (score >= 70) return { label: 'En proceso',      cls: 'bg-amber-100 text-amber-700' };
  return              { label: 'Requiere apoyo', cls: 'bg-rose-100 text-rose-700' };
}

function scoreBar(score) {
  if (score == null) return '<div class="w-full bg-slate-100 rounded-full h-1.5"></div>';
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500';
  return `<div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden"><div class="${color} h-full rounded-full transition-all" style="width:${pct}%"></div></div>`;
}

export const GradesModule = {
  _currentPeriodId: null,
  _periods: [],
  _subjects: [],
  _config: [],
  _activities: [],
  _allStudents: [],
  _view: 'config', // 'config' | 'grades'

  async init() {
    const container = document.getElementById('gradesTableBody');
    if (!container) return;

    await this._loadPeriods();
    this._bindEvents();

    if (this._currentPeriodId) {
      await this._loadData();
    }
  },

  _bindEvents() {
    const bind = (id, ev, fn) => {
      const el = document.getElementById(id);
      if (el && !el._bound) { el._bound = true; el.addEventListener(ev, fn); }
    };

    bind('gradesFilterPeriod', 'change', (e) => {
      this._currentPeriodId = e.target.value || null;
      this._loadData();
    });
    bind('searchGradeStudent', 'input', () => this._renderGradesTable());
    bind('gradesFilterClassroom', 'change', () => this._renderGradesTable());
    bind('btnNewPeriod', 'click', () => this._openPeriodModal());
    bind('btnClosePeriod', 'click', () => this._closePeriod());
    bind('btnExportGrades', 'click', () => this._exportGrades());
    bind('btnGradesConfig', 'click', () => this._switchView('config'));
    bind('btnGradesView', 'click', () => this._switchView('grades'));
  },

  _switchView(view) {
    this._view = view;
    const cfgBtn = document.getElementById('btnGradesConfig');
    const viewBtn = document.getElementById('btnGradesView');
    if (cfgBtn) cfgBtn.className = view === 'config'
      ? 'px-4 py-2 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase shadow-md'
      : 'px-4 py-2 bg-slate-100 text-slate-500 rounded-xl font-black text-xs uppercase hover:bg-slate-200 transition-all';
    if (viewBtn) viewBtn.className = view === 'grades'
      ? 'px-4 py-2 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase shadow-md'
      : 'px-4 py-2 bg-slate-100 text-slate-500 rounded-xl font-black text-xs uppercase hover:bg-slate-200 transition-all';

    if (view === 'config') this._renderConfig();
    else this._renderGradesTable();
  },

  async _loadPeriods() {
    try {
      const { data: periods } = await DirectorApi.getPeriods();
      this._periods = periods || [];
      const sel = document.getElementById('gradesFilterPeriod');
      if (!sel) return;

      sel.innerHTML = '<option value="">Seleccionar periodo</option>' +
        this._periods.map(p =>
          `<option value="${p.id}">${Helpers.escapeHTML(p.name)} ${p.status === 'closed' ? '(Cerrado)' : '(Abierto)'}</option>`
        ).join('');

      const active = this._periods.find(p => p.is_active) || this._periods.find(p => p.status === 'open');
      if (active) {
        sel.value = active.id;
        this._currentPeriodId = String(active.id);
      }

      const btnClose = document.getElementById('btnClosePeriod');
      if (btnClose) btnClose.style.display = active && active.status === 'open' ? 'flex' : 'none';
    } catch (_) {}
  },

  async _loadData() {
    if (!this._currentPeriodId) return;

    const tableBody = document.getElementById('gradesTableBody');
    if (tableBody) {
      tableBody.innerHTML = `
        <tr><td colspan="5" class="px-6 py-12 text-center">
          <div class="h-8 bg-slate-100 rounded-xl animate-pulse w-48 mx-auto mb-3"></div>
          <div class="h-8 bg-slate-100 rounded-xl animate-pulse w-32 mx-auto opacity-60"></div>
        </td></tr>`;
    }

    try {
      const [configRes, activitiesRes, studentsRes] = await Promise.all([
        DirectorApi.getPeriodConfig(this._currentPeriodId),
        DirectorApi.getActivitiesWithGrades(this._currentPeriodId),
        DirectorApi.getStudents({ status: 'active' })
      ]);

      this._config = configRes?.data || [];
      this._activities = activitiesRes?.data || [];
      this._allStudents = studentsRes?.data || [];

      // Load subjects
      const { data: subjects } = await DirectorApi.getSubjects();
      this._subjects = subjects || [];

      this._updateKPIs();
      this._switchView(this._view);
    } catch (e) {
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-12">
          <div class="flex flex-col items-center gap-3">
            <div class="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center text-2xl">⚠️</div>
            <p class="font-bold text-slate-700">Error al cargar datos</p>
            <p class="text-xs text-slate-400">${Helpers.escapeHTML(e?.message || '')}</p>
            <button onclick="App.grades._loadData()" class="px-4 py-2 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase hover:bg-indigo-700 transition-all">Reintentar</button>
          </div>
        </td></tr>`;
      }
    }
  },

  _updateKPIs() {
    const period = this._periods.find(p => String(p.id) === String(this._currentPeriodId));
    Helpers.setTxt('kpiAvgGrade', this._config.length);
    Helpers.setTxt('kpiApprovalRate', this._activities.length);
    Helpers.setTxt('kpiNeedsSupport', this._allStudents.length);
    Helpers.setTxt('kpiLowGrades', this._config.reduce((sum, c) => sum + (c.activity_count || 0), 0));
  },

  // ── VISTA: CONFIGURACIÓN ─────────────────────────────────

  _renderConfig() {
    const container = document.getElementById('gradesTableBody');
    if (!container) return;

    const period = this._periods.find(p => String(p.id) === String(this._currentPeriodId));
    if (!period) {
      container.innerHTML = `<tr><td colspan="5" class="text-center py-16 text-slate-400">
        <div class="flex flex-col items-center gap-3">
          <div class="w-16 h-16 bg-indigo-50 rounded-3xl flex items-center justify-center text-3xl">📋</div>
          <p class="font-bold text-slate-600">Selecciona un periodo para configurarlo</p>
          <p class="text-xs text-slate-400">Crea un periodo o selecciona uno existente</p>
        </div>
      </td></tr>`;
      return;
    }

    const isClosed = period.status === 'closed';
    const grouped = {};
    this._subjects.forEach(s => {
      if (!grouped[s.education_level]) grouped[s.education_level] = [];
      grouped[s.education_level].push(s);
    });

    let html = '';
    for (const [level, subjects] of Object.entries(grouped)) {
      const levelConfig = this._config.filter(c => c.education_level === level);
      const configMap = {};
      levelConfig.forEach(c => { configMap[c.subject_id] = c; });

      html += `
        <tr><td colspan="5" class="px-6 pt-6 pb-2">
          <div class="flex items-center gap-2 mb-3">
            <span class="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-black uppercase">${LEVEL_LABELS[level] || level}</span>
            <span class="text-xs text-slate-400 font-bold">${subjects.length} materias</span>
          </div>
        </td></tr>
        ${subjects.map(s => {
          const cfg = configMap[s.id];
          const count = cfg?.activity_count || 5;
          const actCount = this._activities.filter(a => a.subject_id === s.id).length;
          return `
            <tr class="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
              <td class="px-6 py-3">
                <div class="font-bold text-slate-800 text-sm">${Helpers.escapeHTML(s.name)}</div>
                <div class="text-[10px] text-slate-400 font-medium">${Helpers.escapeHTML(s.description || '')}</div>
              </td>
              <td class="px-6 py-3 text-center">
                <div class="flex items-center justify-center gap-2">
                  ${isClosed ? `
                    <span class="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl font-black text-sm">${count}</span>
                  ` : `
                    <button onclick="App.grades._adjustCount(${s.id}, -1)" class="w-8 h-8 bg-slate-100 text-slate-500 rounded-lg font-black hover:bg-slate-200 transition-all flex items-center justify-center text-sm">−</button>
                    <span id="cfg-count-${s.id}" class="px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-black text-sm text-indigo-700 min-w-[40px] text-center">${count}</span>
                    <button onclick="App.grades._adjustCount(${s.id}, 1)" class="w-8 h-8 bg-slate-100 text-slate-500 rounded-lg font-black hover:bg-slate-200 transition-all flex items-center justify-center text-sm">+</button>
                  `}
                </div>
              </td>
              <td class="px-6 py-3 text-center">
                <span class="px-3 py-1 rounded-full text-xs font-black ${actCount >= count ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">
                  ${actCount}/${count} actividades
                </span>
              </td>
              <td class="px-6 py-3 text-center">
                ${cfg ? `<button onclick="App.grades._removeSubjectConfig(${cfg.id})" class="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all ${isClosed ? 'hidden' : ''}" title="Quitar materia">
                  <i data-lucide="x" class="w-4 h-4"></i>
                </button>` : `
                  <button onclick="App.grades._addSubjectConfig(${s.id})" class="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-all ${isClosed ? 'hidden' : ''}">
                    <i data-lucide="plus" class="w-3 h-3 inline"></i> Agregar
                  </button>
                `}
              </td>
              <td></td>
            </tr>`;
        }).join('')}`;
    }

    if (!html) {
      html = `<tr><td colspan="5" class="text-center py-16 text-slate-400">
        <p class="font-bold">No hay materias disponibles para este periodo</p>
      </td></tr>`;
    }

    container.innerHTML = html;

    // Add save button at bottom if not closed
    if (!isClosed && this._config.length > 0) {
      container.innerHTML += `<tr><td colspan="5" class="px-6 py-6 text-center">
        <button onclick="App.grades._saveAllConfig()" class="px-8 py-3 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all">
          Guardar Configuración
        </button>
      </td></tr>`;
    }

    if (window.lucide) lucide.createIcons();
  },

  _pendingConfig: {},

  _adjustCount(subjectId, delta) {
    const el = document.getElementById(`cfg-count-${subjectId}`);
    if (!el) return;
    let current = parseInt(el.textContent) || 5;
    current = Math.min(8, Math.max(5, current + delta));
    el.textContent = current;
    this._pendingConfig[subjectId] = current;
  },

  async _addSubjectConfig(subjectId) {
    const count = this._pendingConfig[subjectId] || 5;
    const { error } = await DirectorApi.savePeriodConfig(this._currentPeriodId, [
      { subject_id: subjectId, activity_count: count }
    ]);
    if (error) return Helpers.toast('Error al guardar', 'error');
    Helpers.toast('Materia agregada', 'success');
    await this._loadData();
  },

  async _removeSubjectConfig(configId) {
    if (!confirm('Quitar esta materia del periodo?')) return;
    const { error } = await DirectorApi.deletePeriodConfig(configId);
    if (error) return Helpers.toast('Error al quitar', 'error');
    Helpers.toast('Materia removida', 'success');
    await this._loadData();
  },

  async _saveAllConfig() {
    const configs = Object.entries(this._pendingConfig).map(([sid, count]) => ({
      subject_id: parseInt(sid),
      activity_count: count
    }));

    if (!configs.length) return Helpers.toast('No hay cambios que guardar', 'warning');

    const { error } = await DirectorApi.savePeriodConfig(this._currentPeriodId, configs);
    if (error) return Helpers.toast('Error al guardar configuración', 'error');
    Helpers.toast('Configuración guardada', 'success');
    this._pendingConfig = {};
    await this._loadData();
  },

  // ── VISTA: CALIFICACIONES ────────────────────────────────

  _renderGradesTable() {
    const tableBody = document.getElementById('gradesTableBody');
    if (!tableBody) return;

    const period = this._periods.find(p => String(p.id) === String(this._currentPeriodId));
    if (!period) {
      tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-16 text-slate-400">
        Selecciona un periodo para ver las calificaciones
      </td></tr>`;
      return;
    }

    const search = (document.getElementById('searchGradeStudent')?.value || '').toLowerCase();
    const classFilter = document.getElementById('gradesFilterClassroom')?.value || 'all';

    let students = this._allStudents;
    if (search) students = students.filter(s => s.name.toLowerCase().includes(search));
    if (classFilter !== 'all') students = students.filter(s => String(s.classroom_id) === classFilter);

    if (!students.length) {
      tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-16 text-slate-400">
        No se encontraron estudiantes
      </td></tr>`;
      return;
    }

    // Build subject columns header
    const subjectCols = [...new Set(this._activities.map(a => ({ id: a.subject_id, name: a.subject_name })))];
    const subjectMap = {};
    subjectCols.forEach(s => { subjectMap[s.id] = s.name; });

    const headerRow = `
      <tr class="bg-slate-50 border-b border-slate-100">
        <th class="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Estudiante</th>
        <th class="px-6 py-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Promedio</th>
        <th class="px-6 py-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Nivel</th>
        <th class="px-6 py-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Actividades</th>
        <th class="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Acciones</th>
      </tr>`;

    tableBody.innerHTML = headerRow + students.map(s => {
      // Calculate student averages from activities
      const studentGrades = this._activities
        .filter(a => a.grade_count > 0)
        .map(a => {
          // We need to compute per-subject averages
          return a;
        });

      // Group activities by subject for this student's average display
      const subjectAvgs = {};
      subjectCols.forEach(sub => {
        const subActs = this._activities.filter(a => a.subject_id === sub.id);
        // Use the graded_count from the activity data as a proxy
        const totalGraded = subActs.reduce((sum, a) => sum + (a.graded_count || 0), 0);
        const totalActs = subActs.length;
        subjectAvgs[sub.id] = { graded: totalGraded, total: totalActs };
      });

      const totalGraded = this._activities.reduce((sum, a) => sum + (a.graded_count || 0), 0);
      const totalActs = this._activities.length;

      const classroom = s.classrooms?.name || 'Sin aula';
      const level = { label: 'En curso', cls: 'bg-blue-100 text-blue-700' };

      return `
        <tr class="hover:bg-slate-50 border-b border-slate-50 transition-all cursor-pointer group"
            ondblclick="App.grades.openStudentDetail('${s.id}')">
          <td class="px-6 py-4">
            <div class="flex items-center gap-4">
              <div class="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm group-hover:scale-110 transition-transform">
                ${s.name.charAt(0)}
              </div>
              <div>
                <div class="font-black text-slate-800 text-sm">${Helpers.escapeHTML(s.name)}</div>
                <div class="text-[10px] text-slate-400 font-black uppercase tracking-tighter">${Helpers.escapeHTML(classroom)}</div>
              </div>
            </div>
          </td>
          <td class="px-6 py-4 text-center">
            <div class="flex flex-col items-center gap-1">
              <span class="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-black text-sm border border-slate-200">—</span>
              ${scoreBar(null)}
            </div>
          </td>
          <td class="px-6 py-4 text-center">
            <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase shadow-sm ${level.cls}">
              ${level.label}
            </span>
          </td>
          <td class="px-6 py-4 text-center">
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-indigo-50 text-indigo-600 border border-indigo-100">
              <i data-lucide="file-check" class="w-3 h-3"></i>${totalGraded}/${totalActs}
            </span>
          </td>
          <td class="px-6 py-4">
            <div class="flex items-center gap-2 justify-end">
              <button onclick="event.stopPropagation();App.grades.openStudentDetail('${s.id}');"
                class="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-all">
                Ver Detalle
              </button>
              <button onclick="event.stopPropagation();App.grades.openStudentHistory('${s.id}','${Helpers.escapeHTML(s.name).replace(/'/g,"\\'")}');"
                class="p-1.5 bg-violet-50 text-violet-600 rounded-lg hover:bg-violet-100 transition-colors shrink-0" title="Historial">
                <i data-lucide="history" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');

    if (window.lucide) lucide.createIcons();
  },

  async openStudentDetail(studentId) {
    const student = this._allStudents.find(s => String(s.id) === String(studentId));
    if (!student) return;

    const period = this._periods.find(p => String(p.id) === String(this._currentPeriodId));
    if (!period) return;

    const modalHtml = `
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div class="bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white flex justify-between items-center">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center text-2xl font-black">${student.name.charAt(0)}</div>
            <div>
              <h3 class="text-2xl font-black">${Helpers.escapeHTML(student.name)}</h3>
              <p class="text-sm font-bold text-white/70 uppercase tracking-widest">${Helpers.escapeHTML(student.classrooms?.name || '')} — ${Helpers.escapeHTML(period.name)}</p>
            </div>
          </div>
          <button onclick="App.ui.closeModal()" class="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-xl flex items-center justify-center transition-colors">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-6 bg-slate-50" id="studentDetailContent">
          <div class="text-center py-8 text-slate-400">
            <div class="h-8 bg-slate-100 rounded-xl animate-pulse w-48 mx-auto mb-3"></div>
            Cargando calificaciones...
          </div>
        </div>
      </div>`;

    window.openGlobalModal(modalHtml, true);

    try {
      const [gradesRes, averagesRes] = await Promise.all([
        DirectorApi.getStudentGradesV2(studentId, this._currentPeriodId),
        DirectorApi.getStudentSubjectAverages(studentId, this._currentPeriodId)
      ]);

      const grades = gradesRes?.data || [];
      const averages = averagesRes?.data || [];

      const content = document.getElementById('studentDetailContent');
      if (!content) return;

      if (!averages.length && !grades.length) {
        content.innerHTML = `
          <div class="text-center py-12">
            <div class="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-4">📝</div>
            <p class="font-bold text-slate-600">Sin calificaciones registradas</p>
            <p class="text-xs text-slate-400 mt-1">Las calificaciones aparecerán cuando la maestra registre notas en las actividades</p>
          </div>`;
        return;
      }

      // Render subject averages
      let html = `
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          ${averages.map(avg => {
            const level = getLevel(avg.average);
            return `
              <div class="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">${Helpers.escapeHTML(avg.subject_name)}</div>
                <div class="text-3xl font-black text-indigo-700 mb-1">${Number(avg.average).toFixed(1)}</div>
                <div class="flex items-center gap-2">
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${level.cls}">${level.label}</span>
                  <span class="text-[10px] text-slate-400 font-bold">${avg.graded_count} actividad${avg.graded_count !== 1 ? 'es' : ''}</span>
                </div>
                ${scoreBar(avg.average)}
              </div>`;
          }).join('')}
        </div>`;

      // Group grades by subject
      const grouped = {};
      grades.forEach(g => {
        if (!grouped[g.subject_name]) grouped[g.subject_name] = [];
        grouped[g.subject_name].push(g);
      });

      html += `
        <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div class="px-6 py-4 bg-slate-50 border-b border-slate-100">
            <h4 class="font-black text-slate-800 text-sm uppercase tracking-widest">Detalle por Actividad</h4>
          </div>
          <table class="w-full text-left">
            <thead class="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
              <tr>
                <th class="px-6 py-3">Materia</th>
                <th class="px-6 py-3">Actividad</th>
                <th class="px-6 py-3 text-center">Calificación</th>
                <th class="px-6 py-3 text-right">Comentario</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-50">
              ${Object.entries(grouped).map(([subName, acts]) =>
                acts.map((g, i) => {
                  const level = getLevel(g.score);
                  return `
                    <tr class="hover:bg-indigo-50/30 transition-colors">
                      <td class="px-6 py-3">
                        ${i === 0 ? `<span class="font-bold text-slate-800 text-sm">${Helpers.escapeHTML(subName)}</span>` : ''}
                      </td>
                      <td class="px-6 py-3">
                        <span class="text-xs font-bold text-slate-600">${Helpers.escapeHTML(g.activity_title)}</span>
                        <span class="text-[10px] text-slate-400 ml-1">#${g.activity_number}</span>
                      </td>
                      <td class="px-6 py-3 text-center">
                        <span class="px-3 py-1 rounded-lg font-black text-sm ${level.cls}">${g.score != null ? Number(g.score).toFixed(1) : '—'}</span>
                      </td>
                      <td class="px-6 py-3 text-right text-xs text-slate-400 max-w-[160px] truncate">
                        ${Helpers.escapeHTML(g.comment || '—')}
                      </td>
                    </tr>`;
                }).join('')
              ).join('')}
            </tbody>
          </table>
        </div>`;

      content.innerHTML = html;
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      const content = document.getElementById('studentDetailContent');
      if (content) content.innerHTML = `<div class="text-center py-8 text-rose-500">Error: ${Helpers.escapeHTML(e?.message || '')}</div>`;
    }
  },

  // ── CERRAR PERÍODO ───────────────────────────────────────

  async _closePeriod() {
    const periodId = this._currentPeriodId;
    if (!periodId) return Helpers.toast('Selecciona un periodo', 'warning');
    const period = this._periods.find(p => String(p.id) === String(periodId));
    if (!period || period.status === 'closed') return Helpers.toast('Este periodo ya esta cerrado', 'warning');

    if (!this._config.length) {
      return Helpers.toast('Configura al menos una materia antes de cerrar', 'warning');
    }

    if (!confirm(
      '¿Cerrar el periodo "' + period.name + '"?\n\n' +
      '✅ Se calcularán promedios por materia (mejores 5 calificaciones).\n' +
      '📋 Se generarán boletas de calificaciones.\n' +
      '🔒 Las calificaciones quedarán bloqueadas.\n\n' +
      '¿Deseas continuar?'
    )) return;

    const btn = document.getElementById('btnClosePeriod');
    if (btn) { btn.disabled = true; btn.textContent = 'Cerrando...'; }

    try {
      const closeTimeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout al cerrar periodo')), 30000));
      const { data, error } = await Promise.race([supabase.rpc('close_period', { p_period_id: parseInt(periodId) }), closeTimeout]);
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const cards = data?.cards_generated || 0;
      Helpers.toast(`Periodo cerrado ✅ — ${cards} boleta${cards !== 1 ? 's' : ''} generada${cards !== 1 ? 's' : ''}`, 'success');
      auditLog('period.closed.v2', { period_id: periodId, period_name: period.name });
      await this._loadPeriods();
      await this._loadData();
    } catch (e) {
      Helpers.toast('Error al cerrar periodo: ' + (e.message || ''), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Cerrar Periodo'; }
    }
  },

  // ── CREAR PERÍODO ────────────────────────────────────────

  _openPeriodModal() {
    const ic = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 bg-slate-50/50 transition-all text-sm font-medium';
    const lc = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';
    const y = new Date().getFullYear();

    const modalHtml = `
      <div class="w-full max-w-md overflow-hidden">
        <div class="bg-indigo-600 p-6 text-white flex justify-between items-center">
          <h3 class="text-xl font-black">Nuevo Periodo</h3>
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
          <button id="btnSavePeriod" class="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase shadow-lg shadow-indigo-200">Crear Periodo</button>
        </div>
      </div>`;

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
      await this._loadData();
    } catch (e) {
      Helpers.toast('Error al crear periodo', 'error');
    }
  },

  // ── EXPORTAR ─────────────────────────────────────────────

  _exportGrades() {
    if (!this._allStudents.length) return Helpers.toast('No hay datos para exportar', 'warning');
    const choice = confirm('¿Exportar en formato PDF?\n\n(Aceptar para PDF, Cancelar para CSV)');
    if (choice) this._exportToPDF();
    else this._exportToCSV();
  },

  _exportToCSV() {
    const csv = ['Estudiante,Aula,Promedio,Nivel,Actividades Calificadas'];
    this._allStudents.forEach(s => {
      csv.push(`"${s.name}","${s.classrooms?.name || 'Sin aula'}",—,En curso,0`);
    });
    const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `calificaciones_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  _exportToPDF() {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      doc.setFontSize(20);
      doc.setTextColor(79, 70, 229);
      doc.text('Karpus Kids — Reporte de Calificaciones', 14, 22);
      doc.setFontSize(12);
      doc.setTextColor(100);
      const period = this._periods.find(p => String(p.id) === String(this._currentPeriodId));
      doc.text(`Periodo: ${period?.name || 'N/A'}`, 14, 32);
      doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 14, 38);

      const tableData = this._allStudents.map(s => [
        s.name, s.classrooms?.name || 'Sin aula', '—', 'En curso', '0'
      ]);

      doc.autoTable({
        startY: 45,
        head: [['Estudiante', 'Aula', 'Promedio', 'Nivel', 'Actividades']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 9 }
      });

      doc.save(`reporte_calificaciones_${new Date().toISOString().split('T')[0]}.pdf`);
      Helpers.toast('PDF generado', 'success');
    } catch (err) {
      Helpers.toast('Error al generar PDF', 'error');
    }
  },

  // ── HISTORIAL ────────────────────────────────────────────

  async openStudentHistory(studentId, studentName) {
    try {
      const { data, error } = await DirectorApi.getStudentHistory(studentId);
      if (error) throw error;

      const history = Array.isArray(data) ? data : [];

      const rows = history.length > 0 ? history.map(h => {
        const score = h.final_score != null ? Number(h.final_score).toFixed(1) : '-';
        const levelCls = {
          'Excelente':      'bg-emerald-100 text-emerald-700',
          'Bueno':          'bg-blue-100 text-blue-700',
          'En proceso':     'bg-amber-100 text-amber-700',
          'Requiere apoyo': 'bg-rose-100 text-rose-700',
          'Sin calificar':  'bg-slate-100 text-slate-500'
        }[h.level] || 'bg-slate-100 text-slate-500';

        return `
          <tr class="border-b border-slate-50 hover:bg-slate-50 transition-colors">
            <td class="px-4 py-3 text-sm font-bold text-slate-800">${Helpers.escapeHTML(h.period_name)}</td>
            <td class="px-4 py-3 text-xs text-slate-500">${Helpers.escapeHTML(h.classroom_name || '-')}</td>
            <td class="px-4 py-3 text-center">
              <span class="text-base font-black ${score !== '-' ? 'text-indigo-700' : 'text-slate-400'}">${score}</span>
            </td>
            <td class="px-4 py-3 text-center">
              <span class="px-2 py-1 rounded-full text-[10px] font-black uppercase ${levelCls}">${h.level || '-'}</span>
            </td>
            <td class="px-4 py-3 text-xs text-slate-400 max-w-[160px] truncate">${Helpers.escapeHTML(h.teacher_comment || '-')}</td>
          </tr>`;
      }).join('') : `
        <tr><td colspan="5" class="text-center py-10 text-slate-400 text-sm">
          No hay historial para este estudiante.
        </td></tr>`;

      window.openGlobalModal(`
        <div class="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden">
          <div class="bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white flex items-center justify-between">
            <div>
              <h3 class="text-xl font-black">Historial Académico</h3>
              <p class="text-sm text-white/70 font-medium mt-0.5">${Helpers.escapeHTML(studentName)} — Todos los períodos</p>
            </div>
            <button onclick="App.ui.closeModal()" class="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-xl flex items-center justify-center transition-colors">
              <i data-lucide="x" class="w-5 h-5"></i>
            </button>
          </div>
          <div class="p-6 overflow-x-auto">
            <table class="w-full text-sm min-w-[500px]">
              <thead class="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th class="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Período</th>
                  <th class="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Aula</th>
                  <th class="px-4 py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-wider">Promedio</th>
                  <th class="px-4 py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-wider">Nivel</th>
                  <th class="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Comentario</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-50">${rows}</tbody>
            </table>
          </div>
          <div class="p-4 bg-slate-50 border-t border-slate-100 text-center">
            <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Modo Auditoría — Solo visible para Directora y Asistente</p>
          </div>
        </div>
      `, true);
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      Helpers.toast('Error al cargar historial: ' + (e.message || ''), 'error');
    }
  }
};
