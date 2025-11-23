/**
 * KarpusStore v2
 * Extiende el store para adjuntos en publicaciones, comentarios, reacciones y módulo de pagos.
 * Mantiene compatibilidad con métodos esperados por scripts existentes.
 */
(function(){
  const STORAGE_KEY = 'karpus_store_v2';

  function todayStr(){
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }

  const defaultState = {
    classes: ['Pequeños','Medianos','Grandes'],
    teacherProfile: { name: 'Ana Pérez', email: 'ana@karpus.edu', phone: '', bio: 'Educadora apasionada con 5 años de experiencia en desarrollo infantil temprano. Mi objetivo es crear un ambiente de aprendizaje divertido y seguro.', avatar: 'https://placehold.co/200x200' },
    directorProfile: { name: 'Karonlyn García', bio: 'Fundadora y CEO de Karpus Kids, dedicada a ofrecer una educación de calidad basada en el amor, el respeto y la creatividad. ¡Bienvenidos a nuestra familia!', avatar: 'img/mundo.jpg' },
    posts: [
      { id: 1, class: 'Pequeños', teacher: 'Ana Pérez', date: todayStr(), text: 'Actividad de pintura sensorial.', photo: 'https://placehold.co/600x300', video: '', docUrl: '', docType: '', comments: [], reactions: { likes: 2, emoji: { '👍': 1 } } },
      { id: 2, class: 'Pequeños', teacher: 'Ana Pérez', date: todayStr(), text: 'Canción de vocales grabada.', photo: 'https://placehold.co/600x300', video: '', docUrl: '', docType: '', comments: [], reactions: { likes: 1, emoji: {} } }
    ],
    tasks: [
      { id: 1, class: 'Pequeños', title: 'Colorear formas', desc: 'Usar colores primarios.', publish: todayStr(), due: todayStr(), attachments: [], submissions: [], grades: [] },
      { id: 2, class: 'Pequeños', title: 'Canción de vocales', desc: 'Grabar un video corto.', publish: todayStr(), due: todayStr(), attachments: [], submissions: [], grades: [] }
    ],
    notifications: [
      { id: 1, class: 'Pequeños', type: 'task', text: 'Nueva tarea publicada', date: todayStr() },
      { id: 2, class: 'Pequeños', type: 'class', text: 'Nueva publicación en aula', date: todayStr() },
      { id: 3, class: 'General', type: 'payment', text: 'Pago pendiente', date: todayStr() }
    ],
    attendance: [
      { id: 1, class: 'Pequeños', date: todayStr(), present: 15, total: 18 }
    ],
    plans: [
      { id: 1, title: 'Mejorar lectoescritura', class: 'Pequeños', owner: 'Dirección', actions: 'Rutina de vocales, Lectura guiada', due: todayStr(), status: 'Pendiente' }
    ],
    payments: [
      { id: 1, student: 'Andrea Flores', class: 'Pequeños', month: 'Octubre', amount: 120.00, status: 'pagado', dueDate: `${new Date().getFullYear()}-10-30`, paidDate: todayStr(), notes: '' },
      { id: 2, student: 'Juan Pérez', class: 'Medianos', month: 'Octubre', amount: 120.00, status: 'pendiente', dueDate: `${new Date().getFullYear()}-10-30`, paidDate: '', notes: 'Recordatorio enviado' }
    ],
    contacts: [
      { id: 'maestra', name: 'Maestra Ana' },
      { id: 'directora', name: 'Directora' },
      { id: 'padre_andrea', name: 'Madre de Andrea' },
      { id: 'padre_juan', name: 'Padre de Juan' }
    ],
    chats: [
      { id: 1, participants: ['maestra','directora'], messages: [ { id: 1, from: 'directora', text: 'Hola Ana, ¿cómo van las tareas?', date: todayStr(), status: 'sent', seenAt: '' } ] }
    ],
    nextId: { posts: 3, tasks: 3, notifications: 4, plans: 2, payments: 3, chats: 2 }
  };

  function load(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if(raw) return JSON.parse(raw);
      // intentar migración desde v1 si existe
      const rawV1 = localStorage.getItem('karpus_store_v1');
      if(rawV1){
        const v1 = JSON.parse(rawV1);
        // migración básica de posts y tasks
        const posts = (v1.posts||[]).map(p=>({ ...p, video:'', docUrl:'', docType:'', comments:[], reactions:{ likes:0, emoji:{} } }));
        const state = { ...defaultState, posts, tasks: v1.tasks||defaultState.tasks, notifications: v1.notifications||defaultState.notifications, attendance: v1.attendance||defaultState.attendance, plans: v1.plans||defaultState.plans };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        return state;
      }
      return JSON.parse(JSON.stringify(defaultState));
    } catch(e){
      console.warn('Store load error, using defaults', e);
      return JSON.parse(JSON.stringify(defaultState));
    }
  }
  function save(state){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  const state = load();

  const Store = {
    getState(){ return JSON.parse(JSON.stringify(state)); },
    reset(){ Object.assign(state, JSON.parse(JSON.stringify(defaultState))); save(state); },

    // Perfil de maestra
    getTeacherProfile(){ return JSON.parse(JSON.stringify(state.teacherProfile)); },
    getDirectorProfile(){ return JSON.parse(JSON.stringify(state.directorProfile)); },
    updateTeacherProfile(updates){ Object.assign(state.teacherProfile, updates||{}); save(state); return this.getTeacherProfile(); },

    // Posts
    addPost({class: cls, teacher, text, photo, video, docUrl, docType}){
      const id = state.nextId.posts++;
      const post = { id, class: cls || 'Pequeños', teacher: teacher || 'Maestra', date: todayStr(), text: text||'', photo: photo||'', video: video||'', docUrl: docUrl||'', docType: docType||'', comments: [], reactions: { likes:0, emoji:{} } };
      state.posts.unshift(post);
      save(state);
      return post;
    },
    addComment(postId, {author, text}){
      const p = state.posts.find(x=>x.id===postId);
      if(!p) return null;
      p.comments.push({ author: author||'Padre/Madre', text: text||'', date: todayStr() });
      save(state);
      return p;
    },
    reactToPost(postId, { type, emoji }){
      const p = state.posts.find(x=>x.id===postId);
      if(!p) return null;
      if(type==='like') p.reactions.likes = (p.reactions.likes||0) + 1;
      if(type==='emoji' && emoji){
        p.reactions.emoji[emoji] = (p.reactions.emoji[emoji]||0) + 1;
      }
      save(state);
      return p;
    },
    getClassPosts(cls){ return state.posts.filter(p => p.class === cls); },

    // Tasks
    addTask({class: cls, title, desc, publish, due, attachments}){
      const id = state.nextId.tasks++;
      const task = { id, class: cls || 'Pequeños', title: title||'Nueva tarea', desc: desc||'', publish: publish||todayStr(), due: due||todayStr(), attachments: Array.isArray(attachments)? attachments: [], submissions: [], grades: [] };
      state.tasks.unshift(task);
      save(state);
      return task;
    },
    getTasksForClass(cls){ return state.tasks.filter(t => t.class === cls); },
    getTaskById(id){ return JSON.parse(JSON.stringify(state.tasks.find(t=>t.id===id))); },
    updateTask(id, updates){ const t = state.tasks.find(x=>x.id===id); if(!t) return null; Object.assign(t, updates||{}); save(state); return JSON.parse(JSON.stringify(t)); },
    submitTask(taskId, {parent, comment, fileType, files}){
      const t = state.tasks.find(x => x.id === taskId);
      if(!t) return null;
      t.submissions.push({ parent: parent||'Padre', comment: comment||'', fileType: fileType||'archivo', files: Array.isArray(files)? files: [], date: todayStr() });
      save(state);
      return t;
    },
    // alias para compatibilidad
    addTaskSubmission(taskId, payload){ return this.submitTask(taskId, payload); },
    gradeSubmission(taskId, studentName, grade, comment){
      const t = state.tasks.find(x => x.id === taskId);
      if(!t) return null;
      const existingGrade = t.grades.find(g => g.student === studentName);
      if(existingGrade){
        existingGrade.grade = grade;
        existingGrade.comment = comment;
        existingGrade.date = todayStr();
      } else {
        t.grades.push({ student: studentName, grade, comment, date: todayStr() });
      }
      save(state);
      // Notificar al padre que la tarea ha sido calificada
      this.addNotification({
        class: t.class,
        type: 'grade',
        text: `¡Buenas noticias! La tarea "${t.title}" de ${studentName} ha sido calificada.`
      });
    },

    // Notifications
    addNotification({class: cls, type, text}){
      const id = state.nextId.notifications++;
      const n = { id, class: cls || 'Pequeños', type: type||'general', text: text||'', date: todayStr() };
      state.notifications.unshift(n);
      save(state);
      return n;
    },
    getNotificationsForClass(cls){ return state.notifications.filter(n => n.class === cls || n.class === 'General'); },

    // Attendance
    recordAttendance({class: cls, present, total}){
      const id = (state.attendance[state.attendance.length-1]?.id || 0) + 1;
      const rec = { id, class: cls || 'Pequeños', date: todayStr(), present: present||0, total: total||0 };
      state.attendance.push(rec);
      save(state);
      return rec;
    },

    // Improvement Plans (compatibilidad con directora_patch)
    getImprovementPlans(){ return JSON.parse(JSON.stringify(state.plans)); },
    addImprovementPlan({ class: cls, title, actions, owner, due, status }){
      const id = state.nextId.plans++;
      const plan = { id, title: title||'Plan', class: cls||'Pequeños', owner: owner||'Dirección', actions: actions||'', due: due||todayStr(), status: status||'Pendiente' };
      state.plans.unshift(plan);
      save(state);
      return plan;
    },

    // Payments
    addPayment({ student, class: cls, month, amount, status, dueDate, paidDate, notes }){
      const id = state.nextId.payments++;
      const p = { id, student: student||'Estudiante', class: cls||'Pequeños', month: month||'Mes', amount: Number(amount)||0, status: status||'pendiente', dueDate: dueDate||todayStr(), paidDate: paidDate||'', notes: notes||'' };
      state.payments.unshift(p);
      save(state);
      return p;
    },
    markPaymentStatus(id, status){
      const p = state.payments.find(x=>x.id===id);
      if(!p) return null;
      p.status = status;
      p.paidDate = status==='pagado' ? todayStr() : '';
      save(state);
      return p;
    },
    getPaymentsByClass(cls){ return state.payments.filter(p=> p.class===cls); },
    getPaymentSummary(cls){
      const items = cls ? state.payments.filter(p=>p.class===cls) : state.payments;
      const total = items.length;
      const pagados = items.filter(p=>p.status==='pagado').length;
      const pendientes = total - pagados;
      const amountTotal = items.reduce((sum,p)=> sum + (p.amount||0), 0);
      return { total, pagados, pendientes, amountTotal };
    },

    // Academic Summary
    getAcademicSummary(){
      const summary = {};
      state.classes.forEach(cls => {
        const classTasks = state.tasks.filter(t => t.class === cls);
        let totalGradesSum = 0;
        let totalGradesCount = 0;
        const studentsWithGrades = new Set();

        classTasks.forEach(task => {
          task.grades.forEach(grade => {
            const numericGrade = parseFloat(grade.grade);
            if (!isNaN(numericGrade)) {
              totalGradesSum += numericGrade;
              totalGradesCount++;
              studentsWithGrades.add(grade.student);
            }
          });
        });

        summary[cls] = {
          averageGrade: totalGradesCount > 0 ? (totalGradesSum / totalGradesCount).toFixed(1) : 'N/A',
          gradedTasks: totalGradesCount,
          studentsCount: studentsWithGrades.size
        };
      });
      return summary;
    },

    // Chats
    getContacts(){ return JSON.parse(JSON.stringify(state.contacts)); },
    getThread(participants){
      const key = JSON.stringify([...participants].sort());
      let thread = state.chats.find(c => JSON.stringify([...c.participants].sort())===key);
      if(!thread){
        thread = { id: state.nextId.chats++, participants: [...participants], messages: [] };
        state.chats.push(thread);
        save(state);
      }
      return JSON.parse(JSON.stringify(thread));
    },
    sendMessage(participants, { from, text }){
      const key = JSON.stringify([...participants].sort());
      let thread = state.chats.find(c => JSON.stringify([...c.participants].sort())===key);
      if(!thread){ thread = { id: state.nextId.chats++, participants: [...participants], messages: [] }; state.chats.push(thread); }
      const nextMsgId = (thread.messages[thread.messages.length-1]?.id || 0) + 1;
      thread.messages.push({ id: nextMsgId, from: from||'maestra', text: text||'', date: todayStr(), status: 'sent', seenAt: '' });
      save(state);
      return JSON.parse(JSON.stringify(thread));
    },
    markThreadRead(participants, reader){
      const key = JSON.stringify([...participants].sort());
      const thread = state.chats.find(c => JSON.stringify([...c.participants].sort())===key);
      if(!thread) return null;
      let changed = false;
      thread.messages.forEach(m => {
        if(m.from !== reader && m.status !== 'read') { m.status = 'read'; m.seenAt = todayStr(); changed = true; }
      });
      if(changed) save(state);
      return JSON.parse(JSON.stringify(thread));
    },
    // Typing indicator usando localStorage (ephemeral ~3s)
    setTyping(participants, userId, isTyping){
      try {
        const key = 'karpus_typing_' + JSON.stringify([...participants].sort()) + '_' + userId;
        const val = isTyping ? String(Date.now()) : '0';
        localStorage.setItem(key, val);
      } catch(e) { /* noop */ }
    },
    isTyping(participants, userId){
      try {
        const key = 'karpus_typing_' + JSON.stringify([...participants].sort()) + '_' + userId;
        const ts = parseInt(localStorage.getItem(key)||'0', 10);
        return ts && (Date.now() - ts) < 3000; // activo si <3s
      } catch(e){ return false; }
    }
  };

  window.KarpusStore = Store;
})();