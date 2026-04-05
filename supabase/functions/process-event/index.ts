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

    // ── Plantilla base de email con logo Karpus Kids ──────────────────────────
    const LOGO_URL = 'https://karpuskids.com/img/mundo.jpg';
    const emailHeader = `<div style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:24px;text-align:center;border-radius:12px 12px 0 0"><img src="${LOGO_URL}" alt="Karpus Kids" style="width:64px;height:64px;border-radius:50%;border:3px solid rgba(255,255,255,0.4);object-fit:cover;margin:0 auto 10px;display:block"><h1 style="margin:0;color:white;font-family:sans-serif;font-size:20px;font-weight:800">Karpus Kids</h1><p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-family:sans-serif;font-size:12px;text-transform:uppercase;letter-spacing:1px">Centro Educativo</p></div>`;
    const emailFooter = `<div style="padding:16px;text-align:center;background:#f9fafb;border-radius:0 0 12px 12px;border-top:1px solid #e5e7eb"><p style="margin:0;font-size:11px;color:#9ca3af;font-family:sans-serif">Karpus Kids · Correo automático, por favor no respondas.</p></div>`;
    const emailWrap = (content: string) => `<div style="font-family:sans-serif;max-width:600px;margin:32px auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #e5e7eb">${emailHeader}<div style="padding:24px;background:#ffffff">${content}</div>${emailFooter}</div>`;

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
              html: emailWrap(`<h2 style="color:#6366f1;margin:0 0 12px">📚 Nueva Tarea Asignada</h2><p style="color:#374151">Hola <b>${s.p1_name || 'familia'}</b>,</p><p style="color:#374151">Se asignó la tarea <b>"${title}"</b>.</p><div style="background:#f5f3ff;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:4px solid #6366f1"><p style="margin:0;color:#4338ca;font-weight:700">📅 Fecha de entrega: ${due_date}</p></div><a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;padding:12px 24px;background:#6366f1;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Ver Tarea →</a>`)
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
              html: emailWrap(`<h2 style="color:#f97316;margin:0 0 12px">📢 Nueva Publicación</h2><p style="color:#374151">Hola <b>${s.p1_name || 'familia'}</b>,</p><p style="color:#374151"><b>${teacher_name || 'La maestra'}</b> publicó algo nuevo en el muro del aula.</p><a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;padding:12px 24px;background:#f97316;color:white;text-decoration:none;border-radius:8px;font-weight:bold;margin-top:8px">Ver Publicación →</a>`)
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

        // Si no viene parent_email en el payload, buscarlo en la DB
        let resolvedEmail = parent_email;
        let resolvedParentId = parent_id;

        if ((!resolvedEmail || !resolvedParentId) && payment_id) {
          const { data: payData } = await supabase
            .from('payments')
            .select('students:student_id(p1_email, parent_id, p1_name)')
            .eq('id', payment_id)
            .single();
          const st = payData?.students as { p1_email?: string; parent_id?: string } | null;
          if (!resolvedEmail)    resolvedEmail    = st?.p1_email;
          if (!resolvedParentId) resolvedParentId = st?.parent_id;
        }

        if (resend && resolvedEmail) {
          tasks.push(resend.emails.send({
            from: FROM_EMAIL,
            to:   resolvedEmail,
            subject: `✅ Pago Confirmado — ${month}`,
            html: emailWrap(`<h2 style="color:#16a34a;margin:0 0 12px">✅ ¡Pago Confirmado!</h2><p style="color:#374151">El pago de mensualidad de <b>${student_name}</b> fue aprobado.</p><div style="background:#f0fdf4;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #bbf7d0"><table style="width:100%;border-collapse:collapse;font-size:14px"><tr><td style="padding:6px 0;color:#6b7280">Estudiante:</td><td style="padding:6px 0;font-weight:700;text-align:right">${student_name}</td></tr><tr><td style="padding:6px 0;color:#6b7280">Mes:</td><td style="padding:6px 0;font-weight:700;text-align:right">${month}</td></tr><tr><td style="padding:6px 0;color:#6b7280">Monto:</td><td style="padding:6px 0;font-weight:800;color:#16a34a;font-size:16px;text-align:right">${amount}</td></tr>${payment_id ? `<tr><td style="padding:6px 0;color:#6b7280">Ref:</td><td style="padding:6px 0;font-size:11px;color:#9ca3af;text-align:right">${payment_id}</td></tr>` : ''}</table></div><a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;padding:12px 24px;background:#16a34a;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Ver mi Panel →</a>`)
          }));
        }
        if (resolvedParentId) {
          tasks.push(sendPushToUser(
            resolvedParentId,
            '✅ Pago Confirmado',
            `Tu pago de ${amount} para ${month} fue aprobado.`,
            'payment',
            'panel_padres.html'
          ));
        }
        await Promise.allSettled(tasks);
        result = { sent: true, email_to: resolvedEmail || 'none', push_to: resolvedParentId || 'none' };
        break;
      }

      case 'incident.reported': {
        const { parent_email, student_name, severity, description } = data;
        if (resend && parent_email) {
          await resend.emails.send({
            from: FROM_EMAIL,
            to:   parent_email,
            subject: `⚠️ Reporte de Incidencia — ${student_name}`,
            html: emailWrap(`<h2 style="color:#dc2626;margin:0 0 12px">⚠️ Reporte de Incidencia</h2><p style="color:#374151">Se registró una incidencia para <b>${student_name}</b>.</p><div style="background:#fff1f2;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:4px solid #dc2626"><p style="margin:0 0 6px;color:#991b1b;font-weight:700">Gravedad: ${severity}</p><p style="margin:0;color:#374151">${description}</p></div><a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;padding:12px 24px;background:#dc2626;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Ver Detalles →</a>`)
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
            html: emailWrap(`<h2 style="color:${isEntry ? '#16a34a' : '#dc2626'};margin:0 0 12px">${isEntry ? '🟢 Entrada Registrada' : '🔴 Salida Registrada'}</h2><p style="color:#374151"><b>${student_name}</b> registró su ${isEntry ? 'entrada' : 'salida'} a las <b>${time}</b>.</p><a href="https://karpuskids.com/panel_padres.html" style="display:inline-block;padding:12px 24px;background:${isEntry ? '#16a34a' : '#dc2626'};color:white;text-decoration:none;border-radius:8px;font-weight:bold;margin-top:8px">Ver Asistencia →</a>`)
          });
        }
        result = { sent: true };
        break;
      }

      case 'payment.receipt_uploaded': {
        const { student_id, amount, month, student_name } = data;
        const { data: staff } = await supabase.from('profiles').select('email,name').in('role', ['directora', 'asistente']);
        const emails = (staff ?? []).map((s: { email: string }) => s.email).filter(Boolean) as string[];
        if (resend && emails.length) {
          await resend.emails.send({
            from: FROM_EMAIL, to: emails,
            subject: `💳 Nuevo comprobante — ${student_name || 'Estudiante'} · ${month}`,
            html: emailWrap(`<h2 style="color:#1d4ed8;margin:0 0 12px">?? Nuevo Comprobante</h2><p style="color:#374151">El padre/madre de <b>${student_name || "un estudiante"}</b> subi� un comprobante.</p><a href="https://karpuskids.com/panel_directora.html" style="display:inline-block;padding:12px 24px;background:#1d4ed8;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Revisar y Aprobar ?</a>`
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
