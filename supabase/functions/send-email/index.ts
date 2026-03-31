import { Resend } from "https://esm.sh/resend@2.1.0";
import { corsHeaders } from "../_shared/cors.ts";

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_ADDRESS   = Deno.env.get('FROM_EMAIL') ?? 'Karpus Kids <avisos@karpuskids.com>';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Require Authorization header (anon key or user JWT)
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  try {
    const body = await req.json();
    const { to, subject, html, text, attachments } = body;

    if (!to || !subject || (!html && !text)) {
      return json({ error: 'Missing required fields: to, subject, html or text' }, 400);
    }

    const resend = new Resend(RESEND_API_KEY);

    const payload: Record<string, unknown> = {
      from:    FROM_ADDRESS,
      to:      Array.isArray(to) ? to : [to],
      subject,
      html:    html ?? text,
      text:    text ?? (html as string).replace(/<[^>]*>/gm, ''),
    };

    // Optional PDF attachment support
    // attachments: [{ filename: 'recibo.pdf', content: base64string }]
    if (Array.isArray(attachments) && attachments.length > 0) {
      payload.attachments = attachments.map((a: { filename: string; content: string }) => ({
        filename: a.filename,
        content:  a.content, // base64
      }));
    }

    const { data, error } = await resend.emails.send(payload as Parameters<typeof resend.emails.send>[0]);

    if (error) {
      console.error('[send-email] Resend error:', error);
      return json({ error: error.message }, 400);
    }

    console.log('[send-email] Sent:', data?.id, '→', Array.isArray(to) ? to.join(', ') : to);
    return json({ success: true, id: data?.id });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[send-email] Unexpected error:', msg);
    return json({ error: msg }, 500);
  }
});
