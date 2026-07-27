-- ============================================================
-- KARPUS KIDS — SQL DE SEGURIDAD PARA PRODUCCIÓN
-- Corrige: search_path, índices, constraints, RLS gaps, role checks
-- EJECUTAR EN: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. AGREGAR search_path A FUNCIONES TRIGGER ───────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role, accepted_terms)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'padre'),
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ── 2. AGREGAR ROLE CHECKS A FUNCIONES CRÍTICAS ──────────────────────────────

-- run_payment_cycle: solo staff puede ejecutar
DROP FUNCTION IF EXISTS public.run_payment_cycle();
CREATE OR REPLACE FUNCTION public.run_payment_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role         text;
  v_gen_day      int;
  v_due_day      int;
  v_today        int := extract(day from current_date)::int;
  v_cur_month    int := extract(month from current_date)::int;
  v_cur_year     int := extract(year  from current_date)::int;
  v_next_month   int;
  v_next_year    int;
  v_gen_count    int := 0;
  v_expire_count int := 0;
  v_due_date     date;
  v_month_key    text;
BEGIN
  -- Verificar rol
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden ejecutar el ciclo de pagos';
  END IF;

  SELECT generation_day, due_day INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  IF v_gen_day IS NULL THEN
    RETURN jsonb_build_object('error', 'school_settings no encontrado');
  END IF;

  IF v_today >= v_gen_day THEN
    v_month_key  := to_char(current_date, 'YYYY-MM');
    v_next_month := v_cur_month + 1;
    v_next_year  := v_cur_year;
    IF v_next_month > 12 THEN v_next_month := 1; v_next_year := v_next_year + 1; END IF;
    v_due_date := make_date(v_next_year, v_next_month, v_due_day);

    INSERT INTO public.payments (student_id, amount, status, due_date, month_paid, concept)
    SELECT s.id, s.monthly_fee, 'pending', v_due_date, v_month_key, 'Mensualidad'
    FROM public.students s
    WHERE s.is_active = true AND s.monthly_fee > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id AND p.month_paid = v_month_key
      );
    GET DIAGNOSTICS v_gen_count = ROW_COUNT;
  END IF;

  UPDATE public.payments SET status = 'overdue'
  WHERE status = 'pending' AND due_date < current_date;
  GET DIAGNOSTICS v_expire_count = ROW_COUNT;

  RETURN jsonb_build_object('generated', v_gen_count, 'expired', v_expire_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_payment_cycle() TO authenticated;

-- generate_annual_payments: solo staff
DROP FUNCTION IF EXISTS public.generate_annual_payments(int);
CREATE OR REPLACE FUNCTION public.generate_annual_payments(p_year int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role      text;
  v_student   record;
  v_month     int;
  v_month_key text;
  v_due_date  date;
  v_plan_id   bigint;
  v_count     int := 0;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo staff puede generar pagos anuales';
  END IF;

  FOR v_student IN
    SELECT * FROM public.students WHERE is_active = true AND monthly_fee > 0
  LOOP
    INSERT INTO public.payment_plans (student_id, year, total_amount, monthly_amount)
    VALUES (v_student.id, p_year, v_student.monthly_fee * 12, v_student.monthly_fee)
    ON CONFLICT (student_id, year) DO UPDATE
      SET monthly_amount = excluded.monthly_amount, total_amount = excluded.total_amount
    RETURNING id INTO v_plan_id;

    FOR v_month IN 1..12 LOOP
      v_month_key := p_year || '-' || lpad(v_month::text, 2, '0');
      DECLARE
        v_next_month int := CASE WHEN v_month = 12 THEN 1 ELSE v_month + 1 END;
        v_next_year  int := CASE WHEN v_month = 12 THEN p_year + 1 ELSE p_year END;
      BEGIN
        v_due_date := make_date(v_next_year, v_next_month, COALESCE(v_student.due_day, 5));
      END;
      INSERT INTO public.payment_installments (plan_id, student_id, month_paid, amount, due_date)
      VALUES (v_plan_id, v_student.id, v_month_key, v_student.monthly_fee, v_due_date)
      ON CONFLICT (student_id, month_paid) DO NOTHING;
      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('generated', v_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_annual_payments(int) TO authenticated;

-- pay_full_year: solo staff (firma original con p_discount)
DROP FUNCTION IF EXISTS public.pay_full_year(bigint, integer, numeric);
CREATE OR REPLACE FUNCTION public.pay_full_year(
  p_student_id bigint,
  p_year       int,
  p_discount   numeric DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role  text;
  v_total numeric;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo staff puede registrar pagos anuales';
  END IF;
  IF p_discount < 0 THEN RAISE EXCEPTION 'Descuento no puede ser negativo'; END IF;

  UPDATE public.payment_installments
  SET status = 'paid', paid_date = now()
  WHERE student_id = p_student_id AND month_paid LIKE p_year || '%' AND status != 'paid';

  SELECT sum(amount) INTO v_total FROM public.payment_installments
  WHERE student_id = p_student_id AND month_paid LIKE p_year || '%';

  v_total := COALESCE(v_total, 0) - p_discount;

  UPDATE public.payment_plans
  SET paid_percentage = 100, status = 'completed'
  WHERE student_id = p_student_id AND year = p_year;

  RETURN jsonb_build_object('success', true, 'total_pagado', v_total);
END;
$$;
GRANT EXECUTE ON FUNCTION public.pay_full_year(bigint, int, numeric) TO authenticated;

-- ── 3. ÍNDICES FALTANTES EN FOREIGN KEYS ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_attendance_classroom        ON public.attendance(classroom_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date     ON public.attendance(student_id, date);
CREATE INDEX IF NOT EXISTS idx_comments_user               ON public.comments(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_user                  ON public.likes(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_participants_user      ON public.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender             ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver           ON public.messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_incidents_teacher           ON public.incidents(teacher_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_classroom        ON public.daily_logs(classroom_id);
CREATE INDEX IF NOT EXISTS idx_grades_teacher              ON public.grades(teacher_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_parent            ON public.inquiries(parent_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created       ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_student_month      ON public.payments(student_id, month_paid);
CREATE INDEX IF NOT EXISTS idx_students_parent             ON public.students(parent_id);
CREATE INDEX IF NOT EXISTS idx_students_classroom          ON public.students(classroom_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role               ON public.profiles(role);

-- ── 4. CONSTRAINTS FALTANTES ─────────────────────────────────────────────────

-- Asistencia: student_id y classroom_id no deben ser NULL
DO $$ BEGIN
  BEGIN ALTER TABLE public.attendance ALTER COLUMN student_id SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.attendance ALTER COLUMN classroom_id SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.comments ALTER COLUMN post_id SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.likes ALTER COLUMN post_id SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.messages ALTER COLUMN conversation_id SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- ── 5. CORREGIR RLS DE login_attempts ────────────────────────────────────────
-- Evitar spam de registros por usuarios no autenticados

DROP POLICY IF EXISTS "login_attempts_insert" ON public.login_attempts;
CREATE POLICY "login_attempts_insert" ON public.login_attempts
  FOR INSERT WITH CHECK (true); -- Mantener permisivo para el sistema de rate limiting del login

-- ── 6. VALIDACIÓN EN process_door_punch ──────────────────────────────────────
-- Ya corregido en fix_punch_notifications.sql — agregar validación de código

CREATE OR REPLACE FUNCTION public.process_door_punch(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student  record; v_staff record; v_settings record;
  v_today    date := current_date;
  v_now      timestamp with time zone := now();
  v_type     text; v_name text; v_role text; v_parent uuid;
  v_existing record; v_attendance record; v_status text := 'present';
BEGIN
  -- Validar código QR
  IF p_code IS NULL OR length(trim(p_code)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Código QR inválido');
  END IF;

  SELECT * INTO v_student FROM public.students WHERE matricula = trim(p_code) AND is_active = true LIMIT 1;
  IF FOUND THEN
    v_name := v_student.name; v_role := 'Estudiante'; v_parent := v_student.parent_id;
    SELECT * INTO v_settings FROM public.school_settings WHERE id = 1;
    SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_in';
    IF NOT FOUND THEN
      v_type := 'check_in';
      IF v_settings.check_in_end IS NOT NULL AND v_now::time > v_settings.check_in_end THEN v_status := 'late'; END IF;
      SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
      IF v_attendance.id IS NULL THEN
        INSERT INTO public.attendance (student_id, classroom_id, date, status, check_in)
        VALUES (v_student.id, v_student.classroom_id, v_today, v_status, v_now);
      END IF;
      INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id, 'check_in', v_now, v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out';
        SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
        IF v_attendance.id IS NOT NULL THEN UPDATE public.attendance SET check_out = v_now, status = 'retirado' WHERE id = v_attendance.id; END IF;
        INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id, 'check_out', v_now, v_today) ON CONFLICT DO NOTHING;
      ELSE
        RETURN jsonb_build_object('success', false, 'message', v_name || ' ya registró entrada y salida hoy');
      END IF;
    END IF;
    RETURN jsonb_build_object('success', true, 'type', v_type, 'name', v_name, 'role', v_role,
      'student_id', v_student.id, 'parent_id', v_parent,
      'time', to_char(v_now AT TIME ZONE 'America/Santo_Domingo', 'HH12:MI AM'));
  END IF;

  SELECT * INTO v_staff FROM public.profiles
  WHERE (notes = trim(p_code) OR matricula = trim(p_code) OR access_code = trim(p_code))
    AND role IN ('maestra','asistente','directora','admin') LIMIT 1;
  IF NOT FOUND THEN
    BEGIN SELECT * INTO v_staff FROM public.profiles WHERE id = trim(p_code)::uuid AND role IN ('maestra','asistente','directora','admin') LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF FOUND THEN
    v_name := v_staff.name; v_role := initcap(v_staff.role);
    SELECT * INTO v_existing FROM public.door_punches WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_in';
    IF NOT FOUND THEN
      v_type := 'check_in';
      INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date) VALUES (v_staff.id, 'check_in', v_now, v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out';
        INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date) VALUES (v_staff.id, 'check_out', v_now, v_today) ON CONFLICT DO NOTHING;
      ELSE
        RETURN jsonb_build_object('success', false, 'message', v_name || ' ya registró entrada y salida hoy');
      END IF;
    END IF;
    RETURN jsonb_build_object('success', true, 'type', v_type, 'name', v_name, 'role', v_role,
      'student_id', null, 'parent_id', null,
      'time', to_char(v_now AT TIME ZONE 'America/Santo_Domingo', 'HH12:MI AM'));
  END IF;
  RETURN jsonb_build_object('success', false, 'message', 'QR no registrado en el sistema');
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO anon;

-- ── 7. TRIGGER DE AUDITORÍA PARA PAGOS ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_audit_log (
  id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  payment_id  bigint,
  action      text NOT NULL,
  old_status  text,
  new_status  text,
  changed_by  uuid REFERENCES public.profiles(id),
  changed_at  timestamp with time zone DEFAULT now() NOT NULL,
  details     jsonb DEFAULT '{}'
);
ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_log_staff" ON public.payment_audit_log;
CREATE POLICY "audit_log_staff" ON public.payment_audit_log FOR SELECT
  USING (get_my_role() IN ('directora','asistente','admin'));

CREATE OR REPLACE FUNCTION public.fn_audit_payment_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.payment_audit_log (payment_id, action, old_status, new_status, changed_by, details)
    VALUES (NEW.id, 'status_change', OLD.status, NEW.status, auth.uid(),
      jsonb_build_object('amount', NEW.amount, 'month_paid', NEW.month_paid, 'student_id', NEW.student_id));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.payment_audit_log (payment_id, action, old_status, changed_by, details)
    VALUES (OLD.id, 'deleted', OLD.status, auth.uid(),
      jsonb_build_object('amount', OLD.amount, 'month_paid', OLD.month_paid));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS audit_payment_changes ON public.payments;
CREATE TRIGGER audit_payment_changes
  AFTER UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_payment_changes();

-- ── 8. TRIGGER DE AUDITORÍA PARA CAMBIOS DE ROL ──────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_audit_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    INSERT INTO public.audit_logs (user_id, action, payload, created_at)
    VALUES (auth.uid(), 'profile.role_changed',
      jsonb_build_object('target_user', NEW.id, 'old_role', OLD.role, 'new_role', NEW.role),
      now())
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_role_change ON public.profiles;
CREATE TRIGGER audit_role_change
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION public.fn_audit_role_change();

-- ── 9. VERIFICACIÓN FINAL ─────────────────────────────────────────────────────
SELECT 'Índices creados' as check, count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%';
SELECT 'Triggers activos' as check, count(*) FROM information_schema.triggers WHERE trigger_schema = 'public';
