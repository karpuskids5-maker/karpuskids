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
   * 🖨️ Plantilla Corporativa para Impresión de QR
   */
  getQRPrintTemplate(qrImg, name, matricula, extra = {}) {
    const classroom = extra.classroom || '';
    const level = extra.level || '';
    const parentName = extra.parentName || 'No registrado';
    const schoolPhone = extra.schoolPhone || '';
    const year = extra.year || new Date().getFullYear();
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
            display: flex; align-items: center; justify-content: center;
            min-height: 100vh; margin: 0; background: #f1f5f9;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          .carnet {
            width: 85.6mm; height: 54mm; background: #fff;
            border: 2px solid #1e40af; border-radius: 4mm;
            display: flex; flex-direction: column; overflow: hidden;
            box-shadow: 0 8px 32px rgba(30,64,175,0.12);
            position: relative;
          }
          .carnet-body { display: flex; flex: 1; }
          .carnet-left {
            width: 42%; display: flex; flex-direction: column;
            align-items: center; justify-content: center; padding: 3mm;
            background: linear-gradient(135deg, #eff6ff, #f8fafc);
            border-right: 1px solid #e2e8f0;
          }
          .carnet-left img { width: 28mm; height: 28mm; border-radius: 2mm; }
          .carnet-left .qr-hint {
            font-size: 5pt; font-weight: 700; color: #1e40af;
            text-align: center; margin-top: 1.5mm; line-height: 1.3;
          }
          .carnet-left .short-code {
            font-size: 4.5pt; color: #94a3b8; font-weight: 700; margin-top: 0.5mm;
          }
          .carnet-right { width: 58%; padding: 3mm 4mm; display: flex; flex-direction: column; justify-content: center; }
          .school-name {
            font-size: 7pt; font-weight: 900; color: #1e40af;
            text-transform: uppercase; letter-spacing: 0.5px;
          }
          .school-sub { font-size: 4.5pt; color: #64748b; font-weight: 700; margin-bottom: 1mm; }
          .divider { height: 0.5px; background: #1e40af33; margin-bottom: 1.5mm; }
          .student-name { font-size: 9pt; font-weight: 900; color: #0f172a; line-height: 1.2; margin-bottom: 1mm; }
          .info-row { font-size: 5pt; color: #64748b; font-weight: 700; margin-bottom: 0.5mm; }
          .info-row span { color: #334155; }
          .carnet-footer {
            background: #1e40af; padding: 1mm 3mm;
            text-align: center; color: #fff; font-size: 4.5pt;
            font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;
          }
          .watermark {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-15deg);
            font-size: 28pt; font-weight: 900; color: rgba(30,64,175,0.03);
            white-space: nowrap; pointer-events: none; z-index: 0;
          }
          .security-text {
            position: absolute; bottom: 5mm; left: 3mm; right: 3mm;
            font-size: 3pt; color: #f1f5f9; text-align: center;
            letter-spacing: 1px; font-weight: 700; z-index: 0;
          }
          @media print {
            body { background: white; margin: 0; padding: 10mm; }
            .carnet { box-shadow: none; margin: 0 auto; }
          }
        </style>
      </head>
      <body>
        <div class="carnet">
          <div class="watermark">KARPUS KIDS</div>
          <div class="security-text">KARPUS KIDS • KARPUS KIDS • KARPUS KIDS • KARPUS KIDS • KARPUS KIDS</div>
          <div class="carnet-body">
            <div class="carnet-left">
              <img src="${qrImg}" alt="QR Code">
              <p class="qr-hint">Muestre este código<br>al ingresar</p>
              <p class="short-code">${(matricula || '').slice(-6)}</p>
            </div>
            <div class="carnet-right">
              <p class="school-name">Karpus Kids</p>
              <p class="school-sub">Centro de Desarrollo Infantil</p>
              <div class="divider"></div>
              <p class="student-name">${name || 'Estudiante'}</p>
              ${classroom ? `<p class="info-row">🏫 <span>${classroom}</span></p>` : ''}
              ${level ? `<p class="info-row">📚 <span>${level}</span></p>` : ''}
              <p class="info-row">🆔 <span>${matricula || 'S/M'}</span></p>
              <p class="info-row">👨 <span>${parentName}</span></p>
              <p class="info-row">📅 <span>${year}</span></p>
            </div>
          </div>
          <div class="carnet-footer">Karpus Kids — Sistema Inteligente de Gestión Infantil</div>
        </div>
        <script>
          window.onload = () => { setTimeout(() => { window.print(); }, 400); }
        </script>
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