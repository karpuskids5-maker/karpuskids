import { supabase } from './supabase.js';

const CARD_W = 85.6;
const CARD_H = 54;
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_TB = 8;
const MARGIN_LR = 8;
const GAP = 5;
const COLS = 2;
const ROWS = 4;
const CARDS_PER_PAGE = COLS * ROWS;

const GREEN = {
  primary: [25, 135, 84],
  dark: [20, 108, 67],
  light: [90, 198, 122],
  veryLight: [220, 240, 228],
  white: [255, 255, 255],
  bg: [245, 250, 247],
  slate: [100, 116, 139],
  darkText: [15, 23, 42],
  lightText: [148, 163, 184],
};

const INSTITUTIONAL = {
  phone: '(829) 803-8424',
  website: 'www.karpuskids.com',
  address: 'Al lado de Iglesia Bethel Brazos Abiertos, Urbanización Genesis, C. Raúl Mondesí, San Cristóbal 91000',
  email: 'karpuskids@gmail.com',
  facebook: '@karpuskids',
  instagram: '@karpuskids',
  tiktok: '@karpuskids',
};

class CarnetsManager {
  constructor() {
    this._students = [];
    this._classrooms = [];
    this._adminName = '';
    this._loaded = false;
    this._modalOpen = false;
    this._qrCache = {};
    this._logoDataUrl = null;
  }

  async _loadData() {
    const [{ data: students, error: se }, { data: classrooms, error: ce }] = await Promise.all([
      supabase.from('students')
        .select('id, name, matricula, avatar_url, age, age_type, is_active, classroom_id, parent_id, p1_name, p1_phone, p2_name, p2_phone, classrooms(name, level)')
        .order('name'),
      supabase.from('classrooms').select('id, name, level').order('name'),
    ]);

    if (se) throw se;
    this._students = students || [];
    this._classrooms = classrooms || [];

    const { data: profile } = await supabase
      .from('profiles').select('name').maybeSingle();
    this._adminName = profile?.name || 'Administrador';
    this._loaded = true;
  }

  async _loadLogo() {
    if (this._logoDataUrl) return this._logoDataUrl;
    try {
      const base = window.location.origin || '';
      const url = `${base}/img/karpus.jpg`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Logo not found');
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => { this._logoDataUrl = reader.result; resolve(reader.result); };
        reader.onerror = () => reject(new Error('Failed to read logo'));
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('Logo load failed:', e);
      return null;
    }
  }

  openModal() {
    if (this._modalOpen) return;
    this._modalOpen = true;
    this._renderModal();
  }

  closeModal() {
    this._modalOpen = false;
    const gc = document.getElementById('globalModalContainer');
    if (gc) { gc.style.display = 'none'; gc.innerHTML = ''; }
  }

