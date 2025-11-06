// js/panel_directora/ui.js

export const qs = s => document.querySelector(s);
export const qsa = s => Array.from(document.querySelectorAll(s));

export function openModal(title, htmlBody, actions = []) {
  const mc = qs('#modalContainer');
  mc.innerHTML = '';
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50';
  const modal = document.createElement('div');
  modal.className = 'bg-white rounded-lg p-6 w-full max-w-xl mx-4';
  modal.innerHTML = `<h3 class="font-semibold mb-3">${title}</h3><div class="mb-4">${htmlBody}</div><div class="flex justify-end gap-3" id="modalActions"></div>`;
  overlay.appendChild(modal);
  mc.appendChild(overlay);
  const actionsContainer = qs('#modalActions');
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.innerText = a.text;
    btn.className = a.type === 'primary' ? 'px-3 py-2 bg-blue-600 text-white rounded' : 'px-3 py-2 border rounded';
    btn.addEventListener('click', () => {
      if (typeof a.onClick === 'function') a.onClick();
      else closeModal();
    });
    actionsContainer.appendChild(btn);
  });
}

export function closeModal() {
  qs('#modalContainer').innerHTML = '';
}

export function adaptTablesToMobile() {
  const isMobile = window.innerWidth < 640;
  qsa('#paymentsTable tr').forEach(tr => {
    if (isMobile) {
      tr.style.display = 'block';
      tr.style.borderBottom = '1px solid #eee';
      tr.querySelectorAll('td').forEach(td => td.style.display = 'block');
    } else {
      tr.style.display = '';
      tr.querySelectorAll('td').forEach(td => td.style.display = '');
    }
  });
}
