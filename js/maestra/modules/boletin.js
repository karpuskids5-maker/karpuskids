/**
 * 📋 Boletines — Panel Maestra
 * Vista de boletines por estudiante: previsualización dinámica,
 * edición de comentario/fortalezas/debilidades y descarga de PDF.
 */
import { AppState } from '../state.js';
import { UI } from './ui.js';
import { supabase } from '/js/shared/supabase.js';
import {
  fetchBoletin,
  saveBoletinNotes,
  renderBoletin,
  boletinEditorHtml,
  downloadBoletinPDF,
} from '/js/shared/boletin-pdf.js';

const { safeToast, safeEscapeHTML, Modal } = UI;

export async function initBoletin() {
  const container = document.getElementById('t-boletin-inner');
  if (!container) return;

  container.innerHTML = `
    <div class="flex justify-between items-center mb-6">
      <h3 class="text-2xl font-black text-slate-800 flex items-center gap-3">
        <i data-lucide="file-text" class="w-6 h-6 text-indigo-500"></i>
        Boletines
      </h3>
    </div>
    <div id="boletinContent" class="space-y-4">
      <div class="animate-pulse space-y-4">
        <div class="h-32 bg-slate-50 rounded-3xl"></div>
        <div class="h-24 bg-slate-50 rounded-3xl"></div>
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();

  const content = document.getElementById('boletinContent');
  const classroom = AppState.get('classroom');

  try {
    const periodRes = await supabase.rpc('get_active_period', { p_classroom_id: classroom?.id });
    const period = periodRes?.data;

    if (!period || !period.found) {
      content.innerHTML = `
        <div class="text-center py-16">
          <div class="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-4">📋</div>
          <p class="font-bold text-slate-600">No hay período activo</p>
          <p class="text-xs text-slate-400 mt-1">La directora debe crear y activar un período para generar boletines</p>
        </div>`;
      return;
    }

    const students = AppState.get('students') || [];

    if (!students.length) {
      content.innerHTML = `
        <div class="text-center py-16">
          <div class="w-16 h-16 bg-amber-100 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-4">👧</div>
          <p class="font-bold text-slate-600">No hay estudiantes en esta aula</p>
        </div>`;
      return;
    }

    const periodStatus = period.status === 'closed' ? 'Cerrado' : 'En curso';

    content.innerHTML = `
      <div class="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-2xl flex items-center gap-3">
        <i data-lucide="info" class="w-5 h-5 text-indigo-500"></i>
        <div>
          <p class="text-xs font-black text-indigo-800 uppercase tracking-wide">${safeEscapeHTML(period.name)} <span class="ml-2 px-2 py-0.5 bg-white rounded-full text-[10px]">${periodStatus}</span></p>
          <p class="text-[10px] text-indigo-600 font-medium">${students.length} estudiantes — los promedios se calculan automáticamente</p>
        </div>
      </div>
      <div class="bg-white rounded-3xl border-2 border-slate-50 shadow-sm overflow-hidden">
        <div class="divide-y divide-slate-50">
          ${students.map(s => `
            <div class="flex items-center justify-between p-4 hover:bg-slate-50/60 transition-colors">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm overflow-hidden shrink-0">
                  ${s.avatar_url
                    ? `<img src="${safeEscapeHTML(s.avatar_url)}" alt="" class="w-full h-full object-cover" onerror="this.remove()">`
                    : safeEscapeHTML((s.name || '?').charAt(0))}
                </div>
                <div class="min-w-0">
                  <div class="font-black text-slate-800 text-sm truncate">${safeEscapeHTML(s.name)}</div>
                  <div class="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">${safeEscapeHTML(s.matricula || 'Sin matrícula')}</div>
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button onclick="App.openBoletin('${s.id}')"
                  class="px-3 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-bold hover:bg-indigo-100 transition-all">
                  Ver Boletín
                </button>
                <button onclick="App.downloadBoletin('${s.id}')"
                  class="px-3 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all" title="Descargar PDF">
                  <i data-lucide="download" class="w-4 h-4"></i>
                </button>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    content.innerHTML = `
      <div class="text-center py-12">
        <div class="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center text-2xl mx-auto mb-3">⚠️</div>
        <p class="font-bold text-slate-700">Error al cargar boletines</p>
        <p class="text-xs text-slate-400 mt-1">${safeEscapeHTML(e?.message || '')}</p>
        <button onclick="App.initBoletin()" class="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase">Reintentar</button>
      </div>`;
  }
}

export async function openBoletin(studentId) {
  const classroom = AppState.get('classroom');
  const periodRes = await supabase.rpc('get_active_period', { p_classroom_id: classroom?.id });
  const period = periodRes?.data;
  if (!period || !period.found) {
    return safeToast('No hay período activo para esta aula', 'warning');
  }

  const students = AppState.get('students') || [];
  const student = students.find(s => String(s.id) === String(studentId));

  Modal.open('boletinModal', `
    <div class="bg-white rounded-[2rem] w-[min(92vw,900px)] max-h-[92vh] flex flex-col overflow-hidden">
      <div class="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 text-white flex justify-between items-center">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center font-black text-lg overflow-hidden shrink-0">
            ${student?.avatar_url
              ? `<img src="${safeEscapeHTML(student.avatar_url)}" alt="" class="w-full h-full object-cover">`
              : safeEscapeHTML((student?.name || '?').charAt(0))}
          </div>
          <div class="min-w-0">
            <h3 class="text-lg font-black truncate">${safeEscapeHTML(student?.name || 'Estudiante')}</h3>
            <p class="text-xs font-bold text-white/70 uppercase tracking-widest truncate">Boletín · ${safeEscapeHTML(period.name)}</p>
          </div>
        </div>
        <button onclick="Modal.close('boletinModal')" class="w-9 h-9 bg-white/10 hover:bg-white/20 rounded-xl flex items-center justify-center transition-colors shrink-0">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
      </div>
      <div id="boletinModalBody" class="flex-1 overflow-y-auto p-5 bg-slate-50">
        <div class="text-center py-16 text-slate-400">
          <div class="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4"></div>
          Generando boletín...
        </div>
      </div>
    </div>
  `);

  const body = document.getElementById('boletinModalBody');
  try {
    const boletin = await fetchBoletin(studentId, period.id);
    if (boletin?.error) throw new Error(boletin.error);

    body.innerHTML = `
      <div class="grid lg:grid-cols-[300px_1fr] gap-4 items-start max-w-5xl mx-auto">
        <div class="space-y-3 lg:sticky lg:top-0">
          ${boletinEditorHtml(boletin)}
          <button onclick="App.downloadBoletin('${studentId}')"
            class="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all">
            <i data-lucide="download" class="w-4 h-4 inline mr-1"></i> Descargar PDF
          </button>
        </div>
        <div class="rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
          ${renderBoletin(boletin)}
        </div>
      </div>`;
    if (window.lucide) window.lucide.createIcons();

    document.getElementById('btn-save-boletin')?.addEventListener('click', async () => {
      const comment = document.getElementById('boletin-comment')?.value || '';
      const observaciones = document.getElementById('boletin-observaciones')?.value || '';
      const conducta = document.getElementById('boletin-conducta')?.value || '';
      const fortalezas = (document.getElementById('boletin-fortalezas')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
      const debilidades = (document.getElementById('boletin-debilidades')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
      const btn = document.getElementById('btn-save-boletin');
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
      try {
        await saveBoletinNotes(studentId, period.id, comment, fortalezas, debilidades, observaciones, conducta);
        safeToast('Boletín guardado', 'success');
        await openBoletin(studentId);
      } catch (e) {
        safeToast('Error al guardar: ' + (e?.message || ''), 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar Boletín'; }
      }
    });
  } catch (e) {
    body.innerHTML = `
      <div class="text-center py-12">
        <div class="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center text-2xl mx-auto mb-3">⚠️</div>
        <p class="font-bold text-slate-700">Error al cargar el boletín</p>
        <p class="text-xs text-slate-400 mt-1">${safeEscapeHTML(e?.message || '')}</p>
      </div>`;
  }
}

export async function downloadBoletin(studentId) {
  const classroom = AppState.get('classroom');
  const periodRes = await supabase.rpc('get_active_period', { p_classroom_id: classroom?.id });
  const period = periodRes?.data;
  if (!period || !period.found) return safeToast('No hay período activo', 'warning');

  try {
    safeToast('Generando PDF...', 'info');
    const boletin = await fetchBoletin(studentId, period.id);
    if (boletin?.error) throw new Error(boletin.error);
    await downloadBoletinPDF(boletin);
    safeToast('PDF descargado', 'success');
  } catch (e) {
    safeToast('Error al generar PDF: ' + (e?.message || ''), 'error');
  }
}

export const BoletinModule = { initBoletin, openBoletin, downloadBoletin };
