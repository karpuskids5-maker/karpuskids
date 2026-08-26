-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · SQL OPERATIVO 04/10 — FUNCIONES: MORA · PAGOS · ASISTENCIA · CHAT
-- ═══════════════════════════════════════════════════════════════════════════
-- Continuación del esquema maestro (karpus_schema_completo.sql).
-- Contenido: SECCIÓN 9 utilitarias · 10 mora v2 · 11 ciclo de pagos · 12 approve/delete/waive/reset · 13 process_door_punch · 14 chat RPCs
-- Origen: líneas 1504–2109 del archivo original.
--
-- ⚠ EJECUTAR EN ORDEN: 01 → 10 (Supabase Dashboard → SQL Editor)
--   Cada archivo continúa el esquema del anterior; no saltarse ninguno
--   en una base nueva. En la base existente son idempotentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- SECCIÓN 9: FUNCIONES UTILITARIAS
-- ══════════════════════════════════════════════════════════════

-- set_updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- handle_new_user (auth trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role, accepted_terms)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    COALESCE(NEW.raw_user_meta_data->>'role','padre'),
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- update_post_comments_count
CREATE OR REPLACE FUNCTION public.update_post_comments_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id; RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET comments_count = GREATEST(0, comments_count - 1) WHERE id = OLD.post_id; RETURN OLD;
  END IF; RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS on_comment_change ON public.comments;
CREATE TRIGGER on_comment_change AFTER INSERT OR DELETE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.update_post_comments_count();

-- update_post_likes_count
CREATE OR REPLACE FUNCTION public.update_post_likes_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id; RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.post_id; RETURN OLD;
  END IF; RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS on_like_change ON public.likes;
CREATE TRIGGER on_like_change AFTER INSERT OR DELETE ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.update_post_likes_count();

-- handle_new_post_teacher_info
CREATE OR REPLACE FUNCTION public.handle_new_post_teacher_info()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.teacher_id IS NOT NULL THEN
    NEW.teacher_name   := (SELECT name       FROM public.profiles WHERE id = NEW.teacher_id LIMIT 1);
    NEW.teacher_avatar := (SELECT avatar_url FROM public.profiles WHERE id = NEW.teacher_id LIMIT 1);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_new_post_populate_teacher ON public.posts;
CREATE TRIGGER on_new_post_populate_teacher BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_post_teacher_info();

