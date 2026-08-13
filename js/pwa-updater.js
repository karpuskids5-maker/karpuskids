/**
 * 📲 Karpus Kids — PWA Updater Profesional
 * Detecta nuevas versiones publicadas (/version.json) y guía al usuario
 * con una experiencia nativa de instalación de app:
 *
 *   - Banner NO intrusivo "Nueva versión disponible" con botón "Actualizar ahora"
 *     y opción "Ahora no" (no vuelve a molestar hasta la próxima versión).
 *   - Pantalla de actualización estilo descarga de app nativa:
 *     logo con anillo de progreso, porcentaje, barra de carga y mensajes
 *     dinámicos rotativos.
 *   - Patrón profesional "waiting worker": el nuevo Service Worker espera
 *     en silencio. Solo cuando el usuario acepta se envía SKIP_WAITING,
 *     el worker activa y la página recarga UNA sola vez.
 *   - NUNCA fuerza recargas automáticas (controllerchange solo recarga si
 *     el usuario aceptó el flujo de actualización).
 *
 * Funciona en todas las páginas (login, paneles, kiosco). No registra el
 * Service Worker: la app ya lo hace (supabase.js / sw-live.js).
 */
(function () {
  'use strict';

  if (window.KarpusPwaUpdater) return;

  const VERSION_KEY   = 'karpus_pwa_version';
  const ACCEPT_KEY    = 'karpus_pwa_accepted'; // sessionStorage: el usuario aceptó el flujo
  const DISMISS_KEY   = 'karpus_pwa_dismissed'; // localStorage: versión que el usuario pospuso
  const POLL_INTERVAL = 60000; // 60s
  const RELOAD_TIMEOUT = 3500; // ms de respaldo si el worker no activa
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

  // ── Banner no intrusivo ───────────────────────────────────────────────────
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
        '<button type="button" class="kpu-banner-later" title="Recordármelo luego">Ahora no</button>' +
      '</div>';
    document.body.appendChild(wrap);

    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('kpu-on')));

    wrap.querySelector('.kpu-banner-btn').addEventListener('click', () => performUpdate());
    wrap.querySelector('.kpu-banner-later').addEventListener('click', () => dismissBanner());
  }

  // Pospone la actualización hasta la próxima versión publicada
  function dismissBanner() {
    if (nextVersion) {
      try { localStorage.setItem(DISMISS_KEY, nextVersion); } catch (_) {}
    }
    document.getElementById('kpu-banner')?.remove();
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

  // ── Activación del nuevo Service Worker (waiting worker) ─────────────────
  function activateNewWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then(registration => {
      if (!registration) return;
      const waiting = registration.waiting;
      if (waiting) {
        // El worker nuevo ya está instalado → pedirle que active (SKIP_WAITING)
        waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        // Sin worker esperando → forzar la comprobación (no activará si no hay cambios)
        registration.update().catch(() => {});
      }
    }).catch(() => {});
  }

  // ── Flujo de actualización ────────────────────────────────────────────────
  async function performUpdate() {
    if (updating) return;
    updating = true;
    document.getElementById('kpu-banner')?.remove();

    const ui = showOverlay();
    const DURATION = 2000; // ms hasta 92% (sensación de descarga real, breve)

    // Marcar que el usuario aceptó: permite que controllerchange recargue
    try { sessionStorage.setItem(ACCEPT_KEY, '1'); } catch (_) {}

    // Limpiar cachés viejas en paralelo (el worker nuevo ya eliminó las suyas)
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
        ui.render(eased * 92);
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });

    await cacheCleaned;

    // Guardar la versión nueva para no volver a preguntar tras recargar
    if (nextVersion) {
      try {
        localStorage.setItem(VERSION_KEY, nextVersion);
        localStorage.removeItem(DISMISS_KEY);
      } catch (_) {}
    }

    await new Promise(resolve => {
      const t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / 400);
        ui.render(92 + 8 * (1 - Math.pow(1 - k, 2)));
        if (k < 1) requestAnimationFrame(step);
        else { ui.render(100); resolve(); }
      };
      requestAnimationFrame(step);
    });

    // Recargar cuando el worker nuevo tome control (o por respaldo)
    let reloaded = false;
    const doReload = () => {
      if (reloaded) return;
      reloaded = true;
      try { sessionStorage.removeItem(ACCEPT_KEY); } catch (_) {}
      ui.cleanup();
      window.location.reload();
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', doReload);
    }
    setTimeout(doReload, RELOAD_TIMEOUT);

    activateNewWorker();
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
        // No volver a preguntar si el usuario ya pospuso ESTA versión
        const dismissed = localStorage.getItem(DISMISS_KEY);
        if (dismissed === data.version) return;
        showBanner();
      } else if (!known) {
        knownVersion = data.version;
        try { localStorage.setItem(VERSION_KEY, data.version); } catch (_) {}
      }
    } catch (_) {}
  }

  // ── Nuevo worker tomó control ─────────────────────────────────────────────
  // SOLO recarga si el usuario aceptó el flujo (marca en sessionStorage).
  // Si el worker activa por otro motivo, se ignora: cero recargas forzadas.
  function onControllerChange() {
    if (updating) return;
    try {
      if (sessionStorage.getItem(ACCEPT_KEY)) {
        sessionStorage.removeItem(ACCEPT_KEY);
        window.location.reload();
      }
    } catch (_) {}
  }

  function attachControllerChange() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
  }

  function start() {
    if (started) return;
    started = true;
    knownVersion = localStorage.getItem(VERSION_KEY);
    attachControllerChange();
    checkVersion();
    pollTimer = setInterval(checkVersion, POLL_INTERVAL);
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
