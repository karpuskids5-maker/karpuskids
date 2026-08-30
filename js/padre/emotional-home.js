import { AppState } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';

/**
 * 💖 HERO DE BIENVENIDA EMOCIONAL ("El Resumen de Felicidad")
 * Saludo dinámico + indicador de ánimo en vivo + "Highlight Reel" del día.
 */
export const EmotionalHome = {
  _container: null,

  /** Inyecta y rellena el hero emocional en la sección de inicio */
  async init(containerId = 'emotionalHero') {
    const container = document.getElementById(containerId);
    if (!container) return;
    this._container = container;

    const student = AppState.get('currentStudent');
    if (!student) return;

    const profile = AppState.get('profile');
    this._renderGreeting(container, student, profile);

    // Indicador de ánimo en vivo
    const status = AppState.get('todayAttendance');
    this._renderStatus(container, student, status);

    // Highlight Reel del día (log de rutina)
    await this._renderReel(container, student);
  },

  _greetingByHour() {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return '¡Buenos días';
    if (h >= 12 && h < 19) return '¡Buenas tardes';
    return '¡Buenas noches';
  },

  _familyName(profile, student) {
    const p1 = (student && (student.p1_name || '')) || '';
    const last = p1.split(' ').slice(-2).join(' ').trim();
    return (last || profile?.name || 'Familia').split(' ')[0] || 'Familia';
  },

  _renderGreeting(container, student, profile) {
    const greet = this._greetingByHour();
    const fam = this._familyName(profile, student);
    const classroom = student.classrooms?.name || student.grade || student.section || '';
    const firstName = (student.name || 'pequeño').split(' ')[0];

    container.innerHTML = `
      <div class="relative overflow-hidden rounded-[2.5rem] p-6 md:p-8 text-white mb-6"
        style="background:linear-gradient(120deg,#10B981 0%,#0EA5E9 55%,#FACC15 130%)">
        <div class="absolute -top-6 -right-6 w-32 h-32 bg-white/10 rounded-full pointer-events-none animate-float-delayed"></div>
        <div class="absolute bottom-0 left-6 w-24 h-24 bg-white/10 rounded-full pointer-events-none"></div>
        <div class="absolute top-4 right-16 w-10 h-10 bg-white/10 rounded-full pointer-events-none animate-float"></div>

        <div class="relative z-10">
          <p class="text-[11px] md:text-xs font-black uppercase tracking-[0.25em] text-white/80">${greet}, Familia ${escapeHtml(fam)}!</p>
          <h2 class="text-2xl md:text-4xl font-black mt-1 leading-tight">
            Hoy ${escapeHtml(firstName)} está explorando el mundo 🎈${classroom ? ` <span class="text-white/80 text-lg md:text-2xl">en ${escapeHtml(classroom)}</span>` : ''}
          </h2>
          <p class="text-sm md:text-base font-medium text-white/85 mt-2 flex items-center gap-2">
            <i data-lucide="sparkles" class="w-4 h-4"></i> Un día lleno de aprendizaje y cariño
          </p>
        </div>
      </div>
    `;
  },

  _statusInfo(status) {
    const map = {
      present: { emoji: '😄', label: 'Feliz y Activo', color: '#FACC15', dots: '3' },
      late:    { emoji: '⏰', label: 'Llegó puntual/animado', color: '#FACC15', dots: '2' },
      absent:  { emoji: '💤', label: 'Hoy no asistió', color: '#E2E8F0', dots: '1' },
    };
    return map[status?.toLowerCase()] || { emoji: '😄', label: 'Listo para aprender', color: '#FACC15', dots: '2' };
  },

  _renderStatus(container, student, status) {
    const info = this._statusInfo(status);
    const badge = document.createElement('div');
    badge.className = 'inline-flex items-center gap-2 pl-2 pr-4 py-2 rounded-full bg-white shadow-lg border border-slate-100 text-sm font-black text-slate-700 animate-breathe mb-6';
    badge.style.display = 'inline-flex';
    badge.innerHTML = `
      <span class="w-9 h-9 rounded-full flex items-center justify-center text-xl" style="background:${info.color}40">${info.emoji}</span>
      <span>${info.label}</span>
      <span class="flex gap-0.5 ml-1">${'·'.repeat(Number(info.dots))}</span>
    `;
    // Insertar justo debajo del hero (primer hijo del contenedor)
    const hero = container.querySelector(':scope > div');
    if (hero && hero.parentNode) {
      hero.insertAdjacentElement('afterend', badge);
    }
    if (window.lucide) lucide.createIcons();
  },

  /** Highlight Reel: resumen de recuerdos/tips felices del día con Neuro-Dopamina */
  async _renderReel(container, student) {
    const reel = document.createElement('div');
    reel.className = 'mb-6';
    const firstName = (student.name || 'pequeño').split(' ')[0];
    const safeFirstName = Helpers?.escapeHTML ? Helpers.escapeHTML(firstName) : escapeHtml(firstName);

    reel.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-black text-slate-800 flex items-center gap-2">
          <span class="w-8 h-8 bg-gradient-to-tr from-emerald-400 to-teal-500 text-white rounded-xl flex items-center justify-center text-base shadow-sm animate-breathe">📸</span>
          Recuerdos del Día de ${safeFirstName}
        </h3>
        <button onclick="window.App?.navigateTo('routine')" class="text-[10px] font-black text-[#28B54D] uppercase tracking-widest hover:underline flex items-center gap-1">
          Ver Línea de Tiempo <i data-lucide="sparkles" class="w-3 h-3"></i>
        </button>
      </div>
      <div class="flex gap-3 overflow-x-auto no-scrollbar pb-2">
        ${this._storyBubble('🍎', 'Nutrición', '#F43F5E', 'routine')}
        ${this._storyBubble('🧩', 'Autonomía', '#F59E0B', 'routine')}
        ${this._storyBubble('😴', 'Descanso', '#8B5CF6', 'routine')}
        ${this._storyBubble('🎨', 'Creatividad', '#10B981', 'class')}
        ${this._storyBubble('🤝', 'Social', '#0EA5E9', 'routine')}
        ${this._storyBubble('🏆', 'Logro Hoy', '#EC4899', 'grades')}
      </div>
    `;
    container.appendChild(reel);
    if (window.lucide) lucide.createIcons();
  },

  _storyBubble(emoji, label, color, targetSection = 'routine') {
    return `
      <div onclick="window.App?.navigateTo('${targetSection}')" class="flex flex-col items-center gap-1.5 shrink-0 w-20 group cursor-pointer active:scale-95 transition-transform">
        <div class="w-16 h-16 rounded-full p-[3px] shadow-sm group-hover:shadow-md transition-shadow" style="background:conic-gradient(${color}, #FACC15, ${color})">
          <div class="w-full h-full rounded-full bg-white flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
            ${emoji}
          </div>
        </div>
        <p class="text-[10px] font-black text-slate-600 text-center leading-tight group-hover:text-emerald-600 transition-colors">${label}</p>
      </div>
    `;
  }
};
