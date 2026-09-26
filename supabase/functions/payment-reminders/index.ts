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
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

const ALLOWED_ROLES = ['admin', 'directora', 'asistente'];

const json = (data: unknown, status = 200, req?: Request) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });

// ── Fecha en zona horaria de República Dominicana ─────────────────────────────
// Edge Functions corren en UTC. Sin esto, a las 8pm RD el "mes actual" ya es
// el siguiente y los correos dicen "vence mañana" cuando hoy vence.
const RD_TZ = 'America/Santo_Domingo';
const rdDateStr = (d: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: RD_TZ }).format(d); // "YYYY-MM-DD"

// Calcula mora: RD$50/día, cada 7 días = bloque de RD$500
function calcMora(dueDateStr: string, today: Date): number {
  const due   = new Date(dueDateStr + 'T00:00:00Z');
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  try {
    // ── Auth verification ──────────────────────────────────────────────────
    const auth = await verifyAuth(req, ALLOWED_ROLES);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status || 401, req);
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const RESEND_KEY   = Deno.env.get('RESEND_API_KEY')            ?? '';
    const FROM_EMAIL   = Deno.env.get('FROM_EMAIL')                ?? 'Karpus Kids <avisos@karpuskids.com>';

    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing env vars' }, 500, req);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const resend   = RESEND_KEY ? new Resend(RESEND_KEY) : null;

    const body = await req.json().catch(() => ({}));
    // manual = invocación manual desde el panel (envía a TODOS los pendientes del mes)
    // auto   = cron diario (solo vencidos o que vencen en ≤3 días)
    const isManual = body?.action === 'send_all' || body?.manual === true;

    // Todo el cálculo de fechas usa RD, no la zona del servidor (UTC).
    const todayStr = rdDateStr();
    const today     = new Date(todayStr + 'T00:00:00Z');
    const currentMonthKey = todayStr.slice(0, 7); // "YYYY-MM"

    // Cutoff anti-spam: no reenviar si ya se mandó hace <3 días (solo en modo auto)
    const reminderCutoff = new Date(today.getTime() - 3 * 86400000);
    const cutoffStr = reminderCutoff.toISOString();

    // Fecha para recordatorio anticipado en modo auto (vence en ≤3 días)
    const in3daysStr = rdDateStr(new Date(today.getTime() + 3 * 86400000));

    // `payments` usa borrado lógico: sin esto se avisa por pagos ya eliminados.
    const ALIVE = <T>(q: T) => q.is('deleted_at', null);

    const SELECT_FIELDS = `
      id, student_id, amount, concept, due_date, month_paid, status,
      last_reminder_sent,
      students:student_id (
        name, p1_email, p1_name, p2_email, p2_name, parent_id,
        classrooms:classroom_id ( name )
      )
    `;

    let allPayments: Record<string, unknown>[] = [];
    // El timestamp anti-spam se actualiza SIEMPRE en modo auto, incluso si el
    // filtro por last_reminder_sent no se pudo aplicar. Antes, un fallo del
    // filtro reenviaba a todos los morosos cada día sin registrar nada.
    let updateTimestamp = false;

    if (isManual) {
      // ── MODO MANUAL: todos los pending/overdue del mes actual ──────────────
      console.log('[payment-reminders] MANUAL mode — fetching all pending for', currentMonthKey);

      // Intento 1: filtrar por month_paid exacto
      const { data: byMonth, error: e1 } = await ALIVE(
        supabase
          .from('payments')
          .select(SELECT_FIELDS)
          .in('status', ['overdue', 'pending'])
          .eq('month_paid', currentMonthKey)
      );

      if (!e1 && byMonth?.length) {
        allPayments = byMonth;
      } else {
        // Intento 2: fallback por due_date dentro del mes actual
        const monthStart = `${currentMonthKey}-01`;
        const monthEnd   = `${currentMonthKey}-31`;
        const { data: byDate, error: e2 } = await ALIVE(
          supabase
            .from('payments')
            .select(SELECT_FIELDS)
            .in('status', ['overdue', 'pending'])
            .gte('due_date', monthStart)
            .lte('due_date', monthEnd)
        );

        if (e2) return json({ error: e2.message }, 500, req);
        allPayments = byDate ?? [];
      }
      updateTimestamp = false; // manual no actualiza last_reminder_sent para no bloquear reenvíos

    } else {
      // ── MODO AUTO (cron): solo vencidos o que vencen en ≤3 días ───────────
      console.log('[payment-reminders] AUTO mode — fetching due/overdue up to', in3daysStr);
      updateTimestamp = true;

      // PostgREST exige comillas en valores con ':' dentro de .or(), si no el
      // filtro revienta y se caía al fallback sin anti-spam (spam diario).
      const { data, error } = await ALIVE(
        supabase
          .from('payments')
          .select(SELECT_FIELDS)
          .in('status', ['overdue', 'pending'])
          .lte('due_date', in3daysStr)
          .or(`last_reminder_sent.is.null,last_reminder_sent.lt."${cutoffStr}"`)
      );

      if (error) {
        // Solo si la columna no existe: se reintenta sin el filtro, pero el
        // timestamp se sigue escribiendo para no repetir en el siguiente cron.
        console.warn('[payment-reminders] Filter on last_reminder_sent failed, retrying without it:', error.message);
        const { data: fallback, error: err2 } = await ALIVE(
          supabase
            .from('payments')
            .select(SELECT_FIELDS)
            .in('status', ['overdue', 'pending'])
            .lte('due_date', in3daysStr)
        );

        if (err2) return json({ error: err2.message }, 500, req);
        allPayments = fallback ?? [];
      } else {
        allPayments = data ?? [];
      }
    }

    console.log(`[payment-reminders] Found ${allPayments.length} payments to remind`);
    return await processReminders(supabase, resend, FROM_EMAIL, allPayments, updateTimestamp, today, req);

  } catch (e) {
    console.error('[payment-reminders] fatal:', e);
    return json({ error: String(e) }, 500, req);
  }
});

