/**
 * ✨ UI PREMIUM — Componentes Transversales
 */
import { Helpers } from './helpers.js';

export const UIPremium = {
  
  /**
   * 🧭 Inyectar Barra de Navegación Inferior
   */
  injectBottomNav(items = []) {
    if (document.querySelector('.bottom-nav')) return;

    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    
    nav.innerHTML = items.map(item => `
      <a href="#" onclick="UIPremium.handleNavClick(event, '${item.section}')" 
         class="nav-item ${item.active ? 'active' : ''}" data-section="${item.section}">
        <i data-lucide="${item.icon}"></i>
        <span>${item.label}</span>
      </a>
    `).join('');

    document.body.appendChild(nav);
    if (window.lucide) lucide.createIcons();
  },

  handleNavClick(e, section) {
    e.preventDefault();
    Helpers.vibrate('light');
    
    // Disparar evento de cambio de sección (cada panel lo maneja)
    window.dispatchEvent(new CustomEvent('app:nav-change', { detail: { section } }));
    
    // Actualizar visualmente
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.section === section);
    });
  },

  /**
   * 🌊 Aplicar Transiciones Suaves
   */
  applySectionTransition(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.classList.remove('section-transition-enter-active');
    container.classList.add('section-transition-enter');
    
    requestAnimationFrame(() => {
      container.classList.add('section-transition-enter-active');
    });
  },

  /**
   * 🦴 Mostrar Skeleton
   */
  showSkeleton(containerId, type = 'list') {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = '';
    if (type === 'list') {
      html = Array(5).fill(0).map(() => `
        <div class="p-4 mb-3 bg-white rounded-2xl flex items-center gap-4">
          <div class="w-12 h-12 rounded-full skeleton shrink-0"></div>
          <div class="flex-1 space-y-2">
            <div class="h-4 w-3/4 skeleton"></div>
            <div class="h-3 w-1/2 skeleton"></div>
          </div>
        </div>
      `).join('');
    } else if (type === 'cards') {
      html = `
        <div class="grid grid-cols-2 gap-4">
          ${Array(4).fill(0).map(() => `
            <div class="h-32 bg-white rounded-3xl skeleton"></div>
          `).join('')}
        </div>
      `;
    }

    container.innerHTML = html;
  },

  /**
   * 💳 Inicializar Gestos Swipe en filas
   */
  initSwipeActions(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.querySelectorAll('.swipe-row').forEach(row => {
      const content = row.querySelector('.swipe-content');
      let startX = 0;
      let currentX = 0;
      let isSwiping = false;

      row.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isSwiping = true;
        content.style.transition = 'none';
      }, { passive: true });

      row.addEventListener('touchmove', (e) => {
        if (!isSwiping) return;
        currentX = e.touches[0].clientX - startX;
        
        // Limitar el swipe
        if (currentX > 80) currentX = 80;
        if (currentX < -80) currentX = -80;
        
        content.style.transform = `translateX(${currentX}px)`;
      }, { passive: true });

      row.addEventListener('touchend', () => {
        isSwiping = false;
        content.style.transition = 'transform 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)';
        
        if (currentX > 50) {
          // Swipe Derecha -> Acción 1 (Aprobar)
          content.style.transform = 'translateX(80px)';
          if (options.onRight) options.onRight(row.dataset.id);
        } else if (currentX < -50) {
          // Swipe Izquierda -> Acción 2 (Ver)
          content.style.transform = 'translateX(-80px)';
          if (options.onLeft) options.onLeft(row.dataset.id);
        } else {
          content.style.transform = 'translateX(0)';
        }
        
        // Resetear después de un tiempo
        setTimeout(() => {
          content.style.transform = 'translateX(0)';
        }, 1500);
      });
    });
  },

  /**
   * 🔄 Pull to Refresh
   */
  initPullToRefresh(containerId, onRefresh) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let startY = 0;
    let isPulling = false;

    container.addEventListener('touchstart', (e) => {
      if (container.scrollTop === 0) {
        startY = e.touches[0].clientY;
        isPulling = true;
      }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
      if (!isPulling) return;
      const currentY = e.touches[0].clientY;
      const diff = currentY - startY;
      
      if (diff > 0) {
        container.classList.add('ptr-active');
        if (diff > 70) {
          // Feedback visual
          Helpers.vibrate('light');
        }
      }
    }, { passive: true });

    container.addEventListener('touchend', async (e) => {
      if (!isPulling) return;
      const diff = e.changedTouches[0].clientY - startY;
      
      if (diff > 70) {
        Helpers.vibrate('medium');
        if (onRefresh) await onRefresh();
      }
      
      container.classList.remove('ptr-active');
      isPulling = false;
    });
  }
};
