import { supabase } from '../shared/supabase.js';
import { AppState, TABLES, CacheKeys } from './appState.js';
import { Helpers, escapeHtml, sendEmail } from './helpers.js';

/**
 * 💰 MÓDULO DE PAGOS (PADRES)
 */
export const PaymentsModule = {
  _studentId: null,

  /**
   * Inicializa el módulo
   */
  async init(studentId) {
    if (!studentId) return;
    this._studentId = studentId;

    // Mostrar config financiera (monto mensual + día vencimiento)
    const config = AppState.get('financeConfig');
    if (config) {
      const feeEl = document.getElementById('paymentsMonthlyFee');
      const dueEl = document.getElementById('paymentsDueDay');
      if (feeEl) feeEl.textContent = Helpers.formatCurrency(config.monthly_fee || 0);
      if (dueEl) dueEl.textContent = config.due_day || '-';

      // Calcular próxima fecha de vencimiento
      const now = new Date();
      const dueDay = config.due_day || 5;
      let dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay);
      if (dueDate < now) dueDate = new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
      const dueDateEl = document.getElementById('paymentsDueDate');
      if (dueDateEl) dueDateEl.textContent = dueDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    // Configurar listeners de formulario (una sola vez)
    const form = document.getElementById('paymentForm');
    if (form && !form._initialized) {
      form.onsubmit = (e) => this.submitPaymentProof(e);
      form._initialized = true;
    }

    await this.loadPayments();
  },

  /**
   * Carga el historial de pagos
   */
  async loadPayments() {
    const container = document.getElementById('paymentsHistory');
    if (!container) return;
    
    container.innerHTML = Helpers.skeleton(3, 'h-24');

    try {
      const cacheKey = CacheKeys.payments(this._studentId);
      let data = AppState.getCache(cacheKey);

      if (!data) {
        const { data: freshData, error } = await supabase
          .from(TABLES.PAYMENTS)
          .select('*')
          .eq('student_id', this._studentId)
          .order('created_at', { ascending: false });
        
        if (error) throw error;
        data = freshData || [];
        AppState.setCache(cacheKey, data, 60000); // 1 min cache
      }

      if (!data.length) {
        container.innerHTML = Helpers.emptyState('No hay registros de pagos', '💳');
        return;
      }

      container.innerHTML = data.map(p => this.renderPaymentCard(p)).join('');
    } catch (err) {
      console.error('Error loadPayments:', err);
      container.innerHTML = Helpers.emptyState('Error al cargar pagos', '❌');
    }
  },

  /**
   * Renderiza una tarjeta de pago
   */
  renderPaymentCard(p) {
    const statusMap = {
      paid: { label: 'Aprobado', class: 'bg-emerald-100 text-emerald-700' },
      confirmado: { label: 'Aprobado', class: 'bg-emerald-100 text-emerald-700' },
      validado: { label: 'Aprobado', class: 'bg-emerald-100 text-emerald-700' },
      pending: { label: 'Pendiente', class: 'bg-amber-100 text-amber-700' },
      pendiente: { label: 'Pendiente', class: 'bg-amber-100 text-amber-700' },
      review: { label: 'En Revisión', class: 'bg-blue-100 text-blue-700' },
      overdue: { label: 'Vencido', class: 'bg-rose-100 text-rose-700' }
    };

    const status = statusMap[p.status?.toLowerCase()] || { label: p.status, class: 'bg-slate-100 text-slate-600' };
    const amount = Number(p.amount || 0);

    return `
      <div class="bg-white p-5 rounded-[2rem] border-2 border-slate-50 flex justify-between items-center shadow-sm hover:shadow-md transition-all animate-fade-in mb-4">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-xl shadow-inner">
            ${p.method === 'transferencia' ? '🏦' : '💵'}
          </div>
          <div>
            <p class="font-black text-slate-800 text-sm leading-tight">${escapeHtml(p.month_paid || 'Pago de Colegiatura')}</p>
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              ${Helpers.formatDate(p.created_at)} • ${escapeHtml(p.method || 'N/A')}
            </p>
          </div>
        </div>
        <div class="text-right">
          <p class="font-black text-slate-900 text-lg leading-none mb-2">${Helpers.formatCurrency(amount)}</p>
          <span class="text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-tighter ${status.class}">
            ${status.label}
          </span>
        </div>
      </div>
    `;
  },

  /**
   * Envía comprobante de pago
   */
  async submitPaymentProof(e) {
    e.preventDefault();
    const student = AppState.get('currentStudent');
    if (!student) return;

    const fileInput = document.getElementById('paymentFileInput');
    const file = fileInput?.files[0];
    const amount = parseFloat(document.getElementById('paymentAmount')?.value || '0');
    const month = document.getElementById('paymentMonth')?.value?.trim();
    const method = document.getElementById('paymentMethod')?.value;
    
    if (!file || !amount || !month) {
      Helpers.toast('Por favor completa todos los campos', 'warning');
      return;
    }
    
    // 🛡️ Validación de tamaño (Máx 5MB)
    if (file.size > 5 * 1024 * 1024) { 
      Helpers.toast('El archivo es muy grande (máx 5MB)', 'error'); 
      return; 
    }
    
    const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
    if (!allowed.includes(file.type)) {
      Helpers.toast('Formato no permitido (JPG, PNG, PDF)', 'error');
      return;
    }

    try {
      AppState.set('loading', true);
      Helpers.toast('Subiendo comprobante...', 'info');

      const ext = file.name.split('.').pop().toLowerCase();
      const fileName = `payments/${student.id}_${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('classroom_media')
        .upload(fileName, file);

      if (upErr) throw upErr;
      
      const { data: { publicUrl } } = supabase.storage
        .from('classroom_media')
        .getPublicUrl(fileName);
      
      const { error } = await supabase.from(TABLES.PAYMENTS).insert({
        student_id: student.id,
        amount,
        month_paid: month,
        method,
        evidence_url: publicUrl,
        status: 'pending',
        created_at: new Date().toISOString()
      });
      
      if (error) throw error;
      
      Helpers.toast('Comprobante enviado con éxito', 'success');
      AppState.clearCache(CacheKeys.payments(student.id)); // Invalidar caché
      
      e.target.reset();
      await this.loadPayments();

      // Notificar por email (Opcional)
      try {
        await sendEmail('admin@karpuskids.com', `Nuevo Pago: ${student.name}`, `Se recibió un pago de ${Helpers.formatCurrency(amount)}`);
      } catch(e) {}

    } catch (err) {
      console.error('Upload Error:', err);
      Helpers.toast('Error al enviar el pago', 'error');
    } finally {
      AppState.set('loading', false);
    }
  }
};
