/**
 * 🧰 Helpers PRO - Nivel Empresa
 */

export const Helpers = {

  /**
   * 🛡️ Escapar HTML
   */


  /**
   * Helper para asignar texto a un elemento por ID
   */
  setTxt(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  },


  /**
   * 🔔 Toast moderno
   */
  toast(msg, type = 'success', duration = 4000) {

    if (!msg) return;

    document
      .querySelectorAll('.app-toast')
      .forEach(t => t.remove());

    const el =
      document.createElement('div');

    el.className = `
      app-toast
      fixed bottom-6 left-1/2 -translate-x-1/2
      z-[999]
      flex items-center gap-3
      px-6 py-3
      rounded-2xl
      shadow-2xl
      border
      text-sm
      font-bold
      transition-all
      duration-300
      ${

        type === 'error'
        ? 'bg-rose-500 text-white border-rose-400'

        : type === 'warning'
        ? 'bg-amber-500 text-white border-amber-400'

        : 'bg-slate-900 text-white border-slate-800'

      }
    `;

    el.innerHTML = `

      <div class="w-2 h-2 bg-white rounded-full animate-pulse"></div>

      ${Helpers.escapeHTML(msg)}

    `;

    document.body.appendChild(el);

    setTimeout(() => {

      el.classList.add(
        'opacity-0',
        'translate-y-2'
      );

      setTimeout(
        () => el.remove(),
        300
      );

    }, duration);

  },


  /**
   * ❌ Error state con botón de reintentar
   * @param {string} msg — mensaje de error
   */
  errorState(msg) {
    return `
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <div class="w-16 h-16 bg-rose-50 text-rose-500 rounded-3xl flex items-center justify-center mb-4">
          <i data-lucide="alert-circle" class="w-8 h-8"></i>
        </div>
        <h4 class="text-sm font-black text-slate-800 uppercase tracking-widest">${Helpers.escapeHTML(msg)}</h4>
        <button onclick="location.reload()" class="mt-4 px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-xs uppercase transition-all">Reintentar</button>
      </div>
    `;
  },

  /**
   * 📳 Haptic Feedback (Vibración sutil para móvil)
   */
  _vibrateEnabled: false,

  _initVibrate() {
    if (this._vibrateEnabled) return;
    const enable = () => { this._vibrateEnabled = true; };
    ['pointerdown', 'touchstart', 'click'].forEach(evt =>
      document.addEventListener(evt, enable, { once: true, passive: true })
    );
  },

  vibrate(style = 'light') {
    if (!this._vibrateEnabled) {
      this._initVibrate();
      return;
    }
    if (!('vibrate' in navigator)) return;

    try {
      const patterns = {
        light: 10,
        medium: 20,
        heavy: 40,
        success: [10, 40, 10],
        error: [60, 100, 60]
      };
      navigator.vibrate(patterns[style] || 10);
    } catch (e) {
      // Silenciar error de navegador
    }
  },

  /**
   * 📅 Obtener fecha local en formato YYYY-MM-DD
   * Evita el error de cambio de día prematuro (UTC vs Local)
   */
  getYYYYMMDD(date = new Date()) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  /**
   * 📥 Cargar logo institucional como data URL
   */
  async _loadLogoAsDataURL(src = 'img/mundo.jpg') {
    try {
      const base = window.location.origin || '';
      const url = `${base}/${src}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Logo not found');
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read logo'));
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('Logo load failed:', e);
      return null;
    }
  },

  /**
   * 📱 Generar QR con logo institucional en el centro
   */
  async generateQRWithLogo(text, options = {}) {
    const { width = 300, colorDark = '#198754' } = options;
    if (typeof window.QRCode === 'undefined') {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/shared/qrcode.min.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return new Promise((resolve) => {
      const temp = document.createElement('div');
      temp.style.cssText = `position:absolute;left:-9999px;top:-9999px;width:${width}px;height:${width}px;`;
      document.body.appendChild(temp);
      try {
        new window.QRCode(temp, {
          text,
          width,
          height: width,
          colorDark,
          colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel.H,
        });
        setTimeout(async () => {
          const canvas = temp.querySelector('canvas');
          const img = temp.querySelector('img');
          let dataUrl = null;
          if (canvas) {
            const logoSrc = await this._loadLogoAsDataURL('img/karpus.jpg');
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
  },

  /**
   * 🖨️ Carnet Estudiante — Frente + Reverso (PVC 85.6×54mm)
   */
  getQRPrintTemplate(qrImg, name, matricula, extra = {}) {
    const classroom = extra.classroom || '';
    const level = extra.level || '';
    const p1Name = extra.p1Name || '';
    const p2Name = extra.p2Name || '';
    const p1Phone = extra.p1Phone || '';
    const p2Phone = extra.p2Phone || '';
    const schoolPhone = extra.schoolPhone || '(829) 803-8424';
    const schoolEmail = extra.schoolEmail || 'karpuskids@gmail.com';
    const schoolAddress = extra.schoolAddress || 'Al lado de Iglesia Bethel Brazos Abiertos, Urbanización Genesis, C. Raúl Mondesí, San Cristóbal 91000';
    const isInactive = extra.isInactive || false;
    const shortCode = (matricula || '').slice(-8);
    const logoUrl = 'img/karpus.jpg';

    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Carnet Karpus Kids — ${matricula}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;900&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Nunito', sans-serif;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            min-height: 100vh; margin: 0; background: #f1f5f9; padding: 10mm 0; gap: 8mm;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          @page { size: 85.6mm 54mm; margin: 0; }
          .carnet {
            width: 85.6mm; height: 54mm; background: #fff;
            border-radius: 0; overflow: hidden;
            position: relative; box-shadow: 0 2px 16px rgba(0,0,0,0.1);
            page-break-after: always;
          }
          .carnet-back { page-break-after: auto; }
          .top-bar {
            height: 8mm; background: linear-gradient(135deg, #198754, #146C43);
            display: flex; align-items: center; padding: 0 3mm; gap: 2mm;
          }
          .top-bar-text { flex: 1; }
          .top-bar-name { font-size: 6.5pt; font-weight: 900; color: #fff; line-height: 1.1; }
          .top-bar-sub { font-size: 2.5pt; font-weight: 400; color: rgba(255,255,255,0.75); }
          .top-bar img.bar-logo {
            width: 5.5mm; height: 5.5mm; border-radius: 0.6mm; object-fit: cover;
            border: 0.3mm solid rgba(255,255,255,0.4);
          }
          .security {
            position: absolute; left: 0; right: 0;
            font-size: 2.8pt; font-weight: 800; color: rgba(255,255,255,0.28);
            text-transform: uppercase; letter-spacing: 0.2px; text-align: center;
            white-space: nowrap; overflow: hidden; pointer-events: none; z-index: 3;
          }
          .security-top { top: 0.4mm; }
          .security-bottom { bottom: 0.4mm; }
          .card-body { display: flex; height: calc(100% - 10.5mm); }
          .left-side {
            width: 37%; display: flex; flex-direction: column;
            align-items: center; justify-content: center; padding: 2.5mm;
            background: #f8fdfa; border-right: 0.5px solid #d1e7dd;
            position: relative;
          }
          .left-side::before {
            content: '';
            position: absolute; inset: 0;
            background:
              radial-gradient(circle at 20% 20%, rgba(25,135,84,0.06) 0 1.3mm, transparent 1.4mm),
              radial-gradient(circle at 75% 75%, rgba(25,135,84,0.05) 0 1mm, transparent 1.1mm);
          }
          .left-side img.qr-img {
            width: 24mm; height: 24mm; border-radius: 1.5mm;
            display: block; position: relative; z-index: 1;
          }
          .qr-label {
            font-size: 3.2pt; font-weight: 700; color: #198754;
            text-align: center; margin-top: 1.2mm; line-height: 1.3;
            position: relative; z-index: 1;
          }
          .qr-code {
            font-size: 2.8pt; color: #94a3b8; font-weight: 700; margin-top: 0.3mm;
            font-family: monospace; position: relative; z-index: 1;
          }
          .right-side {
            width: 63%; padding: 2.5mm 3mm; display: flex;
            flex-direction: column; justify-content: center;
          }
          .right-header {
            display: flex; align-items: center; gap: 1.5mm; margin-bottom: 1mm;
          }
          .right-header img.right-logo {
            width: 7mm; height: 7mm; border-radius: 0.5mm; object-fit: cover;
          }
          .right-header .right-title {
            font-size: 7pt; font-weight: 900; color: #198754;
            text-transform: uppercase; line-height: 1.1;
          }
          .right-header .right-sub {
            font-size: 3pt; color: #64748b; font-weight: 700;
          }
          .right-divider {
            height: 0.3mm; background: linear-gradient(90deg, #198754, #d1e7dd);
            margin-bottom: 1.2mm;
          }
          .student-name-card {
            font-size: 6.5pt; font-weight: 900; color: #0f172a;
            line-height: 1.15; margin-bottom: 1.2mm; text-transform: uppercase;
          }
          .field-row {
            font-size: 3pt; font-weight: 700; color: #64748b;
            margin-bottom: 0.7mm; display: flex;
          }
          .field-label { color: #198754; min-width: 18mm; }
          .field-value { color: #334155; font-weight: 400; flex: 1; }
          .field-value.bold { font-weight: 700; }
          .bottom-bar {
            height: 2.5mm; background: #198754;
            display: flex; align-items: center; justify-content: center;
          }
          .bottom-bar-text {
            font-size: 2.8pt; font-weight: 800; color: #fff;
            text-transform: uppercase; letter-spacing: 0.3px;
          }
          .watermark {
            position: absolute; top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            width: 30mm; height: 30mm; object-fit: cover;
            opacity: 0.045; pointer-events: none; z-index: 0;
          }
          .inactive-badge {
            position: absolute; bottom: 5mm; right: 3mm;
            background: #fecaca; color: #dc2626;
            font-size: 2.8pt; font-weight: 900;
            padding: 0.5mm 2mm; border-radius: 1mm;
          }
          /* ── REVERSO ── */
          .back-logo-area {
            flex: 1; display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            padding: 2mm;
          }
          .back-logo-wrapper {
            border: 0.6mm solid #198754; border-radius: 1mm;
            padding: 0.5mm; margin-bottom: 2.5mm;
          }
          .back-logo-wrapper img.back-logo-img {
            width: 16mm; height: 16mm; display: block; object-fit: cover;
          }
          .back-divider {
            width: 65%; height: 0.3mm; background: #198754; margin: 0 auto 2.5mm;
          }
          .back-ownership {
            font-size: 3pt; font-weight: 700; color: #0f172a;
            text-align: center; line-height: 1.4; margin-bottom: 0.5mm;
          }
          .back-sub {
            font-size: 2.5pt; color: #64748b; text-align: center; margin-bottom: 2.5mm;
          }
          .back-contact {
            font-size: 2.5pt; font-weight: 700; color: #146C43;
            text-align: center; line-height: 1.6;
          }
          .back-contact .light { font-weight: 400; color: #64748b; font-size: 2.2pt; }
          .back-watermark {
            position: absolute; top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            width: 28mm; height: 28mm; object-fit: cover;
            opacity: 0.045; pointer-events: none; z-index: 0;
          }
          @media print {
            body { background: white; padding: 0; gap: 0; }
            .carnet { box-shadow: none; page-break-after: always; }
            .carnet-back { page-break-after: auto; }
          }
        </style>
      </head>
      <body>
        <!-- ─── FRENTE ─── -->
        <div class="carnet">
          <div class="security security-top">KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL · KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL · KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL · KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL ·</div>
          <img class="watermark" src="${logoUrl}" alt="">
          <div class="top-bar">
            <img class="bar-logo" src="${logoUrl}" alt="">
            <div class="top-bar-text">
              <div class="top-bar-name">KARPUS KIDS</div>
              <div class="top-bar-sub">Centro de Desarrollo Infantil</div>
            </div>
          </div>
          <div class="card-body">
            <div class="left-side">
              <img class="qr-img" src="${qrImg}" alt="QR">
              <div class="qr-label">Escanee para identificar</div>
              <div class="qr-code">KK-${shortCode}</div>
            </div>
            <div class="right-side">
              <div class="right-header">
                <img class="right-logo" src="${logoUrl}" alt="">
                <div>
                  <div class="right-title">KARPUS KIDS</div>
                  <div class="right-sub">Centro de Desarrollo Infantil</div>
                </div>
              </div>
              <div class="right-divider"></div>
              <div class="student-name-card">${name || 'Estudiante'}</div>
              <div class="field-row"><span class="field-label">AULA:</span><span class="field-value bold">${classroom || '—'}</span></div>
              <div class="field-row"><span class="field-label">MATRÍCULA:</span><span class="field-value bold">${matricula || '—'}</span></div>
              <div class="field-row"><span class="field-label">AÑO ESCOLAR:</span><span class="field-value bold">${level || '—'}</span></div>
              <div class="field-row"><span class="field-label">TUTOR 1:</span><span class="field-value">${p1Name || '—'}</span></div>
              <div class="field-row"><span class="field-label">TUTOR 2:</span><span class="field-value">${p2Name || '—'}</span></div>
              <div class="field-row"><span class="field-label">TEL. TUTOR:</span><span class="field-value">${p1Phone || '—'}</span></div>
            </div>
          </div>
          ${isInactive ? '<div class="inactive-badge">INACTIVO</div>' : ''}
          <div class="bottom-bar">
            <span class="bottom-bar-text">KARPUS KIDS — Sistema Inteligente de Gestión Infantil</span>
          </div>
          <div class="security security-bottom">KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL · KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL · KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL · KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL ·</div>
        </div>
        <!-- ─── REVERSO ─── -->
        <div class="carnet carnet-back">
          <div class="security security-top">KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL · KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL · KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL · KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL ·</div>
          <img class="back-watermark" src="${logoUrl}" alt="">
          <div class="top-bar">
            <img class="bar-logo" src="${logoUrl}" alt="">
            <div class="top-bar-text">
              <div class="top-bar-name">KARPUS KIDS</div>
              <div class="top-bar-sub">Centro de Desarrollo Infantil</div>
            </div>
          </div>
          <div class="card-body">
            <div class="back-logo-area">
              <div class="back-logo-wrapper">
                <img class="back-logo-img" src="${logoUrl}" alt="">
              </div>
              <div class="back-divider"></div>
              <div class="back-ownership">🔒 Este carnet es propiedad de<br>la Estancia Karpus Kids.</div>
              <div class="back-sub">En caso de pérdida favor devolver a la institución.</div>
              <div class="back-divider"></div>
              <div class="back-contact">
                📞 ${schoolPhone}<br>
                ✉️ ${schoolEmail}<br>
                <span class="light">📍 ${schoolAddress}</span>
              </div>
            </div>
          </div>
          <div class="bottom-bar">
            <span class="bottom-bar-text">KARPUS KIDS — Sistema Inteligente de Gestión Infantil · www.karpuskids.com</span>
          </div>
          <div class="security security-bottom">KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL · KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL · KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL · KARPUS KIDS · CENTRO DE DESARROLLO INFANTIL ·</div>
        </div>
        <script>
          window.onload = () => { setTimeout(() => { window.print(); }, 400); }
        </script>
      </body>
      </html>
    `;
  },

  /**
   * 🪪 Carnet Personal Administrativo — Horizontal (PVC 85.6×54mm)
   */
  getStaffCarnetTemplate(name, role, phone, extra = {}) {
    const logoUrl = 'img/karpus.jpg';
    const id = extra.accessCode || extra.id || '—';
    const qrImg = extra.qrImg || '';
    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Credencial Karpus Kids — ${name}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;900&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Nunito', sans-serif;
            display: flex; align-items: center; justify-content: center;
            min-height: 100vh; background: #f1f5f9;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          @page { size: 85.6mm 54mm; margin: 0; }
          .carnet {
            width: 85.6mm; height: 54mm; background: #fff;
            position: relative; overflow: hidden;
            box-shadow: 0 2px 16px rgba(0,0,0,0.1);
          }
          .top-bar {
            height: 8mm; background: linear-gradient(135deg, #1e40af, #1d4ed8);
            display: flex; align-items: center; padding: 0 3mm; gap: 2mm;
          }
          .top-bar-text { flex: 1; }
          .top-bar-name { font-size: 6.5pt; font-weight: 900; color: #fff; line-height: 1.1; }
          .top-bar-sub { font-size: 2.5pt; font-weight: 400; color: rgba(255,255,255,0.75); }
          .top-bar img.bar-logo {
            width: 5.5mm; height: 5.5mm; border-radius: 0.6mm; object-fit: cover;
            border: 0.3mm solid rgba(255,255,255,0.4);
          }
          .card-body { display: flex; height: calc(100% - 10.5mm); }
          .left-side {
            width: 40%; display: flex; flex-direction: column;
            align-items: center; justify-content: center; padding: 2.5mm;
            background: #f8faff; border-right: 0.5px solid #dbeafe;
            position: relative; overflow: hidden;
          }
          .left-side::before {
            content: '';
            position: absolute; inset: 0;
            background:
              radial-gradient(circle at 18% 22%, rgba(29,78,216,0.07) 0 1.4mm, transparent 1.5mm),
              radial-gradient(circle at 75% 72%, rgba(29,78,216,0.06) 0 1.1mm, transparent 1.2mm),
              radial-gradient(circle at 30% 88%, rgba(29,78,216,0.05) 0 0.9mm, transparent 1mm);
          }
          .left-side img.staff-logo {
            width: 21mm; height: 21mm; border-radius: 1.2mm; object-fit: cover;
            border: 0.4mm solid #c7d6f5; padding: 0.6mm; background: #fff;
            box-shadow: 0 0.5mm 2mm rgba(29,78,216,0.14);
            position: relative; z-index: 1;
          }
          .staff-badge {
            margin-top: 1.8mm; position: relative; z-index: 1;
            background: linear-gradient(135deg, #1e40af, #1d4ed8); color: #fff;
            font-size: 3.4pt; font-weight: 900;
            padding: 0.6mm 2mm; border-radius: 0.8mm;
            text-transform: uppercase; letter-spacing: 0.5px;
          }
          .staff-role {
            margin-top: 1mm; position: relative; z-index: 1;
            font-size: 3pt; font-weight: 800; color: #1e40af;
            text-transform: uppercase; letter-spacing: 0.5px;
          }
          .left-side img.qr-img {
            width: 22mm; height: 22mm; border-radius: 1.5mm; object-fit: contain;
            border: 0.4mm solid #fff; box-shadow: 0 0.5mm 2mm rgba(29,78,216,0.14);
            background: #fff; padding: 0.4mm; position: relative; z-index: 1;
          }
          .left-side .qr-label {
            margin-top: 1.5mm; position: relative; z-index: 1;
            font-size: 3.2pt; font-weight: 800; color: #1e40af;
            text-align: center; line-height: 1.3;
          }
          .left-side .qr-code {
            margin-top: 0.4mm; position: relative; z-index: 1;
            font-size: 3pt; font-weight: 700; color: #94a3b8;
            font-family: monospace;
          }
          .right-side {
            width: 60%; padding: 2.5mm 3mm;
            display: flex; flex-direction: column; justify-content: center;
          }
          .right-header { display: flex; align-items: center; gap: 1.5mm; margin-bottom: 1mm; }
          .right-header img.right-logo {
            width: 7mm; height: 7mm; border-radius: 0.6mm; object-fit: cover;
            border: 0.3mm solid #dbeafe;
          }
          .right-title {
            font-size: 7pt; font-weight: 900; color: #1e40af;
            text-transform: uppercase; line-height: 1.1;
          }
          .right-sub { font-size: 2.8pt; color: #64748b; font-weight: 700; }
          .right-divider {
            height: 0.3mm; background: linear-gradient(90deg, #1e40af, #dbeafe);
            margin-bottom: 1.2mm;
          }
          .staff-name {
            font-size: 7.5pt; font-weight: 900; color: #0f172a;
            line-height: 1.15; margin-bottom: 1.5mm; text-transform: uppercase;
          }
          .field-row {
            font-size: 3.2pt; font-weight: 700; color: #64748b;
            margin-bottom: 0.9mm; display: flex; align-items: baseline;
          }
          .field-label { color: #1e40af; min-width: 17mm; text-transform: uppercase; letter-spacing: 0.3px; }
          .field-value { color: #334155; font-weight: 400; flex: 1; }
          .field-value.bold { font-weight: 700; color: #0f172a; }
          .bottom-bar {
            height: 2.5mm; background: #1e40af;
            display: flex; align-items: center; justify-content: center;
          }
          .bottom-bar-text {
            font-size: 2.8pt; font-weight: 800; color: #fff;
            text-transform: uppercase; letter-spacing: 0.3px;
          }
          .watermark {
            position: absolute; top: 50%; left: 50%;
            transform: translate(-50%, -50%) rotate(-15deg);
            font-size: 24pt; font-weight: 900;
            color: rgba(30,64,175,0.035);
            white-space: nowrap; pointer-events: none; z-index: 0;
          }
          @media print {
            body { background: white; }
            .carnet { box-shadow: none; }
          }
        </style>
      </head>
      <body>
        <div class="carnet">
          <div class="watermark">PERSONAL ADMINISTRATIVO</div>
          <div class="top-bar">
            <img class="bar-logo" src="${logoUrl}" alt="">
            <div class="top-bar-text">
              <div class="top-bar-name">KARPUS KIDS</div>
              <div class="top-bar-sub">Centro de Desarrollo Infantil</div>
            </div>
          </div>
          <div class="card-body">
            <div class="left-side">
              ${qrImg
                ? `<img class="qr-img" src="${qrImg}" alt="QR">
              <div class="qr-label">Escanee para identificar</div>
              <div class="qr-code">${id}</div>`
                : `<img class="staff-logo" src="${logoUrl}" alt="">
              <div class="staff-badge">Personal Administrativo</div>`}
            </div>
            <div class="right-side">
              <div class="right-header">
                <img class="right-logo" src="${logoUrl}" alt="">
                <div>
                  <div class="right-title">KARPUS KIDS</div>
                  <div class="right-sub">Centro de Desarrollo Infantil</div>
                </div>
              </div>
              <div class="right-divider"></div>
              <div class="staff-name">${name || 'Nombre'}</div>
              <div class="field-row"><span class="field-label">ROL:</span><span class="field-value bold">${role || '—'}</span></div>
              <div class="field-row"><span class="field-label">ID:</span><span class="field-value bold">${id}</span></div>
              <div class="field-row"><span class="field-label">TELÉFONO:</span><span class="field-value">${phone || '—'}</span></div>
              <div class="field-row"><span class="field-label">INSTITUCIÓN:</span><span class="field-value">Karpus Kids</span></div>
            </div>
          </div>
          <div class="bottom-bar">
            <span class="bottom-bar-text">KARPUS KIDS — Sistema Inteligente de Gestión Infantil · www.karpuskids.com</span>
          </div>
        </div>
        <script>window.onload=()=>{setTimeout(()=>{window.print()},400)}</script>
      </body>
      </html>
    `;
  },

  /**
   * 🎭 Escape HTML
   */
  escapeHTML(str = '') {
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  },

  /**
   * 🎭 Empty state
   */
  emptyState(msg = 'Sin datos', icon = 'smile') {

    return `

      <div class="

        flex flex-col
        items-center
        justify-center
        p-12
        text-center

        bg-slate-50/60

        rounded-[3rem]

        border-2
        border-dashed
        border-slate-200

      ">

        <div class="

          w-20 h-20
          bg-white
          rounded-full
          flex
          items-center
          justify-center
          mb-6
          shadow-xl

        ">

          <i
            data-lucide="${icon}"
            class="w-10 h-10 text-slate-300"
          ></i>

        </div>

        <h4 class="

          text-slate-800
          font-black
          text-lg
          mb-2

        ">

          Sin datos

        </h4>

        <p class="

          text-slate-400
          font-bold
          text-sm
          max-w-[260px]

        ">

          ${Helpers.escapeHTML(msg)}

        </p>

      </div>

    `;

  },


  /**
   * ❓ Confirmación nativa (wrapper)
   */
  async confirm(msg = '¿Estás seguro?') {
    return window.confirm(msg);
  },

  /**
   * 🦴 Skeleton lista
   */
  skeleton(rows = 3, height = 'h-24') {
    return Array(rows).fill(0).map(() => `
      <tr class="animate-pulse border-b border-slate-50">
        <td colspan="100%" class="px-6 py-4">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 bg-slate-100 rounded-2xl"></div>
            <div class="flex-1 space-y-2">
              <div class="h-3 bg-slate-100 rounded-full w-1/3"></div>
              <div class="h-2 bg-slate-50 rounded-full w-1/4"></div>
            </div>
          </div>
        </td>
      </tr>
    `).join('');
  },


  /**
   * 🧱 Skeleton automático por ID
   */
  skeletonize(ids = []) {

    ids.forEach(id => {

      const el =
        document.getElementById(id);

      if (!el) return;


      // calendario
      if (
        id
        .toLowerCase()
        .includes('calendar')
      ) {

        el.innerHTML = `

          <div class="

            h-48
            bg-slate-100
            rounded-2xl
            animate-pulse

          "></div>

        `;

        return;

      }


      // listas
      if (
        id
        .toLowerCase()
        .includes('list')
      ) {

        el.innerHTML =
          Helpers.skeleton(
            3,
            'h-12'
          );

        return;

      }


      // KPI
      el.innerHTML = `

        <div class="

          h-8
          w-32

          bg-slate-200

          rounded-xl

          animate-pulse

        "></div>

      `;

    });

  },


  /**
   * 🪟 loading overlay global
   */
  showLoader(msg = 'Cargando...') {

    Helpers.hideLoader();

    const el =
      document.createElement('div');

    el.id = 'globalLoader';

    el.className = `

      fixed
      inset-0

      bg-white/70
      backdrop-blur-sm

      flex
      items-center
      justify-center

      z-[999]

    `;

    el.innerHTML = `

      <div class="

        flex
        flex-col
        items-center
        gap-4

        p-8

        bg-white

        rounded-3xl

        shadow-xl

      ">

        <div class="

          w-10
          h-10

          border-4
          border-slate-200
          border-t-indigo-500

          rounded-full

          animate-spin

        "></div>

        <p class="

          text-sm
          font-bold
          text-slate-600

        ">

          ${Helpers.escapeHTML(msg)}

        </p>

      </div>

    `;

    document.body.appendChild(el);

  },


  hideLoader() {

    document
      .getElementById(
        'globalLoader'
      )
      ?.remove();

  },




  /**
   * ⏳ debounce pro
   */
  debounce(
    func,
    wait = 300
  ) {

    let timeout;

    const debounced =
      (...args) => {

        clearTimeout(timeout);

        timeout =
          setTimeout(
            () => func(...args),
            wait
          );

      };

    debounced.cancel =
      () =>
        clearTimeout(timeout);

    return debounced;

  },

  /**
   * 🛡️ try/catch global con logging a DB
   */
  async safe(fn, context = 'global') {
    try {
      return await fn();
    } catch (err) {
      Helpers.safeLog('error', `[Safe:${context}]`, err);
      
      // Registrar error en la tabla system_errors de forma silenciosa
      try {
        const { supabase } = await import('./supabase.js');
        const user = (await supabase.auth.getUser())?.data?.user;
        
        await supabase.from('system_errors').insert([{
          context,
          message: err.message,
          stack: err.stack,
          user_id: user?.id,
          url: window.location.href,
          user_agent: navigator.userAgent
        }]);
      } catch (logErr) {
        // No use console.warn here either to be safe
      }

      Helpers.toast('Algo no salió bien. El equipo técnico ha sido notificado.', 'error');
      return null;
    }
  },

  /**
   * 🛡️ Sanitiza datos sensibles para logs
   */
  sanitizeData(data) {
    if (!data) return data;
    
    if (typeof data === 'string') {
      return data;
    }
    
    if (Array.isArray(data)) {
      return data.map(item => Helpers.sanitizeData(item));
    }
    
    if (typeof data === 'object') {
      const sanitized = {};
      for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes('password') || lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('credential') || lowerKey.includes('key')) {
            sanitized[key] = '[REDACTED]';
          } else {
            sanitized[key] = Helpers.sanitizeData(data[key]);
          }
        }
      }
      return sanitized;
    }
    
    return data;
  },
  
  /**
   * 🛡️ Logging seguro - solo muestra datos no sensibles en entorno de desarrollo
   */
  safeLog(level, ...args) {
    // Check if we're in development mode (you can set window.NODE_ENV or similar)
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isDev) return;
    
    const sanitizedArgs = args.map(arg => Helpers.sanitizeData(arg));
    
    switch(level) {
      case 'log': console.log(...sanitizedArgs); break;
      case 'warn': console.warn(...sanitizedArgs); break;
      case 'error': console.error(...sanitizedArgs); break;
      case 'debug': console.debug(...sanitizedArgs); break;
      default: console.log(...sanitizedArgs);
    }
  },


  /**
   * 🆔 generar id
   */
  uid() {

    return crypto.randomUUID();

  },





  /**
   * 📅 formato fecha RD
   */
  formatDate(date) {

    if (!date) return '';

    return new Date(date)

      .toLocaleDateString(

        'es-DO',

        {

          day: '2-digit',

          month: 'short',

          year: 'numeric'

        }

      );

  },





  /**
   * 💰 formato moneda
   */
  formatCurrency(val = 0) {
    const num = Number(val || 0);
    return num.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },


  /**
   * 📉 exportar csv excel
   */
  exportToCSV(data, filename = `export_${new Date().getFullYear()}.csv`) {
    if (!data || !data.length) {
      Helpers.toast('No hay datos', 'warning');
      return;
    }

    const headers =
      Object.keys(data[0]);

    const csv = [

      headers.join(','),

      ...data.map(row =>

        headers

          .map(key => {

            let val =
              row[key] ?? '';

            val =
              String(val)
                .replace(/"/g, '""');

            if (
              val.match(
                /("|,|\n)/
              )
            ) {

              val =
                `"${val}"`;

            }

            return val;

          })

          .join(',')

      )

    ].join('\r\n');


    const blob =
      new Blob(

        [

          "\ufeff" + csv

        ],

        {

          type:
            'text/csv;charset=utf-8;'

        }

      );


    const link =
      document.createElement('a');

    link.href =
      URL.createObjectURL(blob);

    link.download =
      filename;

    link.click();

  },


  /**
   * 💰 Cálculo de Mora (Regla Nueva 2026)
   * • Días 1 al 6 de atraso: RD$50 por día 
   * • Día 7 (primer bloque): Se convierte en RD$500 acumulados 
   * • Después del día 7: +RD$50 por día adicional 
   * • Cada 7 días (nuevo bloque): +RD$500 adicionales 
   * • Fórmula: (bloques de 7 días × RD$500) + (días restantes × RD$50)
   */
  calculateMora(dueDate, baseAmount = 0) {
    if (!dueDate) return 0;

    const dueDateStr = String(dueDate);
    const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDateStr)
      ? dueDateStr + 'T00:00:00'
      : dueDateStr;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const limit = new Date(normalizedDate);
    limit.setHours(0, 0, 0, 0);

    const diff = today.getTime() - limit.getTime();
    const daysLate = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (daysLate <= 0) return 0;

    // Calcular bloques completos de 7 días y días restantes
    const bloques = Math.floor(daysLate / 7);
    const diasRestantes = daysLate % 7;
    
    // Aplicar fórmula: (bloques × 500) + (días restantes × 50)
    const totalMora = (bloques * 500) + (diasRestantes * 50);

    return Math.round(totalMora * 100) / 100;
  },

  /**
   * 💰 Desglose de Mora para UI
   */
  getMoraBreakdown(dueDate, baseAmount = 0) {
    const total = Helpers.calculateMora(dueDate, baseAmount);
    if (total === 0) return null;

    const dueDateStr = String(dueDate);
    const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDateStr)
      ? dueDateStr + 'T00:00:00'
      : dueDateStr;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const limit = new Date(normalizedDate); limit.setHours(0, 0, 0, 0);
    const daysLate = Math.floor((today.getTime() - limit.getTime()) / (1000 * 60 * 60 * 24));

    // Calcular bloques completos de 7 días y días restantes
    const bloques = Math.floor(daysLate / 7);
    const diasRestantes = daysLate % 7;

    let text = '';
    if (bloques > 0 && diasRestantes > 0) {
      text = `${bloques} bloque${bloques > 1 ? 's' : ''} de 7d + ${diasRestantes} d`;
    } else if (bloques > 0) {
      text = `${bloques} bloque${bloques > 1 ? 's' : ''} de 7d`;
    } else {
      text = daysLate === 1 ? '1 día' : `${daysLate} días`;
    }

    return {
      total,
      daysLate,
      bloques,
      diasRestantes,
      formattedText: text.trim()
    };
  }

};

// Exponer globalmente para que el listener karpus:db-error pueda usar toast
if (typeof window !== 'undefined') window.Helpers = Helpers;