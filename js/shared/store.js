/**
 * 🛍️ StoreModule v3 — Tienda Escolar Karpus Kids
 * Paneles: Padre (catálogo + pedidos) · Directora/Asistente (pedidos, productos, inventario)
 * Subida real de múltiples fotos, categorías libres, tallas con stock por talla,
 * salidas validadas por talla, KPIs e inventario con movimientos.
 */
import { supabase } from './supabase.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
const _esc = (s = '') => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const _fmt = (n) => Number(n||0).toLocaleString('es-DO',{minimumFractionDigits:2,maximumFractionDigits:2});
const _currency = (n) => `RD$ ${_fmt(n)}`;
const _date = (d) => new Date(d).toLocaleDateString('es-DO',{day:'2-digit',month:'short',year:'numeric'});
const _time = (d) => new Date(d).toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit'});
const _toast = (msg,type='success') => window.Helpers?.toast?.(msg,type);
const BUCKET = 'karpus-uploads';

const STATUS = {
  pending:   {label:'Pendiente',  cls:'bg-amber-100 text-amber-700 border-amber-200',    dot:'bg-amber-400',  icon:'clock'},
  confirmed: {label:'Confirmado', cls:'bg-blue-100 text-blue-700 border-blue-200',       dot:'bg-blue-400',   icon:'check-check'},
  ready:     {label:'Listo',      cls:'bg-teal-100 text-teal-700 border-teal-200',       dot:'bg-teal-400',   icon:'package-check'},
  delivered: {label:'Entregado',  cls:'bg-emerald-100 text-emerald-700 border-emerald-200',dot:'bg-emerald-400',icon:'handshake'},
  cancelled: {label:'Cancelado',  cls:'bg-slate-100 text-slate-500 border-slate-200',    dot:'bg-slate-300',  icon:'x-circle'},
};

const MOVEMENT = {
  entry:      {label:'Entrada', cls:'text-emerald-700 bg-emerald-50 border-emerald-200', icon:'arrow-down-left'},
  exit:       {label:'Salida',  cls:'text-rose-700 bg-rose-50 border-rose-200',          icon:'arrow-up-right'},
  adjustment: {label:'Ajuste',  cls:'text-blue-700 bg-blue-50 border-blue-200',          icon:'sliders-horizontal'},
};

