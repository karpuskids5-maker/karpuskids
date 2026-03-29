import { supabase } from '../shared/supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';

export const PaymentsModule = {
  _studentId: null,

  async init(studentId) {
    if (!studentId) return;
    this._studentId = studentId;

    // Config financiera
    const config = AppState.get('financeConfig');
    if (config) {
      const feeEl  = document.getElementById('paymentsMonthlyFee');
      const dueEl  = document.getElementById('paymentsDueDay');
      const dateEl = document.getElementById('paymentsDueDate');
      if (feeEl)  feeEl.textContent = Helpers.formatCurrency(config.monthly_fee || 0);
      if (dueEl)  dueEl.textContent = config.due_day || '-';
      if (dateEl) {
        const now    = new Date();
        const dueDay = config.due_day || 5;
        let dueDate  = new Date(now.getFullYear(), now.getMonth(), dueDay);
        if (dueDate <= now) dueDate = new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
        dateEl.textContent = dueDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
      }
    }

    // Registrar form UNA sola vez — resetear flag si el form fue reemplazado
    const form = document.getElementById('paymentForm');
    if (form) {
      // Siempre reasignar para evitar handlers duplicados
      form.onsubmit = (e) => this.submitPaymentProof(e);
    }

    await this.loadPayments();
  },

  async loadPayments() {
    const container = document.getElementById('paymentsHistory');
    if (!container) return;
    container.innerHTML = Helpers.skeleton(3, 'h-20');
    try {
      const { data, error } = await supabase
        .from(TABLES.PAYMENTS)
        .select('*') // Traemos todo para mayor contexto
        .eq('student_id', this._studentId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Deduplicar inteligentemente por mes
      // Si para un mismo mes hay un pago con evidencia y otro sin ella (cargo), priorizamos el de evidencia.
      const monthMap = new Map();
      (data || []).forEach(p => {
        const month = (p.month_paid || 'Varios').toLowerCase();
        const existing = monthMap.get(month);
        
        // Si no existe, lo añadimos
        if (!existing) {
          monthMap.set(month, p);
        } else {
          // Si ya existe, decidimos si el nuevo es "mejor"
          // Un pago con evidencia es mejor que un cargo puro
          const hasEvidence = p.evidence_url || p.proof_url;
          const existingHasEvidence = existing.evidence_url || existing.proof_url;
          
          if (hasEvidence && !existingHasEvidence) {
            monthMap.set(month, p);
          } else if (hasEvidence && existingHasEvidence) {
            // Si ambos tienen evidencia, nos quedamos con el más reciente
            if (new Date(p.created_at) > new Date(existing.created_at)) {
              monthMap.set(month, p);
            }
          }
          // Si ninguno tiene evidencia, nos quedamos con el más reciente (o el de mayor monto si fuera necesario)
        }
      });

      const payments = Array.from(monthMap.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      if (!payments.length) {
        container.innerHTML = Helpers.emptyState('No hay registros de pagos', '💳');
        return;
      }
      container.innerHTML = payments.map(p => this.renderPaymentCard(p)).join('');
    } catch (err) {
      console.error('Error loadPayments:', err);
      container.innerHTML = Helpers.emptyState('Error al cargar pagos', '❌');
    }
  },

  renderPaymentCard(p) {
    const hasEvidence = p.evidence_url || p.proof_url;
    
    // Mapeo dinámico de estados con lógica de "En Revisión"
    const statusMap = {
      paid:       { label: 'Aprobado',    cls: 'bg-emerald-100 text-emerald-700', icon: 'check-circle' },
      confirmado: { label: 'Aprobado',    cls: 'bg-emerald-100 text-emerald-700', icon: 'check-circle' },
      validado:   { label: 'Aprobado',    cls: 'bg-emerald-100 text-emerald-700', icon: 'check-circle' },
      pending:    { 
        label: hasEvidence ? 'En Revisión' : 'Pendiente de Pago', 
        cls: hasEvidence ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700',
        icon: hasEvidence ? 'clock' : 'alert-circle'
      },
      review:     { label: 'En Revisión', cls: 'bg-blue-100 text-blue-700', icon: 'clock' },
      overdue:    { label: 'Vencido',     cls: 'bg-rose-100 text-rose-700', icon: 'alert-triangle' }
    };

    const status = statusMap[p.status?.toLowerCase()] || { label: p.status || '-', cls: 'bg-slate-100 text-slate-600', icon: 'info' };
    const amount = Number(p.amount || 0);
    const methodIcon = p.method === 'transferencia' ? '🏦' : '💵';

    return `
      <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm hover:shadow-lg transition-all mb-4 group">
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-2xl ${hasEvidence ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'} flex items-center justify-center text-xl shadow-inner group-hover:scale-110 transition-transform">
              ${methodIcon}
            </div>
            <div>
              <p class="font-black text-slate-800 text-base leading-tight">${escapeHtml(p.month_paid || 'Colegiatura')}</p>
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                ${Helpers.formatDate(p.created_at)} • ${escapeHtml(p.method || 'Generado por Sistema')}
              </p>
            </div>
          </div>
          <div class="text-right">
            <p class="font-black text-slate-900 text-lg leading-none mb-2">${Helpers.formatCurrency(amount)}</p>
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ${status.cls}">
              <i data-lucide="${status.icon}" class="w-3 h-3"></i>
              ${status.label}
            </span>
          </div>
        </div>
        ${hasEvidence ? `
          <div class="mt-4 pt-4 border-t border-slate-50 flex justify-between items-center">
            <p class="text-[10px] font-bold text-slate-400 italic">Comprobante enviado. Esperando validación.</p>
            <a href="${p.evidence_url || p.proof_url}" target="_blank" class="text-[10px] font-black text-blue-600 hover:underline flex items-center gap-1">
              Ver adjunto <i data-lucide="external-link" class="w-3 h-3"></i>
            </a>
          </div>
        ` : ''}
      </div>
    `;
  },

  async submitPaymentProof(e) {
    e.preventDefault();
    const student = AppState.get('currentStudent');
    if (!student) return;

    const fileInput = document.getElementById('paymentFileInput');
    const file      = fileInput?.files[0];
    const amount    = parseFloat(document.getElementById('paymentAmount')?.value || '0');
    const monthEl   = document.getElementById('paymentMonth');
    const month     = monthEl?.value?.trim();
    const method    = document.getElementById('paymentMethod')?.value || 'transferencia';

    if (!file)   { Helpers.toast('Adjunta el comprobante', 'warning'); return; }
    if (!amount) { Helpers.toast('Ingresa el monto', 'warning'); return; }
    if (!month)  { Helpers.toast('Selecciona el mes', 'warning'); return; }
    if (file.size > 5 * 1024 * 1024) { Helpers.toast('Archivo muy grande (max 5MB)', 'error'); return; }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) { Helpers.toast('Formato no permitido (JPG, PNG, PDF)', 'error'); return; }

    const btn = document.getElementById('btnSubmitPayment');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

    try {
      Helpers.toast('Subiendo comprobante...', 'info');
      const ext      = file.name.split('.').pop().toLowerCase();
      const fileName = 'payments/' + student.id + '_' + Date.now() + '.' + ext;

      // Comprimir imagen antes de subir si es imagen (max 800px, calidad 0.8)
      let uploadFile = file;
      if (file.type.startsWith('image/')) {
        try {
          uploadFile = await this._compressImage(file, 800, 0.8);
        } catch (_) { uploadFile = file; } // fallback al original si falla
      }

      const { error: upErr } = await supabase.storage.from('classroom_media').upload(fileName, uploadFile);
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage.from('classroom_media').getPublicUrl(fileName);

      const { error } = await supabase.from(TABLES.PAYMENTS).insert({
        student_id:   student.id,
        amount,
        month_paid:   month,
        method,
        evidence_url: publicUrl,
        status:       'pending',
        created_at:   new Date().toISOString()
      });
      if (error) throw error;

      // Confirmación visual clara
      this._showSuccessConfirmation(amount, month);
      e.target.reset();
      await this.loadPayments();

      // Email completamente silencioso — no bloquea, no lanza error en consola
      setTimeout(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session) return;
          const url = (supabase.supabaseUrl || '') + '/functions/v1/send-email';
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify({ to: 'admin@karpuskids.com', subject: 'Nuevo Pago: ' + student.name, html: 'Pago de ' + Helpers.formatCurrency(amount) })
          }).catch(() => {});
        }).catch(() => {});
      }, 2000);

    } catch (err) {
      console.error('Upload Error:', err);
      Helpers.toast('Error al enviar el pago: ' + (err.message || ''), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar Comprobante'; }
    }
  }
};

// Métodos adicionales inyectados en PaymentsModule
Object.assign(PaymentsModule, {
  _compressImage(file, maxWidth = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          blob => blob ? resolve(new File([blob], file.name, { type: 'image/jpeg' })) : reject(new Error('Compresion fallida')),
          'image/jpeg', quality
        );
      };
      img.onerror = reject;
      img.src = url;
    });
  },

  _showSuccessConfirmation(amount, month) {
    const container = document.getElementById('paymentsHistory');
    if (!container) return;
    const banner = document.createElement('div');
    banner.className = 'bg-green-50 border-2 border-green-200 rounded-2xl p-4 mb-4 flex items-center gap-3';
    banner.innerHTML =
      '<div class="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center text-white text-xl flex-shrink-0">\u2705</div>' +
      '<div>' +
        '<p class="font-black text-green-800 text-sm">Comprobante enviado correctamente</p>' +
        '<p class="text-[10px] font-bold text-green-600 uppercase">' + Helpers.formatCurrency(amount) + ' \u2022 ' + month + ' \u2022 En revisi\u00F3n</p>' +
      '</div>';
    container.insertBefore(banner, container.firstChild);
    setTimeout(() => banner.remove(), 8000);
  }
});
