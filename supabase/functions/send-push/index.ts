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

/** Enviar notificación a OneSignal con un payload dado */
async function sendToOneSignal(appId: string, key: string, payload: Record<string, unknown>) {
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Basic ${key}`
    },
    body: JSON.stringify(payload)
  });
  const result = await res.json();
  return { ok: res.ok, result };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')         ?? '';
    const ONESIGNAL_KEY    = Deno.env.get('ONESIGNAL_REST_API_KEY')    ?? '';

    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing Supabase env vars' }, 500);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const body = await req.json();
    const { user_id, title, message, type = 'info', link = null } = body;

    if (!user_id || !title || !message) {
      return json({ error: 'Missing: user_id, title, message' }, 400);
    }

    // 1. Guardar notificación interna siempre
    const { error: dbErr } = await supabase.from('notifications').insert({
      user_id, title, message, type, link,
      is_read: false,
      created_at: new Date().toISOString()
    });
    if (dbErr) console.warn('[send-push] DB insert error:', dbErr.message);

    // 2. OneSignal push
    let onesignalStatus = 'not_configured';
    let onesignalDetail = '';

    if (!ONESIGNAL_APP_ID || !ONESIGNAL_KEY) {
      console.warn('[send-push] OneSignal no configurado — faltan env vars');
      return json({ ok: true, notification_saved: !dbErr, onesignal: onesignalStatus });
    }

    const fullLink = link
      ? (link.startsWith('http') ? link : 'https://karpuskids.com/' + link.replace(/^\//, ''))
      : 'https://karpuskids.com/';

    const basePayload = {
      app_id:    ONESIGNAL_APP_ID,
      headings:  { en: title,   es: title },
      contents:  { en: message, es: message },
      url:       fullLink,
      android_accent_color: 'FF22C55E',
      ios_sound:            'default',
      ios_badge_type:       'Increase',
      ios_badge_count:      1,
      priority:             10,
      ttl:                  86400,
      data:                 { type, link }
    };

    try {
      // Intento 1: por external_user_id (el método principal)
      console.log('[send-push] Intento 1 — external_user_id:', user_id);
      const { ok: ok1, result: r1 } = await sendToOneSignal(ONESIGNAL_APP_ID, ONESIGNAL_KEY, {
        ...basePayload,
        include_external_user_ids:     [String(user_id)],
        channel_for_external_user_ids: 'push'
      });

      if (!ok1) {
        onesignalStatus = 'failed';
        onesignalDetail = JSON.stringify(r1);
        console.error('[send-push] OneSignal error (intento 1):', onesignalDetail);
      } else if ((r1.recipients ?? 0) > 0) {
        // ✅ Entregado correctamente
        onesignalStatus = 'sent';
        onesignalDetail = `id=${r1.id} recipients=${r1.recipients}`;
        console.log('[send-push] ✅ Enviado | id:', r1.id, '| recipients:', r1.recipients);
      } else {
        // 0 recipients — el usuario no tiene external_user_id registrado en OneSignal
        // Intento 2: buscar player_id guardado en profiles
        console.warn('[send-push] 0 recipients para external_user_id:', user_id, '| errors:', r1.errors);

        const { data: profile } = await supabase
          .from('profiles')
          .select('onesignal_player_id')
          .eq('id', user_id)
          .maybeSingle();

        const playerId = profile?.onesignal_player_id;

        if (playerId) {
          console.log('[send-push] Intento 2 — player_id:', playerId);
          const { ok: ok2, result: r2 } = await sendToOneSignal(ONESIGNAL_APP_ID, ONESIGNAL_KEY, {
            ...basePayload,
            include_player_ids: [playerId]
          });

          if (ok2 && (r2.recipients ?? 0) > 0) {
            onesignalStatus = 'sent_via_player_id';
            onesignalDetail = `id=${r2.id} recipients=${r2.recipients}`;
            console.log('[send-push] ✅ Enviado via player_id | id:', r2.id);
          } else {
            onesignalStatus = 'no_subscribers';
            onesignalDetail = `player_id=${playerId} errors=${JSON.stringify(r2.errors)}`;
            console.warn('[send-push] ⚠️ Sin suscriptores activos para user:', user_id);
          }
        } else {
          onesignalStatus = 'no_subscribers';
          onesignalDetail = `El usuario ${user_id} no tiene dispositivos suscritos ni player_id guardado. Errors: ${JSON.stringify(r1.errors)}`;
          console.warn('[send-push] ⚠️ Sin player_id en profiles para user:', user_id);
          console.warn('[send-push] ℹ️ El usuario debe abrir la app y aceptar notificaciones push.');
        }
      }
    } catch (e) {
      onesignalStatus = 'error';
      onesignalDetail = e instanceof Error ? e.message : String(e);
      console.error('[send-push] OneSignal exception:', onesignalDetail);
    }

    return json({
      ok: true,
      notification_saved: !dbErr,
      onesignal: onesignalStatus,
      detail: onesignalDetail
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[send-push] Fatal:', msg);
    return json({ error: msg }, 500);
  }
});
