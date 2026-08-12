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
  // Hoja externa (css/pwa-updater.css) en vez de <style> inline para cumplir
  // una CSP restrictiva sin 'unsafe-inline' (los <link> sí se permiten con 'self').
  function injectStyles() {
    if (document.getElementById('kpu-styles')) return;
    const link = document.createElement('link');
    link.id = 'kpu-styles';
    link.rel = 'stylesheet';
    link.href = 'css/pwa-updater.css';
    document.head.appendChild(link);
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
