/**
 * SCHOOL YEAR MODULE — Panel de Directora
 * 
 * Gestión completa de años escolares, períodos, inscripciones y cierre.
 * Solo la directora puede usar este módulo.
 */

import { supabase } from '../shared/supabase.js';
import { SchoolEngine } from '../shared/school-engine.js';
import { Helpers } from '../shared/helpers.js';
import { AppState } from './state.js';
import { CalendarView } from '../shared/calendar-view.js';

const { escapeHTML } = Helpers;

export const SchoolYearModule = {
  _years: [],
  _selectedYear: null,

  // ── Inicialización ──────────────────────────────────────────
  async init() {
    await this._loadYears();
    this._render();
  },

  async _loadYears() {
    const { data } = await SchoolEngine.getAllSchoolYears();
    this._years = data || [];
  },

  // ── Render Principal ────────────────────────────────────────
  _render() {
    const container = document.getElementById('schoolYearContent');
    if (!container) return;

    const activeYear = SchoolEngine.getSchoolYear();
    const status = SchoolEngine.getSystemStatus();

    const periods = SchoolEngine.getAllPeriods();

    container.innerHTML = `
      <div class="space-y-6">
        <!-- Estado Actual -->
        ${this._renderCurrentStatus(activeYear, status)}
        
        <!-- Calendario Visual -->
        <div class="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-black text-slate-800 flex items-center gap-2">
              <i data-lucide="calendar-range" class="w-4 h-4 text-violet-500"></i>
              Línea de Tiempo — Períodos Académicos
            </h3>
          </div>
          <div id="calendarTimelineContainer"></div>
        </div>
        
        <!-- Acciones Rápidas -->
        ${this._renderQuickActions(activeYear, status)}
        
        <!-- Lista de Años Escolares -->
        ${this._renderYearsList()}
        
        <!-- Wizard: Crear Nuevo Año -->
        <div id="schoolYearWizard" class="hidden"></div>
      </div>
    `;

    CalendarView.renderPeriodTimeline('calendarTimelineContainer', periods, activeYear);
    if (window.lucide) lucide.createIcons();
  },

  // ── Panel de Estado Actual ──────────────────────────────────
  _renderCurrentStatus(year, status) {
    if (!year) {
      return `
        <div class="bg-gradient-to-br from-violet-600 to-indigo-700 rounded-3xl p-8 text-white text-center">
          <div class="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <i data-lucide="calendar-plus" class="w-10 h-10"></i>
          </div>
          <h3 class="text-xl font-black mb-2">No hay Año Escolar configurado</h3>
          <p class="text-white/70 text-sm mb-6">Crea tu primer año escolar para activar el motor del sistema.</p>
          <button onclick="App.schoolYear.openWizard()" class="px-8 py-3 bg-white text-violet-700 rounded-2xl font-black text-sm hover:bg-white/90 transition-all">
            Crear Año Escolar
          </button>
        </div>
      `;
    }

    const period = SchoolEngine.getActivePeriod();
    const periods = SchoolEngine.getAllPeriods();
    const enrollmentOpen = SchoolEngine.isEnrollmentOpen();
    const reenrollmentOpen = SchoolEngine.isReenrollmentOpen();

    return `
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <!-- Header del Año -->
        <div class="bg-gradient-to-r from-violet-600 to-indigo-600 p-6 text-white">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-[10px] font-black uppercase tracking-widest text-white/60">Año Escolar Actual</p>
              <h2 class="text-2xl font-black">${escapeHTML(year.name)}</h2>
            </div>
            <span class="px-4 py-2 ${SchoolEngine.getStatusColor()} rounded-2xl text-xs font-black">
              ${SchoolEngine.getStatusLabel()}
            </span>
          </div>
          <div class="mt-4 grid grid-cols-3 gap-4 text-center">
            <div>
              <p class="text-white/60 text-[10px] font-black uppercase">Inicio</p>
              <p class="text-sm font-black">${this._formatDate(year.start_date)}</p>
            </div>
            <div>
              <p class="text-white/60 text-[10px] font-black uppercase">Fin</p>
              <p class="text-sm font-black">${this._formatDate(year.end_date)}</p>
            </div>
            <div>
              <p class="text-white/60 text-[10px] font-black uppercase">Días Restantes</p>
              <p class="text-sm font-black">${year.days_remaining || 0}</p>
            </div>
          </div>
        </div>

        <!-- Indicadores -->
        <div class="p-6 grid grid-cols-2 gap-4">
          <!-- Inscripciones -->
          <div class="p-4 rounded-2xl border-2 ${enrollmentOpen ? 'border-blue-200 bg-blue-50' : 'border-slate-100 bg-slate-50'}">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl ${enrollmentOpen ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-500'} flex items-center justify-center">
                <i data-lucide="user-plus" class="w-5 h-5"></i>
              </div>
              <div>
                <p class="text-[10px] font-black uppercase tracking-widest ${enrollmentOpen ? 'text-blue-600' : 'text-slate-400'}">Inscripciones</p>
                <p class="text-sm font-black ${enrollmentOpen ? 'text-blue-800' : 'text-slate-600'}">${enrollmentOpen ? 'ABIERTAS' : 'Cerradas'}</p>
              </div>
            </div>
          </div>

          <!-- Reinscripciones -->
          <div class="p-4 rounded-2xl border-2 ${reenrollmentOpen ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-slate-50'}">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl ${reenrollmentOpen ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-500'} flex items-center justify-center">
                <i data-lucide="refresh-cw" class="w-5 h-5"></i>
              </div>
              <div>
                <p class="text-[10px] font-black uppercase tracking-widest ${reenrollmentOpen ? 'text-amber-600' : 'text-slate-400'}">Reinscripciones</p>
                <p class="text-sm font-black ${reenrollmentOpen ? 'text-amber-800' : 'text-slate-600'}">${reenrollmentOpen ? 'ABIERTAS' : 'Cerradas'}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Períodos -->
        <div class="px-6 pb-6">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-black text-slate-800">Períodos Académicos</h3>
            <span class="text-[10px] font-black text-violet-600 uppercase">${periods.length} período${periods.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="space-y-2">
            ${periods.map(p => `
              <div class="flex items-center gap-3 p-3 rounded-xl ${p.is_active ? 'bg-violet-50 border border-violet-200' : p.status === 'closed' ? 'bg-slate-50 opacity-60' : 'bg-white border border-slate-100'}">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black ${p.is_active ? 'bg-violet-500 text-white' : p.status === 'closed' ? 'bg-slate-300 text-white' : 'bg-slate-200 text-slate-600'}">
                  ${p.order_index}
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-bold text-slate-800">${escapeHTML(p.name)}</p>
                  <p class="text-[10px] font-bold text-slate-400">${this._formatDate(p.start_date)} — ${this._formatDate(p.end_date)}</p>
                </div>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${p.status === 'open' ? 'bg-emerald-100 text-emerald-700' : p.status === 'closed' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}">
                  ${p.status === 'open' ? 'ABIERTO' : p.status === 'closed' ? 'CERRADO' : 'PENDIENTE'}
                </span>
                ${p.is_active ? '<span class="w-2 h-2 rounded-full bg-violet-500 animate-pulse"></span>' : ''}
              </div>
            `).join('')}
            ${periods.length === 0 ? '<p class="text-center text-slate-400 text-sm py-4">No hay períodos configurados</p>' : ''}
          </div>
        </div>
      </div>
    `;
  },

  // ── Acciones Rápidas ────────────────────────────────────────
  _renderQuickActions(year, status) {
    if (!year) return '';

    const actions = [];

    // Avanzar estado
    actions.push({
      label: 'Avanzar Estado',
      icon: 'play',
      color: 'bg-emerald-500 hover:bg-emerald-600',
      action: 'App.schoolYear.advanceState()'
    });

    // Cerrar período actual
    const period = SchoolEngine.getActivePeriod();
    if (period && period.status === 'open') {
      actions.push({
        label: 'Cerrar Período',
        icon: 'lock',
        color: 'bg-amber-500 hover:bg-amber-600',
        action: `App.schoolYear.closePeriod(${period.id})`
      });
    }

    // Cerrar año escolar
    if (year.status === 'active') {
      actions.push({
        label: 'Cerrar Año',
        icon: 'archive',
        color: 'bg-red-500 hover:bg-red-600',
        action: `App.schoolYear.closeYear(${year.id})`
      });
    }

    // Promover estudiantes
    if (year.status === 'archived') {
      actions.push({
        label: 'Promover Estudiantes',
        icon: 'graduation-cap',
        color: 'bg-violet-500 hover:bg-violet-600',
        action: `App.schoolYear.promoteStudents(${year.id})`
      });
    }

    // Crear nuevo año
    actions.push({
      label: 'Nuevo Año',
      icon: 'plus',
      color: 'bg-slate-600 hover:bg-slate-700',
      action: 'App.schoolYear.openWizard()'
    });

    return `
      <div class="flex flex-wrap gap-3">
        ${actions.map(a => `
          <button onclick="${a.action}" class="px-5 py-2.5 ${a.color} text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg transition-all flex items-center gap-2">
            <i data-lucide="${a.icon}" class="w-4 h-4"></i>
            ${a.label}
          </button>
        `).join('')}
      </div>
    `;
  },

  // ── Lista de Años Escolares ─────────────────────────────────
  _renderYearsList() {
    if (this._years.length === 0) return '';

    return `
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
        <h3 class="text-sm font-black text-slate-800 mb-4 flex items-center gap-2">
          <i data-lucide="archive" class="w-4 h-4 text-slate-400"></i>
          Historial de Años Escolares
        </h3>
        <div class="space-y-3">
          ${this._years.map(y => `
            <div class="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 hover:bg-slate-50 transition-all cursor-pointer" onclick="App.schoolYear.viewYear(${y.id})">
              <div class="w-12 h-12 rounded-2xl ${y.status === 'active' ? 'bg-violet-100 text-violet-700' : y.status === 'archived' ? 'bg-slate-100 text-slate-500' : 'bg-blue-100 text-blue-700'} flex items-center justify-center font-black">
                ${y.name.split('-')[0].slice(-2)}
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-black text-slate-800">${escapeHTML(y.name)}</p>
                <p class="text-[10px] font-bold text-slate-400">${this._formatDate(y.start_date)} — ${this._formatDate(y.end_date)}</p>
              </div>
              <span class="px-3 py-1 rounded-full text-[10px] font-black ${SchoolEngine.getStatusColor()} ${y.status !== SchoolEngine.getSchoolYear()?.status ? 'opacity-50' : ''}">
                ${this._getStatusLabel(y.status)}
              </span>
              <i data-lucide="chevron-right" class="w-4 h-4 text-slate-300"></i>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  // ── Wizard: Crear Año Escolar ───────────────────────────────
  openWizard(editYear = null) {
    const wizard = document.getElementById('schoolYearWizard');
    if (!wizard) return;

    this._selectedYear = editYear;

    const y = editYear || {};
    const isEdit = !!editYear;
    const nextYear = new Date().getFullYear();
    const yearName = `${nextYear}-${nextYear + 1}`;

    wizard.innerHTML = `
      <div class="bg-white rounded-3xl border border-violet-200 shadow-lg p-8">
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-lg font-black text-slate-800 flex items-center gap-3">
            <div class="w-10 h-10 bg-violet-100 rounded-2xl flex items-center justify-center">
              <i data-lucide="${isEdit ? 'edit' : 'plus-circle'}" class="w-5 h-5 text-violet-600"></i>
            </div>
            ${isEdit ? 'Editar Año Escolar' : 'Nuevo Año Escolar'}
          </h3>
          <button onclick="App.schoolYear.closeWizard()" class="p-2 hover:bg-slate-100 rounded-xl transition-all">
            <i data-lucide="x" class="w-5 h-5 text-slate-400"></i>
          </button>
        </div>

        <form id="schoolYearForm" onsubmit="App.schoolYear.saveYear(event)" class="space-y-6">
          <!-- Nombre del Año -->
          <div>
            <label class="text-xs font-black text-slate-600 uppercase tracking-widest mb-2 block">Nombre del Año Escolar</label>
            <input type="text" id="syName" value="${escapeHTML(y.name || yearName)}" required
              class="w-full p-4 bg-slate-50 rounded-2xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-violet-400 transition-all"
              placeholder="Ej: 2026-2027">
          </div>

          <!-- Fechas del Año -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-xs font-black text-slate-600 uppercase tracking-widest mb-2 block">Inicio del Año</label>
              <input type="date" id="syStartDate" value="${y.start_date || ''}" required
                class="w-full p-4 bg-slate-50 rounded-2xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-violet-400">
            </div>
            <div>
              <label class="text-xs font-black text-slate-600 uppercase tracking-widest mb-2 block">Fin del Año</label>
              <input type="date" id="syEndDate" value="${y.end_date || ''}" required
                class="w-full p-4 bg-slate-50 rounded-2xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-violet-400">
            </div>
          </div>

          <!-- Ventana de Inscripciones -->
          <div class="p-4 bg-blue-50 rounded-2xl border border-blue-100">
            <h4 class="text-xs font-black text-blue-700 uppercase tracking-widest mb-3 flex items-center gap-2">
              <i data-lucide="user-plus" class="w-4 h-4"></i> Ventana de Inscripciones (Nuevos)
            </h4>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="text-[10px] font-bold text-blue-600 mb-1 block">Desde</label>
                <input type="date" id="syEnrollStart" value="${y.enrollment_start || ''}"
                  class="w-full p-3 bg-white rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-400 border border-blue-100">
              </div>
              <div>
                <label class="text-[10px] font-bold text-blue-600 mb-1 block">Hasta</label>
                <input type="date" id="syEnrollEnd" value="${y.enrollment_end || ''}"
                  class="w-full p-3 bg-white rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-400 border border-blue-100">
              </div>
            </div>
          </div>

          <!-- Ventana de Reinscripciones -->
          <div class="p-4 bg-amber-50 rounded-2xl border border-amber-100">
            <h4 class="text-xs font-black text-amber-700 uppercase tracking-widest mb-3 flex items-center gap-2">
              <i data-lucide="refresh-cw" class="w-4 h-4"></i> Ventana de Reinscripciones (Existentes)
            </h4>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="text-[10px] font-bold text-amber-600 mb-1 block">Desde</label>
                <input type="date" id="syReenrollStart" value="${y.reenrollment_start || ''}"
                  class="w-full p-3 bg-white rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-400 border border-amber-100">
              </div>
              <div>
                <label class="text-[10px] font-bold text-amber-600 mb-1 block">Hasta</label>
                <input type="date" id="syReenrollEnd" value="${y.reenrollment_end || ''}"
                  class="w-full p-3 bg-white rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-400 border border-amber-100">
              </div>
            </div>
          </div>

          <!-- Períodos -->
          <div>
            <div class="flex items-center justify-between mb-3">
              <h4 class="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                <i data-lucide="layers" class="w-4 h-4 text-violet-500"></i> Períodos Académicos
              </h4>
              <button type="button" onclick="App.schoolYear.addPeriodRow()" class="px-4 py-1.5 bg-violet-100 text-violet-700 rounded-xl text-[10px] font-black uppercase hover:bg-violet-200 transition-all">
                + Agregar Período
              </button>
            </div>
            <div id="periodsList" class="space-y-3">
              <!-- Períodos por defecto: 2 -->
              <div class="period-row flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span class="w-8 h-8 bg-violet-500 text-white rounded-lg flex items-center justify-center text-xs font-black">1</span>
                <input type="text" placeholder="Nombre (Ej: Periodo 1)" class="period-name flex-1 p-2.5 bg-white rounded-lg text-sm font-bold border border-slate-200 outline-none focus:ring-2 focus:ring-violet-300">
                <input type="date" class="period-start p-2.5 bg-white rounded-lg text-xs font-bold border border-slate-200 outline-none focus:ring-2 focus:ring-violet-300">
                <input type="date" class="period-end p-2.5 bg-white rounded-lg text-xs font-bold border border-slate-200 outline-none focus:ring-2 focus:ring-violet-300">
                <button type="button" onclick="this.closest('.period-row').remove()" class="p-1.5 text-slate-400 hover:text-red-500 transition-colors">
                  <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
              </div>
              <div class="period-row flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span class="w-8 h-8 bg-violet-500 text-white rounded-lg flex items-center justify-center text-xs font-black">2</span>
                <input type="text" placeholder="Nombre (Ej: Periodo 2)" class="period-name flex-1 p-2.5 bg-white rounded-lg text-sm font-bold border border-slate-200 outline-none focus:ring-2 focus:ring-violet-300">
                <input type="date" class="period-start p-2.5 bg-white rounded-lg text-xs font-bold border border-slate-200 outline-none focus:ring-2 focus:ring-violet-300">
                <input type="date" class="period-end p-2.5 bg-white rounded-lg text-xs font-bold border border-slate-200 outline-none focus:ring-2 focus:ring-violet-300">
                <button type="button" onclick="this.closest('.period-row').remove()" class="p-1.5 text-slate-400 hover:text-red-500 transition-colors">
                  <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- Botones -->
          <div class="flex gap-3 pt-4">
            <button type="submit" class="flex-1 py-4 bg-violet-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-violet-700 shadow-lg shadow-violet-200 transition-all flex items-center justify-center gap-2">
              <i data-lucide="save" class="w-5 h-5"></i>
              ${isEdit ? 'Guardar Cambios' : 'Crear Año Escolar'}
            </button>
            <button type="button" onclick="App.schoolYear.closeWizard()" class="px-6 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black text-sm uppercase hover:bg-slate-200 transition-all">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    `;

    wizard.classList.remove('hidden');
    wizard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (window.lucide) lucide.createIcons();
  },

  // ── Agregar Fila de Período ─────────────────────────────────
  addPeriodRow() {
    const list = document.getElementById('periodsList');
    if (!list) return;

    const count = list.querySelectorAll('.period-row').length + 1;
    const row = document.createElement('div');
    row.className = 'period-row flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100';
    row.innerHTML = `
      <span class="w-8 h-8 bg-violet-500 text-white rounded-lg flex items-center justify-center text-xs font-black">${count}</span>
      <input type="text" placeholder="Nombre (Ej: Periodo ${count})" class="period-name flex-1 p-2.5 bg-white rounded-lg text-sm font-bold border border-slate-200 outline-none focus:ring-2 focus:ring-violet-300">
      <input type="date" class="period-start p-2.5 bg-white rounded-lg text-xs font-bold border border-slate-200 outline-none focus:ring-2 focus:ring-violet-300">
      <input type="date" class="period-end p-2.5 bg-white rounded-lg text-xs font-bold border border-slate-200 outline-none focus:ring-2 focus:ring-violet-300">
      <button type="button" onclick="this.closest('.period-row').remove()" class="p-1.5 text-slate-400 hover:text-red-500 transition-colors">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    `;
    list.appendChild(row);
    if (window.lucide) lucide.createIcons();
  },

  // ── Guardar Año Escolar ─────────────────────────────────────
  async saveYear(e) {
    e.preventDefault();

    const name = document.getElementById('syName')?.value?.trim();
    const startDate = document.getElementById('syStartDate')?.value;
    const endDate = document.getElementById('syEndDate')?.value;
    const enrollStart = document.getElementById('syEnrollStart')?.value || null;
    const enrollEnd = document.getElementById('syEnrollEnd')?.value || null;
    const reenrollStart = document.getElementById('syReenrollStart')?.value || null;
    const reenrollEnd = document.getElementById('syReenrollEnd')?.value || null;

    if (!name || !startDate || !endDate) {
      Helpers.toast('Completa nombre y fechas del año escolar', 'error');
      return;
    }

    if (new Date(endDate) <= new Date(startDate)) {
      Helpers.toast('La fecha de fin debe ser posterior al inicio', 'error');
      return;
    }

    // Recopilar períodos
    const periodRows = document.querySelectorAll('#periodsList .period-row');
    const periods = [];
    let hasEmptyPeriod = false;

    periodRows.forEach((row, idx) => {
      const pName = row.querySelector('.period-name')?.value?.trim() || `Periodo ${idx + 1}`;
      const pStart = row.querySelector('.period-start')?.value;
      const pEnd = row.querySelector('.period-end')?.value;

      if (pStart && pEnd) {
        periods.push({
          name: pName,
          start_date: pStart,
          end_date: pEnd,
          order_index: idx + 1
        });
      } else if (row.querySelector('.period-name')?.value || pStart || pEnd) {
        hasEmptyPeriod = true;
      }
    });

    if (periods.length === 0) {
      Helpers.toast('Agrega al menos un período con fechas', 'error');
      return;
    }

    if (hasEmptyPeriod) {
      Helpers.toast('Completa todas las fechas de los períodos', 'error');
      return;
    }

    try {
      Helpers.toast('Guardando año escolar...', 'info');

      let yearResult;
      if (this._selectedYear) {
        yearResult = await SchoolEngine.updateSchoolYear(this._selectedYear.id, {
          name, start_date: startDate, end_date: endDate,
          enrollment_start: enrollStart, enrollment_end: enrollEnd,
          reenrollment_start: reenrollStart, reenrollment_end: reenrollEnd
        });
      } else {
        yearResult = await SchoolEngine.createSchoolYear({
          name, start_date: startDate, end_date: endDate,
          enrollment_start: enrollStart, enrollment_end: enrollEnd,
          reenrollment_start: reenrollStart, reenrollment_end: reenrollEnd
        });
      }

      if (yearResult.error) throw new Error(yearResult.error.message || yearResult.error);

      const yearId = yearResult.data.id;

      // Si es edición, eliminar períodos antiguos
      if (this._selectedYear) {
        await supabase.rpc('delete_academic_periods_by_year', { p_school_year_id: yearId });
      }

      // Crear períodos
      for (const p of periods) {
        const { error: pErr } = await SchoolEngine.createPeriod({
          school_year_id: yearId,
          name: p.name,
          start_date: p.start_date,
          end_date: p.end_date,
          order_index: p.order_index,
          status: 'pending',
          is_active: false
        });
        if (pErr) throw new Error(pErr.message || pErr);
      }

      // Activar el primer período si es un año nuevo
      if (!this._selectedYear && periods.length > 0) {
        const firstPeriod = await supabase.rpc('get_first_academic_period', {
          p_school_year_id: yearId
        });

        if (firstPeriod.data?.found) {
          await SchoolEngine.activatePeriod(firstPeriod.data.id);
        }
      }

      // Si el año quedó en draft (sin ventanas de inscripción), forzar a active
      if (yearResult.data.status === 'draft') {
        await SchoolEngine.advanceState();
        const status = await supabase.rpc('get_school_year_status');
        if (!status.data?.has_active_year) {
          await SchoolEngine.updateSchoolYear(yearId, { status: 'active' });
        }
      }

      Helpers.toast(this._selectedYear ? 'Año escolar actualizado' : 'Año escolar creado exitosamente', 'success');
      this.closeWizard();
      await this.init();
      await SchoolEngine.refresh();

    } catch (err) {
      Helpers.toast('Error: ' + err.message, 'error');
    }
  },

  // ── Acciones ────────────────────────────────────────────────
  closeWizard() {
    const wizard = document.getElementById('schoolYearWizard');
    if (wizard) { wizard.innerHTML = ''; wizard.classList.add('hidden'); }
    this._selectedYear = null;
  },

  async advanceState() {
    const result = await SchoolEngine.advanceState();
    if (result.data?.success) {
      Helpers.toast(result.data.message || 'Estado avanzado', 'success');
      await this.init();
    } else if (result.data?.message) {
      Helpers.toast(result.data.message, 'info');
    }
  },

  async closePeriod(periodId) {
    const confirmed = await Helpers.confirm('¿Cerrar este período? Se abrirá automáticamente el siguiente.');
    if (!confirmed) return;

    const result = await SchoolEngine.closePeriod(periodId);
    if (result.data?.success) {
      Helpers.toast(result.data.message || 'Período cerrado', 'success');
      await this.init();
    } else {
      Helpers.toast(result.data?.error || 'Error al cerrar período', 'error');
    }
  },

  async closeYear(yearId) {
    const confirmed = await Helpers.confirm('¿Cerrar este año escolar? Todos los estudiantes pasarán a historial. Esta acción no se puede deshacer.');
    if (!confirmed) return;

    const result = await SchoolEngine.closeSchoolYear(yearId);
    if (result.data?.success) {
      Helpers.toast(result.data.message, 'success');
      await this.init();
    } else {
      Helpers.toast(result.data?.error || 'Error al cerrar año', 'error');
    }
  },

  async promoteStudents(yearId) {
    const confirmed = await Helpers.confirm('¿Promover estudiantes? Se evaluará asistencia y calificaciones de cada estudiante.');
    if (!confirmed) return;

    Helpers.toast('Promoviendo estudiantes...', 'info');
    const result = await SchoolEngine.promoteStudents(yearId);
    if (result.data?.success) {
      Helpers.toast(result.data.message, 'success');
      await this.init();
    } else {
      Helpers.toast(result.data?.error || 'Error al promover', 'error');
    }
  },

  viewYear(yearId) {
    const year = this._years.find(y => y.id === yearId);
    if (year) {
      this.openWizard(year);
    }
  },

  // ── Helpers ─────────────────────────────────────────────────
  _formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  },

  _getStatusLabel(status) {
    const labels = {
      'draft': 'Borrador',
      'enrollment': 'Inscripción',
      'reenrollment': 'Reinscripción',
      'active': 'Activo',
      'closed': 'Cerrado',
      'archived': 'Archivado'
    };
    return labels[status] || status;
  }
};

// Exponer globalmente
if (typeof window !== 'undefined') {
  window.App = window.App || {};
  window.App.schoolYear = SchoolYearModule;
}
