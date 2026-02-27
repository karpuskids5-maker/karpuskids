import { supabase, initOneSignal } from './supabase.js';

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
  
  dailySummary: {
    present: 0,
    absent: 0,
    incidents: 0
  },
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
    
    this.initNotifications(); // ✅ Activar notificaciones push

    // 12. Optimización Técnica: Visibility Change
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && AppState.currentClass) {
        this.loadClasses(); // Recargar datos frescos
      }
    });
  },

  async checkSession() {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      window.location.href = 'login.html';
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role, name, email')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) {
      await supabase.auth.signOut();
      window.location.href = 'login.html';
      return;
    }

    // 1. Corrección Validación de Rol
    if (profile.role === 'padre') {
      window.location.href = 'panel_padres.html';
      return;
    }
    if (profile.role === 'directora') {
      window.location.href = 'panel_directora.html';
      return;
    }
    if (profile.role !== 'maestra') {
      window.location.href = 'login.html';
      return;
    }
    
    AppState.user = user;
    AppState.profile = profile;
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
    const name = AppState.profile?.name || 'Maestra Allamna';
    const email = AppState.profile?.email || AppState.user.email;
    const avatar = AppState.profile?.avatar_url;
    document.querySelectorAll('.user-name-display').forEach(el => el.textContent = name);
    document.querySelectorAll('.user-email-display').forEach(el => el.textContent = email);
    document.querySelectorAll('.user-initial').forEach(el => el.textContent = name.charAt(0));
    if(avatar) document.querySelectorAll('#profileAvatar').forEach(el => el.src = avatar);
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

        // Post Submit (Delegación para evitar memory leaks)
        if (e.target.closest('#btnSubmitPost')) {
            this.createPost();
        }
        
        // 3. Delegación de eventos para Asistencia (Eliminado onclick inline)
        const attBtn = e.target.closest('.att-btn');
        if (attBtn) {
            const row = attBtn.closest('tr');
            const status = attBtn.dataset.status;
            if (row && status) {
                this.setAttendance(row.dataset.id, status);
            }
        }

        // Daily Routine Toggles
        const routineBtn = e.target.closest('.routine-toggle');
        if (routineBtn) {
            this.toggleRoutineOption(routineBtn);
        }

        // Incident Button in Profile
        if (e.target.closest('#btnRegisterIncident')) {
            const modal = document.getElementById('studentProfileModal');
            // Asumimos que el ID del estudiante está guardado en el modal o accesible
            // Para simplificar, usaremos un atributo data en el modal si es posible, o variable global temporal
            // Mejor: obtenerlo del contexto actual si está abierto
            // Implementación simple:
            this.openIncidentModal();
        }

        // Gallery Upload Listener (Delegado o directo si el elemento es estático en HTML, pero aquí lo vinculamos dinámicamente si es necesario)
        // Como galleryUploadInput está en el HTML estático (modificado arriba), podemos usar change directo si existiera al inicio,
        // pero como está dentro de un tab que podría recargarse, mejor delegación o binding en render.
        // Usaremos binding directo en renderGallery o un listener global change.
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

    // Incident Modal Actions
    document.getElementById('btnCancelIncident')?.addEventListener('click', () => {
        document.getElementById('incidentModal').classList.add('hidden');
        document.getElementById('incidentModal').classList.remove('flex');
    });
    document.getElementById('btnSaveIncident')?.addEventListener('click', () => this.saveIncident());

    // Gallery Input Change
    document.getElementById('galleryUploadInput')?.addEventListener('change', (e) => {
        this.handleGalleryUpload(e.target.files);
    });

    // Profile Events
    document.getElementById('profileAvatarInput')?.addEventListener('change', (e) => {
        this.handleAvatarUpload(e.target.files[0]);
    });
    
    document.getElementById('profileForm')?.addEventListener('submit', (e) => {
        this.saveProfile(e);
    });
  },

  showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) {
        target.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        if (id === 't-profile') {
            this.renderProfile();
        }
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
    sidebar.classList.toggle('-translate-x-full'); // Tailwind toggle
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
      Helpers.toast('Error cargando clases', 'error'); // 4. Manejo de errores
      return;
    }

    if (!classes || classes.length === 0) {
      grid.innerHTML = Helpers.emptyState('No tienes aulas asignadas aún.');
      return;
    }

    // Enrich classes with counts
    const enrichedClasses = await Promise.all(classes.map(async (cls) => {
        const { count: tasksCount, error: tErr } = await supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('classroom_id', cls.id);
        const { count: studentsCount, error: sErr } = await supabase.from('students').select('*', { count: 'exact', head: true }).eq('classroom_id', cls.id);
        if(tErr || sErr) console.warn('Error counting stats');
        return { ...cls, tasksCount, studentsCount };
    }));
    
    // 7. Dashboard Diario Inteligente (Stats Globales)
    const today = new Date().toISOString().split('T')[0];
    const { count: presentCount } = await supabase.from('attendance').select('*', { count: 'exact', head: true }).eq('date', today).eq('status', 'present');
    const { count: incidentCount } = await supabase.from('incidents').select('*', { count: 'exact', head: true }).gte('reported_at', today);
    
    AppState.dailySummary.present = presentCount || 0;
    AppState.dailySummary.incidents = incidentCount || 0;

    document.getElementById('statClasses').textContent = enrichedClasses.length;
    document.getElementById('statStudents').textContent = enrichedClasses.reduce((acc, c) => acc + (c.studentsCount||0), 0);
    document.getElementById('statIncidents').textContent = AppState.dailySummary.incidents;
    document.getElementById('statPresent').textContent = AppState.dailySummary.present;

    grid.innerHTML = enrichedClasses.map(cls => this.renderClassCard(cls)).join('');
    if(window.lucide) lucide.createIcons();
  },

  renderClassCard(cls) {
    // Random color assignment based on ID char or index could be better, but random for now is ok or strict list
    const themes = [
      { border: 'border-orange-400', bg: 'bg-orange-50', icon: 'text-orange-500' },
      { border: 'border-blue-400', bg: 'bg-blue-50', icon: 'text-blue-500' },
      { border: 'border-pink-400', bg: 'bg-pink-50', icon: 'text-pink-500' },
      { border: 'border-green-400', bg: 'bg-green-50', icon: 'text-green-500' }
    ];
    const theme = themes[String(cls.id).charCodeAt(0) % themes.length];

    return `
      <div class="class-card bg-white rounded-3xl p-0 border-2 ${theme.border} border-b-[8px] shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer group overflow-hidden" 
           data-id="${cls.id}" data-name="${Helpers.escapeHTML(cls.name)}">
        <div class="h-4 w-full ${theme.bg} opacity-50 flex gap-1 px-2 pt-1">
           <!-- Fake studs -->
           ${Array(6).fill('<div class="w-6 h-2 bg-black/10 rounded-t"></div>').join('')}
        </div>
        <div class="p-6">
            <div class="flex justify-between items-start mb-2">
                <h3 class="font-black text-xl text-slate-800 group-hover:text-green-600 transition-colors">${Helpers.escapeHTML(cls.name)}</h3>
                <i data-lucide="blocks" class="${theme.icon} w-8 h-8"></i>
            </div>
            <p class="text-sm text-slate-500 font-bold mb-4">${Helpers.escapeHTML(cls.level || 'General')} • ${cls.studentsCount || 0} Alumnos</p>
            <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div class="bg-green-400 h-full" style="width: 75%"></div>
            </div>
            <p class="text-xs text-slate-400 mt-1 text-right">Progreso del día</p>
        </div>
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
    
    // ✔ Mostrar contador de alumnos y tareas
    let metaEl = document.getElementById('currentClassMeta');
    if (!metaEl) {
        metaEl = document.createElement('div');
        metaEl.id = 'currentClassMeta';
        metaEl.className = 'text-sm text-slate-500 mt-1 font-medium';
        document.getElementById('currentClassName').parentNode.appendChild(metaEl);
    }
    metaEl.innerHTML = `${cls.studentsCount || 0} alumnos • ${cls.tasksCount || 0} tareas`;
    
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
      if (btn.dataset.tab === tabName) {
        btn.classList.add('active', 'bg-orange-600', 'text-white');
        btn.classList.remove('text-slate-600', 'hover:bg-slate-100');
      } else {
        btn.classList.remove('active', 'bg-orange-600', 'text-white');
        btn.classList.add('text-slate-600', 'hover:bg-slate-100');
      }
    });

    // Show Content
    document.querySelectorAll('.class-tab-content').forEach(c => c.classList.add('hidden'));
    const activeTab = document.getElementById(`tab-${tabName}`);
    if (activeTab) activeTab.classList.remove('hidden');

    // Load Data
    if (tabName === 'feed') this.renderFeed();
    if (tabName === 'students') this.renderStudents();
    if (tabName === 'daily-routine') this.renderDailyRoutine();
    if (tabName === 'attendance') this.renderAttendance();
    if (tabName === 'tasks') this.renderTasks?.();
    if (tabName === 'gallery') this.renderGallery?.();
    if (tabName === 'videocall') this.initVideoCall?.();
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
                <button id="btnSubmitPost" class="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-700 transition flex items-center gap-2 shadow-sm shadow-orange-200">
                    <span>Publicar</span>
                    <i data-lucide="send" class="w-4 h-4"></i>
                </button>
            </div>
        </div>
        <div id="feedPostsContainer"></div>
    `;
    
    if(window.lucide) lucide.createIcons();

    this.setupPostInputEvents();

    // Listener delegado en bindEvents

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
        ${(() => {
            const safeMedia = p.media_url ? encodeURI(p.media_url) : '';
            return `
        <div class="bg-white p-4 rounded-2xl border shadow-sm mb-4">
            <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-bold shadow-sm">
                    ${Helpers.escapeHTML(p.profiles?.name?.charAt(0) || 'M')}
                </div>
                <div>
                    <div class="font-bold text-sm text-slate-800">${Helpers.escapeHTML(p.profiles?.name || 'Maestra')}</div>
                    <div class="text-xs text-slate-500">${Helpers.formatDate(p.created_at)}</div>
                </div>
            </div>
            <p class="text-slate-700 text-sm mb-3 whitespace-pre-line">${Helpers.escapeHTML(p.content || '')}</p>
            ${p.media_type === 'image' ? `
                <div class="rounded-xl overflow-hidden border border-slate-100 mt-2">
                    <img src="${safeMedia}" alt="Imagen adjunta" class="w-full h-auto max-h-96 object-cover bg-slate-50" loading="lazy">
                </div>
            ` : p.media_type === 'video' ? `
                <div class="rounded-xl overflow-hidden border border-slate-100 mt-2">
                    <video src="${safeMedia}" controls class="w-full h-auto max-h-96 bg-black"></video>
                </div>
            ` : ''}
        </div>
            `;
        })()}
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

    // 3️⃣ btnSubmitPost puede ser null
    if(!btnSubmit) return;
    
    // ✔ Evitar doble click al publicar post
    if(btnSubmit.disabled) return;

    if (!AppState.currentClass?.id) {
        Helpers.toast('Error: Clase no seleccionada', 'error');
        return;
    }

    if(!content && !file) {
        Helpers.toast('Escribe algo o sube una foto', 'info');
        return;
    }

    // ✔ Limitar tamaño de archivos
    if (file && file.size > 10 * 1024 * 1024) {
       Helpers.toast('Archivo máximo 10MB', 'error');
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

            const { data: { publicUrl } } = await supabase.storage
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
        // 5️⃣ Falta resetear preview al publicar post
        const imgPreview = document.getElementById('imgPreview');
        if(imgPreview) imgPreview.src = '';
        
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

    tab.innerHTML = Helpers.skeleton(4);

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

    // Pastel color variants
    const pastelColors = ['pastel-blue', 'pastel-green', 'pastel-pink', 'pastel-yellow', 'pastel-purple'];

    tab.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          ${students.map((s, index) => `
          <div class="student-card-pastel ${pastelColors[index % pastelColors.length]}">
            <div class="student-card-avatar">${Helpers.escapeHTML((s.name || '?').charAt(0))}</div>
            <h4 class="student-card-name">${Helpers.escapeHTML(s.name || 'Sin nombre')}</h4>
            <p class="student-card-meta">ID: ${s.id}</p>
            <button onclick="window.UI.openStudentProfile('${s.id}')" class="student-card-button">
               Ver Ficha
            </button>
            </div>
          `).join('')}
        </div>
      `;
    if (window.lucide) lucide.createIcons();
  },

  // 3. NUEVA FUNCIÓN: Rutina del Día
  async renderDailyRoutine() {
      const tab = document.getElementById('tab-daily-routine');
      if (!AppState.currentClass?.id) {
          tab.innerHTML = Helpers.emptyState('Seleccione una clase primero');
          return;
      }
      
      tab.innerHTML = Helpers.skeleton(3);
      
      const today = new Date().toISOString().split('T')[0];
      
      // Fetch students and existing logs
      const { data: students } = await supabase.from('students').select('id, name').eq('classroom_id', AppState.currentClass.id).order('name');
      const { data: logs } = await supabase.from('daily_logs').select('*').eq('classroom_id', AppState.currentClass.id).eq('date', today);
      
      const logMap = {};
      logs?.forEach(l => logMap[l.student_id] = l);

      if (!students?.length) {
          tab.innerHTML = Helpers.emptyState('No hay estudiantes.');
          return;
      }

      const renderOptions = (type, currentVal, studentId) => {
          const options = {
              mood: [
                  {val: 'feliz', icon: '😊', label: 'Feliz'},
                  {val: 'tranquilo', icon: '😐', label: 'Tranquilo'},
                  {val: 'triste', icon: '😢', label: 'Triste'},
                  {val: 'enojado', icon: '😠', label: 'Enojado'}
              ],
              food: [
                  {val: 'todo', icon: '🍽️', label: 'Todo'},
                  {val: 'mitad', icon: '🥣', label: 'Mitad'},
                  {val: 'poco', icon: '🤏', label: 'Poco'},
                  {val: 'nada', icon: '❌', label: 'Nada'}
              ],
              nap: [
                  {val: 'si', icon: '😴', label: 'Durmió'},
                  {val: 'no', icon: '👀', label: 'No durmió'}
              ]
          };
          
          return options[type].map(opt => `
              <button class="routine-toggle px-2 py-1 rounded-lg border text-xs flex items-center gap-1 transition-all ${currentVal === opt.val ? 'bg-blue-100 border-blue-300 text-blue-700 font-bold ring-1 ring-blue-300' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}"
                      data-type="${type}" data-val="${opt.val}" data-student="${studentId}">
                  <span>${opt.icon}</span> <span class="hidden sm:inline">${opt.label}</span>
              </button>
          `).join('');
      };

      tab.innerHTML = `
        <div class="space-y-4">
            ${students.map(s => {
                const log = logMap[s.id] || {};
                return `
                <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center gap-4">
                    <div class="w-40 shrink-0 font-bold text-slate-700 truncate">${Helpers.escapeHTML(s.name)}</div>
                    
                    <div class="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div class="flex flex-col gap-1">
                            <span class="text-[10px] uppercase font-bold text-slate-400">Ánimo</span>
                            <div class="flex flex-wrap gap-1">${renderOptions('mood', log.mood, s.id)}</div>
                        </div>
                        <div class="flex flex-col gap-1">
                            <span class="text-[10px] uppercase font-bold text-slate-400">Comida</span>
                            <div class="flex flex-wrap gap-1">${renderOptions('food', log.food, s.id)}</div>
                        </div>
                        <div class="flex flex-col gap-1">
                            <span class="text-[10px] uppercase font-bold text-slate-400">Siesta</span>
                            <div class="flex flex-wrap gap-1">${renderOptions('nap', log.nap, s.id)}</div>
                        </div>
                    </div>
                </div>
                `;
            }).join('')}
        </div>
      `;
      if(window.lucide) lucide.createIcons();
  },

  // 4. UX: Auto-Guardado
  async toggleRoutineOption(btn) {
      const type = btn.dataset.type;
      const val = btn.dataset.val;
      const studentId = btn.dataset.student;
      const today = new Date().toISOString().split('T')[0];

      // UI Update Optimistic
      const siblings = btn.parentElement.querySelectorAll('.routine-toggle');
      siblings.forEach(b => b.className = 'routine-toggle px-2 py-1 rounded-lg border text-xs flex items-center gap-1 transition-all bg-white border-slate-200 text-slate-600 hover:bg-slate-50');
      btn.className = 'routine-toggle px-2 py-1 rounded-lg border text-xs flex items-center gap-1 transition-all bg-blue-100 border-blue-300 text-blue-700 font-bold ring-1 ring-blue-300';

      // Upsert to DB
      const payload = {
          student_id: studentId,
          classroom_id: AppState.currentClass.id,
          date: today,
          [type]: val
      };
      
      // Check if exists to update or insert (Supabase upsert handles this with unique constraint)
      // Assuming unique constraint on (student_id, date)
      const { error } = await supabase.from('daily_logs').upsert(payload, { onConflict: 'student_id,date' });
      
      if(error) {
          console.error(error);
          Helpers.toast('Error al guardar', 'error');
      }
  },

  async renderAttendance() {
    const tab = document.getElementById('tab-attendance');
    if (!AppState.currentClass?.id) {
        if(tab) tab.innerHTML = Helpers.emptyState('Seleccione una clase primero');
        return;
    }
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
            await supabase.from('attendance').upsert(toSeed, { onConflict: 'student_id,classroom_id,date' });
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
            <h3 class="font-bold text-slate-700 flex items-center gap-2"><i data-lucide="calendar"></i> ${Helpers.formatDate(selectedDate)}</h3>
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
                            <td class="p-4 font-medium text-slate-700">${Helpers.escapeHTML(s.name)}</td>
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
                                            data-status="present" title="Presente" aria-label="Marcar presente">
                                        <i data-lucide="check-circle" class="w-5 h-5"></i>
                                    </button>
                                    <button class="att-btn p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition" 
                                            data-status="absent" title="Ausente" aria-label="Marcar ausente">
                                        <i data-lucide="x-circle" class="w-5 h-5"></i>
                                    </button>
                                    <button class="att-btn p-2 rounded-lg hover:bg-yellow-50 text-slate-400 hover:text-yellow-600 transition" 
                                            data-status="late" title="Tardanza" aria-label="Marcar tardanza">
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

  setAttendance(studentId, status) {
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
      if (!AppState.currentClass?.id) {
          Helpers.toast('Seleccione una clase', 'error');
          return;
      }
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

      // 2. Attendance: doble toast innecesario (Corregido)
      Helpers.toast('Guardando asistencia...', 'info'); // Solo uno
      
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
    
    // ✔ Confirmación al cerrar formulario tarea
    document.getElementById('btnCloseTaskForm').onclick = () => {
        const t = document.getElementById('taskTitle').value;
        const d = document.getElementById('taskDesc').value;
        if ((t || d) && !confirm('¿Descartar esta tarea?')) return;
        
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

    // 4️⃣ Error silencioso cuando no existe tasks
    if(error || !tasks || tasks.length === 0) {
      container.innerHTML = `<div class="col-span-full">${Helpers.emptyState('No hay tareas asignadas', 'clipboard-list')}</div>`;
      return;
    }

    container.innerHTML = tasks.map(t => `
      <div class="notebook-bg p-5 rounded-2xl shadow-sm hover:shadow-md transition group relative overflow-hidden">
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

    const selectedDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
      Helpers.toast('La fecha debe ser hoy o futura', 'error');
      return;
    }

    btn.disabled = true;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<span>Publicando...</span>';

    try {
      let fileUrl = null;
      if(file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
        const fileName = `tasks/${AppState.currentClass.id}_${Date.now()}_${safeName}`;
        const { error: upErr } = await supabase.storage.from('classroom_media').upload(fileName, file);
        if(upErr) throw upErr;
        const { data } = await supabase.storage.from('classroom_media').getPublicUrl(fileName);
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

      // Notificar a los padres del aula
      try {
        const { data: students } = await supabase
          .from('students')
          .select('parent_id')
          .eq('classroom_id', AppState.currentClass.id);
        
        const parentIds = [...new Set(students.map(s => s.parent_id).filter(Boolean))];
        for (const pid of parentIds) {
          await window.sendPush({
            user_id: pid,
            title: 'Nueva Tarea Asignada 📝',
            message: `Se ha publicado una nueva tarea: "${title}". Fecha de entrega: ${Helpers.formatDate(date)}`,
            type: 'info',
            link: '/panel_padres.html#tasks'
          });
        }
      } catch (e) { console.error('Error notificando tarea:', e); }
      
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
      btn.innerHTML = originalHTML;
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
      
      // UI de Calificación Mejorada
      const gradingUI = ev ? `
        <div class="flex flex-col items-center gap-2">
          <!-- Selector de Nota (A, B, C) -->
          <div class="flex bg-slate-100 p-1 rounded-lg">
            ${['A','B','C'].map(g => {
              const isActive = grade === g;
              const activeClass = g === 'A' ? 'bg-green-500 text-white' : (g === 'B' ? 'bg-blue-500 text-white' : 'bg-orange-500 text-white');
              return `<button onclick="UI.gradeTask('${ev.id}', '${g}', this)" 
                class="w-8 h-8 rounded-md font-bold text-xs transition-all ${isActive ? activeClass + ' shadow-md scale-105' : 'text-slate-400 hover:bg-white hover:text-slate-600'}">
                ${g}
              </button>`;
            }).join('')}
          </div>
          <!-- Selector de Estrellas -->
          <div class="flex gap-1">
            ${[1,2,3,4,5].map(n => `
              <button title="${n} estrellas" onclick="UI.gradeStars('${ev.id}', ${n}, this)" class="transition-transform hover:scale-110 focus:outline-none">
                <i data-lucide="star" class="w-5 h-5 ${n <= stars ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200 fill-slate-100'}"></i>
              </button>
            `).join('')}
          </div>
        </div>
      ` : `<span class="text-xs text-slate-400 italic bg-slate-50 px-2 py-1 rounded">Sin entrega</span>`;

      return `
        <tr class="hover:bg-slate-50 border-b last:border-0 transition-colors">
          <td class="p-4 font-medium text-slate-700">
            ${Helpers.escapeHTML(s.name)}
          </td>
          <td class="p-4 text-center">
            <span class="px-3 py-1 rounded-full text-xs font-bold ${ev ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}">
              ${status}
            </span>
          </td>
          <td class="p-4 text-center">
            ${ev?.file_url ? `<a href="${ev.file_url}" target="_blank" class="inline-flex items-center gap-1 text-blue-600 font-bold text-xs hover:underline bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"><i data-lucide="file-text" class="w-3 h-3"></i> Ver Tarea</a>` : '<span class="text-slate-300">-</span>'}
          </td>
          <td class="p-3 text-center">
            ${gradingUI}
          </td>
        </tr>`;
    }).join('');
    if(window.lucide) lucide.createIcons();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('btnCloseTaskModal')?.focus(); // Accessibility: Focus Management

    const closeBtn = document.getElementById('btnCloseTaskModal');
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        };
    }
  },

  async gradeTask(evidenceId, grade, btn) {
    // UI Optimista
    Array.from(btn.parentElement.children).forEach(b => {
        b.className = 'w-8 h-8 rounded-md font-bold text-xs transition-all text-slate-400 hover:bg-white hover:text-slate-600';
    });
    const activeClass = grade === 'A' ? 'bg-green-500 text-white' : (grade === 'B' ? 'bg-blue-500 text-white' : 'bg-orange-500 text-white');
    btn.className = `w-8 h-8 rounded-md font-bold text-xs transition-all ${activeClass} shadow-md scale-105`;
    
    const { error } = await supabase.from('task_evidences').update({ grade_letter: grade, status: 'graded' }).eq('id', evidenceId);
    if(error) {
        Helpers.toast('Error al guardar calificación', 'error');
        return;
    }
    Helpers.toast(`Calificado con ${grade}`);

    // Notificar al padre sobre la calificación
    try {
      const { data: evidence } = await supabase
        .from('task_evidences')
        .select('student:students(parent_id, name), task:tasks(title)')
        .eq('id', evidenceId)
        .single();
      
      if (evidence?.student?.parent_id) {
        await window.sendPush({
          user_id: evidence.student.parent_id,
          title: 'Tarea Calificada ⭐',
          message: `La tarea "${evidence.task.title}" de ${evidence.student.name} ha sido calificada con "${grade}".`,
          type: 'info',
          link: '/panel_padres.html#tasks'
        });
      }
    } catch (e) { console.error('Error notificando calificación:', e); }
  },

  async gradeStars(evidenceId, stars, btn) {
    const parent = btn.parentElement;
    Array.from(parent.children).forEach((b, idx) => {
      const isActive = idx < stars;
      b.querySelector('i').className = `w-5 h-5 ${isActive ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200 fill-slate-100'}`;
    });
    const { error } = await supabase.from('task_evidences').update({ stars: stars, status: 'graded' }).eq('id', evidenceId);
    if(!error) Helpers.toast(`${stars} estrella(s) asignadas`);
  },

  // 5. NUEVA FUNCIÓN: Galería del Día
  async renderGallery() {
      const tab = document.getElementById('tab-gallery');
      const grid = document.getElementById('galleryGrid');
      
      if (!AppState.currentClass?.id) {
          if(grid) grid.innerHTML = Helpers.emptyState('Seleccione una clase primero');
          return;
      }
      
      if(grid) grid.innerHTML = Helpers.skeleton(4, 'h-48');

      const today = new Date().toISOString().split('T')[0];

      // Fetch gallery items
      const { data: photos, error } = await supabase
          .from('classroom_gallery')
          .select('*')
          .eq('classroom_id', AppState.currentClass.id)
          .eq('date', today)
          .order('created_at', { ascending: false });

      if (error) {
          console.error(error);
          if(grid) grid.innerHTML = Helpers.emptyState('Error cargando galería', 'alert-circle');
          return;
      }

      if (!photos || photos.length === 0) {
          if(grid) grid.innerHTML = `<div class="col-span-full">${Helpers.emptyState('No hay fotos hoy. ¡Sube algunas!', 'camera')}</div>`;
          return;
      }

      if(grid) {
          grid.innerHTML = photos.map(p => `
            <div class="group relative aspect-square bg-slate-100 rounded-xl overflow-hidden shadow-sm border border-slate-100">
                <img src="${p.image_url}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy">
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors"></div>
            </div>
          `).join('');
      }
      
      if(window.lucide) lucide.createIcons();
  },

  async handleGalleryUpload(files) {
      if (!files || files.length === 0) return;
      if (!AppState.currentClass?.id) { Helpers.toast('Selecciona una clase', 'error'); return; }

      Helpers.toast(`Subiendo ${files.length} foto(s)...`, 'info');
      const today = new Date().toISOString().split('T')[0];
      let uploadedCount = 0;

      for (const file of files) {
          try {
              const fileExt = file.name.split('.').pop();
              const fileName = `gallery/${AppState.currentClass.id}/${today}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

              const { error: upErr } = await supabase.storage.from('classroom_media').upload(fileName, file);
              if (upErr) throw upErr;

              const pub = supabase.storage.from('classroom_media').getPublicUrl(fileName);
              const publicUrl = pub.data?.publicUrl;
              if (!publicUrl) throw new Error('No se pudo obtener URL pública');

              await supabase.from('classroom_gallery').insert({
                  classroom_id: AppState.currentClass.id,
                  date: today,
                  image_url: publicUrl,
                  caption: ''
              });
              uploadedCount++;
          } catch (e) {
              console.error('Error subiendo foto:', e);
          }
      }

      Helpers.toast(`${uploadedCount} fotos subidas correctamente`, 'success');
      this.renderGallery(); // Recargar grid
      document.getElementById('galleryUploadInput').value = ''; // Limpiar input
  },

  // --- STUDENT PROFILE MODAL ---
  async openStudentProfile(studentId) {
    const modal = document.getElementById('studentProfileModal');
    if(!modal) return;
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('no-scroll');
    document.getElementById('closeStudentProfileModal')?.focus(); // Accessibility: Focus Management
    
    // Store ID for incident reporting
    document.getElementById('incidentStudentId').value = studentId;

    // Reset fields
    const ids = ['studentProfileName', 'studentDOB', 'studentClassroom', 'studentAllergies',
      'parent1Name', 'parent1Phone', 'parent1Email', 'parent2Name', 'parent2Phone',
      'studentBlood', 'studentPickup'];
    ids.forEach(id => {
         const el = document.getElementById(id);
         if(el) el.textContent = 'Cargando...';
    });

    try {
        // Query for student, their classroom, and their main parent contact
        const { data: student, error } = await supabase
          .from('students')
          .select(`
            *,
            classrooms(name),
            parent:parent_id(name, phone, email)
          `)
          .eq('id', studentId)
          .single();
          
        if(error) throw error;
        
        const setText = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val || '-'; };
        
        // Student Info
        setText('studentProfileName', student.name);
        setText('studentDOB', student.birth_date ? Helpers.formatDate(student.birth_date) : '-');
        setText('studentClassroom', student.classrooms?.name || AppState.currentClass?.name || 'Sin aula');
        
        // Medical & Auth
        setText('studentBlood', student.blood_type);
        setText('studentAllergies', student.allergies);
        setText('studentPickup', student.authorized_pickup);
        
        // Parent 1 (from relation if exists, fallback to p1_ fields)
        if (student.parent) {
            setText('parent1Name', student.parent.name);
            setText('parent1Phone', student.parent.phone);
            setText('parent1Email', student.parent.email);
        } else {
            setText('parent1Name', student.p1_name);
            setText('parent1Phone', student.p1_phone);
            setText('parent1Email', student.p1_email);
        }

        // Parent 2 (from p2_ fields)
        setText('parent2Name', student.p2_name);
        setText('parent2Phone', student.p2_phone);

    } catch (e) {
        Helpers.toast('Error cargando perfil', 'error');
        console.error(e);
        // Set fields to error state
        ids.forEach(id => {
            const el = document.getElementById(id);
            if(el) el.textContent = 'Error';
        });
    }
  },

  // 6. FUNCIÓN CRÍTICA: Registro de Incidentes
  openIncidentModal() {
      const modal = document.getElementById('incidentModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
  },

  async saveIncident() {
      if (!AppState.user?.id) {
          Helpers.toast('Sesión inválida', 'error');
          return;
      }
      const studentId = document.getElementById('incidentStudentId').value;
      const severity = document.getElementById('incidentSeverity').value;
      const desc = document.getElementById('incidentDesc').value;
      
      if(!desc) { Helpers.toast('Descripción requerida', 'error'); return; }

      const { error } = await supabase.from('incidents').insert({
          student_id: studentId,
          classroom_id: AppState.currentClass.id,
          severity,
          description: desc,
          reported_at: new Date().toISOString(),
          teacher_id: AppState.user.id // 8. Seguridad: Validar ownership
      });

      if(error) {
          Helpers.toast('Error al registrar', 'error');
      } else {
          Helpers.toast('Incidente registrado', 'success');

          // Notificar a la directora y asistentes
          try {
            const { data: staff } = await supabase
              .from('profiles')
              .select('id')
              .in('role', ['directora', 'asistente']);
            
            const { data: student } = await supabase.from('students').select('name').eq('id', studentId).single();
            
            for (const s of (staff || [])) {
              await window.sendPush({
                user_id: s.id,
                title: 'Nuevo Incidente Reportado ⚠️',
                message: `Se ha registrado un incidente de nivel "${severity}" para ${student?.name || 'un estudiante'}.`,
                type: 'alert',
                link: '/panel_directora.html#reportes'
              });
            }
          } catch (e) { console.error('Error notificando incidente:', e); }

          document.getElementById('incidentModal').classList.add('hidden');
          document.getElementById('incidentModal').classList.remove('flex');
          document.getElementById('incidentDesc').value = '';
      }
  },

  // 7. VIDEO CALL (Jitsi)
  async initVideoCall() {
    const container = document.getElementById('meet');
    if (!container) return;
    container.innerHTML = ''; // Clear previous instance

    if (typeof JitsiMeetExternalAPI === 'undefined') {
      container.innerHTML = Helpers.emptyState('Error cargando sistema de video', 'video-off');
      return;
    }

    // Pre-verificación de permisos para evitar errores en consola y UI rota
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach(track => track.stop()); // Cerrar stream inmediatamente, solo era prueba
    } catch (err) {
      console.warn('Permisos de medios denegados:', err);
      container.innerHTML = Helpers.emptyState(
        'No se pudo acceder a la cámara o micrófono. Por favor, permite el acceso en tu navegador.', 
        'camera-off'
      );
      return;
    }

    // 1. Marcar clase como EN VIVO
    supabase.from('classrooms').update({ is_live: true }).eq('id', AppState.currentClass.id).then();

    if (window.jitsiInstance) window.jitsiInstance.dispose();

    // 2. Construir Layout (Video + Chat)
    container.innerHTML = `
      <div class="flex flex-col lg:flex-row gap-4 h-[600px]">
         <div id="jitsi-container" class="flex-1 bg-black rounded-xl overflow-hidden shadow-inner"></div>
         
         <div class="w-full lg:w-80 bg-white border border-slate-200 rounded-xl flex flex-col shadow-sm">
            <div class="p-3 border-b bg-slate-50 rounded-t-xl flex justify-between items-center">
              <span class="font-bold text-slate-700 text-sm">Chat de Clase</span>
              <span class="flex h-2 w-2 relative">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
            </div>
            <div id="chat-messages" class="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50/50">
               <div class="text-center text-xs text-slate-400 mt-4">Iniciando chat...</div>
            </div>
            <div class="p-2 border-t bg-white rounded-b-xl flex gap-2">
               <input id="chat-input" class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 outline-none" placeholder="Escribe un mensaje..." autocomplete="off">
               <button id="chat-send" class="bg-orange-600 hover:bg-orange-700 text-white rounded-lg p-2 transition-colors"><i data-lucide="send" class="w-4 h-4"></i></button>
            </div>
         </div>
      </div>
      <div class="mt-4 flex justify-end">
         <button id="btnEndClass" class="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-xl font-bold shadow-lg shadow-red-200 transition flex items-center gap-2">
            <i data-lucide="phone-off" class="w-4 h-4"></i> Terminar Clase
         </button>
      </div>
    `;
    if(window.lucide) lucide.createIcons();

    // 3. Iniciar Jitsi
    const domain = "meet.jit.si";
    const options = {
      roomName: "KarpusKids_" + (AppState.currentClass?.id || 'General'),
      width: "100%",
      height: "100%",
      parentNode: document.getElementById('jitsi-container'),
      lang: 'es',
      userInfo: {
        displayName: AppState.profile?.name || 'Maestra'
      }
    };
    window.jitsiInstance = new JitsiMeetExternalAPI(domain, options);

    // 4. Lógica del Chat
    this.initChatLogic(AppState.currentClass.id);

    // 5. Botón Terminar
    document.getElementById('btnEndClass').onclick = async () => {
        if(confirm('¿Finalizar la clase en vivo?')) {
            await supabase.from('classrooms').update({ is_live: false }).eq('id', AppState.currentClass.id);
            if (window.jitsiInstance) window.jitsiInstance.dispose();
            container.innerHTML = Helpers.emptyState('Clase finalizada', 'video-off');
        }
    };
  },

  async initChatLogic(classroomId) {
      const chatContainer = document.getElementById('chat-messages');
      const input = document.getElementById('chat-input');
      const btn = document.getElementById('chat-send');
      
      // Cargar mensajes previos
      const { data: msgs } = await supabase
          .from('classroom_chat')
          .select('message, created_at, profiles(name)')
          .eq('classroom_id', classroomId)
          .order('created_at', { ascending: false })
          .limit(50);
      
      chatContainer.innerHTML = '';
      (msgs || []).reverse().forEach(m => appendMessage(m));
      scrollToBottom();

      // Suscripción Realtime
      const channel = supabase.channel('room_chat_' + classroomId)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'classroom_chat', filter: `classroom_id=eq.${classroomId}` }, async (payload) => {
              const { data: user } = await supabase.from('profiles').select('name').eq('id', payload.new.user_id).single();
              appendMessage({ ...payload.new, profiles: user });
              scrollToBottom();
          })
          .subscribe();

      // Enviar mensaje
      const sendMessage = async () => {
          const text = input.value.trim();
          if(!text) return;
          input.value = '';
          await supabase.from('classroom_chat').insert({ classroom_id: classroomId, user_id: AppState.user.id, message: text });
      };

      btn.onclick = sendMessage;
      input.onkeypress = (e) => { if(e.key === 'Enter') sendMessage(); };

      function appendMessage(m) {
          const isMe = m.user_id === AppState.user.id; // Note: user_id might not be in payload.new directly if not selected, but for local echo logic or fetch it works.
          const name = m.profiles?.name || 'Usuario';
          const time = new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
          
          chatContainer.innerHTML += `
              <div class="flex flex-col mb-2 ${name === (AppState.profile?.name) ? 'items-end' : 'items-start'}">
                  <div class="text-[10px] text-slate-400 mb-0.5 px-1">${name} • ${time}</div>
                  <div class="px-3 py-2 rounded-xl text-sm max-w-[85%] ${name === (AppState.profile?.name) ? 'bg-orange-100 text-orange-900 rounded-tr-none' : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none shadow-sm'}">
                      ${Helpers.escapeHTML(m.message)}
                  </div>
              </div>
          `;
      }
      function scrollToBottom() { chatContainer.scrollTop = chatContainer.scrollHeight; }
  },

  // 9. PERFIL DOCENTE
  async renderProfile() {
      const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', AppState.user.id).single();
      if(error) { console.error(error); return; }
      
      AppState.profile = profile; // Update state
      
      const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };
      
      setVal('profName', profile.name);
      setVal('profPhone', profile.phone);
      setVal('profEmail', profile.email);
      setVal('profBio', profile.bio || profile.notes); // Fallback to notes if bio empty
      
      const avatarEl = document.getElementById('profileAvatar');
      if(avatarEl && profile.avatar_url) avatarEl.src = profile.avatar_url;
      
      this.updateUserProfileUI();
  },

  async saveProfile(e) {
      e.preventDefault();
      const btn = document.getElementById('btnSaveProfile');
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="animate-spin"></i> Guardando...';
      if(window.lucide) lucide.createIcons();

      const updates = {
          name: document.getElementById('profName').value,
          phone: document.getElementById('profPhone').value,
          bio: document.getElementById('profBio').value,
          // updated_at: new Date().toISOString() // Supabase handles this usually, or add if column exists
      };

      const { error } = await supabase.from('profiles').update(updates).eq('id', AppState.user.id);

      if(error) {
          Helpers.toast('Error al guardar perfil', 'error');
      } else {
          Helpers.toast('Perfil actualizado', 'success');
          AppState.profile = { ...AppState.profile, ...updates };
          this.updateUserProfileUI();
      }
      
      btn.disabled = false;
      btn.innerHTML = originalText;
      if(window.lucide) lucide.createIcons();
  },

  async handleAvatarUpload(file) {
      if(!file) return;
      
      Helpers.toast('Subiendo imagen...', 'info');
      
      try {
          const fileExt = file.name.split('.').pop();
          const fileName = `avatars/${AppState.user.id}_${Date.now()}.${fileExt}`;
          
          const { error: upErr } = await supabase.storage.from('classroom_media').upload(fileName, file);
          if(upErr) throw upErr;
          
          const { data: { publicUrl } } = supabase.storage.from('classroom_media').getPublicUrl(fileName);
          
          const { error: updateErr } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', AppState.user.id);
          if(updateErr) throw updateErr;
          
          document.getElementById('profileAvatar').src = publicUrl;
          AppState.profile.avatar_url = publicUrl;
          this.updateUserProfileUI();
          Helpers.toast('Avatar actualizado', 'success');
          
      } catch(e) {
          console.error(e);
          Helpers.toast('Error al subir imagen', 'error');
      }
  },

  // 8. NOTIFICACIONES PUSH (REALTIME)
  initNotifications() {
    if (!("Notification" in window)) return;

    // Solicitar permiso si no se tiene
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }

    // Suscribirse a eventos relevantes (ej: nuevos mensajes, incidentes críticos)
    const channel = supabase.channel('teacher_notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'classroom_chat' },
        (payload) => {
          // Solo notificar si no es mi propio mensaje
          if (payload.new.user_id !== AppState.user?.id) {
             this.showBrowserNotification('Nuevo mensaje en el aula', payload.new.message);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'incidents' },
        (payload) => {
           this.showBrowserNotification('Nuevo Incidente Registrado', payload.new.description);
        }
      )
      .subscribe();
  },

  showBrowserNotification(title, body) {
    if (Notification.permission === "granted") {
      new Notification("Karpus Kids - Maestra", {
        body: body,
        icon: 'logo/favicon.ico',
        vibrate: [200, 100, 200]
      });
    } else {
      Helpers.toast(title, 'info'); // Fallback a toast
    }
  }
};

// Expose UI to window for inline onclicks (backward compatibility or specific generated HTML)
window.UI = UI;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    try { initOneSignal(); } catch(e) {}
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
