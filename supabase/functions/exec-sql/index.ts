// @ts-nocheck
// Ejecuta SQL arbitrario vía la RPC run_ddl_migration.
// GATE: SOLO acepta la SUPABASE_SERVICE_ROLE_KEY como Bearer (nunca exponer al cliente).
import { getCorsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const svcNew = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const projectRef = Deno.env.get('SUPABASE_URL')?.replace(/^https:\/\/([^.]+)\..*$/, '$1') || '';

    let authorized = !!svcNew && authHeader === `Bearer ${svcNew}`;
    if (!authorized && authHeader.startsWith('Bearer ')) {
      try {
        const parts = authHeader.slice(7).split('.');
        if (parts.length === 3) {
          const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
          const p = JSON.parse(new TextDecoder().decode(b64u(parts[1])));
          const notExpired = !p.exp || p.exp > Math.floor(Date.now() / 1000);
          authorized = p.role === 'service_role' && p.ref === projectRef && notExpired;
        }
      } catch (_) {}
    }

    if (!authorized) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = await req.json().catch(() => ({}));
    const ddl = typeof body.ddl === 'string' ? body.ddl : '';
    if (!ddl.trim()) {
      return new Response(JSON.stringify({ ok: false, error: 'Falta el campo ddl' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const { error } = await admin.rpc('run_ddl_migration', { ddl });
    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
