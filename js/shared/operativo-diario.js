/**
 * ============================================================================
 * KARPUS KIDS · OPERATIVO DIARIO · CONTROL DE LA ESTANCIA
 * ----------------------------------------------------------------------------
 * Módulo COMPARTIDO por los paneles de Directora y Asistente.
 *
 *  · OperativoDiarioModule  → consola de control operativo de la estancia:
 *      salud del centro, organigrama de aulas, monitor en vivo de asistencia y
 *      rutinas infantiles, alertas inteligentes y centro de intervenciones.
 *  · SupervisionEngine      → modo supervisión de aula con barra persistente,
 *      sello por rol (Directora / Asistente) y actas auditables INT-YYYY-XXXX.
 *
 * Requiere el CSS compartido: css/operativo-diario.css
 * Se apoya en la migración 15_supervision_operativo_diario.sql (degrada a
 * localStorage si la tabla aún no existe).
 * ============================================================================
 */
import { supabase } from '/js/shared/supabase.js';

/* -------------------------------------------------------------------------- */
/*  Configuración                                                             */
/* -------------------------------------------------------------------------- */
const ROLE_LABEL = {
  directora: 'Directora',
  asistente: 'Asistente de Dirección',
  admin: 'Administrador',
};

const LEVEL_GROUPS = [
  { key: 'lactantes',   label: 'Lactantes y Maternal',   age: '0 – 12 meses', ratio: 5,  icon: 'baby',       color: '#ec4899',
    kw: ['lact', 'bebe', 'bebé', 'maternal', 'cuna', 'cunero', 'nido'] },
  { key: 'caminadores', label: 'Caminadores y Párvulos', age: '1 – 3 años',   ratio: 8,  icon: 'footprints', color: '#f59e0b',
    kw: ['camin', 'parvul', 'párvul', 'andar', 'explor'] },
  { key: 'preescolar',  label: 'Preescolar y Kínder',    age: '3 – 6 años',   ratio: 15, icon: 'layout-grid', color: '#6366f1',
    kw: ['preescol', 'kinder', 'kínder', 'inicial', 'nivel', 'pre-', 'prem'] },
  { key: 'otras',       label: 'Aulas mixtas / Otras',   age: '—',            ratio: 12, icon: 'school',     color: '#0ea5e9', kw: [] },
];

const SUP_CTX_KEY = 'karpus_supervision_ctx_v1';
const SUP_LOCAL_AUDITS = 'karpus_supervision_audits_local_v1';
const OD_TABS = [
  { key: 'resumen',        label: 'Resumen',        icon: 'layout-dashboard' },
  { key: 'organizacion',   label: 'Organización',   icon: 'network' },
  { key: 'monitoreo',      label: 'Monitoreo',      icon: 'activity' },
  { key: 'intervenciones', label: 'Intervenciones', icon: 'clipboard-list' },
];