  async _renderModal() {
    if (!this._loaded) {
      if (window.Helpers?.blockUI) Helpers.blockUI('Cargando datos...');
      try { await this._loadData(); }
      finally { if (window.Helpers?.unblockUI) Helpers.unblockUI(); }
    }

    const active = this._students.filter(s => s.is_active !== false);
    const inactive = this._students.filter(s => s.is_active === false);
    const classroomOpts = this._classrooms.map(c =>
      `<option value="${c.id}">${c.name}${c.level ? ' (' + c.level + ')' : ''}</option>`
    ).join('');

    const html = `
    <div style="overflow:hidden;border-radius:1.5rem">
      <div style="background:linear-gradient(135deg,#198754,#146C43);color:#fff;padding:1.5rem;border-radius:1.5rem 1.5rem 0 0">
        <div style="display:flex;align-items:center;gap:0.75rem">
          <div style="width:3rem;height:3rem;background:rgba(255,255,255,0.2);border-radius:1rem;display:flex;align-items:center;justify-content:center">
            <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color:#fff"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0"/></svg>
          </div>
          <div>
            <h3 style="font-size:1.25rem;font-weight:900;margin:0">Generar Carnets</h3>
            <p style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0.25rem 0 0;opacity:0.7">Karpus Kids · Carnet Institucional PVC</p>
          </div>
        </div>
      </div>

      <div style="padding:1.5rem" id="carnetsModalBody">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;text-align:center;margin-bottom:1.25rem">
          <div style="background:#f0fdf4;border:2px solid rgba(90,198,122,0.3);border-radius:1rem;padding:1rem">
            <div style="font-size:1.875rem;font-weight:900;color:#198754">${active.length}</div>
            <div style="font-size:10px;font-weight:700;color:#146C43;text-transform:uppercase;letter-spacing:0.1em;margin-top:0.25rem">Estudiantes Activos</div>
          </div>
          <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:1rem;padding:1rem">
            <div style="font-size:1.875rem;font-weight:900;color:#94a3b8">${inactive.length}</div>
            <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;margin-top:0.25rem">Estudiantes Inactivos</div>
          </div>
        </div>

        <div style="border:2px solid #f1f5f9;border-radius:1rem;padding:1rem;margin-bottom:1.25rem">
          <h4 style="font-size:12px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 1rem">Filtros de Generación</h4>

          <div style="margin-bottom:0.75rem">
            <label style="display:block;font-size:10px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;margin-left:4px">Opción de selección</label>
            <select id="carnetFilter" style="width:100%;padding:0.625rem 1rem;border:2px solid #f1f5f9;border-radius:0.75rem;outline:none;font-size:0.875rem;font-weight:500;background:#fff;transition:all 0.2s"
              onchange="document.getElementById('carnetFilterDetail').classList.toggle('hidden', this.value === 'all')">
              <option value="all">Todos los estudiantes activos</option>
              <option value="classroom">Por aula</option>
              <option value="student">Buscar estudiante específico</option>
              <option value="matricula">Por rango de matrícula</option>
              <option value="selected">Solo inactivos (incluidos)</option>
            </select>
          </div>

          <div id="carnetFilterDetail" class="hidden" style="display:none">
            <div id="filterClassroom" class="hidden" style="margin-bottom:0.75rem">
              <label style="display:block;font-size:10px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;margin-left:4px">Seleccionar aula</label>
              <select id="carnetClassroom" style="width:100%;padding:0.625rem 1rem;border:2px solid #f1f5f9;border-radius:0.75rem;outline:none;font-size:0.875rem;font-weight:500;background:#fff">${classroomOpts}</select>
            </div>
            <div id="filterStudent" class="hidden" style="margin-bottom:0.75rem">
              <label style="display:block;font-size:10px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;margin-left:4px">Nombre o matrícula</label>
              <input id="carnetStudentSearch" type="text" placeholder="Buscar..."
                style="width:100%;padding:0.625rem 1rem;border:2px solid #f1f5f9;border-radius:0.75rem;outline:none;font-size:0.875rem;font-weight:500;background:#fff;transition:all 0.2s">
            </div>
            <div id="filterMatricula" class="hidden" style="margin-bottom:0.75rem">
              <label style="display:block;font-size:10px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;margin-left:4px">Rango de matrícula (ej: 2024-2025)</label>
              <div style="display:flex;gap:0.5rem">
                <input id="carnetMatStart" type="text" placeholder="Desde" style="flex:1;padding:0.625rem 0.75rem;border:2px solid #f1f5f9;border-radius:0.75rem;outline:none;font-size:0.875rem;font-weight:500;background:#fff">
                <input id="carnetMatEnd" type="text" placeholder="Hasta" style="flex:1;padding:0.625rem 0.75rem;border:2px solid #f1f5f9;border-radius:0.75rem;outline:none;font-size:0.875rem;font-weight:500;background:#fff">
              </div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:0.5rem;font-size:12px;color:#64748b;font-weight:500">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#198754"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            Se generarán <strong id="carnetEstimate" style="color:#198754">${active.length}</strong> carnets · 8 por hoja (frente + reverso)
          </div>
        </div>

        <div id="carnetProgressContainer" class="hidden">
          <div style="background:#f0fdf4;border:2px solid rgba(90,198,122,0.3);border-radius:1rem;padding:1rem">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
              <span style="font-size:12px;font-weight:700;color:#146C43" id="carnetProgressText">Generando PDF...</span>
              <span style="font-size:12px;font-weight:900;color:#198754" id="carnetProgressPct">0%</span>
            </div>
            <div style="width:100%;background:#fff;border-radius:9999px;height:0.75rem;overflow:hidden;border:1px solid rgba(90,198,122,0.3)">
              <div id="carnetProgressBar" style="height:100%;background:linear-gradient(90deg,#198754,#5AC67A);border-radius:9999px;transition:width 0.3s;width:0%"></div>
            </div>
            <div style="font-size:10px;color:rgba(20,108,67,0.7);margin-top:0.25rem;font-weight:500" id="carnetProgressDetail"></div>
          </div>
        </div>

        <div id="carnetPreviewContainer" class="hidden">
          <div style="border:2px solid #f1f5f9;border-radius:1rem;padding:1rem">
            <h4 style="font-size:12px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 0.75rem">Vista Previa</h4>
            <div style="display:flex;gap:0.75rem;justify-content:center">
              <div style="text-align:center">
                <div style="font-size:9px;font-weight:700;color:#94a3b8;margin-bottom:4px">FRENTE</div>
                <div id="carnetPreviewFront" style="background:#f8fafc;border-radius:0.75rem;border:1px solid #e2e8f0;overflow:hidden;width:256px;height:162px"></div>
              </div>
              <div style="text-align:center">
                <div style="font-size:9px;font-weight:700;color:#94a3b8;margin-bottom:4px">REVERSO</div>
                <div id="carnetPreviewBack" style="background:#f8fafc;border-radius:0.75rem;border:1px solid #e2e8f0;overflow:hidden;width:256px;height:162px"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style="padding:1.5rem;border-top:1px solid #f1f5f9;background:#f8fafc;border-radius:0 0 1.5rem 1.5rem;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:10px;color:#94a3b8;font-weight:700">Carnet PVC: 85.6×54mm · 8 por hoja · A4 vertical</span>
        <div style="display:flex;gap:0.5rem">
          <button onclick="window._carnetsClose()" style="padding:0.625rem 1.25rem;border:2px solid #e2e8f0;color:#475569;font-weight:700;font-size:12px;border-radius:0.75rem;cursor:pointer;background:#fff;transition:all 0.2s">Cancelar</button>
          <button id="btnCarnetGenerate" onclick="window._carnetsGenerate()" style="padding:0.625rem 1.25rem;background:linear-gradient(135deg,#198754,#146C43);color:#fff;font-weight:700;font-size:12px;border-radius:0.75rem;border:none;cursor:pointer;box-shadow:0 10px 15px -3px rgba(90,198,122,0.3);display:flex;align-items:center;gap:0.375rem;transition:all 0.2s">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fff"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            Generar Carnets
          </button>
        </div>
      </div>
    </div>`;

    if (window.openGlobalModal) {
      window.openGlobalModal(html);
    }

    this._bindFilterEvents();
    window._carnetsClose = () => this.closeModal();
    window._carnetsGenerate = () => this._handleGenerate();
  }

