import { supabase, sendPush, sendEmail, emitEvent } from '../shared/supabase.js';
import { Api } from '../shared/api.js';
import { Helpers } from '../shared/helpers.js';
import { AppState } from './state.js';

/**
 * Módulo de Pagos para Asistente
 */
export const PaymentsModule = {
  _financialChart: null,

  async init() {
    const filter = document.getElementById('paymentMonthFilter');
    if (filter) {
      filter.onchange = () => this.loadPayments();
    }

    // ✅ MEJORA: Delegación de eventos para acciones en la tabla
    const tbody = document.getElementById('paymentsTableBody');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;

        const { action } = button.dataset;
        const id = button.dataset.id;
        const studentId = button.dataset.studentId;

        switch (action) {
          case 'confirm':
            this.confirmPayment(id);
            break;
          case 'reject':
            this.rejectPayment(id);
            break;
          case 'delete':
            this.deletePayment(id);
            break;
          case 'register':
            this.openModal(studentId);
            break;
        }
      });
    }

    const btnOpen = document.getElementById('btnOpenPaymentModal');
    if (btnOpen) btnOpen.onclick = () => this.openModal();

    const form = document.getElementById('paymentForm');
    if (form) form.onsubmit = (e) => this.handleSubmit(e);

    await this.loadPayments();
    await this.loadIncomeChart();
  },

  async loadIncomeChart() {
    const canvas = document.getElementById('incomeChart');
    if (!canvas || !window.Chart) return;

    try {
      const year = new Date().getFullYear();
      const { data: payments, error } = await supabase
        .from('payments')
        .select('amount, created_at, status')
        .in('status', ['confirmado', 'paid', 'efectivo'])
        .gte('created_at', `${year}-01-01`)
        .lte('created_at', `${year}-12-31`);

      if (error) throw error;

      const labels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      const dataValues = new Array(12).fill(0);

      payments?.forEach(p => {
        const date = new Date(p.created_at);
        if (date.getFullYear() === year) {
          dataValues[date.getMonth()] += (p.amount || 0);
        }
      });

      if (this._financialChart) this._financialChart.destroy();
      this._financialChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Ingresos ($)',
            data: dataValues,
            backgroundColor: 'rgba(13, 148, 136, 0.2)',
            borderColor: 'rgb(13, 148, 136)',
            borderWidth: 2,
            borderRadius: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              grid: { display: false }
            },
            x: {
              grid: { display: false }
            }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    } catch (e) {
      console.error('Error loadIncomeChart:', e);
    }
  },

  async loadPayments() {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="10" class="p-4">${Helpers.skeleton(3, 'h-12')}</td></tr>`;

    try {
      const selectedMonth = document.getElementById('paymentMonthFilter')?.value || 
                          new Date().toLocaleString('es-ES', { month: 'long' });

      // Obtener estudiantes y sus pagos del mes
      const [students, payments] = await Promise.all([
        supabase.from('students').select('id, name, parent_id').eq('is_active', true).order('name'),
        supabase.from('payments').select('*').eq('month_paid', selectedMonth)
      ]);

      if (students.error) throw students.error;
      if (payments.error) throw payments.error;

      // Mapear pagos (un pago por estudiante por mes)
      const paymentMap = {};
      (payments.data || []).forEach(p => {
        if (!paymentMap[p.student_id] || p.status === 'confirmado') {
          paymentMap[p.student_id] = p;
        }
      });

      // Construir lista de deudores y pagos
      const displayList = (students.data || []).map(st => {
        const pay = paymentMap[st.id];
        if (pay && pay.status === 'confirmado') return null; // Ocultar si ya pagó y está confirmado

        if (pay) {
          return { ...pay, students: { name: st.name, parent_id: st.parent_id } };
        } else {
          // Fila virtual para pendiente (sin registro en DB aún)
          return { 
            id: null, 
            student_id: st.id, 
            amount: 0, 
            month_paid: selectedMonth, 
            method: '-', 
            status: 'sin_pago', 
            bank: '-', 
            reference: '-', 
            transfer_date: '-', 
            evidence_url: null, 
            students: { name: st.name, parent_id: st.parent_id } 
          };
        }
      }).filter(Boolean);

      AppState.set('paymentsData', displayList);
      this.renderTable(displayList);

    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="10" class="text-center text-rose-500 py-4 font-bold text-sm">Error cargando pagos</td></tr>`;
    }
  },

  renderTable(payments) {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;

    if (!payments || !payments.length) {
      tbody.innerHTML = `<tr><td colspan="10">${Helpers.emptyState('Todos los estudiantes están al día')}</td></tr>`;
      return;
    }

    const badgeClass = (status) => {
      const map = {
        confirmado: 'bg-green-100 text-green-700',
        rechazado: 'bg-red-100 text-red-700',
        efectivo: 'bg-blue-100 text-blue-700',
        sin_pago: 'bg-slate-100 text-slate-500'
      };
      return map[status] || 'bg-amber-100 text-amber-700';
    };

    tbody.innerHTML = payments.map(p => {
      const isVirtual = !p.id;
      const statusLabel = p.status === 'sin_pago' ? 'Pendiente' : p.status;
      
      return `
        <tr class="hover:bg-slate-50 border-b border-slate-50 transition-colors">
          <td class="px-4 py-2 font-bold text-slate-700 text-sm">${p.students?.name || '—'}</td>
          <td class="px-4 py-2 text-slate-600 text-sm">${isVirtual ? '-' : '$'+p.amount}</td>
          <td class="px-4 py-2 text-slate-500 text-[10px] font-bold uppercase">${p.method || '-'}</td>
          <td class="px-4 py-2">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${badgeClass(p.status)}">
              ${statusLabel}
            </span>
          </td>
          <td class="px-4 py-2 text-slate-500 text-[10px]">${p.bank || '-'}</td>
          <td class="px-4 py-2 text-slate-500 text-[10px]">${p.reference || '-'}</td>
          <td class="px-4 py-2 text-slate-500 text-[10px]">${p.transfer_date || '-'}</td>
          <td class="px-4 py-2 text-slate-500 text-[10px] font-bold">${p.month_paid}</td>
          <td class="px-4 py-2">
            ${p.evidence_url ? `<a href="${p.evidence_url}" target="_blank" class="text-sky-600 font-bold text-[10px] uppercase hover:underline">Ver</a>` : '-'}
          </td>
          <td class="px-4 py-2 flex gap-2">
            ${!isVirtual ? `
              <button data-action="confirm" data-id="${p.id}" class="bg-emerald-50 text-emerald-600 p-1.5 rounded-lg hover:bg-emerald-100" title="Confirmar"><i data-lucide="check" class="w-4 h-4 pointer-events-none"></i></button>
              <button data-action="reject" data-id="${p.id}" class="bg-rose-50 text-rose-600 p-1.5 rounded-lg hover:bg-rose-100" title="Rechazar"><i data-lucide="x" class="w-4 h-4 pointer-events-none"></i></button>
              <button data-action="delete" data-id="${p.id}" class="text-slate-300 hover:text-rose-500 p-1.5" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i></button>
            ` : `
              <button data-action="register" data-student-id="${p.student_id}" class="bg-sky-50 text-sky-600 px-3 py-1 rounded-lg hover:bg-sky-100 font-bold text-[10px] uppercase">
                Registrar
              </button>
            `}
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  },

  async openModal(studentId = null) {
    const modal = document.getElementById('paymentModal');
    if (!modal) return;
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    const select = document.getElementById('studentSelect');
    if (select) {
      const students = await Api.getStudents();
      select.innerHTML = '<option value="" disabled selected>Seleccione un estudiante</option>' +
        students.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
      if (studentId) select.value = studentId;
    }
    
    const methodSel = document.getElementById('paymentMethod');
    const tf = document.getElementById('transferFields');
    if (methodSel && tf) {
      methodSel.onchange = () => {
        tf.style.display = methodSel.value === 'transferencia' ? 'block' : 'none';
      };
    }
  },

  async handleSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;

    try {
      const studentId = document.getElementById('studentSelect').value;
      const amount = document.getElementById('paymentAmount').value;
      const month = document.getElementById('paymentMonth').value;
      const method = document.getElementById('paymentMethod').value;
      const evidence = document.getElementById('paymentEvidence')?.files?.[0];

      let evidenceUrl = null;
      if (method === 'transferencia' && evidence) {
        const path = `${studentId}_${Date.now()}_${evidence.name}`;
        const { error: upErr } = await supabase.storage.from('payments_evidence').upload(path, evidence);
        if (upErr) throw upErr;
        
        const { data: signed } = await supabase.storage.from('payments_evidence').createSignedUrl(path, 60 * 60 * 24 * 7);
        evidenceUrl = signed?.signedUrl;
      }

      const { error } = await supabase.from('payments').insert({
        student_id: studentId,
        amount: Number(amount),
        month_paid: month,
        method,
        evidence_url: evidenceUrl,
        status: method === 'efectivo' ? 'efectivo' : 'pendiente',
        recorded_by: AppState.get('user').id
      });

      if (error) throw error;
      
      Helpers.toast('Pago registrado correctamente');
      document.getElementById('paymentModal').classList.add('hidden');
      await this.loadPayments();
    } catch (err) {
      console.error(err);
      Helpers.toast('Error al registrar pago', 'error');
    } finally {
      btn.disabled = false;
    }
  },

  // ✅ MEJORA: Lógica de negocio encapsulada en el módulo
  async confirmPayment(id) {
    if (!id) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('payments').update({ status: 'confirmado', validated_by: user.id }).eq('id', id);
    if (!error) {
      Helpers.toast('Pago confirmado');
      this.loadPayments();
    } else {
      Helpers.toast('Error al confirmar', 'error');
    }
  },

  async rejectPayment(id) {
    if (!id) return;
    // ✅ MEJORA UX: Usar un modal en lugar de un prompt
    const reason = prompt('Motivo del rechazo (opcional):');
    if (reason === null) return; // El usuario canceló el prompt

    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('payments').update({ status: 'rechazado', validated_by: user.id, notes: reason || null }).eq('id', id);
    if (!error) {
      Helpers.toast('Pago rechazado');
      this.loadPayments();
    } else {
      Helpers.toast('Error al rechazar', 'error');
    }
  },

  async deletePayment(id) {
    if (!id || !confirm('¿Seguro que desea eliminar este registro de pago?')) return;
    const { error } = await supabase.from('payments').delete().eq('id', id);
    if (!error) Helpers.toast('Pago eliminado');
    else Helpers.toast('Error al eliminar', 'error');
    this.loadPayments();
  }
};
