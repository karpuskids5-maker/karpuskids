-- ═══════════════════════════════════════════════════════════════════════════
-- 26 · PATCH: Columna images en donation_campaigns + reload schema cache
-- Error: "Could not find the 'images' column of 'donation_campaigns'"
--
-- Ejecutar en Supabase SQL Editor. Después de correr este script,
-- el schema cache de PostgREST se recargará automáticamente en ~30s.
-- Si el error persiste: Dashboard → Settings → API → "Reload schema".
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Asegurar que la columna images existe (idempotente)
ALTER TABLE public.donation_campaigns
  ADD COLUMN IF NOT EXISTS images TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.donation_campaigns
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

-- 2. Notificar a PostgREST para que recargue el schema cache inmediatamente
NOTIFY pgrst, 'reload schema';

-- 3. Verificación
SELECT
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'donation_campaigns'
  AND column_name  IN ('images', 'cover_image_url')
ORDER BY column_name;
