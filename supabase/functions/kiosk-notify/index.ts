/**
 * 🚪 kiosk-notify — Edge Function
 * Envía notificaciones push + email cuando un estudiante marca entrada/salida
 * en el kiosco de asistencia (attendance-live.html).
 *
 * Seguridad:
 *   - Requiere header `X-Kiosk-Secret` == env KIOSK_SECRET (compartido con la
 *     DB via pg_net, NUNCA expuesto al navegador).
 *   - Rate limiting: máx 60 notificaciones por minuto (anti-abuso).
 *   - No acepta llamadas anónimas directas ni desde el navegador.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.1.0";
import { getCorsHeaders } from "../_shared/cors.ts";

const json = (data: unknown, status = 200, req?: Request) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  try {
    const KIOSK_SECRET = Deno.env.get('KIOSK_SECRET') ?? '';

    // ── Verificar secreto compartido ─────────────────────────────────────────
    const provided = req.headers.get('X-Kiosk-Secret') ?? (await req.clone().text().then(t => { try { return JSON.parse(t).secret ?? ''; } catch { return ''; } }));
    if (!KIOSK_SECRET || provided !== KIOSK_SECRET) {
      return json({ ok: false, error: 'No autorizado' }, 403, req);
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const RESEND_KEY   = Deno.env.get('RESEND_API_KEY')            ?? '';
    const FROM_EMAIL   = Deno.env.get('FROM_EMAIL')                ?? 'Karpus Kids <avisos@karpuskids.com>';
    const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')      ?? '';
    const ONESIGNAL_KEY    = Deno.env.get('ONESIGNAL_REST_API_KEY') ?? '';

    if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: 'Server config' }, 500, req);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const resend   = RESEND_KEY ? new Resend(RESEND_KEY) : null;

    const body = await req.json();
    const { student_id, student_name, parent_id, type = 'check_in', time } = body;
    if (!student_id || !student_name) {
      return json({ ok: false, error: 'Faltan fields' }, 400, req);
    }

    // ── Rate limiting: máx 60/min ────────────────────────────────────────────
    const sinceMinute = new Date(Date.now() - 60 * 1000).toISOString();
    const { count } = await supabase
      .from('system_events')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'kiosk.notify')
      .gte('created_at', sinceMinute);
    if ((count || 0) >= 60) {
      return json({ ok: false, error: 'Rate limit' }, 429, req);
    }

    const isEntry = type === 'check_in' || type === 'checkin';
    const action  = isEntry ? 'llegó a la estancia' : 'salió de la estancia';
    const label   = isEntry ? 'Entrada' : 'Salida';
    const emoji   = isEntry ? '📥' : '📤';
    const title   = `${emoji} ${student_name} ${isEntry ? 'llegó' : 'salió'}`;
    const message = `${student_name} ${action} a las ${time || ''}`;
    const color   = isEntry ? '#22c55e' : '#3b82f6';

    // ── Notificación interna + push ─────────────────────────────────────────
    if (parent_id) {
      await supabase.from('notifications').insert({
        user_id: parent_id, title, message, type: 'attendance',
        link: 'panel_padres.html', is_read: false, created_at: new Date().toISOString()
      }).catch(() => {});

      if (ONESIGNAL_APP_ID && ONESIGNAL_KEY) {
        fetch('https://onesignal.com/api/v1/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${ONESIGNAL_KEY}` },
          body: JSON.stringify({
            app_id: ONESIGNAL_APP_ID,
            headings: { en: title, es: title },
            contents: { en: message, es: message },
            url: 'https://karpuskids.com/panel_padres.html',
            include_external_user_ids: [String(parent_id)],
            channel_for_external_user_ids: 'push',
            chrome_web_icon: 'https://karpuskids.com/img/mundo.jpg',
            large_icon: 'https://karpuskids.com/img/mundo.jpg',
            ttl: 86400,
            data: { type: 'attendance', link: 'panel_padres.html' }
          })
        }).catch(() => {});
      }
    }

    // ── Email a todos los correos de los padres ─────────────────────────────
    if (resend) {
      const { data: st } = await supabase
        .from('students').select('p1_email, p2_email, p1_name, p2_name').eq('id', student_id).maybeSingle();
      const emails = [st?.p1_email, st?.p2_email].filter((e: string) => e && e.includes('@'));
      const safeName = String(student_name).replace(/[<>&]/g, '');
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:20px;">
          <div style="background:linear-gradient(135deg,${color},#16a34a);padding:20px;border-radius:8px 8px 0 0;text-align:center;">
            <h2 style="color:white;margin:0;">${emoji} Karpus Kids</h2>
          </div>
          <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;">
            <h3 style="color:#374151;">${title.replace(/[<>&]/g, '')}</h3>
            <p style="color:#374151;">${message.replace(/[<>&]/g, '')}</p>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;text-align:center;">
              <p style="color:#1f2937;font-weight:700;font-size:16px;margin:0;">🕐 ${String(time || '').replace(/[<>&]/g, '')}</p>
            </div>
            <p style="color:#6b7280;font-size:12px;margin-top:16px;text-align:center;">Karpus Kids · Notificación automática</p>
          </div>
        </div>`;
      for (const email of emails) {
        await resend.emails.send({
          from: FROM_EMAIL, to: email,
          subject: `${label}: ${safeName}`,
          html
        }).catch(() => {});
      }
    }

    // ── Registrar en system_events (rate-limit + auditoría) ─────────────────
    await supabase.from('system_events').insert({
      type: 'kiosk.notify', status: 'completed',
      payload: { student_id, student_name, parent_id, type, at: new Date().toISOString() }
    }).catch(() => {});

    return json({ ok: true }, 200, req);

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[kiosk-notify] Fatal:', msg);
    return json({ ok: false, error: 'Internal error' }, 500, req);
  }
});
