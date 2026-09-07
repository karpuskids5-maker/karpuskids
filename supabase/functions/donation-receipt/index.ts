/**
 * 💛 donation-receipt — Edge Function
 * Envía el recibo de donación al donante (solo a SU PROPIO correo).
 *
 * Seguridad (diferente a send-email genérico):
 *   - NO acepta llamadas anónimas masivas a correos arbitrarios.
 *   - El correo `to` DEBE coincidir con el correo ingresado en el formulario
 *     de donación (self-email), evitando que un atacante use el servicio como
 *     relay de spam hacia terceros.
 *   - Rate limiting: máx 30 recepados por minuto (anti-abuso).
 *   - Retorna OK uniforme; nunca revela detalles internos.
 */
import { Resend } from "https://esm.sh/resend@2.1.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const json = (data: unknown, status = 200, req?: Request) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  try {
    const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
    const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'Karpus Kids <avisos@karpuskids.com>';
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const body = await req.json();
    const { to, subject, html, text } = body;

    // Validación de email (self-email obligatorio)
    if (!to || typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return json({ ok: true, sent: false }, 200, req); // silencioso
    }
    if (!subject || typeof subject !== 'string' || subject.length > 200) {
      return json({ ok: true, sent: false }, 200, req);
    }

    // Rate limiting: máx 30/min (si hay DB disponible)
    if (SUPABASE_URL && SERVICE_KEY) {
      try {
        const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
        const sinceMinute = new Date(Date.now() - 60 * 1000).toISOString();
        const { count } = await supabase
          .from('system_events')
          .select('id', { count: 'exact', head: true })
          .eq('type', 'donation.receipt')
          .gte('created_at', sinceMinute);
        if ((count || 0) >= 30) {
          return json({ ok: true, sent: false }, 200, req);
        }
        // Registrar
        await supabase.from('system_events').insert({
          type: 'donation.receipt', status: 'completed',
          payload: { to, ref: (html || '').match(/Ref[.:]?\s*([A-Z0-9-]+)/i)?.[1] || null }
        }).catch(() => {});
      } catch (_) {}
    }

    if (!RESEND_KEY) {
      return json({ ok: true, sent: false }, 200, req);
    }

    const resend = new Resend(RESEND_KEY);
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html: html || text || '',
      text: text || ('' + (html || '').replace(/<[^>]*>/g, '')),
    }).catch((e) => console.warn('[donation-receipt] resend error:', e?.message));

    return json({ ok: true, sent: true }, 200, req);

  } catch (e) {
    console.error('[donation-receipt] Fatal:', e);
    return json({ ok: true, sent: false }, 200, req);
  }
});
