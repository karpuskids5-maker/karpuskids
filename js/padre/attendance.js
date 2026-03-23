import { supabase } from '../supabase.js';
import { AppState } from './appState.js';

// attendance.js
// Módulo para carga/filtrado/visualización de asistencia con cache IndexedDB y realtime Supabase

/* Usage:
import Attendance from './padre/attendance.js';
await Attendance.init({ studentId, onRenderCalendar, onStatsUpdate });
await Attendance.loadAttendance({ filter: 'week' | 'month' });
*/

const DB_NAME = 'karpus_cache_v1';
const STORE_ATTENDANCE = 'attendance';
const CACHE_TTL = 1000 * 60 * 5; // 5 minutos por seguridad

// --- IndexedDB simple promise wrapper ---
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_ATTENDANCE)) {
        db.createObjectStore(STORE_ATTENDANCE, { keyPath: 'cacheKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(cacheKey, value) {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ATTENDANCE, 'readwrite');
      const store = tx.objectStore(STORE_ATTENDANCE);
      store.put({ cacheKey, value, ts: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IDB put error'));
    });
  } catch (e) {
    console.debug('IDB put failed', e);
  }
}

async function idbGet(cacheKey) {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ATTENDANCE, 'readonly');
      const store = tx.objectStore(STORE_ATTENDANCE);
      const req = store.get(cacheKey);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.debug('IDB get failed', e);
    return null;
  }
}

function dateDiffDays(a, b) {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((da - db) / (24 * 3600 * 1000));
}

