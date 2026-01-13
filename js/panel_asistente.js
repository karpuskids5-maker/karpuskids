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
  }
};

// --- 2. APP STATE ---
const AppState = {
  user: null,
  profile: null,
  currentSection: 'dashboard'
};

// --- 3. UI CONTROLLER ---
const UI = {
  init() {
    this.bindEvents();
    this.checkSession();
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
    this.updateUserUI();

    // Initial Load
    this.loadDashboardStats();
    
    // Check if URL hash has a section
    // Optional: could add hash routing here
  },

  updateUserUI() {
    const name = AppState.profile?.name || 'Asistente';
    document.getElementById('sidebarUserName').textContent = name;
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

    // --- Access Control Logic ---
    const accessInput = document.getElementById('accessSearchInput');
    if (accessInput) {
      accessInput.addEventListener('input', (e) => this.handleAccessSearch(e.target.value));
    }

    // --- Payment Modal ---
    document.getElementById('btnNewPayment')?.addEventListener('click', () => this.openPaymentModal());
    document.getElementById('closePaymentModal')?.addEventListener('click', () => this.closePaymentModal());
    document.getElementById('cancelPayment')?.addEventListener('click', () => this.closePaymentModal());
    document.getElementById('btnExportPayments')?.addEventListener('click', () => this.exportPaymentsToCSV());
    
    const paymentForm = document.getElementById('paymentForm');
    if (paymentForm) {
      paymentForm.addEventListener('submit', (e) => this.handlePaymentSubmit(e));
    }

    // --- Attendance Modal ---
    document.getElementById('closeAttendanceModal')?.addEventListener('click', () => {
        document.getElementById('attendanceModal').classList.add('hidden');
        document.getElementById('attendanceModal').classList.remove('flex');
    });

    // Global Delegated Events (for dynamic content)
    document.addEventListener('click', (e) => {
        // Access Buttons
        if (e.target.closest('.btn-check-in')) {
            const btn = e.target.closest('.btn-check-in');
            this.registerAccess(btn.dataset.id, 'check_in');
        }
        if (e.target.closest('.btn-check-out')) {
            const btn = e.target.closest('.btn-check-out');
            this.registerAccess(btn.dataset.id, 'check_out');
        }
        // Delete Payment
        if (e.target.closest('.btn-delete-payment')) {
            const btn = e.target.closest('.btn-delete-payment');
            this.deletePayment(btn.dataset.id);
        }
        // Attendance Detail
        if (e.target.closest('.card-attendance-room')) {
            const card = e.target.closest('.card-attendance-room');
            this.openAttendanceDetail(card.dataset.id, card.dataset.name);
        }
    });
  },

  showSection(id) {
    AppState.currentSection = id;
    document.querySelectorAll('.section').forEach(s => {
        s.classList.remove('active');
    });
    
    const target = document.getElementById(id);
    if (target) {
        target.classList.add('active');
        // Trigger data load
        if (id === 'estudiantes') this.loadStudents();
        if (id === 'asistencia') this.loadAttendanceRooms();
        if (id === 'pagos') this.loadPayments();
        if (id === 'accesos') this.loadAccessLogs();
    }
  },

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const shell = document.getElementById('layoutShell');
    const btn = document.getElementById('toggleSidebar');
    
    sidebar.classList.toggle('collapsed');
    shell.classList.toggle('sidebar-collapsed');
    
    if(window.lucide) {
        const icon = sidebar.classList.contains('collapsed') ? 'chevron-right' : 'chevron-left';
        btn.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i>`;
        lucide.createIcons();
    }
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
        return;
      }

      tbody.innerHTML = students.map(s => `
        <tr class="hover:bg-slate-50 transition-colors border-b last:border-0">
          <td class="px-6 py-4 font-medium text-slate-800 flex items-center gap-3">
            <img 
              src="assets/img/students/${s.photo || 'default-avatar.png'}" 
              onerror="this.src='assets/img/students/default-avatar.png'" 
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
        </tr>
      `).join('');
    } catch (error) {
      console.error(error);
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-red-500 py-4">Error cargando estudiantes</td></tr>`;
    }
  },

  // --- ACCESS CONTROL ---
  async handleAccessSearch(term) {
    const container = document.getElementById('accessSearchResults');
    if (!container) return;
    
    if (term.length < 2) { 
        container.innerHTML = ''; 
        return; 
    }

    const { data: students } = await supabase
      .from('students')
      .select('id, name, classrooms(name), authorized_pickup')
      .ilike('name', `%${term}%`)
      .limit(5);

    if(!students || students.length === 0) {
        container.innerHTML = '<div class="text-slate-500 text-sm text-center py-2">No encontrado</div>';
        return;
    }

    container.innerHTML = students.map(s => `
      <div class="flex items-center justify-between p-4 border rounded-xl bg-slate-50 shadow-sm">
        <div>
          <p class="font-bold text-slate-800">${s.name}</p>
          <p class="text-xs text-slate-500">${s.classrooms?.name || 'Sin aula'}</p>
          <p class="text-xs text-slate-400 mt-1">Autorizados: ${s.authorized_pickup || 'No especificado'}</p>
        </div>
        <div class="flex gap-2">
          <button data-id="${s.id}" class="btn-check-in px-3 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 text-sm font-medium transition">Entrada</button>
          <button data-id="${s.id}" class="btn-check-out px-3 py-2 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 text-sm font-medium transition">Salida</button>
        </div>
      </div>
    `).join('');
  },

  async registerAccess(studentId, action) {
    let authorizedPerson = null;
    if (action === 'check_out') {
      // Better UX than prompt? For now prompt is simplest, could be a modal later.
      authorizedPerson = prompt('¿Quién recoge al estudiante? (Nombre de la persona autorizada)');
      if (!authorizedPerson) return; // User cancelled
    }

    const { error } = await supabase.from('access_logs').insert({
      student_id: studentId,
      action: action,
      authorized_person_name: authorizedPerson,
      recorded_by: AppState.user.id
    });

    if (error) {
        Helpers.toast('Error al registrar acceso', 'error');
    } else {
        Helpers.toast(`Registro de ${action === 'check_in' ? 'Entrada' : 'Salida'} exitoso.`);
        document.getElementById('accessSearchInput').value = '';
        document.getElementById('accessSearchResults').innerHTML = '';
        this.loadAccessLogs();
    }
  },

  async loadAccessLogs() {
    const container = document.getElementById('accessRecentLog');
    if (!container) return;
    
    // Simple loader
    container.innerHTML = Helpers.skeleton(3, 'h-10');

    const { data: logs } = await supabase
      .from('access_logs')
      .select('*, students(name)')
      .order('timestamp', { ascending: false })
      .limit(10);

    if(!logs || logs.length === 0) {
        container.innerHTML = Helpers.emptyState('No hay movimientos recientes', 'clock');
        return;
    }

    container.innerHTML = logs.map(log => `
      <div class="flex justify-between items-center border-b pb-2 last:border-0">
        <div>
          <p class="font-medium text-slate-800">${log.students?.name || 'Desconocido'}</p>
          <p class="text-xs text-slate-500">${new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${log.authorized_person_name || 'Estudiante'}</p>
        </div>
        <span class="text-xs px-2 py-1 rounded-full font-bold ${log.action === 'check_in' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}">
          ${log.action === 'check_in' ? 'Entrada' : 'Salida'}
        </span>
      </div>
    `).join('');
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

        if (rooms && rooms.length > 0) {
            grid.innerHTML = rooms.map(r => {
                const s = stats[r.id] || { present: 0, absent: 0, late: 0, total: 0 };
                return `
                <div data-id="${r.id}" data-name="${r.name}" 
                     class="card-attendance-room p-4 border rounded-xl hover:shadow-md transition-shadow cursor-pointer bg-white group">
                    <div class="flex justify-between items-start mb-3">
                        <h4 class="font-bold text-slate-700 group-hover:text-teal-600 transition-colors">${r.name}</h4>
                        <span class="text-xs font-mono bg-slate-100 px-2 py-1 rounded text-slate-500">${Helpers.formatDate(today)}</span>
                    </div>
                    
                    <div class="grid grid-cols-3 gap-2 text-center">
                        <div class="bg-green-50 p-2 rounded-lg">
                            <p class="text-xs text-green-600 font-bold">Presentes</p>
                            <p class="text-lg font-bold text-green-700">${s.present}</p>
                        </div>
                        <div class="bg-red-50 p-2 rounded-lg">
                            <p class="text-xs text-red-600 font-bold">Ausentes</p>
                            <p class="text-lg font-bold text-red-700">${s.absent}</p>
                        </div>
                        <div class="bg-yellow-50 p-2 rounded-lg">
                            <p class="text-xs text-yellow-600 font-bold">Tardanzas</p>
                            <p class="text-lg font-bold text-yellow-700">${s.late}</p>
                        </div>
                    </div>
                    <div class="mt-3 text-center">
                        <span class="text-xs text-teal-600 font-medium group-hover:underline">Ver detalle &rarr;</span>
                    </div>
                </div>
                `;
            }).join('');
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
    
    // Only load if empty or if needed (caching could be added)
    if(select.children.length > 1) return;

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

    if (!studentId || !amount || !month) {
      Helpers.toast('Complete todos los campos', 'error');
      return;
    }

    try {
      const { error } = await supabase.from('payments').insert({
        student_id: studentId, amount, month_paid: month, recorded_by: AppState.user.id
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
    
    tbody.innerHTML = `<tr><td colspan="5" class="p-4">${Helpers.skeleton(3, 'h-12')}</td></tr>`;

    try {
      const { data: payments, error } = await supabase
        .from('payments')
        .select('*, students(name)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (!payments.length) {
        tbody.innerHTML = `<tr><td colspan="5">${Helpers.emptyState('No hay pagos registrados.')}</td></tr>`;
        return;
      }

      tbody.innerHTML = payments.map(p => `
        <tr class="hover:bg-slate-50 transition-colors border-b last:border-0">
          <td class="px-6 py-4 font-medium text-slate-800">${p.students?.name || 'Desconocido'}</td>
          <td class="px-6 py-4 text-slate-600">$${p.amount}</td>
          <td class="px-6 py-4 text-slate-600">${new Date(p.created_at).toLocaleDateString()}</td>
          <td class="px-6 py-4 text-slate-600">${p.month_paid}</td>
          <td class="px-6 py-4">
            <button class="btn-delete-payment text-red-500 hover:text-red-700 transition" data-id="${p.id}" title="Eliminar">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </td>
        </tr>
      `).join('');
      
      if (window.lucide) lucide.createIcons();
    } catch (error) {
      console.error('Error cargando pagos:', error);
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-red-500 py-4">Error cargando datos</td></tr>`;
    }
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
    }
    const headers = ['Estudiante','Monto','Fecha','Mes Pagado'];
    const lines = [headers.join(',')];
    tbody.querySelectorAll('tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length >= 4) {
        const estudiante = (tds[0].textContent || '').trim().replace(/,/g, ' ');
        const monto = (tds[1].textContent || '').trim().replace(/,/g, '').replace('$','');
        const fecha = (tds[2].textContent || '').trim().replace(/,/g, ' ');
        const mes = (tds[3].textContent || '').trim().replace(/,/g, ' ');
        lines.push([estudiante, monto, fecha, mes].join(','));
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
  }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    UI.init();
});

// Expose UI for debugging or legacy inline calls if absolutely necessary
window.UI = UI;