  _bindFilterEvents() {
    const filter = document.getElementById('carnetFilter');
    if (!filter) return;
    filter.addEventListener('change', () => {
      const val = filter.value;
      document.getElementById('filterClassroom')?.classList.toggle('hidden', val !== 'classroom');
      document.getElementById('filterStudent')?.classList.toggle('hidden', val !== 'student');
      document.getElementById('filterMatricula')?.classList.toggle('hidden', val !== 'matricula');

      const filtered = this._getFiltered();
      const el = document.getElementById('carnetEstimate');
      if (el) el.textContent = filtered.length;
    });

    const classSelect = document.getElementById('carnetClassroom');
    const searchInput = document.getElementById('carnetStudentSearch');
    const matStart = document.getElementById('carnetMatStart');
    const matEnd = document.getElementById('carnetMatEnd');

    const updateEstimate = () => {
      const filtered = this._getFiltered();
      const el = document.getElementById('carnetEstimate');
      if (el) el.textContent = filtered.length;
    };

    classSelect?.addEventListener('change', updateEstimate);
    searchInput?.addEventListener('input', updateEstimate);
    matStart?.addEventListener('input', updateEstimate);
    matEnd?.addEventListener('input', updateEstimate);
  }

  _getFiltered() {
    const filter = document.getElementById('carnetFilter')?.value || 'all';
    const active = this._students.filter(s => s.is_active !== false);
    const all = this._students;

    switch (filter) {
      case 'classroom': {
        const cid = document.getElementById('carnetClassroom')?.value;
        return active.filter(s => String(s.classroom_id) === String(cid));
      }
      case 'student': {
        const q = (document.getElementById('carnetStudentSearch')?.value || '').toLowerCase().trim();
        if (!q) return active;
        return active.filter(s =>
          (s.name || '').toLowerCase().includes(q) ||
          (s.matricula || '').toLowerCase().includes(q)
        );
      }
      case 'matricula': {
        const start = (document.getElementById('carnetMatStart')?.value || '').trim().toLowerCase();
        const end = (document.getElementById('carnetMatEnd')?.value || '').trim().toLowerCase();
        return active.filter(s => {
          const m = (s.matricula || '').toLowerCase();
          if (start && m < start) return false;
          if (end && m > end) return false;
          return true;
        });
      }
      case 'selected':
        return all;
      default:
        return active;
    }
  }

  async _handleGenerate() {
    const btn = document.getElementById('btnCarnetGenerate');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" style="animation:spin 1s linear infinite;margin-right:6px"><circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" stroke-dasharray="40" stroke-dashoffset="10"/></svg> Generando carnets...';
    }

