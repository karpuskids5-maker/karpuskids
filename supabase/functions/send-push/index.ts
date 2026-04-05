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

/** Enviar notificación a OneSignal */
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
  return { ok: res.ok, result };
}

/**
 * Buscar player_ids de un usuario en OneSignal por external_user_id.
 * Usa la API v1 de OneSignal para obtener los dispositivos del usuario.
 */
async function getPlayerIdsByExternalId(appId: string, key: string, externalUserId: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://onesignal.com/api/v1/players?app_id=${appId}&limit=50`,
      { headers: { 'Authorization': `Basic ${key}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const players = (data.players || []) as Array<{ id: string; external_user_id?: string }>;
    return players
      .filter(p => p.external_user_id === externalUserId)
      .map(p => p.id);
  } catch (_) {
    return [];
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
      // ── Íconos Karpus Kids ──────────────────────────────────────────────
      // Android: ícono pequeño en la barra de estado (debe ser PNG blanco/transparente idealmente)
      // Si no tienes un PNG monocromático, OneSignal usará el ícono de la app por defecto
      // El large_icon aparece en el cuerpo de la notificación (imagen grande)
      large_icon:           ICON_URL,   // imagen grande en el cuerpo (Android)
      big_picture:          ICON_URL,   // imagen expandida al deslizar (Android)
      // iOS: ícono de la app (se toma del bundle, no se puede cambiar por API)
      // Pero sí podemos poner una imagen adjunta
      ios_attachments:      { id1: ICON_URL },
      // Web push (Chrome/Firefox): ícono en la notificación del navegador
      chrome_web_icon:      ICON_URL,
      chrome_web_image:     ICON_URL,
      firefox_icon:         ICON_URL,
      // ────────────────────────────────────────────────────────────────────
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
      // ── Intento 1: external_user_id (método estándar) ──────────────────────
      console.log('[send-push] Intento 1 — external_user_id:', user_id);
      const { ok: ok1, result: r1 } = await osNotify(ONESIGNAL_APP_ID, ONESIGNAL_KEY, {
        ...basePayload,
        include_external_user_ids:     [String(user_id)],
        channel_for_external_user_ids: 'push'
      });

      if (ok1 && (r1.recipients ?? 0) > 0) {
        onesignalStatus = 'sent';
        onesignalDetail = `id=${r1.id} recipients=${r1.recipients}`;
        console.log('[send-push] ✅ Enviado | id:', r1.id, '| recipients:', r1.recipients);
        return json({ ok: true, notification_saved: !dbErr, onesignal: onesignalStatus, detail: onesignalDetail });
      }

      // ── Intento 2: buscar player_ids por external_user_id en OneSignal API ─
      console.warn('[send-push] 0 recipients para external_user_id:', user_id, '| errors:', r1.errors);
      console.log('[send-push] Intento 2 — buscando player_ids en OneSignal...');

      const playerIds = await getPlayerIdsByExternalId(ONESIGNAL_APP_ID, ONESIGNAL_KEY, String(user_id));

      if (playerIds.length > 0) {
        console.log('[send-push] Intento 2 — player_ids encontrados:', playerIds);
        const { ok: ok2, result: r2 } = await osNotify(ONESIGNAL_APP_ID, ONESIGNAL_KEY, {
          ...basePayload,
          include_player_ids: playerIds
        });

        if (ok2 && (r2.recipients ?? 0) > 0) {
          onesignalStatus = 'sent_via_player_id';
          onesignalDetail = `id=${r2.id} recipients=${r2.recipients} players=${playerIds.join(',')}`;
          console.log('[send-push] ✅ Enviado via player_id | id:', r2.id);
          return json({ ok: true, notification_saved: !dbErr, onesignal: onesignalStatus, detail: onesignalDetail });
        }
        onesignalDetail = `player_ids=${playerIds} errors=${JSON.stringify(r2.errors)}`;
      }

      // ── Intento 3: player_id guardado en profiles ──────────────────────────
      const { data: profile } = await supabase
        .from('profiles')
        .select('onesignal_player_id')
        .eq('id', user_id)
        .maybeSingle();

      const savedPlayerId = profile?.onesignal_player_id;
      if (savedPlayerId && !playerIds.includes(savedPlayerId)) {
        console.log('[send-push] Intento 3 — player_id de profiles:', savedPlayerId);
        const { ok: ok3, result: r3 } = await osNotify(ONESIGNAL_APP_ID, ONESIGNAL_KEY, {
          ...basePayload,
          include_player_ids: [savedPlayerId]
        });

        if (ok3 && (r3.recipients ?? 0) > 0) {
          onesignalStatus = 'sent_via_saved_player_id';
          onesignalDetail = `id=${r3.id} recipients=${r3.recipients}`;
          console.log('[send-push] ✅ Enviado via saved player_id | id:', r3.id);
          return json({ ok: true, notification_saved: !dbErr, onesignal: onesignalStatus, detail: onesignalDetail });
        }
      }

      // Sin suscriptores activos — notificación guardada en DB, push pendiente
      onesignalStatus = 'no_subscribers';
      onesignalDetail = `user_id=${user_id} — Sin suscripción push activa. La notificación fue guardada en la app.`;
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
