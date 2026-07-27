-- ============================================================
-- 🚀 Karpus Kids — Configuración Final de Producción
-- Ejecutar en Supabase SQL Editor (ÚLTIMO paso antes de go-live)
-- ============================================================

-- ── 1. CRON JOBS (requiere extensión pg_cron) ────────────────────────────────
-- Activar pg_cron: Dashboard → Database → Extensions → pg_cron → Enable

-- Verificar si pg_cron está disponible
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron no está instalado. Actívalo en Dashboard → Database → Extensions';
  ELSE
    RAISE NOTICE 'pg_cron disponible ✅';
  END IF;
END $$;

-- Ciclo de pagos: ejecutar el día 25 de cada mes a las 8:00 AM (hora DO = UTC-4)
-- UTC 12:00 = 8:00 AM República Dominicana
SELECT cron.schedule(
  'karpus-payment-cycle',
  '0 12 25 * *',
  $$SELECT public.run_payment_cycle()$$
);

-- Recordatorios de mora: cada 3 días a las 9:00 AM (hora DO)
-- UTC 13:00 = 9:00 AM República Dominicana
SELECT cron.schedule(
  'karpus-mora-reminders',
  '0 13 */3 * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/payment-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    )
  $$
);

-- Marcar pagos vencidos: cada día a las 6:00 AM (hora DO)
SELECT cron.schedule(
  'karpus-mark-overdue',
  '0 10 * * *',
  $$
    UPDATE public.payments
    SET status = 'overdue'
    WHERE status = 'pending'
      AND due_date < CURRENT_DATE
      AND deleted_at IS NULL
  $$
);

-- Ver cron jobs activos
-- SELECT * FROM cron.job;

-- ── 2. POLÍTICAS DE STORAGE ──────────────────────────────────────────────────
-- Limitar tipos de archivo y tamaño en los buckets de Supabase Storage
-- Nota: Los límites de tamaño se configuran en Dashboard → Storage → Buckets
-- Aquí configuramos las políticas RLS de Storage

-- Bucket: karpus-uploads (avatares, comprobantes)
-- Solo el propietario puede subir, todos los autenticados pueden leer
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'karpus-uploads',
  'karpus-uploads',
  true,
  5242880, -- 5MB máximo
  ARRAY['image/jpeg','image/png','image/webp','image/gif','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif','application/pdf'];

-- Bucket: classroom_media (posts del muro, tareas)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'classroom_media',
  'classroom_media',
  true,
  52428800, -- 50MB máximo (videos)
  ARRAY['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = 52428800,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','application/pdf'];

-- ── 3. VISTA DE INTENTOS DE FUERZA BRUTA ────────────────────────────────────
-- Para el panel de control — ver intentos fallidos recientes
CREATE OR REPLACE VIEW public.v_brute_force_attempts AS
SELECT
  email,
  COUNT(*) FILTER (WHERE success = false)  AS failed_attempts,
  COUNT(*) FILTER (WHERE success = true)   AS successful_logins,
  MAX(created_at)                          AS last_attempt,
  MIN(created_at)                          AS first_attempt,
  -- Marcar como sospechoso si tiene 5+ intentos fallidos en 1 hora
  CASE
    WHEN COUNT(*) FILTER (
      WHERE success = false
        AND created_at > NOW() - INTERVAL '1 hour'
    ) >= 5 THEN true
    ELSE false
  END AS is_suspicious
FROM public.login_attempts
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY email
ORDER BY failed_attempts DESC, last_attempt DESC;

GRANT SELECT ON public.v_brute_force_attempts TO authenticated;

-- RLS: solo admin puede ver
CREATE POLICY "brute_force_admin_only" ON public.login_attempts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── 4. ÍNDICE PARA CONSULTAS DE FUERZA BRUTA ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time
  ON public.login_attempts (email, created_at DESC, success);

-- ── 5. FUNCIÓN: Verificar si un email está siendo atacado ───────────────────
CREATE OR REPLACE FUNCTION public.is_email_under_attack(p_email text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) >= 10
  FROM public.login_attempts
  WHERE email = p_email
    AND success = false
    AND created_at > NOW() - INTERVAL '1 hour'
$$;

GRANT EXECUTE ON FUNCTION public.is_email_under_attack(text) TO authenticated;

-- ── 6. LIMPIEZA AUTOMÁTICA DE LOGS ANTIGUOS ──────────────────────────────────
-- Limpiar login_attempts de más de 30 días (privacidad + rendimiento)
SELECT cron.schedule(
  'karpus-cleanup-logs',
  '0 3 1 * *', -- Primer día de cada mes a las 3 AM UTC
  $$
    DELETE FROM public.login_attempts WHERE created_at < NOW() - INTERVAL '30 days';
    DELETE FROM public.system_errors  WHERE created_at < NOW() - INTERVAL '90 days';
  $$
);

-- ── 7. CONFIGURACIÓN DE VARIABLES DE APP ────────────────────────────────────
-- Necesarias para que los cron jobs puedan llamar Edge Functions
-- Ejecutar con los valores reales:
-- ALTER DATABASE postgres SET app.supabase_url = 'https://wwnfonkvemimwiqjpkij.supabase.co';
-- ALTER DATABASE postgres SET app.service_role_key = 'eyJ...';

-- ── 8. VERIFICACIÓN FINAL ────────────────────────────────────────────────────
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'profiles','students','classrooms','payments','tasks','task_evidences',
    'periods','report_cards','audit_logs','login_attempts','door_punches'
  ];
  t text;
  v_count int;
BEGIN
  RAISE NOTICE '=== Verificación de tablas ===';
  FOREACH t IN ARRAY v_tables LOOP
    SELECT COUNT(*) INTO v_count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = t;
    IF v_count > 0 THEN
      RAISE NOTICE '✅ %', t;
    ELSE
      RAISE NOTICE '❌ FALTA: %', t;
    END IF;
  END LOOP;

  RAISE NOTICE '=== Verificación de funciones RPC ===';
  DECLARE
    v_funcs text[] := ARRAY[
      'run_payment_cycle','close_period','get_active_period',
      'get_tasks_for_period','get_posts_for_period','approve_payment',
      'delete_payment','waive_payment_mora','calc_mora','process_door_punch'
    ];
    f text;
  BEGIN
    FOREACH f IN ARRAY v_funcs LOOP
      SELECT COUNT(*) INTO v_count FROM pg_proc
      WHERE proname = f AND pronamespace = 'public'::regnamespace;
      IF v_count > 0 THEN
        RAISE NOTICE '✅ %', f;
      ELSE
        RAISE NOTICE '❌ FALTA RPC: %', f;
      END IF;
    END LOOP;
  END;
END $$;
