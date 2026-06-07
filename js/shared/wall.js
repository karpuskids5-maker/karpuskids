import { supabase, RealtimeUtils } from './supabase.js';
import { Helpers } from './helpers.js';
import { ImageLoader } from './image-loader.js';
import { QueryCache } from './query-cache.js';
import { withTimeout } from './db-utils.js';

// Inline helper — optimiza URLs de Supabase Storage con transformaciones
// Aplica resize y compresión cuando la URL es de Supabase Storage (plan Pro)
// En plan gratuito, agrega parámetros de caché para mejor rendimiento
const optimizeImageUrl = (url, opts = {}) => {
  if (!url) return url || null;
  // Solo optimizar URLs de Supabase Storage
  if (!url.includes('/storage/v1/object/public/')) return url;
  const { width, quality } = opts;
  // Agregar parámetros de transformación (requiere plan Pro de Supabase)
  // En plan gratuito estos parámetros son ignorados pero no causan error
  if (width || quality) {
    const sep = url.includes('?') ? '&' : '?';
    const params = [];
    if (width) params.push(`width=${width}`);
    if (quality) params.push(`quality=${quality}`);
    return url + sep + params.join('&');
  }
  return url;
};

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

  // Obtiene los colores de like según la configuración o el rol del usuario
  _getLikeColors() {
    let color = this._options.likeColor;
    
    if (!color) {
      // Fallback basado en el rol si no se pasó un color específico en init
      const role = this._appState?.get('profile')?.role || 'padre';
      const roleColors = {
        'padre': 'emerald',    // Verde
        'maestra': 'orange',   // Naranja
        'asistente': 'emerald',// Verde (Asistente usa Teal/Emerald)
        'directora': 'purple', // Morado
        'admin': 'purple'
      };
      color = roleColors[role] || 'rose';
    }

    return {
      text: `text-${color}-500`,
      fill: `fill-${color}-500`,
      hover: `hover:text-${color}-500`
    };
  },

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
    // Legacy — use _resolveUrlSync instead
    return this._resolveUrlSync(imagePath, opts);
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
    } catch (_) { /* silencioso */ }
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
    // 🛡️ Fix: Si 'container' es un string (ID), convertirlo a elemento DOM
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
      this._isLoading = false;
      return;
    }

    // ✅ PERSISTENCIA EN APPSTATE: Si no es append y tenemos datos en cache, mostrarlos primero
    if (!append && this._appState) {
      const cachedPosts = this._appState.get('wall_posts_cache');
      const cachedFilters = this._appState.get('wall_filters_cache');
      const currentFilters = JSON.stringify(this._options);

      if (cachedPosts && cachedFilters === currentFilters) {
        container.innerHTML = cachedPosts.map(p => this.renderPost(p)).join('');
        if (window.lucide) lucide.createIcons();
        ImageLoader.observe(container);
        this._isLoading = false; 
        // Continuamos para refrescar datos en segundo plano
      }
    }

    if (!append && !container.innerHTML) {
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

      if (this._options.classroomId) {
        // Show posts for this classroom AND general posts (classroom_id = null)
        query = query.or(`classroom_id.eq.${this._options.classroomId},classroom_id.is.null`);
      }
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

      const processedPosts = posts.map(p => this._processPost(p, user));
      
      // Guardar en cache para persistencia instantánea
      if (!append && this._appState) {
        this._appState.set('wall_posts_cache', processedPosts);
        this._appState.set('wall_filters_cache', JSON.stringify(this._options));
      }

      const html = processedPosts.map(p => this.renderPost(p)).join('');

      if (append) container.insertAdjacentHTML('beforeend', html);
      else container.innerHTML = html;

      // Activar lazy loading en las nuevas imágenes
      ImageLoader.observe(container);

      // Pre-cargar avatares e imágenes en background
      const urlsToPrefetch = processedPosts
        .flatMap(p => [p.display_media_url, p.teacher_avatar])
        .filter(Boolean);
      ImageLoader.prefetch(urlsToPrefetch);

      // Paginaci\u00f3n
      if (posts.length < this._pageSize) {
        this._hasMore = false;
        container.insertAdjacentHTML('beforeend', '<div class="py-8 text-center text-xs text-slate-300 italic">No hay m\u00e1s publicaciones.</div>');
      } else {
        this._page++;
        this._setupInfiniteScroll(container);
      }

      if (window.lucide) lucide.createIcons();
    } catch (err) {
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
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.6 }); // Reproducir cuando el 60% del video sea visible

    document.querySelectorAll('video').forEach(v => videoObserver.observe(v));
  },

  _processPost(p, user) {
    const teacherData = p.teacher || {};
    const likesArray = p.likes || [];
    const likeCount = likesArray.length;
    const userLiked = user ? likesArray.some(l => l.user_id === user.id) : false;

    // Resolver URLs de forma SÍNCRONA — con transformación CDN
    const mediaUrl = p.media_url || p.image_url || null;
    const publicUrl = this._resolveUrlSync(mediaUrl, { width: 800, quality: 75 });
    const teacherAvatar = this._resolveUrlSync(teacherData.avatar_url, { width: 80, quality: 80 });

    return {
      ...p,
      teacher_name: teacherData.name || 'Maestra',
      teacher_avatar: teacherAvatar,
      like_count: likeCount,
      user_liked: userLiked,
      display_media_url: publicUrl,
      is_video: p.media_type === 'video' || (mediaUrl && /\.(mp4|mov|webm)$/i.test(mediaUrl))
    };
  },

  // Resolución síncrona de URLs — sin await, sin fetch
  _resolveUrlSync(url, opts = {}) {
    if (!url) return null;
    // Ya es URL completa
    if (/^https?:\/\//i.test(url)) return optimizeImageUrl(url, opts);
    // Construir URL pública de Supabase Storage
    const clean = url.replace(/^(posts|karpus-uploads|avatars|classroom_media)\//, '');
    const isAvatar = url.includes('avatar');
    const bucket = isAvatar ? 'karpus-uploads' : 'posts';
    const path = isAvatar ? `avatars/${clean}` : clean;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return optimizeImageUrl(data?.publicUrl, opts);
  },

  // Utilidad para generar colores consistentes por nombre
  _getAvatarColor(name) {
    const colors = [
      'bg-blue-100 text-blue-600',
      'bg-emerald-100 text-emerald-600',
      'bg-purple-100 text-purple-600',
      'bg-amber-100 text-amber-600',
      'bg-rose-100 text-rose-600',
      'bg-indigo-100 text-indigo-600',
      'bg-teal-100 text-teal-600'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  },

  renderPost(p) {
    const date = this._relativeTimeFromNow(p.created_at);
    const accent = this._options.accentColor || 'indigo';
    const isFirstPost = this._page === 0;
    const colors = this._getLikeColors();

    // Lógica de Renderizado Multimedia con aspect-ratio fijo y lazy loading
    let mediaHtml = '';
    if (p.display_media_url) {
      if (p.is_video) {
        mediaHtml = `
          <div class="aspect-video rounded-2xl overflow-hidden border border-slate-100 mb-4 bg-black relative group/media shadow-inner">
            ${ImageLoader.video(p.display_media_url, '', { 
              cls: 'w-full h-full object-contain',
              preload: 'none' // Lazy loading nativo para video
            })}
            <a href="${p.display_media_url}" download target="_blank" rel="noopener noreferrer"
               class="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-xl opacity-0 group-hover/media:opacity-100 transition-opacity flex items-center gap-1.5 text-[10px] font-black uppercase backdrop-blur-sm"
               title="Descargar video" onclick="event.stopPropagation()">
              <i data-lucide="download" class="w-3.5 h-3.5"></i> Descargar
            </a>
          </div>`;
      } else {
        mediaHtml = `
          <div class="aspect-video rounded-2xl overflow-hidden border border-slate-100 mb-4 cursor-zoom-in bg-slate-50 relative group/media shadow-inner"
               onclick="window.openLightbox('${p.display_media_url}','image')">
            ${ImageLoader.img(p.display_media_url, {
              alt: 'Post media',
              cls: 'w-full h-full object-cover', // Aspect ratio fijo
              fallback: 'img/mundo.jpg',
              priority: isFirstPost ? 'high' : 'low'
            })}
            <a href="${p.display_media_url}" download target="_blank" rel="noopener noreferrer"
               class="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-xl opacity-0 group-hover/media:opacity-100 transition-opacity flex items-center gap-1.5 text-[10px] font-black uppercase backdrop-blur-sm"
               title="Descargar imagen" onclick="event.stopPropagation()">
              <i data-lucide="download" class="w-3.5 h-3.5"></i> Descargar
            </a>
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
      <div class="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden mb-6" id="post-${p.id}" data-classroom-id="${p.classroom_id || 'null'}">
        <div class="p-5">
          <div class="flex justify-between items-start mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-${accent}-100 flex items-center justify-center overflow-hidden shrink-0 shadow-sm border border-slate-100">
                ${ImageLoader.img(p.teacher_avatar, { 
                  cls: 'w-full h-full object-cover', 
                  fallback: 'img/1.jpg',
                  w: 80, h: 80
                })}
              </div>
              <div>
                <div class="font-bold text-slate-800 text-sm">${Helpers.escapeHTML(p.teacher_name)}</div>
                <div class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  ${date} • ${Helpers.escapeHTML(p.classroom?.name || 'General')}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1">
              ${p.display_media_url ? `
                <a href="${p.display_media_url}" download target="_blank" rel="noopener noreferrer"
                   class="p-1.5 text-slate-300 hover:text-${accent}-500 hover:bg-${accent}-50 transition-colors rounded-lg" title="Descargar ${p.is_video ? 'video' : 'imagen'}">
                  <i data-lucide="${p.is_video ? 'video' : 'image'}" class="w-4 h-4"></i>
                </a>
              ` : ''}
              ${canDelete ? `
                <button onclick="WallModule.deletePost('${p.id}')" class="text-slate-300 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50" title="Eliminar publicación">
                  <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
              ` : ''}
            </div>
          </div>

          <div class="text-slate-600 text-sm mb-4 whitespace-pre-wrap leading-relaxed">${Helpers.escapeHTML(p.content)}</div>
          
          ${mediaHtml}

          <div class="flex items-center gap-6 pt-4 border-t border-slate-50">
            <button onclick="WallModule.toggleLike('${p.id}')" class="flex items-center gap-2 text-xs font-bold transition-colors group ${p.user_liked ? colors.text : 'text-slate-500 ' + colors.hover}">
              <i data-lucide="heart" class="w-4 h-4 ${p.user_liked ? colors.fill : 'group-hover:scale-110 transition-transform'}"></i>
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

    const colors = this._getLikeColors();

    // Optimistic Update
    const btn = document.querySelector(`#post-${postId} button[onclick*="toggleLike"]`);
    const countSpan = document.getElementById(`like-count-${postId}`);
    const icon = btn?.querySelector('i') || btn?.querySelector('svg');
    
    // Detección robusta basada en la clase de color configurada
    const isLiked = btn?.classList.contains(colors.text);
    const currentCount = parseInt(countSpan?.textContent || 0);
    const newCount = isLiked ? Math.max(0, currentCount - 1) : currentCount + 1;
    
    if(btn) {
      btn.classList.toggle(colors.text, !isLiked);
      btn.classList.toggle('text-slate-500', isLiked);
      // Animación de pulso al dar like
      if (!isLiked) {
        btn.classList.add('animate-bounce-subtle');
        setTimeout(() => btn.classList.remove('animate-bounce-subtle'), 500);
      }
    }
    
    if(icon) {
      icon.classList.toggle(colors.fill, !isLiked);
      if (!isLiked) {
        icon.classList.remove('group-hover:scale-110', 'transition-transform');
      } else {
        icon.classList.add('group-hover:scale-110', 'transition-transform');
      }
    }

    if(countSpan) countSpan.textContent = String(newCount);

    try {
      if (isLiked) {
        await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', user.id);
      } else {
        // Vibración ligera en móviles
        if (navigator.vibrate) navigator.vibrate(10);
        await supabase.from('likes').insert({ post_id: postId, user_id: user.id });
      }
    } catch (err) {
      // Revertir en caso de error (Silencioso para el usuario)
      if(btn) {
        btn.classList.toggle(colors.text, isLiked);
        btn.classList.toggle('text-slate-500', !isLiked);
      }
      if(icon) icon.classList.toggle(colors.fill, isLiked);
      if(countSpan) countSpan.textContent = String(currentCount);
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

      const colorClass = this._getAvatarColor(userName);
      const tempEl = document.createElement('div');
      tempEl.id = tempId;
      tempEl.className = 'flex gap-2 text-xs opacity-60 animate-slideInUp';
      tempEl.innerHTML = `
        <div class="w-7 h-7 rounded-full ${colorClass} flex items-center justify-center font-black text-[10px] border-2 border-white shrink-0 shadow-sm">
          ${Helpers.escapeHTML(userName.charAt(0).toUpperCase())}
        </div>
        <div class="bg-white p-3 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm flex-1">
          <div class="flex justify-between items-center mb-1">
            <span class="font-black text-slate-800 text-[11px]">${Helpers.escapeHTML(userName)}</span>
            <span class="text-[9px] text-slate-400 font-bold uppercase">ahora</span>
          </div>
          <p class="text-slate-600 leading-relaxed">${Helpers.escapeHTML(content)}</p>
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
      // Revertir optimistic
      document.getElementById(tempId)?.remove();
      input.value = content;
    }
  },

  async toggleCommentSection(postId) {
    const section = document.getElementById(`comments-section-${postId}`);
    if (!section) return;
    section.classList.toggle('hidden');

    // Solo cargar desde DB si la sección se abre Y la lista está vacía o tiene solo el placeholder
    if (!section.classList.contains('hidden')) {
      const list = document.getElementById(`comments-list-${postId}`);
      const hasRealComments = list && list.querySelectorAll('.bg-white').length > 0;
      if (!hasRealComments) {
        list.innerHTML = `
          <div class="py-4 text-center">
            <div class="animate-spin w-5 h-5 border-2 border-slate-200 border-t-slate-400 rounded-full mx-auto"></div>
          </div>`;
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

    // 🔒 Privacidad: Obtener el post para saber si pertenece a un aula
    const postEl = document.getElementById(`post-${postId}`);
    const isClassroomPost = postEl && postEl.dataset.classroomId !== 'null';

    container.innerHTML = comments.map(c => {
      const { name: displayName } = this._resolveCommentName(c);
      const initial = displayName.charAt(0).toUpperCase();
      const colorClass = this._getAvatarColor(displayName);

      return `
      <div class="flex gap-2 text-xs animate-slideInUp">
        <div class="w-7 h-7 rounded-full ${colorClass} flex items-center justify-center font-black text-[10px] border-2 border-white shrink-0 shadow-sm">
          ${initial}
        </div>
        <div class="bg-white p-3 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm flex-1">
          <div class="flex justify-between items-center mb-1">
            <span class="font-black text-slate-800 text-[11px]">${Helpers.escapeHTML(displayName)}</span>
            <span class="text-[9px] text-slate-400 font-bold uppercase">${new Date(c.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
          </div>
          <p class="text-slate-600 leading-relaxed">${Helpers.escapeHTML(c.content)}</p>
        </div>
      </div>
    `}).join('');

    // Activar lazy loading en avatares de comentarios (solo si se muestran)
    if (!isClassroomPost) ImageLoader.observe(container);
  },

  async deletePost(postId) {
    if (!confirm('¿Eliminar esta publicación permanentemente?')) return;
    try {
      // ✅ INTERFAZ OPTIMISTA: Animación de salida
      const el = document.getElementById(`post-${postId}`);
      if (el) {
        el.style.transition = 'all 0.4s ease';
        el.style.opacity = '0';
        el.style.transform = 'translateX(20px)';
      }

      await supabase.from('posts').delete().eq('id', postId);
      setTimeout(() => document.getElementById(`post-${postId}`)?.remove(), 400);
      Helpers.toast('Publicación eliminada', 'info');
    } catch (err) {
      Helpers.toast('Error al eliminar', 'error');
    }
  },

  // Escuchar cambios en posts para actualizar el muro de forma inteligente
  subscribeRealtime() {
    this._unsubscribeRealtime(); // limpiar canal anterior si existe

    const classroomId = this._options.classroomId;
    const self = this;
    
    this._realtimeChannel = supabase
      .channel(`wall_${classroomId || 'global'}_${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async (payload) => {
        const post = payload.new;
        if (classroomId && post.classroom_id && post.classroom_id !== classroomId) return;
        
        // Mostrar indicador de nuevos posts en lugar de refrescar auto
        const container = document.getElementById(self._containerId);
        if (container) {
          const indicator = document.getElementById('wall-new-posts-indicator');
          if (!indicator) {
            const btn = document.createElement('div');
            btn.id = 'wall-new-posts-indicator';
            btn.className = 'fixed top-24 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-6 py-2.5 rounded-full text-[10px] font-black uppercase shadow-2xl animate-bounce cursor-pointer z-50 flex items-center gap-2 border-2 border-white/20 backdrop-blur-md';
            btn.innerHTML = '<i data-lucide="arrow-up" class="w-3 h-3"></i> Nuevas publicaciones disponibles';
            btn.onclick = () => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              self.applyFilters();
              btn.remove();
            };
            document.body.appendChild(btn);
            if (window.lucide) lucide.createIcons();
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, (payload) => {
        const post = payload.new;
        const el = document.getElementById(`post-${post.id}`);
        if (el) {
          const likeSpan = document.getElementById(`like-count-${post.id}`);
          const commBtn = el.querySelector(`button[onclick*="toggleCommentSection"] span`);
          if (likeSpan && typeof post.likes_count === 'number') likeSpan.textContent = post.likes_count;
          if (commBtn && typeof post.comments_count === 'number') commBtn.textContent = `${post.comments_count} Comentarios`;
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => {
        const el = document.getElementById(`post-${payload.old?.id}`);
        if (el) {
          el.classList.add('opacity-0', 'scale-95');
          setTimeout(() => el.remove(), 300);
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          setTimeout(() => {
            if (self._realtimeChannel) self.subscribeRealtime();
          }, 5000);
        }
      });
  },

  /** Desuscribir el canal del muro — llamar cuando el usuario cambia de sección */
  _unsubscribeRealtime() {
    if (this._realtimeChannel) {
      try { supabase.removeChannel(this._realtimeChannel); } catch (_) {}
      this._realtimeChannel = null;
    }
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  },

  /** Destruir completamente el módulo — llamar al salir de la sección muro */
  destroy() {
    this._unsubscribeRealtime();
  },

  openLightbox(postId) {
    const post = document.getElementById(`post-${postId}`);
    const img = post?.querySelector('img');
    if (!img) return;

    const html = `
      <div class="w-full max-w-lg overflow-hidden relative">
        <div class="relative h-80 bg-slate-900 flex items-center justify-center">
          <img src="${img.src}" class="w-full h-full object-contain cursor-zoom-out" alt="Evidencia" onclick="App.ui.closeModal()">
        </div>
      </div>
    `;
    if (window.openGlobalModal) window.openGlobalModal(html, true);
    else if (window.Modal?.open) window.Modal.open('lightbox', html);
  }
};
