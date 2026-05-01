/**
 * payment-reminders — Edge Function
 * Envía recordatorios de pago a padres con pagos pendientes/vencidos.
 * Se ejecuta desde el servidor — no depende del navegador del usuario.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.1.0";

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
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const RESEND_KEY    = Deno.env.get('RESEND_API_KEY')            ?? '';
    const FROM_EMAIL    = Deno.env.get('FROM_EMAIL')                ?? 'Karpus Kids <avisos@karpuskids.com>';

    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing env vars' }, 500);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const resend   = RESEND_KEY ? new Resend(RESEND_KEY) : null;

    // Get all pending/overdue payments with parent info
    const { data: payments, error } = await supabase
      .from('payments')
      .select('id, amount, month_paid, due_date, status, students:student_id(name, parent_id, p1_email, p1_name)')
      .in('status', ['pending', 'overdue'])
      .not('students', 'is', null);

    if (error) return json({ error: error.message }, 500);

    let pushSent = 0, emailSent = 0, skipped = 0;

    for (const p of payments ?? []) {
      const student = p.students as { name: string; parent_id: string; p1_email: string; p1_name: string } | null;
      if (!student?.parent_id) { skipped++; continue; }

      const amt       = Number(p.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
      const isOverdue = p.status === 'overdue';
      const title     = isOverdue
        ? `⚠️ Pago vencido — ${student.name}`
        : `💳 Recordatorio de pago — ${student.name}`;
      const message   = isOverdue
        ? `El pago de RD$${amt} para ${p.month_paid || 'mensualidad'} está vencido.`
        : `Tu pago de RD$${amt} para ${p.month_paid || 'mensualidad'} vence pronto.`;

      // Push via send-push function
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ user_id: student.parent_id, title, message, type: 'payment', link: 'panel_padres.html' })
        });
        pushSent++;
      } catch (_) {}

      // Email via Resend
      if (resend && student.p1_email) {
        try {
          const color = isOverdue ? '#dc2626' : '#f97316';
          await resend.emails.send({
            from: FROM_EMAIL,
            to:   student.p1_email,
            subject: title,
            html: `<div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:20px;">
              <div style="background:${color};padding:20px;border-radius:12px 12px 0 0;text-align:center;">
                <h2 style="color:white;margin:0;">${isOverdue ? '⚠️ Pago Vencido' : '💳 Recordatorio'}</h2>
              </div>
              <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:24px;">
                <p>Hola <strong>${student.p1_name || 'Padre/Madre'}</strong>,</p>
                <p>${message}</p>
                <div style="background:#f9fafb;border-radius:8px;padding:16px;margin:16px 0;">
                  <p style="margin:0;"><strong>Estudiante:</strong> ${student.name}</p>
                  <p style="margin:8px 0 0;"><strong>Monto:</strong> RD$${amt}</p>
                  <p style="margin:8px 0 0;"><strong>Mes:</strong> ${p.month_paid || '—'}</p>
                </div>
                <a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;background:${color};color:white;padding:12px 24px;border-radius:8px;font-weight:bold;text-decoration:none;">Ver mi Panel →</a>
              </div>
            </div>`
          });
          emailSent++;
        } catch (_) {}
      }
    }

    return json({ ok: true, push_sent: pushSent, emails_sent: emailSent, skipped, total: (payments ?? []).length });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
