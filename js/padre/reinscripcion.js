/**
 * 🔁 Panel Padre — Módulo de Reinscripción
 *
 * Muestra el estado de la solicitud de reinscripción del estudiante
 * para el próximo año escolar (generada al activar el año) y permite
 * pagar el concepto «Reinscripción» con el mismo flujo de comprobantes.
 * Al aprobarse el pago, la directora valida y la reinscripción queda
 * aprobada automáticamente (backend).
 */
import { supabase } from '../shared/supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers } from './helpers.js';
import { emitEvent } from '../shared/supabase.js';

const CONCEPT = 'Reinscripción';

export const ReinscripcionModule = {
  _studentId: null,
  _data: null,

  async init(studentId) {
    if (!studentId) return;
    this._studentId = studentId;
    const content = document.getElementById('reenrollmentContent');
    if (!content) return;
    content.innerHTML = Helpers.skeleton(3, 'h-28');
    try {
      this._data = await this._load(studentId);
      content.innerHTML = this._render(this._data);
      if (window.lucide) lucide.createIcons();
      this._wire();
      this.checkBadge(studentId);
    } catch (err) {
      content.innerHTML = Helpers.emptyState('No se pudo cargar la reinscripción', 'alert-triangle');
    }
  },

  async _load(studentId) {
    const [enrRes, payRes, yearRes] = await Promise.allSettled([
      supabase
        .from('enrollments')
        .select(`
          id, type, status, classroom_id, payment_id, created_at, enrolled_at, notes,
          school_years:school_year_id(name, status, reenrollment_end, end_date),
          classrooms:classroom_id(name, level)
        `)
        .eq('student_id', studentId)
        .eq('type', 'reenrollment')
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from(TABLES.PAYMENTS)
        .select('id, amount, status, due_date, evidence_url, proof_url, method, bank, created_at, notes')
        .eq('student_id', studentId)
        .eq('concept', CONCEPT)
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('school_years')
        .select('id, name, status, reenrollment_start, reenrollment_end')
        .order('start_date', { ascending: false })
        .limit(3),
    ]);

    const enrollments = enrRes.status === 'fulfilled' ? (enrRes.value.data || []) : [];
    const payments = payRes.status === 'fulfilled' ? (payRes.value.data || []) : [];
    const years = yearRes.status === 'fulfilled' ? (yearRes.value.data || []) : [];

    // Mapa: payment_id -> pago (para cruzar estado)
    const payById = new Map();
    payments.forEach(p => { if (p.id != null) payById.set(String(p.id), p); });
    enrollments.forEach(e => {
      const pay = e.payment_id != null ? payById.get(String(e.payment_id)) : undefined;
      e._payment = pay || null;
    });

    // Pagos de reinscripción que no están ligados a un enrollment cargado
    const linked = new Set(enrollments.map(e => e.payment_id != null ? String(e.payment_id) : null).filter(Boolean));
    const orphanPayments = payments.filter(p => !linked.has(String(p.id)));

    return { enrollments, payments, years, orphanPayments };
  },

  _mainEnrollment(data) {
    // Priorizar la solicitud más reciente pendiente/aprobada; si hay varias, la primera de la lista.
    const enr = data.enrollments || [];
    if (!enr.length) return null;
    const pending = enr.find(e => e.status === 'pending');
    return pending || enr[0];
  },

  _badge(status) {
    const map = {
      approved: { label: 'Aprobada', cls: 'bg-emerald-100 text-emerald-700', icon: 'check-circle-2' },
      rejected: { label: 'Rechazada', cls: 'bg-rose-100 text-rose-700', icon: 'x-circle' },
      pending:  { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700', icon: 'clock' },
    };
    const sc = map[status] || map.pending;
    return `<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black uppercase ${sc.cls}">
      <i data-lucide="${sc.icon}" class="w-3 h-3"></i>${sc.label}</span>`;
  },

  _paymentBadge(p) {
    const map = {
      paid:     { label: 'Pago aprobado', cls: 'bg-emerald-100 text-emerald-700', icon: 'check-circle-2' },
      review:   { label: 'Comprobante en revisión', cls: 'bg-blue-100 text-blue-700', icon: 'clock' },
      overdue:  { label: 'Vencido', cls: 'bg-rose-100 text-rose-700', icon: 'alert-triangle' },
      rejected: { label: 'Pago rechazado', cls: 'bg-rose-100 text-rose-700', icon: 'x-circle' },
      pending:  { label: 'Pago pendiente', cls: 'bg-amber-100 text-amber-700', icon: 'alert-circle' },
    };
    const sc = map[(p?.status || 'pending').toLowerCase()] || map.pending;
    return `<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black uppercase ${sc.cls}">
      <i data-lucide="${sc.icon}" class="w-3 h-3"></i>${sc.label}</span>`;
  },

  _render(data) {
    const esc = Helpers.escapeHTML;
    const main = this._mainEnrollment(data);
    const currentYear = (data.years || []).find(y => ['active', 'enrollment', 'reenrollment'].includes(y.status));

    // ── Sin solicitudes → estado vacío ─────────────────────────
    if (!main) {
      return `
        <div class="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center">
          <div class="w-16 h-16 bg-amber-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <i data-lucide="refresh-cw" class="w-8 h-8 text-amber-500"></i>
          </div>
          <h3 class="text-lg font-black text-slate-800 mb-2">Aún no hay una solicitud de reinscripción</h3>
          <p class="text-sm text-slate-500 font-medium max-w-md mx-auto">
            La directora genera las solicitudes de reinscripción al activar el nuevo año escolar.
            En cuanto esté disponible la verás aquí, junto con el pago de «Reinscripción».
          </p>
          ${currentYear
            ? `<p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-4">Año escolar actual: ${esc(currentYear.name)}</p>`
            : ''}
        </div>
        ${this._renderHistory(data)}`;
    }

    // ── Detalle de la solicitud principal ──────────────────────
    const sy = Array.isArray(main.school_years) ? main.school_years[0] : main.school_years;
    const cls = Array.isArray(main.classrooms) ? main.classrooms[0] : main.classrooms;
    const pay = main._payment;
    const yearName = sy?.name || 'próximo año escolar';

    let actionBlock = '';
    if (main.status === 'approved') {
      actionBlock = `
        <div class="bg-emerald-50 border border-emerald-200 rounded-3xl p-6 flex items-start gap-4">
          <div class="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center shrink-0">
            <i data-lucide="check" class="w-6 h-6 text-white"></i>
          </div>
          <div>
            <h4 class="font-black text-emerald-800 text-base">¡Reinscripción aprobada!</h4>
            <p class="text-sm text-emerald-700 font-medium mt-1">
              ${esc(main.student_name || 'Tu hijo(a)')} quedó reinscrito para el año escolar ${esc(yearName)}.
            </p>
            ${main.enrolled_at
              ? `<p class="text-[11px] font-bold text-emerald-600 uppercase tracking-widest mt-2">Aprobado el ${new Date(main.enrolled_at).toLocaleDateString('es-DO')}</p>`
              : ''}
          </div>
        </div>`;
    } else if (main.status === 'rejected') {
      actionBlock = `
        <div class="bg-rose-50 border border-rose-200 rounded-3xl p-6 flex items-start gap-4">
          <div class="w-12 h-12 bg-rose-500 rounded-2xl flex items-center justify-center shrink-0">
            <i data-lucide="x-circle" class="w-6 h-6 text-white"></i>
          </div>
          <div>
            <h4 class="font-black text-rose-800 text-base">Reinscripción rechazada</h4>
            <p class="text-sm text-rose-700 font-medium mt-1">
              La solicitud para el año escolar ${esc(yearName)} fue rechazada.
              ${main.notes ? esc(' Motivo: ' + main.notes) : 'Contacta a la directora para más información.'}
            </p>
          </div>
        </div>`;
    } else {
      // PENDIENTE → estado del pago
      const payStatus = (pay?.status || '').toLowerCase();

      if (!pay) {
        actionBlock = `
          <div class="bg-amber-50 border border-amber-200 rounded-3xl p-6 flex items-start gap-4">
            <div class="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center shrink-0">
              <i data-lucide="refresh-cw" class="w-6 h-6 text-white"></i>
            </div>
            <div>
              <h4 class="font-black text-amber-900 text-base">Reinscripción en proceso</h4>
              <p class="text-sm text-amber-800 font-medium mt-1">
                Tu solicitud de reinscripción está pendiente. En breve verás aquí el pago de «Reinscripción»
                para completar el proceso.
              </p>
            </div>
          </div>`;
      } else if (payStatus === 'pending' || payStatus === 'overdue') {
        actionBlock = this._renderPaymentAction(main, pay);
      } else if (payStatus === 'review') {
        actionBlock = `
          <div class="bg-blue-50 border border-blue-200 rounded-3xl p-6 flex items-start gap-4">
            <div class="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center shrink-0">
              <i data-lucide="clock" class="w-6 h-6 text-white"></i>
            </div>
            <div>
              <h4 class="font-black text-blue-800 text-base">Comprobante en revisión</h4>
              <p class="text-sm text-blue-700 font-medium mt-1">
                Ya enviamos tu comprobante de «Reinscripción». La directora lo revisará y
                la solicitud se aprobará automáticamente al validar el pago.
              </p>
              ${pay.evidence_url ? `<a href="${esc(pay.evidence_url)}" target="_blank" class="inline-flex items-center gap-1 text-[11px] font-black text-blue-600 hover:underline mt-2">Ver comprobante <i data-lucide="external-link" class="w-3 h-3"></i></a>` : ''}
            </div>
          </div>`;
      } else if (payStatus === 'rejected') {
        actionBlock = this._renderPaymentAction(main, pay);
      } else if (payStatus === 'paid') {
        actionBlock = `
          <div class="bg-emerald-50 border border-emerald-200 rounded-3xl p-6 flex items-start gap-4">
            <div class="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center shrink-0">
              <i data-lucide="credit-card" class="w-6 h-6 text-white"></i>
            </div>
            <div>
              <h4 class="font-black text-emerald-800 text-base">Pago de reinscripción realizado</h4>
              <p class="text-sm text-emerald-700 font-medium mt-1">
                Tu pago fue aprobado. La solicitud de reinscripción quedará confirmada de inmediato.
              </p>
            </div>
          </div>`;
      } else {
        actionBlock = this._renderPaymentAction(main, pay);
      }
    }

    const mainCard = `
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div class="bg-gradient-to-r from-amber-500 to-orange-500 p-6 text-white">
          <div class="flex items-center justify-between flex-wrap gap-3">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                <i data-lucide="refresh-cw" class="w-6 h-6"></i>
              </div>
              <div>
                <p class="text-[10px] font-black uppercase tracking-widest text-white/70">Reinscripción escolar</p>
                <h3 class="text-xl font-black">Año escolar ${esc(yearName)}</h3>
              </div>
            </div>
            ${this._badge(main.status)}
          </div>
          ${cls ? `<p class="text-sm font-bold text-white/90 mt-3 flex items-center gap-2"><i data-lucide="school" class="w-4 h-4"></i> Aula asignada: ${esc(cls.name)}${cls.level ? ' · ' + esc(cls.level) : ''}</p>` : ''}
        </div>
        <div class="p-6">
          ${actionBlock}
          ${main._payment ? `
            <div class="mt-4 bg-slate-50 rounded-2xl border border-slate-100 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Concepto</p>
                <p class="font-black text-slate-800 text-sm">${CONCEPT}</p>
              </div>
              <div>
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Monto</p>
                <p class="font-black text-slate-800 text-sm">${Helpers.formatCurrency(main._payment.amount)}</p>
              </div>
              ${main._payment.due_date ? `
              <div>
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Vence</p>
                <p class="font-black text-slate-800 text-sm">${new Date(main._payment.due_date + 'T00:00:00').toLocaleDateString('es-DO')}</p>
              </div>` : ''}
              <div>${this._paymentBadge(main._payment)}</div>
            </div>` : ''}
        </div>
      </div>`;

    return `${mainCard}${this._renderHistory(data)}`;
  },

  _renderPaymentAction(enr, pay) {
    const esc = Helpers.escapeHTML;
    const amount = Number(pay?.amount || 0);
    const due = pay?.due_date;
    const isRejected = (pay?.status || '').toLowerCase() === 'rejected';

    return `
      <div class="bg-amber-50 border border-amber-200 rounded-3xl p-6">
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center shrink-0">
            <i data-lucide="banknote" class="w-6 h-6 text-white"></i>
          </div>
          <div class="flex-1 min-w-0">
            <h4 class="font-black text-amber-900 text-base">Pagar reinscripción</h4>
            <p class="text-sm text-amber-800 font-medium mt-1">
              Realiza la transferencia a la cuenta de la escuela por el monto de <strong>${Helpers.formatCurrency(amount)}</strong>
              ${due ? 'antes del <strong>' + new Date(due + 'T00:00:00').toLocaleDateString('es-DO') + '</strong>' : ''}
              y sube el comprobante. Al validarlo, la reinscripción se aprueba automáticamente.
            </p>
            ${isRejected ? '<p class="text-[11px] font-black text-rose-600 uppercase tracking-widest mt-1">El pago anterior fue rechazado. Envía un nuevo comprobante.</p>' : ''}
          </div>
        </div>

        <form id="reenrollmentForm" class="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold text-amber-900/70 uppercase tracking-wider mb-1">Monto a pagar</label>
            <div class="relative">
              <span class="absolute left-4 top-3 text-amber-800/60 font-bold">$</span>
              <input type="text" id="reenrollmentAmount" value="${amount.toFixed(2)}" readonly
                class="w-full pl-8 p-3 border-none rounded-2xl bg-white/70 focus:ring-2 focus:ring-amber-400 outline-none transition-all font-bold text-slate-700 cursor-not-allowed">
            </div>
            <p class="text-[10px] text-amber-700/70 italic mt-1">Monto establecido por la escuela.</p>
          </div>
          <div>
            <label class="block text-xs font-bold text-amber-900/70 uppercase tracking-wider mb-1">Banco de origen <span class="text-rose-400">*</span></label>
            <select id="reenrollmentBank" class="w-full p-3 border-none rounded-2xl bg-white/70 focus:ring-2 focus:ring-amber-400 outline-none transition-all font-medium text-slate-700" required>
              <option value="">Seleccionar banco...</option>
              <option value="Banreservas">Banreservas</option>
              <option value="Banco Popular Dominicano">Banco Popular Dominicano</option>
              <option value="Banco BHD">Banco BHD</option>
              <option value="Banco Santa Cruz">Banco Santa Cruz</option>
              <option value="Banco Caribe">Banco Caribe</option>
              <option value="Banco Vimenca">Banco Vimenca</option>
              <option value="Banco BDI">Banco BDI</option>
              <option value="Scotiabank">Scotiabank</option>
              <option value="Otro">Otro</option>
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-bold text-amber-900/70 uppercase tracking-wider mb-1">Comprobante <span class="text-rose-400">*</span></label>
            <input type="file" id="reenrollmentFileInput" accept="image/png,image/jpeg,image/webp,application/pdf"
              class="w-full text-sm text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-amber-500 file:text-white hover:file:bg-amber-600 transition-all cursor-pointer shadow-md" required>
            <p class="text-[10px] text-amber-700/70 italic mt-1">Puedes tomar una foto o seleccionar una de tu galería.</p>
          </div>
          <button id="btnSubmitReenrollment" type="submit"
            class="md:col-span-2 w-full py-3.5 rounded-2xl font-bold bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-200 transition-all active:scale-95 flex items-center justify-center gap-2">
            <i data-lucide="send" class="w-4 h-4"></i> Enviar comprobante de reinscripción
          </button>
        </form>
      </div>`;
  },

  _renderHistory(data) {
    const esc = Helpers.escapeHTML;
    const enrollments = (data.enrollments || []).filter(e => e.status !== 'pending');
    if (!enrollments.length && !data.orphanPayments.length) return '';

    const rows = [
      ...enrollments.map(e => {
        const sy = Array.isArray(e.school_years) ? e.school_years[0] : e.school_years;
        return `
          <div class="flex items-center justify-between gap-3 p-4 rounded-2xl bg-white border border-slate-100">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                <i data-lucide="graduation-cap" class="w-4 h-4"></i>
              </div>
              <div class="min-w-0">
                <p class="text-xs font-black text-slate-800 truncate">${esc(sy?.name || 'Año escolar #' + e.school_year_id)}</p>
                <p class="text-[10px] font-bold text-slate-400 uppercase">${e.enrolled_at ? 'Aprobado el ' + new Date(e.enrolled_at).toLocaleDateString('es-DO') : ''}</p>
              </div>
            </div>
            ${this._badge(e.status)}
          </div>`;
      }),
      ...data.orphanPayments.map(p => `
        <div class="flex items-center justify-between gap-3 p-4 rounded-2xl bg-white border border-slate-100">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <i data-lucide="credit-card" class="w-4 h-4"></i>
            </div>
            <div class="min-w-0">
              <p class="text-xs font-black text-slate-800 truncate">${CONCEPT}</p>
              <p class="text-[10px] font-bold text-slate-400 uppercase">${Helpers.formatCurrency(p.amount)}</p>
            </div>
          </div>
          ${this._paymentBadge(p)}
        </div>`),
    ];

    return `
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
        <h3 class="text-xs font-black text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2">
          <i data-lucide="history" class="w-4 h-4 text-slate-400"></i> Historial de reinscripciones
        </h3>
        <div class="space-y-2.5">${rows.join('')}</div>
      </div>`;
  },

  _wire() {
    const form = document.getElementById('reenrollmentForm');
    if (form) form.onsubmit = (e) => this._submitProof(e);
  },

  async _submitProof(e) {
    if (e && e.preventDefault) e.preventDefault();

    const student = AppState.get('currentStudent');
    const main = this._mainEnrollment(this._data);
    const pay = main?._payment;
    if (!student || !main || !pay) return;

    const { checkRateLimit, paymentProofLimiter } = await import('../shared/rate-limiter.js');
    if (!checkRateLimit(paymentProofLimiter, 'enviar comprobantes de reinscripción')) return;

    const fileInput = document.getElementById('reenrollmentFileInput');
    const file = fileInput?.files[0];
    const bank = document.getElementById('reenrollmentBank')?.value?.trim();

    if (!file) { Helpers.toast('Adjunta el comprobante', 'warning'); return; }
    if (!bank) { Helpers.toast('Selecciona el banco de origen', 'warning'); return; }
    if (file.size > 5 * 1024 * 1024) { Helpers.toast('Archivo muy grande (máx 5MB)', 'error'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) {
      Helpers.toast('Formato no permitido (JPG, PNG, PDF)', 'error'); return;
    }

    const btn = document.getElementById('btnSubmitReenrollment');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

    try {
      Helpers.toast('Subiendo comprobante...', 'info');
      const ext = file.name.split('.').pop().toLowerCase();
      const path = `reenrollment/${student.id}_${Date.now()}.${ext}`;
      let uploadFile = file;

      if (file.type.startsWith('image/')) {
        try {
          const { ImageLoader } = await import('../shared/image-loader.js');
          uploadFile = await ImageLoader.compress(file, { maxWidth: 1000, maxHeight: 1000, quality: 0.8, maxSizeKB: 400 });
        } catch (_) {}
      }

      const { error: upErr } = await supabase.storage.from('classroom_media').upload(path, uploadFile, {
        upsert: true,
      });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage.from('classroom_media').getPublicUrl(path);

      const { error: updateErr } = await supabase
        .from(TABLES.PAYMENTS)
        .update({
          evidence_url: publicUrl,
          proof_url: publicUrl,
          status: 'review',
          method: 'transferencia',
          bank,
        })
        .eq('id', pay.id);
      if (updateErr) throw updateErr;

      if (window.confetti) {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#f59e0b', '#10b981', '#3b82f6'],
        });
      }

      Helpers.toast('Comprobante enviado. La directora lo revisará.', 'success');
      emitEvent('payment.receipt_uploaded', {
        student_id: student.id,
        student_name: student.name,
        amount: String(pay.amount || 0),
        month: 'Reinscripción',
      }).catch(() => {});

      await this.init(student.id);
    } catch (err) {
      Helpers.toast('Error al enviar: ' + (err.message || 'Error desconocido'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar comprobante de reinscripción'; }
    }
  },

  /**
   * 🔴 Badge del menú: mostrar un punto si hay reinscripción pendiente sin pago aprobado.
   */
  async checkBadge(studentId) {
    const badge = document.getElementById('badge-reenrollment');
    if (!badge || !studentId) return;
    try {
      const { data } = await supabase
        .from('enrollments')
        .select('id, status, payment_id, payments:payment_id(status)')
        .eq('student_id', studentId)
        .eq('type', 'reenrollment')
        .order('created_at', { ascending: false })
        .limit(3);
      const hasPending = (data || []).some(e => {
        const pay = Array.isArray(e.payments) ? e.payments[0] : e.payments;
        return e.status === 'pending' && (!pay || (pay.status || 'pending').toLowerCase() !== 'paid');
      });
      badge.classList.toggle('hidden', !hasPending);
      badge.classList.toggle('flex', hasPending);
    } catch (_) {}
  },
};

window.ReinscripcionModule = ReinscripcionModule;
