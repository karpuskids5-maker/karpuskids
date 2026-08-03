/**
 * 🗑️ Karpus Confirm Dialog — shared across all panels
 * Usage: await window.karpusConfirm('Title', 'Message') → true/false
 */
(function () {
  if (window._karpusConfirmDelete) return; // already loaded

  window._karpusConfirmDelete = function (title, message) {
    return new Promise(resolve => {
      const uid = 'kcd-' + Date.now();
      const el  = document.createElement('div');
      el.id = uid;
      el.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);padding:16px';
      el.innerHTML =
        '<div style="background:#fff;border-radius:24px;box-shadow:0 25px 60px rgba(0,0,0,0.2);width:100%;max-width:360px;padding:28px;text-align:center">' +
          '<div style="width:56px;height:56px;background:#fee2e2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:24px">⚠️</div>' +
          '<h3 style="margin:0 0 8px;font-size:17px;font-weight:900;color:#1e293b">' + (title || '¿Confirmar?') + '</h3>' +
          '<p style="margin:0 0 24px;font-size:13px;color:#64748b;line-height:1.5">' + (message || 'Esta acción no se puede deshacer.') + '</p>' +
          '<div style="display:flex;gap:10px">' +
            '<button id="' + uid + '-no"  style="flex:1;padding:12px;background:#f1f5f9;color:#475569;border:none;border-radius:14px;font-weight:900;font-size:12px;text-transform:uppercase;cursor:pointer">Cancelar</button>' +
            '<button id="' + uid + '-yes" style="flex:1;padding:12px;background:#dc2626;color:#fff;border:none;border-radius:14px;font-weight:900;font-size:12px;text-transform:uppercase;cursor:pointer;box-shadow:0 4px 12px rgba(220,38,38,0.3)">Sí, eliminar</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(el);
      document.getElementById(uid + '-yes').onclick = () => { el.remove(); resolve(true); };
      document.getElementById(uid + '-no').onclick  = () => { el.remove(); resolve(false); };
      el.addEventListener('click', e => { if (e.target === el) { el.remove(); resolve(false); } });
    });
  };
})();
