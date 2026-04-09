import { supabase } from './supabase.js';
import { Helpers } from './helpers.js';
import { ImageLoader } from './image-loader.js';
import { QueryCache } from './query-cache.js';
import { withTimeout } from './db-utils.js';

// Inline helper \u2014 evita dependencia de media.js
const optimizeImageUrl = (url) => url || null;

/**
 * M\u00f3dulo de Muro Global Mejorado
 * Soporta Videos, Im\u00e1genes y conteo real de likes
 */
export const WallModule = {
  _appState: null,
  _commentsCache: {},
  _containerId: null,
  _observer: null,
  _options: {},

  // Utilidad de tiempo relativo
  _relativeTimeFromNow(timeString) {
    try {
      const date = new Date(timeString);
      const diffMs = Date.now() - date.getTime();
      if (diffMs < 0) return 'hace poco';
      const seconds = Math.floor(diffMs / 1000);
      if (seconds < 60) return `hace ${seconds} seg`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `hace ${minutes} min`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `hace ${hours} h`;
      const days = Math.floor(hours / 24);
      if (days < 30) return `hace ${days} d\u00edas`;
      const months = Math.floor(days / 30);
      if (months < 12) return `hace ${months} meses`;
      const years = Math.floor(months / 12);
      return `hace ${years} a\u00f1os`;
    } catch (e) {
      return '';
    }
  },

  async _getPublicImageUrl(imagePath, opts = {}) {
    if (!imagePath) return null;
    if (/^https?:\/\//i.test(imagePath)) return optimizeImageUrl(imagePath, opts);

    const cleanPath = imagePath.replace(/^posts\//, '').replace(/^karpus-uploads\//, '').replace(/^avatars\//, '');
    try {
      const isAvatar = imagePath.includes('avatar');
      const bucket = isAvatar ? 'karpus-uploads' : 'posts';
      const { data } = supabase.storage.from(bucket).getPublicUrl(isAvatar ? `avatars/${cleanPath}` : cleanPath);
      return optimizeImageUrl(data?.publicUrl, opts);
    } catch (err) {
      console.warn('Error resolviendo imagen:', err);
      return null;
    }
  },

  async init(containerId, options = {}, appState = null) {
    this._page = 0;
    this._pageSize = 10;
    this._isLoading = false;
    this._hasMore = true;
    this._containerId = containerId;
    this._options = options;
    this._appState = appState;

    const container = document.getElementById(containerId);
    if (!container) return;

    await this.loadClassrooms();
    this.setupFilters();
    await this.loadPosts(container);
    this.subscribeRealtime();
  },

  async loadClassrooms() {
    try {
      const classrooms = await QueryCache.get(
        'classrooms_list',
        async () => {
          const { data } = await supabase.from('classrooms').select('id, name').order('name');
          return data || [];
        },
        10 * 60_000 // 10 min TTL \u2014 classrooms rarely change
      );
      const select = document.getElementById('wallClassroomFilter');
      if (select && classrooms) {
        select.innerHTML = '<option value="">Todas las aulas</option>';
        classrooms.forEach(c => {
          const option = document.createElement('option');
          option.value = c.id;
          option.textContent = c.name;
          select.appendChild(option);
        });
      }
    } catch (err) {
      console.error('Error loading classrooms:', err);
    }
  },

  setupFilters() {
    const searchInput = document.getElementById('wallSearch');
    const classroomSelect = document.getElementById('wallClassroomFilter');
    
    // Debounce para b\u00fasqueda
    let timeout;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => this.applyFilters(), 500);
      });
    }
    if (classroomSelect) {
      classroomSelect.addEventListener('change', () => this.applyFilters());
    }
  },

  async applyFilters() {
    const searchInput = document.getElementById('wallSearch');
    const classroomSelect = document.getElementById('wallClassroomFilter');
    
    this._options.searchTerm = searchInput?.value.toLowerCase() || '';
    this._options.classroomId = classroomSelect?.value || null;
    
    this._page = 0;
    this._hasMore = true;
    const container = document.getElementById(this._containerId);
    if (container) await this.loadPosts(container);
  },

  async loadPosts(container, append = false) {
    // \ud83d\udee1\ufe0f Fix: Si 'container' es un string (ID), convertirlo a elemento DOM
    if (typeof container === 'string') {
      container = document.getElementById(container);
    }
    // Si no se pas\u00f3 container o no es v\u00e1lido, usar el ID configurado
    if (!container) {
      container = document.getElementById(this._containerId);
    }
    
    if (this._isLoading || (!this._hasMore && append)) return;
    this._isLoading = true;

    if (!container) {
      console.warn('WallModule: No container found to load posts.');
      this._isLoading = false;
      return;
    }

    if (!append) {
      container.innerHTML = `
        <div class="py-12 text-center" id="wall-loader">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-400 mx-auto"></div>
          <p class="mt-4 text-slate-400 font-medium text-xs">Cargando muro...</p>
        </div>`;
      this._page = 0;
      this._hasMore = true;
    }

    try {
      const user = this._appState ? this._appState.get('user') : null;
      const from = this._page * this._pageSize;
      const to = from + this._pageSize - 1;

      let query = supabase
        .from('posts')
        .select(`
          id, content, media_url, media_type, created_at,
          classroom:classrooms(name),
          teacher:profiles!posts_teacher_id_fkey(name, avatar_url),
          likes(user_id),
          comments:comments(count)
        `)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (this._options.classroomId) query = query.eq('classroom_id', this._options.classroomId);
      if (this._options.searchTerm) query = query.ilike('content', `%${this._options.searchTerm}%`);

      const { data: posts, error } = await withTimeout(() => query, 10_000);
      if (error) throw error;

      // Limpiar loaders
      document.getElementById('wall-loader')?.remove();
      document.getElementById('wall-scroll-loader')?.remove();

      if ((!posts || posts.length === 0) && !append) {
        container.innerHTML = Helpers.emptyState('No hay publicaciones recientes.', 'layout');
        this._hasMore = false;
        return;
      }

      const processedPosts = await Promise.all(posts.map(p => this._processPost(p, user)));
      const html = processedPosts.map(p => this.renderPost(p)).join('');
      
      if (append) container.insertAdjacentHTML('beforeend', html);
      else container.innerHTML = html;

      // Activar lazy loading en las nuevas im\u00e1genes
      ImageLoader.observe(container);

      // Paginaci\u00f3n
      if (posts.length < this._pageSize) {
        this._hasMore = false;
        container.insertAdjacentHTML('beforeend', '<div class="py-8 text-center text-xs text-slate-300 italic">No hay m\u00e1s publicaciones.</div>');
      } else {
        this._page++;
        this._setupInfiniteScroll(container);
      }

      if (window.lucide) lucide.createIcons();
      // Activar lazy loading en im\u00e1genes reci\u00e9n inyectadas
      ImageLoader.observe(container);
    } catch (err) {
      console.error('Error loadPosts:', err);
      if (!append) container.innerHTML = Helpers.emptyState('Error al cargar el muro', 'alert-triangle');
    } finally {
      this._isLoading = false;
    }
  },

  _setupInfiniteScroll(container) {
    if (this._observer) this._observer.disconnect();
    this._observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && this._hasMore && !this._isLoading) {
        this.loadPosts(container, true);
      }
    }, { rootMargin: '200px' });
    
    const last = container.lastElementChild;
    if (last) this._observer.observe(last);

    // \ud83c\udfa5 Setup Autoplay de videos al hacer scroll
    this._setupVideoAutoplay();
  },

  _setupVideoAutoplay() {
    const videoObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const video = entry.target;
        if (entry.isIntersecting) {
          video.play().catch(e => console.log('Autoplay blocked:', e));
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.6 }); // Reproducir cuando el 60% del video sea visible

    document.querySelectorAll('video').forEach(v => videoObserver.observe(v));
  },

  async _processPost(p, user) {
    const teacherData = p.teacher || {};
    // Correcci\u00f3n para Likes: Ahora likes es un array de objetos con user_id
    const likesArray = p.likes || [];
    const likeCount = likesArray.length;
    const userLiked = user ? likesArray.some(l => l.user_id === user.id) : false;
    
    // Obtener URL p\u00fablica
    const mediaUrl = p.media_url || p.image_url || null;
    const publicUrl = await this._getPublicImageUrl(mediaUrl);
    
    // Obtener Avatar
    const teacherAvatar = await this._getPublicImageUrl(teacherData.avatar_url);

    return {
      ...p,
      teacher_name: teacherData.name || 'Maestra',
      teacher_avatar: teacherAvatar,
      like_count: likeCount,
      user_liked: userLiked,
      display_media_url: publicUrl,
      // Priorizar media_type de la BD, o inferir si es video
      is_video: p.media_type === 'video' || (mediaUrl && mediaUrl.match(/\.(mp4|mov|webm)$/i))
    };
  },

  renderPost(p) {
    const date = this._relativeTimeFromNow(p.created_at);
    const accent = this._options.accentColor || 'indigo';
    const isFirstPost = this._page === 0;

    // L\u00f3gica de Renderizado Multimedia con lazy loading
    let mediaHtml = '';
    if (p.display_media_url) {
      if (p.is_video) {
        mediaHtml = `
          <div class="rounded-2xl overflow-hidden border border-slate-100 mb-4 bg-black">
            ${ImageLoader.video(p.display_media_url, '', { cls: 'w-full max-h-[500px] mx-auto' })}
          </div>`;
      } else {
        mediaHtml = `
          <div class="rounded-2xl overflow-hidden border border-slate-100 mb-4 bg-slate-50 cursor-zoom-in"
               onclick="window.openLightbox('${p.display_media_url}','image')">
            ${ImageLoader.img(p.display_media_url, {
              alt: 'Post media',
              cls: 'w-full max-h-[480px] object-contain mx-auto',
              fallback: 'img/mundo.jpg',
              priority: isFirstPost ? 'high' : 'low'
            })}
          </div>`;
      }
    }

    const profile = this._appState?.get('profile');
    const isDirectora = profile?.role === 'directora';
    const isMaestra   = profile?.role === 'maestra';
    const isAsistente = profile?.role === 'asistente';
    const canDelete   = isDirectora || isMaestra || isAsistente;
    const canComment  = ['directora', 'maestra', 'padre', 'asistente'].includes(profile?.role);

    return `
      <div class="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden mb-6" id="post-${p.id}">
        <div class="p-5">
          <div class="flex justify-between items-start mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-${accent}-100 flex items-center justify-center overflow-hidden">
                ${ImageLoader.img(p.teacher_avatar, { 
                  cls: 'w-full h-full object-cover', 
                  fallback: 'img/1.jpg',
                  w: 80, h: 80 // Sugerencia de tama\u00f1o para avatar
                })}
              </div>
              <div>
                <div class="font-bold text-slate-800 text-sm">${Helpers.escapeHTML(p.teacher_name)}</div>
                <div class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  ${date} \u2022 ${Helpers.escapeHTML(p.classroom?.name || 'General')}
                </div>
              </div>
            </div>
            ${canDelete ? `
              <button onclick="WallModule.deletePost('${p.id}')" class="text-slate-300 hover:text-red-500 transition-colors p-1 rounded-lg hover:bg-red-50" title="Eliminar publicaci\u00f3n"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            ` : ''}
          </div>

          <div class="text-slate-600 text-sm mb-4 whitespace-pre-wrap leading-relaxed">${Helpers.escapeHTML(p.content)}</div>
          
          ${mediaHtml}

          <div class="flex items-center gap-6 pt-4 border-t border-slate-50">
            <button onclick="WallModule.toggleLike('${p.id}')" class="flex items-center gap-2 text-xs font-bold transition-colors group ${p.user_liked ? 'text-rose-500' : 'text-slate-500 hover:text-rose-500'}">
              <i data-lucide="heart" class="w-4 h-4 ${p.user_liked ? 'fill-rose-500' : 'group-hover:scale-110 transition-transform'}"></i>
              <span id="like-count-${p.id}">${p.like_count}</span>
            </button>
            <button onclick="WallModule.toggleCommentSection('${p.id}')" class="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-blue-500 transition-colors">
              <i data-lucide="message-circle" class="w-4 h-4"></i>
              <span>${p.comments && p.comments[0] ? p.comments[0].count : 0} Comentarios</span>
            </button>
          </div>

          <div id="comments-section-${p.id}" class="hidden mt-4 pt-4 border-t border-slate-50 bg-slate-50/50 -mx-5 px-5 pb-2">
            <div id="comments-list-${p.id}" class="space-y-3 mb-3 max-h-60 overflow-y-auto">
              <p class="text-center text-xs text-slate-400 py-2">Cargando comentarios...</p>
            </div>
            ${canComment ? `
              <div class="flex gap-2">
                <input type="text" id="comment-input-${p.id}" class="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-${accent}-400 outline-none" placeholder="Escribe un comentario..." onkeypress="if(event.key==='Enter') WallModule.sendComment('${p.id}')">
                <button onclick="WallModule.sendComment('${p.id}')" class="p-2 bg-${accent}-600 text-white rounded-xl hover:bg-${accent}-700 transition-colors"><i data-lucide="send" class="w-4 h-4"></i></button>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  // Funciones de acci\u00f3n (Like, Comentar, Eliminar)
  async toggleLike(postId) {
    const user = this._appState?.get('user');
    if (!user) return;

    // Optimistic Update
    const btn = document.querySelector(`#post-${postId} button[onclick*="toggleLike"]`);
    const countSpan = document.getElementById(`like-count-${postId}`);
    const icon = btn?.querySelector('i');
    
    const isLiked = btn?.classList.contains('text-rose-500');
    const newCount = parseInt(countSpan?.textContent || 0) + (isLiked ? -1 : 1);
    
    if(btn) btn.className = `flex items-center gap-2 text-xs font-bold transition-colors group ${!isLiked ? 'text-rose-500' : 'text-slate-500 hover:text-rose-500'}`;
    if(icon) icon.setAttribute('class', `w-4 h-4 ${!isLiked ? 'fill-rose-500' : 'group-hover:scale-110 transition-transform'}`);
    if(countSpan) countSpan.textContent = newCount;

    try {
      if (isLiked) {
        await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', user.id);
      } else {
        await supabase.from('likes').insert({ post_id: postId, user_id: user.id });
      }
    } catch (err) {
      console.error(err); // Revertir si falla
    }
  },

  async sendComment(postId) {
    const input = document.getElementById(`comment-input-${postId}`);
    const content = input?.value.trim();
    if (!content) return;

    const user    = this._appState?.get('user');
    const profile = this._appState?.get('profile');
    if (!user) return;

    // Resolver nombre del autor
    let userName = 'Usuario';
    if (profile?.role === 'padre') {
      const { data: student } = await supabase.from('students').select('name').eq('parent_id', user.id).maybeSingle();
      userName = student?.name || profile.name || 'Padre';
    } else {
      userName = profile?.name || 'Personal';
    }

    // Optimistic UI \u2014 agregar comentario sin recargar
    const commentsList = document.getElementById(`comments-list-${postId}`);
    const tempId = `temp-${Date.now()}`;
    if (commentsList) {
      const placeholder = commentsList.querySelector('.italic');
      if (placeholder) placeholder.remove();

      const tempEl = document.createElement('div');
      tempEl.id = tempId;
      tempEl.className = 'flex gap-2 text-xs opacity-60';
      tempEl.innerHTML = `
        <div class="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center font-bold text-[9px] text-slate-500 shrink-0">
          ${Helpers.escapeHTML(userName.charAt(0).toUpperCase())}
        </div>
        <div class="bg-white p-2 rounded-xl rounded-tl-none border border-slate-100 shadow-sm flex-1">
          <div class="flex justify-between">
            <span class="font-bold text-slate-700">${Helpers.escapeHTML(userName)}</span>
            <span class="text-[9px] text-slate-400">ahora</span>
          </div>
          <p class="text-slate-600 mt-0.5">${Helpers.escapeHTML(content)}</p>
        </div>`;
      commentsList.appendChild(tempEl);
      commentsList.scrollTop = commentsList.scrollHeight;
    }

    // Limpiar input inmediatamente
    input.value = '';

    try {
      const { error } = await supabase.from('comments').insert({
        post_id:   postId,
        user_id:   user.id,
        user_name: userName,
        content
      });

      if (error) throw error;

      // Confirmar \u2014 quitar opacidad del comentario temporal
      const tempEl = document.getElementById(tempId);
      if (tempEl) tempEl.classList.remove('opacity-60');

      // Actualizar contador en el bot\u00f3n de comentarios
      const countBtn = document.querySelector(`#post-${postId} button[onclick*="toggleCommentSection"] span`);
      if (countBtn) {
        const match = countBtn.textContent.match(/\d+/);
        const current = match ? parseInt(match[0]) : 0;
        countBtn.textContent = `${current + 1} Comentarios`;
      }

    } catch (err) {
      console.error('[WallModule] Error sendComment:', err);
      // Revertir optimistic
      document.getElementById(tempId)?.remove();
      input.value = content;
    }
  },

  async toggleCommentSection(postId) {
    const section = document.getElementById(`comments-section-${postId}`);
    if (!section) return;
    section.classList.toggle('hidden');

    // Solo cargar desde DB si la secci\u00f3n se abre Y la lista est\u00e1 vac\u00eda o tiene solo el placeholder
    if (!section.classList.contains('hidden')) {
      const list = document.getElementById(`comments-list-${postId}`);
      const hasRealComments = list && list.querySelectorAll('[id^="comment-"]').length > 0;
      if (!hasRealComments) {
        const comments = await this._fetchComments(postId);
        this.renderComments(postId, comments);
      }
    }
  },

  async _fetchComments(postId) {
    // Traer comentarios con join a profiles (name) y tambi\u00e9n a students (para padres)
    const { data, error } = await supabase
      .from('comments')
      .select(`
        id, content, user_name, created_at, user_id,
        profile:profiles!comments_user_id_fkey(name, avatar_url, role)
      `)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching comments:', error);
      return [];
    }

    // Para comentarios de padres, buscar el nombre del estudiante hijo
    const parentComments = (data || []).filter(c => {
      const p = Array.isArray(c.profile) ? c.profile[0] : c.profile;
      return p?.role === 'padre';
    });

    if (parentComments.length) {
      const parentIds = [...new Set(parentComments.map(c => c.user_id))];
      const { data: students } = await supabase
        .from('students')
        .select('parent_id, name')
        .in('parent_id', parentIds);

      // Mapa parent_id \u2192 nombre del estudiante
      const studentByParent = {};
      (students || []).forEach(s => { studentByParent[s.parent_id] = s.name; });

      // Inyectar nombre del estudiante en los comentarios de padres
      return (data || []).map(c => {
        const p = Array.isArray(c.profile) ? c.profile[0] : c.profile;
        if (p?.role === 'padre' && studentByParent[c.user_id]) {
          return { ...c, _studentName: studentByParent[c.user_id] };
        }
        return c;
      });
    }

    return data || [];
  },

  // Resuelve el nombre a mostrar en un comentario:
  // - Padre \u2192 nombre del estudiante hijo (no el nombre del padre)
  // - Maestra/Directora/Asistente \u2192 profile.name de profiles
  _resolveCommentName(c) {
    const profile = Array.isArray(c.profile) ? c.profile[0] : (c.profile || null);
    
    // Si es padre y tenemos el nombre del estudiante, usarlo
    if (profile?.role === 'padre' && c._studentName) {
      return {
        name:   c._studentName,
        avatar: null   // el avatar del padre no aplica para el estudiante
      };
    }

    return {
      name:   profile?.name || c.user_name || 'Usuario',
      avatar: (profile?.avatar_url && profile.avatar_url.startsWith('http')) ? profile.avatar_url : null
    };
  },

  renderComments(postId, comments) {
    const container = document.getElementById(`comments-list-${postId}`);
    if (!container) return;
    
    if (comments.length === 0) {
      container.innerHTML = '<p class="text-center text-[10px] text-slate-400 italic py-2">S\u00e9 el primero en comentar.</p>';
      return;
    }

    container.innerHTML = comments.map(c => {
      const { name: displayName, avatar: avatarUrl } = this._resolveCommentName(c);

      return `
      <div class="flex gap-2 text-xs">
        <div class="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center font-bold text-[9px] text-slate-500 overflow-hidden border border-white shrink-0">
          ${avatarUrl
            ? ImageLoader.img(avatarUrl, { cls: 'w-full h-full object-cover', fallback: '' })
            : displayName.charAt(0).toUpperCase()}
        </div>
        <div class="bg-white p-2 rounded-xl rounded-tl-none border border-slate-100 shadow-sm flex-1">
          <div class="flex justify-between">
            <span class="font-bold text-slate-700">${Helpers.escapeHTML(displayName)}</span>
            <span class="text-[9px] text-slate-400">${new Date(c.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
          </div>
          <p class="text-slate-600 mt-0.5">${Helpers.escapeHTML(c.content)}</p>
        </div>
      </div>
    `}).join('');

    // Activar lazy loading en avatares de comentarios
    ImageLoader.observe(container);
  },

  async deletePost(postId) {
    if (!confirm('\u00bfEliminar publicaci\u00f3n?')) return;
    try {
      await supabase.from('posts').delete().eq('id', postId);
      document.getElementById(`post-${postId}`)?.remove();
    } catch (err) {
      console.error('Error eliminando post:', err);
    }
  },

  subscribeRealtime() {
    // Implementar suscripci\u00f3n simple si se desea actualizaciones en vivo
  }
};
