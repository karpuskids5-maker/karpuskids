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
   * 🦴 Skeleton lista
   */
  skeleton(
    count = 3,
    height = 'h-20'
  ) {

    return Array
      .from({ length: count })

      .map(() => `

        <div class="

          w-full
          ${height}

          bg-slate-100
          rounded-3xl

          animate-pulse

          mb-3

          flex
          items-center
          gap-4

          px-5

        ">

          <div class="

            w-12
            h-12

            bg-slate-200

            rounded-2xl

          "></div>

          <div class="flex-1 space-y-2">

            <div class="

              w-1/2
              h-3
              bg-slate-200
              rounded-full

            "></div>

            <div class="

              w-1/4
              h-2
              bg-slate-200
              rounded-full

            "></div>

          </div>

        </div>

      `)

      .join('');

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

      ">

        ${letter}

      </div>

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
   * 💰 formato moneda RD$
   */
  formatCurrency(amount = 0) {

    return new Intl

      .NumberFormat(

        'es-DO',

        {

          style: 'currency',

          currency: 'DOP'

        }

      )

      .format(amount);

  },


  /**
   * 📉 exportar csv excel
   */
  exportToCSV(
    data,
    filename = 'export.csv'
  ) {

    if (
      !data ||
      !data.length
    ) {

      Helpers.toast(
        'No hay datos',
        'warning'
      );

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
   * 💰 Cálculo de Mora (Reglas Exactas)
   * Del día 1 al 6: RD$50 por día
   * Día 7: Se convierte en RD$500
   * Después del día 7: +RD$50 por día
   * Cada 7 días (bloque): +RD$500
   * Fórmula: (bloques_7 * 500) + (dias_restantes * 50)
   */
  calculateMora(dueDate) {

    if (!dueDate) return 0;

    const today = new Date();

    const limit = new Date(dueDate);


    // Diferencia en milisegundos

    const diff = today - limit;


    // Convertir a días (floor para días completos de atraso)

    const daysLate = Math.floor(diff / (1000 * 60 * 60 * 24));


    if (daysLate <= 0) return 0;


    const blocks = Math.floor(daysLate / 7);

    const remainingDays = daysLate % 7;


    const totalMora = (blocks * 500) + (remainingDays * 50);


    return totalMora;

  },


  /**
   * 💰 Desglose de Mora para UI
   */
  getMoraBreakdown(dueDate) {

    const total = Helpers.calculateMora(dueDate);

    if (total === 0) return null;


    const today = new Date();

    const limit = new Date(dueDate);

    const daysLate = Math.floor((today - limit) / (1000 * 60 * 60 * 24));


    const weeks = Math.floor(daysLate / 7);

    const days = daysLate % 7;


    let text = '';

    if (weeks > 0) text += `${weeks} sem `;

    if (days > 0) text += `${days} días`;


    return {
      total,
      daysLate,
      weeks,
      remainingDays: days,
      formattedText: text.trim()
    };

  }

};