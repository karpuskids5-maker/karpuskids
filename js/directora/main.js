import { ensureRole, supabase, sendPush, createClient, SUPABASE_URL, SUPABASE_ANON_KEY, initOneSignal } from '../shared/supabase.js';
import { AppState } from './state.js';
import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { WallModule as WallModuleShared } from '../shared/wall.js';
import { WallModule } from './wall.module.js';
import { DashboardService } from '../directora/dashboard.service.js';
import { VideoCallModule } from '../shared/videocall.js';

// ====================================================================================
// 🧠 0. DEFINICIÓN GLOBAL DE APP (INICIO PARA EVITAR REFERENCE ERRORS)
// ====================================================================================
window.App = window.App || {};
// Se llenará después con las funciones declaradas
// ====================================================================================
// 🧠 4. CREAR UI HELPERS (PRO LEVEL)
// ====================================================================================
const UIHelpers = {
  setLoading(state, modalSelector = '#globalModalContainer', buttonSelector = '.modal-footer button:last-child') {
    const btn = document.querySelector(`${modalSelector} ${buttonSelector}`);
    if (!btn) {
      console.warn('⚠️ Botón no encontrado para loading');
      return;
    }

    if (state) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin inline-block mr-2 w-4 h-4"></i> Guardando...`;
      window.lucide?.createIcons();
    } else {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalText || 'Guardar';
    }
  },
  
  closeModal(modalSelector = '#globalModalContainer') {
    if (modalSelector === '#globalModalContainer') {
      const container = document.getElementById('globalModalContainer');
      if (container) {
        container.classList.add('hidden');
        container.classList.remove('flex', 'active');
        container.innerHTML = '';
      }
    } else {
      const modal = document.querySelector(modalSelector);
      if (modal) modal.classList.add('hidden');
    }
  }
};

/**
 * 🛠️ SISTEMA GLOBAL DE MODALES (Single Source of Truth)
 */
function openGlobalModal(html) {
  const container = document.getElementById('globalModalContainer');
  if (!container) return;

  container.innerHTML = html;
  container.classList.remove('hidden');
  container.classList.add('flex', 'active');
  
  // 🔄 Forzar renderizado de iconos Lucide
  setTimeout(() => {
    if (window.lucide) lucide.createIcons();
  }, 0);
}

function closeGlobalModal() {
  const container = document.getElementById('globalModalContainer');
  if (container) {
    container.classList.add('hidden');
    container.classList.remove('flex', 'active');
    container.innerHTML = '';
  }
}

/**
 * 👤 CARGA DE PERFIL (Dinámico)
 */
/**
 * 👤 CARGAR PERFIL DINÁMICO (Avatar y Datos)
 */
async function loadProfile() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 🛡️ CORRECCIÓN: Pedir solo columnas existentes en tabla 'profiles'
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*') // 🔥 CAMBIO: Usar * evita error 400 si falta alguna columna específica como 'bio'
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile:', error);
      return;
    }
    if (!profile) return;

    const displayName = profile.name || 'Director(a)';
    const avatarUrl = profile.avatar_url || 'img/mundo.jpg';

    // 🔄 Actualizar todos los avatares en la UI
    document.querySelectorAll('#profileAvatar, .user-avatar-img').forEach(img => {
      img.src = avatarUrl;
      img.onerror = () => { img.src = 'img/mundo.jpg'; };
    });

    // 🔄 Actualizar todos los nombres en la UI
    document.querySelectorAll('#sidebarName, .user-name-text').forEach(el => {
      el.textContent = displayName;
    });

    // 🔄 Llenar formulario de configuración si existe
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('confDirName', profile.name || '');
    setVal('confDirBio', profile.bio);
    setVal('confPhone', profile.phone);
    setVal('confEmail', profile.email);
    setVal('confAddress', ''); // La dirección no está en la tabla profiles

    // 🛡️ Configurar listener de subida de avatar (evitar duplicados)
    const avatarInput = document.getElementById('avatarInput');
    if (avatarInput && !avatarInput.dataset.listenerSet) {
      avatarInput.dataset.listenerSet = "true";
      avatarInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
          return Helpers.toast('Máximo 2MB', 'error');
        }

        try {
          Helpers.toast('Subiendo imagen...', 'info');
          const fileExt = file.name.split('.').pop();
          const filePath = `avatars/${user.id}_${Date.now()}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from('karpus-uploads')
            .upload(filePath, file, { upsert: true });

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from('karpus-uploads')
            .getPublicUrl(filePath);

          await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
          
          // Actualizar UI en caliente
          document.querySelectorAll('#profileAvatar, .user-avatar-img').forEach(img => img.src = publicUrl);
          Helpers.toast('Foto actualizada', 'success');
        } catch (err) {
          console.error('Error uploading avatar:', err);
          Helpers.toast('Error al subir imagen', 'error');
        }
      });
    }
  } catch (err) {
    console.error('Error loadProfile:', err);
  }
}


window.openGlobalModal = openGlobalModal;
window.closeGlobalModal = closeGlobalModal;

// 🌐 Exponer UIHelpers globalmente para evitar ReferenceError en onclicks del HTML
window.UIHelpers = UIHelpers;

// 🧩 HELPER GLOBAL PARA FECHAS (ANTI-ZONA HORARIA BUG)
function getTodaySafe() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// ====================================================================================
// 🎨 MÓDULO DE UI (antes ui.js)
// ====================================================================================
const DirectorUI = {
  statusBadge: (s) => {
    const map = {
      received: 'bg-slate-100 text-slate-700',
      review: 'bg-amber-100 text-amber-700',
      in_progress: 'bg-blue-100 text-blue-700',
      resolved: 'bg-emerald-100 text-emerald-700',
      closed: 'bg-slate-200 text-slate-700'
    };
    const labels = { received:'Recibida', review:'En revisión', in_progress:'En proceso', resolved:'Resuelta', closed:'Cerrada' };
    return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${map[s]||'bg-slate-100'}">${labels[s]||s}</span>`;
  },
  prioBadge: (p) => {
    const map = { high: 'bg-red-100 text-red-700', medium: 'bg-orange-100 text-orange-700', low: 'bg-slate-100 text-slate-700' };
    const labels = { high:'Alta', medium:'Media', low:'Baja' };
    return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${map[p]||map.medium}">${labels[p]||p||'Media'}</span>`;
  },
  renderInquiryCard: (item, index) => {
    const styles = ['crayon', 'ruler', 'notebook', 'toy'];
    const icons = {'crayon': '🖍️', 'ruler': '📏', 'notebook': '📓', 'toy': '🧸'};
    const styleClass = styles[index % styles.length];
    const date = Helpers.formatDate(item.created_at);
    const folio = item.folio || `F-${String(item.id).padStart(5,'0')}`;

    return `
      <div class="child-card ${styleClass}">
        <div class="child-card-header justify-between">
          <div class="flex items-center gap-2">
            <span class="child-card-icon">${icons[styleClass]}</span>
            <div>
              <div class="font-bold text-slate-700 text-sm">${Helpers.escapeHTML(item.subject || 'Incidencia')}</div>
              <div class="text-[10px] text-slate-500">${item.parent?.name || 'Padre'} • ${date} • Folio: <span class="font-semibold">${folio}</span></div>
            </div>
          </div>
          <div class="flex items-center gap-1">${DirectorUI.prioBadge(item.priority)} ${DirectorUI.statusBadge(item.status)}</div>
        </div>
        <div class="child-card-body">
          <p class="line-clamp-3 text-xs">${Helpers.escapeHTML(item.message || '')}</p>
          ${item.attachment_url ? `<div class="mt-2 text-[10px] text-blue-600 font-bold flex items-center gap-1"><i data-lucide="image" class="w-3 h-3"></i> Contiene foto</div>` : ''}
        </div>
        <div class="child-card-footer gap-2">
          <button class="btn-inquiry-detail px-2 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-slate-50" data-id="${item.id}">Ver Detalle</button>
          ${item.status !== 'resolved' && item.status !== 'closed' 
            ? `<button class="btn-inquiry-reply px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-[10px] font-bold hover:bg-blue-200" data-id="${item.id}">Responder</button>`
            : `<span class="px-2 py-1 bg-green-100 text-green-700 rounded text-[10px] font-bold">Resuelto</span>`
          }
        </div>
      </div>
    `;
  },
  renderStudentCard: (s) => {
    const styles = ['crayon', 'ruler', 'notebook', 'toy'];
    const safeName = (s.name || '?').trim();
    const index = safeName ? safeName.charCodeAt(0) % styles.length : 0;
    const styleClass = styles[index];
    const safeAvatar = s.avatar_url ? encodeURI(s.avatar_url) : '';
    
    // Configuración infantil por estilo
    const theme = {
      crayon: { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-600', icon: '🎨', gradient: 'from-rose-400 to-pink-500' },
      ruler: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600', icon: '📏', gradient: 'from-amber-400 to-orange-500' },
      notebook: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600', icon: '📚', gradient: 'from-blue-400 to-indigo-500' },
      toy: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-600', icon: '🧸', gradient: 'from-emerald-400 to-teal-500' }
    }[styleClass];

    let statusChip = s.is_active
      ? `<span class="absolute top-4 right-4 bg-emerald-100 text-emerald-700 border-2 border-emerald-200 text-[10px] font-black uppercase px-3 py-1 rounded-full tracking-wider shadow-sm z-10">Activo</span>`
      : `<span class="absolute top-4 right-4 bg-slate-100 text-slate-500 border-2 border-slate-200 text-[10px] font-black uppercase px-3 py-1 rounded-full tracking-wider shadow-sm z-10">Inactivo</span>`;

    return `
      <div class="relative group">
        <!-- Decoración infantil -->
        <div class="absolute -top-2 -left-2 text-2xl group-hover:scale-125 transition-transform duration-300 z-10">${theme.icon}</div>
        
        <div class="${theme.bg} rounded-[2rem] shadow-lg border-4 ${theme.border} p-6 hover:shadow-xl transition-all duration-300 relative overflow-hidden flex flex-col h-full">
          <!-- Banner superior curvo -->
          <div class="absolute top-0 left-0 w-full h-12 bg-gradient-to-r ${theme.gradient} opacity-10 -rotate-3 scale-110 origin-top-left"></div>
          
          ${statusChip}
          
          <div class="flex flex-col items-center text-center mb-6 pt-4">
            <div class="relative mb-4">
              <div class="w-24 h-24 rounded-[2rem] bg-white flex items-center justify-center overflow-hidden border-4 ${theme.border} shadow-inner transform rotate-3 group-hover:rotate-0 transition-transform duration-300">
                ${safeAvatar 
                  ? `<img src="${safeAvatar}" class="w-full h-full object-cover">` 
                  : `<span class="font-black text-4xl ${theme.text}">${(s.name || '?').charAt(0)}</span>`
                }
              </div>
              <div class="absolute -bottom-2 -right-2 bg-white rounded-full p-1.5 shadow-md border ${theme.border}">
                <i data-lucide="sparkles" class="w-4 h-4 ${theme.text}"></i>
              </div>
            </div>
            
            <h3 class="font-black text-slate-800 text-2xl leading-tight mb-1">${Helpers.escapeHTML(s.name || 'Estudiante')}</h3>
            <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/60 border ${theme.border} text-xs font-bold ${theme.text} uppercase tracking-wide">
              <i data-lucide="home" class="w-3 h-3"></i>
              ${s.classrooms?.name || 'Sin aula'}
            </div>
          </div>

          <div class="flex gap-3 mt-auto">
            <button class="btn-student-edit flex-1 py-3 bg-white border-2 ${theme.border} ${theme.text} rounded-2xl text-xs font-black uppercase tracking-wider hover:bg-white/80 transition-all shadow-sm active:scale-95 flex items-center justify-center gap-2" data-id="${s.id}">
              <i data-lucide="edit-3" class="w-4 h-4"></i> Editar
            </button>
            <button class="btn-student-delete flex-1 py-3 bg-rose-500 text-white rounded-2xl text-xs font-black uppercase tracking-wider hover:bg-rose-600 transition-all shadow-md active:scale-95 flex items-center justify-center gap-2" data-id="${s.id}">
              <i data-lucide="trash-2" class="w-4 h-4"></i> Borrar
            </button>
          </div>
        </div>
      </div>
    `;
  },
  renderTeacherCard: (t) => {
    const avatarUrl = t.avatar_url || t.profiles?.avatar_url;
    const safeAvatar = avatarUrl ? encodeURI(avatarUrl) : '';
    const name = (t.name || t.profiles?.name || 'Maestro').trim();
    const initials = (name || '?').charAt(0);
    // 🔥 FIX: Manejar si classrooms viene como array (relación inversa) o objeto
    const classroomName = Array.isArray(t.classrooms) ? t.classrooms[0]?.name : t.classrooms?.name;

    return `
      <div class="bg-white rounded-[2rem] shadow-sm border-2 border-slate-50 p-6 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
        <div class="flex items-center gap-4 mb-6">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center text-2xl overflow-hidden font-black text-blue-600 border-2 border-white shadow-sm transform -rotate-2 group-hover:rotate-0 transition-transform">
            ${safeAvatar ? `<img src="${safeAvatar}" class="w-full h-full object-cover" onerror="this.parentElement.textContent='${initials}'">` : initials}
          </div>
          <div>
            <h4 class="font-black text-slate-800 text-lg leading-tight">${Helpers.escapeHTML(name)}</h4>
            <div class="flex items-center gap-1 mt-1">
              <span class="px-2 py-0.5 bg-blue-100 text-blue-600 rounded-lg text-[10px] font-black uppercase tracking-wider">${t.role || 'Maestra'}</span>
            </div>
          </div>
        </div>
        
        <div class="space-y-3 mb-6 bg-slate-50/50 p-4 rounded-2xl border border-dashed border-slate-200">
          <div class="flex items-center gap-3 text-xs text-slate-500 font-medium">
            <div class="w-7 h-7 rounded-lg bg-white flex items-center justify-center shadow-sm"><i data-lucide="mail" class="w-3.5 h-3.5 text-blue-400"></i></div>
            <span class="truncate">${t.email || 'N/A'}</span>
          </div>
          <div class="flex items-center gap-3 text-xs text-slate-500 font-medium">
            <div class="w-7 h-7 rounded-lg bg-white flex items-center justify-center shadow-sm"><i data-lucide="home" class="w-3.5 h-3.5 text-indigo-400"></i></div>
            <span class="truncate">${classroomName || 'Sin aula asignada'}</span>
          </div>
        </div>
        
        <button class="btn-teacher-edit w-full py-3 bg-white border-2 border-blue-100 text-blue-600 rounded-2xl text-xs font-black uppercase tracking-wider hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all shadow-sm active:scale-95 flex items-center justify-center gap-2" data-id="${t.id}">
          <i data-lucide="edit-3" class="w-4 h-4"></i> Editar Perfil
        </button>
      </div>
    `;
  },
  renderClassroomRow: (r) => {
    const capacity = r.capacity || 10;
    const count = r.current_capacity || 0;
    const percent = capacity > 0 ? (count / capacity) * 100 : 0;
    const barColor = r.occupancyStatus === 'red' ? 'bg-rose-500' : r.occupancyStatus === 'yellow' ? 'bg-amber-500' : 'bg-emerald-500';
    
    return `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="py-4 px-6 font-bold text-slate-800">${Helpers.escapeHTML(r.name || 'Aula')}</td>
        <td class="py-4 px-6 text-slate-600">${(r.teacher?.name || 'No asignada')}</td>
        <td class="py-4 px-6">
          <div class="flex items-center gap-2">
            <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div class="${barColor} h-full" style="width: ${percent}%"></div>
            </div>
            <span class="text-xs font-bold text-slate-500">${count}/${capacity}</span>
          </div>
        </td>
        <td class="py-4 px-6 text-center">
          <button class="p-2 text-slate-400 hover:text-purple-600 transition-colors"><i data-lucide="eye" class="w-4 h-4"></i></button>
        </td>
      </tr>
    `;
  },
};

