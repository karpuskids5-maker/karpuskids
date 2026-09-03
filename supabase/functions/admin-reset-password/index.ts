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
    const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')        ?? '';

    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('[admin-reset-password] Missing env vars:', {
        hasUrl: !!SUPABASE_URL,
        hasServiceKey: !!SERVICE_KEY,
      });
      return json({ error: 'Variables de entorno del servidor no configuradas. Verifica SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.' }, 500);
    }

    // Verify caller is authenticated
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) {
      return json({ error: 'No se proporcionó token de autenticación.' }, 401);
    }

    const callerClient = createClient(SUPABASE_URL, ANON_KEY || SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false }
    });
    const { data: { user: caller }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !caller) {
      return json({ error: 'No autenticado. Inicia sesión nuevamente.' }, 401);
    }

    // Check admin/directora/asistente role
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle();

    if (profileErr) {
      console.error('[admin-reset-password] Profile query error:', profileErr);
      return json({ error: 'Error al verificar permisos: ' + profileErr.message }, 500);
    }

    const allowedRoles = ['admin', 'directora', 'asistente'];
    if (!allowedRoles.includes(profile?.role)) {
      return json({ error: 'Acceso denegado. Solo administradores, directoras o asistentes.' }, 403);
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return json({ error: 'Cuerpo de petición inválido.' }, 400);
    }

    const { user_id, new_password } = body;
    if (!user_id || !new_password) {
      return json({ error: 'Faltan parámetros requeridos: user_id y new_password.' }, 400);
    }
    if (new_password.length < 6) {
      return json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, 400);
    }

    // Update password using service role (admin API)
    const { data: updateData, error: updateErr } = await adminClient.auth.admin.updateUserById(user_id, {
      password: new_password
    });

    if (updateErr) {
      console.error('[admin-reset-password] Update error:', updateErr);
      return json({ error: 'Error al actualizar contraseña: ' + updateErr.message }, 400);
    }

    return json({ ok: true, message: 'Contraseña actualizada correctamente', user_id });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[admin-reset-password] Unexpected error:', msg);
    return json({ error: 'Error interno del servidor: ' + msg }, 500);
  }
});
