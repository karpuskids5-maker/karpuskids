import { createClient, SUPABASE_URL, SUPABASE_ANON_KEY } from '../shared/supabase.js';
import { Helpers, escapeHtml } from './helpers.js';
import { AppState } from './appState.js';

const QUICK_AMOUNTS = [250, 500, 1000, 2000, 5000];
const BANK_OPTIONS = [
  'Banreservas', 'Banco Popular Dominicano', 'Banco BHD', 'Banco Santa Cruz',
  'Banco Caribe', 'Banco Vimenca', 'Banco BDI', 'Scotiabank'
];

function methodLabel(m) {
  return ({ transfer: 'Transferencia Bancaria', card: 'Tarjeta de Crédito/Débito', cash: 'Efectivo' })[m] || m;
}

function fmtRD(n) {
  return 'RD$ ' + Helpers.formatCurrency(n);
}

export const DonacionesModule = {
  _campaigns: [],
  _anon: null,
  _profile: null,
  _receipt: null,

  async init() {
    const container = document.getElementById('donaciones-padre-container');
    if (!container) return;
    this._profile = AppState.get('profile') || {};
    container.innerHTML = '<div class="text-center py-14 text-slate-400 text-sm font-bold">Cargando campañas 💝…</div>';
    this._anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: 'public' }
    });
    await this._loadCampaigns(container);
    this._bindForm(container);
  },

  async _loadCampaigns(container) {
    try {
      const { data, error } = await this._anon
        .from('donation_campaigns')
        .select('id, title, description, target_amount, raised_amount, cover_image_url, images, is_active, end_date')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      this._campaigns = data || [];

      const totalTarget = this._campaigns.reduce((s, c) => s + Number(c.target_amount || 0), 0);
      const totalRaised = this._campaigns.reduce((s, c) => s + Number(c.raised_amount || 0), 0);
      const pct = totalTarget > 0 ? Math.min(100, (totalRaised / totalTarget) * 100) : 0;
      const now = new Date();
      const daysLeft = (c) => {
        if (!c.end_date) return '';
        const days = Math.ceil((new Date(c.end_date + 'T23:59:59') - now) / 86400000);
        return days >= 0 ? `Quedan ${days} día${days === 1 ? '' : 's'}` : 'Finalizada';
      };

      container.innerHTML = this._renderHeader(totalRaised, totalTarget, pct) + this._renderCampaigns(daysLeft) + this._renderForm();
    } catch (err) {
      container.innerHTML = '<div class="bg-white rounded-2xl p-10 text-center border border-slate-100 shadow-sm"><p class="text-3xl mb-3">🙈</p><p class="text-sm font-bold text-slate-500">No pudimos cargar las campañas. Intenta de nuevo en un momento.</p></div>';
      console.error('donaciones-padre:', err);
    }
  },

  _renderHeader(totalRaised, totalTarget, pct) {
    return `
      <div class="relative overflow-hidden rounded-3xl p-6 bg-gradient-to-br from-orange-400 via-pink-400 to-rose-500 text-white shadow-lg mb-6">
        <div class="absolute -right-8 -top-8 w-40 h-40 bg-white/10 rounded-full"></div>
        <div class="absolute right-20 -bottom-12 w-28 h-28 bg-white/10 rounded-full"></div>
        <div class="relative">
          <p class="text-[11px] font-black uppercase tracking-[0.2em] text-white/80 mb-1">Campañas de la escuela</p>
          <h2 class="text-2xl font-black leading-tight mb-1">Juntos transformamos vidas 💖</h2>
          <p class="text-sm font-bold text-white/85">Tu aporte apoya proyectos, aulas y servicios del centro. Todo donativo genera tu recibo al instante.</p>
          <div class="mt-5">
            <div class="h-2.5 bg-white/25 rounded-full overflow-hidden">
              <div class="h-full bg-white rounded-full transition-all" style="width:${pct.toFixed(1)}%"></div>
            </div>
            <div class="flex justify-between mt-2 text-xs font-black">
              <span>${this._campaigns.length} campaña(s) activa(s)</span>
              <span>${fmtRD(totalRaised)} <span class="opacity-70">de ${fmtRD(totalTarget)} · ${pct.toFixed(0)}%</span></span>
            </div>
          </div>
        </div>
      </div>`;
  },

  _renderCampaigns(daysLeft) {
    if (!this._campaigns.length) {
      return '<div class="bg-white rounded-2xl p-8 text-center border border-slate-100 shadow-sm mb-6"><p class="text-3xl mb-2">🎗️</p><p class="text-sm font-bold text-slate-500">Aún no hay campañas activas. Tu donación general hace la diferencia.</p></div>';
    }
    const opts = ['<option value="">Donación General</option>']
      .concat(this._campaigns.map(c => `<option value="${c.id}">${escapeHtml(c.title)}</option>`))
      .join('');
    const cards = this._campaigns.map(c => {
      const raised = Number(c.raised_amount || 0);
      const target = Number(c.target_amount || 0);
      const cpct = target > 0 ? Math.min(100, (raised / target) * 100) : 0;
      const gallery = (c.images && c.images.length
        ? c.images
        : (c.cover_image_url ? [c.cover_image_url] : [])).filter(Boolean).slice(0, 5);
      const cover = gallery[0] || null;
      const media = cover
        ? `<div class="h-32 rounded-xl overflow-hidden mb-3 border border-slate-100">
             <img src="${escapeHtml(cover)}" alt="${escapeHtml(c.title)}" loading="lazy" class="w-full h-full object-cover">
           </div>
           ${gallery.length > 1 ? `<div class="flex gap-1.5 mb-3">${gallery.map(g => `<img src="${escapeHtml(g)}" alt="" loading="lazy" class="w-12 h-12 rounded-lg object-cover border border-slate-100" onerror="this.style.display='none'">`).join('')}</div>` : ''}`
        : '';
      return `
        <div class="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm hover:shadow-md transition-all">
          ${media}
          <div class="flex items-center gap-3 mb-2">
            <div class="w-11 h-11 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center text-xl shrink-0 shadow-sm">🎯</div>
            <div class="min-w-0">
              <h4 class="text-sm font-black text-slate-800 leading-tight truncate">${escapeHtml(c.title)}</h4>
              <p class="text-[11px] font-bold text-slate-400">${escapeHtml(daysLeft(c))}</p>
            </div>
          </div>
          <p class="text-xs text-slate-500 leading-relaxed mb-3 line-clamp-2">${escapeHtml(c.description || '')}</p>
          <div class="h-2 bg-slate-100 rounded-full overflow-hidden mb-1.5">
            <div class="h-full bg-gradient-to-r from-orange-400 to-pink-500 rounded-full" style="width:${cpct.toFixed(1)}%"></div>
          </div>
          <div class="flex justify-between text-[11px] font-black">
            <span class="text-slate-700">${fmtRD(raised)}</span>
            <span class="text-slate-400">de ${fmtRD(target)} · ${cpct.toFixed(0)}%</span>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="flex flex-col md:flex-row md:items-center gap-3 mb-4">
        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-black text-slate-700 uppercase tracking-widest">Campañas activas</h3>
          <select id="don-parent-camp" class="mt-2 w-full md:max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
            ${opts}
          </select>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">${cards}</div>`;
  },

  _renderForm() {
    const profile = this._profile || {};
    return `
      <div id="don-parent-form" class="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
        <div class="flex items-center gap-3 mb-5">
          <div class="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center text-xl">💝</div>
          <div>
            <h3 class="text-base font-black text-slate-800">Haz tu donación</h3>
            <p class="text-xs font-bold text-slate-400">Completa los datos y genera tu recibo.</p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Monto (RD$)</label>
            <input id="don-parent-amount" type="number" min="1" step="any" inputmode="decimal" placeholder="0.00"
              class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-lg font-black text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all">
            <div class="flex flex-wrap gap-2 mt-2.5" id="don-parent-quick">
              ${QUICK_AMOUNTS.map(a => `<button type="button" data-a="${a}" class="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-emerald-100 hover:text-emerald-700 transition-all">RD$${a}</button>`).join('')}
            </div>
          </div>
          <div>
            <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Método de pago</label>
            <select id="don-parent-method" class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-black text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all">
              <option value="transfer">Transferencia Bancaria</option>
              <option value="card">Tarjeta de Crédito/Débito</option>
              <option value="cash">Efectivo</option>
            </select>
            <div id="don-parent-bank-row" class="mt-2.5 hidden">
              <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Banco de origen</label>
              <select id="don-parent-bank" class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-black text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all">
                ${BANK_OPTIONS.map(b => `<option>${b}</option>`).join('')}
              </select>
            </div>
          </div>
          <div>
            <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Nombre o razón social</label>
            <input id="don-parent-name" type="text" value="${escapeHtml(profile.name || '')}" placeholder="Tu nombre"
              class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all">
          </div>
          <div>
            <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Correo electrónico</label>
            <input id="don-parent-email" type="email" value="${escapeHtml(profile.email || '')}" placeholder="tucorreo@ejemplo.com"
              class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all">
          </div>
          <div>
            <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Teléfono (opcional)</label>
            <input id="don-parent-phone" type="tel" value="" placeholder="809-000-0000"
              class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all">
          </div>
          <div>
            <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">RNC / Cédula (opcional)</label>
            <input id="don-parent-taxid" type="text" value="" placeholder="Para empresas"
              class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all">
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-4 mt-5">
          <label class="flex items-center gap-2 text-xs font-bold text-slate-500 cursor-pointer select-none">
            <input id="don-parent-anon" type="checkbox" class="w-4 h-4 rounded accent-emerald-600">
            Donar de forma anónima
          </label>
          <button type="button" id="don-parent-btn"
            class="ml-auto px-7 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-black uppercase tracking-widest shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-95 transition-all">
            Donar ahora 💝
          </button>
        </div>
        <p id="don-parent-msg" class="hidden mt-4 text-sm font-black text-center rounded-xl px-4 py-3"></p>
      </div>`;
  },

  _bindForm(container) {
    const amountInput = document.getElementById('don-parent-amount');
    document.getElementById('don-parent-quick')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-a]');
      if (!btn || !amountInput) return;
      document.querySelectorAll('#don-parent-quick button').forEach(b => b.classList.remove('bg-emerald-500', 'text-white'));
      btn.classList.add('bg-emerald-500', 'text-white');
      amountInput.value = btn.dataset.a;
    });
    amountInput?.addEventListener('input', () => {
      document.querySelectorAll('#don-parent-quick button').forEach(b => b.classList.remove('bg-emerald-500', 'text-white'));
    });

    const methodSel = document.getElementById('don-parent-method');
    const bankRow = document.getElementById('don-parent-bank-row');
    methodSel?.addEventListener('change', () => {
      if (bankRow) bankRow.classList.toggle('hidden', methodSel.value !== 'transfer');
    });

    document.getElementById('don-parent-btn')?.addEventListener('click', () => this._submit(container));
  },

  async _submit(container) {
    const msg = document.getElementById('don-parent-msg');
    const btn = document.getElementById('don-parent-btn');
    const setMsg = (t, ok) => {
      if (!msg) return;
      msg.classList.remove('hidden');
      msg.textContent = t;
      msg.style.color = ok ? '#059669' : '#e11d48';
      msg.style.background = ok ? '#ecfdf5' : '#fff1f2';
    };

    const amount  = parseFloat(document.getElementById('don-parent-amount').value);
    const name    = (document.getElementById('don-parent-name').value || '').trim();
    const email   = (document.getElementById('don-parent-email').value || '').trim();
    const phone   = (document.getElementById('don-parent-phone').value || '').trim();
    const taxId   = (document.getElementById('don-parent-taxid').value || '').trim();
    const method  = document.getElementById('don-parent-method').value;
    const campId  = document.getElementById('don-parent-camp').value;
    const anon    = document.getElementById('don-parent-anon').checked;

    if (!amount || amount <= 0) return setMsg('Ingresa un monto válido.', false);
    if (name.length < 2) return setMsg('Ingresa tu nombre o razón social.', false);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setMsg('Ingresa un correo electrónico válido.', false);

    btn.disabled = true;
    btn.textContent = 'Procesando…';
    setMsg('', true);

    try {
      const { data, error } = await this._anon.rpc('register_donation', {
        p_campaign_id: campId ? parseInt(campId, 10) : null,
        p_donor_name: name,
        p_donor_email: email,
        p_donor_phone: phone || null,
        p_donor_tax_id: taxId || null,
        p_is_company: false,
        p_is_anonymous: anon,
        p_amount: amount,
        p_payment_method: method,
        p_bank_name: method === 'transfer' ? (document.getElementById('don-parent-bank')?.value || null) : null,
        p_receipt_url: null
      });
      if (error) throw new Error(error.message || 'Error al registrar la donación');

      const camp = (this._campaigns || []).find(c => String(c.id) === String(campId));
      this._receipt = {
        ref: data?.tracking_ref || '',
        id: data?.donation_id || '',
        amount,
        campaign: camp ? camp.title : 'Donación General',
        name: anon ? 'Anónimo' : name,
        email,
        method,
        date: new Date().toLocaleString('es-DO', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      };

      const form = document.getElementById('don-parent-form');
      if (form) form.style.display = 'none';
      container.insertAdjacentHTML('beforeend', this._renderSuccess());

      this._anon.functions.invoke('send-email', {
        body: {
          to: email,
          subject: 'Karpus Kids · Confirmación de donación ' + this._receipt.ref,
          html: this._receiptEmailHTML(this._receipt, name),
          text: 'Gracias por tu donación. Referencia: ' + this._receipt.ref
        }
      }).catch(() => {});

      document.getElementById('don-parent-print')?.addEventListener('click', () => this._printReceipt());
      document.getElementById('don-parent-another')?.addEventListener('click', () => location.reload());
      if (window.confetti) {
        confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 }, colors: ['#10b981', '#f43f5e', '#f59e0b'] });
      }
    } catch (err) {
      setMsg(err?.message || 'Ocurrió un error. Inténtalo de nuevo.', false);
      console.error('donaciones-padre submit:', err);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Donar ahora 💝';
    }
  },

  _renderSuccess() {
    const r = this._receipt;
    return `
      <div id="don-parent-success" class="bg-white rounded-3xl p-6 border-2 border-emerald-200 shadow-md">
        <div class="text-center mb-5">
          <div class="w-16 h-16 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl mb-3">✅</div>
          <h3 class="text-lg font-black text-slate-800">¡Gracias por tu donación!</h3>
          <p class="text-xs font-bold text-slate-400">Tu aporte está pendiente de validación. Guarda tu referencia:</p>
          <div class="inline-block mt-3 px-5 py-2.5 rounded-xl bg-amber-50 border-2 border-dashed border-amber-300 text-sm font-black text-amber-700">${escapeHtml(r.ref)}</div>
        </div>
        <div class="rounded-2xl bg-slate-50 p-5 space-y-2.5 text-sm">
          <div class="flex justify-between"><span class="text-slate-500 font-bold">Monto</span><span class="font-black text-slate-800">${fmtRD(r.amount)}</span></div>
          <div class="flex justify-between"><span class="text-slate-500 font-bold">Campaña</span><span class="font-black text-slate-800">${escapeHtml(r.campaign)}</span></div>
          <div class="flex justify-between"><span class="text-slate-500 font-bold">Método</span><span class="font-black text-slate-800">${escapeHtml(methodLabel(r.method))}</span></div>
          <div class="flex justify-between"><span class="text-slate-500 font-bold">Fecha</span><span class="font-black text-slate-800">${escapeHtml(r.date)}</span></div>
        </div>
        <p class="text-[11px] leading-relaxed text-slate-400 font-bold mt-4 text-center">Si hiciste una transferencia, adjunta tu volante bancario respondiendo al correo de confirmación que acabamos de enviarte. 💛</p>
        <div class="flex gap-3 mt-5">
          <button type="button" id="don-parent-print" class="flex-1 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest transition-all">Imprimir recibo</button>
          <button type="button" id="don-parent-another" class="flex-1 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black uppercase tracking-widest shadow-md transition-all">Hacer otra donación</button>
        </div>
      </div>`;
  },

  _receiptEmailHTML(r, name) {
    const esc = escapeHtml;
    return `
      <div style="font-family:Nunito,Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
          <div style="background:linear-gradient(135deg,#FF9800,#E91E63);padding:20px;color:#fff;">
            <div style="font-weight:900;font-size:18px;">Karpus Kids</div>
            <div style="font-size:12px;opacity:.85;">Recibo de donación</div>
          </div>
          <div style="padding:24px;">
            <p style="font-size:15px;font-weight:700;">Hola, ${esc(name)}:</p>
            <p style="font-size:13px;line-height:1.7;color:#475569;">Recibimos tu donación. Guárdala con este número de referencia para el seguimiento:</p>
            <div style="margin:18px 0;padding:14px;background:#fff7ed;border:2px dashed #fdba74;border-radius:12px;text-align:center;font-weight:900;font-size:16px;color:#c2410c;">${esc(r.ref)}</div>
            <table style="width:100%;font-size:13px;color:#334155;">
              <tr><td style="padding:4px 0;color:#64748b;">Monto</td><td style="text-align:right;font-weight:800;">${fmtRD(r.amount)}</td></tr>
              <tr><td style="padding:4px 0;color:#64748b;">Campaña</td><td style="text-align:right;font-weight:800;">${esc(r.campaign)}</td></tr>
              <tr><td style="padding:4px 0;color:#64748b;">Método</td><td style="text-align:right;font-weight:800;">${esc(methodLabel(r.method))}</td></tr>
              <tr><td style="padding:4px 0;color:#64748b;">Fecha</td><td style="text-align:right;font-weight:800;">${esc(r.date)}</td></tr>
            </table>
            <p style="font-size:12px;line-height:1.6;color:#94a3b8;margin-top:16px;">La donación está pendiente de validación. Si realizaste una transferencia, adjunta tu volante bancario respondiendo a este correo. Gracias por cambiar vidas. 💛</p>
          </div>
        </div>
      </div>`;
  },

  _printReceipt() {
    const r = this._receipt;
    const w = window.open('', '_blank', 'width=640,height=900');
    if (!w) return;
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Recibo ${escapeHtml(r.ref)}</title>
      <style>
        body{font-family:Nunito,Arial,sans-serif;background:#f1f5f9;padding:32px;color:#0f172a;}
        .card{max-width:520px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;}
        .head{background:linear-gradient(135deg,#FF9800,#E91E63);padding:22px;color:#fff;}
        .head small{opacity:.85;}
        .body{padding:24px;}
        .ref{margin:16px 0;padding:14px;background:#fff7ed;border:2px dashed #fdba74;border-radius:12px;text-align:center;font-weight:900;font-size:17px;color:#c2410c;}
        table{width:100%;font-size:13px;color:#334155;border-collapse:collapse;}
        td{padding:7px 0;border-bottom:1px solid #f1f5f9;}
        td:first-child{color:#64748b;font-weight:700;}
        td:last-child{text-align:right;font-weight:800;}
        .foot{font-size:11px;color:#94a3b8;margin-top:18px;line-height:1.6;}
      </style></head><body>
      <div class="card">
        <div class="head"><div style="font-weight:900;font-size:18px;">Karpus Kids</div><small>Recibo de donación</small></div>
        <div class="body">
          <p style="font-size:14px;font-weight:700;">${escapeHtml(r.name)}</p>
          <div class="ref">${escapeHtml(r.ref)}</div>
          <table>
            <tr><td>Monto</td><td>${fmtRD(r.amount)}</td></tr>
            <tr><td>Campaña</td><td>${escapeHtml(r.campaign)}</td></tr>
            <tr><td>Método</td><td>${escapeHtml(methodLabel(r.method))}</td></tr>
            <tr><td>Fecha</td><td>${escapeHtml(r.date)}</td></tr>
          </table>
          <p class="foot">Donación pendiente de validación. Este documento no sustituye el certificado oficial. Gracias por cambiar vidas.</p>
        </div>
      </div>
      <script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script>
    </body></html>`);
    w.document.close();
  }
};