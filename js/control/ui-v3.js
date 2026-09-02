// ═══════════════════════════════════════════════════════════════════════════
// KARPUS KIDS — Control Center v3.0 — UI Enhancements
// 25 Visual + 25 Functional Improvements + Mobile Sidebar Fix
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. Tab switching: Muro ────────────────────────────────────────────────
function switchWallTab(tab) {
  ['feed','table','gallery','media'].forEach(t => {
    const el = document.getElementById('wallTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('#sec-muro .tab-btn').forEach((b,i) => b.classList.toggle('active', ['feed','table','gallery','media'][i] === tab));
  if (tab === 'gallery') window.renderWallGallery?.();
  if (tab === 'media') window.renderWallMedia?.();
  if (tab === 'feed') window.renderWallFeed?.();
}

// ── 2. Tab switching: Chat ────────────────────────────────────────────────
function switchChatTab(tab) {
  ['messages','conversations','media'].forEach(t => {
    const el = document.getElementById('chatTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('#sec-chat .tab-btn').forEach((b,i) => b.classList.toggle('active', ['messages','conversations','media'][i] === tab));
  if (tab === 'conversations') window.renderChatConversations?.();
  if (tab === 'media') window.renderChatMedia?.();
}

// ── 3. Tab switching: Analytics ───────────────────────────────────────────
function switchAnalyticsTab(tab) {
  ['teachers','logins','traffic'].forEach(t => {
    const el = document.getElementById('anTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('#sec-analytics .tab-btn').forEach((b,i) => b.classList.toggle('active', ['teachers','logins','traffic'][i] === tab));
  if (tab === 'teachers') window.renderTeacherEfficiency?.();
  if (tab === 'logins') window.renderLoginAnalytics?.();
  if (tab === 'traffic') window.renderTrafficAnalytics?.();
}

// ── 4. Lightbox helper ───────────────────────────────────────────────────
function openLightbox(url, caption) {
  const m = document.getElementById('lightboxModal');
  const img = document.getElementById('lightboxImg');
  const info = document.getElementById('lightboxInfo');
  if (!m || !img) return;
  img.src = url;
  if (info) info.textContent = caption || '';
  m.classList.add('show');
}

// ── 5. Swipe to close sidebar on mobile ───────────────────────────────────
(function() {
  let startX = 0, startY = 0, swiping = false;
  document.addEventListener('touchstart', function(e) {
    var sb = document.getElementById('sidebar');
    if (!sb || !sb.classList.contains('open')) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swiping = true;
  }, { passive: true });
  document.addEventListener('touchmove', function(e) {
    if (!swiping) return;
    var dx = e.touches[0].clientX - startX;
    var dy = Math.abs(e.touches[0].clientY - startY);
    if (dy > 40) { swiping = false; return; }
    if (dx < -60) { closeSidebar(); swiping = false; }
  }, { passive: true });
  document.addEventListener('touchend', function() { swiping = false; });
})();

// ── 6. Auto-refresh with countdown ────────────────────────────────────────
var _autoRefreshOn = true;
var _autoRefreshCount = 60;
var _autoRefreshInterval = null;

function startAutoRefresh() {
  if (_autoRefreshInterval) clearInterval(_autoRefreshInterval);
  _autoRefreshCount = 60;
  _autoRefreshInterval = setInterval(function() {
    if (!_autoRefreshOn) return;
    _autoRefreshCount--;
    var el = document.getElementById('autoRefreshTimer');
    if (el) el.textContent = _autoRefreshCount + 's';
    if (_autoRefreshCount <= 0) {
      _autoRefreshCount = 60;
      if (window.refreshAll) window.refreshAll();
    }
  }, 1000);
}

window.toggleAutoRefresh = function() {
  _autoRefreshOn = !_autoRefreshOn;
  var el = document.getElementById('autoRefreshBadge');
  if (el) el.style.opacity = _autoRefreshOn ? '1' : '.4';
  if (window.showToast) window.showToast(_autoRefreshOn ? 'Auto-actualización activada (60s)' : 'Auto-actualización pausada', _autoRefreshOn ? 'success' : 'info');
};
startAutoRefresh();

// ── 7. Compact mode toggle ────────────────────────────────────────────────
window.toggleCompact = function() {
  document.body.classList.toggle('compact');
  var isCompact = document.body.classList.contains('compact');
  try { localStorage.setItem('karpus_compact', isCompact ? '1' : '0'); } catch(_) {}
  if (window.showToast) window.showToast(isCompact ? 'Modo compacto activado' : 'Modo compacto desactivado', 'info');
};
try { if (localStorage.getItem('karpus_compact') === '1') document.body.classList.add('compact'); } catch(_) {}

// ── 8. Fullscreen toggle ──────────────────────────────────────────────────
window.toggleFullscreen = function() {
  document.body.classList.toggle('fullscreen');
  var isFull = document.body.classList.contains('fullscreen');
  try { localStorage.setItem('karpus_fullscreen', isFull ? '1' : '0'); } catch(_) {}
  if (isFull && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(function() {});
  } else if (!isFull && document.fullscreenElement) {
    document.exitFullscreen().catch(function() {});
  }
};
try { if (localStorage.getItem('karpus_fullscreen') === '1') document.body.classList.add('fullscreen'); } catch(_) {}

// ── 9. Print mode ────────────────────────────────────────────────────────
window.togglePrintMode = function() {
  window.print();
};

// ── 10. Column sort on tables ────────────────────────────────────────────
document.addEventListener('click', function(e) {
  var th = e.target.closest('.tbl th');
  if (!th) return;
  var thead = th.closest('thead');
  if (!thead) return;
  var table = th.closest('.tbl');
  if (!table) return;
  var tbody = table.querySelector('tbody');
  if (!tbody || tbody.rows.length < 2) return;
  var idx = Array.from(th.parentNode.children).indexOf(th);
  var isAsc = th.classList.contains('sorted-asc');
  th.parentNode.querySelectorAll('th').forEach(function(h) { h.classList.remove('sorted-asc', 'sorted-desc'); });
  th.classList.add(isAsc ? 'sorted-desc' : 'sorted-asc');
  var rows = Array.from(tbody.rows);
  rows.sort(function(a, b) {
    var va = (a.children[idx] ? a.children[idx].textContent : '').trim();
    var vb = (b.children[idx] ? b.children[idx].textContent : '').trim();
    var na = parseFloat(va.replace(/[^0-9.,\-]/g, '').replace(',', '.'));
    var nb = parseFloat(vb.replace(/[^0-9.,\-]/g, '').replace(',', '.'));
    if (!isNaN(na) && !isNaN(nb)) return isAsc ? nb - na : na - nb;
    return isAsc ? vb.localeCompare(va, 'es') : va.localeCompare(vb, 'es');
  });
  rows.forEach(function(r) { tbody.appendChild(r); });
  if (!th.querySelector('.sort-icon')) {
    var sp = document.createElement('span');
    sp.className = 'sort-icon';
    sp.textContent = ' \u25B2';
    th.appendChild(sp);
  }
  var icon = th.querySelector('.sort-icon');
  if (icon) icon.textContent = isAsc ? ' \u25BC' : ' \u25B2';
});

// ── 11. Loading skeletons for tables ─────────────────────────────────────
window.showTableSkeleton = function(tbodyId, rows, cols) {
  rows = rows || 5;
  cols = cols || 6;
  var tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  var html = '';
  for (var r = 0; r < rows; r++) {
    html += '<tr class="skel-row">';
    for (var c = 0; c < cols; c++) {
      var w = 50 + Math.random() * 40;
      html += '<td><div class="skel" style="width:' + w + '%;height:14px;"></div></td>';
    }
    html += '</tr>';
  }
  tbody.innerHTML = html;
};

// ── 12. Confirmation dialog ──────────────────────────────────────────────
window.confirmAction = function(msg) {
  return new Promise(function(resolve) {
    resolve(window.confirm(msg));
  });
};

// ── 13. Keyboard shortcuts: number keys for sections ─────────────────────
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  var sectionMap = { '1': 'dashboard', '2': 'auditoria', '3': 'usuarios', '4': 'muro', '5': 'chat', '6': 'pagos', '7': 'asistencia', '8': 'analytics', '9': 'configuracion' };
  if (sectionMap[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (window.goTo) window.goTo(sectionMap[e.key]);
  }
  // F5/Ctrl+R override: refreshAll
  if (e.key === 'F5' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (window.refreshAll) window.refreshAll();
  }
});

// ── 14. Toast dismiss on swipe ──────────────────────────────────────────
(function() {
  var touchStartX = 0;
  document.addEventListener('touchstart', function(e) {
    var toast = e.target.closest('.toast');
    if (!toast) return;
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchend', function(e) {
    var toast = e.target.closest('.toast');
    if (!toast) return;
    var dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 60) {
      toast.classList.add('out');
      setTimeout(function() { toast.remove(); }, 320);
    }
  }, { passive: true });
})();

// ── 15. URL hash-based navigation ────────────────────────────────────────
(function() {
  var hash = window.location.hash.replace('#', '');
  if (hash && document.getElementById('sec-' + hash)) {
    setTimeout(function() { if (window.goTo) window.goTo(hash); }, 500);
  }
  window.addEventListener('hashchange', function() {
    var h = window.location.hash.replace('#', '');
    if (h && document.getElementById('sec-' + h) && window.goTo) window.goTo(h);
  });
})();

// Update URL hash on navigation — hook into goTo via MutationObserver
(function() {
  var lastSection = '';
  var observer = new MutationObserver(function() {
    var active = document.querySelector('.section.active');
    if (active) {
      var id = active.id.replace('sec-', '');
      if (id !== lastSection) {
        lastSection = id;
        try { history.replaceState(null, '', '#' + id); } catch(_) {}
      }
    }
  });
  // Observe all sections for class changes
  setTimeout(function() {
    document.querySelectorAll('.section').forEach(function(sec) {
      observer.observe(sec, { attributes: true, attributeFilter: ['class'] });
    });
  }, 300);
})();

// ── 16. Back/forward browser buttons ─────────────────────────────────────
window.addEventListener('popstate', function() {
  var h = window.location.hash.replace('#', '');
  if (h && document.getElementById('sec-' + h) && window.goTo) window.goTo(h);
});

// ── 17. Copy text on double-click (table cells) ─────────────────────────
document.addEventListener('dblclick', function(e) {
  var td = e.target.closest('.tbl td');
  if (!td) return;
  var text = td.textContent.trim();
  if (!text) return;
  navigator.clipboard.writeText(text).then(function() {
    if (window.showToast) window.showToast('Copiado: ' + text.slice(0, 40) + (text.length > 40 ? '...' : ''), 'info');
  }).catch(function() {});
});

// ── 18. KPI animated counters ───────────────────────────────────────────
window.animateKPI = function(elementId, target, prefix, suffix) {
  prefix = prefix || '';
  suffix = suffix || '';
  var el = document.getElementById(elementId);
  if (!el) return;
  var start = parseInt(el.textContent.replace(/[^0-9]/g, '')) || 0;
  var diff = target - start;
  if (diff === 0) { el.textContent = prefix + target.toLocaleString('es-DO') + suffix; return; }
  var steps = 20;
  var step = 0;
  var timer = setInterval(function() {
    step++;
    var progress = step / steps;
    var eased = 1 - Math.pow(1 - progress, 3);
    var current = Math.round(start + diff * eased);
    el.textContent = prefix + current.toLocaleString('es-DO') + suffix;
    if (step >= steps) clearInterval(timer);
  }, 25);
};

// ── 19. Breadcrumb trail ────────────────────────────────────────────────
(function() {
  var trail = [];
  var maxTrail = 5;
  // Hook into section changes via MutationObserver
  setTimeout(function() {
    document.querySelectorAll('.section').forEach(function(sec) {
      new MutationObserver(function() {
        if (sec.classList.contains('active')) {
          var id = sec.id.replace('sec-', '');
          if (trail[trail.length - 1] !== id) {
            trail.push(id);
            if (trail.length > maxTrail) trail.shift();
          }
        }
      }).observe(sec, { attributes: true, attributeFilter: ['class'] });
    });
  }, 300);
  window.goBack = function() {
    if (trail.length > 1) {
      trail.pop();
      var prev = trail[trail.length - 1];
      trail.pop();
      if (window.goTo) window.goTo(prev);
    }
  };
})();

// ── 20. Session timer display ───────────────────────────────────────────
(function() {
  var startTime = Date.now();
  setInterval(function() {
    var elapsed = Date.now() - startTime;
    var mins = Math.floor(elapsed / 60000);
    var hrs = Math.floor(mins / 60);
    mins = mins % 60;
    var clockEl = document.getElementById('topClock');
    if (clockEl) {
      var now = new Date();
      var timeStr = now.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
      clockEl.textContent = timeStr + (hrs > 0 ? ' (' + hrs + 'h ' + mins + 'm)' : '');
    }
  }, 10000);
  // Initial
  setTimeout(function() {
    var clockEl = document.getElementById('topClock');
    if (clockEl) {
      var now = new Date();
      clockEl.textContent = now.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
    }
  }, 500);
})();

// ── 21. Responsive font scaling ─────────────────────────────────────────
(function() {
  function adjustFont() {
    var w = window.innerWidth;
    var base = w < 420 ? 13 : w < 768 ? 14 : 15;
    document.documentElement.style.fontSize = base + 'px';
  }
  adjustFont();
  window.addEventListener('resize', adjustFont);
})();

// ── 22. Empty state illustrations ────────────────────────────────────────
window.showEmptyState = function(containerId, icon, title, subtitle) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:48px 20px;">' +
    '<div style="font-size:48px;margin-bottom:12px;opacity:.3;">' + (icon || '📭') + '</div>' +
    '<div style="font-size:15px;font-weight:900;color:var(--text);margin-bottom:6px;">' + (title || 'Sin datos') + '</div>' +
    '<div style="font-size:12px;color:var(--muted);max-width:280px;margin:0 auto;">' + (subtitle || 'No hay registros disponibles en este momento.') + '</div>' +
    '</div>';
};

// ── 23. User quick-view popover ──────────────────────────────────────────
(function() {
  var popTimer = null;
  var popEl = null;

  document.addEventListener('mouseover', function(e) {
    var userCell = e.target.closest('[data-user-id]');
    if (!userCell) { hidePop(); return; }
    clearTimeout(popTimer);
    popTimer = setTimeout(function() {
      var uid = userCell.getAttribute('data-user-id');
      if (!uid) return;
      // Try to find user in global data (if available)
      var users = window._allUsers || [];
      var user = users.find(function(u) { return u.id === uid; });
      if (!user) return;
      if (!popEl) {
        popEl = document.createElement('div');
        popEl.style.cssText = 'position:fixed;z-index:99999;background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:0 16px 48px rgba(0,0,0,.5);max-width:280px;pointer-events:none;animation:fadeUp .2s ease;';
        document.body.appendChild(popEl);
      }
      var rect = userCell.getBoundingClientRect();
      popEl.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';
      popEl.style.top = (rect.bottom + 8) + 'px';
      popEl.innerHTML = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
        '<div style="width:36px;height:36px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:white;">' + ((user.name || '?')[0] || '?').toUpperCase() + '</div>' +
        '<div><div style="font-size:13px;font-weight:900;color:var(--text);">' + (user.name || '—') + '</div>' +
        '<div style="font-size:11px;color:var(--muted);">' + (user.email || '—') + '</div></div></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        '<span class="badge badge-' + (user.role === 'admin' ? 'red' : user.role === 'maestra' ? 'green' : user.role === 'directora' ? 'orange' : 'blue') + '">' + (user.role || '?') + '</span>' +
        (user.phone ? '<span class="badge badge-gray">📞 ' + user.phone + '</span>' : '') +
        '</div>';
      popEl.style.display = 'block';
    }, 400);
  });

  function hidePop() {
    clearTimeout(popTimer);
    if (popEl) popEl.style.display = 'none';
  }
  document.addEventListener('mouseout', function(e) {
    if (!e.target.closest('[data-user-id]')) hidePop();
  });
})();

// ── 24. Dark mode pattern background ─────────────────────────────────────
(function() {
  var canvas = document.createElement('canvas');
  canvas.width = 60;
  canvas.height = 60;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = 'rgba(99,102,241,.015)';
  ctx.fillRect(0, 0, 60, 60);
  ctx.fillStyle = 'rgba(99,102,241,.025)';
  ctx.beginPath();
  ctx.arc(30, 30, 1, 0, Math.PI * 2);
  ctx.fill();
  var dataUrl = canvas.toDataURL();
  document.body.style.backgroundImage = 'url(' + dataUrl + '),radial-gradient(ellipse at 20% 0%,rgba(99,102,241,.06) 0%,transparent 50%),radial-gradient(ellipse at 80% 100%,rgba(139,92,246,.04) 0%,transparent 50%)';
})();

// ── 25. Export generic table to CSV ──────────────────────────────────────
window.exportTableCSV = function(tableId, filename) {
  var table = document.getElementById(tableId);
  if (!table) return;
  var rows = [];
  table.querySelectorAll('tr').forEach(function(tr) {
    var cols = [];
    tr.querySelectorAll('th, td').forEach(function(cell) {
      var text = cell.textContent.trim().replace(/"/g, '""');
      cols.push('"' + text + '"');
    });
    if (cols.length) rows.push(cols.join(','));
  });
  var csv = rows.join('\n');
  var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = (filename || 'export') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  URL.revokeObjectURL(link.href);
  if (window.showToast) window.showToast('CSV exportado correctamente', 'success');
};

// ── Escape HTML helper ──────────────────────────────────────────────────
function escH(s) {
  var d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ── Make escH available globally for main.js ────────────────────────────
if (!window.escH) window.escH = escH;

// ── Re-export tab switchers globally ────────────────────────────────────
window.switchWallTab = switchWallTab;
window.switchChatTab = switchChatTab;
window.switchAnalyticsTab = switchAnalyticsTab;
window.openLightbox = openLightbox;
