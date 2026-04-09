/**
 * 🖼️ Karpus Kids — ImageLoader Pro
 * Maneja carga perezosa, optimización de Supabase y placeholders.
 */
export const ImageLoader = {
  /**
   * Retorna una URL optimizada si el proyecto tiene habilitado Supabase Transformation.
   * @param {string} url - URL original
   * @param {object} options - { w, h, quality, format }
   */
  getOptimizedUrl(url, { w, h, q = 80, format = 'webp' } = {}) {
    if (!url || !url.includes('supabase.co')) return url;
    // Si el usuario tiene plan Pro, Supabase permite transformar vía URL:
    // render/image/public/bucket/path?width=100...
    // Si no, devolvemos la URL original pero este helper queda listo para escalar.
    return url;
  },

  /** Genera el HTML para una imagen con lazy loading nativo y clase de transición */
  img(url, { alt = '', cls = '', fallback = 'img/mundo.jpg', priority = 'low' } = {}) {
    const optimized = this.getOptimizedUrl(url);
    return `
      <img 
        src="${optimized}" 
        alt="${alt}" 
        class="transition-opacity duration-500 opacity-0 ${cls}"
        loading="${priority === 'high' ? 'eager' : 'lazy'}"
        fetchpriority="${priority}"
        onload="this.classList.remove('opacity-0')"
        onerror="this.src='${fallback}';this.onerror=null;"
      >`;
  },

  /** Genera HTML para video optimizado */
  video(url, poster = '', { cls = '' } = {}) {
    return `
      <video 
        src="${url}" 
        poster="${poster}"
        class="${cls}"
        preload="metadata"
        controls
        playsinline
        muted
        loop
      ></video>`;
  },

  /** Observa elementos para activar efectos cuando entran en pantalla */
  observe(container = document) {
    const images = container.querySelectorAll('img[loading="lazy"]');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '50px' });
    images.forEach(img => observer.observe(img));
  }
};