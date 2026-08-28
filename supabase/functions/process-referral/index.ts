import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// Escala de recompensas del Programa Embajadores (propuesta.md §4.3)
// Base mensual de referencia (RD$). Los montos reales se calculan según la
// cuota configurada del colegio (finance_config.monthly_fee).
const REWARD_TIERS = [
  { minEnrolled: 1, label: 'Bronce',   rewardType: 'monthly_discount', discountPct: 15 },
  { minEnrolled: 2, label: 'Plata',    rewardType: 'monthly_discount', discountPct: 35 },
  { minEnrolled: 3, label: 'Oro',      rewardType: 'free_month',       discountPct: 100 },
  { minEnrolled: 4, label: 'Leyenda',  rewardType: 'cashback',         amount: 100 },
];

const REWARD_DESCRIPTIONS: Record<string, string> = {
  monthly_discount: 'Descuento en tu próxima mensualidad por referido matriculado',
  free_month:       '1 MES TOTALMENTE GRATIS de mensualidad por referidos matrinuclados 🎉',
  cashback:         'Crédito acumulable en Monedero Escolar por ser Leyenda Karpus',
};

/**
 * Calcula la recompensa para un embajador según su número de referidos matriculados.
 * Devuelve el objeto de recompensa a insertar.
 */
function computeReward(enrolledCount: number): { reward_type: string; amount: number | null; discount_pct: number; description: string } | null {
  if (enrolledCount < 1) return null;
  const tier = REWARD_TIERS.filter((t) => t.minEnrolled <= enrolledCount).pop();
  if (!tier) return null;

  // rewards se crean con un monto simbólico; la cuota real se aplica en facturación.
  return {
    reward_type: tier.rewardType,
    amount: tier.amount != null ? tier.amount : 0,
    discount_pct: tier.discountPct,
    description: REWARD_DESCRIPTIONS[tier.rewardType] || 'Recompensa Embajador Karpus',
  };
}

/**
 * Registra un referido a partir de un código `ref` capturado en preinscripción.
 */
async function handlePreregistration(supabase: any, payload: { code?: string; prereg_id?: number | string; family?: string; email?: string; phone?: string }) {
  const { code, prereg_id, family, email, phone } = payload;
  if (!code) return { ok: false, reason: 'missing_code' };

  const { data: refCode } = await supabase
    .from('referral_codes')
    .select('id, parent_id')
    .eq('code', String(code).trim())
    .maybeSingle();

  if (!refCode?.parent_id) return { ok: false, reason: 'invalid_code' };

  const familyName = family && family.trim() ? family.trim() : 'Familia Interesada';

  // Evitar duplicados por email
  if (email) {
    const { data: dup } = await supabase
      .from('referrals')
      .select('id')
      .eq('referrer_parent_id', refCode.parent_id)
      .eq('referred_email', email)
      .maybeSingle();
    if (dup) return { ok: true, reason: 'duplicate', referral_id: dup.id, referrer_parent_id: refCode.parent_id };
  }

  let preregId: number | null = null;
  if (prereg_id != null) {
    const parsed = Number(prereg_id);
    if (!Number.isNaN(parsed)) preregId = parsed;
  }

  const { data: referral, error } = await supabase
    .from('referrals')
    .insert({
      referrer_parent_id: refCode.parent_id,
      referred_family_name: familyName,
      referred_email: email || null,
      referred_phone: phone || null,
      status: 'registered', // ya completó el formulario de preinscripción
      reward_status: 'pending',
      prereg_id: preregId,
    })
    .select('id')
    .single();

  if (error) return { ok: false, reason: error.message };

  // Vincular el código de referido a la preinscripción para el flujo de matrícula
  if (preregId) {
    const { error: stampErr } = await supabase
      .from('student_preregistrations')
      .update({ referral_code: String(code).trim(), referral_parent_id: refCode.parent_id })
      .eq('id', preregId);
    if (stampErr) console.warn('[process-referral] stamp prereg:', stampErr.message);
  }

  // Incremento del contador vía función SQL (evita restricción RLS del query builder)
  const { error: incErr } = await supabase.rpc('increment_referral_count', { p_code_id: refCode.id });
  if (incErr) console.warn('[process-referral] increment_referral_count:', incErr.message);

  return { ok: true, reason: 'registered', referral_id: referral.id, referrer_parent_id: refCode.parent_id };
}

/**
 * Marca un referido como matriculado y otorga la recompensa correspondiente.
 * Se invoca cuando la Directora aprueba la matrícula de un estudiante con referido.
 * Acepta `referral_id` (UUID) o `prereg_id` (bigint de la preinscripción).
 */
