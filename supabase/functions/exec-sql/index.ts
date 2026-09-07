// @ts-nocheck
// Ejecuta SQL arbitrario vía la RPC run_ddl_migration.
// GATE: SOLO acepta service_role autenticado (verificación server-side).
import { getCorsHeaders } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const jsonResp = (data, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

    // Accept either: direct service_role key OR authenticated admin/directora user
    const authHeader = req.headers.get('Authorization') || '';
    const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const isServiceKeyAuth = !!svcKey && authHeader === `Bearer ${svcKey}`;

    if (!isServiceKeyAuth) {
      // Verify JWT properly via Supabase (validates signature server-side)
      const auth = await verifyAuth(req, ['admin', 'directora']);
      if (!auth.ok) {
        return jsonResp({ ok: false, error: 'No autorizado' }, 403);
      }
    }

    const body = await req.json().catch(() => ({}));
    const ddl = typeof body.ddl === 'string' ? body.ddl : '';
    if (!ddl.trim()) {
      return jsonResp({ ok: false, error: 'Falta el campo ddl' }, 400);
    }

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const { error } = await admin.rpc('run_ddl_migration', { ddl });
    if (error) {
      return jsonResp({ ok: false, error: 'Error ejecutando SQL' }, 200);
    }
    return jsonResp({ ok: true });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Error interno' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