// ====================================================================================
// 🎓 MÓDULO DE CALIFICACIONES (NUEVO)
// ====================================================================================
const GradesModule = {
  // 🎯 FUNCIÓN CENTRAL DE NORMALIZACIÓN
  getScore(g) {
    if (g.grade_letter) {
      return { 'A': 10, 'B': 8, 'C': 6, 'D': 5 }[g.grade_letter] || 0;
    }
    if (g.stars !== null && g.stars !== undefined) {
      return g.stars * 2; // 5 estrellas = 10
    }
    // Fallback para score numérico si ya existe
    return parseFloat(g.score || 0);
  },

  // 🎓 CONVERTIR A NOTA FINAL (A/B/C/D)
  getFinalGrade(avg) {
    if (avg >= 9) return 'A';
    if (avg >= 7) return 'B';
    if (avg >= 6) return 'C';
    return 'D';
  },

  // 🟡 ESTADO AUTOMÁTICO
  getStatus(avg) {
    if (avg >= 9) return 'Excelente';
    if (avg >= 7) return 'Bien';
    if (avg >= 6) return 'Regular';
    return 'Necesita apoyo';
  },

  async init() {
    await this.loadFilters();
    document.getElementById('gradesFilterClassroom')?.addEventListener('change', () => this.loadGrades());
    document.getElementById('gradesFilterSubject')?.addEventListener('change', () => this.loadGrades());
    document.getElementById('searchGradeStudent')?.addEventListener('input', Helpers.debounce(() => this.loadGrades(), 350));
    
    // ✅ NUEVO: Conectar botón de exportar
    document.getElementById('btnExportGrades')?.addEventListener('click', () => this.exportGrades());

    await this.loadGrades();
  },

  async loadFilters() {
    try {
      const { data: classrooms } = await DirectorApi.getClassrooms();
      const select = document.getElementById('gradesFilterClassroom');
      if (select && classrooms) {
        select.innerHTML = '<option value="all">Todas las aulas</option>';
        classrooms.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.name;
          select.appendChild(opt);
        });
      }
      
      // 🛡️ Corregir error: .distinct() no es una función de Supabase. Usar select('subject') y filtrar en JS.
      const { data: allGrades } = await supabase.from('grades').select('subject');
      const subjects = [...new Set((allGrades || []).map(g => g.subject).filter(Boolean))];
      
      const subjectSelect = document.getElementById('gradesFilterSubject');
      if (subjectSelect && subjects) {
        subjectSelect.innerHTML = '<option value="all">Todas las materias</option>';
        subjects.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s;
          opt.textContent = s;
          subjectSelect.appendChild(opt);
        });
      }
    } catch (e) {
      console.error('Error loading grade filters:', e);
    }
  },

  async loadGrades() {
    const container = document.getElementById('gradesTableBody');
    if (!container) return;
    container.innerHTML = `<tr><td colspan="5" class="text-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div></td></tr>`;

    try {
      const classroomId = document.getElementById('gradesFilterClassroom')?.value;
      const subject = document.getElementById('gradesFilterSubject')?.value;
      const searchQuery = document.getElementById('searchGradeStudent')?.value?.trim();

      const filters = {
        classroom_id: classroomId !== 'all' ? classroomId : null,
        subject: subject !== 'all' ? subject : null,
        search: searchQuery
      };

      // 🛡️ CORRECCIÓN: Usar getTaskGrades para ver notas reales de tareas
      const { data: grades, error } = await DirectorApi.getTaskGrades(filters);
      if (error) throw error;

      if (!grades || !grades.length) {
        container.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-slate-400">No se encontraron calificaciones.</td></tr>`;
        this.updateKPIs([]);
        return;
      }
      
      // 📊 3. AGRUPACIÓN POR ESTUDIANTE (Arquitectura Simple)
      const byStudent = {};
      grades.forEach(g => {
        const studentId = g.student_id;
        const studentName = g.student?.name || 'N/A';
        const score = this.getScore(g);
        // Adaptar obtención del aula según estructura de tarea
        const classroomName = g.classroom?.name || g.task?.classroom?.name || 'N/A';

        if (!byStudent[studentId]) {
          byStudent[studentId] = {
            name: studentName,
            avatar: g.student?.avatar_url,
            classroom: classroomName,
            totalScore: 0,
            count: 0
          };
        }
        byStudent[studentId].totalScore += score;
        byStudent[studentId].count++;
      });

      // 🧮 4. CALCULAR PROMEDIOS FINALES
      const studentSummary = Object.values(byStudent).map(s => {
        const avg = s.totalScore / s.count;
        return {
          ...s,
          avg,
          finalGrade: this.getFinalGrade(avg),
          status: this.getStatus(avg)
        };
      });

      container.innerHTML = studentSummary.map(s => this.renderStudentGradeRow(s)).join('');
      this.updateKPIs(grades);
      
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('loadGrades error:', e);
      container.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-red-500">Error al cargar calificaciones.</td></tr>';
    }
  },

  async exportGrades() {
    const classroomId = document.getElementById('gradesFilterClassroom')?.value;
    const filters = {
      classroom_id: classroomId !== 'all' ? classroomId : null,
      subject: document.getElementById('gradesFilterSubject')?.value !== 'all' ? document.getElementById('gradesFilterSubject')?.value : null,
      search: document.getElementById('searchGradeStudent')?.value?.trim()
    };

    Helpers.toast('Generando reporte...', 'info');
    const { data: grades } = await DirectorApi.getGrades(filters);

    if (!grades || !grades.length) return Helpers.toast('No hay calificaciones para exportar', 'warning');

    // Aplanar datos para Excel
    const exportData = grades.map(g => ({
      Estudiante: g.student?.name || 'N/A',
      Materia: g.subject || 'N/A',
      Calificacion: this.getScore(g),
      Periodo: g.period || '-',
      Maestra: g.teacher?.name || 'N/A',
      Fecha: new Date(g.created_at).toLocaleDateString()
    }));

    Helpers.exportToCSV(exportData, `Calificaciones_${new Date().toISOString().slice(0,10)}.csv`);
    Helpers.toast('Archivo descargado', 'success');
  },

  renderStudentGradeRow(s) {
    let scoreBadge = '';
    if (s.avg >= 9) scoreBadge = 'bg-green-100 text-green-700';
    else if (s.avg >= 7) scoreBadge = 'bg-blue-100 text-blue-700';
    else if (s.avg >= 6) scoreBadge = 'bg-yellow-100 text-yellow-700';
    else scoreBadge = 'bg-red-100 text-red-700';

    return `
      <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
        <td class="px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden font-bold text-slate-400">
              ${s.avatar ? `<img src="${s.avatar}" class="w-full h-full object-cover">` : s.name.charAt(0)}
            </div>
            <div>
              <div class="font-bold text-slate-800">${Helpers.escapeHTML(s.name)}</div>
              <div class="text-[10px] text-slate-400 font-bold uppercase">${Helpers.escapeHTML(s.classroom)}</div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4 text-center font-black text-slate-700">${s.avg.toFixed(1)}/10</td>
        <td class="px-6 py-4 text-center">
          <span class="px-3 py-1 rounded-full text-xs font-black ${scoreBadge}">${s.finalGrade}</span>
        </td>
        <td class="px-6 py-4 text-center">
          <span class="text-xs font-bold ${s.avg >= 6 ? 'text-green-600' : 'text-red-500'}">${s.status}</span>
        </td>
        <td class="px-6 py-4 text-center">
          <button class="p-2 text-slate-400 hover:text-purple-600 transition-colors" title="Ver detalle"><i data-lucide="eye" class="w-4 h-4"></i></button>
        </td>
      </tr>
    `;
  },

  updateKPIs(grades = []) {
    const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };

    if (grades.length === 0) {
      setTxt('kpiAvgGrade', 'N/A');
      setTxt('kpiApprovalRate', 'N/A');
      setTxt('kpiNeedsSupport', '0');
      setTxt('kpiLowGrades', '0');
      return;
    }

    const allScores = grades.map(g => this.getScore(g));
    const avgGeneral = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    
    const approvedCount = allScores.filter(s => s >= 7).length;
    const approvalRate = (approvedCount / allScores.length) * 100;

    const needsSupportCount = allScores.filter(s => s >= 5 && s < 7).length;
    const lowGradesCount = allScores.filter(s => s < 5).length;

    setTxt('kpiAvgGrade', avgGeneral.toFixed(1));
    setTxt('kpiApprovalRate', `${approvalRate.toFixed(0)}%`);
    setTxt('kpiNeedsSupport', needsSupportCount);
    setTxt('kpiLowGrades', lowGradesCount);
  }
};

