document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const layoutShell = document.getElementById('layoutShell');
  const menuBtn = document.getElementById('menuBtn');
  const toggleSidebarBtn = document.getElementById('toggleSidebar');

  function isMobile() { return window.innerWidth < 768; }

  // Overlay para cerrar tocando fuera en móvil
  let overlay = document.getElementById('sidebarOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sidebarOverlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.35)';
    overlay.style.zIndex = '9'; // debajo del sidebar (que suele estar en z-10)
    overlay.style.display = 'none';
    document.body.appendChild(overlay);
  }
  function showOverlay(show) { overlay.style.display = show ? 'block' : 'none'; }

  function openSidebarMobile() {
    if (!sidebar) return;
    sidebar.classList.remove('hidden');
    sidebar.classList.add('mobile-visible');
    // Animación
    sidebar.classList.add('sidebar-mobile');
    requestAnimationFrame(() => sidebar.classList.add('sidebar-open'));
    showOverlay(true);
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
  }
  function closeSidebarMobile() {
    if (!sidebar) return;
    if (sidebar.classList.contains('mobile-visible')) {
      // Animación de salida
      sidebar.classList.remove('sidebar-open');
      setTimeout(() => {
        sidebar.classList.add('hidden');
        sidebar.classList.remove('mobile-visible');
      }, 200);
    }
    showOverlay(false);
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
  }

  // Toggle con botón hamburguesa
  // Accesibilidad: aria-controls
  menuBtn?.setAttribute('aria-controls', 'sidebar');
  menuBtn?.setAttribute('aria-expanded', 'false');

  menuBtn?.addEventListener('click', () => {
    if (!sidebar) return;
    if (isMobile()) {
      if (sidebar.classList.contains('mobile-visible')) {
        closeSidebarMobile();
      } else {
        openSidebarMobile();
      }
    } else {
      // Escritorio: colapsar/expandir
      sidebar.classList.toggle('collapsed');
      // mirror state on layout shell to let CSS grid adjust columns smoothly
      if (layoutShell) layoutShell.classList.toggle('sidebar-collapsed', sidebar.classList.contains('collapsed'));
      try { localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed')); } catch(e){}
      if (menuBtn) menuBtn.setAttribute('aria-expanded', sidebar.classList.contains('collapsed') ? 'false' : 'true');
    }
  });

  // Botón dentro del sidebar para colapsar en desktop
  toggleSidebarBtn?.addEventListener('click', () => {
    if (!sidebar) return;
    sidebar.classList.toggle('collapsed');
    if (layoutShell) layoutShell.classList.toggle('sidebar-collapsed', sidebar.classList.contains('collapsed'));
    try { localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed')); } catch(e){}
  });

  overlay.addEventListener('click', () => closeSidebarMobile());

  function handleResize() {
    if (!sidebar) return;
    if (isMobile()) {
      // Oculto por defecto en móvil
      closeSidebarMobile();
    } else {
      showOverlay(false);
      sidebar.classList.remove('mobile-visible');
      sidebar.classList.remove('sidebar-open');
      const saved = localStorage.getItem('sidebarCollapsed');
      if (saved === 'true') {
        sidebar.classList.add('collapsed');
        if (layoutShell) layoutShell.classList.add('sidebar-collapsed');
      } else {
        sidebar.classList.remove('collapsed');
        if (layoutShell) layoutShell.classList.remove('sidebar-collapsed');
      }
      if (menuBtn) menuBtn.setAttribute('aria-expanded', sidebar.classList.contains('collapsed') ? 'false' : 'true');
    }
  }
  handleResize();
  window.addEventListener('resize', handleResize);

  // Navegación genérica: sólo si la página NO tiene navegación dedicada
  const dedicatedNavPresent = document.querySelector('.teams-nav-item[data-section], .nav-button[data-section], .nav-btn[data-section]');
  if (!dedicatedNavPresent) {
    const navBtns = document.querySelectorAll('#sidebar [data-section]');
    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.section;
        if (!targetId) return;
        btn.setAttribute('aria-controls', targetId);
        // Marcar item activo (aria-selected)
        navBtns.forEach(b => b.setAttribute('aria-selected', b === btn ? 'true' : 'false'));
        // Ocultar secciones estándar
        document.querySelectorAll('main .section, main > section').forEach(s => {
          if (!s.classList.contains('hidden')) {
            s.classList.remove('section-visible');
            setTimeout(() => s.classList.add('hidden'), 180);
          } else {
            s.classList.add('hidden');
          }
        });
        const target = document.getElementById(targetId);
        if (target) {
          target.classList.add('section-anim');
          target.classList.remove('hidden');
          requestAnimationFrame(() => target.classList.add('section-visible'));
        }
        // Auto-scroll en móvil para mejorar UX
        if (isMobile()) {
          try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(e) { window.scrollTo(0, 0); }
        }

        // Cerrar sidebar en móvil tras navegar
        const ov = document.getElementById('sidebarOverlay');
        if (sidebar?.classList.contains('mobile-visible')) {
          closeSidebarMobile();
          if (ov) ov.style.display = 'none';
        }
      });
    });
  }

  // Botón de cierre para cada sección
  const sections = document.querySelectorAll('section.section, main section');
  sections.forEach(sec => {
    if (sec.querySelector('.section-close')) return;
    const btn = document.createElement('button');
    btn.className = 'section-close';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Cerrar sección');
    btn.innerHTML = '&times;';
    btn.addEventListener('click', () => {
      // Animar salida antes de ocultar
      sec.classList.remove('section-visible');
      setTimeout(() => sec.classList.add('hidden'), 180);
    });
    // Garantizar posicionamiento relativo si no está definido inline
    if (!getComputedStyle(sec).position || getComputedStyle(sec).position === 'static') {
      sec.style.position = 'relative';
    }
    sec.appendChild(btn);
    // Marcar secciones para animación
    sec.classList.add('section-anim');
  });
});