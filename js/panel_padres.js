const Helpers = {
  toast: (m, t = 'success') => {
    const e = document.createElement('div');
    const c = t === 'success' ? 'bg-[#22C55E]' : (t === 'error' ? 'bg-[#EF4444]' : 'bg-[#3B82F6]');
    e.className = `fixed bottom-6 right-6 ${c} text-white px-4 py-2 rounded-xl shadow-lg z-50 transition-all`;
    e.textContent = m;
    document.body.appendChild(e);
    setTimeout(() => {
      e.style.opacity = '0';
      e.style.transform = 'translateY(20px)';
      setTimeout(() => e.remove(), 300);
    }, 3000);
  },
  emptyState: (msg, icon = 'smile') => `<div class="text-center py-10 text-[#1E293B]/50"><i data-lucide="${icon}" class="mx-auto mb-3 w-12 h-12 opacity-50"></i><p>${msg}</p></div>`,
  skeleton: (n = 3, h = 'h-16') => Array(n).fill(0).map(() => `<div class="animate-pulse bg-[#F8FAFC] rounded-xl ${h} w-full mb-2"></div>`).join('')
};

const AppState = {
  user: null,
  profile: null,
  students: [],
  currentStudent: null,
  currentSection: 'home',
  currentDate: new Date(),
  currentTaskId: null
};

