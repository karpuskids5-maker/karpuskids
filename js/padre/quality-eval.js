/**
 * QualityEval — Encuesta mensual de calidad (Panel de Padres)
 *
 * Muestra el periodo abierto, el bloque de preguntas activas y guarda la
 * respuesta completa con el RPC `quality_submit_survey`, que valida en el
 * servidor que el alumno sea de esta familia, que el periodo esté abierto y
 * que estén contestadas todas las preguntas.
 *
 * Reglas que este módulo respeta a propósito (propuesta.md):
 *  - No hay puntos, premios ni descuentos: responder no otorga nada.
 *  - Una sola respuesta por periodo. El UNIQUE del servidor lo garantiza; la
 *    UI solo refleja ese estado.
 *  - Los comentarios pueden enviarse de forma anónima.
 */

import { supabase } from '../shared/supabase.js';
import { AppState } from './appState.js';
import { Helpers } from './helpers.js';

const MONTHS = ['enero','febrero','marzo','abril','mayo','junio',
                'julio','agosto','septiembre','octubre','noviembre','diciembre'];

// Escala 1-5 compartida por todas las preguntas. Se explica una sola vez arriba
// para que el padre no tenga que descifrar la escala en cada pregunta.
const SCALE = [
  { value: 1, label: 'Muy insatisfecho', emoji: '😟' },
  { value: 2, label: 'Insatisfecho',     emoji: '🙁' },
  { value: 3, label: 'Neutral',           emoji: '😐' },
  { value: 4, label: 'Satisfecho',        emoji: '🙂' },
  { value: 5, label: 'Muy satisfecho',    emoji: '😄' },
];

const _state = {
  period: null,
  questions: [],
  answered: false,
  loaded: false,
};

const _answers = {
  scores: {},          // question_key -> 1..5
  overall: null,       // IGSM
  teacherComment: '',
  generalComment: '',
  anonymous: false,
};

// ── Utilidades ───────────────────────────────────────────────────────────────

function _monthLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Días que quedan para el cierre, contados desde hoy. */
function _daysLeft(closesAt) {
  if (!closesAt) return 0;
  const now = new Date();
  const end = new Date(closesAt);
  return Math.max(0, Math.ceil((end - now) / 86400000));
}

function _fullName(student) {
  if (!student) return 'tu hijo/a';
  return [student.name, student.last_name].filter(Boolean).join(' ') || 'tu hijo/a';
}

function _escape(text) {
  return Helpers.escapeHTML(text);
}

// ── Carga de estado ──────────────────────────────────────────────────────────

/**
 * Consulta el periodo abierto y si el alumno actual ya respondió.
 * Nunca lanza: un fallo aquí solo deja el banner oculto, no rompe el panel.
 */
