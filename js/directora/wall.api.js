/**
 * 📰 WALL API - Acceso a datos para muro/forum
 * 
 * Responsabilidad: Consultas a Supabase para posts, comentarios y likes
 */

import { supabase, sendEmail } from '../shared/supabase.js';
import { TABLES } from '../shared/constants.js';
import { Helpers } from '../shared/helpers.js';

const POSTS_TABLE = 'posts';
const COMMENTS_TABLE = 'comments';
const LIKES_TABLE = 'post_likes';

function logError(context, error) {
  console.error(`[WallApi:${context}]`, error);
}

async function withTimeout(promise, ms = 10000) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout tras ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

function handleResponse({ data, error, count }, context = 'API') {
  if (error) {
    logError(context, error);
    return { data: null, error: error.message || 'Error inesperado', count: 0 };
  }
  return { data, error: null, count: count || 0 };
}

async function queryBuilder(query, context = 'Query') {
  try {
    const res = await withTimeout(query);
    return handleResponse(res, context);
  } catch (error) {
    logError(context, error);
    return { data: null, error: error.message, count: 0 };
  }
}

export const WallApi = {
  /**
   * Obtener posts con paginación
   */
  async getPosts(page = 1, limit = 10) {
    const start = (page - 1) * limit;
    const query = supabase
      .from(POSTS_TABLE)
      .select(`
        id,
        teacher_id,
        content,
        images,
        created_at,
        teacher:profiles(id, name, avatar_url, role)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(start, start + limit - 1);

    const { data, error, count } = await queryBuilder(query, 'getPosts');
    
    return {
      data: {
        posts: data || [],
        total: count || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
      },
      error
    };
  },

  /**
   * Obtener un post específico
   */
  async getPost(id) {
    return await queryBuilder(
      supabase.from(POSTS_TABLE)
        .select(`
          id,
          teacher_id,
          content,
          images,
          created_at,
          teacher:profiles(id, name, avatar_url, role)
        `)
        .eq('id', id)
        .single(),
      'getPost'
    );
  },

  /**
   * Crear un nuevo post
   */
  async createPost(title, content, images = []) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: null, error: 'No autenticado' };

    return await queryBuilder(
      supabase.from(POSTS_TABLE)
        .insert([{
          teacher_id: user.id,
          content: Helpers.escapeHTML(title ? `${title}\n\n${content}` : content),
          images: images,
          created_at: new Date().toISOString()
        }])
        .select()
        .single(),
      'createPost'
    );
  },

  /**
   * Actualizar un post
   */
  async updatePost(id, updates) {
    return await queryBuilder(
      supabase.from(POSTS_TABLE)
        .update(updates)
        .eq('id', id)
        .select()
        .single(),
      'updatePost'
    );
  },

  /**
   * Eliminar un post (soft delete si existe la columna, sino hard delete)
   */
  async deletePost(id) {
    // Por seguridad intentamos soft delete primero, si falla hacemos hard delete o manejamos error
    return await queryBuilder(
      supabase.from(POSTS_TABLE).delete().eq('id', id),
      'deletePost'
    );
  },

  /**
   * Obtener comentarios de un post
   */
  async getComments(postId) {
    return await queryBuilder(
      supabase.from(COMMENTS_TABLE)
        .select(`
          id,
          post_id,
          user_id,
          content,
          created_at,
          author:profiles(id, name, avatar_url, role)
        `)
        .eq('post_id', postId)
        .order('created_at', { ascending: true }),
      'getComments'
    );
  },

  /**
   * Agregar comentario a un post
   */
  async addComment(postId, content) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: null, error: 'No autenticado' };

    return await queryBuilder(
      supabase.from(COMMENTS_TABLE)
        .insert([{
          post_id: postId,
          user_id: user.id,
          content: Helpers.escapeHTML(content),
          created_at: new Date().toISOString()
        }])
        .select('*, author:profiles(id, name, avatar_url, role)')
        .single(),
      'addComment'
    );
  },

  /**
   * Eliminar comentario
   */
  async deleteComment(id) {
    return await queryBuilder(
      supabase.from(COMMENTS_TABLE).delete().eq('id', id).select().single(),
      'deleteComment'
    );
  },

  /**
   * Toggle like en un post
   */
  async toggleLike(postId) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: null, error: 'No autenticado' };

    const { data: existing } = await supabase.from(LIKES_TABLE).select('id').eq('post_id', postId).eq('user_id', user.id).single();

    if (existing) {
      await supabase.from(LIKES_TABLE).delete().eq('post_id', postId).eq('user_id', user.id);
      return { data: { liked: false }, error: null };
    } else {
      await supabase.from(LIKES_TABLE).insert([{ post_id: postId, user_id: user.id }]);
      return { data: { liked: true }, error: null };
    }
  },

  async hasUserLiked(postId) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: false, error: null };

    const { data } = await supabase.from(LIKES_TABLE).select('id').eq('post_id', postId).eq('user_id', user.id).single();
    return { data: !!data, error: null };
  },

  /**
   * Buscar posts por contenido
   */
  async searchPosts(query, page = 1, limit = 10) {
    const start = (page - 1) * limit;
    return await queryBuilder(
      supabase.from(POSTS_TABLE)
        .select('*, teacher:profiles(id, name, avatar_url, role)')
        .ilike('content', `%${query}%`)
        .order('created_at', { ascending: false })
        .range(start, start + limit - 1),
      'searchPosts'
    );
  },

  /**
   * Obtener posts del usuario actual
   */
  async getMyPosts(page = 1, limit = 10) {
    const start = (page - 1) * limit;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: null, error: 'No autenticado' };

    return await queryBuilder(
      supabase.from(POSTS_TABLE)
        .select('*, teacher:profiles(id, name, avatar_url, role)')
        .eq('teacher_id', user.id)
        .order('created_at', { ascending: false })
        .range(start, start + limit - 1),
      'getMyPosts'
    );
  }
};
