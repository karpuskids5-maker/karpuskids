import { supabase, emitEvent } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';
import { AssistantApi } from './api.js';

let isProcessing = false;
let _searchTimeout = null;

export const AccessModule = {

  async init() {
    this._bindSearch();
    this._bindQRScanner();
    await this.loadStats();
    await this.loadHistory();
  },

  // ── Búsqueda por nombre O matrícula ──────────────────────────────────────
  _bindSearch() {
    const input = document.getElementById('accessSearchInput');
    const results = document.getElementById('accessSearchResults');
    if (!input) return;

    input.addEventListener('input', (e) => {
      clearTimeout(_searchTimeout);
      const term = e.target.value.trim();
      if (term.length < 2) { results.innerHTML = ''; return; }
      results.innerHTML = `<div class="flex items-center gap-2 px-3 py-2 text-xs text-slate-400"><div class="w-3 h-3 border-2 border-teal-400 border-t-transparent rounded-full animate-spin"></div> Buscando...</div>`;
      _searchTimeout = setTimeout(() => this._search(term), 280);
    });

    // Limpiar al presionar Escape
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = ''; results.innerHTML = ''; }
    });
  },

  async _search(term) {
    const results = document.getElementById('accessSearchResults');
    try {
      // Buscar por nombre O matrícula
      const { data: students, error } = await supabase
        .from('students')
        .select('id, name, matricula, classroom_id, avatar_url, classrooms:classroom_id(name)')
        .or(`name.ilike.%${term}%,matricula.ilike.%${term}%`)
        .eq('is_active', true)
        .limit(6);

      if (error) throw error;

      if (!students?.length) {
        results.innerHTML = `<div class="px-3 py-4 text-center text-xs text-slate-400 font-bold">Sin resultados para "${Helpers.escapeHTML(term)}"</div>`;
        return;
      }

      results.innerHTML = students.map(s => this._studentResultHTML(s)).join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      results.innerHTML = `<div class="px-3 py-2 text-xs text-rose-500">Error al buscar</div>`;
    }
  },

  _studentResultHTML(s) {
    const initials = (s.name || '?').charAt(0).toUpperCase();
    const aula = s.classrooms?.name || 'Sin aula';
    const mat  = s.matricula ? `<span class="font-mono text-[9px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">${s.matricula}</span>` : '';
    return `
      <div class="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-9 h-9 rounded-xl bg-teal-100 text-teal-700 font-black text-sm flex items-center justify-center shrink-0 overflow-hidden">
            ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : initials}
          </div>
          <div class="min-w-0">
            <p class="font-bold text-slate-800 text-sm truncate">${Helpers.escapeHTML(s.name)}</p>
            <div class="flex items-center gap-1.5 mt-0.5">${mat}<span class="text-[10px] text-slate-400 font-bold">${aula}</span></div>
          </div>
        </div>
        <div class="flex gap-1.5 shrink-0 ml-2">
          <button data-id="${s.id}" data-type="check-in"
            class="punch-btn px-2.5 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-[10px] font-black uppercase hover:bg-emerald-100 border border-emerald-100 flex items-center gap-1 transition-all active:scale-95">
            <i data-lucide="log-in" class="w-3 h-3"></i> Entrada
          </button>
          <button data-id="${s.id}" data-type="check-out"
            class="punch-btn px-2.5 py-1.5 bg-rose-50 text-rose-600 rounded-lg text-[10px] font-black uppercase hover:bg-rose-100 border border-rose-100 flex items-center gap-1 transition-all active:scale-95">
            <i data-lucide="log-out" class="w-3 h-3"></i> Salida
          </button>
        </div>
      </div>`;
  },

  // ── Ponche por matrícula (QR / manual) ───────────────────────────────────
  async punchByMatricula(matricula) {
    if (isProcessing) return;
    isProcessing = true;
    try {
      const { data, error } = await supabase.rpc('process_student_punch', { p_matricula: matricula.trim() });
      if (error) throw error;
      if (data?.success) {
        Helpers.toast(`${data.type === 'check_in' ? '✅ Entrada' : '🚪 Salida'}: ${data.student_name} · ${data.time}`, 'success');
        this._showPunchFeedback(data);
      } else {
        Helpers.toast(data?.message || 'Error en ponche', 'warning');
      }
      await this.loadStats();
      await this.loadHistory();
    } catch (e) {
      Helpers.toast('Error: ' + e.message, 'error');
    } finally {
      isProcessing = false;
    }
  },

  // ── Ponche manual por ID ──────────────────────────────────────────────────
  async register(studentId, type) {
    if (isProcessing) return;
    isProcessing = true;
    const today = new Date().toISOString().split('T')[0];
    try {
      if (type === 'check-in') {
        const existing = await AssistantApi.getAttendanceStatus(studentId, today);
        if (existing) { Helpers.toast('Ya tiene asistencia registrada hoy', 'info'); return; }
        const { data: student, error } = await supabase
          .from('students').select('name, classroom_id, p1_email').eq('id', studentId).single();
        if (error || !student) throw new Error('Estudiante no encontrado');
        await AssistantApi.checkIn(studentId, student.classroom_id, today);
        Helpers.toast(`✅ Entrada: ${student.name}`, 'success');
        emitEvent('attendance.checkin', { student_id: studentId, student_name: student.name, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
      } else {
        const existing = await AssistantApi.getAttendanceStatus(studentId, today);
        if (!existing) { Helpers.toast('Sin entrada registrada hoy', 'error'); return; }
        if (existing.check_out) { Helpers.toast('Salida ya registrada', 'info'); return; }
        await AssistantApi.checkOut(existing.id);
        Helpers.toast(`🚪 Salida: ${existing.student?.name}`, 'success');
      }
      // Limpiar búsqueda
      const input = document.getElementById('accessSearchInput');
      const res   = document.getElementById('accessSearchResults');
      if (input) input.value = '';
      if (res)   res.innerHTML = '';
      await this.loadStats();
      await this.loadHistory();
    } catch (e) {
      Helpers.toast('Error: ' + e.message, 'error');
    } finally {
      isProcessing = false;
    }
  },

  // ── Estadísticas del día ──────────────────────────────────────────────────
  async loadStats() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('attendance')
        .select('status, check_out')
        .eq('date', today);

      const present  = (data || []).filter(r => r.status === 'present').length;
      const late     = (data || []).filter(r => r.status === 'late').length;
      const checkouts = (data || []).filter(r => r.check_out).length;
      const total    = (data || []).length;

      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('statPresent',  present);
      set('statLate',     late);
      set('statCheckout', checkouts);
      set('statTotal',    total);
    } catch (_) {}
  },

  // ── Historial reciente ────────────────────────────────────────────────────
  async loadHistory() {
    const container = document.getElementById('accessRecentLog');
    if (!container) return;
    try {
      const logs = await AssistantApi.getTodayAttendance();
      if (!logs?.length) {
        container.innerHTML = `<div class="text-center py-8 text-slate-300"><i data-lucide="clock" class="w-8 h-8 mx-auto mb-2"></i><p class="text-xs font-bold uppercase tracking-widest">Sin actividad hoy</p></div>`;
        if (window.lucide) lucide.createIcons();
        return;
      }
      container.innerHTML = logs.map(log => {
        const inTime  = log.check_in  ? new Date(log.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
        const outTime = log.check_out ? new Date(log.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
        const dot = log.check_out ? 'bg-rose-400' : (log.check_in ? 'bg-emerald-400' : 'bg-slate-300');
        return `
          <div class="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0">
            <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
              ${log.student?.avatar_url ? `<img src="${log.student.avatar_url}" class="w-full h-full object-cover">` : `<i data-lucide="user" class="w-4 h-4 text-slate-400"></i>`}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-black text-slate-700 truncate">${Helpers.escapeHTML(log.student?.name || '—')}</p>
              <div class="flex gap-2 mt-0.5">
                ${inTime  ? `<span class="text-[9px] font-bold text-emerald-600 flex items-center gap-0.5"><i data-lucide="log-in" class="w-2.5 h-2.5"></i>${inTime}</span>` : ''}
                ${outTime ? `<span class="text-[9px] font-bold text-rose-500 flex items-center gap-0.5"><i data-lucide="log-out" class="w-2.5 h-2.5"></i>${outTime}</span>` : ''}
              </div>
            </div>
            <div class="w-2 h-2 rounded-full ${dot} shrink-0"></div>
          </div>`;
      }).join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      container.innerHTML = `<div class="px-3 py-4 text-xs text-rose-500 text-center">Error al cargar historial</div>`;
    }
  },

  // ── Feedback visual de ponche ─────────────────────────────────────────────
  _showPunchFeedback(data) {
    const overlay = document.getElementById('punchFeedbackOverlay');
    if (!overlay) return;
    const isIn = data.type === 'check_in';
    overlay.innerHTML = `
      <div class="bg-white rounded-3xl p-8 max-w-xs w-full mx-4 text-center shadow-2xl animate-bounce-in">
        <div class="w-20 h-20 rounded-full ${isIn ? 'bg-emerald-100' : 'bg-rose-100'} flex items-center justify-center mx-auto mb-4 text-4xl">
          ${isIn ? '✅' : '🚪'}
        </div>
        <h3 class="text-xl font-black text-slate-800 mb-1">${Helpers.escapeHTML(data.student_name)}</h3>
        <p class="text-sm font-bold ${isIn ? 'text-emerald-600' : 'text-rose-500'} uppercase tracking-wider mb-3">
          ${isIn ? 'Entrada registrada' : 'Salida registrada'}
        </p>
        <div class="text-2xl font-black text-slate-700 bg-slate-50 rounded-2xl py-2">${data.time}</div>
      </div>`;
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('hidden'), 2500);
  },

  // ── Escáner QR integrado ──────────────────────────────────────────────────
  _bindQRScanner() {
    const btn = document.getElementById('btnOpenQRScanner');
    if (!btn) return;
    btn.addEventListener('click', () => this._openScanner());
  },

  _openScanner() {
    const modal = document.getElementById('qrScannerModal');
    if (!modal) return;
    modal.classList.remove('hidden');

    if (!window.Html5Qrcode) {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/html5-qrcode';
      script.onload = () => this._startScanner();
      document.head.appendChild(script);
    } else {
      this._startScanner();
    }
  },

  _startScanner() {
    const el = document.getElementById('qrReaderInline');
    if (!el || window._qrInstance) return;
    window._qrInstance = new Html5Qrcode('qrReaderInline');
    window._qrInstance.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      async (decodedText) => {
        await window._qrInstance.stop();
        window._qrInstance = null;
        document.getElementById('qrScannerModal')?.classList.add('hidden');
        await this.punchByMatricula(decodedText);
      },
      () => {}
    ).catch(e => console.warn('[QR]', e));
  },

  closeScanner() {
    if (window._qrInstance) {
      window._qrInstance.stop().catch(() => {});
      window._qrInstance = null;
    }
    document.getElementById('qrScannerModal')?.classList.add('hidden');
  }
};

// Delegación global para botones de ponche en resultados de búsqueda
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.punch-btn');
  if (!btn) return;
  const { id, type } = btn.dataset;
  if (id && type) window.App?.access?.register(id, type);
});