const UI = {
  async init() {
    this.bindEvents();
    await this.checkSession();
    this.showSection('home');
  },

  async checkSession() {
    try {
      const u = await window.supabase.auth.getUser();
      const user = u?.data?.user;
      if (!user) {
        window.location.href = 'login.html';
        return;
      }
      AppState.user = user;
      const pr = await window.supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      const profile = pr.data;
      if (!profile || profile.role !== 'padre') {
        await window.supabase.auth.signOut();
        window.location.href = 'login.html';
        return;
      }
      AppState.profile = profile;
      const st = await window.supabase.from('students').select('*, classrooms(name,level)').eq('parent_id', user.id);
      AppState.students = st.data || [];
      AppState.currentStudent = AppState.students[0] || null;
      this.updateHeader();
      this.subscribeNotifications();
    } catch (e) {
      console.error(e);
    }
  },

  subscribeNotifications() {
    if (!AppState.user) return;
    
    // Eliminar suscripción previa si existe
    if (UI.notifChannel) window.supabase.removeChannel(UI.notifChannel);

    UI.notifChannel = window.supabase
      .channel('public:notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${AppState.user.id}` },
        (payload) => {
          Helpers.toast(payload.new.title || 'Nueva notificación', 'success');
          if (AppState.currentSection === 'notifications') UI.loadNotifications();
        }
      )
      .subscribe();
  },

  bindEvents() {
    document.querySelectorAll('[data-target]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const id = btn.dataset.target;
        this.showSection(id);
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    document.getElementById('ctaPendingBtn')?.addEventListener('click', () => {
      document.querySelector('[data-target="tasks"]')?.click();
    });
    const submitBtn = document.getElementById('submitTaskParent');
    if (submitBtn) {
      submitBtn.addEventListener('click', () => this.submitTaskEvidence());
    }
    const closeSubmit = document.getElementById('closeSubmitTask');
    if (closeSubmit) {
      closeSubmit.addEventListener('click', () => {
        const m = document.getElementById('modalSubmitTask');
        if (m) {
          m.classList.add('hidden');
          m.classList.remove('flex');
        }
      });
    }
    const list = document.getElementById('tasksList');
    if (list) {
      list.addEventListener('click', e => {
        const btn = e.target.closest('.open-submit-btn');
        if (!btn) return;
        AppState.currentTaskId = Number(btn.dataset.taskId);
        const m = document.getElementById('modalSubmitTask');
        if (m) {
          m.classList.remove('hidden');
          m.classList.add('flex');
        }
        const tEl = document.getElementById('taskTitleModal');
        if (tEl) tEl.textContent = btn.dataset.taskTitle || '';
        const sEl = document.getElementById('modal-submit-student');
        if (sEl) sEl.textContent = AppState.currentStudent?.name || '';
        const pEl = document.getElementById('modal-submit-parent');
        if (pEl) pEl.textContent = AppState.profile?.name || '';
      });
    }
  },

  showSection(id) {
    AppState.currentSection = id;
    document.querySelectorAll('.section').forEach(s => {
      s.classList.remove('active');
      s.style.display = 'none';
    });
    const t = document.getElementById(id);
    if (t) {
      t.classList.add('active');
      t.style.display = 'block';
      if (id === 'home') this.loadDashboard();
      if (id === 'live-attendance') this.loadAttendance();
      if (id === 'tasks') this.loadTasks();
      if (id === 'class') this.loadClassFeed();
      if (id === 'notifications') this.loadNotifications();
      if (id === 'profile') this.populateProfile();
      if (id === 'grades') this.loadGrades();
    }
  },

  updateHeader() {
    const set = (sel, txt) => {
      document.querySelectorAll(sel).forEach(el => el.textContent = txt);
    };
    const student = AppState.currentStudent?.name || '-';
    const parent = AppState.profile?.name || '-';
    const classroom = AppState.currentStudent?.classrooms?.name || '-';
    set('.student-name-display', student);
    set('.guardian-name-display', parent);
    set('.classroom-name-display', classroom);
    const ms = document.getElementById('mobile-student-name');
    if (ms) ms.textContent = student;
    const ss = document.getElementById('sidebar-student-name');
    if (ss) {
      if (AppState.students.length > 1) {
        // Si hay múltiples estudiantes, mostrar selector
        ss.innerHTML = '';
        const select = document.createElement('select');
        select.className = 'bg-transparent border border-white/30 rounded px-2 py-1 text-white text-sm font-semibold outline-none cursor-pointer w-full';
        
        AppState.students.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          opt.className = 'text-slate-800'; // Color oscuro para las opciones desplegadas
          if (AppState.currentStudent && s.id === AppState.currentStudent.id) opt.selected = true;
          select.appendChild(opt);
        });

        select.addEventListener('change', (e) => {
          const newId = Number(e.target.value);
          const newStudent = AppState.students.find(s => s.id === newId);
          if (newStudent) {
            AppState.currentStudent = newStudent;
            UI.updateHeader(); // Actualizar textos
            UI.showSection(AppState.currentSection); // Recargar sección actual con datos del nuevo alumno
          }
        });
        ss.appendChild(select);
      } else {
        ss.textContent = student;
      }
    }
    const cd = document.getElementById('currentDateDisplay');
    if (cd) cd.textContent = new Date().toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
  },

  async loadDashboard() {
    if (!AppState.currentStudent) return;
    try {
      const att = await window.supabase.from('attendance').select('status').eq('student_id', AppState.currentStudent.id);
      const attendance = att.data || [];
      const total = attendance.length;
      const present = attendance.filter(a => a.status === 'present' || a.status === 'late').length;
      const percent = total ? Math.round((present / total) * 100) : 0;
      const da = document.getElementById('dashAttendance');
      if (da) da.textContent = `${percent}%`;
      
      const ct = await window.supabase.from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('classroom_id', AppState.currentStudent.classroom_id)
        .eq('status', 'pending');
        
      const dp = document.getElementById('dashPendingTasks');
      if (dp) dp.textContent = String(ct.count || 0);
    } catch (e) {
      Helpers.toast('Error cargando dashboard', 'error');
    }
  },

  async loadAttendance() {
    const grid = document.getElementById('calendarGrid');
    if (!grid || !AppState.currentStudent) return;
    grid.innerHTML = Helpers.skeleton(5, 'h-10');
    
    try {
      const start = new Date(AppState.currentDate.getFullYear(), AppState.currentDate.getMonth(), 1);
      const end = new Date(AppState.currentDate.getFullYear(), AppState.currentDate.getMonth() + 1, 0);
      const { data, error } = await window.supabase.from('attendance')
        .select('date,status')
        .eq('student_id', AppState.currentStudent.id)
        .gte('date', start.toISOString().split('T')[0])
        .lte('date', end.toISOString().split('T')[0]);
        
      if (error) throw error;

      const map = new Map((data || []).map(a => [a.date, a.status]));
      const days = end.getDate();
      let html = '';
      for (let d = 1; d <= days; d++) {
        const key = new Date(AppState.currentDate.getFullYear(), AppState.currentDate.getMonth(), d).toISOString().split('T')[0];
        const st = map.get(key);
        let bg = 'bg-[#F8FAFC]', tx = 'text-[#1E293B]';
        if (st === 'present') bg = 'bg-[#22C55E]/20', tx = 'text-[#22C55E] font-bold';
        else if (st === 'absent') bg = 'bg-[#EF4444]/20', tx = 'text-[#EF4444] font-bold';
        else if (st === 'late') bg = 'bg-[#FACC15]/20', tx = 'text-[#FACC15] font-bold';
        html += `<div class="${bg} ${tx} rounded-lg p-2 text-center text-sm transition-colors flex items-center justify-center aspect-square border">${d}</div>`;
      }
      grid.innerHTML = html;
    } catch (e) {
      grid.innerHTML = Helpers.emptyState('Error cargando asistencia', 'alert-circle');
    }
  },

  async loadTasks(filter = 'all') {
    const list = document.getElementById('tasksList');
    if (!list || !AppState.currentStudent) return;
    list.innerHTML = Helpers.skeleton(3, 'h-24');
    
    try {
      let q = window.supabase.from('tasks').select('*').eq('classroom_id', AppState.currentStudent.classroom_id);
      if (filter === 'overdue') q = q.lt('due_date', new Date().toISOString());
      const { data: tasks, error } = await q.order('due_date');
      
      if (error) throw error;

      if (!tasks || !tasks.length) {
        list.innerHTML = Helpers.emptyState('No hay tareas', 'clipboard');
        return;
      }
      list.innerHTML = tasks.map(t => `<div class="bg-white p-4 rounded-xl border shadow-sm"><h4 class="font-bold text-[#1E293B]">${t.title}</h4><p class="text-sm text-[#1E293B]/70">${t.description || ''}</p><div class="mt-2 flex gap-2"><button class="open-submit-btn px-3 py-1 rounded-xl bg-[#3B82F6] text-white text-xs hover:bg-[#BFDBFE] hover:text-[#1E293B] transition-colors" data-task-id="${t.id}" data-task-title="${t.title}">Subir evidencia</button></div></div>`).join('');
      
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      list.innerHTML = Helpers.emptyState('Error cargando tareas', 'alert-circle');
    }
  },

  async submitTaskEvidence() {
    try {
      const f = document.getElementById('taskFile');
      const c = document.getElementById('taskComment');
      const file = f?.files?.[0] || null;
      const comment = (c?.value || '').trim();
      if (!AppState.currentStudent) {
        Helpers.toast('Selecciona un estudiante', 'error');
        return;
      }
      if (!file && !comment) {
        Helpers.toast('Adjunta un archivo o escribe un comentario', 'error');
        return;
      }
      let publicUrl = null;
      if (file) {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf'];
        if (!allowed.includes(file.type)) {
          Helpers.toast('Formato no soportado', 'error');
          return;
        }
        if (file.size > 10 * 1024 * 1024) {
          Helpers.toast('El archivo excede 10MB', 'error');
          return;
        }
        const path = `evidences/${AppState.currentStudent.id}/${Date.now()}-${file.name}`;
        const up = await window.supabase.storage.from('classroom_media').upload(path, file, {
          upsert: false,
          contentType: file.type
        });
        if (up.error) {
          Helpers.toast('Error subiendo archivo', 'error');
          return;
        }
        const pub = window.supabase.storage.from('classroom_media').getPublicUrl(path);
        publicUrl = pub.data?.publicUrl || null;
      }

      const { error } = await window.supabase.from('task_evidences').insert({
        task_id: AppState.currentTaskId,
        student_id: AppState.currentStudent.id,
        parent_id: AppState.user.id,
        file_url: publicUrl,
        comment: comment
      });

      if (error) throw error;

      Helpers.toast('Evidencia enviada', 'success');
      if (f) f.value = '';
      if (c) c.value = '';
      const m = document.getElementById('modalSubmitTask');
      if (m) {
        m.classList.add('hidden');
        m.classList.remove('flex');
      }
    } catch (e) {
      console.error(e);
      Helpers.toast('Error al enviar evidencia', 'error');
    }
  },

  async loadClassFeed() {
    const container = document.getElementById('classFeed');
    if (!container || !AppState.currentStudent) return;
    container.innerHTML = Helpers.skeleton(3, 'h-32');
    
    try {
      const { data: posts, error } = await window.supabase.from('posts')
        .select('*, profiles:teacher_id(name), likes(user_id), comments(id,content,created_at, profiles:user_id(name))')
        .eq('classroom_id', AppState.currentStudent.classroom_id)
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      
      if (!posts || !posts.length) {
        container.innerHTML = Helpers.emptyState('No hay publicaciones en el muro', 'layout-dashboard');
        return;
      }

      container.innerHTML = posts.map(p => {
        const comments = (p.comments || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const liked = (p.likes || []).some(l => l.user_id === AppState.user?.id);
        
        return `
          <div class="bg-white rounded-xl p-4 shadow-sm border mb-4">
            <div class="flex items-center gap-3 mb-3">
              <div class="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold">
                ${p.profiles?.name?.charAt(0) || 'D'}
              </div>
              <div>
                <p class="font-semibold text-[#1E293B]">${p.profiles?.name || 'Docente'}</p>
                <p class="text-xs text-slate-500">${new Date(p.created_at).toLocaleDateString()}</p>
              </div>
            </div>
            <p class="text-sm text-[#1E293B] mb-3">${p.content || ''}</p>
            ${p.media_url ? `<img src="${p.media_url}" class="w-full rounded-lg mb-3 object-cover max-h-64" alt="Media">` : ''}
            <div class="flex items-center gap-4 border-t pt-3">
              <button class="flex items-center gap-1 text-sm ${liked ? 'text-red-500' : 'text-slate-500'}">
                <i data-lucide="heart" class="w-4 h-4 ${liked ? 'fill-current' : ''}"></i> ${p.likes?.length || 0}
              </button>
              <button class="flex items-center gap-1 text-sm text-slate-500">
                <i data-lucide="message-circle" class="w-4 h-4"></i> ${comments.length}
              </button>
            </div>
          </div>
        `;
      }).join('');
      
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      container.innerHTML = Helpers.emptyState('Error al cargar publicaciones', 'alert-circle');
    }
  },

  async loadGrades() {
    const container = document.getElementById('gradesContent');
    if (!container || !AppState.currentStudent) return;
    
    container.innerHTML = Helpers.skeleton(3, 'h-16');

    try {
      const { data: grades, error } = await window.supabase
        .from('grades')
        .select('*, profiles:teacher_id(name)')
        .eq('student_id', AppState.currentStudent.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (!grades || grades.length === 0) {
        container.innerHTML = Helpers.emptyState('No hay calificaciones registradas', 'graduation-cap');
        return;
      }

      container.innerHTML = `
        <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 border-b">
              <tr>
                <th class="px-4 py-3 font-semibold text-slate-600">Materia</th>
                <th class="px-4 py-3 font-semibold text-slate-600">Periodo</th>
                <th class="px-4 py-3 font-semibold text-slate-600">Calificación</th>
                <th class="px-4 py-3 font-semibold text-slate-600">Maestro</th>
                <th class="px-4 py-3 font-semibold text-slate-600">Fecha</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${grades.map(g => `
                <tr class="hover:bg-slate-50">
                  <td class="px-4 py-3 font-medium text-slate-800">${g.subject}</td>
                  <td class="px-4 py-3 text-slate-600">${g.period || '-'}</td>
                  <td class="px-4 py-3 font-bold ${g.score >= 70 ? 'text-green-600' : 'text-red-600'}">${g.score}</td>
                  <td class="px-4 py-3 text-slate-600">${g.profiles?.name || '-'}</td>
                  <td class="px-4 py-3 text-slate-500 text-xs">${new Date(g.created_at).toLocaleDateString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      container.innerHTML = Helpers.emptyState('Error cargando calificaciones', 'alert-circle');
    }
  },

  async loadNotifications() {
    const container = document.getElementById('notifications');
    if (!container) return;
    
    container.innerHTML = Helpers.skeleton(3, 'h-24');

    try {
      const { data: notifs, error } = await window.supabase
        .from('notifications')
        .select('*')
        .eq('user_id', AppState.user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      if (!notifs || notifs.length === 0) {
        container.innerHTML = Helpers.emptyState('No tienes notificaciones nuevas', 'bell');
        return;
      }

      container.innerHTML = `<div class="space-y-3 max-w-3xl mx-auto">` + notifs.map(n => `
        <div class="bg-white p-4 rounded-xl border shadow-sm flex gap-4 ${n.is_read ? 'opacity-70' : 'border-l-4 border-l-blue-500'}">
          <div class="bg-blue-50 w-10 h-10 rounded-full flex items-center justify-center text-blue-600 flex-shrink-0"><i data-lucide="bell" class="w-5 h-5"></i></div>
          <div><h4 class="font-bold text-slate-800">${n.title}</h4><p class="text-sm text-slate-600">${n.message}</p><p class="text-xs text-slate-400 mt-2">${new Date(n.created_at).toLocaleString()}</p></div>
        </div>`).join('') + `</div>`;
      
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      container.innerHTML = Helpers.emptyState('Error cargando notificaciones', 'alert-circle');
    }
  },

  populateProfile() {
    try {
      const s = AppState.currentStudent;
      const p = AppState.profile;
      const u = AppState.user;
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) {
          if ('value' in el) {
            el.value = val || '';
          } else {
            el.textContent = val || '-';
          }
        }
      };
      setVal('inputStudentName', s?.name || '');
      setVal('inputBirthYear', s?.birth_year || '');
      setVal('inputParent1Name', p?.name || '');
      setVal('inputParent1Phone', p?.phone || '');
      setVal('inputParent1Email', u?.email || '');
      setVal('inputParent1Occupation', p?.occupation || '');
      setVal('inputParent1Address', p?.address || '');
      setVal('inputParent1Emergency', p?.emergency_contact || '');
      setVal('inputParent2Name', s?.secondary_parent_name || '');
      setVal('inputParent2Phone', s?.secondary_parent_phone || '');
      setVal('inputParent2Email', s?.secondary_parent_email || '');
      setVal('inputParent2Occupation', s?.secondary_parent_occupation || '');
      setVal('inputParent2Address', s?.secondary_parent_address || '');
      setVal('inputParent2Emergency', s?.secondary_parent_emergency || '');
      setVal('inputClassroom', s?.classrooms?.name || '');
      setVal('inputEntryDate', s?.entry_date ? new Date(s.entry_date).toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }) : '');
      setVal('inputAllergies', s?.allergies || '');
      setVal('inputPickup', s?.authorized_pickup || '');
      setVal('inputBloodType', s?.blood_type || '');
    } catch (e) {}
  }
};

