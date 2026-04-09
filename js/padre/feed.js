import { supabase } from '../shared/supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';
import { ImageLoader } from '../shared/image-loader.js';

/**
 * 📱 MÓDULO DE MURO (FEED)
 */
export const FeedModule = {
  _classroomId: null,
  _channel: null,

  /**
   * Inicializa el muro
   */
  async init(classroomId) {
    if (!classroomId) return;
    this._classroomId = classroomId;
    
    // Delegación para likes y comentarios
    const container = document.getElementById('classFeed');
    if (container && !container._initialized) {
      Helpers.delegate(container, '[data-action="like"]', 'click', (e, btn) => {
        this.toggleLike(btn.dataset.postId);
      });
      Helpers.delegate(container, '[data-action="comment"]', 'click', (e, btn) => {
        this.showComments(btn.dataset.postId);
      });
      container._initialized = true;
    }

    // Suscripción reactiva al estado
    AppState.subscribe('feedPosts', (posts) => {
      this.renderFeed(posts);
    });

    await this.loadPosts();
    this.initRealtime();
  },

  /**
   * Carga publicaciones de Supabase
   */
  async loadPosts() {
    const container = document.getElementById('classFeed');
    if (!container) return;
    
    container.innerHTML = Helpers.skeleton(2, 'h-48');

    try {
      const { data: posts, error } = await supabase
        .from(TABLES.POSTS)
        .select(`
          *, 
          teacher:teacher_id(name, avatar_url, role), 
          likes(*), 
          comments(*, user:profiles(name, avatar_url, role))
        `)
        .eq('classroom_id', this._classroomId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      AppState.set('feedPosts', posts || []);

    } catch (err) {
      console.error('Feed error:', err);
      container.innerHTML = Helpers.errorState('Error al cargar el muro', 'window.App.feed.reload?.()');
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
    const teacher = p.teacher || { name: 'Maestra', role: 'docente' };
    const date = Helpers.formatDate(p.created_at);
    const myId = AppState.get('user')?.id;
    const isLiked = (p.likes || []).some(l => l.user_id === myId);
    
    let mediaHTML = '';
    if (p.media_url) {
      const isVideo = p.media_url.match(/\.(mp4|webm|ogg)$/i);
      // Optimizar URL con transformación de Supabase (WebP + resize)
      const optimizedUrl = p.media_url.includes('supabase.co/storage')
        ? p.media_url + (p.media_url.includes('?') ? '&' : '?') + 'width=900&quality=80&format=webp'
        : p.media_url;
      mediaHTML = isVideo
        ? ImageLoader.video(p.media_url, '', { cls: 'w-full rounded-2xl mb-4 max-h-80 object-cover' })
        : `<div class="cursor-zoom-in" onclick="window.openLightbox && window.openLightbox('${optimizedUrl}','image')">${ImageLoader.img(optimizedUrl, { cls: 'w-full rounded-2xl mb-4 max-h-80 object-cover shadow-sm', fallback: 'img/mundo.jpg' })}</div>`;
    }

    return `
      <div class="bg-white p-5 rounded-[2.5rem] border-2 border-slate-50 mb-6 shadow-sm hover:shadow-md transition-all animate-fade-in">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-full bg-orange-100 flex items-center justify-center font-bold text-orange-600 overflow-hidden border border-orange-50">
              ${teacher.avatar_url ? ImageLoader.img(teacher.avatar_url, { cls: 'w-full h-full object-cover', fallback: 'img/mundo.jpg' }) : teacher.name.charAt(0)}
            </div>
            <div>
              <p class="font-black text-slate-800 text-sm leading-tight">${escapeHtml(teacher.name)}</p>
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${date}</p>
            </div>
          </div>
          <span class="px-3 py-1 bg-slate-50 text-slate-400 text-[9px] font-black uppercase rounded-full border border-slate-100">Comunicado</span>
        </div>

        <p class="text-sm text-slate-600 leading-relaxed mb-4">${escapeHtml(p.content)}</p>
        
        ${mediaHTML}

        <div class="flex items-center gap-4 pt-4 border-t border-slate-50">
          <button data-action="like" data-post-id="${p.id}" class="flex items-center gap-2 text-xs font-black uppercase tracking-tighter ${isLiked ? 'text-orange-600' : 'text-slate-400'} hover:scale-105 transition-all">
            <i data-lucide="heart" class="w-4 h-4 ${isLiked ? 'fill-current' : ''}"></i>
            ${(p.likes || []).length} Me gusta
          </button>
          <button data-action="comment" data-post-id="${p.id}" class="flex items-center gap-2 text-xs font-black uppercase tracking-tighter text-slate-400 hover:text-blue-600 transition-all">
            <i data-lucide="message-circle" class="w-4 h-4"></i>
            ${(p.comments || []).length} Comentarios
          </button>
        </div>

        <div id="comments-section-${p.id}" class="hidden mt-4 pt-4 border-t border-slate-50 bg-slate-50/50 -mx-5 px-5 pb-2">
          <div id="comments-list-${p.id}" class="space-y-3 mb-3 max-h-48 overflow-y-auto">
            ${(p.comments || []).length === 0
              ? '<p class="text-center text-[10px] text-slate-400 italic py-2">Sé el primero en comentar.</p>'
              : (p.comments || []).map(c => {
                  // Priorizar c.user_name que es donde guardamos el nombre del estudiante/maestra al insertar
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
      console.error('Error enviando comentario:', err);
      // Revertir optimistic — quitar el comentario temporal
      document.getElementById(tempId)?.remove();
      input.value = content; // restaurar el texto
      Helpers.toast('Error al enviar comentario', 'error');
    }
  },

  /**
   * Realtime para el muro
   */
  initRealtime() {
    if (this._channel) supabase.removeChannel(this._channel);

    this._channel = supabase
      .channel(`feed_${this._classroomId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'posts',
        filter: `classroom_id=eq.${this._classroomId}`
      }, (payload) => {
        // Notificación push al padre cuando la maestra publica
        Helpers.toast('\uD83D\uDCE2 Nueva publicaci\u00F3n en el muro del aula', 'info');
        this.loadPosts();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'posts',
        filter: `classroom_id=eq.${this._classroomId}`
      }, () => this.loadPosts())
      .subscribe();
  },

  async toggleLike(postId) {
    const user = AppState.get('user');
    const posts = AppState.get('feedPosts');
    const post = posts.find(p => p.id === postId);
    const existingLike = post?.likes?.find(l => l.user_id === user.id);

    try {
      if (existingLike) {
        await supabase.from('likes').delete().eq('id', existingLike.id);
      } else {
        await supabase.from('likes').insert({ post_id: postId, user_id: user.id });
      }
      // El realtime recargará los posts
    } catch (e) { console.error('Like error'); }
  }
};
