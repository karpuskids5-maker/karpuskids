/**
 * 📲 PWA Install Manager — Karpus Kids
 * Detecta si la app está instalada y muestra banner de descarga si no lo está.
 * Funciona en login.html y en todos los paneles.
 */
(function () {
  if (window.pwaInstallInitialized) return;
  window.pwaInstallInitialized = true;

  let deferredPrompt = null;

  // ── Detectar si ya está instalada ──────────────────────────────────────────
  function isInstalled() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://')
    );
  }

  // ── Mostrar botón en login.html ────────────────────────────────────────────
  function updateLoginBtn(show) {
    const btn = document.getElementById('installAppBtn');
    if (!btn) return;
    if (show) {
      btn.classList.remove('hidden');
      btn.classList.add('flex');
    } else {
      btn.classList.add('hidden');
      btn.classList.remove('flex');
    }
  }

  // ── Banner flotante para paneles ───────────────────────────────────────────
  function showInstallBanner() {
    if (document.getElementById('pwa-install-banner')) return;
    if (isInstalled()) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.className = [
      'fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:w-80',
      'bg-white rounded-2xl shadow-2xl border border-green-100 p-4',
      'flex items-center gap-3 z-[9998]',
      'animate-slide-up'
    ].join(' ');

    banner.innerHTML =
      '<div class="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">\uD83C\uDF93</div>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="font-black text-slate-800 text-sm leading-tight">Instala Karpus Kids</p>' +
        '<p class="text-[10px] font-bold text-slate-400 mt-0.5">Acceso r\u00E1pido desde tu pantalla de inicio</p>' +
      '</div>' +
      '<div class="flex flex-col gap-1.5 flex-shrink-0">' +
        '<button id="pwa-install-btn" class="px-3 py-1.5 bg-green-500 text-white rounded-xl text-[10px] font-black uppercase hover:bg-green-600 transition-colors">Instalar</button>' +
        '<button id="pwa-dismiss-btn" class="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200 transition-colors">Ahora no</button>' +
      '</div>';

    document.body.appendChild(banner);

    document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          banner.remove();
          localStorage.setItem('pwa-dismissed', 'installed');
        }
        deferredPrompt = null;
      }
    });

    document.getElementById('pwa-dismiss-btn')?.addEventListener('click', () => {
      banner.remove();
      // Recordar por 3 días
      localStorage.setItem('pwa-dismissed', String(Date.now() + 3 * 24 * 60 * 60 * 1000));
    });
  }

  // ── Verificar si debe mostrar el banner ────────────────────────────────────
  function shouldShowBanner() {
    if (isInstalled()) return false;
    const dismissed = localStorage.getItem('pwa-dismissed');
    if (!dismissed) return true;
    if (dismissed === 'installed') return false;
    return Date.now() > parseInt(dismissed, 10);
  }

  // ── Evento beforeinstallprompt ─────────────────────────────────────────────
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    // Botón en login
    updateLoginBtn(true);

    // Banner en paneles (con pequeño delay para no interrumpir la carga)
    if (!document.getElementById('loginForm') && shouldShowBanner()) {
      setTimeout(showInstallBanner, 3000);
    }
  });

  // ── Botón en login.html ────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('installAppBtn');
    if (loginBtn) {
      // Si ya está instalada, ocultar
      if (isInstalled()) {
        updateLoginBtn(false);
      }

      loginBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          deferredPrompt = null;
          updateLoginBtn(false);
          if (outcome === 'accepted') {
            localStorage.setItem('pwa-dismissed', 'installed');
          }
        }
      });
    }

    // En paneles: si no hay evento beforeinstallprompt pero tampoco está instalada
    // (iOS Safari no dispara beforeinstallprompt — mostrar instrucciones)
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isInStandaloneMode = isInstalled();
    if (isIOS && !isInStandaloneMode && !document.getElementById('loginForm') && shouldShowBanner()) {
      setTimeout(() => {
        if (document.getElementById('pwa-install-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.className = 'fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:w-80 bg-white rounded-2xl shadow-2xl border border-blue-100 p-4 flex items-center gap-3 z-[9998]';
        banner.innerHTML =
          '<div class="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">\uD83D\uDCF1</div>' +
          '<div class="flex-1 min-w-0">' +
            '<p class="font-black text-slate-800 text-sm">Instala en iPhone</p>' +
            '<p class="text-[10px] font-bold text-slate-400 mt-0.5">Toca \uD83D\uDCE4 Compartir \u2192 "A\u00F1adir a inicio"</p>' +
          '</div>' +
          '<button id="pwa-dismiss-btn" class="p-2 text-slate-400 hover:text-slate-600 flex-shrink-0"><i data-lucide="x" class="w-4 h-4"></i></button>';
        document.body.appendChild(banner);
        if (window.lucide) lucide.createIcons();
        document.getElementById('pwa-dismiss-btn')?.addEventListener('click', () => {
          banner.remove();
          localStorage.setItem('pwa-dismissed', String(Date.now() + 3 * 24 * 60 * 60 * 1000));
        });
      }, 4000);
    }
  });

  // ── App instalada ──────────────────────────────────────────────────────────
  window.addEventListener('appinstalled', () => {
    updateLoginBtn(false);
    document.getElementById('pwa-install-banner')?.remove();
    localStorage.setItem('pwa-dismissed', 'installed');
    deferredPrompt = null;
  });

  // ── CSS para animación del banner ──────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = '@keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}.animate-slide-up{animation:slideUp 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards}';
  document.head.appendChild(style);
})();
