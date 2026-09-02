-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · SQL OPERATIVO 07/10 — SEGURIDAD · STORAGE · CRON · VISTAS
-- ═══════════════════════════════════════════════════════════════════════════
-- Continuación del esquema maestro (karpus_schema_completo.sql).
-- Contenido: SECCIÓN 19 auditoría y validación · 20 event schedule · 21 búsqueda estudiantes · 22 storage buckets/políticas · 23 vista fuerza bruta · 24 active tasks · 25 permisos · 26 cron jobs
-- Origen: líneas 3867–4216 del archivo original.
--
-- ⚠ EJECUTAR EN ORDEN: 01 → 10 (Supabase Dashboard → SQL Editor)
--   Cada archivo continúa el esquema del anterior; no saltarse ninguno
--   en una base nueva. En la base existente son idempotentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- SECCIÓN 19: SEGURIDAD — triggers de auditoría y validación
-- ══════════════════════════════════════════════════════════════

-- Auditoría de pagos (trigger inmutable)
CREATE OR REPLACE FUNCTION public.fn_audit_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text; v_payload jsonb; v_user_id uuid;
BEGIN
  BEGIN v_user_id := auth.uid(); EXCEPTION WHEN OTHERS THEN v_user_id := NULL; END;
  IF TG_OP = 'INSERT' THEN
    v_action := 'payment.created';
    v_payload := jsonb_build_object('payment_id',NEW.id,'student_id',NEW.student_id,'amount',NEW.amount,'month',NEW.month_paid,'status',NEW.status,'method',NEW.method,'concept',NEW.concept);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status OR OLD.amount IS DISTINCT FROM NEW.amount OR OLD.due_date IS DISTINCT FROM NEW.due_date THEN
      v_action := CASE WHEN NEW.status='paid' AND OLD.status!='paid' THEN 'payment.approved'
                       WHEN NEW.status='overdue' AND OLD.status!='overdue' THEN 'payment.overdue'
                       WHEN NEW.status='rejected' THEN 'payment.rejected'
                       WHEN OLD.due_date IS DISTINCT FROM NEW.due_date THEN 'payment.mora_waived'
                       ELSE 'payment.updated' END;
      v_payload := jsonb_build_object('payment_id',NEW.id,'student_id',NEW.student_id,'amount',NEW.amount,'month',NEW.month_paid,'old_status',OLD.status,'new_status',NEW.status);
    ELSE RETURN NEW; END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'payment.deleted';
    v_payload := jsonb_build_object('payment_id',OLD.id,'student_id',OLD.student_id,'amount',OLD.amount,'month',OLD.month_paid,'status',OLD.status);
  END IF;
  INSERT INTO public.audit_logs (user_id, action, payload, created_at) VALUES (v_user_id, v_action, v_payload, now());
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_audit_payment ON public.payments;
CREATE TRIGGER trg_audit_payment AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_payment();

-- Proteger pagos aprobados
CREATE OR REPLACE FUNCTION public.fn_protect_paid_records()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'paid' AND (SELECT role FROM public.profiles WHERE id = auth.uid()) NOT IN ('admin') THEN
    RAISE EXCEPTION 'No se puede modificar o eliminar un pago ya validado y aprobado.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_paid_records ON public.payments;
CREATE TRIGGER trg_protect_paid_records BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_paid_records();

-- Auto pasar a "review" al subir comprobante
CREATE OR REPLACE FUNCTION public.fn_on_payment_evidence_uploaded()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ((NEW.proof_url IS NOT NULL AND NEW.proof_url <> '') AND (OLD.proof_url IS NULL OR OLD.proof_url = '')) OR
     ((NEW.evidence_url IS NOT NULL AND NEW.evidence_url <> '') AND (OLD.evidence_url IS NULL OR OLD.evidence_url = '')) THEN
    IF NEW.status IN ('pending','overdue') THEN
      NEW.status := 'review';
      NEW.notes := COALESCE(NEW.notes||' | ','')||'Comprobante subido - Pendiente de validación';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_on_evidence_uploaded ON public.payments;
CREATE TRIGGER trg_on_evidence_uploaded BEFORE UPDATE OF proof_url, evidence_url ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_on_payment_evidence_uploaded();

