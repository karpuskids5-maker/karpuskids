import { DirectorApi } from './api.js';
import { Helpers } from '../shared/helpers.js';
import { UIHelpers } from './ui.module.js';
import { AppState } from './state.js';

export const PaymentsModule = {
  settings: {
    due_day: 5,
    generation_day: 25
  },
  _financialChart: null,

  async init() {
    document.getElementById('btnRefreshPayments')?.addEventListener('click', () => this.loadPayments());
    document.getElementById('filterPaymentMonth')?.addEventListener('change', () => this.loadPayments());
    document.getElementById('filterPaymentYear')?.addEventListener('change', () => this.loadPayments());
    document.getElementById('filterPaymentStatus')?.addEventListener('change', () => this.loadPayments());
    document.getElementById('searchPaymentStudent')?.addEventListener('input', () => this.loadPayments());
    document.getElementById('btnNewPaymentAction')?.addEventListener('click', () => this.openPaymentModal());
    document.getElementById('btnGenerateCharges')?.addEventListener('click', () => this.generateCharges());
    
    await this.loadPayments();
  },

  filterBy(status) {
    const select = document.getElementById('filterPaymentStatus');
    if (select) {
      select.value = status;
      this.loadPayments();
    }
  },

  async openPaymentModal() {
    const inputClass = "w-full px-4 py-2.5 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-emerald-100 focus:border-emerald-400 bg-slate-50/50 transition-all text-sm font-medium";
    const labelClass = "block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5 ml-1";
    
    const modalHTML = `
      <div class="modal-header bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-6 rounded-t-3xl">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl shadow-inner">💰</div>
          <div>
            <h3 class="text-xl font-black">Registrar Pago</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Cobro Manual</p>
          </div>
        </div>
        <button onclick="App.ui.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors">
          <i data-lucide="x" class="w-6 h-6"></i>
        </button>
      </div>
      
      <div class="modal-body p-8 bg-slate-50/30" id="modalPayment">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <label class="${labelClass}">Estudiante</label>
            <select id="payStudentSelect" class="${inputClass}">
              <option value="">-- Seleccionar Estudiante --</option>
            </select>
          </div>
          
          <div>
            <label class="${labelClass}">Monto ($)</label>
            <input id="payAmount" type="number" step="0.01" class="${inputClass}" placeholder="0.00">
          </div>
          
          <div>
            <label class="${labelClass}">Método</label>
            <select id="payMethod" class="${inputClass}">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
            </select>
          </div>
          
          <div>
            <label class="${labelClass}">Estado</label>
            <select id="payStatus" class="${inputClass}">
              <option value="paid">Pagado</option>
              <option value="pending">Pendiente</option>
            </select>
          </div>
          
          <div>
            <label class="${labelClass}">Fecha Vencimiento (Si aplica)</label>
            <input id="payDueDate" type="date" class="${inputClass}">
          </div>
        </div>
      </div>
      
      <div class="modal-footer bg-white p-6 rounded-b-3xl border-t border-slate-100">
        <button onclick="App.ui.closeModal()" class="px-8 py-3 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
        <button id="btnSavePaymentAction" class="px-10 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-emerald-200 hover:shadow-emerald-300 hover:-translate-y-0.5 transition-all active:scale-95">Registrar Pago</button>
      </div>
    `;
    
    window.openGlobalModal(modalHTML);
    
    try {
      const { data: students } = await DirectorApi.getStudents();
      const select = document.getElementById('payStudentSelect');
      if (select && students) {
        students.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = `${s.name} (${s.classrooms?.name || 'Sin aula'})`;
          select.appendChild(opt);
        });
      }
    } catch (e) { console.error(e); }

    document.getElementById('btnSavePaymentAction')?.addEventListener('click', () => this.saveManualPayment());
    if (window.lucide) lucide.createIcons();
  },

  async saveManualPayment() {
    const studentId = document.getElementById('payStudentSelect')?.value;
    const amount = parseFloat(document.getElementById('payAmount')?.value || 0);
    const method = document.getElementById('payMethod')?.value || 'efectivo';
    const status = document.getElementById('payStatus')?.value || 'paid';
    const dueDate = document.getElementById('payDueDate')?.value;
    const paidDate = status === 'paid' ? new Date().toISOString() : null;

    if (!studentId || !amount || amount <= 0) return Helpers.toast('Faltan datos para registrar el pago', 'warning');

    UIHelpers.setLoading(true, '#modalPayment');
    try {
      const now = new Date();
      const payload = {
        student_id: studentId,
        amount,
        concept: 'Pago Manual',
        method,
        status,
        month_paid: now.toLocaleString('es-ES', { month: 'long' }),
        due_date: dueDate || null,
        paid_date: paidDate,
        created_at: now.toISOString()
      };

      const { data: payment, error } = await DirectorApi.createManualPayment(payload);
      if (error) throw error;

      Helpers.toast('Pago registrado correctamente', 'success');
      UIHelpers.closeModal();
      await this.loadPayments();

      if (payment?.id) {
        try {
          await DirectorApi.sendPaymentReceipt(payment.id, 'Gracias por su pago.');
          Helpers.toast('Recibo enviado por correo', 'success');
        } catch (e) { console.warn('Error enviando recibo:', e); }
      }
    } catch (e) {
      console.error(e);
      Helpers.toast('Error al guardar pago', 'error');
    } finally {
      UIHelpers.setLoading(false, '#modalPayment');
    }
  },

  async loadPayments() {
    const container = document.getElementById('paymentsTableBody');
    if (!container) return;
    container.innerHTML = '<tr><td colspan="8" class="text-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div></td></tr>';
    
    this.loadStats();
    this.loadIncomeChart();

    try {
      const month = document.getElementById('filterPaymentMonth')?.value;
      const year = document.getElementById('filterPaymentYear')?.value;
      const statusFilter = document.getElementById('filterPaymentStatus')?.value;
      const searchQuery = document.getElementById('searchPaymentStudent')?.value?.trim();

      const filters = { month, year, status: statusFilter, search: searchQuery };
      const { data: payments, error } = await DirectorApi.getPayments(filters);
      if (error) throw new Error(error);

      if (!payments || !payments.length) {
        container.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-slate-400">No se encontraron registros para este periodo.</td></tr>`;
        return;
      }

      const sortedPayments = [...payments].sort((a, b) => {
        const priority = { overdue: 1, pending: 2, review: 3, paid: 4 };
        const statusA = this.getPaymentStatus(a);
        const statusB = this.getPaymentStatus(b);
        return (priority[statusA] || 99) - (priority[statusB] || 99);
      });
      
      container.innerHTML = sortedPayments.map(p => this.renderPaymentRow(p)).join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('loadPayments error:', e);
      container.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-red-500">Error al cargar pagos.</td></tr>';
    }
  },

  getPaymentStatus(p) {
    if (p.status === 'paid') return 'paid';
    if (p.status === 'review' || (p.status === 'pending' && p.method === 'transferencia')) return 'review';

    const today = new Date();
    today.setHours(0,0,0,0);
    const dueDate = p.due_date ? new Date(p.due_date) : null;

    if (!dueDate) return 'pending';
    if (today.getTime() > dueDate.getTime()) return 'overdue';

    return 'pending';
  },

  renderPaymentRow(p) {
    const statusKey = this.getPaymentStatus(p);
    const statusMap = {
      paid: { label: 'Aprobado', class: 'bg-emerald-100 text-emerald-700', icon: 'check-circle' },
      pending: { label: 'Pendiente', class: 'bg-slate-100 text-slate-500', icon: 'clock' },
      review: { label: 'En Revisión', class: 'bg-amber-100 text-amber-700', icon: 'file-search' },
      overdue: { label: 'Vencido', class: 'bg-rose-100 text-rose-700', icon: 'alert-triangle' }
    };
    
    const status = statusMap[statusKey] || { label: p.status, class: 'bg-slate-100 text-slate-700', icon: 'help-circle' };
    const student = p.students || { name: 'Desconocido', classrooms: { name: 'Sin aula' } };
    const dueDateStr = p.due_date ? new Date(p.due_date).toLocaleDateString() : '—';

    return `
      <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
        <td class="px-6 py-4">
          <div class="font-bold text-slate-800">${Helpers.escapeHTML(student.name)}</div>
          <div class="text-[10px] text-slate-400 font-black uppercase tracking-tighter">${student.classrooms?.name || 'General'}</div>
        </td>
        <td class="px-6 py-4 text-center">
          <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black uppercase ${status.class} w-fit">
            <i data-lucide="${status.icon}" class="w-3 h-3"></i> ${status.label}
          </span>
        </td>
        <td class="px-6 py-4 text-right">
          <div class="font-black text-slate-700">$${(p.amount || 0).toLocaleString()}</div>
        </td>
        <td class="px-6 py-4">
          <span class="text-[10px] font-black uppercase text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">${p.method || '—'}</span>
        </td>
        <td class="px-6 py-4">
          <div class="text-[10px] font-bold text-slate-600 uppercase truncate max-w-[120px]">${p.bank || '—'}</div>
          <div class="text-[9px] text-slate-400 font-black uppercase tracking-tighter">${p.reference || ''}</div>
        </td>
        <td class="px-6 py-4">
          <div class="text-[11px] font-bold text-slate-600">${p.paid_date ? new Date(p.paid_date).toLocaleDateString() : dueDateStr}</div>
          <div class="text-[9px] text-slate-400 font-black uppercase tracking-tighter">${p.paid_date ? 'Pago' : 'Vencimiento'}</div>
        </td>
        <td class="px-6 py-4 text-center">
          ${p.evidence_url ? `<a href="${p.evidence_url}" target="_blank" class="text-sky-600 hover:underline text-xs font-bold uppercase">Ver</a>` : '—'}
        </td>
        <td class="px-6 py-4 text-center">
          <div class="flex justify-center gap-2">
            ${statusKey !== 'paid' ? `<button onclick="App.payments.markPaid('${p.id}')" class="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors shadow-sm" title="Aprobar"><i data-lucide="check" class="w-4 h-4"></i></button>` : ''}
            <button onclick="App.payments.delete('${p.id}')" class="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition-colors shadow-sm" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
          </div>
        </td>
      </tr>`;
  },

  async loadStats() {
    try {
      const { data } = await DirectorApi.getPaymentStats();
      if (data) {
        const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
        setTxt('kpiIncomeMonth', `$${data.incomeMonth.toLocaleString()}`);
        setTxt('kpiPendingCount', data.pending);
        setTxt('kpiOverdueCount', data.overdue);
        setTxt('kpiConfirmedCount', data.confirmed);
      }
    } catch (e) { console.error(e); }
  },

  async loadIncomeChart() {
    const canvas = document.getElementById('financialChart');
    if (!canvas || !window.Chart) return;
    
    try {
      const year = document.getElementById('filterPaymentYear')?.value || new Date().getFullYear();
      const { data: payments } = await DirectorApi.getPayments({ year, status: 'paid' });

      const labels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      const dataValues = new Array(12).fill(0);
      payments?.forEach(p => {
        const date = new Date(p.created_at);
        if (date.getFullYear() == year) dataValues[date.getMonth()] += (p.amount || 0);
      });

      if (this._financialChart) this._financialChart.destroy();
      this._financialChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Ingresos ($)',
            data: dataValues,
            backgroundColor: 'rgba(79, 70, 229, 0.2)',
            borderColor: 'rgb(79, 70, 229)',
            borderWidth: 2,
            borderRadius: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true } }
        }
      });
    } catch (e) { console.error(e); }
  },

  async markPaid(id) {
    try {
      await DirectorApi.updatePayment(id, { status: 'paid', paid_date: new Date().toISOString() });
      Helpers.toast('Pago aprobado', 'success');
      await this.loadPayments();
    } catch (e) { Helpers.toast('Error al aprobar pago', 'error'); }
  },

  async delete(id) {
    if (!confirm('¿Seguro que desea eliminar este pago?')) return;
    try {
      await DirectorApi.deletePayment(id);
      Helpers.toast('Pago eliminado');
      await this.loadPayments();
    } catch (e) { Helpers.toast('Error al eliminar pago', 'error'); }
  },

  async generateCharges() {
    try {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      if (!confirm(`¿Generar cuotas para ${new Date(currentYear, currentMonth - 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}?`)) return;

      Helpers.toast('Generando cuotas...', 'info');
      const { data, error } = await DirectorApi.generateMonthlyCharges(currentMonth, currentYear);
      if (error) throw error;

      Helpers.toast(`${data.created_count || 0} cuotas generadas`, 'success');
      await this.loadPayments();
    } catch (e) { Helpers.toast('Error al generar cuotas', 'error'); }
  }
};