    try {
      const students = this._getFiltered();
      if (!students.length) {
        this._toast('No hay estudiantes para los filtros seleccionados', 'warning');
        return;
      }

      document.getElementById('carnetProgressContainer')?.classList.remove('hidden');
      await this._generatePDF(students);
      this._toast(`PDF generado correctamente: ${students.length} carnets`, 'success');
    } catch (e) {
      console.error('Carnets PDF error:', e);
      this._toast('Error al generar PDF: ' + (e.message || 'Error desconocido'), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fff"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg> Generar Carnets';
      }
    }
  }

  async _generatePDF(students) {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) throw new Error('Librería jsPDF no disponible');

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const totalPages = Math.ceil(students.length / CARDS_PER_PAGE);
    const now = new Date();
    const dateStr = now.toLocaleDateString('es-ES');
    const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    await this._loadLogo();

    this._qrCache = {};
    for (let i = 0; i < students.length; i++) {
      const s = students[i];
      this._qrCache[s.id] = await this._generateQRWithLogo(s.matricula || String(s.id));
      this._updateProgress(`Generando QR ${i + 1} de ${students.length}`, ((i + 1) / students.length) * 40);
    }

    const totalPagesAll = totalPages * 2;

    for (let page = 0; page < totalPages; page++) {
      if (page > 0) doc.addPage('a4', 'portrait');
      this._drawPageBackground(doc);
      this._drawCutGrid(doc);
      this._drawFooter(doc, `Frente · Página ${page + 1} de ${totalPages}`, totalPagesAll, students.length, dateStr, timeStr);

      for (let i = 0; i < CARDS_PER_PAGE; i++) {
        const idx = page * CARDS_PER_PAGE + i;
        if (idx >= students.length) break;
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const cx = MARGIN_LR + col * (CARD_W + GAP);
        const cy = MARGIN_TB + row * (CARD_H + GAP);
        this._drawFrontCard(doc, students[idx], cx, cy, this._qrCache[students[idx].id]);
        this._drawCutMarks(doc, cx, cy);
      }

      this._updateProgress(`Generando frentes: página ${page + 1} de ${totalPages}`, 40 + ((page + 1) / totalPages) * 30);
    }

    for (let page = 0; page < totalPages; page++) {
      doc.addPage('a4', 'portrait');
      this._drawPageBackground(doc);
      this._drawCutGrid(doc);
      this._drawFooter(doc, `Reverso · Página ${page + 1} de ${totalPages}`, totalPagesAll, students.length, dateStr, timeStr);

      for (let i = 0; i < CARDS_PER_PAGE; i++) {
        const idx = page * CARDS_PER_PAGE + i;
        if (idx >= students.length) break;
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const cx = MARGIN_LR + col * (CARD_W + GAP);
        const cy = MARGIN_TB + row * (CARD_H + GAP);
        this._drawBackCard(doc, students[idx], cx, cy);
        this._drawCutMarks(doc, cx, cy);
      }

      this._updateProgress(`Generando reversos: página ${page + 1} de ${totalPages}`, 70 + ((page + 1) / totalPages) * 28);
    }

    this._updateProgress('Completado · PDF listo para descargar', 100);

    await this._generatePreview(students[0]);

    const ts = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    doc.save(`carnets-karpus-kids-${ts}.pdf`);
  }

  _drawPageBackground(doc) {
    doc.setFillColor(...GREEN.bg);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(50);
    doc.setTextColor(25, 135, 84);
    doc.text('KARPUS KIDS', PAGE_W / 2, PAGE_H / 2, { align: 'center', angle: 90 });
    doc.setFontSize(10);
    doc.setTextColor(90, 198, 122);
    doc.text('Centro de Desarrollo Infantil', PAGE_W / 2, PAGE_H / 2 + 12, { align: 'center', angle: 90 });
  }

  _drawCutGrid(doc) {
    doc.setDrawColor(200, 210, 205);
    doc.setLineWidth(0.1);
    for (let col = 0; col <= COLS; col++) {
      const cx = MARGIN_LR + col * (CARD_W + GAP) - (col === 0 ? 0 : GAP / 2);
      if (col > 0 && col < COLS) {
        for (let y = MARGIN_TB; y < PAGE_H - MARGIN_TB; y += 4) {
          doc.line(cx, y, cx, Math.min(y + 2, PAGE_H - MARGIN_TB));
        }
      }
    }
    for (let row = 0; row <= ROWS; row++) {
      const ry = MARGIN_TB + row * (CARD_H + GAP) - (row === 0 ? 0 : GAP / 2);
      if (row > 0 && row < ROWS) {
        for (let x = MARGIN_LR; x < PAGE_W - MARGIN_LR; x += 4) {
          doc.line(x, ry, Math.min(x + 2, PAGE_W - MARGIN_LR), ry);
        }
      }
    }
  }

  _drawCutMarks(doc, x, y) {
    doc.setDrawColor(150, 160, 155);
    doc.setLineWidth(0.15);
    const m = 3;
    doc.line(x - m, y, x - 0.5, y);
    doc.line(x, y - m, x, y - 0.5);
    doc.line(x + CARD_W + 0.5, y, x + CARD_W + m, y);
    doc.line(x + CARD_W, y - m, x + CARD_W, y - 0.5);
    doc.line(x - m, y + CARD_H, x - 0.5, y + CARD_H);
    doc.line(x, y + CARD_H + 0.5, x, y + CARD_H + m);
    doc.line(x + CARD_W + 0.5, y + CARD_H, x + CARD_W + m, y + CARD_H);
    doc.line(x + CARD_W, y + CARD_H + 0.5, x + CARD_W, y + CARD_H + m);

    const cs = 2;
    doc.setLineWidth(0.1);
    [[x - cs, y], [x + CARD_W + cs, y], [x - cs, y + CARD_H], [x + CARD_W + cs, y + CARD_H]].forEach(([cx, cy]) => {
      doc.line(cx - 1, cy, cx + 1, cy);
      doc.line(cx, cy - 1, cx, cy + 1);
    });
  }

  _drawLogoCorner(doc, x, y) {
    if (!this._logoDataUrl) return;
    try {
      const s = 6;
      doc.addImage(this._logoDataUrl, 'JPEG', x + 1.5, y + 1, s, s);
    } catch (_) {}
  }

  _drawFrontCard(doc, student, x, y, qrDataUrl) {
    const w = CARD_W;
    const h = CARD_H;
    const classroom = this._classrooms.find(c => c.id == student.classroom_id);
    const classroomName = student.classrooms?.name || classroom?.name || 'Sin aula';
    const level = student.classrooms?.level || classroom?.level || '';

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, 2, 2, 'F');
    doc.setDrawColor(...GREEN.light);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, 2, 2, 'S');

    this._drawCardBackground(doc, x, y, w, h);

    doc.setFillColor(...GREEN.primary);
    doc.roundedRect(x, y, w, 8, 1, 1, 'F');

    this._drawLogoCorner(doc, x, y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('KARPUS KIDS', x + w / 2 + 3, y + 5.2, { align: 'center' });
    doc.setFontSize(3);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(210, 240, 220);
    doc.text('Centro de Desarrollo Infantil', x + w / 2 + 3, y + 7.5, { align: 'center' });

    const qrZoneW = 32;
    const qrZoneY = y + 10;
    const qrZoneH = h - 15;
    doc.setFillColor(250, 252, 251);
    doc.roundedRect(x + 0.8, qrZoneY, qrZoneW, qrZoneH, 2, 2, 'F');
    doc.setDrawColor(230, 240, 235);
    doc.setLineWidth(0.15);
    doc.roundedRect(x + 0.8, qrZoneY, qrZoneW, qrZoneH, 2, 2, 'S');

    const qrSize = 24;
    const qrX = x + (qrZoneW - qrSize) / 2 + 0.8;
    const qrY = qrZoneY + 2;

    if (qrDataUrl) {
      try {
        doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

        if (this._logoDataUrl) {
          const logoR = 3.5;
          const logoCx = qrX + qrSize / 2;
          const logoCy = qrY + qrSize / 2;
          doc.setFillColor(255, 255, 255);
          doc.circle(logoCx, logoCy, logoR + 0.8, 'F');
          try {
            doc.addImage(this._logoDataUrl, 'JPEG', logoCx - logoR, logoCy - logoR, logoR * 2, logoR * 2);
          } catch (_) {
            doc.setFillColor(...GREEN.primary);
            doc.circle(logoCx, logoCy, logoR, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(4.5);
            doc.setTextColor(255, 255, 255);
            doc.text('KK', logoCx, logoCy + 1.3, { align: 'center' });
          }
        } else {
          const logoR = 3.5;
          const logoCx = qrX + qrSize / 2;
          const logoCy = qrY + qrSize / 2;
          doc.setFillColor(255, 255, 255);
          doc.circle(logoCx, logoCy, logoR + 0.8, 'F');
          doc.setFillColor(...GREEN.primary);
          doc.circle(logoCx, logoCy, logoR, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(4.5);
          doc.setTextColor(255, 255, 255);
          doc.text('KK', logoCx, logoCy + 1.3, { align: 'center' });
        }
      } catch (e) {
        doc.setFillColor(240, 248, 243);
        doc.roundedRect(qrX, qrY, qrSize, qrSize, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5);
        doc.setTextColor(...GREEN.light);
        doc.text('QR', qrX + qrSize / 2, qrY + qrSize / 2 + 1.5, { align: 'center' });
      }
    }

    const qrTextX = x + qrZoneW / 2 + 0.8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(3.8);
    doc.setTextColor(...GREEN.dark);
    doc.text('Escanee para', qrTextX, qrZoneY + qrZoneH - 9, { align: 'center' });
    doc.text('identificar', qrTextX, qrZoneY + qrZoneH - 5.5, { align: 'center' });

    const shortCode = (student.matricula || String(student.id)).slice(-8);
    doc.setFontSize(3);
    doc.setTextColor(...GREEN.slate);
    doc.text('KK-' + shortCode, qrTextX, qrZoneY + qrZoneH - 2.5, { align: 'center' });

    const infoX = x + qrZoneW + 3;
    const infoW = w - qrZoneW - 6;
    let infoY = y + 11;

    if (this._logoDataUrl) {
      try {
        doc.addImage(this._logoDataUrl, 'JPEG', infoX, infoY - 0.5, 5.5, 4.5);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.5);
        doc.setTextColor(...GREEN.dark);
        doc.text('KARPUS KIDS', infoX + 7, infoY + 2);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(2.8);
        doc.setTextColor(...GREEN.slate);
        doc.text('Centro de Desarrollo Infantil', infoX + 7, infoY + 4.5);
      } catch (_) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6);
        doc.setTextColor(...GREEN.primary);
        doc.text('KARPUS KIDS', infoX, infoY + 2.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(2.8);
        doc.setTextColor(...GREEN.slate);
        doc.text('Centro de Desarrollo Infantil', infoX, infoY + 5);
      }
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6);
      doc.setTextColor(...GREEN.primary);
      doc.text('KARPUS KIDS', infoX, infoY + 2.5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(2.8);
      doc.setTextColor(...GREEN.slate);
      doc.text('Centro de Desarrollo Infantil', infoX, infoY + 5);
    }
    infoY += 7;

    doc.setDrawColor(...GREEN.primary);
    doc.setLineWidth(0.3);
    doc.line(infoX, infoY, infoX + infoW, infoY);
    infoY += 3.5;

    const fullName = student.name || 'Estudiante';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...GREEN.darkText);
    const nameLines = doc.splitTextToSize(fullName.toUpperCase(), infoW);
    doc.text(nameLines[0], infoX, infoY);
    infoY += nameLines.length * 3.5 + 1.5;

    const p1Name = student.p1_name || student._parentName || '';
    const p2Name = student.p2_name || '';
    const p1Phone = student.p1_phone || student._parentPhone || '';
    const p2Phone = student.p2_phone || '';

    const fields = [
      { label: 'AULA', value: classroomName },
      { label: 'MATRÍCULA', value: student.matricula || 'S/M' },
    ];
    if (level) fields.push({ label: 'AÑO ESCOLAR', value: level });
    if (p1Name) fields.push({ label: 'TUTOR 1', value: p1Name });
    if (p2Name) fields.push({ label: 'TUTOR 2', value: p2Name });
    if (p1Phone) fields.push({ label: 'TEL. TUTOR', value: p1Phone });

    const maxFields = 7;
    fields.slice(0, maxFields).forEach(f => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(3.5);
      doc.setTextColor(...GREEN.primary);
      doc.text(f.label + ':', infoX, infoY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(3.5);
      doc.setTextColor(51, 65, 85);
      const valLines = doc.splitTextToSize(f.value, infoW - 20);
      doc.text(valLines[0], infoX + 20, infoY);
      infoY += 3.3;
    });

    if (student.is_active === false) {
      doc.setFillColor(254, 226, 226);
      doc.roundedRect(infoX, infoY, 12, 3, 1, 1, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(3);
      doc.setTextColor(220, 38, 38);
      doc.text('INACTIVO', infoX + 6, infoY + 2, { align: 'center' });
      infoY += 4;
    }

    doc.setFillColor(...GREEN.primary);
    doc.roundedRect(x, y + h - 2.5, w, 2.5, 0, 0, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(3);
    doc.setTextColor(255, 255, 255);
    doc.text('KARPUS KIDS — Sistema Inteligente de Gestión Infantil · www.karpuskids.com', x + w / 2, y + h - 0.7, { align: 'center' });

    this._drawWatermark(doc, x, y, w, h);
    this._drawSecurityBorder(doc, x, y, w, h);
  }

  _drawBackCard(doc, student, x, y) {
    const w = CARD_W;
    const h = CARD_H;

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, 2, 2, 'F');
    doc.setDrawColor(...GREEN.light);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, 2, 2, 'S');

    this._drawCardBackground(doc, x, y, w, h);

    doc.setFillColor(...GREEN.primary);
    doc.roundedRect(x, y, w, 8, 1, 1, 'F');

    this._drawLogoCorner(doc, x, y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('KARPUS KIDS', x + w / 2 + 3, y + 5.2, { align: 'center' });
    doc.setFontSize(3);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(210, 240, 220);
    doc.text('Centro de Desarrollo Infantil', x + w / 2 + 3, y + 7.5, { align: 'center' });

    const cx = x + w / 2;
    const logoSize = 14;

    const logoX = cx - logoSize / 2;
    const logoY = y + 11;

    if (this._logoDataUrl) {
      try {
        doc.setDrawColor(...GREEN.primary);
        doc.setLineWidth(0.6);
        doc.rect(logoX - 0.6, logoY - 0.6, logoSize + 1.2, logoSize + 1.2);
        doc.addImage(this._logoDataUrl, 'JPEG', logoX, logoY, logoSize, logoSize);
      } catch (_) {}
    }

    const line1Y = logoY + logoSize + 3;
    doc.setDrawColor(...GREEN.primary);
    doc.setLineWidth(0.3);
    doc.line(cx - 28, line1Y, cx + 28, line1Y);

    let textY = line1Y + 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(3);
    doc.setTextColor(...GREEN.darkText);
    doc.text('🔒 Este carnet es propiedad de la Estancia Karpus Kids.', cx, textY, { align: 'center' });
    textY += 3.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(2.8);
    doc.setTextColor(...GREEN.slate);
    doc.text('En caso de pérdida favor devolver a la institución.', cx, textY, { align: 'center' });

    const line2Y = textY + 3;
    doc.setDrawColor(...GREEN.primary);
    doc.setLineWidth(0.3);
    doc.line(cx - 28, line2Y, cx + 28, line2Y);

    let contactY = line2Y + 3.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(2.8);
    doc.setTextColor(...GREEN.dark);
    doc.text('📞 ' + INSTITUTIONAL.phone, cx, contactY, { align: 'center' });
    contactY += 3;
    doc.text('✉️ ' + INSTITUTIONAL.email, cx, contactY, { align: 'center' });
    contactY += 3;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(2.5);
    doc.setTextColor(...GREEN.slate);
    doc.text('📍 ' + INSTITUTIONAL.address, cx, contactY, { align: 'center' });

    doc.setFillColor(...GREEN.primary);
    doc.roundedRect(x, y + h - 2.5, w, 2.5, 0, 0, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(3);
    doc.setTextColor(255, 255, 255);
    doc.text('KARPUS KIDS — Sistema Inteligente de Gestión Infantil · www.karpuskids.com', cx, y + h - 0.7, { align: 'center' });

    this._drawWatermark(doc, x, y, w, h);
    this._drawSecurityBorder(doc, x, y, w, h);
  }

  _drawCardBackground(doc, x, y, w, h) {
    const seed = (x * 1000 + y * 100) | 0;
    const pseudoRand = (i) => {
      let v = Math.sin(seed + i * 127.1) * 43758.5453;
      return v - Math.floor(v);
    };

    const patterns = [
      (px, py, sz) => {
        doc.setFillColor(90, 198, 122);
        const s = sz * 0.4;
        for (let a = 0; a < 5; a++) {
          const angle = (a * 144 - 90) * Math.PI / 180;
          const nx = px + s * Math.cos(angle);
          const ny = py + s * Math.sin(angle);
          doc.line(px, py, nx, ny);
        }
      },
      (px, py, sz) => {
        doc.setFillColor(90, 198, 122);
        const r = sz * 0.35;
        doc.circle(px - r * 0.35, py - r * 0.2, r, 'F');
        doc.circle(px + r * 0.35, py - r * 0.2, r, 'F');
        doc.triangle(px - r, py, px + r, py, px, py + r * 1.2, 'F');
      },
      (px, py, sz) => {
        doc.setFillColor(90, 198, 122);
        const r = sz * 0.3;
        doc.circle(px, py, r, 'F');
        doc.circle(px - r * 0.7, py - r * 0.9, r * 0.45, 'F');
        doc.circle(px + r * 0.7, py - r * 0.9, r * 0.45, 'F');
      },
      (px, py, sz) => {
        doc.setFillColor(90, 198, 122);
        doc.rect(px - sz * 0.25, py - sz * 0.35, sz * 0.5, sz * 0.7, 'F');
        doc.circle(px, py - sz * 0.35, sz * 0.2, 'F');
      },
    ];

    const count = 18;
    for (let i = 0; i < count; i++) {
      const px = x + pseudoRand(i) * w;
      const py = y + pseudoRand(i + 50) * h;
      const sz = 2.5 + pseudoRand(i + 100) * 2.5;
      const patIdx = Math.floor(pseudoRand(i + 150) * patterns.length);
      doc.setGState(new doc.GState({ opacity: 0.035 }));
      patterns[patIdx](px, py, sz);
    }
    doc.setGState(new doc.GState({ opacity: 1 }));

    if (this._logoDataUrl) {
      try {
        doc.setGState(new doc.GState({ opacity: 0.04 }));
        const wmS = 32;
        doc.addImage(this._logoDataUrl, 'JPEG', x + w / 2 - wmS / 2, y + h / 2 - wmS / 2, wmS, wmS);
        doc.setGState(new doc.GState({ opacity: 1 }));
      } catch (_) {
        doc.setGState(new doc.GState({ opacity: 1 }));
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.setTextColor(245, 250, 247);
        doc.text('KARPUS KIDS', x + w / 2, y + h / 2 + 3, { align: 'center' });
      }
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(245, 250, 247);
      doc.text('KARPUS KIDS', x + w / 2, y + h / 2 + 3, { align: 'center' });
    }
  }

  _drawWatermark(doc, x, y, w, h) {
    if (this._logoDataUrl) {
      try {
        doc.setGState(new doc.GState({ opacity: 0.05 }));
        const wmS = 28;
        doc.addImage(this._logoDataUrl, 'JPEG', x + w / 2 - wmS / 2, y + h / 2 - wmS / 2, wmS, wmS);
        doc.setGState(new doc.GState({ opacity: 1 }));
        return;
      } catch (_) {
        doc.setGState(new doc.GState({ opacity: 1 }));
      }
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(245, 250, 247);
    doc.text('KARPUS KIDS', x + w / 2, y + h / 2 + 3, { align: 'center' });
  }

  _drawSecurityBorder(doc, x, y, w, h) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(1.2);
    doc.setTextColor(230, 242, 234);

    const secText = 'KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL · ';
    const topRepeats = Math.ceil(w / secText.length) + 1;
    doc.text(secText.repeat(topRepeats).slice(0, Math.floor(w / 1.8)), x + w / 2, y + 1.3, { align: 'center' });

    const bottomRepeats = Math.ceil(w / secText.length) + 1;
    doc.text(secText.repeat(bottomRepeats).slice(0, Math.floor(w / 1.8)), x + w / 2, y + h - 3.5, { align: 'center' });
  }

  _drawFooter(doc, label, totalPages, studentCount, dateStr, timeStr) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5);
    doc.setTextColor(...GREEN.slate);
    doc.text(`Karpus Kids — Carnet Institucional · ${dateStr} · ${timeStr}`, MARGIN_LR, PAGE_H - 5);
    doc.text(`${studentCount} carnets · ${label}`, PAGE_W / 2, PAGE_H - 5, { align: 'center' });
    doc.text(`Admin: ${this._adminName}`, PAGE_W - MARGIN_LR, PAGE_H - 5, { align: 'right' });
  }

  _updateProgress(text, pct) {
    const txtEl = document.getElementById('carnetProgressText');
    const pctEl = document.getElementById('carnetProgressPct');
    const barEl = document.getElementById('carnetProgressBar');
    const detEl = document.getElementById('carnetProgressDetail');
    if (txtEl) txtEl.textContent = text;
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    if (barEl) barEl.style.width = Math.round(pct) + '%';
    if (detEl) detEl.textContent = pct >= 100 ? 'PDF listo para descargar' : '';
  }

  async _generatePreview(student) {
    if (!student) return;
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) return;

    try {
      const qrUrl = this._qrCache[student.id] || await this._generateQRWithLogo(student.matricula || String(student.id));

      const frontDoc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [CARD_W + 4, CARD_H + 4] });
      frontDoc.setFillColor(255, 255, 255);
      frontDoc.rect(0, 0, CARD_W + 4, CARD_H + 4, 'F');
      this._drawFrontCard(frontDoc, student, 2, 2, qrUrl);
      const frontBlob = frontDoc.output('blob');
      const frontUrl = URL.createObjectURL(frontBlob);

      const backDoc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [CARD_W + 4, CARD_H + 4] });
      backDoc.setFillColor(255, 255, 255);
      backDoc.rect(0, 0, CARD_W + 4, CARD_H + 4, 'F');
      this._drawBackCard(backDoc, student, 2, 2);
      const backBlob = backDoc.output('blob');
      const backUrl = URL.createObjectURL(backBlob);

      const frontEl = document.getElementById('carnetPreviewFront');
      const backEl = document.getElementById('carnetPreviewBack');
      if (frontEl) frontEl.innerHTML = `<iframe src="${frontUrl}" class="w-full h-full border-0" style="width:256px;height:162px;"></iframe>`;
      if (backEl) backEl.innerHTML = `<iframe src="${backUrl}" class="w-full h-full border-0" style="width:256px;height:162px;"></iframe>`;
      document.getElementById('carnetPreviewContainer')?.classList.remove('hidden');
    } catch (e) {
      console.warn('Preview generation failed:', e);
    }
  }

  async _generateQRWithLogo(text) {
    await this._ensureQRLibrary();
    return new Promise((resolve) => {
      const temp = document.createElement('div');
      temp.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:300px;height:300px;';
      document.body.appendChild(temp);
      try {
        new window.QRCode(temp, {
          text: text,
          width: 300,
          height: 300,
          colorDark: '#198754',
          colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel.H,
        });
        setTimeout(async () => {
          const canvas = temp.querySelector('canvas');
          const img = temp.querySelector('img');
          let dataUrl = null;

          if (canvas) {
            const logoSrc = this._logoDataUrl || await this._loadLogo();
            if (logoSrc) {
              const ctx = canvas.getContext('2d');
              const size = canvas.width;
              const logoSize = size * 0.2;
              const logoX = (size - logoSize) / 2;
              const logoY = (size - logoSize) / 2;

              ctx.fillStyle = '#ffffff';
              ctx.beginPath();
              ctx.arc(size / 2, size / 2, logoSize / 2 + 6, 0, Math.PI * 2);
              ctx.fill();

              const logoImg = new Image();
              logoImg.crossOrigin = 'anonymous';
              logoImg.onload = () => {
                ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
                dataUrl = canvas.toDataURL('image/png');
                document.body.removeChild(temp);
                resolve(dataUrl);
              };
              logoImg.onerror = () => {
                const fallbackCanvas = document.createElement('canvas');
                fallbackCanvas.width = logoSize;
                fallbackCanvas.height = logoSize;
                const fctx = fallbackCanvas.getContext('2d');
                fctx.fillStyle = '#198754';
                fctx.beginPath();
                fctx.arc(logoSize / 2, logoSize / 2, logoSize / 2, 0, Math.PI * 2);
                fctx.fill();
                fctx.fillStyle = '#ffffff';
                fctx.font = `bold ${logoSize * 0.4}px Arial`;
                fctx.textAlign = 'center';
                fctx.textBaseline = 'middle';
                fctx.fillText('KK', logoSize / 2, logoSize / 2);
                ctx.drawImage(fallbackCanvas, logoX, logoY, logoSize, logoSize);
                dataUrl = canvas.toDataURL('image/png');
                document.body.removeChild(temp);
                resolve(dataUrl);
              };
              logoImg.src = logoSrc;
              return;
            }
            dataUrl = canvas.toDataURL('image/png');
          } else if (img) {
            dataUrl = img.src;
          }
          document.body.removeChild(temp);
          resolve(dataUrl);
        }, 150);
      } catch (e) {
        document.body.removeChild(temp);
        resolve(null);
      }
    });
  }

  _ensureQRLibrary() {
    return new Promise((resolve) => {
      if (window.QRCode) { resolve(); return; }
      const s = document.createElement('script');
      s.src = '/js/shared/qrcode.min.js';
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    });
  }

  _toast(msg, type = 'success') {
    if (window.Helpers?.toast) Helpers.toast(msg, type);
    else if (window.safeToast) window.safeToast(msg, type);
  }
}

const _instance = new CarnetsManager();
export const CarnetsModule = { openModal: () => _instance.openModal() };
