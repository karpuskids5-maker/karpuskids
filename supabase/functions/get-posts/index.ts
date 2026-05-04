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
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: 'Missing env vars' }, 500);
    }

    // Verificar que el caller está autenticado
    const authHeader = req.headers.get('Authorization') ?? '';
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const callerClient = createClient(SUPABASE_URL, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false }
    });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return json({ error: 'No autenticado' }, 401);

    // Parsear classroom_id del body o query param
    let classroomId: number | null = null;
    try {
      const body = await req.json().catch(() => ({}));
      classroomId = body.classroom_id ? Number(body.classroom_id) : null;
    } catch (_) {}

    // Usar service role para leer sin RLS
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Fetch posts: generales (classroom_id IS NULL) + del aula si se especifica
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
      query = query.or(`classroom_id.is.null,classroom_id.eq.${classroomId}`);
    } else {
      query = query.is('classroom_id', null);
    }

    const { data: posts, error } = await query;
    if (error) return json({ error: error.message }, 400);

    return json({ posts: posts || [] });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
