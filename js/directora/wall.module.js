/**
 * 📰 WALL MODULE - Módulo de Muro/Forum (Sincronizado con WallModule compartido)
 */

import { supabase } from '../shared/supabase.js';
import { Helpers } from '../shared/helpers.js';
import { WallModule as SharedWallModule } from '../shared/wall.js';

export const WallModule = {
  ...SharedWallModule,

  /**
   * Sobrescribir init para manejar lógica específica de Directora si es necesario
   */
  async init(containerId, options = {}, appState = null) {
    // Forzar color de acento y rol
    options.accentColor = options.accentColor || 'orange';
    
    // Asignar _appState ANTES de llamar al shared init
    this._appState = appState;
    
    // Llamar al init del módulo compartido
    await SharedWallModule.init.call(this, containerId, options, appState);
    
    console.log('✅ WallModule (Directora) - Sincronizado con Shared');
  },

  /**
   * Modal para crear nuevo post (Específico de Directora/Maestra)
   */
  openNewPostModal() {
    const html = `
      <div class="modal-header bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6 rounded-t-3xl flex justify-between items-center">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl shadow-inner">📝</div>
          <div>
            <h3 class="text-xl font-black">Crear Publicación</h3>
            <p class="text-xs text-white/70 font-bold uppercase tracking-widest">Muro Escolar</p>
          </div>
        </div>
        <button onclick="App.ui.closeModal()" class="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors">
          <i data-lucide="x" class="w-6 h-6"></i>
        </button>
      </div>
      
      <div class="p-8 bg-white space-y-6">
        <div>
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 ml-1">Contenido del Mensaje</label>
          <textarea id="postContent" rows="4" class="w-full px-4 py-3 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium resize-none" placeholder="¿Qué quieres compartir hoy con los padres?"></textarea>
        </div>

        <div>
          <label class="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 ml-1">Aula (Opcional)</label>
          <select id="postClassroom" class="w-full px-4 py-3 border-2 border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-purple-100 focus:border-purple-400 bg-slate-50/50 transition-all text-sm font-medium appearance-none">
            <option value="">General (Todos)</option>
          </select>
        </div>

        <div class="flex flex-col md:flex-row gap-6 items-center bg-slate-50 p-6 rounded-3xl border-2 border-slate-100">
          <div class="relative group cursor-pointer">
            <div id="postMediaPreview" class="w-24 h-24 rounded-[2rem] bg-white border-4 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 group-hover:border-purple-400 group-hover:bg-purple-50 transition-all overflow-hidden">
              <i data-lucide="camera" class="w-8 h-8 mb-1"></i>
              <span class="text-[9px] font-black uppercase">Media</span>
            </div>
            <input type="file" id="postMediaFile" class="absolute inset-0 opacity-0 cursor-pointer" accept="image/*,video/*">
          </div>
          <div class="flex-1">
            <h4 class="text-sm font-black text-slate-800 mb-1">📸 MULTIMEDIA</h4>
            <p class="text-xs text-slate-500">Sube una imagen o video para acompañar tu publicación. Máximo 10MB.</p>
          </div>
        </div>
      </div>

      <div class="p-6 border-t bg-slate-50 rounded-b-3xl flex justify-end gap-3">
        <button onclick="App.ui.closeModal()" class="px-8 py-3 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 rounded-2xl transition-all">Cancelar</button>
        <button id="btnSubmitPost" onclick="WallModule.submitNewPost()" class="px-10 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-purple-200 hover:shadow-purple-300 hover:-translate-y-0.5 transition-all active:scale-95">Publicar Ahora</button>
      </div>
    `;

    window.openGlobalModal(html);
    
    // Cargar aulas en el select
    this.loadClassroomsForPost();

    // Listener para preview
    document.getElementById('postMediaFile')?.addEventListener('change', (e) => this.handleMediaPreview(e));
  },

  async loadClassroomsForPost() {
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
    } catch (e) { console.error(e); }
  },

  handleMediaPreview(e) {
    const file = e.target.files[0];
    const preview = document.getElementById('postMediaPreview');
    if (!file || !preview) return;

    if (file.size > 10 * 1024 * 1024) {
      Helpers.toast('Archivo muy grande (Máx 10MB)', 'error');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (file.type.startsWith('image/')) {
        preview.innerHTML = `<img src="${event.target.result}" class="w-full h-full object-cover">`;
      } else {
        preview.innerHTML = `<div class="w-full h-full flex items-center justify-center bg-slate-800 text-white"><i data-lucide="video" class="w-8 h-8"></i></div>`;
        if (window.lucide) lucide.createIcons();
      }
    };
    reader.readAsDataURL(file);
  },

  async submitNewPost() {
    const btn = document.getElementById('btnSubmitPost');
    const content = document.getElementById('postContent')?.value.trim();
    const classroomId = document.getElementById('postClassroom')?.value;
    const mediaFile = document.getElementById('postMediaFile')?.files[0];

    if (!content && !mediaFile) return Helpers.toast('Escribe algo o sube un archivo', 'warning');

    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Publicando...';
    if (window.lucide) lucide.createIcons();

    try {
      const user = this._appState?.get('user');
      let mediaUrl = null;
      let mediaType = 'image';

      if (mediaFile) {
        const fileExt = mediaFile.name.split('.').pop();
        const filePath = `posts/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
        mediaType = mediaFile.type.startsWith('video/') ? 'video' : 'image';

        const { error: uploadError } = await supabase.storage
          .from('posts')
          .upload(filePath, mediaFile);

        if (uploadError) throw uploadError;
        mediaUrl = filePath;
      }

      const { error } = await supabase.from('posts').insert({
        content,
        classroom_id: classroomId || null,
        media_url: mediaUrl,
        media_type: mediaType,
        teacher_id: user.id
      });

      if (error) throw error;

      Helpers.toast('Publicación compartida correctamente', 'success');
      App.ui.closeModal();
      await this.loadPosts();
    } catch (err) {
      console.error(err);
      Helpers.toast('Error al publicar', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Publicar Ahora';
      if (window.lucide) lucide.createIcons();
    }
  }
};
