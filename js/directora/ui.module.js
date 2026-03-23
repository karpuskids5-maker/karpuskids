import { Helpers } from '../shared/helpers.js';

/**
 * 🎨 UI HELPERS & COMPONENTS
 */
export const UIHelpers = {
  setLoading(isLoading, containerSelector = '#globalModalContainer', btnSelector = null) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    if (isLoading) {
      const loader = document.createElement('div');
      loader.id = 'ui-loading-overlay';
      loader.className = 'absolute inset-0 bg-white/60 backdrop-blur-[2px] z-[100] flex items-center justify-center rounded-3xl animate-fade-in';
      loader.innerHTML = `
        <div class="flex flex-col items-center gap-3">
          <div class="w-12 h-12 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
          <span class="text-[10px] font-black text-indigo-600 uppercase tracking-widest animate-pulse">Procesando...</span>
        </div>`;
      container.style.position = 'relative';
      container.appendChild(loader);
      if (btnSelector) {
        const btn = document.querySelector(btnSelector);
        if (btn) {
          btn.disabled = true;
          btn.classList.add('opacity-50', 'cursor-not-allowed');
        }
      }
    } else {
      const loader = document.getElementById('ui-loading-overlay');
      if (loader) loader.remove();
      if (btnSelector) {
        const btn = document.querySelector(btnSelector);
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
      }
    }
  },
  
  closeModal(modalSelector = '#globalModalContainer') {
    if (modalSelector === '#globalModalContainer') {
      const container = document.getElementById('globalModalContainer');
      if (container) {
        container.style.display = 'none';
        container.innerHTML = '';
      }
    } else {
      const modal = document.querySelector(modalSelector);
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('active');
      }
    }
  }
};

/**
 * 🏛️ DIRECTOR UI COMPONENTS
 */
