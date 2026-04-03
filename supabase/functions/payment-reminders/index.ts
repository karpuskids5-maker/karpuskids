/**
 * 📅 payment-reminders — Edge Function
 * Envía recordatorios de pago por PUSH y EMAIL.
 *
 * Disparadores:
 *  - 3 días antes del vencimiento → recordatorio preventivo
 *  - Día del vencimiento          → último aviso
 *  - 1 día después                → aviso de mora + marca overdue
 *
 * Cómo ejecutar automáticamente:
 *  Configura un cron en Supabase Dashboard → Database → Extensions → pg_cron
 *  O llama manualmente desde el panel de directora.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.1.0";

const CORS = {
  'Access-Control-Allow-Origin':  'https://karpuskids.com',
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
    const RESEND_KEY   = Deno.env.get('RESEND_API_KEY') ?? '';
    const FROM_EMAIL   = Deno.env.get('FROM_EMAIL') ?? 'Karpus Kids <avisos@karpuskids.com>';

    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing env vars' }, 500);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const resend   = RESEND_KEY ? new Resend(RESEND_KEY) : null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const d3 = new Date(today); d3.setDate(d3.getDate() + 3);
    const d1 = new Date(today); d1.setDate(d1.getDate() - 1);
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    // Traer pagos pendientes con datos del estudiante y correo de notificaciones
    const { data: payments, error: qErr } = await supabase
      .from('payments')
      .select(`
        id, amount, month_paid, due_date,
        students:student_id(
          name,
          parent_id,
          p1_email,
          p1_name
        )
      `)
      .in('status', ['pending', 'pendiente'])
      .in('due_date', [fmt(d3), fmt(today), fmt(d1)]);

    if (qErr) {
      console.error('[payment-reminders] Query error:', qErr.message);
      return json({ error: qErr.message }, 500);
    }

    const results = { reminder_3d: 0, due_today: 0, overdue_1d: 0, emails_sent: 0, pushes_sent: 0 };

    // Helper push
    const sendPushNotif = (user_id: string, title: string, message: string) =>
      fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ user_id, title, message, type: 'payment', link: 'panel_padres.html' })
      }).catch(e => console.warn('[payment-reminders] push error:', e));

    // Helper email
    const sendEmailNotif = async (to: string, subject: string, html: string) => {
      if (!resend || !to) return;
      try {
        const { error } = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
        if (error) console.warn('[payment-reminders] email error:', error.message);
        else results.emails_sent++;
      } catch (e) {
        console.warn('[payment-reminders] email exception:', e);
      }
    };

    for (const p of payments ?? []) {
      const student  = p.students as { name?: string; parent_id?: string; p1_email?: string; p1_name?: string } | null;
      const parentId = student?.parent_id;
      const email    = student?.p1_email;
      const name     = student?.name || 'tu hijo/a';
      const parentName = student?.p1_name || 'familia';
      const month    = p.month_paid || 'la mensualidad';
      const amount   = `$${Number(p.amount || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}`;

      if (!parentId && !email) continue;

      if (p.due_date === fmt(d3)) {
        // ── 3 días antes ──────────────────────────────────────────────────
        const title = `📅 Recordatorio de pago — ${month}`;
        const msg   = `Hola, recuerda que el pago de ${name} (${amount}) vence en 3 días. ¡Paga a tiempo y evita recargos!`;

        if (parentId) { await sendPushNotif(parentId, title, msg); results.pushes_sent++; }
        if (email) {
          await sendEmailNotif(email, title, `
            <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;background:#fffbeb;border-radius:12px;border:1px solid #fde68a">
              <h2 style="color:#d97706;margin:0 0 16px">📅 Recordatorio de Pago</h2>
              <p>Hola <b>${parentName}</b>,</p>
              <p>Te recordamos que el pago de mensualidad de <b>${name}</b> por <b>${amount}</b> vence en <b>3 días</b> (${p.due_date}).</p>
              <p style="color:#92400e;font-weight:bold">¡Paga a tiempo para evitar recargos por mora!</p>
              <a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#d97706;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Ir a mi Panel →</a>
              <p style="margin-top:24px;font-size:12px;color:#9ca3af">Karpus Kids · Correo automático</p>
            </div>`);
        }
        results.reminder_3d++;

      } else if (p.due_date === fmt(today)) {
        // ── Día del vencimiento ───────────────────────────────────────────
        const title = `⏰ ¡Hoy vence tu pago! — ${month}`;
        const msg   = `Hoy es el último día para pagar la mensualidad de ${name} (${amount}). Envía tu comprobante antes de las 6:00 PM.`;

        if (parentId) { await sendPushNotif(parentId, title, msg); results.pushes_sent++; }
        if (email) {
          await sendEmailNotif(email, title, `
            <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;background:#fff7ed;border-radius:12px;border:1px solid #fed7aa">
              <h2 style="color:#ea580c;margin:0 0 16px">⏰ ¡Último Día de Pago!</h2>
              <p>Hola <b>${parentName}</b>,</p>
              <p><b>Hoy es el último día</b> para pagar la mensualidad de <b>${name}</b> por <b>${amount}</b> sin recargo.</p>
              <p style="color:#9a3412;font-weight:bold">Envía tu comprobante antes de las 6:00 PM para evitar mora.</p>
              <a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#ea580c;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Enviar Comprobante →</a>
              <p style="margin-top:24px;font-size:12px;color:#9ca3af">Karpus Kids · Correo automático</p>
            </div>`);
        }
        results.due_today++;

      } else if (p.due_date === fmt(d1)) {
        // ── 1 día después (mora) ──────────────────────────────────────────
        // Marcar como vencido
        await supabase.from('payments').update({ status: 'overdue' }).eq('id', p.id);

        const title = `⚠️ Pago vencido — ${month}`;
        const msg   = `Tu pago de ${name} (${amount}) está vencido. Tienes 24h de gracia antes de aplicar el recargo por mora.`;

        if (parentId) { await sendPushNotif(parentId, title, msg); results.pushes_sent++; }
        if (email) {
          await sendEmailNotif(email, title, `
            <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;background:#fff1f2;border-radius:12px;border:1px solid #fecdd3">
              <h2 style="color:#dc2626;margin:0 0 16px">⚠️ Pago Vencido</h2>
              <p>Hola <b>${parentName}</b>,</p>
              <p>El pago de mensualidad de <b>${name}</b> por <b>${amount}</b> está <b>vencido</b>.</p>
              <p style="color:#991b1b;font-weight:bold">Tienes 24 horas de gracia antes de que se aplique el recargo por mora.</p>
              <p>Por favor realiza el pago lo antes posible para evitar cargos adicionales.</p>
              <a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#dc2626;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Pagar Ahora →</a>
              <p style="margin-top:24px;font-size:12px;color:#9ca3af">Karpus Kids · Correo automático</p>
            </div>`);
        }
        results.overdue_1d++;
      }
    }

    console.log('[payment-reminders] ✅ Results:', results);
    return json({ ok: true, ...results });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[payment-reminders] Fatal:', msg);
    return json({ error: msg }, 500);
  }
});
