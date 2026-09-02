import { supabase, sendEmail } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';
import { ensureJspdf } from '../shared/load-pdf.js';
import { CENTRO } from '../shared/factura.js';

const STATUS_LABEL = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  certified: 'Certificado'
};

const STATUS_BADGE = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
  certified: 'bg-violet-100 text-violet-700'
};

const METHOD_LABEL = {
  transfer: 'Transferencia',
  card: 'Tarjeta',
  cash: 'Efectivo'
};

const fmtRD = v => 'RD$ ' + Helpers.formatCurrency(v);
const esc = v => Helpers.escapeHTML(v);

export const DonationsModule = {
  _campaigns: [],
  _donations: [],
  _filter: 'all',
  _campImages: [],        // URLs finales (existentes + subidas) de la campaña en edición
  _campPendingFiles: [],  // Archivos pendientes de subir al guardar {file, objectUrl}

  /* ── Carga inicial ─────────────────────────────────────────────── */
  async init() {
    try {
      await this.loadCampaigns();
      await this.loadDonations();
      this.render();
      this._checkLargePending();
    } catch (e) {
      Helpers.safeLog('error', 'DonationsModule:', e);
      Helpers.toast('Error al cargar donaciones: ' + (e.message || e), 'error');
    }
  },

  async loadCampaigns() {
    const { data, error } = await supabase
      .from('donation_campaigns')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    this._campaigns = data || [];
  },

  async loadDonations() {
    const { data, error } = await supabase
      .from('donations')
      .select('id, tracking_ref, campaign_id, donor_name, donor_email, donor_phone, donor_tax_id, is_company, is_anonymous, amount, currency, payment_method, bank_name, receipt_url, status, notes, approved_by, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    this._donations = data || [];
  },

  async reload() {
    try {
      await this.loadCampaigns();
      await this.loadDonations();
      this.render();
      this._checkLargePending();
    } catch (e) {
      Helpers.safeLog('error', 'DonationsModule.reload:', e);
      Helpers.toast('Error al refrescar: ' + (e.message || e), 'error');
    }
  },

  /* ── Utilidades ────────────────────────────────────────────────── */
  _findDonation(id) {
    return this._donations.find(d => String(d.id) === String(id));
  },

  _campaignName(id) {
    const c = this._campaigns.find(x => String(x.id) === String(id));
    return c ? c.title : 'Donación General';
  },

  // Identifica a un donante. Para donaciones anónimas no hay forma de agrupar
  // de forma fiable (no hay email/nombre), por lo que se usan como entidad única.
  _donorKey(d) {
    if (d.is_anonymous) return '__anon__' + d.id;
    return (d.donor_email || d.donor_name || '').trim().toLowerCase();
  },

  /* ── Render principal ──────────────────────────────────────────── */
  render() {
    this._renderKpis();
    this._renderCampaigns();
    this._renderFilters();
    this.renderDonations();
    this._renderDonors();
    this._renderBadge();
  },

  _renderKpis() {
    const counts = { pending: 0, approved: 0, rejected: 0, certified: 0 };
    let total = 0;
    const donorsSet = new Set();
    for (const d of this._donations) {
      const st = d.status || 'pending';
      counts[st] = (counts[st] || 0) + 1;
      if (st === 'approved' || st === 'certified') total += Number(d.amount);
      if (st !== 'rejected') donorsSet.add(this._donorKey(d));
    }
    const activeCam = this._campaigns.filter(c => c.is_active).length;

    Helpers.setTxt('donKpiTotal', fmtRD(total));
    Helpers.setTxt('donKpiDonors', donorsSet.size);
    Helpers.setTxt('donKpiPending', counts.pending || 0);
    Helpers.setTxt('donKpiCampaigns', activeCam);
    Helpers.setTxt('donKpiCertified', counts.certified || 0);
  },

  _renderCampaigns() {
    const el = document.getElementById('donCampList');
    if (!el) return;
    const count = document.getElementById('donCampCount');
    if (count) count.textContent = this._campaigns.length + ' campañas';

    if (!this._campaigns.length) {
      el.innerHTML = '<div class="text-center py-10 text-slate-400 text-sm font-medium">Aún no hay campañas. Crea la primera para empezar a recaudar.</div>';
      return;
    }

    el.innerHTML = this._campaigns.map(c => {
      const pct = c.target_amount > 0
        ? Math.min(100, Math.round((Number(c.raised_amount) / Number(c.target_amount)) * 100))
        : 0;
      const gallery = (Array.isArray(c.images) ? c.images : []).filter(Boolean);
      const cover = gallery[0] || c.cover_image_url || null;
      const coverImg = cover
        ? `<img src="${esc(cover)}" alt="" loading="lazy" class="w-full h-full object-cover" onerror="this.style.display='none'">`
        : '<i data-lucide="heart-handshake" class="w-8 h-8 text-rose-400"></i>';
      return `
        <div class="relative flex flex-col md:flex-row md:items-center gap-4 p-4 border border-slate-100 rounded-2xl mb-3 hover:shadow-md transition-all ${c.is_active ? 'bg-white' : 'bg-slate-50 opacity-80'}" style="border-left:4px solid ${c.is_active ? '#e11d48' : '#94a3b8'}">
          <div class="w-24 h-24 shrink-0 rounded-xl overflow-hidden bg-rose-50 border border-slate-100 flex items-center justify-center relative">
            ${coverImg}
            ${gallery.length > 1 ? `<span class="absolute bottom-1 right-1 text-[9px] font-black text-white bg-slate-900/70 rounded px-1 py-0.5">${gallery.length} fotos</span>` : ''}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center flex-wrap gap-2">
              <h3 class="font-black text-slate-800 text-sm truncate">${esc(c.title)}</h3>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${c.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}">${c.is_active ? 'Activa' : 'Inactiva'}</span>
            </div>
            <p class="text-xs text-slate-500 mt-1 line-clamp-2">${esc(c.description || 'Sin descripción')}</p>
            <div class="flex items-center gap-3 text-[11px] font-bold text-slate-400 mt-2 flex-wrap">
              <span>${esc(c.start_date || '—')} → ${esc(c.end_date || 'Sin fin')}</span>
              <span class="text-rose-600">${fmtRD(c.raised_amount)} de ${fmtRD(c.target_amount)} (${pct}%)</span>
            </div>
            <div class="h-2 bg-slate-100 rounded-full mt-2 overflow-hidden">
              <div class="h-full bg-gradient-to-r from-rose-500 to-pink-500 rounded-full transition-all" style="width:${pct}%"></div>
            </div>
          </div>
          <div class="flex gap-2 justify-end">
            <button onclick="App.donations.toggleCampaign('${c.id}')" class="px-3 py-1.5 text-[11px] font-bold rounded-lg border ${c.is_active ? 'text-slate-600 border-slate-200 hover:bg-slate-50' : 'text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100'}">
              ${c.is_active ? 'Pausar' : 'Activar'}
            </button>
            <button onclick="App.donations.openCampaignModal('${c.id}')" class="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" title="Editar">
              <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="App.donations.deleteCampaign('${c.id}')" class="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50" title="Eliminar">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>`;
    }).join('');
    this._refreshIcons();
  },

  _renderFilters() {
    const el = document.getElementById('donStatusFilters');
    if (!el) return;
    const counts = { all: this._donations.length };
    for (const st in STATUS_LABEL) counts[st] = this._donations.filter(d => d.status === st).length;
    const chips = ['all', 'pending', 'approved', 'rejected', 'certified'].map(f => {
      const label = f === 'all' ? 'Todas' : STATUS_LABEL[f];
      const active = this._filter === f ? 'bg-rose-600 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200';
      return `<button onclick="App.donations.setFilter('${f}')" class="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all ${active}">${label} <span class="opacity-70">(${counts[f] || 0})</span></button>`;
    }).join('');
    el.innerHTML = chips;
  },

  renderDonations() {
    const el = document.getElementById('donTableBody');
    if (!el) return;
    const q = (document.getElementById('donSearch')?.value || '').trim().toLowerCase();
    let rows = this._donations.filter(d => this._filter === 'all' || d.status === this._filter);
    if (q) {
      rows = rows.filter(d =>
        (d.tracking_ref || '').toLowerCase().includes(q) ||
        (d.donor_name || '').toLowerCase().includes(q) ||
        (d.donor_email || '').toLowerCase().includes(q) ||
        this._campaignName(d.campaign_id).toLowerCase().includes(q)
      );
    }

    if (!rows.length) {
      el.innerHTML = '<tr><td colspan="8" class="text-center py-10 text-slate-400 text-sm font-medium">No hay donaciones que coincidan con el filtro.</td></tr>';
      return;
    }

    el.innerHTML = rows.map(d => {
      const donor = d.is_anonymous ? 'Anónimo' : (d.donor_name || '—');
      const badges = [];
      if (d.status === 'pending') badges.push(`<button onclick="App.donations.approveDonation('${d.id}')" class="px-2 py-1 text-[10px] font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700" title="Aprobar">✓ Aprobar</button>`);
      if (d.status === 'pending' || d.status === 'approved') badges.push(`<button onclick="App.donations.rejectDonation('${d.id}')" class="px-2 py-1 text-[10px] font-bold rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200" title="Rechazar">✕</button>`);
      if (d.status === 'approved') badges.push(`<button onclick="App.donations.certifyDonation('${d.id}')" class="px-2 py-1 text-[10px] font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700" title="Certificar">Certificar</button>`);
      badges.push(`<button onclick="App.donations.viewDonation('${d.id}')" class="px-2 py-1 text-[10px] font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200" title="Detalles"><i data-lucide="eye" class="w-3 h-3"></i></button>`);
      if (d.status === 'approved' || d.status === 'certified') badges.push(`<button onclick="App.donations.generateCertificate('${d.id}')" class="px-2 py-1 text-[10px] font-bold rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200" title="Certificado PDF"><i data-lucide="file-badge" class="w-3 h-3"></i></button>`);

      return `<tr class="border-b border-slate-50 hover:bg-slate-50/60">
        <td class="px-5 py-3 whitespace-nowrap text-slate-500 font-medium text-xs">${esc(Helpers.formatDate(d.created_at))}</td>
        <td class="px-4 py-3 font-black text-[11px] text-slate-700">${esc(d.tracking_ref)}</td>
        <td class="px-4 py-3 text-slate-700 font-bold text-xs">${esc(donor)}${d.is_company ? ' <span class="text-[9px] bg-sky-100 text-sky-700 rounded px-1 py-0.5">EMPRESA</span>' : ''}</td>
        <td class="px-4 py-3 text-slate-500 font-medium text-xs">${esc(this._campaignName(d.campaign_id))}</td>
        <td class="px-4 py-3 font-black ${Number(d.amount) >= 5000 ? 'text-amber-600' : 'text-slate-800'} text-xs">${fmtRD(d.amount)}</td>
        <td class="px-4 py-3 text-slate-500 font-medium text-xs">${esc(METHOD_LABEL[d.payment_method] || d.payment_method)}${d.bank_name ? '<br><span class="text-[9px] text-slate-400">' + esc(d.bank_name) + '</span>' : ''}</td>
        <td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-[10px] font-black uppercase ${STATUS_BADGE[d.status] || 'bg-slate-100 text-slate-500'}">${STATUS_LABEL[d.status] || d.status}</span></td>
        <td class="px-4 py-3"><div class="flex gap-1.5 justify-end">${badges.join('')}</div></td>
      </tr>`;
    }).join('');
    this._refreshIcons();
  },

  _renderDonors() {
    const el = document.getElementById('donDonorBody');
    if (!el) return;
    const map = new Map();
    for (const d of this._donations) {
      if (d.status === 'rejected') continue;
      const key = this._donorKey(d);
      const name = d.is_anonymous ? 'Anónimo' : (d.donor_name || (d.donor_email ? '(sin nombre)' : '—'));
      const entry = map.get(key) || { name, email: d.donor_email, phone: d.donor_phone, is_company: d.is_company, count: 0, total: 0, last: d.created_at };
      entry.count++;
      entry.total += Number(d.amount);
      if (new Date(d.created_at) > new Date(entry.last)) entry.last = d.created_at;
      map.set(key, entry);
    }
    const donors = [...map.values()].sort((a, b) => b.total - a.total);

    if (!donors.length) {
      el.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-slate-400 text-sm font-medium">Sin donantes aún.</td></tr>`;
      return;
    }

    el.innerHTML = donors.map((don, i) => `
      <tr class="border-b border-slate-50 hover:bg-slate-50/60">
        <td class="px-5 py-3">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center text-[11px] font-black">${esc((don.name || '?').charAt(0).toUpperCase())}</div>
            <div>
              <p class="font-black text-slate-700 text-xs">${esc(don.name)}${don.is_company ? ' <span class="text-[9px] bg-sky-100 text-sky-700 rounded px-1 py-0.5">EMPRESA</span>' : ''}</p>
              ${don.email ? `<p class="text-[10px] text-slate-400">${esc(don.email)}</p>` : ''}
            </div>
          </div>
        </td>
        <td class="px-4 py-3 text-slate-500 font-medium text-xs">${don.phone ? esc(don.phone) : '—'}</td>
        <td class="px-4 py-3 font-black text-slate-700 text-xs">${don.count} aporte${don.count > 1 ? 's' : ''}</td>
        <td class="px-4 py-3 font-black text-emerald-700 text-xs">${fmtRD(don.total)}</td>
        <td class="px-4 py-3 text-slate-400 font-medium text-xs">${esc(Helpers.formatDate(don.last))}</td>
      </tr>`).join('');
  },

  _renderBadge() {
    const badge = document.getElementById('badge-donaciones');
    if (!badge) return;
    const pending = this._donations.filter(d => d.status === 'pending').length;
    badge.textContent = pending;
    badge.classList.toggle('hidden', pending === 0);
  },

  _checkLargePending() {
    const el = document.getElementById('donAlertLarge');
    if (!el) return;
    const big = this._donations.filter(d => d.status === 'pending' && Number(d.amount) >= 5000);
    if (!big.length) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
        <i data-lucide="alert-triangle" class="w-5 h-5 text-amber-500 mt-0.5"></i>
        <div class="flex-1">
          <p class="text-sm font-black text-amber-800">${big.length} donación${big.length > 1 ? 'es' : ''} a partir de RD$ 5,000 pendiente${big.length > 1 ? 's' : ''} de validar</p>
          <p class="text-xs text-amber-700 mt-1 font-medium">${big.slice(0, 4).map(d => esc(d.tracking_ref) + ' · ' + fmtRD(d.amount)).join(' — ')}${big.length > 4 ? '…' : ''}</p>
        </div>
      </div>`;
    this._refreshIcons();
  },

  _refreshIcons() {
    if (window.lucide) try { lucide.createIcons(); } catch (e) {}
  },

  /* ── Filtros y búsqueda ────────────────────────────────────────── */
  setFilter(f) {
    this._filter = f || 'all';
    this._renderFilters();
    this.renderDonations();
  },

  /* ── CRUD de campañas ──────────────────────────────────────────── */
  openCampaignModal(id) {
    const c = id ? this._campaigns.find(x => String(x.id) === String(id)) : null;
    const tt = c ? '' : 'Nueva Campaña de Recaudación';
    window.openGlobalModal(`
      <div class="p-6">
        <h3 class="text-xl font-black text-slate-800 mb-1">${c ? 'Editar Campaña' : tt}</h3>
        <p class="text-xs text-slate-400 font-medium mb-5">${c ? 'Actualiza la información de la campaña.' : 'Crea una campaña y publícala en la página principal.'}</p>
        <div class="space-y-4">
          <div>
            <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Título *</label>
            <input id="donCampTitle" value="${c ? esc(c.title) : ''}" class="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-rose-500 outline-none" placeholder="Ej: Becas Escolares 2026" />
          </div>
          <div>
            <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Descripción</label>
            <textarea id="donCampDesc" rows="3" class="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-rose-500 outline-none" placeholder="¿Para qué se usa el fondo?">${c ? esc(c.description || '') : ''}</textarea>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Meta (RD$)</label>
              <input id="donCampTarget" type="number" min="0" step="0.01" value="${c ? (c.target_amount || 0) : ''}" class="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-rose-500 outline-none" placeholder="250000" />
            </div>
            <div>
              <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Estado</label>
              <select id="donCampActive" class="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-rose-500 outline-none">
                <option value="true" ${c && !c.is_active ? '' : 'selected'}>Activa (visible al público)</option>
                <option value="false" ${c && !c.is_active ? 'selected' : ''}>Inactiva (oculta)</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Inicio</label>
              <input id="donCampStart" type="date" value="${c ? esc((c.start_date || '').slice(0, 10)) : ''}" class="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-rose-500 outline-none" />
            </div>
            <div>
              <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Fin (opcional)</label>
              <input id="donCampEnd" type="date" value="${c ? esc((c.end_date || '').slice(0, 10)) : ''}" class="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-rose-500 outline-none" />
            </div>
          </div>
          <div>
            <label class="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Fotos de la campaña (máx. 5, la primera será la portada)</label>
            <div id="donCampImages" class="flex flex-wrap gap-2 mb-2"></div>
            <input type="file" id="donCampCoverFile" accept="image/*" multiple class="hidden">
            <button type="button" onclick="App.donations.pickCampaignImages()" class="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm font-bold text-slate-400 hover:border-rose-400 hover:text-rose-500 active:scale-[.99] transition-all">
              <i data-lucide="image-plus" class="w-4 h-4 inline-block mr-1"></i> Subir fotos
            </button>
            <p class="text-[10px] text-slate-400 font-medium mt-1.5"><i data-lucide="info" class="w-3 h-3 inline-block mr-0.5"></i>JPG, PNG o WebP · máx. 5 MB por foto</p>
          </div>
          <input type="hidden" id="donCampId" value="${c ? c.id : ''}" />
          <div class="flex gap-3 pt-2">
            <button onclick="App.donations.saveCampaign()" class="flex-1 py-3 bg-rose-600 text-white rounded-xl font-black text-sm hover:bg-rose-700 transition-all shadow-md">Guardar Campaña</button>
            <button onclick="App.ui.closeModal()" class="px-5 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-200">Cancelar</button>
          </div>
        </div>
      </div>`);

    // Estado de la galería para editar/crear la campaña
    this._campImages = c
      ? [...(c.images && Array.isArray(c.images) ? c.images : [])]
      : [];
    if (!this._campImages.length && c?.cover_image_url) this._campImages.push(c.cover_image_url);
    this._campPendingFiles = [];
    this._renderCampImages();

    const fileInput = document.getElementById('donCampCoverFile');
    if (fileInput) fileInput.value = '';
    fileInput?.addEventListener('change', (e) => this._handleCampImages(e));
  },

  /* ── Galería de fotos de campaña ─────────────────────────────── */
  _renderCampImages() {
    const el = document.getElementById('donCampImages');
    if (!el) return;

    const items = [
      ...this._campImages.map((url, i) => this._imgTile(url, 'saved', i)),
      ...this._campPendingFiles.map((p, i) => this._imgTile(p.objectUrl, 'pending', i))
    ].join('');
    el.innerHTML = items || '<span class="text-[11px] text-slate-400 font-medium italic py-1">Sin fotos aún.</span>';
    this._refreshIcons();
  },

  _imgTile(src, kind, idx) {
    return `
      <div class="relative group w-20 h-20 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
        <img src="${esc(src)}" alt="" class="w-full h-full object-cover">
        <span class="absolute bottom-1 left-1 text-[8px] font-black text-white bg-slate-900/60 rounded px-1 py-0.5">${idx === 0 ? 'Portada' : ''}</span>
        <button type="button" onclick="App.donations.removeCampImage('${kind}', ${idx})" title="Quitar" class="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">✕</button>
        ${kind === 'pending' ? '<span class="absolute bottom-1 right-1 text-[8px] font-black text-amber-600 bg-white/90 rounded px-1 py-0.5">nuevo</span>' : ''}
      </div>`;
  },

  pickCampaignImages() {
    const input = document.getElementById('donCampCoverFile');
    if (!input) return;
    input.click();
  },

  _handleCampImages(e) {
    const fileInput = e.target;
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;

    const total = this._campImages.length + this._campPendingFiles.length + files.length;
    if (total > 5) {
      Helpers.toast('Máximo 5 fotos por campaña', 'warning');
      fileInput.value = '';
      return;
    }

    let added = 0;
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) { Helpers.toast('Una foto supera 5 MB y fue omitida', 'warning'); continue; }
      if (!file.type.startsWith('image/')) { Helpers.toast('Solo se permiten imágenes', 'warning'); continue; }
      this._campPendingFiles.push({ file, objectUrl: URL.createObjectURL(file) });
      added++;
    }
    fileInput.value = '';
    if (added) { this._renderCampImages(); Helpers.toast(added + ' foto(s) seleccionada(s)', 'success'); }
  },

  removeCampImage(kind, idx) {
    if (kind === 'saved') {
      this._campImages.splice(idx, 1);
    } else {
      const item = this._campPendingFiles[idx];
      if (item) { URL.revokeObjectURL(item.objectUrl); this._campPendingFiles.splice(idx, 1); }
    }
    this._renderCampImages();
  },

  async _uploadCampImages() {
    const urls = [];
    const pending = [...this._campPendingFiles];
    for (const p of pending) {
      try {
        const ext = (p.file.name.split('.').pop() || 'jpg').toLowerCase().replace('jpeg', 'jpg');
        const path = `donaciones/campanas/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from('karpus-uploads').upload(path, p.file, { upsert: true, contentType: p.file.type });
        if (error) throw error;
        const { data } = supabase.storage.from('karpus-uploads').getPublicUrl(path);
        urls.push(data.publicUrl);
      } catch (err) {
        Helpers.safeLog('warn', 'upload campaña imagen:', err);
      } finally {
        URL.revokeObjectURL(p.objectUrl);
      }
    }
    this._campPendingFiles = [];
    if (urls.length < pending.length) Helpers.toast('Algunas fotos no pudieron subirse', 'warning');
    return urls;
  },

  async saveCampaign() {
    const id      = document.getElementById('donCampId')?.value?.trim();
    const title   = document.getElementById('donCampTitle')?.value?.trim();
    if (!title) return Helpers.toast('El título es requerido', 'warning');

    const btn = document.querySelector('#globalModalContainer button[onclick*="donations.saveCampaign"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Subiendo fotos…'; }

    this._campImages = this._campImages || [];

    try {
      const uploaded = await this._uploadCampImages();
      const images = [...this._campImages, ...uploaded].slice(0, 5);

      const payload = {
        title,
        description: document.getElementById('donCampDesc')?.value?.trim() || null,
        target_amount: Number(document.getElementById('donCampTarget')?.value) || 0,
        images,
        cover_image_url: images[0] || null,
        start_date: document.getElementById('donCampStart')?.value || null,
        end_date: document.getElementById('donCampEnd')?.value || null,
        is_active: document.getElementById('donCampActive')?.value === 'true'
      };

      if (id) {
        const { error } = await supabase.from('donation_campaigns').update(payload).eq('id', parseInt(id));
        if (error) throw error;
        Helpers.toast('Campaña actualizada ✓', 'success');
      } else {
        const { error } = await supabase.from('donation_campaigns').insert(payload);
        if (error) throw error;
        Helpers.toast('Campaña creada ✓', 'success');
      }
      App.ui.closeModal();
      this.reload();
    } catch (e) {
      Helpers.safeLog('error', 'saveCampaign:', e);
      Helpers.toast('Error al guardar: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar Campaña'; }
    }
  },

  async toggleCampaign(id) {
    const c = this._campaigns.find(x => String(x.id) === String(id));
    if (!c) return;
    const { error } = await supabase
      .from('donation_campaigns')
      .update({ is_active: !c.is_active })
      .eq('id', parseInt(id));
    if (error) return Helpers.toast('Error: ' + error.message, 'error');
    Helpers.toast(c.is_active ? 'Campaña pausada' : 'Campaña activada ✓', 'success');
    this.reload();
  },

  async deleteCampaign(id) {
    const c = this._campaigns.find(x => String(x.id) === String(id));
    if (!c) return;
    if (!(await Helpers.confirm(`¿Eliminar la campaña «${c.title}»? Sus donaciones se conservarán como "General".`))) return;
    const { error } = await supabase.from('donation_campaigns').delete().eq('id', parseInt(id));
    if (error) return Helpers.toast('Error: ' + error.message, 'error');
    Helpers.toast('Campaña eliminada', 'success');
    this.reload();
  },

  /* ── Acciones sobre donaciones ─────────────────────────────────── */
  async approveDonation(id) {
    const d = this._findDonation(id);
    if (!d) return;
    if (!(await Helpers.confirm(`¿Aprobar la donación ${esc(d.tracking_ref)} por ${fmtRD(d.amount)}?`))) return;

    const { error } = await supabase.rpc('approve_donation', { p_donation_id: id });
    if (error) {
      Helpers.safeLog('error', 'approve_donation:', error);
      return Helpers.toast('Error al aprobar: ' + error.message, 'error');
    }
    Helpers.toast('Donación aprobada ✓', 'success');
    this._notifyApproved(d);
    this.reload();
  },

  async rejectDonation(id) {
    const d = this._findDonation(id);
    if (!d) return;
    const reason = window.prompt('Motivo del rechazo:', 'No se pudo verificar el pago');
    if (reason === null) return;

    const { error } = await supabase.rpc('reject_donation', { p_donation_id: id, p_notes: reason.trim() || null });
    if (error) {
      Helpers.safeLog('error', 'reject_donation:', error);
      return Helpers.toast('Error al rechazar: ' + error.message, 'error');
    }
    Helpers.toast('Donación rechazada', 'error');
    this.reload();
  },

  async certifyDonation(id) {
    const d = this._findDonation(id);
    if (!d) return;
    if (!(await Helpers.confirm(`¿Certificar (certificado deducible fiscal) la donación ${esc(d.tracking_ref)}?`))) return;

    const { error } = await supabase.rpc('certify_donation', { p_donation_id: id });
    if (error) {
      Helpers.safeLog('error', 'certify_donation:', error);
      return Helpers.toast('Error al certificar: ' + error.message, 'error');
    }
    Helpers.toast('Donación certificada ✓', 'success');
    this.generateCertificate(id);
    this.reload();
  },

  /* ── Detalle ───────────────────────────────────────────────────── */
  viewDonation(id) {
    const d = this._findDonation(id);
    if (!d) return;
    const methodIcon = d.payment_method === 'transfer' ? 'landmark' : (d.payment_method === 'card' ? 'credit-card' : 'banknote');
    window.openGlobalModal(`
      <div class="p-6">
        <div class="flex items-center justify-between mb-1">
          <h3 class="text-xl font-black text-slate-800">${esc(d.tracking_ref)}</h3>
          <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase ${STATUS_BADGE[d.status] || 'bg-slate-100 text-slate-500'}">${STATUS_LABEL[d.status] || d.status}</span>
        </div>
        <p class="text-[11px] text-slate-400 font-bold mb-5">Registrada ${esc(Helpers.formatDate(d.created_at))}</p>
        <div class="grid grid-cols-2 gap-4 text-sm mb-5">
          <div class="col-span-2"><p class="text-[10px] font-black text-slate-400 uppercase mb-0.5">Donante</p><p class="font-black text-slate-800">${esc(d.is_anonymous ? 'Anónimo' : (d.donor_name || '—'))}${d.is_company ? ' <span class="text-[9px] bg-sky-100 text-sky-700 rounded px-1 py-0.5">EMPRESA</span>' : ''}${d.is_anonymous ? ' <span class="text-[9px] bg-slate-100 text-slate-500 rounded px-1 py-0.5">ANÓNIMO</span>' : ''}</p></div>
          <div><p class="text-[10px] font-black text-slate-400 uppercase mb-0.5">Monto</p><p class="font-black text-rose-600">${fmtRD(d.amount)}</p></div>
          <div><p class="text-[10px] font-black text-slate-400 uppercase mb-0.5">Método</p><p class="font-bold text-slate-700 flex items-center gap-1.5"><i data-lucide="${methodIcon}" class="w-3.5 h-3.5"></i> ${esc(METHOD_LABEL[d.payment_method] || d.payment_method)}${d.bank_name ? ' · ' + esc(d.bank_name) : ''}</p></div>
          <div><p class="text-[10px] font-black text-slate-400 uppercase mb-0.5">Campaña</p><p class="font-bold text-slate-700">${esc(this._campaignName(d.campaign_id))}</p></div>
          <div><p class="text-[10px] font-black text-slate-400 uppercase mb-0.5">Moneda</p><p class="font-bold text-slate-700">${esc(d.currency || 'DOP')}</p></div>
          <div><p class="text-[10px] font-black text-slate-400 uppercase mb-0.5">Email</p><p class="font-bold text-slate-700 text-xs">${esc(d.donor_email || '—')}</p></div>
          <div><p class="text-[10px] font-black text-slate-400 uppercase mb-0.5">Teléfono</p><p class="font-bold text-slate-700 text-xs">${esc(d.donor_phone || '—')}</p></div>
          ${d.donor_tax_id ? `<div><p class="text-[10px] font-black text-slate-400 uppercase mb-0.5">Cédula / RNC</p><p class="font-bold text-slate-700 text-xs">${esc(d.donor_tax_id)}</p></div>` : ''}
          ${d.notes ? `<div class="col-span-2"><p class="text-[10px] font-black text-slate-400 uppercase mb-0.5">Notas</p><p class="text-xs text-slate-600 bg-slate-50 rounded-xl p-3">${esc(d.notes)}</p></div>` : ''}
        </div>
        <div class="flex gap-3 flex-wrap">
          <button onclick="App.donations.generateCertificate('${d.id}')" class="px-4 py-2.5 bg-amber-500 text-white rounded-xl text-xs font-black hover:bg-amber-600 shadow-md"><i data-lucide="file-badge" class="w-3.5 h-3.5 inline-block mr-1"></i> ${d.status === 'certified' ? 'Descargar certificado' : 'Generar recibo'}</button>
          ${d.receipt_url ? `<a href="${esc(d.receipt_url)}" target="_blank" class="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-xs font-black hover:bg-slate-200"><i data-lucide="paperclip" class="w-3.5 h-3.5 inline-block mr-1"></i> Volante adjunto</a>` : ''}
          ${d.status === 'pending' ? `<button onclick="App.donations.approveDonation('${d.id}')" class="px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 shadow-md">✓ Aprobar</button>
          <button onclick="App.donations.rejectDonation('${d.id}')" class="px-4 py-2.5 bg-rose-100 text-rose-700 rounded-xl text-xs font-black hover:bg-rose-200">Rechazar</button>` : ''}
          ${d.status === 'approved' ? `<button onclick="App.donations.certifyDonation('${d.id}')" class="px-4 py-2.5 bg-violet-600 text-white rounded-xl text-xs font-black hover:bg-violet-700 shadow-md">Certificar deducible</button>` : ''}
        </div>
      </div>`);
  },

  /* ── Notificaciones ────────────────────────────────────────────── */
  async _notifyApproved(d) {
    try {
      if (!d.donor_email || d.is_anonymous) return;
      await sendEmail(
        d.donor_email,
        'Karpus Kids · Donación verificada ✓ ' + d.tracking_ref,
        `<div style="font-family:Nunito,Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
          <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid #e2e8f0;">
            <div style="background:linear-gradient(135deg,#16a34a,#0f766e);padding:20px;color:#fff;">
              <div style="font-weight:900;font-size:18px;">Gracias por tu generosidad 💚</div>
              <div style="font-size:12px;opacity:.85;">Tu donación fue verificada y aprobada</div>
            </div>
            <div style="padding:24px;font-size:13px;line-height:1.7;color:#334155;">
              <p>Hola, <b>${esc(d.donor_name || 'amigo/a de Karpus Kids')}</b>:</p>
              <p>Tu aporte de <b style="color:#0f766e;">${fmtRD(d.amount)}</b> a la campaña <b>${esc(this._campaignName(d.campaign_id))}</b> fue <b>aprobado</b>.</p>
              <p style="margin:18px 0;">Referencia: <b style="color:#0f766e;">${esc(d.tracking_ref)}</b></p>
              <p style="font-size:12px;color:#94a3b8;">Nuestro equipo generará tu certificado deducible de impuestos. Si lo necesitas, responde a este correo. Gracias por cambiar vidas. 💛</p>
            </div>
          </div>
        </div>`,
        'Tu donación ' + d.tracking_ref + ' fue aprobada por ' + fmtRD(d.amount) + '. Referencia: ' + d.tracking_ref
      );
    } catch (e) {
      Helpers.safeLog('warn', 'email aprobación no enviado:', e);
    }
  },

  /* ── Certificado PDF ───────────────────────────────────────────── */
  async generateCertificate(id) {
    const d = this._findDonation(id);
    if (!d) return;
    const isCertified = d.status === 'certified';

    try {
      await ensureJspdf();
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const W = 297, H = 210, cx = W / 2;

      // Marco decorativo
      doc.setDrawColor(230, 52, 102);
      doc.setLineWidth(1.2);
      doc.roundedRect(10, 10, W - 20, H - 20, 6, 6);
      doc.setLineWidth(0.4);
      doc.setDrawColor(253, 186, 116);
      doc.roundedRect(13, 13, W - 26, H - 26, 4, 4);

      // Encabezado
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(30, 27, 75);
      doc.text(CENTRO.nombre, cx, 34, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 140);
      doc.text(CENTRO.direccion + ' · ' + CENTRO.telefono + ' · ' + CENTRO.email, cx, 41, { align: 'center' });

      doc.setDrawColor(230, 52, 102);
      doc.setLineWidth(0.6);
      doc.line(cx - 60, 45, cx + 60, 45);

      // Título
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(30);
      doc.setTextColor(230, 52, 102);
      doc.text(isCertified ? 'CERTIFICADO DE DONACIÓN' : 'RECIBO DE DONACIÓN', cx, 60, { align: 'center' });

      if (isCertified) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(150, 110, 70);
        doc.text('Comprobante deducible de impuestos — República Dominicana', cx, 67, { align: 'center' });
      }

      // Cuerpo
      const donor = d.is_anonymous ? 'Donante Anónimo' : (d.donor_name || 'Donante');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(60, 60, 80);
      const p1 = isCertified
        ? 'Se certifica que'
        : 'Se hace constar que';
      doc.text(p1, cx, isCertified ? 82 : 78, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.setTextColor(30, 27, 75);
      doc.text(donor, cx, isCertified ? 92 : 88, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(60, 60, 80);
      const amountLine = 'donó la suma de';
      doc.text(amountLine, cx, isCertified ? 103 : 99, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(26);
      doc.setTextColor(16, 185, 129);
      doc.text(fmtRD(d.amount) + ' DOP', cx, isCertified ? 115 : 111, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(60, 60, 80);
      doc.text(
        'a ' + CENTRO.nombre + ', Centro Educativo de Estancia Infantil, ' +
        (this._campaignName(d.campaign_id).toLowerCase() === 'donación general' ? 'en carácter de donación filantrópica' : 'para la campaña:'),
        cx, isCertified ? 127 : 123, { align: 'center' });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(230, 52, 102);
      doc.text(this._campaignName(d.campaign_id), cx, isCertified ? 136 : 132, { align: 'center' });

      // Referencia y fecha
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(90, 90, 110);
      const fecha = new Date(d.created_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' });
      doc.text('Referencia: ' + d.tracking_ref + '      Fecha de emisión: ' + fecha, cx, isCertified ? 152 : 148, { align: 'center' });

      // Firma
      doc.setDrawColor(150, 150, 170);
      doc.setLineWidth(0.4);
      doc.line(cx - 50, 172, cx + 50, 172);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(30, 27, 75);
      doc.text('Dirección General', cx, 178, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(130, 130, 150);
      doc.text(CENTRO.nombre, cx, 183, { align: 'center' });

      doc.save('certificado-' + d.tracking_ref + '.pdf');
    } catch (e) {
      Helpers.safeLog('error', 'generateCertificate:', e);
      Helpers.toast('No se pudo generar el PDF: ' + (e.message || e), 'error');
    }
  },

  /* ── Exportaciones ─────────────────────────────────────────────── */
  exportCSV() {
    if (!this._donations.length) return Helpers.toast('No hay donaciones para exportar', 'warning');
    const rows = this._donations.map(d => ({
      Fecha: new Date(d.created_at).toLocaleString('es-DO'),
      Referencia: d.tracking_ref,
      Donante: d.is_anonymous ? 'Anónimo' : (d.donor_name || ''),
      Email: d.is_anonymous ? '' : (d.donor_email || ''),
      Telefono: d.is_anonymous ? '' : (d.donor_phone || ''),
      Cedula_RNC: d.donor_tax_id || '',
      Empresa: d.is_company ? 'Sí' : 'No',
      Campana: this._campaignName(d.campaign_id),
      Monto: d.amount,
      Moneda: d.currency || 'DOP',
      Metodo: METHOD_LABEL[d.payment_method] || d.payment_method,
      Banco: d.bank_name || '',
      Estado: STATUS_LABEL[d.status] || d.status,
      Notas: d.notes || ''
    }));
    Helpers.exportToCSV(rows, 'donaciones_' + new Date().toISOString().slice(0, 10) + '.csv');
  },

  exportDonorsCSV() {
    if (!this._donations.length) return Helpers.toast('No hay donantes para exportar', 'warning');
    const map = new Map();
    for (const d of this._donations) {
      if (d.status === 'rejected') continue;
      const key = this._donorKey(d);
      const entry = map.get(key) || { nombre: d.is_anonymous ? 'Anónimo' : (d.donor_name || ''), email: d.donor_email, telefono: d.donor_phone, empresa: d.is_company ? 'Sí' : 'No', aportes: 0, total: 0 };
      entry.aportes++;
      entry.total += Number(d.amount);
      map.set(key, entry);
    }
    const rows = [...map.values()].map(d => ({
      Donante: d.nombre,
      Email: d.email,
      Telefono: d.telefono,
      Empresa: d.empresa,
      Aportes: d.aportes,
      Total_donado: d.total
    }));
    Helpers.exportToCSV(rows, 'donantes_' + new Date().toISOString().slice(0, 10) + '.csv');
  }
};