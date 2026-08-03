import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // Verify caller is admin
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false }
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: 'No autenticado' }, 401);

    // Check admin role
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle();

    if (profile?.role !== 'admin') {
      return json({ error: 'Acceso denegado. Solo administradores.' }, 403);
    }

    const { user_id, new_password } = await req.json();
    if (!user_id || !new_password) {
      return json({ error: 'Faltan parámetros: user_id, new_password' }, 400);
    }
    if (new_password.length < 6) {
      return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400);
    }

    // Update password using service role (admin API)
    const { error } = await adminClient.auth.admin.updateUserById(user_id, {
      password: new_password
    });

    if (error) return json({ error: error.message }, 400);

    return json({ ok: true, message: 'Contraseña actualizada correctamente' });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
