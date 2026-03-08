import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // Manejo de CORS (Preflight)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    const onesignalAppId = Deno.env.get("ONESIGNAL_APP_ID")
    const onesignalApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY")

    if (!url || !key) {
      return new Response(JSON.stringify({ error: "Configuración de Supabase faltante" }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }
    
    const supabase = createClient(url, key, { auth: { persistSession: false } })

    const body = await req.json()
    const { user_id, title, message, type = "info", link = null } = body

    if (!user_id || !title || !message) {
      return new Response(JSON.stringify({ error: "Faltan datos obligatorios (user_id, title, message)" }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }

    // 1. Guardar en la base de datos (Notificación interna)
    const { data: rpcResult, error: rpcError } = await supabase.rpc("send_notification", { 
      p_user_id: user_id, 
      p_title: title, 
      p_message: message, 
      p_type: type, 
      p_link: link 
    })

    if (rpcError) console.error("Error en RPC send_notification:", rpcError)

    // 2. Enviar via OneSignal si las llaves están configuradas
    let onesignalStatus = "not_configured"
    if (onesignalAppId && onesignalApiKey) {
      try {
        const osResponse = await fetch("https://onesignal.com/api/v1/notifications", {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": `Basic ${onesignalApiKey}`
          },
          body: JSON.stringify({
            app_id: onesignalAppId,
            include_external_user_ids: [user_id],
            headings: { "en": title, "es": title },
            contents: { "en": message, "es": message },
            url: link ? (link.startsWith('http') ? link : `https://karpuskids.com${link}`) : "https://karpuskids.com/",
            android_accent_color: "FF4CAF50",
            small_icon: "ic_stat_onesignal_default"
          })
        })
        
        const osResult = await osResponse.json()
        onesignalStatus = osResponse.ok ? "sent" : "failed"
        if (!osResponse.ok) console.error("Error OneSignal:", osResult)
      } catch (e) {
        console.error("Error llamando a OneSignal:", e)
        onesignalStatus = "error"
      }
    }

    return new Response(JSON.stringify({ 
      ok: true, 
      internal_notif: !rpcError,
      onesignal: onesignalStatus 
    }), { 
      status: 200, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })

  } catch (e) {
    console.error("Critical Error in send-push:", e)
    return new Response(JSON.stringify({ error: String(e) }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }
})
