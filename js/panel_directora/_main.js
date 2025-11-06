// js/panel_directora/_main.js

import { adaptTablesToMobile } from './ui.js';
import { initNavigation, initDashboardChart, attachPaymentsHandlers, attachCommunicationsHandlers } from './handlers.js';

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
  initNavigation();
  initDashboardChart();
  attachPaymentsHandlers();
  attachCommunicationsHandlers();

  window.addEventListener('resize', () => adaptTablesToMobile());
  adaptTablesToMobile();

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
});