/* -------------------------------------------------------------------------- */
/*  Utilidades                                                                */
/* -------------------------------------------------------------------------- */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]).join('').toUpperCase() || '?';
}
function localDateISO(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function minutesSince(ts) {
  if (!ts) return Infinity;
  const d = new Date(ts);
  if (isNaN(d)) return Infinity;
  return (Date.now() - d.getTime()) / 60000;
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function classForScore(s) { return s >= 85 ? 'ok' : s >= 65 ? 'warn' : 'bad'; }
function normStatus(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'present') return 'present';
  if (v === 'late') return 'late';
  if (v === 'excused' || v === 'excusa') return 'excused';
  if (v === 'retirado') return 'retirado';
  if (v === 'absent') return 'absent';
  return v || 'none';
}
const ATT_LABEL = { present: 'Presente', late: 'Tarde', excused: 'Excusa', absent: 'Ausente', retirado: 'Retirado' };
const PRI_LABEL = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const INT_STATUS_LABEL = { abierta: 'Abierta', en_proceso: 'En proceso', resuelta: 'Resuelta' };
const CATEGORIES = ['pedagogica', 'conducta', 'salud', 'instalaciones', 'personal', 'padres', 'otra'];

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function roleLabel(role) { return ROLE_LABEL[role] || role || 'Staff'; }
function isPastCutoff(settings) {
  const cutoff = settings?.check_in_end || '09:00';
  const [hh, mm] = String(cutoff).split(':').map(Number);
  const now = new Date();
  return now.getHours() > (hh || 9) || (now.getHours() === (hh || 9) && now.getMinutes() >= (mm || 0));
}
function classify(cr) {
  const s = `${cr.level || ''} ${cr.name || ''}`.toLowerCase();
  for (const g of LEVEL_GROUPS) {
    if (g.kw.length && g.kw.some(k => s.includes(k))) return g;
  }
  return LEVEL_GROUPS[LEVEL_GROUPS.length - 1];
}
function icon(name, cls = '') {
  return `<i data-lucide="${esc(name)}"${cls ? ` class="${esc(cls)}"` : ''}></i>`;
}
function refreshIcons() { try { if (window.lucide) window.lucide.createIcons(); } catch (_) {} }
function goto(section) {
  try {
    if (typeof window.goToSection === 'function') return window.goToSection(section);
    if (window.App?.navigation?.goTo) return window.App.navigation.goTo(section);
  } catch (_) {}
}
function restoreFetch() {
  try {
    if (window.__odOriginalFetch) {
      window.fetch = window.__odOriginalFetch;
      delete window.__odOriginalFetch;
      window.__odFetchWrapped = false;
    }
  } catch (_) {}
}

/* -------------------------------------------------------------------------- */
/*  Consultas de datos (tolerantes a fallos)                                  */
/* -------------------------------------------------------------------------- */
async function q(fn, fb) {
  try {
    const r = await fn();
    if (r && r.error) throw r.error;
    return (r && r.data != null) ? r.data : fb;
  } catch (e) {
    console.warn('[OperativoDiario]', e?.message || e);
    return fb;
  }
}

/** Escritura tolerante: devuelve { ok, data }. */
async function w(fn) {
  try {
    const r = await fn();
    if (r && r.error) throw r.error;
    return { ok: true, data: (r && r.data != null) ? r.data : null };
  } catch (e) {
    console.warn('[OperativoDiario]', e?.message || e);
    return { ok: false, data: null };
  }
}

async function loadData() {
  const date = ST.date;
  const me = ST.profile?.id || ST.user?.id || null;
  const [classrooms, profiles, students, attendance, logs, incidents, punches, settings, unread] = await Promise.all([
    q(() => supabase.from('classrooms').select('id,name,level,capacity,teacher_id,is_live').order('name'), []),
    q(() => supabase.from('profiles').select('id,name,avatar_url,role').in('role', ['maestra', 'asistente', 'directora']), []),
    q(() => supabase.from('students').select('id,name,classroom_id,is_active,avatar_url,allergies,medical_conditions,age,age_type,parent_id').eq('is_active', true).order('name'), []),
    q(() => supabase.from('attendance').select('student_id,classroom_id,date,status,check_in,check_out').eq('date', date), []),
    q(() => supabase.from('daily_logs').select('student_id,classroom_id,date,mood,food,nap,eating,sleeping,infant_data,status,created_at').eq('date', date), []),
    q(() => supabase.from('incidents').select('*').gte('reported_at', date + 'T00:00:00').order('reported_at', { ascending: false }).limit(200), []),
    q(() => supabase.from('door_punches').select('student_id,staff_id,punch_type,punched_at,date').eq('date', date), []),
    q(() => supabase.from('school_settings').select('open_time,close_time,check_in_end').eq('id', 1).maybeSingle(), null),
    me ? q(() => supabase.from('messages').select('id,sender_id,content,created_at').eq('receiver_id', me).or('is_read.eq.false,is_read.is.null').order('created_at', { ascending: false }).limit(300), []) : Promise.resolve([]),
  ]);

  const teachers = {};
  (profiles || []).forEach(p => { teachers[p.id] = p; });

  // Tolerancia de esquema: si la tabla `incidents` desplegada no expone la
  // columna `status`, se asume "received" (abierto) para no perder incidencias.
  const normalizedIncidents = (incidents || []).map(i => ({
    ...i,
    status: i.status || 'received',
  }));

  ST.data = { classrooms, profiles, teachers, students, attendance, logs, incidents: normalizedIncidents, punches, settings, unread: unread || [], date };
  ST.classrooms = buildClassrooms();
  ST.health = computeHealth();
  return ST.data;
}

function buildClassrooms() {
  const { classrooms, teachers, students, attendance, logs, incidents, unread } = ST.data;
  const byClassStudents = {};
  (students || []).forEach(s => { (byClassStudents[s.classroom_id] = byClassStudents[s.classroom_id] || []).push(s); });
  const byClassAtt = {};
  (attendance || []).forEach(a => { (byClassAtt[a.classroom_id] = byClassAtt[a.classroom_id] || []).push(a); });
  const byClassLog = {};
  (logs || []).forEach(l => { (byClassLog[l.classroom_id] = byClassLog[l.classroom_id] || []).push(l); });
  const openInc = {};
  (incidents || []).forEach(i => { if (i.status !== 'resolved' && i.status !== 'archived') openInc[i.classroom_id] = (openInc[i.classroom_id] || 0) + 1; });
  const unreadBySender = {};
  (unread || []).forEach(m => { (unreadBySender[m.sender_id] = unreadBySender[m.sender_id] || []).push(m); });

  return (classrooms || []).map(cr => {
    const group = classify(cr);
    const enrolled = byClassStudents[cr.id] || [];
    const att = byClassAtt[cr.id] || [];
    const ll = byClassLog[cr.id] || [];
    const teacher = cr.teacher_id ? teachers[cr.teacher_id] : null;

    const counts = { present: 0, late: 0, excused: 0, absent: 0, retirado: 0, none: 0, taken: 0 };
    att.forEach(a => {
      const s = normStatus(a.status);
      counts[s] = (counts[s] || 0) + 1;
      if (s !== 'none') counts.taken++;
    });
    const enrolledCount = enrolled.length;
    const attended = counts.present + counts.late + counts.excused;
    const attPct = enrolledCount ? Math.round((attended / enrolledCount) * 100) : 0;
    const occupancy = cr.capacity ? Math.round((enrolledCount / cr.capacity) * 100) : 0;

    const withFood = ll.filter(l => l.food).length;
    const withNap = ll.filter(l => l.nap || l.sleeping).length;
    const withMood = ll.filter(l => l.mood).length;
    const infantRecords = ll.reduce((n, l) => n + (Array.isArray(l.infant_data) ? l.infant_data.length : 0), 0);
    const foodPct = enrolledCount ? Math.round((withFood / enrolledCount) * 100) : 0;
    const napPct = enrolledCount ? Math.round((withNap / enrolledCount) * 100) : 0;
    const moodPct = enrolledCount ? Math.round((withMood / enrolledCount) * 100) : 0;
    const routineScore = Math.round((foodPct + napPct + moodPct) / 3);

    const publishedLogs = ll.filter(l => l.status === 'published');
    const publishedCount = publishedLogs.length;
    const routinePublished = publishedCount > 0;

    const teacherUnread = cr.teacher_id ? (unreadBySender[cr.teacher_id] || []) : [];
    const unreadCount = teacherUnread.length;
    const unreadSample = teacherUnread[0]?.content || '';

    const lastLog = ll.reduce((m, l) => Math.max(m, new Date(l.created_at).getTime() || 0), 0);
    const lastAtt = att.reduce((m, a) => Math.max(m, new Date(a.check_in || ST.date).getTime() || 0), 0);
    const lastUpdate = Math.max(lastLog, lastAtt) || null;
    const stale = enrolledCount > 0 && (!lastUpdate || minutesSince(lastUpdate) > 45);

    let score = 100;
    if (!teacher) score -= 15;
    if (enrolledCount === 0) score -= 10;
    if (counts.taken === 0 && enrolledCount > 0) score -= 25;
    if (occupancy > 100) score -= 8;
    if (routineScore < 50 && enrolledCount > 0) score -= 12;
    if (stale) score -= 10;
    if (openInc[cr.id]) score -= 12;
    score = clamp(Math.round(score), 0, 100);

    return {
      id: cr.id, name: cr.name, level: cr.level, capacity: cr.capacity || 0, is_live: cr.is_live,
      group, teacher, enrolled, enrolledCount, occupancy, counts, attended, attPct,
      logs: ll, foodPct, napPct, moodPct, routineScore, infantRecords,
      publishedCount, routinePublished, unread: unreadCount, unreadSample,
      lastUpdate, stale, openIncidents: openInc[cr.id] || 0, score, status: classForScore(score),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function computeHealth() {
  const list = ST.classrooms || [];
  const totalEnrolled = list.reduce((n, c) => n + c.enrolledCount, 0);
  const totalAttended = list.reduce((n, c) => n + c.attended, 0);
  const withTeacher = list.filter(c => c.teacher).length;
  const attendanceTaken = list.filter(c => c.counts.taken > 0).length;
  const openIncidents = (ST.data.incidents || []).filter(i => i.status !== 'resolved' && i.status !== 'archived').length;
  const stamps = list.filter(c => c.lastUpdate).map(c => c.lastUpdate);
  const lastUpdate = stamps.length ? Math.max(...stamps) : null;
  const avgScore = list.length ? Math.round(list.reduce((n, c) => n + c.score, 0) / list.length) : 100;

  const issues = [];
  const pastCutoff = isPastCutoff(ST.data.settings);
  list.forEach(c => {
    if (!c.teacher) issues.push({ level: 'bad', icon: 'user-x', classroom: c, short: 'Sin docente asignada', title: `${c.name} sin docente asignada`, text: 'Aula sin maestra titular registrada. Asigne personal para garantizar la supervisión.' });
    if (c.enrolledCount > 0 && c.counts.taken === 0) issues.push({ level: 'warn', icon: 'calendar-x-2', classroom: c, short: 'Pase de lista pendiente', title: `${c.name}: pase de lista pendiente`, text: `${c.enrolledCount} estudiantes matriculados sin registro de asistencia hoy.` });
    if (c.enrolledCount > 0 && pastCutoff && !c.routinePublished) issues.push({ level: 'warn', icon: 'book-x', classroom: c, short: 'Rutina sin publicar', title: `${c.name}: rutina sin publicar`, text: `${c.teacher?.name || 'La maestra'} aún no ha publicado la rutina diaria (${c.enrolledCount} estudiantes).` });
    else if (c.enrolledCount > 0 && c.publishedCount > 0 && c.publishedCount < c.enrolledCount) issues.push({ level: 'warn', icon: 'book-open', classroom: c, short: 'Rutina parcial', title: `${c.name}: rutina parcial`, text: `Solo ${c.publishedCount}/${c.enrolledCount} rutinas publicadas.` });
    if (c.unread > 0) issues.push({ level: 'warn', icon: 'mail', classroom: c, short: `${c.unread} mensaje(s) sin leer`, title: `${c.name}: ${c.unread} mensaje(s) sin leer`, text: `De ${c.teacher?.name || 'la maestra'}: "${(c.unreadSample || '').slice(0, 120)}"` });
    if (c.occupancy > 100) issues.push({ level: 'warn', icon: 'users', classroom: c, short: 'Sobre ocupación', title: `${c.name} sobre ocupación`, text: `${c.enrolledCount}/${c.capacity} estudiantes (${c.occupancy}%).` });
    if (c.stale && c.enrolledCount > 0 && c.counts.taken > 0) issues.push({ level: 'warn', icon: 'clock', classroom: c, short: 'Rutinas sin actualizar', title: `${c.name}: rutinas sin actualizar`, text: `Sin novedades en los últimos 45 minutos.` });
    if (c.group.key === 'otras' && c.enrolledCount > 0) issues.push({ level: 'warn', icon: 'help-circle', classroom: c, short: 'Nivel sin clasificar', title: `Nivel sin clasificar: ${c.name}`, text: `Edite el nivel del aula para calcular el ratio docente-niño.` });
  });
  (ST.data.incidents || []).forEach(i => {
    if (i.status === 'received' || i.status === 'review') {
      const classroom = list.find(c => c.id === i.classroom_id);
      issues.push({ level: i.severity === 'alta' ? 'bad' : 'warn', icon: 'alert-triangle', classroom, incident: i, short: `Incidente ${i.severity || 'media'} abierto`, title: `Incidente ${i.severity || 'media'} abierto`, text: i.description || 'Incidente sin descripción.' });
    }
  });

  const attendancePct = totalEnrolled ? Math.round((totalAttended / totalEnrolled) * 100) : 0;
  const punctual = list.filter(c => c.enrolledCount > 0 && c.routineScore >= 85).length;
  const routinePunctuality = list.filter(c => c.enrolledCount > 0).length
    ? Math.round((punctual / list.filter(c => c.enrolledCount > 0).length) * 100) : 100;
  const routineClassrooms = list.filter(c => c.enrolledCount > 0).length;
  const routinesPublishedCount = list.filter(c => c.enrolledCount > 0 && c.routinePublished).length;
  const unreadTotal = list.reduce((n, c) => n + c.unread, 0);

  let level = classForScore(avgScore);
  if (openIncidents > 0 && (ST.data.incidents || []).some(i => (i.status === 'received') && i.severity === 'alta')) level = 'bad';
  else if (attendanceTaken < list.length && pastCutoff) level = level === 'ok' ? 'warn' : level;

  return {
    totalEnrolled, totalAttended, attendancePct, withTeacher, attendanceTaken,
    classroomCount: list.length, openIncidents, avgScore, routinePunctuality, lastUpdate,
    routineClassrooms, routinesPublishedCount, unreadTotal,
    level, issues,
  };
}

/* -------------------------------------------------------------------------- */
/*  Motor de supervisión                                                      */
/* -------------------------------------------------------------------------- */
function readSupCtx() {
  try { return JSON.parse(localStorage.getItem(SUP_CTX_KEY) || 'null'); } catch (_) { return null; }
}
function writeSupCtx(ctx) {
  try { ctx ? localStorage.setItem(SUP_CTX_KEY, JSON.stringify(ctx)) : localStorage.removeItem(SUP_CTX_KEY); } catch (_) {}
}
function localAudits() {
  try { return JSON.parse(localStorage.getItem(SUP_LOCAL_AUDITS) || '[]'); } catch (_) { return []; }
}
function saveLocalAudit(a) {
  try { const l = localAudits(); l.unshift(a); localStorage.setItem(SUP_LOCAL_AUDITS, JSON.stringify(l.slice(0, 100))); } catch (_) {}
}

export const SupervisionEngine = {
  context: readSupCtx(),
  isActive(classroomId) {
    const c = this.context;
    return !!(c && (classroomId == null || Number(c.classroomId) === Number(classroomId)));
  },
  async enter({ classroomId, classroomName, teacherId, teacherName }) {
    const role = ST.role;
    const profile = ST.profile || {};
    let sessionId = null;
    const startedAt = new Date().toISOString();
    const res = await w(() => supabase.from('supervision_sessions')
      .insert({ classroom_id: classroomId, supervisor_id: profile.id || null, supervisor_role: role, status: 'active', started_at: startedAt })
      .select('id').single());
    if (res.ok && res.data) sessionId = res.data.id;

    this.context = {
      sessionId, classroomId, classroomName: classroomName || '',
      teacherId: teacherId || null, teacherName: teacherName || '',
      supervisorId: profile.id || null, supervisorName: profile.name || roleLabel(role),
      role, startedAt,
    };
    writeSupCtx(this.context);
    OD.updateBar();
    if (OD.wrap) OD.paint();
    OD.toast(`Modo supervisión activo en ${classroomName || 'aula'}`, 'ok');
    window.dispatchEvent(new CustomEvent('karpus:supervision-change', { detail: this.context }));
    return this.context;
  },
  launchMirror(ctx) {
    if (!ctx) return;
    const from = (window.location.pathname.split('/').pop() || 'panel_directora.html');
    const params = new URLSearchParams({ spv: '1', classroomId: String(ctx.classroomId), role: ctx.role, from });
    if (ctx.sessionId) params.set('sessionId', String(ctx.sessionId));
    window.location.href = 'panel-maestra.html?' + params.toString();
  },
  async exit() {
    const c = this.context;
    if (!c) return;
    if (c.sessionId) {
      await w(() => supabase.from('supervision_sessions')
        .update({ status: 'closed', ended_at: new Date().toISOString() }).eq('id', c.sessionId));
    }
    this.context = null;
    writeSupCtx(null);
    OD.updateBar();
    if (OD.wrap) OD.paint();
    OD.toast('Supervisión finalizada. Sesión auditada y cerrada.', 'info');
    window.dispatchEvent(new CustomEvent('karpus:supervision-change', { detail: null }));
  },
  async registerIntervention(payload) {
    const role = ST.role;
    const profile = ST.profile || {};
    const c = this.context || {};
    const code = genCode();
    const row = {
      code,
      session_id: c.sessionId || null,
      classroom_id: payload.classroomId || c.classroomId || null,
      teacher_id: payload.teacherId || c.teacherId || null,
      supervisor_id: profile.id || null,
      supervisor_role: role,
      priority: payload.priority || 'media',
      status: payload.status || 'abierta',
      category: payload.category || 'pedagogica',
      reason: payload.reason,
      action_taken: payload.action || null,
      notes: payload.notes || null,
    };
    const res = await w(() => supabase.from('supervision_audits').insert(row).select('*').single());
    if (res.ok && res.data) return res.data;
    const fallback = { ...row, id: 'local-' + Date.now(), created_at: new Date().toISOString(), _local: true };
    saveLocalAudit(fallback);
    return fallback;
  },
  async setStatus(id, status) {
    if (String(id).startsWith('local-')) {
      const l = localAudits();
      const idx = l.findIndex(a => String(a.id) === String(id));
      if (idx >= 0) { l[idx].status = status; localStorage.setItem(SUP_LOCAL_AUDITS, JSON.stringify(l)); }
      return true;
    }
    const res = await w(() => supabase.from('supervision_audits').update({ status }).eq('id', id));
    return res.ok;
  },
  async loadAudits() {
    const remote = await q(() => supabase.from('supervision_audits').select('*').order('created_at', { ascending: false }).limit(120), null);
    if (remote && remote.length) return remote;
    return localAudits();
  },
};

function genCode() {
  const y = new Date().getFullYear();
  return `INT-${y}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/* -------------------------------------------------------------------------- */
/*  Módulo principal                                                          */
/* -------------------------------------------------------------------------- */
const OD = {
  /* ---- ciclo de vida --------------------------------------------------- */
  async init(config = {}) {
    ST = {
      role: config.role || 'asistente',
      profile: config.profile || {},
      user: config.user || null,
      containerId: config.container || 'odOperativoRoot',
      tab: 'resumen',
      date: localDateISO(),
      search: '',
      levelFilter: 'all',
      intFilter: 'todas',
      data: {},
      classrooms: [],
      health: {},
      audits: [],
      isAfterCutoff: false,
      lastRefresh: null,
      refreshing: false,
    };

    this.showSkeleton();
    await this.load();
    await this.applySchedule();
    this.mountShell();
    this.paint();
    this.startAutoRefresh();
    this.wireFetchHeaders();
    this.updateBar();
    return this;
  },

  showSkeleton() {
    const wrap = this.wrap;
    if (!wrap) return;
    wrap.className = 'od-wrap';
    wrap.innerHTML = `
      <div class="od-hero" style="min-height:150px"></div>
      <div class="od-kpis">${'<div class="od-skel kpi"></div>'.repeat(4)}</div>
      <div class="od-tabs">${'<div class="od-skel" style="height:40px;flex:1;margin:6px"></div>'.repeat(4)}</div>
      <div class="od-grid">${'<div class="od-skel card"></div>'.repeat(3)}</div>`;
  },

  async refresh() {
    if (ST.refreshing) return;
    ST.refreshing = true;
    await this.load();
    await this.applySchedule();
    this.paint();
    ST.lastRefresh = new Date();
    ST.refreshing = false;
  },

  destroy() {
    if (ST?._timer) clearInterval(ST._timer);
    if (ST?._channels) ST._channels.forEach(ch => { try { supabase.removeChannel(ch); } catch (_) {} });
    try { document.getElementById('odSupervisionBar')?.remove(); } catch (_) {}
    try { document.getElementById('odModal')?.remove(); } catch (_) {}
    try { document.getElementById('odToastWrap')?.remove(); } catch (_) {}
    restoreFetch();
    refreshIcons();
  },

  async applySchedule() {
    try {
      const s = ST.data?.settings;
      const cutoff = (s?.check_in_end || '09:00');
      const [hh, mm] = String(cutoff).split(':').map(Number);
      const now = new Date();
      ST.isAfterCutoff = now.getHours() > (hh || 9) || (now.getHours() === (hh || 9) && now.getMinutes() >= (mm || 0));
    } catch (_) { ST.isAfterCutoff = new Date().getHours() >= 9; }
  },

  async load() {
    await loadData();
    ST.audits = await SupervisionEngine.loadAudits();
  },

  /* ---- helpers de DOM -------------------------------------------------- */
  get wrap() { return document.getElementById(ST.containerId); },

  mountShell() {
    const wrap = this.wrap;
    if (!wrap) return;
    wrap.className = 'od-wrap';
    wrap.innerHTML = `
      <div id="odHero"></div>
      <div class="od-tabs" id="odTabs" role="tablist">
        ${OD_TABS.map(t => `<button class="od-tab${t.key === ST.tab ? ' active' : ''}" data-od-tab="${t.key}" role="tab">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}
      </div>
      ${OD_TABS.map(t => `<div class="od-panel${t.key === ST.tab ? ' active' : ''}" id="odPanel-${t.key}"></div>`).join('')}
    `;
    this.ensureOverlays();
    this.bindShell();
  },

  ensureOverlays() {
    if (!document.getElementById('odSupervisionBar')) {
      const bar = document.createElement('div');
      bar.id = 'odSupervisionBar';
      document.body.appendChild(bar);
    }
    if (!document.getElementById('odToastWrap')) {
      const tw = document.createElement('div');
      tw.id = 'odToastWrap';
      document.body.appendChild(tw);
    }
  },

  bindShell() {
    const wrap = this.wrap;
    if (!wrap || wrap._odBound) return;
    wrap._odBound = true;
    wrap.addEventListener('click', (e) => this.onClick(e));
    wrap.addEventListener('input', (e) => this.onInput(e));
    wrap.addEventListener('change', (e) => this.onChange(e));
  },

  onClick(e) {
    const tabBtn = e.target.closest('[data-od-tab]');
    if (tabBtn) { this.switchTab(tabBtn.dataset.odTab); return; }

    const action = e.target.closest('[data-od-action]');
    if (action) {
      const a = action.dataset.odAction;
      const id = action.dataset.odId;
      switch (a) {
        case 'open-aula':   this.openAula(id); break;
        case 'supervise':   this.toggleSupervise(id); break;
        case 'intervene':   this.openIntervention(id); break;
        case 'refresh':     this.refresh(); break;
        case 'export':      this.exportCSV(); break;
        case 'print':       this.printReport(); break;
        case 'goto':        goto(action.dataset.odTarget); break;
        case 'set-status':  this.setAuditStatus(id, action.dataset.odStatus); break;
        case 'modal-tab':   this.modalTab(action.dataset.odId); break;
        case 'modal-close': this.closeModal(); break;
        case 'modal-supervise': this.superviseFromModal(); break;
        case 'modal-intervene': this.openIntervention(this.curAulaId); break;
      }
      return;
    }

    const card = e.target.closest('[data-od-aula]');
    if (card && !e.target.closest('[data-od-action]')) { this.openAula(card.dataset.odAula); }
  },

  onInput(e) {
    if (e.target.matches('[data-od-search]')) {
      ST.search = e.target.value;
      const tab = ST.tab;
      this.paintBody(tab);
      const inp = this.wrap?.querySelector(`#odPanel-${tab} [data-od-search]`);
      if (inp) { inp.focus(); const v = inp.value; try { inp.setSelectionRange(v.length, v.length); } catch (_) {} }
    }
  },

  onChange(e) {
    if (e.target.matches('[data-od-levelfilter]')) { ST.levelFilter = e.target.value; this.paintBody('organizacion'); this.paintBody('monitoreo'); }
    if (e.target.matches('[data-od-intfilter]')) { ST.intFilter = e.target.value; this.paintBody('intervenciones'); }
  },

  switchTab(key) {
    ST.tab = key;
    this.wrap?.querySelectorAll('.od-tab').forEach(b => b.classList.toggle('active', b.dataset.odTab === key));
    this.wrap?.querySelectorAll('.od-panel').forEach(p => p.classList.toggle('active', p.id === `odPanel-${key}`));
    this.paintBody(key);
    refreshIcons();
  },

  paint() {
    if (!this.wrap) return;
    this.paintHero();
    OD_TABS.forEach(t => this.paintBody(t.key));
    refreshIcons();
  },

  paintBody(tab) {
    const el = document.getElementById(`odPanel-${tab}`);
    if (!el) return;
    switch (tab) {
      case 'resumen': el.innerHTML = this.htmlResumen(); break;
      case 'organizacion': el.innerHTML = this.htmlOrganizacion(); break;
      case 'monitoreo': el.innerHTML = this.htmlMonitoreo(); break;
      case 'intervenciones': el.innerHTML = this.htmlIntervenciones(); break;
    }
    refreshIcons();
  },

  /* ---- HERO ------------------------------------------------------------ */
  paintHero() {
    const el = document.getElementById('odHero');
    if (!el) return;
    const h = ST.health;
    const semText = { ok: 'Operación estable', warn: 'Atención requerida', bad: 'Intervención crítica' }[h.level];
    const now = new Date();
    el.innerHTML = `
      <div class="od-hero">
        <div class="od-hero-top">
          <div>
            <div class="od-hero-eyebrow">Control de la Estancia · ${esc(roleLabel(ST.role))}</div>
            <h1 class="od-hero-title">Operativo Diario</h1>
            <div class="od-hero-sub">Supervisión en vivo de aulas, asistencia, rutinas infantiles e intervención pedagógica de Karpus Kids.</div>
          </div>
          <div class="od-hero-actions">
            <span class="od-clock">${icon('clock')} ${now.toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmtTime(now)}</span>
            <span class="od-sem ${h.level}"><span class="od-sem-dot"></span>${semText}</span>
          </div>
        </div>
        <div class="od-kpis">
          ${this.kpi('Matrícula activa', h.totalEnrolled, `${h.classroomCount} aulas operativas`, 'users')}
          ${this.kpi('Asistencia hoy', h.attendancePct + '%', `${h.totalAttended}/${h.totalEnrolled} presentes`, h.attendancePct >= 85 ? 'ok' : h.attendancePct >= 65 ? 'warn' : 'bad', 'user-check')}
          ${this.kpi('Salud operativa', h.avgScore, 'Índice promedio por aula', classForScore(h.avgScore), 'heart-pulse')}
          ${this.kpi('Pases de lista', `${h.attendanceTaken}/${h.classroomCount}`, 'Aulas con asistencia tomada', h.attendanceTaken === h.classroomCount ? 'ok' : 'warn', 'calendar-check-2')}
          ${this.kpi('Rutinas publicadas', `${h.routinesPublishedCount}/${h.routineClassrooms}`, 'Aulas con rutina publicada hoy', h.routineClassrooms === 0 || h.routinesPublishedCount === h.routineClassrooms ? 'ok' : 'warn', 'book-open')}
          ${this.kpi('Mensajes sin leer', h.unreadTotal, 'De maestras al equipo directivo', h.unreadTotal === 0 ? 'ok' : 'warn', 'mail')}
          ${this.kpi('Incidentes abiertos', h.openIncidents, 'Requieren seguimiento', h.openIncidents === 0 ? 'ok' : 'bad', 'alert-triangle')}
        </div>
      </div>`;
  },

  kpi(label, value, foot, state, ic) {
    const cls = ['ok', 'warn', 'bad'].includes(state) ? state : '';
    const icHtml = ic ? `${icon(ic)}` : '';
    return `<div class="od-kpi ${cls}">
      <div class="od-flex" style="justify-content:space-between;align-items:flex-start">
        <div class="od-kpi-label">${esc(label)}</div>
        <span style="color:var(--od-ink-mute)">${icHtml}</span>
      </div>
      <div class="od-kpi-value">${esc(value)}</div>
      <div class="od-kpi-foot">${esc(foot)}</div>
    </div>`;
  },

  /* ---- RESUMEN --------------------------------------------------------- */
  htmlResumen() {
    const h = ST.health;
    const byGroup = this.groupCounts();
    const recent = (ST.data.attendance || [])
      .filter(a => a.check_in)
      .sort((a, b) => new Date(b.check_in) - new Date(a.check_in))
      .slice(0, 8);
    const studentMap = {};
    (ST.data.students || []).forEach(s => { studentMap[s.id] = s; });

    const grouped = this.groupIssues(h.issues).slice(0, 12);

    return `
      <div class="od-card">
        <div class="od-card-head">
          <div class="od-card-title">${icon('alert-triangle')} Centro de Alertas Operativas</div>
          <span class="od-card-sub">${grouped.length ? grouped.length + (grouped.length === 1 ? ' aula con novedades' : ' aulas con novedades') : 'Sin novedades'}</span>
        </div>
        ${grouped.length ? `<div class="od-alerts">${grouped.map(g => this.alertGroupHTML(g)).join('')}</div>`
          : `<div class="od-empty">${icon('check-circle')}<p>Todo en orden. No hay alertas operativas.</p></div>`}
      </div>

      <div class="od-section-label">Distribución por nivel pedagógico</div>
      <div class="od-grid">
        ${byGroup.map(g => `
          <div class="od-card" style="border-left:4px solid ${g.color}">
            <div class="od-card-head" style="margin-bottom:8px">
              <div class="od-card-title">${icon(g.icon)} ${esc(g.label)}</div>
              <span class="od-chip info">${g.aulas} aulas</span>
            </div>
            <div class="od-bar-row"><span>${g.students} estudiantes</span><span>Ratio ${'1:' + g.ratio}</span></div>
            <div class="od-bar ${g.occupancy > 95 ? 'bad' : g.occupancy > 85 ? 'warn' : ''}"><span style="width:${clamp(g.occupancy, 0, 100)}%"></span></div>
            <div class="od-bar-row"><span>Ocupación media</span><span>${g.occupancy}%</span></div>
          </div>`).join('')}
      </div>

      <div class="od-card od-mt">
        <div class="od-card-head">
          <div class="od-card-title">${icon('log-in')} Entradas recientes de hoy</div>
          <button class="od-btn sm ghost" data-od-action="goto" data-od-target="asistencia">${icon('arrow-right')} Asistencia</button>
        </div>
        ${recent.length ? `
        <div class="od-table-wrap">
          <table class="od-table">
            <thead><tr><th>Estudiante</th><th>Aula</th><th>Estado</th><th>Entrada</th></tr></thead>
            <tbody>${recent.map(a => {
              const st = studentMap[a.student_id];
              return `<tr>
                <td class="od-cell-name"><span class="od-avatar sm">${esc(initials(st?.name))}</span>${esc(st?.name || '—')}</td>
                <td>${esc((ST.classrooms.find(c => c.id === a.classroom_id) || {}).name || '—')}</td>
                <td><span class="od-chip ${normStatus(a.status) === 'present' ? 'ok' : normStatus(a.status) === 'absent' ? 'bad' : 'warn'}">${esc(ATT_LABEL[normStatus(a.status)] || '—')}</span></td>
                <td>${esc(fmtTime(a.check_in))}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>` : `<div class="od-empty">${icon('inbox')}<p>Sin registros de entrada todavía.</p></div>`}
      </div>`;
  },

  groupIssues(issues) {
    const byClass = new Map();
    const standalone = [];
    (issues || []).forEach(i => {
      const c = i.classroom;
      if (c && c.id != null) {
        if (!byClass.has(c.id)) byClass.set(c.id, { classroom: c, level: 'ok', items: [] });
        const g = byClass.get(c.id);
        g.items.push(i);
        if (i.level === 'bad') g.level = 'bad';
        else if (i.level === 'warn' && g.level !== 'bad') g.level = 'warn';
      } else {
        standalone.push({ standalone: i });
      }
    });
    return [...byClass.values(), ...standalone];
  },

  alertGroupHTML(g) {
    if (g.standalone) return this.alertHTML(g.standalone);
    const c = g.classroom;
    const headIcon = g.items.length === 1 ? g.items[0].icon : 'alert-triangle';
    return `<div class="od-alert ${g.level}">
      <div class="od-alert-icon">${icon(headIcon)}</div>
      <div class="od-alert-body">
        <div class="od-alert-title">${esc(c.name)}</div>
        <ul class="od-alert-list">
          ${g.items.map(i => `<li>
            <span class="od-li-title">${icon(i.icon)}${esc(i.short || i.title)}</span>
            <span class="od-li-text">${esc(i.text)}</span>
          </li>`).join('')}
        </ul>
        <div class="od-alert-actions">
          <button class="od-btn sm" data-od-action="open-aula" data-od-id="${c.id}">${icon('search')} Ver aula</button>
          <button class="od-btn sm ghost" data-od-action="supervise" data-od-id="${c.id}">${icon('shield-check')} Supervisar</button>
          <button class="od-btn sm ghost" data-od-action="intervene" data-od-id="${c.id}">${icon('clipboard-list')} Intervenir</button>
        </div>
      </div>
    </div>`;
  },

  alertHTML(i) {
    const c = i.classroom;
    return `<div class="od-alert ${i.level}">
      <div class="od-alert-icon">${icon(i.icon)}</div>
      <div class="od-alert-body">
        <div class="od-alert-title">${esc(i.title)}</div>
        <div class="od-alert-text">${esc(i.text)}</div>
        ${c ? `<div class="od-alert-actions">
          <button class="od-btn sm" data-od-action="open-aula" data-od-id="${c.id}">${icon('search')} Ver aula</button>
          <button class="od-btn sm ghost" data-od-action="supervise" data-od-id="${c.id}">${icon('shield-check')} Supervisar</button>
          <button class="od-btn sm ghost" data-od-action="intervene" data-od-id="${c.id}">${icon('clipboard-list')} Intervenir</button>
        </div>` : ''}
      </div>
    </div>`;
  },

  /* ---- ORGANIZACIÓN ---------------------------------------------------- */
  htmlOrganizacion() {
    let list = ST.classrooms;
    if (ST.levelFilter !== 'all') list = list.filter(c => c.group.key === ST.levelFilter);
    const s = ST.search.trim().toLowerCase();
    if (s) list = list.filter(c => (`${c.name} ${c.level || ''} ${c.teacher?.name || ''}`).toLowerCase().includes(s));

    const toolbar = `
      <div class="od-toolbar">
        <div class="od-search od-grow">${icon('search')}<input data-od-search placeholder="Buscar aula o docente..." value="${esc(ST.search)}"></div>
        <select class="od-select" data-od-levelfilter>
          <option value="all">Todos los niveles</option>
          ${LEVEL_GROUPS.map(g => `<option value="${g.key}"${ST.levelFilter === g.key ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}
        </select>
        <button class="od-btn ghost sm" data-od-action="refresh">${icon('refresh-cw')} Actualizar</button>
      </div>`;

    if (!list.length) return toolbar + `<div class="od-card od-mt"><div class="od-empty">${icon('school')}<p>Sin aulas para este filtro.</p></div></div>`;

    const order = LEVEL_GROUPS.map(g => g.key);
    const sorted = [...list].sort((a, b) => {
      const d = order.indexOf(a.group.key) - order.indexOf(b.group.key);
      return d !== 0 ? d : a.name.localeCompare(b.name, 'es');
    });

    const rows = sorted.map(c => {
      const sup = SupervisionEngine.isActive(c.id);
      const t = c.teacher;
      const routineChip = c.enrolledCount === 0
        ? '<span class="od-muted">—</span>'
        : c.publishedCount >= c.enrolledCount
          ? `<span class="od-chip ok">${icon('check')} Publicada</span>`
          : c.publishedCount > 0
            ? `<span class="od-chip warn">${icon('book-open')} ${c.publishedCount}/${c.enrolledCount}</span>`
            : `<span class="od-chip bad">${icon('book-x')} Sin publicar</span>`;
      const mailChip = c.unread > 0
        ? `<span class="od-chip warn" title="${esc(c.unreadSample)}">${icon('mail')} ${c.unread} sin leer</span>`
        : '<span class="od-muted">—</span>';
      return `<tr data-od-aula="${c.id}" style="cursor:pointer"${sup ? ' class="od-row-sup"' : ''}>
        <td class="od-cell-name">${esc(c.name)}${sup ? ' <span class="od-chip info">Supervisada</span>' : ''}</td>
        <td><span class="od-chip" style="background:${c.group.color}22;color:${c.group.color}">${esc(c.group.label)}</span></td>
        <td class="od-cell-name"><span class="od-avatar sm">${t?.avatar_url ? `<img class="od-avatar sm" src="${esc(t.avatar_url)}" alt="">` : esc(initials(t?.name || '?'))}</span>${esc(t?.name || '— sin asignar —')}</td>
        <td>${c.enrolledCount}/${c.capacity || '—'}</td>
        <td><span class="od-chip ${c.occupancy > 100 ? 'bad' : c.occupancy > 90 ? 'warn' : ''}">${c.occupancy}%</span></td>
        <td>1:${c.group.ratio}</td>
        <td><span class="od-chip ${c.attPct >= 85 ? 'ok' : c.attPct >= 50 ? 'warn' : 'bad'}">${c.attPct}%</span></td>
        <td>${routineChip}</td>
        <td>${mailChip}</td>
        <td><span class="od-sem plain ${c.status}"><span class="od-sem-dot"></span>${c.score}</span></td>
        <td>
          <div class="od-flex" style="gap:5px;flex-wrap:nowrap">
            <button class="od-btn sm ghost" data-od-action="open-aula" data-od-id="${c.id}" title="Ver ficha">${icon('search')}</button>
            <button class="od-btn sm ${sup ? 'danger' : 'ghost'}" data-od-action="supervise" data-od-id="${c.id}" title="${sup ? 'Salir de supervisión' : 'Supervisar aula'}">${icon('shield-check')}</button>
            <button class="od-btn sm ghost" data-od-action="intervene" data-od-id="${c.id}" title="Registrar intervención">${icon('clipboard-list')}</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    return toolbar + `
      <div class="od-card od-mt">
        <div class="od-card-head">
          <div class="od-card-title">${icon('network')} Aulas y personal · ${esc(ST.date)}</div>
          <span class="od-card-sub">Clic en una fila para abrir la ficha del aula</span>
        </div>
        <div class="od-table-wrap">
          <table class="od-table od-table-wide">
            <thead><tr>
              <th>Aula</th><th>Nivel</th><th>Docente</th><th>Matrícula</th><th>Ocupación</th>
              <th>Ratio</th><th>Asist.</th><th>Rutina</th><th>Mensajes</th><th>Salud</th><th>Acciones</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  },

  /* ---- MONITOREO ------------------------------------------------------- */
  htmlMonitoreo() {
    let list = ST.classrooms;
    if (ST.levelFilter !== 'all') list = list.filter(c => c.group.key === ST.levelFilter);
    const s = ST.search.trim().toLowerCase();
    if (s) list = list.filter(c => (`${c.name} ${c.teacher?.name || ''}`).toLowerCase().includes(s));

    const toolbar = `
      <div class="od-toolbar">
        <div class="od-search od-grow">${icon('search')}<input data-od-search placeholder="Filtrar aulas..." value="${esc(ST.search)}"></div>
        <select class="od-select" data-od-levelfilter>
          <option value="all">Todos los niveles</option>
          ${LEVEL_GROUPS.map(g => `<option value="${g.key}"${ST.levelFilter === g.key ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}
        </select>
        <button class="od-btn ghost sm" data-od-action="refresh">${icon('refresh-cw')} En vivo</button>
        <button class="od-btn ghost sm" data-od-action="export">${icon('download')} CSV</button>
        <button class="od-btn ghost sm" data-od-action="print">${icon('printer')} Reporte</button>
      </div>`;

    if (!list.length) return toolbar + `<div class="od-card od-mt"><div class="od-empty">${icon('activity')}<p>Sin datos de monitoreo.</p></div></div>`;

    const rows = list.map(c => {
      const upd = c.lastUpdate ? `${Math.round(minutesSince(c.lastUpdate))} min` : '—';
      return `<tr data-od-aula="${c.id}" style="cursor:pointer">
        <td class="od-cell-name">${esc(c.name)}<br><span class="od-chip ${c.status}" style="margin-top:4px">${c.status === 'ok' ? 'Estable' : c.status === 'warn' ? 'Atención' : 'Crítico'}</span></td>
        <td>${esc(c.teacher?.name || '— sin asignar —')}</td>
        <td>${c.enrolledCount}/${c.capacity}</td>
        <td><span class="od-chip ${c.attPct >= 85 ? 'ok' : c.attPct >= 50 ? 'warn' : 'bad'}">${c.attPct}%</span> <span class="od-muted" style="font-size:11px">(${c.counts.present}P · ${c.counts.absent}A${c.counts.late ? ' · ' + c.counts.late + 'T' : ''})</span></td>
        <td><span class="od-chip ${c.foodPct >= 80 ? 'ok' : c.foodPct >= 40 ? 'warn' : ''}">${c.foodPct}%</span></td>
        <td><span class="od-chip ${c.napPct >= 80 ? 'ok' : c.napPct >= 40 ? 'warn' : ''}">${c.napPct}%</span></td>
        <td>${c.infantRecords || 0}</td>
        <td>${c.openIncidents ? `<span class="od-chip bad">${c.openIncidents}</span>` : '<span class="od-muted">—</span>'}</td>
        <td>${esc(upd)}</td>
        <td>
          <div class="od-flex" style="gap:5px;flex-wrap:nowrap">
            <button class="od-btn sm ghost" data-od-action="open-aula" data-od-id="${c.id}" title="Ficha">${icon('search')}</button>
            <button class="od-btn sm ghost" data-od-action="supervise" data-od-id="${c.id}" title="Supervisar">${icon('shield-check')}</button>
            <button class="od-btn sm ghost" data-od-action="intervene" data-od-id="${c.id}" title="Intervenir">${icon('clipboard-list')}</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    return toolbar + `
      <div class="od-card od-mt">
        <div class="od-card-head">
          <div class="od-card-title">${icon('activity')} Matriz de seguimiento · ${esc(ST.date)}</div>
          <span class="od-card-sub">Clic en una fila para abrir la ficha del aula</span>
        </div>
        <div class="od-table-wrap">
          <table class="od-table">
            <thead><tr>
              <th>Aula</th><th>Docente</th><th>Ocupación</th><th>Asistencia</th>
              <th>Alim.</th><th>Sueño</th><th>Esfínteres</th><th>Inc.</th><th>Últ. act.</th><th>Acciones</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  },

  /* ---- INTERVENCIONES -------------------------------------------------- */
  htmlIntervenciones() {
    const sup = SupervisionEngine.context;
    let list = ST.audits || [];
    if (ST.intFilter !== 'todas') list = list.filter(a => a.status === ST.intFilter);
    const s = ST.search.trim().toLowerCase();
    if (s) list = list.filter(a => (`${a.code} ${a.reason} ${a.classroom_id}`).toLowerCase().includes(s));

    const cmap = {}; ST.classrooms.forEach(c => { cmap[c.id] = c; });

    const toolbar = `
      <div class="od-toolbar">
        ${sup ? `<button class="od-btn primary" data-od-action="intervene" data-od-id="${sup.classroomId}">${icon('plus')} Nueva intervención (aula supervisada)</button>`
              : `<span class="od-chip info">${icon('eye')} Activa el modo supervisión para registrar en contexto</span>`}
        <div class="od-search od-grow">${icon('search')}<input data-od-search placeholder="Buscar por código, motivo..." value="${esc(ST.search)}"></div>
        <select class="od-select" data-od-intfilter>
          <option value="todas"${ST.intFilter === 'todas' ? ' selected' : ''}>Todos los estados</option>
          <option value="abierta"${ST.intFilter === 'abierta' ? ' selected' : ''}>Abiertas</option>
          <option value="en_proceso"${ST.intFilter === 'en_proceso' ? ' selected' : ''}>En proceso</option>
          <option value="resuelta"${ST.intFilter === 'resuelta' ? ' selected' : ''}>Resueltas</option>
        </select>
        <button class="od-btn ghost sm" data-od-action="refresh">${icon('refresh-cw')} Actualizar</button>
      </div>`;

    if (!list.length) return toolbar + `<div class="od-card od-mt"><div class="od-empty">${icon('clipboard-list')}<p>No hay intervenciones registradas.</p></div></div>`;

    const canClose = ST.role === 'directora' || ST.role === 'admin';

    return toolbar + `<div class="od-card od-mt">
      <div class="od-card-head">
        <div class="od-card-title">${icon('clipboard-list')} Centro de Intervenciones</div>
        <span class="od-card-sub">${list.length} registros auditables</span>
      </div>
      <div class="od-table-wrap">
        <table class="od-table">
          <thead><tr><th>Código</th><th>Aula</th><th>Prioridad</th><th>Motivo</th><th>Responsable</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>
          <tbody>${list.map(a => {
            const c = cmap[a.classroom_id];
            const pri = a.priority || 'media';
            return `<tr>
              <td><strong>${esc(a.code || '—')}</strong>${a._local ? ' <span class="od-chip warn">local</span>' : ''}</td>
              <td>${esc(c?.name || ('Aula #' + (a.classroom_id || '—')))}</td>
              <td><span class="od-chip ${pri === 'alta' ? 'bad' : pri === 'media' ? 'warn' : ''}">${esc(PRI_LABEL[pri] || pri)}</span></td>
              <td style="max-width:280px">${esc(a.reason || '—')}</td>
              <td>${esc(roleLabel(a.supervisor_role))}</td>
              <td><span class="od-chip ${a.status === 'resuelta' ? 'ok' : a.status === 'en_proceso' ? 'info' : 'warn'}">${esc(INT_STATUS_LABEL[a.status] || a.status)}</span></td>
              <td>${esc(fmtDateTime(a.created_at))}</td>
              <td>${canClose && a.status !== 'resuelta' ? `<button class="od-btn sm ok" data-od-action="set-status" data-od-id="${esc(a.id)}" data-od-status="resuelta">${icon('check')} Resolver</button>` : ''}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>`;
  },

  groupCounts() {
    const res = {};
    LEVEL_GROUPS.forEach(g => { res[g.key] = { ...g, aulas: 0, students: 0, occSum: 0, occupancy: 0 }; });
    ST.classrooms.forEach(c => {
      const r = res[c.group.key] || res.otras;
      r.aulas++; r.students += c.enrolledCount; r.occSum += c.occupancy;
    });
    Object.values(res).forEach(r => { r.occupancy = r.aulas ? Math.round(r.occSum / r.aulas) : 0; });
    return LEVEL_GROUPS.map(g => res[g.key]);
  },

  /* ---- acción: supervisar ---------------------------------------------- */
  async toggleSupervise(id) {
    const c = ST.classrooms.find(x => x.id === Number(id));
    if (!c) return;
    if (SupervisionEngine.isActive(c.id)) {
      await SupervisionEngine.exit();
    } else {
      const ctx = await SupervisionEngine.enter({
        classroomId: c.id, classroomName: c.name,
        teacherId: c.teacher?.id || null, teacherName: c.teacher?.name || '',
      });
      // Pere operativo.md 3.2: abrir el Panel de la Maestra en modo espejo,
      // NO un modal de ficha. La barra #spv-supervision-bar se monta allá.
      SupervisionEngine.launchMirror(ctx);
    }
  },

  updateBar() {
    const bar = document.getElementById('odSupervisionBar');
    if (!bar) return;
    const c = SupervisionEngine.context;
    if (!c) { bar.classList.remove('active'); bar.innerHTML = ''; return; }
    const started = new Date(c.startedAt);
    const mins = Math.max(0, Math.round((Date.now() - started.getTime()) / 60000));
    bar.classList.add('active');
    bar.innerHTML = `
      <span class="od-sup-live"><span class="dot"></span> SUPERVISIÓN ACTIVA</span>
      <span>${icon('school')} ${esc(c.classroomName || 'Aula')}</span>
      <span class="od-sup-meta">Docente: ${esc(c.teacherName || '—')}</span>
      <span class="od-sup-meta">Sello: ${esc(roleLabel(c.role))}</span>
      <span class="od-sup-meta">${icon('timer')} ${mins} min</span>
      <span class="od-sup-spacer"></span>
      <button class="od-btn sm" onclick="window.OperativoDiarioModule.openIntervention(${c.classroomId})">${icon('clipboard-list')} Registrar intervención</button>
      <button class="od-btn sm" onclick="window.OperativoDiarioModule.exitSupervision()">${icon('log-out')} Salir de supervisión</button>`;
    refreshIcons();
  },

  async exitSupervision() { await SupervisionEngine.exit(); },

  /* ---- Ficha de aula (modal) ------------------------------------------- */
  openAula(id) {
    const c = ST.classrooms.find(x => x.id === Number(id));
    if (!c) return;
    this.curAulaId = c.id;
    this.curModalTab = 'general';
    let modal = document.getElementById('odModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'odModal';
      modal.className = 'od-modal';
      document.body.appendChild(modal);
    }
    modal.classList.add('open');
    modal.onclick = (e) => { if (e.target === modal) this.closeModal(); };
    this.paintModal(c);
  },

  closeModal() {
    document.getElementById('odModal')?.classList.remove('open');
    this.curAulaId = null;
  },

  modalTab(tab) {
    this.curModalTab = tab;
    const c = ST.classrooms.find(x => x.id === this.curAulaId);
    if (c) this.paintModal(c);
  },

  paintModal(c) {
    const modal = document.getElementById('odModal');
    if (!modal) return;
    const sup = SupervisionEngine.isActive(c.id);
    const tabs = [
      ['general', 'General'], ['estudiantes', 'Estudiantes'],
      ['rutinas', 'Asistencia / Rutinas'], ['personal', 'Personal'],
    ];
    const body = {
      general: this.modalGeneral(c),
      estudiantes: this.modalStudents(c),
      rutinas: this.modalRoutines(c),
      personal: this.modalStaff(c),
    }[this.curModalTab] || '';

    modal.querySelector('.od-modal-box')?.remove();
    const box = document.createElement('div');
    box.className = 'od-modal-box';
    box.innerHTML = `
      <div class="od-modal-head">
        <div>
          <h3>${esc(c.name)} ${sup ? '<span class="od-chip info">En supervisión</span>' : ''}</h3>
          <div class="od-modal-sub">${esc(c.level || c.group.label)} · ${esc(c.group.age)} · Capacidad ${c.capacity} · Ratio sugerido 1:${c.group.ratio}</div>
        </div>
        <button class="od-modal-x" data-od-action="modal-close">${icon('x')}</button>
      </div>
      <div class="od-modal-tabs">
        ${tabs.map(([k, l]) => `<button class="od-modal-tab${this.curModalTab === k ? ' active' : ''}" data-od-action="modal-tab" data-od-id="${k}">${l}</button>`).join('')}
      </div>
      <div class="od-modal-body">${body}</div>
      <div class="od-modal-foot">
        <button class="od-btn ghost" data-od-action="modal-intervene">${icon('clipboard-list')} Registrar intervención</button>
        <button class="od-btn ${sup ? 'danger' : 'primary'}" data-od-action="modal-supervise">${icon('shield-check')} ${sup ? 'Salir de supervisión' : 'Iniciar supervisión'}</button>
      </div>`;
    modal.appendChild(box);
    box.addEventListener('click', (e) => this.onClick(e));
    refreshIcons();
  },

  modalGeneral(c) {
    const teacher = c.teacher;
    return `
      <div class="od-kv">
        <div class="od-kv-item"><span class="k">Matriculados</span><span class="v">${c.enrolledCount}</span></div>
        <div class="od-kv-item"><span class="k">Capacidad</span><span class="v">${c.capacity || '—'}</span></div>
        <div class="od-kv-item"><span class="k">Ocupación</span><span class="v">${c.occupancy}%</span></div>
        <div class="od-kv-item"><span class="k">Ratio docente</span><span class="v">1:${c.group.ratio}</span></div>
        <div class="od-kv-item"><span class="k">Docente titular</span><span class="v">${esc(teacher?.name || 'Sin asignar')}</span></div>
        <div class="od-kv-item"><span class="k">Salud del aula</span><span class="v">${c.score}/100</span></div>
      </div>
      <div class="od-section-label">Indicadores del día</div>
      <div class="od-kv">
        <div class="od-kv-item"><span class="k">Asistencia</span><span class="v">${c.attPct}% (${c.attended}/${c.enrolledCount})</span></div>
        <div class="od-kv-item"><span class="k">Alimentación</span><span class="v">${c.foodPct}%</span></div>
        <div class="od-kv-item"><span class="k">Sueño</span><span class="v">${c.napPct}%</span></div>
        <div class="od-kv-item"><span class="k">Registros de esfínteres</span><span class="v">${c.infantRecords}</span></div>
        <div class="od-kv-item"><span class="k">Rutina publicada</span><span class="v">${c.enrolledCount === 0 ? '—' : c.routinePublished ? `Sí (${c.publishedCount}/${c.enrolledCount})` : 'No publicada'}</span></div>
        <div class="od-kv-item"><span class="k">Mensajes sin leer</span><span class="v">${c.unread}</span></div>
        <div class="od-kv-item"><span class="k">Incidentes abiertos</span><span class="v">${c.openIncidents}</span></div>
        <div class="od-kv-item"><span class="k">Última actualización</span><span class="v">${c.lastUpdate ? fmtTime(c.lastUpdate) : '—'}</span></div>
      </div>`;
  },

  modalStudents(c) {
    if (!c.enrolled.length) return `<div class="od-empty">${icon('users')}<p>Sin estudiantes matriculados en esta aula.</p></div>`;
    return `<div class="od-table-wrap"><table class="od-table">
      <thead><tr><th>Estudiante</th><th>Edad</th><th>Asistencia</th><th>Alergias / Condiciones</th></tr></thead>
      <tbody>${c.enrolled.map(s => {
        const att = (ST.data.attendance || []).find(x => x.student_id === s.id && x.classroom_id === c.id);
        const st = att ? normStatus(att.status) : 'none';
        const cond = [s.allergies, s.medical_conditions].filter(Boolean).join(' · ');
        return `<tr>
          <td class="od-cell-name"><span class="od-avatar sm">${s.avatar_url ? `<img class="od-avatar sm" src="${esc(s.avatar_url)}" alt="">` : esc(initials(s.name))}</span>${esc(s.name)}</td>
          <td>${s.age ? esc(s.age + ' ' + (s.age_type || 'años')) : '—'}</td>
          <td><span class="od-chip ${st === 'present' ? 'ok' : st === 'absent' ? 'bad' : st === 'none' ? '' : 'warn'}">${esc(ATT_LABEL[st] || 'Sin registro')}</span></td>
          <td>${cond ? `<span class="od-chip warn">${icon('alert-triangle')} ${esc(cond)}</span>` : '<span class="od-muted">—</span>'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  },

  modalRoutines(c) {
    const logsByStudent = {};
    (ST.data.logs || []).forEach(l => { if (l.classroom_id === c.id) logsByStudent[l.student_id] = l; });
    if (!c.enrolled.length) return `<div class="od-empty">${icon('sparkles')}<p>Sin estudiantes para mostrar rutinas.</p></div>`;
    const summary = c.routinePublished
      ? `<span class="od-chip ${c.publishedCount >= c.enrolledCount ? 'ok' : 'warn'}">${icon('book-open')} Rutina ${c.publishedCount}/${c.enrolledCount} publicada(s)</span>`
      : `<span class="od-chip bad">${icon('book-x')} La maestra aún no ha publicado la rutina de hoy</span>`;
    return `<div class="od-flex" style="gap:8px;align-items:center">${summary}
        <span class="od-chip ${c.unread > 0 ? 'warn' : ''}">${icon('mail')} ${c.unread} mensaje(s) sin leer</span>
      </div>
      <div class="od-table-wrap od-mt"><table class="od-table">
      <thead><tr><th>Estudiante</th><th>Ánimo</th><th>Alimentación</th><th>Sueño</th><th>Esfínteres</th><th>Estado</th></tr></thead>
      <tbody>${c.enrolled.map(s => {
        const l = logsByStudent[s.id];
        const infant = Array.isArray(l?.infant_data) ? l.infant_data.length : 0;
        return `<tr>
          <td class="od-cell-name">${esc(s.name)}</td>
          <td>${l?.mood ? esc(l.mood) : '<span class="od-muted">—</span>'}</td>
          <td>${l?.food ? esc(l.food) : '<span class="od-muted">—</span>'}</td>
          <td>${(l?.nap || l?.sleeping) ? esc(l.nap || l.sleeping) : '<span class="od-muted">—</span>'}</td>
          <td>${infant ? `<span class="od-chip info">${infant} registros</span>` : '<span class="od-muted">—</span>'}</td>
          <td><span class="od-chip ${l?.status === 'published' ? 'ok' : l ? 'warn' : ''}">${l ? (l.status === 'published' ? 'Publicado' : 'Borrador') : 'Sin registro'}</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  },

  modalStaff(c) {
    const list = (ST.data.profiles || []);
    const teacher = c.teacher;
    const staff = teacher ? [teacher] : [];
    return `
      <div class="od-flex" style="gap:12px;align-items:center">
        <span class="od-avatar">${teacher?.avatar_url ? `<img class="od-avatar" src="${esc(teacher.avatar_url)}" alt="">` : esc(initials(teacher?.name || '?'))}</span>
        <div><div class="od-teacher-name">${esc(teacher?.name || 'Sin docente asignada')}</div><div class="od-teacher-role">Maestra titular</div></div>
      </div>
      <div class="od-section-label">Directorio de personal</div>
      <div class="od-flex" style="gap:8px">
        ${list.length ? list.slice(0, 12).map(p => `<span class="od-chip">${icon('user')} ${esc(p.name || p.email || 'Staff')}${p.role ? ' · ' + esc(roleLabel(p.role)) : ''}</span>`).join('') : '<span class="od-muted">Sin datos de personal.</span>'}
      </div>`;
  },

  async superviseFromModal() {
    const id = this.curAulaId;
    await this.toggleSupervise(id);
    const c = ST.classrooms.find(x => x.id === this.curAulaId);
    if (c) this.paintModal(c);
  },

  /* ---- Modal de intervención ------------------------------------------- */
  openIntervention(classroomId) {
    const c = ST.classrooms.find(x => x.id === Number(classroomId)) || (SupervisionEngine.context && ST.classrooms.find(x => x.id === Number(SupervisionEngine.context.classroomId)));
    let modal = document.getElementById('odModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'odModal';
      modal.className = 'od-modal';
      document.body.appendChild(modal);
    }
    modal.classList.add('open');
    modal.onclick = (e) => { if (e.target === modal) this.closeModal(); };
    modal.querySelector('.od-modal-box')?.remove();
    const box = document.createElement('div');
    box.className = 'od-modal-box';
    box.innerHTML = `
      <div class="od-modal-head">
        <div>
          <h3>Registrar intervención</h3>
          <div class="od-modal-sub">Quedará auditada con código único y sello de ${esc(roleLabel(ST.role))}</div>
        </div>
        <button class="od-modal-x" data-od-action="modal-close">${icon('x')}</button>
      </div>
      <div class="od-modal-body">
        <div class="od-field">
          <label>Aula</label>
          <select id="odIntClassroom">
            <option value="">— Seleccionar aula —</option>
            ${ST.classrooms.map(x => `<option value="${x.id}"${c && x.id === c.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select>
        </div>
        <div class="od-field-row">
          <div class="od-field">
            <label>Categoría</label>
            <select id="odIntCategory">
              ${CATEGORIES.map(cat => `<option value="${cat}">${esc(cat[0].toUpperCase() + cat.slice(1))}</option>`).join('')}
            </select>
          </div>
          <div class="od-field">
            <label>Prioridad</label>
            <div class="od-pri">
              <input type="radio" name="odPri" id="odPriB" value="baja"><label for="odPriB">Baja</label>
              <input type="radio" name="odPri" id="odPriM" value="media" checked><label for="odPriM">Media</label>
              <input type="radio" name="odPri" id="odPriA" value="alta"><label for="odPriA">Alta</label>
            </div>
          </div>
        </div>
        <div class="od-field">
          <label>Motivo de la intervención *</label>
          <textarea id="odIntReason" placeholder="Describa el hallazgo o situación observada..."></textarea>
        </div>
        <div class="od-field">
          <label>Acción directiva adoptada</label>
          <textarea id="odIntAction" placeholder="Medida o indicación dada a la docente..."></textarea>
        </div>
        <div class="od-field">
          <label>Notas / acta</label>
          <textarea id="odIntNotes" placeholder="Observaciones adicionales para el expediente..."></textarea>
        </div>
      </div>
      <div class="od-modal-foot">
        <button class="od-btn ghost" data-od-action="modal-close">Cancelar</button>
        <button class="od-btn primary" id="odIntSave">${icon('save')} Registrar intervención</button>
      </div>`;
    modal.appendChild(box);
    box.addEventListener('click', (e) => this.onClick(e));
    document.getElementById('odIntSave').addEventListener('click', () => this.saveIntervention());
    refreshIcons();
  },

  async saveIntervention() {
    const classroomId = Number(document.getElementById('odIntClassroom')?.value) || null;
    const reason = document.getElementById('odIntReason')?.value?.trim();
    if (!reason) { this.toast('El motivo es obligatorio', 'warn'); return; }
    const priority = document.querySelector('input[name="odPri"]:checked')?.value || 'media';
    const category = document.getElementById('odIntCategory')?.value || 'pedagogica';
    const action = document.getElementById('odIntAction')?.value?.trim() || '';
    const notes = document.getElementById('odIntNotes')?.value?.trim() || '';
    const c = ST.classrooms.find(x => x.id === classroomId);

    const btn = document.getElementById('odIntSave');
    if (btn) { btn.disabled = true; btn.innerHTML = `${icon('loader')} Guardando...`; }

    const saved = await SupervisionEngine.registerIntervention({
      classroomId, teacherId: c?.teacher?.id || null,
      priority, category, reason, action, notes,
    });

    const audits = await SupervisionEngine.loadAudits();
    ST.audits = audits;

    this.closeModal();
    this.toast(`Intervención ${saved?.code || ''} registrada`, 'ok');
    if (ST.tab === 'intervenciones') this.paintBody('intervenciones');
    this.paintHero();
  },

  async setAuditStatus(id, status) {
    await SupervisionEngine.setStatus(id, status);
    ST.audits = await SupervisionEngine.loadAudits();
    this.paintBody('intervenciones');
    this.toast('Estado de la intervención actualizado', 'ok');
  },

  /* ---- Export / impresión ---------------------------------------------- */
  exportCSV() {
    const rows = [['Aula', 'Docente', 'Nivel', 'Matriculados', 'Capacidad', 'Ocupacion%', 'Asistencia%', 'Presentes', 'Ausentes', 'Alimentacion%', 'Sueno%', 'Esfinteres', 'RutinaPublicada', 'RutinasPublicadas', 'MensajesSinLeer', 'Incidentes', 'Salud']];
    ST.classrooms.forEach(c => rows.push([
      c.name, c.teacher?.name || '', c.level || c.group.label, c.enrolledCount, c.capacity, c.occupancy,
      c.attPct, c.counts.present, c.counts.absent, c.foodPct, c.napPct, c.infantRecords,
      c.enrolledCount === 0 ? '' : (c.routinePublished ? 'Si' : 'No'), c.publishedCount, c.unread,
      c.openIncidents, c.score,
    ]));
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `operativo-diario_${ST.date}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    this.toast('Reporte CSV exportado', 'ok');
  },

  printReport() {
    this.switchTab('resumen');
    setTimeout(() => window.print(), 250);
  },

  /* ---- tiempo real / cabeceras ---------------------------------------- */
  startAutoRefresh() {
    if (ST._timer) clearInterval(ST._timer);
    ST._timer = setInterval(() => { if (!document.hidden) this.refresh(); }, 60000);
    if (ST._channels) ST._channels.forEach(ch => { try { supabase.removeChannel(ch); } catch (_) {} });
    ST._channels = [];
    const on = debounce(() => this.refresh(), 4000);
    ['attendance', 'daily_logs', 'incidents', 'supervision_audits', 'supervision_sessions'].forEach(t => {
      try {
        const ch = supabase.channel('od-' + t)
          .on('postgres_changes', { event: '*', schema: 'public', table: t }, on)
          .subscribe();
        ST._channels.push(ch);
      } catch (_) {}
    });
  },

  wireFetchHeaders() {
    if (window.__odFetchWrapped) return;
    window.__odFetchWrapped = true;
    const original = window.fetch;
    window.__odOriginalFetch = original;
    window.fetch = function (input, init) {
      try {
        const ctx = readSupCtx();
        if (ctx) {
          const headers = new Headers((init && init.headers) || (input && input.headers) || {});
          headers.set('X-Supervision-Active', 'true');
          if (ctx.sessionId) headers.set('X-Supervision-Session-Id', String(ctx.sessionId));
          if (ctx.classroomId) headers.set('X-Supervision-Classroom-Id', String(ctx.classroomId));
          if (ctx.teacherId) headers.set('X-Supervision-Teacher-Id', String(ctx.teacherId));
          init = Object.assign({}, init, { headers });
        }
      } catch (_) {}
      return original.apply(this, [input, init]);
    };
  },

  /* ---- toast ----------------------------------------------------------- */
  toast(msg, kind = 'info') {
    this.ensureOverlays();
    const wrap = document.getElementById('odToastWrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = `od-toast ${kind === 'info' ? '' : kind}`;
    const ic = kind === 'ok' ? 'check-circle' : kind === 'warn' ? 'alert-triangle' : kind === 'bad' ? 'x-circle' : 'info';
    el.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
    wrap.appendChild(el);
    refreshIcons();
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; setTimeout(() => el.remove(), 250); }, 3600);
  },
};

/* -------------------------------------------------------------------------- */
/*  Exportaciones                                                             */
/* -------------------------------------------------------------------------- */
let ST = {
  role: 'asistente', profile: {}, user: null, containerId: 'odOperativoRoot',
  tab: 'resumen', date: localDateISO(), search: '', levelFilter: 'all', intFilter: 'todas',
  data: {}, classrooms: [], health: {}, audits: [], isAfterCutoff: false, lastRefresh: null, refreshing: false,
};

export const OperativoDiarioModule = OD;
export const SchoolCenterModule = OD;   // alias descriptivo (ver mejoras.md)
export default OD;

window.OperativoDiarioModule = OD;
window.SupervisionEngine = SupervisionEngine;
