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
    overlay.style.zIndex = '9';
    overlay.style.display = 'none';
    document.body.appendChild(overlay);
  }
  function showOverlay(show) { overlay.style.display = show ? 'block' : 'none'; }

  function openSidebarMobile() {
    if (!sidebar) return;
    sidebar.classList.remove('hidden');
    sidebar.classList.add('mobile-visible');
    showOverlay(true);
    menuBtn?.setAttribute('aria-expanded', 'true');
  }

  function closeSidebarMobile() {
    if (!sidebar) return;
    if (sidebar.classList.contains('mobile-visible')) {
      sidebar.classList.add('hidden');
      sidebar.classList.remove('mobile-visible');
    }
    showOverlay(false);
    menuBtn?.setAttribute('aria-expanded', 'false');
  }

  // Toggle con botón hamburguesa
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
      // Escritorio: colapsar/expandir sin depender de CSS externo
      const collapsed = sidebar.classList.toggle('collapsed');
      // Ajuste visual mínimo por JS para ancho
      sidebar.style.width = collapsed ? '72px' : '';
      if (layoutShell) layoutShell.classList.toggle('sidebar-collapsed', collapsed);
      try { localStorage.setItem('sidebarCollapsed', collapsed); } catch(e){}
      menuBtn?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
  });

  // Botón dentro del sidebar para colapsar en desktop
  toggleSidebarBtn?.addEventListener('click', () => {
    if (!sidebar) return;
    const collapsed = sidebar.classList.toggle('collapsed');
    sidebar.style.width = collapsed ? '72px' : '';
    if (layoutShell) layoutShell.classList.toggle('sidebar-collapsed', collapsed);
    try { localStorage.setItem('sidebarCollapsed', collapsed); } catch(e){}
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
      const saved = localStorage.getItem('sidebarCollapsed');
      const collapsed = saved === 'true';
      sidebar.classList.toggle('collapsed', collapsed);
      sidebar.style.width = collapsed ? '72px' : '';
      if (layoutShell) layoutShell.classList.toggle('sidebar-collapsed', collapsed);
      menuBtn?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
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
        navBtns.forEach(b => b.setAttribute('aria-selected', b === btn ? 'true' : 'false'));
        document.querySelectorAll('main .section, main > section').forEach(s => {
          s.classList.add('hidden');
        });
        const target = document.getElementById(targetId);
        if (target) {
          target.classList.remove('hidden');
        }
        if (isMobile()) {
          try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(e) { window.scrollTo(0, 0); }
        }
        if (sidebar?.classList.contains('mobile-visible')) {
          closeSidebarMobile();
          const ov = document.getElementById('sidebarOverlay');
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
    btn.textContent = '×';
    btn.style.position = 'absolute';
    btn.style.top = '0.5rem';
    btn.style.right = '0.5rem';
    btn.style.background = '#e5e7eb';
    btn.style.borderRadius = '0.5rem';
    btn.style.padding = '0.25rem 0.5rem';
    btn.addEventListener('click', () => {
      try { window.Auth?.logout(); } catch(e){}
      if (typeof window !== 'undefined') {
        window.location.href = 'login.html';
      }
    });
    if (!getComputedStyle(sec).position || getComputedStyle(sec).position === 'static') {
      sec.style.position = 'relative';
    }
    sec.appendChild(btn);
  });
});