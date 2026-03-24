import { supabase } from '../shared/supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';

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
      container.innerHTML = Helpers.emptyState('Error al cargar el muro');
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
      mediaHTML = isVideo 
        ? `<video src="${p.media_url}" controls class="w-full rounded-2xl mb-4 max-h-80 object-cover"></video>`
        : `<img src="${p.media_url}" class="w-full rounded-2xl mb-4 max-h-80 object-cover shadow-sm">`;
    }

    return `
      <div class="bg-white p-5 rounded-[2.5rem] border-2 border-slate-50 mb-6 shadow-sm hover:shadow-md transition-all animate-fade-in">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-full bg-orange-100 flex items-center justify-center font-bold text-orange-600 overflow-hidden border border-orange-50">
              ${teacher.avatar_url ? `<img src="${teacher.avatar_url}" class="w-full h-full object-cover">` : teacher.name.charAt(0)}
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
          <button data-action="comment" data-post-id="${p.id}" class="flex items-center gap-2 text-xs font-black uppercase tracking-tighter text-slate-400 hover:text-indigo-600 transition-all">
            <i data-lucide="message-circle" class="w-4 h-4"></i>
            ${(p.comments || []).length} Comentarios
          </button>
        </div>
      </div>
    `;
  },

  /**
   * Muestra comentarios (Placeholder por ahora o implementar modal)
   */
  showComments(postId) {
    Helpers.toast('Comentarios en desarrollo 🚀', 'info');
  },

  /**
   * Realtime para el muro
   */
  initRealtime() {
    if (this._channel) supabase.removeChannel(this._channel);
    
    this._channel = supabase
      .channel(`feed_${this._classroomId}`)
      .on('postgres_changes', { 
        event: '*', 
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
