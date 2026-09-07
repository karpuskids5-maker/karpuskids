-- ═══════════════════════════════════════════════════════════════════════════
-- 20 · COLUMNAS FALTANTES EN donation_campaigns
-- Karpus Kids · Fix "Could not find the 'images' column of 'donation_campaigns'"
--
-- La migración 15 definió estas columnas dentro de un CREATE TABLE IF NOT EXISTS.
-- Si la tabla ya existía en producción (variante previa del esquema), las columnas
-- nuevas nunca se agregaron y el panel directora falla al guardar (PGRST204).
-- Este parche agrega SOLO las columnas que faltan, de forma idempotente.
--
-- Es idempotente: ADD COLUMN IF NOT EXISTS. Puede ejecutarse sin daño.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.donation_campaigns
  ADD COLUMN IF NOT EXISTS title           TEXT NOT NULL DEFAULT 'Campaña',
  ADD COLUMN IF NOT EXISTS description     TEXT,
  ADD COLUMN IF NOT EXISTS target_amount   NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS raised_amount   NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS images          TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS start_date      DATE    NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS end_date        DATE,
  ADD COLUMN IF NOT EXISTS is_active       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '20_donaciones_campanas_columns' AS migracion,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='donation_campaigns' AND column_name='images')          AS col_images,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='donation_campaigns' AND column_name='cover_image_url') AS col_cover,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='donation_campaigns' AND column_name='start_date')      AS col_start,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='donation_campaigns' AND column_name='end_date')        AS col_end,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='donation_campaigns' AND column_name='raised_amount')   AS col_raised,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='donation_campaigns' AND column_name='is_active')       AS col_active;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN DE LA MIGRACIÓN 20
-- ═══════════════════════════════════════════════════════════════════════════