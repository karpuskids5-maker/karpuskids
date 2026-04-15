// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_ANON_KEY'),
      { auth: { persistSession: false } }
    );

    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Usar service role para DDL
    const admin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false } }
    );

    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'directora') {
      return new Response(JSON.stringify({ error: 'Solo la directora puede ejecutar migraciones' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Ejecutar DDL via pg directamente usando fetch a la API de Supabase Management
    const projectRef = Deno.env.get('SUPABASE_URL').replace('https://', '').replace('.supabase.co', '');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const sql = `
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS classroom_id bigint REFERENCES public.classrooms(id) ON DELETE SET NULL;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS age integer;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS schedule text;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p1_job text;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p1_address text;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p1_emergency_contact text;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p2_job text;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p2_address text;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS blood_type text;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS authorized_pickup text;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS monthly_fee numeric DEFAULT 0;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS due_day integer DEFAULT 5;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS matricula text;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS start_date date;
      ALTER TABLE public.students ADD COLUMN IF NOT EXISTS avatar_url text;
    `;

    // Usar el endpoint de Postgres directamente via REST
    const pgResp = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      }
    );

    if (!pgResp.ok) {
      // Fallback: intentar via rpc con función plpgsql
      const { error: rpcErr } = await admin.rpc('run_ddl_migration', { ddl: sql });
      if (rpcErr) {
        return new Response(JSON.stringify({ 
          error: 'No se pudo ejecutar la migración automáticamente. Ejecuta manualmente en Supabase SQL Editor:\n\nALTER TABLE public.students ADD COLUMN IF NOT EXISTS classroom_id bigint REFERENCES public.classrooms(id) ON DELETE SET NULL;',
          manual_sql: 'ALTER TABLE public.students ADD COLUMN IF NOT EXISTS classroom_id bigint REFERENCES public.classrooms(id) ON DELETE SET NULL;'
        }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Migración ejecutada correctamente. La columna classroom_id ahora existe en students.'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
