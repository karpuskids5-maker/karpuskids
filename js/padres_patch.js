import { supabase } from './supabase.js';

// --- 1. HELPERS & UTILS ---
const Helpers = {
  toast(msg, type = 'success') {
    const t = document.createElement('div');
    const colorClass = type === 'success' ? 'bg-green-500' : (type === 'error' ? 'bg-red-500' : 'bg-blue-500');
    t.className = `toast-notification ${colorClass} fixed bottom-6 right-6 text-white px-4 py-2 rounded-xl shadow-lg z-50 transition-all duration-300`;
    t.textContent = msg;
    document.body.appendChild(t);
    
    // Animation
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

  skeleton(count = 3, height = 'h-16') {
    return Array(count).fill(0).map(() => `
      <div class="animate-pulse bg-slate-100 rounded-xl ${height} w-full mb-2"></div>
    `).join('');
  },

  formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
  },

  validateImage(file) {
    if (!file) return { valid: false, msg: 'No se seleccionó archivo' };
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) return { valid: false, msg: 'Formato no soportado. Usa JPG, PNG o WebP' };
    if (file.size > 5 * 1024 * 1024) return { valid: false, msg: 'El archivo excede 5MB' };
    return { valid: true };
  },

  renderDonutChart(containerId, percent, colorClass = 'text-karpus-primary') {
    const container = document.getElementById(containerId);
    if (!container) return;
    const size = 120;
    const strokeWidth = 12;
    const radius = (size / 2) - (strokeWidth * 2);
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100 * circumference);

    container.innerHTML = `
      <svg class="w-32 h-32" viewBox="0 0 ${size} ${size}">
        <circle class="text-slate-200" stroke-width="${strokeWidth}" stroke="currentColor" fill="transparent" r="${radius}" cx="${size/2}" cy="${size/2}"/>
        <circle class="${colorClass}" stroke-width="${strokeWidth}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" stroke="currentColor" fill="transparent" r="${radius}" cx="${size/2}" cy="${size/2}" style="transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset 0.5s ease;"/>
        <text x="50%" y="50%" text-anchor="middle" dy=".3em" class="text-2xl font-bold text-slate-800">${percent}%</text>
      </svg>
    `;
  }
};

// --- 2. APP STATE ---
const AppState = {
  user: null,
  profile: null,
  students: [],
  currentStudent: null,
  currentSection: 'home',
  currentDate: new Date()
};

