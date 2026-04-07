/**
 * 🛡️ Karpus Kids — Security Module
 * Protección contra XSS, CSRF, clickjacking e inyección.
 * Importar en todos los paneles: import { Security } from '../shared/security.js';
 */

export const Security = {

  /**
   * Sanitiza texto para inserción segura en HTML.
   * Más completo que escapeHTML básico.
   */
  sanitize(input = '') {
    if (typeof input !== 'string') return String(input ?? '');
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .replace(/`/g, '&#x60;')
      .replace(/=/g, '&#x3D;');
  },

  /**
   * Valida y sanitiza una URL — evita javascript: y data: URIs maliciosas.
   */
  safeUrl(url = '') {
    if (!url) return '#';
    const lower = url.toLowerCase().trim();
    if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
      console.warn('[Security] URL bloqueada:', url);
      return '#';
    }
    return url;
  },

  /**
   * Valida email básico.
   */
  isValidEmail(email = '') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  },

  /**
   * Valida contraseña segura (mín 8 chars, 1 mayúscula, 1 número).
   */
  isStrongPassword(pwd = '') {
    if (pwd.length < 8) return { ok: false, msg: 'Mínimo 8 caracteres' };
    if (!/[A-Z]/.test(pwd)) return { ok: false, msg: 'Debe incluir al menos una mayúscula' };
    if (!/[0-9]/.test(pwd)) return { ok: false, msg: 'Debe incluir al menos un número' };
    return { ok: true, msg: '' };
  },

  /**
   * Limpia un objeto de payload antes de enviarlo a Supabase.
   * Elimina campos undefined/null opcionales y sanitiza strings.
   */
  cleanPayload(obj = {}, sanitizeStrings = false) {
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      if (sanitizeStrings && typeof v === 'string') {
        clean[k] = v.trim();
      } else {
        clean[k] = v;
      }
    }
    return clean;
  },

  /**
   * Detecta y bloquea intentos de XSS en inputs del usuario.
   * Retorna true si el input parece malicioso.
   */
  isMalicious(input = '') {
    const patterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i,       // onclick=, onload=, etc.
      /<iframe/i,
      /<object/i,
      /<embed/i,
      /eval\s*\(/i,
      /document\.cookie/i,
      /window\.location/i,
    ];
    return patterns.some(p => p.test(input));
  },

  /**
   * Inicializa protecciones globales en el documento.
   * Llamar una vez al cargar cada panel.
   */
  init() {
    // 1. Prevenir clickjacking via JS (refuerza X-Frame-Options)
    if (window.self !== window.top) {
      document.body.innerHTML = '<div style="padding:2rem;font-family:sans-serif;text-align:center"><h2>Acceso no permitido</h2><p>Esta página no puede cargarse en un iframe.</p></div>';
      return;
    }

    // 2. Detectar DevTools abiertos (disuasión básica)
    // Solo en producción
    if (window.location.hostname === 'karpuskids.com') {
      let devtoolsOpen = false;
      const threshold = 160;
      setInterval(() => {
        const widthDiff  = window.outerWidth  - window.innerWidth  > threshold;
        const heightDiff = window.outerHeight - window.innerHeight > threshold;
        if ((widthDiff || heightDiff) && !devtoolsOpen) {
          devtoolsOpen = true;
          console.warn('%c⚠️ Karpus Kids — Zona Restringida', 'color:red;font-size:20px;font-weight:bold');
          console.warn('%cSi eres un desarrollador autorizado, ignora este mensaje.', 'color:orange;font-size:14px');
        } else if (!widthDiff && !heightDiff) {
          devtoolsOpen = false;
        }
      }, 1000);
    }

    // 3. Sanitizar automáticamente inputs al perder foco
    document.addEventListener('blur', (e) => {
      const el = e.target;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
      if (el.type === 'password' || el.type === 'email') return; // no tocar passwords/emails
      if (el.value && this.isMalicious(el.value)) {
        console.warn('[Security] Input malicioso detectado y bloqueado');
        el.value = '';
        el.classList.add('border-rose-500');
        el.placeholder = '⚠️ Contenido no permitido';
      }
    }, true);

    // 4. Prevenir paste de scripts en inputs de texto
    document.addEventListener('paste', (e) => {
      const el = e.target;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
      if (el.type === 'password') return;
      const pasted = e.clipboardData?.getData('text') || '';
      if (this.isMalicious(pasted)) {
        e.preventDefault();
        console.warn('[Security] Paste malicioso bloqueado');
      }
    }, true);

    console.log('[Security] ✅ Protecciones activas');
  }
};

// Auto-init en todos los paneles
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => Security.init());
}
