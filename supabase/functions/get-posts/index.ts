/**
 * get-posts — Edge Function
 * Retorna posts para el panel padre, bypaseando RLS.
 * Incluye posts generales (classroom_id IS NULL) + posts del aula del estudiante.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500);
    }

    // Verificar autenticación del caller usando el JWT del header
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing authorization header' }, 401);
    }

    // Usar service role para leer sin RLS
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false }
    });

    // Verificar que el JWT es válido
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) {
      return json({ error: 'Token inválido' }, 401);
    }

    // Parsear classroom_id del body
    let classroomId: number | null = null;
    try {
      const body = await req.json();
      classroomId = body.classroom_id ? Number(body.classroom_id) : null;
    } catch (_) {}

    // Fetch posts con service role (sin RLS)
    let query = admin
      .from('posts')
      .select(`
        id, content, media_url, media_type, image_url, created_at, classroom_id, teacher_id,
        teacher:profiles!posts_teacher_id_fkey(name, avatar_url, role),
        likes(id, user_id),
        comments(id, content, user_name, user_id, created_at)
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (classroomId) {
      query = (query as any).or(`classroom_id.is.null,classroom_id.eq.${classroomId}`);
    } else {
      query = (query as any).is('classroom_id', null);
    }

    const { data: posts, error } = await query;
    if (error) {
      console.error('[get-posts] DB error:', error.message);
      return json({ error: error.message }, 400);
    }

    // Resolver URLs de media relativas a URLs públicas de Supabase Storage
    const resolvedPosts = (posts || []).map((p: Record<string, unknown>) => {
      const mediaUrl = p.media_url as string | null;
      if (mediaUrl && !mediaUrl.startsWith('http')) {
        // Es un path relativo — construir URL pública
        const bucket = mediaUrl.startsWith('posts/') ? 'posts' : 'classroom_media';
        const path   = mediaUrl.replace(/^(posts|classroom_media)\//, '');
        p = {
          ...p,
          media_url: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
        };
      }
      return p;
    });

    console.log(`[get-posts] user=${user.id} classroom=${classroomId} posts=${resolvedPosts.length}`);
    return json({ posts: resolvedPosts });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[get-posts] Fatal:', msg);
    return json({ error: msg }, 500);
  }
});