async function processReminders(
  supabase: ReturnType<typeof createClient>,
  resend: InstanceType<typeof Resend> | null,
  fromEmail: string,
  payments: Record<string, unknown>[],
  updateTimestamp: boolean,
  today: Date,
  req?: Request
): Promise<Response> {
  const CORS = getCorsHeaders(req);

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
    const student     = (p.students as Record<string, unknown>) ?? {};
    const studentName = (student.name as string) ?? 'Estudiante';
    const classroom   = ((student.classrooms as Record<string, unknown>)?.name as string) ?? '';
    const dueDate     = p.due_date as string;
    const amount      = Number(p.amount ?? 0);
    const monthPaid   = (p.month_paid as string) ?? '';
    // El concepto real del cobro: antes todo se rotulaba "Mensualidad",
    // incluidos cargos de "Dia Prolongado" u otros.
    const concept     = ((p.concept as string) || 'Mensualidad');
    const conceptLabel = concept + (monthPaid ? ` — ${monthPaid}` : '');
    const parentId    = student.parent_id as string;

    if (!dueDate) {
      errors.push(`Sin due_date en el pago ${String(p.id)}`);
      continue;
    }

    const dueDateObj = new Date(dueDate + 'T00:00:00Z');
    // daysUntilDue > 0 = aún no vence | = 0 vence hoy | < 0 = ya venció
    const daysUntilDue = Math.floor((dueDateObj.getTime() - today.getTime()) / 86400000);
    const isOverdue    = daysUntilDue < 0;
    const daysLate     = isOverdue ? Math.abs(daysUntilDue) : 0;
    const mora         = isOverdue ? calcMora(dueDate, today) : 0;
    const totalDue     = amount + mora;

    const dueDateFmt = dueDateObj.toLocaleDateString('es-DO', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    // ── Construir email según estado ──────────────────────────────────────────
    let html: string;
    let subject: string;
    let pushTitle: string;
    let pushMsg: string;

    if (isOverdue) {
      // ── PAGO VENCIDO: aviso de mora ──────────────────────────────────────
      const moraRow = mora > 0
        ? `<tr style="background:#fff1f2;">
             <td style="padding:10px 16px;color:#be123c;font-weight:700;border-bottom:1px solid #fecdd3;">Mora acumulada (${daysLate} día${daysLate !== 1 ? 's' : ''} de retraso)</td>
             <td style="padding:10px 16px;text-align:right;color:#be123c;font-weight:800;border-bottom:1px solid #fecdd3;">${formatCurrency(mora)}</td>
           </tr>`
        : '';

      subject   = `🚨 Pago Vencido — ${studentName} · ${daysLate} día${daysLate !== 1 ? 's' : ''} de retraso`;
      pushTitle = `🚨 Pago vencido — ${studentName}`;
      pushMsg   = `Lleva ${daysLate} día${daysLate !== 1 ? 's' : ''} de retraso. Mora: ${formatCurrency(mora)}. Total: ${formatCurrency(totalDue)}`;

      html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<div style="max-width:580px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:28px 32px;text-align:center;">
    <div style="font-size:40px;margin-bottom:8px;">🚨</div>
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">Pago Vencido</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Karpus Kids — Aviso de Mora</p>
  </div>
  <div style="padding:28px 32px;">
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
      Estimada familia de <strong>${studentName}</strong>,<br>
      le informamos que su pago de <strong>${conceptLabel}</strong> lleva <strong style="color:#dc2626;">${daysLate} día${daysLate !== 1 ? 's' : ''} de retraso</strong>.
      La mora se incrementa <strong>RD$50 por día</strong> hasta completar bloques de RD$500 cada 7 días.
    </p>
    <div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="background:#f3f4f6;">
          <th style="padding:10px 16px;text-align:left;color:#6b7280;font-weight:700;font-size:11px;text-transform:uppercase;">Concepto</th>
          <th style="padding:10px 16px;text-align:right;color:#6b7280;font-weight:700;font-size:11px;text-transform:uppercase;">Monto</th>
        </tr></thead>
        <tbody>
          <tr><td style="padding:10px 16px;color:#374151;border-bottom:1px solid #e5e7eb;">${conceptLabel}</td><td style="padding:10px 16px;text-align:right;color:#374151;font-weight:700;border-bottom:1px solid #e5e7eb;">${formatCurrency(amount)}</td></tr>
          ${moraRow}
          <tr style="background:#fef2f2;"><td style="padding:12px 16px;color:#991b1b;font-weight:800;font-size:15px;">TOTAL A PAGAR</td><td style="padding:12px 16px;text-align:right;color:#991b1b;font-weight:900;font-size:18px;">${formatCurrency(totalDue)}</td></tr>
        </tbody>
      </table>
    </div>
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6;">
        📅 <strong>Venció el:</strong> ${dueDateFmt}<br>
        📈 <strong>Mora:</strong> RD$50/día · RD$500 por semana<br>
        🏫 <strong>Aula:</strong> ${classroom || 'Sin aula asignada'}
      </p>
    </div>
    <div style="text-align:center;">
      <a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;padding:14px 32px;border-radius:10px;font-weight:800;font-size:15px;text-decoration:none;box-shadow:0 4px 12px rgba(220,38,38,0.35);">Pagar Ahora →</a>
    </div>
  </div>
  <div style="background:#f9fafb;border-top:1px solid #f0f0f0;padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9ca3af;">Karpus Kids · San Cristóbal, República Dominicana · Correo automático, por favor no respondas.</p>
  </div>
</div>
</body></html>`;

    } else {
      // ── PAGO PENDIENTE: recordatorio amigable ────────────────────────────
      const daysLabel = daysUntilDue === 0
        ? 'vence <strong style="color:#d97706;">hoy</strong>'
        : `vence en <strong style="color:#2563eb;">${daysUntilDue} día${daysUntilDue !== 1 ? 's' : ''}</strong> (${dueDateFmt})`;

      subject   = daysUntilDue === 0
        ? `⏰ Tu pago vence HOY — ${studentName}`
        : `📅 Recordatorio de pago — ${studentName} · Vence el ${dueDateFmt}`;
      pushTitle = daysUntilDue === 0 ? `⏰ Pago vence hoy — ${studentName}` : `📅 Recordatorio — ${studentName}`;
      pushMsg   = `Tu ${conceptLabel} ${daysUntilDue === 0 ? 'vence hoy' : `vence el ${dueDateFmt}`}. Monto: ${formatCurrency(amount)}`;

      html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<div style="max-width:580px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:28px 32px;text-align:center;">
    <div style="font-size:40px;margin-bottom:8px;">📅</div>
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">Recordatorio de Pago</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Karpus Kids — Aviso de Mensualidad</p>
  </div>
  <div style="padding:28px 32px;">
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
      Estimada familia de <strong>${studentName}</strong>,<br>
      le recordamos que su pago de <strong>${conceptLabel}</strong> ${daysLabel}.
      Por favor realice su pago a tiempo para evitar cargos por mora.
    </p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;overflow:hidden;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="background:#dbeafe;">
          <th style="padding:10px 16px;text-align:left;color:#1e40af;font-weight:700;font-size:11px;text-transform:uppercase;">Concepto</th>
          <th style="padding:10px 16px;text-align:right;color:#1e40af;font-weight:700;font-size:11px;text-transform:uppercase;">Monto</th>
        </tr></thead>
        <tbody>
          <tr><td style="padding:10px 16px;color:#374151;border-bottom:1px solid #bfdbfe;">${conceptLabel}</td><td style="padding:10px 16px;text-align:right;color:#374151;font-weight:700;border-bottom:1px solid #bfdbfe;">${formatCurrency(amount)}</td></tr>
          <tr style="background:#dbeafe;"><td style="padding:12px 16px;color:#1e40af;font-weight:800;font-size:15px;">TOTAL A PAGAR</td><td style="padding:12px 16px;text-align:right;color:#1e40af;font-weight:900;font-size:18px;">${formatCurrency(amount)}</td></tr>
        </tbody>
      </table>
    </div>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;color:#166534;font-size:13px;line-height:1.6;">
        📅 <strong>Fecha límite de pago:</strong> ${dueDateFmt}<br>
        ⚠️ <strong>Importante:</strong> Después de esta fecha se aplicará mora de RD$50/día<br>
        🏫 <strong>Aula:</strong> ${classroom || 'Sin aula asignada'}
      </p>
    </div>
    <div style="text-align:center;">
      <a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;padding:14px 32px;border-radius:10px;font-weight:800;font-size:15px;text-decoration:none;box-shadow:0 4px 12px rgba(37,99,235,0.35);">Pagar Ahora →</a>
    </div>
  </div>
  <div style="background:#f9fafb;border-top:1px solid #f0f0f0;padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9ca3af;">Karpus Kids · San Cristóbal, República Dominicana · Correo automático, por favor no respondas.</p>
  </div>
</div>
</body></html>`;
    }

    // ── Enviar correo ─────────────────────────────────────────────────────────
    const emailTargets = [student.p1_email as string, student.p2_email as string]
      .filter(e => e && typeof e === 'string' && e.includes('@'));

    if (resend && emailTargets.length > 0) {
      // Resend v2 NO lanza en error: devuelve { data, error }. Sin mirarlo,
      // un envío fallido contaba como enviado y el panel reportaba éxito.
      const { data: sent, error: emailErr } = await resend.emails.send({
        from: fromEmail, to: emailTargets, subject, html
      });
      if (emailErr) {
        errors.push(`Email error for ${studentName}: ${emailErr.message}`);
      } else {
        emailsSent++;
        void sent;
      }
    }

    // ── Enviar push ───────────────────────────────────────────────────────────
    if (parentId) {
      await sendPush(parentId, pushTitle, pushMsg);
    }

    // ── Actualizar last_reminder_sent (solo modo auto) ────────────────────────
    if (updateTimestamp) {
      // Va fuera del try/catch: si el UPDATE falla hay que enterarse, o el
      // cron siguiente reenvía exactamente lo mismo.
      const { error: updErr } = await supabase
        .from('payments')
        .update({ last_reminder_sent: new Date().toISOString() })
        .eq('id', p.id as string);
      if (updErr) errors.push(`No se pudo marcar recordatorio ${String(p.id)}: ${updErr.message}`);
    }
  }

  console.log(`[payment-reminders] done: ${emailsSent} emails, ${pushesSent} pushes, ${errors.length} errors`);

  // Clasificar para el frontend. Usa la misma fecha RD del envío.
  let reminder3d = 0, dueToday = 0, overdue1d = 0;
  for (const p of payments) {
    if (!p.due_date) continue;
    const diff = Math.floor((new Date((p.due_date as string) + 'T00:00:00Z').getTime() - today.getTime()) / 86400000);
    if (diff < 0)                overdue1d++;
    else if (diff === 0)         dueToday++;
    else if (diff <= 3)         reminder3d++;
  }

  return new Response(
    JSON.stringify({
      processed:   payments.length,
      reminder_3d: reminder3d,
      due_today:   dueToday,
      overdue_1d:  overdue1d,
      emails_sent: emailsSent,
      pushes_sent: pushesSent,
      errors: errors.length > 0 ? errors : undefined,
    }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
}