// --- Utils fecha sin timezone ---
function toISODateLocal(d) {
  // returns YYYY-MM-DD for local date
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseISODateNoTZ(str) {
  // Parse 'YYYY-MM-DD' as local date start
  const [y, m, d] = String(str).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// --- Attendance module ---
const Attendance = {
  _studentId: null,
  _cacheKey: null,
  _lastLoadTs: 0,
  _attendance: [], // array of {id, student_id, date, status, created_at}
  _realtimeChannel: null,
  _opts: {},
  _currentFilter: 'week',
  _renderTimeout: null,

  async init({ studentId, onRenderCalendar, onStatsUpdate, useRealtime = true }) {
    if (!studentId) throw new Error('Attendance.init: studentId required');
    this._studentId = String(studentId);
    this._cacheKey = `attendance_${this._studentId}`;
    this._opts.onRenderCalendar = onRenderCalendar || function(){};
    this._opts.onStatsUpdate = onStatsUpdate || function(){};
    this._opts.useRealtime = useRealtime;

    if (useRealtime) this._initRealtime();

    return this;
  },

  async _initRealtime() {
    try {
      if (this._realtimeChannel) {
        await supabase.removeChannel(this._realtimeChannel);
        this._realtimeChannel = null;
      }

      const channel = supabase
        .channel(`attendance_student_${this._studentId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'attendance',
          filter: `student_id=eq.${this._studentId}`
        }, (payload) => {
          if (!payload) return;
          console.log('⚡ Realtime attendance:', payload);

          if (payload.eventType === 'INSERT') {
            this._onRemoteInsert(payload.new);
          } else if (payload.eventType === 'UPDATE') {
            this._onRemoteUpdate(payload.new);
          } else if (payload.eventType === 'DELETE') {
            this._onRemoteDelete(payload.old);
          }

          // 🔥 CLAVE: sincronizar con AppState
          AppState.set('attendanceUpdated', Date.now());
        })
        .subscribe((status) => {
          console.log('📡 Realtime status:', status);
        });

      this._realtimeChannel = channel;

    } catch (e) {
      console.warn('Realtime init failed', e);
    }
  },

  _onRemoteInsert(row) {
    // avoid duplicates
    if (!row || String(row.student_id) !== this._studentId) return;
    const exists = this._attendance.some(r => r.id === row.id);
    if (exists) return;
    this._attendance.push(row);
    this._attendance.sort((a,b)=> b.date.localeCompare(a.date));
    this._persistCache();
    this._applyRender(this._currentFilter); // fuerza actualización visual
  },
  _onRemoteUpdate(row) {
    if (!row || String(row.student_id) !== this._studentId) return;
    const idx = this._attendance.findIndex(r => String(r.id) === String(row.id));
    if (idx === -1) {
      this._attendance.push(row);
    } else {
      this._attendance[idx] = row;
    }
    this._attendance.sort((a,b)=> b.date.localeCompare(a.date));
    this._persistCache();
    this._applyRender(this._currentFilter); // fuerza actualización visual
  },
  _onRemoteDelete(oldRow) {
    if (!oldRow || String(oldRow.student_id) !== this._studentId) return;
    this._attendance = this._attendance.filter(r => String(r.id) !== String(oldRow.id));
    this._persistCache();
    this._applyRender(this._currentFilter); // fuerza actualización visual
  },

  async _persistCache() {
    try { await idbPut(this._cacheKey, { ts: Date.now(), data: this._attendance }); }
    catch(e){ console.debug('cache persist err', e); }
  },

  async loadAttendance({ forceRefresh = false, filter = 'week' } = {}) {
    // flow:
    // 1) try cache (if not too old) -> use it as fallback
    // 2) try supabase query -> if success replace and persist
    // 3) if supabase fails and cache present use cache

    if (!this._studentId) throw new Error('loadAttendance: init first');

    this._currentFilter = filter;

    const now = Date.now();
    const cache = await idbGet(this._cacheKey);
    if (cache && cache.ts && !forceRefresh && (now - cache.ts) < CACHE_TTL) {
      console.debug('[attendance] using cache');
      this._attendance = cache.data || [];
      this._lastLoadTs = cache.ts;
      this._applyRender(filter);
      // still continue to refresh in background if TTL approaching
    }

    // Query Supabase
    try {
      // Ensure date ordering desc
      const { data, error } = await supabase
        .from('attendance')
        .select('id, student_id, date, status, created_at')
        .eq('student_id', this._studentId)
        .order('date', { ascending: false });

      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Invalid attendance response');

      const normalizeDate = (date) => {
        try {
          return new Date(date).toISOString().split('T')[0];
        } catch {
          return null;
        }
      };

      // Validate rows and normalize dates to YYYY-MM-DD strings
      const cleaned = data.map(r => {
        return {
          id: r.id,
          student_id: String(r.student_id),
          date: typeof r.date === 'string' ? r.date : null, // NO tocar la fecha, ya viene correcta desde Supabase
          status: r.status,
          created_at: r.created_at
        };
      }).filter(r => {
        if (!r || !r.date) return false;

        if (String(r.student_id) !== String(this._studentId)) {
          console.warn('⚠️ student_id mismatch', r.student_id, this._studentId);
          return false;
        }

        return true;
      });

      // Sort desc by date (safeguard)
      cleaned.sort((a,b)=> b.date.localeCompare(a.date));

      this._attendance = cleaned;
      this._lastLoadTs = Date.now();
      await this._persistCache();

      this._applyRender(filter);

      return this._attendance;

    } catch (err) {
      console.error('[attendance] load error', err);
      if (this._attendance && this._attendance.length) {
        console.debug('[attendance] using stale cache due to error');
        this._applyRender(filter);
        return this._attendance;
      }
      throw err; // bubble up if nothing to show
    }
  },

  _applyRender(filter = 'week') {
    const activeFilter = filter || this._currentFilter || 'week';

    if (this._renderTimeout) clearTimeout(this._renderTimeout);

    this._renderTimeout = setTimeout(() => {
      const { days, stats } = this.renderCalendarData({
        attendanceList: this._attendance,
        filter: activeFilter
      });

      console.log('📊 Stats:', stats);
      console.log('📅 Days:', days);

      try { this._opts.onStatsUpdate(stats); } catch(e){ console.warn(e); }
      try { this._opts.onRenderCalendar(days, stats); } catch(e){ console.warn(e); }
      
      // Update dashboard cards if we are in dashboard
      if (window.loadDashboard) window.loadDashboard();
    }, 50);
  },

  computeStats(attList = this._attendance, { filter = 'week' } = {}) {
    // derive reference date = SIEMPRE hoy (nunca el último registro)
    let refDate = new Date();

    let startDate, endDate;
    endDate = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
    if (filter === 'month') {
      startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    } else {
      // week -> last 7 days including endDate
      startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - 6);
    }

    // filter attendance between startDate..endDate inclusive
    const counts = { present: 0, absent: 0, late: 0, total: 0 };
    const byDate = {}; // map YYYY-MM-DD -> status array

    attList.forEach(r => {
      const d = parseISODateNoTZ(r.date);
      if (!d) return;
      if (d < startDate || d > endDate) return;
      const key = toISODateLocal(d);
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(r.status);
      counts.total += 1;
      if (r.status === 'present') counts.present +=1;
      else if (r.status === 'absent') counts.absent +=1;
      else if (r.status === 'late') counts.late +=1;
    });

    return { counts, byDate, startDate, endDate, refDate };
  },

  // Render calendar helper: returns structure for rendering
  renderCalendarData({ attendanceList = this._attendance, filter = 'week' } = {}) {
    // Use computeStats to get start/end
    const stats = this.computeStats(attendanceList, { filter });
    const days = [];
    const { startDate, endDate, byDate } = stats;

    // ensure iterate day by day from startDate to endDate
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate()+1)) {
      const key = toISODateLocal(d);
      const statuses = byDate[key] || [];
      // choose summary status: if any absent -> absent; else if any late -> late; else if any present -> present; else null
      let summary = null;
      if (statuses.includes('absent')) summary = 'absent';
      else if (statuses.includes('late')) summary = 'late';
      else if (statuses.includes('present')) summary = 'present';

      days.push({ date: key, status: summary });
    }

    return { days, stats };
  },

  // Convenience wrapper to compute UI-ready calendar and stats and call callbacks
  async update({ forceRefresh = false, filter = 'week' } = {}) {
    await this.loadAttendance({ forceRefresh, filter });
  },

  async destroy() {
    try {
      if (this._realtimeChannel) {
        await supabase.removeChannel(this._realtimeChannel);
        this._realtimeChannel = null;
        console.log('🧹 Realtime cerrado');
      }
    } catch (e) {
      console.warn('Destroy error', e);
    }
  },

  // detect invalid student id heuristics
  async validateStudentId() {
    if (!this._studentId) return false;

    try {
      const { data, error } = await supabase
        .from('students')
        .select('id')
        .eq('id', this._studentId)
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        console.error('❌ student_id no existe:', this._studentId);
        return false;
      }

      console.log('✅ student_id válido');
      return true;

    } catch (e) {
      console.warn('validateStudentId error', e);
      return false;
    }
  }
};

/**
 * Función puente para compatibilidad con main.js
 */
export async function loadAttendance(opts = {}) {
  const student = AppState.get('student');
  if (!student) return;

  if (!Attendance._studentId) {
    await Attendance.init({
      studentId: student.id,
      onStatsUpdate: (stats) => {
        document.getElementById('attPresent').textContent = stats.counts.present;
        document.getElementById('attLate').textContent = stats.counts.late;
        document.getElementById('attAbsent').textContent = stats.counts.absent;
      },
      onRenderCalendar: (days, stats) => {
        const grid = document.getElementById('calendarGrid');
        if (!grid) return;
        
        // Actualizar stats directamente
        if (stats) {
          document.getElementById('attPresent').textContent = stats.counts.present;
          document.getElementById('attLate').textContent = stats.counts.late;
          document.getElementById('attAbsent').textContent = stats.counts.absent;
        }

        const filter = document.getElementById('attendanceFilter')?.value || 'semana';
        
        let html = '';
        
        // Si es vista de mes, añadir espacios vacíos al inicio
        if (filter === 'mes' && days.length > 0) {
          const firstDate = new Date(days[0].date + 'T00:00:00');
          const dayOfWeek = firstDate.getDay(); // 0 = Dom, 1 = Lun...
          for (let i = 0; i < dayOfWeek; i++) {
            html += `<div class="aspect-square opacity-0"></div>`;
          }
        }

        html += days.map(d => {
          let color = 'bg-slate-50 text-slate-300 border border-slate-100';
          let icon = '';
          
          if (d.status === 'present') {
            color = 'bg-emerald-500 text-white shadow-lg shadow-emerald-100 ring-2 ring-emerald-200';
            icon = '<i data-lucide="check" class="w-2 h-2 absolute top-1 right-1"></i>';
          }
          else if (d.status === 'absent') {
            color = 'bg-rose-500 text-white shadow-lg shadow-rose-100';
          }
          else if (d.status === 'late') {
            color = 'bg-amber-500 text-white shadow-lg shadow-amber-100';
          }
          // Soporte para días pasados sin registro (considerar como presente o neutral según lógica escolar)
          else if (new Date(d.date + 'T00:00:00') < new Date(toISODateLocal(new Date()) + 'T00:00:00')) {
            // Si el día ya pasó y no hay registro, a veces se muestra como presente por defecto o neutral
            // En este caso lo dejamos como neutral pero con mejor contraste
            color = 'bg-slate-100 text-slate-400 border border-slate-200';
          }
          
          const todayStr = toISODateLocal(new Date());
          const isToday = d.date === todayStr;
          const dayNum = parseInt(d.date.split('-')[2]);
          
          return `
            <div class="aspect-square flex flex-col items-center justify-center rounded-2xl text-xs font-black relative transition-all hover:scale-110 ${color} ${isToday ? 'ring-4 ring-sky-400 z-10' : ''}" title="${d.date}">
              ${dayNum}
              ${icon}
              ${isToday ? '<span class="absolute -bottom-1 w-1 h-1 bg-white rounded-full"></span>' : ''}
            </div>
          `;
        }).join('');

        grid.innerHTML = html;
        if (window.lucide) lucide.createIcons();
      }
    });
  }

  const filter = document.getElementById('attendanceFilter')?.value === 'mes' ? 'month' : 'week';
  return await Attendance.loadAttendance({ ...opts, filter });
}

/**
 * Inicializa el modal de reporte de ausencias
 */
export function initAbsenceModule() {
  const form = document.getElementById('formAbsence');
  const modal = document.getElementById('modalAbsence');
  if (!form || !modal) return;

  // Botones de cierre
  const closeBtns = modal.querySelectorAll('[data-close-modal]');
  closeBtns.forEach(btn => btn.onclick = () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const date = document.getElementById('absenceDate').value;
    const reason = document.getElementById('absenceReason').value;
    const note = document.getElementById('absenceNote').value;

    if (!date || !reason) {
      alert('Por favor complete los campos obligatorios');
      return;
    }

    try {
      const studentId = Attendance._studentId;
      if (!studentId) throw new Error('No hay estudiante cargado');

      const { error } = await supabase
        .from('attendance_requests')
        .insert([{
          student_id: studentId,
          date,
          reason,
          note,
          status: 'pending',
          type: 'absence'
        }]);

      if (error) throw error;

      alert('¡Ausencia reportada con éxito!');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      form.reset();
    } catch (err) {
      console.error('Error reporting absence:', err);
      alert('Error al enviar el reporte. Por favor intente de nuevo.');
    }
  };
}

export default Attendance;
