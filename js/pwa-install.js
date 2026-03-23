/**
 * Lógica para la instalación de la PWA (Progressive Web App)
 * Vincula el evento del navegador con el botón "Instalar App" de login.html
 */

// Usamos un IIFE y una bandera global para asegurarnos de que este código solo se ejecute una vez,
// incluso si el script se carga varias veces por error.
(function() {
  if (window.pwaInstallInitialized) {
    return;
  }
  window.pwaInstallInitialized = true;

  let deferredPrompt;
  const installBtn = document.getElementById('installAppBtn');

  // 1. Escuchar el evento que habilita la instalación
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevenir que Chrome muestre el prompt nativo automáticamente
    e.preventDefault();
    deferredPrompt = e;
    
    // Mostrar el botón de instalación en el login
    if (installBtn) {
      installBtn.classList.remove('hidden');
      installBtn.classList.add('flex'); // Asegurar display flex para centrado
    }
  });

  // 2. Listener del botón
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`Respuesta instalación: ${outcome}`);
        deferredPrompt = null;
        installBtn.classList.add('hidden');
        installBtn.classList.remove('flex');
      }
    });
  }

  // 3. Detectar si ya se instaló
  window.addEventListener('appinstalled', () => {
    if (installBtn) {
      installBtn.classList.add('hidden');
      installBtn.classList.remove('flex');
    }
    deferredPrompt = null;
  });
})();
