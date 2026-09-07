import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

const allowedRoles = ['admin', 'directora', 'asistente'];

const json = (data: unknown, status = 200, req?: Request) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  try {
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: 'Missing env vars' }, 500, req);
    }

    // ── Auth verification ──────────────────────────────────────────────────
    const auth = await verifyAuth(req, allowedRoles);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status || 401, req);
    }
    const callerId = auth.userId!;

    const { user_id } = await req.json();
    if (!user_id) {
      return json({ error: 'Falta parámetro: user_id' }, 400, req);
    }

    // Prevent self-deletion
    if (user_id === callerId) {
      return json({ error: 'No puedes eliminarte a ti mismo.' }, 400, req);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Capture target email for audit before deletion
    const { data: targetProfile } = await adminClient
      .from('profiles')
      .select('email, name, role')
      .eq('id', user_id)
      .maybeSingle();
    const targetEmail = targetProfile?.email || 'unknown';

    // 1. Unlink students from this parent
    await adminClient
      .from('students')
      .update({ parent_id: null })
      .eq('parent_id', user_id);

    // 2. Delete profile
    await adminClient.from('profiles').delete().eq('id', user_id);

    // 3. Delete auth user
    const { error: authErr } = await adminClient.auth.admin.deleteUser(user_id);
    if (authErr) return json({ error: 'Auth: ' + authErr.message }, 400, req);

    // 4. Audit log (immutable record of this destructive action)
    await adminClient.from('audit_logs').insert({
      user_id: callerId,
      action: 'admin.delete_user',
      payload: { target_id: user_id, target_email: targetEmail, deleted_by: callerId }
    }).catch((e) => console.warn('[admin-delete-user] audit log fail:', e?.message));

    return json({ ok: true, message: 'Usuario eliminado correctamente' }, 200, req);

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[admin-delete-user] Fatal:', msg);
    return json({ error: 'Error interno del servidor' }, 500, req);
  }
});
