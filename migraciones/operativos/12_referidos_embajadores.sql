-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · SQL OPERATIVO 12/12 — SISTEMA EMBAJADORES & REFERIDOS
-- ═══════════════════════════════════════════════════════════════════════════
-- Origen: propuesta.md (INFORME DE ESTRATEGIA UX Y SISTEMA DINÁMICO DE REFERIDOS)
--
-- Implementa:
--   1. Códigos de referido únicos por familia (referral_codes)
--   2. Seguimiento de referidos (referrals) con estados y recompensas
--   3. Monedero digital de recompensas (referral_rewards) aplicable a pagos
--   4. Captura del código `ref` en preinscripción (student_preregistrations)
--   5. Funciones + políticas RLS para privacidad de los padres
--
-- ⚠ EJECUTAR EN ORDEN: 01 → 12 (Supabase Dashboard → SQL Editor)
--   Cada archivo continúa el esquema del anterior; no saltarse ninguno
--   en una base nueva. En la base existente son idempotentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 12.1 · CÓDIGOS DE REFERIDO POR FAMILIA
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id             uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  code                  text NOT NULL UNIQUE,
  qr_url                text,
  total_invites_sent    integer DEFAULT 0,
  successful_conversions integer DEFAULT 0,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_parent ON public.referral_codes (parent_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code     ON public.referral_codes (code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12.2 · REGISTRO DE SEGUIMIENTO DE REFERIDOS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referrals (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_parent_id   uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_family_name text NOT NULL,
  referred_email       text,
  referred_phone       text,
  status               text NOT NULL DEFAULT 'invited'
                       CHECK (status IN ('invited','registered','visited','enrolled','rejected')),
  reward_status        text NOT NULL DEFAULT 'pending'
                       CHECK (reward_status IN ('pending','approved','applied','expired')),
  discount_amount      numeric(10,2) DEFAULT 0.00,
  prereg_id            bigint REFERENCES public.student_preregistrations(id) ON DELETE SET NULL,
  enrolled_student_id  bigint REFERENCES public.students(id) ON DELETE SET NULL,
  enrolled_at          timestamptz,
  created_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_parent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_status   ON public.referrals (status)
  WHERE status IN ('invited','registered','visited');

-- ─────────────────────────────────────────────────────────────────────────────
-- 12.3 · MONEDERO DIGITAL Y RECOMPENSAS
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTA: applied_to_payment_id referencia public.payments(id) que es BIGINT,
-- por lo que usamos bigint (NO uuid) para mantener la integridad referencial.
CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id            uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_id          uuid REFERENCES public.referrals(id) ON DELETE CASCADE,
  reward_type          text NOT NULL DEFAULT 'monthly_discount'
                       CHECK (reward_type IN ('monthly_discount','free_month','cashback')),
  amount               numeric(10,2) NOT NULL DEFAULT 0,
  description          text,
  is_used              boolean DEFAULT false,
  applied_to_payment_id bigint REFERENCES public.payments(id) ON DELETE SET NULL,
  used_at              timestamptz,
  expires_at           timestamptz,
  created_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_parent  ON public.referral_rewards (parent_id, is_used);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_active  ON public.referral_rewards (parent_id)
  WHERE is_used = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12.4 · CÓDIGO `ref` EN PREINSCRIPCIÓN (para enlazar el referido entrante)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.student_preregistrations
  ADD COLUMN IF NOT EXISTS referral_code text;
ALTER TABLE public.student_preregistrations
  ADD COLUMN IF NOT EXISTS referral_parent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prereg_referral ON public.student_preregistrations (referral_code)
  WHERE referral_code IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12.5 · ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.referral_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

-- Staff (directora/asistente/admin) puede ver todo
DROP POLICY IF EXISTS "referral_codes_staff" ON public.referral_codes;
CREATE POLICY "referral_codes_staff" ON public.referral_codes FOR ALL
  TO authenticated USING (get_my_role() IN ('directora','asistente','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','admin'));

DROP POLICY IF EXISTS "referrals_staff" ON public.referrals;
CREATE POLICY "referrals_staff" ON public.referrals FOR SELECT
  TO authenticated USING (get_my_role() IN ('directora','asistente','admin'));

DROP POLICY IF EXISTS "referral_rewards_staff" ON public.referral_rewards;
CREATE POLICY "referral_rewards_staff" ON public.referral_rewards FOR ALL
  TO authenticated USING (get_my_role() IN ('directora','asistente','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','admin'));

-- El padre solo accede a SUS propios datos de referidos
DROP POLICY IF EXISTS "referral_codes_parent" ON public.referral_codes;
CREATE POLICY "referral_codes_parent" ON public.referral_codes FOR SELECT
  TO authenticated USING (parent_id = auth.uid());

DROP POLICY IF EXISTS "referrals_parent" ON public.referrals;
CREATE POLICY "referrals_parent" ON public.referrals FOR ALL
  TO authenticated USING (referrer_parent_id = auth.uid())
  WITH CHECK (referrer_parent_id = auth.uid());

DROP POLICY IF EXISTS "referral_rewards_parent" ON public.referral_rewards;
CREATE POLICY "referral_rewards_parent" ON public.referral_rewards FOR SELECT
  TO authenticated USING (parent_id = auth.uid());

-- El padre puede insertar sus propias recompensas (p.ej. para aplicar crédito)
DROP POLICY IF EXISTS "referral_rewards_parent_update" ON public.referral_rewards;
CREATE POLICY "referral_rewards_parent_update" ON public.referral_rewards FOR UPDATE
  TO authenticated USING (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 12.6 · FUNCIÓN: OBTENER O CREAR CÓDIGO DE REFERIDO DE UN PADRE
-- ─────────────────────────────────────────────────────────────────────────────
-- Genera de forma idempotente el código único de la familia, p.ej. "KARPUS-RODRIGUEZ-982"
CREATE OR REPLACE FUNCTION public.ensure_referral_code(p_parent_id uuid)
RETURNS public.referral_codes LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code   public.referral_codes%ROWTYPE;
  v_parent public.profiles%ROWTYPE;
  v_stem   text;
  v_salt   text;
BEGIN
  IF p_parent_id IS NULL OR p_parent_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  SELECT * INTO v_code FROM public.referral_codes WHERE parent_id = p_parent_id;
  IF v_code.id IS NOT NULL THEN
    RETURN v_code;
  END IF;

  SELECT * INTO v_parent FROM public.profiles WHERE id = p_parent_id;
  -- Extraer apellido o palabra clave del nombre para un código memorable
  v_stem := upper(trim(regexp_replace(
    coalesce(v_parent.name, 'FAMILIA'),
    '[^a-zA-Z ]', '', 'g'
  )));
  IF v_stem = '' OR v_stem IS NULL THEN v_stem := 'FAMILIA'; END IF;
  v_stem := substring(v_stem from 1 for 20);

  -- Sufijo numérico aleatorio de 3 dígitos
  v_salt := to_char(floor(random() * 900 + 100)::int, 'FM000');

  -- Caracter + año para aleatoriedad extra
  v_code.code := 'KARPUS-' || replace(v_stem, ' ', '-') || '-' || v_salt;

  -- Manejar colisión rara regenerando
  LOOP
    BEGIN
      INSERT INTO public.referral_codes (parent_id, code)
      VALUES (p_parent_id, v_code.code)
      RETURNING * INTO v_code;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_salt := to_char(floor(random() * 900 + 100)::int, 'FM000');
      v_code.code := 'KARPUS-' || replace(v_stem, ' ', '-') || '-' || v_salt;
    END;
  END LOOP;

  RETURN v_code;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12.7 · FUNCIÓN: REGISTRAR UN REFERIDO (data desde preinscripción o manual)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_referral(
  p_family_name text,
  p_email       text DEFAULT NULL,
  p_phone       text DEFAULT NULL,
  p_prereg_id   bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code  public.referral_codes%ROWTYPE;
  v_id    uuid;
  v_count int;
BEGIN
  IF p_family_name IS NULL OR trim(p_family_name) = '' THEN
    RAISE EXCEPTION 'Nombre de la familia referida es obligatorio';
  END IF;

  -- El padre debe tener un código (se crea si no existe)
  v_code := public.ensure_referral_code(auth.uid());

  -- No duplicar por email/celular si ya existe un referido igual
  IF p_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.referrals
    WHERE referrer_parent_id = auth.uid()
      AND referred_email = p_email
  ) THEN
    RAISE EXCEPTION 'Esa familia ya fue registrada por este medio';
  END IF;

  INSERT INTO public.referrals
    (referrer_parent_id, referred_family_name, referred_email, referred_phone, status, prereg_id)
  VALUES
    (auth.uid(), p_family_name, p_email, p_phone, 'invited', p_prereg_id)
  RETURNING id INTO v_id;

  UPDATE public.referral_codes
    SET total_invites_sent = total_invites_sent + 1
  WHERE id = v_code.id;

  SELECT count(*) INTO v_count FROM public.referrals
    WHERE referrer_parent_id = auth.uid() AND status = 'enrolled';

  RETURN jsonb_build_object('ok', true, 'referral_id', v_id, 'enrolled_count', v_count);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12.8 · FUNCIÓN: APLICAR CRÉDITO DEL MONEDERO A LA MENSUALIDAD
-- ─────────────────────────────────────────────────────────────────────────────
-- Marca una recompensa como usada vinculándola a un pago específico.
CREATE OR REPLACE FUNCTION public.apply_referral_reward(
  p_reward_id uuid,
  p_payment_id bigint
) RETURNS public.referral_rewards LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.referral_rewards%ROWTYPE;
BEGIN
  IF p_reward_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'reward_id y payment_id son obligatorios';
  END IF;

  SELECT * INTO v_row FROM public.referral_rewards WHERE id = p_reward_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Recompensa no encontrada'; END IF;

  IF v_row.parent_id <> auth.uid() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  IF v_row.is_used THEN RAISE EXCEPTION 'Este crédito ya fue utilizado'; END IF;

  -- Verificar que el pago pertenezca a un estudiante del padre
  IF NOT EXISTS (
    SELECT 1 FROM public.payments p
    JOIN public.students s ON s.id = p.student_id
    WHERE p.id = p_payment_id AND s.parent_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'El pago no pertenece a un estudiante válido';
  END IF;

  UPDATE public.referral_rewards
    SET is_used = true, applied_to_payment_id = p_payment_id, used_at = now()
  WHERE id = p_reward_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12.9 · FUNCIÓN: TABLERO DEL PADRE (referidos + saldo del monedero)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_embajador_dashboard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code     public.referral_codes%ROWTYPE;
  v_referrals jsonb;
  v_rewards  jsonb;
  v_balance  numeric(10,2);
  v_enrolled integer;
BEGIN
  SELECT * INTO v_code FROM public.referral_codes WHERE parent_id = auth.uid();

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'family', r.referred_family_name,
      'email', r.referred_email,
      'phone', r.referred_phone,
      'status', r.status,
      'reward_status', r.reward_status,
      'discount_amount', r.discount_amount,
      'created_at', r.created_at
    ) ORDER BY r.created_at DESC
  ), '[]'::jsonb)
  INTO v_referrals
  FROM public.referrals r WHERE r.referrer_parent_id = auth.uid();

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', w.id,
      'reward_type', w.reward_type,
      'amount', w.amount,
      'description', w.description,
      'is_used', w.is_used,
      'created_at', w.created_at
    ) ORDER BY w.created_at DESC
  ), '[]'::jsonb),
  coalesce(sum(w.amount) FILTER (WHERE w.is_used = false), 0),
  count(*) FILTER (WHERE r.status = 'enrolled')
  INTO v_rewards, v_balance, v_enrolled
  FROM public.referral_rewards w
  LEFT JOIN public.referrals r ON r.id = w.referral_id
  WHERE w.parent_id = auth.uid();

  RETURN jsonb_build_object(
    'code', v_code.id IS NOT NULL,
    'code_value', coalesce(v_code.code, null),
    'qr_url', coalesce(v_code.qr_url, null),
    'total_invites', coalesce(v_code.total_invites_sent, 0),
    'enrolled_count', v_enrolled,
    'balance', v_balance,
    'referrals', v_referrals,
    'rewards', v_rewards
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12.10 · FUNCIÓN: INCREMENTAR CONTADOR DE INVITACIONES (usada por el edge function)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_referral_count(p_code_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.referral_codes
    SET total_invites_sent = total_invites_sent + 1
  WHERE id = p_code_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_referral_count(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.ensure_referral_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_referral(text,text,text,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_referral_reward(uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_embajador_dashboard() TO authenticated;

REVOKE ALL ON public.referral_codes, public.referrals, public.referral_rewards FROM PUBLIC;
GRANT SELECT ON public.referral_codes TO authenticated;
GRANT SELECT ON public.referrals TO authenticated;
GRANT SELECT ON public.referral_rewards TO authenticated;
