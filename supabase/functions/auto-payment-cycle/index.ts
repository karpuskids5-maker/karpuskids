/**
 * auto-payment-cycle — Edge Function
 * Genera cobros mensuales automáticamente para todos los estudiantes activos.
 * - REGLA DE NEGOCIO: los cobros del mes M se generan a partir del día
 *   `generation_day` (25) de ese mismo mes — antes de esa fecha el padre
 *   NO ve ningún cobro nuevo.
 * - NUNCA genera cobros de meses anteriores (backfill) ni de meses futuros:
 *   se respeta la fecha de inscripción (start_date) de cada estudiante.
 * - Se puede forzar con header x-force-run: true o body {"force":true}
 *
 * Cron recomendado: DIARIO a las 6am RD (10:00 UTC) — '0 10 * * *'
 * (es idempotente y está blindado por generation_day, así que correr
 * diario es seguro y garantiza que genere apenas llegue el día 25).
 */
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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing env vars' }, 500);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const forceRun = req.headers.get('x-force-run') === 'true' || body?.force === true;

    // ── Configuración ────────────────────────────────────────────────────────
    const { data: settings } = await supabase
      .from('school_settings').select('generation_day, due_day').eq('id', 1).single();
    const dueDay        = settings?.due_day ?? 5;
    const generationDay = settings?.generation_day ?? 25;

    const now = new Date();

    // ── Fecha LOCAL de República Dominicana (evita desfase UTC al cerrar mes:
    //    sin esto, el 31/ago 8pm RD ya contaría como septiembre) ─────────────
    const rdDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santo_Domingo',
    }).format(now); // "YYYY-MM-DD"
    const [rdY, rdM, rdD] = rdDate.split('-').map(Number);

    // ── Regla: NO generar antes del día 25 (generation_day) del mes ─────────
    // Mientras tanto el padre no ve ningún cobro nuevo. x-force-run lo omite.
    if (!forceRun && rdD < generationDay) {
      return json({
        ok: true,
        skipped: true,
        reason: `Hoy es día ${rdD} (RD): los cobros se generan a partir del día ${generationDay}.`,
        ran_at: now.toISOString(),
      });
    }

    // ── Estudiantes activos con cuota ────────────────────────────────────────
    const { data: students, error: sErr } = await supabase
      .from('students')
      .select('id, name, monthly_fee, start_date')
      .eq('is_active', true)
      .gt('monthly_fee', 0);
    if (sErr) return json({ error: sErr.message }, 500);
    if (!students?.length) return json({ ok: true, generated: 0, message: 'No active students with fee' });

    // ── Determinar qué meses necesitan cobros ────────────────────────────────
    // SOLO el mes actual. Sin backfill: los cobros de meses anteriores se
    // registran manualmente desde el panel para no cobrar a estudiantes que
    // aún no estaban inscritos.
    const monthKey = `${rdY}-${String(rdM).padStart(2, '0')}`;
    const monthsToProcess: string[] = [monthKey];

    console.log('[auto-payment-cycle] Processing months:', monthsToProcess);

    // Último día del mes en proceso (para comparar con la fecha de inscripción)
    const lastDayOfMonth = new Date(rdY, rdM, 0)
      .toISOString().split('T')[0];

    let totalGenerated = 0;
    const results: Record<string, number> = {};

    for (const monthKey of monthsToProcess) {
      const [yr, mo] = monthKey.split('-').map(Number);

      // due_date = día 5 del mes siguiente
      const dueMonth = mo > 11 ? 1 : mo + 1;
      const dueYear  = mo > 11 ? yr + 1 : yr;
      const dueDate  = `${dueYear}-${String(dueMonth).padStart(2,'0')}-${String(dueDay).padStart(2,'0')}`;

      // Estudiantes que YA tienen cobro en este mes
      const { data: existing } = await supabase
        .from('payments')
        .select('student_id')
        .or(`month_paid.eq.${monthKey},month_paid.eq.${monthKey.replace('-0','-').replace(/^(\d{4})-(\d)$/,'$1-0$2')}`)
        .not('status', 'eq', 'deleted');

      const existingIds = new Set((existing || []).map((p: { student_id: string }) => String(p.student_id)));

      // Solo estudiantes inscritos a más tardar el último día del mes:
      // evita cobrar a quienes ingresan después o aún no ingresan.
      const missing = students.filter(s =>
        !existingIds.has(String(s.id)) &&
        (!s.start_date || s.start_date <= lastDayOfMonth)
      );

      if (!missing.length) {
        console.log(`[auto-payment-cycle] ${monthKey}: all students covered`);
        results[monthKey] = 0;
        continue;
      }

      const inserts = missing.map(s => ({
        student_id: s.id,
        amount:     s.monthly_fee,
        status:     'pending',
        due_date:   dueDate,
        month_paid: monthKey,
        concept:    'Mensualidad',
        created_at: new Date().toISOString(),
      }));

      const { error: insErr } = await supabase.from('payments').insert(inserts);
      if (insErr) {
        console.error(`[auto-payment-cycle] Insert error for ${monthKey}:`, insErr.message);
        results[monthKey] = -1;
        continue;
      }

      console.log(`[auto-payment-cycle] ${monthKey}: generated ${missing.length} payments`);
      results[monthKey] = missing.length;
      totalGenerated += missing.length;
    }

    // ── Marcar vencidos ──────────────────────────────────────────────────────
    await supabase.from('payments')
      .update({ status: 'overdue' })
      .eq('status', 'pending')
      .lt('due_date', rdDate);

    console.log(`[auto-payment-cycle] ✅ Total generated: ${totalGenerated}`);

    return json({
      ok:        true,
      generated: totalGenerated,
      by_month:  results,
      ran_at:    now.toISOString(),
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[auto-payment-cycle] Fatal:', msg);
    return json({ error: msg }, 500);
  }
});
