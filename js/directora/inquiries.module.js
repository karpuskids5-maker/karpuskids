import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { UI } from './ui.module.js';

export const InquiriesModule = {
  _allInquiries: [],

  async init() {
    const container = document.getElementById('reportsList');
    if (!container) return;
    
    container.innerHTML = '<div class="col-span-3 text-center p-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div></div>';
    try {
      const res = await DirectorApi.getInquiries();
      const inquiries = res?.data || [];
      if (res?.error) throw new Error(res.error);

      this._allInquiries = inquiries;
      container.innerHTML = inquiries.map((item, idx) => UI.renderInquiryCard(item, idx)).join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('Error initReports:', e);
      container.innerHTML = '<div class="col-span-3 text-center p-8 text-red-500">Error al cargar reportes.</div>';
    }
  },

  filter(status) {
    const container = document.getElementById('reportsList');
    if (!container) return;

    let filtered = this._allInquiries;
    if (status === 'pending') filtered = this._allInquiries.filter(i => i.status !== 'resolved' && i.status !== 'closed');
    if (status === 'resolved') filtered = this._allInquiries.filter(i => i.status === 'resolved' || i.status === 'closed');
    
    if (!filtered.length) {
      container.innerHTML = Helpers.emptyState('No hay reportes con este estado');
      return;
    }
    
    container.innerHTML = filtered.map((item, idx) => UI.renderInquiryCard(item, idx)).join('');
    if (window.lucide) lucide.createIcons();
    
    const btns = document.querySelectorAll('#reportsFilters button');
    btns.forEach(b => {
       const onclick = b.getAttribute('onclick');
       if(onclick && onclick.includes(`'${status}'`)) {
         b.className = "px-4 py-2 rounded-full bg-slate-800 text-white text-xs font-bold shadow-md transition-all";
       } else {
         b.className = "px-4 py-2 rounded-full bg-white text-slate-600 border border-slate-200 text-xs font-bold hover:bg-slate-50 transition-all";
       }
    });
  },

  async openDetail(id) {
    try {
      const item = this._allInquiries.find(i => i.id == id);
      if (!item) return Helpers.toast('Reporte no encontrado', 'warning');
      
      const modalHTML = `
        <div class="modal-header p-6 bg-indigo-600 text-white rounded-t-3xl flex justify-between items-center">
          <h3 class="text-xl font-bold">Detalle de Reporte</h3>
          <button onclick="App.ui.closeModal()" class="text-white/70 hover:text-white"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body p-8 space-y-4 bg-white">
          <div><label class="text-[10px] font-black text-slate-400 uppercase">Asunto</label><p class="font-bold text-slate-800">${Helpers.escapeHTML(item.subject)}</p></div>
          <div><label class="text-[10px] font-black text-slate-400 uppercase">Padre</label><p class="text-slate-600">${Helpers.escapeHTML(item.parent?.name)} (${item.parent?.email})</p></div>
          <div><label class="text-[10px] font-black text-slate-400 uppercase">Mensaje</label><p class="text-sm bg-slate-50 p-4 rounded-2xl text-slate-600 border border-slate-100">${Helpers.escapeHTML(item.message)}</p></div>
          ${item.attachment_url ? `<div><label class="text-[10px] font-black text-slate-400 uppercase">Adjunto</label><img src="${item.attachment_url}" class="w-full rounded-2xl mt-2 border border-slate-100 shadow-sm"></div>` : ''}
        </div>
        <div class="modal-footer p-6 bg-slate-50 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">
          <button onclick="App.inquiries.reply('${item.id}')" class="px-8 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-md">Responder</button>
          <button onclick="App.ui.closeModal()" class="px-8 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-all">Cerrar</button>
        </div>`;
      window.openGlobalModal(modalHTML);
    } catch (e) { console.error(e); }
  },

  async reply(id) {
    const reply = prompt('Escribe tu respuesta para el padre:');
    if (!reply) return;
    try {
      await DirectorApi.updateInquiry(id, { status: 'in_progress', internal_notes: reply });
      Helpers.toast('Respuesta registrada', 'success');
      this.init();
    } catch (e) { console.error(e); }
  }
};