// ── Upload de imagen a Supabase Storage ──────────────────────────────────────
async function _uploadImg(file){
  try{
    const { ImageLoader } = await import('./image-loader.js');
    const ext = (file.name.split('.').pop()||'jpg').toLowerCase();
    const path = `store/products/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    return await ImageLoader.uploadToStorage(file, BUCKET, path, {maxWidth:1100, maxHeight:1100, quality:.82});
  }catch(e1){
    const ext = (file.name.split('.').pop()||'jpg').toLowerCase();
    const path = `store/products/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const {error} = await supabase.storage.from(BUCKET).upload(path, file, {upsert:false, contentType:file.type});
    if(error) throw error;
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PANEL PADRE — Catálogo, carrito y pedidos
// ═════════════════════════════════════════════════════════════════════════════
let _cart    = [];
let _catalog = [];
let _padre   = {search:'', cat:'__all'};

const _ckey  = (pid,sz) => sz ? `${pid}__${sz}` : pid;
const _total = () => _cart.reduce((s,i)=>s+i.price*i.quantity,0);
const _count = () => _cart.reduce((s,i)=>s+i.quantity,0);

function _cartAdd(product, sz=null, qty=1){
  const k = _ckey(product.id,sz);
  const ex = _cart.find(i=>_ckey(i.product_id,i.sz)===k);
  const maxStock = sz ? (product.sizes?.find(s=>s.label===sz)?.stock ?? product.stock) : product.stock;
  if(ex){
    if(ex.quantity+qty<=maxStock) ex.quantity+=qty;
    else{ ex.quantity=maxStock; _toast('Stock máximo alcanzado','warning'); }
  }
  else{
    if(maxStock<=0){ _toast('Producto agotado','warning'); return false; }
    _cart.push({product_id:product.id,name:product.name+(sz?` (Talla ${sz})`:''),price:Number(product.price),quantity:Math.min(qty,maxStock),stock:maxStock,sz});
  }
  _badge(true);
  return true;
}
function _badge(pop=false){
  const n=_count();
  document.querySelectorAll('[data-store-badge]').forEach(el=>{
    el.textContent=n; el.classList.toggle('hidden',n===0);
    if(pop&&n>0){ el.classList.remove('kk-store-pop'); void el.offsetWidth; el.classList.add('kk-store-pop'); }
  });
}
function _ensureStoreCss(){
  if(document.getElementById('kkStoreCss'))return;
  const st=document.createElement('style'); st.id='kkStoreCss';
  st.textContent=`
    @keyframes kkStorePop{0%{transform:scale(1)}35%{transform:scale(1.55)}70%{transform:scale(.85)}100%{transform:scale(1)}}
    .kk-store-pop{animation:kkStorePop .55s cubic-bezier(.34,1.56,.64,1)}
    @keyframes kkFlyToCart{0%{opacity:1;transform:scale(1)}70%{opacity:.9}100%{opacity:0;transform:translate(var(--kfx,40px),var(--kfy,-260px)) scale(.25)}}
    .kk-fly-img{position:fixed;z-index:4000;border-radius:18px;object-fit:cover;pointer-events:none;box-shadow:0 12px 32px rgba(0,0,0,.28);animation:kkFlyToCart .7s cubic-bezier(.4,0,.6,1) forwards}
    @keyframes kkModalIn{from{opacity:0;transform:translateY(26px) scale(.97)}to{opacity:1;transform:none}}
    .kk-modal-in{animation:kkModalIn .28s cubic-bezier(.22,1,.36,1)}
    @keyframes kkFadeIn{from{opacity:0}to{opacity:1}}
    .kk-fade-in{animation:kkFadeIn .2s ease-out}
    #pdMainImgWrap img{user-select:none;-webkit-user-drag:none}
    /* Overlay "Ver detalles": solo en dispositivos con hover real (evita pill
       fantasma pegado en pantallas táctiles) */
    .kk-hover-reveal{display:none!important}
    @media (hover:hover) and (pointer:fine){.kk-hover-reveal{display:flex!important}}`;
  document.head.appendChild(st);
}
function _cartRm(k){ _cart=_cart.filter(i=>_ckey(i.product_id,i.sz)!==k); _badge(); }

export async function initStorePadre(containerId){
  const w=document.getElementById(containerId); if(!w) return;
  _ensureStoreCss();
  w.innerHTML=`
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
      <div><h2 class="text-2xl font-black text-slate-800 flex items-center gap-2"><span class="w-10 h-10 bg-lime-100 rounded-2xl flex items-center justify-center text-xl">🛍️</span> Tienda Escolar</h2>
           <p class="text-sm text-slate-400 mt-1 font-semibold">Toca un artículo para ver fotos, tallas y agregarlo a tu pedido</p></div>
      <button onclick="StoreModule.openCart()"
        class="relative flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-sm shadow-md shadow-emerald-600/25 transition-all active:scale-95">
        <i data-lucide="shopping-cart" class="w-4 h-4"></i> Mi Pedido
        <span data-store-badge class="hidden absolute -top-2 -right-2 min-w-[20px] h-5 px-1 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center ring-2 ring-white">0</span>
      </button>
    </div>
    <div class="flex items-center gap-2 mb-4">
      <div class="relative flex-1 max-w-md">
        <i data-lucide="search" class="w-4 h-4 text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2"></i>
        <input id="storePadreSearch" type="text" placeholder="Buscar uniformes, útiles..." value="${_esc(_padre.search)}"
          oninput="StoreModule._padreSearch(this.value)"
          class="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 placeholder:text-slate-300 outline-none focus:ring-2 focus:ring-lime-400 focus:border-transparent transition-all">
      </div>
    </div>
    <div id="store-padre-cats" class="flex gap-2 overflow-x-auto pb-2 mb-4"></div>
    <div id="store-my-orders" class="mb-5"></div>
    <div id="store-catalog-wrap"></div>`;
  if(window.lucide)lucide.createIcons();
  await Promise.all([_loadCatalogPadre(),_loadMyOrders()]);
}

function _padreCatsBar(){
  const el=document.getElementById('store-padre-cats'); if(!el)return;
  const cats=[...new Map(_catalog.filter(p=>p.category).map(p=>[p.category,{name:p.category,icon:p.category_icon||'📦'}])).values()];
  const chip=(val,icon,label)=>`
    <button onclick="StoreModule._padreCat('${_esc(val)}')"
      class="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider border transition-all ${_padre.cat===val?'bg-lime-500 border-lime-500 text-white shadow-sm':'bg-white border-slate-200 text-slate-500 hover:border-lime-300 hover:text-lime-600'}">
      <span>${icon}</span>${_esc(label)}
    </button>`;
  el.innerHTML=chip('__all','🛒','Todos')+cats.map(c=>chip(c.name,c.icon,c.name)).join('');
}

export function _padreSearch(v){ _padre.search=v; _renderCatalogPadre(); }
export function _padreCat(v){ _padre.cat=v; _padreCatsBar(); _renderCatalogPadre(); }

async function _loadCatalogPadre(){
  const w=document.getElementById('store-catalog-wrap'); if(!w)return;
  w.innerHTML=`<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">${
    Array(4).fill(`<div class="bg-white rounded-3xl border border-slate-100 overflow-hidden animate-pulse"><div class="h-44 bg-slate-100"></div><div class="p-3 space-y-2"><div class="h-3 bg-slate-100 rounded w-3/4"></div><div class="h-3 bg-slate-100 rounded w-1/2"></div><div class="h-7 bg-slate-100 rounded-xl w-full"></div></div></div>`).join('')
  }</div>`;
  try{
    const {data,error}=await supabase.rpc('get_store_catalog');
    if(error)throw error;
    _catalog=data||[];
    _padreCatsBar();
    _renderCatalogPadre();
  }catch(e){
    w.innerHTML=`<div class="text-center py-16"><div class="text-5xl mb-3">😵</div><p class="font-black text-slate-500">Error al cargar la tienda.</p><p class="text-xs text-slate-400 font-bold mt-1">${_esc(e.message||'')}</p></div>`;
  }
}

function _renderCatalogPadre(){
  const w=document.getElementById('store-catalog-wrap'); if(!w)return;
  let list=_catalog;
  const q=_padre.search.trim().toLowerCase();
  if(q)list=list.filter(p=>`${p.name} ${p.description||''} ${p.category||''}`.toLowerCase().includes(q));
  if(_padre.cat!=='__all')list=list.filter(p=>(p.category||'General')===_padre.cat);

  if(!_catalog.length){
    w.innerHTML=`<div class="text-center py-16 text-slate-400"><div class="text-6xl mb-3">🛒</div><p class="font-black text-slate-500">La tienda aún no tiene artículos.</p><p class="text-xs font-bold mt-1">Vuelve pronto.</p></div>`;return;
  }
  if(!list.length){
    w.innerHTML=`<div class="text-center py-16 text-slate-400"><div class="text-5xl mb-3">🔍</div><p class="font-black text-slate-500">Sin resultados para "${_esc(_padre.search)}"</p></div>`;return;
  }

  const byC={};
  list.forEach(p=>{const c=p.category||'General';if(!byC[c])byC[c]={icon:p.category_icon||'📦',items:[]};byC[c].items.push(p);});

  let html='';
  Object.entries(byC).forEach(([cat,{icon,items}])=>{
    html+=`<div class="mb-8">
      <div class="flex items-center gap-2 mb-3"><span class="text-lg">${icon}</span>
        <span class="text-xs font-black text-slate-500 uppercase tracking-widest">${_esc(cat)}</span>
        <span class="text-[10px] font-black text-slate-300 uppercase tracking-widest">${items.length} art.</span></div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">`;
    items.forEach(p=>{
      const stock=Number(p.stock)||0;
      const out=stock<=0, low=!out&&stock<=5;
      const imgs=p.images?.length?p.images:[];
      const cover=imgs[0]||null;
      const needsSize=!!(p.has_sizes&&p.sizes?.length);
      html+=`
      <div class="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col group">
        <div class="relative h-44 bg-slate-100 overflow-hidden cursor-pointer" onclick="StoreModule._openProductDetail('${p.id}')" id="imgwrap-${p.id}">
          ${cover?`<img id="img-${p.id}" src="${_esc(cover)}" alt="${_esc(p.name)}" data-no-lightbox onerror="this.style.display='none'" class="w-full h-full object-cover group-hover:scale-[1.06] transition-transform duration-500" loading="lazy">`:
            `<div class="w-full h-full flex items-center justify-center text-6xl opacity-80">${p.category_icon||'📦'}</div>`}
          <div class="absolute top-2 left-2 z-20 px-2 py-0.5 rounded-full bg-white/90 backdrop-blur text-[9px] font-black text-slate-600 uppercase tracking-wide shadow-sm">${_esc(p.category||'General')}</div>
          <div class="kk-hover-reveal absolute inset-0 bg-gradient-to-t from-slate-900/45 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-8 pointer-events-none">
            <span class="flex items-center gap-1.5 px-3 py-1.5 bg-white/95 backdrop-blur text-[10px] font-black text-slate-700 uppercase tracking-widest rounded-full shadow-lg">
              <i data-lucide="maximize-2" class="w-3 h-3"></i> Ver detalles
            </span>
          </div>
          ${out?`<div class="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center pointer-events-none"><span class="px-3 py-1.5 bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest rounded-full shadow-lg">Agotado</span></div>`:''}
          ${imgs.length>1?`<div class="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1" id="dots-${p.id}">
            ${imgs.map((_,i)=>`<span onclick="event.stopPropagation();StoreModule._setImg('${p.id}',${i})" class="w-1.5 h-1.5 rounded-full transition-all cursor-pointer ${i===0?'bg-white w-3':'bg-white/50'}" data-dot="${i}"></span>`).join('')}
          </div>`:''}
          ${imgs.length>1?`<span class="absolute top-2 right-2 z-20 bg-black/40 backdrop-blur text-white text-[8px] font-black px-1.5 py-0.5 rounded-full pointer-events-none">${imgs.length} 📷</span>`:''}
        </div>
        <div class="p-3 flex flex-col flex-1">
          <p class="text-sm font-black text-slate-800 leading-tight">${_esc(p.name)}</p>
          ${p.description?`<p class="text-[11px] text-slate-400 font-semibold line-clamp-2 mt-0.5 min-h-[28px]">${_esc(p.description)}</p>`:'<div class="min-h-[28px]"></div>'}
          <div class="flex items-center justify-between gap-1 flex-wrap mt-1.5">
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full ${out?'bg-rose-400':low?'bg-amber-400':'bg-emerald-400'}"></span>
              <span class="text-[10px] font-black uppercase tracking-wide ${out?'text-rose-500':low?'text-amber-600':'text-emerald-600'}">${out?'Agotado':low?`Últimas ${stock}`:`${stock} disp.`}</span>
            </div>
            ${needsSize?`<span class="text-[9px] font-black text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Por talla</span>`:''}
          </div>
          <div class="mt-auto pt-2.5">
            <div class="flex items-end justify-between mb-2">
              <span class="text-lg font-black text-emerald-600 leading-none">${_currency(p.price)}</span>
              <span class="text-[9px] font-bold text-slate-300 uppercase tracking-wider">/ ${_esc(p.unit||'unidad')}</span>
            </div>
            <button onclick="StoreModule._addToCartPadre('${p.id}')"
              class="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${out?'bg-slate-100 text-slate-400 cursor-not-allowed':needsSize?'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/25':'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/25 hover:shadow-lg'}"
              ${out?'disabled':''}>
              <i data-lucide="${needsSize?'shirt':out?'circle-off':'shopping-cart'}" class="w-3.5 h-3.5"></i> ${out?'Agotado':needsSize?'Elegir talla':'Agregar'}
            </button>
          </div>
        </div>
      </div>`;
    });
    html+=`</div></div>`;
  });
  w.innerHTML=html;
  if(window.lucide)lucide.createIcons();
}

export function _setImg(pid,idx){
  const p=_catalog.find(x=>x.id===pid); if(!p||!p.images?.length)return;
  const img=document.getElementById(`img-${pid}`); if(!img)return;
  const i=((idx%p.images.length)+p.images.length)%p.images.length;
  img.src=p.images[i];
  document.querySelectorAll(`#dots-${pid} [data-dot]`).forEach(d=>{
    const on=Number(d.dataset.dot)===i;
    d.classList.toggle('bg-white',on); d.classList.toggle('w-3',on); d.classList.toggle('bg-white/50',!on); d.classList.toggle('w-1.5',!on);
  });
}

export function _pickSize(pid,label){
  const wrap=document.getElementById(`sizes-${pid}`); if(!wrap)return;
  wrap.querySelectorAll('.szpill').forEach(b=>{
    const on=b.dataset.label===label;
    b.classList.toggle('border-lime-500',on); b.classList.toggle('bg-lime-50',on); b.classList.toggle('text-lime-700',on);
    b.classList.toggle('border-slate-200',!on); b.classList.toggle('text-slate-600',!on);
  });
}

async function _loadMyOrders(){
  const w=document.getElementById('store-my-orders'); if(!w)return;
  try{
    const{data}=await supabase.rpc('get_my_store_orders');
    const orders=(data||[]).filter(o=>o.status!=='delivered'&&o.status!=='cancelled').slice(0,3);
    if(!orders.length){w.innerHTML='';return;}
    w.innerHTML=`
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div class="px-4 py-3 border-b border-slate-50 flex items-center gap-2 bg-teal-50">
          <i data-lucide="package" class="w-4 h-4 text-teal-500"></i>
          <p class="text-xs font-black text-slate-500 uppercase tracking-widest">Mis Pedidos Activos</p>
        </div>
        <div class="divide-y divide-slate-50">${orders.map(o=>{
          const st=STATUS[o.status]||STATUS.pending;
          const its=(o.items||[]).map(i=>`${i.quantity}× ${_esc(i.product_name)}${i.size_label?` <span class="text-[9px] bg-slate-100 px-1 py-0.5 rounded font-black text-slate-500">T: ${_esc(i.size_label)}</span>`:''}`).join('<span class="text-slate-300 mx-1">·</span> ');
          return `<div class="px-4 py-3 flex items-center gap-3">
            <span class="w-2 h-2 rounded-full ${st.dot} shrink-0 animate-pulse"></span>
            <div class="flex-1 min-w-0"><p class="text-xs font-black text-slate-700 truncate">${its||'Pedido'}</p><p class="text-[10px] font-bold text-slate-400">${_date(o.created_at)} · ${_time(o.created_at)}</p></div>
            <span class="px-2 py-0.5 rounded-full text-[9px] font-black border ${st.cls}">${st.label}</span>
            <span class="text-xs font-black text-slate-700 shrink-0">${_currency(o.total)}</span>
          </div>`;
        }).join('')}</div>
      </div>`;
    if(window.lucide)lucide.createIcons();
  }catch(_){w.innerHTML='';}
}

export function _addToCartPadre(productId){
  const p=_catalog.find(x=>x.id===productId); if(!p)return;
  if(p.has_sizes&&p.sizes?.length){ _openProductDetail(productId); return; }
  const ok=_cartAdd(p,null,1);
  if(!ok)return;
  _toast(`${p.name} agregado 🛒`,'success');
  _flyToCart(productId);
}

function _flyToCart(productId){
  try{
    const src=document.getElementById(`img-${productId}`)?.src;
    const target=document.querySelector('[data-store-badge]')?.getBoundingClientRect();
    const origin=document.getElementById(`imgwrap-${productId}`)?.getBoundingClientRect();
    if(!src||!target||!origin)return;
    const img=document.createElement('img');
    img.src=src; img.className='kk-fly-img';
    img.style.cssText+=`left:${origin.left+origin.width/2-36}px;top:${origin.top}px;width:72px;height:72px;`;
    document.body.appendChild(img);
    setTimeout(()=>img.remove(),750);
  }catch(_){}
}

// ── Modal de detalle de producto (galería + tallas + cantidad) ───────────────
let _pd={pid:null,idx:0,sz:null,qty:1,_tx:0};

function _pdStock(p,sz){ return sz ? (p.sizes?.find(s=>s.label===sz)?.stock ?? 0) : (Number(p.stock)||0); }
function _pdInCart(pid,sz){
  const k=_ckey(pid,sz);
  return _cart.find(i=>_ckey(i.product_id,i.sz)===k)?.quantity||0;
}
function _pdMaxQty(p){ const s=_pdStock(p,_pd.sz); return Math.max(0,s-_pdInCart(p.id,_pd.sz)); }

export function _openProductDetail(pid){
  const p=_catalog.find(x=>x.id===pid); if(!p)return;
  document.getElementById('storeProductDetailModal')?.remove();
  _pd={pid,idx:0,sz:null,qty:1,_tx:0};
  const m=document.createElement('div');
  m.id='storeProductDetailModal';
  m.className='fixed inset-0 z-[3000] flex items-end sm:items-center justify-center';
  m.style.cssText='background:rgba(15,23,42,0.65);backdrop-filter:blur(6px);';
  m.innerHTML=`
    <div class="bg-white w-full sm:max-w-md rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl flex flex-col kk-modal-in overflow-hidden" style="max-height:calc(100dvh - 24px);">
      <div class="pt-2 pb-1 flex justify-center sm:hidden shrink-0 bg-slate-900/90"><span class="w-10 h-1.5 rounded-full bg-white/40"></span></div>
      <div class="relative shrink-0 bg-slate-900 select-none" id="pdMainImgWrap">
        ${(()=>{const imgs=p.images?.length?p.images:[null];const has=!!imgs[0];
          return has?`<img id="pdMainImg" src="${_esc(imgs[0])}" alt="${_esc(p.name)}" data-no-lightbox draggable="false"
              onclick="StoreModule._pdZoom()" onerror="this.style.display='none'"
              class="w-full h-64 sm:h-72 object-cover cursor-zoom-in">`
            :`<div id="pdNoImg" class="w-full h-64 sm:h-72 flex items-center justify-center text-7xl opacity-80">${p.category_icon||'📦'}</div>`;})()}
        <button onclick="document.getElementById('storeProductDetailModal').remove()"
          class="absolute top-3 right-3 w-9 h-9 bg-black/45 hover:bg-black/65 backdrop-blur text-white rounded-full flex items-center justify-center transition-all z-10"><i data-lucide="x" class="w-4 h-4"></i></button>
        <div class="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-white/92 backdrop-blur text-[9px] font-black text-slate-600 uppercase tracking-widest shadow">${_esc(p.category||'General')}</div>
        ${(p.images?.length||0)>1?`
        <button onclick="event.stopPropagation();StoreModule._pdNav(-1)" class="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-black/35 hover:bg-black/60 backdrop-blur text-white rounded-full items-center justify-center transition-all hidden sm:flex"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
        <button onclick="event.stopPropagation();StoreModule._pdNav(1)" class="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-black/35 hover:bg-black/60 backdrop-blur text-white rounded-full items-center justify-center transition-all hidden sm:flex"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
        <span class="absolute bottom-2.5 right-2.5 px-2 py-0.5 bg-black/50 backdrop-blur text-white text-[10px] font-black rounded-full" id="pdCounter">1 / ${p.images.length}</span>
        <div class="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1.5" id="pdDots">
          ${p.images.map((_,i)=>`<span data-pddot="${i}" onclick="StoreModule._pdSetImg(${i})" class="w-1.5 h-1.5 rounded-full transition-all cursor-pointer ${i===0?'bg-white w-4':'bg-white/45'}"></span>`).join('')}
        </div>`:''}
        ${imgs[0]?`<span class="absolute bottom-2.5 left-2.5 flex items-center gap-1 px-2 py-1 bg-black/45 backdrop-blur text-white text-[9px] font-black uppercase tracking-wider rounded-full pointer-events-none">
          <i data-lucide="zoom-in" class="w-3 h-3"></i> Toca para ampliar
        </span>`:''}
      </div>
      ${(p.images?.length||0)>1?`<div class="flex gap-1.5 px-4 pt-2.5 shrink-0 overflow-x-auto" id="pdThumbs">
        ${p.images.map((u,i)=>`<img src="${_esc(u)}" data-no-lightbox onclick="StoreModule._pdSetImg(${i})" onerror="this.style.display='none'" loading="lazy"
          class="pdthumb w-12 h-12 rounded-xl object-cover border-2 shrink-0 cursor-pointer transition-all ${i===0?'border-lime-500 ring-1 ring-lime-300':'border-slate-100 opacity-70 hover:opacity-100'}">`).join('')}
      </div>`:''}
      <div class="overflow-y-auto flex-1 px-5 pt-3 pb-4" id="pdTouchArea">
        <div class="flex items-start justify-between gap-3">
          <h3 class="text-lg font-black text-slate-800 leading-tight">${_esc(p.name)}</h3>
          <div class="text-right shrink-0">
            <p class="text-xl font-black text-emerald-600 leading-none" id="pdUnitPrice">${_currency(p.price)}</p>
            <p class="text-[9px] font-bold text-slate-300 uppercase tracking-wider mt-0.5">por ${_esc(p.unit||'unidad')}</p>
          </div>
        </div>
        ${p.description?`<p class="text-xs text-slate-500 font-semibold leading-relaxed mt-2 whitespace-pre-line">${_esc(p.description)}</p>`:''}
        <div id="pdStockRow" class="mt-2.5"></div>
        <div id="pdSizesWrap" class="mt-3"></div>
        <div id="pdQtyWrap" class="mt-4"></div>
      </div>
      <div class="shrink-0 border-t border-slate-100 bg-white/95 backdrop-blur px-5 py-3.5" id="pdActionBar"></div>
    </div>`;
  m.onclick=(e)=>{if(e.target===m)m.remove();};
  document.body.appendChild(m);
  // Swipe en la galería
  const touch=document.getElementById('pdMainImgWrap');
  if(touch&&p.images?.length>1){
    touch.addEventListener('touchstart',e=>{_pd._tx=e.touches[0].clientX;},{passive:true});
    touch.addEventListener('touchend',e=>{
      const dx=(e.changedTouches[0]?.clientX||0)-_pd._tx;
      if(Math.abs(dx)>42)_pdNav(dx<0?1:-1);
    },{passive:true});
  }
  _pdRenderBody();
  if(window.lucide)lucide.createIcons();
}

function _pdRenderBody(){
  const p=_catalog.find(x=>x.id===_pd.pid); if(!p)return;
  const maxQ=_pdMaxQty(p);
  const totalStock=Number(p.stock)||0;
  const out=totalStock<=0;

  const stockRow=document.getElementById('pdStockRow');
  if(stockRow){
    stockRow.innerHTML= out
      ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 border border-rose-200 text-[10px] font-black uppercase tracking-widest text-rose-600"><i data-lucide="circle-off" class="w-3 h-3"></i> Agotado temporalmente</span>`
      : _pd.sz
        ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-black uppercase tracking-widest text-emerald-600"><i data-lucide="check-circle-2" class="w-3 h-3"></i> Talla ${_esc(_pd.sz)}: ${_pdStock(p,_pd.sz)} disponibles</span>`
        : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-black uppercase tracking-widest text-emerald-600"><i data-lucide="check-circle-2" class="w-3 h-3"></i> ${totalStock} disponibles</span>`;
  }

  const sizesWrap=document.getElementById('pdSizesWrap');
  if(sizesWrap){
    if(p.has_sizes&&p.sizes?.length){
      sizesWrap.innerHTML=`
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><i data-lucide="ruler" class="w-3.5 h-3.5"></i> Selecciona la talla</p>
        <div class="flex flex-wrap gap-1.5" id="pdSizes">
          ${p.sizes.map(s=>{
            const dis=s.stock<=0, on=_pd.sz===s.label;
            return `<button onclick="StoreModule._pdPickSize('${_esc(s.label)}')" ${dis?'disabled':''}
              class="px-3 py-1.5 rounded-xl text-[11px] font-black border-2 transition-all active:scale-95
              ${dis?'border-slate-100 text-slate-300 line-through cursor-not-allowed bg-slate-50'
                :on?'border-lime-500 bg-lime-50 text-lime-700 shadow-sm'
                :'border-slate-200 text-slate-600 hover:border-lime-400 hover:text-lime-600 bg-white'}">
              ${_esc(s.label)}
              <span class="block text-[8px] font-bold uppercase tracking-wide ${dis?'text-slate-300':on?'text-lime-600':'text-slate-400'}">${dis?'agotada':`${s.stock} disp.`}</span>
            </button>`;}).join('')}
        </div>`;
    } else sizesWrap.innerHTML='';
  }

  const qtyWrap=document.getElementById('pdQtyWrap');
  if(qtyWrap&&!out){
    qtyWrap.innerHTML=`
      <div class="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-2xl p-2">
        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Cantidad</span>
        <div class="flex items-center gap-2">
          <button onclick="StoreModule._pdQty(-1)" class="w-9 h-9 rounded-xl bg-white border border-slate-200 font-black text-lg flex items-center justify-center shadow-sm transition-all active:scale-90 ${(_pd.qty<=1)?'opacity-40':'hover:border-rose-300 hover:text-rose-500'}">−</button>
          <span class="w-9 text-center text-base font-black text-slate-800">${_pd.qty}</span>
          <button onclick="StoreModule._pdQty(1)" class="w-9 h-9 rounded-xl bg-white border border-slate-200 font-black text-lg flex items-center justify-center shadow-sm transition-all active:scale-90 ${(_pd.qty>=maxQ)?'opacity-40':'hover:border-emerald-300 hover:text-emerald-600'}">+</button>
        </div>
      </div>
      ${maxQ<=0?`<p class="text-[11px] font-bold text-amber-600 mt-1.5 flex items-center gap-1"><i data-lucide="info" class="w-3.5 h-3.5"></i> Ya tienes todo el stock disponible en tu pedido</p>`:''}`;
  } else if(qtyWrap) qtyWrap.innerHTML='';

  const bar=document.getElementById('pdActionBar');
  if(bar){
    const needSize=p.has_sizes&&p.sizes?.length&&!_pd.sz;
    const lineTotal=Number(p.price)*_pd.qty;
    bar.innerHTML= out
      ? `<button disabled class="w-full py-3.5 bg-slate-100 text-slate-400 rounded-2xl text-xs font-black uppercase tracking-widest cursor-not-allowed">Producto agotado</button>`
      : `<div class="flex items-center gap-3">
          <div class="min-w-0">
            <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Total</p>
            <p class="text-lg font-black text-slate-800 leading-tight truncate" id="pdTotal">${_currency(lineTotal)}</p>
          </div>
          <button onclick="StoreModule._pdAddToCart()" id="pdAddBtn"
            class="flex-1 py-3.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2
            ${needSize||maxQ<=0?'bg-slate-200 text-slate-400 cursor-not-allowed':'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/30'}"
            ${needSize||maxQ<=0?'disabled':''}>
            <i data-lucide="${needSize?'shirt':'shopping-cart'}" class="w-4 h-4"></i> ${needSize?'Elige una talla':'Agregar al pedido'}
          </button>
        </div>`;
  }
  if(window.lucide)lucide.createIcons();
}

export function _pdSetImg(i){
  const p=_catalog.find(x=>x.id===_pd.pid); if(!p?.images?.length)return;
  _pd.idx=((i%p.images.length)+p.images.length)%p.images.length;
  const img=document.getElementById('pdMainImg');
  if(img)img.src=p.images[_pd.idx];
  const c=document.getElementById('pdCounter'); if(c)c.textContent=`${_pd.idx+1} / ${p.images.length}`;
  document.querySelectorAll('#pdDots [data-pddot]').forEach(d=>{
    const on=Number(d.dataset.pddot)===_pd.idx;
    d.classList.toggle('bg-white',on); d.classList.toggle('w-4',on); d.classList.toggle('bg-white/45',!on); d.classList.toggle('w-1.5',!on);
  });
  document.querySelectorAll('#pdThumbs .pdthumb').forEach((t,ti)=>{
    const on=ti===_pd.idx;
    t.classList.toggle('border-lime-500',on); t.classList.toggle('ring-1',on); t.classList.toggle('ring-lime-300',on);
    t.classList.toggle('border-slate-100',!on); t.classList.toggle('opacity-70',!on);
  });
}
export function _pdNav(dir){ _pdSetImg(_pd.idx+dir); }
export function _pdZoom(){
  const p=_catalog.find(x=>x.id===_pd.pid); if(!p)return;
  const url=p.images?.[_pd.idx]; if(!url)return;
  window.openLightbox(url,'image');
}
export function _pdPickSize(label){
  const p=_catalog.find(x=>x.id===_pd.pid); if(!p)return;
  _pd.sz=(_pd.sz===label)?null:label;
  _pd.qty=Math.max(1,Math.min(_pd.qty,Math.max(1,_pdMaxQty(p))));
  _pdRenderBody();
}
export function _pdQty(d){
  const p=_catalog.find(x=>x.id===_pd.pid); if(!p)return;
  const maxQ=_pdMaxQty(p);
  _pd.qty=Math.max(1,Math.min(maxQ,_pd.qty+d));
  _pdRenderBody();
}
export function _pdAddToCart(){
  const p=_catalog.find(x=>x.id===_pd.pid); if(!p)return;
  if(p.has_sizes&&p.sizes?.length&&!_pd.sz){_toast('Selecciona una talla primero','warning');return;}
  if(!_cartAdd(p,_pd.sz,_pd.qty))return;
  document.getElementById('storeProductDetailModal')?.remove();
  _toast(`${_pd.qty} × ${p.name}${_pd.sz?` (talla ${_pd.sz})`:''} agregado 🛒`,'success');
}

function _cartThumb(productId,fallbackIcon='📦'){
  const p=_catalog.find(x=>x.id===productId);
  const url=p?.images?.[0]||p?.image_url||null;
  return url
    ? `<img src="${_esc(url)}" data-no-lightbox onerror="this.style.display='none'" class="w-12 h-12 rounded-xl object-cover border border-slate-100 shrink-0 bg-slate-50" loading="lazy">`
    : `<div class="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-xl shrink-0">${fallbackIcon}</div>`;
}

function _cartRows(){
  if(!_cart.length)return`<div class="text-center py-12 px-4 text-slate-400">
    <div class="w-20 h-20 mx-auto mb-3 rounded-full bg-slate-50 flex items-center justify-center"><span class="text-4xl">🛒</span></div>
    <p class="font-black text-slate-500">Tu pedido está vacío</p>
    <p class="text-xs font-bold mt-1">Explora la tienda y agrega artículos</p>
  </div>`;
  return _cart.map(i=>{
    const k=_ckey(i.product_id,i.sz);
    const p=_catalog.find(x=>x.id===i.product_id);
    return`<div class="flex items-center gap-3 py-3 border-b border-slate-50 last:border-0">
      ${_cartThumb(i.product_id,p?.category_icon)}
      <div class="flex-1 min-w-0">
        <p class="text-sm font-black text-slate-700 truncate leading-tight">${_esc(p?.name||i.name.split(' (Talla')[0])}</p>
        ${i.sz?`<span class="inline-block mt-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-500 rounded-md text-[9px] font-black uppercase tracking-wide">Talla ${_esc(i.sz)}</span>`:''}
        <p class="text-[10px] font-bold text-slate-400 mt-0.5">${_currency(i.price)} c/u</p>
      </div>
      <div class="flex flex-col items-end gap-1 shrink-0">
        <div class="flex items-center gap-1.5">
          <button onclick="StoreModule._chQty('${k}',-1)" class="w-8 h-8 rounded-lg bg-slate-100 font-black text-base flex items-center justify-center hover:bg-rose-100 hover:text-rose-600 transition-all active:scale-90">−</button>
          <span class="w-6 text-center text-sm font-black">${i.quantity}</span>
          <button onclick="StoreModule._chQty('${k}',1)" class="w-8 h-8 rounded-lg bg-slate-100 font-black text-base flex items-center justify-center hover:bg-emerald-100 hover:text-emerald-600 transition-all active:scale-90 ${i.quantity>=i.stock?'opacity-40':''}">+</button>
        </div>
        <span class="text-sm font-black text-emerald-600">${_currency(i.price*i.quantity)}</span>
      </div>
    </div>`;
  }).join('');
}

export function openCart(){
  document.getElementById('storeCartModal')?.remove();
  const m=document.createElement('div');
  m.id='storeCartModal';
  m.className='fixed inset-0 z-[3000] flex items-end sm:items-center justify-center';
  m.style.cssText='background:rgba(15,23,42,0.65);backdrop-filter:blur(6px);';
  m.innerHTML=`
    <div class="bg-white rounded-t-[2rem] sm:rounded-[2rem] w-full sm:max-w-md shadow-2xl flex flex-col kk-modal-in" style="max-height:calc(100dvh - 32px);">
      <div class="pt-2 pb-1 flex justify-center sm:hidden shrink-0"><span class="w-10 h-1.5 rounded-full bg-slate-200"></span></div>
      <div class="px-5 py-4 flex items-center justify-between border-b border-slate-100 shrink-0 bg-emerald-50">
        <h3 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">🛒</span> Tu Pedido
          ${_count()?`<span class="px-2 py-0.5 bg-emerald-600 text-white text-[9px] font-black rounded-full">${_count()} art.</span>`:''}
        </h3>
        <button onclick="document.getElementById('storeCartModal').remove()" class="p-2 bg-white rounded-xl text-slate-500 hover:bg-slate-100 transition-colors shadow-sm"><i data-lucide="x" class="w-4 h-4"></i></button>
      </div>
      <div class="overflow-y-auto flex-1 px-5 py-1" id="cartItemsList">${_cartRows()}</div>
      <div class="px-5 py-4 border-t border-slate-100 bg-slate-50/80 shrink-0 sm:rounded-b-[2rem] space-y-3">
        ${_cart.length?`
        <div class="flex justify-between items-center text-xs font-bold text-slate-400">
          <span>Artículos: <b class="text-slate-600">${_count()}</b></span>
          <div class="flex items-center gap-1"><i data-lucide="info" class="w-3.5 h-3.5"></i> Pagas al confirmar en la escuela</div>
        </div>
        <div class="flex justify-between items-center pt-1 border-t border-dashed border-slate-200">
          <span class="text-xs font-black text-slate-400 uppercase tracking-widest">Total</span>
          <span class="text-2xl font-black text-emerald-600" id="cartTotalDisplay">${_currency(_total())}</span>
        </div>
        <textarea id="storeOrderNotes" rows="2" placeholder="Nota opcional (color, aclaración...)"
          class="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-400 resize-none transition-all placeholder:text-slate-300"></textarea>
        <button onclick="StoreModule.submitOrder()" class="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-sm uppercase tracking-widest shadow-lg shadow-emerald-600/25 transition-all active:scale-95 flex items-center justify-center gap-2">
          <i data-lucide="send" class="w-4 h-4"></i> Enviar Pedido · <span id="cartBtnTotal">${_currency(_total())}</span>
        </button>
        <button onclick="StoreModule._cartClear();document.getElementById('storeCartModal').remove()" class="w-full py-1 text-slate-400 text-xs font-bold uppercase tracking-wider hover:text-rose-500 transition-colors">Vaciar pedido</button>`:
        `<button onclick="document.getElementById('storeCartModal').remove()" class="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-black text-sm uppercase tracking-widest transition-all active:scale-95">Explorar la tienda</button>`}
      </div>
    </div>`;
  m.onclick=(e)=>{if(e.target===m)m.remove();};
  document.body.appendChild(m);
  if(window.lucide)lucide.createIcons();
}
export function _cartClear(){ _cart=[]; _badge(); }
export async function submitOrder(){
  if(!_cart.length)return;
  const notes=document.getElementById('storeOrderNotes')?.value?.trim()||null;
  const studentId=window.AppState?.get('currentStudent')?.id||null;
  const btn=document.querySelector('#storeCartModal button[onclick*="submitOrder"]');
  if(btn){btn.disabled=true;btn.textContent='Enviando...';}
  try{
    const{error}=await supabase.rpc('create_store_order',{
      p_student_id:studentId,
      p_items:_cart.map(i=>({product_id:i.product_id,quantity:i.quantity,size_label:i.sz||null})),
      p_notes:notes
    });
    if(error)throw error;
    _cart=[];_badge();
    document.getElementById('storeCartModal')?.remove();
    if(window.confetti)confetti({particleCount:100,spread:65,origin:{y:0.6},colors:['#10b981','#84cc16','#f59e0b']});
    _toast('¡Pedido enviado! La escuela lo confirmará pronto 🎉');
    await _loadMyOrders();
    await _loadCatalogPadre();
  }catch(e){
    _toast('Error: '+(e.message||''),'error');
    if(btn){btn.disabled=false;btn.innerHTML='<i data-lucide="send" class="w-4 h-4"></i> Enviar Pedido';if(window.lucide)lucide.createIcons();}
  }
}
export function _chQty(cartKey,delta){
  const item=_cart.find(i=>_ckey(i.product_id,i.sz)===cartKey);
  if(!item)return;
  item.quantity=Math.max(0,Math.min(item.stock,item.quantity+delta));
  if(item.quantity===0)_cartRm(cartKey);
  const list=document.getElementById('cartItemsList');
  const tot=document.getElementById('cartTotalDisplay');
  const btnTot=document.getElementById('cartBtnTotal');
  if(list)list.innerHTML=_cartRows();
  if(tot)tot.textContent=_currency(_total());
  if(btnTot)btnTot.textContent=_currency(_total());
  _badge();
  const modal=document.querySelector('#storeCartModal h3 span.px-2');
  if(modal&&_count())modal.textContent=`${_count()} art.`;
  if(window.lucide)lucide.createIcons();
}

// ═════════════════════════════════════════════════════════════════════════════
// PANEL STAFF (Directora / Asistente) — Pedidos · Productos · Inventario
// ═════════════════════════════════════════════════════════════════════════════
const _st = {
  tab:'pedidos', ready:false,
  products:[], sizes:{}, cats:[], orders:[], movements:[],
  search:'', lowOnly:false, ordFilter:null, ordSearch:'', invType:'all',
  pm:null,
};

export async function initStoreAsistente(containerId){
  const w=document.getElementById(containerId); if(!w)return;
  if(!_st.ready){
    w.innerHTML=`<div class="space-y-4">${Array(3).fill('<div class="bg-white rounded-3xl border border-slate-100 p-6 animate-pulse"><div class="h-4 bg-slate-100 rounded w-1/3 mb-3"></div><div class="h-24 bg-slate-50 rounded-2xl"></div></div>').join('')}</div>`;
    await _staffLoadData();
    _st.ready=true;
  }
  _staffShell(w);
}

export function initStoreDirectora(containerId){ return initStoreAsistente(containerId); }

async function _staffLoadData(){
  try{
    const [prodQ,sizesQ,catsQ]=await Promise.all([
      supabase.from('store_products').select('id,name,description,price,images,image_url,stock,unit,is_active,has_sizes,category_id,created_at,store_categories(name,icon)').order('created_at',{ascending:false}),
      supabase.from('store_product_sizes').select('id,product_id,size_label,stock').order('size_label'),
      supabase.from('store_categories').select('*').order('sort_order'),
    ]);
    if(prodQ.error)throw prodQ.error;
    _st.products=prodQ.data||[];
    _st.sizes={};
    (sizesQ.data||[]).forEach(s=>{(_st.sizes[s.product_id]??=[]).push(s);});
    _st.cats=catsQ.data||[];
    await Promise.all([_staffLoadOrders(),_staffLoadMovements()]);
  }catch(e){ _toast('Error cargando tienda: '+(e.message||''),'error'); }
}
async function _staffLoadOrders(){
  const {data,error}=await supabase.rpc('get_all_store_orders');
  if(!error)_st.orders=data||[];
}
async function _staffLoadMovements(){
  const {data,error}=await supabase.rpc('get_store_inventory',{p_limit:150});
  if(!error)_st.movements=data||[];
}

function _staffBadgeAlerts(){
  const n=_st.products.filter(p=>p.is_active&&(Number(p.stock)||0)<=5).length;
  document.querySelectorAll('#badge-tienda,[data-store-alerts-badge]').forEach(el=>{
    el.textContent=n; el.classList.toggle('hidden',n===0);
  });
}

// ── Helpers visuales staff ───────────────────────────────────────────────────
const _statusChip=(st,extra='')=>`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider border ${st.cls} ${extra}"><i data-lucide="${st.icon}" class="w-3 h-3"></i>${st.label}</span>`;

const _stockBar=(stock)=>{
  const s=Number(stock)||0;
  const pct=Math.min(100,Math.max(5,(s/20)*100));
  const bar=s<=0?'bg-rose-500':s<=5?'bg-amber-400':'bg-emerald-500';
  const txt=s<=0?'text-rose-600 font-black':s<=5?'text-amber-600 font-black':'text-slate-700 font-bold';
  return `<div class="flex items-center gap-2">
    <div class="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden shrink-0"><div class="h-full ${bar} rounded-full transition-all" style="width:${pct}%"></div></div>
    <span class="text-xs ${txt} tabular-nums">${s}</span>
  </div>`;
};

const _prodThumbStaff=(p,size='w-10 h-10 rounded-xl text-base',imgCls='w-10 h-10')=>{
  const imgs=p.images?.length?p.images:(p.image_url?[p.image_url]:[]);
  return `<div class="${size} bg-slate-100 relative overflow-hidden shrink-0 flex items-center justify-center">
    ${imgs[0]?`<img src="${_esc(imgs[0])}" data-no-lightbox onerror="this.style.display='none'" onclick="StoreModule._prodZoom('${p.id}')" class="${imgCls} object-cover absolute inset-0 cursor-zoom-in hover:scale-110 transition-transform" loading="lazy">`
      :`<span>${p.store_categories?.icon||'📦'}</span>`}
  </div>`;
};

export function _prodZoom(pid){
  const p=_st.products.find(x=>x.id===pid); if(!p)return;
  const imgs=p.images?.length?p.images:(p.image_url?[p.image_url]:[]);
  if(imgs[0])window.openLightbox(imgs[0],'image');
}

export function _ordSearch(v){ _st.ordSearch=v; _renderOrders(); if(window.lucide)lucide.createIcons(); }

function _staffShell(w){
  const pendingN=_st.orders.filter(o=>o.status==='pending').length;
  const tabs=[
    {id:'pedidos',   icon:'clipboard-list', label:'Pedidos',    badge:pendingN},
    {id:'productos', icon:'package',        label:'Productos',  badge:_st.products.length},
    {id:'inventario',icon:'warehouse',      label:'Inventario', badge:_st.products.filter(p=>p.is_active&&(p.stock||0)<=5).length},
  ];
  w.innerHTML=`
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
      <div><h2 class="text-2xl font-black text-slate-800 flex items-center gap-2"><span class="w-10 h-10 bg-lime-100 rounded-2xl flex items-center justify-center text-xl">🛍️</span> Tienda Escolar</h2>
        <p class="text-sm text-slate-400 mt-1 font-semibold">Gestiona pedidos, catálogo e inventario</p></div>
      <button onclick="StoreModule._staffRefresh()" class="self-start flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:border-lime-300 hover:text-lime-600 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-wider transition-all active:scale-95">
        <i data-lucide="refresh-cw" class="w-4 h-4"></i> Actualizar
      </button>
    </div>
    <div class="flex gap-2 mb-5 bg-white p-1.5 rounded-2xl border border-slate-100 shadow-sm w-fit max-w-full overflow-x-auto">
      ${tabs.map(t=>`
        <button onclick="StoreModule._stTab('${t.id}')" data-staff-tab="${t.id}"
          class="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider whitespace-nowrap transition-all
          ${_st.tab===t.id?'bg-emerald-600 text-white shadow-md':'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}">
          <i data-lucide="${t.icon}" class="w-4 h-4"></i> ${t.label}
          <span class="min-w-[18px] h-[18px] px-1 rounded-full text-[9px] flex items-center justify-center ${_st.tab===t.id?'bg-white/25 text-white':'bg-slate-100 text-slate-400'}">${t.badge}</span>
        </button>`).join('')}
    </div>
    <div id="staff-store-body"></div>`;
  if(window.lucide)lucide.createIcons();
  _renderStaffTab();
}

export async function _staffRefresh(){
  _st.ready=false;
  const w=document.getElementById('staff-store-body');
  if(w)w.innerHTML='<div class="py-10 text-center"><span class="inline-block w-8 h-8 border-4 border-lime-400 border-t-transparent rounded-full animate-spin"></span></div>';
  await initStoreAsistente(document.getElementById('store-directora-container')?.id||document.getElementById('store-asistente-container')?.id||'store-asistente-container');
}

export function _stTab(tab){
  _st.tab=tab;
  document.querySelectorAll('[data-staff-tab]').forEach(b=>{
    const on=b.dataset.staffTab===tab;
    b.className=`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider whitespace-nowrap transition-all ${on?'bg-emerald-600 text-white shadow-md':'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`;
  });
  _renderStaffTab();
}

function _renderStaffTab(){
  const body=document.getElementById('staff-store-body'); if(!body)return;
  if(_st.tab==='pedidos')_renderOrders();
  else if(_st.tab==='productos')_renderProducts();
  else _renderInventory();
  if(window.lucide)lucide.createIcons();
}

// ── TAB PEDIDOS ──────────────────────────────────────────────────────────────
export function _ordFilter(f){ _st.ordFilter=(f==='all')?null:f; _renderOrders(); if(window.lucide)lucide.createIcons(); }

function _renderOrders(){
  const body=document.getElementById('staff-store-body'); if(!body)return;
  const counts={all:_st.orders.length};
  Object.keys(STATUS).forEach(k=>counts[k]=_st.orders.filter(o=>o.status===k).length);
  const chips=[['all','Todas'],...Object.entries(STATUS).map(([k,v])=>[k,v.label])];
  let list=_st.ordFilter?_st.orders.filter(o=>o.status===_st.ordFilter):_st.orders;
  const q=_st.ordSearch.trim().toLowerCase();
  if(q)list=list.filter(o=>`${o.parent_name||''} ${o.student_name||''} ${(o.items||[]).map(i=>i.product_name).join(' ')} #${o.id}`.toLowerCase().includes(q));
  const pendTotal=list.filter(o=>o.status==='pending').reduce((t,o)=>t+Number(o.total||0),0);

  body.innerHTML=`
    <div class="flex flex-col lg:flex-row items-stretch lg:items-center gap-2 mb-4">
      <div class="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
        ${chips.map(([k,l])=>`
          <button onclick="StoreModule._ordFilter('${k}')"
            class="shrink-0 px-3.5 py-2 rounded-full text-[11px] font-black uppercase tracking-wider border transition-all
            ${(_st.ordFilter??'all')===(k==='all'?'all':k)?'bg-slate-800 border-slate-800 text-white shadow-sm':'bg-white border-slate-200 text-slate-500 hover:border-slate-400'}">
            ${l} <span class="opacity-60 tabular-nums">${counts[k]??0}</span>
          </button>`).join('')}
      </div>
      <div class="relative lg:ml-auto lg:w-64 shrink-0">
        <i data-lucide="search" class="w-4 h-4 text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2"></i>
        <input type="text" placeholder="Buscar cliente, producto..." value="${_esc(_st.ordSearch)}" oninput="StoreModule._ordSearch(this.value)"
          class="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 placeholder:text-slate-300 outline-none focus:ring-2 focus:ring-lime-400 transition-all">
      </div>
    </div>
    ${list.length&&pendTotal?`<p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Por cobrar en estado pendiente: <span class="text-amber-600">${_currency(pendTotal)}</span></p>`:''}
    ${!list.length?`<div class="text-center py-16 text-slate-400 bg-white rounded-3xl border border-slate-100"><div class="text-6xl mb-3">📭</div><p class="font-black text-slate-500">${_st.ordSearch?'Sin resultados para tu búsqueda':'No hay pedidos aquí.'}</p></div>`:`

    <div class="hidden lg:block bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
      <table class="w-full text-left">
        <thead><tr class="bg-slate-50/80 border-b border-slate-100">
          <th class="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Pedido</th>
          <th class="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Cliente</th>
          <th class="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Artículos</th>
          <th class="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Total</th>
          <th class="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Estado</th>
          <th class="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Acciones</th>
        </tr></thead>
        <tbody class="divide-y divide-slate-50">${list.map(o=>{
          const st=STATUS[o.status]||STATUS.pending;
          const its=o.items||[];
          const itemsShort=its.slice(0,2).map(i=>`${i.quantity}× ${_esc(i.product_name)}${i.size_label?` <span class="text-[8px] bg-indigo-50 text-indigo-500 px-1 rounded font-black">T:${_esc(i.size_label)}</span>`:''}`).join('<span class="text-slate-300 mx-0.5">·</span>');
          return `
          <tr class="hover:bg-lime-50/40 transition-colors align-top">
            <td class="px-4 py-3"><p class="text-[10px] font-black text-slate-500">#${o.id.slice(0,8)}</p><p class="text-[10px] font-bold text-slate-300 whitespace-nowrap">${_date(o.created_at)}</p></td>
            <td class="px-4 py-3 min-w-[140px]"><p class="text-xs font-black text-slate-700 leading-tight">${_esc(o.parent_name||'—')}</p>${o.student_name?`<p class="text-[10px] font-bold text-slate-400 mt-0.5">Estudiante: ${_esc(o.student_name)}</p>`:''}
              ${o.notes?`<p class="text-[10px] text-slate-400 italic mt-1 line-clamp-1" title="${_esc(o.notes)}">📝 ${_esc(o.notes)}</p>`:''}</td>
            <td class="px-4 py-3 text-xs font-bold text-slate-600 max-w-[240px]">${itemsShort}${its.length>2?` <span class="text-[10px] font-black text-slate-400">+${its.length-2} más</span>`:''}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap"><span class="text-sm font-black text-emerald-600">${_currency(o.total)}</span></td>
            <td class="px-4 py-3">${_statusChip(st)}</td>
            <td class="px-4 py-3"><div class="flex gap-1.5 justify-end">
              ${o.status==='pending'?`<button onclick="StoreModule._ordStatus('${o.id}','confirmed')" title="Confirmar (descuenta stock)" class="py-2 px-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm transition-all active:scale-95 flex items-center gap-1"><i data-lucide="check-check" class="w-3.5 h-3.5"></i> Confirmar</button>`:''}
              ${o.status==='confirmed'?`<button onclick="StoreModule._ordStatus('${o.id}','ready')" title="Marcar lista para entregar" class="py-2 px-3 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm transition-all active:scale-95 flex items-center gap-1"><i data-lucide="package-check" class="w-3.5 h-3.5"></i> Lista</button>`:''}
              ${o.status==='ready'?`<button onclick="StoreModule._ordStatus('${o.id}','delivered')" title="Marcar entregado" class="py-2 px-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm transition-all active:scale-95 flex items-center gap-1"><i data-lucide="handshake" class="w-3.5 h-3.5"></i> Entregar</button>`:''}
              ${!['delivered','cancelled'].includes(o.status)?`<button onclick="StoreModule._ordStatus('${o.id}','cancelled')" title="Cancelar pedido" class="py-2 px-2.5 bg-white border border-rose-200 text-rose-500 hover:bg-rose-50 rounded-lg text-[11px] font-black transition-all active:scale-95">✕</button>`:''}
            </div></td>
          </tr>`;}).join('')}
        </tbody>
      </table>
    </div>

    <div class="lg:hidden grid gap-3 sm:grid-cols-2">${list.map(o=>{
      const st=STATUS[o.status]||STATUS.pending;
      const its=(o.items||[]);
      return `
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col">
        <div class="px-4 py-3 flex items-center justify-between border-b border-slate-50 bg-slate-50/50">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full ${st.dot} shrink-0"></span>
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 truncate">#${o.id.slice(0,8)} · ${_date(o.created_at)}</p>
          </div>
          ${_statusChip(st)}
        </div>
        <div class="px-4 py-3 space-y-1.5 flex-1">
          <div class="flex items-center gap-2 text-xs">
            <i data-lucide="user" class="w-3.5 h-3.5 text-slate-300"></i><span class="font-black text-slate-700 truncate">${_esc(o.parent_name||'—')}</span>
            ${o.student_name?`<span class="text-slate-300">·</span><span class="font-bold text-slate-400 truncate">${_esc(o.student_name)}</span>`:''}
          </div>
          <div class="pt-1 space-y-1">
            ${its.map(i=>`
              <div class="flex items-center justify-between gap-2 text-xs">
                <span class="font-bold text-slate-600 truncate">${i.quantity}× ${_esc(i.product_name)}
                  ${i.size_label?`<span class="ml-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-500 rounded text-[9px] font-black">T: ${_esc(i.size_label)}</span>`:''}
                </span>
                <span class="font-black text-slate-400 shrink-0">${_currency(i.subtotal)}</span>
              </div>`).join('')}
          </div>
          ${o.notes?`<p class="text-[11px] text-slate-400 italic border-t border-dashed border-slate-100 mt-2 pt-2">📝 ${_esc(o.notes)}</p>`:''}
        </div>
        <div class="px-4 py-3 border-t border-slate-50 bg-slate-50/30">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] font-black text-slate-300 uppercase tracking-widest">${_time(o.created_at)}</span>
            <span class="text-base font-black text-emerald-600">${_currency(o.total)}</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            ${o.status==='pending'?`
              <button onclick="StoreModule._ordStatus('${o.id}','confirmed')" class="flex-1 min-w-[110px] py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-wider shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1"><i data-lucide="check-check" class="w-3.5 h-3.5"></i> Confirmar</button>`:''}
            ${o.status==='confirmed'?`
              <button onclick="StoreModule._ordStatus('${o.id}','ready')" class="flex-1 min-w-[110px] py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-[10px] font-black uppercase tracking-wider shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1"><i data-lucide="package-check" class="w-3.5 h-3.5"></i> Lista</button>`:''}
            ${o.status==='ready'?`
              <button onclick="StoreModule._ordStatus('${o.id}','delivered')" class="flex-1 min-w-[110px] py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-wider shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1"><i data-lucide="handshake" class="w-3.5 h-3.5"></i> Entregado</button>`:''}
            ${!['delivered','cancelled'].includes(o.status)?`
              <button onclick="StoreModule._ordStatus('${o.id}','cancelled')" class="py-2 px-3 bg-white border border-rose-200 text-rose-500 hover:bg-rose-50 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95">✕</button>`:''}
          </div>
        </div>
      </div>`;}).join('')}</div>`}`;
}

export async function _ordStatus(id,status){
  const st=STATUS[status];
  if(status==='cancelled'&&!confirm('¿Cancelar este pedido?'))return;
  if(status==='confirmed'&&!confirm('Confirmar pedido: se descontará el stock del inventario.'))return;
  const patch={status};
  if(status==='confirmed')patch.confirmed_at=new Date().toISOString();
  if(status==='delivered')patch.delivered_at=new Date().toISOString();
  try{
    const{error}=await supabase.from('store_orders').update(patch).eq('id',id);
    if(error)throw error;
    _toast(st?`Pedido marcado como "${st.label}"`:'Actualizado');
    await Promise.all([_staffLoadOrders(),_staffLoadData()]);
    _staffBadgeAlerts();
    const shell=document.getElementById('store-directora-container')||document.getElementById('store-asistente-container');
    if(shell)_staffShell(shell); else _renderStaffTab();
  }catch(e){ _toast('Error: '+(e.message||''),'error'); }
}

// ── TAB PRODUCTOS ────────────────────────────────────────────────────────────
export function _prodSearch(v){ _st.search=v; _renderProducts(); if(window.lucide)lucide.createIcons(); }
export function _prodLowOnly(){ _st.lowOnly=!_st.lowOnly; _renderProducts(); if(window.lucide)lucide.createIcons(); }

function _renderProducts(){
  const body=document.getElementById('staff-store-body'); if(!body)return;
  let list=_st.products;
  const q=_st.search.trim().toLowerCase();
  if(q)list=list.filter(p=>`${p.name} ${p.description||''} ${p.store_categories?.name||''}`.toLowerCase().includes(q));
  if(_st.lowOnly)list=list.filter(p=>(Number(p.stock)||0)<=5);
  const totalValor=list.reduce((t,p)=>t+Number(p.price)*(Number(p.stock)||0),0);

  const rowActions=(p)=>`
    <button onclick="StoreModule._openProductModal('${p.id}')" title="Editar" class="py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[10px] font-black transition-all active:scale-95 flex items-center gap-1"><i data-lucide="pencil" class="w-3 h-3"></i> Editar</button>
    <button onclick="StoreModule._pmToggleActive('${p.id}')" title="${p.is_active?'Desactivar (oculta de la tienda)':'Activar en la tienda'}" class="p-2 ${p.is_active?'bg-amber-50 text-amber-600 hover:bg-amber-100':'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'} rounded-lg text-[10px] font-black transition-all active:scale-95"><i data-lucide="${p.is_active?'eye-off':'eye'}" class="w-3.5 h-3.5"></i></button>
    <button onclick="StoreModule._pmDelete('${p.id}')" title="Eliminar" class="p-2 bg-rose-50 text-rose-500 hover:bg-rose-100 rounded-lg text-[10px] font-black transition-all active:scale-95"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>`;

  const stockChip=(p)=>{
    const stock=Number(p.stock)||0, out=stock<=0, low=!out&&stock<=5;
    return !p.is_active?`<span class="px-1.5 py-0.5 bg-slate-200 rounded text-[9px] font-black text-slate-500 uppercase tracking-wide">Inactivo</span>`:
      out?`<span class="px-1.5 py-0.5 bg-rose-100 rounded text-[9px] font-black text-rose-600 uppercase tracking-wide">Agotado</span>`:
      low?`<span class="px-1.5 py-0.5 bg-amber-100 rounded text-[9px] font-black text-amber-600 uppercase tracking-wide">⚠ Bajo</span>`:
      `<span class="px-1.5 py-0.5 bg-emerald-50 rounded text-[9px] font-black text-emerald-600 uppercase tracking-wide">Activo</span>`;
  };

  body.innerHTML=`
    <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4">
      <div class="relative flex-1">
        <i data-lucide="search" class="w-4 h-4 text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2"></i>
        <input type="text" placeholder="Buscar producto o categoría..." value="${_esc(_st.search)}" oninput="StoreModule._prodSearch(this.value)"
          class="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 placeholder:text-slate-300 outline-none focus:ring-2 focus:ring-lime-400 focus:border-transparent transition-all">
      </div>
      <button onclick="StoreModule._prodLowOnly()"
        class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-wider border transition-all ${_st.lowOnly?'bg-amber-400 border-amber-400 text-white shadow-sm':'bg-white border-slate-200 text-slate-500 hover:border-amber-300'}">
        <i data-lucide="alert-triangle" class="w-4 h-4"></i> Stock bajo
      </button>
      <button onclick="StoreModule._openProductModal()" class="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-md hover:shadow-lg transition-all active:scale-95">
        <i data-lucide="plus" class="w-4 h-4"></i> Nuevo Producto
      </button>
    </div>
    ${list.length?`<p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">${list.length} producto(s) · Valor del listado: <span class="text-emerald-600">${_currency(totalValor)}</span></p>`:''}
    ${!list.length?`
      <div class="text-center py-16 bg-white rounded-3xl border border-slate-100"><div class="text-6xl mb-3">📦</div>
        <p class="font-black text-slate-500">${_st.products.length?'Sin resultados':'Aún no hay productos'}</p>
        <p class="text-xs text-slate-400 font-bold mt-1">${_st.products.length?'Prueba otra búsqueda.':'Presiona "Nuevo Producto" para crear el primero.'}</p></div>`:`

    <div class="hidden lg:block bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
      <table class="w-full text-left">
        <thead><tr class="bg-slate-50/80 border-b border-slate-100">
          <th class="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Producto</th>
          <th class="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Precio</th>
          <th class="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Stock</th>
          <th class="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Tallas</th>
          <th class="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Estado</th>
          <th class="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Acciones</th>
        </tr></thead>
        <tbody class="divide-y divide-slate-50">${list.map(p=>{
          const sizes=_st.sizes[p.id]||[];
          return `
          <tr class="hover:bg-lime-50/40 transition-colors ${p.is_active?'':'opacity-70'}">
            <td class="px-4 py-3 min-w-[220px]">
              <div class="flex items-center gap-3">
                ${_prodThumbStaff(p)}
                <div class="min-w-0">
                  <p class="text-xs font-black text-slate-800 leading-tight truncate max-w-[220px]" title="${_esc(p.description||'')}">${_esc(p.name)}</p>
                  <p class="text-[10px] font-bold text-slate-400 mt-0.5">${p.store_categories?.icon||'📦'} ${_esc(p.store_categories?.name||'General')} · ${_esc(p.unit||'unidad')}</p>
                </div>
              </div>
            </td>
            <td class="px-4 py-3 text-right whitespace-nowrap"><span class="text-sm font-black text-emerald-600">${_currency(p.price)}</span></td>
            <td class="px-4 py-3">${_stockBar(p.stock)}</td>
            <td class="px-4 py-3">${p.has_sizes&&sizes.length
              ?`<div class="flex flex-wrap gap-1 max-w-[180px]">${sizes.map(s=>`<span class="px-1.5 py-0.5 rounded-md text-[9px] font-black ${s.stock<=0?'bg-rose-50 text-rose-400 line-through':'bg-indigo-50 text-indigo-500'}">${_esc(s.size_label)}: ${s.stock}</span>`).join('')}</div>`
              :`<span class="text-[10px] font-bold text-slate-300 uppercase">—</span>`}</td>
            <td class="px-4 py-3">${stockChip(p)}</td>
            <td class="px-4 py-3"><div class="flex gap-1.5 justify-end">${rowActions(p)}</div></td>
          </tr>`;}).join('')}
        </tbody>
      </table>
    </div>

    <div class="lg:hidden grid gap-3 sm:grid-cols-2">${list.map(p=>{
      const sizes=_st.sizes[p.id]||[];
      return `
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-lg transition-all overflow-hidden flex ${p.is_active?'':'opacity-60'}">
        <div class="w-28 shrink-0 bg-slate-100 relative">
          ${(()=>{const imgs=p.images?.length?p.images:(p.image_url?[p.image_url]:[]);
            return imgs[0]?`<img src="${_esc(imgs[0])}" data-no-lightbox onerror="this.style.display='none'" onclick="StoreModule._prodZoom('${p.id}')" class="w-full h-full object-cover absolute inset-0 cursor-zoom-in" loading="lazy">`:`<div class="w-full h-full flex items-center justify-center text-4xl">${p.store_categories?.icon||'📦'}</div>`;})()}
          ${(p.images?.length||0)>1?`<span class="absolute bottom-1 right-1 bg-black/40 text-white text-[8px] font-black px-1.5 rounded-full">${p.images.length}📷</span>`:''}
        </div>
        <div class="flex-1 min-w-0 p-3 flex flex-col">
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm font-black text-slate-800 leading-tight">${_esc(p.name)}</p>
            <span class="text-sm font-black text-emerald-600 shrink-0">${_currency(p.price)}</span>
          </div>
          <div class="flex items-center gap-1.5 mt-1 flex-wrap">
            ${p.store_categories?.name?`<span class="px-1.5 py-0.5 bg-slate-100 rounded text-[9px] font-black text-slate-500 uppercase tracking-wide">${_esc(p.store_categories.name)}</span>`:''}
            ${p.has_sizes?`<span class="px-1.5 py-0.5 bg-indigo-50 rounded text-[9px] font-black text-indigo-500 uppercase">Por talla</span>`:''}
            ${stockChip(p)}
          </div>
          <div class="mt-1.5">${_stockBar(p.stock)}</div>
          ${p.has_sizes&&sizes.length?`
            <div class="flex flex-wrap gap-1 mt-1.5">
              ${sizes.map(s=>`<span class="px-1.5 py-0.5 rounded-md text-[9px] font-black ${s.stock<=0?'bg-rose-50 text-rose-400':'bg-slate-50 text-slate-500'}">${_esc(s.size_label)}: ${s.stock}</span>`).join('')}
            </div>`:''}
          <div class="mt-auto pt-2 flex gap-1.5">${rowActions(p)}</div>
        </div>
      </div>`;}).join('')}</div>`}`;
}

// ── Formulario Producto (modal) ──────────────────────────────────────────────
const COMMON_SIZES=['2','4','6','8','10','12','XS','S','M','L','XL'];

export function _openProductModal(productId=null){
  const p=productId?_st.products.find(x=>x.id===productId):null;
  const sizes=p?(_st.sizes[p.id]||[]):[];
  _st.pm={
    id:p?.id||null,
    photos:(p?(p.images?.length?p.images:(p.image_url?[p.image_url]:[])):[]).map(u=>({url:u,preview:u,status:'done'})),
    hasSizes:!!p?.has_sizes,
    sizes:sizes.map(s=>({label:s.size_label,stock:s.stock})),
    uploading:false,
  };
  document.getElementById('storeProductModal')?.remove();
  const m=document.createElement('div');
  m.id='storeProductModal';
  m.className='fixed inset-0 z-[3000] flex items-end sm:items-center justify-center';
  m.style.cssText='background:rgba(15,23,42,0.65);backdrop-filter:blur(6px);';
  m.innerHTML=`
    <div class="bg-white w-full sm:max-w-lg rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl flex flex-col" style="max-height:calc(100dvh - 32px);">
      <div class="pt-2 pb-1 flex justify-center sm:hidden shrink-0"><span class="w-10 h-1.5 rounded-full bg-slate-200"></span></div>
      <div class="px-5 py-4 flex items-center justify-between border-b border-slate-100 bg-lime-50 rounded-t-[2rem] shrink-0">
        <h3 class="font-black text-slate-800 flex items-center gap-2"><span class="w-9 h-9 bg-lime-100 rounded-xl flex items-center justify-center text-lg">${p?'✏️':'➕'}</span>
          <span>${p?'Editar Producto':'Nuevo Producto'}</span></h3>
        <button onclick="document.getElementById('storeProductModal').remove()" class="p-2 bg-slate-100 rounded-xl text-slate-500 hover:bg-slate-200 transition-colors"><i data-lucide="x" class="w-4 h-4"></i></button>
      </div>
      <div class="overflow-y-auto flex-1 px-5 py-4 space-y-4">

        <div>
          <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Fotos del producto (varias permitidas)</label>
          <div id="pmPhotoGrid" class="grid grid-cols-3 gap-2 mb-2"></div>
          <label class="flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-200 hover:border-lime-400 hover:bg-lime-50/40 rounded-2xl cursor-pointer transition-all text-slate-400 hover:text-lime-600">
            <i data-lucide="camera" class="w-5 h-5"></i>
            <span class="text-xs font-black uppercase tracking-wider">Agregar fotos</span>
            <input type="file" accept="image/*" multiple class="hidden" onchange="StoreModule._pmAddFiles(this)">
          </label>
        </div>

        <div>
          <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Nombre *</label>
          <input id="pmName" type="text" value="${_esc(p?.name||'')}" placeholder="Ej: Uniforme Polo Azul"
            class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-lime-400 transition-all">
        </div>

        <div>
          <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Descripción</label>
          <textarea id="pmDesc" rows="2" placeholder="Detalles, material, colores..."
            class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-lime-400 resize-none transition-all">${_esc(p?.description||'')}</textarea>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Precio (RD$) *</label>
            <input id="pmPrice" type="number" min="0" step="0.01" value="${p?Number(p.price):''}" placeholder="0.00"
              class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-emerald-600 outline-none focus:ring-2 focus:ring-lime-400 transition-all">
          </div>
          <div>
            <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Unidad</label>
            <select id="pmUnit" class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-lime-400 transition-all">
              ${['unidad','par','kit','caja','litro'].map(u=>`<option value="${u}" ${p?.unit===u?'selected':''}>${u.charAt(0).toUpperCase()+u.slice(1)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div>
          <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Categoría <span class="normal-case font-bold">(escribe una nueva y se creará)</span></label>
          <div class="flex gap-2">
            <input id="pmCategory" list="pmCatList" type="text" value="${_esc(p?.store_categories?.name||'')}" placeholder="Ej: Uniformes, Útiles..."
              class="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-lime-400 transition-all" autocomplete="off">
            <input id="pmCatIcon" type="text" maxlength="4" value="📦" title="Ícono si es categoría nueva"
              class="w-12 text-center px-1 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-lg outline-none focus:ring-2 focus:ring-lime-400 transition-all">
          </div>
          <datalist id="pmCatList">
            ${_st.cats.map(c=>`<option value="${_esc(c.name)}">${_esc(c.icon||'')} ${_esc(c.name)}</option>`).join('')}
          </datalist>
        </div>

        <div class="bg-slate-50 border border-slate-100 rounded-2xl p-3">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-xs font-black text-slate-600 flex items-center gap-2"><i data-lucide="ruler" class="w-4 h-4 text-indigo-500"></i> Este producto usa tallas</span>
            <button type="button" id="pmHasSizes" onclick="StoreModule._pmToggleSizes()" role="switch" aria-checked="${_st.pm.hasSizes}"
              class="relative w-11 h-6 rounded-full transition-colors ${_st.pm.hasSizes?'bg-lime-500':'bg-slate-300'}">
              <span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${_st.pm.hasSizes?'translate-x-5':''}"></span>
            </button>
          </label>
          <div id="pmSizesWrap" class="${_st.pm.hasSizes?'':'hidden'} mt-3">
            <div class="flex flex-wrap gap-1 mb-2" id="pmQuickSizes">
              ${COMMON_SIZES.map(s=>`<button type="button" onclick="StoreModule._pmQuickSize('${s}')" class="px-2 py-0.5 bg-white border border-slate-200 hover:border-lime-400 hover:text-lime-600 rounded-lg text-[10px] font-black text-slate-500 transition-all">+ ${s}</button>`).join('')}
            </div>
            <div id="pmSizeRows" class="space-y-1.5"></div>
            <button type="button" onclick="StoreModule._pmAddSizeRow()" class="mt-2 text-[10px] font-black uppercase tracking-widest text-lime-600 hover:text-lime-700 flex items-center gap-1"><i data-lucide="plus-circle" class="w-3.5 h-3.5"></i> Otra talla</button>
          </div>
        </div>

        <div id="pmStockBox" class="${_st.pm.hasSizes?'hidden':''}">
          <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Cantidad en stock</label>
          <input id="pmStock" type="number" min="0" step="1" value="${p&&!p.has_sizes?Number(p.stock):''}" placeholder="0"
            class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-lime-400 transition-all">
        </div>
      </div>
      <div class="px-5 py-4 border-t border-slate-100 bg-slate-50/80 shrink-0 sm:rounded-b-[2rem] flex gap-2">
        <button onclick="document.getElementById('storeProductModal').remove()" class="flex-1 py-3 bg-white border border-slate-200 text-slate-500 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-100 transition-all">Cancelar</button>
        <button id="pmSaveBtn" onclick="StoreModule._pmSave()" class="flex-[2] py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-md transition-all active:scale-95 flex items-center justify-center gap-2">
          <i data-lucide="save" class="w-4 h-4"></i> ${p?'Guardar Cambios':'Crear Producto'}
        </button>
      </div>
    </div>`;
  m.onclick=(e)=>{if(e.target===m)m.remove();};
  document.body.appendChild(m);
  _pmRenderPhotos(); _pmRenderSizeRows();
  if(window.lucide)lucide.createIcons();
}

function _pmRenderPhotos(){
  const grid=document.getElementById('pmPhotoGrid'); if(!grid||!_st.pm)return;
  grid.innerHTML=_st.pm.photos.map((ph,i)=>`
    <div class="relative aspect-square rounded-2xl overflow-hidden border border-slate-200 group" data-photo="${i}">
      <img src="${_esc(ph.preview)}" class="w-full h-full object-cover ${ph.status!=='done'?'opacity-50 animate-pulse':''}">
      ${i===0?`<span class="absolute top-1 left-1 px-1.5 py-0.5 bg-lime-500 text-white text-[8px] font-black uppercase rounded-full">Portada</span>`:''}
      ${ph.status!=='done'?`<div class="absolute inset-0 flex items-center justify-center"><span class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span></div>`:
        `<button onclick="StoreModule._pmRemovePhoto(${i})" class="absolute top-1 right-1 w-6 h-6 bg-rose-500 text-white rounded-full text-xs font-black opacity-90 hover:scale-110 transition-transform shadow">✕</button>`}
    </div>`).join('');
}

export async function _pmAddFiles(input){
  const files=[...(input.files||[])]; input.value='';
  if(!files.length||!_st.pm)return;
  for(const f of files){
    if(!f.type.startsWith('image/')){_toast(`"${f.name}" no es una imagen`,'warning');continue;}
    if(f.size>5*1024*1024){_toast(`"${f.name}" supera 5MB`,'warning');continue;}
    const ph={url:null,preview:URL.createObjectURL(f),status:'up'};
    _st.pm.photos.push(ph);
    _pmRenderPhotos();
    try{
      ph.url=await _uploadImg(f);
      ph.status='done';
    }catch(e){
      _st.pm.photos=_st.pm.photos.filter(x=>x!==ph);
      _toast('Error subiendo foto: '+(e.message||''),'error');
    }
    _pmRenderPhotos();
  }
}
export function _pmRemovePhoto(i){ if(!_st.pm)return; _st.pm.photos.splice(i,1); _pmRenderPhotos(); }

export function _pmToggleSizes(){
  if(!_st.pm)return;
  _st.pm.hasSizes=!_st.pm.hasSizes;
  const btn=document.getElementById('pmHasSizes'),wrap=document.getElementById('pmSizesWrap'),box=document.getElementById('pmStockBox');
  if(btn){btn.setAttribute('aria-checked',_st.pm.hasSizes);btn.className=`relative w-11 h-6 rounded-full transition-colors ${_st.pm.hasSizes?'bg-lime-500':'bg-slate-300'}`;btn.firstElementChild.className=`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${_st.pm.hasSizes?'translate-x-5':''}`;}
  wrap?.classList.toggle('hidden',!_st.pm.hasSizes);
  box?.classList.toggle('hidden',_st.pm.hasSizes);
}
export function _pmRenderSizeRows(){
  const wrap=document.getElementById('pmSizeRows'); if(!wrap||!_st.pm)return;
  wrap.innerHTML=_st.pm.sizes.map((s,i)=>`
    <div class="flex gap-1.5 items-center" data-sizerow="${i}">
      <input type="text" value="${_esc(s.label)}" placeholder="Talla" oninput="StoreModule._pmSizeLabel(${i},this.value)"
        class="w-20 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-black text-slate-700 uppercase outline-none focus:ring-2 focus:ring-lime-400">
      <input type="number" min="0" step="1" value="${s.stock}" placeholder="0" oninput="StoreModule._pmSizeStock(${i},this.value)"
        class="flex-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-lime-400">
      <button type="button" onclick="StoreModule._pmRmSizeRow(${i})" class="w-7 h-7 bg-rose-50 text-rose-400 hover:bg-rose-100 rounded-lg font-black transition-all">✕</button>
    </div>`).join('');
  if(!_st.pm.sizes.length)wrap.innerHTML=`<p class="text-[11px] font-bold text-slate-300 text-center py-2">Agrega tallas con los botones rápidos ↑</p>`;
}
export function _pmAddSizeRow(){ _st.pm.sizes.push({label:'',stock:0}); _pmRenderSizeRows(); }
export function _pmRmSizeRow(i){ _st.pm.sizes.splice(i,1); _pmRenderSizeRows(); }
export function _pmSizeLabel(i,v){ if(_st.pm.sizes[i])_st.pm.sizes[i].label=v.toUpperCase(); }
export function _pmSizeStock(i,v){ if(_st.pm.sizes[i])_st.pm.sizes[i].stock=Math.max(0,parseInt(v)||0); }
export function _pmQuickSize(label){
  if(_st.pm.sizes.some(s=>s.label===label)){_toast('La talla ya existe','warning');return;}
  _st.pm.sizes.push({label,stock:0});
  _pmRenderSizeRows();
}

export async function _pmSave(){
  if(!_st.pm)return;
  const name=document.getElementById('pmName')?.value?.trim();
  const desc=document.getElementById('pmDesc')?.value?.trim()||null;
  const price=parseFloat(document.getElementById('pmPrice')?.value);
  const unit=document.getElementById('pmUnit')?.value||'unidad';
  const catName=document.getElementById('pmCategory')?.value?.trim();
  const catIcon=document.getElementById('pmCatIcon')?.value?.trim()||'📦';

  if(!name){_toast('El nombre es obligatorio','warning');document.getElementById('pmName')?.focus();return;}
  if(isNaN(price)||price<0){_toast('Ingresa un precio válido','warning');document.getElementById('pmPrice')?.focus();return;}

  const pending=_st.pm.photos.some(ph=>ph.status!=='done'||!ph.url);
  if(pending){_toast('Espera: aún se están subiendo las fotos…','warning');return;}
  const urls=_st.pm.photos.map(ph=>ph.url);

  let stockTotal=0, sizes=[];
  if(_st.pm.hasSizes){
    sizes=_st.pm.sizes.filter(s=>s.label.trim());
    if(!sizes.length){_toast('Agrega al menos una talla con stock','warning');return;}
    const dup=sizes.find((s,i)=>sizes.findIndex(x=>x.label===s.label)!==i);
    if(dup){_toast(`Talla duplicada: ${dup.label}`,'warning');return;}
    stockTotal=sizes.reduce((t,s)=>t+s.stock,0);
  }else{
    stockTotal=Math.max(0,parseInt(document.getElementById('pmStock')?.value)||0);
  }

  const btn=document.getElementById('pmSaveBtn');
  btn.disabled=true;btn.innerHTML='<span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"></span> Guardando…';

  try{
    let categoryId=null;
    if(catName){
      const ex=_st.cats.find(c=>c.name.toLowerCase()===catName.toLowerCase());
      if(ex)categoryId=ex.id;
      else{
        const{data:newCat,error:catErr}=await supabase.from('store_categories').insert({name:catName,icon:catIcon}).select().single();
        if(catErr){
          if(catErr.code==='42501')_toast('No se pudo crear la categoría: ejecuta db/store_v3_migration.sql en Supabase','error');
          else _toast('Error creando categoría: '+catErr.message,'error');
        }else{
          categoryId=newCat.id; _st.cats.push(newCat);
          _toast(`Categoría "${catName}" creada ${catIcon}`);
        }
      }
    }

    const payload={name,description:desc,price,unit,category_id:categoryId,stock:stockTotal,has_sizes:_st.pm.hasSizes,images:urls,image_url:urls[0]||null};
    let productId=_st.pm.id;
    if(productId){
      const{error}=await supabase.from('store_products').update(payload).eq('id',productId);
      if(error)throw error;
    }else{
      const{data:np,error}=await supabase.from('store_products').insert(payload).select().single();
      if(error)throw error;
      productId=np.id;
    }

    await supabase.from('store_product_sizes').delete().eq('product_id',productId);
    if(sizes.length){
      const{error:sErr}=await supabase.from('store_product_sizes').insert(sizes.map(s=>({product_id:productId,size_label:s.label,stock:s.stock})));
      if(sErr)throw sErr;
    }

    document.getElementById('storeProductModal')?.remove();
    _toast(_st.pm.id?'Producto actualizado ✅':'¡Producto creado! 🎉');
    _st.pm=null;
    await _staffLoadData();
    _staffBadgeAlerts();
    _stTab('productos');
  }catch(e){
    _toast('Error guardando: '+(e.message||''),'error');
    btn.disabled=false;btn.innerHTML=`<i data-lucide="save" class="w-4 h-4"></i> Guardar`;
    if(window.lucide)lucide.createIcons();
  }
}

export async function _pmToggleActive(id){
  const p=_st.products.find(x=>x.id===id); if(!p)return;
  try{
    const{error}=await supabase.from('store_products').update({is_active:!p.is_active}).eq('id',id);
    if(error)throw error;
    _toast(p.is_active?'Producto desactivado':'Producto activado');
    await _staffLoadData(); _staffBadgeAlerts(); _stTab('productos');
  }catch(e){_toast('Error: '+(e.message||''),'error');}
}

export async function _pmDelete(id){
  const p=_st.products.find(x=>x.id===id); if(!p)return;
  if(!confirm(`¿Eliminar definitivamente "${p.name}"?\n\nSi tiene pedidos asociados, conviene desactivarlo.`))return;
  try{
    const{error}=await supabase.from('store_products').delete().eq('id',id);
    if(error)throw error;
    _toast('Producto eliminado');
    await _staffLoadData(); _staffBadgeAlerts(); _stTab('productos');
  }catch(e){
    _toast('No se pudo eliminar (tiene pedidos). Sugerencia: desactívalo.','warning');
  }
}

// ── TAB INVENTARIO ───────────────────────────────────────────────────────────
export function _invType(t){ _st.invType=t; _renderInventory(); if(window.lucide)lucide.createIcons(); }

function _renderInventory(){
  const body=document.getElementById('staff-store-body'); if(!body)return;
  const actives=_st.products.filter(p=>p.is_active);
  const valor=actives.reduce((t,p)=>t+Number(p.price)*(Number(p.stock)||0),0);
  const agotados=actives.filter(p=>(Number(p.stock)||0)<=0).length;
  const bajos=actives.filter(p=>{const s=Number(p.stock)||0;return s>0&&s<=5;}).length;
  const hoy=new Date().toDateString();
  const movHoy=_st.movements.filter(m=>new Date(m.created_at).toDateString()===hoy).length;
  const salud=actives.length?Math.round(((actives.length-agotados-bajos)/actives.length)*100):100;

  const kpi=(icon,val,label,color,ring)=>`
    <div class="bg-white rounded-3xl border border-slate-100 shadow-sm p-4 flex items-center gap-3 relative overflow-hidden">
      <div class="absolute -right-4 -top-4 w-16 h-16 rounded-full ${ring} opacity-40"></div>
      <span class="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${color} relative"><i data-lucide="${icon}" class="w-5 h-5"></i></span>
      <div class="min-w-0 relative"><p class="text-lg font-black text-slate-800 leading-none truncate">${val}</p><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">${label}</p></div>
    </div>`;

  let moves=_st.movements;
  if(_st.invType!=='all')moves=moves.filter(m=>m.type===_st.invType);

  body.innerHTML=`
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
      ${kpi('package',actives.length,'Productos activos','bg-lime-50 text-lime-700','bg-lime-200')}
      ${kpi('banknote',_currency(valor),'Valor inventario','bg-emerald-50 text-emerald-600','bg-emerald-200')}
      ${kpi('alert-triangle',bajos,'Stock bajo (≤5)','bg-amber-50 text-amber-600','bg-amber-200')}
      ${kpi('circle-off',agotados,'Agotados','bg-rose-50 text-rose-600','bg-rose-200')}
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm p-4 flex flex-col justify-center relative overflow-hidden">
        <div class="absolute -right-4 -top-4 w-16 h-16 rounded-full bg-teal-200 opacity-40"></div>
        <div class="flex items-end gap-1.5 relative">
          <span class="text-lg font-black text-slate-800 leading-none tabular-nums">${salud}%</span>
          <span class="text-[9px] font-black text-teal-600 uppercase tracking-widest mb-0.5">salud</span>
        </div>
        <div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mt-2 relative">
          <div class="h-full bg-gradient-to-r from-teal-400 to-emerald-500 rounded-full transition-all" style="width:${salud}%"></div>
        </div>
      </div>
    </div>

    <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4">
      <div class="flex gap-1.5 bg-white p-1 rounded-2xl border border-slate-100 shadow-sm w-fit">
        <button onclick="StoreModule._invOpenMove('entry')" class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider shadow-sm transition-all active:scale-95"><i data-lucide="plus" class="w-3.5 h-3.5"></i> Entrada</button>
        <button onclick="StoreModule._invOpenMove('exit')" class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-black uppercase tracking-wider shadow-sm transition-all active:scale-95"><i data-lucide="minus" class="w-3.5 h-3.5"></i> Salida</button>
        <button onclick="StoreModule._invOpenMove('adjustment')" class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-[10px] font-black uppercase tracking-wider shadow-sm transition-all active:scale-95"><i data-lucide="sliders-horizontal" class="w-3.5 h-3.5"></i> Ajuste</button>
      </div>
      <span class="sm:ml-auto text-[10px] font-black text-slate-300 uppercase tracking-widest self-center">${movHoy} movimientos hoy</span>
    </div>

    <div class="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-50 flex items-center gap-2 flex-wrap">
        <i data-lucide="history" class="w-4 h-4 text-slate-400"></i>
        <p class="text-xs font-black text-slate-500 uppercase tracking-widest">Historial de movimientos</p>
        <div class="ml-auto flex gap-1">
          ${[['all','Todo'],['entry','Entradas'],['exit','Salidas'],['adjustment','Ajustes']].map(([k,l])=>`
            <button onclick="StoreModule._invType('${k}')" class="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${_st.invType===k?'bg-slate-800 text-white':'bg-slate-50 text-slate-400 hover:text-slate-600'}">${l}</button>`).join('')}
        </div>
      </div>
      ${!moves.length?`<div class="text-center py-12 text-slate-300"><div class="text-4xl mb-2">🗂️</div><p class="text-xs font-black uppercase tracking-widest">Sin movimientos registrados</p></div>`:
      `
      <div class="hidden md:block overflow-x-auto max-h-[520px] overflow-y-auto">
        <table class="w-full text-left">
          <thead class="sticky top-0 z-10"><tr class="bg-slate-50/95 backdrop-blur border-b border-slate-100">
            <th class="px-4 py-2.5 text-[9px] font-black text-slate-400 uppercase tracking-widest">Tipo</th>
            <th class="px-4 py-2.5 text-[9px] font-black text-slate-400 uppercase tracking-widest">Producto</th>
            <th class="px-4 py-2.5 text-[9px] font-black text-slate-400 uppercase tracking-widest">Motivo</th>
            <th class="px-4 py-2.5 text-[9px] font-black text-slate-400 uppercase tracking-widest">Responsable</th>
            <th class="px-4 py-2.5 text-[9px] font-black text-slate-400 uppercase tracking-widest">Fecha</th>
            <th class="px-4 py-2.5 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Cantidad</th>
          </tr></thead>
          <tbody class="divide-y divide-slate-50">${moves.map(mv=>{
            const md=MOVEMENT[mv.type]||MOVEMENT.adjustment;
            return `
            <tr class="hover:bg-slate-50/60 transition-colors">
              <td class="px-4 py-2.5"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wide ${md.cls}"><i data-lucide="${md.icon}" class="w-3 h-3"></i>${md.label}</span></td>
              <td class="px-4 py-2.5 min-w-[160px]"><p class="text-xs font-black text-slate-700 truncate max-w-[220px]">${_esc(mv.product_name||'—')}</p>
                ${mv.size_label?`<span class="mt-0.5 inline-block px-1.5 py-0.5 bg-indigo-50 text-indigo-500 rounded text-[9px] font-black">Talla: ${_esc(mv.size_label)}</span>`:''}</td>
              <td class="px-4 py-2.5 text-xs font-bold text-slate-500 capitalize">${_esc(mv.reason||'—')}</td>
              <td class="px-4 py-2.5 text-xs font-bold text-slate-400">${mv.actor_name?_esc(mv.actor_name):'<span class="italic">sistema</span>'}</td>
              <td class="px-4 py-2.5 whitespace-nowrap"><p class="text-xs font-bold text-slate-600">${_date(mv.created_at)}</p><p class="text-[10px] font-bold text-slate-300">${_time(mv.created_at)}</p></td>
              <td class="px-4 py-2.5 text-right whitespace-nowrap"><span class="inline-flex items-center gap-1 text-sm font-black ${mv.quantity>=0?'text-emerald-600':'text-rose-500'}"><i data-lucide="${mv.quantity>=0?'arrow-up-right':'arrow-down-left'}" class="w-3.5 h-3.5"></i>${Math.abs(mv.quantity)}</span></td>
            </tr>`;}).join('')}
          </tbody>
        </table>
      </div>

      <div class="md:hidden divide-y divide-slate-50 max-h-[480px] overflow-y-auto">${moves.map(mv=>{
        const md=MOVEMENT[mv.type]||MOVEMENT.adjustment;
        return `
        <div class="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
          <span class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${md.cls}"><i data-lucide="${md.icon}" class="w-4 h-4"></i></span>
          <div class="min-w-0 flex-1">
            <p class="text-xs font-black text-slate-700 truncate">${_esc(mv.product_name||'—')}
              ${mv.size_label?`<span class="ml-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-500 rounded text-[9px] font-black">T: ${_esc(mv.size_label)}</span>`:''}
            </p>
            <p class="text-[10px] font-bold text-slate-400">${_esc(md.label)} · ${_esc(mv.reason||'—')} · ${mv.actor_name?_esc(mv.actor_name):'sistema'} · ${_date(mv.created_at)} ${_time(mv.created_at)}</p>
          </div>
          <span class="text-xs font-black shrink-0 ${mv.quantity>=0?'text-emerald-600':'text-rose-500'}">${mv.quantity>=0?'+':''}${mv.quantity}</span>
        </div>`;}).join('')}</div>`}
    </div>`;
}

export function _invOpenMove(type){
  const actives=_st.products.filter(p=>p.is_active);
  if(!actives.length){_toast('Primero crea un producto','warning');return;}
  const titles={
    entry:['Entrada de mercancía','arrow-down-left'],
    exit:['Registrar Salida','arrow-up-right'],
    adjustment:['Ajuste de inventario','sliders-horizontal'],
  };
  const[tTitle,tIcon]=titles[type];
  const accent=(exitV,entryV,adjV)=>type==='exit'?exitV:type==='entry'?entryV:adjV;

  document.getElementById('storeMoveModal')?.remove();
  const m=document.createElement('div');
  m.id='storeMoveModal';
  m.className='fixed inset-0 z-[3000] flex items-end sm:items-center justify-center';
  m.style.cssText='background:rgba(15,23,42,0.65);backdrop-filter:blur(6px);';
  m.innerHTML=`
    <div class="bg-white w-full sm:max-w-md rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl flex flex-col" style="max-height:calc(100dvh - 32px);">
      <div class="pt-2 pb-1 flex justify-center sm:hidden shrink-0"><span class="w-10 h-1.5 rounded-full bg-slate-200"></span></div>
      <div class="px-5 py-4 flex items-center justify-between border-b border-slate-100 shrink-0 ${accent('bg-rose-50','bg-emerald-50','bg-blue-50')} rounded-t-[2rem]">
        <h3 class="font-black text-slate-800 flex items-center gap-2"><span class="w-9 h-9 ${accent('bg-rose-100','bg-emerald-100','bg-blue-100')} rounded-xl flex items-center justify-center"><i data-lucide="${tIcon}" class="w-4 h-4 ${accent('text-rose-600','text-emerald-600','text-blue-600')}"></i></span> ${tTitle}</h3>
        <button onclick="document.getElementById('storeMoveModal').remove()" class="p-2 bg-slate-100 rounded-xl text-slate-500 hover:bg-slate-200 transition-colors"><i data-lucide="x" class="w-4 h-4"></i></button>
      </div>
      <div class="overflow-y-auto flex-1 px-5 py-4 space-y-4">
        <div>
          <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Producto *</label>
          <select id="mvProduct" onchange="StoreModule._mvProductChange()"
            class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-400 transition-all">
            <option value="">— Selecciona un producto —</option>
            ${actives.map(p=>`<option value="${p.id}">${_esc(p.name)}${(p.stock||0)<=0?' ⚠ AGOTADO':''}</option>`).join('')}
          </select>
        </div>
        <div id="mvContext"></div>
        <div id="mvQtyWrap">
          <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1" id="mvQtyLabel">${type==='adjustment'?'Conteo real encontrado':'Cantidad *'}</label>
          <input id="mvQty" type="number" min="0" step="1" placeholder="0" oninput="StoreModule._mvHint()"
            class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-700 outline-none focus:ring-2 focus:ring-emerald-400 transition-all">
          <p id="mvHint" class="text-[11px] font-bold text-slate-400 mt-1.5"></p>
        </div>
        <div>
          <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Motivo</label>
          <select id="mvReason" class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-400 transition-all">
            ${(type==='entry'?['compra','devolución','donación']:type==='exit'?['venta','dañado','pérdida','uso interno']:['conteo físico','corrección']).map(r=>`<option value="${r}">${r.charAt(0).toUpperCase()+r.slice(1)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="px-5 py-4 border-t border-slate-100 bg-slate-50/80 shrink-0 sm:rounded-b-[2rem]">
        <button onclick="StoreModule._invSubmitMove('${type}')" class="w-full py-3.5 ${accent('bg-rose-500 hover:bg-rose-600','bg-emerald-500 hover:bg-emerald-600','bg-blue-500 hover:bg-blue-600')} text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-md transition-all active:scale-95 flex items-center justify-center gap-2">
          <i data-lucide="${tIcon}" class="w-4 h-4"></i> Registrar ${MOVEMENT[type].label}
        </button>
      </div>
    </div>`;
  m.onclick=(e)=>{if(e.target===m)m.remove();};
  document.body.appendChild(m);
  if(window.lucide)lucide.createIcons();
}

export function _mvProductChange(){
  const pid=document.getElementById('mvProduct')?.value;
  const ctx=document.getElementById('mvContext');
  if(!ctx)return;
  const p=_st.products.find(x=>x.id===pid);
  const sizes=p?(_st.sizes[p.id]||[]):[];
  if(!p){ctx.innerHTML='';_mvHint();return;}
  const stock=Number(p.stock)||0;
  ctx.innerHTML=`
    <div class="bg-slate-50 border border-slate-100 rounded-2xl p-3 mb-1">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Stock actual</span>
        <span class="text-sm font-black ${stock<=0?'text-rose-500':stock<=5?'text-amber-500':'text-emerald-600'}">${stock} ${_esc(p.unit||'unidad(es)')}</span>
      </div>
      ${sizes.length?`<div class="flex flex-wrap gap-1 mt-2">${sizes.map(s=>`<span class="px-1.5 py-0.5 rounded-md text-[9px] font-black ${s.stock<=0?'bg-rose-100 text-rose-400':'bg-white text-slate-500 border border-slate-100'}">${_esc(s.size_label)}: ${s.stock}</span>`).join('')}</div>`:''}
    </div>
    ${p.has_sizes&&sizes.length?`
    <div>
      <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Talla * <span class="text-rose-400">obligatoria para este producto</span></label>
      <select id="mvSize" onchange="StoreModule._mvHint()"
        class="w-full px-4 py-2.5 bg-white border-2 border-slate-200 rounded-xl text-sm font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-400 transition-all">
        <option value="">— Selecciona la talla —</option>
        ${sizes.map(s=>`<option value="${_esc(s.size_label)}" data-stock="${s.stock}">${_esc(s.size_label)} — disponibles: ${s.stock}${s.stock<=0?' ⚠':''}</option>`).join('')}
      </select>
    </div>`:''}`;
  _mvHint();
}

function _mvSelectedSize(){
  const sel=document.getElementById('mvSize');
  if(!sel||!sel.value)return null;
  const opt=sel.selectedOptions[0];
  return {label:sel.value, stock:Number(opt?.dataset.stock)||0};
}

function _mvCurrentType(){
  const btn=document.querySelector('#storeMoveModal button[onclick^="StoreModule._invSubmitMove"]');
  const oc=btn?.getAttribute('onclick')||'';
  const mm=oc.match(/_invSubmitMove\('(\w+)'\)/);
  return mm?mm[1]:null;
}

export function _mvHint(){
  const type=_mvCurrentType();
  const pid=document.getElementById('mvProduct')?.value;
  const p=_st.products.find(x=>x.id===pid);
  const hint=document.getElementById('mvHint'); if(!hint)return;
  if(!p){hint.textContent='';return;}
  const qty=parseInt(document.getElementById('mvQty')?.value)||0;
  const sz=_mvSelectedSize();
  if(type==='adjustment'){
    const cur=sz?sz.stock:(Number(p.stock)||0);
    const delta=qty-cur;
    hint.innerHTML=delta===0?'Sin cambios respecto al stock actual.':`Delta calculado: <b class="${delta>0?'text-emerald-600':'text-rose-500'}">${delta>0?'+':''}${delta}</b>`;
  }else if(type==='exit'){
    if(p.has_sizes&&!sz){hint.innerHTML='<span class="text-rose-400">⚠ Este producto se gestiona por tallas: selecciona una.</span>';return;}
    const avail=sz?sz.stock:(Number(p.stock)||0);
    hint.textContent=qty>avail?`⚠ Solo hay ${avail} disponibles${sz?` en talla ${sz.label}`:''}.`:qty?`Quedarían ${avail-qty} en stock${sz?` (talla ${sz.label})`:''}.`:'';
  }else if(type==='entry'){
    hint.textContent=qty?`Sumarán ${((sz?sz.stock:(Number(p.stock)||0))+qty)} en stock${sz?` (talla ${sz.label})`:''}.`:'';
  }
}

export async function _invSubmitMove(type){
  const pid=document.getElementById('mvProduct')?.value;
  const p=_st.products.find(x=>x.id===pid);
  if(!p){_toast('Selecciona un producto','warning');return;}
  const reason=document.getElementById('mvReason')?.value||null;
  const qtyInput=parseInt(document.getElementById('mvQty')?.value);
  const sz=_mvSelectedSize();

  if(isNaN(qtyInput)||(type!=='adjustment'&&qtyInput<=0)){_toast('Ingresa una cantidad válida','warning');document.getElementById('mvQty')?.focus();return;}

  // Validación dura: producto con tallas exige talla en la salida
  if(type==='exit'&&p.has_sizes&&(_st.sizes[p.id]?.length)&&!sz){
    _toast('⚠ Falta la talla: este producto se gestiona por tallas.','error');
    const sel=document.getElementById('mvSize');
    if(sel){sel.classList.add('ring-2','ring-rose-400','border-rose-300');setTimeout(()=>sel.classList.remove('ring-2','ring-rose-400','border-rose-300'),1800);}
    return;
  }
  // Validación: salida no puede exceder stock disponible
  if(type==='exit'){
    const avail=sz?sz.stock:(Number(p.stock)||0);
    if(qtyInput>avail){_toast(`Stock insuficiente: solo hay ${avail} disponibles${sz?` en talla ${sz.label}`:''}.`,'error');return;}
  }

  let qty=qtyInput;
  if(type==='adjustment'){
    const cur=sz?sz.stock:(Number(p.stock)||0);
    qty=qtyInput-cur;
    if(qty===0){_toast('El conteo coincide con el stock actual','warning');return;}
  }

  const btn=document.querySelector('#storeMoveModal button[onclick^="StoreModule._invSubmitMove"]');
  if(btn){btn.disabled=true;btn.innerHTML='<span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"></span> Registrando…';}

  try{
    const rpcQty=type==='adjustment'?Math.abs(qty)*(qty<0?-1:1):Math.abs(qty);
    const{error}=await supabase.rpc('store_manual_movement_v2',{
      p_product_id:pid,p_type:type,p_quantity:rpcQty,
      p_reason:reason,p_size_label:sz?.label||null
    });
    if(error){
      const msg=error.message||'';
      const missing=/could not find the function|PGRST202|404/i.test(msg+' '+(error.code||''));
      if(!missing)throw _friendlyMoveError(error);
      await _fallbackMovement({productId:pid,type,qty,reason,sizeLabel:sz?.label||null});
    }
    document.getElementById('storeMoveModal')?.remove();
    _toast(`${MOVEMENT[type].label} registrada ✅`);
    await _staffLoadData();
    _staffBadgeAlerts();
    _stTab('inventario');
  }catch(e){
    _toast(typeof e==='string'?e:('Error: '+(e.message||'')),'error');
    if(btn){btn.disabled=false;btn.innerHTML=`<i data-lucide="${MOVEMENT[type].icon}" class="w-4 h-4"></i> Registrar ${MOVEMENT[type].label}`;if(window.lucide)lucide.createIcons();}
  }
}

function _friendlyMoveError(error){
  const msg=error.message||'Error de inventario';
  if(/FALTA_TALLA/i.test(msg))return '⚠ Salida bloqueada: selecciona la talla del producto.';
  if(/STOCK_INSUFICIENTE/i.test(msg))return '⚠ Stock insuficiente para esa cantidad.';
  return error;
}

async function _fallbackMovement({productId,type,qty,reason,sizeLabel}){
  const signed=type==='exit'?-Math.abs(qty):(qty<0?qty:Math.abs(qty));
  const{data:{user}}=await supabase.auth.getUser();
  const{error:insErr}=await supabase.from('store_inventory').insert({
    product_id:productId,type,quantity:signed,reason,size_label:sizeLabel||null,actor_id:user?.id||null
  });
  if(insErr)throw insErr;
  if(sizeLabel){
    const row=(_st.sizes[productId]||[]).find(s=>s.size_label===sizeLabel);
    if(row){
      const ns=Math.max(0,row.stock+signed);
      const{error}=await supabase.from('store_product_sizes').update({stock:ns}).eq('id',row.id);
      if(error)throw error;
      const total=(_st.sizes[productId]||[]).reduce((t,s)=>t+(s.id===row.id?ns:s.stock),0);
      await supabase.from('store_products').update({stock:total}).eq('id',productId);
    }
  }else{
    const p=_st.products.find(x=>x.id===productId);
    const ns=Math.max(0,(Number(p?.stock)||0)+signed);
    const{error}=await supabase.from('store_products').update({stock:ns}).eq('id',productId);
    if(error)throw error;
  }
}

// ── Exposición global para onclick handlers ──────────────────────────────────
const StoreModule={
  openCart,submitOrder,_addToCartPadre,_chQty,_cartClear,_setImg,_pickSize,_padreSearch,_padreCat,
  _openProductDetail,_pdSetImg,_pdNav,_pdZoom,_pdPickSize,_pdQty,_pdAddToCart,
  initStorePadre,initStoreAsistente,initStoreDirectora,
  _stTab,_staffRefresh,_ordFilter,_ordStatus,_ordSearch,_prodZoom,
  _openProductModal,_pmAddFiles,_pmRemovePhoto,_pmToggleSizes,_pmRenderSizeRows,_pmAddSizeRow,_pmRmSizeRow,_pmSizeLabel,_pmSizeStock,_pmQuickSize,_pmSave,_pmToggleActive,_pmDelete,
  _prodSearch,_prodLowOnly,
  _invType,_invOpenMove,_mvProductChange,_mvHint,_invSubmitMove,
};
if(typeof window!=='undefined')window.StoreModule=StoreModule;
