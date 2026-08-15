import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { supabase } from '../shared/supabase.js';
import { AppState } from './state.js';
import { SchoolEngine } from '../shared/school-engine.js';
import { auditLog } from '../shared/db-utils.js';
import {
  fetchBoletin,
  renderBoletin,
  boletinEditorHtml,
  saveBoletinNotes,
  downloadBoletinPDF,
  createBoletinDoc,
  appendBoletinPage,
  finalizeBoletinDoc,
} from '../shared/boletin-pdf.js';

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
  _studentGrades: [],
  _classrooms: [],
  _configLevelFilter: 'all', // 'all' | 'estancia' | 'preescolar' | 'primaria'
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

    if (view === 'config') {
      this._setConfigHeader();
      this._renderConfig();
    } else {
      this._setGradesHeader();
      this._renderGradesTable();
    }
  },

  _setConfigHeader() {
    const head = document.getElementById('gradesTableHead');
    if (!head) return;
    head.innerHTML = `<tr><th colspan="5" class="px-6 py-2 border-b border-slate-200"></th></tr>`;
  },

  _setGradesHeader() {
    const head = document.getElementById('gradesTableHead');
    if (!head) return;
    head.innerHTML = `
      <tr>
        <th class="px-6 py-4 border-b border-slate-200">Estudiante</th>
        <th class="px-6 py-4 border-b border-slate-200">Aula</th>
        <th class="px-6 py-4 text-center border-b border-slate-200">Promedio</th>
        <th class="px-6 py-4 text-center border-b border-slate-200">Estado</th>
        <th class="px-6 py-4 text-right border-b border-slate-200"></th>
      </tr>`;
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
      const [configRes, activitiesRes, studentsRes, gradesRes] = await Promise.all([
        DirectorApi.getPeriodConfig(this._currentPeriodId),
        DirectorApi.getActivitiesWithGrades(this._currentPeriodId),
        DirectorApi.getStudents({ status: 'active' }),
        this._fetchStudentGrades(this._currentPeriodId)
      ]);

      this._config = configRes?.data || [];
      this._activities = activitiesRes?.data || [];
      this._allStudents = studentsRes?.data || [];
      this._studentGrades = gradesRes || [];

      // Load subjects
      const { data: subjects } = await DirectorApi.getSubjects();
      this._subjects = subjects || [];

      // Load classrooms (para el filtro por aula)
      try {
        const { data: classrooms } = await DirectorApi.getClassrooms();
        this._classrooms = classrooms || [];
        this._populateClassroomFilter();
      } catch (_) {}

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

  _populateClassroomFilter() {
    const sel = document.getElementById('gradesFilterClassroom');
    if (!sel || sel.dataset.populated === '1') return;
    const current = sel.value;
    sel.innerHTML = '<option value="all">Todas las aulas</option>' +
      this._classrooms.map(c =>
        `<option value="${c.id}">${Helpers.escapeHTML(c.name || 'Aula')}${c.level ? ' · ' + (LEVEL_LABELS[c.level] || c.level) : ''}</option>`
      ).join('');
    sel.dataset.populated = '1';
    if (current) sel.value = current;
  },

  /**
   * Obtiene en un solo query todas las calificaciones (score_v2) del período
   * para poder calcular promedios reales por estudiante en la tabla principal.
   */
  async _fetchStudentGrades(periodId) {
    try {
      const { data, error } = await supabase
        .from('grades')
        .select('student_id, score_v2, activity_id, notes')
        .eq('period_id', parseInt(periodId))
        .not('score_v2', 'is', null);
      return error ? [] : (data || []);
    } catch (_) {
      return [];
    }
  },

  /**
   * Calcula el promedio real del estudiante replicando la lógica del boletín:
   * por área se usan las mejores 5 notas (si hay 5+) y el promedio general es
   * el promedio de los promedios por área.
   */
  _computeStudentStats(studentId) {
    const actSubject = {};
    this._activities.forEach(a => { actSubject[a.id] = a.subject_id; });

    const bySubject = {};
    this._studentGrades.forEach(g => {
      if (String(g.student_id) !== String(studentId)) return;
      const sid = actSubject[g.activity_id];
      if (sid == null) return;
      if (!bySubject[sid]) bySubject[sid] = [];
      bySubject[sid].push(Number(g.score_v2));
    });

    const subjectAvgs = Object.values(bySubject).map(scores => {
      const top = scores.slice().sort((a, b) => b - a);
      const selected = top.length >= 5 ? top.slice(0, 5) : top;
      return selected.reduce((s, x) => s + x, 0) / selected.length;
    });

    let average = null;
    if (subjectAvgs.length) {
      average = subjectAvgs.reduce((s, x) => s + x, 0) / subjectAvgs.length;
    }

    return {
      average,
      totalGraded: this._studentGrades.filter(g => String(g.student_id) === String(studentId)).length,
      subjectsGraded: subjectAvgs.length,
      totalSubjects: this._config.length,
      level: getLevel(average)
    };
  },

  /**
   * Construye un objeto boletín equivalente a get_student_boletin usando solo
   * datos ya cargados en memoria. Es el respaldo cuando las RPC del boletín
   * (migración add_boletin_dinamico) no están aplicadas en la base.
   */
  _buildBoletinFallback(studentId) {
    const student = this._allStudents.find(s => String(s.id) === String(studentId));
    if (!student) return null;

    const period = this._periods.find(p => String(p.id) === String(this._currentPeriodId));
    const actById = {};
    this._activities.forEach(a => { actById[a.id] = a; });

    const areas = [];
    const activities = [];
    let overallSum = 0;
    let overallCount = 0;

    this._config.forEach(c => {
      const graded = [];
      this._studentGrades.forEach(g => {
        if (String(g.student_id) !== String(studentId)) return;
        const act = actById[g.activity_id];
        if (!act || String(act.subject_id) !== String(c.subject_id)) return;
        const score = Number(g.score_v2);
        graded.push(score);
        activities.push({
          subject_id: act.subject_id,
          subject_name: c.subject_name || act.subject_name,
          activity_id: act.id,
          activity_title: act.title || 'Actividad ' + (act.activity_number ?? ''),
          activity_number: act.activity_number,
          score,
          comment: g.notes || null
        });
      });

      let average = null;
      let method = 'all';
      if (graded.length) {
        const top = graded.slice().sort((x, y) => y - x);
        const selected = top.length >= 5 ? top.slice(0, 5) : top;
        average = Math.round((selected.reduce((s, x) => s + x, 0) / selected.length) * 100) / 100;
        method = graded.length >= 5 ? 'best_5' : 'all';
        overallSum += average;
        overallCount++;
      }

      areas.push({
        subject_id: c.subject_id,
        subject_name: c.subject_name,
        activity_count: c.activity_count || 5,
        graded_count: graded.length,
        average,
        method
      });
    });

    if (!areas.length && !activities.length) return null;

    const overall = overallCount ? Math.round((overallSum / overallCount) * 100) / 100 : null;

    return {
      student: {
        id: student.id,
        name: student.name,
        matricula: student.matricula,
        age: student.age,
        age_type: student.age_type,
        birth_date: student.birth_date,
        avatar_url: student.avatar_url
      },
      classroom: student.classrooms
        ? { id: student.classrooms.id, name: student.classrooms.name }
        : null,
      teacher_name: null,
      directora_name: null,
      school_year_name: null,
      period: period
        ? { id: period.id, name: period.name, start_date: period.start_date, end_date: period.end_date, status: period.status, is_active: period.is_active }
        : null,
      areas,
      activities,
      overall_average: overall,
      level: getLevel(overall).label,
      attendance: {},
      issued_at: null,
      report: null
    };
  },

  /**
   * Obtiene el boletín vía RPC y, si falla (función no creada en la base),
   * lo reconstruye localmente para que el panel siga funcionando.
   */
  async _getBoletin(studentId) {
    try {
      const boletin = await fetchBoletin(studentId, this._currentPeriodId);
      if (boletin?.error) throw new Error(boletin.error);
      return boletin;
    } catch (e) {
      const fb = this._buildBoletinFallback(studentId);
      if (fb) return fb;
      throw e;
    }
  },

  // ── VISTA: CONFIGURACIÓN ─────────────────────────────────

  _renderConfig() {
    const container = document.getElementById('gradesTableBody');
    if (!container) return;
    this._pendingConfig = {};

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
    const filter = this._configLevelFilter;

    const configMap = {};
    this._config.forEach(c => { configMap[c.subject_id] = c; });
    const activitiesBySubject = {};
    this._activities.forEach(a => {
      if (!activitiesBySubject[a.subject_id]) activitiesBySubject[a.subject_id] = 0;
      activitiesBySubject[a.subject_id]++;
    });

    const LEVEL_STYLES = {
      estancia:   { chip: 'bg-pink-100 text-pink-700',   bar: 'bg-pink-500' },
      preescolar: { chip: 'bg-violet-100 text-violet-700', bar: 'bg-violet-500' },
      primaria:   { chip: 'bg-indigo-100 text-indigo-700', bar: 'bg-indigo-500' },
    };

    const visible = this._subjects.filter(s => filter === 'all' || s.education_level === filter);
    const configuredCount = visible.filter(s => configMap[s.id]).length;

    const pills = [['all', 'Todas'], ['estancia', 'Estancia'], ['preescolar', 'Preescolar'], ['primaria', 'Primaria']]
      .map(([v, label]) => `
        <button onclick="App.grades._setConfigLevelFilter('${v}')"
          class="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${filter === v ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600'}">
          ${label}
        </button>`).join('');

    let html = `
      <tr><td colspan="5" class="px-6 pt-5">
        <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 flex flex-col lg:flex-row lg:items-center gap-3">
          <div class="flex flex-wrap items-center gap-1.5">${pills}</div>
          <p class="text-[11px] text-slate-500 font-bold flex-1 min-w-[140px]">
            ${configuredCount} de ${visible.length} áreas configuradas${filter !== 'all' ? ' · ' + (LEVEL_LABELS[filter] || filter) : ''}
            <span class="block text-[9px] font-semibold normal-case text-slate-400">La configuración es global del periodo: se aplica a todas las aulas.</span>
          </p>
          <div class="flex flex-wrap gap-2 shrink-0">
            <button onclick="App.grades._openSubjectModal()" class="px-3.5 py-2 bg-violet-600 text-white rounded-xl font-black text-[10px] uppercase tracking-wider shadow-md shadow-violet-200 hover:bg-violet-700 transition-all flex items-center gap-1.5">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i> Nueva Área
            </button>
            <button onclick="App.grades._applyVisible()" ${isClosed ? 'disabled' : ''} class="px-3.5 py-2 bg-white text-indigo-600 border-2 border-indigo-200 rounded-xl font-black text-[10px] uppercase tracking-wider hover:bg-indigo-50 transition-all flex items-center gap-1.5 ${isClosed ? 'opacity-40 cursor-not-allowed' : ''}">
              <i data-lucide="copy-check" class="w-3.5 h-3.5"></i> Aplicar visibles
            </button>
            <button onclick="App.grades._saveAllConfig()" ${isClosed ? 'disabled' : ''} class="px-3.5 py-2 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-wider shadow-md shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center gap-1.5 ${isClosed ? 'opacity-40 cursor-not-allowed' : ''}">
              <i data-lucide="save" class="w-3.5 h-3.5"></i> Guardar
            </button>
          </div>
        </div>
      </td></tr>`;

    if (isClosed) {
      html += `<tr><td colspan="5" class="px-6 pt-2">
        <div class="flex items-center gap-2 text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2">
          <i data-lucide="lock" class="w-3.5 h-3.5"></i> Periodo cerrado — la configuración está en modo lectura.
        </div>
      </td></tr>`;
    }

    if (!visible.length) {
      html += `<tr><td colspan="5" class="text-center py-12 text-slate-400">
        <div class="flex flex-col items-center gap-2">
          <p class="font-bold">No hay áreas disponibles${filter !== 'all' ? ' para este nivel' : ''}</p>
          <p class="text-xs text-slate-400 mt-1">Usa "Aplicar visibles" o crea una nueva área.</p>
        </div>
      </td></tr>`;
    } else {
      visible.forEach(s => {
        const style = LEVEL_STYLES[s.education_level] || LEVEL_STYLES.primaria;
        const cfg = configMap[s.id];
        const count = cfg?.activity_count || 5;
        const actCount = activitiesBySubject[s.id] || 0;
        const configured = !!cfg;
        const progressPct = count > 0 ? Math.min(100, Math.round(actCount / count * 100)) : 0;
        const progressCls = progressPct >= 100 ? 'bg-emerald-500' : progressPct >= 50 ? 'bg-amber-500' : 'bg-rose-400';
        html += `<tr><td colspan="5" class="px-6 pt-2">
          ${this._renderConfigRow(s, cfg, style, count, actCount, configured, isClosed, progressPct, progressCls)}
        </td></tr>`;
      });
    }

    container.innerHTML = html;
    if (window.lucide) lucide.createIcons();
  },

  _renderConfigRow(s, cfg, style, count, actCount, configured, isClosed, progressPct, progressCls) {
    const level = s.education_level;
    return `
      <div id="cfg-row-${s.id}" class="group rounded-xl border ${configured ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50/50'} p-3 flex flex-col gap-2 transition-all hover:shadow-sm">
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${style.chip} shrink-0">${LEVEL_LABELS[level] || level}</span>
          <input id="cfg-name-${s.id}" value="${Helpers.escapeHTML(s.name)}" oninput="App.grades._markDirty(${s.id})"
            placeholder="Nombre del área" ${isClosed ? 'readonly' : ''}
            class="flex-1 min-w-[120px] bg-transparent border-b-2 border-transparent focus:border-indigo-400 px-1 py-1 text-sm font-black text-slate-800 outline-none transition-all ${isClosed ? 'opacity-60 cursor-not-allowed' : ''}">
          <button onclick="App.grades._toggleDesc(${s.id})" class="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="${s.description ? 'Ver / editar descripción' : 'Agregar descripción'}">
            <i data-lucide="chevron-down" class="w-4 h-4"></i>
          </button>
          <span id="cfg-dirty-${s.id}" class="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-amber-100 text-amber-700 opacity-0 transition-opacity">● Sin guardar</span>
        </div>
        <div id="cfg-desc-wrap-${s.id}" class="hidden">
          <textarea id="cfg-desc-${s.id}" rows="2" oninput="App.grades._markDirty(${s.id})"
            placeholder="Descripción del área (lo que se trabaja en esta materia)..." ${isClosed ? 'readonly' : ''}
            class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-500 font-medium outline-none focus:bg-white transition-all resize-none ${isClosed ? 'opacity-60 cursor-not-allowed' : ''}">${Helpers.escapeHTML(s.description || '')}</textarea>
        </div>
        <div class="flex flex-wrap items-center gap-2.5">
          <div class="flex items-center gap-1.5">
            ${isClosed ? `
              <span class="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg font-black text-sm">${count}</span>
            ` : `
              <button onclick="App.grades._adjustCount(${s.id}, -1)" class="w-8 h-8 bg-slate-100 text-slate-500 rounded-lg font-black hover:bg-slate-200 transition-all flex items-center justify-center text-base">−</button>
              <span id="cfg-count-${s.id}" class="px-3 py-1 bg-white border-2 border-slate-200 rounded-lg font-black text-sm text-indigo-700 min-w-[40px] text-center">${count}</span>
              <button onclick="App.grades._adjustCount(${s.id}, 1)" class="w-8 h-8 bg-slate-100 text-slate-500 rounded-lg font-black hover:bg-slate-200 transition-all flex items-center justify-center text-base">+</button>
            `}
            <span class="text-[9px] font-black text-slate-400 uppercase tracking-wider">actividades</span>
          </div>
          <div class="flex items-center gap-2 ml-auto">
            <span class="px-2.5 py-1 rounded-full text-[10px] font-black ${actCount >= count ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${actCount}/${count}</span>
            <div class="hidden md:block w-20 bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div class="${progressCls} h-full rounded-full transition-all" style="width:${progressPct}%"></div>
            </div>
            ${configured ? `
              <button onclick="App.grades._removeSubjectConfig(${cfg.id})" class="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all ${isClosed ? 'hidden' : ''}" title="Quitar área del periodo">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-50 text-emerald-600 border border-emerald-100"><i data-lucide="check" class="w-3 h-3"></i> Activa</span>
            ` : `
              <button onclick="App.grades._addSubjectConfig(${s.id})" class="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-all ${isClosed ? 'hidden' : ''}">
                <i data-lucide="plus" class="w-3 h-3 inline"></i> Agregar
              </button>
            `}
          </div>
        </div>
      </div>`;
  },

  _setConfigLevelFilter(level) {
    this._configLevelFilter = level;
    this._renderConfig();
    if (window.lucide) lucide.createIcons();
  },

  _toggleDesc(subjectId) {
    const wrap = document.getElementById(`cfg-desc-wrap-${subjectId}`);
    if (wrap) wrap.classList.toggle('hidden');
    const btn = document.querySelector(`#cfg-row-${subjectId} button[onclick*="_toggleDesc(${subjectId})"]`);
    const icon = btn?.querySelector('i');
    if (icon) icon.classList.toggle('rotate-180');
  },

  _pendingConfig: {},

  _markDirty(subjectId) {
    const dot = document.getElementById(`cfg-dirty-${subjectId}`);
    if (dot) dot.classList.remove('opacity-0');
    const row = document.getElementById(`cfg-row-${subjectId}`);
    if (row) row.classList.add('ring-2', 'ring-amber-200', 'ring-inset');
  },

  _adjustCount(subjectId, delta) {
    const el = document.getElementById(`cfg-count-${subjectId}`);
    if (!el) return;
    let current = parseInt(el.textContent) || 5;
    current = Math.min(8, Math.max(5, current + delta));
    el.textContent = current;
    this._pendingConfig[subjectId] = current;
    this._markDirty(subjectId);
  },

  async _addSubjectConfig(subjectId) {
    const count = this._pendingConfig[subjectId] || 5;
    const { error } = await DirectorApi.savePeriodConfig(this._currentPeriodId, [
      { subject_id: subjectId, activity_count: count }
    ]);
    if (error) return Helpers.toast('Error al guardar', 'error');
    Helpers.toast('Área agregada', 'success');
    await this._loadData();
  },

  async _removeSubjectConfig(configId) {
    if (configId == null) {
      Helpers.toast('No se encontró la configuración de esta área', 'warning');
      return;
    }
    const ok = window._karpusConfirmDelete
      ? await window._karpusConfirmDelete('Quitar área', 'Se quitará esta área del periodo. Sus actividades y notas se conservan.')
      : window.confirm('¿Quitar esta área del periodo? Se conservarán sus actividades y notas.');
    if (!ok) return;

    const btn = document.querySelector(`button[onclick*="App.grades._removeSubjectConfig(${configId})"]`);
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }

    try {
      const { error } = await DirectorApi.deletePeriodConfig(configId);
      if (error) return Helpers.toast('No se pudo quitar el área: ' + (error?.message || 'Error'), 'error');
      Helpers.toast('Área removida', 'success');
      await this._loadData();
    } catch (e) {
      Helpers.toast('Error al quitar el área: ' + (e?.message || ''), 'error');
    }
  },

  async _updateSubject(subjectId) {
    const elName = document.getElementById(`cfg-name-${subjectId}`);
    const elDesc = document.getElementById(`cfg-desc-${subjectId}`);
    if (!elName) return;
    const name = elName.value.trim();
    const desc = (elDesc?.value || '').trim();
    if (!name) return Helpers.toast('El nombre del área no puede estar vacío', 'warning');
    const { error } = await supabase.rpc('update_subject', {
      p_subject_id: parseInt(subjectId),
      p_name: name,
      p_description: desc || null
    });
    if (error) return Helpers.toast('Error al actualizar el área: ' + error.message, 'error');
    Helpers.toast('Área actualizada', 'success');
    await this._loadData();
  },

  async _applyVisible() {
    const period = this._periods.find(p => String(p.id) === String(this._currentPeriodId));
    if (!period) return Helpers.toast('Selecciona un periodo', 'warning');
    if (period.status === 'closed') return Helpers.toast('El periodo está cerrado', 'warning');

    const existingIds = new Set(this._config.map(c => c.subject_id));
    let missing = this._subjects.filter(s => !existingIds.has(s.id));
    if (this._configLevelFilter !== 'all') {
      missing = missing.filter(s => s.education_level === this._configLevelFilter);
    }
    if (!missing.length) {
      return Helpers.toast(this._configLevelFilter !== 'all'
        ? 'Todas las áreas de este nivel ya están configuradas'
        : 'Todas las áreas ya están configuradas', 'info');
    }

    const rows = missing.map(s => ({ subject_id: s.id, activity_count: 5 }));
    const { error } = await DirectorApi.savePeriodConfig(this._currentPeriodId, rows);
    if (error) return Helpers.toast('Error al aplicar la configuración', 'error');
    Helpers.toast(`${rows.length} área${rows.length !== 1 ? 's' : ''} aplicada${rows.length !== 1 ? 's' : ''} al periodo ✅`, 'success');
    await this._loadData();
  },

  _openSubjectModal() {
    const ic = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-violet-100 focus:border-violet-400 bg-slate-50/50 transition-all text-sm font-medium';
    const lc = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';
    const modalHtml = `
      <div class="w-full overflow-hidden">
        <div class="bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white">
          <h3 class="text-xl font-black">Nueva Área</h3>
          <p class="text-sm text-white/70 font-medium mt-0.5">Se aplicará a todas las aulas del nivel seleccionado</p>
        </div>
        <div class="p-6 space-y-4">
          <div><label class="${lc}">Nombre del Área</label><input id="newSubjectName" class="${ic}" placeholder="Ej: Música"></div>
          <div><label class="${lc}">Nivel</label>
            <select id="newSubjectLevel" class="${ic}">
              <option value="estancia">Estancia</option>
              <option value="preescolar">Preescolar</option>
              <option value="primaria">Primaria</option>
            </select>
          </div>
          <div><label class="${lc}">Descripción</label><textarea id="newSubjectDesc" rows="3" class="${ic} resize-none" placeholder="¿Qué se trabaja en esta área?"></textarea></div>
        </div>
        <div class="p-6 bg-slate-50 flex justify-end gap-3">
          <button onclick="App.ui.closeModal()" class="px-6 py-2.5 text-xs font-black uppercase text-slate-400">Cancelar</button>
          <button id="btnCreateSubject" class="px-6 py-2.5 bg-violet-600 text-white rounded-xl font-black text-xs uppercase shadow-lg shadow-violet-200 hover:bg-violet-700 transition-all">Crear Área</button>
        </div>
      </div>`;

    window.openGlobalModal(modalHtml);
    document.getElementById('btnCreateSubject')?.addEventListener('click', () => this._createSubject());
    if (window.lucide) lucide.createIcons();
  },

  async _createSubject() {
    const name = document.getElementById('newSubjectName')?.value?.trim();
    const level = document.getElementById('newSubjectLevel')?.value;
    const desc = document.getElementById('newSubjectDesc')?.value?.trim() || null;
    if (!name) return Helpers.toast('Escribe el nombre del área', 'warning');
    if (!level) return Helpers.toast('Selecciona un nivel', 'warning');

    const btn = document.getElementById('btnCreateSubject');
    if (btn) { btn.disabled = true; btn.textContent = 'Creando...'; }

    try {
      const { data, error } = await supabase.rpc('insert_subject', {
        p_name: name,
        p_education_level: level,
        p_description: desc
      });
      if (error) throw error;
      if (data?.error) return Helpers.toast(data.error, 'error');

      const period = this._periods.find(p => String(p.id) === String(this._currentPeriodId));
      if (period && period.status !== 'closed') {
        const { error: cfgErr } = await DirectorApi.savePeriodConfig(this._currentPeriodId, [
          { subject_id: data.id, activity_count: 5 }
        ]);
        if (cfgErr) return Helpers.toast('Área creada, pero no se pudo agregar al periodo: ' + cfgErr.message, 'error');
      }

      App.ui.closeModal();
      Helpers.toast('Área creada correctamente ✅', 'success');
      await this._loadData();
    } catch (e) {
      Helpers.toast('Error al crear el área: ' + (e?.message || ''), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Crear Área'; }
    }
  },

  async _saveAllConfig() {
    const countChanges = Object.entries(this._pendingConfig).map(([sid, count]) => ({
      subject_id: parseInt(sid),
      activity_count: count
    }));

    const subjectChanges = [];
    this._subjects.forEach(s => {
      const elName = document.getElementById(`cfg-name-${s.id}`);
      const elDesc = document.getElementById(`cfg-desc-${s.id}`);
      if (!elName) return;
      const name = elName.value.trim();
      const desc = (elDesc?.value || '').trim();
      if (!name) return;
      if (name !== s.name || desc !== (s.description || '')) {
        subjectChanges.push({ subject_id: s.id, name, description: desc || null });
      }
    });

    if (!countChanges.length && !subjectChanges.length) {
      return Helpers.toast('No hay cambios que guardar', 'warning');
    }

    let ok = true;
    if (countChanges.length) {
      const { error } = await DirectorApi.savePeriodConfig(this._currentPeriodId, countChanges);
      if (error) ok = false;
    }
    for (const sc of subjectChanges) {
      const { error } = await supabase.rpc('update_subject', {
        p_subject_id: sc.subject_id,
        p_name: sc.name,
        p_description: sc.description
      });
      if (error) ok = false;
    }

    if (!ok) return Helpers.toast('Hubo errores al guardar', 'error');
    this._pendingConfig = {};
    Helpers.toast('Configuración guardada correctamente', 'success');
    await this._loadData();
  },

  // ── VISTA: CALIFICACIONES ────────────────────────────────

  _renderGradesTable() {
    const tableBody = document.getElementById('gradesTableBody');
    if (!tableBody) return;

    const period = this._periods.find(p => String(p.id) === String(this._currentPeriodId));
    if (!period) {
      tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-16 text-slate-400">
        <div class="flex flex-col items-center gap-3">
          <div class="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center text-3xl">📚</div>
          <p class="font-bold text-slate-600">Selecciona un periodo para ver las calificaciones</p>
        </div>
      </td></tr>`;
      return;
    }

    const search = (document.getElementById('searchGradeStudent')?.value || '').toLowerCase();
    const classFilter = document.getElementById('gradesFilterClassroom')?.value || 'all';

    let students = this._allStudents;
    if (search) students = students.filter(s => (s.name || '').toLowerCase().includes(search));
    if (classFilter !== 'all') students = students.filter(s => String(s.classroom_id) === classFilter);

    if (!students.length) {
      tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-16 text-slate-400">
        No se encontraron estudiantes
      </td></tr>`;
      return;
    }

    tableBody.innerHTML = students.map(s => {
      const stats = this._computeStudentStats(s.id);
      const classroom = s.classrooms?.name || 'Sin aula';
      const avg = stats.average;
      const isGraded = avg != null;
      const avatar = s.avatar_url
        ? `<img src="${Helpers.escapeHTML(s.avatar_url)}" alt="" class="w-full h-full object-cover" onerror="this.remove()">`
        : (s.name || '?').charAt(0).toUpperCase();

      return `
        <tr class="hover:bg-indigo-50/40 border-b border-slate-50 transition-all cursor-pointer group"
            onclick="App.grades.openStudentDetail('${s.id}')">
          <td class="px-6 py-4">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 text-indigo-600 flex items-center justify-center font-black text-base overflow-hidden shrink-0 border-2 border-white shadow-sm group-hover:border-indigo-200 transition-all">
                ${avatar}
              </div>
              <div class="min-w-0">
                <div class="font-black text-slate-800 text-sm truncate">${Helpers.escapeHTML(s.name)}</div>
                <div class="text-[10px] text-slate-400 font-bold uppercase tracking-tighter mt-0.5">${Helpers.escapeHTML(s.matricula || '')}</div>
              </div>
            </div>
          </td>
          <td class="px-6 py-4">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
              <span class="text-xs font-bold text-slate-600">${Helpers.escapeHTML(classroom)}</span>
            </div>
          </td>
          <td class="px-6 py-4">
            <div class="flex flex-col items-center gap-1.5">
              <span class="px-3 py-1 rounded-xl font-black text-sm border ${isGraded ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-slate-50 text-slate-400 border-slate-100'}">
                ${isGraded ? Number(avg).toFixed(1) : '—'}
              </span>
              ${scoreBar(avg)}
            </div>
          </td>
          <td class="px-6 py-4">
            <div class="flex flex-col items-center gap-1.5">
              <span class="px-2.5 py-1 rounded-full text-[10px] font-black uppercase shadow-sm ${stats.level.cls}">
                ${stats.level.label}
              </span>
              <span class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">${stats.subjectsGraded}/${stats.totalSubjects} áreas</span>
            </div>
          </td>
          <td class="px-6 py-4">
            <div class="flex items-center justify-end gap-1">
              <button onclick="event.stopPropagation();App.grades.openBoletin('${s.id}');"
                class="p-2 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors" title="Ver boletín">
                <i data-lucide="file-text" class="w-3.5 h-3.5"></i>
              </button>
              <button onclick="event.stopPropagation();App.grades.openStudentHistory('${s.id}','${Helpers.escapeHTML(s.name).replace(/'/g,"\\'")}');"
                class="p-2 text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors" title="Historial">
                <i data-lucide="history" class="w-3.5 h-3.5"></i>
              </button>
              <span class="w-6 h-6 flex items-center justify-center text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all">
                <i data-lucide="chevron-right" class="w-4 h-4"></i>
              </span>
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

    const avatar = student.avatar_url
      ? `<img src="${Helpers.escapeHTML(student.avatar_url)}" alt="" class="w-full h-full object-cover" onerror="this.remove()">`
      : (student.name || '?').charAt(0).toUpperCase();

    const modalHtml = `
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div class="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-6 text-white relative overflow-hidden shrink-0">
          <div class="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full"></div>
          <div class="absolute right-24 -bottom-12 w-28 h-28 bg-white/10 rounded-full"></div>
          <div class="flex items-center gap-4 relative z-10">
            <div class="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-2xl font-black overflow-hidden shrink-0 border-2 border-white/30 shadow-lg">
              ${avatar}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-[10px] font-black uppercase tracking-[0.25em] text-white/70">Centro de Calificaciones</p>
              <h3 class="text-2xl font-black truncate">${Helpers.escapeHTML(student.name)}</h3>
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs font-bold text-white/85">
                <span class="inline-flex items-center gap-1.5"><i data-lucide="school" class="w-3.5 h-3.5"></i> ${Helpers.escapeHTML(student.classrooms?.name || 'Sin aula')}</span>
                <span class="inline-flex items-center gap-1.5"><i data-lucide="calendar" class="w-3.5 h-3.5"></i> ${Helpers.escapeHTML(period.name)}</span>
                <span class="inline-flex items-center gap-1.5"><i data-lucide="book-open" class="w-3.5 h-3.5"></i> Boletín de calificaciones</span>
              </div>
            </div>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-6 bg-slate-50" id="studentDetailContent">
          <div class="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
            <div class="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
            <p class="text-sm font-bold">Generando boletín...</p>
          </div>
        </div>
      </div>`;

    window.openGlobalModal(modalHtml, true);

    const content = document.getElementById('studentDetailContent');
    if (!content) return;

    try {
      const boletin = await this._getBoletin(studentId);
      if (boletin?.error) throw new Error(boletin.error);

      const areas = boletin?.areas || [];
      const acts = boletin?.activities || [];
      const overall = boletin?.overall_average;

      if (!areas.length) {
        content.innerHTML = `
          <div class="text-center py-12">
            <div class="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-4">📝</div>
            <p class="font-bold text-slate-600">Sin calificaciones registradas</p>
            <p class="text-xs text-slate-400 mt-1">Las calificaciones aparecerán cuando la maestra registre notas en las actividades</p>
          </div>`;
        return;
      }

      // ── Matriz área × actividades (como boletín) ──
      const bySubjectActs = {};
      acts.forEach(a => {
        if (!bySubjectActs[a.subject_id]) bySubjectActs[a.subject_id] = {};
        bySubjectActs[a.subject_id][a.activity_number] = a;
      });

      const maxActs = Math.min(5, Math.max(1, ...areas.map(a => a.activity_count || 5)));
      const actCols = Array.from({ length: maxActs }, (_, i) => i + 1);
      const overallLvl = getLevel(overall);

      const starsOf = (score) => {
        const n = Math.max(0, Math.min(5, Math.round(Number(score) / 20)));
        return '★'.repeat(n) + '☆'.repeat(5 - n);
      };

      const rowsHtml = areas.map((area, i) => {
        const color = ['#1D4ED8', '#15803D', '#CA8A04', '#DB2777', '#EA580C', '#7C3AED'][i % 6];
        const cells = actCols.map(n => {
          const act = bySubjectActs[area.subject_id]?.[n];
          if (!act || act.score == null) {
            return `<td class="px-1.5 py-3 text-center"><span class="text-slate-300 font-black text-sm">—</span></td>`;
          }
          const lvl = getLevel(act.score);
          const tip = `${act.activity_title || 'Actividad ' + n}${act.comment ? ' · ' + act.comment : ''}`.replace(/"/g, '&quot;');
          return `
            <td class="px-1.5 py-3 text-center" title="${Helpers.escapeHTML(tip)}">
              <div class="flex flex-col items-center gap-1 cursor-default">
                <span class="w-11 h-8 rounded-lg font-black text-sm flex items-center justify-center ${lvl.cls}">${Number(act.score).toFixed(0)}</span>
                <span class="text-[9px] leading-none tracking-tight ${act.score >= 80 ? 'text-amber-400' : act.score >= 60 ? 'text-amber-300' : 'text-rose-400'}">${starsOf(act.score)}</span>
              </div>
            </td>`;
        }).join('');

        return `
          <tr class="border-b border-slate-100 hover:bg-indigo-50/30 transition-colors">
            <td class="px-4 py-3">
              <div class="font-black text-sm" style="color:${color}">${Helpers.escapeHTML(area.subject_name)}</div>
              <div class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">${area.graded_count} de ${maxActs} actividades</div>
            </td>
            ${cells}
            <td class="px-4 py-3 text-center">
              <span class="inline-block min-w-[3.5rem] px-2.5 py-1.5 rounded-xl font-black text-sm" style="background:${color}1A;color:${color}">${area.average != null ? Number(area.average).toFixed(1) : '—'}</span>
            </td>
          </tr>`;
      }).join('');

      const headerCells = actCols.map(n => `
        <th class="px-1.5 py-3 text-center text-[10px] font-black uppercase tracking-widest">Act ${n}</th>`).join('');

      content.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div class="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <h4 class="font-black text-slate-700 text-xs uppercase tracking-widest flex items-center gap-2">
              <span class="w-1.5 h-5 bg-indigo-600 rounded-full"></span> Resultados por Área
            </h4>
            <span class="text-[10px] font-bold text-slate-400" title="Se usan las mejores 5 notas por área">Mejores 5 notas por área · <span class="text-indigo-500 font-black">pasa el cursor sobre una nota</span></span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm min-w-[560px]">
              <thead class="bg-gradient-to-r from-indigo-600 to-violet-600 text-white">
                <tr>
                  <th class="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest">Área</th>
                  ${headerCells}
                  <th class="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Promedio</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-50">
                ${rowsHtml}
              </tbody>
              <tfoot>
                <tr class="bg-gradient-to-r from-indigo-600 to-violet-600 text-white">
                  <td class="px-4 py-3.5 font-black text-xs uppercase tracking-widest">Promedio General</td>
                  <td class="px-1.5 py-3.5 text-center text-[10px] font-bold text-white/70 uppercase tracking-wider" colspan="${maxActs}">${overall != null ? overallLvl.label : 'Sin calificar'}</td>
                  <td class="px-4 py-3.5 text-center">
                    <span class="inline-flex items-center gap-2">
                      <span class="text-2xl font-black">${overall != null ? Number(overall).toFixed(1) : '—'}</span>
                      <span class="text-amber-300 text-sm">★</span>
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 mt-6">
          <button onclick="App.grades.openBoletin('${studentId}')"
            class="px-4 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2">
            <i data-lucide="file-text" class="w-4 h-4"></i> Ver Boletín
          </button>
          <button onclick="App.grades._downloadBoletin('${studentId}')"
            class="px-4 py-3 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all flex items-center justify-center gap-2">
            <i data-lucide="download" class="w-4 h-4"></i> Descargar PDF
          </button>
        </div>`;

      if (window.lucide) lucide.createIcons();
    } catch (e) {
      content.innerHTML = `
        <div class="text-center py-10">
          <div class="w-14 h-14 bg-rose-100 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-3">⚠️</div>
          <p class="font-bold text-slate-700">Error al cargar calificaciones</p>
          <p class="text-xs text-slate-400 mt-1">${Helpers.escapeHTML(e?.message || '')}</p>
        </div>`;
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
      try { await SchoolEngine.refresh(); } catch (_) {}
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
      <div class="w-full overflow-hidden">
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
      const yearId = AppState.get('schoolYear')?.id;

      // Try academic_periods (School Engine) first
      let targetTable = 'academic_periods';
      let payload = {
        name,
        start_date: start,
        end_date: end,
        status: 'open',
        is_active: isActive,
        order_index: this._periods.length + 1
      };
      if (yearId) payload.school_year_id = yearId;

      if (isActive) {
        await supabase.from(targetTable).update({ is_active: false }).eq('is_active', true).then(() => {}).catch(() => {});
      }

      const { error } = await supabase.from(targetTable).insert(payload);

      if (error) {
        // Fallback to legacy periods table
        if (isActive) {
          await supabase.from('periods').update({ is_active: false }).eq('is_active', true);
        }
        const { error: legacyErr } = await supabase.from('periods').insert({
          name, start_date: start, end_date: end, status: 'open', is_active: isActive
        });
        if (legacyErr) throw legacyErr;
      }

      Helpers.toast('Periodo creado correctamente', 'success');
      App.ui.closeModal();
      try { await SchoolEngine.refresh(); } catch (_) {}
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
    if (!this._allStudents.length) return Helpers.toast('No hay datos para exportar', 'warning');
    if (!this._currentPeriodId) return Helpers.toast('Selecciona un periodo', 'warning');
    this._exportBoletinesPDF();
  },

  /**
   * Genera un PDF con el boletín profesional de cada estudiante.
   */
  async _exportBoletinesPDF() {
    const period = this._periods.find(p => String(p.id) === String(this._currentPeriodId));
    const btn = document.getElementById('btnExportGrades');
    if (btn) { btn.disabled = true; btn.textContent = 'Generando boletines...'; }

    try {
      Helpers.toast('Generando boletines...', 'info');
      const doc = await createBoletinDoc();
      let generated = 0;
      for (const s of this._allStudents) {
        try {
          const boletin = await this._getBoletin(s.id);
          if (!boletin?.error) {
            await appendBoletinPage(doc, boletin);
            generated++;
          }
        } catch (_) { /* estudiante sin datos: se omite */ }
      }

      if (!generated) {
        Helpers.toast('No hay calificaciones para generar boletines', 'warning');
        return;
      }

      finalizeBoletinDoc(doc);
      const ts = new Date().toISOString().slice(0, 10);
      doc.save(`boletines_${(period?.name || 'periodo').replace(/\s+/g, '_').toLowerCase()}_${ts}.pdf`);
      Helpers.toast(`${generated} boletín${generated !== 1 ? 'es' : ''} generado${generated !== 1 ? 's' : ''} ✅`, 'success');
      auditLog('grades.export_boletines', { period_id: this._currentPeriodId, period_name: period?.name, cards: generated });
    } catch (err) {
      Helpers.toast('Error al generar boletines: ' + (err?.message || ''), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Exportar PDF'; }
    }
  },

  /**
   * Abre el boletín dinámico de un estudiante (vista + edición + PDF).
   */
  async openBoletin(studentId) {
    const student = this._allStudents.find(s => String(s.id) === String(studentId));
    if (!student) return;
    const period = this._periods.find(p => String(p.id) === String(this._currentPeriodId));
    if (!period) return Helpers.toast('Selecciona un periodo', 'warning');

    const modalHtml = `
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div class="bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white flex justify-between items-center">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center text-2xl font-black">${student.name.charAt(0)}</div>
            <div>
              <h3 class="text-2xl font-black">${Helpers.escapeHTML(student.name)}</h3>
              <p class="text-sm font-bold text-white/70 uppercase tracking-widest">Boletín · ${Helpers.escapeHTML(period.name)}</p>
            </div>
          </div>
          <button onclick="App.ui.closeModal()" class="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-xl flex items-center justify-center transition-colors">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-6 bg-slate-50" id="boletinContent">
          <div class="text-center py-8 text-slate-400">
            <div class="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4"></div>
            Generando boletín...
          </div>
        </div>
      </div>`;

    window.openGlobalModal(modalHtml, true);

    const content = document.getElementById('boletinContent');
    try {
      const boletin = await this._getBoletin(studentId);
      if (boletin?.error) throw new Error(boletin.error);

      content.innerHTML = `
        <div class="grid lg:grid-cols-[300px_1fr] gap-4 items-start">
          <div class="space-y-3 lg:sticky lg:top-0">
            ${boletinEditorHtml(boletin)}
            <button onclick="App.grades._downloadBoletin('${studentId}')"
              class="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all">
              <i data-lucide="download" class="w-4 h-4 inline mr-1"></i> Descargar PDF
            </button>
          </div>
          <div class="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
            ${renderBoletin(boletin)}
          </div>
        </div>`;
      if (window.lucide) lucide.createIcons();

      document.getElementById('btn-save-boletin')?.addEventListener('click', async () => {
        const comment = document.getElementById('boletin-comment')?.value || '';
        const observaciones = document.getElementById('boletin-observaciones')?.value || '';
        const conducta = document.getElementById('boletin-conducta')?.value || '';
        const fortalezas = (document.getElementById('boletin-fortalezas')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
        const debilidades = (document.getElementById('boletin-debilidades')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
        const btn = document.getElementById('btn-save-boletin');
        if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
        try {
          await saveBoletinNotes(studentId, this._currentPeriodId, comment, fortalezas, debilidades, observaciones, conducta);
          Helpers.toast('Boletín guardado', 'success');
          await this.openBoletin(studentId);
        } catch (e) {
          Helpers.toast('Error al guardar: ' + (e?.message || ''), 'error');
          if (btn) { btn.disabled = false; btn.textContent = 'Guardar Boletín'; }
        }
      });
    } catch (e) {
      content.innerHTML = `<div class="text-center py-8 text-rose-500 font-bold">Error: ${Helpers.escapeHTML(e?.message || '')}</div>`;
    }
  },

  async _downloadBoletin(studentId) {
    try {
      Helpers.toast('Generando PDF...', 'info');
      const boletin = await this._getBoletin(studentId);
      if (boletin?.error) throw new Error(boletin.error);
      await downloadBoletinPDF(boletin);
      Helpers.toast('PDF descargado', 'success');
    } catch (e) {
      Helpers.toast('Error al generar PDF: ' + (e?.message || ''), 'error');
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
