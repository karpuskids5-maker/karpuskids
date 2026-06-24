/**
 * ⚡ Karpus Kids — Prefetch System
 *
 * CONCEPTO:
 * Mientras el usuario ve el skeleton de carga de una sección,
 * en paralelo consultamos la DB y pre-cargamos todas las imágenes/videos
 * en el caché del browser. Cuando el usuario llega a la sección,
 * las imágenes ya están listas → aparecen instantáneamente.
 *
 * USO:
 *   // En el init del panel, después de autenticar:
 *   Prefetch.start(classroomId, userId);
 *
 *   // En cada módulo, antes de renderizar:
 *   await Prefetch.ready('muro');   // espera a que las imágenes del muro estén listas
 */

import { supabase } from './supabase.js';

// ── Caché de promesas por sección ─────────────────────────────────────────────
const _cache = new Map();   // sectionKey → Promise<void>
const _done  = new Set();   // secciones ya pre-cargadas

export const Prefetch = {

  /**
   * Limpia toda la pre-carga y el caché.
   * Útil al cambiar de estudiante o de usuario.
   */
  clear() {
    _cache.clear();
    _done.clear();
  },

  /**
   * Inicia la pre-carga de todas las secciones en paralelo.
   * Llamar una sola vez al iniciar el panel, después de autenticar.
   *
   * @param {object} ctx — { classroomId, userId, studentId, role }
   */
  start(ctx = {}) {
    const { classroomId, userId, studentId, role } = ctx;

    // Pre-cargar en paralelo — silencioso si falla
    if (classroomId) {
      _cache.set('muro',   this._prefetchMuro(classroomId));
      _cache.set('tareas', this._prefetchTareas(classroomId));
    }
    if (userId) {
      _cache.set('avatares', this._prefetchAvatares(userId, role));
    }
    if (studentId) {
      _cache.set('evidencias', this._prefetchEvidencias(studentId));
    }

  },

  /**
   * Espera a que la pre-carga de una sección esté lista.
   * Si ya terminó, resuelve inmediatamente.
   * Si no hay pre-carga para esa sección, resuelve inmediatamente.
   */
  async ready(section) {
    if (_done.has(section)) return;
    const p = _cache.get(section);
    if (p) {
      try { await p; } catch (_) {}
    }
  },

  // ── Pre-cargadores por sección ──────────────────────────────────────────

  async _prefetchMuro(classroomId) {
    try {
      const { data: posts } = await supabase
        .from('posts')
        .select('media_url, image_url, teacher:teacher_id(avatar_url)')
        .eq('classroom_id', classroomId)
        .order('created_at', { ascending: false })
        .limit(10);

      const urls = [];
      for (const p of posts || []) {
        const media = p.media_url || p.image_url;
        if (media) urls.push(media);
        if (p.teacher?.avatar_url) urls.push(p.teacher.avatar_url);
      }

      await this._preloadImages(urls);
      _done.add('muro');
    } catch (_) {
      _done.add('muro');
    }
  },

  async _prefetchTareas(classroomId) {
    try {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id')
        .eq('classroom_id', classroomId)
        .order('created_at', { ascending: false })
        .limit(10);

      const taskIds = (tasks || []).map(t => t.id);
      if (!taskIds.length) { _done.add('tareas'); return; }

      const { data: evidences } = await supabase
        .from('task_evidences')
        .select('file_url, student:student_id(avatar_url)')
        .in('task_id', taskIds)
        .limit(30);

      const urls = [];
      for (const e of evidences || []) {
        if (e.file_url) urls.push(e.file_url);
        if (e.student?.avatar_url) urls.push(e.student.avatar_url);
      }

      await this._preloadImages(urls);
      _done.add('tareas');
    } catch (_) {
      _done.add('tareas');
    }
  },

  async _prefetchAvatares(userId, role) {
    try {
      // ✅ SMART PREFETCH: Solo avatares de contactos con conversaciones activas
      // 1. Obtener IDs de usuarios con los que se ha hablado recientemente
      const { data: participants } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id')
        .eq('user_id', userId);

      if (!participants?.length) { _done.add('avatares'); return; }

      const convIds = participants.map(p => p.conversation_id);

      const { data: recentContacts } = await supabase
        .from('conversation_participants')
        .select('user_id, profiles:user_id(avatar_url)')
        .in('conversation_id', convIds)
        .neq('user_id', userId)
        .limit(20);

      const urls = (recentContacts || [])
        .map(c => c.profiles?.avatar_url)
        .filter(Boolean);

      if (urls.length > 0) {
        await this._preloadImages(urls);
      }
      _done.add('avatares');
    } catch (_) {
      _done.add('avatares');
    }
  },

  async _prefetchEvidencias(studentId) {
    try {
      const { data: evidences } = await supabase
        .from('task_evidences')
        .select('file_url')
        .eq('student_id', studentId)
        .not('file_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(20);

      const urls = (evidences || []).map(e => e.file_url).filter(Boolean);
      await this._preloadImages(urls);
      _done.add('evidencias');
    } catch (_) {
      _done.add('evidencias');
    }
  },

  // ── Motor de pre-carga ────────────────────────────────────────────────────

  /**
   * Pre-carga un array de URLs en el caché del browser.
   * Usa <link rel="prefetch"> para imágenes y fetch() para videos.
   * No bloquea — resuelve cuando todas terminan (o fallan).
   */
  _preloadImages(urls) {
    if (!urls.length) return Promise.resolve();

    const unique = [...new Set(urls.filter(Boolean))];

    const promises = unique.map(url => {
      // Detectar si es video
      const isVideo = /\.(mp4|mov|webm|ogg)(\?|$)/i.test(url);

      if (isVideo) {
        // Para videos: solo pre-cargar el primer chunk con fetch range
        return fetch(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-65535' }, // primeros 64KB
          cache: 'force-cache'
        }).catch(() => {});
      } else {
        // Para imágenes: crear un Image() que el browser cachea automáticamente
        return new Promise(resolve => {
          const img = new Image();
          img.onload  = resolve;
          img.onerror = resolve; // silencioso si falla
          img.src = url;
        });
      }
    });

    return Promise.allSettled(promises);
  }
};

// ── Skeletons reutilizables ───────────────────────────────────────────────────
export const Skeletons = {
  /** Post del muro con imagen */
  post: () => `
    <div class="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden mb-6 animate-pulse">
      <div class="p-5">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full bg-slate-200"></div>
          <div class="flex-1 space-y-2">
            <div class="h-3 bg-slate-200 rounded-full w-1/3"></div>
            <div class="h-2 bg-slate-100 rounded-full w-1/4"></div>
          </div>
        </div>
        <div class="space-y-2 mb-4">
          <div class="h-3 bg-slate-200 rounded-full w-full"></div>
          <div class="h-3 bg-slate-200 rounded-full w-4/5"></div>
        </div>
        <div class="h-48 bg-slate-200 rounded-2xl"></div>
      </div>
    </div>`,

  /** Tarjeta de tarea */
  task: () => `
    <div class="bg-white rounded-2xl border border-slate-100 p-5 animate-pulse">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-slate-200 shrink-0"></div>
        <div class="flex-1 space-y-2">
          <div class="h-3 bg-slate-200 rounded-full w-2/3"></div>
          <div class="h-2 bg-slate-100 rounded-full w-1/2"></div>
          <div class="h-24 bg-slate-100 rounded-xl mt-3"></div>
        </div>
      </div>
    </div>`,

  /** Lista de n skeletons */
  list: (n = 3, type = 'post') => Array.from({ length: n }, () => Skeletons[type]?.() || '').join('')
};
