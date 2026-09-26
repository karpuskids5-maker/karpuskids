/**
 * auto-payment-cycle — Edge Function
 *
 * Disparador HTTP opcional del ciclo de pagos. La lógica vive ÚNICAMENTE en
 * la función SQL `public.run_payment_cycle()`; esta Edge Function es un wrapper
 * delgado que la invoca con la service role.
 *
 * Antes esta función reimplementaba el ciclo en TypeScript. Eso duplicaba la
 * lógica y divergía de la SQL en cuatro puntos:
 *   1) No filtraba por `concept`, así que un cargo de "Dia Prolongado" o similar
 *      del mismo mes hacía creer al estudiante que ya tenía "Mensualidad" y la
 *      mensualidad nunca se generaba.
 *   2) No aplicaba descuentos: insertaba `monthly_fee` crudo en vez de
 *      `get_monthly_fee_for(student_id)`.
 *   3) No generaba los cargos de "Dia Prolongado".
 *   4) El insert masivo no era idempotente: dos ejecuciones simultáneas (cron
 *      diario + corrida manual) hacían fallar el lote completo por violar el
 *      índice único (student_id, month_paid, concept).
 * La SQL ya resuelve todo con `ON CONFLICT DO NOTHING`, el filtro por concepto,
 * `deleted_at IS NULL` y el guard de rol.
 *
 * Reglas de negocio (las aplica la SQL, se documentan aquí):
 *   - Los cobros del mes M se generan a partir del día `generation_day` (25).
 *     Antes de esa fecha el padre NO ve ningún cobro nuevo.
 *   - NUNCA hay backfill de meses anteriores ni cobros de meses futuros: se
 *     respeta la `start_date` de cada estudiante.
 *
 * Cron recomendado: DIARIO a las 6am RD (10:00 UTC) — '0 10 * * *'.
 * Es idempotente y está blindado por `generation_day`.
 *
 * Uso:
 *   curl -X POST <url> -H "Authorization: Bearer <jwt>" -H "x-force-run: true"
 *   body opcional: { "force": true }
 */
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { getServiceClient } from "../_shared/auth.ts";

const ALLOWED_ROLES = ['admin', 'directora', 'asistente'];

const json = (data: unknown, status = 200, req?: Request) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  try {
    // ── Auth verification ──────────────────────────────────────────────────
    // Mismos roles que permite la propia función SQL.
    const auth = await verifyAuth(req, ALLOWED_ROLES);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status || 401, req);
    }

    const supabase = getServiceClient();

    const body = await req.json().catch(() => ({}));
    const forceRun = req.headers.get('x-force-run') === 'true' || body?.force === true;

    // ── Regla del día 25 (misma que la SQL, para responder sin escribir) ────
    // Antes de `generation_day` la SQL solo vencen cobros, no crea nuevos.
    const { data: settings } = await supabase
      .from('school_settings').select('generation_day, due_day').eq('id', 1).maybeSingle();
    const generationDay = settings?.generation_day ?? 25;

    const rdDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santo_Domingo',
    }).format(new Date()); // "YYYY-MM-DD"
    const rdDay = Number(rdDate.split('-')[2]);

    if (!forceRun && rdDay < generationDay) {
      return json({
        ok: true,
        skipped: true,
        reason: `Hoy es día ${rdDay} (RD): los cobros se generan a partir del día ${generationDay}.`,
        ran_at: new Date().toISOString(),
      });
    }

    // ── Ciclo: una sola fuente de verdad (SQL) ─────────────────────────────
    const { data, error } = await supabase.rpc('run_payment_cycle');
    if (error) {
      console.error('[auto-payment-cycle] run_payment_cycle:', error.message);
      return json({ error: error.message }, 500, req);
    }

    const result = (data ?? {}) as {
      generated?: number; expired?: number; month?: string;
      due_date?: string; generation_day?: number; skipped?: string | null;
    };

    console.log(
      `[auto-payment-cycle] ${result.month}: generated=${result.generated} expired=${result.expired}`
    );

    return json({
      ok: true,
      generated: result.generated ?? 0,
      expired: result.expired ?? 0,
      month: result.month ?? null,
      due_date: result.due_date ?? null,
      by_month: result.month ? { [result.month]: result.generated ?? 0 } : {},
      ran_at: new Date().toISOString(),
    }, 200, req);

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[auto-payment-cycle] Fatal:', msg);
    return json({ error: msg }, 500, req);
  }
});
