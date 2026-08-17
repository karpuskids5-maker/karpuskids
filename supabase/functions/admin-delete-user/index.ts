import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false }
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: 'No autenticado' }, 401);

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle();

    const allowedRoles = ['admin', 'directora', 'asistente'];
    if (!allowedRoles.includes(profile?.role)) {
      return json({ error: 'Acceso denegado.' }, 403);
    }

    const { user_id } = await req.json();
    if (!user_id) {
      return json({ error: 'Falta parámetro: user_id' }, 400);
    }

    // Prevent self-deletion
    if (user_id === caller.id) {
      return json({ error: 'No puedes eliminarte a ti mismo.' }, 400);
    }

    // 1. Unlink students from this parent
    await adminClient
      .from('students')
      .update({ parent_id: null })
      .eq('parent_id', user_id);

    // 2. Delete profile
    await adminClient.from('profiles').delete().eq('id', user_id);

    // 3. Delete auth user
    const { error: authErr } = await adminClient.auth.admin.deleteUser(user_id);
    if (authErr) return json({ error: 'Auth: ' + authErr.message }, 400);

    return json({ ok: true, message: 'Usuario eliminado correctamente' });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
