/**
 * Controlador Principal: Panel de Padres
 * Orquesta la lógica de negocio y conecta Servicios con UI.
 */
class ParentDashboardApp {
    constructor() {
        this.auth = window.Auth;
        this.data = window.KarpusStore;
        this.ui = new (function UIManager() {
            this.showTab = (tabId) => {
                document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
                const tabToShow = document.getElementById(`tab-${tabId}`);
                if (tabToShow) {
                    tabToShow.classList.remove('hidden');
                }
            };
            this.render = (elementId, html) => {
                const element = document.getElementById(elementId);
                if (element) {
                    element.innerHTML = html;
                }
            };
            this.renderDonutChart = (containerId, percent, present, absent) => {
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
                        <circle class="text-karpus-primary" stroke-width="${strokeWidth}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" stroke="currentColor" fill="transparent" r="${radius}" cx="${size/2}" cy="${size/2}" style="transform: rotate(-90deg); transform-origin: 50% 50%;"/>
                        <text x="50%" y="50%" text-anchor="middle" dy=".3em" class="text-2xl font-bold text-slate-800">${percent}%</text>
                    </svg>
                `;
            };
        })();
        
        this.state = {
            currentClass: null,
            studentName: null,
            filterTask: 'all',
            userRole: 'Padre / Tutor'
        };
    }

    async init() {
        // 1. Seguridad
        if (!this.auth.enforceRole('padre')) return;
        
        this.setupEventListeners();
        
        await this.loadUserProfile();
        
        // Check for store initialization error
        if (this.data && typeof this.data.getError === 'function') {
             const err = this.data.getError();
             if (err) {
                 console.error('Store init error:', err);
                 alert('Error de conexión al inicializar datos. Algunas funciones pueden no estar disponibles.');
             }
        }

        // 2. Carga inicial de datos
        await this.loadDashboard();
        
        // 3. Navegación inicial
        this.ui.showTab('home');
        
        // 4. Inicializar iconos
        if (window.lucide) window.lucide.createIcons();
    }

    setupEventListeners() {
        // Navegación Sidebar
        document.querySelectorAll('.sidebar-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const section = btn.dataset.section;
                this.ui.showTab(section);
                this.handleSectionLoad(section);
            });
        });

        // Filtros de Tareas
        document.querySelectorAll('.task-filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleTaskFilter(e));
        });

        // Botón CTA Dashboard
        document.getElementById('ctaPendingBtn')?.addEventListener('click', () => {
            this.ui.showTab('tasks');
        });
    }

    async handleSectionLoad(section) {
        switch(section) {
            case 'live-attendance':
                await this.loadAttendance();
                break;
            case 'tasks':
                await this.loadTasks();
                break;
            case 'grades':
                await this.loadGrades();
                break;
            case 'class':
                // Placeholder for future implementation
                break;
        }
    }

    handleTaskFilter(e) {
        const target = e.currentTarget;
        this.state.filterTask = target.dataset.filter;

        document.querySelectorAll('.task-filter-btn').forEach(btn => {
            btn.classList.remove('active', 'bg-slate-800', 'text-white');
            btn.classList.add('bg-slate-100', 'text-slate-600');
        });

        target.classList.add('active', 'bg-slate-800', 'text-white');
        target.classList.remove('bg-slate-100', 'text-slate-600');

        this.loadTasks();
    }

    // --- Lógica de Negocio por Sección ---

    async loadUserProfile() {
        // Simulación de fetch de perfil completo
        const user = this.auth.currentUser();
        // En producción: const profile = await this.data.get('profile');
        
        this.state.studentName = user.studentName || 'Estudiante';
        this.state.currentClass = user.classId || 'pequenos';
        
        // Actualizar UI global
        const updateText = (id, text) => { const el = document.getElementById(id); if(el) el.textContent = text; };
        
        updateText('sidebar-student-name', this.state.studentName);
        updateText('sidebar-role-label', this.state.userRole);
        updateText('mobile-student-name', this.state.studentName);
        updateText('dropdown-role', this.state.userRole);
        updateText('dropdown-student', this.state.studentName);
        updateText('modal-submit-student', this.state.studentName);
        updateText('modal-submit-parent', user.name);
    }

    async loadDashboard() {
        try {
            // Actualizar fecha y datos básicos
            const dateEl = document.getElementById('currentDateDisplay');
            if (dateEl) dateEl.textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
            
            document.getElementById('dash-student-name').textContent = this.state.studentName;
            document.getElementById('dash-guardian-name').textContent = this.auth.currentUser().name;

            // Cargar resumen de asistencia
            const att = await this.data.get('attendance');
            const percent = Math.round((att.present / att.total) * 100) || 0;
            document.getElementById('dashAttendance').textContent = `${percent}%`;

            // Cargar tareas pendientes (contador)
            const tasks = await this.data.getTasksForClass(this.state.currentClass);
            const pending = tasks.filter(t => !this.isTaskSubmitted(t)).length;
            document.getElementById('dashPendingTasks').textContent = pending;
        } catch (error) {
            console.error('Error loading dashboard:', error);
            alert('Error de conexión al cargar el dashboard: ' + error.message);
        }
    }

    async loadAttendance() {
        try {
            const att = await this.data.get('attendance');
            const percent = Math.round((att.present / att.total) * 100) || 0;
            
            // Usar el componente de UI para renderizar el gráfico
            // Creamos un contenedor específico si no existe
            let chartContainer = document.getElementById('attendance-chart-container');
            if (!chartContainer) {
                const section = document.getElementById('tab-live-attendance');
                chartContainer = document.createElement('div');
                chartContainer.id = 'attendance-chart-container';
                chartContainer.className = 'flex justify-center py-4';
                // Insertar después del header
                section.querySelector('.modern-card').insertBefore(chartContainer, section.querySelector('.modern-card').children[1]);
            }
            
            this.ui.renderDonutChart('attendance-chart-container', percent, att.present, att.total - att.present);
        } catch (error) {
            console.error('Error loading attendance:', error);
            alert('Error de conexión al cargar asistencia: ' + error.message);
        }
    }

    async loadTasks() {
        try {
            const allTasks = await this.data.getTasksForClass(this.state.currentClass);
            const container = document.getElementById('tasksList');

            const filteredTasks = allTasks.filter(task => {
                const isSubmitted = this.isTaskSubmitted(task);
                const isOverdue = this.isTaskOverdue(task);

                switch (this.state.filterTask) {
                    case 'pending':
                        return !isSubmitted && !isOverdue;
                    case 'submitted':
                        return isSubmitted;
                    case 'overdue':
                        return !isSubmitted && isOverdue;
                    case 'all':
                    default:
                        return true;
                }
            });

            if (!filteredTasks.length) {
                this.ui.render('tasksList', '<p class="text-center text-slate-500 py-4">No hay tareas en esta categoría.</p>');
                return;
            }

            const html = filteredTasks.map(t => {
                const isSubmitted = this.isTaskSubmitted(t);
                const isOverdue = this.isTaskOverdue(t);
                
                let statusClass, statusText, icon, iconBg;

                if (isSubmitted) {
                    statusClass = 'bg-green-100 text-green-700';
                    statusText = 'Entregada';
                    icon = 'check-circle-2';
                    iconBg = 'bg-green-50 text-green-600';
                } else if (isOverdue) {
                    statusClass = 'bg-red-100 text-red-700';
                    statusText = 'Vencida';
                    icon = 'alert-triangle';
                    iconBg = 'bg-red-50 text-red-500';
                } else {
                    statusClass = 'bg-yellow-100 text-yellow-800';
                    statusText = 'Pendiente';
                    icon = 'pencil';
                    iconBg = 'bg-orange-50 text-orange-500';
                }
                
                return `
                    <div class="group p-4 rounded-3xl bg-white border border-slate-100 hover:border-karpus-pink transition-all shadow-sm hover:shadow-md mb-3 relative overflow-hidden">
                        <div class="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
                            <i data-lucide="clipboard-list" class="w-16 h-16 text-karpus-pink"></i>
                        </div>
                        <div class="flex items-start gap-4 relative z-10">
                            <div class="w-12 h-12 rounded-2xl ${iconBg} flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110">
                                <i data-lucide="${icon}" class="w-6 h-6"></i>
                            </div>
                            <div class="flex-1">
                                <h4 class="text-base font-bold text-slate-800 mb-1">${t.title}</h4>
                                <div class="flex items-center gap-3 text-xs text-slate-500 mb-3">
                                    <span class="flex items-center gap-1"><i data-lucide="calendar" class="w-3 h-3"></i> ${t.due}</span>
                                    <span class="px-2 py-0.5 rounded-full ${statusClass} font-bold text-[10px] uppercase tracking-wide">${statusText}</span>
                                </div>
                                <button class="w-full sm:w-auto text-xs font-bold px-4 py-2 rounded-xl border-2 border-slate-100 text-slate-600 hover:border-karpus-pink hover:text-karpus-pink hover:bg-pink-50 transition-colors">
                                    Ver detalle y entregar
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            this.ui.render('tasksList', html);
            if (window.lucide) window.lucide.createIcons();
        } catch (error) {
            console.error('Error loading tasks:', error);
            alert('Error de conexión al cargar tareas: ' + error.message);
        }
    }

    async loadGrades() {
        try {
            const grades = await this.data.get('grades');
            const html = grades.map(g => `
                <tr class="hover:bg-slate-50">
                    <td class="p-4 font-medium text-slate-700">${g.subject}</td>
                    <td class="p-4 text-center"><span class="px-2 py-1 rounded-lg bg-slate-100 font-bold text-xs">${g.grade}</span></td>
                    <td class="p-4 text-slate-500 text-xs">${g.comment}</td>
                </tr>
            `).join('');
            this.ui.render('gradesTableBody', html);
        } catch (error) {
            console.error('Error loading grades:', error);
            alert('Error de conexión al cargar calificaciones: ' + error.message);
        }
    }

    isTaskOverdue(task) {
        if (!task.due) return false;
        const dueDate = new Date(task.due.split('/').reverse().join('-'));
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return dueDate < today;
    }

    // Helpers
    isTaskSubmitted(task) {
        const parentName = this.auth.currentUser().name;
        return task.submissions?.some(s => s.parent === parentName);
    }

    // Inicialización
    static bootstrap() {
        const app = new ParentDashboardApp();
        document.addEventListener('DOMContentLoaded', () => app.init());
    }
}

// Arrancar la aplicación
ParentDashboardApp.bootstrap();