-- send_notification (overloads)
CREATE OR REPLACE FUNCTION public.send_notification(p_user_id uuid, p_type text, p_message text, p_data jsonb DEFAULT '{}', p_link text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, link, is_read, created_at)
  VALUES (p_user_id, p_type, p_message, p_type, p_link, false, now()) ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.send_notification(p_user_id uuid, p_type text, p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, is_read, created_at)
  VALUES (p_user_id, p_type, p_message, p_type, false, now()) ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_notification(uuid, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_notification(uuid, text, text) TO authenticated;

-- is_email_under_attack
CREATE OR REPLACE FUNCTION public.is_email_under_attack(p_email text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) >= 10 FROM public.login_attempts
  WHERE email = p_email AND success = false AND created_at > NOW() - INTERVAL '1 hour';
$$;
GRANT EXECUTE ON FUNCTION public.is_email_under_attack(text) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 10: FUNCIÓN MORA (Centralizada v2)
-- Regla: bloques de 7 días × RD$500 + días restantes × RD$50
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.calculate_mora_v2(p_amount numeric, p_due_date date, p_status text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_days_late int;
  v_bloques int;
  v_dias_restantes int;
BEGIN
  IF p_status = 'paid' OR p_status = 'rejected' OR p_due_date IS NULL OR p_due_date >= CURRENT_DATE THEN
    RETURN 0;
  END IF;
  v_days_late := (CURRENT_DATE - p_due_date)::int;
  v_bloques := FLOOR(v_days_late / 7);
  v_dias_restantes := v_days_late % 7;
  RETURN (v_bloques * 500) + (v_dias_restantes * 50);
END;
$$;

-- Alias corto
CREATE OR REPLACE FUNCTION public.calc_mora(p_due_date date)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_days_late int; v_bloques int; v_resto int;
BEGIN
  v_days_late := (CURRENT_DATE - p_due_date)::int;
  IF v_days_late <= 0 THEN RETURN 0; END IF;
  v_bloques := v_days_late / 7;
  v_resto   := v_days_late % 7;
  RETURN (v_bloques * 500) + (v_resto * 50);
END;
$$;

-- Vista con mora
DROP VIEW IF EXISTS public.v_payments_with_mora;
CREATE VIEW public.v_payments_with_mora AS
SELECT
  p.*,
  public.calculate_mora_v2(p.amount, p.due_date, p.status) AS mora_amount,
  public.calculate_mora_v2(p.amount, p.due_date, p.status) AS calculated_mora,
  (p.amount + public.calculate_mora_v2(p.amount, p.due_date, p.status)) AS total_due,
  (CURRENT_DATE - p.due_date)::int AS days_late,
  s.name          AS student_name,
  s.p1_name       AS parent_name,
  s.p1_email      AS parent_email,
  s.p1_phone      AS parent_phone,
  s.p2_name       AS parent2_name,
  s.p2_email      AS parent2_email,
  s.p2_phone      AS parent2_phone,
  c.name          AS classroom_name,
  ap.name         AS approved_by_name
FROM public.payments p
LEFT JOIN public.students  s  ON s.id = p.student_id
LEFT JOIN public.classrooms c ON c.id = s.classroom_id
LEFT JOIN public.profiles  ap ON ap.id = p.validated_by
WHERE p.deleted_at IS NULL;
GRANT SELECT ON public.v_payments_with_mora TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 11: CICLO DE PAGOS (run_payment_cycle con regla de gracia)
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.run_payment_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role          text;
  v_gen_day       int;
  v_due_day       int;
  v_now           date := current_date;
  v_target_month  text;
  v_due_date      date;
  v_generated     int := 0;
  v_expired       int := 0;
  v_student       record;
  v_start_day     int;
  v_first_billing text;
  v_first_m       int;
  v_first_y       int;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden ejecutar el ciclo de pagos';
  END IF;

  SELECT COALESCE(generation_day,25), COALESCE(due_day,5) INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  v_target_month := to_char(v_now, 'YYYY-MM');
  v_due_date     := (date_trunc('month', v_now + interval '1 month') + (v_due_day - 1) * interval '1 day')::date;

  FOR v_student IN
    SELECT s.id, s.monthly_fee, s.prolongado_fee, s.start_date
    FROM public.students s
    WHERE s.is_active = true AND s.monthly_fee > 0 AND s.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id AND p.month_paid = v_target_month AND p.concept = 'Mensualidad' AND p.deleted_at IS NULL
      )
  LOOP
    IF v_student.start_date IS NOT NULL THEN
      v_start_day := EXTRACT(DAY FROM v_student.start_date)::int;
      IF v_start_day < v_gen_day THEN
        v_first_m := EXTRACT(MONTH FROM v_student.start_date)::int;
        v_first_y := EXTRACT(YEAR FROM v_student.start_date)::int;
        IF v_first_m = 12 THEN v_first_m := 1; v_first_y := v_first_y + 1;
        ELSE v_first_m := v_first_m + 1; END IF;
      ELSE
        v_first_m := EXTRACT(MONTH FROM v_student.start_date)::int + 2;
        v_first_y := EXTRACT(YEAR FROM v_student.start_date)::int;
        IF v_first_m > 12 THEN v_first_m := v_first_m - 12; v_first_y := v_first_y + 1; END IF;
      END IF;
      v_first_billing := v_first_y || '-' || LPAD(v_first_m::text, 2, '0');
      IF v_target_month < v_first_billing THEN CONTINUE; END IF;
    END IF;

    INSERT INTO public.payments (student_id, amount, status, due_date, month_paid, concept, created_at)
    VALUES (v_student.id, v_student.monthly_fee, 'pending', v_due_date, v_target_month, 'Mensualidad', now())
    ON CONFLICT DO NOTHING;
    v_generated := v_generated + 1;

    IF v_student.prolongado_fee > 0 THEN
      INSERT INTO public.payments (student_id, amount, status, due_date, month_paid, concept, created_at)
      VALUES (v_student.id, v_student.prolongado_fee, 'pending', v_due_date, v_target_month, 'Día Prolongado', now())
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  UPDATE public.payments SET status = 'overdue', updated_at = now()
  WHERE status = 'pending' AND due_date < v_now AND deleted_at IS NULL;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object('generated', v_generated, 'expired', v_expired, 'month', v_target_month, 'due_date', v_due_date::text);
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_payment_cycle() TO authenticated;

-- preview_payment_cycle
CREATE OR REPLACE FUNCTION public.preview_payment_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gen_day int; v_today int := extract(day from current_date)::int;
  v_target_month text; v_gen_count int := 0; v_total_amount numeric := 0;
  v_grace_count int := 0; v_existing_count int := 0;
BEGIN
  SELECT COALESCE(generation_day,25) INTO v_gen_day FROM public.school_settings WHERE id = 1;
  v_target_month := to_char(current_date, 'YYYY-MM');
  SELECT count(*), coalesce(sum(monthly_fee + prolongado_fee),0)
  INTO v_gen_count, v_total_amount
  FROM public.students WHERE is_active = true AND monthly_fee > 0
    AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.student_id = students.id AND p.month_paid = v_target_month AND p.deleted_at IS NULL);
  SELECT count(DISTINCT student_id) INTO v_existing_count
  FROM public.payments WHERE month_paid = v_target_month AND deleted_at IS NULL;
  RETURN jsonb_build_object('target_month', v_target_month, 'count', v_gen_count,
    'total_amount', v_total_amount, 'existing_count', v_existing_count);
