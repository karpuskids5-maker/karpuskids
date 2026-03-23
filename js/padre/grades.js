import { supabase } from '../supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers } from './helpers.js';

/**
 * Módulo de Calificaciones para el Panel de Padres
 */
export async function loadGrades() {
    const container = document.getElementById('gradesContent');
    if (!container) return;

    container.innerHTML = Helpers.skeleton(3, 'h-24');

    const student = AppState.get('student');
    if (!student) {
        container.innerHTML = Helpers.emptyState('No se encontró información del estudiante');
        return;
    }

    try {
        const [gradesRes, taskRes] = await Promise.all([
            supabase
                .from('grades')
                .select('*')
                .eq('student_id', student.id)
                .order('created_at', { ascending: false }),
            supabase
                .from('task_evidences')
                .select(`
                    *,
                    tasks:task_id (title, description)
                `)
                .eq('student_id', student.id)
                .order('created_at', { ascending: false })
        ]);

        if (gradesRes.error) throw gradesRes.error;
        if (taskRes.error) throw taskRes.error;

        const grades = gradesRes.data || [];
        const taskEvidences = taskRes.data || [];

        if (grades.length === 0 && taskEvidences.length === 0) {
            container.innerHTML = Helpers.emptyState('No hay registros académicos aún.', 'award');
            return;
        }

        // --- RENDERIZAR ESTRUCTURA ---
        container.innerHTML = `
            <div class="w-full max-w-5xl space-y-10">
                <!-- Dashboard de Rendimiento -->
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <!-- Gráfico Principal -->
                    <div class="lg:col-span-2 bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                        <div class="flex items-center justify-between mb-8">
                            <div>
                                <h4 class="font-black text-slate-800 text-xl">Rendimiento General</h4>
                                <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Progreso en el tiempo</p>
                            </div>
                            <div class="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-500">
                                <i data-lucide="line-chart" class="w-6 h-6"></i>
                            </div>
                        </div>
                        <div class="h-72 w-full relative">
                            <canvas id="gradesChart"></canvas>
                        </div>
                    </div>

                    <!-- Stats Rápidas -->
                    <div class="space-y-4">
                        <div class="bg-gradient-to-br from-emerald-400 to-emerald-500 p-6 rounded-[2rem] text-white shadow-lg shadow-emerald-100">
                            <p class="text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Promedio General</p>
                            <div class="text-4xl font-black mt-2">${calculateGPA(grades)}</div>
                            <div class="mt-4 flex items-center gap-2 bg-white/20 px-3 py-1 rounded-full w-fit">
                                <i data-lucide="trending-up" class="w-3 h-3"></i>
                                <span class="text-[10px] font-bold">Excelente</span>
                            </div>
                        </div>
                        <div class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                            <p class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Tareas Entregadas</p>
                            <div class="text-3xl font-black text-slate-700 mt-2">${taskEvidences.length}</div>
                            <p class="text-[10px] text-slate-400 font-bold mt-1">De las últimas asignadas</p>
                        </div>
                    </div>
                </div>

                <!-- Desglose de Tareas y Calificaciones -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <!-- Calificaciones por Materia -->
                    <div class="space-y-4">
                        <h4 class="font-black text-slate-800 text-lg px-4 flex items-center gap-2">
                            <i data-lucide="book-open" class="w-5 h-5 text-sky-500"></i> Calificaciones
                        </h4>
                        <div class="space-y-3">
                            ${grades.length > 0 ? grades.map(g => renderGradeCard(g)).join('') : '<p class="text-center text-slate-400 py-10 bg-slate-50 rounded-3xl">Sin calificaciones aún</p>'}
                        </div>
                    </div>

                    <!-- Desglose de Tareas (Evidencias) -->
                    <div class="space-y-4">
                        <h4 class="font-black text-slate-800 text-lg px-4 flex items-center gap-2">
                            <i data-lucide="clipboard-check" class="w-5 h-5 text-emerald-500"></i> Desglose de Tareas
                        </h4>
                        <div class="space-y-3">
                            ${taskEvidences.length > 0 ? taskEvidences.map(t => renderTaskEvidenceCard(t)).join('') : '<p class="text-center text-slate-400 py-10 bg-slate-50 rounded-3xl">Sin tareas entregadas aún</p>'}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Inicializar el gráfico
        setTimeout(() => {
            renderChart(grades);
            lucide.createIcons();
        }, 100);

    } catch (err) {
        console.error('Error cargando calificaciones:', err);
        container.innerHTML = Helpers.emptyState('Error al cargar las calificaciones');
    }
}

function renderChart(grades) {
    const ctx = document.getElementById('gradesChart');
    if (!ctx || grades.length === 0) return;

    // Tomar las últimas 10 para el gráfico, invertidas para orden cronológico
    const chartData = [...grades].slice(0, 10).reverse();
    
    const labels = chartData.map(g => g.subject || 'Materia');
    const scores = chartData.map(g => parseFloat(g.score) || 0);

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Calificación',
                data: scores,
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                borderWidth: 4,
                tension: 0.4,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: '#6366f1',
                pointBorderWidth: 3,
                pointRadius: 6,
                pointHoverRadius: 8,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleFont: { family: 'Nunito', size: 13, weight: 'bold' },
                    bodyFont: { family: 'Nunito', size: 12 },
                    padding: 12,
                    cornerRadius: 16,
                    displayColors: false,
                    callbacks: {
                        label: (context) => `Puntaje: ${context.parsed.y}%`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: '#f8fafc', drawBorder: false },
                    ticks: { 
                        font: { family: 'Nunito', weight: '800', size: 10 }, 
                        color: '#94a3b8',
                        callback: (value) => value + '%'
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { family: 'Nunito', weight: '800', size: 10 }, color: '#94a3b8' }
                }
            }
        }
    });
}

function calculateGPA(grades) {
    if (!grades.length) return '0.0';
    const sum = grades.reduce((acc, g) => acc + (parseFloat(g.score) || 0), 0);
    return (sum / grades.length).toFixed(1);
}

function renderTaskEvidenceCard(t) {
    const statusMap = {
        submitted: { label: 'Entregado', color: 'text-blue-500', bg: 'bg-blue-50' },
        graded: { label: 'Calificado', color: 'text-emerald-500', bg: 'bg-emerald-50' }
    };
    const status = statusMap[t.status] || statusMap.submitted;
    
    return `
        <div class="bg-white p-4 rounded-3xl border border-slate-50 shadow-sm flex items-center justify-between group hover:shadow-md transition-all">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-emerald-50 group-hover:text-emerald-500 transition-colors">
                    <i data-lucide="file-text" class="w-5 h-5"></i>
                </div>
                <div class="min-w-0">
                    <h5 class="font-bold text-slate-700 text-sm truncate">${Helpers.escapeHtml(t.tasks?.title || 'Tarea')}</h5>
                    <p class="text-[10px] text-slate-400 font-bold uppercase">${new Date(t.created_at).toLocaleDateString()}</p>
                </div>
            </div>
            <div class="text-right">
                <span class="px-2 py-1 rounded-lg ${status.bg} ${status.color} text-[10px] font-black uppercase tracking-tighter">
                    ${status.label}
                </span>
                ${t.stars ? `
                    <div class="flex items-center gap-0.5 mt-1 justify-end text-amber-400">
                        ${Array(t.stars).fill('<i data-lucide="star" class="w-2.5 h-2.5 fill-current"></i>').join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

function renderGradeCard(g) {
    const score = parseFloat(g.score) || 0;
    const color = score >= 90 ? 'text-emerald-500' : (score >= 70 ? 'text-blue-500' : 'text-amber-500');
    const bg = score >= 90 ? 'bg-emerald-50' : (score >= 70 ? 'bg-blue-50' : 'bg-amber-50');
    
    return `
        <div class="bg-white p-5 rounded-[2rem] border-2 border-slate-50 shadow-sm hover:shadow-md transition-all flex items-center justify-between group">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-2xl ${bg} flex items-center justify-center text-slate-400 group-hover:scale-110 transition-transform">
                    <i data-lucide="award" class="w-6 h-6 ${color}"></i>
                </div>
                <div>
                    <h4 class="font-bold text-slate-700">${Helpers.escapeHtml(g.subject || 'Materia')}</h4>
                    <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest">${new Date(g.created_at).toLocaleDateString()}</p>
                </div>
            </div>
            <div class="text-right">
                <div class="text-2xl font-black ${color}">${score}</div>
                <p class="text-[10px] font-bold uppercase tracking-widest text-slate-300">Puntaje</p>
            </div>
        </div>
    `;
}
