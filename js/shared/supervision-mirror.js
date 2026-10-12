import { supabase } from '/js/shared/supabase.js';

const SUP_CTX_KEY = 'karpus_supervision_ctx_v1';
const DIRECTIVO_ROLES = ['directora', 'asistente', 'encargada', 'admin'];

const ROLE_STYLE = {
  directora: { color: '#0B63C7', badge: '👁️ MODO SUPERVISIÓN — Dirección' },
  asistente: { color: '#0D9488', badge: '👁️ MODO SUPERVISIÓN — Asistente' },
  encargada: { color: '#8B5CF6', badge: '👁️ MODO SUPERVISIÓN — Encargada' },
  admin:     { color: '#0B63C7', badge: '👁️ MODO SUPERVISIÓN — Administración' },
};

const SECTION_LABELS = {
  't-home': 'Mis Clases',
  't-chat': 'Chat',
  't-grades': 'Calificaciones',
  't-permits': 'Mis Permisos',
  't-profile': 'Mi Perfil',
};

function readCtx() {
  try { return JSON.parse(localStorage.getItem(SUP_CTX_KEY) || 'null'); } catch (_) { return null; }
}
function clearCtx() {
  try { localStorage.removeItem(SUP_CTX_KEY); } catch (_) {}
}

export const SupervisionMirror = {
  active: false,
  ctx: null,
  from: 'panel_directora.html',
  _clock: null,
  _sectionTimer: null,
  _fetchWrapped: false,

  detect() {
    if (this.active) return true;
    const ctx = readCtx();
    if (!ctx || !DIRECTIVO_ROLES.includes(ctx.role)) return false;
    this.ctx = ctx;
    this.active = true;
    const from = new URLSearchParams(window.location.search).get('from') || '';
    this.from = /panel_asistente\.html/.test(from) ? 'panel_asistente.html' : 'panel_directora.html';
    return true;
  },

  style() {
    return ROLE_STYLE[this.ctx?.role] || ROLE_STYLE.directora;
  },

  mount() {
    if (!this.active) return;
    const bar = document.getElementById('spv-supervision-bar');
    if (bar) return;

    const st = this.style();
    const ctx = this.ctx || {};

    const el = document.createElement('div');
    el.id = 'spv-supervision-bar';
    el.style.cssText = [
      'position:sticky;top:0;left:0;right:0;z-index:9998;',
      `background:${st.color};color:#fff;`,
      'display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;',
      'padding:8px 14px;box-shadow:0 2px 10px rgba(0,0,0,0.25);',
      'font-family:inherit;font-weight:700;font-size:12px;letter-spacing:0.2px;',
    ].join('');

    el.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,0.18);padding:3px 10px;border-radius:999px;white-space:nowrap;">
        ${st.badge}
      </span>
      <span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;">🏫 ${escapeHTML(ctx.classroomName || 'Aula')}</span>
      <span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;">👩‍🏫 ${escapeHTML(ctx.teacherName || '—')}</span>
      <span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-variant-numeric:tabular-nums;">⏱ <span id="spv-timer">00m 00s</span></span>
      <span style="display:inline-flex;align-items:center;gap:5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📍 <span id="spv-module">Módulo: Aula</span></span>
      <span style="flex:1;min-width:8px;"></span>
      <button id="spv-open" style="background:#fff;color:#dc2626;border:0;border-radius:999px;padding:6px 14px;font-weight:800;font-size:12px;cursor:pointer;font-family:inherit;">🔴 Registrar Intervención</button>
      <button id="spv-exit" style="background:rgba(0,0,0,0.25);color:#fff;border:1px solid rgba(255,255,255,0.5);border-radius:999px;padding:6px 14px;font-weight:800;font-size:12px;cursor:pointer;font-family:inherit;">🚪 Salir de Supervisión</button>
    `;
    document.body.insertBefore(el, document.body.firstChild);

    document.getElementById('spv-exit')?.addEventListener('click', () => { this.exit(); });
    document.getElementById('spv-open')?.addEventListener('click', () => { this.openIntervention(); });

    this._startClock();
    this._trackSection();
    this._wireFetch();

    document.title = 'Supervisión · ' + (ctx.classroomName || 'Aula');
    window.dispatchEvent(new CustomEvent('karpus:supervision-change', { detail: ctx }));
  },

  _startClock() {
    if (this._clock) clearInterval(this._clock);
    const started = this.ctx?.startedAt ? new Date(this.ctx.startedAt) : new Date();
    const tick = () => {
      const el = document.getElementById('spv-timer');
      if (!el) return;
      const diff = Math.max(0, Date.now() - started.getTime());
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      el.textContent = `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    };
    tick();
    this._clock = setInterval(tick, 1000);
  },

  _trackSection() {
    const label = document.getElementById('spv-module');
    const update = () => {
      if (!label) return;
      const active = document.querySelector('.section.active');
      const id = active?.id || '';
      label.textContent = 'Módulo: ' + (SECTION_LABELS[id] || 'Aula');
    };
    update();
    document.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-section]')) update();
    });
    this._sectionTimer = setInterval(update, 2000);
  },

  _wireFetch() {
    if (this._fetchWrapped) return;
    this._fetchWrapped = true;
    const original = window.fetch;
    window.__spvOriginalFetch = original;
    window.fetch = function (input, init) {
      try {
        const ctx = readCtx();
        if (ctx) {
          const headers = new Headers((init && init.headers) || (input && input.headers) || {});
          headers.set('X-Supervision-Active', 'true');
          if (ctx.sessionId) headers.set('X-Supervision-Session-Id', String(ctx.sessionId));
          if (ctx.classroomId) headers.set('X-Supervision-Classroom-Id', String(ctx.classroomId));
          if (ctx.teacherId) headers.set('X-Supervision-Teacher-Id', String(ctx.teacherId));
          init = Object.assign({}, init, { headers });
        }
      } catch (_) {}
      return original.apply(this, [input, init]);
    };
  },

  openIntervention() {
    if (!this.active) return;
    const ctx = this.ctx || {};
    const overlay = document.createElement('div');
    overlay.id = 'spv-intervention-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:18px;padding:20px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.35);font-family:inherit;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;">
          <h3 style="margin:0;font-size:16px;font-weight:800;color:#0f172a;">Registrar Intervención</h3>
          <button id="spv-int-close" style="background:#f1f5f9;border:0;border-radius:50%;width:30px;height:30px;font-size:14px;cursor:pointer;color:#64748b;">✕</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11px;font-weight:700;color:#64748b;margin-bottom:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;">
          <span>🏫 ${escapeHTML(ctx.classroomName || 'Aula')}</span>
          <span>·</span>
          <span>👩‍🏫 ${escapeHTML(ctx.teacherName || '—')}</span>
          <span>·</span>
          <span>👁️ ${escapeHTML(this.style().badge.replace('👁️ ', ''))}</span>
        </div>
        <label style="display:block;font-size:11px;font-weight:800;color:#334155;margin-bottom:4px;">Motivo / Título *</label>
        <input id="spv-int-title" type="text" placeholder="Ej. Almuerzo no registrado en el aula"
          style="width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:9px 12px;font-size:13px;font-family:inherit;margin-bottom:12px;outline:none;" />
        <label style="display:block;font-size:11px;font-weight:800;color:#334155;margin-bottom:4px;">Descripción / Instrucciones</label>
        <textarea id="spv-int-reason" rows="3" placeholder="Detalle de la acción requerida por la maestra..."
          style="width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:9px 12px;font-size:13px;font-family:inherit;margin-bottom:12px;outline:none;resize:vertical;"></textarea>
        <label style="display:block;font-size:11px;font-weight:800;color:#334155;margin-bottom:4px;">Prioridad</label>
        <select id="spv-int-priority" style="width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:9px 12px;font-size:13px;font-family:inherit;margin-bottom:16px;outline:none;">
          <option value="baja">🟢 Baja</option>
          <option value="media">🟡 Media</option>
          <option value="alta">🔴 Alta</option>
        </select>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button id="spv-int-cancel" style="background:#f1f5f9;color:#475569;border:0;border-radius:999px;padding:9px 16px;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;">Cancelar</button>
          <button id="spv-int-save" style="background:${this.style().color};color:#fff;border:0;border-radius:999px;padding:9px 18px;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;">Guardar Intervención</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#spv-int-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#spv-int-cancel')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#spv-int-save')?.addEventListener('click', async () => {
      const title = (overlay.querySelector('#spv-int-title')?.value || '').trim();
      const reason = (overlay.querySelector('#spv-int-reason')?.value || '').trim();
      const priorityRaw = overlay.querySelector('#spv-int-priority')?.value || 'media';
      if (!title) {
        overlay.querySelector('#spv-int-title')?.focus();
        return;
      }
      const priority = priorityRaw === 'critica' ? 'alta' : priorityRaw;
      try {
        await this._saveIntervention({ title, reason, priority });
      } catch (_) {}
      overlay.remove();
    });
  },

  async _saveIntervention({ title, reason, priority }) {
    const ctx = this.ctx || {};
    const profile = await this._getProfile();
    const row = {
      session_id: ctx.sessionId || null,
      classroom_id: ctx.classroomId || null,
      teacher_id: ctx.teacherId || null,
      supervisor_id: profile?.id || ctx.supervisorId || null,
      supervisor_role: ctx.role || 'directora',
      priority,
      status: 'abierta',
      category: 'pedagogica',
      reason: title,
      action_taken: reason || null,
      notes: null,
    };
    try {
      const { error } = await supabase.from('supervision_audits').insert(row).select('code').single();
      if (error) throw error;
      this._toast('Intervención registrada y auditada', 'success');
    } catch (_) {
      this._toast('No se pudo guardar en BD; revisa la migración 15', 'error');
    }
  },

  async _getProfile() {
    try {
      const { data, error } = await supabase.from('profiles').select('id, name, role').maybeSingle();
      if (error) return null;
      return data;
    } catch (_) { return null; }
  },

  async exit() {
    const ctx = this.ctx;
    if (ctx?.sessionId) {
      try {
        await supabase.from('supervision_sessions')
          .update({ status: 'closed', ended_at: new Date().toISOString() })
          .eq('id', ctx.sessionId);
      } catch (_) {}
    }
    if (this._clock) clearInterval(this._clock);
    if (this._sectionTimer) clearInterval(this._sectionTimer);
    if (window.__spvOriginalFetch) window.fetch = window.__spvOriginalFetch;
    clearCtx();
    this.active = false;
    window.location.href = this.from;
  },

  _toast(msg, kind = 'success') {
    if (typeof window.safeToast === 'function') {
      window.safeToast(msg, kind === 'success' ? 'success' : 'error');
      return;
    }
    alert(msg);
  },
};

function escapeHTML(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}