async function _load() {
  _state.loaded = false;
  _state.period = null;
  _state.answered = false;
  _state.questions = [];

  const student = AppState.get('currentStudent');
  if (!student?.id) return;

  const { data, error } = await supabase.rpc('quality_open_period');
  if (error || !data) return;

  _state.period = data;

  const { data: qs, error: qErr } = await supabase
    .from('quality_questions')
    .select('id, block, question_key, prompt, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (qErr) return;
  _state.questions = qs || [];

  // ¿Ya respondió este alumno en este periodo? El RLS deja ver solo las propias.
  const { data: mine } = await supabase
    .from('quality_responses')
    .select('id')
    .eq('period_id', data.id)
    .eq('student_id', student.id)
    .maybeSingle();

  _state.answered = !!mine;
  _state.loaded = true;
}

/** Estado público para el banner dinámico. */
export async function status() {
  if (!_state.loaded) await _load();

  if (!_state.period) {
    return { open: false, pending: false };
  }
  return {
    open: true,
    pending: !_state.answered,
    period: _state.period,
    daysLeft: _daysLeft(_state.period.closes_at),
  };
}

// ── Modal ────────────────────────────────────────────────────────────────────

function _ensureModal() {
  if (document.getElementById('qualityEvalModal')) return;

  const el = document.createElement('div');
  el.id = 'qualityEvalModal';
  el.className = 'fixed inset-0 z-[210] hidden items-center justify-center p-3 sm:p-4';
  el.style.cssText = 'background:rgba(0,0,0,.45);backdrop-filter:blur(4px)';
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });
  el.innerHTML = `
    <div class="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
      <div class="p-5 sm:p-6 text-center shrink-0" style="background:linear-gradient(135deg,#6366f1,#4f46e5,#4338ca)">
        <div class="w-14 h-14 bg-white/25 backdrop-blur-md rounded-2xl flex items-center justify-center text-3xl mx-auto mb-3">💬</div>
        <h3 class="font-black text-white text-lg">Evaluación mensual</h3>
        <p class="text-white/80 text-xs font-bold mt-1" data-qe-subtitle></p>
      </div>
      <div class="p-5 sm:p-6 space-y-6 overflow-y-auto" data-qe-body></div>
      <div class="flex gap-3 p-5 sm:p-6 pt-0 shrink-0">
        <button type="button" data-qe-cancel
                class="flex-1 py-3 bg-slate-100 text-slate-600 font-black text-sm rounded-2xl hover:bg-slate-200 transition-all active:scale-95">Ahora no</button>
        <button type="button" data-qe-submit
                class="flex-[2] py-3 bg-indigo-600 text-white font-black text-sm rounded-2xl hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100">Enviar evaluación</button>
      </div>
    </div>`;

  document.body.appendChild(el);
  el.querySelector('[data-qe-cancel]').addEventListener('click', close);
  el.querySelector('[data-qe-submit]').addEventListener('click', submit);
}

function _scaleButtons() {
  return SCALE.map(s => `
    <button type="button" data-qe-scale="${s.value}" title="${s.label}"
            class="qe-scale-btn flex flex-col items-center gap-0.5 flex-1 py-2 rounded-xl border-2 border-slate-100 bg-slate-50 transition-all active:scale-95">
      <span class="text-xl leading-none">${s.emoji}</span>
      <span class="text-[9px] font-black text-slate-500">${s.value}</span>
    </button>`).join('');
}

function _questionCard(q, legend) {
  const val = _answers.scores[q.question_key];
  return `
    <div data-qe-q="${_escape(q.question_key)}" class="rounded-2xl border border-slate-100 p-4 bg-white">
      <p class="text-sm font-bold text-slate-700 leading-snug mb-1">${_escape(q.prompt)}</p>
      <p class="text-[10px] font-black text-slate-400 uppercase tracking-wide mb-3">${_escape(legend)}</p>
      <div class="flex gap-1.5" data-qe-scale-group>${_scaleButtons()}</div>
    </div>`;
}

