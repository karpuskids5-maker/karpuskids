/**
 * QualityEvalModule — Evaluación mensual de calidad (Panel de Dirección)
 *
 * Analítica de los tres indicadores (IGSM, índice docente, índice
 * institucional), la matriz por docente, el seguimiento de alertas y acciones
 * de mejora, y la lectura de comentarios.
 *
 * Decisiones que este módulo aplica a propósito (propuesta.md):
 *  - Una puntuación baja NO se muestra como veredicto sobre una docente. La
 *    matriz va por dimensión, con el número de respuestas al lado, y quien
 *    decide es Dirección: no hay semáforo por persona ni ranking.
 *  - Las alertas de descenso exigen 3+ respuestas en el servidor. Aquí se
 *    muestra cuántas hay para que la Dirección no lea de más.
 *  - Los comentarios marcados como anónimos se muestran SIN datos de la
 *    familia: el nombre del alumno solo se resuelve para los no anónimos.
 *  - Cerrar una acción de mejora es un trámite, no el objetivo: el seguimiento
 *    real es ver el efecto en el mes siguiente.
 */

import { supabase } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const ACTION_STATUS = {
  pendiente:  { label: 'Pendiente',  cls: 'bg-slate-100 text-slate-700 border-slate-200', icon: '⏳' },
  revision:   { label: 'En revisión', cls: 'bg-amber-100 text-amber-800 border-amber-200',  icon: '🔍' },
  proceso:    { label: 'En proceso',  cls: 'bg-blue-100 text-blue-800 border-blue-200',     icon: '🔄' },
  solucionado:{ label: 'Solucionado', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: '✅' },
};

const ALERT_STATUS = {
  pendiente:  { label: 'Pendiente',  cls: 'bg-slate-100 text-slate-700 border-slate-200', icon: '⏳' },
  revision:   { label: 'En revisión', cls: 'bg-amber-100 text-amber-800 border-amber-200',  icon: '🔍' },
  proceso:    { label: 'En proceso',  cls: 'bg-blue-100 text-blue-800 border-blue-200',     icon: '🔄' },
  solucionado:{ label: 'Solucionado', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: '✅' },
};

function _monthLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function _fmt(value, suffix = '') {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `${n}${suffix}` : `${value}${suffix}`;
}

function _scoreColor(score) {
  if (score === null || score === undefined) return 'text-slate-400';
  if (score >= 4.5) return 'text-emerald-600';
  if (score >= 3.5) return 'text-teal-600';
  if (score >= 2.5) return 'text-amber-600';
  return 'text-rose-600';
}

