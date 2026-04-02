/**
 * 🖼️ Karpus Kids — Media Utilities
 * Optimización de URLs de imágenes y activación de lazy loading.
 */

/**
 * Optimiza una URL de imagen de Supabase Storage añadiendo parámetros de resize.
 * Si la URL no es de Supabase, la devuelve tal cual.
 */
export function optimizeImageUrl(url, opts = {}) {
  if (!url) return null;
  // Solo optimizar URLs de Supabase Storage
  if (!url.includes('supabase.co/storage')) return url;
  const { width = 800, quality = 80 } = opts;
  // Supabase Storage soporta transform params
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}width=${width}&quality=${quality}&resize=contain`;
}

/**
 * Genera URL de thumbnail (versión pequeña para previews).
 */
export function thumbnailUrl(url) {
  return optimizeImageUrl(url, { width: 200, quality: 60 });
}

/**
 * Activa lazy loading en imágenes con data-src dentro de un contenedor.
 * Usa IntersectionObserver para cargar solo cuando son visibles.
 */
export function activateLazyImages(container = document) {
  const imgs = container.querySelectorAll('img[data-src]:not([data-lazy-done])');
  if (!imgs.length) return;

  if (!window._karpusLazyObserver) {
    window._karpusLazyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        const src = img.dataset.src;
        if (src) {
          img.src = src;
          img.removeAttribute('data-src');
          img.setAttribute('data-lazy-done', '1');
        }
        window._karpusLazyObserver.unobserve(img);
      });
    }, { rootMargin: '300px' });
  }

  imgs.forEach(img => {
    img.setAttribute('data-lazy-done', 'pending');
    window._karpusLazyObserver.observe(img);
  });
}