function _paintBody() {
  const body = document.querySelector('[data-qe-body]');
  const period = _state.period;
  const student = AppState.get('currentStudent');
  const days = _daysLeft(period.closes_at);

  const blockA = _state.questions.filter(q => q.block === 'docente');
  const blockB = _state.questions.filter(q => q.block === 'institucion');

  body.innerHTML = `
    <p class="text-xs font-bold text-slate-500 bg-indigo-50 border border-indigo-100 rounded-xl p-3 leading-relaxed">
      Esta evaluación corresponde a <strong>${_escape(_monthLabel(period.period_month))}</strong> y se cierra
      el ${_escape(new Date(period.closes_at).toLocaleDateString('es-DO', { day: 'numeric', month: 'long' }))}.
      ${days > 0 ? `Te quedan <strong>${days} día${days === 1 ? '' : 's'}</strong>.` : 'Se cierra hoy.'}
    </p>

    ${blockA.length ? `
      <div class="space-y-3">
        <h4 class="text-xs font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
          <span class="w-1.5 h-4 bg-emerald-500 rounded-full"></span> Sobre la docente de ${_escape(_fullName(student))}
        </h4>
        ${blockA.map(q => _questionCard(q, 'Bloque A')).join('')}
      </div>` : ''}

    ${blockB.length ? `
      <div class="space-y-3">
        <h4 class="text-xs font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
          <span class="w-1.5 h-4 bg-indigo-500 rounded-full"></span> Sobre Karpus Kids
        </h4>
        ${blockB.map(q => _questionCard(q, 'Bloque B')).join('')}
      </div>` : ''}

    <div class="space-y-3">
      <h4 class="text-xs font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
        <span class="w-1.5 h-4 bg-amber-500 rounded-full"></span> En general
      </h4>
      <div data-qe-q="__overall" class="rounded-2xl border border-slate-100 p-4 bg-white">
        <p class="text-sm font-bold text-slate-700 leading-snug mb-1">
          ¿Qué tan satisfecho estás con el servicio de Karpus Kids este mes?
        </p>
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-wide mb-3">Indicador general (IGSM)</p>
        <div class="flex gap-1.5" data-qe-scale-group>${_scaleButtons()}</div>
      </div>
    </div>

    <div class="space-y-3">
      <h4 class="text-xs font-black text-slate-800 uppercase tracking-wide"> Comentarios (opcional)</h4>
      <div>
        <label class="text-[10px] font-black text-slate-500 uppercase ml-1">Sobre la docente</label>
        <textarea data-qe-field="teacherComment" rows="2" maxlength="600"
                  placeholder="¿Algo que quieras destacar sobre la atención de la docente?"
                  class="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 transition-all resize-none">${_escape(_answers.teacherComment)}</textarea>
      </div>
      <div>
        <label class="text-[10px] font-black text-slate-500 uppercase ml-1">Sobre el centro</label>
        <textarea data-qe-field="generalComment" rows="2" maxlength="600"
                  placeholder="Instalaciones, alimentación, comunicación, seguridad…"
                  class="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 transition-all resize-none">${_escape(_answers.generalComment)}</textarea>
      </div>
      <label class="flex items-start gap-2.5 p-3 bg-slate-50 border border-slate-100 rounded-2xl cursor-pointer">
        <input type="checkbox" data-qe-field="anonymous" ${_answers.anonymous ? 'checked' : ''}
               class="mt-0.5 w-4 h-4 accent-indigo-600 shrink-0">
        <span class="text-xs font-bold text-slate-600 leading-relaxed">
          Enviar mis comentarios de forma anónima.
          La Dirección los usará para mejorar sin ver quién los escribió.
        </span>
      </label>
    </div>

    <p class="text-[10px] font-bold text-slate-400 leading-relaxed text-center">
      Las respuestas se muestran a la Dirección de forma agregada. No hay puntos,
      descuentos ni premios por participar.
    </p>`;

  body.querySelectorAll('[data-qe-scale-group]').forEach(group => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-qe-scale]');
      if (!btn) return;
      const value = parseInt(btn.dataset.qeScale, 10);
      const card = btn.closest('[data-qe-q]');
      const key = card.dataset.qeQ;
      if (key === '__overall') _answers.overall = value;
      else _answers.scores[key] = value;
      card.querySelectorAll('.qe-scale-btn').forEach(b => {
        const on = parseInt(b.dataset.qeScale, 10) === value;
        b.classList.toggle('border-indigo-500', on);
        b.classList.toggle('bg-indigo-50', on);
        b.classList.toggle('border-slate-100', !on);
        b.classList.toggle('bg-slate-50', !on);
      });
    });
  });

  body.querySelectorAll('[data-qe-field]').forEach(field => {
    const key = field.dataset.qeField;
    field.addEventListener('input', () => {
      _answers[key] = field.type === 'checkbox' ? field.checked : field.value;
    });
  });

  // Reaplica la selección previa si el padre reabre el modal sin haber enviado.
  ['__overall', ...Object.keys(_answers.scores)].forEach(key => {
    const card = body.querySelector(`[data-qe-q="${key}"]`);
    const value = key === '__overall' ? _answers.overall : _answers.scores[key];
    if (!card || !value) return;
    card.querySelectorAll('.qe-scale-btn').forEach(b => {
      const on = parseInt(b.dataset.qeScale, 10) === value;
      b.classList.toggle('border-indigo-500', on);
      b.classList.toggle('bg-indigo-50', on);
      b.classList.toggle('border-slate-100', !on);
      b.classList.toggle('bg-slate-50', !on);
    });
  });
}

