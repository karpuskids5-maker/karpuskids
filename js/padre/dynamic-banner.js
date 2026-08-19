/**
 * DynamicBanner — Karpus Kids
 * Single rotating banner that shows priority-based info.
 * Replaces 8 separate banners with one smart carousel.
 */

import { AppState } from './appState.js';
import { Helpers } from '/js/shared/helpers.js';
import { getBirthdayInfo } from '/js/shared/birthday-utils.js';
import { NotifyPermission } from '/js/shared/notify-permission.js';
import { supabase } from '/js/shared/supabase.js';

const SLIDE_INTERVAL = 6000;
const GRADIENTS = {
  exit_urgent:  'linear-gradient(135deg,#ef4444,#dc2626,#b91c1c)',
  exit_warning: 'linear-gradient(135deg,#fbbf24,#f59e0b,#d97706)',
  exit_info:    'linear-gradient(135deg,#f59e0b,#d97706,#b45309)',
  entry_urgent: 'linear-gradient(135deg,#818cf8,#6366f1,#4f46e5)',
  entry_warning:'linear-gradient(135deg,#6366f1,#4f46e5,#4338ca)',
  entry_info:   'linear-gradient(135deg,#818cf8,#6366f1,#818cf8)',
  debt:         'linear-gradient(135deg,#f97316,#ea580c,#c2410c)',
  debt_overdue: 'linear-gradient(135deg,#dc2626,#b91c1c,#991b1b)',
  birthday:     'linear-gradient(135deg,#f472b6,#f43f5e,#d946ef)',
  birthday_up:  'linear-gradient(135deg,#fda4af,#f472b6,#e879f9)',
  push:         'linear-gradient(135deg,#38bdf8,#2563eb,#6366f1)',
  schedule:     'linear-gradient(135deg,#34d399,#22c55e,#14b8a6)',
  new_post:     'linear-gradient(135deg,#f97316,#ea580c,#f59e0b)',
  school:       'linear-gradient(135deg,#8b5cf6,#7c3aed,#6d28d9)',
};

const ANIMATIONS = {
  pulse: 'animate-pulse',
  bounce: 'animate-bounce',
  none: '',
};

