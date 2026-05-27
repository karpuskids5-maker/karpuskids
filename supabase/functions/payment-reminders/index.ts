/**
 * 💳 payment-reminders — Edge Function
 * Envía correos de mora a padres con pagos vencidos.
 * Regla: Solo envía si han pasado ≥3 días desde el último recordatorio
 *        (o si nunca se ha enviado). Usa la columna `last_reminder_sent`
 *        en la tabla payments (si existe) o simplemente filtra por
 *        due_date para evitar spam.
 *
 * Invocación manual: POST /functions/v1/payment-reminders {}
 * Invocación automática: Supabase Cron (cada día a las 8am)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.1.0";

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

// Calcula mora: RD$50/día, cada 7 días = bloque de RD$500
function calcMora(dueDateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due   = new Date(dueDateStr + 'T00:00:00');
  const daysLate = Math.floor((today.getTime() - due.getTime()) / 86400000);
  if (daysLate <= 0) return 0;
  const blocks = Math.floor(daysLate / 7);
  const rem    = daysLate % 7;
  return (blocks * 500) + (rem * 50);
}

function formatCurrency(n: number): string {
  return 'RD$' + n.toLocaleString('es-DO', { minimumFractionDigits: 2 });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const RESEND_KEY   = Deno.env.get('RESEND_API_KEY')            ?? '';
    const FROM_EMAIL   = Deno.env.get('FROM_EMAIL')                ?? 'Karpus Kids <avisos@karpuskids.com>';

    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing env vars' }, 500);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const resend   = RESEND_KEY ? new Resend(RESEND_KEY) : null;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Fecha límite: solo enviar si el último recordatorio fue hace ≥3 días
    const reminderCutoff = new Date(today);
    reminderCutoff.setDate(reminderCutoff.getDate() - 3);
    const cutoffStr = reminderCutoff.toISOString();

    // Fecha para recordatorio anticipado (vence en ≤3 días)
    const in3days = new Date(today);
    in3days.setDate(in3days.getDate() + 3);
    const in3daysStr = in3days.toISOString().split('T')[0];

    // Obtener pagos pendientes/vencidos con datos del estudiante y padre
    // Incluye: overdue, pending con due_date ya pasada, y pending que vencen en ≤3 días
    const { data: allPayments, error } = await supabase
      .from('payments')
      .select(`
        id, student_id, amount, concept, due_date, month_paid, status,
        last_reminder_sent,
        students:student_id (
          name, p1_email, p1_name, p2_email, p2_name, parent_id,
          classrooms:classroom_id ( name )
        )
      `)
      .in('status', ['overdue', 'pending'])
      .lte('due_date', in3daysStr)
      .or(`last_reminder_sent.is.null,last_reminder_sent.lt.${cutoffStr}`);

    if (error) {
      // Si last_reminder_sent no existe, hacer query sin ese filtro
      console.warn('[payment-reminders] last_reminder_sent column may not exist, retrying without it');
      const { data: fallback, error: err2 } = await supabase
        .from('payments')
        .select(`
          id, student_id, amount, concept, due_date, month_paid, status,
          students:student_id (
            name, p1_email, p1_name, p2_email, p2_name, parent_id,
            classrooms:classroom_id ( name )
          )
        `)
        .in('status', ['overdue', 'pending'])
        .lte('due_date', in3daysStr);

      if (err2) return json({ error: err2.message }, 500);

      return await processReminders(supabase, resend, FROM_EMAIL, fallback ?? [], false);
    }

    return await processReminders(supabase, resend, FROM_EMAIL, allPayments ?? [], true);

  } catch (e) {
    console.error('[payment-reminders] fatal:', e);
    return json({ error: String(e) }, 500);
  }
});

async function processReminders(
  supabase: ReturnType<typeof createClient>,
  resend: InstanceType<typeof Resend> | null,
  fromEmail: string,
  payments: Record<string, unknown>[],
  updateTimestamp: boolean
): Promise<Response> {
  const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  let emailsSent = 0;
  let pushesSent = 0;
  const errors: string[] = [];

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const sendPush = async (userId: string, title: string, message: string) => {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'apikey': SERVICE_KEY,
        },
        body: JSON.stringify({ user_id: userId, title, message, type: 'payment', link: 'panel_padres.html' }),
      });
      pushesSent++;
    } catch (_) {}
  };

  for (const p of payments) {
    const student = (p.students as Record<string, unknown>) ?? {};
    const studentName = (student.name as string) ?? 'Estudiante';
    const classroom   = ((student.classrooms as Record<string, unknown>)?.name as string) ?? '';
    const dueDate     = p.due_date as string;
    const amount      = Number(p.amount ?? 0);
    const monthPaid   = (p.month_paid as string) ?? '';
    const parentId    = student.parent_id as string;

    // Calcular mora acumulada
    const mora      = calcMora(dueDate);
    const totalDue  = amount + mora;
    const today     = new Date(); today.setHours(0, 0, 0, 0);
    const daysLate  = Math.floor((today.getTime() - new Date(dueDate + 'T00:00:00').getTime()) / 86400000);

    const dueDateFmt = new Date(dueDate + 'T00:00:00').toLocaleDateString('es-DO', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    // Construir correo HTML
    const moraRow = mora > 0
      ? `<tr style="background:#fff1f2;">
           <td style="padding:10px 16px;color:#be123c;font-weight:700;border-bottom:1px solid #fecdd3;">Mora acumulada (${daysLate} días)</td>
           <td style="padding:10px 16px;text-align:right;color:#be123c;font-weight:800;border-bottom:1px solid #fecdd3;">${formatCurrency(mora)}</td>
         </tr>`
      : '';

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<div style="max-width:580px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <!-- Header rojo urgente -->
  <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:28px 32px;text-align:center;">
    <div style="font-size:40px;margin-bottom:8px;">🚨</div>
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">Pago Vencido</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Karpus Kids — Aviso de Mora</p>
  </div>

  <!-- Cuerpo -->
  <div style="padding:28px 32px;">
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
      Estimada familia de <strong>${studentName}</strong>,<br>
      le informamos que tiene un pago <strong style="color:#dc2626;">vencido hace ${daysLate} día${daysLate !== 1 ? 's' : ''}</strong>.
      La mora se incrementa <strong>RD$50 por día</strong> hasta completar bloques de RD$500 cada 7 días.
    </p>

    <!-- Tabla de desglose -->
    <div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:10px 16px;text-align:left;color:#6b7280;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Concepto</th>
            <th style="padding:10px 16px;text-align:right;color:#6b7280;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Monto</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:10px 16px;color:#374151;border-bottom:1px solid #e5e7eb;">Mensualidad — ${monthPaid}</td>
            <td style="padding:10px 16px;text-align:right;color:#374151;font-weight:700;border-bottom:1px solid #e5e7eb;">${formatCurrency(amount)}</td>
          </tr>
          ${moraRow}
          <tr style="background:#fef2f2;">
            <td style="padding:12px 16px;color:#991b1b;font-weight:800;font-size:15px;">TOTAL A PAGAR</td>
            <td style="padding:12px 16px;text-align:right;color:#991b1b;font-weight:900;font-size:18px;">${formatCurrency(totalDue)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Info adicional -->
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;color:#92400e;font-size:13px;line-height:1.5;">
        📅 <strong>Fecha de vencimiento original:</strong> ${dueDateFmt}<br>
        📈 <strong>Mora:</strong> RD$50/día · RD$500 por semana<br>
        🏫 <strong>Aula:</strong> ${classroom || 'Sin aula asignada'}
      </p>
    </div>

    <!-- CTA -->
    <div style="text-align:center;">
      <a href="https://karpuskids.com/panel_padres.html"
         style="display:inline-block;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;padding:14px 32px;border-radius:10px;font-weight:800;font-size:15px;text-decoration:none;box-shadow:0 4px 12px rgba(220,38,38,0.35);">
        Pagar Ahora →
      </a>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#f9fafb;border-top:1px solid #f0f0f0;padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9ca3af;">Karpus Kids · San Cristóbal, República Dominicana · Correo automático, por favor no respondas.</p>
  </div>
</div>
</body></html>`;

    // Recopilar emails del padre
    const emailTargets = [student.p1_email as string, student.p2_email as string]
      .filter(e => e && typeof e === 'string' && e.includes('@'));

    // Enviar correo
    if (resend && emailTargets.length > 0) {
      try {
        await resend.emails.send({
          from:    fromEmail,
          to:      emailTargets,
          subject: `🚨 Pago Vencido — ${studentName} · Mora: ${formatCurrency(mora)}`,
          html,
        });
        emailsSent++;
      } catch (emailErr) {
        errors.push(`Email error for ${studentName}: ${String(emailErr)}`);
      }
    }

    // Enviar push al padre
    if (parentId) {
      await sendPush(
        parentId,
        `🚨 Pago vencido — ${studentName}`,
        `Mora acumulada: ${formatCurrency(mora)}. Total a pagar: ${formatCurrency(totalDue)}`
      );
    }

    // Actualizar last_reminder_sent si la columna existe
    if (updateTimestamp) {
      try {
        await supabase
          .from('payments')
          .update({ last_reminder_sent: new Date().toISOString() })
          .eq('id', p.id as string);
      } catch (_) {}
    }
  }

  console.log(`[payment-reminders] done: ${emailsSent} emails, ${pushesSent} pushes, ${errors.length} errors`);

  // Clasificar para el frontend (reminder_3d = vence en ≤3 días, overdue_1d = ya vencidos)
  const today2 = new Date(); today2.setHours(0, 0, 0, 0);
  let reminder3d = 0, dueToday = 0, overdue1d = 0;
  for (const p of payments) {
    const due = new Date((p.due_date as string) + 'T00:00:00');
    const diff = Math.floor((due.getTime() - today2.getTime()) / 86400000);
    if (diff < 0)      overdue1d++;
    else if (diff === 0) dueToday++;
    else                 reminder3d++;
  }

  return new Response(
    JSON.stringify({
      processed:    payments.length,
      reminder_3d:  reminder3d,
      due_today:    dueToday,
      overdue_1d:   overdue1d,
      emails_sent:  emailsSent,
      pushes_sent:  pushesSent,
      errors: errors.length > 0 ? errors : undefined,
    }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
}
