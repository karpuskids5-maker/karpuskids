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

async function osNotify(appId: string, key: string, payload: Record<string, unknown>) {
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Basic ${key}`
    },
    body: JSON.stringify(payload)
  });
  const result = await res.json();
  return { ok: res.ok, status: res.status, result };
}

/**
 * Busca todos los subscription IDs (player_ids) de un usuario via API v2.
 * Devuelve array de IDs — sin filtrar agresivamente para no perder suscripciones válidas.
 */
async function getSubscriptionIds(appId: string, key: string, externalUserId: string): Promise<{ ids: string[], raw: unknown }> {
  try {
    const res = await fetch(
      `https://api.onesignal.com/apps/${appId}/users/by/external_id/${encodeURIComponent(externalUserId)}`,
      {
        headers: {
          'Authorization': `Basic ${key}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const data = await res.json();
    if (!res.ok) {
      console.warn('[send-push] API v2 lookup failed:', res.status, JSON.stringify(data));
      return { ids: [], raw: data };
    }

    const subscriptions = (data.subscriptions || []) as Array<{
      id: string;
      type: string;
      enabled: boolean;
      notification_types?: number;
      token?: string;
    }>;

    console.log(`[send-push] API v2 found ${subscriptions.length} total subscriptions for ${externalUserId}`);

    // Filtro corregido:
    // - enabled !== false (debe estar habilitada)
    // - notification_types !== -2 (OneSignal v2 usa -2 para suscripciones deshabilitadas/pendientes)
    // - Debe ser un tipo de push soportado
    const pushTypes = ['ChromePush', 'FirefoxPush', 'SafariPush', 'SafariLegacyPush',
                       'AndroidPush', 'iOSPush', 'HuaweiPush', 'EdgePush', 'OperaPush'];
    
    const validSubs = subscriptions.filter(s => {
      const isPush = pushTypes.includes(s.type);
      const isEnabled = s.enabled !== false;
      const notDisabled = s.notification_types !== -2;
      
      console.log(`  - Sub ID: ${s.id.slice(0,8)}... | Type: ${s.type} | Enabled: ${s.enabled} | NotifTypes: ${s.notification_types} | Valid: ${isPush && isEnabled && notDisabled}`);
      
      return isPush && isEnabled && notDisabled;
    });

    const ids = validSubs.map(s => s.id);
    console.log('[send-push] IDs finales para envío:', ids);
    return { ids, raw: subscriptions };
  } catch (e) {
    console.warn('[send-push] getSubscriptionIds error:', e);
    return { ids: [], raw: null };
  }
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

    // 0. Verificar si ya tenemos un player_id guardado (para diagnóstico)
    const { data: profileCheck } = await supabase.from('profiles').select('onesignal_player_id').eq('id', user_id).maybeSingle();
    console.log(`[send-push] Diagnóstico inicial para ${user_id}: ${profileCheck?.onesignal_player_id ? 'Tiene player_id: ' + profileCheck.onesignal_player_id : 'NO tiene player_id guardado'}`);

    // 1. Guardar notificación interna siempre
    const { error: dbErr } = await supabase.from('notifications').insert({
      user_id, title, message, type, link,
      is_read: false,
      created_at: new Date().toISOString()
    });
    if (dbErr) console.warn('[send-push] DB insert error:', dbErr.message);

    // 2. OneSignal push
    if (!ONESIGNAL_APP_ID || !ONESIGNAL_KEY) {
      console.warn('[send-push] OneSignal no configurado');
      return json({ ok: true, notification_saved: !dbErr, onesignal: 'not_configured' });
    }

    const fullLink = link
      ? (link.startsWith('http') ? link : 'https://karpuskids.com/' + link.replace(/^\//, ''))
      : 'https://karpuskids.com/';

    const ICON_URL = 'https://karpuskids.com/img/mundo.jpg';

    const basePayload = {
      app_id:               ONESIGNAL_APP_ID,
      headings:             { en: title, es: title },
      contents:             { en: message, es: message },
      url:                  fullLink,
      large_icon:           ICON_URL,
      big_picture:          ICON_URL,
      ios_attachments:      { id1: ICON_URL },
      chrome_web_icon:      ICON_URL,
      chrome_web_image:     ICON_URL,
      firefox_icon:         ICON_URL,
      android_accent_color: 'FF22C55E',
      ios_sound:            'default',
      ios_badge_type:       'Increase',
      ios_badge_count:      1,
      priority:             10,
      ttl:                  86400,
      data:                 { type, link }
    };

    let onesignalStatus = 'pending';
    let onesignalDetail = '';

    try {
      // ── Intento 1: external_user_id (API v1) ──────────────────────────────────
      console.log('[send-push] Intento 1 — external_user_id:', user_id);
      const { ok: ok1, status: s1, result: r1 } = await osNotify(ONESIGNAL_APP_ID, ONESIGNAL_KEY, {
        ...basePayload,
        include_external_user_ids:     [String(user_id)],
        channel_for_external_user_ids: 'push'
      });
      console.log('[send-push] Intento 1 result:', JSON.stringify(r1));

      if (ok1 && (r1.recipients ?? 0) > 0) {
        onesignalStatus = 'sent';
        onesignalDetail = `id=${r1.id} recipients=${r1.recipients}`;
        console.log('[send-push] ✅ Enviado via external_user_id');
        return json({ ok: true, notification_saved: !dbErr, onesignal: onesignalStatus, detail: onesignalDetail });
      }

      // ── Intento 2: player_ids via API v2 lookup ───────────────────────────
      console.log('[send-push] Intento 2 — buscando player_ids via API v2...');
      const { ids: playerIds } = await getSubscriptionIds(ONESIGNAL_APP_ID, ONESIGNAL_KEY, String(user_id));

      if (playerIds.length > 0) {
        console.log('[send-push] Intento 2 — player_ids encontrados:', playerIds);
        const { ok: ok2, result: r2 } = await osNotify(ONESIGNAL_APP_ID, ONESIGNAL_KEY, {
          ...basePayload,
          include_player_ids: playerIds   // ← campo correcto para API v1
        });
        console.log('[send-push] Intento 2 result:', JSON.stringify(r2));

        if (ok2 && (r2.recipients ?? 0) > 0) {
          onesignalStatus = 'sent_via_player_ids';
          onesignalDetail = `id=${r2.id} recipients=${r2.recipients}`;
          console.log('[send-push] ✅ Enviado via player_ids');

          // Actualizar el player_id guardado con el primero válido para fallback rápido
          supabase.from('profiles')
            .update({ onesignal_player_id: playerIds[0] })
            .eq('id', user_id)
            .then(() => {}).catch(() => {});

          return json({ ok: true, notification_saved: !dbErr, onesignal: onesignalStatus, detail: onesignalDetail });
        }
        console.warn('[send-push] Intento 2 falló:', JSON.stringify(r2.errors || r2));
      }

      // ── Intento 3: player_id guardado en base de datos ──────────────────────
      const { data: profile } = await supabase
        .from('profiles')
        .select('onesignal_player_id')
        .eq('id', user_id)
        .maybeSingle();

      const savedPlayerId = profile?.onesignal_player_id;
      if (savedPlayerId && !playerIds.includes(savedPlayerId)) {
        console.log('[send-push] Intento 3 — saved player_id fallback:', savedPlayerId);
        const { ok: ok3, result: r3 } = await osNotify(ONESIGNAL_APP_ID, ONESIGNAL_KEY, {
          ...basePayload,
          include_player_ids: [savedPlayerId]
        });
        console.log('[send-push] Intento 3 result:', JSON.stringify(r3));

        if (ok3 && (r3.recipients ?? 0) > 0) {
          onesignalStatus = 'sent_via_saved_player_id';
          onesignalDetail = `id=${r3.id} recipients=${r3.recipients}`;
          console.log('[send-push] ✅ Enviado via saved player_id');
          return json({ ok: true, notification_saved: !dbErr, onesignal: onesignalStatus, detail: onesignalDetail });
        }
        console.warn('[send-push] Intento 3 falló:', JSON.stringify(r3.errors || r3));
      }

      onesignalStatus = 'no_active_subscription';
      onesignalDetail = `user_id=${user_id} — Sin suscripción push activa. El usuario debe abrir la app y aceptar notificaciones.`;
      console.info('[send-push] ℹ️', onesignalDetail);

    } catch (e) {
      onesignalStatus = 'error';
      onesignalDetail = e instanceof Error ? e.message : String(e);
      console.error('[send-push] Exception:', onesignalDetail);
    }

    return json({ ok: true, notification_saved: !dbErr, onesignal: onesignalStatus, detail: onesignalDetail });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[send-push] Fatal:', msg);
    return json({ error: msg }, 500);
  }
});