window.UI = UI;

document.addEventListener('DOMContentLoaded', () => {
  UI.init();
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }

  const sb = document.getElementById('sidebar');
  const shell = document.getElementById('layoutShell');
  const overlay = document.getElementById('sidebarOverlay');

  document.getElementById('toggleSidebar')?.addEventListener('click', () => {
    if (!sb || !shell) return;
    sb.classList.toggle('collapsed');
    shell.classList.toggle('sidebar-collapsed');
  });
  if (sb) {
    sb.addEventListener('mouseenter', () => {
      if (sb.classList.contains('collapsed')) sb.classList.add('hover-open');
    });
    sb.addEventListener('mouseleave', () => {
      sb.classList.remove('hover-open');
    });
  }
  document.getElementById('menuBtn')?.addEventListener('click', () => {
    if (sb) {
      sb.classList.remove('hidden');
      sb.classList.add('flex');
    }
    if (overlay) {
      overlay.classList.remove('hidden');
    }
  });
  overlay?.addEventListener('click', () => {
    if (sb) {
      sb.classList.add('hidden');
      sb.classList.remove('flex');
    }
    overlay.classList.add('hidden');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (sb && overlay && !overlay.classList.contains('hidden')) {
        sb.classList.add('hidden');
        sb.classList.remove('flex');
        overlay.classList.add('hidden');
      }
    }
  });
  document.querySelectorAll('.sidebar-btn').forEach(el => {
    el.addEventListener('click', () => {
      if (window.innerWidth < 768) {
        if (sb) {
          sb.classList.add('hidden');
          sb.classList.remove('flex');
        }
        if (overlay) {
          overlay.classList.add('hidden');
        }
      }
    });
  });

  const btnProfile = document.querySelector('[data-target="profile"]');
  btnProfile?.addEventListener('click', () => {
    UI.populateProfile();
  });
  const up = document.getElementById('profilePhotoUpload');
  up?.addEventListener('change', () => {
    const f = up.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = document.getElementById('profilePhotoPreview');
    if (img) {
      img.src = url;
    }
  });
  const save = document.getElementById('saveProfileBtn');
  save?.addEventListener('click', async () => {
    const sn = document.getElementById('inputStudentName')?.value?.trim() || '';
    const by = document.getElementById('inputBirthYear')?.value?.trim() || '';
    const p1n = document.getElementById('inputParent1Name')?.value?.trim() || '';
    const p1p = document.getElementById('inputParent1Phone')?.value?.trim() || '';
    const p1e = document.getElementById('inputParent1Email')?.value?.trim() || '';
    const p1o = document.getElementById('inputParent1Occupation')?.value?.trim() || '';
    const p1a = document.getElementById('inputParent1Address')?.value?.trim() || '';
    const p1em = document.getElementById('inputParent1Emergency')?.value?.trim() || '';
    const p2n = document.getElementById('inputParent2Name')?.value?.trim() || '';
    const p2p = document.getElementById('inputParent2Phone')?.value?.trim() || '';
    const p2e = document.getElementById('inputParent2Email')?.value?.trim() || '';
    const p2o = document.getElementById('inputParent2Occupation')?.value?.trim() || '';
    const p2a = document.getElementById('inputParent2Address')?.value?.trim() || '';
    const p2em = document.getElementById('inputParent2Emergency')?.value?.trim() || '';
    const ed = document.getElementById('inputEntryDate')?.value?.trim() || '';
    const al = document.getElementById('inputAllergies')?.value?.trim() || '';
    const pk = document.getElementById('inputPickup')?.value?.trim() || '';
    const bt = document.getElementById('inputBloodType')?.value?.trim() || '';
    const studentId = AppState.currentStudent?.id;
    const userId = AppState.user?.id;
    if (!studentId || !userId) {
      Helpers.toast('Sesión inválida', 'error');
      return;
    }
    const payloadStudent = {
      name: sn || AppState.currentStudent?.name,
      birth_year: by ? Number(by) : AppState.currentStudent?.birth_year,
      secondary_parent_name: p2n || null,
      secondary_parent_phone: p2p || null,
      secondary_parent_email: p2e || null,
      secondary_parent_occupation: p2o || null,
      secondary_parent_address: p2a || null,
      secondary_parent_emergency: p2em || null,
      allergies: al || null,
      authorized_pickup: pk || null,
      blood_type: bt || null
    };
    if (ed) {
      const d = new Date(ed);
      if (!isNaN(d.getTime())) payloadStudent.entry_date = d.toISOString().split('T')[0];
    }
    let avatarUrl = null;
    const file = document.getElementById('profilePhotoUpload')?.files?.[0] || null;
    if (file) {
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.type)) {
        Helpers.toast('Formato de imagen no soportado', 'error');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        Helpers.toast('La imagen excede 10MB', 'error');
        return;
      }
      const path = 'students/' + studentId + '/' + Date.now() + '-' + file.name;
      const upRes = await window.supabase.storage.from('avatars').upload(path, file, {
        upsert: false,
        contentType: file.type
      });
      if (upRes.error) {
        Helpers.toast('Error subiendo foto', 'error');
        return;
      }
      const pub = window.supabase.storage.from('avatars').getPublicUrl(path);
      avatarUrl = pub.data?.publicUrl || null;
      if (avatarUrl) payloadStudent.avatar_url = avatarUrl;
    }
    const payloadProfile = {
      phone: p1p || AppState.profile?.phone || null,
      address: p1a || AppState.profile?.address || null,
      occupation: p1o || AppState.profile?.occupation || null,
      emergency_contact: p1em || AppState.profile?.emergency_contact || null
    };
    const updProf = await window.supabase.from('profiles').update(payloadProfile).eq('id', userId);
    if (updProf.error) {
      Helpers.toast('Error guardando perfil', 'error');
      return;
    }
    const updStud = await window.supabase.from('students').update(payloadStudent).eq('id', studentId);
    if (updStud.error) {
      Helpers.toast('Error guardando estudiante', 'error');
      return;
    }
    AppState.profile = { ...AppState.profile,
      ...payloadProfile
    };
    AppState.currentStudent = { ...AppState.currentStudent,
      ...payloadStudent
    };
    if (avatarUrl) {
      const img = document.getElementById('profilePhotoPreview');
      if (img) img.src = avatarUrl;
    }
    Helpers.toast('Perfil guardado', 'success');
  });

  document.querySelectorAll('.task-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.task-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      UI.loadTasks(btn.dataset.filter || 'all');
    });
  });
  window.addEventListener('beforeunload', () => {
    if (UI.feedChannel) window.supabase.removeChannel(UI.feedChannel);
    if (UI.notifChannel) window.supabase.removeChannel(UI.notifChannel);
  });
});
