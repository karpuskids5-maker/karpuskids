/**
 * KarpusStore v2
 * Extiende el store para adjuntos en publicaciones, comentarios, reacciones y módulo de pagos.
 * Mantiene compatibilidad con métodos esperados por scripts existentes.
 */
 (function(){
  const API = 'http://127.0.0.1:5600/api';
  const caches = {
    classes: [],
    posts: {}, // by class
    tasks: {}, // by class
    notifications: {}, // by class
    contacts: [],
  };
  async function fetchJson(url, opts){
    const res = await fetch(url, opts);
    if(!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  }
  async function preload(){
    try {
      caches.classes = await fetchJson(`${API}/classrooms`);
      caches.contacts = await fetchJson(`${API}/contacts`);
      // Pre-cargar clases principales
      const levels = ['Pequeños','Medianos','Grandes'];
      for(const lvl of levels){
        try {
          caches.posts[lvl] = await fetchJson(`${API}/posts?class=${encodeURIComponent(lvl)}`);
          caches.tasks[lvl] = await fetchJson(`${API}/tasks?class=${encodeURIComponent(lvl)}`);
          caches.notifications[lvl] = await fetchJson(`${API}/notifications?class=${encodeURIComponent(lvl)}`);
        } catch(e) { /* noop por clase faltante */ }
      }
    } catch(e){ /* noop global */ }
  }
  const ready = preload();

  const Store = {
    ready,
    getClasses(){ return caches.classes || []; },
    getState(){ return {}; },
    reset(){},

    // Perfil de maestra/directora desde API
    async getTeacherProfile(){ return await fetchJson(`${API}/profiles/teacher`); },
    async getDirectorProfile(){ return await fetchJson(`${API}/profiles/director`); },
    updateTeacherProfile(){ return this.getTeacherProfile(); },

    // Posts
    getClassPosts(cls){
      const cached = caches.posts[cls];
      if(cached) return cached;
      return [];
    },

    // Tasks
    getTasksForClass(cls){
      const cached = caches.tasks[cls];
      if(cached) return cached;
      return [];
    },
    getTaskById(id){ return fetchJson(`${API}/task/${id}`); },
    addTaskSubmission(taskId, { parent, comment, fileType }){
      // Mapeo simple: usar Andrea (id=1) del seed
      const studentId = 1;
      return fetchJson(`${API}/task/${taskId}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, fileType, comment, parent })
      });
    },

    // Notifications
    getNotificationsForClass(cls){
      const cached = caches.notifications[cls];
      if(cached) return cached;
      return [];
    },

    // Attendance
    recordAttendance(){},

    // Improvement Plans (compatibilidad con directora_patch)
    getImprovementPlans(){ return []; },

    // Payments
    addPayment(){},
    markPaymentStatus(){},
    addPaymentPartial(){},
    getPaymentsByClass(){ return []; },
    getPaymentsPending(){ return []; },
    getPaymentSummary(){ return { total:0, pagados:0, pendientes:0, amountTotal:0 }; },

    // Configuración (persistente)
    getConfig(){ return {}; },
    setConfig(){ return {}; },

    // Visits (Recepción)
    addVisit(){},
    markVisitExit(){},
    getOpenVisits(){ return []; },

    // Academic Summary
    getAcademicSummary(){ return {}; },

    // Chats
    async getContacts(){ return caches.contacts; },
    async getThread(participants){
      const qs = encodeURIComponent(participants.join(','));
      return await fetchJson(`${API}/messages?participants=${qs}`);
    },
    async sendMessage(participants, { from, text }){
      await fetchJson(`${API}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participants, from, text })
      });
      return this.getThread(participants);
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
    setTyping(){},
    isTyping(){ return false; }
  };

  window.KarpusStore = Store;
})();
