/**
 * 📧 send-email — Edge Function
 * Envía correos via Resend. Requiere autenticación.
 */
import { Resend } from "https://esm.sh/resend@2.1.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_ADDRESS   = Deno.env.get('FROM_EMAIL') ?? 'Karpus Kids <avisos@karpuskids.com>';
const ALLOWED_ROLES  = ['admin', 'directora', 'asistente'];

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // ── Auth verification ──────────────────────────────────────────────────
    const auth = await verifyAuth(req, ALLOWED_ROLES);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error }), {
        status: auth.status || 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { to, subject, html, text, attachments } = body;

    // Validación de schema
    if (!to || !subject || (!html && !text)) {
      return new Response(JSON.stringify({ error: 'Missing required fields: to, subject, html or text' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    // Validar formato de email
    const toList = Array.isArray(to) ? to : [to];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!toList.every(e => typeof e === 'string' && emailRegex.test(e))) {
      return new Response(JSON.stringify({ error: 'Invalid email address in "to" field' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    if (typeof subject !== 'string' || subject.length > 500) {
      return new Response(JSON.stringify({ error: 'Invalid subject' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    // Limitar tamaño del body para evitar abuso
    const bodySize = JSON.stringify(body).length;
    if (bodySize > 500_000) {
      return new Response(JSON.stringify({ error: 'Request body too large' }), {
        status: 413, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    if (!RESEND_API_KEY) {
      console.error('[send-email] RESEND_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const resend = new Resend(RESEND_API_KEY);

    const payload: Record<string, unknown> = {
      from:    FROM_ADDRESS,
      to:      Array.isArray(to) ? to : [to],
      subject,
      html:    html ?? text,
      text:    text ?? (html as string).replace(/<[^>]*>/gm, ''),
    };

    if (Array.isArray(attachments) && attachments.length > 0) {
      payload.attachments = attachments.map((a: { filename: string; content: string }) => ({
        filename: a.filename,
        content:  a.content,
      }));
    }

    const { data, error } = await resend.emails.send(payload as Parameters<typeof resend.emails.send>[0]);

    if (error) {
      console.error('[send-email] Resend error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    console.log('[send-email] ✅ Sent:', data?.id, '→', Array.isArray(to) ? `${to.length} recipient(s)` : '1 recipient');
    return new Response(JSON.stringify({ success: true, id: data?.id }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[send-email] Unexpected error:', msg);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
