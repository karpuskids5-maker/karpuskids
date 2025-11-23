document.addEventListener('DOMContentLoaded', ()=>{
  if(!window.KarpusStore) return;

  const container = document.querySelector('main') || document.body;
  const section = document.createElement('section');
  section.id = 'improvementSection';
  section.className = 'mt-6';

  function renderPlans(){
    const plans = KarpusStore.getImprovementPlans();
    section.innerHTML = `
      <div class="p-4 rounded-3xl bg-white border shadow-soft">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-lg font-semibold">Plan de Mejora</h2>
          <button id="btnAddPlan" class="px-3 py-1 rounded-xl bg-karpus-blue text-white text-sm">Agregar</button>
        </div>
        <div id="plansList" class="space-y-2"></div>
      </div>
    `;
    const list = section.querySelector('#plansList');
    list.innerHTML = '';
    plans.forEach(pl=>{
      const row = document.createElement('div');
      row.className = 'p-3 rounded-xl border bg-white';
      row.innerHTML = `<p class=\"text-sm\"><strong>${pl.title}</strong> — Aula: ${pl.class} — Responsable: ${pl.owner}</p>
                       <p class=\"text-xs text-slate-600\">Acciones: ${pl.actions}</p>
                       <p class=\"text-xs text-slate-500\">Vence: ${pl.due} • Estado: ${pl.status||'Pendiente'}</p>`;
      list.appendChild(row);
    });

    section.querySelector('#btnAddPlan')?.addEventListener('click', openModal);
  }

  function openModal(){
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class=\"bg-white rounded-2xl p-4 w-full max-w-md\">
        <h3 class=\"text-base font-semibold mb-2\">Nuevo Plan de Mejora</h3>
        <div class=\"space-y-2\">
          <select id=\"planClass\" class=\"w-full border rounded-xl p-2 text-sm\">
            <option value=\"Pequeños\">Pequeños</option>
            <option value=\"Medianos\">Medianos</option>
            <option value=\"Grandes\">Grandes</option>
          </select>
          <input id=\"planTitle\" class=\"w-full border rounded-xl p-2 text-sm\" placeholder=\"Título\" />
          <textarea id=\"planActions\" class=\"w-full border rounded-xl p-2 text-sm\" placeholder=\"Acciones\"></textarea>
          <input id=\"planOwner\" class=\"w-full border rounded-xl p-2 text-sm\" placeholder=\"Responsable\" />
          <input id=\"planDue\" type=\"date\" class=\"w-full border rounded-xl p-2 text-sm\" />
        </div>
        <div class=\"mt-3 flex justify-end gap-2\">
          <button id=\"closePlanModal\" class=\"px-3 py-1 rounded-xl border text-sm\">Cancelar</button>
          <button id=\"submitPlan\" class=\"px-3 py-1 rounded-xl bg-karpus-green text-white text-sm\">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector('#closePlanModal')?.addEventListener('click', ()=> modal.remove());
    modal.querySelector('#submitPlan')?.addEventListener('click', ()=>{
      const cls = modal.querySelector('#planClass').value;
      const title = modal.querySelector('#planTitle').value || 'Mejora';
      const actions = modal.querySelector('#planActions').value || '';
      const owner = modal.querySelector('#planOwner').value || 'Dirección';
      const due = modal.querySelector('#planDue').value || new Date().toISOString().slice(0,10);
      KarpusStore.addImprovementPlan({ class: cls, title, actions, owner, due, status: 'Pendiente' });
      modal.remove();
      renderPlans();
    });
  }

  // ======================
  // Resumen Académico (Calificaciones)
  // ======================
  function renderAcademicSummary() {
    const container = document.getElementById('gradesSummaryContainer');
    if (!container) return;

    const summary = KarpusStore.getAcademicSummary();
    container.innerHTML = '';

    const colors = {
      'Pequeños': 'bg-blue-100 text-blue-800',
      'Medianos': 'bg-green-100 text-green-800',
      'Grandes': 'bg-orange-100 text-orange-800'
    };

    for (const className in summary) {
      const data = summary[className];
      const card = document.createElement('div');
      card.className = `p-6 rounded-2xl shadow ${colors[className] || 'bg-slate-100'}`;
      card.innerHTML = `
        <h3 class="text-lg font-bold mb-4">${className}</h3>
        <div class="space-y-3">
          <p class="text-sm">Calificación Promedio: <span class="font-bold text-2xl">${data.averageGrade}</span></p>
          <p class="text-sm">Total Tareas Calificadas: <span class="font-bold">${data.gradedTasks}</span></p>
          <p class="text-sm">Estudiantes con Calificaciones: <span class="font-bold">${data.studentsCount}</span></p>
        </div>`;
      container.appendChild(card);
    }
  }

  renderPlans();
  container.appendChild(section);

  // ======================
  // Pagos
  // ======================
  function renderPayments(){
    const clsSel = document.getElementById('paymentsClassFilter');
    const cls = clsSel?.value || 'Pequeños';
    const items = KarpusStore.getPaymentsByClass(cls);
    const tbody = document.getElementById('paymentsTable');
    if(!tbody) return;
    tbody.innerHTML = '';
    items.forEach(p=>{
      const tr = document.createElement('tr');
      const badge = p.status==='pagado' ? '<span class="badge badge-green">Pagado</span>' : '<span class="badge badge-orange">Pendiente</span>';
      tr.innerHTML = `<td>${p.student}</td><td>${p.class}</td><td>${p.month}</td><td>$${p.amount.toFixed(2)}</td><td>${badge}</td><td>
        ${p.status==='pendiente' ? `<button class='btn btn-green text-xs' data-id='${p.id}' data-action='mark-paid'>Marcar pagado</button>` : ''}
        <button class='btn btn-blue text-xs' data-id='${p.id}' data-action='reminder'>Recordatorio</button>
      </td>`;
      tbody.appendChild(tr);
    });

    const { total, pagados, pendientes, amountTotal } = KarpusStore.getPaymentSummary(cls);
    document.getElementById('paymentsTotal')?.replaceChildren(document.createTextNode(`Total: ${total}`));
    document.getElementById('paymentsPagados')?.replaceChildren(document.createTextNode(`Pagados: ${pagados}`));
    document.getElementById('paymentsPendientes')?.replaceChildren(document.createTextNode(`Pendientes: ${pendientes}`));
    document.getElementById('paymentsAmount')?.replaceChildren(document.createTextNode(`$${amountTotal.toFixed(2)}`));
    updatePaymentsChart({ pagados, pendientes });
  }

  function updatePaymentsChart({ pagados, pendientes }){
    const ctx = document.getElementById('paymentsChart')?.getContext('2d');
    if(!ctx) return;
    if(updatePaymentsChart._chart){ updatePaymentsChart._chart.destroy(); }
    updatePaymentsChart._chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Pagados', 'Pendientes'],
        datasets: [{
          label: 'Pagos',
          data: [pagados, pendientes],
          backgroundColor: ['#4CAF50','#FF9800'],
          borderRadius: 6
        }]
      },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }

  function setupPaymentsEvents(){
    document.getElementById('paymentsClassFilter')?.addEventListener('change', renderPayments);
    document.getElementById('btnRecordatorioMasivo')?.addEventListener('click', ()=> alert('Recordatorios enviados a pendientes (simulado).'));
    document.getElementById('btnNuevoPago')?.addEventListener('click', openPaymentModal);
    document.getElementById('paymentsTable')?.addEventListener('click', (e)=>{
      const btn = e.target.closest('button');
      if(!btn) return;
      const id = parseInt(btn.dataset.id, 10);
      const action = btn.dataset.action;
      if(action==='mark-paid'){
        KarpusStore.markPaymentStatus(id, 'pagado');
        renderPayments();
      } else if(action==='reminder'){
        alert('Recordatorio enviado (simulado).');
      }
    });
  }

  function openPaymentModal(){
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl p-4 w-full max-w-md">
        <h3 class="text-base font-semibold mb-2">Registrar pago</h3>
        <div class="grid gap-2">
          <input id="payStudent" class="border rounded px-3 py-2" placeholder="Estudiante" />
          <select id="payClass" class="border rounded px-3 py-2">
            <option>Pequeños</option>
            <option>Medianos</option>
            <option>Grandes</option>
          </select>
          <input id="payMonth" class="border rounded px-3 py-2" placeholder="Mes (Ej: Octubre)" />
          <input id="payAmount" type="number" step="0.01" class="border rounded px-3 py-2" placeholder="Monto" />
          <select id="payStatus" class="border rounded px-3 py-2">
            <option value="pendiente">Pendiente</option>
            <option value="pagado">Pagado</option>
          </select>
        </div>
        <div class="mt-3 flex justify-end gap-2">
          <button id="closePayModal" class="px-3 py-1 rounded-xl border text-sm">Cancelar</button>
          <button id="submitPay" class="px-3 py-1 rounded-xl bg-karpus-green text-white text-sm">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#closePayModal')?.addEventListener('click', ()=> modal.remove());
    modal.querySelector('#submitPay')?.addEventListener('click', ()=>{
      const student = modal.querySelector('#payStudent').value||'Estudiante';
      const cls = modal.querySelector('#payClass').value||'Pequeños';
      const month = modal.querySelector('#payMonth').value||'Mes';
      const amount = parseFloat(modal.querySelector('#payAmount').value||'0');
      const status = modal.querySelector('#payStatus').value||'pendiente';
      KarpusStore.addPayment({ student, class: cls, month, amount, status, dueDate: new Date().toISOString().slice(0,10) });
      modal.remove();
      // ajustar filtro a clase del pago si cambia
      const filter = document.getElementById('paymentsClassFilter');
      if(filter){ filter.value = cls; }
      renderPayments();
    });
  }

  // Inicializar si existe la sección de pagos
  if(document.getElementById('pagos')){
    setupPaymentsEvents();
    renderPayments();
  }

  // ======================
  // Chat privado unificado
  // ======================
  (function initDirectorChat(){
    const listEl = document.getElementById('contactList');
    const msgsEl = document.getElementById('chatMessages');
    if(!listEl || !msgsEl) return; // solo si existe UI
    const contacts = KarpusStore.getContacts();
    function renderContacts(filter=''){
      const f = (filter||'').toLowerCase(); listEl.innerHTML='';
      contacts.filter(c=> c.name.toLowerCase().includes(f)).forEach(c=>{
        const btn = document.createElement('button'); btn.className='w-full text-left px-2 py-1 rounded hover:bg-slate-50 text-sm';
        btn.textContent = c.name; btn.dataset.cid = c.id; listEl.appendChild(btn);
      });
    }
    renderContacts();
    let currentContact = null; const me = 'directora';
    listEl.addEventListener('click', (e)=>{
      const btn = e.target.closest('button'); if(!btn) return; currentContact = btn.dataset.cid; const participants=[me,currentContact];
      const thread = KarpusStore.getThread(participants); KarpusStore.markThreadRead(participants, me);
      document.getElementById('chatHeader').textContent = `Chat con ${contacts.find(c=>c.id===currentContact)?.name||''}`;
      msgsEl.innerHTML='';
      thread.messages.forEach(m=>{
        const isMine = m.from===me; const wrap = document.createElement('div'); wrap.className = 'flex ' + (isMine? 'justify-end':'justify-start');
        const bubble = document.createElement('div'); bubble.className = `px-3 py-2 rounded-2xl inline-block ${isMine? 'bg-karpus-blue text-white':'bg-slate-100'} text-xs`; bubble.textContent = m.text; wrap.appendChild(bubble); msgsEl.appendChild(wrap);
        if(isMine){ const status = document.createElement('div'); status.className='text-[10px] text-slate-500 mt-1 text-right'; status.textContent = m.status==='read'? '✔✔ Visto':'✔ Enviado'; msgsEl.appendChild(status); }
      });
    });
    document.getElementById('contactFilter')?.addEventListener('input', (e)=> renderContacts(e.target.value||''));
    const emojiBtn = document.getElementById('chatEmoji'); const emojiMenu = document.getElementById('emojiMenu'); const emojis=['😊','👍','❤️','🎉','👀','📝'];
    if(emojiMenu){ emojiMenu.innerHTML = emojis.map(e=> `<button class='px-2 py-1 text-lg'>${e}</button>`).join(''); }
    emojiBtn?.addEventListener('click', ()=>{ document.getElementById('emojiMenu')?.classList.toggle('hidden'); });
    document.getElementById('emojiMenu')?.addEventListener('click', (e)=>{ const b=e.target.closest('button'); if(!b) return; const input=document.getElementById('chatInput'); input.value=(input.value||'')+b.textContent; input.focus(); });
    const inputEl = document.getElementById('chatInput');
    inputEl?.addEventListener('input', ()=>{ if(currentContact) KarpusStore.setTyping([me,currentContact], me, true); });
    inputEl?.addEventListener('blur', ()=>{ if(currentContact) KarpusStore.setTyping([me,currentContact], me, false); });
    setInterval(()=>{
      if(!currentContact) return; const typing = KarpusStore.isTyping([me,currentContact], currentContact);
      const el = document.getElementById('typingIndicator'); if(el) el.textContent = typing? `${contacts.find(c=>c.id===currentContact)?.name||''} está escribiendo...` : '';
    }, 1000);
    document.getElementById('chatSend')?.addEventListener('click', ()=>{
      const input = document.getElementById('chatInput'); const text=(input?.value||'').trim(); if(!text || !currentContact) return; const participants=[me,currentContact];
      KarpusStore.sendMessage(participants, { from: me, text }); input.value=''; KarpusStore.setTyping(participants, me, false);
      const wrap=document.createElement('div'); wrap.className='flex justify-end'; const bubble=document.createElement('div'); bubble.className='px-3 py-2 rounded-2xl inline-block bg-karpus-blue text-white text-xs'; bubble.textContent=text; wrap.appendChild(bubble);
      const status=document.createElement('div'); status.className='text-[10px] text-slate-500 mt-1 text-right'; status.textContent='✔ Enviado'; msgsEl.appendChild(wrap); msgsEl.appendChild(status);
    });
  })();
});