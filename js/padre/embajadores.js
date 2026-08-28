import { supabase } from '../shared/supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';

/**
 * 🎖️ MÓDULO EMBAJADORES KARPUS (SISTEMA DE REFERIDOS)
 * Panel de seguimiento, generador de QR, compartir por WhatsApp y monedero digital.
 */
export const EmbajadoresModule = {
  _container: null,
  _dashboard: null,
  _inited: false,

  /**
   * Inicializa y dibuja la sección Embajadores dentro del perfil.
   * @param {HTMLElement} container Contenedor destino (#embajadoresContainer)
   */
  async init(container) {
    this._container = container || document.getElementById('embajadoresContainer');
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
        const { data: codeRow } = await supabase
          .from('referral_codes')
          .select('code')
          .eq('parent_id', AppState.get('profile')?.id)
          .maybeSingle();
        if (!codeRow) {
          try {
            const { data: ensure } = await supabase.rpc('ensure_referral_code', {
              p_parent_id: AppState.get('profile')?.id
            });
            if (ensure?.code) this._dashboard.code_value = ensure.code;
          } catch (e) {
            console.warn('[embajadores] ensure_referral_code:', e);
          }
        } else {
          this._dashboard.code_value = codeRow.code;
        }
      }

      this._render();
      this._renderQR();
    } catch (err) {
      this._container.innerHTML = Helpers.emptyState(
        'No pudimos cargar tu programa Embajadores',
        '🎯',
        { label: 'Reintentar', action: () => this._load() }
      );
      console.error('[embajadores] Load error:', err);
    }
  },

  /** Tarjeta del código + QR + acciones de compartir */
  _renderHero() {
    const code = this._dashboard?.code_value || '';
    const enrolled = this._dashboard?.enrolled_count || 0;
    const link = code ? `https://karpuskids.com/preinscripcion.html?ref=${encodeURIComponent(code)}` : '#';

    return `
      <div class="bg-gradient-to-br from-emerald-500 via-teal-500 to-sky-500 rounded-[2rem] p-6 md:p-8 text-white relative overflow-hidden">
        <div class="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full pointer-events-none"></div>
        <div class="absolute -bottom-10 -left-4 w-32 h-32 bg-white/10 rounded-full pointer-events-none"></div>

        <div class="flex items-center gap-2 mb-3">
          <span class="px-3 py-1 bg-white/20 rounded-full text-[10px] font-black uppercase tracking-widest">🎖️ Embajador</span>
          <span class="px-3 py-1 bg-amber-400/90 text-amber-900 rounded-full text-[10px] font-black uppercase tracking-widest">${enrolled} referidos</span>
        </div>

        <h3 class="text-2xl font-black mb-1">Invita y gana premios 🎉</h3>
        <p class="text-emerald-50 text-sm font-medium mb-5 max-w-md">
          Recomienda Karpus Kids. Por cada familia que se matrícule con tu código, ganas descuentos y hasta un mes gratis.
        </p>

        <div class="flex flex-col md:flex-row gap-5 items-center">
          <div class="bg-white rounded-3xl p-4 flex flex-col items-center shrink-0">
            <div id="embajador-qr" class="bg-white rounded-2xl w-40 h-40 flex items-center justify-center text-slate-300 overflow-hidden">
              <i data-lucide="loader" class="w-8 h-8 animate-spin"></i>
            </div>
            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-3">Tu código único</p>
          </div>

          <div class="flex-1 w-full">
            <label class="text-[10px] font-black uppercase tracking-widest text-white/70 mb-1 block">Enlace de invitación</label>
            <div class="flex gap-2">
              <input id="embajador-link" readonly value="${escapeHtml(link)}"
                class="flex-1 w-full px-4 py-3 bg-white/20 border border-white/30 rounded-2xl text-sm font-bold placeholder-white/50 outline-none focus:ring-2 focus:ring-white/60 select-all" />
              <button type="button" data-emb="copy"
                class="px-4 py-3 bg-white text-emerald-700 rounded-2xl font-black text-xs shadow-md hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 shrink-0">
                <i data-lucide="copy" class="w-4 h-4"></i> Copiar
              </button>
            </div>

            <div class="grid grid-cols-2 gap-3 mt-4">
              <button type="button" data-emb="whatsapp"
                class="col-span-2 px-4 py-3 bg-[#25D366] text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2">
                <i data-lucide="message-circle" class="w-5 h-5"></i> Invitar por WhatsApp
              </button>
              <button type="button" data-emb="share"
                class="col-span-2 md:col-span-1 px-4 py-3 bg-white/15 border border-white/30 text-white rounded-2xl font-black text-xs uppercase tracking-wider hover:bg-white/25 active:scale-95 transition-all flex items-center justify-center gap-2">
                <i data-lucide="share-2" class="w-4 h-4"></i> Compartir QR
              </button>
              <button type="button" data-emb="preview"
                class="col-span-2 md:col-span-1 px-4 py-3 bg-white/15 border border-white/30 text-white rounded-2xl font-black text-xs uppercase tracking-wider hover:bg-white/25 active:scale-95 transition-all flex items-center justify-center gap-2">
                <i data-lucide="eye" class="w-4 h-4"></i> Ver tarjeta
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  /** Escala de recompensas (programa) */
  _renderTiers() {
    const enrolled = this._dashboard?.enrolled_count || 0;
    const tiers = [
      { level: 'Bronce', icon: '🥉', min: 1, reward: '15% dcto. mensualidad', new: '10% dcto. inscripción', color: 'from-orange-400 to-amber-500' },
      { level: 'Plata', icon: '🥈', min: 2, reward: '35% dcto. mensualidad', new: '15% dcto. inscripción', color: 'from-slate-300 to-slate-400' },
      { level: 'Oro', icon: '🥇', min: 3, reward: '1 MES GRATIS 🎉', new: '20% dcto. inscripción', color: 'from-amber-400 to-yellow-500' },
      { level: 'Leyenda', icon: '👑', min: 4, reward: '$100 USD crédito', new: '20% dcto. inscripción', color: 'from-violet-500 to-fuchsia-500' }
    ];
    return `
      <div>
        <h4 class="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
          <span class="w-6 h-px bg-slate-200"></span> Niveles de Embajador
        </h4>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          ${tiers.map((t) => {
            const reached = enrolled >= t.min;
            const isNext = !reached && (enrolled + 1 === t.min || t.min === 1);
            return `
              <div class="p-4 rounded-3xl border bg-gradient-to-br ${t.color} ${reached ? 'text-white shadow-lg' : 'border-slate-100 bg-slate-50 text-slate-500 opacity-80'}">
                <div class="text-3xl mb-2">${t.icon}</div>
                <p class="font-black ${reached ? 'text-white' : 'text-slate-700'}">${t.level}${reached ? ' ✓' : ''}</p>
                <p class="text-[11px] font-bold mt-1 ${reached ? 'text-white/80' : 'text-slate-400'}">${t.reward}</p>
                <p class="text-[10px] font-semibold mt-1 ${reached ? 'text-white/70' : 'text-slate-400'}">• ${t.new}</p>
                ${isNext ? '<p class="mt-2 inline-block px-2 py-0.5 bg-white/90 text-emerald-700 rounded-full text-[9px] font-black uppercase">Siguiente →</p>' : ''}
              </div>`;
          }).join('')}
        </div>
      </div>
    `;
  },

  /** Monedero digital de recompensas */
  _renderWallet() {
    const rewards = this._dashboard?.rewards || [];
    const balance = Number(this._dashboard?.balance || 0);

    return `
      <div>
        <h4 class="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
          <span class="w-6 h-px bg-slate-200"></span> Monedero Karpus
        </h4>
        <div class="bg-slate-50 rounded-3xl border border-slate-100 p-5">
          <div class="flex items-center justify-between mb-4">
            <div>
              <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Saldo disponible</p>
              <p class="text-3xl font-black text-emerald-600 mt-1">${Helpers.formatCurrency(balance)}</p>
            </div>
            <div class="w-12 h-12 bg-emerald-500/10 text-emerald-600 rounded-2xl flex items-center justify-center">
              <i data-lucide="wallet" class="w-6 h-6"></i>
            </div>
          </div>
          ${rewards.length === 0 ? `
            <p class="text-sm font-medium text-slate-500">Aún no tienes créditos. Comparte tu enlace y empieza a ganar. 💛</p>
          ` : `
            <div class="space-y-2 max-h-56 overflow-y-auto no-scrollbar pr-1">
              ${rewards.map((r) => `
                <div class="flex items-center justify-between bg-white rounded-2xl px-4 py-3 border border-slate-100 ${r.is_used ? 'opacity-50' : ''}">
                  <div class="flex items-center gap-3">
                    <span class="text-xl">${r.reward_type === 'free_month' ? '🎉' : r.reward_type === 'cashback' ? '👑' : '💳'}</span>
                    <div>
                      <p class="text-sm font-black text-slate-700">${escapeHtml(r.description || 'Recompensa')}</p>
                      <p class="text-[10px] text-slate-400 font-semibold">${Helpers.formatDate(r.created_at)}</p>
                    </div>
                  </div>
                  <span class="text-sm font-black ${r.is_used ? 'text-slate-400 line-through' : 'text-emerald-600'}">
                    ${r.reward_type === 'cashback' ? '$' : ''}${Helpers.formatCurrency(r.amount)}${r.reward_type === 'free_month' ? ' (mes gratis)' : ''}
                  </span>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  },

  /** Línea de tiempo de referidos */
  _renderReferrals() {
    const referrals = this._dashboard?.referrals || [];
    const statusMap = {
      invited:    { label: 'Invitado',     icon: '💬', color: 'bg-amber-100 text-amber-700' },
      registered: { label: 'Preinscrito',  icon: '📝', color: 'bg-sky-100 text-sky-700' },
      visited:    { label: 'Visita',       icon: '🏫', color: 'bg-violet-100 text-violet-700' },
      enrolled:   { label: 'Matriculado',  icon: '✅', color: 'bg-emerald-100 text-emerald-700' },
      rejected:   { label: 'Rechazado',    icon: '🚫', color: 'bg-rose-100 text-rose-700' }
    };

    return `
      <div>
        <h4 class="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
          <span class="w-6 h-px bg-slate-200"></span> Mis Referidos
        </h4>
        ${referrals.length === 0 ? Helpers.emptyState('Aún no has invitado a nadie. ¡Comparte tu enlace!', '📣') : `
          <div class="space-y-3">
            ${referrals.map((r) => {
              const st = statusMap[r.status] || statusMap.invited;
              return `
                <div class="flex items-center justify-between bg-white rounded-2xl px-4 py-3 border border-slate-100">
                  <div class="flex items-center gap-3 min-w-0">
                    <span class="text-2xl">${st.icon}</span>
                    <div class="min-w-0">
                      <p class="text-sm font-black text-slate-700 truncate">${escapeHtml(r.family)}</p>
                      <p class="text-[10px] text-slate-400 font-semibold">${Helpers.formatDate(r.created_at)}</p>
                    </div>
                  </div>
                  <span class="shrink-0 px-3 py-1 rounded-full text-[10px] font-black uppercase ${st.color}">${st.label}</span>
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
      <div class="space-y-8">
        ${this._renderHero()}
        ${this._renderReferrals()}
        ${this._renderTiers()}
        ${this._renderWallet()}
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    this._bind();
    this._celebrateIfNewReward();
  },

  /** 🎉 Celebra con confeti si el padre tiene una recompensa sin usar y sin celebrar */
  _celebrateIfNewReward() {
    const rewards = this._dashboard?.rewards || [];
    const uncelebrated = rewards.find(r => !r.is_used && (r.reward_type === 'free_month' || r.reward_type === 'cashback'));
    if (!uncelebrated) return;

    // Solo celebrar una vez por sesión/estudiante
    const key = 'karpus_celebrated_' + (AppState.get('currentStudent')?.id || '') + '_' + uncelebrated.id;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

    setTimeout(() => {
      if (window.confetti) {
        window.confetti({ particleCount: 160, spread: 80, origin: { y: 0.6 } });
        window.confetti({ particleCount: 90, angle: 60, spread: 60, origin: { x: 0, y: 0.7 } });
        window.confetti({ particleCount: 90, angle: 120, spread: 60, origin: { x: 1, y: 0.7 } });
      }
      Helpers.vibrate('success');
      Helpers.toast('¡Recompensa disponible en tu Monedero Karpus! 🎉', 'success');
    }, 350);
  },

  _renderQR() {
    const code = this._dashboard?.code_value || '';
    const qrEl = document.getElementById('embajador-qr');
    if (!qrEl || !code) return;
    const text = `https://karpuskids.com/preinscripcion.html?ref=${encodeURIComponent(code)}`;

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
    const that = this;
    const container = this._container;
    if (!container) return;
    const code = this._dashboard?.code_value || '';
    const link = code ? `https://karpuskids.com/preinscripcion.html?ref=${encodeURIComponent(code)}` : '';

    container.querySelector('[data-emb="copy"]')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        Helpers.toast('Enlace copiado ✅', 'success');
        Helpers.vibrate('light');
      } catch {
        const input = document.getElementById('embajador-link');
        if (input) { input.focus(); input.select(); }
        Helpers.toast('Selecciona y copia el enlace', 'info');
      }
    });

    container.querySelector('[data-emb="whatsapp"]')?.addEventListener('click', () => {
      const msg = `¡Hola! 🎈 Formo parte de la familia Karpus Kids y la atención a nuestro hijo ha sido maravillosa. Si estás buscando un lugar seguro y lleno de amor para tu pequeño, te regalo un descuento especial en su inscripción usando mi enlace: ${link}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
    });

    container.querySelector('[data-emb="share"]')?.addEventListener('click', () => {
      const qrEl = document.getElementById('embajador-qr');
      const canvas = qrEl?.querySelector('canvas');
      if (canvas) {
        canvas.toBlob((blob) => {
          const file = new File([blob], `karpus-embajador-${code}.png`, { type: 'image/png' });
          if (navigator.share && navigator.canShare({ files: [file] })) {
            navigator.share({ title: 'Mi código de Embajador Karpus Kids', files: [file], text: link });
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

    container.querySelector('[data-emb="preview"]')?.addEventListener('click', () => {
      const profile = AppState.get('profile');
      const html = this._cardTemplate(code, profile?.name || 'Familia', link);
      if (window.openGlobalModal) {
        window.openGlobalModal(html);
        // generar QR dentro de la tarjeta al abrir el modal
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

  /** Tarjeta gráfica para presumir el código (Instagram / WhatsApp) */
  _cardTemplate(code, familyName, link) {
    return `
      <div class="bg-white rounded-[2rem] p-6 shadow-2xl">
        <div style="background:linear-gradient(135deg,#10B981,#0EA5E9,#FACC15)" class="rounded-3xl p-6 text-center text-white">
          <p class="text-[10px] font-black uppercase tracking-[0.3em] opacity-90">Karpus Kids</p>
          <h3 class="text-2xl font-black mt-1 mb-4">¡Únete a nuestra familia!</h3>
          <div class="bg-white rounded-2xl p-4 inline-block mx-auto">
            <div id="card-qr"></div>
          </div>
          <p class="text-sm font-black mt-4">${escapeHtml(code)}</p>
          <p class="text-xs font-medium opacity-90 mt-1">Comparte este código y obtén un descuento especial</p>
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