-- Auditoría de cambios de rol/perfil
CREATE OR REPLACE FUNCTION public.fn_audit_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text; v_payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'profile.created'; v_payload := jsonb_build_object('target_user',NEW.id,'name',NEW.name,'email',NEW.email,'role',NEW.role);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := CASE WHEN OLD.role IS DISTINCT FROM NEW.role THEN 'profile.role_changed' ELSE 'profile.updated' END;
    v_payload := jsonb_build_object('target_user',NEW.id,'old',jsonb_build_object('role',OLD.role,'name',OLD.name),'new',jsonb_build_object('role',NEW.role,'name',NEW.name));
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'profile.deleted'; v_payload := jsonb_build_object('target_user',OLD.id,'name',OLD.name,'role',OLD.role);
  END IF;
  INSERT INTO public.audit_logs (user_id, action, payload, created_at) VALUES (auth.uid(), v_action, v_payload, now()) ON CONFLICT DO NOTHING;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS audit_role_change ON public.profiles;
CREATE TRIGGER audit_role_change AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_role_change();

-- Validar cambios de rol (solo directora/admin)
CREATE OR REPLACE FUNCTION public.fn_validate_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_current_role text;
BEGIN
  SELECT role INTO v_current_role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
  IF TG_OP = 'INSERT' AND v_current_role NOT IN ('directora','admin') THEN
    RAISE EXCEPTION 'Solo directora o admin pueden crear perfiles';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role AND v_current_role NOT IN ('directora','admin') THEN
    RAISE EXCEPTION 'Solo directora o admin pueden modificar roles';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_role_change ON public.profiles;
CREATE TRIGGER trg_validate_role_change BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_role_change();

-- Validar avatar_url (XSS prevention)
CREATE OR REPLACE FUNCTION public.fn_validate_avatar_url()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.avatar_url IS NOT NULL THEN
    IF NEW.avatar_url ~ '["''<>\\]' THEN RAISE EXCEPTION 'avatar_url contiene caracteres no permitidos'; END IF;
    IF NOT (NEW.avatar_url ~ '^https?://' OR NEW.avatar_url ~ '^/img/') THEN
      RAISE EXCEPTION 'avatar_url inválido: solo URLs http(s) o rutas /img/';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_avatar_profiles ON public.profiles;
CREATE TRIGGER trg_validate_avatar_profiles BEFORE INSERT OR UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_avatar_url();
DROP TRIGGER IF EXISTS trg_validate_avatar_students ON public.students;
CREATE TRIGGER trg_validate_avatar_students BEFORE INSERT OR UPDATE OF avatar_url ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_avatar_url();