// ====================================================================================
// 📅 MÓDULO DE ASISTENCIA (antes attendance.js)
// ====================================================================================
const AttendanceModule = {
  _chart: null,
  async init() {
    // No hay filtros necesarios
  },
  async loadAttendance() {
    const selectedDate = document.getElementById('attendanceDateFilter')?.value || new Date().toISOString().split('T')[0];
    const loader = document.getElementById('attendanceLoader');
    this.loadTrendChart(); // Cargar tendencia
    if (loader) loader.classList.remove('hidden');
    try {
      const { data: attendance, error } = await DirectorApi.getAttendanceByDate(selectedDate);
      if (error) throw new Error(error);

      const stats = { present: 0, absent: 0, late: 0 };
      const roomStats = {};
      (attendance || []).forEach(r => {
        const status = (r.status || '').toLowerCase();
        if (status === 'present') stats.present++; else if (status === 'absent') stats.absent++; else if (status === 'late') stats.late++;
        const roomName = r?.students?.classrooms?.name || 'Sin aula';
        if (!roomStats[roomName]) roomStats[roomName] = { present: 0, total: 0 };
        roomStats[roomName].total++;
        if (status === 'present' || status === 'late') roomStats[roomName].present++;
      });
      document.getElementById('statPresent').textContent = stats.present;
      document.getElementById('statAbsent').textContent = stats.absent;
      document.getElementById('statLate').textContent = stats.late;
      this.renderTable(attendance || [], roomStats);
      this.updatePieChart(stats);
    } catch (e) {
      console.error('Error loadAttendance:', e);
      Helpers.toast('Error al cargar asistencia', 'error');
    } finally {
      if (loader) loader.classList.add('hidden');
    }
  },
  renderTable(attendance, roomStats) {
      const tableBody = document.getElementById('attendanceByRoomBody');
      if(!tableBody) return;
      if (!attendance.length) {
          tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-400 italic">No hay registros para esta fecha.</td></tr>';
          return;
      }
      tableBody.innerHTML = Object.entries(roomStats).map(([room, s]) => {
        const percent = s.total > 0 ? ((s.present / s.total) * 100).toFixed(0) : 0;
        return `
          <tr class="border-b border-slate-50 hover:bg-slate-50 transition-colors">
            <td class="py-4 px-2 font-bold text-slate-700 text-sm">${Helpers.escapeHTML(room)}</td>
            <td class="py-4 text-center text-emerald-600 font-black">${s.present}</td>
            <td class="py-4 text-center text-rose-500 font-black">${s.total - s.present}</td>
            <td class="py-4 px-2">
              <div class="flex items-center gap-3">
                <div class="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                  <div class="bg-gradient-to-r from-blue-400 to-indigo-600 h-full" style="width: ${percent}%"></div>
                </div>
                <span class="text-[10px] font-black text-slate-500 w-8 text-right">${percent}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join('');
  },
  updatePieChart(stats) {
    const ctx = document.getElementById('attendancePieChart');
    if (!ctx || typeof Chart === 'undefined') return;
    const data = [stats.present, stats.absent, stats.late];
    if (this._chart) {
      this._chart.data.datasets[0].data = data;
      this._chart.update();
    } else {
      this._chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Presentes', 'Ausentes', 'Tardanzas'],
          datasets: [{ data, backgroundColor: ['#10b981', '#ef4444', '#f59e0b'], borderWidth: 0, cutout: '75%' }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20, font: { size: 11 } } } }
        }
      });
    }
  },
  
  // 📈 Nuevo Gráfico de Tendencia
  async loadTrendChart() {
    const ctx = document.getElementById('attendanceTrendChart');
    if (!ctx) return;
    
    const { data: trend } = await DirectorApi.getAttendanceLast7Days();
    if (!trend) return;

    const labels = Object.keys(trend).sort(); // Fechas
    const presentData = labels.map(d => trend[d].present);
    const absentData = labels.map(d => trend[d].absent);

    if (this._trendChart) this._trendChart.destroy();

    this._trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels.map(d => new Date(d).toLocaleDateString('es-ES', {weekday: 'short', day: 'numeric'})),
        datasets: [
          { label: 'Presentes', data: presentData, borderColor: '#10b981', backgroundColor: '#10b98120', fill: true, tension: 0.4 },
          { label: 'Ausentes', data: absentData, borderColor: '#ef4444', backgroundColor: '#ef444420', fill: true, tension: 0.4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }
};

// ====================================================================================
// 💳 MÓDULO DE PAGOS (antes payments.js)
// ====================================================================================
const PaymentsModule = {
  currentReviewId: null,
  settings: {
    generation_day: 25,
    due_day: 5
  },
  
  async init() {
    document.getElementById('btnSavePayment')?.addEventListener('click', () => this.saveManualPayment());
    document.getElementById('filterPaymentStatus')?.addEventListener('change', () => this.loadPayments());
    document.getElementById('btnSaveConfig')?.addEventListener('click', () => this.saveConfig());
    document.getElementById('btnGeneratePaymentsNow')?.addEventListener('click', () => this.generatePaymentsManual());
    
    // Inicializar filtros de periodo
    const now = new Date();
    const monthSelect = document.getElementById('filterPaymentMonth');
    const yearSelect = document.getElementById('filterPaymentYear');
    
    if (monthSelect) {
      monthSelect.value = String(now.getMonth() + 1).padStart(2, '0');
      monthSelect.addEventListener('change', () => { this.loadPayments(); this.loadIncomeChart(); });
    }
    
    if (yearSelect) {
      yearSelect.value = now.getFullYear();
      yearSelect.addEventListener('change', () => { this.loadPayments(); this.loadIncomeChart(); });
    }

    const chartYearSelect = document.getElementById('chartYear');
    if (chartYearSelect) {
      chartYearSelect.value = now.getFullYear();
      chartYearSelect.addEventListener('change', () => this.loadIncomeChart());
    }

    const chartMonthSelect = document.getElementById('chartMonth');
    if (chartMonthSelect) {
      chartMonthSelect.addEventListener('change', () => this.loadIncomeChart());
    }
    
    document.getElementById('searchPaymentStudent')?.addEventListener('input', Helpers.debounce(() => this.loadPayments(), 350));
    
    // 🔥 AUTO-RUN: Ejecutar lógica de ciclo de pagos al cargar
    this.runAutomation();
    this.loadConfig();
  },

  // ⚙️ AUTOMATIZACIÓN INTELIGENTE
  async runAutomation() {
    console.log('🤖 Running Payment Cycle Automation...');
    try {
      // 1. Verificar configuración
      const { data: config } = await supabase.from('school_settings').select('*').single();
      if (!config) return;

      const now = new Date();
      const today = now.getDate();
      const genDay = config.generation_day || 25;

      // 2. Si hoy es el día de generación, disparar la creación automática (si no existe)
      if (today === genDay && !localStorage.getItem('payments_generated_today')) {
        console.log('📅 Día de generación detectado. Ejecutando ciclo...');
        await this.generatePaymentsManual();
        localStorage.setItem('payments_generated_today', 'true');
      }

      // 3. Llamada al RPC para vencimientos y lógica avanzada
      // Verificamos si existe el RPC antes de llamarlo para evitar 400
      const { data, error } = await supabase.rpc('run_payment_cycle');
      
      if (error) {
        // Ignoramos errores menores de automatización para no bloquear el dashboard
        console.warn('Automation cycle info/error:', error.message);
        return;
      }
      
      if (data && data.error) {
        console.warn('Automation logic warning:', data.error);
        return;
      }
      
      if (data && (data.generated > 0 || data.expired > 0)) {
        Helpers.toast(`Ciclo ejecutado: ${data.generated} generados, ${data.expired} vencidos`, 'info');
        this.loadPayments(); // Recargar tabla si hubo cambios
        DashboardService.invalidateCache();
      }
    } catch (e) {
      console.warn('Automation background error:', e);
    }
  },

  async loadConfig() {
    try {
      const { data, error } = await supabase.from('school_settings').select('*').single();
      if (error) throw error;

      if (data) {
        this.settings.generation_day = data.generation_day || 25;
        this.settings.due_day = data.due_day || 5;
        if (document.getElementById('confGenDay')) document.getElementById('confGenDay').value = this.settings.generation_day;
        if (document.getElementById('confDueDay')) document.getElementById('confDueDay').value = this.settings.due_day;
      }
    } catch(e) {
      console.warn('Config load error (Table might not exist):', e);
    }
  },

  async saveConfig() {
    const genDay = document.getElementById('confGenDay')?.value;
    const dueDay = document.getElementById('confDueDay')?.value;
    
    try {
      const { error } = await supabase.from('school_settings').upsert({
        id: 1,
        generation_day: parseInt(genDay || 25),
        due_day: parseInt(dueDay || 5),
        updated_at: new Date()
      });
      
      if(error) throw error;
      this.settings.generation_day = parseInt(genDay || 25);
      this.settings.due_day = parseInt(dueDay || 5);
      Helpers.toast('Configuración de pagos guardada', 'success');
    } catch(e) {
      Helpers.toast('Error guardando configuración', 'error');
    }
  },

  async generatePaymentsManual() {
    const btn = document.getElementById('btnGeneratePaymentsNow');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="animate-spin" data-lucide="loader-2"></i> Generando...';
      if (window.lucide) lucide.createIcons();
    }

    try {
      const { data: students, error: sError } = await supabase
        .from('students')
        .select('id, name, monthly_fee');
      
      if (sError) throw sError;
      if (!students?.length) return Helpers.toast('No hay estudiantes activos para generar pagos', 'warning');

      const now = new Date();
      const year = now.getFullYear();
      const monthIndex = now.getMonth(); // 0-11
      const { data: config } = await supabase.from('school_settings').select('*').single();
      const genDay = config?.generation_day || 25;
      const dueDay = config?.due_day || 5;

      // Si hoy es mayor o igual que el día de generación, el ciclo actual corresponde al mes actual y vence el próximo mes.
      // Si no, el ciclo actual corresponde al mes anterior y vence en el mes actual.
      let cycleMonthIndex = monthIndex;
      let cycleYear = year;
      let dueMonthIndex = monthIndex;
      let dueYear = year;

      if (now.getDate() >= genDay) {
        dueMonthIndex = monthIndex + 1;
        if (dueMonthIndex > 11) {
          dueMonthIndex = 0;
          dueYear += 1;
        }
      } else {
        cycleMonthIndex = monthIndex - 1;
        if (cycleMonthIndex < 0) {
          cycleMonthIndex = 11;
          cycleYear -= 1;
        }
        dueMonthIndex = monthIndex;
      }

      const dueDateObj = new Date(dueYear, dueMonthIndex, dueDay);
      const dueDate = dueDateObj.toISOString().split('T')[0];
      const monthName = dueDateObj.toLocaleString('es-ES', { month: 'long' });

      const dueMonth = String(dueMonthIndex + 1).padStart(2, '0');
      const lastDay = new Date(dueYear, dueMonthIndex + 1, 0).getDate();
      const startOfDue = `${dueYear}-${dueMonth}-01T00:00:00.000Z`;
      const endOfDue = `${dueYear}-${dueMonth}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`;

      const { data: existing } = await supabase
        .from('payments')
        .select('student_id')
        .eq('month_paid', monthName)
        .gte('due_date', startOfDue)
        .lte('due_date', endOfDue);

      const existingIds = new Set(existing?.map(p => p.student_id));
      const toCreate = students.filter(s => !existingIds.has(s.id));

      if (toCreate.length === 0) {
        Helpers.toast('Los pagos para este periodo ya han sido generados', 'info');
        return;
      }

      // Construir objeto de pago con todos los campos requeridos (si existe la columna concept)
      const payments = toCreate.map(s => ({
        student_id: s.id,
        amount: parseFloat(s.monthly_fee || 2000),
        concept: 'Mensualidad',
        status: 'pending',
        month_paid: monthName,
        due_date: dueDate
      }));

      // Inserción masiva
      const { error: iError } = await supabase.from('payments').insert(payments);
      
      if (iError) {
        console.warn('Error inserting payments, retrying with fallback fields...', iError);

        const minimalPayments = toCreate.map(s => {
          const fallback = {
            student_id: s.id,
            amount: parseFloat(s.monthly_fee || 2000),
            status: 'pending',
            month_paid: monthName,
            due_date: dueDate
          };

          if (iError.code === 'PGRST204' && iError.message?.includes("Could not find the 'concept' column")) {
            return fallback;
          }

          return { ...fallback, concept: 'Mensualidad' };
        });

        const { error: iError2 } = await supabase.from('payments').insert(minimalPayments);
        if (iError2) throw iError2;
      }

      Helpers.toast(`Se han generado ${payments.length} pagos exitosamente`, 'success');
      this.loadPayments();
      DashboardService.invalidateCache();
    } catch (e) {
      console.error('Error manual generation:', e);
      Helpers.toast('Error al generar pagos. Verifique consola para detalles técnicos.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="play-circle" class="w-4 h-4"></i> Generar pagos ahora';
        if (window.lucide) lucide.createIcons();
      }
    }
  },

  // 🚀 Función para filtrar desde los KPIs (UX Profesional)
  filterBy(status) {
    const select = document.getElementById('filterPaymentStatus');
    if(select) {
      select.value = status;
      this.loadPayments();
      const labels = { pending: 'Pendientes', overdue: 'Vencidos', paid: 'Aprobados', review: 'En Revisión' };
      Helpers.toast(`Filtrando por: ${labels[status] || status}`, 'info');
    }
  },

  async openPaymentModal() {
    // ... (Mantener modal existente pero actualizando estilos si es necesario)
    const inputClass = "w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium";
    const labelClass = "block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1";
    
    const modalHTML = `
      <div class="modal-header bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-6 rounded-t-3xl">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl shadow-inner">💰</div>
          <div>
            <h3 class="text-xl font-black">Registrar Pago Manual</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Nuevo Ingreso</p>
          </div>
        </div>
        <button onclick="UIHelpers.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors">
          <i data-lucide="x" class="w-6 h-6"></i>
        </button>
      </div>
      
      <div class="modal-body p-8 bg-slate-50/30">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="md:col-span-2">
            <label class="${labelClass}">Estudiante</label>
            <select id="payStudentSelect" class="${inputClass}">
              <option value="">-- Seleccionar Estudiante --</option>
            </select>
          </div>
          
          <div>
            <label class="${labelClass}">Monto ($)</label>
            <input id="payAmount" type="number" step="0.01" class="${inputClass}" placeholder="0.00">
          </div>
          
          <div>
            <label class="${labelClass}">Método</label>
            <select id="payMethod" class="${inputClass}">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
            </select>
          </div>
          
          <div>
            <label class="${labelClass}">Estado</label>
            <select id="payStatus" class="${inputClass}">
              <option value="paid">Pagado</option>
              <option value="pending">Pendiente</option>
            </select>
          </div>
          
          <div>
            <label class="${labelClass}">Fecha Vencimiento (Si aplica)</label>
            <input id="payDueDate" type="date" class="${inputClass}">
          </div>
        </div>
      </div>
      
      <div class="modal-footer bg-white p-6 rounded-b-3xl border-t border-slate-100">
        <button onclick="UIHelpers.closeModal()" class="px-8 py-3 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
        <button id="btnSavePaymentAction" class="px-10 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-emerald-200 hover:shadow-emerald-300 hover:-translate-y-0.5 transition-all active:scale-95">Registrar Pago</button>
      </div>
    `;
    
    openGlobalModal(modalHTML);
    
    // Cargar estudiantes
    try {
      const { data: students } = await DirectorApi.getStudents();
      const select = document.getElementById('payStudentSelect');
      if (select && students) {
        students.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = `${s.name} (${s.classrooms?.name || 'Sin aula'})`;
          select.appendChild(opt);
        });
      }
    } catch (e) { console.error(e); }

    document.getElementById('btnSavePaymentAction')?.addEventListener('click', () => this.saveManualPayment());
    if (window.lucide) lucide.createIcons();
  },
  async saveManualPayment() {
    const studentId = document.getElementById('payStudentSelect')?.value;
    const amount = parseFloat(document.getElementById('payAmount')?.value || 0);
    const method = document.getElementById('payMethod')?.value || 'efectivo';
    const status = document.getElementById('payStatus')?.value || 'paid';
    const dueDate = document.getElementById('payDueDate')?.value;
    const paidDate = status === 'paid' ? new Date().toISOString() : null;

    if (!studentId || !amount || amount <= 0) return Helpers.toast('Faltan datos para registrar el pago', 'warning');

    UIHelpers.setLoading(true, '#modalPayment');
    try {
      const now = new Date();
      const payload = {
        student_id: studentId,
        amount,
        concept: 'Pago Manual',
        method,
        status,
        month_paid: now.toLocaleString('es-ES', { month: 'long' }),
        due_date: dueDate || null,
        paid_date: paidDate,
        created_at: now.toISOString()
      };

      let paymentResult;

      const { data: payment, error } = await DirectorApi.createManualPayment(payload);

      if (error) {
        console.warn('Retry fallback...', error);

        const fallbackPayload = {
          student_id: studentId,
          amount,
          status
        };

        const { data: payment2, error: error2 } = await DirectorApi.createManualPayment(fallbackPayload);

        if (error2) throw error2;

        paymentResult = payment2;
      } else {
        paymentResult = payment;
      }

      Helpers.toast('Pago registrado correctamente', 'success');
      UIHelpers.closeModal('#modalPayment');
      await this.loadPayments();

      // Enviar recibo por email a los padres
      if (paymentResult?.id) {
        try {
          await DirectorApi.sendPaymentReceipt(paymentResult.id, 'Gracias por su pago.');
          Helpers.toast('Recibo enviado por correo', 'success');
        } catch (e) {
          console.warn('Error enviando recibo:', e);
        }
      }
    } catch (e) {
      console.error(e);
      Helpers.toast('Error al guardar pago', 'error');
    } finally {
      UIHelpers.setLoading(false, '#modalPayment');
    }
  },
  async loadPayments() {
    const container = document.getElementById('paymentsTableBody');
    if (!container) return;
    container.innerHTML = '<tr><td colspan="8" class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div></td></tr>';
    
    // Cargar KPIs y Gráfico en paralelo
    this.loadStats();
    this.loadIncomeChart();

    try {
      const month = document.getElementById('filterPaymentMonth')?.value;
      const year = document.getElementById('filterPaymentYear')?.value;
      const statusFilter = document.getElementById('filterPaymentStatus')?.value;
      const searchQuery = document.getElementById('searchPaymentStudent')?.value?.trim();

      const filters = { 
        month,
        year,
        status: statusFilter, 
        search: searchQuery
      };
      
      const { data: payments, error } = await DirectorApi.getPayments(filters);
      if (error) throw new Error(error);

      // --- LÓGICA DE FILTRO INTELIGENTE (PRO) ---
      const now = new Date();
      const currentDay = now.getDate();
      const selectedPeriod = `${year}-${month}`;
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextPeriod = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;

      // 1. Si es el mes PRÓXIMO y hoy está antes del día de generación, no mostrar nada
      const generationDay = this.settings?.generation_day || 25;
      if (selectedPeriod === nextPeriod && currentDay < generationDay) {
        container.innerHTML = `
          <tr><td colspan="8" class="text-center py-12">
            <div class="max-w-xs mx-auto">
              <i data-lucide="clock" class="w-12 h-12 text-slate-200 mx-auto mb-3"></i>
              <p class="text-slate-500 font-bold">Aún no se han generado pagos para el próximo periodo.</p>
              <p class="text-xs text-slate-400 mt-1">Se generarán automáticamente el día 25.</p>
            </div>
          </td></tr>`;
        if (window.lucide) lucide.createIcons();
        return;
      }

      if (!payments || !payments.length) {
        container.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-slate-400">No se encontraron registros para este periodo.</td></tr>`;
        return;
      }

      // 2. ORDEN INTELIGENTE (PRO)
      // 1. Vencidos, 2. Pendientes, 3. En revisión, 4. Aprobados
      const sortedPayments = [...payments].sort((a, b) => {
        const priority = { overdue: 1, pending: 2, review: 3, paid: 4 };
        const statusA = this.getPaymentStatus(a);
        const statusB = this.getPaymentStatus(b);
        return (priority[statusA] || 99) - (priority[statusB] || 99);
      });
      
      container.innerHTML = sortedPayments.map(p => {
         if (!p.students) p.students = { name: 'Estudiante Eliminado', classrooms: { name: '-' } };
         return this.renderPaymentRow(p);
      }).join('');
      
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('loadPayments error:', e);
      container.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-red-500">Error al cargar pagos. Verifique la conexión.</td></tr>';
    }
  },

  // Conversión de nombre de mes (es/en) a índice 0-11
  _parseMonthName(monthName) {
    if (!monthName) return null;
    const m = String(monthName).toLowerCase().trim();
    const namesEs = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const namesEn = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const idxEs = namesEs.indexOf(m);
    if (idxEs !== -1) return idxEs;
    const idxEn = namesEn.indexOf(m);
    if (idxEn !== -1) return idxEn;
    return null;
  },

  // Mes/año del ciclo activo según configuración y fecha actual
  _getActiveCycle() {
    const today = new Date();
    let cycleMonth = today.getMonth();
    let cycleYear = today.getFullYear();
    const genDay = this.settings?.generation_day || 25;

    if (today.getDate() < genDay) {
      cycleMonth -= 1;
      if (cycleMonth < 0) {
        cycleMonth = 11;
        cycleYear -= 1;
      }
    }
    return { cycleMonth, cycleYear };
  },

  // Fecha de vencimiento “esperada” según ciclo y configuración
  getExpectedDueDateForPayment(p) {
    const dueDay = this.settings?.due_day || 5;
    const genDay = this.settings?.generation_day || 25;
    const today = new Date();
    today.setHours(0,0,0,0);

    // Base natural (p.due_date preferido)
    let baseDue = null;
    if (p.due_date) {
      const [y, m, d] = p.due_date.split('-').map(Number);
      if (y && m && d) {
        baseDue = new Date(y, m - 1, d);
        baseDue.setHours(0,0,0,0);
      }
    }

    // Intentamos detectar si este pago corresponde al ciclo actual
    const monthPaidIndex = this._parseMonthName(p.month_paid);
    const { cycleMonth, cycleYear } = this._getActiveCycle();
    const isCurrentCycle = monthPaidIndex === cycleMonth;

    // Si el pago es del ciclo actual, calculemos la fecha de vencimiento correcta
    if (isCurrentCycle) {
      let dueMonth = cycleMonth;
      let dueYear = cycleYear;
      if (dueDay <= genDay) {
        dueMonth = cycleMonth + 1;
        if (dueMonth > 11) {
          dueMonth = 0;
          dueYear += 1;
        }
      }
      const expected = new Date(dueYear, dueMonth, dueDay);
      expected.setHours(0,0,0,0);
      // Solo si el cálculo es plausible reemplaza due_date errónea para no marcar como vencido injustamente
      if (!baseDue || expected.getTime() !== baseDue.getTime()) {
        return expected;
      }
    }

    // Si no pertenece al ciclo actual, usamos due_date existente o la calculada según month_paid
    if (baseDue) return baseDue;

    // Fallback con month_paid / year según ciclo
    if (monthPaidIndex !== null) {
      let targetYear = cycleYear;
      if (monthPaidIndex > cycleMonth) {
        targetYear -= 1; // month_paid al final del año anterior
      }
      // Si month_paid es actual ciclo, aplicar lógica de dueDay con genDay
      let dueMonth = monthPaidIndex;
      if (dueDay <= genDay) {
        dueMonth = monthPaidIndex + 1;
        if (dueMonth > 11) {
          dueMonth = 0;
          targetYear += 1;
        }
      }
      const fallbackDate = new Date(targetYear, dueMonth, dueDay);
      fallbackDate.setHours(0,0,0,0);
      return fallbackDate;
    }

    return null;
  },

  // Helper para determinar el estado real basado en fecha
  getPaymentStatus(p) {
    if (p.status === 'paid') return 'paid';

    if (p.status === 'review' || (p.status === 'pending' && p.method === 'transferencia')) {
      return 'review';
    }

    const today = getTodaySafe();
    const dueDate = this.getExpectedDueDateForPayment(p);

    if (!dueDate) return 'pending';

    if (today.getTime() > dueDate.getTime()) return 'overdue';

    return 'pending';
  },

  renderPaymentRow(p) {
    const statusKey = this.getPaymentStatus(p);
    const statusMap = {
      paid: { label: 'Aprobado', class: 'bg-emerald-100 text-emerald-700', icon: 'check-circle' },
      pending: { label: 'Pendiente', class: 'bg-slate-100 text-slate-500', icon: 'clock' },
      review: { label: 'En Revisión', class: 'bg-amber-100 text-amber-700', icon: 'file-search' },
      overdue: { label: 'Vencido', class: 'bg-rose-100 text-rose-700', icon: 'alert-triangle' }
    };
    
    const status = statusMap[statusKey] || { label: p.status, class: 'bg-slate-100 text-slate-700', icon: 'help-circle' };
    const student = p.students || { name: 'Desconocido', classrooms: { name: 'Sin aula' } };
    
    // Cálculo de días (PRO) usando fecha de vencimiento efectiva
    const dueDateObj = this.getExpectedDueDateForPayment(p);
    const dueDateForDisplay = dueDateObj ? dueDateObj.toLocaleDateString() : (p.due_date || '—');

    let daysLabel = '';
    if (statusKey === 'pending' || statusKey === 'review') {
      const diff = dueDateObj ? Math.ceil((dueDateObj - new Date()) / (1000 * 60 * 60 * 24)) : 0;
      daysLabel = `<span class="text-[9px] font-bold ${diff < 3 ? 'text-amber-600' : 'text-slate-400'} ml-1">${diff} días</span>`;
    } else if (statusKey === 'overdue') {
      const diff = dueDateObj ? Math.floor((new Date() - dueDateObj) / (1000 * 60 * 60 * 24)) : 0;
      daysLabel = `<span class="text-[9px] font-bold text-rose-600 ml-1">hace ${diff} días</span>`;
    }

    // Voucher / Comprobante
    const voucherUrl = p.evidence_url || p.proof_url;
    const voucherBtn = voucherUrl 
      ? `<a href="${voucherUrl}" target="_blank" class="inline-flex items-center gap-1 px-2 py-1 bg-sky-50 text-sky-600 rounded-lg hover:bg-sky-100 transition-all text-[10px] font-black uppercase">
           <i data-lucide="image" class="w-3.5 h-3.5"></i> Ver
         </a>`
      : `<span class="text-[10px] text-slate-300 font-bold uppercase tracking-widest">—</span>`;

    return `
      <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
        <td class="px-6 py-4">
          <div class="font-bold text-slate-800">${Helpers.escapeHTML(student.name)}</div>
          <div class="text-[10px] text-slate-400 font-black uppercase tracking-tighter">${student.classrooms?.name || 'General'}</div>
        </td>
        <td class="px-6 py-4 text-center">
          <div class="flex flex-col items-center">
            <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black uppercase ${status.class} w-fit">
              <i data-lucide="${status.icon}" class="w-3 h-3"></i> ${status.label}
            </span>
            ${daysLabel}
          </div>
        </td>
        <td class="px-6 py-4 text-right">
          <div class="font-black text-slate-700">$${(p.amount || 0).toLocaleString()}</div>
          ${statusKey === 'paid' ? '<div class="text-[9px] text-emerald-600 font-bold uppercase tracking-tighter">Total Pagado</div>' : ''}
        </td>
        <td class="px-6 py-4">
          <span class="text-[10px] font-black uppercase text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">${p.method || '—'}</span>
        </td>
        <td class="px-6 py-4">
          <div class="text-[10px] font-bold text-slate-600 uppercase truncate max-w-[120px]" title="${p.bank || ''} ${p.reference || ''}">
            ${p.bank || '—'}
          </div>
          <div class="text-[9px] text-slate-400 font-black uppercase tracking-tighter">${p.reference || ''}</div>
        </td>
        <td class="px-6 py-4">
          <div class="text-[11px] font-bold text-slate-600">${p.paid_date ? new Date(p.paid_date).toLocaleDateString() : dueDateForDisplay}</div>
          <div class="text-[9px] text-slate-400 font-black uppercase tracking-tighter">${p.paid_date ? 'Pago' : 'Vencimiento'}</div>
        </td>
        <td class="px-6 py-4 text-center">
          ${voucherBtn}
        </td>
        <td class="px-6 py-4 text-center">
          <div class="flex justify-center gap-2">
            ${statusKey !== 'paid' ? `<button onclick="App.payments.markPaid('${p.id}')" class="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors shadow-sm" title="Aprobar"><i data-lucide="check" class="w-4 h-4"></i></button>` : ''}
            <button onclick="App.payments.sendReceipt('${p.id}')" class="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors shadow-sm" title="Enviar Recordatorio"><i data-lucide="bell" class="w-4 h-4"></i></button>
            <button onclick="App.payments.delete('${p.id}')" class="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition-colors shadow-sm" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
          </div>
        </td>
      </tr>`;
  },

  // 📊 Cargar KPIs de Pagos
  async loadStats() {
    try {
      const { data } = await DirectorApi.getPaymentStats();
      if (data) {
        const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
        setTxt('kpiIncomeMonth', `$${data.incomeMonth.toLocaleString()}`);
        setTxt('kpiPendingCount', data.pending);
        setTxt('kpiOverdueCount', data.overdue);
        setTxt('kpiConfirmedCount', data.confirmed);
        if (document.getElementById('kpiReviewCount')) document.getElementById('kpiReviewCount').textContent = data.toApprove;
      }
    } catch (e) { console.error('Error loading payment stats', e); }
  },

  // 📈 Cargar Gráfico Financiero (Mejorado)
  async loadIncomeChart() {
    const canvas = document.getElementById('financialChart');
    if (!canvas) return;
    
    try {
      const year = document.getElementById('chartYear')?.value || document.getElementById('filterPaymentYear')?.value || new Date().getFullYear();
      const month = document.getElementById('chartMonth')?.value || 'all';
      
      // Obtener todos los pagos pagados del año para graficar
      const { data: payments, error } = await DirectorApi.getPayments({ year: year, status: 'paid' });
      if (error) throw error;

      let labels, dataValues;

      if (month === 'all') {
        labels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        dataValues = new Array(12).fill(0);
        payments?.forEach(p => {
          const date = new Date(p.paid_date || p.created_at);
          if (date.getFullYear() == year) {
            dataValues[date.getMonth()] += (p.amount || 0);
          }
        });
      } else {
        // Graficar por semanas del mes seleccionado
        const daysInMonth = new Date(year, month, 0).getDate();
        labels = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4+'];
        dataValues = [0, 0, 0, 0];
        payments?.forEach(p => {
          const date = new Date(p.paid_date || p.created_at);
          if (date.getFullYear() == year && (date.getMonth() + 1) == month) {
            const day = date.getDate();
            if (day <= 7) dataValues[0] += p.amount;
            else if (day <= 14) dataValues[1] += p.amount;
            else if (day <= 21) dataValues[2] += p.amount;
            else dataValues[3] += p.amount;
          }
        });
      }

      if (this._financialChart) this._financialChart.destroy();

      this._financialChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Ingresos ($)',
            data: dataValues,
            backgroundColor: 'rgba(79, 70, 229, 0.2)',
            borderColor: 'rgb(79, 70, 229)',
            borderWidth: 2,
            borderRadius: 8,
            hoverBackgroundColor: 'rgb(79, 70, 229)'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => ` $${ctx.raw.toLocaleString()}`
              }
            }
          },
          scales: {
            y: { beginAtZero: true, grid: { display: false }, ticks: { callback: (v) => '$' + v } },
            x: { grid: { display: false } }
          }
        }
      });
    } catch (e) {
      console.error('Error loading income chart', e);
    }
  },

  async markPaid(id) {
    try {
      const { data: payment, error } = await DirectorApi.getPaymentById(id);
      if (error || !payment) throw new Error(error || 'Pago no encontrado');
      await DirectorApi.updatePayment(id, { status: 'paid', paid_date: new Date().toISOString() });
      Helpers.toast('Pago marcado como pagado', 'success');
      await this.loadPayments();
    } catch (e) {
      console.error(e);
      Helpers.toast('No se pudo marcar como pagado', 'error');
    }
  },

  async sendReceipt(id) {
    try {
      const { error } = await DirectorApi.sendPaymentReceipt(id, 'Adjunto recibo de pago Karpus.');
      if (error) throw new Error(error);
      Helpers.toast('Recibo enviado por correo a los padres', 'success');
    } catch (e) {
      console.error(e);
      Helpers.toast('Error al enviar recibo por correo', 'error');
    }
  },

  async sendSummaryToParents() {
    try {
      const { data: payments, error } = await DirectorApi.getPayments({ status: 'pending', year: new Date().getFullYear() });
      if (error) throw new Error(error);

      const overdue = (payments || []).filter(p => p.status === 'overdue');
      if (!overdue.length) return Helpers.toast('No hay pagos vencidos para enviar', 'info');

      // Por simplicidad se envía email individual por pago vencido.
      await Promise.all(overdue.map(p => DirectorApi.sendPaymentReceipt(p.id, 'Su pago se encuentra vencido. Por favor regularice lo antes posible.')));
      Helpers.toast('Resumen semanal enviado a padres con pagos vencidos', 'success');
    } catch (e) {
      console.error(e);
      Helpers.toast('Error al enviar resumen semanal', 'error');
    }
  },

  async generatePDF(id) {
    Helpers.toast('Generando reporte PDF...', 'info');

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      const { data: p, error } = await DirectorApi.getPaymentById(id);
      if (error || !p) throw new Error('No se pudo obtener el pago');

      const studentName = p.students?.name || 'Estudiante desconocido';
      const statusKey = this.getPaymentStatus(p);

      const today = new Date();
      const todayStr = today.toLocaleDateString('es-DO');

      const paymentDate = p.paid_date
        ? new Date(p.paid_date).toLocaleDateString('es-DO')
        : (p.due_date ? new Date(p.due_date).toLocaleDateString('es-DO') : 'N/A');

      doc.setFontSize(18);
      doc.text('REPORTE DE PAGO - KARPUS KIDS', 20, 25);

      doc.setFontSize(11);
      doc.text(`Fecha de Emisión: ${todayStr}`, 20, 35);

      doc.line(20, 40, 190, 40);

      doc.text(`Estudiante: ${studentName}`, 20, 55);
      doc.text(`Periodo: ${p.month_paid || 'N/A'}`, 20, 65);
      doc.text(`Monto Total: $${p.amount || 0}`, 20, 75);
      doc.text(`Estado: ${statusKey.toUpperCase()}`, 20, 85);
      doc.text(`Fecha: ${paymentDate}`, 20, 95);

      doc.setFontSize(9);
      doc.text('Documento generado automáticamente por Karpus Kids.', 20, 120);

      doc.save(`Reporte_${studentName.replace(/\s+/g, '_')}.pdf`);

      Helpers.toast('PDF generado correctamente', 'success');

    } catch (e) {
      console.error('Error PDF:', e);
      Helpers.toast('Error al generar PDF', 'error');
    }
  },

  /**
   * Generar cuotas mensuales para todos los estudiantes activos
   */
  async generateCharges() {
    try {
      // Obtener mes y año actual
      const now = new Date();
      const currentMonth = now.getMonth() + 1; // JavaScript months are 0-based
      const currentYear = now.getFullYear();

      // Confirmar con el usuario
      const confirmMsg = `¿Generar cuotas para ${new Date(currentYear, currentMonth - 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}?`;
      if (!confirm(confirmMsg)) return;

      const key = `charges_${currentMonth}_${currentYear}`;
      if (localStorage.getItem(key)) {
        return Helpers.toast('Ya generaste las cuotas este mes', 'warning');
      }

      Helpers.toast('Generando cuotas mensuales...', 'info');

      // Llamar a la función RPC que maneja la transacción
      const { data: result, error } = await DirectorApi.generateMonthlyCharges(currentMonth, currentYear);
      if (error) throw new Error(error.message || 'Error desconocido');

      if (result && result.created_count > 0) {
        Helpers.toast(`✅ ${result.created_count} cuotas generadas exitosamente`, 'success');
        localStorage.setItem(key, 'true');
        // Invalidar caché de KPIs y recargar datos
        AppState.invalidateCache('dashboard_kpis');
        // Recargar la lista de pagos
        await this.loadPayments();
      } else {
        Helpers.toast('No se generaron nuevas cuotas (posiblemente ya existen)', 'warning');
      }

    } catch (error) {
      console.error('Error generando cuotas:', error);
      Helpers.toast('Error al generar cuotas: ' + (error.message || error), 'error');
    }
  }
};

