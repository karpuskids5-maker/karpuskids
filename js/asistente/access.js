import { supabase, emitEvent } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';
import { AssistantApi } from './api.js';

let isProcessing = false;
let _accessChart = null;

export const AccessModule = {

  async init() {
    this._initFilters();
    this._initOfflineSupport();
    await this.loadStats();
    await this.loadHistory();
    this._bindSearch();
  },

  _initFilters() {
    const today = new Date().toISOString().split('T')[0];
    const fromInput = document.getElementById('accessFilterFrom');
    const toInput   = document.getElementById('accessFilterTo');
    
    if (fromInput) fromInput.value = today;
    if (toInput) toInput.value = today;

    document.getElementById('btnApplyAccessFilters')?.addEventListener('click', () => {
      this.loadStats();
      this.loadHistory();
      this.updateChart();
    });
  },

  _bindSearch() {
    const input = document.getElementById('searchAccessTable');
    if (input) {
      input.addEventListener('input', Helpers.debounce((e) => {
        this.loadHistory(e.target.value);
      }, 300));
    }
  },

  setPunchType(type) {
    this._punchType = type;
    const btns = document.querySelectorAll('#qrScannerModal button[onclick*="setPunchType"]');
    btns.forEach(b => {
      b.classList.remove('ring-4', 'ring-teal-200', 'border-teal-400');
      if (b.getAttribute('onclick').includes(type)) {
        b.classList.add('ring-4', 'ring-teal-200', 'border-teal-400');
      }
    });
    Helpers.toast(`Modo seleccionado: ${type === 'present' ? 'ENTRADA' : 'SALIDA'}`, 'info');
  },

  async openScanner() {
    this._punchType = 'present'; // Default
    const modal = document.getElementById('qrScannerModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    this.setPunchType('present');

    try {
      if (!window.Html5QrcodeScanner) {
        throw new Error('Librería QR no cargada');
      }

      this._scanner = new Html5Qrcode("qrReaderInline");
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };
      
      await this._scanner.start({ facingMode: "environment" }, config, (decodedText) => {
        this.register(decodedText, this._punchType);
        this.closeScanner();
      });
    } catch (err) {
      console.error('QR Error:', err);
      Helpers.toast('No se pudo iniciar la cámara', 'error');
    }
  },

  closeScanner() {
    if (this._scanner) {
      this._scanner.stop().catch(() => {});
      this._scanner = null;
    }
    const modal = document.getElementById('qrScannerModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  },

  stopScanner() {
    this.closeScanner();
  },

  _initOfflineSupport() {
    window.addEventListener('online', () => {
      Helpers.toast('Conexión restaurada. Sincronizando...', 'info');
      this._syncOfflinePunches();
    });
    window.addEventListener('offline', () => {
      Helpers.toast('Modo Offline: Los accesos se guardarán localmente.', 'warning');
    });
  },

  async _syncOfflinePunches() {
    try {
      const offline = JSON.parse(localStorage.getItem('karpus_offline_punches') || '[]');
      if (!offline.length) return;

      Helpers.showLoader('Sincronizando datos...');
      
      for (const p of offline) {
        await supabase.rpc('process_door_punch', {
          p_code: p.matricula
        });
      }

      localStorage.removeItem('karpus_offline_punches');
      Helpers.hideLoader();
      Helpers.toast('Sincronización completada con éxito', 'success');
      this.loadHistory();
    } catch (e) {
      console.error('Error syncing offline punches:', e);
      Helpers.hideLoader();
    }
  },

  // ── Registro de Acceso (Ponche) ───────────────────────────────────────────
  async register(qrText, type) {
    if (isProcessing) return;
    isProcessing = true;

    let matricula = null;

    // Parse QR data (supports both formats)
    try {
      const qrData = JSON.parse(qrText);
      // New short format
      if (qrData.m) {
        matricula = qrData.m;
      }
      // Old long format
      else if (qrData.matricula) {
        matricula = qrData.matricula;
      }
    } catch (e) {
      // If it's not JSON, assume it's just a matricula string
      matricula = qrText;
    }

    if (!navigator.onLine) {
      this._handleOfflinePunch(matricula, type);
      isProcessing = false;
      return;
    }

    try {
      // Get student by matricula
      const { data: student, error: sErr } = await supabase
        .from('students')
        .select('id, name, avatar_url, parent_id, classrooms:classroom_id(name)')
        .eq('matricula', matricula)
        .maybeSingle();

      if (sErr || !student) throw new Error('Estudiante no encontrado');

      // ── ALERTA DE SALIDA SEGURA (NUEVO) ──
      if (type === 'retirado') {
        const confirmed = await this._showSecureExitPopup(student);
        if (!confirmed) {
          isProcessing = false;
          return;
        }
      }

      const now = new Date();
      const today = now.toISOString().split('T')[0];

      // Determinar si es entrada o salida para la DB
      const { error: pErr } = await supabase.rpc('process_door_punch', {
        p_code: matricula
      });

      if (pErr) throw pErr;

      this._showPunchFeedback(student, type);
      await this.loadStats();
      await this.loadHistory();

    } catch (err) {
      console.error('Error registerAccess:', err);
      Helpers.toast(err.message || 'Error al registrar acceso', 'error');
    } finally {
      isProcessing = false;
    }
  },

  _handleOfflinePunch(matricula, type) {
    try {
      const offline = JSON.parse(localStorage.getItem('karpus_offline_punches') || '[]');
      offline.push({
        matricula,
        type,
        time: new Date().toISOString()
      });
      localStorage.setItem('karpus_offline_punches', JSON.stringify(offline));
      
      // Feedback visual offline
      Helpers.toast('Acceso guardado localmente (Offline)', 'warning');
      
      // Feedback sonoro (si está disponible)
      try { new Audio('assets/sounds/offline.mp3').play().catch(()=>{}); } catch(_){}

      this.loadHistory(); // Refrescar tabla (mostrará datos locales si se implementa)
    } catch (e) {
      console.error('Error saving offline punch:', e);
    }
  },

  toggleExteriorMode() {
    const btn = document.getElementById('btnExteriorMode');
    const isDark = document.body.classList.toggle('exterior-mode');
    
    if (isDark) {
      document.documentElement.style.setProperty('--bg', '#000000');
      document.documentElement.style.setProperty('--surface', '#1a1a1a');
      document.body.style.fontSize = '110%';
      btn.innerHTML = '<i data-lucide="moon" class="w-4 h-4 text-blue-400"></i> Modo Normal';
      Helpers.toast('Modo Exterior: Alto Contraste Activado', 'info');
    } else {
      document.documentElement.style.removeProperty('--bg');
      document.documentElement.style.removeProperty('--surface');
      document.body.style.fontSize = '';
      btn.innerHTML = '<i data-lucide="sun" class="w-4 h-4 text-amber-400"></i> Modo Exterior';
    }
    if (window.lucide) lucide.createIcons();
  },

  async _showSecureExitPopup(student) {
    return new Promise(async (resolve) => {
      // Obtener personas autorizadas
      const { data: authorized } = await supabase
        .from('authorized_pickups')
        .select('name, relationship, phone, photo_url')
        .eq('student_id', student.id);

      const modalId = 'secureExitModal';
      const content = `
        <div class="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-slideUp">
          <div class="bg-rose-600 p-6 text-white flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center animate-pulse">
                <i data-lucide="shield-alert" class="w-7 h-7"></i>
              </div>
              <div>
                <h3 class="text-xl font-black uppercase tracking-tighter">Protocolo de Salida Segura</h3>
                <p class="text-xs font-bold text-rose-100 uppercase tracking-widest">Verificación de Identidad Obligatoria</p>
              </div>
            </div>
          </div>
          
          <div class="p-8">
            <div class="flex items-center gap-6 mb-8 p-4 bg-slate-50 rounded-3xl border-2 border-slate-100">
              <div class="w-20 h-20 rounded-2xl bg-white border-4 border-white shadow-md overflow-hidden shrink-0">
                ${student.avatar_url ? `<img src="${student.avatar_url}" class="w-full h-full object-cover">` : `<div class="w-full h-full flex items-center justify-center bg-teal-50 text-teal-600 font-black text-2xl">${student.name.charAt(0)}</div>`}
              </div>
              <div>
                <h4 class="text-lg font-black text-slate-800">${student.name}</h4>
                <p class="text-sm font-bold text-teal-600 uppercase tracking-widest">${student.classrooms?.name || 'Aula no asignada'}</p>
              </div>
            </div>

            <h5 class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 ml-1">Personas Autorizadas</h5>
            <div class="space-y-3 mb-8">
              ${authorized?.length ? authorized.map(a => `
                <div class="flex items-center gap-4 p-3 bg-emerald-50 border border-emerald-100 rounded-2xl">
                  <div class="w-10 h-10 rounded-xl bg-white border border-emerald-200 overflow-hidden flex items-center justify-center shrink-0">
                    ${a.photo_url ? `<img src="${a.photo_url}" class="w-full h-full object-cover">` : `<i data-lucide="user" class="w-5 h-5 text-emerald-300"></i>`}
                  </div>
                  <div class="flex-1">
                    <p class="text-sm font-black text-emerald-900">${a.name}</p>
                    <p class="text-[10px] font-bold text-emerald-600 uppercase">${a.relationship} · ${a.phone || 'Sin tel'}</p>
                  </div>
                  <div class="w-6 h-6 bg-emerald-500 text-white rounded-full flex items-center justify-center"><i data-lucide="check" class="w-4 h-4"></i></div>
                </div>
              `).join('') : `
                <div class="p-6 text-center bg-amber-50 border-2 border-dashed border-amber-200 rounded-2xl">
                  <p class="text-sm font-black text-amber-700">⚠️ Sin lista de autorizados</p>
                  <p class="text-[10px] font-bold text-amber-600/70 uppercase mt-1">Contactar al padre inmediatamente</p>
                </div>
              `}
            </div>

            <div class="grid grid-cols-2 gap-4">
              <button id="btnCancelExit" class="py-4 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase text-xs hover:bg-slate-200 transition-all">Cancelar</button>
              <button id="btnConfirmExit" class="py-4 bg-rose-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg shadow-rose-200 hover:bg-rose-700 transition-all active:scale-95">Confirmar Salida</button>
            </div>
          </div>
        </div>
      `;

      const overlay = document.getElementById('punchFeedbackOverlay');
      if (overlay) {
        overlay.innerHTML = content;
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
      }

      if (window.lucide) lucide.createIcons();

      document.getElementById('btnCancelExit').onclick = () => {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
        resolve(false);
      };

      document.getElementById('btnConfirmExit').onclick = () => {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
        resolve(true);
      };
    });
  },

  _showPunchFeedback(student, type) {
    const isEntry = type === 'present' || type === 'late';
    const color = isEntry ? 'emerald' : 'blue';
    const icon  = isEntry ? 'check-circle' : 'log-out';
    const title = isEntry ? 'Entrada Registrada' : 'Salida Registrada';
    
    // Feedback de Sonido
    try {
      const audio = new Audio(isEntry ? 'assets/sounds/success.mp3' : 'assets/sounds/exit.mp3');
      audio.play().catch(() => {});
    } catch (_) {}

    const content = `
      <div class="bg-white rounded-[3rem] shadow-2xl p-10 text-center animate-bounceIn max-w-xs w-full">
        <div class="w-24 h-24 bg-${color}-100 text-${color}-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
          <i data-lucide="${icon}" class="w-12 h-12"></i>
        </div>
        <h3 class="text-2xl font-black text-slate-800 mb-2">${title}</h3>
        <p class="text-sm font-bold text-slate-400 uppercase tracking-widest mb-6">${student.name}</p>
        <div class="py-3 px-6 bg-${color}-50 text-${color}-700 rounded-2xl font-black text-xs uppercase tracking-tighter">
          Acceso Autorizado ✅
        </div>
      </div>
    `;

    const overlay = document.getElementById('punchFeedbackOverlay');
    if (overlay) {
      overlay.innerHTML = content;
      overlay.classList.remove('hidden');
      overlay.style.display = 'flex';
      if (window.lucide) lucide.createIcons();
      
      setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
      }, 2500);
    }
  },

  // ── Estadísticas con Filtro ──────────────────────────────────────────────
  async loadStats() {
    try {
      const from = document.getElementById('accessFilterFrom')?.value;
      const to = document.getElementById('accessFilterTo')?.value;
      
      // Estadísticas de estudiantes (desde attendance)
      let qAtt = supabase.from('attendance').select('status, check_out');
      if (from) qAtt = qAtt.gte('date', from);
      if (to) qAtt = qAtt.lte('date', to);
      const { data: attData } = await qAtt;

      // Estadísticas de personal (desde door_punches)
      let qStaff = supabase.from('door_punches').select('punch_type').not('staff_id', 'is', null);
      if (from) qStaff = qStaff.gte('date', from);
      if (to) qStaff = qStaff.lte('date', to);
      const { data: staffData } = await qStaff;

      const present  = (attData || []).filter(r => ['present', 'late'].includes(r.status)).length;
      const late     = (attData || []).filter(r => r.status === 'late').length;
      const checkouts = (attData || []).filter(r => r.status === 'retirado').length;
      
      // Personal presente (tienen check_in pero no necesariamente check_out aún)
      // Para simplificar, contamos los check_ins del personal
      const staffIns = (staffData || []).filter(p => p.punch_type === 'check_in').length;

      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('statAccessPresent',  present + staffIns);
      set('statAccessLate',     late);
      set('statAccessCheckout', checkouts + (staffData || []).filter(p => p.punch_type === 'check_out').length);
      set('statAccessTotal',    (attData || []).length + staffIns);
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  },

  // ── Historial Detallado (Tabla) ───────────────────────────────────────────
  async loadHistory(query = '') {
    const tbody = document.getElementById('accessTableBody');
    if (!tbody) return;

    tbody.innerHTML = Helpers.skeleton(5, 'h-16');

    try {
      const fromInput = document.getElementById('accessFilterFrom')?.value;
      const toInput   = document.getElementById('accessFilterTo')?.value;
      const status    = document.getElementById('accessFilterStatus')?.value;

      // Por defecto mostrar solo HOY si no hay filtros manuales
      const todayStr = new Date().toISOString().split('T')[0];
      const from = fromInput || todayStr;
      const to   = toInput   || todayStr;

      // 1. Asistencia de Estudiantes
      let qAtt = supabase
        .from('attendance')
        .select('id, date, check_in, check_out, status, student_id, student:student_id(name, matricula, avatar_url)')
        .gte('date', from).lte('date', to)
        .order('date', { ascending: false })
        .order('check_in', { ascending: false });

      if (status && status !== 'all' && status !== 'staff') qAtt = qAtt.eq('status', status);

      const { data: attData, error: attErr } = await qAtt.limit(500);
      if (attErr) throw attErr;

      // 2. Ponches del Personal
      let qPunches = supabase
        .from('door_punches')
        .select('id, date, punched_at, punch_type, staff_id, staff:staff_id(name, role, matricula, access_code, avatar_url)')
        .not('staff_id', 'is', null)
        .gte('date', from).lte('date', to)
        .order('date', { ascending: false })
        .order('punched_at', { ascending: false });

      const { data: punchData, error: punchErr } = await qPunches.limit(500);
      if (punchErr) throw punchErr;

      // 3. Agrupar ponches del personal por persona+día (evita duplicados)
      const staffGroups = {};
      (punchData || []).forEach(p => {
        const key = `${p.staff_id}-${p.date}`;
        if (!staffGroups[key]) {
          staffGroups[key] = {
            id: p.id, date: p.date,
            check_in: null, check_out: null,
            status: 'staff',
            name: p.staff?.name || 'Personal',
            role: p.staff?.role || 'staff',
            id_code: p.staff?.access_code || p.staff?.matricula || '—',
            avatar: p.staff?.avatar_url,
            type: 'staff'
          };
        }
        if (p.punch_type === 'check_in')  staffGroups[key].check_in  = p.punched_at;
        if (p.punch_type === 'check_out') staffGroups[key].check_out = p.punched_at;
      });
      const staffLogs = Object.values(staffGroups);

      // 4. Mapear estudiantes
      const studentLogs = (attData || []).map(log => ({
        id: log.id, date: log.date,
        check_in: log.check_in, check_out: log.check_out,
        status: log.status,
        name: log.student?.name || 'Estudiante',
        role: 'Estudiante',
        id_code: log.student?.matricula || '—',
        avatar: log.student?.avatar_url,
        type: 'student'
      }));

      // 5. Filtrar por tipo si se seleccionó "staff"
      let combined = status === 'staff'
        ? staffLogs
        : [...studentLogs, ...staffLogs];

      // 6. Ordenar por fecha desc
      combined.sort((a, b) => {
        const da = new Date(a.date + 'T' + (a.check_in ? new Date(a.check_in).toTimeString().slice(0,8) : '00:00:00'));
        const db = new Date(b.date + 'T' + (b.check_in ? new Date(b.check_in).toTimeString().slice(0,8) : '00:00:00'));
        return db - da;
      });

      // 7. Filtro por nombre/ID
      if (query) {
        const term = query.toLowerCase();
        combined = combined.filter(c =>
          c.name.toLowerCase().includes(term) || c.id_code.toLowerCase().includes(term)
        );
      }

      combined = combined.slice(0, 200);

      if (!combined.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-slate-300 font-bold uppercase tracking-widest text-xs">Sin registros encontrados</td></tr>`;
        return;
      }

      tbody.innerHTML = combined.map(log => {
        const dateStr = new Date(log.date + 'T12:00:00').toLocaleDateString('es-DO', { day: '2-digit', month: 'short' });
        const inTime = log.check_in ? new Date(log.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
        const outTime = log.check_out ? new Date(log.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
        
        let statusBadge = '';
        if (log.status === 'present') statusBadge = '<span class="px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[9px] font-black uppercase tracking-tighter shadow-sm border border-emerald-100">Entrada</span>';
        else if (log.status === 'late') statusBadge = '<span class="px-2.5 py-1 bg-amber-50 text-amber-600 rounded-lg text-[9px] font-black uppercase tracking-tighter shadow-sm border border-amber-100">Tardanza</span>';
        else if (log.status === 'retirado') statusBadge = '<span class="px-2.5 py-1 bg-blue-50 text-blue-600 rounded-lg text-[9px] font-black uppercase tracking-tighter shadow-sm border border-blue-100">Salida</span>';
        else if (log.status === 'staff') statusBadge = '<span class="px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[9px] font-black uppercase tracking-tighter shadow-sm border border-indigo-100">Personal</span>';

        const roleLabels = { maestra: 'Maestra', asistente: 'Asistente', directora: 'Directora', admin: 'Admin', staff: 'Personal' };
        const roleLabel = log.type === 'student' ? 'Estudiante' : (roleLabels[log.role] || log.role);
        const roleClass = log.type === 'student' ? 'bg-teal-50 text-teal-600 border-teal-100' : 'bg-indigo-50 text-indigo-600 border-indigo-100';

        return `
          <tr class="hover:bg-slate-50/80 transition-all group">
            <td class="px-8 py-4">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-2xl bg-white border-2 border-slate-100 shadow-sm overflow-hidden shrink-0 group-hover:border-teal-200 transition-all">
                  ${log.avatar ? `<img src="${log.avatar}" class="w-full h-full object-cover">` : `<div class="w-full h-full flex items-center justify-center bg-slate-50 text-slate-300 font-black">${log.name.charAt(0)}</div>`}
                </div>
                <div>
                  <span class="font-black text-slate-700 text-sm block group-hover:text-teal-600 transition-colors">${Helpers.escapeHTML(log.name)}</span>
                  <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">${roleLabel}</span>
                </div>
              </div>
            </td>
            <td class="px-8 py-4">
              <span class="px-2 py-0.5 rounded-md text-[9px] font-black uppercase border ${roleClass}">${roleLabel}</span>
            </td>
            <td class="px-8 py-4 font-mono text-[10px] text-slate-400 font-bold tracking-tighter">${log.id_code}</td>
            <td class="px-8 py-4">
              <div class="text-sm font-black text-slate-600">${dateStr}</div>
              <div class="text-[9px] font-bold text-slate-300 uppercase tracking-widest">Fecha</div>
            </td>
            <td class="px-8 py-4 text-center">
              <div class="font-black text-slate-800 italic text-sm">${inTime}</div>
              <div class="text-[9px] font-bold text-slate-300 uppercase tracking-widest">Entrada</div>
            </td>
            <td class="px-8 py-4 text-center">
              <div class="font-black text-slate-800 italic text-sm">${outTime}</div>
              <div class="text-[9px] font-bold text-slate-300 uppercase tracking-widest">Salida</div>
            </td>
            <td class="px-8 py-4 text-center">${statusBadge}</td>
          </tr>`;
      }).join('');

      if (window.lucide) lucide.createIcons();
    } catch (err) {
      console.error('Error loading history:', err);
      tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-rose-500 font-bold">${Helpers.errorState('Fallo al cargar historial')}</td></tr>`;
    }
  },

  // ── Gráfico de Tendencia ──────────────────────────────────────────────────
  async initChart() {
    const ctx = document.getElementById('accessChart')?.getContext('2d');
    if (!ctx) return;

    if (!window.Chart) {
      await this._loadChartJs();
    }

    this.updateChart();
  },

  async updateChart() {
    const ctx = document.getElementById('accessChart')?.getContext('2d');
    if (!ctx) return;

    try {
      const from = document.getElementById('accessFilterFrom')?.value;
      const { data } = await supabase.from('attendance').select('date, status').gte('date', from).order('date');
      
      const days = [...new Set(data.map(d => d.date))].slice(-7);
      const entries = days.map(day => data.filter(d => d.date === day && d.status === 'present').length);
      const lates = days.map(day => data.filter(d => d.date === day && d.status === 'late').length);

      if (_accessChart) _accessChart.destroy();

      _accessChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: days.map(d => new Date(d + 'T12:00:00').toLocaleDateString('es-DO', { weekday: 'short' })),
          datasets: [
            { label: 'Entradas', data: entries, borderColor: '#10b981', backgroundColor: '#10b98120', fill: true, tension: 0.4 },
            { label: 'Tardanzas', data: lates, borderColor: '#f59e0b', backgroundColor: '#f59e0b20', fill: true, tension: 0.4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }
        }
      });
    } catch (e) { /* silencioso */ }
  },async _loadChartJs() {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script.onload = resolve;
      document.head.appendChild(script);
    });
  },

  // ── Exportación a Excel (Simple CSV) ───────────────────────────────────────
  async exportToExcel() {
    const rows = [['Nombre', 'Rol', 'ID/Matricula', 'Fecha', 'Entrada', 'Salida', 'Estado']];
    const tbody = document.querySelectorAll('#accessTableBody tr');
    
    tbody.forEach(tr => {
      const cols = tr.querySelectorAll('td');
      if (cols.length < 7) return;
      rows.push([
        cols[0].querySelector('span')?.textContent || '',
        cols[1].querySelector('span')?.textContent || '',
        cols[2].textContent,
        cols[3].textContent,
        cols[4].textContent,
        cols[5].textContent,
        cols[6].textContent.trim()
      ]);
    });

    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `reporte_asistencia_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    Helpers.toast('Reporte generado correctamente');
  },

  async updateChart() {
    const ctx = document.getElementById('accessChart')?.getContext('2d');
    if (!ctx) return;

    try {
      const fromInput = document.getElementById('accessFilterFrom')?.value;
      const toInput   = document.getElementById('accessFilterTo')?.value;

      // Fallback: si no hay filtro de fecha, mostrar últimos 7 días
      const today = new Date();
      const defaultFrom = new Date(today); defaultFrom.setDate(today.getDate() - 6);
      const from = fromInput || defaultFrom.toISOString().split('T')[0];
      const to   = toInput   || today.toISOString().split('T')[0];

      // 1. Datos Estudiantes
      const { data: attData } = await supabase
        .from('attendance').select('date, status')
        .gte('date', from).lte('date', to).order('date');

      // 2. Datos Personal (solo check_ins)
      const { data: staffData } = await supabase
        .from('door_punches').select('date')
        .eq('punch_type', 'check_in').not('staff_id', 'is', null)
        .gte('date', from).lte('date', to).order('date');

      // Generar rango de días completo (sin huecos)
      const days = [];
      const cur = new Date(from + 'T12:00:00');
      const end = new Date(to   + 'T12:00:00');
      while (cur <= end) {
        days.push(cur.toISOString().split('T')[0]);
        cur.setDate(cur.getDate() + 1);
      }

      const entries = days.map(day => {
        const attCount   = (attData  || []).filter(d => d.date === day && d.status === 'present').length;
        const staffCount = (staffData || []).filter(d => d.date === day).length;
        return attCount + staffCount;
      });
      const lates = days.map(day =>
        (attData || []).filter(d => d.date === day && d.status === 'late').length
      );

      if (_accessChart) _accessChart.destroy();

      _accessChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: days.map(d => new Date(d + 'T12:00:00').toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric' })),
          datasets: [
            { label: 'Entradas', data: entries, borderColor: '#10b981', backgroundColor: '#10b98120', fill: true, tension: 0.4, pointRadius: 4 },
            { label: 'Tardanzas', data: lates,   borderColor: '#f59e0b', backgroundColor: '#f59e0b20', fill: true, tension: 0.4, pointRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true, labels: { boxWidth: 12, font: { size: 10, weight: 'bold' } } } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }
        }
      });
    } catch (e) {
      console.error('Error updating chart:', e);
    }
  }
};

// Delegación global para botones de ponche en resultados de búsqueda
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.punch-btn');
  if (!btn) return;
  const { id, type } = btn.dataset;
  if (id && type) window.App?.access?.register(id, type);
});
