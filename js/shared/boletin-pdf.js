/**
 * 📄 Boletín Premium Karpus Kids — Módulo Compartido
 * Renderiza el boletín en pantalla (HTML) y genera el PDF profesional:
 * logo, QR, datos del estudiante, tabla de áreas a color, promedio general,
 * gráfico de desempeño, asistencia, conducta, fortalezas/áreas de mejora,
 * comentarios, firmas y pie institucional.
 *
 * Usa jsPDF + jspdf-autotable + qrcode.min.js (ya cargados en js/shared).
 */
import { supabase } from './supabase.js';
import { ensureJspdf } from './load-pdf.js';

let _logoDataUrl = null;

/* ─────────────── paleta Karpus Kids (Canva + Apple + Material) ───────────── */
const BLUE   = [37, 99, 235];   // #2563EB
const GREEN  = [34, 197, 94];   // #22C55E
const YELLOW = [250, 204, 21];  // #FACC15
const PINK   = [236, 72, 153];  // #EC4899
const ORANGE = [251, 146, 60];  // #FB923C
const PURPLE = [139, 92, 246];  // #8B5CF6
const DARK   = [30, 41, 59];
const GRAY   = [100, 116, 139];
const SLATE  = [241, 245, 249]; // slate-100
const LINE   = [226, 232, 240]; // slate-200

const PALETTE = [BLUE, GREEN, YELLOW, PINK, ORANGE, PURPLE];
const TINTS = [
  [219, 234, 254], [220, 252, 231], [254, 249, 195],
  [252, 231, 243], [255, 237, 213], [237, 233, 254],
];
const HEX = ['#2563EB', '#22C55E', '#FACC15', '#EC4899', '#FB923C', '#8B5CF6'];
const HEX_DARK = ['#1D4ED8', '#15803D', '#CA8A04', '#DB2777', '#EA580C', '#7C3AED'];

const LEVEL_RGB = {
  'Excelente':       [22, 101, 52],
  'Bueno':           [37, 99, 235],
  'En proceso':      [146, 64, 14],
  'Requiere apoyo':  [159, 18, 57],
  'Sin calificar':   [100, 116, 139],
};

const CONDUCTA_STARS = { 'Excelente': 5, 'Muy buena': 4, 'Buena': 3, 'Regular': 2 };

const PW = 210;   // A4 width mm
const M = 12;     // margin
const CW = PW - M * 2;
const BOTTOM = 284; // último Y de contenido por página
const HEADER_H = 46;

/* ───────────────────────── utilidades ───────────────────────── */

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function levelInfo(score) {
  if (score == null) return { label: 'Sin calificar', color: 'slate' };
  if (score >= 90) return { label: 'Excelente', color: 'emerald' };
  if (score >= 80) return { label: 'Bueno', color: 'blue' };
  if (score >= 70) return { label: 'En proceso', color: 'amber' };
  return { label: 'Requiere apoyo', color: 'rose' };
}

const LEVEL_HTML = {
  slate:   'bg-slate-100 text-slate-600',
  emerald: 'bg-emerald-100 text-emerald-700',
  blue:    'bg-blue-100 text-blue-700',
  amber:   'bg-amber-100 text-amber-700',
  rose:    'bg-rose-100 text-rose-700',
};

function levelHtmlClass(score) {
  return LEVEL_HTML[levelInfo(score).color] || LEVEL_HTML.slate;
}

