import { supabase } from '../supabase.js';
import { AppState, TABLES } from './appState.js';
import { Helpers, escapeHtml } from './helpers.js';

// 🔥 3. HACER FEED REACTIVO (CLAVE)
AppState.subscribe('feedPosts', (posts) => {
  renderFeed(posts);
});

export async function loadClassFeed(reset = true) {
  const container = document.getElementById('classFeed');
  if (!container) return;
  
  container.innerHTML = Helpers.skeleton(2, 'h-32');
  const student = AppState.get('student');
  if (!student?.classroom_id) {
    container.innerHTML = Helpers.emptyState('Sin aula asignada');
    return;
  }

  try {
    const { data: posts, error } = await supabase
      .from(TABLES.POSTS)
      .select(`
        *, 
        teacher:teacher_id(name, avatar_url, role), 
        likes(*), 
        comments(*, user:profiles(name, avatar_url, role), students:students!parent_id(name, avatar_url))
      `)
      .eq('classroom_id', student.classroom_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const postsData = posts || [];

    // 🔥 guardar en estado global
    AppState.set('feedPosts', postsData);

  } catch (err) {
    console.error('Error cargando muro:', err);
    container.innerHTML = Helpers.emptyState('Error al cargar muro');
  }
}

function renderFeed(posts) {
  const container = document.getElementById('classFeed');
  if (!container) return;

  if (!posts.length) {
    container.innerHTML = Helpers.emptyState('No hay publicaciones');
    return;
  }

  const chunk = posts.slice(0, 10);
  container.innerHTML = chunk.map((p, i) => createPostHTML(p, i)).join('');

  if (window.lucide) lucide.createIcons();
}

function createPostHTML(p, index = 0) {
  const teacherObj = Array.isArray(p.teacher) ? p.teacher[0] : p.teacher;
  const tName = teacherObj?.name || p.teacher_name || 'Maestra/o';
  let teacherAvatar = teacherObj?.avatar_url || p.teacher_avatar;
  teacherAvatar = (teacherAvatar && teacherAvatar.startsWith('http')) ? teacherAvatar : '';
  const tRole = teacherObj?.role === 'maestra' ? 'Maestra' : (teacherObj?.role || 'Docente');
  
  const postDate = new Date(p.created_at);
  const isNew = (Date.now() - postDate.getTime()) < 3600000;
  
  const reactionCounts = {};
  if (p.likes && Array.isArray(p.likes)) {
    p.likes.forEach(l => {
      const type = l.reaction_type || 'like';
      reactionCounts[type] = (reactionCounts[type] || 0) + 1;
    });
  }
  
  const myReaction = (p.likes && Array.isArray(p.likes)) ? p.likes.find(l => l.user_id === AppState.get('user')?.id)?.reaction_type : null;
  const commentCount = Array.isArray(p.comments) ? p.comments.length : 0;
  
  let safeMedia = '';
  if (p.media_url && (p.media_url.startsWith('https://') || p.media_url.startsWith('http://'))) {
      const safeTypes = ['jpg','jpeg','png','webp','mp4'];
      const ext = p.media_url.split('.').pop().toLowerCase().split('?')[0];
      if(safeTypes.includes(ext)){
         safeMedia = encodeURI(p.media_url);
      }
  }

  const imgLoading = index < 2 ? 'eager' : 'lazy';
  const imgPriority = index < 2 ? 'high' : 'auto';

  return `
  <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-4 animate-fade-in" id="post-${p.id}">
    <div class="flex items-center gap-3 mb-3">
      <div class="w-10 h-10 rounded-full bg-indigo-100 border border-indigo-50 overflow-hidden flex items-center justify-center flex-shrink-0">
        ${teacherAvatar 
          ? `<img src="${teacherAvatar}" class="w-full h-full object-cover" alt="${escapeHtml(tName)}">` 
          : `<span class="font-bold text-indigo-600">${tName.charAt(0)}</span>`
        }
      </div>
      <div>
        <p class="font-bold text-slate-800 flex items-center gap-2">${escapeHtml(tName)} <span class="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full uppercase tracking-wider">${tRole}</span></p>
        <div class="flex items-center gap-2">
          <p class="text-xs text-slate-500">${postDate.toLocaleDateString()} ${postDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
          ${isNew ? '<span class="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">NUEVO</span>' : ''}
        </div>
      </div>
    </div>
    <p class="text-slate-700 text-sm leading-relaxed mb-3">${escapeHtml(p.content)}</p>
    ${p.media_url ? `
      <div class="rounded-xl overflow-hidden border border-slate-100">
        ${p.media_type === 'video' 
          ? `<video src="${safeMedia}" controls class="w-full max-h-80 bg-black"></video>`
          : `<img src="${safeMedia}" class="w-full object-cover max-h-80" loading="${imgLoading}" fetchpriority="${imgPriority}" decoding="async">`
        }
      </div>
    ` : ''}
    
    <div class="flex gap-4 text-xs text-slate-400 mb-2 mt-3 px-1" id="reaction-summary-${p.id}">
        ${renderReactionSummary(reactionCounts)}
        <span class="flex items-center gap-1">💬 <span id="comment-count-${p.id}">${commentCount}</span></span>
    </div>

    <div class="flex items-center gap-4 pt-2 border-t border-slate-50">
      <div class="flex gap-1 bg-slate-50 rounded-full p-1" id="reaction-buttons-${p.id}">
         <button data-type="like" onclick="window.toggleReaction('${p.id}', 'like')" class="p-2 rounded-full hover:bg-white hover:shadow-sm transition-all ${myReaction === 'like' ? 'bg-blue-100 ring-2 ring-blue-200' : ''}">👍</button>
         <button data-type="love" onclick="window.toggleReaction('${p.id}', 'love')" class="p-2 rounded-full hover:bg-white hover:shadow-sm transition-all ${myReaction === 'love' ? 'bg-pink-100 ring-2 ring-pink-200' : ''}">❤️</button>
         <button data-type="haha" onclick="window.toggleReaction('${p.id}', 'haha')" class="p-2 rounded-full hover:bg-white hover:shadow-sm transition-all ${myReaction === 'haha' ? 'bg-yellow-100 ring-2 ring-yellow-200' : ''}">😂</button>
      </div>

      <button class="flex items-center gap-2 text-slate-500 hover:text-blue-500 hover:bg-blue-50 transition-colors text-sm py-2 px-3 rounded-lg ml-auto" onclick="window.toggleCommentSection('${p.id}')">
        <i data-lucide="message-circle" class="w-5 h-5"></i>
        <span>Comentar</span>
      </button>
    </div>

    <div id="comments-section-${p.id}" class="hidden mt-3 pt-3 border-t border-slate-100 bg-slate-50/50 rounded-xl p-3">
      <div id="comments-list-${p.id}" class="space-y-3 mb-3 max-h-60 overflow-y-auto pr-1 overscroll-contain">
        ${(p.comments && p.comments.length > 0) ? p.comments.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).map(renderComment).join('') : '<p class="text-xs text-slate-400 text-center py-2">Sé el primero en comentar</p>'}
      </div>
      <div class="flex gap-2 items-center">
        <input type="text" id="comment-input-${p.id}" class="flex-1 border rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="Escribe un comentario..." onkeypress="if(event.key==='Enter') window.sendComment('${p.id}')">
        <button onclick="window.sendComment('${p.id}')" class="bg-blue-600 text-white p-2 rounded-xl hover:bg-blue-700 transition-colors shadow-sm"><i data-lucide="send" class="w-4 h-4"></i></button>
      </div>
    </div>
  </div>`;
}

function renderReactionSummary(counts) {
  const items = [];
  if (counts.like) items.push(`👍 ${counts.like}`);
  if (counts.love) items.push(`❤️ ${counts.love}`);
  if (counts.haha) items.push(`😂 ${counts.haha}`);
  return items.length > 0 ? `<span class="flex items-center gap-2">${items.join(' ')}</span>` : '<span class="flex items-center gap-1">👍 0</span>';
}

export function renderComment(c) {
  const userObj = Array.isArray(c.user) ? c.user[0] : c.user;
  // Intentar obtener datos del estudiante vinculado al padre que comentó
  const studentObj = (c.students && Array.isArray(c.students) && c.students.length > 0) 
    ? c.students[0] 
    : (c.students || null);

  // Lógica de visualización: Priorizar datos del Estudiante si es un Padre
  let uName = userObj?.name || 'Usuario';
  let avatar = userObj?.avatar_url || '';

  if (userObj?.role === 'padre' && studentObj) {
    uName = studentObj.name;
    if (studentObj.avatar_url) avatar = studentObj.avatar_url;
  }

  avatar = avatar.startsWith('http') ? avatar : '';

  return `
    <div class="flex gap-2 group">
      <div class="w-7 h-7 rounded-full bg-slate-200 overflow-hidden flex-shrink-0 border border-white">
        ${avatar ? `<img src="${avatar}" class="w-full h-full object-cover">` : `<span class="text-[10px] flex items-center justify-center h-full font-bold text-slate-500">${uName.charAt(0)}</span>`}
      </div>
      <div class="flex-1">
        <div class="bg-white px-3 py-2 rounded-2xl rounded-tl-none shadow-sm border border-slate-100">
          <p class="text-[11px] font-bold text-slate-800 mb-0.5">${escapeHtml(uName)}</p>
          <p class="text-xs text-slate-600 leading-tight">${escapeHtml(c.content)}</p>
        </div>
        <p class="text-[9px] text-slate-400 mt-1 ml-1">${new Date(c.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
      </div>
    </div>
  `;
}

window.toggleCommentSection = (postId) => {
  const sec = document.getElementById(`comments-section-${postId}`);
  if (sec) {
    sec.classList.toggle('hidden');
    if (!sec.classList.contains('hidden')) {
      const input = document.getElementById(`comment-input-${postId}`);
      if (input) input.focus();
    }
  }
};

window.sendComment = async (postId) => {
  const input = document.getElementById(`comment-input-${postId}`);
  const content = input?.value.trim();
  if (!content) return;

  const user = AppState.get('user');
  if (!user) return;

  try {
    input.value = '';
    const { error } = await supabase.from(TABLES.COMMENTS).insert({
      post_id: postId,
      user_id: user.id,
      content
    });
    if (error) throw error;
    
  } catch (err) {
    console.error('Error enviando comentario:', err);
    Helpers.toast('Error al comentar', 'error');
  }
};

window.toggleReaction = async (postId, type) => {
  const user = AppState.get('user');
  if (!user) return;

  try {
    const { data: existing } = await supabase
      .from(TABLES.LIKES)
      .select('*')
      .eq('post_id', postId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      if (existing.reaction_type === type) {
        await supabase.from(TABLES.LIKES).delete().eq('id', existing.id);
      } else {
        await supabase.from(TABLES.LIKES).update({ reaction_type: type }).eq('id', existing.id);
      }
    } else {
      await supabase.from(TABLES.LIKES).insert({
        post_id: postId,
        user_id: user.id,
        reaction_type: type
      });
    }
    
  } catch (err) {
    console.error('Error en reacción:', err);
  }
};

export async function initFeedRealtime() {
  const student = AppState.get('student');
  if (!student?.classroom_id) return;

  const old = AppState.get('feedChannel');
  if (old) {
    await AppState.removeChannelSafe(old);
    AppState.set('feedChannel', null);
  }

  const channel = supabase
    .channel(`feed_${student.classroom_id}`)

    // 🧱 POSTS
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: TABLES.POSTS,
      filter: `classroom_id=eq.${student.classroom_id}`
    }, (payload) => {
      let posts = AppState.get('feedPosts') || [];

      if (payload.eventType === 'INSERT') {
        posts = [payload.new, ...posts];
      }

      if (payload.eventType === 'UPDATE') {
        posts = posts.map(p => p.id === payload.new.id ? payload.new : p);
      }

      if (payload.eventType === 'DELETE') {
        posts = posts.filter(p => p.id !== payload.old.id);
      }

      AppState.set('feedPosts', posts);
    })

    // 💬 COMMENTS
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: TABLES.COMMENTS
    }, (payload) => {
      const postId = payload.new?.post_id || payload.old?.post_id;
      if (!postId) return;

      let posts = AppState.get('feedPosts') || [];

      posts = posts.map(p => {
        if (p.id !== postId) return p;

        let comments = p.comments || [];

        if (payload.eventType === 'INSERT') {
          comments = [...comments, payload.new];
        }

        if (payload.eventType === 'DELETE') {
          comments = comments.filter(c => c.id !== payload.old.id);
        }

        return { ...p, comments };
      });

      AppState.set('feedPosts', posts);
    })

    // 👍 LIKES
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: TABLES.LIKES
    }, (payload) => {
      const postId = payload.new?.post_id || payload.old?.post_id;
      if (!postId) return;

      let posts = AppState.get('feedPosts') || [];

      posts = posts.map(p => {
        if (p.id !== postId) return p;

        let likes = p.likes || [];

        if (payload.eventType === 'INSERT') {
          likes = [...likes, payload.new];
        }

        if (payload.eventType === 'DELETE') {
          likes = likes.filter(l => l.id !== payload.old.id);
        }

        return { ...p, likes };
      });

      AppState.set('feedPosts', posts);
    })

    .subscribe((status) => {
      console.log('📡 Feed realtime:', status);
    });

  AppState.set('feedChannel', channel);
}