END;
$$;

-- check_payment_cycle_health
CREATE OR REPLACE FUNCTION public.check_payment_cycle_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gen_day int; v_today int := extract(day from current_date)::int;
  v_month_key text; v_has_payments boolean;
BEGIN
  SELECT COALESCE(generation_day,25) INTO v_gen_day FROM public.school_settings WHERE id = 1;
  IF v_today < v_gen_day THEN
    RETURN jsonb_build_object('status','ok','message','Aún no llega el día de generación');
  END IF;
  v_month_key := to_char(current_date, 'YYYY-MM');
  SELECT EXISTS (SELECT 1 FROM public.payments WHERE month_paid = v_month_key AND concept = 'Mensualidad' AND deleted_at IS NULL)
  INTO v_has_payments;
  IF v_has_payments THEN RETURN jsonb_build_object('status','ok','message','Ciclo ejecutado correctamente');
  ELSE RETURN jsonb_build_object('status','error','message','El ciclo de pagos no se ha ejecutado todavía'); END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.preview_payment_cycle() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_payment_cycle_health() TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 12: PAGOS — approve, delete, waive, reset, annual
-- ══════════════════════════════════════════════════════════════

-- approve_payment (requiere comprobante para transferencias)
CREATE OR REPLACE FUNCTION public.approve_payment(p_payment_id bigint, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text; v_payment record; has_proof boolean;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error','No tienes permisos para aprobar pagos');
  END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','El pago no existe'); END IF;
  IF v_payment.status = 'paid' THEN RETURN jsonb_build_object('error','El pago ya fue aprobado'); END IF;
  has_proof := (v_payment.proof_url IS NOT NULL AND v_payment.proof_url <> '') OR
               (v_payment.evidence_url IS NOT NULL AND v_payment.evidence_url <> '');
  IF NOT has_proof AND (v_payment.method IS DISTINCT FROM 'efectivo') THEN
    RETURN jsonb_build_object('error','No se puede aprobar una transferencia sin comprobante cargado');
  END IF;
  UPDATE public.payments
  SET status='paid', paid_date=now(), validated_by=auth.uid(), notes=COALESCE(p_notes,notes,'Aprobado vía sistema')
  WHERE id = p_payment_id;
  RETURN jsonb_build_object('success',true,'payment_id',p_payment_id,'approved_by',auth.uid(),'approved_at',now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_payment(bigint, text) TO authenticated;

-- delete_payment (soft delete)
CREATE OR REPLACE FUNCTION public.delete_payment(p_payment_id bigint, p_reason text DEFAULT 'Eliminado por administración')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN RETURN jsonb_build_object('error','No autorizado'); END IF;
  UPDATE public.payments SET deleted_at=now(), notes=COALESCE(notes||' | ','')||p_reason||' ('||to_char(now(),'DD/MM/YYYY HH24:MI')||')'
  WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Pago no encontrado'); END IF;
  RETURN jsonb_build_object('success',true,'payment_id',p_payment_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_payment(bigint, text) TO authenticated;

-- waive_payment_mora
CREATE OR REPLACE FUNCTION public.waive_payment_mora(p_payment_id bigint, p_reason text DEFAULT 'Mora exonerada por administración')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_payment payments%ROWTYPE;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Pago no encontrado'); END IF;
  UPDATE public.payments SET due_date=CURRENT_DATE, last_reminder_sent=NULL,
    notes=COALESCE(notes||' | ','')||p_reason||' ('||to_char(now(),'DD/MM/YYYY')||')'
  WHERE id = p_payment_id;
  RETURN jsonb_build_object('success',true,'payment_id',p_payment_id,'new_due_date',CURRENT_DATE);
END;
$$;
GRANT EXECUTE ON FUNCTION public.waive_payment_mora(bigint, text) TO authenticated;

-- reset_payment_to_pending
CREATE OR REPLACE FUNCTION public.reset_payment_to_pending(p_payment_id bigint, p_reason text DEFAULT 'Reiniciado por administración')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payments SET status='pending', due_date=CURRENT_DATE+INTERVAL '7 days', last_reminder_sent=NULL,
    notes=COALESCE(notes||' | ','')||p_reason||' ('||to_char(now(),'DD/MM/YYYY')||')'
  WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Pago no encontrado'); END IF;
  RETURN jsonb_build_object('success',true,'payment_id',p_payment_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_payment_to_pending(bigint, text) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 13: ASISTENCIA — process_door_punch (versión final)
-- Incluye: zona horaria RD, validación código, student_id en respuesta
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.process_door_punch(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student  record; v_staff record; v_settings record;
  v_today    date := (now() AT TIME ZONE 'America/Santo_Domingo')::date;
  v_now      timestamp with time zone := now();
  v_local_time time := (now() AT TIME ZONE 'America/Santo_Domingo')::time;
  v_type     text; v_name text; v_role text; v_parent uuid;
  v_existing record; v_attendance record; v_status text := 'present';
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) < 3 THEN
    RETURN jsonb_build_object('success',false,'message','Código QR inválido');
  END IF;

  SELECT * INTO v_student FROM public.students WHERE matricula = trim(p_code) AND is_active = true LIMIT 1;
  IF FOUND THEN
    v_name := v_student.name; v_role := 'Estudiante'; v_parent := v_student.parent_id;
    SELECT * INTO v_settings FROM public.school_settings WHERE id = 1;
    SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_in';
    IF NOT FOUND THEN
      v_type := 'check_in';
      IF v_settings.check_in_end IS NOT NULL AND v_local_time > v_settings.check_in_end THEN v_status := 'late'; END IF;
      SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
      IF v_attendance.id IS NULL THEN
        INSERT INTO public.attendance (student_id, classroom_id, date, status, check_in)
        VALUES (v_student.id, v_student.classroom_id, v_today, v_status, v_now);
      ELSE
        UPDATE public.attendance SET status = v_status, check_in = v_now WHERE id = v_attendance.id;
      END IF;
      INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id,'check_in',v_now,v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out'; v_status := 'retirado';
        SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
        IF v_attendance.id IS NOT NULL THEN UPDATE public.attendance SET check_out = v_now, status = 'retirado' WHERE id = v_attendance.id; END IF;
        INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id,'check_out',v_now,v_today) ON CONFLICT DO NOTHING;

        -- Auto-crear evento "salida" en daily_logs para que aparezca en la rutina del padre
        BEGIN
          INSERT INTO public.daily_logs (student_id, classroom_id, date, status, events)
          VALUES (
            v_student.id, v_student.classroom_id, v_today, 'published',
            jsonb_build_array(
              jsonb_build_object(
                'type', 'salida',
                'scheduled_time', to_char(v_now AT TIME ZONE 'America/Santo_Domingo', 'HH12:MI AM'),
                'created_at', v_now::text,
                'comment', 'Salida registrada desde ponchador'
              )
            )
          )
          ON CONFLICT (student_id, date) DO UPDATE
            SET events = CASE
              WHEN NOT public.daily_logs.events @> '[{"type":"salida"}]'::jsonb
              THEN public.daily_logs.events || jsonb_build_array(
                jsonb_build_object(
                  'type', 'salida',
                  'scheduled_time', to_char(v_now AT TIME ZONE 'America/Santo_Domingo', 'HH12:MI AM'),
                  'created_at', v_now::text,
                  'comment', 'Salida registrada desde ponchador'
                )
              )
              ELSE public.daily_logs.events
            END;
        EXCEPTION WHEN OTHERS THEN
          -- Si falla la inserción del daily_log, no afecta el punch principal
          NULL;
        END;
      ELSE
        RETURN jsonb_build_object('success',false,'message',v_name||' ya registró entrada y salida hoy');
      END IF;
    END IF;
    RETURN jsonb_build_object('success',true,'type',v_type,'name',v_name,'role',v_role,'status',v_status,
      'student_id',v_student.id,'parent_id',v_parent,'time',to_char(v_now AT TIME ZONE 'America/Santo_Domingo','HH12:MI AM'));
  END IF;

  SELECT * INTO v_staff FROM public.profiles
  WHERE (notes=trim(p_code) OR matricula=trim(p_code) OR access_code=trim(p_code))
    AND role IN ('maestra','asistente','directora','admin') LIMIT 1;
  IF NOT FOUND THEN
    BEGIN SELECT * INTO v_staff FROM public.profiles WHERE id=trim(p_code)::uuid AND role IN ('maestra','asistente','directora','admin') LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF FOUND THEN
    v_name := v_staff.name; v_role := initcap(v_staff.role);
    SELECT * INTO v_existing FROM public.door_punches WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_in';
    IF NOT FOUND THEN
      v_type := 'check_in';
      INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date) VALUES (v_staff.id,'check_in',v_now,v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out';
        INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date) VALUES (v_staff.id,'check_out',v_now,v_today) ON CONFLICT DO NOTHING;
      ELSE
        RETURN jsonb_build_object('success',false,'message',v_name||' ya registró entrada y salida hoy');
      END IF;
    END IF;
    RETURN jsonb_build_object('success',true,'type',v_type,'name',v_name,'role',v_role,'status','present',
      'student_id',null,'parent_id',null,'time',to_char(v_now AT TIME ZONE 'America/Santo_Domingo','HH12:MI AM'));
  END IF;
  RETURN jsonb_build_object('success',false,'message','QR no registrado en el sistema');
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO anon;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 14: CHAT — find_or_create, get_direct_messages, mark_read, unread_counts
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.find_or_create_private_conversation(p_user1 uuid, p_user2 uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conv_id bigint;
BEGIN
  SELECT cp1.conversation_id INTO v_conv_id
  FROM public.conversation_participants cp1
  JOIN public.conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id AND cp2.user_id = p_user2
  JOIN public.conversations c ON c.id = cp1.conversation_id AND c.type = 'direct_message'
  WHERE cp1.user_id = p_user1 LIMIT 1;
  IF v_conv_id IS NOT NULL THEN RETURN v_conv_id; END IF;
  INSERT INTO public.conversations (type) VALUES ('direct_message') RETURNING id INTO v_conv_id;
  INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES (v_conv_id,p_user1),(v_conv_id,p_user2) ON CONFLICT DO NOTHING;
  RETURN v_conv_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.find_or_create_private_conversation(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_direct_messages(p_other_user_id uuid)
RETURNS TABLE (
  id              bigint, content text, sender_id uuid, created_at timestamp with time zone,
  is_read boolean, conversation_id bigint, sender_name text, sender_avatar text
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.content, m.sender_id, m.created_at, m.is_read, m.conversation_id,
         p.name AS sender_name, p.avatar_url AS sender_avatar
  FROM public.messages m
  LEFT JOIN public.profiles p ON m.sender_id = p.id
  WHERE m.conversation_id = (
    SELECT c.id FROM public.conversations c
    WHERE c.type IN ('direct_message','private')
      AND EXISTS (SELECT 1 FROM public.conversation_participants x WHERE x.conversation_id = c.id AND x.user_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.conversation_participants y WHERE y.conversation_id = c.id AND y.user_id = p_other_user_id)
    LIMIT 1
  )
  ORDER BY m.created_at ASC;
$$;
GRANT EXECUTE ON FUNCTION public.get_direct_messages(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_messages_read(p_conversation_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_my_id uuid := auth.uid();
BEGIN
  IF v_my_id IS NULL OR p_conversation_id IS NULL THEN RETURN; END IF;
  UPDATE public.messages SET is_read = true
  WHERE conversation_id = p_conversation_id AND sender_id <> v_my_id AND (is_read IS NULL OR is_read = false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_messages_read(bigint) TO authenticated;

-- get_unread_counts — devuelve mapa sender_id → count + total
CREATE OR REPLACE FUNCTION public.get_unread_counts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result  jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN RETURN v_result; END IF;
  SELECT jsonb_object_agg(m.sender_id, m.count) INTO v_result
  FROM (
    SELECT m.sender_id, count(*) AS count
    FROM public.messages m
    JOIN public.conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = v_user_id
    WHERE m.sender_id <> v_user_id AND m.is_read = false
    GROUP BY m.sender_id
  ) m;
  v_result := jsonb_set(
    COALESCE(v_result,'{}'),'{total}',
    to_jsonb(COALESCE((SELECT sum(count::int) FROM jsonb_each_text(COALESCE(v_result,'{}')) AS t(key,count)),0))
  );
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('total',0);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_unread_counts() TO authenticated;

-- get_dashboard_kpis — KPIs del dashboard de la directora
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_month text DEFAULT '%')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_students   int;
  v_teachers   int;
  v_classrooms int;
  v_attendance int;
  v_pending    numeric;
  v_incidents  int;
  v_today      date := current_date;
BEGIN
  v_students   := (SELECT count(*)::int FROM public.students WHERE is_active = true);
  v_teachers   := (SELECT count(*)::int FROM public.profiles WHERE role IN ('maestra','asistente'));
  v_classrooms := (SELECT count(*)::int FROM public.classrooms);
  v_attendance := (SELECT count(*)::int FROM public.attendance WHERE date = v_today AND status IN ('present','late'));
  v_pending    := COALESCE((SELECT sum(amount) FROM public.payments WHERE status IN ('pending','overdue','pendiente','vencido')), 0);
  v_incidents  := COALESCE((SELECT count(*)::int FROM public.inquiries WHERE status NOT IN ('resolved','closed')), 0);

  RETURN jsonb_build_object(
    'total',            v_students,
    'active',           v_students,
    'teachers',         v_teachers,
    'classrooms',       v_classrooms,
    'attendance_today', v_attendance,
    'pending_payments', v_pending,
    'pending_amount',   v_pending,
    'inquiries',        v_incidents
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis(text) TO authenticated;

-- get_legacy_periods_for_sync — períodos legacy para que el frontend los muestre mientras migra
CREATE OR REPLACE FUNCTION public.get_legacy_periods_for_sync()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'start_date', p.start_date,
      'end_date', p.end_date,
      'status', p.status,
      'is_active', p.is_active,
      'classroom_id', p.classroom_id,
      'classroom_name', c.name
    ) ORDER BY p.start_date DESC
  ) INTO v_result
  FROM public.periods p
  LEFT JOIN public.classrooms c ON c.id = p.classroom_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_legacy_periods_for_sync() TO authenticated;

-- ══════════════════════════════════════════════════════════════
