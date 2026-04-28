/**
 * auto-payment-cycle — Edge Function
 * Ejecuta el ciclo de cobros mensual automáticamente.
 * 
 * Llamar via cron externo (ej: cron-job.org) el día 25 de cada mes:
 *   POST https://<project>.supabase.co/functions/v1/auto-payment-cycle
 *   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 * 
 * O habilitar pg_cron en Supabase y ejecutar:
 *   SELECT cron.schedule('monthly-cycle', '0 6 25 * *',
 *     $$ SELECT net.http_post(url := 'https://<project>.supabase.co/functions/v1/auto-payment-cycle',
 *        headers := '{"Authorization":"Bearer <SERVICE_KEY>"}') $$);
 */
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

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false }
    });

    const today = new Date();
    const dayOfMonth = today.getDate();

    // Get generation_day from school_settings
    const { data: settings } = await supabase
      .from('school_settings')
      .select('generation_day, due_day')
      .eq('id', 1)
      .single();

    const genDay = settings?.generation_day ?? 25;
    const dueDay = settings?.due_day ?? 5;

    // Only run if today is the generation day (or called manually)
    const forceRun = req.headers.get('x-force-run') === 'true';
    if (!forceRun && dayOfMonth !== genDay) {
      return json({
        skipped: true,
        reason: `Today is day ${dayOfMonth}, generation day is ${genDay}`,
        today: today.toISOString()
      });
    }

    // Run the payment cycle RPC
    const { data, error } = await supabase.rpc('run_payment_cycle');

    if (error) {
      console.error('[auto-payment-cycle] RPC error:', error);
      return json({ error: error.message }, 500);
    }

    const result = typeof data === 'string' ? JSON.parse(data) : (data || {});

    console.log(`[auto-payment-cycle] ✅ generated=${result.generated} expired=${result.expired}`);

    return json({
      ok: true,
      generated: result.generated ?? 0,
      expired:   result.expired   ?? 0,
      month:     `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`,
      due_date:  (() => {
        const nm = today.getMonth() + 2 > 12 ? 1 : today.getMonth() + 2;
        const ny = today.getMonth() + 2 > 12 ? today.getFullYear() + 1 : today.getFullYear();
        return `${ny}-${String(nm).padStart(2,'0')}-${String(dueDay).padStart(2,'0')}`;
      })(),
      ran_at: today.toISOString()
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[auto-payment-cycle] Fatal:', msg);
    return json({ error: msg }, 500);
  }
});