-- Reports: triggers de updated_at y auditoría
DROP TRIGGER IF EXISTS set_reports_updated_at ON public.reports;
CREATE TRIGGER set_reports_updated_at BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_report_actions_updated_at ON public.report_actions;
CREATE TRIGGER set_report_actions_updated_at BEFORE UPDATE ON public.report_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.audit_report_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.report_history (report_id, action, changed_by, old_values, new_values)
  VALUES (COALESCE(NEW.id, OLD.id),
    CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END,
    auth.uid(), CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) ELSE NULL END);
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS audit_report_changes ON public.reports;
CREATE TRIGGER audit_report_changes AFTER INSERT OR UPDATE OR DELETE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.audit_report_change();

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 20: EVENT SCHEDULE — get_classroom_schedule, log_timeline_event
-- Backfill de categorías de eventos
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_classroom_schedule(p_classroom_id bigint)
RETURNS TABLE (
  event_type text, event_label text, event_icon text, category text,
  sched_hour smallint, sched_minute smallint, duration_min smallint,
  auto_register boolean, applies_to text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT s.event_type, s.event_label, s.event_icon, s.category,
    s.scheduled_hour, s.scheduled_minute, s.duration_minutes, s.auto_register, s.applies_to
  FROM public.classroom_event_schedule s
  WHERE s.classroom_id = p_classroom_id AND s.is_active = true
  ORDER BY s.sort_order, s.scheduled_hour, s.scheduled_minute;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_classroom_schedule(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_timeline_event(
  p_classroom_id bigint, p_event_type text, p_registered_by uuid,
  p_target_students bigint[], p_scheduled_time time DEFAULT NULL,
  p_duration_minutes smallint DEFAULT NULL, p_metadata jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.timeline_event_log (classroom_id, event_type, registered_by, target_students,
    student_count, scheduled_time, actual_time, duration_minutes, metadata)
  VALUES (p_classroom_id, p_event_type, p_registered_by, p_target_students,
    array_length(p_target_students,1), p_scheduled_time, CURRENT_TIME, p_duration_minutes, p_metadata);
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_timeline_event(bigint,text,uuid,bigint[],time,smallint,jsonb) TO authenticated;

-- Backfill categorías de eventos existentes
UPDATE public.classroom_event_schedule SET category = CASE event_type
  WHEN 'desayuno' THEN 'alimentacion' WHEN 'almuerzo' THEN 'alimentacion'
  WHEN 'merienda' THEN 'alimentacion' WHEN 'biberon' THEN 'alimentacion'
  WHEN 'agua' THEN 'alimentacion' WHEN 'fruta' THEN 'alimentacion'
  WHEN 'temperatura' THEN 'salud' WHEN 'medicamento' THEN 'salud'
  WHEN 'fiebre' THEN 'salud' WHEN 'malestar' THEN 'salud'
  WHEN 'siesta' THEN 'descanso' WHEN 'descanso_corto' THEN 'descanso'
  WHEN 'panal_humedo' THEN 'higiene' WHEN 'panal_sucio' THEN 'higiene'
  WHEN 'bano' THEN 'higiene' WHEN 'cepillado' THEN 'higiene' WHEN 'lavado_manos' THEN 'higiene'
  WHEN 'actividad' THEN 'actividades' WHEN 'manualidad' THEN 'actividades'
  WHEN 'musica' THEN 'actividades' WHEN 'baile' THEN 'actividades' WHEN 'gimnasia' THEN 'actividades'
  WHEN 'patio' THEN 'juego' WHEN 'juego_libre' THEN 'juego'
  WHEN 'bienvenida' THEN 'social' WHEN 'convivencia' THEN 'social'
  WHEN 'proyecto' THEN 'aprendizaje' WHEN 'lectura' THEN 'aprendizaje'
  WHEN 'escritura' THEN 'aprendizaje' WHEN 'matematicas' THEN 'aprendizaje'
  WHEN 'paseo' THEN 'exterior' WHEN 'huerta' THEN 'exterior'
  WHEN 'accidente' THEN 'incidentes' WHEN 'golpe' THEN 'incidentes'
  WHEN 'pelea' THEN 'incidentes' WHEN 'llamada_padres' THEN 'incidentes'
  ELSE 'personalizados'
END
WHERE category = 'personalizados' OR category IS NULL;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 21: BÚSQUEDA DE ESTUDIANTES (full-text)
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.search_students(query text)
RETURNS SETOF public.students LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.students
  WHERE search_vector @@ plainto_tsquery('simple', query)
     OR lower(name) LIKE lower('%'||query||'%')
     OR lower(COALESCE(matricula,'')) LIKE lower('%'||query||'%')
  ORDER BY ts_rank(search_vector, plainto_tsquery('simple', query)) DESC
  LIMIT 50;
$$;
GRANT EXECUTE ON FUNCTION public.search_students(text) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 22: STORAGE — buckets y políticas
-- ══════════════════════════════════════════════════════════════

-- Bucket: avatars
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars','avatars',true,5242880,ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public=true, file_size_limit=5242880,
  allowed_mime_types=ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif'];

-- Bucket: classroom_media
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('classroom_media','classroom_media',true,52428800,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public=true, file_size_limit=52428800;

-- Bucket: karpus-uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('karpus-uploads','karpus-uploads',true,5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public=true, file_size_limit=5242880;

-- Políticas storage: avatars
DROP POLICY IF EXISTS "avatars_public_read"  ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
CREATE POLICY "avatars_auth_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id='avatars' AND auth.role()='authenticated');
DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
CREATE POLICY "avatars_auth_update" ON storage.objects FOR UPDATE USING (bucket_id='avatars' AND auth.role()='authenticated');
DROP POLICY IF EXISTS "avatars_auth_delete" ON storage.objects;
CREATE POLICY "avatars_auth_delete" ON storage.objects FOR DELETE USING (bucket_id='avatars' AND auth.role()='authenticated');

-- Políticas storage: classroom_media
DROP POLICY IF EXISTS "classroom_media_public_read" ON storage.objects;
CREATE POLICY "classroom_media_public_read" ON storage.objects FOR SELECT USING (bucket_id='classroom_media');
DROP POLICY IF EXISTS "classroom_media_auth_insert" ON storage.objects;
CREATE POLICY "classroom_media_auth_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id='classroom_media' AND auth.role()='authenticated');
DROP POLICY IF EXISTS "classroom_media_auth_update" ON storage.objects;
CREATE POLICY "classroom_media_auth_update" ON storage.objects FOR UPDATE USING (bucket_id='classroom_media' AND auth.role()='authenticated');

-- Políticas storage: karpus-uploads
DROP POLICY IF EXISTS "karpus_uploads_public_read" ON storage.objects;
CREATE POLICY "karpus_uploads_public_read" ON storage.objects FOR SELECT USING (bucket_id='karpus-uploads');
DROP POLICY IF EXISTS "karpus_uploads_auth_insert" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id='karpus-uploads' AND auth.role()='authenticated');
DROP POLICY IF EXISTS "karpus_uploads_auth_update" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_update" ON storage.objects FOR UPDATE USING (bucket_id='karpus-uploads' AND auth.role()='authenticated');
DROP POLICY IF EXISTS "karpus_uploads_auth_delete" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_delete" ON storage.objects FOR DELETE USING (bucket_id='karpus-uploads' AND auth.role()='authenticated');

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 23: VISTA DE FUERZA BRUTA
-- ══════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.v_brute_force_attempts;
CREATE VIEW public.v_brute_force_attempts AS
SELECT
  email,
  COUNT(*) FILTER (WHERE success = false) AS failed_attempts,
  COUNT(*) FILTER (WHERE success = true)  AS successful_logins,
  MAX(created_at) AS last_attempt,
  CASE WHEN COUNT(*) FILTER (WHERE success=false AND created_at > NOW()-INTERVAL '1 hour') >= 5 THEN true ELSE false END AS is_suspicious
FROM public.login_attempts
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY email
ORDER BY failed_attempts DESC, last_attempt DESC;
GRANT SELECT ON public.v_brute_force_attempts TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 24: VISTA ACTIVE TASKS
-- ══════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.v_active_tasks;
CREATE VIEW public.v_active_tasks AS
SELECT t.*, p.name AS period_name, p.status AS period_status
FROM public.tasks t
LEFT JOIN public.periods p ON p.id = t.period_id
WHERE p.is_active = true
  OR (t.period_id IS NULL AND EXISTS (
    SELECT 1 FROM public.periods ap WHERE ap.classroom_id = t.classroom_id AND ap.is_active = true
      AND t.created_at BETWEEN ap.start_date AND ap.end_date + INTERVAL '1 day'));
GRANT SELECT ON public.v_active_tasks TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 25: PERMISOS GENERALES
-- ══════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.likes               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_logs          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.door_punches        TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public              TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 26: CRON JOBS (requiere pg_cron habilitado)
-- Dashboard → Database → Extensions → pg_cron → Enable
-- Reemplaza TU_REF y SERVICE_ROLE_KEY con tus valores reales.
-- ══════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('karpus-mark-overdue');            EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('karpus-payment-cycle');           EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('karpus-payment-reminders-daily'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('karpus-cleanup-logs');            EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Marcar vencidos: cada día 6AM hora RD (10:00 UTC)
    PERFORM cron.schedule('karpus-mark-overdue','0 10 * * *',
      $c$UPDATE public.payments SET status='overdue', updated_at=now() WHERE status='pending' AND due_date < CURRENT_DATE AND deleted_at IS NULL;$c$);

    -- Ciclo de pagos: día 1 de cada mes 6AM hora RD
    PERFORM cron.schedule('karpus-payment-cycle','0 10 1 * *',
      $c$SELECT net.http_post(url:='https://TU_REF.supabase.co/functions/v1/auto-payment-cycle',headers:='{"Content-Type":"application/json","Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb,body:='{"force":true}'::jsonb);$c$);

    -- Recordatorios: cada día 9AM hora RD
    PERFORM cron.schedule('karpus-payment-reminders-daily','0 13 * * *',
      $c$SELECT net.http_post(url:='https://TU_REF.supabase.co/functions/v1/payment-reminders',headers:='{"Content-Type":"application/json","Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb,body:='{"action":"auto"}'::jsonb);$c$);

    -- Limpieza de logs: día 1 de cada mes 3AM UTC
    PERFORM cron.schedule('karpus-cleanup-logs','0 3 1 * *',
      $c$DELETE FROM public.login_attempts WHERE created_at < NOW()-INTERVAL '30 days'; DELETE FROM public.system_errors WHERE created_at < NOW()-INTERVAL '90 days';$c$);
  ELSE
    RAISE NOTICE 'pg_cron no instalado. Activar en Dashboard → Database → Extensions';
  END IF;
END $$;
-- ═════════════════════════════════════════════════════════════════════════════
-- PARTE B · MIGRACIONES POSTERIORES INTEGRADAS
-- ═════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════
