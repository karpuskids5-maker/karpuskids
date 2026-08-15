let _pdfPromise = null;

/**
 * Carga jsPDF + jspdf-autotable de forma perezosa, solo cuando se genera un PDF.
 * Evita los ~393KB de librerías de PDF en el bundle inicial de cada panel.
 * Devuelve una promesa que se resuelve cuando ambas librerías están disponibles.
 */
export function ensureJspdf() {
  if (window.jspdf) return Promise.resolve();
  if (_pdfPromise) return _pdfPromise;

  _pdfPromise = new Promise((resolve, reject) => {
    const load = src => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
    load('js/shared/jspdf.min.js')
      .then(() => load('js/shared/jspdf-autotable.min.js'))
      .then(() => {
        if (window.jspdf) resolve();
        else reject(new Error('jsPDF no disponible'));
      })
      .catch(reject);
  });
  return _pdfPromise;
}