function initials(name) {
  return (name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
}

function classroomLevel(lv) {
  return ({ estancia: 'Estancia', preescolar: 'Preescolar', primaria: 'Primaria' })[lv] || lv || '—';
}

function boletinCode(st, period) {
  return `KK-${(st.matricula || st.id || 'BOL')}-${period?.id || ''}`;
}

function scoreColor(v) {
  if (v == null) return GRAY;
  if (v >= 80) return [22, 101, 52];
  if (v >= 60) return [146, 64, 14];
  return [159, 18, 57];
}

/**
 * Construye la matriz de áreas × actividades (máx. 5 columnas).
 */
function buildAreasMatrix(boletin) {
  const areas = boletin?.areas || [];
  const acts = boletin?.activities || [];
  const maxActs = Math.min(5, Math.max(1, ...areas.map(a => a.activity_count || 5)));
  const bySubject = {};
  acts.forEach(g => {
    if (!bySubject[g.subject_id]) bySubject[g.subject_id] = {};
    bySubject[g.subject_id][g.activity_number] = g.score;
  });
  return areas.map((a, i) => {
    const actScores = [];
    for (let n = 1; n <= maxActs; n++) actScores.push(bySubject[a.subject_id]?.[n] ?? null);
    return { ...a, index: i, maxActs, actScores };
  });
}

async function loadImage(url) {
  if (!url) return null;
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function loadLogo() {
  if (_logoDataUrl) return _logoDataUrl;
  _logoDataUrl = await loadImage(`${window.location.origin}/img/karpus.jpg`);
  return _logoDataUrl;
}

function ensureQR() {
  return new Promise(resolve => {
    if (window.QRCode) return resolve();
    const s = document.createElement('script');
    s.src = '/js/shared/qrcode.min.js';
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

async function generateQR(text) {
  try {
    await ensureQR();
    return await new Promise(resolve => {
      const temp = document.createElement('div');
      temp.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:260px;height:260px;';
      document.body.appendChild(temp);
      try {
        new window.QRCode(temp, {
          text,
          width: 260,
          height: 260,
          colorDark: '#1D4ED8',
          colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel.H,
        });
        setTimeout(() => {
          const canvas = temp.querySelector('canvas');
          let dataUrl = null;
          if (canvas) dataUrl = canvas.toDataURL('image/png');
          else {
            const img = temp.querySelector('img');
            if (img) dataUrl = img.src;
          }
          document.body.removeChild(temp);
          resolve(dataUrl);
        }, 150);
      } catch (e) {
        document.body.removeChild(temp);
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

/* ───────────────────────────── API ───────────────────────────── */

/**
 * Obtiene todos los datos del boletín (RPC get_student_boletin).
 */
export async function fetchBoletin(studentId, periodId) {
  const { data, error } = await supabase.rpc('get_student_boletin', {
    p_student_id: parseInt(studentId),
    p_period_id: parseInt(periodId),
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Guarda comentario / fortalezas / debilidades / observaciones / conducta.
 */
export async function saveBoletinNotes(studentId, periodId, comment, fortalezas, debilidades, observaciones = null, conducta = null) {
  const { data, error } = await supabase.rpc('save_boletin_notes', {
    p_student_id: parseInt(studentId),
    p_period_id: parseInt(periodId),
    p_teacher_comment: comment || null,
    p_fortalezas: Array.isArray(fortalezas) ? fortalezas : [],
    p_debilidades: Array.isArray(debilidades) ? debilidades : [],
    p_observaciones: observaciones || null,
    p_conducta: conducta || null,
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * URL del boletín digital (destino del código QR).
 * Siempre apunta al panel de padres para que el QR abra el boletín aunque
 * el PDF se genere desde maestra o directora.
 */
function boletinUrl(student, period) {
  const path = window.location.pathname || '/';
  const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/') + 1) : '';
  const page = path.includes('padre') ? path : `${dir}panel_padres.html`;
  return `${window.location.origin}${page}?boletin=${student?.id}&periodo=${period?.id}`;
}

/* ─────────────────────── render en pantalla ──────────────────── */

/**
 * HTML del boletín (vista dinámica en pantalla). Solo lectura.
 */
export function renderBoletin(boletin) {
  const st = boletin?.student || {};
  const period = boletin?.period || {};
  const rep = boletin?.report || {};
  const att = boletin?.attendance || {};
  const matrix = buildAreasMatrix(boletin);
  const fortalezas = rep.fortalezas || [];
  const debilidades = rep.debilidades || [];
  const overall = boletin?.overall_average;
  const lvl = levelInfo(overall);
  const levelCls = levelHtmlClass(overall);
  const periodStatus = period.status === 'closed' ? 'Cerrado' : 'En curso';
  const code = boletinCode(st, period);
  const conducta = rep.conducta || '';
  const stars = CONDUCTA_STARS[conducta] ?? 0;

  const hasAttendance = att.total != null && att.total > 0;
  const actCols = Array.from({ length: matrix[0]?.maxActs || 5 }, (_, i) => i + 1);

  const chartHtml = matrix.length ? `
    <div class="space-y-2.5">
      ${matrix.map(a => {
        const pct = a.average != null ? Math.max(0, Math.min(100, a.average)) : 0;
        return `
          <div class="flex items-center gap-3">
            <span class="w-36 text-[10px] font-black uppercase text-slate-500 truncate shrink-0">${esc(a.subject_name)}</span>
            <div class="flex-1 h-3.5 rounded-full bg-slate-100 overflow-hidden">
              <div class="h-full rounded-full transition-all" style="width:${pct}%;background:${HEX[a.index % 6]}"></div>
            </div>
            <span class="w-10 text-right text-xs font-black ${a.average != null ? 'text-slate-800' : 'text-slate-300'} shrink-0">${a.average != null ? Number(a.average).toFixed(1) : '—'}</span>
          </div>`;
      }).join('')}
    </div>` : '';

  return `
    <div class="bg-white">
      <!-- Encabezado institucional -->
      <div class="bg-gradient-to-r from-blue-600 via-blue-600 to-violet-600 px-6 py-5 text-white relative overflow-hidden">
        <div class="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full"></div>
        <div class="absolute right-28 -bottom-10 w-24 h-24 bg-white/10 rounded-full"></div>
        <div class="flex items-center gap-4 relative z-10">
          <div class="w-16 h-16 rounded-2xl bg-white flex items-center justify-center text-xl font-black text-blue-600 overflow-hidden shrink-0 shadow-lg">
            <img src="/img/karpus.jpg" alt="Karpus Kids" class="w-full h-full object-contain" onerror="this.remove()">
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-[10px] font-black uppercase tracking-[0.25em] text-white/80">Karpus Kids · Centro de Desarrollo Infantil</p>
            <h2 class="text-2xl font-black mt-0.5">Boletín de Calificaciones</h2>
            <p class="text-xs font-bold text-white/85 mt-1">Año Escolar: <span class="text-white">${esc(boletin?.school_year_name || '—')}</span> · Período: <span class="text-white">${esc(period.name || '')}</span></p>
            <div class="flex items-center gap-2 mt-2">
              <span class="px-2.5 py-1 rounded-full bg-white/20 text-[10px] font-black uppercase">${periodStatus}</span>
              <span class="px-2.5 py-1 rounded-full bg-yellow-400 text-blue-900 text-[10px] font-black uppercase">Código: ${esc(code)}</span>
            </div>
          </div>
          <div class="hidden lg:flex flex-col items-center justify-center shrink-0">
            <div class="w-20 h-20 bg-white rounded-2xl flex items-center justify-center text-center text-[8px] font-black text-slate-400 shadow-lg">
              <div>Boletín<br>Digital<br>📱</div>
            </div>
          </div>
        </div>
      </div>

      <div class="p-5 space-y-4">
        <!-- Datos del estudiante -->
        <div class="flex items-center gap-4 bg-slate-50 rounded-3xl border border-slate-100 p-4">
          <div class="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-100 to-violet-100 text-blue-600 flex items-center justify-center font-black text-2xl overflow-hidden shrink-0 border-2 border-white shadow-sm">
            ${st.avatar_url
              ? `<img src="${esc(st.avatar_url)}" alt="" class="w-full h-full object-cover" onerror="this.remove()">`
              : initials(st.name)}
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="text-xl font-black text-slate-800 truncate">${esc(st.name)}</h3>
            <div class="grid grid-cols-2 gap-x-6 gap-y-1 mt-2 text-[11px] font-bold text-slate-500">
              <span><span class="text-slate-400">Matrícula:</span> ${esc(st.matricula || '—')}</span>
              <span><span class="text-slate-400">Edad:</span> ${st.age != null ? `${st.age} ${st.age_type || 'años'}` : '—'}</span>
              <span><span class="text-slate-400">Nacimiento:</span> ${fmtDate(st.birth_date)}</span>
              <span><span class="text-slate-400">Aula:</span> ${esc(boletin?.classroom?.name || '—')}</span>
              <span><span class="text-slate-400">Nivel:</span> ${esc(classroomLevel(boletin?.classroom?.level))}</span>
              <span><span class="text-slate-400">Maestra:</span> ${esc(boletin?.teacher_name || '—')}</span>
              <span><span class="text-slate-400">Directora:</span> ${esc(boletin?.directora_name || '—')}</span>
              <span><span class="text-slate-400">Emisión:</span> ${fmtDate(boletin?.issued_at)}</span>
            </div>
          </div>
        </div>

        <!-- Promedio general -->
        <div class="bg-gradient-to-r from-blue-600 to-violet-600 rounded-3xl p-5 text-white flex items-center justify-between relative overflow-hidden">
          <div class="absolute -right-6 -top-6 w-28 h-28 bg-white/10 rounded-full"></div>
          <div class="relative">
            <p class="text-[10px] font-black uppercase tracking-[0.25em] text-white/80">Promedio General del Período</p>
            <div class="flex items-end gap-3 mt-1.5">
              <span class="text-5xl font-black leading-none">${overall != null ? Number(overall).toFixed(1) : '—'}</span>
              <span class="mb-1 px-3 py-1 bg-white text-blue-700 rounded-full text-[10px] font-black uppercase">${lvl.label}</span>
            </div>
          </div>
          <div class="text-yellow-300 text-5xl relative shrink-0">★</div>
        </div>

        <!-- Tabla de áreas -->
        <div class="rounded-3xl border border-slate-200 overflow-hidden">
          <div class="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <h4 class="font-black text-slate-700 text-xs uppercase tracking-widest">Resultados por Área</h4>
            <span class="text-[10px] font-bold text-slate-400">Mejores 5 notas por área</span>
          </div>
          ${matrix.length ? `
            <table class="w-full text-sm">
              <thead class="bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest">
                <tr>
                  <th class="px-3 py-2.5 text-left rounded-tl-xl">Área</th>
                  ${actCols.map(n => `<th class="px-1 py-2.5 text-center">Act ${n}</th>`).join('')}
                  <th class="px-3 py-2.5 text-center rounded-tr-xl">Promedio</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-50">
                ${matrix.map(a => `
                  <tr class="hover:bg-slate-50/60 transition-colors">
                    <td class="px-3 py-2.5 font-black text-sm">
                      <span class="inline-block w-2 h-2 rounded-full mr-2" style="background:${HEX[a.index % 6]}"></span>
                      <span style="color:${HEX_DARK[a.index % 6]}">${esc(a.subject_name)}</span>
                    </td>
                    ${a.actScores.map(sc => `
                      <td class="px-1 py-2.5 text-center text-xs font-black ${sc == null ? 'text-slate-300' : sc >= 80 ? 'text-emerald-600' : sc >= 60 ? 'text-amber-600' : 'text-rose-600'}">${sc == null ? '—' : Number(sc).toFixed(0)}</td>`).join('')}
                    <td class="px-3 py-2.5 text-center">
                      ${a.average != null
                        ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black ${levelHtmlClass(a.average)}">${Number(a.average).toFixed(1)}</span>`
                        : '<span class="text-slate-300 font-black text-xs">—</span>'}
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          ` : `<div class="p-8 text-center text-slate-400 text-sm"><p class="font-bold">Sin calificaciones registradas</p></div>`}
        </div>

        <!-- Gráfico de desempeño -->
        ${chartHtml ? `
          <div class="rounded-3xl border border-slate-200 p-5">
            <h4 class="font-black text-slate-700 text-xs uppercase tracking-widest mb-4">Desempeño por Áreas</h4>
            ${chartHtml}
          </div>` : ''}

        <!-- Asistencia -->
        ${hasAttendance ? `
          <div class="grid grid-cols-4 gap-3">
            <div class="rounded-3xl bg-emerald-50 p-4 text-center">
              <p class="text-2xl font-black text-emerald-600">${att.asistencias ?? 0}</p>
              <p class="text-[10px] font-black uppercase tracking-wider text-emerald-500 mt-0.5">Días asistidos</p>
            </div>
            <div class="rounded-3xl bg-rose-50 p-4 text-center">
              <p class="text-2xl font-black text-rose-600">${att.ausencias ?? 0}</p>
              <p class="text-[10px] font-black uppercase tracking-wider text-rose-500 mt-0.5">Ausencias</p>
            </div>
            <div class="rounded-3xl bg-orange-50 p-4 text-center">
              <p class="text-2xl font-black text-orange-500">${att.tardanzas ?? 0}</p>
              <p class="text-[10px] font-black uppercase tracking-wider text-orange-500 mt-0.5">Tardanzas</p>
            </div>
            <div class="rounded-3xl bg-blue-50 p-4 text-center">
              <p class="text-2xl font-black text-blue-600">${att.pct != null ? Number(att.pct).toFixed(1) + '%' : '—'}</p>
              <p class="text-[10px] font-black uppercase tracking-wider text-blue-500 mt-0.5">Asistencia</p>
            </div>
          </div>` : ''}

        <!-- Conducta -->
        ${conducta ? `
          <div class="rounded-3xl border border-amber-100 bg-amber-50/50 p-4 flex items-center justify-between">
            <div>
              <h4 class="font-black text-amber-700 text-xs uppercase tracking-widest">Conducta</h4>
              <p class="text-lg font-black text-slate-800 mt-0.5">${esc(conducta)}</p>
            </div>
            <div class="text-2xl tracking-wide shrink-0 ml-4">
              ${Array.from({ length: 5 }, (_, i) => `<span class="${i < stars ? 'text-yellow-400' : 'text-slate-200'}">★</span>`).join('')}
            </div>
          </div>` : ''}

        <!-- Fortalezas -->
        ${fortalezas.length ? `
          <div class="rounded-3xl bg-emerald-50/60 border border-emerald-100 p-4">
            <h4 class="font-black text-emerald-700 text-xs uppercase tracking-widest mb-2">★ Fortalezas</h4>
            <ul class="space-y-1">
              ${fortalezas.map(f => `<li class="flex items-start gap-2 text-sm text-emerald-900"><span class="text-emerald-500 font-black mt-0.5">✦</span><span>${esc(f)}</span></li>`).join('')}
            </ul>
          </div>` : ''}

        <!-- Áreas de mejora -->
        ${debilidades.length ? `
          <div class="rounded-3xl bg-orange-50/60 border border-orange-100 p-4">
            <h4 class="font-black text-orange-600 text-xs uppercase tracking-widest mb-2">✎ Áreas de Mejora</h4>
            <ul class="space-y-1">
              ${debilidades.map(d => `<li class="flex items-start gap-2 text-sm text-orange-900"><span class="text-orange-400 font-black mt-0.5">◆</span><span>${esc(d)}</span></li>`).join('')}
            </ul>
          </div>` : ''}

        <!-- Comentario de la maestra -->
        ${rep.teacher_comment ? `
          <div class="rounded-3xl border border-slate-200 bg-white p-4">
            <h4 class="font-black text-blue-600 text-xs uppercase tracking-widest mb-2">✎ Comentario de la Maestra</h4>
            <p class="text-sm text-slate-700 italic leading-relaxed">"${esc(rep.teacher_comment)}"</p>
          </div>` : ''}

        <!-- Observaciones -->
        ${rep.directora_comment ? `
          <div class="rounded-3xl bg-violet-50/60 border border-violet-100 p-4">
            <h4 class="font-black text-violet-600 text-xs uppercase tracking-widest mb-2">📋 Observaciones de la Directora</h4>
            <p class="text-sm text-violet-900 italic leading-relaxed">"${esc(rep.directora_comment)}"</p>
          </div>` : ''}

        <!-- Firmas -->
        <div class="grid grid-cols-3 gap-4 pt-2">
          ${['Maestra', 'Directora', 'Padre o tutor'].map(role => `
            <div class="text-center">
              <div class="border-t-2 border-slate-300 w-full mt-8"></div>
              <p class="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1.5">${role}</p>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

/**
 * Formulario para editar el boletín (comentarios, conducta, listas).
 * Devuelve HTML con inputs id: boletin-comment, boletin-observaciones,
 * boletin-conducta, boletin-fortalezas, boletin-debilidades.
 */
export function boletinEditorHtml(boletin) {
  const rep = boletin?.report || {};
  const ic = 'w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-100 rounded-xl outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-400 transition-all text-sm font-medium';
  const label = (icon, color, text) => `
    <label class="flex items-center gap-1.5 text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
      <i data-lucide="${icon}" class="w-3.5 h-3.5 ${color}"></i> ${text}
    </label>`;
  return `
    <div class="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div class="px-4 py-3 bg-gradient-to-r from-blue-600 to-violet-600 flex items-center justify-between">
        <div class="flex items-center gap-2 text-white">
          <i data-lucide="edit-3" class="w-4 h-4"></i>
          <h4 class="font-black text-xs uppercase tracking-widest">Editar Boletín</h4>
        </div>
        <span class="text-white/70 text-[9px] font-black uppercase tracking-widest">Período ${esc(boletin?.period?.name || '')}</span>
      </div>
      <div class="p-4 space-y-4">
        <div>
          ${label('message-square', 'text-blue-500', 'Comentario de la maestra')}
          <textarea id="boletin-comment" rows="3" class="${ic}" placeholder="Comentario libre sobre el desempeño del estudiante...">${esc(rep.teacher_comment || '')}</textarea>
        </div>
        <div>
          ${label('building-2', 'text-violet-500', 'Observaciones (directora)')}
          <textarea id="boletin-observaciones" rows="2" class="${ic}" placeholder="Observaciones institucionales...">${esc(rep.directora_comment || '')}</textarea>
        </div>
        <div>
          ${label('sparkles', 'text-amber-500', 'Conducta')}
          <select id="boletin-conducta" class="${ic}">
            <option value="">— Seleccionar —</option>
            ${['Excelente', 'Muy buena', 'Buena', 'Regular'].map(c =>
              `<option value="${c}" ${rep.conducta === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div>
          ${label('award', 'text-emerald-500', 'Fortalezas (una por línea)')}
          <textarea id="boletin-fortalezas" rows="3" class="${ic}" placeholder="Excelente participación&#10;Buen compañerismo">${esc((rep.fortalezas || []).join('\n'))}</textarea>
        </div>
        <div>
          ${label('target', 'text-orange-500', 'Áreas de mejora (una por línea)')}
          <textarea id="boletin-debilidades" rows="3" class="${ic}" placeholder="Concentración&#10;Orden">${esc((rep.debilidades || []).join('\n'))}</textarea>
        </div>
      </div>
      <div class="px-4 pb-4 pt-1">
        <button id="btn-save-boletin"
          class="w-full px-4 py-2.5 bg-blue-600 text-white rounded-xl font-black text-xs uppercase shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all">
          Guardar Boletín
        </button>
      </div>
    </div>`;
}

/* ──────────────────────────── PDF ────────────────────────────── */

export async function createBoletinDoc() {
  await ensureJspdf();
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new Error('Librería jsPDF no disponible');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc._karpusBoletines = 0;
  return doc;
}

/** Salta a una nueva página si el bloque no cabe; devuelve el Y de trabajo. */
function _fit(doc, y, h) {
  if (y + h > BOTTOM) {
    doc.addPage();
    return 20;
  }
  return y;
}

function _drawStar(doc, cx, cy, r, color, inner = 0.45) {
  const pts = [];
  const n = 5;
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inner;
    const ang = (Math.PI / n) * i - Math.PI / 2;
    pts.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]);
  }
  const lines = [];
  for (let i = 1; i < pts.length; i++) lines.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  lines.push([pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]]);
  doc.setFillColor(...color);
  doc.setDrawColor(...color);
  doc.lines(lines, pts[0][0], pts[0][1], [1, 1], 'F', true);
}

/**
 * Pie institucional en todas las páginas (logo, web, correo, página).
 */
export function finalizeBoletinDoc(doc, meta = {}) {
  const now = new Date();
  const dateStr = meta.dateStr || now.toLocaleDateString('es-ES');
  const timeStr = meta.timeStr || now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(M, 287, PW - M, 287);

    const logo = doc._karpusLogo;
    if (logo) {
      try { doc.addImage(logo, M, 288.2, 5, 5); } catch (_) {}
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY);
    const left = doc.splitTextToSize('Generado automáticamente por Karpus Kids · www.karpuskids.com · contacto@karpuskids.com', CW - 40);
    doc.text(left, M + 7.5, 291);
    doc.setFont('helvetica', 'bold');
    doc.text(`Página ${i} de ${pages}`, PW - M, 291, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.text(`Generado el ${dateStr} a las ${timeStr}`, M + 7.5, 294);
  }
}

/** Encabezado: banda azul, logo, título, metadatos y QR. */
function _drawHeader(doc, boletin, qr) {
  const period = boletin?.period || {};
  const st = boletin?.student || {};
  const status = period.status === 'closed' ? 'Cerrado' : 'En curso';
  const code = boletinCode(st, period);

  doc.setFillColor(...BLUE);
  doc.rect(0, 0, PW, HEADER_H, 'F');
  doc.setFillColor(29, 78, 216);
  doc.circle(0, 0, 34, 'F');
  doc.setFillColor(59, 130, 246);
  doc.circle(PW, 0, 30, 'F');
  doc.setFillColor(147, 197, 253);
  doc.circle(150, HEADER_H + 2, 12, 'F');

  // Logo
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(M, 6, 22, 22, 4, 4, 'F');
  const logo = doc._karpusLogo;
  if (logo) {
    try { doc.addImage(logo, M + 2, 8, 18, 18); } catch (_) {}
  } else {
    doc.setTextColor(...BLUE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('KK', M + 11, 20.5, { align: 'center' });
  }

  // QR digital
  const qrX = PW - M - 20;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(qrX, 7, 20, 20, 3, 3, 'F');
  if (qr) {
    try { doc.addImage(qr, qrX + 2, 9, 16, 16); } catch (_) {}
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(255, 255, 255);
  doc.text('BOLETÍN DIGITAL', qrX + 10, 31, { align: 'center' });

  // Títulos
  const tx = M + 30;
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('KARPUS KIDS', tx, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(219, 234, 254);
  doc.text('Centro de Desarrollo Infantil', tx, 18);

  _drawStar(doc, tx + 4, 24.5, 3, YELLOW);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.setTextColor(255, 255, 255);
  doc.text('Boletín de Calificaciones', tx + 10, 28);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(219, 234, 254);
  const meta1 = `Año Escolar: ${boletin?.school_year_name || '—'}   ·   Período: ${period.name || ''}`;
  doc.text(doc.splitTextToSize(meta1, qrX - tx - 4)[0], tx, 35.5);
  const meta2 = `Estado: ${status}   ·   Código: ${code}`;
  doc.text(doc.splitTextToSize(meta2, qrX - tx - 4)[0], tx, 40);
}

/** Tarjeta de datos del estudiante con foto. */
function _drawStudentBlock(doc, boletin, y) {
  const st = boletin?.student || {};
  const cl = boletin?.classroom || {};
  const issued = fmtDate(boletin?.issued_at);
  const age = st.age != null ? `${st.age} ${st.age_type || 'años'}` : '—';

  const fields = [
    ['Matrícula', st.matricula || '—'],
    ['Edad', age],
    ['Nacimiento', fmtDate(st.birth_date)],
    ['Aula', cl.name || '—'],
    ['Nivel', classroomLevel(cl.level)],
    ['Maestra', boletin?.teacher_name || '—'],
    ['Directora', boletin?.directora_name || '—'],
    ['Emisión', issued],
  ];

  const cardH = 40;
  y = _fit(doc, y, cardH + 6);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, y, CW, cardH, 5, 5, 'F');
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, y, CW, cardH, 5, 5, 'S');

  doc.setFillColor(...TINTS[0]);
  doc.roundedRect(M + 5, y + 5, 30, 30, 4, 4, 'F');
  const avatar = doc._karpusAvatar;
  if (avatar) {
    try { doc.addImage(avatar, M + 6.5, y + 6.5, 27, 27); } catch (_) {}
  } else {
    doc.setFillColor(...BLUE);
    doc.circle(M + 20, y + 20, 13, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(initials(st.name), M + 20, y + 23, { align: 'center' });
  }

  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(doc.splitTextToSize(st.name, CW - 46)[0], M + 42, y + 10);

  const colX = [M + 42, M + 42 + 74];
  doc.setFont('helvetica', 'normal');
  fields.forEach(([k, v], idx) => {
    const cx = colX[Math.floor(idx / 4)];
    const ry = y + 17 + (idx % 4) * 5.6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY);
    doc.text(`${k}:`, cx, ry);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...DARK);
    const kw = doc.getTextWidth(`${k}: `);
    doc.text(doc.splitTextToSize(v, 72 - kw)[0], cx + kw, ry);
  });

  return y + cardH + 6;
}

/** Tabla de áreas con colores por fila y columnas de actividades. */
function _drawAreasTable(doc, boletin, y) {
  const matrix = buildAreasMatrix(boletin);
  if (!matrix.length) {
    y = _fit(doc, y, 14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...GRAY);
    doc.text('Sin calificaciones registradas en este período.', M, y + 8);
    return y + 16;
  }

  const maxActs = matrix[0].maxActs;
  const head = ['Área', ...Array.from({ length: maxActs }, (_, i) => `Act ${i + 1}`), 'Promedio'];
  const body = matrix.map(a => [
    a.subject_name,
    ...a.actScores.map(s => s != null ? Number(s).toFixed(0) : '—'),
    a.average != null ? Number(a.average).toFixed(1) : '—',
  ]);

  const wArea = 56;
  const wAct = Math.min(13, (CW - wArea - 40) / Math.max(1, maxActs));
  const wAvg = CW - wArea - wAct * maxActs;
  const colStyles = { 0: { cellWidth: wArea, halign: 'left', fontStyle: 'bold' } };
  for (let c = 1; c <= maxActs; c++) colStyles[c] = { cellWidth: wAct, halign: 'center' };
  colStyles[maxActs + 1] = { cellWidth: wAvg, halign: 'center', fontStyle: 'bold' };

  y = _fit(doc, y, 14);
  doc.autoTable({
    startY: y,
    margin: { left: M, right: M },
    head: [head],
    body,
    theme: 'grid',
    headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold', fontSize: 7.5, halign: 'center', cellPadding: 2.2 },
    styles: { fontSize: 7.5, cellPadding: 2.2 },
    columnStyles: colStyles,
    didParseCell: data => {
      if (data.section !== 'body') return;
      const i = data.row.index;
      const col = data.column.index;
      data.cell.styles.fillColor = TINTS[i % 6];
      if (col === 0) {
        data.cell.styles.textColor = HEX_DARK[i % 6];
      } else if (col === maxActs + 1) {
        data.cell.styles.textColor = HEX_DARK[i % 6];
      } else {
        const raw = data.cell.raw;
        data.cell.styles.textColor = raw === '—' || raw == null ? GRAY : scoreColor(parseFloat(raw));
      }
    },
  });
  return doc.lastAutoTable.finalY + 7;
}

/** Tarjeta grande de promedio general con estrella. */
function _drawOverall(doc, boletin, y) {
  const overall = boletin?.overall_average;
  const lvl = levelInfo(overall);
  const h = 22;
  y = _fit(doc, y, h + 4);
  doc.setFillColor(...BLUE);
  doc.roundedRect(M, y, CW, h, 5, 5, 'F');
  doc.setFillColor(59, 130, 246);
  doc.circle(PW - M - 2, y + 2, 14, 'F');
  doc.setFillColor(29, 78, 216);
  doc.circle(M, y + h, 12, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('PROMEDIO GENERAL DEL PERÍODO', M + 10, y + 7);

  doc.setFontSize(24);
  doc.text(overall != null ? Number(overall).toFixed(1) : '—', M + 10, y + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  const chipW = 40;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(PW - M - chipW - 12, y + 5.5, chipW, 9, 3, 3, 'F');
  doc.setTextColor(...(LEVEL_RGB[lvl.label] || GRAY));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(lvl.label, PW - M - 12 - chipW / 2, y + 11.5, { align: 'center' });

  _drawStar(doc, PW - M - 8, y + 17.5, 4.5, YELLOW);
  return y + h + 4;
}

/** Gráfico de barras de desempeño por área. */
function _drawChart(doc, boletin, y) {
  const matrix = buildAreasMatrix(boletin);
  const rows = matrix.filter(a => a.average != null);
  if (!rows.length) return y;

  const rowH = 9;
  const totalH = 12 + rows.length * rowH;
  y = _fit(doc, y, totalH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text('DESEMPEÑO POR ÁREAS', M, y + 4);
  y += 8;

  const labelW = 62;
  const valW = 14;
  const maxBar = CW - labelW - valW - 6;
  doc.setFont('helvetica', 'normal');
  rows.forEach(a => {
    const pct = Math.max(0, Math.min(100, a.average));
    const color = PALETTE[a.index % 6];
    y = _fit(doc, y, rowH + 2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    const labelLines = doc.splitTextToSize(a.subject_name, labelW - 2);
    doc.text(labelLines[0], M, y + 4);

    const bx = M + labelW;
    doc.setFillColor(...SLATE);
    doc.roundedRect(bx, y + 1.5, maxBar, 4, 2, 2, 'F');
    if (pct > 0) {
      doc.setFillColor(...color);
      doc.roundedRect(bx, y + 1.5, Math.max(1.5, maxBar * pct / 100), 4, 2, 2, 'F');
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    doc.text(Number(a.average).toFixed(1), bx + maxBar + 3, y + 4);
    y += rowH;
  });
  return y + 4;
}

/** Tarjeta de asistencia con 4 métricas. */
function _drawAttendance(doc, boletin, y) {
  const att = boletin?.attendance || {};
  if (!att.total) return y;

  const stats = [
    [att.asistencias ?? 0, 'DÍAS ASISTIDOS', GREEN, TINTS[1]],
    [att.ausencias ?? 0, 'AUSENCIAS', [159, 18, 57], TINTS[3]],
    [att.tardanzas ?? 0, 'TARDANZAS', ORANGE, TINTS[4]],
    [att.pct != null ? `${Number(att.pct).toFixed(1)}%` : '—', 'ASISTENCIA', BLUE, TINTS[0]],
  ];

  const h = 26;
  y = _fit(doc, y, h + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text('ASISTENCIA', M, y + 4);

  const gap = 4;
  const boxW = (CW - gap * 3) / 4;
  stats.forEach(([value, label, color, tint], i) => {
    const x = M + i * (boxW + gap);
    doc.setFillColor(...tint);
    doc.roundedRect(x, y + 7, boxW, 17, 4, 4, 'F');
    doc.setFillColor(...color);
    doc.circle(x + boxW / 2, y + 12.5, 3.2, 'F');
    doc.setTextColor(...color);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(String(value), x + boxW / 2, y + 19, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...GRAY);
    doc.text(label, x + boxW / 2, y + 22.5, { align: 'center' });
  });
  return y + h + 6;
}

/** Tarjeta de conducta con estrellas. */
function _drawConducta(doc, boletin, y) {
  const conducta = boletin?.report?.conducta;
  if (!conducta) return y;
  const stars = CONDUCTA_STARS[conducta] ?? 0;

  const h = 18;
  y = _fit(doc, y, h + 6);
  doc.setFillColor(254, 243, 199);
  doc.roundedRect(M, y, CW, h, 5, 5, 'F');
  doc.setDrawColor(252, 211, 77);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, y, CW, h, 5, 5, 'S');

  doc.setTextColor([146, 64, 14]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('CONDUCTA', M + 10, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.text(conducta, M + 10, y + 14);

  const sX = PW - M - 10 - (5 * 5);
  for (let i = 0; i < 5; i++) {
    const x = sX + i * 5 + 2.5;
    _drawStar(doc, x, y + 11, 2.2, i < stars ? YELLOW : [203, 213, 225]);
  }
  return y + h + 6;
}

/** Tarjeta de lista (fortalezas / áreas de mejora). */
function _drawListBlock(doc, boletin, y, kind) {
  const key = kind === 'fortalezas' ? 'fortalezas' : 'debilidades';
  const items = boletin?.report?.[key] || [];
  if (!items.length) return y;

  const isF = kind === 'fortalezas';
  const label = isF ? '★ FORTALEZAS' : '✎ ÁREAS DE MEJORA';
  const accent = isF ? [6, 95, 70] : [154, 52, 18];
  const tint = isF ? TINTS[1] : TINTS[4];
  const bullet = isF ? '✦' : '◆';

  const lines = [];
  for (const it of items) lines.push(...doc.splitTextToSize(`${bullet} ${it}`, CW - 14));
  const blockH = 14 + lines.length * 4.6 + 4;
  y = _fit(doc, y, blockH + 6);
  const top = y;

  doc.setFillColor(...tint);
  doc.roundedRect(M, top, CW, blockH, 5, 5, 'F');
  doc.setDrawColor(...(isF ? [167, 243, 208] : [254, 215, 170]));
  doc.setLineWidth(0.3);
  doc.roundedRect(M, top, CW, blockH, 5, 5, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...accent);
  doc.text(label, M + 10, top + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  let ly = top + 14;
  for (const it of items) {
    const wrapped = doc.splitTextToSize(`${bullet} ${it}`, CW - 14);
    doc.text(wrapped, M + 8, ly);
    ly += wrapped.length * 4.6 + 1;
  }
  return top + blockH + 6;
}

/** Tarjeta de comentario de texto libre. */
function _drawComment(doc, boletin, y, label, text, accent, tint) {
  if (!text) return y;
  const lines = doc.splitTextToSize(text, CW - 18);
  const h = lines.length * 4.6 + 16;
  y = _fit(doc, y, h + 6);

  doc.setFillColor(...tint);
  doc.roundedRect(M, y, CW, h, 5, 5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...accent);
  doc.text(label, M + 10, y + 8);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text(lines, M + 10, y + 15);
  return y + h + 6;
}

function _drawSignatures(doc, boletin, y) {
  const names = [boletin?.teacher_name || '', boletin?.directora_name || '', ''];
  const roles = ['Maestra', 'Directora', 'Padre o tutor'];
  const sigW = (CW - 20) / 3;

  y = _fit(doc, y, 24);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  roles.forEach((role, i) => {
    const x = M + i * (sigW + 10);
    doc.line(x, y, x + sigW, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...DARK);
    doc.text(role, x + sigW / 2, y + 5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    if (names[i]) doc.text(names[i], x + sigW / 2, y + 9, { align: 'center' });
  });
  return y + 16;
}

/**
 * Dibuja un boletín completo sobre el documento actual (nueva página si ya hay contenido).
 */
export async function appendBoletinPage(doc, boletin) {
  await ensureJspdf();
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new Error('Librería jsPDF no disponible');

  if (doc._karpusBoletines === undefined) doc._karpusBoletines = 0;
  if (doc._karpusBoletines > 0) doc.addPage();
  doc._karpusBoletines++;

  const st = boletin?.student || {};
  const period = boletin?.period || {};

  if (!doc._karpusLogo) doc._karpusLogo = await loadLogo();
  if (!doc._karpusAvatar && st.avatar_url) doc._karpusAvatar = await loadImage(st.avatar_url);
  const qr = await generateQR(boletinUrl(st, period));

  _drawHeader(doc, boletin, qr);

  let y = HEADER_H + 6;
  y = _drawStudentBlock(doc, boletin, y);
  y = _drawAreasTable(doc, boletin, y);
  y = _drawOverall(doc, boletin, y);
  y = _drawChart(doc, boletin, y);
  y = _drawAttendance(doc, boletin, y);
  y = _drawConducta(doc, boletin, y);
  y = _drawListBlock(doc, boletin, y, 'fortalezas');
  y = _drawListBlock(doc, boletin, y, 'debilidades');
  y = _drawComment(doc, boletin, y, '✎ COMENTARIO DE LA MAESTRA', boletin?.report?.teacher_comment, BLUE, TINTS[0]);
  y = _drawComment(doc, boletin, y, '📋 OBSERVACIONES DE LA DIRECTORA', boletin?.report?.directora_comment, PURPLE, TINTS[5]);
  _drawSignatures(doc, boletin, y);
}

/**
 * Descarga el PDF de un único boletín.
 */
export async function downloadBoletinPDF(boletin, fileName) {
  const doc = await createBoletinDoc();
  await appendBoletinPage(doc, boletin);
  finalizeBoletinDoc(doc);
  const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const name = fileName || `boletin_${(boletin?.student?.name || 'estudiante').replace(/\s+/g, '_').toLowerCase()}_${boletin?.period?.id || ''}_${ts}.pdf`;
  doc.save(name);
  return doc;
}