// --- 3. UI CONTROLLER ---
const UI = {
  async init() {
    this.bindEvents();
    await this.checkSession();
  },

  async checkSession() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    AppState.user = user;

    // Load Profile
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    AppState.profile = profile;

    // Load Students linked to parent
    const { data: students } = await supabase.from('students').select('*, classrooms(name)').eq('parent_id', user.id);
    AppState.students = students || [];
    if (AppState.students.length > 0) {
        AppState.currentStudent = AppState.students[0]; // Default to first student
    }

    this.updateUserUI();
    this.loadDashboard();
    
    // Subscribe to global user notifications
    this.subscribeToNotifications();
    
    // Initial tab
    this.showSection('home');
  },

  subscribeToNotifications() {
    if (!AppState.user) return;
    try {
      if (this.notificationsSubscription) {
        supabase.removeChannel(this.notificationsSubscription);
        this.notificationsSubscription = null;
      }
      this.notificationsSubscription = supabase
        .channel('public:notifications')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${AppState.user.id}`
        }, payload => {
          Helpers.toast('Nueva notificación', 'info');
          this.loadNotifications();
        })
        .subscribe();
    } catch (e) {
      console.error('Error suscribiendo a notificaciones', e);
    }
  },

  updateUserUI() {
    const userName = AppState.profile?.name || 'Padre/Madre';
    const studentName = AppState.currentStudent?.name || 'Sin estudiante asignado';
    const classroomName = AppState.currentStudent?.classrooms?.name || 'Sin aula';

    // Sidebar & Mobile Header
    const setText = (id, text) => { const el = document.getElementById(id); if(el) el.textContent = text; };
    
    setText('sidebar-role-label', 'Padre / Tutor');
    setText('sidebar-student-name', studentName);
    setText('mobile-student-name', studentName);
    setText('dropdown-role', 'Padre / Tutor');
    setText('dropdown-student', studentName);
    setText('dash-student-name', studentName);
    setText('dash-guardian-name', userName);
    setText('dash-classroom', classroomName);
    setText('currentDateDisplay', new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
    
    // Avatar logic could go here if we had avatars in DB
  },

  bindEvents() {
    // Navigation
    document.querySelectorAll('[data-section]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const sectionId = btn.dataset.section;
        this.showSection(sectionId);
        
        // Update Sidebar Active State
        document.querySelectorAll('.sidebar-btn').forEach(b => {
             b.classList.remove('bg-karpus-blue/10', 'text-karpus-blue'); // Simplified active state class logic
             if(b.dataset.section === sectionId) b.classList.add('bg-karpus-blue/10', 'text-karpus-blue');
        });
      });
    });

    // Mobile Menu
    const menuBtn = document.getElementById('menuBtn');
    const sidebar = document.getElementById('sidebar');
    if (menuBtn && sidebar) {
        menuBtn.addEventListener('click', () => {
            sidebar.classList.toggle('hidden');
            sidebar.classList.toggle('flex'); // Ensure flex is toggled for layout
            // Add overlay if needed, or simple toggle for now
        });
    }

    // Task Filters
    document.querySelectorAll('.task-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.task-filter-btn').forEach(b => b.classList.remove('active', 'bg-slate-800', 'text-white'));
            document.querySelectorAll('.task-filter-btn').forEach(b => b.classList.add('bg-slate-100', 'text-slate-600'));
            
            e.target.classList.remove('bg-slate-100', 'text-slate-600');
            e.target.classList.add('active', 'bg-slate-800', 'text-white');
            
            this.loadTasks(e.target.dataset.filter);
        });
    });
    
    // Calendar Navigation
    document.getElementById('calPrevBtn')?.addEventListener('click', () => {
        AppState.currentDate.setMonth(AppState.currentDate.getMonth() - 1);
        this.renderCalendar();
    });
    document.getElementById('calNextBtn')?.addEventListener('click', () => {
        AppState.currentDate.setMonth(AppState.currentDate.getMonth() + 1);
        this.renderCalendar();
    });
  },

  showSection(id) {
    AppState.currentSection = id;
    
    // Hide all sections
    document.querySelectorAll('.section').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none'; // Ensure hidden
    });

    // Show target section
    const target = document.getElementById(`tab-${id}`);
    if (target) {
        target.classList.add('active');
        target.style.display = 'block'; // Ensure visible for animation
        
        // Trigger data load
        if (id === 'home') this.loadDashboard();
        if (id === 'live-attendance') this.loadAttendance();
        if (id === 'tasks') this.loadTasks();
        if (id === 'class') this.loadClassFeed();
        if (id === 'grades') this.loadGrades();
        if (id === 'notifications') this.loadNotifications();
        if (id === 'profile') this.loadProfile();
    }
  },

  // --- NOTIFICATIONS ---
  async loadNotifications() {
      const list = document.getElementById('systemNotificationsList');
      if(!list || !AppState.user) return;
      
      list.innerHTML = Helpers.skeleton(2, 'h-16');
      
      const { data: notifs, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', AppState.user.id)
          .order('created_at', { ascending: false })
          .limit(20);

      if(error) {
          console.error(error);
          list.innerHTML = Helpers.emptyState('Error al cargar notificaciones', 'alert-circle');
          return;
      }
      
      if(!notifs || !notifs.length) {
          list.innerHTML = Helpers.emptyState('No tienes notificaciones nuevas', 'bell-off');
          return;
      }
      
      list.innerHTML = notifs.map(n => `
          <div class="flex gap-3 items-start bg-slate-50 p-3 rounded-xl border border-slate-100 ${n.is_read ? 'opacity-60' : 'bg-white shadow-sm border-blue-100'}">
              <div class="p-2 rounded-full ${n.type === 'alert' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}">
                  <i data-lucide="${n.type === 'alert' ? 'alert-triangle' : 'info'}" class="w-4 h-4"></i>
              </div>
              <div class="flex-1">
                  <div class="flex justify-between items-start">
                      <h4 class="text-sm font-bold text-slate-800">${n.title}</h4>
                      <span class="text-[10px] text-slate-400">${Helpers.formatDate(n.created_at)}</span>
                  </div>
                  <p class="text-xs text-slate-600 mt-1">${n.message}</p>
              </div>
          </div>
      `).join('');
      
      if(window.lucide) lucide.createIcons();
      
      // Mark as read (simplified batch update)
      const unreadIds = notifs.filter(n => !n.is_read).map(n => n.id);
      if(unreadIds.length > 0) {
          await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds);
      }
  },

  // --- DASHBOARD ---
  async loadDashboard() {
    if (!AppState.currentStudent) return;

    try {
        const { data: attendance = [] } = await supabase
            .from('attendance')
            .select('status')
            .eq('student_id', AppState.currentStudent.id);
        
        const total = attendance.length;
        const present = attendance.filter(a => a.status === 'present' || a.status === 'late').length;
        const percent = total ? Math.round((present / total) * 100) : 0;
        const el = document.getElementById('dashAttendance');
        if (el) el.textContent = `${percent}%`;

        // Pending Tasks
        const { count: pendingCount } = await supabase
            .from('tasks') // Assuming a tasks table exists or simplified logic
            .select('*', { count: 'exact', head: true })
            .eq('classroom_id', AppState.currentStudent.classroom_id)
            .eq('status', 'pending');
            // Ideally we check submissions to see if pending. For now just show count of recent tasks?
            // Or better: implement proper task checking.
        
        const elTasks = document.getElementById('dashPendingTasks');
        if(elTasks) elTasks.textContent = pendingCount || 0;

        // Feed / Recent Activity (Simplified)
        this.loadFeedPreview();

    } catch (err) {
        console.error('Dashboard error:', err);
        Helpers.toast('Error cargando dashboard', 'error');
    }
  },

  async loadFeedPreview() {
    const container = document.getElementById('feed');
    if (!container || !AppState.currentStudent) return;

    const { data: posts } = await supabase
        .from('posts')
        .select('*')
        .eq('classroom_id', AppState.currentStudent.classroom_id)
        .order('created_at', { ascending: false })
        .limit(3);
    
    if (!posts || !posts.length) {
        container.innerHTML = Helpers.emptyState('No hay actividad reciente', 'activity');
        return;
    }

    container.innerHTML = posts.map(p => `
        <div class="flex gap-3 items-start border-b pb-3 last:border-0">
            <div class="bg-blue-100 p-2 rounded-full"><i data-lucide="message-square" class="w-4 h-4 text-blue-600"></i></div>
            <div>
                <p class="text-sm font-medium text-slate-800">${p.title || 'Nueva publicación'}</p>
                <p class="text-xs text-slate-500 line-clamp-2">${p.content}</p>
                <span class="text-[10px] text-slate-400">${Helpers.formatDate(p.created_at)}</span>
            </div>
        </div>
    `).join('');
    if(window.lucide) lucide.createIcons();
  },

  // --- ATTENDANCE ---
  async loadAttendance() {
    this.renderCalendar();
    // Update stats logic here if needed
  },

  async renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const label = document.getElementById('calMonthLabel');
    if (!grid || !AppState.currentStudent) return;

    const year = AppState.currentDate.getFullYear();
    const month = AppState.currentDate.getMonth();
    
    label.textContent = AppState.currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    grid.innerHTML = ''; // Clear

    // Get Attendance Data for this month
    const startStr = new Date(year, month, 1).toISOString().split('T')[0];
    const endStr = new Date(year, month + 1, 0).toISOString().split('T')[0];

    const { data: attendance } = await supabase
        .from('attendance')
        .select('date, status')
        .eq('student_id', AppState.currentStudent.id)
        .gte('date', startStr)
        .lte('date', endStr);
    
    const attMap = {};
    attendance?.forEach(a => attMap[a.date] = a.status);

    // Render Grid
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Empty slots
    for (let i = 0; i < firstDay; i++) {
        grid.innerHTML += `<div></div>`;
    }

    // Days
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const status = attMap[dateStr];
        
        let bgClass = 'bg-white hover:bg-slate-50';
        let textClass = 'text-slate-700';
        
        if (status === 'present') { bgClass = 'bg-green-100'; textClass = 'text-green-700 font-bold'; }
        else if (status === 'absent') { bgClass = 'bg-red-100'; textClass = 'text-red-700 font-bold'; }
        else if (status === 'late') { bgClass = 'bg-yellow-100'; textClass = 'text-yellow-700 font-bold'; }
        
        grid.innerHTML += `
            <div class="${bgClass} ${textClass} rounded-lg p-2 text-center text-sm transition-colors flex items-center justify-center aspect-square border border-slate-50">
                ${d}
            </div>
        `;
    }
  },

  // --- TASKS ---
  async loadTasks(filter = 'all') {
    const list = document.getElementById('tasksList');
    if (!list || !AppState.currentStudent) return;

    list.innerHTML = Helpers.skeleton(3, 'h-24');

    let query = supabase
      .from('tasks')
      .select('*')
      .eq('classroom_id', AppState.currentStudent.classroom_id);

    if (filter === 'pending') query = query.eq('status', 'pending');
    if (filter === 'submitted') query = query.eq('status', 'submitted');
    if (filter === 'overdue') query = query.lt('due_date', new Date().toISOString());

    const { data: tasks } = await query.order('due_date');

    if (!tasks?.length) {
      list.innerHTML = Helpers.emptyState('No hay tareas', 'clipboard');
      return;
    }

    list.innerHTML = tasks.map(t => `
      <div class="bg-white p-4 rounded-xl border shadow-sm">
        <h4 class="font-bold">${t.title}</h4>
        <p class="text-sm text-slate-600">${t.description || ''}</p>
      </div>
    `).join('');
  },

  // --- CLASS FEED ---
  async loadClassFeed() {
    const container = document.getElementById('classFeed');
    if (!container || !AppState.currentStudent) return;
    
    // Subscribe to realtime if not already
    this.subscribeToFeed();

    container.innerHTML = Helpers.skeleton(3, 'h-32');

    const { data: posts, error } = await supabase
        .from('posts')
        .select(`
            *,
            profiles:teacher_id(name),
            likes(user_id),
            comments(
                id, content, created_at,
                profiles:user_id(name)
            )
        `)
        .eq('classroom_id', AppState.currentStudent.classroom_id)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error feed:', error);
        container.innerHTML = Helpers.emptyState('Error al cargar publicaciones', 'alert-circle');
        return;
    }

    if (!posts || !posts.length) {
        container.innerHTML = Helpers.emptyState('No hay publicaciones en el muro', 'layout-dashboard');
        return;
    }

    container.innerHTML = posts.map(p => {
        // Ordenar comentarios por fecha (antiguos primero)
        const comments = p.comments || [];
        comments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        const commentsHTML = comments.map(c => `
            <div class="text-sm mb-2 bg-slate-50 p-2 rounded-lg">
                <span class="font-bold text-slate-700 text-xs block">${c.profiles?.name || 'Usuario'}</span>
                <span class="text-slate-600">${c.content}</span>
            </div>
        `).join('');

        // Likes Logic
        const userLiked = p.likes?.some(l => l.user_id === AppState.user.id);
        const likesCount = p.likes?.length || 0;
        const likeIconClass = userLiked ? 'fill-red-500 text-red-500' : 'text-slate-400';

        return `
        <div class="bg-white p-5 rounded-2xl border shadow-sm mb-6">
            <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-bold shadow-sm">
                    ${p.profiles?.name?.charAt(0) || 'M'}
                </div>
                <div>
                    <h4 class="font-bold text-slate-800">${p.profiles?.name || 'Maestra'}</h4>
                    <span class="text-xs text-slate-500">${Helpers.formatDate(p.created_at)}</span>
                </div>
            </div>
            <div class="prose prose-sm text-slate-600 mb-3 whitespace-pre-line">
                ${p.content || ''}
            </div>
            ${p.media_url ? `
                <div class="rounded-xl overflow-hidden border border-slate-100 mb-4">
                    <img src="${p.media_url}" alt="Imagen adjunta" class="w-full h-auto max-h-96 object-cover bg-slate-50" loading="lazy">
                </div>
            ` : ''}
            
            <!-- Actions Bar -->
            <div class="flex items-center gap-4 mb-3 border-t pt-2">
                <button onclick="window.UI.toggleLike('${p.id}')" class="flex items-center gap-1.5 text-sm font-medium hover:bg-slate-50 p-1.5 rounded-lg transition-colors ${userLiked ? 'text-red-600' : 'text-slate-500'}">
                    <i data-lucide="heart" class="w-4 h-4 ${likeIconClass}"></i>
                    <span>${likesCount > 0 ? likesCount : 'Me gusta'}</span>
                </button>
            </div>

            <!-- Comentarios -->
            <div class="bg-slate-50/50 rounded-xl p-3">
                <div class="space-y-2 mb-3 max-h-60 overflow-y-auto">
                    ${commentsHTML}
                </div>
                <div class="flex gap-2 items-center">
                    <input id="comment-input-${p.id}" type="text" placeholder="Escribe un comentario..." 
                        class="flex-1 border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-100 outline-none bg-white focus:bg-white transition-colors"
                        onkeypress="if(event.key === 'Enter') window.UI.submitComment('${p.id}')">
                    <button onclick="window.UI.submitComment('${p.id}')" class="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-sm">
                        <i data-lucide="send" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
        </div>
    `}).join('');
    
    if(window.lucide) lucide.createIcons();
  },

  subscribeToFeed() {
      if (!AppState.currentStudent) return;
      if (this.feedSubscription) {
        supabase.removeChannel(this.feedSubscription);
        this.feedSubscription = null;
      }
      this.feedSubscription = supabase
        .channel('public:posts')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts', filter: `classroom_id=eq.${AppState.currentStudent.classroom_id}` }, payload => {
            Helpers.toast('Nueva publicación en el muro', 'info');
            this.loadClassFeed();
        })
        .subscribe();
  },

  async toggleLike(postId) {
      if (!AppState.user) return;
      
      const { data: existing } = await supabase
          .from('likes')
          .select('id')
          .match({ post_id: postId, user_id: AppState.user.id })
          .single();
      
      if (existing) {
          await supabase.from('likes').delete().match({ id: existing.id });
      } else {
          await supabase.from('likes').insert({ post_id: postId, user_id: AppState.user.id });
      }
      // Reload silently or with minimal disruption? For now, full reload is safest to sync count/state
      this.loadClassFeed();
  },

  async submitComment(postId) {
      const input = document.getElementById(`comment-input-${postId}`);
      if(!input) return;
      
      const content = input.value.trim();
      if(!content) return;
      
      // Bloquear input mientras envía
      input.disabled = true;
      
      const { error } = await supabase.from('comments').insert({
          post_id: postId,
          user_id: AppState.user.id,
          content: content
      });
      
      if(error) {
          console.error('Error posting comment:', error);
          Helpers.toast('Error al enviar comentario', 'error');
          input.disabled = false;
      } else {
          Helpers.toast('Comentario enviado');
          this.loadClassFeed(); // Recargar para ver el nuevo comentario
      }
  },

  // --- GRADES ---
  async loadGrades() {
    const tbody = document.getElementById('gradesTableBody');
    if (!tbody || !AppState.currentStudent) return;

    tbody.innerHTML = `<tr><td colspan="3" class="p-4">${Helpers.skeleton(3, 'h-10')}</td></tr>`;
    
    const { data: grades, error } = await supabase
      .from('grades')
      .select('*')
      .eq('student_id', AppState.currentStudent.id)
      .order('recorded_at', { ascending: false });

    if (error) {
      console.error('Error loading grades:', error);
      tbody.innerHTML = `<tr><td colspan="3">${Helpers.emptyState('No se pudieron cargar las calificaciones.', 'alert-circle')}</td></tr>`;
      return;
    }

    if (!grades || grades.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3">${Helpers.emptyState('Aún no hay calificaciones registradas.', 'bar-chart-2')}</td></tr>`;
      return;
    }

    tbody.innerHTML = grades.map(g => `
      <tr class="hover:bg-slate-50">
        <td class="p-4 font-medium text-slate-800">${g.activity_name}</td>
        <td class="p-4 text-center">
          <span class="px-2 py-1 text-xs rounded-full ${g.grade >= 70 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
            ${g.grade || 'N/A'}
          </span>
        </td>
        <td class="p-4 text-slate-600">${g.observation || 'Sin comentarios'}</td>
      </tr>
    `).join('');
  },
  
  // --- PROFILE ---
  loadProfile() {
      // Use AppState.user and AppState.profile to fill fields
      const p = AppState.profile;
      const s = AppState.currentStudent;
      
      const setText = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt || '-'; };
      
      if(s) {
          setText('profileStudentName', s.name);
          setText('profileStudentId', s.id);
          setText('profileStudentMeta', s.classrooms?.name);
      }
      
      if(p) {
          setText('profileGuardianName', p.name);
          setText('profileGuardianEmail', AppState.user.email);
          setText('profileGuardianPhone', p.phone || 'No registrado');
      }
  }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    UI.init();
});
window.UI = UI; // Exponer UI globalmente para los eventos onclick
