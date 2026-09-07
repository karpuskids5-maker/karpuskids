-- ═══════════════════════════════════════════════════════════════════════════
-- 17_seguridad_backup_mejoras.sql
-- Karpus Kids — Mejoras de seguridad, backup y datos
--
--  1. Tabla `recovery_requests` para rate-limit de recuperación de contraseña
--  2. RPC `run_daily_backup` — dispara el backup a Google Sheets de forma segura
--     (SOLO directora/admin, evita llamar edge functions de forma abierta)
--  3. Función de cron para limpiar datos sensibles (audit purge policy)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. recovery_requests: registro de intentos de recuperación ─────────────
CREATE TABLE IF NOT EXISTS public.recovery_requests (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recovery_requests_email_time
  ON public.recovery_requests (email, created_at DESC);

ALTER TABLE public.recovery_requests ENABLE ROW LEVEL SECURITY;
-- Solo el service_role (edge function) puede insertar/leer
DROP POLICY IF EXISTS "recovery_requests_service_only" ON public.recovery_requests;
CREATE POLICY "recovery_requests_service_only"
  ON public.recovery_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 2. Vista de salud de backups (para el panel de control) ────────────────
CREATE OR REPLACE VIEW public.v_backup_status AS
SELECT
  COALESCE(MAX(created_at), NULL) AS last_backup_at,
  COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS backups_last_24h,
  COUNT(*) AS total_backups
FROM public.system_events
WHERE type = 'backup.completed';

-- ── 3. RPC run_daily_backup — invocable por directora/admin ────────────────
--    Dispara REALMENTE la edge function backup-to-sheets vía pg_net usando el
--    service role key (que backup-to-sheets acepta como caller interno).
--    Evita exponer la edge function backup-to-sheets sin auth.
CREATE OR REPLACE FUNCTION public.run_daily_backup()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_rec record;
  v_url text;
  v_headers jsonb;
  v_body jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','admin') THEN
    RETURN jsonb_build_object('error','No tienes permisos para ejecutar el backup');
  END IF;

  -- Leer la URL de la función desde kiosk_config (reutilizamos la tabla de
  -- configuración para no duplicar constantes).
  SELECT base_url INTO v_rec FROM public.kiosk_config WHERE id = 1;
  v_url := COALESCE(v_rec.base_url, 'https://wwnfonkvemimwiqjpkij.supabase.co/functions/v1')
           || '/backup-to-sheets';

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || COALESCE(
      current_setting('secrets.service_role_key', true),
      'REEMPLAZAR_CON_SERVICE_ROLE_KEY'
    )
  );
  v_body := jsonb_build_object('force', true, 'source', 'panel_control');

  -- Invocar backup de forma asíncrona (pg_net); no bloquea la respuesta
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM net.http_post(url := v_url, headers := v_headers, body := v_body);
  END IF;

  -- Registrar intención de backup
  INSERT INTO public.system_events (type, payload, status)
  VALUES ('backup.requested', jsonb_build_object('requested_by', auth.uid(), 'source', 'panel_control'), 'pending');

  RETURN jsonb_build_object('ok', true, 'message', 'Backup solicitado. Revisa la pestaña Configuración > Backup para el resultado.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_daily_backup() TO authenticated;

-- NOTA: Para el servicio automático real debes guardar el service role key en
-- una variable de configuración segura, o configurar un secreto en el panel:
--   ALTER ROLE postgres SET "secrets.service_role_key" = '<SERVICE_ROLE_KEY>';
-- Y para programarlo diario además:
--   SELECT cron.schedule('daily-backup', '0 8 * * *',
--     $$SELECT net.http_post(url:='https://wwnfonkvemimwiqjpkij.supabase.co/functions/v1/backup-to-sheets',
--       headers:='{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
--       body:='{"force":true,"source":"cron"}'::jsonb);$$);

-- ── 4. Purga de datos sensibles (retención) ────────────────────────────────
--    Elimina registros de auditoría y eventos mayores a 12 meses para
--    cumplir política de retención y evitar crecimiento descontrolado.
CREATE OR REPLACE FUNCTION public.purge_old_audit_logs(p_months int DEFAULT 12)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM public.audit_logs
  WHERE created_at < now() - (p_months || ' months')::interval;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_old_audit_logs(int) FROM authenticated, anon;

-- ── 5. KIOSK: notificaciones seguras vía trigger + pg_net ───────────────────
--    Cuando un estudiante marca entrada/salida (door_punches insert/update),
--    se invoca la Edge Function kiosk-notify con el secreto compartido
--    server-side. Así el navegador del kiosco NUNCA llama a edge functions
--    ni posee credenciales de notificación.
--    Requisitos:
--      1. Extensión pg_net habilitada (Dashboard → Database → Extensions).
--      2. Configurar KIOSK_SECRET en la edge function kiosk-notify (dashboard),
--         y el MISMO valor en esta tabla de configuración (aquí abajo).
--      3. Ajustar base_url + function_secret según tu proyecto.
-- NOTA: El trigger usa pg_net de forma ASÍNCRONA y registra en system_events.
CREATE TABLE IF NOT EXISTS public.kiosk_config (
  id                 int PRIMARY KEY,
  function_secret    text NOT NULL DEFAULT '',
  base_url           text NOT NULL DEFAULT 'https://wwnfonkvemimwiqjpkij.supabase.co/functions/v1',
  function_name      text NOT NULL DEFAULT 'kiosk-notify',
  paused             boolean NOT NULL DEFAULT false
);
ALTER TABLE public.kiosk_config ENABLE ROW LEVEL SECURITY;
-- Solo el servicio/admin la lee; no exponer el secreto a clientes.
CREATE POLICY kiosk_config_none ON public.kiosk_config FOR ALL USING (false);

CREATE OR REPLACE FUNCTION public.trigger_kiosk_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student_name text;
  v_parent uuid;
  v_cfg public.kiosk_config%ROWTYPE;
  v_url text;
  v_headers jsonb;
  v_body jsonb;
BEGIN
  -- Solo estudiantes (staff no tiene parent a notificar)
  IF NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Config desactivada → no hacer nada
  SELECT * INTO v_cfg FROM public.kiosk_config WHERE id = 1;
  IF NOT FOUND OR v_cfg.paused OR v_cfg.function_secret = '' THEN
    RETURN NEW;
  END IF;

  SELECT name, parent_id INTO v_student_name, v_parent
  FROM public.students WHERE id = NEW.student_id;

  IF v_parent IS NULL THEN
    RETURN NEW;
  END IF;

  v_url := rtrim(v_cfg.base_url, '/') || '/' || v_cfg.function_name;
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Kiosk-Secret', v_cfg.function_secret
  );
  v_body := jsonb_build_object(
    'student_id', NEW.student_id,
    'student_name', v_student_name,
    'parent_id', v_parent,
    'type', NEW.punch_type,
    'time', to_char(NEW.punched_at AT TIME ZONE 'America/Santo_Domingo', 'HH12:MI AM')
  );

  -- Invocación asíncrona via pg_net
  PERFORM net.http_post(
    url := v_url,
    headers := v_headers,
    body := v_body
  );

  -- Registro de auditoría
  INSERT INTO public.system_events (type, status, payload)
  VALUES ('kiosk.notify', 'queued', v_body);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kiosk_notify ON public.door_punches;
CREATE TRIGGER trg_kiosk_notify
  AFTER INSERT OR UPDATE OF punch_type ON public.door_punches
  FOR EACH ROW EXECUTE FUNCTION public.trigger_kiosk_notify();

-- Indicar la extensión requerida si está disponible (no falla si no existe)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Insertar config por defecto (editar function_secret con el MISMO valor de la
-- env KIOSK_SECRET configurada en la edge function, y base_url si cambia)
INSERT INTO public.kiosk_config (id, function_secret, base_url, function_name, paused)
VALUES (1, '', 'https://wwnfonkvemimwiqjpkij.supabase.co/functions/v1', 'kiosk-notify', true)
ON CONFLICT (id) DO NOTHING;

-- ── 6. Seguridad adicional: revoke direct table DML en pagos (forzar RPCs) ──
--    Nota: este hardening opcional se comenta porque podría romper flujos
--    que aún usan updates directos. Descomentar SOLO cuando todos los flujos
--    migren a RPCs.
-- REVOKE UPDATE, DELETE ON public.payments FROM authenticated;
-- REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;
