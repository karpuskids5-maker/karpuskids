import { supabase, createClient, SUPABASE_URL, SUPABASE_ANON_KEY, sendEmail } from './supabase.js';
import { Helpers } from './helpers.js';
import { auditLog } from './db-utils.js';

const TABS = [
  { id: 'info',     label: 'Info General', icon: 'user-square' },
  { id: 'family',   label: 'Familia',      icon: 'users' },
  { id: 'health',   label: 'Salud',        icon: 'heart-pulse' },
  { id: 'payments', label: 'Pagos',        icon: 'credit-card' },
  { id: 'docs',     label: 'Documentos',   icon: 'folder-open' },
  { id: 'access',   label: 'Accesos',      icon: 'key-round' },
  { id: 'history',  label: 'Historial',    icon: 'history' },
];

const DOC_TYPES = [
  { key: 'photo',         label: 'Foto del estudiante',       icon: 'camera',       required: true  },
  { key: 'acta',          label: 'Acta de nacimiento',        icon: 'file-text',    required: true  },
  { key: 'ced_front',     label: 'Cédula tutor 1 (frente)',   icon: 'credit-card',  required: true  },
  { key: 'ced_back',      label: 'Cédula tutor 1 (atrás)',    icon: 'credit-card',  required: false },
  { key: 'p1_ced_front',  label: 'Cédula tutor 2 (frente)',   icon: 'credit-card',  required: false },
  { key: 'p1_ced_back',   label: 'Cédula tutor 2 (atrás)',    icon: 'credit-card',  required: false },
  { key: 'p2_ced_front',  label: 'Cédula tutor 3 (frente)',   icon: 'credit-card',  required: false },
  { key: 'p2_ced_back',   label: 'Cédula tutor 3 (atrás)',    icon: 'credit-card',  required: false },
  { key: 'vaccine_card',  label: 'Cartilla de vacunas',       icon: 'syringe',      required: true  },
  { key: 'medical_report',label: 'Informe médico',            icon: 'stethoscope',  required: false },
  { key: 'contract',      label: 'Contrato escolar',          icon: 'file-check',   required: false },
];

const LEVELS_FALLBACK = ['Maternal', 'Infantes', 'Párvulos', 'Pre-Kinder', 'Kinder', 'Pre-Primaria', 'Primaria'];
const RELATIONSHIPS = ['Padre', 'Madre', 'Tutor Legal'];
const SCHEDULES = ['Medio día', 'Completo', 'Extendido'];
const CONSENT_DEFS = [
  { key: 'data_treatment', label: 'Autorizo el tratamiento de datos personales del menor según la política de privacidad.' },
  { key: 'correct_info',   label: 'Declaro que los datos suministrados en este formulario son verídicos y correctos.' },
  { key: 'contact',        label: 'Autorizo el envío de comunicaciones e información institucional por correo, SMS o WhatsApp.' },
  { key: 'regulations',    label: 'Acepto el reglamento interno y el código de convivencia del centro.' },
];

const INPUT = 'w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium';
const LABEL = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1';

const _setLoading = (v) => { try { window.App?.ui?.setLoading?.(v); } catch (_) {} };
const _closeModal = () => {
  try { window.App?.ui?.closeModal?.(); } catch (_) {}
  const c = document.getElementById('globalModalContainer');
  if (c) c.style.display = 'none';
};

