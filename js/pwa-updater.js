/**
 * 📲 Karpus Kids — PWA Updater Profesional
 * Detecta nuevas versiones publicadas (/version.json) y guía al usuario
 * con una experiencia nativa de instalación de app:
 *
 *   - Banner OBLIGATORIO "Nueva versión disponible" con botón "Actualizar ahora".
 *   - Pantalla de actualización estilo descarga de app nativa:
 *     logo con anillo de progreso, porcentaje, barra de carga y mensajes
 *     dinámicos rotativos para que el usuario no se desespere.
 *   - Limpia las cachés viejas (karpus-*) y recarga con la nueva versión.
 *
 * Funciona en todas las páginas (login, paneles, kiosco). No registra el
 * Service Worker: la app ya lo hace (supabase.js / sw-live.js).
 */
(function () {
  'use strict';

  if (window.KarpusPwaUpdater) return;

  const VERSION_KEY   = 'karpus_pwa_version';
  const POLL_INTERVAL = 60000; // 60s
  const RING_R        = 54;
  const RING_C        = 2 * Math.PI * RING_R; // ≈ 339.292

  let knownVersion  = null;
  let nextVersion   = null;
  let updating      = false;
  let started       = false;
  let pollTimer     = null;

  const MESSAGES = [
    'Conectando con los servidores de Karpus…',
    'Descargando las mejoras de esta versión…',
    'Aplicando nuevas funciones ✨',
    'Puliendo detalles para ti…',
    'Optimizando tu experiencia 🚀',
    'Casi listo… falta poquito 😉'
  ];

  // ── Estilos compartidos (banner + overlay) ───────────────────────────────
  function injectStyles() {
    if (document.getElementById('kpu-styles')) return;
    const style = document.createElement('style');
    style.id = 'kpu-styles';
    style.textContent = `
      #kpu-banner{position:fixed;top:12px;left:50%;transform:translateX(-50%) translateY(-160%);width:min(92vw,600px);z-index:99999;
        font-family:'Nunito',system-ui,sans-serif;transition:transform .55s cubic-bezier(.34,1.56,.64,1),opacity .4s;}
      #kpu-banner.kpu-on{transform:translateX(-50%) translateY(0);opacity:1;}
      .kpu-banner-card{position:relative;overflow:hidden;display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:20px;
        background:linear-gradient(135deg,#FF8A00,#f97316);box-shadow:0 18px 48px rgba(249,115,22,.42),inset 0 1px 0 rgba(255,255,255,.35);
        border:1px solid rgba(255,255,255,.35);color:#fff;}
      .kpu-banner-card::after{content:'';position:absolute;inset:0;background:linear-gradient(110deg,transparent 20%,rgba(255,255,255,.28) 50%,transparent 80%);
        transform:translateX(-120%);animation:kpuShine 3.2s ease-in-out infinite;}
      .kpu-banner-icon{flex-shrink:0;width:46px;height:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;
        font-size:24px;background:rgba(255,255,255,.22);box-shadow:0 4px 10px rgba(0,0,0,.12),inset 0 1px 0 rgba(255,255,255,.4);}
      .kpu-banner-txt{flex:1;min-width:0;}
      .kpu-banner-title{font-size:13px;font-weight:900;letter-spacing:.2px;line-height:1.2;}
      .kpu-banner-sub{font-size:10px;font-weight:700;opacity:.92;margin-top:2px;}
      .kpu-banner-btn{flex-shrink:0;padding:10px 16px;border:0;border-radius:13px;cursor:pointer;font-family:inherit;
        font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:#b45309;background:#fff;
        box-shadow:0 6px 18px rgba(0,0,0,.18);transition:transform .15s,box-shadow .15s;animation:kpuPulse 2.2s ease-in-out infinite;}
      .kpu-banner-btn:hover{transform:translateY(-1px) scale(1.03);}
      .kpu-banner-btn:active{transform:scale(.96);}

      #kpu-overlay{position:fixed;inset:0;z-index:99999;overflow:hidden;font-family:'Nunito',system-ui,sans-serif;
        background:radial-gradient(1200px 700px at 80% -10%,#1e293b 0%,#0f172a 55%,#020617 100%);}
      .kpu-blob{position:absolute;border-radius:50%;filter:blur(70px);opacity:.5;animation:kpuDrift 9s ease-in-out infinite;}
      .kpu-blob-a{width:320px;height:320px;left:-80px;top:-60px;background:radial-gradient(circle,#FF8A00,transparent 70%);}
      .kpu-blob-b{width:360px;height:360px;right:-100px;bottom:-80px;background:radial-gradient(circle,#28B54D,transparent 70%);animation-delay:3s;}
      .kpu-float{position:absolute;font-size:30px;opacity:.85;animation:kpuFloat 5.5s ease-in-out infinite;}
      .kpu-float-a{left:12%;top:22%;animation-delay:.4s;}
      .kpu-float-b{right:14%;top:30%;font-size:24px;animation-delay:1.6s;}
      .kpu-float-c{left:18%;bottom:18%;font-size:22px;animation-delay:2.8s;}

      .kpu-card{position:relative;z-index:2;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;
        text-align:center;padding:24px;color:#fff;}
      .kpu-ring-wrap{position:relative;width:150px;height:150px;animation:kpuPop .7s cubic-bezier(.34,1.56,.64,1) both;}
      .kpu-ring{width:100%;height:100%;transform:rotate(-90deg);}
      .kpu-ring-track{fill:none;stroke:rgba(255,255,255,.14);stroke-width:9;}
      .kpu-ring-progress{fill:none;stroke:url(#kpuGrad);stroke-width:9;stroke-linecap:round;
        stroke-dasharray:${RING_C.toFixed(2)};stroke-dashoffset:${RING_C.toFixed(2)};transition:stroke-dashoffset .18s linear;}
      .kpu-logo{position:absolute;inset:20px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,.85);
        box-shadow:0 10px 30px rgba(0,0,0,.45),0 0 0 8px rgba(255,255,255,.08);animation:kpuRings 2.6s ease-out infinite;}
      .kpu-logo img{width:100%;height:100%;object-fit:cover;}
      .kpu-pct{margin:26px 0 2px;font-size:44px;font-weight:900;line-height:1;font-family:'Poppins','Nunito',sans-serif;
        background:linear-gradient(180deg,#fff,#cbd5e1);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}
      .kpu-pct-sym{font-size:24px;}
      .kpu-title{margin-top:12px;font-size:19px;font-weight:900;font-family:'Poppins','Nunito',sans-serif;letter-spacing:.3px;}
      .kpu-msg{margin-top:6px;font-size:12.5px;font-weight:700;color:#94a3b8;min-height:18px;transition:opacity .28s ease;opacity:1;}
      .kpu-bar{width:min(300px,78vw);height:8px;margin-top:22px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden;}
      .kpu-bar-fill{height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#FF8A00,#fb923c,#28B54D);
        box-shadow:0 0 14px rgba(251,146,60,.65);transition:width .18s linear;background-size:200% 100%;animation:kpuStripes 1.6s linear infinite;}
      .kpu-vers{margin-top:18px;padding:6px 14px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);
        font-size:10.5px;font-weight:800;color:#cbd5e1;letter-spacing:.3px;}
      .kpu-brand{margin-top:26px;font-size:12px;font-weight:900;letter-spacing:4px;text-transform:uppercase;color:#64748b;}

      @keyframes kpuShine{0%{transform:translateX(-120%)}55%,100%{transform:translateX(120%)}}
      @keyframes kpuPulse{0%,100%{box-shadow:0 6px 18px rgba(0,0,0,.18),0 0 0 0 rgba(255,255,255,.45)}
        50%{box-shadow:0 6px 18px rgba(0,0,0,.18),0 0 0 9px rgba(255,255,255,0)}}
      @keyframes kpuDrift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(30px,24px) scale(1.08)}}
      @keyframes kpuFloat{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-16px) rotate(6deg)}}
      @keyframes kpuPop{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}
      @keyframes kpuRings{0%{box-shadow:0 10px 30px rgba(0,0,0,.45),0 0 0 0 rgba(255,255,255,.35)}
        70%{box-shadow:0 10px 30px rgba(0,0,0,.45),0 0 0 20px rgba(255,255,255,0)}
        100%{box-shadow:0 10px 30px rgba(0,0,0,.45),0 0 0 0 rgba(255,255,255,0)}}
      @keyframes kpuStripes{0%{background-position:0 0}100%{background-position:200% 0}}
    `;
    document.head.appendChild(style);
  }

  // ── Banner obligatorio ────────────────────────────────────────────────────
  function showBanner() {
    injectStyles();
    if (document.getElementById('kpu-banner') || updating) return;

    const wrap = document.createElement('div');
    wrap.id = 'kpu-banner';
    wrap.innerHTML =
      '<div class="kpu-banner-card">' +
        '<div class="kpu-banner-icon">🚀</div>' +
        '<div class="kpu-banner-txt">' +
          '<p class="kpu-banner-title">¡Nueva versión disponible!</p>' +
          '<p class="kpu-banner-sub">Mejoras y correcciones listas para instalar</p>' +
        '</div>' +
        '<button class="kpu-banner-btn">Actualizar ahora</button>' +
      '</div>';
    document.body.appendChild(wrap);

    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('kpu-on')));

    wrap.querySelector('.kpu-banner-btn').addEventListener('click', () => performUpdate());
  }

  // ── Overlay de instalación (estilo app nativa) ────────────────────────────
  function showOverlay() {
    injectStyles();
    if (document.getElementById('kpu-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'kpu-overlay';
    overlay.innerHTML =
      '<div class="kpu-blob kpu-blob-a"></div>' +
      '<div class="kpu-blob kpu-blob-b"></div>' +
      '<div class="kpu-float kpu-float-a">✨</div>' +
      '<div class="kpu-float kpu-float-b">🚀</div>' +
      '<div class="kpu-float kpu-float-c">⚡</div>' +
      '<div class="kpu-card">' +
        '<div class="kpu-ring-wrap">' +
          '<svg class="kpu-ring" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">' +
            '<defs><linearGradient id="kpuGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
              '<stop offset="0%" stop-color="#FF8A00"/><stop offset="100%" stop-color="#28B54D"/>' +
            '</linearGradient></defs>' +
            '<circle class="kpu-ring-track" cx="60" cy="60" r="54"/>' +
            '<circle id="kpu-ring-progress" class="kpu-ring-progress" cx="60" cy="60" r="54"/>' +
          '</svg>' +
          '<div class="kpu-logo"><img src="img/mundo.jpg" alt="Karpus Kids"/></div>' +
        '</div>' +
        '<p class="kpu-pct"><span id="kpu-pct-num">0</span><span class="kpu-pct-sym">%</span></p>' +
        '<p class="kpu-title">Instalando actualización</p>' +
        '<p id="kpu-msg" class="kpu-msg">' + MESSAGES[0] + '</p>' +
        '<div class="kpu-bar"><div id="kpu-bar-fill" class="kpu-bar-fill"></div></div>' +
        '<div id="kpu-vers" class="kpu-vers"></div>' +
        '<p class="kpu-brand">Karpus Kids</p>' +
      '</div>';
    document.body.appendChild(overlay);

    const ring  = overlay.querySelector('#kpu-ring-progress');
    const num   = overlay.querySelector('#kpu-pct-num');
    const bar   = overlay.querySelector('#kpu-bar-fill');
    const msgEl = overlay.querySelector('#kpu-msg');
    const vers  = overlay.querySelector('#kpu-vers');

    const versionText = knownVersion && nextVersion && knownVersion !== nextVersion
      ? `Versión ${knownVersion} → ${nextVersion}`
      : nextVersion ? `Versión ${nextVersion}` : '';
    if (versionText) vers.textContent = versionText;

    // Mensajes dinámicos rotativos
    let msgIdx = 0;
    const msgTimer = setInterval(() => {
      msgEl.style.opacity = 0;
      setTimeout(() => {
        msgIdx = (msgIdx + 1) % MESSAGES.length;
        msgEl.textContent = MESSAGES[msgIdx];
        msgEl.style.opacity = 1;
      }, 300);
    }, 2900);

    const render = pct => {
      num.textContent = String(Math.min(100, Math.round(pct)));
      bar.style.width = Math.min(100, pct) + '%';
      ring.style.strokeDashoffset = (RING_C * (1 - Math.min(100, pct) / 100)).toFixed(2);
    };

    return {
      render,
      cleanup: () => clearInterval(msgTimer)
    };
  }

  // ── Flujo de actualización ────────────────────────────────────────────────
  async function performUpdate() {
    if (updating) return;
    updating = true;
    document.getElementById('kpu-banner')?.remove();

    const ui = showOverlay();
    const DURATION = 4800; // ms hasta 92% (sensación de descarga real)

    let pct = 0;

    // Limpiar cachés viejas en paralelo
    const cacheCleaned = (async () => {
      try {
        if (!('caches' in window)) return;
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('karpus-')).map(k => caches.delete(k)));
      } catch (_) {}
    })();

    await new Promise(resolve => {
      const start = performance.now();
      const step = now => {
        const k = Math.min(1, (now - start) / DURATION);
        const eased = 1 - Math.pow(1 - k, 3); // easeOutCubic
        pct = eased * 92;
        ui.render(pct);
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });

    await cacheCleaned;

    // Guardar la versión nueva y subir a 100%
    if (nextVersion) {
      try { localStorage.setItem(VERSION_KEY, nextVersion); } catch (_) {}
    }

    await new Promise(resolve => {
      const t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / 500);
        pct = 92 + 8 * (1 - Math.pow(1 - k, 2));
        ui.render(pct);
        if (k < 1) requestAnimationFrame(step);
        else { ui.render(100); resolve(); }
      };
      requestAnimationFrame(step);
    });

    // Respiro antes de recargar con la nueva versión
    setTimeout(() => {
      ui.cleanup();
      window.location.reload();
    }, 600);
  }

  // ── Detección de versión ──────────────────────────────────────────────────
  async function checkVersion() {
    try {
      const res = await fetch('/version.json', { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.version) return;

      const known = localStorage.getItem(VERSION_KEY);
      if (known && known !== data.version) {
        nextVersion = data.version;
        showBanner();
      } else if (!known) {
        knownVersion = data.version;
        try { localStorage.setItem(VERSION_KEY, data.version); } catch (_) {}
      }
    } catch (_) {}
  }

  function start() {
    if (started) return;
    started = true;
    knownVersion = localStorage.getItem(VERSION_KEY);
    checkVersion();
    pollTimer = setInterval(checkVersion, POLL_INTERVAL);
  }

  // Un nuevo Service Worker tomó el control → presentar la instalación
  function onControllerChange() {
    if (updating) return;
    if (document.getElementById('kpu-overlay')) return;
    try {
      const res = localStorage.getItem(VERSION_KEY);
      if (res) knownVersion = res;
    } catch (_) {}
    nextVersion = null;
    performUpdate();
  }

  window.KarpusPwaUpdater = {
    start,
    onControllerChange,
    performUpdate,
    isUpdating: () => updating
  };

  // Auto-inicio seguro (idempotente): cubre el kiosco y páginas que no
  // pasan por initOneSignal. Si supabase.js ya lo inició, no hace nada.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
