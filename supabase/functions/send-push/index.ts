import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  try {
    const url = Deno.env.get("SUPABASE_URL")
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!url || !key) return new Response(JSON.stringify({ error: "env" }), { status: 500 })
    const supabase = createClient(url, key, { auth: { persistSession: false } })

    const body = await req.json()
    const user_id = body.user_id
    const title = body.title
    const message = body.message
    const type = body.type || "info"
    const link = body.link || null
    if (!user_id || !title || !message) return new Response(JSON.stringify({ error: "payload" }), { status: 400 })

    const { error } = await supabase.rpc("send_notification", { p_user_id: user_id, p_title: title, p_message: message, p_type: type, p_link: link })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
