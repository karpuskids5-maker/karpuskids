import { supabase } from '../shared/supabase.js';
import { AppState } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';

/**
 * ❤️ MÓDULO REFERIDOS KARPUS — "Comparte y ahorra"
 * Campaña de matrícula: 1 familia matriculada = 50% de descuento,
 * 2 familias = mensualidad gratis. Sin puntos, sin niveles, sin embajadores.
 */
const CAMPAIGN = {
  startMonth: 7,   // Agosto (0-indexed)
  startDay: 29,
  endMonth: 8,     // Septiembre (0-indexed)
  endDay: 15,
};

const STATUS_MAP = {
  invited:    { label: 'Invitada',                icon: '👋', color: 'bg-slate-100 text-slate-600' },
  registered: { label: 'Familia interesada',      icon: '🟡', color: 'bg-amber-100 text-amber-700' },
  visited:    { label: 'En proceso de matrícula', icon: '🔵', color: 'bg-sky-100 text-sky-700' },
  enrolled:   { label: 'Matrícula confirmada',    icon: '🟢', color: 'bg-emerald-100 text-emerald-700' },
  rejected:   { label: 'No se matriculó',         icon: '🚫', color: 'bg-rose-100 text-rose-700' },
};

export const ReferidosModule = {
  _container: null,
  _dashboard: null,

  /**
   * Inicializa y dibuja la sección de referidos dentro del perfil.
   * @param {HTMLElement} container Contenedor destino (#referidosContainer)
   */
  async init(container) {
    this._container = container || document.getElementById('referidosContainer');
    if (!this._container) return;

    const profile = AppState.get('profile');
    if (!profile) return;

    this._container.innerHTML = this._skeleton();
    await this._load();
  },

  /** Carga el tablero desde la función RPC y renderiza */
  async _load() {
    try {
      const { data, error } = await supabase.rpc('get_embajador_dashboard');
      if (error) throw error;

      this._dashboard = data || {};
      // Asegurar código de referido (crea uno si no existe)
      if (!this._dashboard.code_value) {
        try {
          const { data: ensure } = await supabase.rpc('ensure_referral_code', {
            p_parent_id: AppState.get('profile')?.id
          });
          if (ensure?.code) this._dashboard.code_value = ensure.code;
        } catch (e) {
          console.warn('[referidos] ensure_referral_code:', e);
        }
      }

      this._render();
      this._renderQR();
    } catch (err) {
      this._container.innerHTML = Helpers.emptyState(
        'No pudimos cargar tu programa de referidos',
        '❤️',
        { label: 'Reintentar', action: () => this._load() }
      );
      console.error('[referidos] Load error:', err);
    }
  },

  /** Info de la campaña temporal "Comparte y ahorra" */
  _campaignInfo() {
    const now = new Date();
    const start = new Date(now.getFullYear(), CAMPAIGN.startMonth, CAMPAIGN.startDay, 0, 0, 0);
    const end = new Date(now.getFullYear(), CAMPAIGN.endMonth, CAMPAIGN.endDay, 23, 59, 59);
    const active = now >= start && now <= end;
    const daysLeft = active ? Math.max(0, Math.ceil((end - now) / 86400000)) : 0;
    return { active, daysLeft, startLabel: '29 AGO', endLabel: '15 SEP' };
  },

  _enrolled() {
    return Number(this._dashboard?.enrolled_count || 0);
  },

  _halfFee() {
    return Number(AppState.get('financeConfig')?.monthly_fee || 0) / 2;
  },

  /** Ahorro acumulado (máximo = una mensualidad gratis) */
  _savings() {
    return Math.min(this._enrolled(), 2) * this._halfFee();
  },

  /** Tarjeta principal: mensaje emocional + código + acciones de compartir */
  _renderHero() {
    const code = this._dashboard?.code_value || '';
    const link = this._link(code);
    const accepted = this._enrolled();

    return `
      <div class="bg-gradient-to-br from-emerald-500 via-teal-500 to-sky-500 rounded-[2rem] p-6 md:p-8 text-white relative overflow-hidden">
        <div class="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full pointer-events-none"></div>
        <div class="absolute -bottom-10 -left-4 w-32 h-32 bg-white/10 rounded-full pointer-events-none"></div>

        <div class="flex items-center gap-2 mb-3 flex-wrap">
          <span class="px-3 py-1 bg-white/20 rounded-full text-[10px] font-black uppercase tracking-widest">❤️ Comparte y ahorra</span>
          <span class="px-3 py-1 bg-amber-400/90 text-amber-900 rounded-full text-[10px] font-black uppercase tracking-widest">${accepted} familia${accepted === 1 ? '' : 's'} confirmada${accepted === 1 ? '' : 's'}</span>
        </div>

        <h3 class="text-2xl md:text-3xl font-black leading-tight">Comparte Karpus Kids<br>y ahorra en tu próxima mensualidad</h3>
        <p class="text-emerald-50 text-sm font-medium mt-3 max-w-md">
          ¿Conoces una familia que podría formar parte de nuestra comunidad? Compártele Karpus Kids.
          Si se matricula usando tu enlace, agradecemos tu recomendación con un descuento.
        </p>

        <div class="mt-5 inline-flex items-center gap-3 bg-white/15 backdrop-blur-md rounded-2xl px-5 py-3 border border-white/20">
          <span class="text-3xl animate-breathe">🎁</span>
          <div>
            <p class="text-[10px] font-black uppercase tracking-widest text-white/70">Por cada familia que se matricule</p>
            <p class="text-2xl font-black leading-none">50% DE DESCUENTO</p>
          </div>
        </div>

        <div class="flex flex-col md:flex-row gap-5 mt-6 items-center">
          <div class="bg-white rounded-3xl p-4 flex flex-col items-center shrink-0">
            <div id="referidos-qr" class="bg-white rounded-2xl w-40 h-40 flex items-center justify-center text-slate-300 overflow-hidden">
              <i data-lucide="loader" class="w-8 h-8 animate-spin"></i>
            </div>
            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-3">Tu enlace personal</p>
          </div>

          <div class="flex-1 w-full">
            <label class="text-[10px] font-black uppercase tracking-widest text-white/70 mb-1 block">Enlace de invitación</label>
            <div class="flex gap-2">
              <input id="referidos-link" readonly value="${escapeHtml(link)}"
                class="flex-1 w-full px-4 py-3 bg-white/20 border border-white/30 rounded-2xl text-sm font-bold placeholder-white/50 outline-none focus:ring-2 focus:ring-white/60 select-all" />
              <button type="button" data-ref="copy"
                class="px-4 py-3 bg-white text-emerald-700 rounded-2xl font-black text-xs shadow-md hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 shrink-0">
                <i data-lucide="copy" class="w-4 h-4"></i> Copiar
              </button>
            </div>

            <div class="grid grid-cols-2 gap-3 mt-4">
              <button type="button" data-ref="whatsapp"
                class="col-span-2 px-4 py-3.5 bg-[#25D366] text-white rounded-2xl font-black text-sm shadow-lg hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2">
                <i data-lucide="message-circle" class="w-5 h-5"></i> Compartir por WhatsApp
              </button>
              <button type="button" data-ref="share"
                class="col-span-2 md:col-span-1 px-4 py-3 bg-white/15 border border-white/30 text-white rounded-2xl font-black text-xs uppercase tracking-wider hover:bg-white/25 active:scale-95 transition-all flex items-center justify-center gap-2">
                <i data-lucide="share-2" class="w-4 h-4"></i> Compartir QR
              </button>
              <button type="button" data-ref="preview"
                class="col-span-2 md:col-span-1 px-4 py-3 bg-white/15 border border-white/30 text-white rounded-2xl font-black text-xs uppercase tracking-wider hover:bg-white/25 active:scale-95 transition-all flex items-center justify-center gap-2">
                <i data-lucide="eye" class="w-4 h-4"></i> Ver tarjeta
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  /** Campaña temporal + estado del beneficio */
  _renderCampaign() {
    const camp = this._campaignInfo();
    const accepted = this._enrolled();

    return `
      <div class="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6 md:p-8">
        <div class="flex flex-col md:flex-row md:items-center gap-5">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-2">
              <span class="w-2 h-2 bg-rose-500 rounded-full animate-pulse"></span>
              <h4 class="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Campaña especial de matrícula · ${camp.startLabel} — ${camp.endLabel}</h4>
            </div>
            <p class="text-sm font-bold text-slate-600 leading-relaxed">
              Durante este período, cada familia que se matricule mediante tu enlace te da derecho a
              <span class="text-emerald-600">50% de descuento en tu mensualidad</span>. ¡Sin puntos, sin niveles, sin complicaciones!
            </p>
            <div class="flex flex-wrap gap-2 mt-3">
              <span class="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-black uppercase">1 familia = 50% de descuento</span>
              <span class="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-black uppercase">2 familias = mensualidad gratis 🎉</span>
              <span class="px-3 py-1 bg-slate-100 text-slate-500 rounded-full text-[10px] font-black uppercase">3+ familias = crédito</span>
            </div>
          </div>
          <div class="shrink-0 md:w-56 bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-3xl p-5 text-center">
            ${camp.active ? `
              <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">⏰ Termina en</p>
              <p class="text-3xl font-black text-emerald-600 mt-1">${camp.daysLeft} día${camp.daysLeft === 1 ? '' : 's'}</p>
              <p class="text-[11px] font-bold text-slate-500 mt-1">Aprovecha la promoción</p>
            ` : `
              <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Próxima campaña</p>
              <p class="text-2xl font-black text-emerald-600 mt-1">${camp.startLabel} — ${camp.endLabel}</p>
            `}
          </div>
        </div>
      </div>
    `;
  },

  /** Ahorro acumulado + progreso hacia la mensualidad gratis */
  _renderSavings() {
    const accepted = this._enrolled();
    const savings = this._savings();
    const pct = Math.min(100, (accepted / 2) * 100);

    return `
      <div class="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6 md:p-8">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h4 class="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
              <span class="w-6 h-px bg-slate-200"></span> 💰 Tu ahorro
            </h4>
            <div class="flex items-end gap-3">
              <p class="text-4xl md:text-5xl font-black text-emerald-600 leading-none">RD$${Helpers.formatCurrency(savings)}</p>
            </div>
            <p class="text-sm font-bold text-slate-500 mt-3">${accepted === 0
              ? 'Todavía no tienes referidos confirmados.'
              : accepted === 1
                ? '¡Vas por la mitad! Una familia más y tu mensualidad es gratis. ❤️'
                : '¡Lo lograste! Tu próxima mensualidad está cubierta. 🎉'}</p>
          </div>

          <div>
            <h4 class="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
              <span class="w-6 h-px bg-slate-200"></span> Tu beneficio actual
            </h4>
            <div class="flex items-center justify-between mb-2">
              <p class="text-2xl font-black text-slate-800">${accepted} de 2 familias</p>
              <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase
                ${accepted === 0 ? 'bg-slate-100 text-slate-500' : accepted === 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-emerald-100 text-emerald-800'}">
                ${accepted === 0 ? 'Sin descuento' : accepted === 1 ? '50% de descuento' : 'Mensualidad gratis 🎉'}
              </span>
            </div>
            <div class="h-3 bg-slate-100 rounded-full overflow-hidden">
              <div class="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-700" style="width:${pct}%"></div>
            </div>
            <p class="text-xs font-bold text-slate-500 mt-2">
              ${accepted === 0
                ? 'Comparte tu enlace y gana 50% de descuento con la primera familia que se matricule.'
                : accepted === 1
                  ? 'Consigue 1 familia más y tu próxima mensualidad es GRATIS.'
                  : 'El excedente de referidos se convierte en crédito a tu favor.'}
            </p>
          </div>
        </div>
      </div>
    `;
  },

  /** Línea de tiempo de recomendaciones */
  _renderReferrals() {
    const referrals = this._dashboard?.referrals || [];

    return `
      <div>
        <h4 class="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
          <span class="w-6 h-px bg-slate-200"></span> Tus recomendaciones
        </h4>
        ${referrals.length === 0 ? Helpers.emptyState('Todavía no tienes recomendaciones', '📣', {
          label: 'Compartir por WhatsApp',
          action: () => this._shareWhatsApp()
        }) : `
          <div class="space-y-3">
            ${referrals.map((r) => {
              const st = STATUS_MAP[r.status] || STATUS_MAP.invited;
              return `
                <div class="flex items-center justify-between bg-white rounded-2xl px-4 py-3 border border-slate-100">
                  <div class="flex items-center gap-3 min-w-0">
                    <span class="text-2xl">${st.icon}</span>
                    <div class="min-w-0">
                      <p class="text-sm font-black text-slate-700 truncate">${escapeHtml(r.family)}</p>
                      <p class="text-[10px] text-slate-400 font-semibold">${Helpers.formatDate(r.created_at)}</p>
                    </div>
                  </div>
                  <div class="shrink-0 text-right">
                    <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase ${st.color}">${st.label}</span>
                    ${r.status === 'enrolled'
                      ? '<p class="text-[9px] font-black text-emerald-600 uppercase mt-1">✓ Te genera 50% de descuento</p>'
                      : r.status === 'rejected'
                        ? '<p class="text-[9px] font-black text-slate-400 uppercase mt-1">No genera descuento</p>'
                        : '<p class="text-[9px] font-black text-amber-500 uppercase mt-1">Aún no genera descuento</p>'}
                  </div>
                </div>`;
            }).join('')}
          </div>
        `}
      </div>
    `;
  },

  _render() {
    if (!this._container) return;
    this._container.innerHTML = `
      <div class="space-y-6">
        ${this._renderHero()}
        ${this._renderCampaign()}
        ${this._renderSavings()}
        ${this._renderReferrals()}
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    this._bind();
    this._celebrateIfNewReward();
  },

  /** 🎉 Celebra con confeti cuando el padre gana un descuento nuevo sin usar */
  _celebrateIfNewReward() {
    const rewards = this._dashboard?.rewards || [];
    const uncelebrated = rewards.find(r => !r.is_used && (r.reward_type === 'monthly_discount' || r.reward_type === 'free_month'));
    if (!uncelebrated) return;

    const key = 'karpus_referido_celebrated_' + (AppState.get('currentStudent')?.id || '') + '_' + uncelebrated.id;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

    setTimeout(() => {
      if (window.confetti) {
        window.confetti({ particleCount: 160, spread: 80, origin: { y: 0.6 } });
        window.confetti({ particleCount: 90, angle: 60, spread: 60, origin: { x: 0, y: 0.7 } });
        window.confetti({ particleCount: 90, angle: 120, spread: 60, origin: { x: 1, y: 0.7 } });
      }
      Helpers.vibrate('success');
      const msg = this._enrolled() >= 2
        ? '¡Ganaste tu mensualidad gratis! 🎉'
        : '¡Ganaste 50% de descuento en tu mensualidad! 🎉';
      Helpers.toast(msg, 'success');
    }, 350);
  },

  _link(code) {
    return code ? `https://karpuskids.com/preinscripcion.html?ref=${encodeURIComponent(code)}` : '';
  },

  _shareMessage(link) {
    return `❤️ Quería compartirte Karpus Kids.\n\nMi hijo/a forma parte de esta comunidad y pensé que quizás también podría interesarte para tu familia.\n\nAhora tienen una promoción especial para nuevas familias 👇\n\n${link}\n\nSi decides matricular a tu hijo/a, puedes conocer todos los detalles desde aquí.\n\n¡Quizás nos vemos en Karpus Kids! 🥰`;
  },

  _shareWhatsApp() {
    const code = this._dashboard?.code_value || '';
    const link = this._link(code);
    if (!link) { Helpers.toast('Aún no tienes tu enlace. Inténtalo de nuevo.', 'warning'); return; }
    const msg = this._shareMessage(link);
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  },

  _renderQR() {
    const code = this._dashboard?.code_value || '';
    const qrEl = document.getElementById('referidos-qr');
    if (!qrEl || !code) return;
    const text = this._link(code);

    qrEl.innerHTML = '';
    const generate = () => {
      if (!window.QRCode) return;
      new QRCode(qrEl, {
        text,
        width: 150,
        height: 150,
        colorDark: '#065f46',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    };
    if (window.QRCode) {
      generate();
    } else {
      const s = document.createElement('script');
      s.src = 'js/shared/qrcode.min.js';
      s.onload = generate;
      document.head.appendChild(s);
    }
  },

  _bind() {
    const container = this._container;
    if (!container) return;
    const code = this._dashboard?.code_value || '';
    const link = this._link(code);

    container.querySelector('[data-ref="copy"]')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        Helpers.toast('Enlace copiado ✅', 'success');
        Helpers.vibrate('light');
      } catch {
        const input = document.getElementById('referidos-link');
        if (input) { input.focus(); input.select(); }
        Helpers.toast('Selecciona y copia el enlace', 'info');
      }
    });

    container.querySelector('[data-ref="whatsapp"]')?.addEventListener('click', () => this._shareWhatsApp());

    container.querySelector('[data-ref="share"]')?.addEventListener('click', () => {
      const qrEl = document.getElementById('referidos-qr');
      const canvas = qrEl?.querySelector('canvas');
      if (canvas) {
        canvas.toBlob((blob) => {
          const file = new File([blob], `karpus-referido-${code}.png`, { type: 'image/png' });
          if (navigator.share && navigator.canShare({ files: [file] })) {
            navigator.share({ title: 'Comparte Karpus Kids y ahorra 50%', files: [file], text: link });
          } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = file.name; a.click();
            URL.revokeObjectURL(url);
          }
        });
      } else {
        Helpers.toast('QR aún no disponible', 'info');
      }
    });

    container.querySelector('[data-ref="preview"]')?.addEventListener('click', () => {
      const profile = AppState.get('profile');
      const html = this._cardTemplate(code, profile?.name || 'Familia', link);
      if (window.openGlobalModal) {
        window.openGlobalModal(html);
        requestAnimationFrame(() => {
          const cardQr = document.getElementById('card-qr');
          if (cardQr && window.QRCode && code) {
            cardQr.innerHTML = '';
            new QRCode(cardQr, {
              text: link,
              width: 160,
              height: 160,
              colorDark: '#065f46',
              colorLight: '#ffffff',
              correctLevel: QRCode.CorrectLevel.H
            });
          } else if (cardQr && !window.QRCode) {
            const s = document.createElement('script');
            s.src = 'js/shared/qrcode.min.js';
            s.onload = () => {
              cardQr.innerHTML = '';
              new QRCode(cardQr, { text: link, width: 160, height: 160, colorDark: '#065f46', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
            };
            document.head.appendChild(s);
          }
        });
      }
    });
  },

  /** Tarjeta gráfica para presumir el enlace (Instagram / WhatsApp) */
  _cardTemplate(code, familyName, link) {
    return `
      <div class="bg-white rounded-[2rem] p-6 shadow-2xl">
        <div style="background:linear-gradient(135deg,#10B981,#0EA5E9,#FACC15)" class="rounded-3xl p-6 text-center text-white">
          <p class="text-[10px] font-black uppercase tracking-[0.3em] opacity-90">Karpus Kids</p>
          <h3 class="text-2xl font-black mt-1 mb-1">¡Únete a nuestra familia!</h3>
          <p class="text-xs font-bold opacity-90 mb-4">Las familias nuevas reciben 10% de descuento en su inscripción</p>
          <div class="bg-white rounded-2xl p-4 inline-block mx-auto">
            <div id="card-qr"></div>
          </div>
          <p class="text-sm font-black mt-4">${escapeHtml(code)}</p>
          <p class="text-xs font-medium opacity-90 mt-1">Comparte este enlace y conoce Karpus Kids</p>
          <p class="mt-4 inline-block px-4 py-2 bg-white/20 rounded-full text-[10px] font-black uppercase">Familia ${escapeHtml(familyName)}</p>
        </div>
        <div class="text-center mt-4 flex gap-3 justify-center">
          <button onclick="(function(){const c=document.getElementById('card-qr')?.querySelector('canvas');if(c){c.toBlob(b=>{const f=new File([b],'karpus-card.png',{type:'image/png'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=f.name;a.click();URL.revokeObjectURL(u);});}})()"
            class="px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-xs">Descargar tarjeta</button>
          <button onclick="window.closeGlobalModal && closeGlobalModal()"
            class="px-5 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-xs">Cerrar</button>
        </div>
      </div>
    `;
  },

  _skeleton() {
    return `
      <div class="space-y-4">
        ${Helpers.skeleton(1, 'h-56')}
        ${Helpers.skeleton(2, 'h-24')}
      </div>
    `;
  }
};