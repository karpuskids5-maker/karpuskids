-- ═══════════════════════════════════════════════════════════════════════════
-- 18 · MEJORAS AL MÓDULO DE DONACIONES (V5.0 — mejora.md)
-- Karpus Kids · Cierre de huecos del plan estratégico
--
-- Objetivos cubiertos de mejora.md:
--   1. Frecuencia de donación: Única vs. Aporte Mensual Recurrente.
--   2. Tipo de donante: Persona Física / Empresa (is_company ya existía en la
--      tabla pero el formulario público nunca la enviaba; ahora se propaga).
--   3. Cuentas institucionales para transferencia (BHD, Popular, Banreservas)
--      mostradas al donante al elegir "Transferencia Bancaria".
--
-- Es idempotente: CREATE IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 18.1 · COLUMNA `frequency` EN donations (única vs recurrente mensual)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.donations
  ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'one_time'
  CHECK (frequency IN ('one_time','monthly'));

COMMENT ON COLUMN public.donations.frequency IS
  'Frecuencia: one_time = donación única, monthly = aporte mensual recurrente';

-- Índice para el dashboard (recurrentes)
CREATE INDEX IF NOT EXISTS idx_donations_frequency
  ON public.donations (frequency, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 18.2 · TABLA donation_settings: cuentas institucionales + textos
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.donation_settings (
  id                      int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bank_accounts           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Ej. de bank_accounts: [{ "bank":"BHD", "account":"960 341 900 00", "type":"Corriente", "owner":"Karpus Kids SRL" }]
  transfer_instructions   text,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.donation_settings ENABLE ROW LEVEL SECURITY;

-- Público puede leer las cuentas para transferir (son datos de pago públicos)
DROP POLICY IF EXISTS "donation_settings_public_select" ON public.donation_settings;
CREATE POLICY "donation_settings_public_select" ON public.donation_settings
  FOR SELECT TO anon, authenticated
  USING (true);

-- Solo staff gestiona las cuentas
DROP POLICY IF EXISTS "donation_settings_staff" ON public.donation_settings;
CREATE POLICY "donation_settings_staff" ON public.donation_settings
  FOR ALL TO authenticated
  USING (get_my_role() IN ('directora','asistente','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','admin'));

-- Semilla: cuentas institucionales de ejemplo (edítalas en el panel directora)
INSERT INTO public.donation_settings (id, bank_accounts, transfer_instructions)
VALUES (1, '[
  {"bank":"Banco BHD",        "account":"96034190000", "type":"Corriente", "owner":"Karpus Kids SRL"},
  {"bank":"Banco Popular",    "account":"75225189412", "type":"Ahorro",    "owner":"Karpus Kids SRL"},
  {"bank":"Banreservas",      "account":"116543987001", "type":"Corriente", "owner":"Karpus Kids SRL"}
]'::jsonb,
'Solicita al personal de Karpus Kids el comprobante de tu transferencia por WhatsApp o responde al correo de confirmación con el volante bancario.'
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 18.3 · RPC register_donation — acepta `frequency` y propaga is_company
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_donation(
  p_campaign_id     BIGINT DEFAULT NULL,
  p_donor_name      TEXT   DEFAULT NULL,
  p_donor_email     TEXT   DEFAULT NULL,
  p_donor_phone     TEXT   DEFAULT NULL,
  p_donor_tax_id    TEXT   DEFAULT NULL,
  p_is_company      BOOLEAN DEFAULT false,
  p_is_anonymous    BOOLEAN DEFAULT false,
  p_amount          NUMERIC DEFAULT 0,
  p_payment_method  TEXT   DEFAULT 'transfer',
  p_bank_name       TEXT   DEFAULT NULL,
  p_receipt_url     TEXT   DEFAULT NULL,
  p_frequency       TEXT   DEFAULT 'one_time'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ref          TEXT;
  v_donation_id  UUID;
  v_name         TEXT;
  v_email        TEXT;
  v_method       TEXT;
  v_freq         TEXT;
BEGIN
  -- Validaciones de entrada
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Monto de donación inválido';
  END IF;
  IF p_amount > 1000000 THEN
    RAISE EXCEPTION 'Monto excede el límite permitido';
  END IF;

  v_name := nullif(trim(p_donor_name), '');
  IF v_name IS NULL OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'Nombre del donante requerido';
  END IF;

  v_email := lower(nullif(trim(p_donor_email), ''));
  IF v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Correo electrónico inválido';
  END IF;

  v_method := nullif(trim(p_payment_method), '');
  IF v_method IS NULL OR v_method NOT IN ('transfer','card','cash') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;

  v_freq := coalesce(nullif(trim(p_frequency), ''), 'one_time');
  IF v_freq NOT IN ('one_time','monthly') THEN
    RAISE EXCEPTION 'Frecuencia de donación inválida';
  END IF;

  IF p_campaign_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.donation_campaigns c
    WHERE c.id = p_campaign_id AND c.is_active = true
  ) THEN
    RAISE EXCEPTION 'Campaña no válida o inactiva';
  END IF;

  -- Referencia única de seguimiento: DON-YYYY-XXXXXX
  LOOP
    v_ref := 'DON-' || to_char(now(), 'YYYY') || '-'
             || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.donations WHERE tracking_ref = v_ref);
  END LOOP;

  INSERT INTO public.donations (
    tracking_ref, campaign_id, donor_name, donor_email, donor_phone,
    donor_tax_id, is_company, is_anonymous, amount, payment_method,
    bank_name, receipt_url, status, frequency
  ) VALUES (
    v_ref, p_campaign_id, v_name, v_email, nullif(trim(p_donor_phone), ''),
    nullif(trim(p_donor_tax_id), ''), coalesce(p_is_company, false),
    coalesce(p_is_anonymous, false), p_amount, v_method,
    nullif(trim(p_bank_name), ''), nullif(trim(p_receipt_url), ''), 'pending', v_freq
  ) RETURNING id INTO v_donation_id;

  RETURN jsonb_build_object(
    'success',       true,
    'donation_id',   v_donation_id,
    'tracking_ref',  v_ref,
    'amount',        p_amount,
    'currency',      'DOP',
    'frequency',     v_freq,
    'message',       'Donación registrada correctamente'
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '18_donaciones_mejoras' AS migracion,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='donations' AND column_name='frequency') AS col_frequency,
       (SELECT count(*) FROM public.donation_settings) AS settings_rows;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN DE LA MIGRACIÓN 18
-- ═══════════════════════════════════════════════════════════════════════════