const DynamicBanner = {
  _container: null,
  _slides: [],
  _current: 0,
  _timer: null,
  _exitTimer: null,
  _entryTimer: null,
  _postCheckTimer: null,
  _lastPostCount: 0,
  _lastPostCheck: 0,

  init() {
    this._container = document.getElementById('dynamicBanner');
    if (!this._container) return;
    this._collectSlides();
    this._render();
    this._startRotation();

    if (this._exitTimer) clearInterval(this._exitTimer);
    this._exitTimer = setInterval(() => this._refreshTimeSlides(), 60000);

    if (this._postCheckTimer) clearInterval(this._postCheckTimer);
    this._postCheckTimer = setInterval(() => this._checkNewPosts(), 30000);
  },

  destroy() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._exitTimer) { clearInterval(this._exitTimer); this._exitTimer = null; }
    if (this._entryTimer) { clearInterval(this._entryTimer); this._entryTimer = null; }
    if (this._postCheckTimer) { clearInterval(this._postCheckTimer); this._postCheckTimer = null; }
  },

  refresh() {
    this._collectSlides();
    this._render();
  },

  _collectSlides() {
    const student = AppState.get('currentStudent');
    if (!student) { this._slides = []; return; }

    const slides = [];
    const now = new Date();
    const name = student.name || 'tu hijo';

    // ── EXIT reminder (highest priority when time-critical) ──
    if (student.exit_time) {
      const [eh, em] = student.exit_time.split(':').map(Number);
      const exitDate = new Date(now); exitDate.setHours(eh, em, 0, 0);
      const diffMin = Math.round((exitDate - now) / 60000);

      if (diffMin > -10 && diffMin <= 120) {
        if (diffMin < 0) {
          slides.push({
            id: 'exit_urgent',
            priority: 1,
            gradient: GRADIENTS.exit_urgent,
            icon: '🚨',
            anim: ANIMATIONS.bounce,
            title: `¡Hora de recoger a ${name}!`,
            msg: `Llevas ${Math.abs(diffMin)} min de retraso. Por favor recógelo lo antes posible.`,
            cta: null,
          });
        } else if (diffMin <= 15) {
          slides.push({
            id: 'exit_warning',
            priority: 2,
            gradient: GRADIENTS.exit_warning,
            icon: '🚗',
            anim: ANIMATIONS.pulse,
            title: `¡Quedan ${diffMin} min para la salida!`,
            msg: `Prepárate para recoger a ${name}. La salida es a las ${student.exit_time}.`,
            cta: null,
          });
        } else if (diffMin <= 60) {
          slides.push({
            id: 'exit_info',
            priority: 10,
            gradient: GRADIENTS.exit_info,
            icon: '🚗',
            anim: ANIMATIONS.none,
            title: `Salida de ${name} a las ${student.exit_time}`,
            msg: `Quedan ${diffMin} min. Recuerda planificar tu llegada.`,
            cta: null,
          });
        }
      }
    }

    // ── ENTRY reminder ──
    const todayAtt = AppState.get('todayAttendance');
    if (student.entry_time && todayAtt !== 'present' && todayAtt !== 'presente') {
      const [ih, im] = student.entry_time.split(':').map(Number);
      const entryDate = new Date(now); entryDate.setHours(ih, im, 0, 0);
      const diffMin = Math.round((entryDate - now) / 60000);

      if (diffMin > -60 && diffMin <= 120) {
        if (diffMin <= 0) {
          slides.push({
            id: 'entry_urgent',
            priority: 3,
            gradient: GRADIENTS.entry_urgent,
            icon: '🏫',
            anim: ANIMATIONS.pulse,
            title: `¡Hora de llevar a ${name}!`,
            msg: 'La hora de entrada ya comenzó. ¡Llévalo a Karpus Kids!',
            cta: null,
          });
        } else if (diffMin <= 15) {
          slides.push({
            id: 'entry_warning',
            priority: 4,
            gradient: GRADIENTS.entry_warning,
            icon: '🏫',
            anim: ANIMATIONS.pulse,
            title: `¡Quedan ${diffMin} min para la entrada!`,
            msg: `Prepárate para llevar a ${name}. La entrada es a las ${student.entry_time}.`,
            cta: null,
          });
        } else if (diffMin <= 120) {
          slides.push({
            id: 'entry_info',
            priority: 11,
            gradient: GRADIENTS.entry_info,
            icon: '🏫',
            anim: ANIMATIONS.none,
            title: `Entrada de ${name} a las ${student.entry_time}`,
            msg: `Quedan ${diffMin} min. Recuerda planificar tu llegada.`,
            cta: null,
          });
        }
      }
    }

    // ── DEBT / Payment ──
    const finance = AppState.get('finance');
    if (finance?.debt) {
      const debt = finance.debt.total || 0;
      const items = finance.debt.items || [];
      const overdue = items.filter(p => {
        const s = (p.status || '').toLowerCase();
        return s === 'overdue' || s === 'vencido';
      });

      if (overdue.length > 0) {
        slides.push({
          id: 'debt_overdue',
          priority: 5,
          gradient: GRADIENTS.debt_overdue,
          icon: '🚨',
          anim: ANIMATIONS.bounce,
          title: 'Pago vencido',
          msg: `Tienes ${overdue.length} mensualidad(es) atrasada(s). Total: ${Helpers.formatCurrency(debt)}`,
          cta: { label: 'Pagar ahora', action: () => App.navigateTo('payments') },
        });
      } else if (debt > 0) {
        slides.push({
          id: 'debt',
          priority: 8,
          gradient: GRADIENTS.debt,
          icon: '⚠️',
          anim: ANIMATIONS.none,
          title: 'Tienes un saldo pendiente',
          msg: `Tu balance actual es ${Helpers.formatCurrency(debt)}. Recuerda pagar antes del día 5.`,
          cta: { label: 'Pagar ahora', action: () => App.navigateTo('payments') },
        });
      }
    }

    // ── BIRTHDAY ──
    const bday = getBirthdayInfo(student.birth_date);
    if (bday) {
      if (bday.isToday) {
        slides.push({
          id: 'birthday',
          priority: 6,
          gradient: GRADIENTS.birthday,
          icon: '🎂',
          anim: ANIMATIONS.bounce,
          title: `¡Feliz cumpleaños, ${name}!`,
          msg: `Hoy cumple ${bday.ageTurning} años. ¡Que tenga un día lleno de alegría! 🎉`,
          cta: null,
        });
      } else if (bday.isUpcoming) {
        slides.push({
          id: 'birthday_up',
          priority: 12,
          gradient: GRADIENTS.birthday_up,
          icon: '🎂',
          anim: ANIMATIONS.none,
          title: `Próximo cumpleaños de ${name}`,
          msg: `En ${bday.daysUntil} día${bday.daysUntil === 1 ? '' : 's'} cumplirá ${bday.ageTurning} años.`,
          cta: null,
        });
      }
    }

    // ── NEW POST ──
    const postCount = AppState.get('unreadPostCount') || 0;
    if (postCount > 0) {
      slides.push({
        id: 'new_post',
        priority: 9,
        gradient: GRADIENTS.new_post,
        icon: '📢',
        anim: ANIMATIONS.none,
        title: postCount === 1 ? 'Nueva publicación en el muro' : `${postCount} nuevas publicaciones`,
        msg: 'Tu aula tiene contenido nuevo. ¡Revisalo!',
        cta: { label: 'Ver muro', action: () => App.navigateTo('feed') },
      });
    }

    // ── PUSH NOTIFICATIONS ──
    if ('Notification' in window && Notification.permission !== 'granted') {
      slides.push({
        id: 'push',
        priority: 13,
        gradient: GRADIENTS.push,
        icon: '🔔',
        anim: ANIMATIONS.pulse,
        title: 'Activar notificaciones',
        msg: 'Recibe alertas de asistencia, pagos y mensajes importantes.',
        cta: { label: 'Activar', action: () => this._activatePush() },
      });
    }

    // ── SCHEDULE REMINDER ──
    if (!student.entry_time || !student.exit_time) {
      slides.push({
        id: 'schedule',
        priority: 14,
        gradient: GRADIENTS.schedule,
        icon: '🕐',
        anim: ANIMATIONS.none,
        title: 'Horario del estudiante',
        msg: `Aún no has registrado el horario de entrada y salida de ${name}.`,
        cta: { label: 'Configurar', action: () => App.openScheduleModal() },
      });
    }

    // Sort by priority (lower = more important)
    slides.sort((a, b) => a.priority - b.priority);
    this._slides = slides;

    // Keep current index valid
    if (this._current >= this._slides.length) {
      this._current = 0;
    }
  },

  _render() {
    if (!this._container) return;

    if (this._slides.length === 0) {
      this._container.classList.add('hidden');
      this._container.innerHTML = '';
      return;
    }

    this._container.classList.remove('hidden');
    const slide = this._slides[this._current];
    const hasCTA = slide.cta;
    const ctaId = hasCTA ? `banner-cta-${Date.now()}` : '';

    this._container.innerHTML = `
      <div class="relative rounded-[1.5rem] md:rounded-[2rem] overflow-hidden shadow-lg transition-all duration-500"
           style="background:${slide.gradient};box-shadow:0 10px 15px -3px rgba(0,0,0,.15)">
        <div class="p-4 md:p-5 flex flex-col lg:flex-row items-center gap-3">
          <div class="w-11 h-11 md:w-12 md:h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center text-2xl shrink-0 ${slide.anim}">${slide.icon}</div>
          <div class="flex-1 text-center lg:text-left min-w-0 w-full">
            <p class="font-black text-white text-sm md:text-base leading-tight break-words">${slide.title}</p>
            <p class="text-white/85 text-[11px] md:text-xs font-bold mt-0.5 break-words leading-relaxed">${slide.msg}</p>
          </div>
          ${hasCTA ? `<button id="${ctaId}" class="w-full lg:w-auto shrink-0 bg-white font-black text-xs px-5 py-2.5 rounded-2xl hover:bg-white/90 transition-all active:scale-95 shadow-md" style="color:${this._btnColor(slide.gradient)}">${slide.cta.label}</button>` : ''}
        </div>
        ${this._slides.length > 1 ? this._renderDots() : ''}
      </div>`;

    if (hasCTA && ctaId) {
      const btn = document.getElementById(ctaId);
      if (btn) btn.addEventListener('click', slide.cta.action);
    }

    this._wireDots();
    this._animateIn();
  },

  _renderDots() {
    const total = this._slides.length;
    if (total <= 1) return '';
    let dots = '<div class="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">';
    for (let i = 0; i < total; i++) {
      const active = i === this._current;
      dots += `<button data-banner-dot="${i}" class="w-${active ? '5' : '1.5'} h-1.5 rounded-full transition-all duration-300 ${active ? 'bg-white' : 'bg-white/40'}" aria-label="Slide ${i + 1}"></button>`;
    }
    dots += '</div>';
    return dots;
  },

  _wireDots() {
    if (!this._container) return;
    this._container.querySelectorAll('[data-banner-dot]').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(dot.dataset.bannerDot, 10);
        if (!isNaN(idx)) {
          this._current = idx;
          this._render();
          this._resetRotation();
        }
      });
    });
  },

  _btnColor(gradient) {
    if (gradient.includes('#ef4444') || gradient.includes('#dc2626')) return '#dc2626';
    if (gradient.includes('#fbbf24') || gradient.includes('#f59e0b') || gradient.includes('#d97706')) return '#d97706';
    if (gradient.includes('#f97316')) return '#ea580c';
    if (gradient.includes('#f472b6') || gradient.includes('#f43f5e')) return '#e11d48';
    if (gradient.includes('#38bdf8') || gradient.includes('#2563eb')) return '#2563eb';
    if (gradient.includes('#34d399') || gradient.includes('#22c55e')) return '#16a34a';
    if (gradient.includes('#818cf8') || gradient.includes('#6366f1')) return '#4f46e5';
    if (gradient.includes('#8b5cf6') || gradient.includes('#7c3aed')) return '#7c3aed';
    return '#374151';
  },

  _animateIn() {
    if (!this._container) return;
    const inner = this._container.firstElementChild;
    if (!inner) return;
    inner.style.opacity = '0';
    inner.style.transform = 'translateX(20px)';
    requestAnimationFrame(() => {
      inner.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      inner.style.opacity = '1';
      inner.style.transform = 'translateX(0)';
    });
  },

  _startRotation() {
    if (this._timer) clearInterval(this._timer);
    if (this._slides.length <= 1) return;
    this._timer = setInterval(() => this._next(), SLIDE_INTERVAL);
  },

  _resetRotation() {
    this._startRotation();
  },

  _next() {
    if (this._slides.length === 0) return;
    this._current = (this._current + 1) % this._slides.length;
    this._render();
  },

  _refreshTimeSlides() {
    const hadTimeSlides = this._slides.some(s => s.id.startsWith('exit_') || s.id.startsWith('entry_'));
    this._collectSlides();
    if (hadTimeSlides || this._slides.some(s => s.id.startsWith('exit_') || s.id.startsWith('entry_'))) {
      this._render();
    }
  },

  _checkNewPosts() {
    const student = AppState.get('currentStudent');
    if (!student?.classroom_id) return;

    const now = Date.now();
    if (now - this._lastPostCheck < 25000) return;
    this._lastPostCheck = now;

    supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('classroom_id', student.classroom_id)
      .gt('created_at', new Date(Date.now() - 3600000).toISOString())
      .then(({ count }) => {
        const current = count || 0;
        if (current > this._lastPostCount && this._lastPostCount > 0) {
          AppState.set('unreadPostCount', current - this._lastPostCount);
          this._collectSlides();
          this._render();
        }
        this._lastPostCount = current;
      })
      .catch(() => {});
  },

  async _activatePush() {
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        await NotifyPermission._ensureOneSignalLinked(true);
        NotifyPermission._showSuccess();
        this._collectSlides();
        this._render();
      } else {
        Helpers.toast('Permiso de notificaciones denegado', 'warning');
      }
    } catch (e) {
      Helpers.toast('No se pudo activar: ' + e.message, 'error');
    }
  },
};

export { DynamicBanner };
