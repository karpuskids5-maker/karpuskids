/**
 * 🧰 Helpers PRO - Nivel Empresa
 */

export const Helpers = {

  /**
   * 🛡️ Escapar HTML
   */
  escapeHTML(str = '') {

    return String(str)

      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

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
  vibrate(style = 'light') {
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
      // Silenciar error de navegador por falta de interacción
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
  getQRPrintTemplate(qrImg, name, matricula) {
    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Credencial Digital - ${matricula}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;900&display=swap');
          body { 
            font-family: 'Nunito', sans-serif; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            min-height: 100vh; 
            margin: 0; 
            background: #f8fafc; 
            -webkit-print-color-adjust: exact;
          }
          .card { 
            background: white;
            border: 2px solid #e2e8f0; 
            border-radius: 32px; 
            padding: 40px; 
            text-align: center; 
            width: 320px; 
            box-shadow: 0 20px 50px rgba(0,0,0,0.05);
            position: relative;
            overflow: hidden;
          }
          .card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0; height: 8px;
            background: linear-gradient(90deg, #f97316, #3b82f6, #ec4899, #22c55e);
          }
          .logo { 
            font-size: 24px; 
            font-weight: 900; 
            margin-bottom: 30px;
            letter-spacing: -0.5px;
          }
          .k1{color:#f97316} .k2{color:#3b82f6} .k3{color:#ec4899} .k4{color:#22c55e}
          .qr-wrapper {
            background: #f1f5f9;
            padding: 20px;
            border-radius: 24px;
            display: inline-block;
            margin-bottom: 25px;
            border: 1px solid #e2e8f0;
          }
          img { 
            width: 200px; 
            height: 200px; 
            display: block;
            border-radius: 12px;
          }
          .name { 
            font-size: 20px; 
            font-weight: 900; 
            color: #1e293b; 
            margin-top: 10px;
            line-height: 1.2;
          }
          .mat { 
            font-size: 13px; 
            color: #64748b; 
            font-weight: 700; 
            margin-top: 6px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .footer-brand {
            margin-top: 30px;
            font-size: 10px;
            font-weight: 800;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 2px;
          }
          @media print {
            body { background: white; margin: 0; }
            .card { box-shadow: none; border: 1px solid #eee; margin: auto; }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">
            <span class="k1">K</span><span class="k2">a</span><span class="k3">r</span><span class="k4">p</span>us Kids
          </div>
          <div class="qr-wrapper">
            <img src="${qrImg}" alt="QR Code">
          </div>
          <div class="name">${name || 'Estudiante'}</div>
          <div class="mat">${matricula}</div>
          <div class="footer-brand">Sistema de Acceso Seguro</div>
        </div>
        <script>
          window.onload = () => {
            setTimeout(() => {
              window.print();
              setTimeout(() => window.close(), 500);
            }, 500);
          }
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
   * 🖼️ avatar fallback — con lazy loading
   */
  avatar(url, name = '') {
    if (url) {
      // Usar data-src para lazy loading via ImageLoader
      return `<img
        src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k="
        data-src="${url}"
        data-fallback="img/mundo.jpg"
        class="karpus-img karpus-img-loading w-full h-full object-cover"
        loading="lazy"
        decoding="async">`;
    }
    const letter = name?.charAt(0)?.toUpperCase() || '?';
    return `<div class="w-full h-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-black">${letter}</div>`;
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
      console.error(`[Safe:${context}]`, err);
      
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
        console.warn('Could not log error to DB:', logErr);
      }

      Helpers.toast('Algo no salió bien. El equipo técnico ha sido notificado.', 'error');
      return null;
    }
  },


  /**
   * 🆔 generar id
   */
  uid() {

    return crypto.randomUUID();

  },


  /**
   * ⏱️ sleep async
   */
  sleep(ms = 300) {

    return new Promise(

      resolve =>
        setTimeout(resolve, ms)

    );

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
   * 📅 formato corto
   */
  formatShortDate(date) {

    if (!date) return '';

    return new Date(date)

      .toLocaleDateString(

        'es-DO',

        {

          day: 'numeric',

          month: 'short'

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
   * 💰 Cálculo de Mora (Regla Unificada 5% Mensual)
   * Se aplica un 5% del monto base por cada mes o fracción de mes de retraso.
   */
  calculateMora(dueDate, baseAmount = 0) {
    if (!dueDate || !baseAmount) return 0;

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

    const moraRate = 0.05; // 5% mensual
    const monthsLate = Math.ceil(daysLate / 30);
    const totalMora = Number(baseAmount) * moraRate * monthsLate;

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

    const monthsLate = Math.ceil(daysLate / 30);

    let text = daysLate === 1 ? '1 día' : `${daysLate} días`;
    if (monthsLate > 0) {
      text = `${monthsLate} mes${monthsLate > 1 ? 'es' : ''} (${daysLate} d)`;
    }

    return {
      total,
      daysLate,
      monthsLate,
      formattedText: text.trim()
    };
  }

};

// Exponer globalmente para que el listener karpus:db-error pueda usar toast
if (typeof window !== 'undefined') window.Helpers = Helpers;