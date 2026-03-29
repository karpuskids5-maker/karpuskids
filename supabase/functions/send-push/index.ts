import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url            = Deno.env.get("SUPABASE_URL")
    const key            = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    const onesignalAppId = Deno.env.get("ONESIGNAL_APP_ID")
    const onesignalKey   = Deno.env.get("ONESIGNAL_REST_API_KEY")

    if (!url || !key) {
      return new Response(JSON.stringify({ error: "Configuración de Supabase faltante" }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } })
    const body = await req.json()
    const { user_id, title, message, type = "info", link = null } = body

    if (!user_id || !title || !message) {
      return new Response(JSON.stringify({ error: "Faltan campos: user_id, title, message" }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 1. Guardar notificación interna en la tabla notifications directamente
    // (más confiable que el RPC que puede no existir)
    const { error: insertError } = await supabase.from('notifications').insert({
      user_id,
      title,
      message,
      type,
      link,
      is_read: false,
      created_at: new Date().toISOString()
    })

    if (insertError) {
      // Intentar con RPC como fallback
      const { error: rpcError } = await supabase.rpc('send_notification', {
        p_user_id: user_id, p_title: title, p_message: message, p_type: type, p_link: link
      })
      if (rpcError) console.warn('[send-push] No se pudo guardar notificación interna:', rpcError.message)
    }

    // 2. Enviar via OneSignal
    let onesignalStatus = "not_configured"
    if (onesignalAppId && onesignalKey) {
      try {
        const fullLink = link
          ? (link.startsWith('http') ? link : 'https://karpuskids.com' + link)
          : 'https://karpuskids.com/'

        const osRes = await fetch("https://onesignal.com/api/v1/notifications", {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": `Basic ${onesignalKey}`
          },
          body: JSON.stringify({
            app_id: onesignalAppId,
            include_external_user_ids: [user_id],
            headings:  { en: title,   es: title },
            contents:  { en: message, es: message },
            url: fullLink,
            android_accent_color: "FF22C55E",
            small_icon: "ic_stat_onesignal_default",
            // Datos adicionales para el cliente
            data: { type, link }
          })
        })

        const osResult = await osRes.json()
        onesignalStatus = osRes.ok ? "sent" : "failed"
        if (!osRes.ok) console.error('[send-push] OneSignal error:', JSON.stringify(osResult))
      } catch (e) {
        console.error('[send-push] OneSignal exception:', e.message)
        onesignalStatus = "error"
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      notification_saved: !insertError,
      onesignal: onesignalStatus
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    console.error('[send-push] Critical error:', e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
