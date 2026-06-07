import { supabase, RealtimeUtils } from '../shared/supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';
import { ImageLoader } from '../shared/image-loader.js';
import { WallModule } from '../shared/wall.js';

/**
 * 📱 MÓDULO DE MURO (FEED)
 */
export const FeedModule = {
  _classroomId: null,
  _channel: null,

  /**
   * Inicializa el muro
   * classroomId puede ser null — en ese caso solo muestra posts generales
   */
  async init() {
    const student = AppState.get('currentStudent');
    const parent = AppState.get('user');
    if (!student || !parent) return;

    WallModule.init('muroPostsContainer', {
      accentColor: 'indigo',
      likeColor: 'indigo',
      classroomId: student.classroom_id,
      parentId: parent.id // Pasar parentId explícitamente para RLS
    }, AppState);
  },

  /**
   * Carga publicaciones — solo del período activo del aula
   */
  async loadPosts() {
    const container = document.getElementById('classFeed');
    if (!container) return;
    
    container.innerHTML = Helpers.skeleton(2, 'h-48');

    try {
      // Intentar RPC de período activo primero (más eficiente y filtra por período)
      const { data: rpcData, error: rpcErr } = await supabase.rpc('get_posts_for_period', {
        p_classroom_id: this._classroomId || null,
        p_period_id:    null, // null = usar período activo automáticamente
        p_limit:        50
      });

      if (!rpcErr && rpcData?.posts !== undefined) {
        AppState.set('feedPosts', rpcData.posts || []);
        return;
      }

      // Fallback: Edge Function get-posts (sin filtro de período)
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const { data: efData, error: efErr } = await supabase.functions.invoke('get-posts', {
        body: { classroom_id: this._classroomId || null },
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (efErr) throw new Error('Edge Function error: ' + (efErr.message || JSON.stringify(efErr)));
      if (!efData?.posts) throw new Error('Respuesta inesperada de get-posts');

      AppState.set('feedPosts', efData.posts || []);

    } catch (err) {
      container.innerHTML = `
        <div class="p-6 text-center">
          <p class="text-rose-500 font-bold text-sm mb-2">Error al cargar publicaciones</p>
          <p class="text-slate-400 text-xs font-mono">${escapeHtml(err.message || String(err))}</p>
          <button onclick="App.feed.loadPosts()" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold">Reintentar</button>
        </div>`;
      if (window.lucide) lucide.createIcons();
    }
  },

  /**
   * Renderiza los posts en la UI
   */
  renderFeed(posts) {
    const container = document.getElementById('classFeed');
    if (!container) return;

    if (!posts.length) {
      container.innerHTML = Helpers.emptyState('No hay publicaciones en este momento', '📢');
      return;
    }

    container.innerHTML = posts.map(p => this.createPostHTML(p)).join('');
    if (window.lucide) lucide.createIcons();
    ImageLoader.observe(container);
  },

  /**
   * Crea el HTML de un post individual
   */
  createPostHTML(p) {
    // teacher puede venir como objeto o array (según la fuente)
    const teacher = Array.isArray(p.teacher) ? p.teacher[0] : (p.teacher || {});
    const teacherName   = teacher.name   || p.teacher_name   || 'Maestra';
    const teacherAvatar = teacher.avatar_url || p.teacher_avatar || null;
    const date = Helpers.formatDate(p.created_at);
    const myId = AppState.get('user')?.id;
    const likes = Array.isArray(p.likes) ? p.likes : [];
    const comments = Array.isArray(p.comments) ? p.comments : [];
    const isLiked = likes.some(l => l.user_id === myId);
    
    let mediaHTML = '';
    if (p.media_url) {
      const isVideo = p.media_url.match(/\.(mp4|webm|ogg|mov)$/i);
      const optimizedUrl = p.media_url;
      if (isVideo) {
        mediaHTML = `
          <div class="relative group/media rounded-2xl overflow-hidden mb-4 bg-black">
            ${ImageLoader.video(p.media_url, '', { cls: 'w-full max-h-80 object-cover' })}
            <button onclick="App.feed.downloadMedia('${optimizedUrl}', 'video')"
               class="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-xl opacity-0 group-hover/media:opacity-100 transition-opacity flex items-center gap-1.5 text-[10px] font-black uppercase backdrop-blur-sm">
              <i data-lucide="download" class="w-3.5 h-3.5"></i> Descargar
            </button>
          </div>`;
      } else {
        mediaHTML = `
          <div class="relative group/media cursor-zoom-in rounded-2xl overflow-hidden mb-4 bg-black"
               onclick="window.openLightbox && window.openLightbox('${optimizedUrl}','image')">
            ${ImageLoader.img(optimizedUrl, { cls: 'w-full max-h-[500px] object-cover', fallback: 'img/mundo.jpg' })}
            <button onclick="event.stopPropagation(); App.feed.downloadMedia('${optimizedUrl}', 'image')"
               class="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-xl opacity-0 group-hover/media:opacity-100 transition-opacity flex items-center gap-1.5 text-[10px] font-black uppercase backdrop-blur-sm">
              <i data-lucide="download" class="w-3.5 h-3.5"></i> Descargar
            </button>
          </div>`;
      }
    }

    return `
      <div class="bg-white p-5 rounded-[2.5rem] border-2 border-slate-50 mb-6 shadow-sm hover:shadow-md transition-all animate-fade-in">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center font-bold text-orange-600 overflow-hidden border-2 border-orange-50 shrink-0 aspect-square shadow-sm">
              ${teacherAvatar
                ? `<img src="${teacherAvatar}" alt="${escapeHtml(teacherName)}" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                : ''}
              <span style="${teacherAvatar ? 'display:none' : 'display:flex'}" class="w-full h-full items-center justify-center font-bold text-orange-600">${escapeHtml(teacherName.charAt(0))}</span>
            </div>
            <div>
              <p class="font-black text-slate-800 text-sm leading-tight">${escapeHtml(teacherName)}</p>
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${date}</p>
            </div>
          </div>
          <span class="px-3 py-1 bg-slate-50 text-slate-400 text-[9px] font-black uppercase rounded-full border border-slate-100">Comunicado</span>
        </div>

        <p class="text-sm text-slate-600 leading-relaxed mb-4">${escapeHtml(p.content || '')}</p>
        
        ${mediaHTML}

        <div class="flex items-center gap-4 pt-4 border-t border-slate-50">
          <button data-action="like" data-post-id="${p.id}" class="flex items-center gap-2 text-xs font-black uppercase tracking-tighter ${isLiked ? 'text-orange-600' : 'text-slate-400'} hover:scale-105 transition-all">
            <i data-lucide="heart" class="w-4 h-4 ${isLiked ? 'fill-current' : ''}"></i>
            ${likes.length} Me gusta
          </button>
          <button data-action="comment" data-post-id="${p.id}" class="flex items-center gap-2 text-xs font-black uppercase tracking-tighter text-slate-400 hover:text-blue-600 transition-all">
            <i data-lucide="message-circle" class="w-4 h-4"></i>
            ${comments.length} Comentarios
          </button>
          ${p.media_url ? `
          <button onclick="App.feed.downloadMedia('${p.media_url}', '${p.media_url.match(/\.(mp4|webm|ogg|mov)$/i) ? 'video' : 'image'}')"
             class="ml-auto flex items-center gap-1.5 text-xs font-black uppercase tracking-tighter text-slate-400 hover:text-emerald-600 transition-all">
            <i data-lucide="download" class="w-4 h-4"></i>
            Descargar
          </button>` : ''}
        </div>

        <div id="comments-section-${p.id}" class="hidden mt-4 pt-4 border-t border-slate-50 bg-slate-50/50 -mx-5 px-5 pb-2">
          <div id="comments-list-${p.id}" class="space-y-3 mb-3 max-h-48 overflow-y-auto">
            ${comments.length === 0
              ? '<p class="text-center text-[10px] text-slate-400 italic py-2">Sé el primero en comentar.</p>'
              : comments.map(c => {
                  const cName = c.user_name || c.user?.name || 'Usuario';
                  return `<div class="flex gap-2 text-xs"><div class="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-[9px] shrink-0">${cName.charAt(0)}</div><div class="bg-white p-2 rounded-xl rounded-tl-none border border-slate-100 flex-1"><span class="font-bold text-slate-700">${escapeHtml(cName)}</span><p class="text-slate-600 mt-0.5">${escapeHtml(c.content)}</p></div></div>`;
                }).join('')
            }
          </div>
          <div class="flex gap-2">
            <input type="text" id="comment-input-${p.id}" class="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-400 outline-none" placeholder="Escribe un comentario..." onkeypress="if(event.key==='Enter') App.feed.sendComment('${p.id}')">
            <button onclick="App.feed.sendComment('${p.id}')" class="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"><i data-lucide="send" class="w-4 h-4"></i></button>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Muestra/oculta sección de comentarios usando WallModule compartido
   */
  showComments(postId) {
    // Usar WallModule si está disponible (compartido con directora/maestra)
    if (window.WallModule?.toggleCommentSection) {
      window.WallModule.toggleCommentSection(postId);
      return;
    }
    // Fallback: toggle inline
    const section = document.getElementById(`comments-section-${postId}`);
    if (section) section.classList.toggle('hidden');
  },

  /**
   * Envía un comentario en un post
   */
  async sendComment(postId) {
    const input = document.getElementById(`comment-input-${postId}`);
    const content = input?.value.trim();
    if (!content) return;

    const user    = AppState.get('user');
    const student = AppState.get('currentStudent');
    if (!user) return;

    const authorName = student?.name || 'Padre';

    // Optimistic UI — agregar el comentario inmediatamente sin recargar
    const commentsList = document.getElementById(`comments-list-${postId}`);
    const tempId = `temp-comment-${Date.now()}`;
    if (commentsList) {
      // Quitar el placeholder "Sé el primero en comentar"
      const placeholder = commentsList.querySelector('.italic');
      if (placeholder) placeholder.remove();

      const tempEl = document.createElement('div');
      tempEl.id = tempId;
      tempEl.className = 'flex gap-2 text-xs opacity-60';
      tempEl.innerHTML = `
        <div class="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center font-bold text-[9px] text-blue-600 shrink-0">
          ${authorName.charAt(0).toUpperCase()}
        </div>
        <div class="bg-white p-2 rounded-xl rounded-tl-none border border-slate-100 shadow-sm flex-1">
          <div class="flex justify-between">
            <span class="font-bold text-slate-700">${escapeHtml(authorName)}</span>
            <span class="text-[9px] text-slate-400">ahora</span>
          </div>
          <p class="text-slate-600 mt-0.5">${escapeHtml(content)}</p>
        </div>`;
      commentsList.appendChild(tempEl);
      commentsList.scrollTop = commentsList.scrollHeight;
    }

    // Limpiar input inmediatamente
    input.value = '';

    try {
      const { data: newComment, error } = await supabase.from('comments').insert({
        post_id:   postId,
        user_id:   user.id,
        user_name: authorName,
        content
      }).select('id, content, user_name, created_at').single();

      if (error) throw error;

      // Reemplazar el comentario temporal con el real
      const tempEl = document.getElementById(tempId);
      if (tempEl && newComment) {
        tempEl.id = `comment-${newComment.id}`;
        tempEl.classList.remove('opacity-60');
      }

      // Actualizar contador de comentarios en el botón
      const countBtn = document.querySelector(`[data-post-id="${postId}"][data-action="comment"] span`);
      if (countBtn) {
        const current = parseInt(countBtn.textContent) || 0;
        countBtn.textContent = `${current + 1} Comentarios`;
      }

    } catch (err) {
      // Revertir optimistic — quitar el comentario temporal
      document.getElementById(tempId)?.remove();
      input.value = content; // restaurar el texto
      Helpers.toast('Error al enviar comentario', 'error');
    }
  },

  /**
   * Realtime para el muro
   * Escucha posts del aula Y posts generales (classroom_id IS NULL)
   */
  initRealtime() {
    if (this._channel) supabase.removeChannel(this._channel);

    this._channel = supabase
      .channel(`feed_padre_${this._classroomId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'posts'
      }, (payload) => {
        const { eventType, new: newPost, old: oldPost } = payload;

        // Filtrar por aula si aplica
        if (this._classroomId && newPost.classroom_id && newPost.classroom_id !== this._classroomId) {
          return;
        }

        if (eventType === 'INSERT') {
          Helpers.toast('📢 Nueva publicación en el muro', 'info');
          this.loadPosts(); 
        }

        if (eventType === 'UPDATE') {
          // Sincronizar contadores de likes/comentarios sin recargar todo
          const btnLike = document.querySelector(`[data-action="like"][data-post-id="${newPost.id}"]`);
          const btnComm = document.querySelector(`[data-action="comment"][data-post-id="${newPost.id}"]`);

          if (btnLike && typeof newPost.likes_count === 'number') {
            const span = btnLike.querySelector('span') || btnLike;
            span.textContent = `${newPost.likes_count} Me gusta`;
          }

          if (btnComm && typeof newPost.comments_count === 'number') {
            const span = btnComm.querySelector('span') || btnComm;
            span.textContent = `${newPost.comments_count} Comentarios`;
          }
        }

        if (eventType === 'DELETE') {
          const postEl = document.querySelector(`[data-post-id="${oldPost.id}"]`)?.closest('.animate-fade-in');
          if (postEl) postEl.remove();
        }
      });

    RealtimeUtils.monitorChannel(this._channel, `FeedPadre_${this._classroomId}`);
  },

  /**
   * Descarga un archivo multimedia usando fetch+blob para evitar bloqueo CORS
   */
  async downloadMedia(url, type = 'image') {
    try {
      const btn = event?.currentTarget;
      if (btn) { btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> ...'; if (window.lucide) lucide.createIcons(); }

      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const ext = url.split('?')[0].split('.').pop() || (type === 'video' ? 'mp4' : 'jpg');
      const filename = `karpus_${Date.now()}.${ext}`;

      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);

      if (btn) { btn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i> Listo'; if (window.lucide) lucide.createIcons(); setTimeout(() => { btn.innerHTML = '<i data-lucide="download" class="w-3.5 h-3.5"></i> Descargar'; if (window.lucide) lucide.createIcons(); }, 2000); }
    } catch (err) {
      // Fallback: abrir en nueva pestaña si fetch falla
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  },

  async toggleLike(postId) {
    const user = AppState.get('user');
    const posts = AppState.get('feedPosts');
    const post = posts.find(p => p.id === postId);
    const existingLike = post?.likes?.find(l => l.user_id === user.id);

    // Optimistic UI — actualizar inmediatamente sin recargar
    const btn = document.querySelector(`[data-action="like"][data-post-id="${postId}"]`);
    const countSpan = btn?.querySelector('span');
    const isLiked = !!existingLike;
    const currentCount = post?.likes?.length || 0;
    const newCount = isLiked ? currentCount - 1 : currentCount + 1;

    if (btn) {
      btn.className = btn.className.replace(/text-orange-\d+|text-slate-\d+/g, '');
      btn.classList.add(isLiked ? 'text-slate-400' : 'text-orange-600');
    }
    if (countSpan) countSpan.textContent = `${newCount} Me gusta`;

    // Actualizar estado local sin re-render (actualizamos directamente el array interno)
    if (post) {
      const updatedLikes = isLiked
        ? (post.likes || []).filter(l => l.user_id !== user.id)
        : [...(post.likes || []), { user_id: user.id, id: `temp-${Date.now()}` }];
      // Mutar el array en el estado sin disparar suscriptores (evita re-render del feed)
      const currentPosts = AppState.get('feedPosts');
      const idx = currentPosts.findIndex(p => p.id === postId);
      if (idx !== -1) currentPosts[idx] = { ...currentPosts[idx], likes: updatedLikes };
    }

    try {
      if (existingLike) {
        await supabase.from('likes').delete().eq('id', existingLike.id);
      } else {
        await supabase.from('likes').insert({ post_id: postId, user_id: user.id });
      }
    } catch (_) {
      // Revertir optimistic si falla
      if (btn) {
        btn.classList.remove('text-slate-400', 'text-orange-600');
        btn.classList.add(isLiked ? 'text-orange-600' : 'text-slate-400');
      }
      if (countSpan) countSpan.textContent = `${currentCount} Me gusta`;
    }
  }
};
