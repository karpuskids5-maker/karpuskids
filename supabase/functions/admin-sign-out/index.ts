import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

const allowedRoles = ['admin', 'directora'];

const json = (data: unknown, status = 200, req?: Request) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: 'Missing env vars' }, 500, req);
    }

    // Only directora/admin can revoke access
    const auth = await verifyAuth(req, allowedRoles);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status || 401, req);
    }
    const callerId = auth.userId!;

    const body = await req.json().catch(() => null);
    const user_id = body?.user_id;
    if (!user_id) {
      return json({ error: 'Falta parámetro: user_id' }, 400, req);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Safety: never revoke admin sessions
    const { data: targetProfile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', user_id)
      .maybeSingle();
    if (targetProfile?.role === 'admin') {
      return json({ error: 'No puedes revocar la sesión de una cuenta de administrador.' }, 400, req);
    }

    // Revoke all active sessions for this user (global scope)
    const { error: signOutErr } = await adminClient.auth.admin.signOut(user_id, 'global');
    if (signOutErr) {
      return json({ error: 'Error al cerrar la sesión: ' + signOutErr.message }, 400, req);
    }

    // Audit trail (immutable)
    await adminClient.from('audit_logs').insert({
      user_id: callerId,
      action: 'admin.sign_out',
      payload: { target_id: user_id, revoked_by: callerId }
    }).catch((e) => console.warn('[admin-sign-out] audit log fail:', e?.message));

    return json({ ok: true, message: 'Sesión revocada correctamente', user_id }, 200, req);

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[admin-sign-out] Fatal:', msg);
    return json({ error: 'Error interno del servidor' }, 500, req);
  }
});