import { supabase, emitEvent } from '../shared/supabase.js'; // supabase para búsqueda, emitEvent para logs
import { Helpers } from '../shared/helpers.js';
import { AssistantApi } from './api.js';

let isProcessing = false; // 🔥 FIX PRO: Bloqueo de doble ejecución

/**
 * Módulo de Control de Acceso para Asistente (Check-in / Check-out)
 */
export const AccessModule = {
  init() {
    const searchInput = document.getElementById('accessSearchInput');
    const resultsContainer = document.getElementById('accessSearchResults');
    
    if (searchInput) {
      searchInput.addEventListener('input', Helpers.debounce(async (e) => {
        const term = e.target.value.trim();
        if (term.length < 2) {
          resultsContainer.innerHTML = '';
          return;
        }
        
        resultsContainer.innerHTML = Helpers.skeleton(1, 'h-16');
        
        const { data: students, error } = await supabase
          .from('students')
          .select(`
            id, name, classroom_id, avatar_url,
            classroom:classroom_id (name)
          `)
          .ilike('name', `%${term}%`)
          .limit(5);
          
        if (error) {
          resultsContainer.innerHTML = Helpers.errorState('Error al buscar');
          if (window.lucide) lucide.createIcons();
          return;
        }
        
        if (!students?.length) {
          resultsContainer.innerHTML = '<p class="text-slate-400 text-[10px] font-bold">No se encontraron estudiantes</p>';
          return;
        }
        
        resultsContainer.innerHTML = students.map(s => `
          <div class="flex items-center justify-between p-3 bg-white rounded-2xl border border-slate-100 hover:shadow-md transition-all mb-2">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center text-teal-700 font-bold overflow-hidden border border-teal-50">
                ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : s.name.charAt(0)}
              </div>
              <div>
                <p class="font-bold text-slate-700 text-sm">${Helpers.escapeHTML(s.name)}</p>
                <p class="text-[10px] font-bold uppercase text-slate-400 tracking-wider">${s.classroom?.name || 'Sin aula'}</p>
              </div>
            </div>
            <div class="flex gap-2">
              <button onclick="window.App.registerAccess('${s.id}', 'check-in')" class="px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-black uppercase hover:bg-emerald-100 border border-emerald-100 flex items-center gap-1 transition-all">
                <i data-lucide="log-in" class="w-3 h-3"></i> Entrada
              </button>
              <button onclick="window.App.registerAccess('${s.id}', 'check-out')" class="px-3 py-1.5 bg-rose-50 text-rose-600 rounded-xl text-[10px] font-black uppercase hover:bg-rose-100 border border-rose-100 flex items-center gap-1 transition-all">
                <i data-lucide="log-out" class="w-3 h-3"></i> Salida
              </button>
            </div>
          </div>
        `).join('');
        
        if (window.lucide) lucide.createIcons();
      }, 300));
    }
    
    this.loadHistory();
  },

  async register(studentId, type) {
    // 🔥 MEJORA PRO: Evitar doble clic rápido
    if (isProcessing) return;
    isProcessing = true;

    const today = new Date().toISOString().split('T')[0];
    
    try {
      // 💡 MEJORA UX: Feedback inmediato
      Helpers.toast(type === 'check-in' ? 'Registrando entrada...' : 'Registrando salida...', 'info');

      if (type === 'check-in') {
         const existing = await AssistantApi.getAttendanceStatus(studentId, today);
           
         if (existing) {
           Helpers.toast('Ya tiene asistencia hoy', 'info');
           return;
         }
         
         // 💣 FIX PRO: Validación de error y existencia
         const { data: student, error } = await supabase
           .from('students').select('name, classroom_id, p1_email, p1_name').eq('id', studentId).single();
         
         if (error || !student) throw new Error('Estudiante no encontrado');
         
         await AssistantApi.checkIn(studentId, student.classroom_id, today);
         Helpers.toast('Entrada registrada', 'success');

         emitEvent('attendance.checkin', {
           student_id: studentId,
           student_name: student.name,
           parent_email: student.p1_email,
           time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
         });
      } else {
         // Registro de Salida (Check-out)
         const existing = await AssistantApi.getAttendanceStatus(studentId, today);
           
         if (!existing) {
           Helpers.toast('Sin entrada registrada hoy', 'error');
           return;
         }
         
         if (existing.check_out) {
           Helpers.toast('Salida ya registrada hoy', 'info');
           return;
         }

         await AssistantApi.checkOut(existing.id);
         Helpers.toast('Salida registrada', 'success');

         emitEvent('attendance.checkout', {
           student_id: studentId,
           student_name: existing.student?.name,
           parent_email: existing.student?.p1_email,
           time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
         });
      }
      
      // ⚠️ FIX: Esperar a que termine para ver el cambio
      await this.loadHistory();
      
      const input = document.getElementById('accessSearchInput');
      const results = document.getElementById('accessSearchResults');
      if(input) input.value = '';
      if(results) results.innerHTML = '';
      
    } catch (e) {
      console.error(e);
      Helpers.toast('Error al registrar acceso', 'error');
    } finally {
      isProcessing = false;
    }
  },
  
  async loadHistory() {
    const container = document.getElementById('accessRecentLog');
    if (!container) return;
    
    try {
      const logs = await AssistantApi.getTodayAttendance();
      
      if (!logs?.length) {
        container.innerHTML = '<p class="text-slate-400 text-center py-4 text-xs font-bold uppercase opacity-40">Sin actividad hoy</p>';
        return;
      }
      
      container.innerHTML = logs.map(log => {
        const checkInTime = log.check_in ? new Date(log.check_in).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : null;
        const checkOutTime = log.check_out ? new Date(log.check_out).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : null;
        
        return `
          <div class="flex items-center gap-3 p-3 bg-white rounded-2xl border border-slate-50 shadow-sm mb-2 hover:shadow-md transition-all">
            <div class="w-8 h-8 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 overflow-hidden shadow-sm">
              ${log.student?.avatar_url ? `<img src="${log.student.avatar_url}" class="w-full h-full object-cover">` : '<i data-lucide="user" class="w-4 h-4"></i>'}
            </div>
            <div class="flex-1">
              <p class="text-xs font-black text-slate-700 leading-tight">${Helpers.escapeHTML(log.student?.name)}</p>
              <div class="flex gap-2 text-[8px] font-bold uppercase tracking-tighter text-slate-400 mt-0.5">
                 ${checkInTime ? `<span class="flex items-center gap-0.5"><i data-lucide="log-in" class="w-2 h-2 text-emerald-500"></i> EN: ${checkInTime}</span>` : ''}
                 ${checkOutTime ? `<span class="flex items-center gap-0.5"><i data-lucide="log-out" class="w-2 h-2 text-rose-500"></i> SAL: ${checkOutTime}</span>` : ''}
              </div>
            </div>
            <div class="w-1.5 h-1.5 rounded-full ${log.check_out ? 'bg-rose-500' : (log.check_in ? 'bg-emerald-500' : 'bg-slate-300')}"></div>
          </div>
        `;
      }).join('');
      
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('Error cargando historial:', e);
      container.innerHTML = `<div class="text-center py-4 text-rose-500 text-xs font-bold">
        Error de sincronización.
        <br><span class="opacity-75 font-normal text-[10px]">${e.message || 'Verifica la consola'}</span>
      </div>`;
    }
  }
};
