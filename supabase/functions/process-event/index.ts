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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    // ✅ FIX: usar ANON_KEY para invocar otras Edge Functions (SERVICE_KEY causa 401)
    const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')         ?? '';
    const RESEND_KEY    = Deno.env.get('RESEND_API_KEY')            ?? '';
    const FROM_EMAIL    = Deno.env.get('FROM_EMAIL')                ?? 'Karpus Kids <avisos@karpuskids.com>';

    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing env vars' }, 500);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const resend   = RESEND_KEY ? new Resend(RESEND_KEY) : null;

    const { type, data } = await req.json();
    if (!type) return json({ error: 'Missing event type' }, 400);

    console.log('[process-event] type:', type, '| data keys:', Object.keys(data || {}));

    // Helper para enviar push usando la función send-push
    const sendPushToUser = async (user_id: string, title: string, message: string, pushType = 'info', link = 'panel_padres.html') => {
      try {
        // 🔥 FIX: Asegurar que se use la Service Key para llamadas entre funciones internas
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`, // Usar siempre SERVICE_KEY internamente
            'apikey': SERVICE_KEY
          },
          body: JSON.stringify({ user_id, title, message, type: pushType, link })
        });
        
        if (!res.ok) {
          const errText = await res.text();
          console.warn(`[process-event] send-push 401/error for ${user_id}:`, res.status, errText);
        }
        return res;
      } catch (e) {
        console.error(`[process-event] send-push exception for ${user_id}:`, e);
        return null;
      }
    };

    let result: Record<string, unknown> = {};

    switch (type) {

      case 'task.created': {
        const { classroom_id, title, due_date } = data;
        const { data: students } = await supabase
          .from('students')
          .select('p1_email, p1_name, parent_id')
          .eq('classroom_id', classroom_id);

        const emails: Promise<unknown>[] = [];
        const pushes: Promise<unknown>[] = [];

        for (const s of students ?? []) {
          if (resend && s.p1_email) {
            emails.push(resend.emails.send({
              from: FROM_EMAIL,
              to:   s.p1_email,
              subject: `📚 Nueva Tarea: ${title}`,
              html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px">
                <h2 style="color:#6366f1">Nueva Tarea Asignada 📝</h2>
                <p>Hola <b>${s.p1_name || 'familia'}</b>,</p>
                <p>Se asignó la tarea <b>"${title}"</b>. Fecha de entrega: <b>${due_date}</b>.</p>
                <a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;padding:12px 20px;background:#6366f1;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Ver Tarea</a>
              </div>`
            }));
          }
          if (s.parent_id) {
            pushes.push(sendPushToUser(
              s.parent_id,
              `📚 Nueva Tarea — ${title}`,
              `Entrega: ${due_date}`,
              'task',
              'panel_padres.html'
            ));
          }
        }

        await Promise.allSettled([...emails, ...pushes]);
        result = { sent_emails: emails.length, sent_pushes: pushes.length };
        break;
      }

      case 'post.created': {
        const { classroom_id, teacher_name, content_preview } = data;
        const { data: students } = await supabase
          .from('students')
          .select('p1_email, p1_name, parent_id')
          .eq('classroom_id', classroom_id);

        const pushes: Promise<unknown>[] = [];
        const emails: Promise<unknown>[] = [];

        for (const s of students ?? []) {
          if (s.parent_id) {
            pushes.push(sendPushToUser(
              s.parent_id,
              '📢 Nueva publicación en el muro',
              `${teacher_name || 'La maestra'} publicó: "${(content_preview || '').slice(0, 60)}"`,
              'post',
              'panel_padres.html'
            ));
          }
          if (resend && s.p1_email) {
            emails.push(resend.emails.send({
              from: FROM_EMAIL,
              to:   s.p1_email,
              subject: '📢 Nueva publicación en el muro de Karpus Kids',
              html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px">
                <h2 style="color:#f97316">Nueva Publicación 📢</h2>
                <p>Hola <b>${s.p1_name || 'familia'}</b>,</p>
                <p>${teacher_name || 'La maestra'} publicó algo nuevo en el muro del aula.</p>
                <a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;padding:12px 20px;background:#f97316;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Ver Publicación</a>
              </div>`
            }));
          }
        }

        await Promise.allSettled([...pushes, ...emails]);
        result = { sent_pushes: pushes.length, sent_emails: emails.length };
        break;
      }

      case 'attendance.marked': {
        const { parent_id, student_name, status } = data;
        if (parent_id) {
          const emoji = status === 'present' ? '🟢' : status === 'absent' ? '🔴' : '🟡';
          const label = status === 'present' ? 'Presente' : status === 'absent' ? 'Ausente' : 'Tardanza';
          await sendPushToUser(
            parent_id,
            `${emoji} Asistencia — ${student_name}`,
            `${student_name} fue marcado como ${label} hoy.`,
            'attendance',
            'panel_padres.html'
          );
        }
        result = { sent: !!parent_id };
        break;
      }

      case 'payment.approved': {
        const { parent_email, parent_id, student_name, amount, month, payment_id } = data;
        const tasks: Promise<unknown>[] = [];
        if (resend && parent_email) {
          tasks.push(resend.emails.send({
            from: FROM_EMAIL,
            to:   parent_email,
            subject: `✅ Pago Confirmado — ${month}`,
            html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px">
              <h2 style="color:#16a34a">¡Pago Confirmado! ✅</h2>
              <p>El pago de <b>${amount}</b> para <b>${month}</b> del estudiante <b>${student_name}</b> fue aprobado.</p>
              <p><b>ID:</b> ${payment_id}</p>
              <a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;padding:12px 20px;background:#16a34a;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Ver Panel</a>
            </div>`
          }));
        }
        if (parent_id) {
          tasks.push(sendPushToUser(
            parent_id,
            '✅ Pago Confirmado',
            `Tu pago de ${amount} para ${month} fue aprobado.`,
            'payment',
            'panel_padres.html'
          ));
        }
        await Promise.allSettled(tasks);
        result = { sent: true };
        break;
      }

      case 'incident.reported': {
        const { parent_email, student_name, severity, description } = data;
        if (resend && parent_email) {
          await resend.emails.send({
            from: FROM_EMAIL,
            to:   parent_email,
            subject: `⚠️ Reporte de Incidencia — ${student_name}`,
            html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #fee2e2;border-radius:10px">
              <h2 style="color:#dc2626">Reporte de Incidencia ⚠️</h2>
              <p><b>Gravedad:</b> ${severity}</p>
              <p><b>Descripción:</b> ${description}</p>
            </div>`
          });
        }
        result = { sent: true };
        break;
      }

      case 'attendance.checkin':
      case 'attendance.checkout': {
        const { parent_email, student_name, time } = data;
        const isEntry = type === 'attendance.checkin';
        if (resend && parent_email) {
          await resend.emails.send({
            from: FROM_EMAIL,
            to:   parent_email,
            subject: `${isEntry ? '🟢 Entrada' : '🔴 Salida'}: ${student_name}`,
            html: `<p><b>${student_name}</b> registró su ${isEntry ? 'entrada' : 'salida'} a las <b>${time}</b>.</p>`
          });
        }
        result = { sent: true };
        break;
      }

      case 'payment.receipt_uploaded': {
        const { student_id, amount, month } = data;
        const { data: staff } = await supabase.from('profiles').select('email').in('role', ['directora', 'asistente']);
        const emails = (staff ?? []).map((s: { email: string }) => s.email).filter(Boolean) as string[];
        if (resend && emails.length) {
          await resend.emails.send({
            from: FROM_EMAIL, to: emails,
            subject: `💳 Nuevo comprobante subido — Estudiante ${student_id}`,
            html: `<p>Se subió un comprobante de <b>${amount}</b> para <b>${month}</b>. Revisa el panel para validar.</p>`
          });
        }
        result = { notified: emails.length };
        break;
      }

      default:
        console.warn('[process-event] Unhandled type:', type);
        result = { skipped: true, type };
    }

    return json({ ok: true, type, ...result });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[process-event] Fatal:', msg);
    return json({ error: msg }, 500);
  }
});
