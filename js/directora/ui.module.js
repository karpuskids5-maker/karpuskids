import { Helpers } from '../shared/helpers.js';

/**
 * 🎨 UI HELPERS & COMPONENTS
 */
const UIHelpers = {
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
const DirectorUI = {
  renderDashboard(data) {
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    
    // KPIs
    setTxt('kpiStudents', data.students.totalStudents);
    setTxt('kpiTeachers', data.kpis.total_teachers || 0);
    setTxt('kpiClassrooms', data.classrooms.length);
    setTxt('kpiAttendance', data.attendance.today.present);
    setTxt('kpiPendingMoney', `$${data.payments.summary.total_pending || 0}`);
    setTxt('kpiIncidents', data.inquiries.count);
    
    // Si hay más elementos que actualizar, se agregan aquí
    if (window.lucide) lucide.createIcons();
  },

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
            <button data-id="${s.id}" class="btn-student-edit flex-1 py-3 bg-slate-800 text-white rounded-2xl font-black text-[10px] uppercase tracking-wider hover:bg-slate-900 transition-all active:scale-95 shadow-lg shadow-slate-200">Editar</button>
            <button data-id="${s.id}" class="btn-student-delete w-12 h-12 flex items-center justify-center bg-rose-50 text-rose-500 rounded-2xl hover:bg-rose-500 hover:text-white transition-all active:scale-95 border border-rose-100">
              <i data-lucide="trash-2" class="w-5 h-5"></i>
            </button>
          </div>
        </div>
      </div>`;
  },

  renderTeacherCard(t) {
    const avatar = t.avatar_url 
      ? `<img src="${t.avatar_url}" class="w-full h-full object-cover">` 
      : `<div class="w-full h-full flex items-center justify-center text-xl font-black text-indigo-600 bg-indigo-50">${(t.name || '?').charAt(0)}</div>`;
    
    return `
      <div class="bg-white rounded-3xl p-6 border border-slate-100 hover:shadow-xl transition-all group">
        <div class="flex items-center gap-4 mb-6">
          <div class="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-2xl overflow-hidden shadow-inner">
            ${avatar}
          </div>
          <div class="min-w-0">
            <h3 class="font-black text-slate-800 text-lg truncate">${Helpers.escapeHTML(t.name)}</h3>
            <p class="text-[10px] font-black uppercase tracking-widest text-indigo-500">${t.role}</p>
          </div>
        </div>
        <div class="space-y-2 mb-6">
          <div class="flex items-center gap-2 text-xs text-slate-500">
            <i data-lucide="mail" class="w-3.5 h-3.5"></i> ${t.email}
          </div>
          <div class="flex items-center gap-2 text-xs text-slate-500">
            <i data-lucide="phone" class="w-3.5 h-3.5"></i> ${t.phone || 'No asignado'}
          </div>
          <div class="flex items-center gap-2 text-xs text-slate-500">
            <i data-lucide="home" class="w-3.5 h-3.5"></i> ${t.classrooms?.name || 'Sin aula'}
          </div>
        </div>
        <div class="flex gap-2">
          <button data-id="${t.id}" class="btn-teacher-edit flex-1 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase hover:bg-indigo-600 transition-all">Gestionar</button>
        </div>
      </div>`;
  },

  renderClassroomRow(r) {
    const occupancy = r.student_count || 0;
    const capacity = r.capacity || 20;
    const percent = Math.round((occupancy / capacity) * 100);
    const progressColor = percent > 90 ? 'bg-rose-500' : percent > 70 ? 'bg-amber-500' : 'bg-emerald-500';

    return `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="py-4 px-6">
          <div class="font-bold text-slate-800">${Helpers.escapeHTML(r.name)}</div>
          <div class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">${r.level || 'General'}</div>
        </td>
        <td class="py-4 px-6">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold">
              ${(r.profiles?.name || '?').charAt(0)}
            </div>
            <div class="text-sm font-medium text-slate-600">${Helpers.escapeHTML(r.profiles?.name || 'Sin asignar')}</div>
          </div>
        </td>
        <td class="py-4 px-6">
          <div class="flex items-center gap-4">
            <div class="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden max-w-[100px]">
              <div class="${progressColor} h-full rounded-full" style="width: ${percent}%"></div>
            </div>
            <span class="text-xs font-bold text-slate-500">${occupancy}/${capacity}</span>
          </div>
        </td>
        <td class="py-4 px-6 text-center">
          <button onclick="App.rooms.openModal('${r.id}')" class="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all">
            <i data-lucide="edit-3" class="w-4 h-4"></i>
          </button>
        </td>
      </tr>`;
  },

  renderInquiryCard(item, idx) {
    const statusColor = {
      'pending': 'bg-amber-100 text-amber-700 border-amber-200',
      'in_progress': 'bg-blue-100 text-blue-700 border-blue-200',
      'resolved': 'bg-emerald-100 text-emerald-700 border-emerald-200',
      'closed': 'bg-slate-100 text-slate-700 border-slate-200'
    }[item.status] || 'bg-slate-100 text-slate-700';

    return `
      <div class="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-all">
        <div class="flex justify-between items-start mb-4">
          <span class="text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${statusColor}">${item.status}</span>
          <span class="text-[10px] font-bold text-slate-400">${new Date(item.created_at).toLocaleDateString()}</span>
        </div>
        <h3 class="font-bold text-slate-800 mb-1 truncate">${Helpers.escapeHTML(item.subject)}</h3>
        <p class="text-xs text-slate-500 mb-4 line-clamp-2">${Helpers.escapeHTML(item.message)}</p>
        <div class="flex items-center justify-between pt-4 border-t border-slate-50">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
              ${(item.parent?.name || '?').charAt(0)}
            </div>
            <div class="text-[10px] font-bold text-slate-600">${Helpers.escapeHTML(item.parent?.name || 'Padre')}</div>
          </div>
          <button data-id="${item.id}" class="btn-inquiry-detail text-indigo-600 hover:text-indigo-800 font-bold text-xs">Ver Detalle</button>
        </div>
      </div>`;
  }
};

export const UI = { ...UIHelpers, ...DirectorUI };
export { UIHelpers, DirectorUI };
