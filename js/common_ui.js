document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const layoutShell = document.getElementById('layoutShell');
  const menuBtn = document.getElementById('menuBtn');
  const toggleSidebarBtn = document.getElementById('toggleSidebar');

  function isMobile() { return window.innerWidth < 768; }

  // Crear Overlay si no existe
  let overlay = document.getElementById('sidebarOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sidebarOverlay';
    overlay.className = 'fixed inset-0 bg-black/50 z-40 hidden transition-opacity duration-300 backdrop-blur-sm';
    document.body.appendChild(overlay);
  }

  // --- LÓGICA DE ESTADO ---
  
  function initSidebarState() {
    if (isMobile()) {
      // Móvil: Siempre expandido internamente, pero oculto por transform
      sidebar.classList.remove('collapsed');
      layoutShell.classList.remove('sidebar-collapsed');
      sidebar.classList.remove('mobile-visible');
      overlay.classList.add('hidden');
    } else {
      // Escritorio: Recuperar estado
      const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
      toggleDesktopSidebar(isCollapsed);
      // Limpiar estados móviles
      sidebar.classList.remove('mobile-visible');
      overlay.classList.add('hidden');
      document.body.style.overflow = '';
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
    overlay.classList.toggle('hidden', !isVisible);
    document.body.style.overflow = isVisible ? 'hidden' : ''; // Bloquear scroll
  });

  // Botón Colapsar (Escritorio)
  toggleSidebarBtn?.addEventListener('click', () => {
    toggleDesktopSidebar();
  });

  // Cerrar al tocar fuera (Móvil)
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('mobile-visible');
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
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
          overlay.classList.add('hidden');
          document.body.style.overflow = '';
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