async function handleEnrollment(supabase: any, payload: { referral_id?: string; prereg_id?: number | string; student_id?: number | string }) {
  let referralId = payload.referral_id;

  // Si solo tenemos el id de la preinscripción, resolver el referido por prereg_id
  if (!referralId && payload.prereg_id != null) {
    const pId = Number(payload.prereg_id);
    if (!Number.isNaN(pId)) {
      const { data: byPrereg } = await supabase
        .from('referrals')
        .select('id')
        .eq('prereg_id', pId)
        .maybeSingle();
      if (byPrereg) referralId = byPrereg.id;
    }
  }

  if (!referralId) return { ok: false, reason: 'missing_referral_id' };

  const { data: referral } = await supabase
    .from('referrals')
    .select('id, referrer_parent_id, status, reward_status')
    .eq('id', referralId)
    .single();

  if (!referral?.referrer_parent_id) return { ok: false, reason: 'referral_not_found' };
  if (referral.status === 'enrolled') return { ok: true, reason: 'already_enrolled' };

  // Actualizar estado a matriculado
  const studentId = payload.student_id ? Number(payload.student_id) : null;
  const { error: upErr } = await supabase
    .from('referrals')
    .update({
      status: 'enrolled',
      enrolled_student_id: studentId || null,
      enrolled_at: new Date().toISOString(),
    })
    .eq('id', referralId);
  if (upErr) return { ok: false, reason: upErr.message };

  // Contar referidos matriculados del embajador
  const { count, error: cntErr } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_parent_id', referral.referrer_parent_id)
    .eq('status', 'enrolled');
  if (cntErr) return { ok: false, reason: cntErr.message };

  const enrolledCount = count || 0;

  // Actualizar contador de conversiones y nivel de embajador
  await supabase
    .from('referral_codes')
    .update({ successful_conversions: enrolledCount })
    .eq('parent_id', referral.referrer_parent_id);

  const reward = computeReward(enrolledCount);
  let rewardInserted = false;
  if (reward) {
    const { data: inserted, error: insErr } = await supabase
      .from('referral_rewards')
      .insert({
        parent_id: referral.referrer_parent_id,
        referral_id: referralId,
        reward_type: reward.reward_type,
        amount: reward.amount || 0,
        description: reward.description,
        is_used: false,
        expires_at: null,
      })
      .select('id')
      .single();
    if (!insErr && inserted) {
      rewardInserted = true;
      // Notificación de celebración al padre
      await sendCelebration(supabase, referral.referrer_parent_id, enrolledCount, reward);
    }
  }

  return {
    ok: true,
    reason: 'enrolled',
    enrolled_count: enrolledCount,
    reward_inserted: rewardInserted,
  };
}

/**
 * Envía notificación interna + push de celebración al padre promotor.
 */
async function sendCelebration(supabase: any, parentId: string, enrolledCount: number, reward: { reward_type: string; description: string; discount_pct: number }) {
  let title = '¡Tienes un nuevo referido matriculado! 🎉';
  let message = `La familia completó su inscripción. Has ganado una recompensa Embajador Karpus.`;

  if (reward.reward_type === 'free_month') {
    title = '¡Eres Embajador ORO! 🏆';
    message = 'Tu 1 MES GRATIS de mensualidad está listo en tu Monedero Escolar.';
  } else if (reward.reward_type === 'cashback') {
    title = '¡Leyenda Karpus! 👑';
    message = 'Recibiste $100 USD en crédito acumulable en tu Monedero Escolar.';
  } else if (reward.discount_pct) {
    message = `Recibiste ${reward.discount_pct}% de descuento en tu próxima mensualidad.`;
  }

  await supabase.from('notifications').insert({
    user_id: parentId,
    title,
    message,
    type: 'celebration',
    link: null,
    is_read: false,
    created_at: new Date().toISOString(),
  }).then(() => {}).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing Supabase env vars' }, 500);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const body = await req.json();
    const { action, ...payload } = body;

    if (!action || !['preregistration', 'enrollment'].includes(action)) {
      return json({ error: 'Missing or invalid action. Esperado: preregistration | enrollment' }, 400);
    }

    let result;
    if (action === 'preregistration') {
      result = await handlePreregistration(supabase, payload);
    } else {
      result = await handleEnrollment(supabase, payload);
    }

    return json({ ok: true, action, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[process-referral] Fatal:', msg);
    return json({ error: msg }, 500);
  }
});