export const StudentRecordModal = {
  _mode: 'edit',          // 'admit' | 'edit' | 'create'
  _prereg: null,
  _student: null,
  _parentId: null,
  _classrooms: [],
  _concepts: [],
  _schoolYears: [],
  _schoolYearOptions: [],
  _charges: [],
  _authPeople: [],
  _docs: {},
  _consents: {},
  _signature: '',
  _siblings: [],
  _history: [],
  _historyParts: {},
  _form: {},
  _tab: 'info',
  _saving: false,
  _onSaved: null,

  async open({ mode = null, prereg = null, studentId = null, onSaved = null } = {}) {
    this._onSaved = onSaved || null;
    let resolved = mode || (prereg ? 'admit' : studentId ? 'edit' : 'create');
    if (resolved === 'new') resolved = 'create';
    this._mode = resolved;
    this._prereg = prereg;
    this._student = null;
    this._parentId = null;
    this._parentPassword = null;
    this._charges = [];
    this._schoolYearOptions = [];
    this._authPeople = [];
    this._docs = {};
    this._consents = {};
    this._signature = '';
    this._siblings = [];
    this._history = [];
    this._historyParts = {};
    this._tab = 'info';
    this._saving = false;
    this._form = {};

    await this._loadBase();
    if (this._mode === 'edit') await this._loadStudent(studentId);
    else if (this._mode === 'admit') this._fromPrereg();
    else this._emptyForm();

    this._renderShell();
  },

  async _loadBase() {
    const [rooms, concepts, years] = await Promise.allSettled([
      supabase.rpc('get_classrooms_capacity'),
      supabase.from('payment_concepts').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('school_years').select('id, name').order('start_date', { ascending: false }).limit(3),
    ]);
    let roomsData = rooms.status === 'fulfilled' ? (rooms.value.data || []) : null;
    if (!roomsData) {
      const fb = await supabase.from('classrooms').select('id, name, level, capacity');
      roomsData = (fb.data || []).map(c => ({ ...c, occupied: 0, available: c.capacity }));
    }
    this._classrooms = roomsData || [];
    this._concepts = concepts.status === 'fulfilled' ? (concepts.value.data || []) : [];
    this._schoolYearOptions = years.status === 'fulfilled' ? (years.value.data || []) : [];
    this._schoolYears = this._schoolYearOptions.map(y => y.name);
    if (!this._schoolYears.length) {
      const y = new Date().getFullYear();
      for (let i = 0; i < 3; i++) this._schoolYears.push((y + i) + '-' + (y + i + 1));
    }
  },

  _emptyForm() {
    this._form = {
      name: '', last_name: '', matricula: '', birth_date: '', age: '', age_type: 'años',
      gender: '', nationality: 'Dominicana', birthplace: '', address: '', province: '',
      municipality: '', sector: '',
      school_year_requested: this._schoolYears[0] || '',
      level_requested: '', schedule: 'Medio día',
      start_date: new Date().toISOString().split('T')[0],
      has_siblings: false, sibling_name: '',
      classroom_id: '', is_active: true,
      login_email: '',
      blood_type: '', allergies: '', insurance: '', pediatrician: '', pediatrician_phone: '',
      medical_conditions: '', medications: '', food_restrictions: '', disabilities: '',
      medical_notes: '', vaccinations_complete: false, emergency_protocol: '',
      p1_name: '', p1_relationship: '', p1_cedula: '', p1_phone: '', p1_whatsapp: '',
      p1_email: '', p1_address: '', p1_occupation: '', p1_job: '', p1_workplace: '',
      p1_emergency_contact: '',
      p2_name: '', p2_relationship: '', p2_cedula: '', p2_phone: '', p2_whatsapp: '',
      p2_email: '', p2_address: '', p2_occupation: '', p2_job: '', p2_workplace: '',
      emg_name: '', emg_relationship: '', emg_cedula: '', emg_phone: '', emg_observations: '',
      payment_plan: 'mensual', monthly_fee: '', prolongado_fee: '', inscription_fee: '',
      discount_pct: 0, due_day: 5, avatar_url: '',
    };
    this._consents = { data_treatment: false, correct_info: false, contact: false, regulations: false };
    this._signature = '';
    this._autofillConcepts();
  },

  async _loadStudent(id) {
    const { data: student, error } = await supabase
      .from('students')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !student) {
      Helpers.toast('No se pudo cargar el estudiante', 'error');
      return;
    }
    this._student = student;
    this._parentId = student.parent_id || null;
    if (this._parentId && !student.login_email) {
      const { data: prof } = await supabase.from('profiles').select('email').eq('id', this._parentId).maybeSingle();
      if (prof?.email) student.login_email = prof.email;
    }
    this._docs = student.documents || {};
    this._consents = student.consents || {};
    this._signature = student.signature_data || '';
    this._authPeople = Array.isArray(student.authorized_people) ? student.authorized_people : [];
    this._form = {
      name: student.name || '', last_name: student.last_name || '',
      matricula: student.matricula || '', birth_date: student.birth_date || '',
      age: student.age || '', age_type: student.age_type || 'años',
      gender: student.gender || '', nationality: student.nationality || 'Dominicana',
      birthplace: student.birthplace || '', address: student.address || '',
      province: student.province || '', municipality: student.municipality || '',
      sector: student.sector || '',
      school_year_requested: student.school_year_requested || this._schoolYears[0] || '',
      level_requested: student.level_requested || '',
      schedule: student.schedule || 'Medio día',
      start_date: student.start_date || student.estimated_entry_date || new Date().toISOString().split('T')[0],
      has_siblings: !!student.has_siblings, sibling_name: student.sibling_name || '',
      classroom_id: student.classroom_id ? String(student.classroom_id) : '',
      is_active: student.is_active !== false,
      login_email: student.login_email || '',
      blood_type: student.blood_type || '', allergies: student.allergies || '',
      insurance: student.insurance || '', pediatrician: student.pediatrician || '',
      pediatrician_phone: student.pediatrician_phone || '',
      medical_conditions: student.medical_conditions || '', medications: student.medications || '',
      food_restrictions: student.food_restrictions || '', disabilities: student.disabilities || '',
      medical_notes: student.medical_notes || '',
      vaccinations_complete: !!student.vaccinations_complete,
      emergency_protocol: student.emergency_protocol || '',
      p1_name: student.p1_name || '', p1_relationship: student.p1_relationship || '',
      p1_cedula: student.p1_cedula || '', p1_phone: student.p1_phone || '',
      p1_whatsapp: student.p1_whatsapp || '', p1_email: student.p1_email || '',
      p1_address: student.p1_address || '', p1_occupation: student.p1_occupation || '',
      p1_job: student.p1_job || '', p1_workplace: student.p1_workplace || '',
      p1_emergency_contact: student.p1_emergency_contact || '',
      p2_name: student.p2_name || '', p2_relationship: student.p2_relationship || '',
      p2_cedula: student.p2_cedula || '', p2_phone: student.p2_phone || '',
      p2_whatsapp: student.p2_whatsapp || '', p2_email: student.p2_email || '',
      p2_address: student.p2_address || '', p2_occupation: student.p2_occupation || '',
      p2_job: student.p2_job || '', p2_workplace: student.p2_workplace || '',
      emg_name: student.emg_name || '', emg_relationship: student.emg_relationship || '',
      emg_cedula: student.emg_cedula || '', emg_phone: student.emg_phone || '',
      emg_observations: student.emergency_protocol || '',
      payment_plan: student.payment_plan || 'mensual',
      monthly_fee: student.monthly_fee || '', prolongado_fee: student.prolongado_fee || '',
      inscription_fee: student.inscription_fee || '', discount_pct: student.discount_pct || 0,
      due_day: student.due_day || 5,
      avatar_url: student.avatar_url || '',
    };

    const charges = await supabase
      .from('student_charges')
      .select('*')
      .eq('student_id', id)
      .order('due_date', { ascending: false })
      .limit(100);
    this._charges = charges.data || [];

    await this._loadSiblings();
    await this._loadHistory();
  },

  _fromPrereg() {
    const p = this._prereg || {};
    const p1 = p.parent_1 || {};
    const p2 = p.parent_2 || {};
    const emg = p.emergency_contact || {};
    const med = p.medical || {};
    this._docs = p.documents || {};
    this._consents = p.consents || {};
    this._signature = p.signature_data || '';
    this._authPeople = Array.isArray(p.authorized_people) ? p.authorized_people : [];
    this._form = {
      name: p.student_name || '', last_name: p.student_last_name || '',
      matricula: '', birth_date: p.birth_date || '', age: '', age_type: 'años',
      gender: p.gender || '', nationality: p.nationality || 'Dominicana',
      birthplace: '', address: p1.address || '', province: '', municipality: '', sector: '',
      school_year_requested: p.school_year_requested || this._schoolYears[0] || '',
      level_requested: p.level_requested || '', schedule: p.schedule || 'Medio día',
      start_date: p.estimated_entry_date || new Date().toISOString().split('T')[0],
      has_siblings: !!p.has_siblings, sibling_name: p.sibling_name || '',
      classroom_id: '', is_active: true,
      login_email: '',
      blood_type: med.blood_type || '', allergies: med.allergies || '',
      insurance: '', pediatrician: '', pediatrician_phone: '',
      medical_conditions: med.medical_conditions || '', medications: med.medications || '',
      food_restrictions: med.food_restrictions || '', disabilities: '',
      medical_notes: med.medical_notes || '', vaccinations_complete: false,
      emergency_protocol: emg.observations || '',
      p1_name: p1.name || '', p1_relationship: p1.relationship || '',
      p1_cedula: p1.cedula || '', p1_phone: p1.phone || '',
      p1_whatsapp: p1.whatsapp || '', p1_email: p1.email || '',
      p1_address: p1.address || '', p1_occupation: p1.occupation || '',
      p1_job: p1.profession || '', p1_workplace: p1.workplace || '',
      p1_emergency_contact: '',
      p2_name: p2.name || '', p2_relationship: p2.relationship || '',
      p2_cedula: p2.cedula || '', p2_phone: p2.phone || '',
      p2_whatsapp: p2.whatsapp || '', p2_email: p2.email || '',
      p2_address: p2.address || '', p2_occupation: p2.occupation || '',
      p2_job: p2.profession || '', p2_workplace: p2.workplace || '',
      emg_name: emg.name || '', emg_relationship: emg.relationship || '',
      emg_cedula: emg.cedula || '', emg_phone: emg.phone || '',
      emg_observations: emg.observations || '',
      payment_plan: 'mensual', monthly_fee: '', prolongado_fee: '',
      inscription_fee: '', discount_pct: 0, due_day: 5,
      avatar_url: '',
    };
    if (p.birth_date) {
      const b = new Date(p.birth_date);
      const n = new Date();
      if (!isNaN(b.getTime())) {
        let months = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
        if (n.getDate() < b.getDate()) months--;
        if (months < 0) months = 0;
        const showMonths = months < 24;
        this._form.age = String(showMonths ? months : Math.floor(months / 12));
        this._form.age_type = showMonths ? 'meses' : 'años';
      }
    }
    this._autofillConcepts();
  },

  _autofillConcepts() {
    const pick = (t) => this._concepts.find(c => c.type === t)?.default_amount;
    if (!this._form.monthly_fee && pick('mensualidad') != null) this._form.monthly_fee = pick('mensualidad');
    if (!this._form.prolongado_fee && pick('prolongado') != null) this._form.prolongado_fee = pick('prolongado');
    if (!this._form.inscription_fee && pick('inscripcion') != null) this._form.inscription_fee = pick('inscripcion');
  },

  async _loadSiblings() {
    if (!this._form?.has_siblings || !this._parentId) {
      this._siblings = [];
      return;
    }
    const { data } = await supabase
      .from('students')
      .select('id, name, matricula, classroom_id, classrooms:classroom_id(name), is_active')
      .eq('parent_id', this._parentId)
      .is('deleted_at', null);
    this._siblings = (data || []).filter(s => s.id !== this._student?.id);
  },

  async _loadHistory() {
    if (this._mode !== 'edit') {
      this._historyParts = { enrollments: [], reports: [], payments: [] };
      if (this._prereg) {
        this._history = [{ type: 'prereg', title: 'Preinscripción recibida', at: this._prereg.created_at, detail: 'Formulario público completado por los padres.' }];
      }
      return;
    }
    const studentId = this._student?.id;
    if (!studentId) return;
    const [logs, prereg, enrollments, reports, payments] = await Promise.allSettled([
      supabase.from('audit_logs')
        .select('action, payload, created_at')
        .ilike('action', 'student.%')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('student_preregistrations')
        .select('status, created_at, review_notes, reviewed_at')
        .eq('converted_student_id', studentId)
        .maybeSingle(),
      supabase.from('enrollments')
        .select('id, type, status, classroom_id, parent_id, student_name, enrolled_at, created_at, approved_by, notes, school_years:school_year_id(name), classrooms:classroom_id(name, level)')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false }),
      supabase.rpc('get_student_history', { p_student_id: studentId }),
      supabase.from('payments')
        .select('id, concept, amount, status, due_date, paid_date, month_paid')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    const filtered = (logs.status === 'fulfilled' ? (logs.value.data || []) : [])
      .filter(l => l.payload && (String(l.payload.student_id) === String(studentId)))
      .map(l => ({ type: 'log', action: l.action, at: l.created_at, detail: JSON.stringify(l.payload) }));
    this._history = filtered;
    if (prereg.status === 'fulfilled' && prereg.value.data) {
      this._history.unshift({ type: 'prereg', title: 'Preinscripción', at: prereg.value.data.created_at, detail: 'Estado: ' + (prereg.value.data.status || '') });
    }
    this._historyParts = {
      enrollments: enrollments.status === 'fulfilled' ? (enrollments.value.data || []) : [],
      reports: reports.status === 'fulfilled' && reports.value.data ? reports.value.data : [],
      payments: payments.status === 'fulfilled' ? (payments.value.data || []) : [],
    };
  },

  // ---------------------------------------------------------------- SHELL
  _renderShell() {
    const titles = { admit: 'Admisión de Preinscripción', edit: 'Expediente Digital Escolar', create: 'Nuevo Estudiante' };
    const title = titles[this._mode] || titles.create;
    const fullName = ((this._form.name || '') + ' ' + (this._form.last_name || '')).trim();
    const subtitle = this._mode === 'admit'
      ? (fullName || 'Sin nombre') + (this._prereg?.id ? ' · Preinscripción #' + this._prereg.id : '')
      : (fullName || (this._form.matricula ? 'Matrícula ' + this._form.matricula : 'Nuevo registro'));
    const bannerColor = 'from-purple-600 to-indigo-600';
    const modeIcon = this._mode === 'admit' ? 'graduation-cap' : this._mode === 'create' ? 'user-plus' : 'folder-open';
    const statusChip = this._mode === 'admit'
      ? { label: 'Pendiente de admisión', icon: 'clock', cls: 'bg-white/20 text-white' }
      : this._mode === 'create'
        ? { label: 'Alta manual', icon: 'sparkles', cls: 'bg-white/20 text-white' }
        : { label: this._form.is_active ? 'Activo' : 'Inactivo', icon: this._form.is_active ? 'check-circle-2' : 'x-circle', cls: this._form.is_active ? 'bg-emerald-500/20 text-emerald-50' : 'bg-white/20 text-white' };

    const html = `
      <div class="modal-header bg-gradient-to-r ${bannerColor} text-white p-5 rounded-t-3xl relative overflow-hidden">
        <div class="absolute -right-10 -top-12 w-44 h-44 rounded-full bg-white/10 blur-md"></div>
        <div class="absolute -left-8 -bottom-16 w-36 h-36 rounded-full bg-white/5"></div>
        <div class="relative flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center shadow-inner overflow-hidden shrink-0">
            ${this._form.avatar_url
              ? `<img src="${Helpers.escapeHTML(this._form.avatar_url)}" class="w-full h-full object-cover">`
              : `<i data-lucide="${modeIcon}" class="w-5 h-5 text-white"></i>`}
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="text-lg font-black truncate leading-tight">${Helpers.escapeHTML(title)}</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest truncate">${Helpers.escapeHTML(subtitle)}</p>
          </div>
          <div class="hidden md:flex flex-col items-end gap-1.5 shrink-0 pr-11">
            <span class="px-3 py-1 ${statusChip.cls} rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
              <i data-lucide="${statusChip.icon}" class="w-3 h-3"></i>${statusChip.label}
            </span>
            <span id="srm-tab-label" class="px-3 py-1 bg-white/20 text-white/80 rounded-full text-[10px] font-black uppercase tracking-widest">${Helpers.escapeHTML(TABS.find(t => t.id === this._tab)?.label || '')}</span>
          </div>
        </div>
      </div>

      <div class="px-4 py-2.5 bg-slate-100 border-b border-slate-200 sticky top-0 z-10">
        <div class="flex gap-1.5 overflow-x-auto">
          ${TABS.map(t => `
            <button data-tab="${t.id}"
              class="srm-tab flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all whitespace-nowrap shrink-0
                ${this._tab === t.id ? 'bg-white text-purple-600 shadow-sm border border-indigo-100' : 'text-slate-400 hover:text-slate-600 hover:bg-white'}">
              <i data-lucide="${t.icon}" class="w-3.5 h-3.5"></i>${t.label}
            </button>`).join('')}
        </div>
      </div>

      <div id="srm-tab-content" class="p-5 md:p-6 bg-slate-50/50">
        <div class="flex items-center justify-center py-16 text-slate-400">
          <div class="w-8 h-8 border-4 border-slate-200 border-t-purple-500 rounded-full animate-spin"></div>
        </div>
      </div>

      <div class="modal-footer bg-white p-5 rounded-b-3xl border-t border-slate-200 flex justify-between gap-3 flex-wrap items-center">
        <div class="hidden sm:flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
          <i data-lucide="shield-check" class="w-3.5 h-3.5 text-emerald-500"></i>
          Expediente Digital Escolar
        </div>
        <div class="flex justify-end gap-2 ml-auto">
          ${this._mode === 'admit'
            ? `<button id="srm-reject" class="px-5 py-2.5 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-2xl font-black text-xs uppercase transition-all">Rechazar</button>
               <button id="srm-approve" class="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-purple-200 hover:-translate-y-0.5 transition-all active:scale-95">Aprobar Admisión</button>`
            : this._mode === 'create'
              ? `<button id="srm-create" class="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-purple-200 hover:-translate-y-0.5 transition-all active:scale-95">Crear Estudiante</button>`
              : `<button id="srm-save" class="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-purple-200 hover:-translate-y-0.5 transition-all active:scale-95">Guardar cambios</button>`}
        </div>
      </div>`;

    window.openGlobalModal(html, true);
    this._sizeModal();
    this._wireTabs();
    this._activateTab(this._tab);

    document.getElementById('srm-approve')?.addEventListener('click', () => this._approveAdmission());
    document.getElementById('srm-create')?.addEventListener('click', () => this._createStudent());
    document.getElementById('srm-save')?.addEventListener('click', () => this._saveChanges());
    document.getElementById('srm-reject')?.addEventListener('click', () => this._rejectPrereg());
  },

  _sizeModal() {
    const container = document.getElementById('globalModalContainer');
    if (container) {
      container.style.alignItems = 'center';
      container.style.paddingTop = '0';
    }
    const inner = document.getElementById('globalModalInner');
    if (!inner) return;
    inner.style.width = 'min(94vw, 920px)';
    inner.style.maxWidth = '920px';
    inner.style.maxHeight = '90vh';
    inner.style.margin = 'auto';
  },

  _wireTabs() {
    document.querySelectorAll('.srm-tab').forEach(btn => {
      btn.onclick = () => this._activateTab(btn.dataset.tab);
    });
  },

  _activateTab(id) {
    this._saveForm();
    this._tab = id;
    document.querySelectorAll('.srm-tab').forEach(btn => {
      const active = btn.dataset.tab === id;
      btn.className = 'srm-tab flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all whitespace-nowrap shrink-0 ' +
        (active ? 'bg-white text-purple-600 shadow-sm border border-indigo-100' : 'text-slate-400 hover:text-slate-600 hover:bg-white');
    });
    const label = document.getElementById('srm-tab-label');
    if (label) label.textContent = TABS.find(t => t.id === id)?.label || '';

    const content = document.getElementById('srm-tab-content');
    if (!content) return;
    const renderers = {
      info: this._renderAlumno.bind(this),
      family: this._renderFamily.bind(this),
      health: this._renderSalud.bind(this),
      payments: this._renderPago.bind(this),
      docs: this._renderDocs.bind(this),
      access: this._renderAcceso.bind(this),
      history: this._renderHistory.bind(this),
    };
    content.innerHTML = (renderers[id] || this._renderAlumno).call(this);
    if (window.lucide) lucide.createIcons();
    this._wireTab(id);
  },

  _wireTab(id) {
    const map = {
      info: this._wireAlumno.bind(this),
      family: this._wireFamily.bind(this),
      health: this._wireSalud.bind(this),
      payments: this._wirePago.bind(this),
      docs: this._wireDocs.bind(this),
      access: this._wireAcceso.bind(this),
      history: this._wireHistory.bind(this),
    };
    (map[id] || (() => {}))();
  },

  // ---------------------------------------------------------------- FORM I/O
  _saveForm() {
    const f = this._form;
    document.querySelectorAll('#srm-tab-content [data-f]').forEach(el => {
      const key = el.dataset.f;
      if (el.type === 'checkbox') f[key] = el.checked;
      else if (el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') f[key] = el.value;
    });
    document.querySelectorAll('#srm-tab-content [data-consent]').forEach(cb => {
      this._consents[cb.dataset.consent] = cb.checked;
    });
  },

  _num(key, def = 0) {
    const val = parseFloat(this._form[key]);
    return isNaN(val) ? def : val;
  },

  _fmt(v) {
    return Helpers.formatCurrency(v);
  },

  _sectionHeader(icon, title, chip = 'bg-gradient-to-br from-purple-500 to-indigo-600') {
    return `
      <h4 class="flex items-center gap-2.5 text-[11px] font-black text-slate-800 uppercase tracking-wider mb-4">
        <span class="w-8 h-8 rounded-xl ${chip} text-white flex items-center justify-center shadow-sm"><i data-lucide="${icon}" class="w-4 h-4"></i></span>
        <span>${title}</span>
      </h4>`;
  },

  _genPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let p = '';
    const arr = new Uint32Array(10);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 0xffffffff);
    }
    for (let i = 0; i < 10; i++) p += chars[arr[i] % chars.length];
    return p;
  },

  _sendCredentialsEmail(to, password) {
    const studentName = this._form.name || 'tu hijo(a)';
    const parentName = this._form.p1_name || '';
    const subject = 'Acceso al Portal de Padres — Karpus Kids';
    const html =
      '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">' +
        '<div style="background:#4f46e5;padding:24px 28px;border-radius:16px 16px 0 0">' +
          '<h1 style="color:#fff;margin:0;font-size:20px">Bienvenido(a) al Portal de Padres</h1>' +
        '</div>' +
        '<div style="border:1px solid #e2e8f0;border-top:none;padding:24px 28px;border-radius:0 0 16px 16px">' +
          '<p>Hola ' + Helpers.escapeHTML(parentName) + ',</p>' +
          '<p>La cuenta de acceso del estudiante <strong>' + Helpers.escapeHTML(studentName) + '</strong> está lista.</p>' +
          '<p>Con ella podrás consultar pagos, reinscripción y las actividades de tu hijo(a) en el centro.</p>' +
          '<table style="width:100%;margin:16px 0;border-collapse:collapse">' +
            '<tr><td style="padding:8px;color:#64748b;font-size:13px">Acceso:</td><td style="padding:8px;font-weight:bold">' + Helpers.escapeHTML(this._form.login_email || to || '') + '</td></tr>' +
            '<tr><td style="padding:8px;color:#64748b;font-size:13px">Contraseña temporal:</td><td style="padding:8px;font-weight:bold">' + Helpers.escapeHTML(password || '') + '</td></tr>' +
            '<tr><td style="padding:8px;color:#64748b;font-size:13px">Enlace:</td><td style="padding:8px;font-weight:bold">' + Helpers.escapeHTML(window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'login.html') + '</td></tr>' +
          '</table>' +
          '<p style="font-size:13px;color:#64748b">Te recomendamos cambiar la contraseña en tu primer acceso. No compartas estas credenciales.</p>' +
          '<p style="font-size:13px;color:#64748b">Saludos,<br>Equipo Karpus Kids</p>' +
        '</div>' +
      '</div>';
    return sendEmail(to, subject, html, 'Accede con tu correo y la contraseña temporal: ' + (password || ''));
  },

  _authedField(key, label, placeholder, opts = {}) {
    const val = this._form[key] ?? '';
    return `
      <div class="${opts.col || ''}">
        <label class="${LABEL}">${label}</label>
        ${opts.textarea
          ? `<textarea data-f="${key}" rows="${opts.rows || 2}" placeholder="${placeholder || ''}" class="${INPUT} resize-none">${Helpers.escapeHTML(String(val))}</textarea>`
          : `<input data-f="${key}" type="${opts.type || 'text'}" placeholder="${placeholder || ''}" value="${Helpers.escapeHTML(String(val))}" class="${INPUT}">`}
      </div>`;
  },

  _classroomOptions() {
    if (!this._classrooms.length) {
      return '<option value="">-- Sin aulas registradas --</option>';
    }
    return this._classrooms.map(c => {
      const full = c.available <= 0;
      const label = `${c.name} — ${c.occupied}/${c.capacity} cupos${c.level ? ' · ' + c.level : ''}${full ? ' (LLENO)' : ''}`;
      return `<option value="${c.id}" ${String(this._form.classroom_id) === String(c.id) ? 'selected' : ''} ${full ? 'disabled' : ''}>${Helpers.escapeHTML(label)}</option>`;
    }).join('');
  },

  _levelOptions() {
    const fromRooms = this._classrooms.map(c => c.level).filter(Boolean);
    const levels = [...new Set([...fromRooms, ...LEVELS_FALLBACK])];
    return levels.map(l => `<option value="${Helpers.escapeHTML(l)}" ${this._form.level_requested === l ? 'selected' : ''}>${Helpers.escapeHTML(l)}</option>`).join('');
  },

  _yearOptions() {
    return this._schoolYears.map(y => `<option value="${Helpers.escapeHTML(y)}" ${this._form.school_year_requested === y ? 'selected' : ''}>${Helpers.escapeHTML(y)}</option>`).join('');
  },

  // ---------------------------------------------------------------- INFO GENERAL (Pestaña 1)
  _renderAlumno() {
    const f = this._form;
    return `
      <div class="grid grid-cols-1 gap-4">
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          ${this._sectionHeader('user', 'Datos del alumno')}
          <div class="flex flex-col md:flex-row gap-5">
            <div class="relative group cursor-pointer shrink-0">
              <div id="srm-avatar" class="w-20 h-20 rounded-2xl bg-slate-100 border-4 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 group-hover:border-purple-400 group-hover:bg-purple-50 transition-all overflow-hidden">
                ${f.avatar_url ? `<img src="${Helpers.escapeHTML(f.avatar_url)}" class="w-full h-full object-cover">` : '<i data-lucide="camera" class="w-5 h-5"></i>'}
              </div>
              <input type="file" id="srm-avatar-file" class="absolute inset-0 opacity-0 cursor-pointer" accept="image/*">
            </div>
            <div class="flex-1 grid grid-cols-1 gap-3">
              <div>
                <label class="${LABEL}">Matrícula</label>
                <div class="flex gap-2">
                  <input data-f="matricula" placeholder="Generar automática..." value="${Helpers.escapeHTML(String(f.matricula || ''))}" class="${INPUT} flex-1">
                  <button id="srm-gen-matricula" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-sm transition-all active:scale-95 shrink-0">Generar</button>
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label class="${LABEL}">Nombres *</label><input data-f="name" placeholder="Ej: Juan Carlos" value="${Helpers.escapeHTML(String(f.name || ''))}" class="${INPUT}"></div>
                <div><label class="${LABEL}">Apellidos</label><input data-f="last_name" placeholder="Ej: Pérez Gómez" value="${Helpers.escapeHTML(String(f.last_name || ''))}" class="${INPUT}"></div>
                <div><label class="${LABEL}">Fecha de nacimiento</label><input data-f="birth_date" type="date" value="${f.birth_date || ''}" class="${INPUT}"></div>
                <div>
                  <label class="${LABEL}">Edad</label>
                  <div class="flex gap-2">
                    <input data-f="age" id="srm-age" placeholder="Auto" value="${Helpers.escapeHTML(String(f.age || ''))}" class="${INPUT} flex-1">
                    <select data-f="age_type" class="w-24 px-2 py-2.5 border-2 border-slate-100 rounded-2xl text-sm font-black bg-slate-50/50">
                      <option value="años" ${f.age_type === 'años' ? 'selected' : ''}>Años</option>
                      <option value="meses" ${f.age_type === 'meses' ? 'selected' : ''}>Meses</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div>
              <label class="${LABEL}">Sexo</label>
              <select data-f="gender" class="${INPUT}">
                <option value="">--</option>
                <option value="Masculino" ${f.gender === 'Masculino' ? 'selected' : ''}>Masculino</option>
                <option value="Femenino" ${f.gender === 'Femenino' ? 'selected' : ''}>Femenino</option>
              </select>
            </div>
            ${this._authedField('nationality', 'Nacionalidad', 'Dominicana')}
            <div>
              <label class="${LABEL}">Año escolar solicitado</label>
              <select data-f="school_year_requested" class="${INPUT}">${this._yearOptions()}</select>
            </div>
            <div>
              <label class="${LABEL}">Nivel solicitado</label>
              <select data-f="level_requested" class="${INPUT}">${this._levelOptions()}</select>
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div>
              <label class="${LABEL}">Horario solicitado</label>
              <select data-f="schedule" class="${INPUT}">
                ${SCHEDULES.map(s => `<option value="${s}" ${f.schedule === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            ${this._authedField('start_date', 'Fecha estimada de ingreso', '', { type: 'date' })}
            ${this._authedField('sector', 'Sector', '')}
          </div>
          <label class="flex items-center gap-2 cursor-pointer mt-4 bg-amber-50 border border-amber-100 rounded-2xl p-3">
            <input type="checkbox" data-f="has_siblings" ${f.has_siblings ? 'checked' : ''} class="w-5 h-5 rounded text-amber-600">
            <span class="text-sm font-black text-amber-700 uppercase">¿Tiene hermano(s) en el centro?</span>
          </label>
          <div id="srm-sibling-wrap" class="mt-3 ${f.has_siblings ? '' : 'hidden'}">
            ${this._authedField('sibling_name', 'Nombre(s) del hermano', 'Nombre del hermano inscrito')}
          </div>
        </div>

        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          ${this._sectionHeader('school', 'Asignación de aula')}
          ${f.discount_pct ? `<div class="mb-3 flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-2xl p-3 text-emerald-700 font-black text-xs"><i data-lucide="badge-percent" class="w-4 h-4"></i> Descuento por hermano aplicado: ${f.discount_pct}%</div>` : ''}
          <div>
            <label class="${LABEL}">Aula *</label>
            <select data-f="classroom_id" class="${INPUT}">${this._classroomOptions()}</select>
            <p class="text-[10px] text-slate-400 font-bold mt-1 ml-1">Los cupos llenos aparecen deshabilitados.</p>
          </div>
        </div>

        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          ${this._sectionHeader('qr-code', 'QR de asistencia y carnet', 'bg-gradient-to-br from-orange-500 to-amber-500')}
          <div id="srm-qr" class="bg-slate-50 rounded-2xl border border-slate-100 p-4 min-h-[130px] flex items-center justify-center">
            <p class="text-[11px] text-slate-400 font-bold">${f.matricula ? 'Generando…' : 'Ingresa una matrícula arriba para ver el QR'}</p>
          </div>
          <div class="flex gap-2 mt-3">
            <button id="srm-qr-gen" class="flex-1 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Generar QR
            </button>
            <button id="srm-carnet" class="flex-1 px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2">
              <i data-lucide="printer" class="w-3.5 h-3.5"></i> Imprimir carnet
            </button>
          </div>
        </div>
      </div>`;
  },

  _wireAlumno() {
    const file = document.getElementById('srm-avatar-file');
    const preview = document.getElementById('srm-avatar');
    if (file && preview) {
      file.onchange = async (e) => {
        const f0 = e.target.files[0];
        if (!f0) return;
        try {
          const compressed = await this._compress(f0, 600);
          preview.innerHTML = '<img src="' + compressed.dataUrl + '" class="w-full h-full object-cover">';
          const url = await this._upload(compressed.blob, 'avatar-' + Date.now() + '.jpg');
          if (url) {
            this._form.avatar_url = url;
            this._docs.photo = url;
          }
        } catch (err) {
          Helpers.toast('Error al subir la foto: ' + (err.message || err), 'error');
        }
      };
    }
    const birth = document.querySelector('[data-f="birth_date"]');
    if (birth) {
      birth.onchange = () => {
        const val = birth.value;
        if (!val) return;
        const ageEl = document.getElementById('srm-age');
        if (ageEl) {
          const b = new Date(val);
          const n = new Date();
          if (isNaN(b.getTime())) return;
          let months = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
          if (n.getDate() < b.getDate()) months--;
          if (months < 0) months = 0;
          const showMonths = months < 24;
          ageEl.value = String(showMonths ? months : Math.floor(months / 12));
          const typeEl = document.querySelector('[data-f="age_type"]');
          if (typeEl) typeEl.value = showMonths ? 'meses' : 'años';
        }
      };
    }
    const genMat = document.getElementById('srm-gen-matricula');
    if (genMat) {
      genMat.onclick = () => {
        const el = document.querySelector('[data-f="matricula"]');
        if (!el) return;
        el.value = 'KK-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random() * 9000) + 1000);
        this._form.matricula = el.value;
        Helpers.toast('Matrícula generada', 'success');
      };
    }
    const sib = document.querySelector('[data-f="has_siblings"]');
    if (sib) {
      sib.onchange = () => {
        this._form.has_siblings = sib.checked;
        document.getElementById('srm-sibling-wrap')?.classList.toggle('hidden', !sib.checked);
        this._loadSiblings();
      };
    }
    document.getElementById('srm-qr-gen')?.addEventListener('click', () => this._generateQR());
    document.getElementById('srm-carnet')?.addEventListener('click', () => this._printCarnet());
    this._loadQRLib(() => {});
    if (this._form.matricula) setTimeout(() => this._generateQR(), 300);
  },

  // ---------------------------------------------------------------- FAMILIA (Tutores y núcleo familiar)
  _renderFamily() {
    const esc = Helpers.escapeHTML;
    const f = this._form;
    const p1Fields = [
      ['p1_name', 'Nombre completo *', ''],
      ['p1_relationship', 'Parentesco', ''], ['p1_cedula', 'Cédula', '000-0000000-0'],
      ['p1_phone', 'Teléfono', '809-000-0000'], ['p1_whatsapp', 'WhatsApp', ''],
      ['p1_email', 'Correo (notificación)', 'correo@ejemplo.com'], ['p1_address', 'Dirección', ''],
      ['p1_occupation', 'Ocupación', ''], ['p1_job', 'Profesión', ''],
      ['p1_workplace', 'Lugar de trabajo', ''], ['p1_emergency_contact', 'Contacto de emergencia (extra)', ''],
    ];
    const p2Fields = [
      ['p2_name', 'Nombre', ''], ['p2_relationship', 'Parentesco', ''], ['p2_cedula', 'Cédula', ''],
      ['p2_phone', 'Teléfono', ''], ['p2_whatsapp', 'WhatsApp', ''], ['p2_email', 'Correo (notificación)', ''],
      ['p2_address', 'Dirección', ''], ['p2_occupation', 'Ocupación', ''], ['p2_job', 'Profesión', ''],
      ['p2_workplace', 'Lugar de trabajo', ''],
    ];
    const pRow = (list) => list.map(([k, l, ph]) => `
      <div class="${k === 'p1_address' || k === 'p1_emergency_contact' || k === 'p2_address' ? 'md:col-span-2' : ''}">
        <label class="${LABEL}">${l}</label>
        <input data-f="${k}" placeholder="${ph}" value="${esc(this._form[k] || '')}" class="${INPUT}">
      </div>`).join('');
    return `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div class="space-y-4">
          <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
            ${this._sectionHeader('user', 'Tutor principal', 'bg-gradient-to-br from-blue-500 to-indigo-600')}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${pRow(p1Fields)}</div>
          </div>
          <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
            ${this._sectionHeader('user-plus', 'Tutor secundario', 'bg-indigo-500')}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${pRow(p2Fields)}</div>
          </div>
        </div>

        <div class="space-y-4">
          <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
            ${this._sectionHeader('phone-call', 'Contacto de emergencia', 'bg-gradient-to-br from-rose-500 to-red-500')}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              ${this._authedField('emg_name', 'Nombre', 'Persona de contacto')}
              <div>
                <label class="${LABEL}">Parentesco</label>
                <select data-f="emg_relationship" class="${INPUT}">
                  <option value="">--</option>
                  ${RELATIONSHIPS.map(r => `<option value="${r}" ${f.emg_relationship === r ? 'selected' : ''}>${r}</option>`).join('')}
                  <option value="Otro" ${f.emg_relationship === 'Otro' ? 'selected' : ''}>Otro</option>
                </select>
              </div>
              ${this._authedField('emg_cedula', 'Cédula', '')}
              ${this._authedField('emg_phone', 'Teléfono', '809-000-0000')}
              ${this._authedField('emg_observations', 'Instrucciones / observaciones', 'Ej: alergias, condiciones, indicaciones', { col: 'md:col-span-2', textarea: true, rows: 2 })}
            </div>
          </div>

          <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
            ${this._sectionHeader('shield-check', 'Personas autorizadas para retiro', 'bg-gradient-to-br from-amber-400 to-orange-500')}
            <div id="srm-auth-list" class="space-y-2">
              ${this._authPeople.length ? this._authPeople.map((a, i) => this._authRow(a, i)).join('') : '<p class="text-xs text-slate-400 font-bold">Nadie autorizado aún.</p>'}
            </div>
            <button id="srm-auth-add" class="mt-3 px-4 py-2 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">+ Añadir autorizado</button>
          </div>

          <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
            ${this._sectionHeader('users', 'Hermanos en el centro', 'bg-gradient-to-br from-emerald-500 to-teal-500')}
            ${this._siblings.length
              ? `<div class="flex flex-wrap gap-2">${this._siblings.map(s => `
                  <span class="px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-xl text-xs font-black text-emerald-700 flex items-center gap-2">
                    <i data-lucide="user" class="w-3 h-3"></i>${Helpers.escapeHTML(s.name)} <span class="text-emerald-400">·</span> ${Helpers.escapeHTML(s.classrooms?.name || 'sin aula')}
                  </span>`).join('')}</div>
                 <p class="text-[11px] text-emerald-700 font-black mt-3">Se aplicará descuento de 10% por hermano (ver pestaña Pagos).</p>`
              : '<p class="text-xs text-slate-400 font-bold">Sin hermanos detectados para este núcleo familiar.</p>'}
          </div>
        </div>
      </div>`;
  },

  _wireFamily() {
    const add = document.getElementById('srm-auth-add');
    if (add) {
      add.onclick = () => {
        this._authPeople.push({ name: '', relationship: '', phone: '' });
        this._renderAuthList();
      };
    }
    document.getElementById('srm-auth-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-del]');
      if (!btn) return;
      this._authPeople.splice(parseInt(btn.dataset.del, 10), 1);
      this._renderAuthList();
    });
    document.getElementById('srm-auth-list')?.addEventListener('input', (e) => {
      const row = e.target.closest('[data-del]');
      if (!row) return;
      const idx = parseInt(row.dataset.del, 10);
      const auth = this._authPeople[idx];
      if (!auth || !e.target.hasAttribute('data-auth')) return;
      auth[e.target.dataset.auth] = e.target.value;
    });
  },

  _authRow(a, i) {
    const esc = Helpers.escapeHTML;
    return `
      <div class="flex flex-wrap items-center gap-2 bg-slate-50 rounded-2xl p-2 border border-slate-100" data-del="${i}">
        <input data-auth="name" value="${esc(a.name || '')}" placeholder="Nombre" class="flex-1 min-w-[140px] px-3 py-2 border-2 border-slate-100 rounded-xl text-sm bg-white">
        <input data-auth="relationship" value="${esc(a.relationship || '')}" placeholder="Parentesco" class="flex-1 min-w-[100px] px-3 py-2 border-2 border-slate-100 rounded-xl text-sm bg-white">
        <input data-auth="phone" value="${esc(a.phone || '')}" placeholder="Teléfono" class="flex-1 min-w-[120px] px-3 py-2 border-2 border-slate-100 rounded-xl text-sm bg-white">
        <button data-del="${i}" class="w-9 h-9 flex items-center justify-center bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-xl transition-all">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>`;
  },

  _renderAuthList() {
    const list = document.getElementById('srm-auth-list');
    if (!list) return;
    list.innerHTML = this._authPeople.length
      ? this._authPeople.map((a, i) => this._authRow(a, i)).join('')
      : '<p class="text-xs text-slate-400 font-bold">Nadie autorizado aún.</p>';
    if (window.lucide) lucide.createIcons();
  },

  // ---------------------------------------------------------------- SALUD (Pestaña 3)
  _renderSalud() {
    const f = this._form;
    return `
      <div class="grid grid-cols-1 gap-4">
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          ${this._sectionHeader('heart-pulse', 'Ficha de salud', 'bg-gradient-to-br from-rose-500 to-red-500')}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="${LABEL}">Tipo de sangre</label>
              <select data-f="blood_type" class="${INPUT}">
                <option value="">No sabe</option>
                ${['O+','O-','A+','A-','B+','B-','AB+','AB-'].map(b => `<option value="${b}" ${f.blood_type === b ? 'selected' : ''}>${b}</option>`).join('')}
              </select>
            </div>
            ${this._authedField('insurance', 'Seguro médico', 'Ej: ARS Humano')}
            ${this._authedField('pediatrician', 'Pediatra', 'Nombre del pediatra')}
            ${this._authedField('pediatrician_phone', 'Teléfono del pediatra', '')}
            ${this._authedField('allergies', 'Alergias', 'Ej: Maní, polvo, penicilina', { col: 'md:col-span-2' })}
            ${this._authedField('medical_conditions', 'Condiciones médicas', 'Asma, diabetes, etc.', { col: 'md:col-span-2' })}
            ${this._authedField('medications', 'Medicamentos', 'Solo con prescripción', { col: 'md:col-span-2' })}
            ${this._authedField('food_restrictions', 'Restricciones alimentarias', '', { col: 'md:col-span-2' })}
            ${this._authedField('disabilities', 'Necesidades especiales', '', { col: 'md:col-span-2' })}
            ${this._authedField('medical_notes', 'Observaciones médicas', '', { col: 'md:col-span-2', textarea: true, rows: 2 })}
          </div>
          <label class="flex items-center gap-2 cursor-pointer mt-4 bg-emerald-50 border border-emerald-100 rounded-2xl p-3">
            <input type="checkbox" data-f="vaccinations_complete" ${f.vaccinations_complete ? 'checked' : ''} class="w-5 h-5 rounded text-emerald-600">
            <span class="text-sm font-black text-emerald-700 uppercase">Cartilla de vacunas al día</span>
          </label>
        </div>
      </div>`;
  },

  _wireSalud() {},

  // ---------------------------------------------------------------- DOCUMENTOS (Pestaña 5)
  _renderDocs() {
    const hasSig = !!this._signature;
    return `
      <div class="grid grid-cols-1 gap-4">
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          ${this._sectionHeader('folder-open', 'Documentos del expediente')}
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
            ${DOC_TYPES.map(d => {
              const url = this._docs[d.key];
              return `
                <div class="relative rounded-2xl border-2 ${url ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-100 bg-slate-50'} p-3 flex flex-col items-center text-center gap-2">
                  <div class="w-14 h-14 rounded-xl bg-white border border-slate-100 flex items-center justify-center overflow-hidden text-slate-400">
                    ${url ? `<img src="${Helpers.escapeHTML(url)}" class="w-full h-full object-cover">` : `<i data-lucide="${d.icon}" class="w-5 h-5 ${d.required && !url ? 'text-rose-400' : ''}"></i>`}
                  </div>
                  <div>
                    <p class="text-[10px] font-black uppercase tracking-wider text-slate-600 leading-tight">${d.label}</p>
                    <p class="text-[9px] font-black ${url ? 'text-emerald-600' : (d.required ? 'text-rose-500' : 'text-slate-400')}">
                      ${url ? 'Adjuntado' : (d.required ? 'Requerido' : 'Opcional')}
                    </p>
                  </div>
                  <div class="flex gap-1.5">
                    ${url ? `<button data-view="${d.key}" class="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg font-black text-[9px] uppercase">Ver</button>` : ''}
                    <label class="px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-lg font-black text-[9px] uppercase cursor-pointer hover:bg-indigo-100 transition-all">
                      ${url ? 'Reemplazar' : 'Subir'}
                      <input type="file" data-up="${d.key}" accept="image/*" class="hidden">
                    </label>
                  </div>
                </div>`;
            }).join('')}
          </div>
          <p class="text-[10px] text-slate-400 font-bold mt-3">Los archivos se suben a storage público y se guardan al ${this._mode === 'admit' ? 'aprobar la admisión' : 'guardar'}.</p>
        </div>

        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          ${this._sectionHeader('file-check-2', 'Autorizaciones', 'bg-gradient-to-br from-orange-500 to-amber-500')}
          <div class="space-y-3">
            ${CONSENT_DEFS.map(c => `
              <label class="flex items-start gap-3 cursor-pointer bg-slate-50 border border-slate-100 rounded-2xl p-3">
                <input type="checkbox" data-consent="${c.key}" ${this._consents[c.key] ? 'checked' : ''} class="w-5 h-5 mt-0.5 rounded text-orange-500 accent-orange-500 shrink-0">
                <span class="text-sm font-bold text-slate-600">${c.label}</span>
              </label>`).join('')}
          </div>
        </div>

        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          ${this._sectionHeader('pen-tool', 'Firma del tutor')}
          <div class="bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 p-2">
            <canvas id="srm-signature" width="640" height="180" class="w-full rounded-xl bg-white touch-none" style="cursor:crosshair;"></canvas>
          </div>
          <div class="flex items-center justify-between mt-3">
            <p id="srm-sig-status" class="text-[11px] font-black ${hasSig ? 'text-emerald-600' : 'text-slate-400'}">
              ${hasSig ? '✓ Firma capturada' : 'Firme con el mouse o el dedo en el recuadro'}
            </p>
            <button id="srm-sig-clear" class="px-3 py-1.5 bg-slate-100 text-slate-500 hover:bg-rose-50 hover:text-rose-600 rounded-lg font-black text-[9px] uppercase tracking-widest transition-all">Limpiar</button>
          </div>
        </div>
      </div>`;
  },

  _wireDocs() {
    const content = document.getElementById('srm-tab-content');
    content.querySelectorAll('[data-up]').forEach(input => {
      input.onchange = async (e) => {
        const key = e.target.dataset.up;
        const file = e.target.files[0];
        if (!file) return;
        try {
          const compressed = await this._compress(file, 1400);
          const url = await this._upload(compressed.blob, key + '-' + Date.now() + '.jpg');
          if (url) {
            this._docs[key] = url;
            this._refreshDocs();
            Helpers.toast('Documento adjuntado', 'success');
          }
        } catch (err) {
          Helpers.toast('Error al subir: ' + (err.message || err), 'error');
        }
      };
    });
    content.querySelectorAll('[data-view]').forEach(btn => {
      btn.onclick = () => {
        const url = this._docs[btn.dataset.view];
        if (url) window.open(url, '_blank');
      };
    });
    this._wireConsents();
  },

  _refreshDocs() {
    const content = document.getElementById('srm-tab-content');
    if (!content) return;
    content.innerHTML = this._renderDocs();
    if (window.lucide) lucide.createIcons();
    this._wireDocs();
  },

  // ---------------------------------------------------------------- WIRE AUTORIZACIONES Y FIRMA
  _wireConsents() {
    document.querySelectorAll('[data-consent]').forEach(cb => {
      cb.onchange = () => { this._consents[cb.dataset.consent] = cb.checked; };
    });

    const canvas = document.getElementById('srm-signature');
    const status = document.getElementById('srm-sig-status');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (this._signature) {
      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = this._signature;
    }

    let drawing = false;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (canvas.width / r.width),
        y: (e.clientY - r.top) * (canvas.height / r.height),
      };
    };
    const start = (e) => {
      e.preventDefault();
      drawing = true;
      ctx.beginPath();
      ctx.moveTo(pos(e).x, pos(e).y);
    };
    const move = (e) => {
      if (!drawing) return;
      e.preventDefault();
      ctx.lineTo(pos(e).x, pos(e).y);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1e293b';
      ctx.stroke();
    };
    const end = () => {
      if (!drawing) return;
      drawing = false;
      this._signature = canvas.toDataURL('image/png');
      if (status) { status.textContent = '✓ Firma capturada'; status.className = 'text-[11px] font-black text-emerald-600'; }
    };
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    const clear = document.getElementById('srm-sig-clear');
    if (clear) {
      clear.onclick = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        this._signature = '';
        if (status) { status.textContent = 'Firme con el mouse o el dedo en el recuadro'; status.className = 'text-[11px] font-black text-slate-400'; }
      };
    }
  },

  // ---------------------------------------------------------------- CATEGORÍA HISTORIAL DEL ESTUDIANTE
  _enrBadge(status, type) {
    const SC = {
      pending:  { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700' },
      approved: { label: 'Aprobado',  cls: 'bg-emerald-100 text-emerald-700' },
      rejected: { label: 'Rechazado', cls: 'bg-rose-100 text-rose-700' },
    };
    const sc = SC[status] || SC.pending;
    return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase ${sc.cls}">
      <i data-lucide="${status === 'approved' ? 'check-circle-2' : status === 'rejected' ? 'x-circle' : 'clock'}" class="w-3 h-3"></i>${sc.label}</span>`;
  },

  _renderHistory() {
    const esc = Helpers.escapeHTML;
    const enr = this._historyParts.enrollments || [];
    const reports = this._historyParts.reports || [];
    const payments = this._historyParts.payments || [];

    const typeLabel = (t) => t === 'reenrollment' ? 'Reinscripción' : (t === 'new' ? 'Nueva inscripción' : t || '');

    const enrHTML = enr.length ? enr.map(e => {
      const sy = Array.isArray(e.school_years) ? e.school_years[0] : e.school_years;
      const cls = Array.isArray(e.classrooms) ? e.classrooms[0] : e.classrooms;
      return `
      <div class="bg-white rounded-2xl border border-slate-100 p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><i data-lucide="graduation-cap" class="w-4 h-4"></i></span>
            <div class="min-w-0">
              <p class="text-xs font-black text-slate-800 truncate">${esc(sy?.name || 'Año escolar #' + e.school_year_id)}</p>
              <p class="text-[10px] font-bold text-slate-400 uppercase">${esc(typeLabel(e.type))} · ${esc(cls?.name || 'sin aula')}${cls?.level ? ' · ' + esc(cls.level) : ''}</p>
            </div>
          </div>
          ${this._enrBadge(e.status, e.type)}
        </div>
        <div class="flex items-center justify-between mt-3 flex-wrap gap-2">
          <p class="text-[10px] font-bold text-slate-400">
            ${e.enrolled_at ? 'Aprobado el ' + new Date(e.enrolled_at).toLocaleDateString('es-DO') : 'Solicitado el ' + new Date(e.created_at).toLocaleDateString('es-DO')}
            ${e.notes ? ' · ' + esc(String(e.notes)) : ''}
          </p>
          ${this._mode === 'edit' && e.status === 'pending'
            ? `<div class="flex gap-2">
                <button data-approve-enr="${e.id}" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">Aprobar</button>
                <button data-reject-enr="${e.id}" class="px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">Rechazar</button>
              </div>` : ''}
        </div>
      </div>`;
    }).join('') : '<p class="text-xs text-slate-400 font-bold">Sin inscripciones registradas.</p>';

    const repHTML = reports.length ? reports.map(r => `
      <div class="bg-white rounded-2xl border border-slate-100 p-4">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-black text-slate-800 truncate">${esc(r.school_year_name || 'Período')}${r.academic_period_name ? ' · ' + esc(r.academic_period_name) : ''}</p>
          <span class="px-2.5 py-1 rounded-full text-[10px] font-black ${Number(r.average_score) >= 70 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">${esc(String(r.average_score ?? '—'))}</span>
        </div>
        <p class="text-[10px] font-bold text-slate-400 uppercase mt-1">${esc(r.grade_level || '')}${r.classroom_name ? ' · ' + esc(r.classroom_name) : ''}${r.teacher_name ? ' · ' + esc(r.teacher_name) : ''}</p>
        <div class="grid grid-cols-2 gap-2 mt-2">
          <div><p class="text-[9px] font-black text-slate-400 uppercase">Asistencia</p><p class="text-xs font-bold text-slate-700">${esc(String(r.attendance_pct ?? '—'))}%</p></div>
          <div><p class="text-[9px] font-black text-slate-400 uppercase">Estado</p><p class="text-xs font-bold text-slate-700">${esc(String(r.status ?? '—'))}</p></div>
        </div>
        ${r.notes ? `<p class="text-[11px] font-bold text-slate-500 mt-2 italic">${esc(r.notes)}</p>` : ''}
      </div>`).join('') : '<p class="text-xs text-slate-400 font-bold">Sin boletines generados todavía.</p>';

    const payHTML = payments.length ? payments.map(p => `
      <div class="flex items-center justify-between gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-white border border-slate-100">
        <span class="truncate">${esc(p.concept || p.month_paid || 'Pago')}</span>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-indigo-600">${this._fmt(p.amount)}</span>
          <span class="px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${p.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : p.status === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}">${esc(p.status || '')}</span>
        </div>
      </div>`).join('') : '<p class="text-xs text-slate-400 font-bold">Sin pagos registrados.</p>';

    const logsHTML = this._history.length ? this._history.map(h => `
      <div class="flex items-start gap-2 px-3 py-2 rounded-xl bg-white border border-slate-100">
        <i data-lucide="activity" class="w-3.5 h-3.5 text-slate-300 mt-0.5 shrink-0"></i>
        <div class="min-w-0">
          <p class="text-[10px] font-black text-slate-600 uppercase tracking-wider">${esc(h.title || h.action || h.type)}</p>
          <p class="text-[10px] font-bold text-slate-400">${new Date(h.at).toLocaleString('es-DO')}${h.detail ? ' · ' + esc(String(h.detail).slice(0, 120)) : ''}</p>
        </div>
      </div>`).join('') : '<p class="text-xs text-slate-400 font-bold">Sin actividad registrada.</p>';

    return `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          ${this._sectionHeader('graduation-cap', 'Años escolares e inscripciones', 'bg-gradient-to-br from-blue-500 to-indigo-600')}
          <div class="space-y-2.5">${enrHTML}</div>
          ${this._mode === 'edit' ? '<p class="text-[10px] text-slate-400 font-bold mt-2">Las reinscripciones pendientes pueden aprobarse aquí (al aprobar se valida el pago correspondiente).</p>' : ''}
        </div>

        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          ${this._sectionHeader('award', 'Boletines por período', 'bg-gradient-to-br from-emerald-500 to-teal-500')}
          <div class="space-y-2.5">${repHTML}</div>
        </div>

        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          ${this._sectionHeader('credit-card', 'Historial de pagos', 'bg-gradient-to-br from-amber-400 to-orange-500')}
          <div class="space-y-1.5">${payHTML}</div>
        </div>

        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          ${this._sectionHeader('activity', 'Actividad y auditoría', 'bg-gradient-to-br from-purple-500 to-indigo-600')}
          <div class="space-y-1.5">${logsHTML}</div>
        </div>
      </div>`;
  },

  _wireHistory() {
    const content = document.getElementById('srm-tab-content');
    if (!content) return;
    content.querySelectorAll('[data-approve-enr]').forEach(btn => {
      btn.onclick = () => this._reviewReenrollment(btn.dataset.approveEnr, 'approved');
    });
    content.querySelectorAll('[data-reject-enr]').forEach(btn => {
      btn.onclick = () => this._reviewReenrollment(btn.dataset.rejectEnr, 'rejected');
    });
  },

  async _reviewReenrollment(id, status) {
    const label = status === 'approved' ? 'aprobar' : 'rechazar';
    const ok = window.confirm('¿' + (status === 'approved' ? 'Aprobar' : 'Rechazar') + ' esta reinscripción?');
    if (!ok) return;
    this._saving = true;
    _setLoading(true);
    try {
      const { data, error } = await supabase.rpc('review_reenrollment', {
        p_enrollment_id: parseInt(id, 10),
        p_status: status,
        p_notes: null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      Helpers.toast('Reinscripción ' + (status === 'approved' ? 'aprobada' : 'rechazada'), 'success');
      await this._loadHistory();
      const content = document.getElementById('srm-tab-content');
      if (content) {
        content.innerHTML = this._renderHistory();
        if (window.lucide) lucide.createIcons();
        this._wireHistory();
      }
    } catch (e) {
      Helpers.toast('Error al ' + label + ': ' + (e.message || e), 'error');
    } finally {
      this._saving = false;
      _setLoading(false);
    }
  },

  // ---------------------------------------------------------------- PAGOS (Pestaña 4)
  _renderPago() {
    const f = this._form;
    const monthly = this._num('monthly_fee');
    const prolong = this._num('prolongado_fee');
    const insc = this._num('inscription_fee');
    const disc = this._num('discount_pct');
    const preview = this._previewCharges(monthly, prolong, insc, disc);

    return `
      <div class="grid grid-cols-1 gap-4">
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          ${this._sectionHeader('credit-card', 'Plan financiero', 'bg-gradient-to-br from-amber-400 to-orange-500')}
          <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label class="${LABEL}">Plan de pago</label>
              <select data-f="payment_plan" class="${INPUT}">
                <option value="unico" ${f.payment_plan === 'unico' ? 'selected' : ''}>Cuota única anual</option>
                <option value="doble" ${f.payment_plan === 'doble' ? 'selected' : ''}>Dos semestres</option>
                <option value="mensual" ${f.payment_plan === 'mensual' ? 'selected' : ''}>Mensual (10 cuotas)</option>
              </select>
            </div>
            ${this._authedField('inscription_fee', 'Inscripción (RD$)', '0.00')}
            ${this._authedField('monthly_fee', 'Mensualidad (RD$)', '0.00')}
            ${this._authedField('prolongado_fee', 'Día prolongado (RD$)', '0.00')}
            ${this._authedField('discount_pct', 'Descuento %', '0')}
            ${this._authedField('due_day', 'Día de vencimiento', '5')}
          </div>
          <button id="srm-autofill" class="mt-3 px-4 py-2 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
            Autocompletar con conceptos del catálogo
          </button>
          <div class="mt-4">
            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">${this._mode === 'admit' ? 'Vista previa de cargos a generar' : (this._mode === 'create' ? 'Cargos a generar al crear' : 'Cargos del alumno')}</p>
            <div id="srm-preview">
              ${this._mode === 'edit' && this._charges.length
                ? `<div class="space-y-1.5">${this._charges.map(c => `
                    <div class="flex items-center justify-between gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                      <span class="truncate">${Helpers.escapeHTML(c.concept)}</span>
                      <span class="text-indigo-600 shrink-0">${this._fmt(c.amount_net)}</span>
                    </div>`).join('')}</div>`
                : (preview.lines.length
                  ? `<div class="space-y-1.5">${preview.lines.slice(0, 12).map(l => `
                      <div class="flex items-center justify-between text-xs font-bold px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                        <span>${Helpers.escapeHTML(l.label)}</span>
                        <span class="text-indigo-600">${this._fmt(l.amount)}</span>
                      </div>`).join('')}
                     ${preview.lines.length > 12 ? `<p class="text-[10px] text-slate-400 font-black">… y ${preview.lines.length - 12} cargos más</p>` : ''}
                     <div class="flex items-center justify-between text-sm font-black px-3 py-2.5 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 mt-2">
                       <span>TOTAL</span><span>${this._fmt(preview.total)}</span>
                     </div></div>`
                  : '<p class="text-xs text-slate-400 font-bold">Sin montos definidos — no se generarán cargos.</p>')}
            </div>
          </div>
        </div>
      </div>`;
  },

  _wirePago() {
    const autofill = document.getElementById('srm-autofill');
    if (autofill) {
      autofill.onclick = () => { this._autofillConcepts(); this._updatePreview(); };
    }
    const plan = document.querySelector('[data-f="payment_plan"]');
    if (plan) plan.onchange = () => this._updatePreview();
    ['monthly_fee', 'prolongado_fee', 'inscription_fee', 'discount_pct'].forEach(k => {
      document.querySelector(`[data-f="${k}"]`)?.addEventListener('input', () => {
        clearTimeout(this._payDebounce);
        this._payDebounce = setTimeout(() => this._updatePreview(), 400);
      });
    });
  },

  // ---------------------------------------------------------------- ACCESOS (Pestaña 6)
  _renderAcceso() {
    const hasAccount = !!this._parentId && this._mode === 'edit';
    const notifEmails = [this._form.p1_email, this._form.p2_email].filter(Boolean);
    return `
      <div class="grid grid-cols-1 gap-4">
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          ${this._sectionHeader('key-round', 'Acceso del padre / tutor', 'bg-gradient-to-br from-blue-500 to-indigo-600')}
          ${hasAccount ? `<div class="mb-3 flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-2xl p-3 text-emerald-700 font-black text-xs"><i data-lucide="check-circle-2" class="w-4 h-4"></i> Cuenta de padres vinculada</div>` : ''}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${this._authedField('login_email', 'Correo de acceso (login)', 'correo@ejemplo.com', { type: 'email' })}
            <div>
              <label class="${LABEL}">Contraseña temporal (nueva cuenta)</label>
              <input data-f="password" id="srm-password" type="text" placeholder="Mínimo 6 caracteres" class="${INPUT}">
            </div>
          </div>
          <div class="mt-3 flex items-start gap-2 bg-sky-50 border border-sky-100 rounded-2xl p-3 text-[10px] font-bold text-sky-700">
            <i data-lucide="info" class="w-3.5 h-3.5 mt-0.5 shrink-0"></i>
            <span>Regla del centro: el correo de acceso lo define la directora o asistente. Los correos del tutor 1 y 2 (pestaña Familia) son SOLO de notificación y NO se usan para iniciar sesión.</span>
          </div>
          ${notifEmails.length ? `<div class="mt-3 text-[10px] font-bold text-slate-400">Correos de notificación: ${notifEmails.map(e => `<span class="inline-block bg-slate-100 rounded-lg px-2 py-0.5 ml-1">${Helpers.escapeHTML(e)}</span>`).join('')}</div>` : ''}
          <div class="flex gap-2 mt-4">
            <button id="srm-send-creds" class="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2">
              <i data-lucide="mail" class="w-3.5 h-3.5"></i> ${hasAccount ? 'Reenviar credenciales' : 'Crear cuenta y enviar credenciales'}
            </button>
          </div>
        </div>
      </div>`;
  },

  _wireAcceso() {
    document.getElementById('srm-send-creds')?.addEventListener('click', () => this._sendCredentials());
  },

  _previewCharges(monthly, prolong, insc, disc) {
    const lines = [];
    const months = 10;
    const net = (v) => Math.round((v * (1 - disc / 100)) * 100) / 100;
    if (insc > 0) lines.push({ label: 'Inscripción', amount: net(insc) });
    const plan = this._form.payment_plan || 'mensual';
    if (plan === 'unico') {
      if (monthly > 0) lines.push({ label: 'Cuota Única Anual (' + months + ' meses)', amount: net(monthly * months) });
    } else if (plan === 'doble') {
      const half = Math.floor(months / 2);
      if (monthly > 0) {
        lines.push({ label: 'Semestre I (' + half + ' meses)', amount: net(monthly * half) });
        lines.push({ label: 'Semestre II (' + (months - half) + ' meses)', amount: net(monthly * (months - half)) });
      }
    } else {
      for (let i = 1; i <= months; i++) lines.push({ label: 'Mensualidad ' + i, amount: net(monthly) });
    }
    if (prolong > 0) {
      for (let i = 1; i <= months; i++) lines.push({ label: 'Día Prolongado ' + i, amount: net(prolong) });
    }
    const total = lines.reduce((s, l) => s + l.amount, 0);
    return { lines, total };
  },

  _updatePreview() {
    const el = document.getElementById('srm-preview');
    if (!el) return;
    this._saveForm();
    const monthly = this._num('monthly_fee');
    const prolong = this._num('prolongado_fee');
    const insc = this._num('inscription_fee');
    const disc = this._num('discount_pct');
    const preview = this._previewCharges(monthly, prolong, insc, disc);
    el.innerHTML = preview.lines.length
      ? `<div class="space-y-1.5">${preview.lines.slice(0, 12).map(l => `
          <div class="flex items-center justify-between text-xs font-bold px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
            <span>${Helpers.escapeHTML(l.label)}</span>
            <span class="text-indigo-600">${this._fmt(l.amount)}</span>
          </div>`).join('')}
         ${preview.lines.length > 12 ? `<p class="text-[10px] text-slate-400 font-black">… y ${preview.lines.length - 12} cargos más</p>` : ''}
         <div class="flex items-center justify-between text-sm font-black px-3 py-2.5 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 mt-2">
           <span>TOTAL</span><span>${this._fmt(preview.total)}</span>
         </div></div>`
      : '<p class="text-xs text-slate-400 font-bold">Sin montos definidos — no se generarán cargos.</p>';
  },

  _loadQRLib(cb) {
    if (window.QRCode) { cb(); return; }
    const s = document.createElement('script');
    s.src = 'js/shared/qrcode.min.js';
    s.onload = () => cb();
    document.head.appendChild(s);
  },

  async _generateQR() {
    const matricula = this._form.matricula;
    const container = document.getElementById('srm-qr');
    if (!container) return;
    if (!matricula) { Helpers.toast('Genera una matrícula primero (paso 1)', 'warning'); return; }
    container.innerHTML = '<p class="text-[11px] text-slate-400 font-bold">Generando…</p>';
    try {
      await new Promise(r => this._loadQRLib(r));
      const qrUrl = await Helpers.generateQRWithLogo(matricula, { width: 150, colorDark: '#198754' });
      container.innerHTML = qrUrl
        ? `<img src="${qrUrl}" style="width:150px;height:150px;border-radius:8px;display:block;">`
        : '<p class="text-xs text-rose-500 font-bold">Error al generar QR</p>';
    } catch (e) {
      container.innerHTML = '<p class="text-xs text-rose-500 font-bold">Error al generar QR</p>';
    }
  },

  _printCarnet() {
    const matricula = this._form.matricula;
    if (!matricula) { Helpers.toast('Genera la matrícula y el QR primero', 'warning'); return; }
    const qrImg = document.getElementById('srm-qr')?.querySelector('img')?.src;
    if (!qrImg) { Helpers.toast('Genera el QR primero', 'warning'); return; }
    const room = this._classrooms.find(c => String(c.id) === String(this._form.classroom_id));
    const win = window.open('', '_blank');
    win.document.write(Helpers.getQRPrintTemplate(qrImg, this._form.name || '', matricula, {
      classroom: room?.name || '',
      level: room?.level || '',
      p1Name: this._form.p1_name || '',
      p2Name: this._form.p2_name || '',
      p1Phone: this._form.p1_phone || '',
      p2Phone: this._form.p2_phone || '',
    }));
    win.document.close();
  },

  async _sendCredentials() {
    this._saveForm();
    const email = this._form.login_email;
    if (!email) { Helpers.toast('Ingresa el correo de acceso (login) en la pestaña Acceso', 'warning'); return; }
    if (!this._parentPassword) {
      this._parentPassword = this._genPassword();
      this._form.password = this._parentPassword;
      const input = document.getElementById('srm-password');
      if (input) input.value = this._parentPassword;
    }
    Helpers.toast('Creando cuenta y enviando credenciales…', 'info');
    try {
      if (!this._parentId) {
        await this._createParentAccount(email, this._parentPassword);
        if (this._parentId && this._mode === 'edit' && this._student?.id) {
          await supabase
            .from('students')
            .update({ parent_id: this._parentId, login_email: email })
            .eq('id', this._student.id);
        }
      }
      await this._sendCredentialsEmail(email, this._parentPassword);
      Helpers.toast('Credenciales enviadas', 'success');
    } catch (e) {
      Helpers.toast('No se pudieron crear/enviar las credenciales: ' + (e.message || e), 'error');
    }
  },

  // ---------------------------------------------------------------- COLLECT / SAVE
  _collect() {
    const f = this._form;
    return {
      name: f.name || null,
      last_name: f.last_name || null,
      matricula: f.matricula || null,
      birth_date: f.birth_date || null,
      age: f.age ? parseInt(f.age, 10) : null,
      age_type: f.age_type || 'años',
      gender: f.gender || null,
      nationality: f.nationality || 'Dominicana',
      birthplace: f.birthplace || null,
      province: f.province || null,
      municipality: f.municipality || null,
      sector: f.sector || null,
      school_year_requested: f.school_year_requested || null,
      school_year_id: (this._schoolYearOptions.find(o => o.name === f.school_year_requested)?.id) || null,
      level_requested: f.level_requested || null,
      schedule: f.schedule || null,
      start_date: f.start_date || null,
      estimated_entry_date: f.start_date || null,
      has_siblings: !!f.has_siblings,
      sibling_name: f.sibling_name || null,
      login_email: f.login_email || null,
      classroom_id: f.classroom_id ? parseInt(f.classroom_id, 10) : null,
      is_active: f.is_active !== false,
      blood_type: f.blood_type || null,
      allergies: f.allergies || null,
      insurance: f.insurance || null,
      pediatrician: f.pediatrician || null,
      pediatrician_phone: f.pediatrician_phone || null,
      medical_conditions: f.medical_conditions || null,
      medications: f.medications || null,
      food_restrictions: f.food_restrictions || null,
      disabilities: f.disabilities || null,
      medical_notes: f.medical_notes || null,
      vaccinations_complete: !!f.vaccinations_complete,
      emergency_protocol: f.emg_observations || f.emergency_protocol || null,
      p1_name: f.p1_name || null,
      p1_relationship: f.p1_relationship || null,
      p1_cedula: f.p1_cedula || null,
      p1_phone: f.p1_phone || null,
      p1_whatsapp: f.p1_whatsapp || null,
      p1_email: f.p1_email || null,
      p1_address: f.p1_address || null,
      p1_occupation: f.p1_occupation || null,
      p1_job: f.p1_job || null,
      p1_workplace: f.p1_workplace || null,
      p1_emergency_contact: f.p1_emergency_contact || null,
      p2_name: f.p2_name || null,
      p2_relationship: f.p2_relationship || null,
      p2_cedula: f.p2_cedula || null,
      p2_phone: f.p2_phone || null,
      p2_whatsapp: f.p2_whatsapp || null,
      p2_email: f.p2_email || null,
      p2_address: f.p2_address || null,
      p2_occupation: f.p2_occupation || null,
      p2_job: f.p2_job || null,
      p2_workplace: f.p2_workplace || null,
      emg_name: f.emg_name || null,
      emg_relationship: f.emg_relationship || null,
      emg_cedula: f.emg_cedula || null,
      emg_phone: f.emg_phone || null,
      authorized_people: this._authPeople,
      documents: this._docs,
      consents: this._consents,
      signature_data: this._signature || null,
      avatar_url: f.avatar_url || null,
      payment_plan: f.payment_plan || 'mensual',
      monthly_fee: this._num('monthly_fee'),
      prolongado_fee: this._num('prolongado_fee'),
      inscription_fee: this._num('inscription_fee'),
      discount_pct: Math.max(0, Math.min(100, this._num('discount_pct'))),
      due_day: Math.max(1, Math.min(31, parseInt(this._form.due_day, 10) || 5)),
    };
  },

  async _createParentAccount(email, password) {
    if (!email || !password) return null;
    const name = this._form.p1_name || this._form.p2_name || '';
    const phone = this._form.p1_phone || '';

    const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: authData, error: authError } = await tempClient.auth.signUp({
      email,
      password,
      options: { data: { name, role: 'padre', phone } },
    });

    let parentId = null;
    if (authError) {
      const msg = String(authError.message || '').toLowerCase();
      if (msg.includes('already registered') || authError.status === 422) {
        const { data: existing } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle();
        if (existing?.id) {
          parentId = existing.id;
          Helpers.toast('Usuario ya existe — vinculando al estudiante', 'info');
        } else {
          throw new Error('El correo ya está registrado pero no tiene perfil. Contacta al administrador.');
        }
      } else {
        throw authError;
      }
    } else if (authData?.user) {
      parentId = authData.user.id;
    }

    if (parentId) {
      this._parentId = parentId;
      await supabase.from('profiles').upsert({
        id: parentId, name, email, phone, role: 'padre',
      }, { onConflict: 'id' });
    }
    return parentId;
  },

  async _attachParent(payload, password) {
    if (this._parentId) { payload.parent_id = this._parentId; return; }
    if (password) this._parentPassword = password;
    const email = payload.login_email;
    if (!email || !password) return;
    const parentId = await this._createParentAccount(email, password);
    if (parentId) payload.parent_id = parentId;
  },

  _validateBasics() {
    const f = this._form;
    if (!f.name) { Helpers.toast('El nombre del estudiante es obligatorio (paso 1)', 'warning'); return false; }
    if (!f.classroom_id) { Helpers.toast('Asigna un aula en la pestaña "Info General"', 'warning'); return false; }
    const classroom = this._classrooms.find(c => String(c.id) === String(f.classroom_id));
    if (classroom && classroom.available <= 0) { Helpers.toast('Esa aula está llena. Elige otra.', 'warning'); return false; }
    return true;
  },

  async _generateCharges(studentId, payload) {
    const months = 10;
    const hasAmounts = payload.monthly_fee > 0 || payload.inscription_fee > 0 || payload.prolongado_fee > 0;
    if (!hasAmounts) return;
    const rpc = await supabase.rpc('generate_student_charges', {
      p_student_id: studentId,
      p_plan: payload.payment_plan,
      p_inscription_amount: payload.inscription_fee,
      p_monthly_amount: payload.monthly_fee,
      p_prolongado_fee: payload.prolongado_fee,
      p_discount_pct: payload.discount_pct,
      p_due_day: payload.due_day,
      p_months: months,
    });
    if (rpc.error) throw rpc.error;
  },

  async _createStudent() {
    if (this._saving) return;
    this._saveForm();
    if (!this._validateBasics()) return;
    this._saving = true;
    _setLoading(true);
    try {
      const payload = this._collect();
      const password = this._form.password || this._genPassword();
      this._form.password = password;
      this._parentPassword = password;
      await this._attachParent(payload, password);
      if (!payload.parent_id) {
        Helpers.toast('Aviso: no se asignó cuenta de padre. Puedes hacerlo luego en el expediente.', 'info');
      }

      const { data: inserted, error: insErr } = await supabase
        .from('students')
        .insert(payload)
        .select('*')
        .single();
      if (insErr) throw insErr;

      await this._generateCharges(inserted.id, payload);

      await auditLog('student.created', {
        student_id: inserted.id,
        student_name: payload.name,
        matricula: payload.matricula,
        classroom_id: payload.classroom_id,
        parent_email: payload.p1_email,
        login_email: payload.login_email,
      });

      if (payload.parent_id) {
        const recipients = [payload.login_email].filter(Boolean);
        if (recipients.length) await this._sendCredentialsEmail(recipients, password);
      }

      Helpers.toast(payload.monthly_fee > 0 || payload.inscription_fee > 0 ? 'Estudiante creado y cargos generados' : 'Estudiante creado', 'success');
      _closeModal();
      if (this._onSaved) this._onSaved();
    } catch (e) {
      Helpers.toast('Error al crear: ' + (e.message || e), 'error');
    } finally {
      this._saving = false;
      _setLoading(false);
    }
  },

  async _approveAdmission() {
    if (this._saving) return;
    this._saveForm();
    if (!this._validateBasics()) return;
    this._saving = true;
    _setLoading(true);
    try {
      const payload = this._collect();
      const password = this._form.password || this._genPassword();
      this._form.password = password;
      this._parentPassword = password;
      await this._attachParent(payload, password);
      if (!payload.parent_id) {
        Helpers.toast('Aviso: no se asignó cuenta de padre. Puedes hacerlo luego en el expediente.', 'info');
      }

      const { data: inserted, error: insErr } = await supabase
        .from('students')
        .insert(payload)
        .select('*')
        .single();
      if (insErr) throw insErr;

      const studentId = inserted.id;
      await this._generateCharges(studentId, payload);

      if (this._prereg?.id) {
        const upd = await supabase.rpc('review_preregistration', {
          p_id: this._prereg.id,
          p_status: 'converted',
          p_notes: 'Admitido el ' + new Date().toLocaleDateString() + ' — estudiante #' + studentId,
        });
        if (upd.error) throw upd.error;
        await supabase
          .from('student_preregistrations')
          .update({ converted_student_id: studentId })
          .eq('id', this._prereg.id);
      }

      await auditLog('student.admitted', {
        student_id: studentId,
        student_name: payload.name,
        matricula: payload.matricula,
        prereg_id: this._prereg?.id || null,
        classroom_id: payload.classroom_id,
        parent_email: payload.p1_email,
        login_email: payload.login_email,
      });

      if (payload.parent_id) {
        const recipients = [payload.login_email].filter(Boolean);
        if (recipients.length) await this._sendCredentialsEmail(recipients, password);
      }

      Helpers.toast('Estudiante admitido y cargos generados', 'success');
      _closeModal();
      if (this._onSaved) this._onSaved();
    } catch (e) {
      Helpers.toast('Error al admitir: ' + (e.message || e), 'error');
    } finally {
      this._saving = false;
      _setLoading(false);
    }
  },

  async _saveChanges() {
    if (this._saving) return;
    this._saveForm();
    const f = this._form;
    if (!f.name) return Helpers.toast('El nombre del estudiante es obligatorio (paso 1)', 'warning');
    this._saving = true;
    _setLoading(true);
    try {
      const payload = this._collect();
      const studentId = this._student?.id;
      if (!studentId) throw new Error('Estudiante no cargado');

      const { error } = await supabase.from('students').update(payload).eq('id', studentId);
      if (error) throw error;

      await auditLog('student.updated', {
        student_id: studentId,
        student_name: payload.name,
        classroom_id: payload.classroom_id,
      });

      Helpers.toast('Expediente actualizado', 'success');
      _closeModal();
      if (this._onSaved) this._onSaved();
    } catch (e) {
      Helpers.toast('Error al guardar: ' + (e.message || e), 'error');
    } finally {
      this._saving = false;
      _setLoading(false);
    }
  },

  async _rejectPrereg() {
    if (!this._prereg?.id) return;
    const name = this._form.name || 'este estudiante';
    const ok = window.confirm('¿Rechazar la preinscripción de "' + name + '"?\n\nSe registrará en el historial con estado "rechazada".');
    if (!ok) return;

    this._saving = true;
    _setLoading(true);
    try {
      const { error } = await supabase.rpc('review_preregistration', {
        p_id: this._prereg.id,
        p_status: 'rejected',
        p_notes: 'Rechazada por el staff el ' + new Date().toLocaleDateString(),
      });
      if (error) throw error;
      await auditLog('preregistration.rejected', { prereg_id: this._prereg.id, student_name: this._form.name });
      Helpers.toast('Preinscripción rechazada', 'info');
      _closeModal();
      if (this._onSaved) this._onSaved();
    } catch (e) {
      Helpers.toast('Error al rechazar: ' + (e.message || e), 'error');
    } finally {
      this._saving = false;
      _setLoading(false);
    }
  },

  // ---------------------------------------------------------------- UPLOAD
  _compress(file, maxW = 1400) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxW / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (!blob) return reject(new Error('No se pudo comprimir la imagen'));
            resolve({ blob, dataUrl: canvas.toDataURL('image/jpeg', 0.82) });
          }, 'image/jpeg', 0.82);
        };
        img.onerror = () => reject(new Error('Imagen inválida'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsDataURL(file);
    });
  },

  async _upload(blob, name) {
    const path = this._mode === 'admit'
      ? 'prereg-' + (this._prereg?.id || 'pending') + '/' + name
      : 'student-' + (this._student?.id || 'new') + '/' + name;
    const { error } = await supabase.storage.from('preinscripcion-docs').upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error) throw error;
    const { data } = supabase.storage.from('preinscripcion-docs').getPublicUrl(path);
    return data?.publicUrl || null;
  },
};
