/**
 * 📰 WALL MODULE — Directora / Maestra
 * Extiende SharedWallModule con modal de publicación mejorado:
 * compresión WebP, validación 30s, álbum multi-foto, grabación directa,
 * programación, borradores, preview, etiquetado de alumnos.
 */
import { supabase, sendPush, emitEvent } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';
import { showNotifyFeedback } from '../shared/notify-feedback.js';
import { WallModule as SharedWallModule } from '../shared/wall.js';

export const WallModule = {
  ...SharedWallModule,

  // ── Estado del modal ──────────────────────────────────────────────────────────
  _albumFiles: [],          // hasta MAX_ALBUM_PHOTOS imágenes
  _recordedBlob: null,      // blob del grabador
  _draftTimer: null,        // timer para auto-guardar borrador

  async init(containerId, options = {}, appState = null) {
    options.accentColor = 'indigo';
    options.likeColor   = 'indigo';
    this._appState = appState;
    await SharedWallModule.init.call(this, containerId, options, appState);
  },

  // ── Modal principal ───────────────────────────────────────────────────────────
  openNewPostModal() {
    const draft = this._loadDraft();
    const html = `
      <div class="modal-header bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6 rounded-t-3xl flex justify-between items-center">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl shadow-inner">📝</div>
          <div>
            <h3 class="text-xl font-black">Crear Publicación</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Muro Escolar</p>
          </div>
        </div>
        ${draft ? `<button onclick="WallModule._restoreDraft()" class="text-xs bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-xl font-black transition-all" title="Restaurar borrador guardado">📋 Borrador</button>` : ''}
      </div>

      <div class="p-6 bg-white space-y-5 max-h-[70vh] overflow-y-auto">

        <!-- Contenido -->
        <div>
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 ml-1">Mensaje</label>
          <textarea id="postContent" rows="3"
            class="w-full px-4 py-3 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium resize-none"
            placeholder="¿Qué quieres compartir hoy con los padres?"
            oninput="WallModule._scheduleDraftSave()">${draft?.content || ''}</textarea>
        </div>

        <!-- Aula -->
        <div>
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 ml-1">Aula (Opcional)</label>
          <select id="postClassroom"
            class="w-full px-4 py-3 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium appearance-none">
            <option value="">General (Todos)</option>
          </select>
        </div>

        <!-- Multimedia / Álbum -->
        <div class="bg-slate-50 p-4 rounded-3xl border-2 border-slate-100 space-y-3">
          <h4 class="text-[11px] font-black text-slate-400 uppercase tracking-wider">📸 Multimedia</h4>

          <!-- Preview área -->
          <div id="postMediaPreviewArea" class="flex gap-2 flex-wrap min-h-[72px]">
            <label for="postMediaFile" class="w-[72px] h-[72px] rounded-[1.25rem] bg-white border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 hover:border-purple-400 hover:bg-purple-50 transition-all cursor-pointer shrink-0" title="Agregar foto o video">
              <i data-lucide="plus" class="w-6 h-6 mb-0.5"></i>
              <span class="text-[8px] font-black uppercase">Agregar</span>
            </label>
          </div>
          <input type="file" id="postMediaFile" class="hidden" accept="image/*,video/*" multiple>
          <p class="text-[10px] text-slate-400">Imágenes (máx 5 para álbum) o 1 video de hasta 30s / 25MB.</p>

          <!-- Botón grabadora -->
          <button onclick="WallModule._openRecorderFromModal()" type="button"
            class="flex items-center gap-2 text-xs font-black text-red-500 hover:text-red-600 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-2xl transition-all">
            <i data-lucide="video" class="w-4 h-4"></i> Grabar video (30s)
          </button>
        </div>

        <!-- Opciones avanzadas: etiquetado + programar -->
        <details class="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
          <summary class="px-4 py-3 text-[11px] font-black text-slate-500 uppercase tracking-wider cursor-pointer select-none list-none flex justify-between items-center">
            <span>⚙️ Opciones avanzadas</span>
            <i data-lucide="chevron-down" class="w-4 h-4 transition-transform"></i>
          </summary>
          <div class="px-4 pb-4 space-y-4">
            <!-- Etiquetado de alumnos -->
            <div>
              <label class="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">👦 Etiquetar Alumnos</label>
              <div id="studentTagSearch" class="relative">
                <input type="text" id="tagSearchInput" placeholder="Buscar alumno..."
                  class="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-purple-100 focus:border-purple-400 outline-none bg-white"
                  oninput="WallModule._searchStudents(this.value)">
                <div id="tagDropdown" class="hidden absolute z-50 left-0 right-0 bg-white border border-slate-100 rounded-xl shadow-lg mt-1 max-h-36 overflow-y-auto"></div>
              </div>
              <div id="taggedStudentsList" class="flex flex-wrap gap-1.5 mt-2"></div>
            </div>
            <!-- Programar publicación -->
            <div>
              <label class="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">🕒 Programar</label>
              <input type="datetime-local" id="postScheduledAt" min="${this._nowDatetimeLocal()}"
                class="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-purple-100 focus:border-purple-400 outline-none bg-white">
              <p class="text-[9px] text-slate-400 mt-1">Si eliges una fecha futura, se publicará automáticamente.</p>
            </div>
            <!-- Expiración -->
            <div>
              <label class="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">⏳ Expirar en</label>
              <select id="postExpireDays"
                class="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-purple-100 focus:border-purple-400 outline-none bg-white">
                <option value="">Sin expiración</option>
                <option value="1">1 día</option>
                <option value="3">3 días</option>
                <option value="7">1 semana</option>
                <option value="30">1 mes</option>
              </select>
            </div>
          </div>
        </details>
      </div>

      <!-- Acciones -->
      <div class="p-5 border-t bg-slate-50 rounded-b-3xl flex justify-between items-center gap-3">
        <button onclick="WallModule._saveDraftAndClose()" type="button"
          class="px-5 py-2.5 text-slate-500 font-black text-xs uppercase hover:bg-slate-100 rounded-2xl transition-all flex items-center gap-1.5">
          <i data-lucide="save" class="w-3.5 h-3.5"></i> Guardar borrador
        </button>
        <div class="flex gap-2">
          <button onclick="App.ui.closeModal()" type="button"
            class="px-5 py-2.5 text-slate-500 font-black text-xs uppercase hover:bg-slate-100 rounded-2xl transition-all">Cancelar</button>
          <button id="btnSubmitPost" onclick="WallModule.submitNewPost()" type="button"
            class="px-8 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-purple-200 hover:shadow-purple-300 hover:-translate-y-0.5 transition-all active:scale-95">
            Publicar
          </button>
        </div>
      </div>`;

    window.openGlobalModal(html);

    // Reset estado interno
    this._albumFiles = [];
    this._recordedBlob = null;

    setTimeout(() => {
      const fi = document.getElementById('postMediaFile');
      if (fi) {
        fi.value = '';
        fi.addEventListener('change', (e) => this._handleMediaFiles(e));
      }
      this._loadClassroomsForPost();
      this._taggedStudents = [];
      if (window.lucide) lucide.createIcons();
    }, 50);
  },

  // ── Manejo de archivos multimedia ─────────────────────────────────────────────
  async _handleMediaFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const isVideo = files.some(f => f.type.startsWith('video/'));

    if (isVideo) {
      if (files.length > 1) { Helpers.toast('Solo 1 video por publicación', 'warning'); return; }
      const file = files[0];
      const maxBytes = 25 * 1024 * 1024;
      if (file.size > maxBytes) { Helpers.toast('Video demasiado grande (máx 25MB)', 'error'); return; }

      const { ok, duration } = await SharedWallModule.validateVideoDuration
        ? SharedWallModule.validateVideoDuration(file)
        : this._validateDuration(file);

      if (!ok) {
        Helpers.toast(`El video excede 30s (${duration.toFixed(0)}s). Recórtalo.`, 'warning');
        this.openVideoTrimmer(file, () => {
          this._recordedBlob = null;
          this._albumFiles = [file];
          this._renderMediaPreviews([file]);
        });
        return;
      }
      this._albumFiles = [file];
      this._recordedBlob = null;
      this._renderMediaPreviews([file]);
      return;
    }

    // Imágenes — álbum hasta 5
    const MAX = 5;
    const remaining = MAX - this._albumFiles.length;
    if (remaining <= 0) { Helpers.toast(`Máximo ${MAX} imágenes por publicación`, 'warning'); return; }

    const toAdd = files.slice(0, remaining);
    if (toAdd.some(f => f.size > 5 * 1024 * 1024)) { Helpers.toast('Imagen muy grande (máx 5MB por imagen)', 'error'); return; }

    this._albumFiles.push(...toAdd);
    this._renderMediaPreviews(this._albumFiles);
    e.target.value = '';
  },

  _renderMediaPreviews(files) {
    const area = document.getElementById('postMediaPreviewArea');
    if (!area) return;
    // Mantener el botón "agregar"
    const addBtn = area.querySelector('label[for="postMediaFile"]').cloneNode(true);
    area.innerHTML = '';

    files.forEach((file, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'relative w-[72px] h-[72px] shrink-0';

      const isVid = file.type?.startsWith('video/') || (file instanceof Blob && file.type?.startsWith('video/'));
      const inner = document.createElement('div');
      inner.className = 'w-full h-full rounded-[1.25rem] overflow-hidden bg-slate-900 border-2 border-slate-100';

      if (isVid) {
        inner.innerHTML = `<div class="w-full h-full flex items-center justify-center text-white text-2xl">🎬</div>`;
      } else {
        const img = document.createElement('img');
        img.className = 'w-full h-full object-cover';
        img.src = URL.createObjectURL(file);
        img.onload = () => URL.revokeObjectURL(img.src);
        inner.appendChild(img);
      }

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-white text-[10px] font-black flex items-center justify-center shadow-md hover:bg-red-600 transition-colors';
      del.textContent = '×';
      del.onclick = () => { this._albumFiles.splice(idx, 1); this._renderMediaPreviews(this._albumFiles); };

      wrapper.appendChild(inner);
      wrapper.appendChild(del);
      area.appendChild(wrapper);
    });

    if (files.length < 5) area.appendChild(addBtn);
    if (window.lucide) lucide.createIcons();
  },

  _validateDuration(file) {
    return new Promise(resolve => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({ ok: v.duration <= 30, duration: v.duration }); };
      v.onerror = () => { URL.revokeObjectURL(url); resolve({ ok: false, duration: -1 }); };
      v.src = url;
    });
  },

  // ── Grabadora desde modal ─────────────────────────────────────────────────────
  _openRecorderFromModal() {
    this.openVideoRecorder((blob) => {
      this._recordedBlob = blob;
      this._albumFiles = [];
      // Mostrar preview del blob grabado
      const area = document.getElementById('postMediaPreviewArea');
      if (area) {
        const addBtn = area.querySelector('label[for="postMediaFile"]')?.cloneNode(true);
        area.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'relative w-[72px] h-[72px] shrink-0';
        const inner = document.createElement('div');
        inner.className = 'w-full h-full rounded-[1.25rem] overflow-hidden bg-slate-900 border-2 border-purple-300 flex items-center justify-center text-white text-2xl';
        inner.textContent = '🎥';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-white text-[10px] font-black flex items-center justify-center shadow-md hover:bg-red-600 transition-colors';
        del.textContent = '×';
        del.onclick = () => { this._recordedBlob = null; this._renderMediaPreviews([]); };
        wrapper.appendChild(inner);
        wrapper.appendChild(del);
        area.appendChild(wrapper);
        if (addBtn) area.appendChild(addBtn);
      }
      Helpers.toast('Video grabado listo para publicar', 'success');
    });
  },

  // ── Borradores ────────────────────────────────────────────────────────────────
  _scheduleDraftSave() {
    clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => {
      const content = document.getElementById('postContent')?.value || '';
      if (content.trim()) {
        try { localStorage.setItem('karpus_wall_draft', JSON.stringify({ content, savedAt: Date.now() })); } catch (_) {}
      }
    }, 1500);
  },

  _loadDraft() {
    try {
      const d = localStorage.getItem('karpus_wall_draft');
      if (!d) return null;
      const parsed = JSON.parse(d);
      // Descartar borradores de más de 7 días
      if (Date.now() - parsed.savedAt > 7 * 24 * 60 * 60 * 1000) { localStorage.removeItem('karpus_wall_draft'); return null; }
      return parsed;
    } catch (err) {
      console.warn('[Wall] Error cargando borrador:', err);
      return null;
    }
  },

  _restoreDraft() {
    const draft = this._loadDraft();
    if (!draft) return;
    const ta = document.getElementById('postContent');
    if (ta) { ta.value = draft.content; ta.focus(); }
    Helpers.toast('Borrador restaurado', 'info');
  },

  _saveDraftAndClose() {
    const content = document.getElementById('postContent')?.value?.trim() || '';
    if (content) {
      try { localStorage.setItem('karpus_wall_draft', JSON.stringify({ content, savedAt: Date.now() })); } catch (_) {}
      Helpers.toast('Borrador guardado', 'success');
    }
    App.ui.closeModal();
  },

  // ── Carga de aulas ────────────────────────────────────────────────────────────
  async _loadClassroomsForPost() {
    try {
      const { data: classrooms } = await supabase.from('classrooms').select('id, name').order('name');
      const select = document.getElementById('postClassroom');
      if (select && classrooms) {
        classrooms.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.name;
          select.appendChild(opt);
        });
      }
    } catch (err) {
      console.warn('[Wall] Error cargando aulas:', err);
    }
  },

  // ── Búsqueda y etiquetado de alumnos ─────────────────────────────────────────
  _taggedStudents: [],

  async _searchStudents(query) {
    const dropdown = document.getElementById('tagDropdown');
    if (!dropdown) return;
    if (!query || query.length < 2) { dropdown.classList.add('hidden'); return; }

    try {
      const { data } = await supabase.from('students').select('id, name').ilike('name', `%${query}%`).limit(8);
      if (!data?.length) { dropdown.classList.add('hidden'); return; }

      dropdown.innerHTML = data.map(s => `
        <button type="button" onclick="WallModule._tagStudent('${s.id}','${s.name.replaceAll("'", "&#39;")}')"
          class="w-full text-left px-3 py-2 text-xs font-bold hover:bg-purple-50 hover:text-purple-700 transition-colors">
          👦 ${s.name}
        </button>`).join('');
      dropdown.classList.remove('hidden');
    } catch (err) {
      console.warn('[Wall] Error en búsqueda de alumnos:', err);
      dropdown.classList.add('hidden');
    }
  },

  _tagStudent(id, name) {
    if (this._taggedStudents.some(s => s.id === id)) return;
    this._taggedStudents.push({ id, name });
    this._renderTaggedStudents();
    const inp = document.getElementById('tagSearchInput');
    const dd = document.getElementById('tagDropdown');
    if (inp) inp.value = '';
    if (dd) dd.classList.add('hidden');
  },

  _renderTaggedStudents() {
    const list = document.getElementById('taggedStudentsList');
    if (!list) return;
    list.innerHTML = this._taggedStudents.map((s, idx) => `
      <span class="inline-flex items-center gap-1 bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full text-[10px] font-black">
        ${s.name}
        <button type="button" onclick="WallModule._untagStudent(${idx})" class="text-purple-400 hover:text-purple-700 ml-0.5 leading-none">×</button>
      </span>`).join('');
  },

  _untagStudent(idx) {
    this._taggedStudents.splice(idx, 1);
    this._renderTaggedStudents();
  },

  // ── Utilidades UI ─────────────────────────────────────────────────────────────
  _nowDatetimeLocal() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  },

  // ── Submit ────────────────────────────────────────────────────────────────────

  /** Resuelve qué subir y retorna { mediaUrl, mediaType, imagesArr } */
  async _resolveMediaUpload(filesToUpload) {
    if (this._recordedBlob) {
      return this._uploadSingleBlob(this._recordedBlob, 'video/webm', 'video');
    }
    if (filesToUpload.length === 0) {
      return { mediaUrl: null, mediaType: null, imagesArr: [] };
    }
    if (filesToUpload[0].type.startsWith('video/')) {
      return this._uploadVideoFile(filesToUpload[0]);
    }
    if (filesToUpload.length === 1) {
      return this._uploadSingleImage(filesToUpload[0]);
    }
    return this._uploadAlbum(filesToUpload);
  },

  async _uploadSingleBlob(blob, mimeType, mediaType) {
    const path = `posts/${Date.now()}_rec.webm`;
    await this._uploadFile('posts', path, blob, mimeType);
    const { data: u } = supabase.storage.from('posts').getPublicUrl(path);
    return { mediaUrl: u.publicUrl, mediaType, imagesArr: [] };
  },

  async _uploadVideoFile(file) {
    const ext  = file.name.split('.').pop();
    const path = `posts/${Date.now()}.${ext}`;
    await this._uploadFile('posts', path, file, file.type);
    const { data: u } = supabase.storage.from('posts').getPublicUrl(path);
    return { mediaUrl: u.publicUrl, mediaType: 'video', imagesArr: [] };
  },

  async _uploadSingleImage(file) {
    const compressed = await this._compressImage(file);
    const path = `posts/${Date.now()}.webp`;
    await this._uploadFile('posts', path, compressed, 'image/webp');
    const { data: u } = supabase.storage.from('posts').getPublicUrl(path);
    return { mediaUrl: u.publicUrl, mediaType: 'image', imagesArr: [] };
  },

  async _uploadAlbum(files) {
    const imagesArr = [];
    for (const file of files) {
      const compressed = await this._compressImage(file);
      const uid  = crypto.randomUUID().replace(/-/g, '').slice(0, 6);
      const path = `posts/${Date.now()}_${uid}.webp`;
      await this._uploadFile('posts', path, compressed, 'image/webp');
      const { data: u } = supabase.storage.from('posts').getPublicUrl(path);
      if (u?.publicUrl) imagesArr.push(u.publicUrl);
    }
    const mediaUrl = imagesArr.length > 0 ? imagesArr[0] : null;
    const mediaType = imagesArr.length > 0 ? 'album' : null;
    return { mediaUrl, mediaType, imagesArr };
  },

  _isScheduledPost(scheduledAt) {
    return !!scheduledAt && new Date(scheduledAt) > new Date();
  },

  _buildPostPayload({ content, classroomId, scheduledAt, expireDays, mediaUrl, mediaType, imagesArr, user }) {
    const isScheduled    = this._isScheduledPost(scheduledAt);
    return {
      content:         content || null,
      classroom_id:    classroomId || null,
      media_url:       mediaUrl,
      media_type:      mediaType,
      images:          imagesArr.length > 1 ? imagesArr : null,
      teacher_id:      user.id,
      scheduled_at:    isScheduled ? new Date(scheduledAt).toISOString() : null,
      status:          isScheduled ? 'scheduled' : 'published',
      expire_days:     expireDays ? Number.parseInt(expireDays, 10) : null,
      tagged_students: this._taggedStudents.length ? this._taggedStudents : null,
    };
  },

  _resolveFilesToUpload(mediaFileInput) {
    const hasFileInput = (mediaFileInput?.files?.length ?? 0) > 0;
    const fallback = hasFileInput ? Array.from(mediaFileInput.files) : [];
    return this._albumFiles.length > 0 ? this._albumFiles : fallback;
  },

  async _buildAndInsertPost({ content, classroomId, scheduledAt, expireDays, mediaFileInput }) {
    const user = this._appState?.get('user');
    if (!user) throw new Error('Sin sesión');

    const filesToUpload = this._resolveFilesToUpload(mediaFileInput);
    const { mediaUrl, mediaType, imagesArr } = await this._resolveMediaUpload(filesToUpload);
    const payload = this._buildPostPayload({ content, classroomId, scheduledAt, expireDays, mediaUrl, mediaType, imagesArr, user });

    const { error } = await supabase.from('posts').insert(payload);
    if (error) throw error;

    // 🔔 Notificar a padres: push + email — SOLO publicaciones inmediatas
    //    (las programadas se notifican cuando el sistema las publica).
    //    Audiencia: aula seleccionada o GENERAL (todos los estudiantes).
    if (payload.status !== 'scheduled') {
      this._notifyParentsOfPost({
        classroomId: payload.classroom_id || null,
        content: payload.content || '',
        userId: user.id
      }).catch(() => {});
    }

    try { localStorage.removeItem('karpus_wall_draft'); } catch (e) { console.warn('[Wall] No se pudo limpiar borrador:', e); }

    return this._isScheduledPost(scheduledAt)
      ? `Programado para ${new Date(scheduledAt).toLocaleString()}`
      : 'Publicación compartida ✅';
  },

  /**
   * 🔔 Notifica a los padres de la audiencia del post (aula o general):
   * push a cuentas vinculadas + email vía process-event (p1/p2).
   */
  async _notifyParentsOfPost({ classroomId, content, userId }) {
    try {
      let q = supabase.from('students').select('id, parent_id');
      if (classroomId) q = q.eq('classroom_id', classroomId);
      const { data: students } = await q;
      const list = students || [];
      if (!list.length) return;

      const preview = content && content.length > 80 ? content.substring(0, 80) + '…' : (content || '');
      const parentIds = [...new Set(list.map(s => s.parent_id).filter(Boolean))];

      const results = await Promise.allSettled(parentIds.map(pid =>
        sendPush({
          user_id: pid,
          title: '📢 Nueva publicación — Karpus Kids',
          message: preview,
          type: 'post',
          link: '/panel_padres.html#feed'
        })
      ));
      const sent = results.filter(r => r.status === 'fulfilled' && r.value?.ok !== false).length;

      const profile = (await supabase.from('profiles').select('name').eq('id', userId).maybeSingle()).data;
      await emitEvent('post.created', {
        classroom_id: classroomId,
        teacher_name: profile?.name || 'Dirección',
        content_preview: preview
      });

      if (sent > 0) showNotifyFeedback({ sent, type: 'post', label: classroomId ? 'Muro del aula' : 'Muro general' });
    } catch (e) {
      console.warn('[Wall] No se pudo notificar la publicación:', e);
    }
  },

  _readFormValues() {
    return {
      content:        document.getElementById('postContent')?.value.trim() ?? '',
      classroomId:    document.getElementById('postClassroom')?.value ?? '',
      scheduledAt:    document.getElementById('postScheduledAt')?.value ?? '',
      expireDays:     document.getElementById('postExpireDays')?.value ?? '',
      mediaFileInput: document.getElementById('postMediaFile'),
    };
  },

  async submitNewPost() {
    const btn = document.getElementById('btnSubmitPost');
    const form = this._readFormValues();
    const hasFiles = this._albumFiles.length > 0 || this._recordedBlob;
    const hasFileInput = (form.mediaFileInput?.files?.length ?? 0) > 0;

    if (!form.content && !hasFiles && !hasFileInput) {
      return Helpers.toast('Escribe algo o sube un archivo', 'warning');
    }

    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline mr-1"></i> Publicando...';
    if (window.lucide) lucide.createIcons();

    try {
      const successMsg = await this._buildAndInsertPost(form);
      Helpers.toast(successMsg, 'success');
      App.ui.closeModal();
    } catch (err) {
      console.error('[Wall] submitNewPost error:', err);
      Helpers.toast('Error al publicar. Intenta de nuevo.', 'error');
      btn.disabled = false;
      btn.innerHTML = 'Publicar';
      if (window.lucide) lucide.createIcons();
    }
  },

  // ── Helpers de upload / compresión ────────────────────────────────────────────
  async _uploadFile(bucket, path, blob, mimeType) {
    const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: mimeType, upsert: true });
    if (error) throw error;
  },

  async _compressImage(file) {
    return new Promise(resolve => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX_W = 1920;
        let { width: w, height: h } = img;
        if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => resolve(blob || file), 'image/webp', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  },
};