export const DirectorUI = {
  renderStudentCard(s) {
    const avatar = s.avatar_url 
      ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` 
      : `<div class="w-full h-full flex items-center justify-center text-xl font-black text-purple-600 bg-purple-50">${(s.name || '?').charAt(0)}</div>`;
    
    return `
      <div class="bg-white rounded-[2.5rem] p-6 border-2 border-slate-100 hover:border-purple-200 transition-all hover:shadow-xl hover:shadow-purple-100/50 group relative overflow-hidden">
        <div class="absolute top-0 right-0 w-32 h-32 bg-purple-50 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110"></div>
        
        <div class="relative flex flex-col items-center text-center">
          <div class="w-24 h-24 rounded-[2.2rem] p-1.5 bg-gradient-to-tr from-purple-500 to-indigo-500 mb-4 shadow-lg shadow-purple-200 group-hover:rotate-3 transition-transform">
            <div class="w-full h-full rounded-[1.8rem] bg-white overflow-hidden border-4 border-white">
              ${avatar}
            </div>
          </div>
          
          <h3 class="text-lg font-black text-slate-800 leading-tight mb-1 group-hover:text-purple-600 transition-colors">${Helpers.escapeHTML(s.name)}</h3>
          <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">${s.classrooms?.name || 'Sin Aula Asignada'}</p>
          
          <div class="grid grid-cols-2 gap-2 w-full mb-6">
            <div class="bg-slate-50 rounded-2xl p-2.5 border border-slate-100">
              <div class="text-[9px] font-black text-slate-400 uppercase mb-0.5">Asistencia</div>
              <div class="text-xs font-bold text-slate-700">92%</div>
            </div>
            <div class="bg-slate-50 rounded-2xl p-2.5 border border-slate-100">
              <div class="text-[9px] font-black text-slate-400 uppercase mb-0.5">Promedio</div>
              <div class="text-xs font-bold text-slate-700">9.5</div>
            </div>
          </div>
          
          <div class="flex gap-2 w-full">
            <button onclick="App.students.edit('${s.id}')" class="flex-1 py-3 bg-slate-800 text-white rounded-2xl font-black text-[10px] uppercase tracking-wider hover:bg-slate-900 transition-all active:scale-95 shadow-lg shadow-slate-200">Editar</button>
            <button onclick="App.students.delete('${s.id}')" class="w-12 h-12 flex items-center justify-center bg-rose-50 text-rose-500 rounded-2xl hover:bg-rose-500 hover:text-white transition-all active:scale-95 border border-rose-100">
              <i data-lucide="trash-2" class="w-5 h-5"></i>
            </button>
          </div>
        </div>
      </div>`;
  },

  renderTeacherCard(t) {
    const avatar = t.avatar_url 
      ? `<img src="${t.avatar_url}" class="w-full h-full object-cover">` 
      : `<div class="w-full h-full flex items-center justify-center text-xl font-black text-rose-600 bg-rose-50">${(t.name || '?').charAt(0)}</div>`;

    const roleLabel = t.role === 'asistente' ? 'Auxiliar' : 'Titular';
    const roleClass = t.role === 'asistente' ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600';
    
    // 🔥 FIX: Obtener nombre del aula correctamente
    const classroomName = t.classroom_id ? (t.classrooms?.name || 'Aula Asignada') : 'Sin Aula';

    return `
      <div class="bg-white rounded-[2.5rem] p-6 border-2 border-slate-100 hover:border-rose-200 transition-all hover:shadow-xl hover:shadow-rose-100/50 group relative overflow-hidden">
        <div class="absolute top-4 right-4 z-10">
          <span class="px-3 py-1 rounded-full text-[9px] font-black uppercase ${roleClass} shadow-sm border border-white/50">${roleLabel}</span>
        </div>
        
        <div class="relative flex flex-col items-center text-center mt-2">
          <div class="w-24 h-24 rounded-[2.2rem] p-1.5 bg-gradient-to-tr from-rose-500 to-pink-500 mb-4 shadow-lg shadow-rose-200 group-hover:-rotate-3 transition-transform">
            <div class="w-full h-full rounded-[1.8rem] bg-white overflow-hidden border-4 border-white">
              ${avatar}
            </div>
          </div>
          
          <h3 class="text-lg font-black text-slate-800 leading-tight mb-1 group-hover:text-rose-600 transition-colors">${Helpers.escapeHTML(t.name)}</h3>
          <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-1.5">
            <i data-lucide="home" class="w-3 h-3"></i> ${classroomName}
          </p>
          
          <div class="flex gap-2 w-full">
            <button onclick="App.teachers.edit('${t.id}')" class="flex-1 py-3 bg-slate-800 text-white rounded-2xl font-black text-[10px] uppercase tracking-wider hover:bg-slate-900 transition-all active:scale-95 shadow-lg shadow-slate-200">Gestionar</button>
            <a href="tel:${t.phone || ''}" class="w-12 h-12 flex items-center justify-center bg-emerald-50 text-emerald-600 rounded-2xl hover:bg-emerald-500 hover:text-white transition-all active:scale-95 border border-emerald-100">
              <i data-lucide="phone" class="w-5 h-5"></i>
            </a>
          </div>
        </div>
      </div>`;
  },

  renderClassroomRow(r) {
    const percent = r.max_capacity ? Math.round((r.current_capacity / r.max_capacity) * 100) : 0;
    const colorClass = percent >= 90 ? 'bg-rose-500' : percent >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
    
    return `
      <tr class="hover:bg-slate-50/80 transition-colors group border-b border-slate-50">
        <td class="px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black">
              <i data-lucide="home" class="w-5 h-5"></i>
            </div>
            <div>
              <div class="font-black text-slate-800 text-sm group-hover:text-indigo-600 transition-colors">${Helpers.escapeHTML(r.name)}</div>
              <div class="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Capacidad: ${r.max_capacity || '∞'}</div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center">
              <i data-lucide="user" class="w-4 h-4"></i>
            </div>
            <div>
              <div class="text-xs font-bold text-slate-700">${Helpers.escapeHTML(r.teacher?.name || 'Sin Maestra')}</div>
              <div class="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Responsable</div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4">
          <div class="max-w-[120px]">
            <div class="flex justify-between items-center mb-1.5">
              <span class="text-[10px] font-black text-slate-500 uppercase">${r.current_capacity} / ${r.max_capacity || 0}</span>
              <span class="text-[10px] font-black ${percent >= 90 ? 'text-rose-600' : 'text-slate-400'}">${percent}%</span>
            </div>
            <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden p-0.5">
              <div class="h-full ${colorClass} rounded-full transition-all duration-1000" style="width: ${percent}%"></div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4 text-right">
          <div class="flex justify-end gap-2">
            <button onclick="App.rooms.openModal('${r.id}')" class="p-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95">
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button class="p-2.5 bg-white border border-slate-200 text-rose-500 rounded-xl hover:bg-rose-50 hover:border-rose-200 transition-all shadow-sm active:scale-95">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      </tr>`;
  },

  renderInquiryCard(item, idx) {
    const statusMap = {
      pending: { label: 'Pendiente', class: 'bg-amber-100 text-amber-700' },
      resolved: { label: 'Resuelto', class: 'bg-emerald-100 text-emerald-700' },
      closed: { label: 'Cerrado', class: 'bg-slate-100 text-slate-500' },
      in_progress: { label: 'En Proceso', class: 'bg-blue-100 text-blue-700' }
    };
    const status = statusMap[item.status] || { label: item.status, class: 'bg-slate-100 text-slate-700' };
    
    return `
      <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-50 hover:border-indigo-100 hover:shadow-xl transition-all group">
        <div class="flex justify-between items-start mb-4">
          <span class="px-3 py-1 rounded-full text-[9px] font-black uppercase ${status.class}">${status.label}</span>
          <span class="text-[10px] font-bold text-slate-400">${new Date(item.created_at).toLocaleDateString()}</span>
        </div>
        <h4 class="font-black text-slate-800 mb-2 group-hover:text-indigo-600 transition-colors">${Helpers.escapeHTML(item.subject)}</h4>
        <p class="text-xs text-slate-500 line-clamp-2 mb-4 leading-relaxed">${Helpers.escapeHTML(item.message)}</p>
        
        <div class="flex items-center gap-3 pt-4 border-t border-slate-50 mt-auto">
          <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
            ${(item.parent?.name || 'P').charAt(0)}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[11px] font-bold text-slate-700 truncate">${Helpers.escapeHTML(item.parent?.name || 'Padre')}</div>
            <div class="text-[9px] font-black text-slate-400 uppercase tracking-tighter">${item.parent?.email || ''}</div>
          </div>
          <button onclick="App.inquiries.openDetail('${item.id}')" class="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-600 hover:text-white transition-all">
            <i data-lucide="eye" class="w-4 h-4"></i>
          </button>
        </div>
      </div>`;
  }
};
