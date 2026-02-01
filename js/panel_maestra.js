import { supabase, ensureRole, sendPush } from './supabase.js';

// --- 1. HELPERS & UTILS ---
const Helpers = {
  toast(msg, type = 'success') {
    const t = document.createElement('div');
    const colorClass = type === 'success' ? 'bg-green-500' : (type === 'error' ? 'bg-red-500' : 'bg-blue-500');
    t.className = `toast-notification ${colorClass}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(20px)';
      setTimeout(() => t.remove(), 300);
    }, 3000);
  },

  emptyState(message, icon = 'smile') {
    return `
      <div class="text-center py-10 text-slate-400">
        <i data-lucide="${icon}" class="mx-auto mb-3 w-12 h-12 opacity-50"></i>
        <p>${message}</p>
      </div>
    `;
  },

  skeleton(count = 3) {
    return Array(count).fill(0).map(() => `
      <div class="animate-pulse bg-slate-100 rounded-xl h-32 w-full"></div>
    `).join('');
  },

  saveLastClass(id) {
    localStorage.setItem('karpus_last_class', id);
  },

  loadLastClass() {
    return localStorage.getItem('karpus_last_class');
  },

  formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
  },

  escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }
};

// --- 2. APP STATE ---
const AppState = {
  user: null,
  profile: null,
  currentClass: null,
  currentTab: 'feed',
  
  // Cache simple
  studentsCache: {}, 
  
  setCurrentClass(cls) {
    this.currentClass = cls;
    if (cls) {
      Helpers.saveLastClass(cls.id);
    } else {
      localStorage.removeItem('karpus_last_class');
    }
  }
};

// --- 3. UI CONTROLLER ---
const UI = {
  init() {
    this.bindEvents();
    this.checkSession();
  },

  async checkSession() {
    const auth = await ensureRole('maestra');
    if (!auth) return;
    AppState.user = auth.user;
    AppState.profile = auth.profile;
    this.updateUserProfileUI();

    // Initial Load
    await this.loadClasses();

    // Check for last class persistence
    const lastClassId = Helpers.loadLastClass();
    if (lastClassId) {
       this.openClassById(lastClassId);
    }
  },

  updateUserProfileUI() {
    const name = AppState.profile?.name || 'Maestra';
    const email = AppState.profile?.email || AppState.user.email;
    document.querySelectorAll('.user-name-display').forEach(el => el.textContent = name);
    document.querySelectorAll('.user-email-display').forEach(el => el.textContent = email);
  },

  bindEvents() {
    // Navigation (Sidebar)
    document.querySelectorAll('[data-section]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const sectionId = btn.dataset.section;
        this.showSection(sectionId);
        
        // Update Sidebar Active State
        document.querySelectorAll('[data-section]').forEach(b => {
            b.classList.remove('bg-white/20', 'active');
            b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('bg-white/20', 'active');
        btn.setAttribute('aria-selected', 'true');

        // Reset class if going home
        if (sectionId === 't-home') {
          AppState.setCurrentClass(null);
          // Optional: Reload classes to refresh
          // this.loadClasses();
        }
      });
    });

    // Mobile Menu
    const toggleBtn = document.getElementById('toggleSidebar');
    if(toggleBtn) toggleBtn.addEventListener('click', () => this.toggleSidebar());
    
    const menuBtn = document.getElementById('menuBtn');
    if(menuBtn) menuBtn.addEventListener('click', () => this.toggleMobileSidebar());

    const overlay = document.getElementById('sidebarOverlay');
    if(overlay) overlay.addEventListener('click', () => this.toggleMobileSidebar());

    // Back Button
    document.getElementById('backToClasses')?.addEventListener('click', () => {
        document.querySelector('[data-section="t-home"]')?.click();
    });

    // Logout (Movido aquí correctamente)
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
        try { await supabase.auth.signOut(); } catch(e){}
        window.location.href = 'login.html';
    });

    // Class Tabs
    document.querySelectorAll('.class-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.showTab(btn.dataset.tab);
      });
    });

    // Delegated Events for Dynamic Content
    document.addEventListener('click', (e) => {
        // Open Class Card
        const classCard = e.target.closest('.class-card');
        if (classCard) {
            const id = classCard.dataset.id;
            const name = classCard.dataset.name;
            this.openClass({ id, name });
        }

        // View Student Profile (Delegación)
        if (e.target.closest('.btn-view-profile')) {
            const btn = e.target.closest('.btn-view-profile');
            this.openStudentProfile(btn.dataset.id);
        }

        // Daily Log Student Select (Delegación)
        if (e.target.closest('.btn-log-student')) {
            const btn = e.target.closest('.btn-log-student');
            this.openDailyLogModal(btn.dataset.id, btn.dataset.name);
        }
    });
    
    // Setup Modal Closers (Generic)
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
           const modal = btn.closest('.fixed'); // Assuming modal wrapper is fixed
           if(modal) {
               modal.classList.add('hidden');
               modal.classList.remove('flex');
               document.body.classList.remove('no-scroll');
           }
        });
    });
  },

  showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) {
        target.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  },

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const shell = document.getElementById('layoutShell');
    sidebar.classList.toggle('collapsed');
    shell.classList.toggle('sidebar-collapsed');
    
    const iconEl = document.getElementById('toggleSidebarIcon');
    if(iconEl && window.lucide){
        const next = sidebar.classList.contains('collapsed') ? 'chevrons-right' : 'chevrons-left';
        iconEl.setAttribute('data-lucide', next);
        lucide.createIcons();
    }
  },

  toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('mobile-visible');
    overlay.classList.toggle('hidden');
    document.body.classList.toggle('no-scroll');
  },

  // --- CLASSES LOGIC ---
  async loadClasses() {
    const grid = document.getElementById('classesGrid');
    if (!grid) return;
    
    grid.innerHTML = Helpers.skeleton(3);

    const { data: classes, error } = await supabase
      .from('classrooms')
      .select('*')
      .eq('teacher_id', AppState.user.id);

    if (error) {
      grid.innerHTML = Helpers.emptyState(`Error: ${error.message}`, 'alert-circle');
      return;
    }

    if (!classes || classes.length === 0) {
      grid.innerHTML = Helpers.emptyState('No tienes aulas asignadas aún.');
      return;
    }

    grid.innerHTML = classes.map(cls => this.renderClassCard(cls)).join('');
    if(window.lucide) lucide.createIcons();
  },

  renderClassCard(cls) {
    // Random color assignment based on ID char or index could be better, but random for now is ok or strict list
    const colors = ['bg-orange-100 text-orange-600', 'bg-blue-100 text-blue-600', 'bg-pink-100 text-pink-600', 'bg-green-100 text-green-600'];
    const colorClass = colors[String(cls.id).charCodeAt(0) % colors.length];

    return `
      <div class="class-card bg-white rounded-3xl p-6 border shadow-sm hover:shadow-md hover:scale-[1.02] transition-all cursor-pointer group" 
           data-id="${cls.id}" data-name="${cls.name}">
        <div class="flex items-start justify-between mb-4">
          <div class="h-12 w-12 rounded-2xl ${colorClass} flex items-center justify-center">
            <i data-lucide="users" class="w-6 h-6"></i>
          </div>
          <span class="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-lg font-bold group-hover:bg-slate-200 transition-colors">
            ${cls.level || 'General'}
          </span>
        </div>
        <h3 class="font-bold text-lg text-slate-800 mb-1 group-hover:text-green-700 transition-colors">${cls.name}</h3>
        <p class="text-sm text-slate-500">${cls.shift || 'Turno Mañana'}</p>
      </div>
    `;
  },

  async openClassById(id) {
      const { data: cls, error } = await supabase.from('classrooms').select('*').eq('id', id).single();
      if (error) {
          Helpers.toast('Clase no encontrada', 'error');
          return;
      }
      if(cls) this.openClass(cls);
  },

  openClass(cls) {
    AppState.setCurrentClass(cls);
    document.getElementById('currentClassName').textContent = cls.name;
    
    // UX: Desactivar botón home visualmente
    document.querySelector('[data-section="t-home"]')?.classList.remove('active');
    
    this.showSection('t-class-detail');
    this.showTab('feed'); // Default tab
    window.scrollTo({ top: 0 });
  },

  // --- TAB LOGIC ---
  showTab(tabName) {
    AppState.currentTab = tabName;
    
    // Update Buttons
    document.querySelectorAll('.class-tab-btn').forEach(btn => {
        if(btn.dataset.tab === tabName) {
            btn.classList.add('active', 'bg-green-600', 'text-white');
            btn.classList.remove('text-slate-600', 'hover:bg-slate-100');
        } else {
            btn.classList.remove('active', 'bg-green-600', 'text-white');
            btn.classList.add('text-slate-600', 'hover:bg-slate-100');
        }
    });

    // Show Content
    document.querySelectorAll('.class-tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${tabName}`)?.classList.remove('hidden');

    // Load Data
    if(tabName === 'feed') this.renderFeed();
    if(tabName === 'students') this.renderStudents();
    if(tabName === 'daily-log') this.renderDailyLog();
    if(tabName === 'attendance') this.renderAttendance();
    if(tabName === 'tasks') this.renderTasks();
  },

  // --- RENDERERS ---
  async renderFeed() {
    const tab = document.getElementById('tab-feed');
    if(!tab) return;

    if (!AppState.currentClass?.id) {
        tab.innerHTML = Helpers.emptyState('Seleccione una clase primero', 'alert-circle');
        return;
    }
    
    // Skeleton
    tab.innerHTML = Helpers.skeleton(1); 
    
    // TODO: Implement Post creation UI and fetching
    // For now, simple empty state or mock
    tab.innerHTML = `
        <div class="bg-white p-4 rounded-2xl border shadow-sm mb-4">
            <textarea id="newPostContent" class="w-full border rounded-xl p-3 text-sm focus:ring-2 focus:ring-green-500 outline-none resize-none" rows="2" placeholder="Escribe un anuncio para la clase..."></textarea>
            
            <!-- Preview de imagen -->
            <div id="previewContainer" class="hidden mt-3 relative inline-block group">
                <img id="imgPreview" src="" class="h-24 w-auto rounded-lg border border-slate-200 object-cover shadow-sm">
                <button id="btnRemoveImg" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition transform hover:scale-110">
                    <i data-lucide="x" class="w-3 h-3"></i>
                </button>
            </div>

            <div class="flex justify-between items-center mt-3 pt-2 border-t border-slate-50">
                <div class="flex gap-2">
                    <label for="fileInput" class="cursor-pointer flex items-center gap-2 text-slate-500 hover:text-green-600 hover:bg-green-50 px-3 py-2 rounded-lg transition text-sm font-medium select-none">
                        <i data-lucide="paperclip" class="w-4 h-4"></i>
                        <span>Foto/Video</span>
                    </label>
                    <input type="file" id="fileInput" accept="image/*,video/*,application/pdf" class="hidden">
                </div>
                <button id="btnSubmitPost" class="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition flex items-center gap-2 shadow-sm shadow-green-200">
                    <span>Publicar</span>
                    <i data-lucide="send" class="w-4 h-4"></i>
                </button>
            </div>
        </div>
        <div id="feedPostsContainer"></div>
    `;
    
    if(window.lucide) lucide.createIcons();

    this.setupPostInputEvents();

    document.getElementById('btnSubmitPost').addEventListener('click', () => this.createPost());

    const { data: posts, error } = await supabase
      .from('posts')
      .select('*, profiles:teacher_id(name)')
      .eq('classroom_id', AppState.currentClass.id)
      .order('created_at', { ascending: false });

    if(error || !posts || posts.length === 0) {
        document.getElementById('feedPostsContainer').innerHTML = Helpers.emptyState('No hay publicaciones aún.', 'message-square');
        return;
    }

    // Render posts (simplified for brevity, can be expanded)
    const postsHTML = posts.map(p => `
        <div class="bg-white p-4 rounded-2xl border shadow-sm mb-4">
            <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-bold shadow-sm">
                    ${p.profiles?.name?.charAt(0) || 'M'}
                </div>
                <div>
                    <div class="font-bold text-sm text-slate-800">${p.profiles?.name || 'Maestra'}</div>
                    <div class="text-xs text-slate-500">${Helpers.formatDate(p.created_at)}</div>
                </div>
            </div>
            <p class="text-slate-700 text-sm mb-3 whitespace-pre-line">${Helpers.escapeHTML(p.content || '')}</p>
            ${p.media_type === 'image' ? `
                <div class="rounded-xl overflow-hidden border border-slate-100 mt-2">
                    <img src="${p.media_url}" alt="Imagen adjunta" class="w-full h-auto max-h-96 object-cover bg-slate-50" loading="lazy">
                </div>
            ` : p.media_type === 'video' ? `
                <div class="rounded-xl overflow-hidden border border-slate-100 mt-2">
                    <video src="${p.media_url}" controls class="w-full h-auto max-h-96 bg-black"></video>
                </div>
            ` : ''}
        </div>
    `).join('');
    
    document.getElementById('feedPostsContainer').innerHTML = postsHTML;
  },

  setupPostInputEvents() {
    const fileInput = document.getElementById('fileInput');
    const previewContainer = document.getElementById('previewContainer');
    const imgPreview = document.getElementById('imgPreview');
    const btnRemoveImg = document.getElementById('btnRemoveImg');

    if(fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (evt) => {
                    imgPreview.src = evt.target.result;
                    previewContainer.classList.remove('hidden');
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if(btnRemoveImg) {
        btnRemoveImg.addEventListener('click', () => {
            fileInput.value = '';
            previewContainer.classList.add('hidden');
            imgPreview.src = '';
        });
    }
  },

  async createPost() {
    const contentInput = document.getElementById('newPostContent');
    const fileInput = document.getElementById('fileInput');
    const btnSubmit = document.getElementById('btnSubmitPost');

    const content = contentInput.value.trim();
    const file = fileInput?.files[0];

    if (!AppState.currentClass?.id) {
        Helpers.toast('Error: Clase no seleccionada', 'error');
        return;
    }

    if(!content && !file) {
        Helpers.toast('Escribe algo o sube una foto', 'info');
        return;
    }

    // UI Loading state
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Publicando...`;
    if(window.lucide) lucide.createIcons();

    try {
        let mediaUrl = null;
        let mediaType = null;

        // 1. Subir imagen si existe
        if (file) {
            const fileExt = file.name.split('.').pop();
            // Ruta: classroom_id / timestamp_random.ext
            const fileName = `${AppState.currentClass.id}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
            
            const { error: uploadError } = await supabase.storage
                .from('classroom_media')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('classroom_media')
                .getPublicUrl(fileName);
                
            mediaUrl = publicUrl;
            mediaType = 'image';
        }

        // 2. Insertar Post
        const { error } = await supabase.from('posts').insert({
            classroom_id: AppState.currentClass.id,
            teacher_id: AppState.user.id,
            content: content,
            media_url: mediaUrl,
            media_type: mediaType
        });

        if(error) throw error;

        Helpers.toast('Publicado correctamente', 'success');
        
        // Fix: Reactivar botón y limpiar
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `<span>Publicar</span><i data-lucide="send" class="w-4 h-4"></i>`;
        contentInput.value = '';
        if (fileInput) fileInput.value = '';
        document.getElementById('previewContainer').classList.add('hidden');
        if (window.lucide) lucide.createIcons();

        this.renderFeed(); // Recargar feed

    } catch (error) {
        console.error('Error creando post:', error);
        Helpers.toast('Error al publicar: ' + (error.message || 'Error desconocido'), 'error');
        
        // Reset button
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `<span>Publicar</span><i data-lucide="send" class="w-4 h-4"></i>`;
        if(window.lucide) lucide.createIcons();
    }
  },

  async renderStudents() {
    const tab = document.getElementById('tab-students');
    if (!AppState.currentClass?.id) {
        tab.innerHTML = Helpers.emptyState('Seleccione una clase primero');
        return;
    }

    tab.innerHTML = Helpers.skeleton(2);

    const { data: students, error } = await supabase
        .from('students')
        .select('*')
        .eq('classroom_id', AppState.currentClass.id)
        .order('name');
    
    if (error) {
        tab.innerHTML = Helpers.emptyState('Error cargando estudiantes: ' + error.message, 'alert-circle');
        return;
    }

    if (!students || !students.length) {
        tab.innerHTML = Helpers.emptyState('No hay estudiantes en esta clase.', 'users');
        return;
    }

    const cardColors = ['bg-orange-50 border-orange-100', 'bg-blue-50 border-blue-100', 'bg-pink-50 border-pink-100', 'bg-purple-50 border-purple-100'];
    const iconColors = ['text-orange-600 bg-orange-100', 'text-blue-600 bg-blue-100', 'text-pink-600 bg-pink-100', 'text-purple-600 bg-purple-100'];

    tab.innerHTML = `
      <div class="bg-white p-4 rounded-2xl shadow-sm">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          ${students.map((s, index) => `
            <div class="flex items-center gap-3 p-3 border rounded-xl hover:shadow-md transition group relative ${cardColors[index % cardColors.length]}">
              <div class="w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${iconColors[index % iconColors.length]}">
                ${(s.name || '?').charAt(0)}
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm text-slate-800 truncate">${s.name || 'Sin nombre'}</div>
                <div class="text-xs text-slate-500">ID: ${String(s.id).substring(0,8)}</div>
                <button onclick="window.UI.openStudentProfile('${s.id}')" class="text-blue-600 hover:text-green-600 text-xs font-medium mt-1 flex items-center gap-1 cursor-pointer">
                   <i data-lucide="eye" class="w-3 h-3"></i> Ver Perfil
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
    if(window.lucide) lucide.createIcons();
  },

  async renderDailyLog() {
      const tab = document.getElementById('tab-daily-log');
      if (!AppState.currentClass?.id) {
          tab.innerHTML = Helpers.emptyState('Seleccione una clase primero');
          return;
      }
      // Interfaz colorida para el diario
      tab.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-gradient-to-br from-yellow-50 to-orange-50 p-5 rounded-3xl border border-orange-100 shadow-sm">
                <h3 class="font-bold text-orange-800 mb-3 flex items-center gap-2"><i data-lucide="smile" class="w-5 h-5"></i> Estado de Ánimo</h3>
                <div class="grid grid-cols-2 gap-2">
                    <button class="p-2 bg-white rounded-xl border border-orange-100 text-sm hover:bg-orange-100 transition">😊 Feliz</button>
                    <button class="p-2 bg-white rounded-xl border border-orange-100 text-sm hover:bg-orange-100 transition">😐 Tranquilo</button>
                    <button class="p-2 bg-white rounded-xl border border-orange-100 text-sm hover:bg-orange-100 transition">😢 Triste</button>
                    <button class="p-2 bg-white rounded-xl border border-orange-100 text-sm hover:bg-orange-100 transition">😠 Enojado</button>
                </div>
            </div>
            <div class="bg-gradient-to-br from-blue-50 to-indigo-50 p-5 rounded-3xl border border-blue-100 shadow-sm">
                <h3 class="font-bold text-blue-800 mb-3 flex items-center gap-2"><i data-lucide="utensils" class="w-5 h-5"></i> Alimentación</h3>
                <div class="grid grid-cols-2 gap-2">
                    <button class="p-2 bg-white rounded-xl border border-blue-100 text-sm hover:bg-blue-100 transition">🍽️ Todo</button>
                    <button class="p-2 bg-white rounded-xl border border-blue-100 text-sm hover:bg-blue-100 transition">🥣 La mitad</button>
                    <button class="p-2 bg-white rounded-xl border border-blue-100 text-sm hover:bg-blue-100 transition">🤏 Poco</button>
                    <button class="p-2 bg-white rounded-xl border border-blue-100 text-sm hover:bg-blue-100 transition">❌ Nada</button>
                </div>
            </div>
        </div>
        <div class="mt-4 text-center text-slate-400 text-sm italic">
            Seleccione un estudiante para registrar su diario (Funcionalidad completa próximamente)
        </div>
      `;
      if(window.lucide) lucide.createIcons();
  },

  async renderAttendance() {
    const tab = document.getElementById('tab-attendance');
    const todayStr = new Date().toISOString().split('T')[0];
    
    tab.innerHTML = Helpers.skeleton(3);

    const { data: students } = await supabase
      .from('students')
      .select('*')
      .eq('classroom_id', AppState.currentClass.id)
      .order('name');
      
    if(!students?.length) {
        tab.innerHTML = Helpers.emptyState('No hay estudiantes para tomar lista.');
        return;
    }

    // Check existing attendance for today (or selected date)
    // For now, let's use a local date variable, could be moved to AppState if date picker needed
    const selectedDate = todayStr;
    
    const { data: existingAttendance } = await supabase
        .from('attendance')
        .select('*')
        .eq('classroom_id', AppState.currentClass.id)
        .eq('date', selectedDate);

    // --- LÓGICA DE SEMBRADO (SEEDING) ---
    // Si hay estudiantes sin registro para hoy, crearlos como 'pending'
    if ((existingAttendance?.length || 0) < students.length) {
        const existingIds = new Set((existingAttendance || []).map(a => String(a.student_id)));
        const toSeed = students
            .filter(s => !existingIds.has(String(s.id)))
            .map(s => ({
                student_id: s.id,
                classroom_id: AppState.currentClass.id,
                date: selectedDate,
                status: 'pending'
            }));

        if (toSeed.length) {
            await supabase.from('attendance').upsert(toSeed, { onConflict: 'student_id,date' });
            // Actualizar lista local para reflejar cambios
            if(existingAttendance) existingAttendance.push(...toSeed);
        }
    }
    // -------------------------------------
        
    const statusMap = {};
    existingAttendance?.forEach(a => statusMap[a.student_id] = a.status);

    tab.innerHTML = `
      <div class="bg-white p-6 rounded-2xl shadow-sm">
        <div class="flex justify-between items-center mb-6">
            <h3 class="font-bold text-slate-700">Asistencia: ${Helpers.formatDate(selectedDate)}</h3>
            <div class="flex gap-2">
              <button id="btnMarkAllPresent" class="bg-blue-600 text-white px-4 py-2 rounded-xl shadow hover:bg-blue-700 transition flex items-center gap-2">
                <i data-lucide="check" class="w-4 h-4"></i> Marcar todos presentes
              </button>
              <button id="btnSaveAttendance" class="bg-green-600 text-white px-6 py-2 rounded-xl shadow hover:bg-green-700 transition flex items-center gap-2">
                <i data-lucide="save" class="w-4 h-4"></i> Guardar
              </button>
            </div>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
                <thead class="bg-gradient-to-r from-green-50 to-emerald-50 text-green-800 text-xs uppercase font-bold tracking-wider">
                    <tr>
                        <th class="p-4 rounded-tl-xl">Estudiante</th>
                        <th class="p-4 text-center">Estado</th>
                        <th class="p-4 text-center rounded-tr-xl">Acciones</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    ${students.map(s => {
                        const status = statusMap[s.id] || 'pending';
                        return `
                        <tr class="student-row hover:bg-slate-50 transition-colors" data-id="${s.id}" data-status="${status}">
                            <td class="p-4 font-medium text-slate-700">${s.name}</td>
                            <td class="p-4 text-center">
                                <span class="status-badge px-3 py-1 rounded-full text-xs font-bold 
                                    ${status === 'present' ? 'bg-green-100 text-green-700' : 
                                      status === 'absent' ? 'bg-red-100 text-red-700' : 
                                      status === 'late' ? 'bg-yellow-100 text-yellow-700' : 
                                      'bg-slate-100 text-slate-500'}">
                                    ${status === 'present' ? 'Presente' : 
                                      status === 'absent' ? 'Ausente' : 
                                      status === 'late' ? 'Tardanza' : 'Pendiente'}
                                </span>
                            </td>
                            <td class="p-4 text-center">
                                <div class="flex items-center justify-center gap-2">
                                    <button class="att-btn p-2 rounded-lg hover:bg-green-50 text-slate-400 hover:text-green-600 transition" 
                                            onclick="UI.setAttendance('${s.id}', 'present', this)" title="Presente">
                                        <i data-lucide="check-circle" class="w-5 h-5"></i>
                                    </button>
                                    <button class="att-btn p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition" 
                                            onclick="UI.setAttendance('${s.id}', 'absent', this)" title="Ausente">
                                        <i data-lucide="x-circle" class="w-5 h-5"></i>
                                    </button>
                                    <button class="att-btn p-2 rounded-lg hover:bg-yellow-50 text-slate-400 hover:text-yellow-600 transition" 
                                            onclick="UI.setAttendance('${s.id}', 'late', this)" title="Tardanza">
                                        <i data-lucide="clock" class="w-5 h-5"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
      </div>
    `;
    
    if(window.lucide) lucide.createIcons();
    
    // Bind Save Button
    document.getElementById('btnSaveAttendance').addEventListener('click', () => this.saveAttendance());
    document.getElementById('btnMarkAllPresent').addEventListener('click', () => {
      document.querySelectorAll('.student-row').forEach(r => { r.dataset.status = 'present'; });
      document.querySelectorAll('.student-row .status-badge').forEach(b => {
        b.className = 'status-badge px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700';
        b.textContent = 'Presente';
      });
    });
  },

  setAttendance(studentId, status, btn) {
      const row = document.querySelector(`tr[data-id="${studentId}"]`);
      if(!row) return;
      
      row.dataset.status = status;
      
      // Update Badge
      const badge = row.querySelector('.status-badge');
      badge.className = `status-badge px-3 py-1 rounded-full text-xs font-bold 
        ${status === 'present' ? 'bg-green-100 text-green-700' : 
          status === 'absent' ? 'bg-red-100 text-red-700' : 
          status === 'late' ? 'bg-yellow-100 text-yellow-700' : 
          'bg-slate-100 text-slate-500'}`;
      
      const labels = { present: 'Presente', absent: 'Ausente', late: 'Tardanza' };
      badge.textContent = labels[status];
  },

  async saveAttendance() {
      const rows = document.querySelectorAll('.student-row');
      const upsertData = [];
      const date = new Date().toISOString().split('T')[0];
      
      rows.forEach(r => {
          const studentId = r.dataset.id;
          const status = r.dataset.status;
          if(status && status !== 'pending') {
              upsertData.push({
                  student_id: studentId,
                  classroom_id: AppState.currentClass.id,
                  date: date,
                  status: status
              });
          }
      });

      if(upsertData.length === 0) {
          Helpers.toast('No hay cambios para guardar', 'info');
          return;
      }

      Helpers.toast('Guardando asistencia...', 'info');
      
      const { error } = await supabase.from('attendance').upsert(upsertData, { onConflict: 'student_id,classroom_id,date' });
      
      if(error) {
          Helpers.toast('Error al guardar asistencia', 'error');
          console.error(error);
      } else {
          Helpers.toast('Asistencia guardada correctamente', 'success');
      }
  },

  // --- TASKS MODULE ---
  async renderTasks() {
    const tab = document.getElementById('tab-tasks');
    if(!tab) return;
    if (!AppState.currentClass?.id) {
        tab.innerHTML = Helpers.emptyState('Seleccione una clase primero');
        return;
    }
    
    tab.innerHTML = `
      <div id="tasksViewContainer">
        <div class="flex justify-between items-center mb-6">
          <h3 class="font-bold text-slate-700 text-xl">Tareas del Aula</h3>
          <button id="btnNewTask" class="bg-pink-500 text-white px-4 py-2 rounded-xl shadow hover:bg-pink-600 transition flex items-center gap-2 font-bold">
            <i data-lucide="plus" class="w-5 h-5"></i> Nueva Tarea
          </button>
        </div>

        <!-- Formulario Nueva Tarea -->
        <div id="newTaskForm" class="hidden bg-white p-6 rounded-2xl border border-pink-100 shadow-sm mb-6 relative">
          <button id="btnCloseTaskForm" class="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><i data-lucide="x"></i></button>
          <h4 class="font-bold text-pink-600 mb-4">Crear Nueva Tarea</h4>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-bold text-slate-600 mb-1">Título</label>
              <input type="text" id="taskTitle" class="w-full border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-pink-400" placeholder="Ej: Dibujo de la familia">
            </div>
            <div>
              <label class="block text-sm font-bold text-slate-600 mb-1">Descripción</label>
              <textarea id="taskDesc" rows="3" class="w-full border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-pink-400" placeholder="Instrucciones para los padres..."></textarea>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-bold text-slate-600 mb-1">Fecha de Entrega</label>
                <input type="date" id="taskDate" class="w-full border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-pink-400">
              </div>
              <div>
                <label class="block text-sm font-bold text-slate-600 mb-1">Adjunto (Foto/PDF/Video)</label>
                <input type="file" id="taskFile" accept="image/*,video/*,application/pdf" class="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100">
              </div>
            </div>
            <div class="pt-2">
              <button id="btnSaveTask" class="w-full py-3 bg-pink-500 hover:bg-pink-600 text-white rounded-xl font-bold shadow-lg shadow-pink-200 transition">Publicar Tarea</button>
            </div>
          </div>
        </div>

        <!-- Lista de Tareas -->
        <div id="tasksListContainer" class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${Helpers.skeleton(2)}
        </div>
      </div>
      
      <!-- Modal Detalle de Tarea -->
      <div id="taskDetailModal" class="fixed inset-0 bg-black/50 hidden items-center justify-center z-50 p-4">
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-5xl overflow-hidden max-h-[92vh] flex flex-col">
          <div class="p-4 border-b flex items-center justify-between">
            <div>
              <h3 id="taskModalTitle" class="font-bold text-xl text-slate-800"></h3>
              <p id="taskModalDue" class="text-xs text-slate-500"></p>
            </div>
            <button id="btnCloseTaskModal" class="text-slate-400 hover:text-slate-600 p-2 rounded"><i data-lucide="x"></i></button>
          </div>
          <div class="p-4 overflow-auto">
            <table class="w-full text-left">
              <thead class="bg-slate-50 text-slate-600 text-xs uppercase font-bold">
                <tr><th class="p-3">Estudiante</th><th class="p-3 text-center">Estado</th><th class="p-3 text-center">Evidencia</th><th class="p-3 text-center">Calificación</th></tr>
              </thead>
              <tbody id="taskModalBody" class="divide-y divide-slate-100"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    
    if(window.lucide) lucide.createIcons();

    document.getElementById('btnNewTask').onclick = () => {
      document.getElementById('newTaskForm').classList.remove('hidden');
      document.getElementById('btnNewTask').classList.add('hidden');
    };
    document.getElementById('btnCloseTaskForm').onclick = () => {
      document.getElementById('newTaskForm').classList.add('hidden');
      document.getElementById('btnNewTask').classList.remove('hidden');
    };
    document.getElementById('btnSaveTask').onclick = () => this.createTask();

    this.loadTasksList();
  },

  async loadTasksList() {
    const container = document.getElementById('tasksListContainer');
    if(!container) return;

    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('classroom_id', AppState.currentClass.id)
      .order('created_at', { ascending: false });

    if(error || !tasks.length) {
      container.innerHTML = `<div class="col-span-full">${Helpers.emptyState('No hay tareas asignadas', 'clipboard-list')}</div>`;
      return;
    }

    container.innerHTML = tasks.map(t => `
      <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition group relative overflow-hidden">
        <div class="absolute top-0 left-0 w-1 h-full bg-pink-400"></div>
        <div class="flex justify-between items-start mb-2 pl-3">
          <h4 class="font-bold text-slate-800 text-lg group-hover:text-pink-600 transition">${t.title}</h4>
          <span class="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-lg">
            Vence: ${Helpers.formatDate(t.due_date)}
          </span>
        </div>
        <p class="text-slate-600 text-sm mb-4 pl-3 line-clamp-2">${t.description || 'Sin descripción'}</p>
        <div class="flex items-center justify-between mt-auto pl-3">
          <button class="bg-pink-50 text-pink-600 px-4 py-2 rounded-lg font-bold text-sm hover:bg-pink-100 transition flex items-center gap-2" onclick="UI.openTaskDetail('${t.id}')">
            <i data-lucide="eye" class="w-4 h-4"></i> Ver Entregas
          </button>
          ${t.file_url ? `<a href="${t.file_url}" target="_blank" class="text-slate-400 hover:text-blue-500" title="Ver adjunto"><i data-lucide="paperclip" class="w-5 h-5"></i></a>` : ''}
        </div>
      </div>
    `).join('');
    
    if(window.lucide) lucide.createIcons();
  },

  async createTask() {
    const title = document.getElementById('taskTitle').value;
    const desc = document.getElementById('taskDesc').value;
    const date = document.getElementById('taskDate').value;
    const file = document.getElementById('taskFile').files[0];
    const btn = document.getElementById('btnSaveTask');

    if(!title || !date) { Helpers.toast('Título y fecha requeridos', 'error'); return; }

    btn.disabled = true;
    btn.textContent = 'Publicando...';

    try {
      let fileUrl = null;
      if(file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
        const fileName = `tasks/${AppState.currentClass.id}_${Date.now()}_${safeName}`;
        const { error: upErr } = await supabase.storage.from('classroom_media').upload(fileName, file);
        if(upErr) throw upErr;
        const { data } = supabase.storage.from('classroom_media').getPublicUrl(fileName);
        fileUrl = data.publicUrl;
      }

      const { error } = await supabase.from('tasks').insert({
        classroom_id: AppState.currentClass.id,
        title,
        description: desc,
        due_date: date,
        file_url: fileUrl
      });

      if(error) throw error;
      Helpers.toast('Tarea publicada con éxito');
      
      // Fix: Reset form
      document.getElementById('taskTitle').value = '';
      document.getElementById('taskDesc').value = '';
      document.getElementById('taskDate').value = '';
      document.getElementById('taskFile').value = '';

      document.getElementById('newTaskForm').classList.add('hidden');
      document.getElementById('btnNewTask').classList.remove('hidden');
      this.loadTasksList();
    } catch(e) {
      console.error(e);
      Helpers.toast('Error al crear tarea', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Publicar Tarea';
    }
  },

  async openTaskDetail(taskId) {
    const modal = document.getElementById('taskDetailModal');
    const bodyEl = document.getElementById('taskModalBody');
    const titleEl = document.getElementById('taskModalTitle');
    const dueEl = document.getElementById('taskModalDue');
    if(!modal || !bodyEl) return;
    bodyEl.innerHTML = `<tr><td colspan="4" class="p-4">${Helpers.skeleton(1)}</td></tr>`;

    const { data: task } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    const { data: students } = await supabase.from('students').select('id, name').eq('classroom_id', AppState.currentClass.id).order('name');
    const { data: evidences } = await supabase.from('task_evidences').select('*').eq('task_id', taskId);

    const evidenceMap = {};
    evidences?.forEach(e => evidenceMap[e.student_id] = e);

    titleEl.textContent = task.title;
    dueEl.textContent = `Vence: ${Helpers.formatDate(task.due_date)}`;
    bodyEl.innerHTML = students.map(s => {
      const ev = evidenceMap[s.id];
      const status = ev ? 'Entregado' : 'Pendiente';
      const grade = ev?.grade_letter || null;
      const stars = Number(ev?.stars) || 0;
      return `
        <tr class="hover:bg-slate-50">
          <td class="p-3 font-medium text-slate-700">${s.name}</td>
          <td class="p-3 text-center"><span class="px-2 py-1 rounded-full text-xs font-bold ${ev ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}">${status}</span></td>
          <td class="p-3 text-center">${ev?.file_url ? `<a href="${ev.file_url}" target="_blank" class="text-blue-600 font-bold underline text-xs">Ver Archivo</a>` : '-'}</td>
          <td class="p-3 text-center">
            ${ev ? `
              <div class="flex flex-col items-center gap-2">
                <div class="flex justify-center gap-1">${['A','B','C','D'].map(g => `<button onclick="UI.gradeTask('${ev.id}', '${g}', this)" class="w-8 h-8 rounded-lg font-bold text-xs transition ${grade === g ? 'bg-pink-500 text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-pink-100 hover:text-pink-600'}">${g}</button>`).join('')}</div>
                <div class="flex justify-center gap-1">
                  ${[1,2,3,4,5].map(n => `
                    <button title="${n} estrellas" onclick="UI.gradeStars('${ev.id}', ${n}, this)" class="p-1 ${n <= stars ? 'text-yellow-500' : 'text-slate-300'}">
                      <i data-lucide="star" class="w-4 h-4"></i>
                    </button>
                  `).join('')}
                </div>
              </div>
            ` : '<span class="text-xs text-slate-300">Sin entrega</span>'}
          </td>
        </tr>`;
    }).join('');
    if(window.lucide) lucide.createIcons();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('btnCloseTaskModal')?.addEventListener('click', () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  },

  async gradeTask(evidenceId, grade, btn) {
    // UI Optimista
    Array.from(btn.parentElement.children).forEach(b => b.className = 'w-8 h-8 rounded-lg font-bold text-xs transition bg-slate-100 text-slate-500 hover:bg-pink-100 hover:text-pink-600');
    btn.className = 'w-8 h-8 rounded-lg font-bold text-xs transition bg-pink-500 text-white shadow-md';
    
    const { error } = await supabase.from('task_evidences').update({ grade_letter: grade, status: 'graded' }).eq('id', evidenceId);
    if(!error) Helpers.toast(`Calificado con ${grade}`);
  },

  async gradeStars(evidenceId, stars, btn) {
    const parent = btn.parentElement;
    Array.from(parent.children).forEach((b, idx) => {
      const isActive = idx < stars;
      b.className = `p-1 ${isActive ? 'text-yellow-500' : 'text-slate-300'}`;
    });
    const { error } = await supabase.from('task_evidences').update({ stars: stars, status: 'graded' }).eq('id', evidenceId);
    if(!error) Helpers.toast(`${stars} estrella(s) asignadas`);
  },
  // --- STUDENT PROFILE MODAL ---
  async openStudentProfile(studentId) {
    const modal = document.getElementById('studentProfileModal');
    if(!modal) return;
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('no-scroll');

    // Fill with loading state or clear
    ['studentProfileName', 'studentDOB', 'studentClassroom', 'studentAllergies', 
     'parent1Name', 'parent1Phone', 'parent1Email'].forEach(id => {
         const el = document.getElementById(id);
         if(el) el.textContent = '...';
    });

    try {
        const { data: student, error } = await supabase
          .from('students')
          .select(`*, parent:parent_id(*)`)
          .eq('id', studentId)
          .single();
          
        if(error) throw error;
        
        const setText = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val || '-'; };
        
        setText('studentProfileName', student.name);
        setText('studentDOB', student.birth_date);
        setText('studentClassroom', AppState.currentClass?.name);
        setText('studentAllergies', student.allergies);
        
        let parent = student.parent;
        if(Array.isArray(parent)) parent = parent[0];
        
        if(parent) {
            setText('parent1Name', parent.name);
            setText('parent1Phone', parent.phone);
            setText('parent1Email', parent.email);
        }

    } catch (e) {
        Helpers.toast('Error cargando perfil', 'error');
        console.error(e);
    }
  }
};

// Expose UI to window for inline onclicks (backward compatibility or specific generated HTML)
window.UI = UI;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    UI.init();
    
    // Explicit Modal Close Logic for Profile
    document.getElementById('closeStudentProfile')?.addEventListener('click', () => {
        const m = document.getElementById('studentProfileModal');
        m.classList.add('hidden');
        m.classList.remove('flex');
        document.body.classList.remove('no-scroll');
    });
    
    document.getElementById('closeStudentProfileModal')?.addEventListener('click', () => {
        const m = document.getElementById('studentProfileModal');
        m.classList.add('hidden');
        m.classList.remove('flex');
        document.body.classList.remove('no-scroll');
    });
});
