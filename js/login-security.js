/**
 * 🔒 Karpus Kids — Login Security (anti-clickjacking + disuasión de DevTools)
 * Se ejecuta de forma síncrona en el <head>, antes de renderizar el body.
 * Usa solo manipulación de estilos por CSSOM para no requerir 'unsafe-inline'.
 */
(function () {
  'use strict';

  // Anti-clickjacking: ocultar hasta confirmar que somos top frame
  document.documentElement.style.display = 'none';
  if (self === top) {
    document.documentElement.style.display = 'block';
  } else {
    top.location = self.location;
  }

  // Deshabilitar DevTools básico (disuasión)
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key))) {
      e.preventDefault();
    }
  });
})();