/** Abre la encuesta. Si ya se respondió, muestra el estado en vez del formulario. */
export async function open() {
  if (!_state.loaded) await _load();
  if (!_state.period) return;

  _ensureModal();
  const modal = document.getElementById('qualityEvalModal');
  const student = AppState.get('currentStudent');
  const days = _daysLeft(_state.period.closes_at);

  modal.querySelector('[data-qe-subtitle]').textContent =
    `${_monthLabel(_state.period.period_month)} · ${_fullName(student)}`;

  const body = modal.querySelector('[data-qe-body]');
  const submitBtn = modal.querySelector('[data-qe-submit]');
  const cancelBtn = modal.querySelector('[data-qe-cancel]');

  if (_state.answered) {
    // Ya respondió: el UNIQUE del servidor impediría un segundo envío, así que
    // no se ofrece el formulario para no tentar a un error.
    body.innerHTML = `
      <div class="text-center py-10 space-y-3">
        <div class="text-6xl">✅</div>
        <p class="font-black text-slate-800">Ya evaluaste este mes</p>
        <p class="text-sm font-bold text-slate-500 leading-relaxed px-6">
          Registramos tu respuesta de ${_escape(_monthLabel(_state.period.period_month))}.
          En el próximo periodo volverás a recibir la invitación.
        </p>
      </div>`;
    submitBtn.classList.add('hidden');
    cancelBtn.textContent = 'Cerrar';
  } else {
    _paintBody();
    submitBtn.classList.remove('hidden');
    cancelBtn.textContent = 'Ahora no';
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

export function close() {
  const modal = document.getElementById('qualityEvalModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

// ── Envío ────────────────────────────────────────────────────────────────────

async function submit() {
  const student = AppState.get('currentStudent');
  if (!student?.id || !_state.period) return;

  const submitBtn = document.querySelector('#qualityEvalModal [data-qe-submit]');
  const missing = _state.questions.filter(q => !_answers.scores[q.question_key]);
  if (!_answers.overall || missing.length) {
    Helpers.toast('Responde todas las preguntas y la calificación general.', 'warning');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Enviando…';

  const payload = _state.questions.map(q => ({
    question_key: q.question_key,
    score: _answers.scores[q.question_key],
  }));

  const { error } = await supabase.rpc('quality_submit_survey', {
    p_period_id: _state.period.id,
    p_student_id: student.id,
    p_overall_score: _answers.overall,
    p_teacher_comment: _answers.teacherComment,
    p_general_comment: _answers.generalComment,
    p_comment_anonymous: _answers.anonymous,
    p_answers: payload,
  });

  submitBtn.disabled = false;
  submitBtn.textContent = 'Enviar evaluación';

  if (error) {
    // 23505 = UNIQUE (period_id, student_id): el periodo ya estaba respondido.
    const duplicate = error.code === '23505';
    Helpers.toast(
      duplicate
        ? 'Ya registraste tu respuesta de este mes.'
        : `No se pudo enviar: ${error.message}`,
      duplicate ? 'info' : 'error'
    );
    if (duplicate) {
      _state.answered = true;
      close();
    }
    return;
  }

  _state.answered = true;
  Helpers.toast('¡Gracias por tu opinión!', 'success');
  close();
  // El banner dinámico escucha este evento para retirar la slide de la encuesta.
  document.dispatchEvent(new CustomEvent('quality-eval:sent'));
}

export const QualityEval = { init: _load, status, open, close, refresh: _load };
