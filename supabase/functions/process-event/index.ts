import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { Resend } from "https://esm.sh/resend@1.0.0"
import { corsHeaders } from "../_shared/cors.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const resend = new Resend(RESEND_API_KEY)
const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { 
      status: 200, 
      headers: corsHeaders 
    })
  }

  try {
    const { type, data } = await req.json()

    // 1. Log the event
    await supabase.from('system_events').insert({
      type,
      payload: data,
      status: 'processing'
    })

    let responseData = {}

    switch (type) {
      case 'payment.approved':
        responseData = await handlePaymentApproved(data)
        break
      case 'attendance.checkin':
        responseData = await handleAttendance(data, 'entrada')
        break
      case 'attendance.checkout':
        responseData = await handleAttendance(data, 'salida')
        break
      case 'incident.reported':
        responseData = await handleIncident(data)
        break
      case 'payment.receipt_uploaded':
        responseData = await handleReceiptUploaded(data)
        break
      case 'task.created':
        responseData = await handleTaskCreated(data)
        break
      default:
        throw new Error(`Evento no soportado: ${type}`)
    }

    // 2. Update event status
    await supabase.from('system_events')
      .update({ status: 'completed', processed_at: new Date().toISOString() })
      .eq('type', type)
      .order('created_at', { ascending: false })
      .limit(1)

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error("Error in process-event:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

async function handlePaymentApproved(data: any) {
  const { parent_email, student_name, amount, month, payment_id } = data
  
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #16a34a;">¡Pago Confirmado! ✅</h2>
      <p>Hola,</p>
      <p>Confirmamos que el pago de <b>$${amount}</b> correspondiente a <b>${month}</b> para el estudiante <b>${student_name}</b> ha sido aprobado con éxito.</p>
      <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
        <p style="margin: 0;"><b>ID de Pago:</b> ${payment_id}</p>
        <p style="margin: 0;"><b>Monto:</b> $${amount}</p>
        <p style="margin: 0;"><b>Mes:</b> ${month}</p>
      </div>
      <p>Gracias por tu puntualidad y apoyo a Karpus Kids.</p>
      <a href="https://karpuskids.com/panel_padres.html" style="display: inline-block; padding: 12px 20px; background: #16a34a; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Abrir Panel de Padres</a>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #666;">Karpus Kids - Calidez y Desarrollo</p>
    </div>
  `

  await resend.emails.send({
    from: 'Karpus Kids <avisos@karpuskids.com>',
    to: parent_email,
    subject: `Recibo de Pago Aprobado - ${month}`,
    html: html
  })

  return { success: true }
}

async function handleAttendance(data: any, type: string) {
  const { parent_email, student_name, time } = data
  const isEntry = type === 'entrada'
  const color = isEntry ? '#0d9488' : '#ef4444'

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: ${color};">Notificación de ${type === 'entrada' ? 'Llegada' : 'Salida'}</h2>
      <p>Te informamos que <b>${student_name}</b> ha registrado su <b>${type}</b> a Karpus Kids hoy a las <b>${time}</b>.</p>
      <p>${isEntry ? '¡Que tenga un excelente día de aprendizaje!' : '¡Gracias por confiar en nosotros!'}</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #666;">Karpus Kids - Seguridad y Confianza</p>
    </div>
  `

  await resend.emails.send({
    from: 'Karpus Kids <seguridad@karpuskids.com>',
    to: parent_email,
    subject: `Aviso de ${isEntry ? 'Entrada' : 'Salida'}: ${student_name}`,
    html: html
  })

  return { success: true }
}

async function handleIncident(data: any) {
  const { parent_email, student_name, severity, description } = data
  
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #fee2e2; border-radius: 10px;">
      <h2 style="color: #dc2626;">Reporte de Incidencia ⚠️</h2>
      <p>Te informamos que se ha registrado una incidencia relacionada con <b>${student_name}</b>:</p>
      <div style="background: #fef2f2; padding: 15px; border-radius: 8px; margin: 15px 0;">
        <p><b>Nivel de Gravedad:</b> <span style="text-transform: uppercase; font-weight: bold;">${severity}</span></p>
        <p><b>Descripción:</b> ${description}</p>
      </div>
      <p>La maestra está al tanto y ha tomado las medidas necesarias. Si tienes alguna duda, puedes contactarnos a través del chat del panel.</p>
      <hr style="border: none; border-top: 1px solid #fee2e2; margin: 20px 0;">
      <p style="font-size: 12px; color: #666;">Karpus Kids - Cuidado y Atención</p>
    </div>
  `

  await resend.emails.send({
    from: 'Karpus Kids <atencion@karpuskids.com>',
    to: parent_email,
    subject: `Aviso Importante: Reporte de Incidencia - ${student_name}`,
    html: html
  })

  return { success: true }
}

async function handleReceiptUploaded(data: any) {
  const { student_id, amount, month } = data
  const { data: staff } = await supabase.from('profiles').select('email').in('role', ['directora', 'asistente'])
  const emails = staff?.map(s => s.email).filter(Boolean) || []

  if (emails.length > 0) {
    await resend.emails.send({
      from: 'Karpus Kids System <sistema@karpuskids.com>',
      to: emails as string[],
      subject: `Nuevo Comprobante de Pago Subido - Estudiante ID: ${student_id}`,
      html: `<p>Se ha subido un nuevo comprobante de pago por <b>$${amount}</b> para el mes de <b>${month}</b>.</p><p>Por favor, revise el panel administrativo para validar.</p>`
    })
  }
  return { success: true }
}

async function handleTaskCreated(data: any) {
  const { classroom_id, title, due_date } = data
  
  // Obtener correos de padres de ese aula
  const { data: parents } = await supabase
    .from('students')
    .select('p1_email, p1_name')
    .eq('classroom_id', classroom_id)
    .not('p1_email', 'is', null)

  const emailPromises = (parents || []).map(p => {
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #6366f1;">Nueva Tarea Asignada 📝</h2>
        <p>Hola <b>${p.p1_name || 'familia'}</b>,</p>
        <p>Se ha publicado una nueva tarea en el aula: <b>"${title}"</b>.</p>
        <p><b>Fecha de Entrega:</b> ${due_date}</p>
        <br>
        <a href="https://karpuskids.com/panel_padres.html#tasks" style="display: inline-block; padding: 12px 20px; background: #6366f1; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Ver Tarea</a>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #666;">Karpus Kids - Educación y Cuidado</p>
      </div>
    `
    return resend.emails.send({
      from: 'Karpus Kids <tareas@karpuskids.com>',
      to: p.p1_email,
      subject: `Nueva Tarea: ${title}`,
      html: html
    })
  })

  await Promise.allSettled(emailPromises)
  return { success: true }
}
