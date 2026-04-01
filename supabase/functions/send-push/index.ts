import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')             ?? '';
    const SERVICE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')         ?? '';
    const ONESIGNAL_KEY    = Deno.env.get('ONESIGNAL_REST_API_KEY')    ?? '';

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: 'Missing Supabase env vars' }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false }
    });

    const body = await req.json();
    const { user_id, title, message, type = 'info', link = null } = body;

    if (!user_id || !title || !message) {
      return json({ error: 'Missing: user_id, title, message' }, 400);
    }

    // 1. Always save internal notification (bypasses RLS via service role)
    const { error: dbErr } = await supabase.from('notifications').insert({
      user_id,
      title,
      message,
      type,
      link,
      is_read: false,
      created_at: new Date().toISOString()
    });
    if (dbErr) console.warn('[send-push] DB insert error:', dbErr.message);

    // 2. OneSignal push
    let onesignalStatus = 'not_configured';

    if (ONESIGNAL_APP_ID && ONESIGNAL_KEY) {
      try {
        const fullLink = link
          ? (link.startsWith('http') ? link : 'https://karpuskids.com/' + link.replace(/^\//, ''))
          : 'https://karpuskids.com/';

        const osRes = await fetch('https://onesignal.com/api/v1/notifications', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Basic ${ONESIGNAL_KEY}`
          },
          body: JSON.stringify({
            app_id:                          ONESIGNAL_APP_ID,
            include_external_user_ids:       [String(user_id)],
            channel_for_external_user_ids:   "push", // ✅ Asegurar canal push
            headings:  { en: title,   es: title },
            contents:  { en: message, es: message },
            url:       fullLink,
            android_accent_color: 'FF22C55E',
            data: { type, link }
          })
        });

        const osResult = await osRes.json();
        onesignalStatus = osRes.ok ? 'sent' : 'failed';

        if (!osRes.ok) {
          console.error('[send-push] OneSignal error:', JSON.stringify(osResult));
        } else {
          console.log('[send-push] Sent to:', user_id, '| OneSignal id:', osResult.id);
        }
      } catch (e) {
        console.error('[send-push] OneSignal exception:', e instanceof Error ? e.message : e);
        onesignalStatus = 'error';
      }
    }

    return json({ ok: true, notification_saved: !dbErr, onesignal: onesignalStatus });

  } catch (e) {
    console.error('[send-push] Fatal:', e instanceof Error ? e.message : e);
    return json({ error: String(e) }, 500);
  }
});
