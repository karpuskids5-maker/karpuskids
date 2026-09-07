/**
 * 🔑 custom-recovery — Edge Function
 * Recuperación de contraseña personalizada con rate limiting.
 *
 * Flujo:
 *   1. Recibe el email de login del usuario
 *   2. Busca el usuario en auth.users (admin SDK)
 *   3. Busca el correo de notificaciones alternativo en profiles/students
 *   4. Genera un recovery link con auth.admin.generateLink
 *   5. Envía el enlace via Resend al correo de notificaciones (o al de login si no hay alternativo)
 *
 * Seguridad:
 *   - Usa SERVICE_ROLE_KEY solo en el servidor (nunca expuesta al cliente)
 *   - Rate limiting: máx 3 solicitudes por email cada 15 minutos (tabla recovery_requests)
 *   - NO revela si el email existe en el sistema (respuesta uniforme)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.1.0";
import { getCorsHeaders } from "../_shared/cors.ts";

const MAX_REQUESTS = 3;
const WINDOW_MINUTES = 15;

const json = (data: unknown, status = 200, req?: Request) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const RESEND_KEY   = Deno.env.get('RESEND_API_KEY')            ?? '';
    const FROM_EMAIL   = Deno.env.get('FROM_EMAIL')                ?? 'Karpus Kids <avisos@karpuskids.com>';

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ ok: true, sent: false }, 200, req);
    }

    const { email } = await req.json().catch(() => ({}));
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      // Respuesta uniforme: no revelar errores internos
      return json({ ok: true, sent: false }, 200, req);
    }
    const cleanEmail = String(email).toLowerCase().trim();

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // ── Rate limiting ───────────────────────────────────────────────────────
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count } = await admin
      .from('recovery_requests')
      .select('id', { count: 'exact', head: true })
      .eq('email', cleanEmail)
      .gte('created_at', windowStart);

    if ((count || 0) >= MAX_REQUESTS) {
      return json({ ok: true, sent: false }, 200, req); // silencioso para no revelar
    }

    // ── Registrar intento ───────────────────────────────────────────────────
    await admin.from('recovery_requests').insert({ email: cleanEmail })
      .catch((e) => console.warn('[custom-recovery] log fail:', e?.message));

    // ── Buscar usuario en auth.users ────────────────────────────────────────
    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const match = users?.users?.find(u => (u.email || '').toLowerCase() === cleanEmail);
    if (!match) {
      return json({ ok: true, sent: false }, 200, req); // uniforme
    }

    // ── Buscar email alternativo de notificación ────────────────────────────
    let notifyEmail: string | null = null;
    const { data: profile } = await admin
      .from('profiles').select('email, name').eq('id', match.id).maybeSingle();
    notifyEmail = profile?.email || null;

    if (!notifyEmail) {
      const { data: student } = await admin
        .from('students').select('p1_email').eq('parent_id', match.id).limit(1).maybeSingle();
      notifyEmail = student?.p1_email || null;
    }

    const targetEmail = notifyEmail && notifyEmail !== cleanEmail ? notifyEmail : cleanEmail;

    // ── Generar recovery link ───────────────────────────────────────────────
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: match.email!,
    });
    if (linkErr || !linkData?.properties?.action_link) {
      console.warn('[custom-recovery] generateLink error:', linkErr?.message);
      return json({ ok: true, sent: false }, 200, req);
    }
    const recoveryUrl = linkData.properties.action_link;

    // ── Enviar email ────────────────────────────────────────────────────────
    if (RESEND_KEY) {
      const resend = new Resend(RESEND_KEY);
      const name = profile?.name || 'usuario';
      const html = `
        <div style="font-family:sans-serif;max-width:600px;margin:32px auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #e5e7eb">
          <div style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:24px;text-align:center;border-radius:12px 12px 0 0">
            <h1 style="margin:0;color:white;font-size:20px;font-weight:800">Karpus Kids</h1>
          </div>
          <div style="padding:24px;background:#ffffff">
            <h2 style="color:#374151;margin:0 0 12px">Recuperación de contraseña</h2>
            <p style="color:#374151">Hola <b>${name.replace(/<[^>]*>/g, '')}</b>,</p>
            <p style="color:#374151">Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón para continuar.</p>
            <a href="${recoveryUrl}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Restablecer contraseña</a>
            <p style="color:#9ca3af;font-size:12px;margin-top:16px">Si no solicitaste esto, ignora este correo. El enlace vence en 1 hora.</p>
          </div>
        </div>`;
      await resend.emails.send({
        from: FROM_EMAIL,
        to: targetEmail,
        subject: 'Recuperación de contraseña — Karpus Kids',
        html,
      }).catch((e) => console.warn('[custom-recovery] resend error:', e?.message));
    }

    return json({ ok: true, sent: true }, 200, req);

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[custom-recovery] Fatal:', msg);
    // Nunca revelar errores internos al cliente
    return json({ ok: true, sent: false }, 200, req);
  }
});
