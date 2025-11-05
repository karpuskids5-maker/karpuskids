document.addEventListener('DOMContentLoaded', () => {
  if(!window.KarpusStore) return;

  const selToCls = (v) => v==='pequenos' ? 'Pequeños' : v==='medianos' ? 'Medianos' : 'Grandes';
  const classroomSelect = document.getElementById('classroomSelect');
  let currentClass = selToCls(classroomSelect?.value || 'pequenos');

  // Renderizar posts del aula con adjuntos, reacciones y comentarios
  function renderClassPosts(){
    const feedEl = document.getElementById('classroomFeed');
    if(!feedEl) return;
    const posts = KarpusStore.getClassPosts(currentClass);
    feedEl.innerHTML = '';

    posts.forEach(p => {
      const card = document.createElement('div');
      card.className = 'p-4 rounded-3xl bg-white border';
      const attachments = `
        ${p.photo ? `<img src="${p.photo}" class="w-full h-40 object-cover rounded-xl mt-2" />` : ''}
        ${p.video ? `<video controls class="w-full rounded-xl mt-2"><source src="${p.video}" type="video/mp4">Tu navegador no soporta video.</video>` : ''}
        ${p.docUrl ? `<a href="${p.docUrl}" target="_blank" class="inline-block mt-2 text-xs px-2 py-1 rounded-xl bg-slate-100">Documento (${p.docType||'archivo'})</a>` : ''}
      `;

      const comments = (p.comments||[]).map(c=>
        `<div class="text-xs text-slate-600"><strong>${c.author}:</strong> ${c.text} <span class="text-slate-400">${c.date}</span></div>`
      ).join('');

      const emojis = Object.entries(p.reactions?.emoji||{}).map(([e,count])=>
        `<button class="text-xs px-2 py-1 rounded-xl bg-slate-100" data-post-id="${p.id}" data-emoji="${e}" data-action="react-emoji">${e} ${count}</button>`
      ).join(' ');

      card.innerHTML = `
        <div class="flex justify-between items-center mb-2">
          <p class="text-sm font-medium">${p.teacher}</p>
          <span class="text-xs text-slate-500">${p.date}</span>
        </div>
        <p class="text-sm">${p.text}</p>
        ${attachments}
        <div class="mt-3 flex items-center gap-2">
          <button class="text-xs px-2 py-1 rounded-xl bg-karpus-orange text-white" data-post-id="${p.id}" data-action="like">👍 ${p.reactions?.likes||0}</button>
          ${emojis}
          <button class="text-xs px-2 py-1 rounded-xl bg-slate-100" data-post-id="${p.id}" data-emoji="👍" data-action="react-emoji">+ Emoji</button>
        </div>
        <div class="mt-2 space-y-1">${comments}</div>
        <div class="mt-2 flex gap-2">
          <input type="text" class="flex-1 border rounded-xl px-2 py-1 text-xs" placeholder="Añadir comentario" data-post-id="${p.id}" />
          <button class="text-xs px-2 py-1 rounded-xl bg-karpus-blue text-white" data-post-id="${p.id}" data-action="comment">Comentar</button>
        </div>
      `;

      feedEl.appendChild(card);
    });
  }

  // Manejo de acciones en el feed
  document.getElementById('classroomFeed')?.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    const postId = parseInt(btn.dataset.postId, 10);
    const action = btn.dataset.action;
    if(action==='like'){
      KarpusStore.reactToPost(postId, { type:'like' });
      renderClassPosts();
    } else if(action==='react-emoji'){
      const emoji = btn.dataset.emoji || '❤️';
      KarpusStore.reactToPost(postId, { type:'emoji', emoji });
      renderClassPosts();
    } else if(action==='comment'){
      const input = document.querySelector(`input[data-post-id="${postId}"]`);
      const text = (input?.value||'').trim();
      if(!text) return;
      KarpusStore.addComment(postId, { author: 'Maestra', text });
      if(input) input.value='';
      renderClassPosts();
    }
  });

  // Nueva publicación: usar el store v2
  document.getElementById('openAddPost')?.addEventListener('click', ()=>{
    document.getElementById('modalAddPost')?.classList.remove('hidden');
  });
  document.getElementById('closeAddPost')?.addEventListener('click', ()=>{
    document.getElementById('modalAddPost')?.classList.add('hidden');
  });
  async function readFileDataURL(input){
    const f = input?.files?.[0];
    if(!f) return '';
    return new Promise((resolve)=>{
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(f);
    });
  }
  document.getElementById('submitPost')?.addEventListener('click', async ()=>{
    const text = document.getElementById('postText')?.value || '';
    const photoEl = document.getElementById('postPhoto');
    const videoEl = document.getElementById('postVideo');
    const docEl = document.getElementById('postDoc');
    const photo = await readFileDataURL(photoEl);
    const video = await readFileDataURL(videoEl);
    const docUrl = await readFileDataURL(docEl);
    const docType = docEl?.files?.[0]?.name?.split('.').pop() || '';
    if(text.trim()==='' && !photo && !video && !docUrl) return;
    KarpusStore.addPost({ class: currentClass, teacher: 'Ana Pérez', text, photo, video, docUrl, docType });
    ['postText'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    [photoEl, videoEl, docEl].forEach(el=>{ if(el) el.value=''; });
    document.getElementById('modalAddPost')?.classList.add('hidden');
    renderClassPosts();
  });

  classroomSelect?.addEventListener('change', ()=>{
    currentClass = selToCls(classroomSelect.value);
    renderClassPosts();
    renderTasks();
  });

  // Inicial
  renderClassPosts();
  renderTasks();

  // ======================
  // Tareas
  // ======================
  function fileListToArray(input){
    const arr = [];
    const files = input?.files || [];
    const promises = [];
    for(let i=0;i<files.length;i++){
      const f = files[i];
      promises.push(new Promise((resolve)=>{ const r=new FileReader(); r.onload=()=> resolve({ name: f.name, type: f.type||'', dataUrl: r.result }); r.readAsDataURL(f); }));
    }
    return Promise.all(promises);
  }
  function renderTasks(){
    const list = document.getElementById('taskList'); if(!list) return;
    const tasks = KarpusStore.getTasksForClass(currentClass);
    list.innerHTML = '';
    tasks.forEach(t=>{
      const card = document.createElement('div');
      card.className = 'p-4 rounded-3xl bg-white border';
      const atts = (t.attachments||[]).map(a=> `<span class="badge">${a.name}</span>`).join(' ');
      card.innerHTML = `
        <div class="flex justify-between items-center">
          <div>
            <h4 class="text-sm font-medium">${t.title}</h4>
            <p class="text-xs text-slate-500">Publicación: ${t.publish} · Entrega: ${t.due}</p>
            <div class="mt-2 text-xs flex flex-wrap gap-1">${atts}</div>
          </div>
          <div class="flex gap-2">
            <button class="text-xs px-2 py-1 rounded-xl bg-slate-100" data-task-id="${t.id}" data-action="edit-task">Editar</button>
            <button class="text-xs px-2 py-1 rounded-xl bg-karpus-orange text-white" data-task-id="${t.id}" data-action="grade-task">Calificar (${(t.submissions||[]).length})</button>
          </div>
        </div>`;
      list.appendChild(card);
    });
  }
  document.getElementById('openCreateTask')?.addEventListener('click', ()=> document.getElementById('modalCreateTask')?.classList.remove('hidden'));
  document.getElementById('closeCreateTask')?.addEventListener('click', ()=> document.getElementById('modalCreateTask')?.classList.add('hidden'));
  document.getElementById('submitTask')?.addEventListener('click', async ()=>{
    const title = document.getElementById('taskTitle')?.value||'';
    const desc = document.getElementById('taskDesc')?.value||'';
    const publish = document.getElementById('taskPublish')?.value||'';
    const due = document.getElementById('taskDue')?.value||'';
    const filesEl = document.getElementById('taskFiles');
    const attachments = await fileListToArray(filesEl);
    if(!title || !due){ return; }
    KarpusStore.addTask({ class: currentClass, title, desc, publish, due, attachments });
    ['taskTitle','taskDesc','taskPublish','taskDue'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    if(filesEl) filesEl.value='';
    document.getElementById('modalCreateTask')?.classList.add('hidden');
    renderTasks();
  });
  document.getElementById('taskList')?.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const id = parseInt(btn.dataset.taskId,10); const action = btn.dataset.action;
    if(action==='grade-task'){
      const t = KarpusStore.getTaskById(id);
      document.getElementById('gradeTaskTitle').textContent = t.title;
      const gradeList = document.getElementById('gradeList');
      gradeList.innerHTML = '';

      if (!t.submissions || t.submissions.length === 0) {
        gradeList.innerHTML = `<p class="text-center text-sm text-slate-500 p-4">No hay entregas para calificar.</p>`;
      } else {
        t.submissions.forEach(s => {
          const existingGrade = t.grades.find(g => g.student === s.parent);
          const submissionEl = document.createElement('div');
          submissionEl.className = 'p-3 rounded-xl bg-slate-50 border';
          submissionEl.dataset.studentName = s.parent;
          submissionEl.innerHTML = `
            <p class="text-sm font-semibold">${s.parent}</p>
            <p class="text-xs text-slate-500">Entregado: ${s.date}</p>
            <div class="mt-2 space-y-1">
              <input type="number" min="0" max="10" class="grade-input w-full border rounded-lg p-1 text-sm" placeholder="Calificación (0-10)" value="${existingGrade?.grade || ''}">
              <textarea class="grade-comment w-full border rounded-lg p-1 text-sm" rows="2" placeholder="Comentario...">${existingGrade?.comment || ''}</textarea>
            </div>
          `;
          gradeList.appendChild(submissionEl);
        });
      }

      document.getElementById('modalGradeTask')?.classList.remove('hidden');

      document.getElementById('saveGrades').onclick = () => {
        const gradeElements = gradeList.querySelectorAll('[data-student-name]');
        gradeElements.forEach(el => {
          const studentName = el.dataset.studentName;
          const grade = el.querySelector('.grade-input').value;
          const comment = el.querySelector('.grade-comment').value;
          KarpusStore.gradeSubmission(id, studentName, grade, comment);
        });
        alert('Calificaciones guardadas.');
        document.getElementById('modalGradeTask')?.classList.add('hidden');
      };
    } else if(action==='edit-task'){
      const t = KarpusStore.getTaskById(id);
      document.getElementById('editTaskTitle').value = t.title||'';
      document.getElementById('editTaskDesc').value = t.desc||'';
      document.getElementById('editTaskPublish').value = t.publish||'';
      document.getElementById('editTaskDue').value = t.due||'';
      document.getElementById('modalEditTask')?.classList.remove('hidden');
      document.getElementById('submitEditTask').onclick = async ()=>{
        const title = document.getElementById('editTaskTitle')?.value||'';
        const desc = document.getElementById('editTaskDesc')?.value||'';
        const publish = document.getElementById('editTaskPublish')?.value||'';
        const due = document.getElementById('editTaskDue')?.value||'';
        const filesEl = document.getElementById('editTaskFiles'); const newFiles = await fileListToArray(filesEl);
        const current = KarpusStore.getTaskById(id);
        const attachments = [...(current.attachments||[]), ...newFiles];
        KarpusStore.updateTask(id, { title, desc, publish, due, attachments });
        if(filesEl) filesEl.value=''; document.getElementById('modalEditTask')?.classList.add('hidden'); renderTasks();
      };
    }
  });
  document.getElementById('closeEditTask')?.addEventListener('click', ()=> document.getElementById('modalEditTask')?.classList.add('hidden'));
  document.getElementById('closeGradeTask')?.addEventListener('click', ()=> document.getElementById('modalGradeTask')?.classList.add('hidden'));

  // ======================
  // Historial
  // ======================
  document.getElementById('openHistory')?.addEventListener('click', ()=>{
    const list = document.getElementById('historyList');
    const posts = KarpusStore.getClassPosts(currentClass);
    list.innerHTML = posts.map(p=> `<div class='p-2 rounded-xl bg-white border'><div class='text-xs text-slate-500'>${p.date} · ${p.teacher}</div><div class='text-sm'>${p.text}</div></div>`).join('');
    document.getElementById('modalHistory')?.classList.remove('hidden');
  });
  document.getElementById('closeHistory')?.addEventListener('click', ()=> document.getElementById('modalHistory')?.classList.add('hidden'));

  // ======================
  // Chat privado (Avisos)
  // ======================
  const contacts = KarpusStore.getContacts();
  function renderContacts(filter=''){
    const list = document.getElementById('contactList'); if(!list) return;
    const f = filter.toLowerCase();
    list.innerHTML = '';
    contacts.filter(c=> c.name.toLowerCase().includes(f)).forEach(c=>{
      const btn = document.createElement('button'); btn.className='w-full text-left px-2 py-1 rounded hover:bg-slate-50 text-sm';
      btn.textContent = c.name; btn.dataset.cid = c.id;
      list.appendChild(btn);
    });
  }
  renderContacts();
  let currentChat = null; let currentContact = null;
  document.getElementById('contactList')?.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    currentContact = btn.dataset.cid;
    const participants = ['maestra', currentContact];
    const thread = KarpusStore.getThread(participants);
    KarpusStore.markThreadRead(participants, 'maestra');
    currentChat = thread;
    document.getElementById('chatHeader').textContent = `Chat con ${contacts.find(c=>c.id===currentContact)?.name||''}`;
    const msgs = document.getElementById('chatMessages'); msgs.innerHTML = '';
    thread.messages.forEach(m=>{
      const wrap = document.createElement('div'); wrap.className='flex';
      const isMine = m.from==='maestra';
      wrap.classList.add(isMine? 'justify-end':'justify-start');
      const bubble = document.createElement('div');
      bubble.className = `px-3 py-2 rounded-2xl inline-block ${isMine? 'bg-karpus-blue text-white':'bg-slate-100'} text-xs`;
      bubble.textContent = `${m.text}`;
      wrap.appendChild(bubble);
      if(isMine){
        const status = document.createElement('div');
        status.className = 'text-[10px] text-slate-500 mt-1 text-right';
        status.textContent = m.status==='read' ? '✔✔ Visto' : '✔ Enviado';
        msgs.appendChild(wrap); msgs.appendChild(status);
      } else {
        msgs.appendChild(wrap);
      }
    });
  });
  document.getElementById('contactFilter')?.addEventListener('input', (e)=> renderContacts(e.target.value||''));
  // Emoji picker simple
  const emojiBtn = document.getElementById('chatEmoji');
  const emojiMenu = document.getElementById('emojiMenu');
  const emojis = ['😊','👍','❤️','🎉','👀','📝'];
  if(emojiMenu){ emojiMenu.innerHTML = emojis.map(e=> `<button class='px-2 py-1 text-lg'>${e}</button>`).join(''); }
  emojiBtn?.addEventListener('click', ()=>{ document.getElementById('emojiMenu')?.classList.toggle('hidden'); });
  document.getElementById('emojiMenu')?.addEventListener('click', (e)=>{
    const b = e.target.closest('button'); if(!b) return; const input = document.getElementById('chatInput'); input.value = (input.value||'') + b.textContent; input.focus();
  });

  // Indicador de escritura
  const inputEl = document.getElementById('chatInput');
  inputEl?.addEventListener('input', ()=>{ if(currentContact) KarpusStore.setTyping(['maestra', currentContact], 'maestra', true); });
  inputEl?.addEventListener('blur', ()=>{ if(currentContact) KarpusStore.setTyping(['maestra', currentContact], 'maestra', false); });
  setInterval(()=>{
    if(!currentContact) return;
    const typing = KarpusStore.isTyping(['maestra', currentContact], currentContact);
    const el = document.getElementById('typingIndicator'); if(el) el.textContent = typing? `${contacts.find(c=>c.id===currentContact)?.name||''} está escribiendo...` : '';
  }, 1000);

  document.getElementById('chatSend')?.addEventListener('click', ()=>{
    const input = document.getElementById('chatInput'); const text = (input?.value||'').trim(); if(!text || !currentContact) return;
    const participants = ['maestra', currentContact];
    const thread = KarpusStore.sendMessage(participants, { from: 'maestra', text });
    input.value=''; KarpusStore.setTyping(participants, 'maestra', false);
    const msgs = document.getElementById('chatMessages');
    const wrap = document.createElement('div'); wrap.className='flex justify-end';
    const bubble = document.createElement('div'); bubble.className='px-3 py-2 rounded-2xl inline-block bg-karpus-blue text-white text-xs'; bubble.textContent = text; wrap.appendChild(bubble);
    const status = document.createElement('div'); status.className='text-[10px] text-slate-500 mt-1 text-right'; status.textContent='✔ Enviado';
    msgs.appendChild(wrap); msgs.appendChild(status);
  });

  // ======================
  // Perfil editable
  // ======================
  function fillProfile(){
    const pf = KarpusStore.getTeacherProfile();
    ['pfName','pfEmail','pfPhone','pfBio'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value = pf[id.replace('pf','').toLowerCase()] || pf[id] || ''; });
  }
  fillProfile();
  async function readAvatar(){ const el=document.getElementById('pfAvatar'); if(!el?.files?.[0]) return ''; return new Promise((resolve)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.readAsDataURL(el.files[0]); }); }
  document.getElementById('saveProfile')?.addEventListener('click', async ()=>{
    const updates = {
      name: document.getElementById('pfName').value||'',
      email: document.getElementById('pfEmail').value||'',
      phone: document.getElementById('pfPhone').value||'',
      bio: document.getElementById('pfBio').value||'',
    };
    const avatar = await readAvatar(); if(avatar) updates.avatar = avatar;
    KarpusStore.updateTeacherProfile(updates);
    alert('Perfil guardado');
  });

  // ======================
  // Botones y Modales del Perfil
  // ======================
  const setupModal = (openBtnId, closeBtnId, modalId) => {
    const openBtn = document.getElementById(openBtnId);
    const closeBtn = document.getElementById(closeBtnId);
    const modal = document.getElementById(modalId);

    openBtn?.addEventListener('click', () => modal?.classList.remove('hidden'));
    closeBtn?.addEventListener('click', () => modal?.classList.add('hidden'));
  };

  // Modal: Ver Padres
  setupModal('openViewParents', 'closeViewParents', 'modalViewParents');
  document.getElementById('openViewParents')?.addEventListener('click', () => {
    const parentsList = document.getElementById('parentsList');
    if (parentsList) {
      const contacts = KarpusStore.getContacts().filter(c => c.id.startsWith('padre_'));
      parentsList.innerHTML = contacts.map(c => `<div class="p-2 rounded-lg bg-slate-50 text-sm">${c.name}</div>`).join('');
    }
  });

  // Modal: Calendario
  setupModal('openCalendar', 'closeCalendar', 'modalCalendar');

  // Modal: Mensaje (diferente a chat, parece ser un mensaje general)
  setupModal('openMessage', 'closeMessage', 'modalMessage');
  document.getElementById('openMessage')?.addEventListener('click', () => {
    const messageToSelect = document.getElementById('messageTo');
    if (messageToSelect) {
      const contacts = KarpusStore.getContacts().filter(c => c.id.startsWith('padre_'));
      messageToSelect.innerHTML = '<option value="">Seleccionar destinatario...</option>';
      messageToSelect.innerHTML += contacts.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }
  });
  document.getElementById('sendMessage')?.addEventListener('click', () => {
      const recipientId = document.getElementById('messageTo')?.value;
      const text = document.getElementById('messageText')?.value;
      if (!recipientId) return alert('Por favor, seleccione un destinatario.');
      if (!text || !text.trim()) return alert('El mensaje no puede estar vacío.');
      
      const recipientName = document.querySelector(`#messageTo option[value="${recipientId}"]`)?.textContent;
      alert(`Mensaje enviado a ${recipientName} (simulación).`);
      document.getElementById('modalMessage')?.classList.add('hidden');
  });

  // Modal: Exportar
  setupModal('openExport', 'closeExport', 'modalExport');
  document.getElementById('doExport')?.addEventListener('click', () => {
      alert('Reporte exportado (simulación).');
      document.getElementById('modalExport')?.classList.add('hidden');
  });

  // Modal: Enviar Notificación (general)
  setupModal('openSendNotification', 'closeSendNotification', 'modalSendNotification'); // Asumiendo que hay un botón para abrirlo
  document.getElementById('submitNotification')?.addEventListener('click', () => {
      const text = document.getElementById('notifText')?.value || '';
      if (!text.trim()) return alert('El mensaje no puede estar vacío.');
      alert('Notificación enviada (simulación).');
      document.getElementById('modalSendNotification')?.classList.add('hidden');
  });
});