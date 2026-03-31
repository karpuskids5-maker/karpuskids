import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const ONESIGNAL_APP_ID  = Deno.env.get('ONESIGNAL_APP_ID') ?? '';
    const ONESIGNAL_KEY     = Deno.env.get('ONESIGNAL_REST_API_KEY') ?? '';

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ error: 'Missing Supabase env vars' }, 500);
    }

    // Use service role to bypass RLS when saving notifications
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    const body = await req.json();
    const { user_id, title, message, type = 'info', link = null } = body;

    if (!user_id || !title || !message) {
      return json({ error: 'Missing required fields: user_id, title, message' }, 400);
    }

    // 1. Save internal notification (always, even if OneSignal fails)
    const { error: insertError } = await supabase.from('notifications').insert({
      user_id,
      title,
      message,
      type,
      link,
      is_read: false,
      created_at: new Date().toISOString()
    });

    if (insertError) {
      console.warn('[send-push] Could not save notification:', insertError.message);
    }

    // 2. Send via OneSignal
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
            app_id: ONESIGNAL_APP_ID,
            include_external_user_ids: [String(user_id)],
            channel_for_external_user_ids: 'push',
            headings: { en: title,   es: title },
            contents: { en: message, es: message },
            url: fullLink,
            android_accent_color: 'FF22C55E',
            data: { type, link }
          })
        });

        const osResult = await osRes.json();
        onesignalStatus = osRes.ok ? 'sent' : 'failed';
        if (!osRes.ok) console.error('[send-push] OneSignal error:', JSON.stringify(osResult));
        else console.log('[send-push] OneSignal sent to:', user_id, '| id:', osResult.id);

      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[send-push] OneSignal exception:', msg);
        onesignalStatus = 'error';
      }
    }

    return json({
      ok: true,
      notification_saved: !insertError,
      onesignal: onesignalStatus
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[send-push] Critical error:', msg);
    return json({ error: msg }, 500);
  }
});
