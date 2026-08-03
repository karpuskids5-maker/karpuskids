-- ============================================================
-- KARPUS KIDS — Rutina Express V2 Migration
-- Añade columna events JSONB a daily_logs para el nuevo
-- sistema de eventos estructurados (timeline completa)
-- ============================================================

-- Añadir columna events si no existe
ALTER TABLE public.daily_logs
  ADD COLUMN IF NOT EXISTS events JSONB DEFAULT '[]'::jsonb;

-- Índice GIN para búsquedas en el JSONB
CREATE INDEX IF NOT EXISTS idx_daily_logs_events ON public.daily_logs USING GIN (events);

-- Migrar datos existentes de infant_data a events (para bebés que ya tenían datos)
UPDATE public.daily_logs
SET events = infant_data
WHERE infant_data IS NOT NULL
  AND infant_data != '[]'::jsonb
  AND (events IS NULL OR events = '[]'::jsonb);

-- Política RLS: padres solo ven registros publicados
-- (ya existe por status='published' en la query del padre, este comentario es informativo)

-- Verificar estructura
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'daily_logs'
  AND table_schema = 'public'
ORDER BY ordinal_position;
