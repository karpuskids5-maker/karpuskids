import { supabase, createClient, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';

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

  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
};

// --- 2. APP STATE ---
const AppState = {
  user: null,
  profile: null,
  currentSection: 'dashboard',
  paymentsData: [] // Almacén local para búsqueda en tiempo real
};

// --- 3. UI CONTROLLER ---
const UI = {
  init() {
    this.bindEvents();
    this.checkSession();
    this.injectChildTheme(); // Inyectar estilos infantiles
  },

  async checkSession() {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('Error de sesión:', authError);
      window.location.href = 'login.html';
      return;
    }
    AppState.user = user;

    // Load Profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role, name, email')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) console.error('Error cargando perfil:', profileError);

    const role = profile?.role?.toLowerCase();
    if (!profile || (role !== 'asistente' && role !== 'directora')) {
      console.warn('Rol incorrecto o perfil no encontrado:', profile);
      Helpers.toast('Acceso denegado: Rol no autorizado (' + (profile?.role || 'sin rol') + ')', 'error');
      setTimeout(async () => {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
      }, 2000);
      return;
    }

    AppState.profile = profile;
    this.updateUserUI();
    try { const mod = await import('./supabase.js'); mod.subscribeNotifications((n)=>{ try { Helpers.toast(n.title+': '+n.message); } catch(e){} }); } catch(e){}

    // Initial Load
    this.loadDashboardStats();
    
    // Check if URL hash has a section
    // Optional: could add hash routing here
  },

  updateUserUI() {
    const name = AppState.profile?.name || 'Asistente';
    const sideEl = document.getElementById('sidebarUserName');
    if (sideEl) sideEl.textContent = name;
    const welcome = document.getElementById('welcomeName');
    if(welcome) welcome.textContent = name.split(' ')[0];
  },

  bindEvents() {
    // Navigation
    document.querySelectorAll('[data-section]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const sectionId = btn.dataset.section;
        this.showSection(sectionId);
        
        // Update Sidebar Active State
        document.querySelectorAll('[data-section]').forEach(b => b.classList.remove('bg-white/20', 'active'));
        btn.classList.add('bg-white/20', 'active');
        
        // Ocultar botón de accesos si existe en el DOM
        const accessBtn = document.querySelector('[data-section="accesos"]');
        if(accessBtn) accessBtn.style.display = 'none';
      });
    });

    // Sidebar Toggle
    const toggleBtn = document.getElementById('toggleSidebar');
    if(toggleBtn) {
        toggleBtn.addEventListener('click', () => this.toggleSidebar());
    }
    
    // Mobile Menu
    const menuBtn = document.getElementById('menuBtn');
    if(menuBtn) {
        menuBtn.addEventListener('click', () => {
             const sidebar = document.getElementById('sidebar');
             sidebar.classList.toggle('show');
        });
    }

    // Logout
    document.getElementById('btnLogout')?.addEventListener('click', async () => {
      await supabase.auth.signOut();
      window.location.href = 'login.html';
    });

    // --- Search Logic (Students) ---
    const searchInput = document.getElementById('searchStudentInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.loadStudents(e.target.value);
      });
    }

    // --- Teacher Management ---
    document.getElementById('searchTeacherInput')?.addEventListener('input', (e) => this.loadTeachers(e.target.value));
    document.getElementById('btnAddTeacher')?.addEventListener('click', () => this.openTeacherModal());
    document.getElementById('btnCancelTeacher')?.addEventListener('click', () => this.closeTeacherModal());
    document.getElementById('btnCancelTeacherFooter')?.addEventListener('click', () => this.closeTeacherModal());
    document.getElementById('btnSaveTeacher')?.addEventListener('click', () => this.saveTeacher());


    // --- Quick Actions (Dashboard) ---
    document.getElementById('btnQuickStudents')?.addEventListener('click', () => {
        document.querySelector('[data-section="estudiantes"]')?.click();
    });
    document.getElementById('btnQuickPayments')?.addEventListener('click', () => {
        document.querySelector('[data-section="pagos"]')?.click();
    });
    
    // --- Add Student Logic ---
    document.getElementById('btnAddStudent')?.addEventListener('click', () => this.openAddStudentModal());
    document.getElementById('btnCancelStudent')?.addEventListener('click', () => this.closeAddStudentModal());
    document.getElementById('btnCancelStudentFooter')?.addEventListener('click', () => this.closeAddStudentModal());
    document.getElementById('btnSaveStudent')?.addEventListener('click', () => this.saveStudent());

    // --- Teacher Management ---
    document.getElementById('searchTeacherInput')?.addEventListener('input', (e) => this.loadTeachers(e.target.value));
    document.getElementById('btnAddTeacher')?.addEventListener('click', () => this.openTeacherModal());
    document.getElementById('btnCancelTeacher')?.addEventListener('click', () => this.closeTeacherModal());
    document.getElementById('btnCancelTeacherFooter')?.addEventListener('click', () => this.closeTeacherModal());
    document.getElementById('btnSaveTeacher')?.addEventListener('click', () => this.saveTeacher());

    // --- Search Payments ---
    document.getElementById('searchPaymentInput')?.addEventListener('input', (e) => {
      this.filterPayments(e.target.value);
    });

    // --- Payment Modal ---
    document.getElementById('btnNewPayment')?.addEventListener('click', () => this.openPaymentModal());
    document.getElementById('closePaymentModal')?.addEventListener('click', () => this.closePaymentModal());
    document.getElementById('cancelPayment')?.addEventListener('click', () => this.closePaymentModal());
    document.getElementById('btnExportPayments')?.addEventListener('click', () => this.exportPaymentsToCSV());
    
    const paymentForm = document.getElementById('paymentForm');
    if (paymentForm) {
      paymentForm.addEventListener('submit', (e) => this.handlePaymentSubmit(e));
    }

    // --- Reminder Logic ---
    document.getElementById('btnSaveReminder')?.addEventListener('click', () => this.saveReminder());
    document.getElementById('btnSendReminders')?.addEventListener('click', () => this.sendRemindersNow());

    // --- Attendance Modal ---
    document.getElementById('closeAttendanceModal')?.addEventListener('click', () => {
        const m = document.getElementById('attendanceModal');
        if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    });

    // Global Delegated Events (for dynamic content)
    document.addEventListener('click', (e) => {
        // Delete Payment
        if (e.target.closest('.btn-delete-payment')) {
            const btn = e.target.closest('.btn-delete-payment');
            this.deletePayment(btn.dataset.id);
        }
        // Attendance Detail
        if (e.target.closest('.child-card')) {
            const card = e.target.closest('.child-card');
            this.openAttendanceDetail(card.dataset.id, card.dataset.name);
        }
        // Edit Student
        if (e.target.closest('.btn-edit-student')) {
            const btn = e.target.closest('.btn-edit-student');
            this.openEditStudentModal(btn.dataset.id);
        }
        // Edit Teacher
        if (e.target.closest('.btn-edit-teacher')) {
            const btn = e.target.closest('.btn-edit-teacher');
            this.openTeacherModal(btn.dataset.id);
        }
    });
  },

  showSection(id) {
    AppState.currentSection = id;
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) {
      target.classList.add('active');
      document.getElementById('sidebar')?.classList.remove('show');
      if (id === 'estudiantes') this.loadStudents();
      if (id === 'asistencia') this.loadAttendanceRooms();
      if (id === 'maestros') this.loadTeachers();
      if (id === 'pagos') { this.loadPayments(); this.loadPaymentReports(); this.loadReminderConfig(); }
    }
  },

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const shell = document.getElementById('layoutShell');
    const btn = document.getElementById('toggleSidebar');
    const collapsed = sidebar.classList.toggle('collapsed');
    shell.classList.toggle('sidebar-collapsed', collapsed);
    btn.innerHTML = `<i data-lucide="${collapsed ? 'chevron-right' : 'chevron-left'}" class="w-4 h-4"></i>`;
    refreshIcons();
  },

  // --- ESTILOS INFANTILES (Inyectados) ---
  injectChildTheme() {
    // Ocultar botón de accesos inmediatamente
    const accessBtn = document.querySelector('[data-section="accesos"]');
    if(accessBtn) accessBtn.style.display = 'none';

    const style = document.createElement('style');
    style.innerHTML = `
      /* Tarjetas Temáticas */
      .child-card { background: white; border-radius: 20px; padding: 1.25rem; position: relative; box-shadow: 0 8px 15px -3px rgba(0,0,0,0.1); transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); border: 2px solid #f0fdf4; border-top-width: 8px; cursor: pointer; }
      .child-card:hover { transform: translateY(-5px) scale(1.02); box-shadow: 0 12px 20px -3px rgba(0,0,0,0.15); }
      
      .child-card.crayon { border-top-color: #ef4444; }
      .child-card.ruler { border-top-color: #eab308; background-image: repeating-linear-gradient(90deg, transparent, transparent 19px, #fefce8 20px); }
      .child-card.notebook { border-top-color: #3b82f6; background-image: linear-gradient(#f0f9ff 1px, transparent 1px); background-size: 100% 24px; }
      .child-card.toy { border-top-color: #22c55e; border-radius: 24px; border-style: dashed; border-width: 2px; border-top-width: 2px; border-color: #22c55e; background-color: #f0fdf4; }
      
      .child-card-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
      .child-card-icon { font-size: 2rem; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.1)); }
      .child-card-body { font-size: 0.95rem; color: #475569; }
    `;
    document.head.appendChild(style);
  },

  // --- DASHBOARD ---
  async loadDashboardStats() {
    try {
      // Students
      const { count: studentsCount } = await supabase.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true);
      const statStudents = document.getElementById('statStudents');
      if(statStudents) statStudents.textContent = studentsCount || 0;

      // Attendance
      const today = new Date().toISOString().split('T')[0];
      const { count: attendanceCount } = await supabase.from('attendance').select('*', { count: 'exact', head: true }).eq('date', today).eq('status', 'present');
      const statAttendance = document.getElementById('statAttendance');
      if(statAttendance) statAttendance.textContent = attendanceCount || 0;

      // Payments (Simulated or Real)
      const statPayments = document.getElementById('statPayments');
      if(statPayments) statPayments.textContent = '0'; // Placeholder

    } catch (error) {
      console.error('Error loading stats:', error);
    }
  },

  // --- STUDENTS ---
  async loadStudents(searchTerm = '') {
    const tbody = document.getElementById('studentsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = `<tr><td colspan="4" class="p-4">${Helpers.skeleton(3, 'h-12')}</td></tr>`;

    try {
      let query = supabase
        .from('students')
        .select('*, classrooms(name), profiles:parent_id(name)')
        .order('name');

      if (searchTerm) {
        query = query.ilike('name', `%${searchTerm}%`);
      }

      const { data: students, error } = await query;
      if (error) throw error;

      if (!students.length) {
        tbody.innerHTML = `<tr><td colspan="4">${Helpers.emptyState('No se encontraron estudiantes.')}</td></tr>`;
        refreshIcons();
        return;
      }

      tbody.innerHTML = students.map(s => `
        <tr class="hover:bg-slate-50 transition-colors border-b last:border-0">
          <td class="px-6 py-4 font-medium text-slate-800 flex items-center gap-3">
            <img 
              src="${s.photo ? './img/students/' + s.photo : './img/mundo.jpg'}" 
              onerror="this.src='./img/mundo.jpg'" 
              class="w-10 h-10 rounded-full object-cover border"
              alt="${s.name}"
            />
            <span>${s.name}</span>
          </td>
          <td class="px-6 py-4 text-slate-600">${s.classrooms?.name || 'Sin aula'}</td>
          <td class="px-6 py-4 text-slate-600">${s.profiles?.name || s.p1_name || '-'}</td>
          <td class="px-6 py-4">
            <span class="px-2 py-1 rounded-full text-xs font-bold ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
              ${s.is_active ? 'Activo' : 'Inactivo'}
            </span>
          </td>
          <td class="px-6 py-4 text-right">
            <button class="btn-edit-student p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" data-id="${s.id}" title="Editar">
              <i data-lucide="edit-2" class="w-4 h-4"></i>
            </button>
          </td>
        </tr>
      `).join('');
      refreshIcons();
    } catch (error) {
      console.error(error);
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-red-500 py-4">Error cargando estudiantes</td></tr>`;
    }
  },

  // --- ADD STUDENT MODAL ---
  async openAddStudentModal() {
    const modal = document.getElementById('modalAddStudent');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Reset for Create Mode
    document.getElementById('stId').value = '';
    document.getElementById('modalStudentTitle').textContent = 'Agregar Estudiante';
    this.loadClassroomsIntoSelect();
  },

  closeAddStudentModal() {
    const modal = document.getElementById('modalAddStudent');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        // Clear fields
        const ids = ['stId', 'stName', 'stAge', 'stSchedule', 'stClassroom', 'p1Name', 'p1Phone', 'p1Email', 'p1Password', 'p2Name', 'p2Phone', 'stAllergies', 'stBlood', 'stPickup'];
        ids.forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
        const ch = document.getElementById('stActive'); if(ch) ch.checked = true;
    }
  },

  async openEditStudentModal(id) {
    const modal = document.getElementById('modalAddStudent');
    if (!modal) return;

    try {
        const { data: s, error } = await supabase.from('students').select('*').eq('id', id).single();
        if (error) throw error;

        // Populate fields
        document.getElementById('stId').value = s.id;
        document.getElementById('stName').value = s.name || '';
        document.getElementById('stAge').value = ''; // Age is not in schema provided, skipping or custom logic
        document.getElementById('stSchedule').value = ''; // Schedule not in schema
        document.getElementById('p1Name').value = s.p1_name || '';
        document.getElementById('p1Phone').value = s.p1_phone || '';
        document.getElementById('p1Email').value = s.p1_email || '';
        document.getElementById('p1Password').value = ''; // Password never shown
        document.getElementById('p2Name').value = s.p2_name || '';
        document.getElementById('p2Phone').value = s.p2_phone || '';
        document.getElementById('stAllergies').value = s.allergies || '';
        document.getElementById('stBlood').value = s.blood_type || '';
        document.getElementById('stPickup').value = s.authorized_pickup || '';
        document.getElementById('stActive').checked = s.is_active;

        document.getElementById('modalStudentTitle').textContent = 'Editar Estudiante';
        
        await this.loadClassroomsIntoSelect();
        document.getElementById('stClassroom').value = s.classroom_id || '';

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    } catch (e) {
        console.error(e);
        Helpers.toast('Error al cargar datos del estudiante', 'error');
    }
  },

  async loadClassroomsIntoSelect() {
    const select = document.getElementById('stClassroom');
    if (!select) return;
    const { data: rooms } = await supabase.from('classrooms').select('id, name').order('name');
    select.innerHTML = '<option value="">-- Seleccionar Aula --</option>' + 
        (rooms || []).map(r => `<option value="${r.id}">${r.name}</option>`).join('');
  },

  async saveStudent() {
    const btn = document.getElementById('btnSaveStudent');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        const id = document.getElementById('stId')?.value;
        const name = document.getElementById('stName')?.value.trim();
        const classroomId = document.getElementById('stClassroom')?.value;
        const isActive = document.getElementById('stActive')?.checked;
        
        // Parent Data
        const p1Name = document.getElementById('p1Name')?.value.trim();
        const p1Phone = document.getElementById('p1Phone')?.value.trim();
        const p1Email = document.getElementById('p1Email')?.value.trim();
        const p1Password = document.getElementById('p1Password')?.value.trim();
        const p2Name = document.getElementById('p2Name')?.value.trim();
        const p2Phone = document.getElementById('p2Phone')?.value.trim();
        
        // Extra Data
        const allergies = document.getElementById('stAllergies')?.value.trim();
        const blood = document.getElementById('stBlood')?.value.trim();
        const pickup = document.getElementById('stPickup')?.value.trim();

        if (!name) throw new Error('El nombre del estudiante es obligatorio');
        if (!classroomId) throw new Error('Debe asignar un aula');

        let parentId = null;

        // 1. Create/Link Parent User
        if (p1Email && !id) { // Only create parent on insert or if logic permits
            if (!Helpers.isValidEmail(p1Email)) throw new Error('Correo electrónico inválido');
            
            // Check existing profile
            const { data: existing } = await supabase.from('profiles').select('id').eq('email', p1Email).maybeSingle();
            
            if (existing) {
                parentId = existing.id;
            } else if (p1Password) {
                // Create new auth user using temp client to avoid logging out assistant
                const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
                });
                const { data: authData, error: authError } = await tempClient.auth.signUp({
                    email: p1Email,
                    password: p1Password
                });
                if (authError) throw authError;
                if (authData.user) {
                    parentId = authData.user.id;
                    // Create profile entry
                    await supabase.from('profiles').insert({
                        id: parentId,
                        email: p1Email,
                        name: p1Name || 'Padre/Madre',
                        phone: p1Phone,
                        role: 'padre'
                    });
                }
            }
        }

        // 2. Prepare Data
        const studentData = {
            name,
            classroom_id: classroomId,
            is_active: isActive,
            parent_id: parentId,
            p1_name: p1Name,
            p1_phone: p1Phone,
            p1_email: p1Email,
            p2_name: p2Name,
            p2_phone: p2Phone,
            allergies: allergies,
            blood_type: blood,
            authorized_pickup: pickup
        };

        let error;
        if (id) {
            // Update
            ({ error } = await supabase.from('students').update(studentData).eq('id', id));
        } else {
            // Insert
            ({ error } = await supabase.from('students').insert(studentData));
        }

        if (error) throw error;

        Helpers.toast(id ? 'Estudiante actualizado' : 'Estudiante creado exitosamente');
        this.closeAddStudentModal();
        this.loadStudents(); // Refresh list

    } catch (e) {
        console.error(e);
        Helpers.toast(e.message || 'Error al guardar', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
  },

  // --- ATTENDANCE ---
  async loadAttendanceRooms() {
    const grid = document.getElementById('attendanceRoomsGrid');
    if (!grid) return;

    grid.innerHTML = Helpers.skeleton(3, 'h-32');

    try {
        const { data: rooms, error: roomError } = await supabase.from('classrooms').select('*').order('name');
        if (roomError) throw roomError;

        const today = new Date().toISOString().split('T')[0];
        const { data: attendance, error: attError } = await supabase
            .from('attendance')
            .select('*')
            .eq('date', today);
        
        if (attError) throw attError;

        const stats = {};
        attendance.forEach(a => {
            if (!stats[a.classroom_id]) stats[a.classroom_id] = { present: 0, absent: 0, late: 0, total: 0 };
            stats[a.classroom_id].total++;
            if (a.status === 'present') stats[a.classroom_id].present++;
            if (a.status === 'absent') stats[a.classroom_id].absent++;
            if (a.status === 'late') stats[a.classroom_id].late++;
        });

        const styles = ['crayon', 'ruler', 'notebook', 'toy'];
        const icons = {'crayon': '🖍️', 'ruler': '📏', 'notebook': '📓', 'toy': '🧸'};

        if (rooms && rooms.length > 0) {
            grid.innerHTML = rooms.map((r, index) => {
                const s = stats[r.id] || { present: 0, absent: 0, late: 0, total: 0 };
                const styleClass = styles[index % styles.length];
                const icon = icons[styleClass];
                
                return `
                <div data-id="${r.id}" data-name="${r.name}" class="child-card ${styleClass}">
                    <div class="child-card-header">
                        <span class="child-card-icon">${icon}</span>
                        <div>
                            <h4 class="font-bold text-slate-700 text-lg">${r.name}</h4>
                            <span class="text-xs font-bold text-slate-400">${Helpers.formatDate(today)}</span>
                        </div>
                    </div>
                    
                    <div class="child-card-body">
                        <div class="flex justify-between items-center bg-white/50 p-2 rounded-lg mb-1">
                            <span class="text-green-600 font-bold">Presentes:</span>
                            <span class="text-xl font-black text-green-700">${s.present}</span>
                        </div>
                        <div class="flex gap-2 text-xs text-slate-500 justify-end">
                            <span>Ausentes: <b>${s.absent}</b></span> • <span>Tardanzas: <b>${s.late}</b></span>
                        </div>
                    </div>
                </div>
                `;
            }).join('');
            refreshIcons();
        } else {
            grid.innerHTML = Helpers.emptyState('No hay aulas registradas.');
        }
    } catch (error) {
        console.error('Error loading attendance rooms:', error);
        grid.innerHTML = Helpers.emptyState('Error al cargar datos.', 'alert-circle');
    }
  },

  async openAttendanceDetail(classroomId, classroomName) {
    const modal = document.getElementById('attendanceModal');
    const title = document.getElementById('attModalTitle');
    const tbody = document.getElementById('attModalBody');
    
    if(!modal || !tbody) return;
    
    title.textContent = `Asistencia - ${classroomName}`;
    tbody.innerHTML = `<tr><td colspan="3" class="p-4">${Helpers.skeleton(5, 'h-10')}</td></tr>`;
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    try {
        const { data: students, error: stError } = await supabase
            .from('students')
            .select('id, name')
            .eq('classroom_id', classroomId)
            .eq('is_active', true)
            .order('name');
            
        if(stError) throw stError;
        
        const today = new Date().toISOString().split('T')[0];
        const { data: attendance, error: attError } = await supabase
            .from('attendance')
            .select('student_id, status, created_at')
            .eq('classroom_id', classroomId)
            .eq('date', today);
            
        if(attError) throw attError;
        
        const attMap = {};
        attendance.forEach(a => attMap[a.student_id] = a);
        
        if(!students.length) {
            tbody.innerHTML = `<tr><td colspan="3">${Helpers.emptyState('No hay estudiantes.')}</td></tr>`;
            return;
        }
        
        tbody.innerHTML = students.map(s => {
            const att = attMap[s.id];
            const status = att ? att.status : 'pending';
            const time = att ? new Date(att.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-';
            
            let statusBadge = '';
            switch(status) {
                case 'present': statusBadge = '<span class="px-2 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">Presente</span>'; break;
                case 'absent': statusBadge = '<span class="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">Ausente</span>'; break;
                case 'late': statusBadge = '<span class="px-2 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700">Tardanza</span>'; break;
                default: statusBadge = '<span class="px-2 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500">Pendiente</span>';
            }
            
            return `
            <tr class="hover:bg-slate-50 transition-colors border-b last:border-0">
                <td class="p-3 font-medium text-slate-800">${s.name}</td>
                <td class="p-3 text-center">${statusBadge}</td>
                <td class="p-3 text-center text-slate-500 text-xs">${time}</td>
            </tr>
            `;
        }).join('');
        
    } catch(error) {
        console.error('Error loading detail:', error);
        Helpers.toast('Error cargando detalles', 'error');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
  },

  // --- PAYMENTS ---
  openPaymentModal() {
    const modal = document.getElementById('paymentModal');
    if(!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    this.loadStudentsIntoSelect();
    const methodSel = document.getElementById('paymentMethod');
    const tf = document.getElementById('transferFields');
    if (methodSel && tf) {
      const update = ()=>{ tf.style.display = methodSel.value === 'transferencia' ? 'block' : 'none'; };
      update();
      methodSel.onchange = update;
    }
  },

  closePaymentModal() {
    const modal = document.getElementById('paymentModal');
    if(modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.getElementById('paymentForm')?.reset();
    }
  },

  async loadStudentsIntoSelect() {
    const select = document.getElementById('studentSelect');
    if (!select) return;
    
    

    const { data: students, error } = await supabase
      .from('students')
      .select('id, name')
      .eq('is_active', true)
      .order('name');

    if (error) {
      Helpers.toast('Error cargando estudiantes', 'error');
      return;
    }

    select.innerHTML = '<option value="" disabled selected>Seleccione un estudiante</option>' +
      students.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  },

  async handlePaymentSubmit(e) {
    e.preventDefault();

    const studentId = document.getElementById('studentSelect').value;
    const amount = document.getElementById('paymentAmount').value;
    const month = document.getElementById('paymentMonth').value;

    const method = (document.getElementById('paymentMethod')?.value || 'transferencia');
    const bank = document.getElementById('paymentBank')?.value || null;
    const reference = document.getElementById('paymentRef')?.value || null;
    const transferDate = document.getElementById('paymentDate')?.value || null;
    const evidence = document.getElementById('paymentEvidence')?.files?.[0] || null;
    if (!studentId || !amount || !month) {
      Helpers.toast('Complete todos los campos', 'error');
      return;
    }

    try {
      let evidenceUrl = null;
      if (method === 'transferencia' && evidence) {
        const safeName = evidence.name.replace(/[^a-zA-Z0-9.]/g, '_');
        const path = `${studentId}_${Date.now()}_${safeName}`;
        const { error: upErr } = await supabase.storage.from('payments_evidence').upload(path, evidence, { upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = await supabase.storage.from('payments_evidence').getPublicUrl(path);
        evidenceUrl = pub?.publicUrl || null;
      }
      const status = method === 'efectivo' ? 'efectivo' : 'pendiente';
      const { error } = await supabase.from('payments').insert({
        student_id: studentId,
        amount: Number(amount),
        month_paid: month,
        method,
        bank,
        reference,
        transfer_date: transferDate,
        evidence_url: evidenceUrl,
        status,
        recorded_by: AppState.user.id
      });

      if (error) throw error;

      Helpers.toast('Pago registrado correctamente');
      this.closePaymentModal();
      this.loadPayments();

    } catch (error) {
      console.error('Error al registrar el pago:', error);
      Helpers.toast('Error al registrar pago', 'error');
    }
  },

  async loadPayments() {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="10" class="p-4">${Helpers.skeleton(3, 'h-12')}</td></tr>`;

    try {
      const { data: payments, error } = await supabase
        .from('payments')
        .select(`
          id,
          amount,
          month_paid,
          created_at,
          method,
          status,
          bank,
          reference,
          transfer_date,
          evidence_url,
          students (
            name,
            parent_id
          )
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      AppState.paymentsData = payments || [];
      this.renderPaymentsTable(AppState.paymentsData);

    } catch (error) {
      console.error(error);
      tbody.innerHTML = `<tr><td colspan="10" class="text-center text-red-500 py-4">Error cargando pagos</td></tr>`;
    }
  },

  renderPaymentsTable(payments) {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;

    if (!payments || payments.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10">${Helpers.emptyState('No hay pagos registrados')}</td></tr>`;
      return;
    }

    const badge = (st) => {
      if (st === 'confirmado') return 'bg-green-100 text-green-700';
      if (st === 'rechazado') return 'bg-red-100 text-red-700';
      if (st === 'efectivo') return 'bg-blue-100 text-blue-700';
      return 'bg-amber-100 text-amber-700';
    };

    tbody.innerHTML = payments.map(p => `
      <tr class="hover:bg-slate-50 border-b">
        <td class="px-4 py-2 font-medium">${p.students?.name || '—'}</td>
        <td class="px-4 py-2">$${p.amount}</td>
        <td class="px-4 py-2">${p.method || '-'}</td>
        <td class="px-4 py-2">
          <span class="px-2 py-1 rounded-full text-xs font-bold ${badge(p.status)}">
            ${p.status}
          </span>
        </td>
        <td class="px-4 py-2">${p.bank || '-'}</td>
        <td class="px-4 py-2">${p.reference || '-'}</td>
        <td class="px-4 py-2">${p.transfer_date || '-'}</td>
        <td class="px-4 py-2">${p.month_paid}</td>
        <td class="px-4 py-2">
          ${p.evidence_url ? `<a href="${p.evidence_url}" target="_blank" class="text-blue-600">Ver</a>` : '-'}
        </td>
        <td class="px-4 py-2 flex gap-2">
          <button class="btn-confirm-payment text-xs bg-green-100 px-2 py-1 rounded" data-id="${p.id}">Confirmar</button>
          <button class="btn-reject-payment text-xs bg-red-100 px-2 py-1 rounded" data-id="${p.id}">Rechazar</button>
          <button class="btn-delete-payment text-red-500" data-id="${p.id}">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </td>
      </tr>
    `).join('');

    refreshIcons();
  },

  filterPayments(term) {
    const lower = term.toLowerCase();

    const filtered = AppState.paymentsData.filter(p =>
      (p.students?.name || '').toLowerCase().includes(lower) ||
      String(p.amount).includes(lower) ||
      (p.reference || '').toLowerCase().includes(lower) ||
      (p.month_paid || '').toLowerCase().includes(lower)
    );
    this.renderPaymentsTable(filtered);
  },

  async saveReminder() {
    const day = Number(document.getElementById('reminderDay')?.value || '0');
    const msg = document.getElementById('reminderMessage')?.value || '';
    if (!day || !msg) { Helpers.toast('Complete recordatorio', 'error'); return; }
    const { error } = await supabase.from('payment_reminders').insert({ day_of_month: day, message: msg, created_by: AppState.user.id });
    if (error) { Helpers.toast('Error guardando', 'error'); return; }
    Helpers.toast('Recordatorio guardado');
  },

  async sendRemindersNow() {
    const month = new Date().toISOString().slice(0,7);
    const { data: students } = await supabase.from('students').select('id, parent_id, name');
    const { data: payments } = await supabase.from('payments').select('student_id, month_paid');
    const paidSet = new Set((payments||[]).filter(p=>p.month_paid===month).map(p=>String(p.student_id)));
    const pendingParents = (students||[]).filter(s=>!paidSet.has(String(s.id)) && s.parent_id);
    for (const s of pendingParents) {
      await supabase.rpc('send_notification', { p_user_id: s.parent_id, p_title: 'Recordatorio de pago', p_message: 'Recuerde enviar su pago mensual', p_type: 'alert', p_link: '/panel_padres.html' });
    }
    Helpers.toast('Recordatorios enviados');
  },

  async deletePayment(id) {
    if (!confirm('¿Está seguro de que desea eliminar este pago?')) return;

    try {
      const { error } = await supabase.from('payments').delete().eq('id', id);
      if (error) throw error;
      Helpers.toast('Pago eliminado');
      this.loadPayments();
    } catch (error) {
      console.error('Error al eliminar:', error);
      Helpers.toast('No se pudo eliminar', 'error');
    }
  },

  exportPaymentsToCSV() {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody || !tbody.querySelector('tr')) {
      Helpers.toast('No hay datos para exportar', 'error');
      return;
    }
    const headers = ['Estudiante','Monto','Metodo','Estado','Banco','Referencia','Fecha','Mes Pagado'];
    const lines = [headers.join(',')];
    tbody.querySelectorAll('tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length >= 8) {
        lines.push([
          (tds[0].textContent || '').trim().replace(/,/g, ' '),
          (tds[1].textContent || '').trim().replace(/,/g, '').replace('$',''),
          (tds[2].textContent || '').trim().replace(/,/g, ' '),
          (tds[3].textContent || '').trim().replace(/,/g, ' '),
          (tds[4].textContent || '').trim().replace(/,/g, ' '),
          (tds[5].textContent || '').trim().replace(/,/g, ' '),
          (tds[6].textContent || '').trim().replace(/,/g, ' '),
          (tds[7].textContent || '').trim().replace(/,/g, ' ')
        ].join(','));
      }
    });
    const csv = '\uFEFF' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pagos_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  async loadTeachers(searchTerm = '') {
    const tbody = document.getElementById('teachersTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" class="p-4">${Helpers.skeleton(3, 'h-12')}</td></tr>`;
    
    let query = supabase.from('profiles').select('id,name,email,phone').eq('role','maestra').order('name');
    if(searchTerm) query = query.ilike('name', `%${searchTerm}%`);

    const { data: teachers } = await query;

    if (!teachers || !teachers.length) { tbody.innerHTML = `<tr><td colspan="4">${Helpers.emptyState('No hay maestros')}</td></tr>`; return; }
    tbody.innerHTML = teachers.map(t=>`
      <tr class="hover:bg-slate-50 transition-colors border-b last:border-0">
        <td class="px-6 py-4 font-medium">${t.name}</td>
        <td class="px-6 py-4">${t.email||'-'}</td>
        <td class="px-6 py-4">${t.phone||'-'}</td>
        <td class="px-6 py-4">
            <button class="btn-edit-teacher px-2 py-1 rounded bg-slate-100 text-slate-700 text-xs hover:bg-teal-100 hover:text-teal-700 transition" data-id="${t.id}">
                <i data-lucide="edit-2" class="w-3 h-3 inline mr-1"></i>Editar
            </button>
        </td>
      </tr>
    `).join('');
    refreshIcons();
  },

  async openTeacherModal(id = null) {
    const modal = document.getElementById('modalAddTeacher');
    if (!modal) return;
    
    // Reset fields
    document.getElementById('teacherId').value = '';
    document.getElementById('teacherName').value = '';
    document.getElementById('teacherEmail').value = '';
    document.getElementById('teacherPassword').value = '';
    document.getElementById('teacherPhone').value = '';
    document.getElementById('teacherModalTitle').textContent = 'Agregar Maestro';
    document.getElementById('passHint').textContent = '(Requerida para nuevos)';

    if (id) {
        // Edit Mode
        document.getElementById('teacherModalTitle').textContent = 'Editar Maestro';
        document.getElementById('passHint').textContent = '(Dejar en blanco para mantener)';
        const { data: t } = await supabase.from('profiles').select('*').eq('id', id).single();
        if (t) {
            document.getElementById('teacherId').value = t.id;
            document.getElementById('teacherName').value = t.name;
            document.getElementById('teacherEmail').value = t.email;
            document.getElementById('teacherPhone').value = t.phone;
        }
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  },

  closeTeacherModal() {
    const modal = document.getElementById('modalAddTeacher');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
  },

  async saveTeacher() {
    const id = document.getElementById('teacherId').value;
    const name = document.getElementById('teacherName').value;
    const email = document.getElementById('teacherEmail').value;
    const password = document.getElementById('teacherPassword').value;
    const phone = document.getElementById('teacherPhone').value;

    if (!name || !email) { Helpers.toast('Nombre y correo son obligatorios', 'error'); return; }

    const btn = document.getElementById('btnSaveTeacher');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        if (id) {
            // Update existing
            const { error } = await supabase.from('profiles').update({ name, phone, email }).eq('id', id);
            if (error) throw error;
            Helpers.toast('Maestro actualizado');
        } else {
            // Create new
            if (!password || password.length < 6) throw new Error('Contraseña requerida (min 6 caracteres)');
            
            // Use temp client to avoid logging out assistant
            const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
            const { data: authData, error: authError } = await tempClient.auth.signUp({ email, password });
            
            if (authError) throw authError;
            if (authData.user) {
                const { error: profError } = await supabase.from('profiles').insert({
                    id: authData.user.id,
                    name, email, phone, role: 'maestra'
                });
                if (profError) throw profError;
                Helpers.toast('Maestro creado exitosamente');
            }
        }
        this.closeTeacherModal();
        this.loadTeachers();
    } catch (e) {
        console.error(e);
        Helpers.toast(e.message || 'Error al guardar', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar';
    }
  }
  ,

  async loadPaymentReports(filters = {}) {
    try {
      const totalsEl = document.getElementById('paymentReportTotals');
      const byMonthEl = document.getElementById('paymentReportByMonthBody');
      const byBankEl = document.getElementById('paymentReportByBankBody');

      const { data: payments, error } = await supabase
        .from('payments')
        .select('amount, method, status, bank, month_paid, transfer_date');
      if (error) throw error;

      const monthFilter = filters.month || null;
      const bankFilter = filters.bank || null;
      const list = payments || [];
      const filtered = list.filter(p => {
        const okMonth = monthFilter ? (p.month_paid === monthFilter) : true;
        const okBank = bankFilter ? (p.bank === bankFilter) : true;
        return okMonth && okBank;
      });

      const formatAmount = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n || 0);

      const totals = {
        total_confirmado_transfer: 0,
        total_efectivo: 0,
        total_pendiente: 0,
        count_confirmado: 0,
        count_pendiente: 0,
        count_rechazado: 0
      };

      const byMonth = new Map();
      const byBank = new Map();

      for (const p of filtered) {
        if (p.status === 'confirmado') {
          totals.count_confirmado++;
          if (p.method === 'efectivo') totals.total_efectivo += Number(p.amount || 0);
          if (p.method === 'transferencia') totals.total_confirmado_transfer += Number(p.amount || 0);
        } else if (p.status === 'pendiente') {
          totals.count_pendiente++;
          totals.total_pendiente += Number(p.amount || 0);
        } else if (p.status === 'rechazado') {
          totals.count_rechazado++;
        }

        const m = p.month_paid || (p.transfer_date ? String(p.transfer_date).slice(0,7) : 'Sin mes');
        const b = p.bank || 'Sin banco';

        const mm = byMonth.get(m) || { count: 0, amount_confirmado: 0, amount_pendiente: 0, amount_efectivo: 0 };
        mm.count++;
        if (p.status === 'confirmado' && p.method === 'transferencia') mm.amount_confirmado += Number(p.amount || 0);
        if (p.status === 'pendiente') mm.amount_pendiente += Number(p.amount || 0);
        if (p.method === 'efectivo' && p.status === 'confirmado') mm.amount_efectivo += Number(p.amount || 0);
        byMonth.set(m, mm);

        const bb = byBank.get(b) || { count: 0, amount: 0 };
        bb.count++;
        if (p.status === 'confirmado') bb.amount += Number(p.amount || 0);
        byBank.set(b, bb);
      }

      if (totalsEl) {
        totalsEl.innerHTML = `
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div class="p-3 rounded-lg bg-green-50">
              <p class="text-xs text-green-600">Transferencias confirmadas</p>
              <p class="text-lg font-bold text-green-700">${formatAmount(totals.total_confirmado_transfer)}</p>
            </div>
            <div class="p-3 rounded-lg bg-teal-50">
              <p class="text-xs text-teal-600">Efectivo confirmado</p>
              <p class="text-lg font-bold text-teal-700">${formatAmount(totals.total_efectivo)}</p>
            </div>
            <div class="p-3 rounded-lg bg-yellow-50">
              <p class="text-xs text-yellow-600">Pendiente</p>
              <p class="text-lg font-bold text-yellow-700">${formatAmount(totals.total_pendiente)}</p>
            </div>
            <div class="p-3 rounded-lg bg-slate-50">
              <p class="text-xs text-slate-600">Estados</p>
              <p class="text-sm text-slate-700">✔ ${totals.count_confirmado} · ⏳ ${totals.count_pendiente} · ✖ ${totals.count_rechazado}</p>
            </div>
          </div>
        `;
      }

      if (byMonthEl) {
        const rows = Array.from(byMonth.entries())
          .sort((a,b)=>a[0].localeCompare(b[0]))
          .map(([m, v]) => `
            <tr class="hover:bg-slate-50 transition-colors border-b last:border-0">
              <td class="px-4 py-2 font-medium">${m}</td>
              <td class="px-4 py-2">${v.count}</td>
              <td class="px-4 py-2">${formatAmount(v.amount_confirmado)}</td>
              <td class="px-4 py-2">${formatAmount(v.amount_efectivo)}</td>
              <td class="px-4 py-2">${formatAmount(v.amount_pendiente)}</td>
            </tr>
          `).join('');
        byMonthEl.innerHTML = rows || `<tr><td colspan="5">${Helpers.emptyState('Sin datos')}</td></tr>`;
      }

      if (byBankEl) {
        const rows = Array.from(byBank.entries())
          .sort((a,b)=>b[1].amount - a[1].amount)
          .map(([b, v]) => `
            <tr class="hover:bg-slate-50 transition-colors border-b last:border-0">
              <td class="px-4 py-2 font-medium">${b}</td>
              <td class="px-4 py-2">${v.count}</td>
              <td class="px-4 py-2">${formatAmount(v.amount)}</td>
            </tr>
          `).join('');
        byBankEl.innerHTML = rows || `<tr><td colspan="3">${Helpers.emptyState('Sin datos')}</td></tr>`;
      }

    } catch (error) {
      console.error('Error cargando reportes:', error);
      const totalsEl = document.getElementById('paymentReportTotals');
      const byMonthEl = document.getElementById('paymentReportByMonthBody');
      const byBankEl = document.getElementById('paymentReportByBankBody');
      if (totalsEl) totalsEl.innerHTML = Helpers.emptyState('Error');
      if (byMonthEl) byMonthEl.innerHTML = `<tr><td colspan="5">${Helpers.emptyState('Error')}</td></tr>`;
      if (byBankEl) byBankEl.innerHTML = `<tr><td colspan="3">${Helpers.emptyState('Error')}</td></tr>`;
    }
  },

  exportPaymentReportsCSV() {
    const byMonthEl = document.getElementById('paymentReportByMonthBody');
    const byBankEl = document.getElementById('paymentReportByBankBody');
    const lines = [];
    if (byMonthEl) {
      lines.push('Mes,Movimientos,Confirmado Transferencia,Confirmado Efectivo,Pendiente');
      byMonthEl.querySelectorAll('tr').forEach(tr=>{
        const tds = Array.from(tr.querySelectorAll('td')).map(td=> (td.textContent||'').replace(/,/g,' '));
        if (tds.length===5) lines.push(tds.join(','));
      });
      lines.push('');
    }
    if (byBankEl) {
      lines.push('Banco,Movimientos,Confirmado');
      byBankEl.querySelectorAll('tr').forEach(tr=>{
        const tds = Array.from(tr.querySelectorAll('td')).map(td=> (td.textContent||'').replace(/,/g,' '));
        if (tds.length===3) lines.push(tds.join(','));
      });
    }
    if (!lines.length) { Helpers.toast('No hay datos de reporte', 'error'); return; }
    const csv = '\uFEFF' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte_pagos_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  async loadReminderConfig() {
    const { data } = await supabase.from('payment_reminders').select('*').limit(1).maybeSingle();
    if (data) {
        document.getElementById('reminderDay').value = data.day_of_month || '';
        document.getElementById('reminderMessage').value = data.message || '';
    }
  }
};

function refreshIcons() {
  if (window.lucide) {
    lucide.createIcons();
  }
}

// Initialize
  document.addEventListener('DOMContentLoaded', () => {
    UI.init();
    refreshIcons();
    // Listeners moved to UI.bindEvents() to avoid duplication
    document.addEventListener('click', async (e)=>{
      const cBtn = e.target.closest('.btn-confirm-payment');
      const rBtn = e.target.closest('.btn-reject-payment');
      if (cBtn) {
        const id = cBtn.dataset.id;
        const payment = AppState.paymentsData.find(p => p.id == id);
        
        const { error } = await supabase.from('payments').update({ status: 'confirmado', validated_by: AppState.user.id }).eq('id', id);
        
        if (!error) {
          Helpers.toast('Pago confirmado');
          // Enviar notificación al padre si existe
          if (payment && payment.students?.parent_id) {
            await supabase.rpc('send_notification', {
              p_user_id: payment.students.parent_id,
              p_title: 'Pago Confirmado',
              p_message: `Su pago de $${payment.amount} correspondiente a ${payment.month_paid} ha sido validado exitosamente.`,
              p_type: 'info',
              p_link: 'panel_padres.html'
            });
          }
          UI.loadPayments();
        } else {
          Helpers.toast('Error al confirmar', 'error');
        }
      }
      if (rBtn) {
        const id = rBtn.dataset.id;
        const reason = prompt('Motivo del rechazo');
        await supabase.from('payments').update({ status: 'rechazado', validated_by: AppState.user.id, notes: reason || null }).eq('id', id);
        Helpers.toast('Pago rechazado');
        UI.loadPayments();
      }
    });
    document.getElementById('btnSaveReminder')?.addEventListener('click', ()=> UI.saveReminder());
    document.getElementById('btnSendReminders')?.addEventListener('click', ()=> UI.sendRemindersNow());
    document.getElementById('btnExportPaymentReports')?.addEventListener('click', () => UI.exportPaymentReportsCSV());
});

// Expose UI for debugging or legacy inline calls if absolutely necessary
window.UI = UI;