export const QualityEvalModule = {
  state: {
    tab: 'resumen',
    periods: [],
    periodId: null,
    summary: null,
    trends: [],
    dimensions: [],
    teachers: [],
    teacherDimensions: [],
    alerts: [],
    actions: [],
    topics: [],
    comments: [],
    studentNames: {},   // id -> nombre, para comentarios NO anónimos
    loading: false,
  },

  // ── Ciclo de vida ──────────────────────────────────────────────────────────

  async init() {
    this.state.tab = 'resumen';
    await this.load();
  },

  async load() {
    this.state.loading = true;
    this.renderSkeleton();

    const [periodsRes, summaryRes] = await Promise.all([
      supabase.from('v_quality_period_summary').select('*').order('period_month', { ascending: false }),
      supabase.from('v_quality_trends').select('*').order('period_month', { ascending: true }),
    ]);

    this.state.periods = periodsRes.data || [];
    this.state.trends = summaryRes.data || [];

    if (!this.state.periods.length) {
      this.state.loading = false;
      this.renderEmpty();
      return;
    }

    // Por defecto, el periodo abierto; si no hay, el más reciente con datos.
    if (!this.state.periodId || !this.state.periods.some(p => p.period_id === this.state.periodId)) {
      const open = this.state.periods.find(p => p.status === 'open');
      this.state.periodId = (open || this.state.periods[0]).period_id;
    }

    await this.loadPeriod();
    this.state.loading = false;
    this.render();
  },

  async loadPeriod() {
    const pid = this.state.periodId;
    if (!pid) return;

    const [dims, tDims, alerts, actions, topics, comments] = await Promise.all([
      supabase.from('v_quality_dimension_scores').select('*').eq('period_id', pid).order('sort_order'),
      supabase.from('v_quality_teacher_dimensions').select('*').eq('period_id', pid).order('sort_order'),
      supabase.from('quality_alerts').select('*').eq('period_id', pid).order('created_at', { ascending: false }),
      supabase.from('quality_actions').select('*').order('created_at', { ascending: false }),
      supabase.from('v_quality_comment_topics').select('*').eq('period_id', pid).order('mentions', { ascending: false }),
      supabase.from('quality_responses')
        .select('id, student_id, teacher_id, teacher_comment, general_comment, comment_anonymous, created_at')
        .eq('period_id', pid)
        .order('created_at', { ascending: false }),
    ]);

    this.state.dimensions = dims.data || [];
    this.state.teacherDimensions = tDims.data || [];
    this.state.alerts = alerts.data || [];
    this.state.actions = actions.data || [];
    this.state.topics = topics.data || [];
    this.state.comments = comments.data || [];
    this.state.summary = this.state.periods.find(p => p.period_id === pid) || null;

    // Nombres de alumno: solo se necesitan para comentarios NO anónimos. Se
    // piden aparte para no arrastrar el dato de las familias anónimas.
    const visibleIds = this.state.comments.filter(c => !c.comment_anonymous).map(c => c.student_id);
    this.state.studentNames = {};
    if (visibleIds.length) {
      const { data: students } = await supabase
        .from('students')
        .select('id, name, last_name')
        .in('id', visibleIds);
      (students || []).forEach(s => {
        this.state.studentNames[s.id] = [s.name, s.last_name].filter(Boolean).join(' ');
      });
    }

    // Los datos por docente se traen de la matriz para el resumen del bloque A.
    const { data: matrix } = await supabase
      .from('v_quality_teacher_matrix')
      .select('*')
      .eq('period_id', pid)
      .order('teacher_name');
    this.state.teachers = matrix || [];
  },

  // ── Render ─────────────────────────────────────────────────────────────────

  get container() {
    return document.getElementById('qualityEvalContent');
  },

  renderSkeleton() {
    const el = this.container;
    if (!el) return;
    el.innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        ${Array.from({ length: 4 }, () => `
          <div class="h-28 rounded-3xl bg-slate-100 animate-pulse"></div>`).join('')}
      </div>
      <div class="h-64 rounded-3xl bg-slate-100 animate-pulse"></div>`;
  },

  renderEmpty() {
    const el = this.container;
    if (!el) return;
    el.innerHTML = `
      <div class="text-center py-20 bg-white rounded-3xl border border-slate-100">
        <div class="text-6xl mb-3">📊</div>
        <h3 class="font-black text-slate-800 text-lg">Todavía no hay periodos de evaluación</h3>
        <p class="text-sm font-bold text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
          El periodo se abre automáticamente el día 1 de cada mes, sobre el mes
          anterior. Si necesitas abrirlo ahora, ejecuta en Supabase:
        </p>
        <code class="inline-block mt-3 px-4 py-2 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono">
          SELECT public.quality_activate_previous_month();
        </code>
      </div>`;
  },

  render() {
    const el = this.container;
    if (!el) return;

    const s = this.state;
    const period = s.periods.find(p => p.period_id === s.periodId);

    el.innerHTML = `
      ${this._renderHeader(period)}
      ${this._renderTabs()}
      <div id="qe-tab-body">${this._renderTabBody()}</div>`;

    this.bind();
    if (window.lucide) window.lucide.createIcons();
  },

  _renderHeader(period) {
    if (!period) return '';
    const isOpen = period.status === 'open';
    return `
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div class="flex items-center gap-3 flex-wrap">
          <label class="text-xs font-black text-slate-500 uppercase">Periodo</label>
          <select id="qe-period" class="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-400">
            ${this.state.periods.map(p => `
              <option value="${p.period_id}" ${p.period_id === this.state.periodId ? 'selected' : ''}>
                ${_monthLabel(p.period_month)} · ${p.status === 'open' ? 'Abierto' : 'Cerrado'} (${p.response_count} resp.)
              </option>`).join('')}
          </select>
          <span class="px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${isOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
            ${isOpen ? 'Recibiendo respuestas' : 'Histórico'}
          </span>
        </div>
      </div>`;
  },

  _renderTabs() {
    const tabs = [
      { id: 'resumen',    label: 'Resumen',    icon: '📊' },
      { id: 'docentes',   label: 'Docentes',   icon: '👩‍🏫' },
      { id: 'seguimiento',label: 'Seguimiento',icon: '🎯' },
      { id: 'comentarios',label: 'Comentarios',icon: '💬' },
    ];
    return `
      <div class="flex gap-1.5 p-1 bg-slate-100 rounded-2xl mb-6 overflow-x-auto">
        ${tabs.map(t => `
          <button data-qe-tab="${t.id}"
                  class="px-4 py-2.5 rounded-xl text-xs font-black whitespace-nowrap transition-all ${
                    this.state.tab === t.id
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }">
            <span class="mr-1">${t.icon}</span>${t.label}
          </button>`).join('')}
      </div>`;
  },

  _renderTabBody() {
    switch (this.state.tab) {
      case 'docentes':    return this._renderDocentes();
      case 'seguimiento': return this._renderSeguimiento();
      case 'comentarios': return this._renderComentarios();
      default:            return this._renderResumen();
    }
  },

  // ── Resumen ────────────────────────────────────────────────────────────────

  _renderResumen() {
    const s = this.state;
    const sum = s.summary || {};

    if (!s.dimensions.length && !s.comments.length) {
      return `
        <div class="text-center py-16 bg-white rounded-3xl border border-slate-100">
          <div class="text-5xl mb-3">⏳</div>
          <p class="font-black text-slate-700">Sin respuestas en este periodo</p>
          <p class="text-xs font-bold text-slate-400 mt-1">
            Cuando las familias respondan, los indicadores aparecerán aquí.
          </p>
        </div>`;
    }

    return `
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        ${this._kpi('IGSM', _fmt(sum.igsm), 'Satisfacción general', sum.igsm, '💬')}
        ${this._kpi('Índice docente', _fmt(sum.teacher_index), 'Bloque A', sum.teacher_index, '👩‍🏫')}
        ${this._kpi('Índice institucional', _fmt(sum.institution_index), 'Bloque B', sum.institution_index, '🏫')}
        ${this._kpi('Participación', _fmt(sum.participation_pct, '%'), `${sum.response_count || 0} de ${sum.eligible_count || 0} familias`, null, '👨‍👩‍👧')}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        ${this._renderDimensions()}
        ${this._renderTrends()}
      </div>

      ${this._renderTopics()}`;
  },

  _kpi(label, value, hint, score, icon) {
    return `
      <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-wider">${label}</span>
          <span class="text-lg">${icon}</span>
        </div>
        <p class="text-3xl font-black ${score !== null ? _scoreColor(score) : 'text-slate-700'}">${value}</p>
        <p class="text-[11px] font-bold text-slate-400 mt-1">${hint}</p>
      </div>`;
  },

  _renderDimensions() {
    const groups = {
      docente: this.state.dimensions.filter(d => d.block === 'docente'),
      institucion: this.state.dimensions.filter(d => d.block === 'institucion'),
    };

    return `
      <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
        <h3 class="font-black text-slate-800 text-sm mb-1">Promedio por dimensión</h3>
        <p class="text-[11px] font-bold text-slate-400 mb-4">Escala 1 a 5 · ${_monthLabel(this.state.summary?.period_month)}</p>

        ${['institucion', 'docente'].map(block => `
          <div class="${block === 'docente' ? 'mt-5 pt-5 border-t border-slate-100' : ''}">
            <p class="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
              ${block === 'docente' ? 'Bloque A · Docente' : 'Bloque B · Institución'}
            </p>
            ${groups[block].length ? groups[block].map(d => `
              <div class="mb-2.5">
                <div class="flex items-baseline justify-between gap-3 mb-1">
                  <span class="text-xs font-bold text-slate-600 leading-snug">${Helpers.escapeHTML(d.prompt)}</span>
                  <span class="text-xs font-black ${_scoreColor(d.avg_score)} shrink-0">${_fmt(d.avg_score)}</span>
                </div>
                <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div class="h-full rounded-full ${d.avg_score >= 4.5 ? 'bg-emerald-500' : d.avg_score >= 3.5 ? 'bg-teal-500' : d.avg_score >= 2.5 ? 'bg-amber-500' : 'bg-rose-500'}"
                       style="width:${Math.min(100, (Number(d.avg_score) || 0) / 5 * 100)}%"></div>
                </div>
                <p class="text-[10px] font-bold text-slate-300 mt-0.5">${d.answers} respuesta${d.answers === 1 ? '' : 's'}</p>
              </div>`).join('') : '<p class="text-[11px] font-bold text-slate-300">Sin datos</p>'}
          </div>`).join('')}
      </div>`;
  },

  _renderTrends() {
    const trends = (this.state.trends || []).slice(-6);
    if (!trends.length) return '';

    const max = Math.max(...trends.map(t => Number(t.igsm) || 0), 5);
    return `
      <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
        <h3 class="font-black text-slate-800 text-sm mb-1">Tendencia</h3>
        <p class="text-[11px] font-bold text-slate-400 mb-4">IGSM de los últimos periodos</p>
        <div class="flex items-end gap-2 h-40">
          ${trends.map(t => {
            const v = Number(t.igsm) || 0;
            const h = max > 0 ? (v / max) * 100 : 0;
            return `
              <div class="flex-1 flex flex-col items-center justify-end gap-1 group">
                <span class="text-[10px] font-black text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">${_fmt(t.igsm)}</span>
                <div class="w-full bg-indigo-500 rounded-t-lg min-h-[2px]" style="height:${h}%"></div>
                <span class="text-[9px] font-bold text-slate-400 text-center leading-tight">
                  ${new Date(t.period_month).toLocaleDateString('es-DO', { month: 'short' })}
                </span>
              </div>`;
          }).join('')}
        </div>
        <p class="text-[10px] font-bold text-slate-300 mt-2 text-center">
          Sin periodo anterior todavía no hay comparación
        </p>
      </div>`;
  },

  _renderTopics() {
    if (!this.state.topics.length) return '';
    const max = Math.max(...this.state.topics.map(t => t.mentions));
    return `
      <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
        <h3 class="font-black text-slate-800 text-sm mb-1">Temas mencionados</h3>
        <p class="text-[11px] font-bold text-slate-400 mb-4">Dónde se concentran los comentarios de las familias</p>
        <div class="flex flex-wrap gap-2">
          ${this.state.topics.map(t => `
            <span class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-100 rounded-full text-xs font-bold text-slate-600">
              ${Helpers.escapeHTML(t.category)}
              <span class="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-black">${t.mentions}</span>
            </span>`).join('')}
        </div>
      </div>`;
  },

  // ── Docentes ───────────────────────────────────────────────────────────────

  _renderDocentes() {
    if (!this.state.teachers.length) {
      return `
        <div class="text-center py-16 bg-white rounded-3xl border border-slate-100">
          <p class="font-black text-slate-700">Sin datos de docentes en este periodo</p>
          <p class="text-xs font-bold text-slate-400 mt-1">La matriz se arma cuando las familias respondan.</p>
        </div>`;
    }

    // Dimensiones del bloque A, para las columnas de la matriz.
    const dimKeys = [];
    this.state.teacherDimensions.forEach(d => { if (!dimKeys.includes(d.question_key)) dimKeys.push(d.question_key); });
    const dimLabels = {};
    this.state.teacherDimensions.forEach(d => { dimLabels[d.question_key] = d.prompt; });

    const cell = (teacherId, key) =>
      this.state.teacherDimensions.find(d => d.teacher_id === teacherId && d.question_key === key);

    return `
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div class="p-5 border-b border-slate-100">
          <h3 class="font-black text-slate-800 text-sm">Matriz por docente</h3>
          <p class="text-[11px] font-bold text-slate-400 mt-1 leading-relaxed">
            Lee cada dimensión junto con su número de respuestas. Una sola puntuación baja
            no describe a una docente: revisa los comentarios de ese periodo antes de concluir.
          </p>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left min-w-[720px]">
            <thead class="bg-slate-50">
              <tr>
                <th class="px-5 py-3 text-[10px] font-black text-slate-500 uppercase">Docente</th>
                ${dimKeys.map(k => `
                  <th class="px-3 py-3 text-[10px] font-black text-slate-500 uppercase" title="${Helpers.escapeHTML(dimLabels[k] || '')}">
                    ${Helpers.escapeHTML((dimLabels[k] || k).split(' ').slice(0, 3).join(' '))}
                  </th>`).join('')}
                <th class="px-3 py-3 text-[10px] font-black text-slate-500 uppercase">IGSM</th>
              </tr>
            </thead>
            <tbody>
              ${this.state.teachers.map(t => `
                <tr class="border-t border-slate-50 hover:bg-slate-50/50">
                  <td class="px-5 py-4">
                    <p class="text-sm font-black text-slate-700">${Helpers.escapeHTML(t.teacher_name || 'Sin aula asignada')}</p>
                    <p class="text-[10px] font-bold text-slate-400">${t.responses} respuesta${t.responses === 1 ? '' : 's'}</p>
                  </td>
                  ${dimKeys.map(k => {
                    const d = cell(t.teacher_id, k);
                    return `<td class="px-3 py-4 text-sm font-black ${_scoreColor(d?.avg_score)}">
                              ${d ? _fmt(d.avg_score) : '—'}
                            </td>`;
                  }).join('')}
                  <td class="px-3 py-4 text-sm font-black ${_scoreColor(t.igsm)}">${_fmt(t.igsm)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  },

  // ── Seguimiento: alertas + acciones ────────────────────────────────────────

  _renderSeguimiento() {
    return `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        ${this._renderAlerts()}
        ${this._renderActions()}
      </div>`;
  },

  _renderAlerts() {
    return `
      <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
        <div class="flex items-center justify-between mb-1">
          <h3 class="font-black text-slate-800 text-sm">Alertas de revisión</h3>
          <span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black">${this.state.alerts.length}</span>
        </div>
        <p class="text-[11px] font-bold text-slate-400 mb-4 leading-relaxed">
          Una alerta marca una dimensión que bajó medio punto o más frente al mes
          anterior, con al menos 3 respuestas. No es una sanción: es una señal para revisar.
        </p>

        ${this.state.alerts.length ? this.state.alerts.map(a => {
          const st = ALERT_STATUS[a.status] || ALERT_STATUS.pendiente;
          return `
            <div class="p-3.5 mb-2.5 rounded-2xl border ${st.cls}">
              <div class="flex items-start justify-between gap-2 mb-1.5">
                <span class="text-xs font-black">${st.icon} ${Helpers.escapeHTML(a.scope === 'docente' ? 'Docente' : 'Institución')}</span>
                <select data-qe-alert="${a.id}" class="px-2 py-1 border border-white/50 rounded-lg text-[10px] font-black bg-white/70 outline-none">
                  ${Object.entries(ALERT_STATUS).map(([k, v]) => `<option value="${k}" ${k === a.status ? 'selected' : ''}>${v.label}</option>`).join('')}
                </select>
              </div>
              <p class="text-[11px] font-bold text-slate-600 leading-relaxed">${Helpers.escapeHTML(a.message)}</p>
            </div>`;
        }).join('') : `
          <div class="text-center py-10 bg-slate-50 rounded-2xl">
            <p class="text-xs font-bold text-slate-400">Sin alertas en este periodo</p>
            <p class="text-[10px] font-bold text-slate-300 mt-1">Ningún descenso con muestra suficiente</p>
          </div>`}
      </div>`;
  },

  _renderActions() {
    return `
      <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
        <div class="flex items-center justify-between mb-1">
          <h3 class="font-black text-slate-800 text-sm">Acciones de mejora</h3>
          <button data-qe-new-action
                  class="px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-indigo-700 transition-all">
            + Nueva
          </button>
        </div>
        <p class="text-[11px] font-bold text-slate-400 mb-4 leading-relaxed">
          El objetivo no es cerrar la acción: es ver su efecto en el mes siguiente.
        </p>

        ${this.state.actions.length ? this.state.actions.map(a => {
          const st = ACTION_STATUS[a.status] || ACTION_STATUS.pendiente;
          return `
            <div class="p-3.5 mb-2.5 rounded-2xl border border-slate-100 bg-slate-50/50">
              <div class="flex items-start justify-between gap-2 mb-1">
                <p class="text-xs font-black text-slate-700 leading-snug">${Helpers.escapeHTML(a.title)}</p>
                <button data-qe-del-action="${a.id}" title="Eliminar"
                        class="text-slate-300 hover:text-rose-500 transition-colors shrink-0">✕</button>
              </div>
              ${a.description ? `<p class="text-[11px] font-bold text-slate-500 leading-relaxed mb-1.5">${Helpers.escapeHTML(a.description)}</p>` : ''}
              <div class="flex items-center gap-2 flex-wrap">
                <select data-qe-action="${a.id}" class="px-2 py-1 border border-slate-200 rounded-lg text-[10px] font-black bg-white outline-none">
                  ${Object.entries(ACTION_STATUS).map(([k, v]) => `<option value="${k}" ${k === a.status ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}
                </select>
                ${a.responsible ? `<span class="text-[10px] font-bold text-slate-400">👤 ${Helpers.escapeHTML(a.responsible)}</span>` : ''}
                ${a.due_date ? `<span class="text-[10px] font-bold text-slate-400">📅 ${Helpers.escapeHTML(a.due_date)}</span>` : ''}
              </div>
            </div>`;
        }).join('') : `
          <div class="text-center py-10 bg-slate-50 rounded-2xl">
            <p class="text-xs font-bold text-slate-400">Sin acciones registradas</p>
            <p class="text-[10px] font-bold text-slate-300 mt-1">Crea una cuando una alerta requiera un plan</p>
          </div>`}
      </div>`;
  },

  // ── Comentarios ────────────────────────────────────────────────────────────

  _renderComentarios() {
    if (!this.state.comments.length) {
      return `
        <div class="text-center py-16 bg-white rounded-3xl border border-slate-100">
          <p class="font-black text-slate-700">Sin comentarios en este periodo</p>
        </div>`;
    }

    return `
      <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
        <div class="flex items-center justify-between mb-1">
          <h3 class="font-black text-slate-800 text-sm">Comentarios de las familias</h3>
          <button data-qe-export-comments
                  class="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-slate-200 transition-all">
            Exportar CSV
          </button>
        </div>
        <p class="text-[11px] font-bold text-slate-400 mb-4 leading-relaxed">
          Los comentarios marcados como anónimos se muestran sin la familia que los escribió.
        </p>

        ${this.state.comments.map(c => {
          const anon = c.comment_anonymous;
          const who = anon
            ? 'Familia (anónimo)'
            : `Familia de ${this.state.studentNames[c.student_id] || '—'}`;
          const text = c.general_comment || c.teacher_comment;
          return `
            <div class="p-3.5 mb-2.5 rounded-2xl border ${anon ? 'border-indigo-100 bg-indigo-50/40' : 'border-slate-100 bg-slate-50/50'}">
              <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                <span class="text-[10px] font-black ${anon ? 'text-indigo-600' : 'text-slate-500'}">${Helpers.escapeHTML(who)}</span>
                ${anon ? '<span class="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[9px] font-black uppercase">Anónimo</span>' : ''}
                <span class="text-[10px] font-bold text-slate-300 ml-auto">${Helpers.formatDate(c.created_at)}</span>
              </div>
              <p class="text-xs font-bold text-slate-600 leading-relaxed">${Helpers.escapeHTML(text)}</p>
            </div>`;
        }).join('')}
      </div>`;
  },

  // ── Eventos ────────────────────────────────────────────────────────────────

  bind() {
    const el = this.container;
    if (!el) return;

    el.querySelector('#qe-period')?.addEventListener('change', (e) => {
      this.state.periodId = parseInt(e.target.value, 10);
      this.loadPeriod().then(() => this.render());
    });

    el.querySelectorAll('[data-qe-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.tab = btn.dataset.qeTab;
        this.render();
      });
    });

    el.querySelectorAll('[data-qe-alert]').forEach(sel => {
      sel.addEventListener('change', (e) => this._updateAlert(sel.dataset.qeAlert, e.target.value));
    });

    el.querySelectorAll('[data-qe-action]').forEach(sel => {
      sel.addEventListener('change', (e) => this._updateAction(sel.dataset.qeAction, e.target.value));
    });

    el.querySelectorAll('[data-qe-del-action]').forEach(btn => {
      btn.addEventListener('click', () => this._deleteAction(btn.dataset.qeDelAction));
    });

    el.querySelector('[data-qe-new-action]')?.addEventListener('click', () => this._newAction());
    el.querySelector('[data-qe-export-comments]')?.addEventListener('click', () => this._exportComments());
  },

  async _updateAlert(id, status) {
    const { error } = await supabase.from('quality_alerts').update({ status }).eq('id', id);
    if (error) return Helpers.toast(`No se pudo actualizar: ${error.message}`, 'error');
    const a = this.state.alerts.find(x => x.id === id);
    if (a) a.status = status;
    Helpers.toast('Alerta actualizada', 'success');
  },

  async _updateAction(id, status) {
    const patch = { status };
    if (status === 'solucionado') patch.resolved_at = new Date().toISOString();
    const { error } = await supabase.from('quality_actions').update(patch).eq('id', id);
    if (error) return Helpers.toast(`No se pudo actualizar: ${error.message}`, 'error');
    const a = this.state.actions.find(x => x.id === id);
    if (a) Object.assign(a, patch);
    Helpers.toast('Acción actualizada', 'success');
  },

  async _deleteAction(id) {
    const { error } = await supabase.from('quality_actions').delete().eq('id', id);
    if (error) return Helpers.toast(`No se pudo eliminar: ${error.message}`, 'error');
    this.state.actions = this.state.actions.filter(a => a.id !== id);
    this.render();
    Helpers.toast('Acción eliminada', 'success');
  },

  _newAction() {
    window.openGlobalModal(`
      <div class="p-6 space-y-4">
        <h3 class="font-black text-slate-800 text-lg">Nueva acción de mejora</h3>
        <div>
          <label class="text-[10px] font-black text-slate-500 uppercase">Título *</label>
          <input id="qe-act-title" placeholder="Ej: Revisar la comunicación de novedades"
                 class="w-full px-4 py-3 mt-1 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-100">
        </div>
        <div>
          <label class="text-[10px] font-black text-slate-500 uppercase">Descripción</label>
          <textarea id="qe-act-desc" rows="3"
                    class="w-full px-4 py-3 mt-1 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-100 resize-none"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-[10px] font-black text-slate-500 uppercase">Responsable</label>
            <input id="qe-act-owner" placeholder="Nombre"
                   class="w-full px-4 py-3 mt-1 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-100">
          </div>
          <div>
            <label class="text-[10px] font-black text-slate-500 uppercase">Fecha límite</label>
            <input id="qe-act-due" type="date"
                   class="w-full px-4 py-3 mt-1 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-100">
          </div>
        </div>
        <button onclick="App.evaluaciones.saveNewAction()"
                class="w-full py-3 bg-indigo-600 text-white font-black text-sm rounded-2xl hover:bg-indigo-700 transition-all active:scale-95">
          Guardar acción
        </button>
      </div>`);
  },

  async saveNewAction() {
    const title = document.getElementById('qe-act-title')?.value.trim();
    if (!title) return Helpers.toast('El título es obligatorio', 'warning');

    const { error } = await supabase.from('quality_actions').insert({
      period_id: this.state.periodId,
      title,
      description: document.getElementById('qe-act-desc')?.value.trim() || null,
      responsible: document.getElementById('qe-act-owner')?.value.trim() || null,
      due_date: document.getElementById('qe-act-due')?.value || null,
      status: 'pendiente',
    });

    if (error) return Helpers.toast(`No se pudo guardar: ${error.message}`, 'error');

    App.ui.closeModal();
    Helpers.toast('Ación registrada', 'success');
    await this.loadPeriod();
    this.render();
  },

  _exportComments() {
    const rows = this.state.comments.map(c => ({
      anonimo: c.comment_anonymous ? 'sí' : 'no',
      familia: c.comment_anonymous ? '' : (this.state.studentNames[c.student_id] || ''),
      comentario_institucional: c.general_comment || '',
      comentario_docente: c.teacher_comment || '',
      fecha: c.created_at,
    }));
    Helpers.exportToCSV(rows, `comentarios_calidad_${new Date().toISOString().slice(0, 10)}.csv`);
    Helpers.toast('CSV generado', 'success');
  },
};
