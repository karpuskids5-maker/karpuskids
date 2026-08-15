-- ══════════════════════════════════════════════════════════════
-- fix_cron_reminders.sql
-- Configura el cron automático de recordatorios de pago
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- PASO 1: Verificar extensiones disponibles
SELECT
  extname,
  extversion,
  '✅ Activa' AS estado
FROM pg_extension
WHERE extname IN ('pg_cron', 'pg_net');
-- Si no aparecen, actívalas en:
-- Dashboard → Database → Extensions → buscar "pg_cron" y "pg_net" → Enable

-- ══════════════════════════════════════════════════════════════
-- PASO 2: Eliminar crons viejos para evitar duplicados
-- ══════════════════════════════════════════════════════════════
DO $$
BEGIN
  BEGIN PERFORM cron.unschedule('karpus-mora-reminders');          EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('karpus-mark-overdue');            EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('karpus-payment-cycle');           EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('karpus-payment-reminders-daily'); EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- ══════════════════════════════════════════════════════════════
-- PASO 3: Crear los cron jobs
-- ⚠️  REEMPLAZA los dos valores marcados con tus datos reales:
--     SUPABASE_URL  → Dashboard → Settings → API → Project URL
--     SERVICE_KEY   → Dashboard → Settings → API → service_role (secret)
-- ══════════════════════════════════════════════════════════════

-- ── Cron 1: Marcar pagos vencidos — cada día 6:00 AM hora RD (10:00 UTC)
SELECT cron.schedule(
  'karpus-mark-overdue',
  '0 10 * * *',
  $$
    UPDATE public.payments
    SET status = 'overdue'
    WHERE status = 'pending'
      AND due_date < CURRENT_DATE
      AND (deleted_at IS NULL OR deleted_at > NOW());
  $$
);

-- ── Cron 2: Recordatorios diarios — 9:00 AM hora RD (13:00 UTC)
-- Reemplaza 'https://TU_REF.supabase.co' y 'eyJ...SERVICE_ROLE_KEY'
SELECT cron.schedule(
  'karpus-payment-reminders-daily',
  '0 13 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://TU_REF.supabase.co/functions/v1/payment-reminders',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJ...SERVICE_ROLE_KEY","apikey":"eyJ...SERVICE_ROLE_KEY"}'::jsonb,
      body    := '{"action":"auto"}'::jsonb
    );
  $$
);

-- ── Cron 3: Ciclo de pagos — día 1 de cada mes 6:00 AM hora RD (10:00 UTC)
-- Genera cobros del mes actual + backfill de meses anteriores sin cobros
SELECT cron.schedule(
  'karpus-payment-cycle',
  '0 10 1 * *',
  $$
    SELECT net.http_post(
      url     := 'https://TU_REF.supabase.co/functions/v1/auto-payment-cycle',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJ...SERVICE_ROLE_KEY","apikey":"eyJ...SERVICE_ROLE_KEY"}'::jsonb,
      body    := '{"force":true}'::jsonb
    );
  $$
);

-- ══════════════════════════════════════════════════════════════
-- PASO 4: Verificar que quedaron registrados
-- ══════════════════════════════════════════════════════════════
SELECT
  jobid,
  jobname,
  schedule,
  active,
  CASE WHEN active THEN '✅ Activo' ELSE '❌ Inactivo' END AS estado
FROM cron.job
WHERE jobname LIKE 'karpus-%'
ORDER BY jobname;
