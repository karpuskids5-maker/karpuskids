/**
 * KarpusStore v2
 * Extiende el store para adjuntos en publicaciones, comentarios, reacciones y módulo de pagos.
 * Mantiene compatibilidad con métodos esperados por scripts existentes.
 */
 (function(){
  const API = 'http://127.0.0.1:5600/api';
  let USE_SUPABASE = false;
  const caches = {
    classes: [],
    posts: {}, // by class
    tasks: {}, // by class
    notifications: {}, // by class
    contacts: [],
  };
  async function fetchJson(url, opts){
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { ...(opts||{}), signal: controller.signal });
      clearTimeout(id);
      if(!res.ok) throw new Error('HTTP '+res.status);
      return res.json();
    } catch (e) {
      caches.error = e;
      throw e;
    }
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
    } catch(e){ 
      caches.error = e;
      USE_SUPABASE = !!window.supabase;
      if (USE_SUPABASE) {
        try {
          const sb = window.supabase;
          const { data: rooms } = await sb.from('classrooms').select('id,name,level').order('id');
          caches.classes = rooms || [];
          caches.contacts = [
            { id: 'maestra', name: 'Maestra Ana' },
            { id: 'directora', name: 'Directora' }
          ];
          // Mantener posts/tasks/notifications vacíos en fallback
        } catch (se) {}
      }
    }
  }
  const ready = preload();

  const Store = {
    ready,
    getError() { return caches.error; },
    getClasses(){ return caches.classes || []; },
    getState(){ return {}; },
    reset(){},

    // Perfil de maestra/directora desde API
    async getTeacherProfile(){ 
      if (USE_SUPABASE && window.supabase) {
        const { data } = await window.supabase.from('profiles').select('name,email').eq('role','maestra').limit(1);
        const p = (data||[])[0] || { name: 'Maestra', email: '' };
        return p;
      }
      return await fetchJson(`${API}/profiles/teacher`);
    },
    async getDirectorProfile(){ 
      if (USE_SUPABASE && window.supabase) {
        const { data } = await window.supabase.from('profiles').select('name').eq('role','directora').limit(1);
        const p = (data||[])[0] || { name: 'Directora' };
        return p;
      }
      return await fetchJson(`${API}/profiles/director`);
    },
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
    async getAttendance(studentId, date) {
      let qs = [];
      if (studentId) qs.push(`studentId=${studentId}`);
      if (date) qs.push(`date=${date}`);
      const q = qs.length ? '?' + qs.join('&') : '';
      if (USE_SUPABASE && window.supabase) {
        let query = window.supabase.from('attendance').select('*');
        if (studentId) query = query.eq('student_id', studentId);
        if (date) query = query.eq('date', date);
        const { data } = await query;
        return data || [];
      }
      return await fetchJson(`${API}/attendance${q}`);
    },
    recordAttendance(){},

    // Improvement Plans (compatibilidad con directora_patch)
    getImprovementPlans(){ return []; },

    // Teachers
    async getTeachers(){ 
      if (USE_SUPABASE && window.supabase) {
        const { data } = await window.supabase.from('profiles').select('id,name,email,role').eq('role','maestra').order('name');
        return data || [];
      }
      return await fetchJson(`${API}/teachers`); 
    },

    // Login
    async login(username, password) {
      return await fetchJson(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
    },

    // Students
    async getStudents(classId){ 
        const qs = classId ? `?classId=${classId}` : '';
        if (USE_SUPABASE && window.supabase) {
          let query = window.supabase.from('students').select('*, classrooms(name, level)');
          if (classId) query = query.eq('classroom_id', classId);
          const { data } = await query;
          return data || [];
        }
        return await fetchJson(`${API}/students${qs}`); 
    },
    
    // Rooms (Classrooms)
    async getRooms(){ 
      if (USE_SUPABASE && window.supabase) {
        const { data } = await window.supabase.from('classrooms').select('id,name,level').order('id');
        return data || [];
      }
      return await fetchJson(`${API}/classrooms`); 
    },

    // Payments
    async getPayments(studentId){
        const qs = studentId ? `?studentId=${studentId}` : '';
        if (USE_SUPABASE && window.supabase) {
            let query = window.supabase.from('payments').select('*, students(name)');
            if (studentId) query = query.eq('student_id', studentId);
            const { data } = await query;
            return data || [];
        }
        return await fetchJson(`${API}/payments${qs}`);
    },
    addPayment(){},
    markPaymentStatus(){},
    addPaymentPartial(){},
    async getPaymentsByClass(classId){ 
       // Fetch all payments and filter (optimization: add API filter later)
       const payments = await this.getPayments();
       // Fetch students in class
       const students = await this.getStudents(classId);
       const studentIds = new Set(students.map(s => s.id));
       return payments.filter(p => studentIds.has(p.student_id));
    },
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

  Store.sendParentEmail = function(to, payload){
    return fetchJson(`${API}/parents/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject: payload.subject, html: payload.html, text: payload.text })
    });
  };

  window.KarpusStore = Store;
})();

