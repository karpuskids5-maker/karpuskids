document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const layoutShell = document.getElementById('layoutShell');
  const menuBtn = document.getElementById('menuBtn');
  const toggleSidebarBtn = document.getElementById('toggleSidebar');

  // Skip if this panel has its own dedicated sidebar logic (directora, asistente, maestra)
  if (menuBtn && menuBtn.dataset.managed) return;

  function isMobile() { return window.innerWidth < 768; }

  // Crear Overlay si no existe
  let overlay = document.getElementById('sidebarOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sidebarOverlay';
    overlay.className = 'fixed inset-0 bg-black/50 z-40 backdrop-blur-sm';
    overlay.style.display = 'none';
    document.body.appendChild(overlay);
  }

  // --- LÓGICA DE ESTADO ---
  
  function initSidebarState() {
    if (isMobile()) {
      sidebar.classList.remove('collapsed');
      layoutShell?.classList.remove('sidebar-collapsed');
      sidebar.classList.remove('mobile-visible');
      overlay.style.display = 'none';
    } else {
      const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
      toggleDesktopSidebar(isCollapsed);
      sidebar.classList.remove('mobile-visible');
      overlay.style.display = 'none';
    }
  }

  function toggleDesktopSidebar(forceCollapse = null) {
    const shouldCollapse = forceCollapse !== null ? forceCollapse : !sidebar.classList.contains('collapsed');
    
    sidebar.classList.toggle('collapsed', shouldCollapse);
    layoutShell.classList.toggle('sidebar-collapsed', shouldCollapse);
    
    // Guardar preferencia solo si es acción del usuario
    if (forceCollapse === null) {
      localStorage.setItem('sidebarCollapsed', shouldCollapse);
    }
  }

  // --- EVENT LISTENERS ---

  // Botón Hamburguesa (Móvil)
  menuBtn?.addEventListener('click', () => {
    const isVisible = sidebar.classList.toggle('mobile-visible');
    overlay.style.display = isVisible ? 'block' : 'none';
  });

  // Botón Colapsar (Escritorio)
  toggleSidebarBtn?.addEventListener('click', () => {
    toggleDesktopSidebar();
  });

  // Cerrar al tocar fuera (Móvil)
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('mobile-visible');
    overlay.style.display = 'none';
  });

  // Manejar cambio de tamaño de ventana
  window.addEventListener('resize', () => {
    // Solo reiniciar si cambiamos entre móvil y escritorio
    const wasMobile = sidebar.classList.contains('mobile-check'); // Flag temporal
    if (isMobile() !== wasMobile) {
      initSidebarState();
      sidebar.classList.toggle('mobile-check', isMobile());
    }
  });

  // Inicialización
  sidebar.classList.toggle('mobile-check', isMobile());
  initSidebarState();

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
        // Cerrar sidebar en móvil al navegar
        if (isMobile()) {
          sidebar.classList.remove('mobile-visible');
          overlay.style.display = 'none';
        }
      });
    });
  }

  // Botón de cierre para cada sección

  document.querySelectorAll('[data-close-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.closeSection;
      const target = document.getElementById(targetId);
      if (target) target.classList.add('hidden');
    });
  });

}); // end DOMContentLoaded
