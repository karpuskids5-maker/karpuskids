/**
 * 📲 Karpus Kids — Login UX (toggle de contraseña + banner PWA)
 * Antes era un <script> inline; se externalizó para cumplir la CSP restrictiva.
 */
(function () {
  'use strict';

  // Toggle password visibility
  document.getElementById('togglePwd')?.addEventListener('click', () => {
    const pwd = document.getElementById('password');
    if (!pwd) return;
    pwd.type = pwd.type === 'password' ? 'text' : 'password';
  });

  // PWA Banner — shows on ALL devices (Android, iOS, Desktop)
  // Always shows unless: already installed, or user dismissed recently
  const KEY = 'karpus-pwa-v2';
  const isInstalled = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://');

  const stored = localStorage.getItem(KEY);
  const snoozed = stored && stored !== 'installed' && Date.now() < Number.parseInt(stored, 10);
  if (isInstalled() || snoozed || stored === 'installed') return;

  const banner = document.getElementById('pwaBanner');
  const iosMini = document.getElementById('iosMiniBanner');
  const isIOS  = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  let deferredPrompt = null;

  // iOS: show mini-banner, hide standard modal
  if (isIOS) {
    setTimeout(() => iosMini?.classList.remove('hidden'), 2000);
    document.getElementById('pwaBannerInstall')?.classList.add('hidden');
    document.getElementById('iosInstructions')?.classList.remove('hidden');
  }

  // Capture native install prompt (Android + Desktop Chrome/Edge)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  // Always show after 1.5s — no dependency on beforeinstallprompt
  if (!isIOS) setTimeout(() => banner?.classList.remove('hidden'), 1500);

  // Install button
  document.getElementById('pwaBannerInstall')?.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') {
        localStorage.setItem(KEY, 'installed');
        banner?.classList.add('hidden');
      }
    } else {
      // Desktop without prompt: guide user
      alert('Para instalar en Chrome/Edge:\n\nHaz clic en el ícono ⊕ en la barra de direcciones,\no en el menú ⋮ → "Instalar Karpus Kids".');
    }
  });

  const dismiss = (snooze) => {
    banner?.classList.add('hidden');
    localStorage.setItem(KEY, snooze ? String(Date.now() + 7 * 24 * 60 * 60 * 1000) : 'installed');
  };

  const dismissIos = () => {
    iosMini?.classList.add('hidden');
    localStorage.setItem(KEY, String(Date.now() + 3 * 24 * 60 * 60 * 1000)); // snooze 3 days
  };

  document.getElementById('pwaBannerDismiss')?.addEventListener('click',  () => dismiss(true));
  document.getElementById('pwaBannerDismiss2')?.addEventListener('click', () => dismiss(false));
  document.getElementById('closeIosBanner')?.addEventListener('click', dismissIos);

  // Tap backdrop to dismiss
  banner?.addEventListener('click', (e) => { if (e.target === banner) dismiss(true); });

  window.addEventListener('appinstalled', () => {
    banner?.classList.add('hidden');
    localStorage.setItem(KEY, 'installed');
  });
})();
