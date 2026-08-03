/**
 * 🖼️ Karpus Lightbox — Global media viewer
 * Opens images/videos in a full-screen modal instead of a new tab.
 * Auto-initializes on DOMContentLoaded and re-runs on any DOM mutation.
 * Usage: openLightbox(url, type) — or just add data-lightbox="url" to any img/video.
 */

(function () {
  if (window._karpusLightboxReady) return;
  window._karpusLightboxReady = true;

  // ── Create overlay ────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'karpusLightbox';
  overlay.style.cssText = [
    'display:none',
    'position:fixed',
    'inset:0',
    'z-index:99999',
    'background:rgba(0,0,0,0.92)',
    'backdrop-filter:blur(6px)',
    '-webkit-backdrop-filter:blur(6px)',
    'align-items:center',
    'justify-content:center',
    'padding:16px',
    'cursor:zoom-out'
  ].join(';');

  overlay.innerHTML =
    '<div id="karpusLbInner" style="position:relative;max-width:100%;max-height:100%;display:flex;align-items:center;justify-content:center;" onclick="event.stopPropagation()">' +
      '<img id="karpusLbImg" src="" alt="" style="display:none;max-width:min(92vw,1200px);max-height:90vh;width:auto;height:auto;object-fit:contain;border-radius:12px;box-shadow:0 25px 60px rgba(0,0,0,0.5);">' +
      '<video id="karpusLbVideo" src="" controls style="display:none;max-width:min(92vw,1200px);max-height:90vh;width:auto;height:auto;border-radius:12px;box-shadow:0 25px 60px rgba(0,0,0,0.5);"></video>' +
    '</div>' +
    '<button id="karpusLbClose" style="position:fixed;top:16px;right:16px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.15);border:2px solid rgba(255,255,255,0.3);color:#fff;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s;" onclick="window.closeLightbox()">✕</button>';

  document.body.appendChild(overlay);

  // ── Public API ────────────────────────────────────────────────────────────
  window.openLightbox = function (url, type) {
    if (!url) return;
    const img   = document.getElementById('karpusLbImg');
    const video = document.getElementById('karpusLbVideo');
    const isVid = type === 'video' || /\.(mp4|mov|webm|ogg)(\?|$)/i.test(url);

    if (isVid) {
      img.style.display   = 'none';
      video.style.display = 'block';
      video.src = url;
      video.play().catch(() => {});
    } else {
      video.style.display = 'none';
      video.pause();
      video.src = '';
      img.style.display = 'block';
      img.src = url;
    }

    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  };

  window.closeLightbox = function () {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
    const video = document.getElementById('karpusLbVideo');
    video.pause();
    video.src = '';
    document.getElementById('karpusLbImg').src = '';
  };

  // Close on backdrop click
  overlay.addEventListener('click', window.closeLightbox);

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.closeLightbox();
  });

  // ── Auto-bind: intercept clicks on images/videos ──────────────────────────
  function bindMediaClicks(root) {
    // Images — skip avatars and logos (small images)
    root.querySelectorAll('img:not([data-no-lightbox]):not(.avatar-img)').forEach(img => {
      if (img._lbBound) return;
      img._lbBound = true;

      // Only bind if image is "content" sized (> 80px)
      const bind = () => {
        if ((img.naturalWidth || img.width) > 80) {
          img.style.cursor = 'zoom-in';
          img.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.openLightbox(img.src || img.dataset.src, 'image');
          });
        }
      };

      if (img.complete) bind();
      else img.addEventListener('load', bind, { once: true });
    });

    // Videos — add click-to-lightbox on poster/thumbnail
    root.querySelectorAll('video:not([data-no-lightbox])').forEach(video => {
      if (video._lbBound) return;
      video._lbBound = true;
      // Don't override native controls — only open lightbox if not already playing
      video.addEventListener('click', (e) => {
        if (video.paused && !video.controls) {
          e.preventDefault();
          window.openLightbox(video.src || video.currentSrc, 'video');
        }
      });
    });

    // Explicit data-lightbox attributes (any element)
    root.querySelectorAll('[data-lightbox]:not([data-lb-bound])').forEach(el => {
      el.setAttribute('data-lb-bound', '1');
      el.style.cursor = 'zoom-in';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const type = el.dataset.lightboxType || 'image';
        window.openLightbox(el.dataset.lightbox, type);
      });
    });
  }

  // Run on load
  document.addEventListener('DOMContentLoaded', () => bindMediaClicks(document.body));

  // Re-run when DOM changes (wall posts, task images, etc.)
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1) bindMediaClicks(node);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Expose for manual calls
  window._karpusBindLightbox = bindMediaClicks;
})();
