/**
 * 📅 payment-reminders — Edge Function
 * Envía recordatorios push automáticos según el estado del pago.
 * Llamar con cron o manualmente desde el panel.
 *
 * Lógica:
 *  - 3 días antes del vencimiento → recordatorio preventivo
 *  - Día del vencimiento          → último aviso
 *  - 1 día después                → aviso de mora
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing env vars' }, 500);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const pushKey  = ANON_KEY || SERVICE_KEY;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const d3 = new Date(today); d3.setDate(d3.getDate() + 3);
    const d1 = new Date(today); d1.setDate(d1.getDate() - 1);

    const fmt = (d: Date) => d.toISOString().split('T')[0];

    // Traer pagos pendientes con due_date relevante
    const { data: payments } = await supabase
      .from('payments')
      .select('id, amount, month_paid, due_date, students:student_id(name, parent_id)')
      .in('status', ['pending', 'pendiente'])
      .in('due_date', [fmt(d3), fmt(today), fmt(d1)]);

    const results: Record<string, number> = { reminder_3d: 0, due_today: 0, overdue_1d: 0 };

    const sendPush = (user_id: string, title: string, message: string) =>
      fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pushKey}` },
        body: JSON.stringify({ user_id, title, message, type: 'payment', link: 'panel_padres.html' })
      });

    for (const p of payments ?? []) {
      const parentId = (p.students as { parent_id?: string })?.parent_id;
      const name     = (p.students as { name?: string })?.name || 'tu hijo/a';
      const month    = p.month_paid || 'la mensualidad';
      if (!parentId) continue;

      if (p.due_date === fmt(d3)) {
        await sendPush(parentId,
          `📅 Recordatorio de pago — ${month}`,
          `Hola, recuerda que el pago de ${name} vence en 3 días. ¡Paga a tiempo y evita recargos!`
        );
        results.reminder_3d++;
      } else if (p.due_date === fmt(today)) {
        await sendPush(parentId,
          `⏰ ¡Hoy vence tu pago! — ${month}`,
          `Hoy es el último día para pagar la mensualidad de ${name}. Envía tu comprobante antes de las 6:00 PM.`
        );
        results.due_today++;
      } else if (p.due_date === fmt(d1)) {
        // Marcar como vencido y notificar
        await supabase.from('payments').update({ status: 'overdue' }).eq('id', p.id);
        await sendPush(parentId,
          `⚠️ Pago vencido — ${month}`,
          `Tu pago de ${name} está vencido. Tienes 24h de gracia antes de aplicar el recargo por mora.`
        );
        results.overdue_1d++;
      }
    }

    console.log('[payment-reminders] Sent:', results);
    return json({ ok: true, ...results });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[payment-reminders] Fatal:', msg);
    return json({ error: msg }, 500);
  }
});