// ====================================================================================
// 💬 MÓDULO DE CHAT (antes chat.js)
// ====================================================================================
const ChatModule = {
  currentChatUser: null,
  chatChannel: null,
  allContacts: [],

  // 🧩 HELPER PARA SCROLL SEGURO
  scrollToBottom() {
    const el = document.getElementById('chatMessagesContainer');
    if (el) el.scrollTop = el.scrollHeight;
  },
  async init() {
    document.getElementById('btnSendChatMessage')?.addEventListener('click', () => this.sendChatMessage());
    document.getElementById('chatMessageInput')?.addEventListener('keydown', e => (e.key === 'Enter' && !e.shiftKey) && (e.preventDefault(), this.sendChatMessage()));
    document.getElementById('chatSearchInput')?.addEventListener('input', () => this.renderContacts());
    document.getElementById('chatRoleFilter')?.addEventListener('change', () => this.loadChatUsers());
    await this.loadChatUsers();
  },
  async loadChatUsers() {
    const listContainer = document.getElementById('chatContactsList');
    if (!listContainer) return;
    listContainer.innerHTML = Helpers.skeleton(4);
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    const roleVal = document.getElementById('chatRoleFilter')?.value;
    const { data: users, error } = await DirectorApi.getChatUsers(currentUser.id, roleVal);
    if (error) throw new Error(error);

    const parentIds = (users || []).filter(u => u.role === 'padre').map(u => u.id);
    let studentMap = {};
    if (parentIds.length > 0) {
        const { data: students, error: sError } = await DirectorApi.getStudentsByParentIds(parentIds);
        if (!sError) {
          students?.forEach(s => !studentMap[s.parent_id] && (studentMap[s.parent_id] = { studentName: s.name, classroomName: s.classrooms?.name || 'Aula' }));
        }
    }
    // 🛡️ Fallback inteligente para nombres profesionales
    this.allContacts = (users || []).map(u => {
      const studentInfo = studentMap[u.id];
      const studentName = studentInfo?.studentName;
      const profileName = u.name || u.full_name || u.p1_name || 'Usuario';

      return {
        id: u.id,
        // 🛡️ Priorizar nombre del estudiante para padres, fallback al nombre del perfil
        name: u.role === 'padre' && studentName ? studentName : profileName,
        avatar: u.avatar_url,
        role: { maestra: 'Maestra', padre: 'Padre/Madre', asistente: 'Asistente' }[u.role] || u.role,
        meta: u.role === 'padre'
          ? `Estudiante: ${studentName || 'N/A'} • Aula: ${studentInfo?.classroomName || 'Sin asignar'} (${profileName})`
          : 'Personal Karpus'
      };
    });
    this.renderContacts();
  },

  async select(userId, name, role, meta, avatar) {
    return this.selectChat(userId, name, role, meta, avatar);
  },

  renderContacts() {
    const listContainer = document.getElementById('chatContactsList');
    if (!listContainer) return;
    const q = document.getElementById('chatSearchInput')?.value.toLowerCase() || '';
    const filtered = this.allContacts.filter(c => c.name.toLowerCase().includes(q) || c.meta.toLowerCase().includes(q));
    if (filtered.length === 0) { listContainer.innerHTML = Helpers.emptyState('No se encontraron contactos'); return; }
    listContainer.innerHTML = filtered.map(c => `
      <div onclick="App.chat.select('${c.id}', '${Helpers.escapeHTML(c.name)}', '${c.role}', '${c.meta}', '${c.avatar || ''}')" class="flex items-center gap-3 p-3 rounded-2xl hover:bg-white hover:shadow-sm cursor-pointer transition-all border border-transparent hover:border-slate-100 group">
        <div class="w-11 h-11 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold overflow-hidden border border-blue-50 shrink-0">
          ${c.avatar ? `<img src="${c.avatar}" class="w-full h-full object-cover">` : c.name.charAt(0)}
        </div>
        <div class="min-w-0 flex-1"><div class="font-bold text-slate-700 text-sm truncate group-hover:text-blue-600">${Helpers.escapeHTML(c.name)}</div><div class="text-[10px] text-slate-400 font-bold uppercase truncate">${c.role}</div><div class="text-[10px] text-slate-500 truncate mt-0.5">${c.meta}</div></div>
      </div>`).join('');
  },

  async selectChat(userId, name, role, meta, avatar) {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    this.currentChatUser = userId;
    document.getElementById('chatActiveHeader').classList.remove('hidden');
    document.getElementById('chatInputArea').classList.remove('hidden');
    document.getElementById('chatActiveName').textContent = name;
    document.getElementById('chatActiveMeta').textContent = `${role} • ${meta}`;
    document.getElementById('chatActiveAvatar').innerHTML = avatar ? `<img src="${avatar}" class="w-full h-full object-cover">` : name.charAt(0);
    const msgContainer = document.getElementById('chatMessagesContainer');
    msgContainer.innerHTML = `<div class="flex-1 flex items-center justify-center"><i data-lucide="loader-2" class="w-8 h-8 animate-spin text-blue-400"></i></div>`;
    if (window.lucide) lucide.createIcons();
    const { data: msgs, error } = await DirectorApi.getChatHistory(userId);
    if (error) throw new Error(error);

    msgContainer.innerHTML = '';
    if (msgs && msgs.length > 0) msgs.forEach(m => this.appendMessage(m, currentUser.id)); else { msgContainer.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-60"><i data-lucide="sparkles" class="w-12 h-12 mb-3 text-blue-300"></i><p class="text-sm">Inicia la conversación con ${name}</p></div>`; if (window.lucide) lucide.createIcons(); }
    this.scrollToBottom();
    
    if (this.chatChannel) {
      supabase.removeChannel(this.chatChannel);
      this.chatChannel = null;
    }
    
    this.chatChannel = supabase.channel(`chat_dir_${currentUser.id}_${userId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `or(sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id})` }, payload => { 
      const msg = payload.new;
      if (msg.sender_id === userId || msg.receiver_id === userId) { 
        if (msgContainer.querySelector('.opacity-60')) msgContainer.innerHTML = ''; 
        this.appendMessage(msg, currentUser.id); 
        this.scrollToBottom();
      } 
    }).subscribe();
  },

  appendMessage(msg, myId) {
    const container = document.getElementById('chatMessagesContainer');
    const isMine = msg.sender_id === myId;
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const safeContent = Helpers.escapeHTML(msg.content || '');
    const div = document.createElement('div');
    div.className = `flex ${isMine ? 'justify-end' : 'justify-start'} animate-fade-in`;
    div.innerHTML = `<div class="max-w-[85%] md:max-w-[70%] group"><div class="px-4 py-2.5 rounded-2xl text-xs shadow-sm ${isMine ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none'}"><div class="whitespace-pre-wrap break-words">${safeContent}</div><div class="text-[9px] ${isMine ? 'text-blue-200' : 'text-slate-400'} mt-1 text-right font-bold uppercase">${time}</div></div></div>`;
    container.appendChild(div);
  },
 
  async sendChatMessage() {
    const input = document.getElementById('chatMessageInput');
    const text = input?.value.trim();
    
    if (!text || !this.currentChatUser) return;
    if (text.length > 500) return Helpers.toast('Mensaje demasiado largo', 'warning');
    
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    this.appendMessage({ content: text, sender_id: currentUser.id, created_at: new Date().toISOString(), status: 'pending' }, currentUser.id);
    this.scrollToBottom();
    input.value = ''; 
    input.style.height = 'auto';
    
    try {
      const { error } = await DirectorApi.sendMessage(currentUser.id, this.currentChatUser, text);
      if (error) throw new Error(error);
      sendPush({ user_id: this.currentChatUser, title: 'Nuevo mensaje de Dirección', message: text, type: 'chat' });
    } catch (e) { 
      console.error(e); 
      Helpers.toast('Error al enviar mensaje', 'error');
      // ❌ eliminar mensaje temporal
      const container = document.getElementById('chatMessagesContainer');
      container.lastChild?.remove();
    }
  }
};

/**
 * Inicialización principal del Panel de Directora
 */
async function initApp() {
  console.log('🚀 Karpus Admin Module Starting...');
  const auth = await ensureRole(['directora', 'admin']);
  if (!auth) return;
  
  AppState.set('user', auth.user);
  AppState.set('profile', auth.profile);

  // ============================================================
  // ⚡ 1. ACTIVAR INTERFAZ INMEDIATAMENTE (Prioridad Alta)
  // ============================================================
  
  // Botones principales (Modales) - Se activan SIN esperar datos
  const bindClick = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
  };

  bindClick('btnAddStudent', () => openNewStudentModal());
  bindClick('btnNewPayment', () => PaymentsModule.openPaymentModal());
  bindClick('btnAddAssistant', () => openCreateTeacherModal());
  bindClick('btnAddRoom', () => openCreateRoomModal());
  bindClick('btnToggleStuView', toggleStudentView);
  bindClick('btnLogout', async () => { await supabase.auth.signOut(); window.location.href = 'login.html'; });

  // Navegación Dashboard
  bindClick('cardReportes', () => App.navigation.goTo('reportes'));
  bindClick('cardMuro', () => App.navigation.goTo('muro'));
  bindClick('cardVideoconferencia', () => App.navigation.goTo('videoconferencia'));
  bindClick('cardComunicaciones', () => App.navigation.goTo('comunicacion'));

  // Acciones Rápidas
  bindClick('btnRefreshAttendance', () => AttendanceModule.loadAttendance());
  bindClick('btnRefreshDashboard', async () => {
    const btn = document.getElementById('btnRefreshDashboard');
    if(btn) btn.classList.add('animate-spin');
    await initDashboard();
    if(btn) btn.classList.remove('animate-spin');
    Helpers.toast('Dashboard actualizado', 'success');
  });
  
  // Configuración
  bindClick('btnSaveConfig', saveConfigProfile);

  // Inicializar Navegación (Tabs)
  initNavigation();

  // 🔔 Inicializar Notificaciones Push
  try { initOneSignal(auth.user); } catch(e) { console.error("OneSignal init error:", e); }

  // Render Perfil
  const profile = auth.profile;
  document.getElementById('sidebarName').textContent = profile?.name || 'Directora';
  const avatarUrl = profile?.avatar_url;
  document.getElementById('sidebarAvatar').innerHTML = avatarUrl
      ? `<img src="${avatarUrl}" class="w-full h-full object-cover" onerror="this.src='img/mundo.jpg';">`
      : `<div class="w-full h-full flex items-center justify-center text-xl font-black text-orange-600 bg-orange-50">${(profile?.name || 'D').charAt(0)}</div>`;
  
  // Inicializar Módulos
  await loadProfile(); // 👤 Cargar perfil dinámico
  
  // Carga Paralela Robusta (Si falla uno, los demás siguen funcionando)
  const modules = [
    { name: 'Dashboard', fn: initDashboard },
    { name: 'DashboardSub', fn: () => DashboardService.subscribeToChanges() },
    { name: 'Attendance', fn: () => AttendanceModule.init() },
    { name: 'Payments', fn: () => PaymentsModule.init() },
    { name: 'Chat', fn: () => ChatModule.init() },
    { name: 'VideoCall', fn: () => VideoCallModule.init() },
    { name: 'Wall', fn: () => WallModule.init('muroPostsContainer', { accentColor: 'orange' }, AppState) },
    { name: 'Reports', fn: initReports }
  ];

  Promise.allSettled(modules.map(m => m.fn()))
    .then(results => {
      results.forEach((res, index) => {
        if (res.status === 'rejected') {
          console.warn(`⚠️ Módulo ${modules[index].name} falló al cargar:`, res.reason);
        }
      });
    });

  // Event listeners adicionales que no dependen de la carga
  const attendanceDateInput = document.getElementById('attendanceDateFilter');
  if (attendanceDateInput) {
    attendanceDateInput.value = new Date().toISOString().split('T')[0];
    attendanceDateInput.addEventListener('change', () => AttendanceModule.loadAttendance());
  }
  document.getElementById('btnRefreshAttendance')?.addEventListener('click', () => AttendanceModule.loadAttendance());

  // Listener delegado para navegación (data-action)
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action="go-section"]');
    if (!el) return;
    const section = el.dataset.section;
    if (section) App.navigation.goTo(section);
  });

  // Listener Global para cerrar modales (ESC)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') UIHelpers.closeModal();
  });

  // Listener Global para cerrar modal al hacer clic fuera (Backdrop)
  document.addEventListener('click', (e) => {
    if (e.target.id === 'globalModalContainer') UIHelpers.closeModal();
  });

  // Mostrar Dashboard por defecto
  goToSection('dashboard');

  // Inicializar el Muro (WallModule) con su contenedor correcto
  window.WallModule = WallModule; // Exponer globalmente para onclicks del HTML
  WallModule.init('muroPostsContainer', { accentColor: 'orange' }, AppState);

  // Cargar Perfil dinámico
  loadProfile();

  if (window.lucide) window.lucide.createIcons();
}

// ====================================================================================
// 🧠 6. DEFINICIÓN GLOBAL DE APP
// ====================================================================================
window.App = window.App || {};
window.App = {
  navigation: {
    goTo: goToSection,
  },
  students: {
    openModal: openNewStudentModal,
    save: saveStudent,
    edit: openEditStudentModal,
    delete: deleteStudent
  },
  teachers: {
    openCreateModal: openCreateTeacherModal,
    edit: openEditTeacherModal,
    save: saveTeacher,
  },
  rooms: {
    openModal: openCreateRoomModal,
    save: saveRoom,
  },
  payments: {
    ...PaymentsModule,
    delete: deletePaymentHandler,
    openPaymentModal: () => PaymentsModule.openPaymentModal() // Helper directo
  },
  attendance: AttendanceModule,
  grades: GradesModule,
  ui: DirectorUI,
  inquiries: {
    openDetail: openInquiryDetail,
    filter: filterReports,
    reply: replyInquiry
  },
  chat: ChatModule,
  wall: {
    toggleCommentSection: (pid) => WallModule.toggleCommentSection(pid),
    sendComment: (pid) => WallModule.sendComment(pid),
    deletePost: (pid) => WallModule.deletePost(pid),
    toggleLike: (pid) => WallModule.toggleLike(pid)
  }
};

// Arrancar la app cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// ✅ Función extraída para guardar configuración
async function saveConfigProfile() {
  const btn = document.getElementById('btnSaveConfig');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Guardando...';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const updates = {
      name: document.getElementById('confDirName')?.value,
      title: document.getElementById('confDirTitle')?.value,
      bio: document.getElementById('confDirBio')?.value,
      phone: document.getElementById('confPhone')?.value,
      email: document.getElementById('confEmail')?.value,
      address: document.getElementById('confAddress')?.value,
      updated_at: new Date()
    };

    const { error } = await supabase.from('profiles').update(updates).eq('id', user.id);
    if (error) throw error;
    
    Helpers.toast('Configuración actualizada correctamente', 'success');
    await loadProfile(); // Refrescar UI
  } catch (e) {
    console.error('Error saving config:', e);
    Helpers.toast('Error al guardar la configuración', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="save" class="w-4 h-4"></i> Guardar Cambios';
      if (window.lucide) lucide.createIcons();
    }
  }
}

/**
 * 👤 CARGAR PERFIL DINÁMICO (Avatar y Datos)
 */
async function initDashboard() {
  try {
    // 📊 Cargar TODO en paralelo desde Dashboard Service
    const dashboardData = await DashboardService.getFullData();
    AppState.set('dashboardData', dashboardData);
    AppState.set('stats', dashboardData.kpis);

    // 🎨 Renderizar KPIs
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    const kpis = dashboardData.kpis || {};
    setTxt('kpiStudents', kpis.total || 0);
    setTxt('kpiTeachers', kpis.teachers || 0);
    setTxt('kpiClassrooms', kpis.classrooms || 0);
    setTxt('kpiIncidents', kpis.inquiries || 0);
    
    // Porcentaje de asistencia
    const attTotal = dashboardData.attendance?.today?.total || 0;
    const attPresent = (dashboardData.attendance?.today?.present || 0) + (dashboardData.attendance?.today?.late || 0);
    const attPercent = attTotal > 0 ? Math.round((attPresent / attTotal) * 100) : 0;
    setTxt('kpiAttendance', `${attPercent}%`);
    
    setTxt('kpiPendingMoney', `$${dashboardData.payments?.summary?.total_pending || 0}`);

    // 👨‍🎓 Renderizar estudiantes recientes (primeros 10)
    const studentsContainer = document.getElementById('recentStudents');
    // También renderizar KPIs específicos de estudiantes si estamos en dashboard
    const stuKpiTotal = document.getElementById('stuKpiTotal');
    if (stuKpiTotal) stuKpiTotal.textContent = kpis.total || 0;

    if (studentsContainer) {
      if (dashboardData.students?.recent?.length) {
        studentsContainer.innerHTML = dashboardData.students.recent
          .slice(0, 10)
          .map(s => `
            <div class="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100 hover:shadow-md transition-all cursor-pointer group" 
                 onclick="App.navigation.goTo('estudiantes')">
              <div class="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center font-black overflow-hidden">
                ${s.avatar_url ? `<img src="${s.avatar_url}" class="w-full h-full object-cover">` : (s.name || '?').charAt(0)}
              </div>
              <div class="min-w-0 flex-1">
                <div class="font-bold text-slate-800 text-sm truncate group-hover:text-purple-600">${Helpers.escapeHTML(s.name || 'Estudiante')}</div>
                <div class="text-[10px] text-slate-400 font-bold uppercase">${s.classrooms?.name || 'Sin aula'}</div>
              </div>
              <i data-lucide="chevron-right" class="w-4 h-4 text-slate-300 group-hover:text-purple-400 transition-colors"></i>
            </div>
          `)
          .join('');
      } else {
        studentsContainer.innerHTML = Helpers.emptyState('No hay estudiantes recientes');
      }
    }

    // 🏫 Renderizar aulas con semáforo
    const classroomsContainer = document.getElementById('classroomsGrid');
    if (classroomsContainer) {
      if (dashboardData.classrooms?.length) {
        classroomsContainer.innerHTML = dashboardData.classrooms
          .map(c => {
            const color = c.occupancyStatus === 'red' ? 'border-rose-200 bg-rose-50 text-rose-700' :
                          c.occupancyStatus === 'yellow' ? 'border-amber-200 bg-amber-50 text-amber-700' :
                          'border-emerald-200 bg-emerald-50 text-emerald-700';
            const percent = c.max_capacity ? Math.round((c.current_capacity / c.max_capacity) * 100) : 0;
            return `
              <div class="p-4 border-2 rounded-2xl ${color} flex flex-col items-center text-center">
                <div class="font-black text-sm mb-1">${Helpers.escapeHTML(c.name || 'Aula')}</div>
                <div class="text-[10px] font-bold uppercase opacity-70 mb-2">${c.current_capacity || 0}/${c.max_capacity || 0} Niños</div>
                <div class="w-full h-1.5 bg-white/50 rounded-full overflow-hidden">
                  <div class="h-full bg-current opacity-50" style="width: ${percent}%"></div>
                </div>
              </div>
            `;
          })
          .join('');
      } else {
        classroomsContainer.innerHTML = Helpers.emptyState('No hay aulas');
      }
    }

    // 💳 Renderizar pagos pendientes (primeros 5)
    const paymentsContainer = document.getElementById('pendingPaymentsList');
    if (paymentsContainer) {
      if (dashboardData.payments?.pending?.length) {
        paymentsContainer.innerHTML = dashboardData.payments.pending
          .slice(0, 5)
          .map(p => `
            <div class="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-2xl hover:shadow-sm transition-all">
              <div class="min-w-0">
                <div class="font-bold text-slate-800 text-sm truncate">${Helpers.escapeHTML(p.students?.name || 'Estudiante')}</div>
                <div class="text-[10px] text-slate-400 font-bold uppercase">Vence: ${new Date(p.created_at).toLocaleDateString()}</div>
              </div>
              <div class="text-sm font-black text-rose-600">$${p.amount}</div>
            </div>
          `)
          .join('');
      } else {
        paymentsContainer.innerHTML = Helpers.emptyState('Sin pagos pendientes');
      }
    }

    // 📋 Renderizar incidencias activas
    const inquiriesContainer = document.getElementById('activeInquiries');
    if (inquiriesContainer) {
      if (dashboardData.inquiries?.active?.length) {
        inquiriesContainer.innerHTML = dashboardData.inquiries.active
          .map(i => `
            <div class="p-3 bg-pink-50 border border-pink-100 rounded-2xl hover:shadow-sm transition-all cursor-pointer" onclick="App.navigation.goTo('reportes')">
              <div class="flex items-center justify-between mb-1">
                <div class="font-bold text-pink-800 text-sm truncate">${Helpers.escapeHTML(i.subject || 'Incidencia')}</div>
                <span class="text-[9px] px-2 py-0.5 bg-pink-200 text-pink-700 rounded-full font-black uppercase">${i.priority || 'Media'}</span>
              </div>
              <div class="text-[11px] text-pink-600 line-clamp-1">${Helpers.escapeHTML(i.message || '')}</div>
            </div>
          `)
          .join('');
      } else {
        inquiriesContainer.innerHTML = Helpers.emptyState('Sin incidencias activas');
      }
    }

    // 📊 Renderizar gráficos de asistencia (hoy)
    if (dashboardData.attendance?.today?.total > 0) {
      AttendanceModule.updatePieChart({
        present: dashboardData.attendance.today.present,
        absent: dashboardData.attendance.today.absent,
        late: dashboardData.attendance.today.late
      });
    }

    if (window.lucide) lucide.createIcons();
    console.log('✅ Dashboard cargado exitosamente');
  } catch (error) {
    console.error('❌ Error al cargar dashboard:', error);
    Helpers.toast('Error al cargar datos del dashboard', 'error');
  }
}

function initNavigation() {
  const navLinks = document.querySelectorAll('[data-section]');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.dataset.section;
      document.querySelectorAll('section.section').forEach(s => {
        s.classList.add('hidden');
        s.classList.remove('active');
      });
      const targetSec = document.getElementById(target);
      if (targetSec) {
        targetSec.classList.remove('hidden');
        targetSec.classList.add('active');
        AppState.set('currentSection', target);
        
        // Cargar data de la sección activa
        if (target === 'dashboard') initDashboard();
        if (target === 'maestros') initTeachersSection();
        if (target === 'estudiantes') initStudentsSection();
        if (target === 'aulas') initClassroomsSection();
        if (target === 'calificaciones') GradesModule.init();
        if (target === 'asistencia') AttendanceModule.loadAttendance();
        if (target === 'pagos') PaymentsModule.loadPayments();
        if (target === 'reportes') initReports();
        if (target === 'muro') WallModule.loadPosts(1);
        if (target === 'videoconferencia') VideoCallModule.init();
      }
    });
  });
}

function goToSection(sectionId) {
  const link = document.querySelector(`.nav-btn[data-section="${sectionId}"], [data-action="go-section"][data-section="${sectionId}"]`);
  if (link) {
    // Si es un botón de navegación real, disparar el evento click
    if (link.classList.contains('nav-btn')) {
      link.click();
    } else {
      // Si es un acceso directo, simular el comportamiento de navegación
      const targetSec = document.getElementById(sectionId);
      if (targetSec) {
        document.querySelectorAll('section.section').forEach(s => {
          s.classList.add('hidden');
          s.classList.remove('active');
        });
        targetSec.classList.remove('hidden');
        targetSec.classList.add('active');
        AppState.set('currentSection', sectionId);
        
        // Disparar carga de datos
        if (sectionId === 'dashboard') initDashboard();
        if (sectionId === 'maestros') initTeachersSection();
        if (sectionId === 'estudiantes') initStudentsSection();
        if (sectionId === 'aulas') initClassroomsSection();
        if (sectionId === 'calificaciones') GradesModule.init();
        if (sectionId === 'asistencia') AttendanceModule.loadAttendance();
        if (sectionId === 'pagos') PaymentsModule.loadPayments();
        if (sectionId === 'reportes') initReports();
        if (sectionId === 'muro') WallModule.loadPosts(1);
        if (sectionId === 'videoconferencia') VideoCallModule.init();
      }
    }
  } else {
    // Fallback: Mostrar directamente si el ID existe pero no el botón
    const targetSec = document.getElementById(sectionId);
    if (targetSec) {
      document.querySelectorAll('section.section').forEach(s => {
        s.classList.add('hidden');
        s.classList.remove('active');
      });
      targetSec.classList.remove('hidden');
      targetSec.classList.add('active');
      AppState.set('currentSection', sectionId);
      if (sectionId === 'dashboard') initDashboard();
    }
  }
}

async function initStudentsSection() {
  const container = document.getElementById('studentsGrid');
  if (!container) return;
  container.innerHTML = '<div class="col-span-3 text-center p-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div></div>';
  try {
    const { data: students, error } = await DirectorApi.getStudents();
    if (error) throw new Error(error);

    // 1. CARGA DE KPIs REALES (Estudiantes)
    const total = students.length;
    const active = students.filter(s => s.is_active).length;
    
    // Obtener datos globales del dashboard para complementar
    let dashboardData = AppState.get('dashboardData');
    if (!dashboardData || !dashboardData.kpis) {
       // Si no hay datos, intentar recuperarlos silenciosamente o usar fallbacks
       try { dashboardData = await DashboardService.getFullData(); } catch(e) {}
    }
    const kpis = dashboardData?.kpis || {};
    const attToday = dashboardData?.attendance?.today || { present: 0, late: 0, total: 0 };

    const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    
    setTxt('stuKpiTotal', total);
    setTxt('stuKpiActive', active);
    setTxt('stuKpiIncidents', kpis.inquiries || 0); // Incidencias globales
    setTxt('stuKpiByClass', dashboardData?.classrooms?.length || 0);
    setTxt('stuKpiAvg', '9.2'); // Simulado o calcular si existen notas
    
    const attPct = attToday.total > 0 ? Math.round(((attToday.present + attToday.late) / attToday.total) * 100) : 0;
    setTxt('stuKpiAttendance', `${attPct}%`);

    AppState.set('students', students || []);
    
    // ✅ NUEVO: Conectar botón de exportar estudiantes
    const btnExport = document.getElementById('btnExportStudents');
    // Clonar nodo para limpiar listeners viejos si existen
    if (btnExport) {
      const newBtn = btnExport.cloneNode(true);
      btnExport.parentNode.replaceChild(newBtn, btnExport);
      newBtn.addEventListener('click', async () => {
         Helpers.toast('Generando lista de estudiantes...', 'info');
         const list = AppState.get('students') || []; // Usar estado actual cargado
         
         if (!list.length) return Helpers.toast('No hay estudiantes visibles', 'warning');

         const exportData = list.map(s => ({
           Matricula: s.matricula || '',
           Nombre: s.name,
           Aula: s.classrooms?.name || 'Sin Aula',
           Estado: s.is_active ? 'Activo' : 'Inactivo',
           Tutor1: s.p1_name || '',
           Telefono1: s.p1_phone || '',
           Email1: s.p1_email || '',
           Alergias: s.allergies || ''
         }));

         Helpers.exportToCSV(exportData, `Estudiantes_Karpus_${new Date().toISOString().slice(0,10)}.csv`);
      });
    }

    if (!students?.length) {
      container.innerHTML = '<div class="col-span-3 text-center p-8 text-slate-500">No hay estudiantes.</div>';
      return;
    }
    container.innerHTML = students.map(s => DirectorUI.renderStudentCard(s)).join('');
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error(e);
    container.innerHTML = '<div class="col-span-3 text-center p-8 text-red-500">Error al cargar.</div>';
  }
}

// ✅ SAFE DATA HELPER (Uso global)
function safeData(res, fallback = null) {
  return res?.data ?? fallback;
}

async function saveStudent() {
  const id = document.getElementById('stId')?.value;
  const payload = getStudentFormData();

  if (!payload.name || payload.name.trim().length < 3) return Helpers.toast('Nombre inválido (min 3 caracteres)', 'warning');
  if (!payload.p1_name || !payload.p1_phone || !payload.p1_email) return Helpers.toast('Datos del padre/madre 1 incompletos', 'warning');
  if (!validateEmail(payload.p1_email)) return Helpers.toast('Correo padre/madre 1 inválido', 'warning');
  
  UIHelpers.setLoading(true);
  try {
    const res = id 
      ? await DirectorApi.updateStudent(id, payload)
      : await DirectorApi.createStudent(payload);
    
    const { error } = res || {};
    if (error) throw new Error(error);
    
    Helpers.toast(id ? 'Estudiante actualizado' : 'Estudiante creado', 'success');
    UIHelpers.closeModal();
    initStudentsSection();
  } catch (e) {
    console.error('Error saveStudent:', e);
    Helpers.toast('Error al guardar: ' + (e.message || e), 'error');
  } finally {
    UIHelpers.setLoading(false);
  }
}

async function deleteStudent(id) {
  if (!confirm('¿Seguro que desea eliminar a este estudiante?')) return;
  try {
    const res = await DirectorApi.deleteStudent(id);
    const { error } = res || {};
    if (error) throw new Error(error);
    Helpers.toast('Estudiante eliminado con éxito.', 'success');
    initStudentsSection();
  } catch (e) {
    Helpers.toast('Error al eliminar estudiante.', 'error');
    console.error('Error deleteStudent:', e);
  }
}

// ⚡ NUEVA FUNCIÓN: Modal de Importación de Estudiantes
window.openImportStudentModal = function() {
  const html = `
    <div class="modal-header bg-emerald-600 text-white p-6 rounded-t-3xl">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl shadow-inner">📂</div>
        <div>
          <h3 class="text-xl font-black">Importación Masiva</h3>
          <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Carga desde Excel/CSV</p>
        </div>
      </div>
      <button onclick="UIHelpers.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors"><i data-lucide="x" class="w-6 h-6"></i></button>
    </div>
    <div class="p-8 bg-slate-50 space-y-6">
      <div class="bg-white p-6 rounded-2xl border-2 border-dashed border-slate-300 text-center hover:border-emerald-400 transition-colors group cursor-pointer relative">
        <input type="file" id="csvFileInput" accept=".csv" class="absolute inset-0 opacity-0 cursor-pointer" onchange="window.previewCSV(this)">
        <div class="pointer-events-none">
          <i data-lucide="file-spreadsheet" class="w-12 h-12 mx-auto text-slate-300 group-hover:text-emerald-500 mb-2 transition-colors"></i>
          <p class="font-bold text-slate-600">Arrastra tu archivo CSV aquí</p>
          <p class="text-xs text-slate-400 mt-1">o haz clic para buscar</p>
        </div>
      </div>
      <div class="text-xs text-slate-500 space-y-1">
        <p class="font-bold uppercase">Formato requerido (cabeceras):</p>
        <code class="block bg-slate-200 p-2 rounded text-slate-600">nombre, email_tutor, telefono_tutor, nombre_tutor</code>
      </div>
      <div id="csvPreview" class="hidden max-h-40 overflow-y-auto bg-white rounded-xl border border-slate-200 p-2 text-xs font-mono"></div>
    </div>
    <div class="p-6 bg-white rounded-b-3xl flex justify-end gap-3">
      <button onclick="UIHelpers.closeModal()" class="px-6 py-2.5 rounded-xl font-bold text-slate-500 hover:bg-slate-100">Cancelar</button>
      <button onclick="window.processImport()" id="btnProcessImport" class="px-6 py-2.5 rounded-xl font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed">Importar Estudiantes</button>
    </div>
  `;
  openGlobalModal(html);
};

window.previewCSV = function(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    document.getElementById('csvPreview').textContent = text.slice(0, 500) + '...';
    document.getElementById('csvPreview').classList.remove('hidden');
  };
  reader.readAsText(file);
};

window.processImport = async function() {
  const input = document.getElementById('csvFileInput');
  const file = input?.files[0];
  if (!file) return Helpers.toast('Selecciona un archivo CSV', 'warning');

  UIHelpers.setLoading(true, '#globalModalContainer', '#btnProcessImport');
  
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const text = e.target.result;
      const rows = text.split('\n').slice(1); // Ignorar header
      const students = rows.filter(r => r.trim()).map(row => {
        const cols = row.split(',');
        return {
          name: cols[0]?.trim(),
          p1_email: cols[1]?.trim(),
          p1_phone: cols[2]?.trim(),
          p1_name: cols[3]?.trim(),
          is_active: true
        };
      });

      if (students.length === 0) throw new Error('Archivo vacío o formato incorrecto');

      const { error } = await DirectorApi.importStudentsBatch(students);
      if (error) throw error;

      Helpers.toast(`Se importaron ${students.length} estudiantes`, 'success');
      UIHelpers.closeModal();
      initStudentsSection();
    } catch (err) {
      console.error(err);
      Helpers.toast('Error en importación: ' + err.message, 'error');
    } finally {
      UIHelpers.setLoading(false, '#globalModalContainer', '#btnProcessImport');
    }
  };
  reader.readAsText(file);
};

async function initTeachersSection() {
  const container = document.getElementById('teachersGrid');
  if (!container) return;
  container.innerHTML = '<div class="col-span-3 text-center p-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div></div>';
  try {
    // 🔥 FIX: Consulta directa robusta incluyendo AULAS (classrooms)
    const { data: teachers, error } = await supabase
      .from('profiles')
      .select('*, classrooms(id, name)')
      .in('role', ['maestra', 'asistente'])
      .order('name');

    if (error) throw new Error(error);

    // 📊 CORRECCIÓN: Calcular y renderizar KPIs de maestros
    const total = teachers.length;
    const active = teachers.filter(t => t.is_active !== false).length;
    const assistants = teachers.filter(t => t.role === 'asistente').length;
    // Contar si tiene aula asignada (ya sea por ID directo o relación inversa)
    const inClass = teachers.filter(t => t.classroom_id || (t.classrooms && t.classrooms.length > 0)).length;

    const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    setTxt('kpiStaffTotal', total);
    setTxt('kpiStaffActive', active);
    setTxt('kpiStaffInClass', inClass); 
    setTxt('kpiStaffAssistants', assistants);

    AppState.set('teachers', teachers);
    if (!teachers?.length) {
      container.innerHTML = '<div class="col-span-3 text-center p-8 text-slate-500">No hay maestras.</div>';
      return;
    }
    container.innerHTML = teachers.map(t => DirectorUI.renderTeacherCard(t)).join('');
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error('Error initTeachersSection:', e);
    container.innerHTML = '<div class="col-span-3 text-center p-8 text-red-500">Error al cargar.</div>';
  }
}

async function saveTeacher() {
  const id = document.getElementById('tId')?.value;
  const payload = {
    name: (document.getElementById('tName').value || '').trim(),
    phone: (document.getElementById('tPhone').value || '').trim(),
    email: (document.getElementById('tEmail').value || '').trim(),
    role: document.getElementById('tRole').value,
    classroom_id: document.getElementById('tClassroom').value || null,
    is_active: document.getElementById('tActive').checked
  };
  
  const password = document.getElementById('tPassword')?.value;

  if (!payload.name || payload.name.length < 3) return Helpers.toast('Nombre inválido (min 3 caracteres)', 'warning');
  if (!payload.email) return Helpers.toast('Correo requerido', 'warning');
  
  UIHelpers.setLoading(true);
  try {
    let res;
    
    if (id) {
      // ACTUALIZAR
      res = await DirectorApi.updateTeacher(id, payload);
    } else {
      // CREAR NUEVO (Con Auth)
      if (!password || password.length < 6) throw new Error('Contraseña requerida (mínimo 6 caracteres)');
      
      // Cliente temporal sin persistencia para no cerrar sesión a la directora
      const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
         auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      
      const { data: authData, error: authError } = await tempClient.auth.signUp({
        email: payload.email,
        password: password,
        options: { data: { name: payload.name, role: payload.role, phone: payload.phone } }
      });
      
      if (authError) throw authError;
      if (authData.user) {
         // Asegurar que el perfil se actualice con los datos extra
         await DirectorApi.updateTeacher(authData.user.id, payload);
         res = { data: authData.user, error: null };
      }
    }
    
    const { error } = res || {};
    if (error) throw new Error(error);
    
    Helpers.toast(id ? 'Maestra actualizada' : 'Maestra creada', 'success');
    UIHelpers.closeModal();
    initTeachersSection();
  } catch (e) {
    console.error('Error saveTeacher:', e);
    Helpers.toast('Error al guardar: ' + (e.message || e), 'error');
  } finally {
    UIHelpers.setLoading(false);
  }
}

async function deletePaymentHandler(id) {
  if (!confirm('¿Seguro que desea eliminar este pago?')) return;
  try {
    const res = await DirectorApi.deletePayment(id);
    const { error } = res || {};
    if (error) throw new Error(error);
    Helpers.toast('Pago eliminado');
    PaymentsModule.loadPayments();
  } catch (e) {
    console.error('Error deletePaymentHandler:', e);
    Helpers.toast('Error al eliminar pago', 'error');
  }
}

// 🧠 3. CONSTRUCCIÓN SEGURA DEL PAYLOAD (SOLO COLUMNAS REALES BD)
function getStudentFormData() {
  // Nota: 'age' y 'horario' son visuales, no se guardan en BD según esquema
  return {
    name: document.getElementById('stName')?.value,
    classroom_id: document.getElementById('stClassroom')?.value || null,
    start_date: document.getElementById('stJoinedDate')?.value || new Date().toISOString().split('T')[0], // Mapeado de joined_date
    is_active: document.getElementById('active')?.checked,
    
    // Salud
    blood_type: document.getElementById('bloodType')?.value,
    allergies: document.getElementById('allergies')?.value,
    authorized_pickup: document.getElementById('authorized')?.value,

    // Tutor 1 (Principal)
    p1_name: document.getElementById('p1Name')?.value,
    p1_phone: document.getElementById('p1Phone')?.value,
    p1_job: document.getElementById('p1Profession')?.value, // Mapeado de p1_profession
    p1_address: document.getElementById('p1Address')?.value,
    p1_emergency_contact: document.getElementById('p1Emergency')?.value,
    p1_email: document.getElementById('stEmailNotif')?.value, // Correo de notificaciones

    // Tutor 2 (Secundario)
    p2_name: document.getElementById('p2Name')?.value,
    p2_phone: document.getElementById('p2Phone')?.value,
    p2_job: document.getElementById('p2Profession')?.value, // Nuevo campo
    p2_address: document.getElementById('p2Address')?.value, // Nuevo campo
    
    // Finanzas
    monthly_fee: parseFloat(document.getElementById('monthlyFee')?.value || 0),
    due_day: parseInt(document.getElementById('dueDay')?.value || 5)
  };
}

// 2. FUNCIÓN GLOBAL GENERAR MATRÍCULA
window.generateMatricula = function() {
  const year = new Date().getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000); // 4 dígitos aleatorios
  const matricula = `STU-${year}-${random}`;
  const input = document.getElementById('stMatricula');
  if (input) input.value = matricula;
};

async function openNewStudentModal() {
  const inputClass = "w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium";
  const labelClass = "block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1";
  
  const modalHTML = `
    <div class="modal-header bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6 rounded-t-3xl">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl shadow-inner">👶</div>
        <div>
          <h3 class="text-xl font-black">Crear Estudiante</h3>
          <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Nuevo Registro</p>
        </div>
      </div>
      <button onclick="UIHelpers.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors">
        <i data-lucide="x" class="w-6 h-6"></i>
      </button>
    </div>
    
    <div class="modal-body p-8 bg-slate-50/30" id="studentForm">
      <div class="grid grid-cols-1 gap-8">
        <input type="hidden" id="stId" />
        
        <!-- 1. FOTO Y MATRÍCULA -->
        <div class="flex flex-col md:flex-row gap-6 items-center bg-white p-6 rounded-3xl border-2 border-slate-100 shadow-sm">
          <div class="relative group cursor-pointer">
            <div id="stAvatarPreview" class="w-24 h-24 rounded-[2rem] bg-slate-100 border-4 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 group-hover:border-purple-400 group-hover:bg-purple-50 transition-all overflow-hidden">
              <i data-lucide="camera" class="w-8 h-8 mb-1"></i>
              <span class="text-[9px] font-black uppercase">Foto</span>
            </div>
            <input type="file" id="stAvatarFile" class="absolute inset-0 opacity-0 cursor-pointer" accept="image/*">
          </div>
          
          <div class="flex-1 w-full">
            <h4 class="text-sm font-black text-slate-800 mb-3">📷 FOTO Y MATRÍCULA</h4>
            <div class="flex gap-2">
              <div class="relative flex-1">
                <i data-lucide="hash" class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"></i>
                <input id="stMatricula" placeholder="Generar automática..." class="${inputClass} pl-10 bg-white" readonly>
              </div>
              <button onclick="generateMatricula()" class="px-6 py-2 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase hover:bg-indigo-700 shadow-md transition-all active:scale-95">Generar</button>
            </div>
            <div class="grid grid-cols-2 gap-4 mt-3">
               <div><label class="${labelClass}">Fecha inscripción</label><input type="date" id="stJoinedDate" class="${inputClass}"></div>
               <div class="flex items-center pt-6">
                  <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="active" checked class="w-5 h-5 rounded text-emerald-600"><span class="text-sm font-black text-emerald-700 uppercase">Estado Activo</span></label>
               </div>
            </div>
          </div>
        </div>

        <!-- 2. INFORMACIÓN DEL ESTUDIANTE -->
        <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
          <h4 class="text-sm font-black text-slate-800 flex items-center gap-2 mb-4">
            <span class="w-8 h-8 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
              <i data-lucide="user" class="w-4 h-4"></i>
            </span>
            👦 INFORMACIÓN DEL ESTUDIANTE
          </h4>
          
          <div>
            <label class="${labelClass}">Nombre completo</label>
            <input id="stName" placeholder="Ej: Juan Pérez" class="${inputClass}">
          </div>
          
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="${labelClass}">Edad</label>
              <input id="stAge" placeholder="Ej: 5" type="number" class="${inputClass}">
            </div>
            <div>
              <label class="${labelClass}">Horario</label>
              <input id="stHorario" placeholder="08:00-12:00" class="${inputClass}">
            </div>
          </div>
          
          <div>
            <label class="${labelClass}">Aula</label>
            <div class="relative">
              <i data-lucide="home" class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"></i>
              <select id="stClassroom" class="${inputClass} pl-10 appearance-none">
                <option value="">-- Seleccionar Aula --</option>
              </select>
            </div>
          </div>
        </div>

        <!-- 3. ACCESO DEL ESTUDIANTE -->
        <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
          <h4 class="text-sm font-black text-slate-800 flex items-center gap-2 mb-4">
            <span class="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center"><i data-lucide="lock" class="w-4 h-4"></i></span>
            🔐 ACCESO Y NOTIFICACIONES
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="${labelClass}">Correo de Usuario (Login)</label>
              <input id="stEmailUser" placeholder="usuario@karpus.com" type="email" class="${inputClass}">
            </div>
            <div>
              <label class="${labelClass}">Correo de Notificaciones</label>
              <input id="stEmailNotif" placeholder="avisos@ejemplo.com" type="email" class="${inputClass}">
            </div>
            <div>
              <label class="${labelClass}">Contraseña (Min 6 caracteres)</label>
              <input id="stPassword" type="text" placeholder="********" class="${inputClass}">
            </div>
          </div>
        </div>

        <!-- 4. SALUD Y SEGURIDAD -->
        <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
          <h4 class="text-sm font-black text-slate-800 flex items-center gap-2 mb-4">
            <span class="w-8 h-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center"><i data-lucide="heart-pulse" class="w-4 h-4"></i></span>
            🩺 SALUD Y SEGURIDAD
          </h4>
          
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="${labelClass}">Tipo Sangre</label>
              <select id="bloodType" class="${inputClass}">
                <option value="O+">O+</option>
                <option value="O-">O-</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
              </select>
            </div>
            <div>
              <label class="${labelClass}">Alergias</label>
              <input id="allergies" placeholder="Ej: Maní, Polvo" class="${inputClass}">
            </div>
          </div>
          
          <div>
            <label class="${labelClass}">Autorizados para recoger</label>
            <textarea id="authorized" rows="2" placeholder="Ej: Abuela Carmen, Tío Juan" class="${inputClass} resize-none"></textarea>
          </div>
        </div>

        <!-- 5. TUTOR PRINCIPAL -->
        <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
          <h4 class="text-sm font-black text-slate-800 flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center"><i data-lucide="user" class="w-4 h-4"></i></div>
            👨‍👩‍👦 TUTOR PRINCIPAL
          </h4>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="${labelClass}">Nombre</label>
              <input id="p1Name" placeholder="Nombre completo" class="${inputClass}">
            </div>
            <div>
              <label class="${labelClass}">Teléfono</label>
              <input id="p1Phone" placeholder="Teléfono" class="${inputClass}">
            </div>
            <div>
              <label class="${labelClass}">Profesión</label>
              <input id="p1Profession" placeholder="Ej: Ingeniero" class="${inputClass}">
            </div>
            <div class="md:col-span-2">
              <label class="${labelClass}">Dirección</label>
              <input id="p1Address" placeholder="Dirección completa" class="${inputClass}">
            </div>
            <div class="md:col-span-2">
              <label class="${labelClass}">Contacto de Emergencia (Extra)</label>
              <input id="p1Emergency" placeholder="Nombre y Teléfono alternativo" class="${inputClass}">
            </div>
          </div>
        </div>

        <!-- 6. TUTOR SECUNDARIO -->
        <div class="bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm space-y-4">
            <h4 class="text-sm font-black text-slate-800 flex items-center gap-2">
              <div class="w-8 h-8 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center"><i data-lucide="user-plus" class="w-4 h-4"></i></div>
              👨‍👩‍👧 TUTOR SECUNDARIO
            </h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="${labelClass}">Nombre</label>
                <input id="p2Name" placeholder="Nombre" class="${inputClass}">
              </div>
              <div>
                <label class="${labelClass}">Teléfono</label>
                <input id="p2Phone" placeholder="Teléfono" class="${inputClass}">
              </div>
              <div>
                <label class="${labelClass}">Profesión</label>
                <input id="p2Profession" placeholder="Ej: Abogada" class="${inputClass}">
              </div>
              <div>
                <label class="${labelClass}">Dirección</label>
                <input id="p2Address" placeholder="Dirección opcional" class="${inputClass}">
              </div>
            </div>
        </div>

        <!-- 7. INFORMACIÓN DE PAGO -->
        <div class="bg-amber-50 p-6 rounded-[2rem] border-2 border-amber-100 space-y-4">
            <h4 class="text-sm font-black text-amber-800 flex items-center gap-2">
              <div class="w-8 h-8 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center"><i data-lucide="credit-card" class="w-4 h-4"></i></div>
              💳 INFORMACIÓN DE PAGO
            </h4>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="${labelClass}">Mensualidad</label>
                <div class="relative">
                  <span class="absolute left-4 top-1/2 -translate-y-1/2 text-amber-600 font-black text-sm">$</span>
                  <input id="monthlyFee" placeholder="0.00" type="number" step="0.01" class="${inputClass} pl-8 bg-white">
                </div>
              </div>
              <div>
                <label class="${labelClass}">Día Vencimiento</label>
                <input id="dueDay" placeholder="5" type="number" min="1" max="31" class="${inputClass} bg-white">
              </div>
            </div>
          </div>
        </div>
    </div>
    
    <div class="modal-footer bg-white p-6 rounded-b-3xl border-t border-slate-100">
      <button onclick="UIHelpers.closeModal()" class="px-8 py-3 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
      <button onclick="App.students.save()" class="px-10 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-purple-200 hover:shadow-purple-300 hover:-translate-y-0.5 transition-all active:scale-95">Guardar Estudiante</button>
    </div>`;
    
  openGlobalModal(modalHTML);
  
  // Cargar aulas en el select
  try {
    const res = await DirectorApi.getClassrooms();
    const rooms = safeData(res, []);
    const select = document.getElementById('stClassroom');
    if(select && rooms?.length) {
      rooms.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = (r.name || 'Sin nombre').trim();
        select.appendChild(opt);
      });
    }
  } catch (e) { console.error('Error cargando aulas:', e); }
}

// 👨‍🏫 MODAL MAESTRO (PRO)
function openNewTeacherModal() {
  const html = `
    <div class="modal-header bg-indigo-600 text-white p-6 rounded-t-2xl flex justify-between items-center">
      <h3 class="font-bold text-lg flex items-center gap-2">
        <i data-lucide="user-plus" class="w-5 h-5"></i> Agregar Personal
      </h3>
      <button onclick="closeGlobalModal()" class="text-white/70 hover:text-white"><i data-lucide="x" class="w-6 h-6"></i></button>
    </div>
    <div class="p-6 space-y-4 bg-white">
        <input type="hidden" id="teacherId">
        <div>
            <label class="text-sm font-bold text-slate-700 block mb-1 uppercase tracking-wider text-[10px]">Nombre Completo</label>
            <input id="teacherName" class="w-full border border-slate-200 rounded-xl px-4 py-3 focus:ring-4 focus:ring-indigo-100 outline-none transition-all" />
        </div>
        <div>
            <label class="text-sm font-bold text-slate-700 block mb-1 uppercase tracking-wider text-[10px]">Email (Acceso)</label>
            <input id="teacherEmail" type="email" class="w-full border border-slate-200 rounded-xl px-4 py-3 focus:ring-4 focus:ring-indigo-100 outline-none transition-all" />
        </div>
        <div>
            <label class="text-sm font-bold text-slate-700 block mb-1 uppercase tracking-wider text-[10px]">Rol</label>
            <select id="teacherRole" class="w-full border border-slate-200 rounded-xl px-4 py-3 focus:ring-4 focus:ring-indigo-100 outline-none bg-white transition-all">
              <option value="maestra">Maestra Titular</option>
              <option value="asistente">Asistente / Auxiliar</option>
              <option value="admin">Administrativo</option>
            </select>
        </div>
    </div>
    <div class="p-6 border-t bg-slate-50 rounded-b-2xl flex justify-end gap-3">
      <button onclick="closeGlobalModal()" class="px-6 py-2.5 text-slate-500 font-bold hover:bg-white rounded-xl uppercase text-xs">Cancelar</button>
      <button id="btnSaveTeacher" onclick="App.teachers.save()" class="px-8 py-2.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 uppercase text-xs transition-all active:scale-95">Guardar Personal</button>
    </div>`;
  
  openGlobalModal(html);
}

async function openEditStudentModal(id) {
  await openNewStudentModal();
  const students = AppState.get('students') || [];
  const student = students.find(s => s.id == id);
  if (!student) return;
  document.querySelector('#globalModalContainer h3').textContent = 'Editar Estudiante';
  const setVal = (eid, val) => { const e = document.getElementById(eid); if(e) e.value = val || ''; };
  setVal('stId', student.id);
  setVal('stMatricula', student.matricula);
  setVal('stName', student.name);
  setVal('stAge', student.age);
  setVal('stHorario', student.horario);
  setVal('stClassroom', student.classroom_id);
  setVal('p1Name', student.p1_name);
  setVal('p1Phone', student.p1_phone);
  setVal('stEmailUser', student.parent?.email || ''); // Email del usuario auth vinculado
  setVal('stEmailNotif', student.p1_email); // Email de notificaciones en tabla students
  // Password se deja vacío por seguridad
  setVal('p1Profession', student.p1_job); // Mapeado de DB
  setVal('p1Address', student.p1_address);
  setVal('p1Emergency', student.p1_emergency_contact);
  setVal('p2Name', student.p2_name);
  setVal('p2Phone', student.p2_phone);
  setVal('p2Profession', student.p2_job);
  setVal('p2Address', student.p2_address);
  setVal('allergies', student.allergies);
  setVal('bloodType', student.blood_type);
  setVal('monthlyFee', student.monthly_fee);
  setVal('dueDay', student.due_day);
  setVal('authorized', student.authorized_pickup);
  setVal('stJoinedDate', student.start_date ? student.start_date.split('T')[0] : '');
  const checkActive = document.getElementById('active');
  if(checkActive) checkActive.checked = student.is_active;
}

async function initClassroomsSection() {
  const container = document.getElementById('roomsTable');
  if (!container) return;
  container.innerHTML = '<tr><td colspan="4" class="text-center py-8">Cargando...</td></tr>';
  try {
    const res = await DirectorApi.getClassroomsWithOccupancy();
    const classrooms = safeData(res, []);
    const { error } = res || {};
    if (error) throw new Error(error);
    if (!classrooms?.length) {
      container.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-500">No hay aulas.</td></tr>';
      return;
    }
    container.innerHTML = classrooms.map(r => DirectorUI.renderClassroomRow(r)).join('');
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error('Error initClassroomsSection:', e);
    container.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-red-500">Error al cargar.</td></tr>';
  }
}

async function initReports() {
  const container = document.getElementById('reportsList');
  const filtersContainer = document.getElementById('reportsFilters');
  
  if (!container) return;
  
  // Inyectar filtros si no existen
  if (!filtersContainer && container.parentElement) {
     const filterHTML = `
       <div id="reportsFilters" class="flex gap-2 mb-6 overflow-x-auto pb-2">
         <button onclick="App.inquiries.filter('all')" class="px-4 py-2 rounded-full bg-slate-800 text-white text-xs font-bold shadow-md">Todos</button>
         <button onclick="App.inquiries.filter('pending')" class="px-4 py-2 rounded-full bg-white text-slate-600 border border-slate-200 text-xs font-bold hover:bg-slate-50">Pendientes</button>
         <button onclick="App.inquiries.filter('resolved')" class="px-4 py-2 rounded-full bg-white text-slate-600 border border-slate-200 text-xs font-bold hover:bg-slate-50">Resueltos</button>
       </div>`;
     container.insertAdjacentHTML('beforebegin', filterHTML);
  }

  container.innerHTML = '<div class="col-span-3 text-center p-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div></div>';
  try {
    const res = await DirectorApi.getInquiries();
    const inquiries = safeData(res, []);
    const { error } = res || {};
    if (error) throw new Error(error);
    if (!inquiries?.length) {
      container.innerHTML = '<div class="col-span-3 text-center p-8 text-slate-500">No hay reportes.</div>';
      return;
    }
    // Guardar en variable global para filtrado
    window._allInquiries = inquiries;
    container.innerHTML = inquiries.map((item, idx) => DirectorUI.renderInquiryCard(item, idx)).join('');
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error('Error initReports:', e);
    container.innerHTML = '<div class="col-span-3 text-center p-8 text-red-500">Error al cargar.</div>';
  }
}

function filterReports(status) {
  const container = document.getElementById('reportsList');
  const inquiries = window._allInquiries || [];
  let filtered = inquiries;
  
  if (status === 'pending') filtered = inquiries.filter(i => i.status !== 'resolved' && i.status !== 'closed');
  if (status === 'resolved') filtered = inquiries.filter(i => i.status === 'resolved' || i.status === 'closed');
  
  if (!filtered.length) {
    container.innerHTML = Helpers.emptyState('No hay reportes con este estado');
    return;
  }
  
  container.innerHTML = filtered.map((item, idx) => DirectorUI.renderInquiryCard(item, idx)).join('');
  if (window.lucide) lucide.createIcons();
  
  // Actualizar estilos de botones
  const btns = document.querySelectorAll('#reportsFilters button');
  btns.forEach(b => {
     if(b.getAttribute('onclick').includes(`'${status}'`)) b.className = "px-4 py-2 rounded-full bg-slate-800 text-white text-xs font-bold shadow-md transition-all";
     else b.className = "px-4 py-2 rounded-full bg-white text-slate-600 border border-slate-200 text-xs font-bold hover:bg-slate-50 transition-all";
  });
}

function getTeacherModalTemplate() {
  const inputClass = "w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium";
  const labelClass = "block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1";

  return `
    <div class="modal-header bg-gradient-to-r from-pink-500 to-rose-500 text-white p-6 rounded-t-3xl">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl shadow-inner">👩‍🏫</div>
        <div>
          <h3 class="text-xl font-black">Gestión de Personal</h3>
          <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Maestras y Asistentes</p>
        </div>
      </div>
      <button onclick="UIHelpers.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors">
        <i data-lucide="x" class="w-6 h-6"></i>
      </button>
    </div>
    <div class="modal-body p-8 bg-slate-50/30" id="teacherForm">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <input type="hidden" id="tId" />
        <div class="col-span-2">
          <label class="${labelClass}">Nombre completo</label>
          <input id="tName" placeholder="Ej: Maria Lopez" class="${inputClass}">
        </div>
        
        <div>
          <label class="${labelClass}">Correo electrónico</label>
          <input id="tEmail" placeholder="usuario@karpus.com" type="email" class="${inputClass}">
        </div>

        <div>
          <label class="${labelClass}">Teléfono</label>
          <input id="tPhone" placeholder="Opcional" type="tel" class="${inputClass}">
        </div>

        <div class="col-span-2" id="passwordFieldContainer">
          <label class="${labelClass}">Contraseña <span class="text-rose-400 normal-case ml-1 font-normal">(Mínimo 6 caracteres)</span></label>
          <div class="relative">
            <i data-lucide="lock" class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"></i>
            <input id="tPassword" placeholder="Crear contraseña de acceso" type="text" class="${inputClass} pl-10">
          </div>
          <p class="text-[10px] text-slate-400 mt-1 ml-1">* Solo requerida para nuevos usuarios</p>
        </div>

        <div>
          <label class="${labelClass}">Rol</label>
          <select id="tRole" class="${inputClass}">
            <option value="maestra">Maestra</option>
            <option value="asistente">Asistente</option>
          </select>
        </div>
        <div>
          <label class="${labelClass}">Aula asignada</label>
          <select id="tClassroom" class="${inputClass}"><option value="">Seleccionar Aula</option></select>
        </div>
        <div class="col-span-2">
          <label class="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-xl cursor-pointer">
            <input type="checkbox" id="tActive" checked class="w-5 h-5 rounded text-rose-500 focus:ring-rose-200">
            <span class="text-sm font-bold text-slate-700">Cuenta Activa</span>
          </label>
        </div>
      </div>
    </div>
    <div class="modal-footer bg-white p-6 rounded-b-3xl border-t border-slate-100">
      <button onclick="UIHelpers.closeModal()" class="px-8 py-3 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
      <button onclick="App.teachers.save()" class="px-10 py-3 bg-gradient-to-r from-rose-500 to-pink-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-rose-200 hover:shadow-rose-300 hover:-translate-y-0.5 transition-all active:scale-95">Guardar Personal</button>
    </div>`;
}

async function openCreateTeacherModal() {
  const modalHTML = getTeacherModalTemplate();
  openGlobalModal(modalHTML);

  try {
    const res = await DirectorApi.getClassrooms();
    const rooms = safeData(res, []);
    const select = document.getElementById('tClassroom');
    if (select && rooms?.length) {
      select.innerHTML += rooms.map(r => `<option value="${r.id}">${(r.name || 'Sin nombre').trim()}</option>`).join('');
    }
  } catch (error) {
    console.error('Error cargando aulas:', error);
    Helpers.toast('Error al cargar aulas', 'error');
  }
}

async function openEditTeacherModal(id) {
  await openCreateTeacherModal();
  const teachers = AppState.get('teachers') || [];
  const teacher = teachers.find(t => t.id == id);
  if (!teacher) return;
  document.querySelector('#globalModalContainer h3').textContent = 'Editar Maestra';
  const setVal = (eid, val) => { const e = document.getElementById(eid); if(e) e.value = val || ''; };
  setVal('tId', teacher.id);
  setVal('tName', teacher.name);
  setVal('tPhone', teacher.phone);
  setVal('tEmail', teacher.email);
  setVal('tRole', teacher.role);
  
  // 🔥 FIX: Obtener ID del aula correctamente (objeto o array)
  const classId = teacher.classroom_id || (Array.isArray(teacher.classrooms) ? teacher.classrooms[0]?.id : teacher.classrooms?.id);
  setVal('tClassroom', classId);

  const checkActive = document.getElementById('tActive');
  if(checkActive) checkActive.checked = teacher.is_active;
  
  // Ocultar contraseña al editar (opcional) o dejarla vacía para no cambiar
  const passContainer = document.getElementById('passwordFieldContainer');
  if(passContainer) passContainer.style.display = 'none'; // Simplificación: solo crear contraseña al crear usuario
}

async function openInquiryDetail(id) {
  try {
    const res = await DirectorApi.getInquiries();
    const inquiries = safeData(res, []);
    const item = inquiries?.find(i => i.id == id);
    if (!item) return Helpers.toast('Reporte no encontrado', 'warning');
    
    const modalHTML = `
      <div class="modal-header">
        <h3 class="text-xl font-bold">Detalle de Reporte</h3>
        <button onclick="UIHelpers.closeModal()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body space-y-4">
        <div><label class="text-[10px] font-black text-slate-400 uppercase">Asunto</label><p class="font-bold">${Helpers.escapeHTML(item.subject)}</p></div>
        <div><label class="text-[10px] font-black text-slate-400 uppercase">Padre</label><p>${Helpers.escapeHTML(item.parent?.name)} (${item.parent?.email})</p></div>
        <div><label class="text-[10px] font-black text-slate-400 uppercase">Mensaje</label><p class="text-sm bg-slate-50 p-3 rounded-xl">${Helpers.escapeHTML(item.message)}</p></div>
        ${item.attachment_url ? `<div><label class="text-[10px] font-black text-slate-400 uppercase">Adjunto</label><img src="${item.attachment_url}" class="w-full rounded-xl mt-2 border"></div>` : ''}
      </div>
      <div class="modal-footer">
        <button onclick="UIHelpers.closeModal()" class="px-6 py-2 border rounded-xl font-bold">Cerrar</button>
      </div>`;
    openGlobalModal(modalHTML);
  } catch (e) { console.error(e); }
}

async function replyInquiry(id) {
  const reply = prompt('Escribe tu respuesta para el padre:');
  if (!reply) return;
  
  try {
    await DirectorApi.updateInquiry(id, { status: 'in_progress', internal_notes: reply });
    Helpers.toast('Respuesta enviada (Simulado)', 'success');
    initReports();
  } catch (e) { console.error(e); }
}

async function sendComment(postId) {
  const input = document.getElementById(`commentInput_${postId}`);
  const content = (input?.value || '').trim();
  if (!content) return Helpers.toast('Escribe un comentario', 'warning');
  
  try {
    const res = await WallApi.addComment(postId, content);
    const { error } = res || {};
    if (error) throw new Error(error);
    input.value = '';
    try {
      const container = document.getElementById('muroPostsContainer');
      if (container) await WallModule.loadPosts(container);
    } catch (e) {
      console.warn('Error reloading posts:', e);
    }
  } catch (e) {
    console.error('Error sendComment:', e);
    Helpers.toast('Error al comentar', 'error');
  }
}

async function deleteWallComment(commentId, postId) {
  if (!confirm('¿Eliminar comentario?')) return;
  try {
    const res = await WallApi.deleteComment(commentId);
    const { error } = res || {};
    if (error) throw new Error(error);
    Helpers.toast('Comentario eliminado');
    const container = document.getElementById('muroPostsContainer');
    if (container) await WallModule.loadPosts(container);
  } catch (e) { 
    console.error('Error deleteWallComment:', e);
    Helpers.toast('Error al eliminar comentario', 'error');
  }
}

// ====================================================================================
// 🏫 MODAL NUEVA / EDITAR AULA
// ====================================================================================
async function openCreateRoomModal(roomId = null) {
  const inputClass = "w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium";
  const labelClass = "block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1";
  const html = `
    <div class="modal-header bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6 rounded-t-3xl flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">🏫</div>
        <div>
          <h3 id="roomModalTitle" class="text-xl font-black">${roomId ? 'Editar Aula' : 'Nueva Aula'}</h3>
          <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Gestión de Aulas</p>
        </div>
      </div>
      <button onclick="UIHelpers.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors">✕</button>
    </div>
    <div class="modal-body p-8 bg-slate-50/30">
      <input type="hidden" id="roomId" value="${roomId || ''}">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="col-span-2">
          <label class="${labelClass}">Nombre del Aula</label>
          <input id="roomName" placeholder="Ej: Kinder A" class="${inputClass}">
        </div>
        <div>
          <label class="${labelClass}">Capacidad</label>
          <input id="roomCapacity" type="number" placeholder="Ej: 20" class="${inputClass}">
        </div>
        <div>
          <label class="${labelClass}">Maestra Asignada</label>
          <select id="roomTeacher" class="${inputClass}"><option value="">Sin asignar</option></select>
        </div>
      </div>
    </div>
    <div class="modal-footer bg-white p-6 rounded-b-3xl border-t border-slate-100 flex justify-end gap-3">
      <button onclick="UIHelpers.closeModal()" class="px-8 py-3 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
      <button onclick="window.saveRoom()" class="px-10 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg hover:-translate-y-0.5 transition-all active:scale-95">Guardar Aula</button>
    </div>`;
  openGlobalModal(html);
  try {
    const res = await DirectorApi.getTeachers();
    const teachers = safeData(res, []);
    const select = document.getElementById('roomTeacher');
    if (select && teachers?.length) {
      select.innerHTML += teachers.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    }
  } catch (e) { console.error('Error cargando maestras:', e); }
  if (roomId) {
    try {
      const { data: room } = await supabase.from('classrooms').select('*').eq('id', roomId).single();
      if (room) {
        document.getElementById('roomName').value = room.name || '';
        document.getElementById('roomCapacity').value = room.capacity || '';
        document.getElementById('roomTeacher').value = room.teacher_id || '';
      }
    } catch (e) { console.error('Error cargando aula:', e); }
  }
}

async function saveRoom() {
  const id = document.getElementById('roomId')?.value;
  const name = document.getElementById('roomName')?.value?.trim();
  const capacity = document.getElementById('roomCapacity')?.value;
  const teacher_id = document.getElementById('roomTeacher')?.value || null;
  if (!name) return Helpers.toast('El nombre del aula es requerido', 'warning');
  UIHelpers.setLoading(true);
  try {
    const payload = { name, capacity: capacity ? parseInt(capacity) : null, teacher_id };
    let error;
    if (id) {
      ({ error } = await supabase.from('classrooms').update(payload).eq('id', id));
    } else {
      ({ error } = await supabase.from('classrooms').insert(payload));
    }
    if (error) throw error;
    Helpers.toast(id ? 'Aula actualizada' : 'Aula creada', 'success');
    UIHelpers.closeModal();
    await initClassroomsSection();
  } catch (e) {
    console.error('Error saveRoom:', e);
    Helpers.toast('Error al guardar aula: ' + e.message, 'error');
  } finally {
    UIHelpers.setLoading(false);
  }
}

// ====================================================================================
// 🔀 TOGGLE VISTA ESTUDIANTES (Grid / Lista)
// ====================================================================================
function toggleStudentView() {
  const btn = document.getElementById('btnToggleStuView');
  const container = document.getElementById('studentsGrid');
  if (!container) return;
  const isGrid = container.classList.contains('grid');
  if (isGrid) {
    container.classList.remove('grid', 'grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3', 'xl:grid-cols-4');
    container.classList.add('flex', 'flex-col');
    if (btn) btn.textContent = 'Grid';
  } else {
    container.classList.remove('flex', 'flex-col');
    container.classList.add('grid', 'grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3', 'xl:grid-cols-4');
    if (btn) btn.textContent = 'Lista';
  }
}

// Exponer funciones globales usadas en onclick de modales dinámicos
window.saveRoom = saveRoom;
window.openCreateRoomModal = openCreateRoomModal;
