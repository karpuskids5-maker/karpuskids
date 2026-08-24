-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · SQL OPERATIVO 05/10 — FUNCIONES CONSOLIDADAS + PREINSCRIPCIÓN
-- ═══════════════════════════════════════════════════════════════════════════
-- Continuación del esquema maestro (karpus_schema_completo.sql).
-- Contenido: SECCIÓN 14B helpers consolidados de migraciones (RLS, ponche, chat, pagos, año escolar, reportes) · SECCIÓN 14C preinscripción e inscripción completa
-- Origen: líneas 2110–3398 del archivo original.
--
-- ⚠ EJECUTAR EN ORDEN: 01 → 10 (Supabase Dashboard → SQL Editor)
--   Cada archivo continúa el esquema del anterior; no saltarse ninguno
--   en una base nueva. En la base existente son idempotentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- SECCIÓN 14B: FUNCIONES CONSOLIDADAS DE MIGRACIONES
-- Helpers RLS, ponche, chat, pagos, año escolar y reportes que
-- el bloque de limpieza (SECCIÓN 0) elimina y aquí se recrean.
-- ══════════════════════════════════════════════════════════════

-- ── Helpers de rol / RLS ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_teacher_of_classroom(p_classroom_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  select exists (select 1 from public.classrooms where id = p_classroom_id and teacher_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_parent_of_student(p_student_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  select exists (select 1 from public.students where id = p_student_id and parent_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_parent_of_classroom(p_classroom_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  select exists (select 1 from public.students where classroom_id = p_classroom_id and parent_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_teacher_of_student(p_student_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  select exists (
    select 1 from public.students s
    join public.classrooms c on c.id = s.classroom_id
    where s.id = p_student_id and c.teacher_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_classroom_ids()
RETURNS table(ret_id bigint) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  select s.classroom_id::bigint from public.students s
  where s.parent_id = auth.uid() and s.classroom_id is not null and s.deleted_at is null;
$$;

CREATE OR REPLACE FUNCTION public.user_is_participant(p_conversation_id bigint, p_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.assign_student_to_classroom(p_student_id bigint, p_classroom_id bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.students SET classroom_id = p_classroom_id WHERE id = p_student_id;
$$;
GRANT EXECUTE ON FUNCTION public.assign_student_to_classroom(bigint, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_students_bulk(p_student_ids bigint[], p_classroom_id bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.students SET classroom_id = p_classroom_id WHERE id = ANY(p_student_ids);
$$;
GRANT EXECUTE ON FUNCTION public.assign_students_bulk(bigint[], bigint) TO authenticated;

-- ── Ponche (asistencia) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_student_punch(p_matricula text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_student record;
  v_attendance record;
  v_settings record;
  v_now timestamp with time zone := now();
  v_today date := current_date;
  v_status text;
  v_msg text;
  v_type text;
begin
  select * into v_student from public.students
  where matricula = p_matricula
  and deleted_at is null
  and (is_active is true or is_active is null);

  if not found then
    return jsonb_build_object('success', false, 'message', 'Estudiante no encontrado');
  end if;

  select * into v_settings from public.school_settings where id = 1;

  select * into v_attendance from public.attendance
  where student_id = v_student.id and date = v_today;

  if v_attendance.id is null then
    v_type := 'check_in';
    if v_now::time > v_settings.check_in_end then
      v_status := 'late';
      v_msg := v_student.name || ' registrado - Entrada (Tardanza)';
    else
      v_status := 'present';
      v_msg := v_student.name || ' registrado - Entrada';
    end if;

    insert into public.attendance (student_id, classroom_id, date, status, check_in)
    values (v_student.id, v_student.classroom_id, v_today, v_status, v_now);

  elsif v_attendance.check_out is null then
    v_type := 'check_out';
    v_status := 'retirado';
    v_msg := v_student.name || ' registrado - Salida';

    update public.attendance
    set check_out = v_now, status = v_status
    where id = v_attendance.id;

  else
    return jsonb_build_object('success', false, 'message', v_student.name || ' ya registró entrada y salida hoy');
  end if;

  insert into public.system_events (type, payload)
  values ('student_punch', jsonb_build_object(
    'student_id', v_student.id,
    'student_name', v_student.name,
    'parent_id', v_student.parent_id,
    'punch_type', v_type,
    'timestamp', v_now,
    'status', v_status
  ));

  return jsonb_build_object(
    'success', true,
    'message', v_msg,
    'student_name', v_student.name,
    'type', v_type,
    'time', to_char(v_now, 'HH12:MI AM')
  );
end;
$$;
GRANT EXECUTE ON FUNCTION public.process_student_punch(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_student_punch(text) TO service_role;

-- ── Triggers: chat y pagos ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_student_chat_creation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_teacher_id        uuid;
  v_classroom_chat_id bigint;
  v_dm_chat_id        bigint;
begin
  if NEW.classroom_id is null or NEW.parent_id is null then return NEW; end if;
  v_teacher_id := (select teacher_id from public.classrooms where classrooms.id = NEW.classroom_id);
  if v_teacher_id is null then return NEW; end if;
  v_classroom_chat_id := (select id from public.conversations where conversations.type = 'classroom' and conversations.classroom_id = NEW.classroom_id limit 1);
  if v_classroom_chat_id is null then
    insert into public.conversations (type, classroom_id)
      values ('classroom', NEW.classroom_id) returning id into v_classroom_chat_id;
  end if;
  insert into public.conversation_participants (conversation_id, user_id)
    values (v_classroom_chat_id, NEW.parent_id), (v_classroom_chat_id, v_teacher_id)
    on conflict do nothing;
  v_dm_chat_id := (select conv.id from public.conversations conv
    where conv.type = 'direct_message'
      and exists (select 1 from public.conversation_participants cp where cp.conversation_id = conv.id and cp.user_id = NEW.parent_id)
      and exists (select 1 from public.conversation_participants cp where cp.conversation_id = conv.id and cp.user_id = v_teacher_id)
    limit 1);
  if v_dm_chat_id is null then
    insert into public.conversations (type) values ('direct_message') returning id into v_dm_chat_id;
    insert into public.conversation_participants (conversation_id, user_id)
      values (v_dm_chat_id, NEW.parent_id), (v_dm_chat_id, v_teacher_id);
  end if;
  return NEW;
end;
$$;
DROP TRIGGER IF EXISTS on_student_upsert_chat ON public.students;
CREATE TRIGGER on_student_upsert_chat AFTER INSERT OR UPDATE OF classroom_id, parent_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.handle_student_chat_creation();

CREATE OR REPLACE FUNCTION public.notify_parent_on_new_charge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_parent_id    uuid;
  v_student_name text;
begin
  if new.status = 'pending' and new.amount > 0 then
    v_parent_id := (select parent_id from public.students where id = new.student_id);
    v_student_name := (select name from public.students where id = new.student_id);
    if v_parent_id is not null then
      insert into public.notifications (user_id, title, message, type, link)
      values (v_parent_id, 'Nuevo Cargo Generado',
        'Se genero un cargo de $' || new.amount::text || ' para '
          || coalesce(v_student_name, 'Estudiante')
          || ' (' || coalesce(new.month_paid, 'Mensualidad') || ').',
        'alert', 'panel_padres.html#payments');
    end if;
  end if;
  return new;
end;
$$;
DROP TRIGGER IF EXISTS on_new_payment_charge ON public.payments;
CREATE TRIGGER on_new_payment_charge AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.notify_parent_on_new_charge();

CREATE OR REPLACE FUNCTION public.update_staff_permits_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS tr_update_staff_permits_timestamp ON public.staff_permits;
CREATE TRIGGER tr_update_staff_permits_timestamp BEFORE UPDATE ON public.staff_permits
  FOR EACH ROW EXECUTE FUNCTION public.update_staff_permits_timestamp();

-- ── Pagos: anuales, año completo, mora, resumen ───────────────
CREATE OR REPLACE FUNCTION public.generate_annual_payments(p_year int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_student record;
  v_month int;
  v_month_key text;
  v_due_date date;
  v_plan_id bigint;
  v_count int := 0;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo staff puede generar pagos anuales';
  END IF;

  FOR v_student IN SELECT * FROM public.students WHERE is_active = true AND monthly_fee > 0 LOOP
    INSERT INTO public.payment_plans (student_id, year, total_amount, monthly_amount)
    VALUES (v_student.id, p_year, v_student.monthly_fee * 12, v_student.monthly_fee)
    ON CONFLICT (student_id, year) DO UPDATE SET monthly_amount = EXCLUDED.monthly_amount, total_amount = EXCLUDED.total_amount
    RETURNING id INTO v_plan_id;

    FOR v_month IN 1..12 LOOP
      v_month_key := p_year || '-' || lpad(v_month::text, 2, '0');
      DECLARE
        v_next_month int := CASE WHEN v_month = 12 THEN 1 ELSE v_month + 1 END;
        v_next_year  int := CASE WHEN v_month = 12 THEN p_year + 1 ELSE p_year END;
      BEGIN
        v_due_date := make_date(v_next_year, v_next_month, coalesce(v_student.due_day, 5));
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

CREATE OR REPLACE FUNCTION public.pay_full_year(
  p_student_id bigint,
  p_year       int,
  p_discount   numeric default 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_total numeric;
begin
  update public.payment_installments
  set status    = 'paid',
      paid_date = now()
  where student_id = p_student_id
    and month_paid like p_year || '%'
    and status != 'paid';

  select sum(amount) into v_total
  from public.payment_installments
  where student_id = p_student_id
    and month_paid like p_year || '%';

  v_total := coalesce(v_total, 0) - p_discount;

  update public.payment_plans
  set paid_percentage = 100,
      status = 'completed'
  where student_id = p_student_id and year = p_year;

  return jsonb_build_object('success', true, 'total_pagado', v_total);
end;
$$;
GRANT EXECUTE ON FUNCTION public.pay_full_year(bigint, int, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_overdue_payments()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.payments
  SET status = 'overdue'
  WHERE status = 'pending'
  AND due_date < CURRENT_DATE
  AND (deleted_at IS NULL OR deleted_at > NOW());

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('expired', v_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_overdue_payments() TO authenticated;

CREATE OR REPLACE FUNCTION public.financial_summary_month(p_year int, p_month int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_month_key text := p_year || '-' || lpad(p_month::text, 2, '0');
  v_paid      numeric;
  v_pending   numeric;
  v_invoiced  numeric;
begin
  v_paid    := coalesce((select sum(amount) from public.payments where month_paid = v_month_key and status in ('paid','pagado','confirmado')), 0);
  v_pending := coalesce((select sum(amount) from public.payments where month_paid = v_month_key and status in ('pending','overdue','pendiente','vencido','review')), 0);
  v_invoiced := v_paid + v_pending;

  return jsonb_build_object(
    'total_paid',     v_paid,
    'total_pending',  v_pending,
    'total_invoiced', v_invoiced
  );
end;
$$;
GRANT EXECUTE ON FUNCTION public.financial_summary_month(int, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.attendance_last_7_days()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_result jsonb := '{}';
  v_date   date;
  v_count  int;
begin
  for i in 0..6 loop
    v_date  := current_date - i;
    v_count := (select count(*)::int from public.attendance where date = v_date and status in ('present','late'));
    v_result := v_result || jsonb_build_object(v_date::text, v_count);
  end loop;
  return v_result;
end;
$$;
GRANT EXECUTE ON FUNCTION public.attendance_last_7_days() TO authenticated;

-- ── Año escolar / períodos (school engine) ───────────────────
CREATE OR REPLACE FUNCTION public.get_periods_for_year(p_school_year_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ap.id,
      'name', ap.name,
      'start_date', ap.start_date,
      'end_date', ap.end_date,
      'status', ap.status,
      'is_active', ap.is_active,
      'order_index', ap.order_index
    ) ORDER BY ap.order_index
  ) INTO v_result
  FROM public.academic_periods ap
  WHERE ap.school_year_id = p_school_year_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_periods_for_year(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.advance_school_year_state()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year record;
  v_today date := CURRENT_DATE;
  v_new_status text;
  v_changed boolean := false;
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora', 'admin') THEN
    RETURN jsonb_build_object('error', 'Acceso denegado');
  END IF;

  SELECT * INTO v_year
  FROM public.school_years
  WHERE status IN ('active', 'enrollment', 'reenrollment', 'draft')
  ORDER BY
    CASE status WHEN 'active' THEN 1 WHEN 'enrollment' THEN 2 WHEN 'reenrollment' THEN 3 ELSE 4 END
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'No hay año escolar para avanzar');
  END IF;

  v_new_status := v_year.status;

  CASE v_year.status
    WHEN 'draft' THEN
      IF v_year.enrollment_start IS NOT NULL AND v_today >= v_year.enrollment_start THEN
        v_new_status := 'enrollment';
        v_changed := true;
      END IF;

    WHEN 'enrollment' THEN
      IF v_year.enrollment_end IS NOT NULL AND v_today > v_year.enrollment_end THEN
        IF v_year.reenrollment_start IS NOT NULL AND v_today >= v_year.reenrollment_start THEN
          v_new_status := 'reenrollment';
        ELSE
          v_new_status := 'active';
        END IF;
        v_changed := true;
      END IF;

    WHEN 'reenrollment' THEN
      IF v_year.reenrollment_end IS NOT NULL AND v_today > v_year.reenrollment_end THEN
        v_new_status := 'active';
        v_changed := true;
      END IF;

    WHEN 'active' THEN
      IF v_today > v_year.end_date THEN
        v_new_status := 'closed';
        v_changed := true;
      END IF;
  END CASE;

  IF v_changed THEN
    UPDATE public.school_years SET status = v_new_status WHERE id = v_year.id;
    RETURN jsonb_build_object(
      'success', true,
      'old_status', v_year.status,
      'new_status', v_new_status,
      'school_year_name', v_year.name
    );
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'current_status', v_year.status,
    'message', 'No hay cambio de estado necesario'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.advance_school_year_state() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_enroll_student(p_student_id bigint, p_school_year_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_student record;
  v_year record;
  v_existing record;
BEGIN
  SELECT * INTO v_student FROM public.students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_enroll', false, 'error', 'Estudiante no encontrado');
  END IF;

  SELECT * INTO v_year FROM public.school_years WHERE id = p_school_year_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_enroll', false, 'error', 'Año escolar no encontrado');
  END IF;

  SELECT * INTO v_existing
  FROM public.enrollments
  WHERE student_id = p_student_id AND school_year_id = p_school_year_id AND status != 'rejected';

  IF FOUND THEN
    RETURN jsonb_build_object(
      'can_enroll', false,
      'error', 'El estudiante ya está inscrito en este año escolar',
      'existing_status', v_existing.status
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.student_history
    WHERE student_id = p_student_id AND school_year_id = p_school_year_id
  ) THEN
    RETURN jsonb_build_object('can_enroll', false, 'error', 'El estudiante ya tiene historial en este año');
  END IF;

  RETURN jsonb_build_object('can_enroll', true, 'student_name', v_student.name);
END;
$$;
GRANT EXECUTE ON FUNCTION public.can_enroll_student(bigint, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_period_stats(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_result jsonb;
  v_attendance record;
  v_grades record;
  v_tasks record;
BEGIN
  SELECT
    count(*) as total_records,
    count(*) FILTER (WHERE status = 'present') as present_count,
    count(*) FILTER (WHERE status = 'absent') as absent_count,
    count(*) FILTER (WHERE status = 'late') as late_count
  INTO v_attendance
  FROM public.attendance
  WHERE academic_period_id = p_period_id;

  SELECT
    count(*) as total_grades,
    COALESCE(avg(score), 0) as avg_score
  INTO v_grades
  FROM public.grades
  WHERE period_id = p_period_id;

  SELECT count(*) as total_tasks
  INTO v_tasks
  FROM public.tasks
  WHERE period_id = p_period_id;

  v_result := jsonb_build_object(
    'attendance', jsonb_build_object(
      'total', v_attendance.total_records,
      'present', v_attendance.present_count,
      'absent', v_attendance.absent_count,
      'late', v_attendance.late_count,
      'pct', CASE WHEN v_attendance.total_records > 0
        THEN round((v_attendance.present_count::numeric / v_attendance.total_records * 100), 1)
        ELSE 0 END
    ),
    'grades', jsonb_build_object(
      'total', v_grades.total_grades,
      'average', round(v_grades.avg_score, 1)
    ),
    'tasks', jsonb_build_object(
      'total', v_tasks.total_tasks
    )
  );

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_period_stats(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_school_year(p_school_year_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year record;
  v_role text;
  v_closed_periods int;
  v_student record;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora', 'admin') THEN
    RETURN jsonb_build_object('error', 'Solo la directora puede cerrar años escolares');
  END IF;

  SELECT * INTO v_year FROM public.school_years WHERE id = p_school_year_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Año escolar no encontrado');
  END IF;

  SELECT count(*) INTO v_closed_periods
  FROM public.academic_periods
  WHERE school_year_id = p_school_year_id AND status != 'closed';

  IF v_closed_periods > 0 THEN
    RETURN jsonb_build_object(
      'error', 'Todos los períodos deben estar cerrados antes de cerrar el año escolar',
      'pending_periods', v_closed_periods
    );
  END IF;

  FOR v_student IN
    SELECT s.*, c.name as classroom_name, c.level as grade_level,
      (SELECT name FROM public.profiles WHERE id = c.teacher_id) as teacher_name
    FROM public.students s
    LEFT JOIN public.classrooms c ON c.id = s.classroom_id
    WHERE s.school_year_id = p_school_year_id AND s.is_active = true AND s.deleted_at IS NULL
  LOOP
    INSERT INTO public.student_history (
      student_id, student_name, school_year_id, classroom_id,
      classroom_name, teacher_name, grade_level, status
    ) VALUES (
      v_student.id, v_student.name, p_school_year_id, v_student.classroom_id,
      v_student.classroom_name, v_student.teacher_name, v_student.grade_level, 'active'
    ) ON CONFLICT (student_id, school_year_id) DO NOTHING;
  END LOOP;

  UPDATE public.school_years SET status = 'archived' WHERE id = p_school_year_id;

  UPDATE public.academic_periods
  SET status = 'closed', is_active = false
  WHERE school_year_id = p_school_year_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Año escolar cerrado y archivado correctamente',
    'school_year_name', v_year.name
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.close_school_year(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.promote_students(p_school_year_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_student record;
  v_promoted int := 0;
  v_retained int := 0;
  v_year record;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora', 'admin') THEN
    RETURN jsonb_build_object('error', 'Solo la directora puede promover estudiantes');
  END IF;

  SELECT * INTO v_year FROM public.school_years WHERE id = p_school_year_id;
  IF NOT FOUND OR v_year.status != 'archived' THEN
    RETURN jsonb_build_object('error', 'El año escolar debe estar archivado para promover');
  END IF;

  FOR v_student IN
    SELECT sh.*, s.is_active
    FROM public.student_history sh
    JOIN public.students s ON s.id = sh.student_id
    WHERE sh.school_year_id = p_school_year_id AND sh.status = 'active'
  LOOP
    IF COALESCE(v_student.average_score, 100) >= 70
       AND COALESCE(v_student.attendance_pct, 100) >= 80 THEN
      UPDATE public.student_history SET status = 'promoted' WHERE id = v_student.id;
      v_promoted := v_promoted + 1;
    ELSE
      UPDATE public.student_history SET status = 'retained' WHERE id = v_student.id;
      v_retained := v_retained + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'promoted', v_promoted,
    'retained', v_retained,
    'message', v_promoted || ' estudiantes promovidos, ' || v_retained || ' requieren repetir'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.promote_students(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_school_year(
  p_id              bigint,
  p_name            text DEFAULT NULL,
  p_start_date      date DEFAULT NULL,
  p_end_date        date DEFAULT NULL,
  p_enrollment_start date DEFAULT NULL,
  p_enrollment_end  date DEFAULT NULL,
  p_reenrollment_start date DEFAULT NULL,
  p_reenrollment_end date DEFAULT NULL,
  p_status          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_row  public.school_years%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuario no autenticado o sin perfil');
  END IF;
  IF v_role NOT IN ('directora', 'admin') THEN
    RETURN jsonb_build_object('error', 'Solo la directora o admin pueden modificar años escolares');
  END IF;

  UPDATE public.school_years
  SET
    name               = COALESCE(p_name, name),
    start_date         = COALESCE(p_start_date, start_date),
    end_date           = COALESCE(p_end_date, end_date),
    enrollment_start   = COALESCE(p_enrollment_start, enrollment_start),
    enrollment_end     = COALESCE(p_enrollment_end, enrollment_end),
    reenrollment_start = COALESCE(p_reenrollment_start, reenrollment_start),
    reenrollment_end   = COALESCE(p_reenrollment_end, reenrollment_end),
    status             = CASE WHEN p_status IS NOT NULL THEN p_status ELSE status END
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Año escolar no encontrado');
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'start_date', v_row.start_date,
    'end_date', v_row.end_date,
    'enrollment_start', v_row.enrollment_start,
    'enrollment_end', v_row.enrollment_end,
    'reenrollment_start', v_row.reenrollment_start,
    'reenrollment_end', v_row.reenrollment_end,
    'status', v_row.status,
    'created_by', v_row.created_by,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_school_year(bigint, text, date, date, date, date, date, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_academic_periods_by_year(
  p_school_year_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_count int;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuario no autenticado o sin perfil');
  END IF;
  IF v_role NOT IN ('directora', 'maestra', 'asistente', 'admin') THEN
    RETURN jsonb_build_object('error', 'Sin permisos para eliminar períodos');
  END IF;

  DELETE FROM public.academic_periods
  WHERE school_year_id = p_school_year_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'deleted', v_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_academic_periods_by_year(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_first_academic_period(
  p_school_year_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_row public.academic_periods%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.academic_periods
  WHERE school_year_id = p_school_year_id
  ORDER BY order_index
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'id', v_row.id,
    'school_year_id', v_row.school_year_id,
    'name', v_row.name,
    'order_index', v_row.order_index
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_first_academic_period(bigint) TO authenticated;

-- ── resolve_period_id — acepta id de academic_periods O legacy periods ─
-- period_config, activities, grades y report_cards usan FK a legacy "periods",
-- mientras el School Engine usa academic_periods. Este helper acepta
-- CUALQUIER id y devuelve el id legacy (creándolo si falta), de modo que
-- todas las funciones de calificaciones funcionen con ambos sistemas.
-- NOTA: se revisa academic_periods PRIMERO para que una colisión de ids
-- (misma identidad en ambas tablas) no devuelva un período legacy equivocado.
CREATE OR REPLACE FUNCTION public.resolve_period_id(p_period_id bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_legacy bigint;
  v_ap     record;
BEGIN
  -- Si el id pertenece a academic_periods, mapear SIEMPRE por nombre + fechas
  SELECT * INTO v_ap FROM public.academic_periods WHERE id = p_period_id;
  IF FOUND THEN
    SELECT p.id INTO v_legacy
    FROM public.periods p
    WHERE p.name = v_ap.name
      AND p.start_date = v_ap.start_date
      AND p.end_date = v_ap.end_date
    ORDER BY p.id
    LIMIT 1;

    IF v_legacy IS NULL THEN
      INSERT INTO public.periods (name, start_date, end_date, status, is_active)
      VALUES (
        v_ap.name, v_ap.start_date, v_ap.end_date,
        CASE WHEN v_ap.status IN ('open','closed') THEN v_ap.status ELSE 'open' END,
        v_ap.is_active
      )
      RETURNING id INTO v_legacy;
    END IF;

    RETURN v_legacy;
  END IF;

  -- No es academic_period: devolver el id tal cual (legacy periods)
  RETURN p_period_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_period_id(bigint) TO authenticated;

-- ── Grados / reportes ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_activities_with_grades(p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',             a.id,
        'title',          a.title,
        'description',    a.description,
        'max_score',      a.max_score,
        'activity_number',a.activity_number,
        'is_mandatory',   a.is_mandatory,
        'config_id',      a.config_id,
        'subject_id',     pc.subject_id,
        'subject_name',   s.name,
        'grade_count',    COALESCE(g.grade_count, 0),
        'graded_count',   COALESCE(g.graded_count, 0)
      )
      ORDER BY s.name, a.activity_number
    ),
    '[]'::jsonb
  )
  FROM public.activities a
  JOIN public.period_config pc ON pc.id = a.config_id
  JOIN public.subjects s ON s.id = pc.subject_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS grade_count,
      COUNT(g.score_v2)::int AS graded_count
    FROM public.grades g
    WHERE g.activity_id = a.id
  ) g ON true
  WHERE pc.period_id = public.resolve_period_id(p_period_id);
$$;
GRANT EXECUTE ON FUNCTION public.get_activities_with_grades(bigint) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 14C: SISTEMA DE PREINSCRIPCIÓN E INSCRIPCIÓN (consolidado)
-- Fuentes: add_preinscripcion_system.sql + fix_preinscripcion_rls.sql
-- ══════════════════════════════════════════════════════════════

-- Columnas del expediente digital de students (faltantes)
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS payment_plan text
  CHECK (payment_plan IN ('unico','doble','mensual'));
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS discount_pct numeric(5,2) DEFAULT 0;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS nationality text DEFAULT 'Dominicana';
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS birthplace text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS province text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS municipality text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS sector text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS insurance text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS pediatrician text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS pediatrician_phone text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS medical_conditions text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS medications text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS food_restrictions text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS disabilities text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS vaccinations_complete boolean DEFAULT false;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS emergency_protocol text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS authorized_people jsonb DEFAULT '[]';
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS documents jsonb DEFAULT '{}';
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS inscription_fee numeric(10,2) DEFAULT 0;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS school_year_requested text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS level_requested text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS estimated_entry_date date;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS has_siblings boolean DEFAULT false;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS sibling_name text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS login_email text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p1_relationship text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p1_cedula text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p1_whatsapp text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p1_occupation text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p1_workplace text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p2_relationship text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p2_cedula text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p2_whatsapp text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p2_occupation text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS p2_workplace text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS emg_name text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS emg_relationship text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS emg_cedula text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS emg_phone text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS medical_notes text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS consents jsonb DEFAULT '{}';
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS signature_data text;

-- 1. CATÁLOGO DE CONCEPTOS DE PAGO
CREATE TABLE IF NOT EXISTS public.payment_concepts (
  id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name           text NOT NULL,
  type           text NOT NULL DEFAULT 'mensualidad'
                 CHECK (type IN ('inscripcion','mensualidad','prolongado','materiales','kit','servicio','otro')),
  default_amount numeric(10,2) DEFAULT 0,
  is_active      boolean DEFAULT true,
  sort_order     int DEFAULT 0,
  created_at     timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO public.payment_concepts (name, type, default_amount, sort_order) VALUES
  ('Inscripción',          'inscripcion',   2000,  1),
  ('Mensualidad',          'mensualidad',   4500,  2),
  ('Día Prolongado',       'prolongado',    1500,  3),
  ('Kit de Libros',        'kit',           1500,  4),
  ('Uniformes',            'servicio',       800,  5),
  ('Cuota Única Anual',    'mensualidad',   45000, 6),
  ('Semestre I',           'mensualidad',   22500, 7),
  ('Semestre II',          'mensualidad',   22500, 8)
ON CONFLICT DO NOTHING;

-- 2. PREINSCRIPCIONES (formulario público por wizard)
CREATE TABLE IF NOT EXISTS public.student_preregistrations (
  id                    bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','reviewing','admitted','converted','rejected','expired')),
  student_name          text NOT NULL,
  student_last_name     text,
  birth_date            date,
  gender                text CHECK (gender IN ('Masculino','Femenino')),
  nationality           text DEFAULT 'Dominicana',
  school_year_requested text,
  level_requested       text,
  schedule              text,
  estimated_entry_date  date,
  has_siblings          boolean DEFAULT false,
  sibling_name          text,
  parent_1              jsonb DEFAULT '{}',
  parent_2              jsonb DEFAULT '{}',
  emergency_contact     jsonb DEFAULT '{}',
  authorized_people     jsonb DEFAULT '[]',
  medical               jsonb DEFAULT '{}',
  documents             jsonb DEFAULT '{}',
  consents              jsonb DEFAULT '{}',
  signature_data        text,
  contact_email         text,
  contact_phone         text,
  review_notes          text,
  reviewed_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at           timestamp with time zone,
  converted_student_id  bigint REFERENCES public.students(id) ON DELETE SET NULL,
  ip_address            text,
  user_agent            text,
  created_at            timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prereg_status        ON public.student_preregistrations (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prereg_email         ON public.student_preregistrations (contact_email) WHERE contact_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prereg_converted     ON public.student_preregistrations (converted_student_id) WHERE converted_student_id IS NOT NULL;

-- 3. LIBRO DE CARGOS DEL ESTUDIANTE (student_charges)
CREATE TABLE IF NOT EXISTS public.student_charges (
  id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id   bigint NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  concept_id   bigint REFERENCES public.payment_concepts(id) ON DELETE SET NULL,
  concept      text NOT NULL,
  type         text NOT NULL DEFAULT 'mensualidad'
               CHECK (type IN ('inscripcion','mensualidad','prolongado','materiales','kit','servicio','otro')),
  amount       numeric(10,2) NOT NULL DEFAULT 0,
  discount_pct numeric(5,2)  NOT NULL DEFAULT 0,
  amount_net   numeric(10,2) NOT NULL DEFAULT 0,
  month_paid   text,
  due_date     date,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','review','paid','waived')),
  method       text,
  reference    text,
  proof_url    text,
  paid_date    timestamp with time zone,
  notes        text,
  created_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(student_id, concept, month_paid)
);

CREATE INDEX IF NOT EXISTS idx_student_charges_student ON public.student_charges (student_id, due_date DESC);
CREATE INDEX IF NOT EXISTS idx_student_charges_status  ON public.student_charges (status) WHERE status = 'pending';

-- 4. RPC: GENERAR CARGOS AL ADMITIR
CREATE OR REPLACE FUNCTION public.generate_student_charges(
  p_student_id          bigint,
  p_plan                text DEFAULT 'mensual',
  p_inscription_amount  numeric DEFAULT 0,
  p_monthly_amount      numeric DEFAULT 0,
  p_prolongado_fee      numeric DEFAULT 0,
  p_discount_pct        numeric DEFAULT 0,
  p_due_day             int     DEFAULT 5,
  p_months              int     DEFAULT 10,
  p_start_month         text    DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role         text;
  v_start_month  text;
  v_discount     numeric;
  v_month_net    numeric;
  v_prolong_net  numeric;
  v_tot_net      numeric;
  v_charges      int := 0;
  v_payments     int := 0;
  v_i            int;
  v_month        text;
  v_due          date;
  v_half         int;
  v_sem_mes      text;
  v_insc_net     numeric;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden generar cargos';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'El estudiante no existe';
  END IF;

  v_start_month := COALESCE(p_start_month, to_char(current_date, 'YYYY-MM'));
  v_discount    := GREATEST(0, LEAST(COALESCE(p_discount_pct,0), 100));
  v_month_net   := round(COALESCE(p_monthly_amount,0) * (1 - v_discount/100), 2);
  v_prolong_net := round(COALESCE(p_prolongado_fee,0) * (1 - v_discount/100), 2);

  IF COALESCE(p_inscription_amount,0) > 0 THEN
    v_insc_net := round(p_inscription_amount * (1 - v_discount/100), 2);
    v_due := (date_trunc('month', current_date) + (p_due_day - 1) * interval '1 day')::date;
    INSERT INTO public.student_charges
      (student_id, concept, type, amount, discount_pct, amount_net, due_date, status, created_by)
    VALUES (p_student_id, 'Inscripción', 'inscripcion', p_inscription_amount, v_discount, v_insc_net, v_due, 'pending', auth.uid())
    ON CONFLICT DO NOTHING;
    INSERT INTO public.payments (student_id, amount, concept, status, due_date, created_at)
    VALUES (p_student_id, v_insc_net, 'Inscripción', 'pending', v_due, now())
    ON CONFLICT DO NOTHING;
    v_charges := v_charges + 1;
    v_payments := v_payments + 1;
  END IF;

  IF p_plan = 'unico' THEN
    v_tot_net := v_month_net * GREATEST(p_months,1);
    v_due := (to_date(v_start_month || '-01','YYYY-MM-DD') + (p_due_day - 1) * interval '1 day')::date;
    INSERT INTO public.student_charges
      (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
    VALUES (p_student_id, 'Cuota Única Anual', 'mensualidad',
            round(COALESCE(p_monthly_amount,0) * GREATEST(p_months,1),2), v_discount, v_tot_net,
            v_start_month, v_due, 'pending', auth.uid())
    ON CONFLICT DO NOTHING;
    INSERT INTO public.payments (student_id, amount, concept, status, due_date, created_at)
    VALUES (p_student_id, v_tot_net, 'Cuota Única Anual', 'pending', v_due, now())
    ON CONFLICT DO NOTHING;
    v_charges := v_charges + 1;
    v_payments := v_payments + 1;
  ELSIF p_plan = 'doble' THEN
    v_half := floor(GREATEST(p_months,1) / 2.0)::int;
    FOR v_i IN 0..1 LOOP
      v_sem_mes := to_char(date_trunc('month', to_date(v_start_month,'YYYY-MM')) + (v_i * v_half) * interval '1 month', 'YYYY-MM');
      v_tot_net := v_month_net * (GREATEST(p_months,1) - v_i * v_half);
      v_due := (to_date(v_sem_mes || '-01','YYYY-MM-DD') + (p_due_day - 1) * interval '1 day')::date;
      INSERT INTO public.student_charges
        (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
      VALUES (p_student_id, CASE WHEN v_i = 0 THEN 'Semestre I' ELSE 'Semestre II' END, 'mensualidad',
              round(COALESCE(p_monthly_amount,0) * (GREATEST(p_months,1) - v_i * v_half),2), v_discount, v_tot_net,
              v_sem_mes, v_due, 'pending', auth.uid())
      ON CONFLICT DO NOTHING;
      INSERT INTO public.payments (student_id, amount, concept, status, due_date, created_at)
      VALUES (p_student_id, v_tot_net, CASE WHEN v_i = 0 THEN 'Semestre I' ELSE 'Semestre II' END, 'pending', v_due, now())
      ON CONFLICT DO NOTHING;
      v_charges := v_charges + 1;
      v_payments := v_payments + 1;
    END LOOP;
  ELSE
    FOR v_i IN 0 .. GREATEST(p_months,1)-1 LOOP
      v_month := to_char(date_trunc('month', to_date(v_start_month,'YYYY-MM')) + v_i * interval '1 month', 'YYYY-MM');
      v_due := (to_date(v_month || '-01','YYYY-MM-DD') + (p_due_day - 1) * interval '1 day')::date;
      INSERT INTO public.student_charges
        (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
      VALUES (p_student_id, 'Mensualidad', 'mensualidad', COALESCE(p_monthly_amount,0), v_discount, v_month_net,
              v_month, v_due, 'pending', auth.uid())
      ON CONFLICT DO NOTHING;
      INSERT INTO public.payments (student_id, amount, concept, status, due_date, month_paid, created_at)
      VALUES (p_student_id, v_month_net, 'Mensualidad', 'pending', v_due, v_month, now())
      ON CONFLICT DO NOTHING;
      v_charges := v_charges + 1;
      v_payments := v_payments + 1;
    END LOOP;
  END IF;

  IF v_prolong_net > 0 THEN
    FOR v_i IN 0 .. GREATEST(p_months,1)-1 LOOP
      v_month := to_char(date_trunc('month', to_date(v_start_month,'YYYY-MM')) + v_i * interval '1 month', 'YYYY-MM');
      v_due := (to_date(v_month || '-01','YYYY-MM-DD') + (p_due_day - 1) * interval '1 day')::date;
      INSERT INTO public.student_charges
        (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
      VALUES (p_student_id, 'Día Prolongado', 'prolongado', COALESCE(p_prolongado_fee,0), v_discount, v_prolong_net,
              v_month, v_due, 'pending', auth.uid())
      ON CONFLICT DO NOTHING;
      INSERT INTO public.payments (student_id, amount, concept, status, due_date, month_paid, created_at)
      VALUES (p_student_id, v_prolong_net, 'Día Prolongado', 'pending', v_due, v_month, now())
      ON CONFLICT DO NOTHING;
      v_charges := v_charges + 1;
      v_payments := v_payments + 1;
    END LOOP;
  END IF;

  UPDATE public.students
     SET monthly_fee   = COALESCE(p_monthly_amount, monthly_fee),
         prolongado_fee = COALESCE(p_prolongado_fee, prolongado_fee),
         due_day        = COALESCE(p_due_day, due_day),
         discount_pct   = v_discount,
         payment_plan   = p_plan
   WHERE id = p_student_id;

  RETURN jsonb_build_object('charges', v_charges, 'payments', v_payments,
    'plan', p_plan, 'start_month', v_start_month);
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_student_charges(bigint,text,numeric,numeric,numeric,numeric,int,int,text) TO authenticated;

-- 5. RPC: AFORO DE AULAS (ocupación vs capacidad)
CREATE OR REPLACE FUNCTION public.get_classrooms_capacity()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'level', c.level, 'capacity', c.capacity,
      'occupied', (SELECT count(*)::int FROM public.students s
                   WHERE s.classroom_id = c.id AND s.is_active = true AND s.deleted_at IS NULL),
      'available', GREATEST(c.capacity - (SELECT count(*)::int FROM public.students s
                   WHERE s.classroom_id = c.id AND s.is_active = true AND s.deleted_at IS NULL), 0)
    ) ORDER BY c.name), '[]')
  FROM public.classrooms c;
$$;
GRANT EXECUTE ON FUNCTION public.get_classrooms_capacity() TO authenticated;

-- 6. RPC: TRANSICIONES DE ESTADO AUDITADAS
CREATE OR REPLACE FUNCTION public.review_preregistration(
  p_id     bigint,
  p_status text,
  p_notes  text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_row  record;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden revisar preinscripciones';
  END IF;

  IF p_status NOT IN ('pending','reviewing','admitted','converted','rejected','expired') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status;
  END IF;

  UPDATE public.student_preregistrations
     SET status        = p_status,
         review_notes  = COALESCE(p_notes, review_notes),
         reviewed_by   = auth.uid(),
         reviewed_at   = now()
   WHERE id = p_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Preinscripción no encontrada';
  END IF;

  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (auth.uid(), 'preregistration.' || p_status,
    jsonb_build_object('prereg_id', p_id, 'student_name', v_row.student_name, 'status', p_status),
    now());

  RETURN jsonb_build_object('id', p_id, 'status', p_status);
END;
$$;
GRANT EXECUTE ON FUNCTION public.review_preregistration(bigint,text,text) TO authenticated;

-- 7. RPC: FORMULARIO PÚBLICO (anon inserta y devuelve el id)
CREATE OR REPLACE FUNCTION public.submit_preinscripcion(payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.student_preregistrations (
    student_name, student_last_name, birth_date, gender, nationality,
    school_year_requested, level_requested, schedule, estimated_entry_date,
    has_siblings, sibling_name,
    parent_1, parent_2, emergency_contact, authorized_people,
    medical, documents, consents, signature_data,
    contact_email, contact_phone, user_agent
  )
  VALUES (
    payload->>'student_name', payload->>'student_last_name',
    (payload->>'birth_date')::date, payload->>'gender', COALESCE(payload->>'nationality', 'Dominicana'),
    payload->>'school_year_requested', payload->>'level_requested', payload->>'schedule',
    (payload->>'estimated_entry_date')::date,
    COALESCE((payload->>'has_siblings')::boolean, false), payload->>'sibling_name',
    COALESCE(payload->'parent_1', '{}'), COALESCE(payload->'parent_2', '{}'),
    COALESCE(payload->'emergency_contact', '{}'), COALESCE(payload->'authorized_people', '[]'),
    COALESCE(payload->'medical', '{}'), COALESCE(payload->'documents', '{}'),
    COALESCE(payload->'consents', '{}'), payload->>'signature_data',
    payload->>'contact_email', payload->>'contact_phone', payload->>'user_agent'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_preinscripcion(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_preinscripcion(jsonb) TO anon, authenticated;

-- 8. RPC: GUARDAR URLs DE DOCUMENTOS TRAS SUBIRLOS A STORAGE
CREATE OR REPLACE FUNCTION public.set_preinscripcion_documents(p_id bigint, documents jsonb DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.student_preregistrations
  SET documents = documents
  WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_preinscripcion_documents(bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_preinscripcion_documents(bigint, jsonb) TO anon, authenticated;

-- 9. ROW LEVEL SECURITY
ALTER TABLE public.payment_concepts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_preregistrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_charges           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_concepts_read" ON public.payment_concepts;
CREATE POLICY "payment_concepts_read" ON public.payment_concepts FOR SELECT
  USING (true);
DROP POLICY IF EXISTS "payment_concepts_staff" ON public.payment_concepts;
CREATE POLICY "payment_concepts_staff" ON public.payment_concepts FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')));

DROP POLICY IF EXISTS "prereg_insert_public" ON public.student_preregistrations;
CREATE POLICY "prereg_insert_public" ON public.student_preregistrations FOR INSERT TO anon
  WITH CHECK (true);
DROP POLICY IF EXISTS "prereg_insert_auth" ON public.student_preregistrations;
CREATE POLICY "prereg_insert_auth" ON public.student_preregistrations FOR INSERT TO authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS "prereg_staff" ON public.student_preregistrations;
CREATE POLICY "prereg_staff" ON public.student_preregistrations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')));
DROP POLICY IF EXISTS "prereg_staff_update" ON public.student_preregistrations;
CREATE POLICY "prereg_staff_update" ON public.student_preregistrations FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')));

DROP POLICY IF EXISTS "charges_staff" ON public.student_charges;
CREATE POLICY "charges_staff" ON public.student_charges FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')));
DROP POLICY IF EXISTS "charges_parent" ON public.student_charges;
CREATE POLICY "charges_parent" ON public.student_charges FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_charges.student_id AND s.parent_id = auth.uid()));

-- 10. GRANTS
GRANT SELECT ON public.payment_concepts TO anon, authenticated;
GRANT INSERT ON public.student_preregistrations TO anon, authenticated;
GRANT SELECT, UPDATE ON public.student_preregistrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_charges TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.student_preregistrations_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.student_charges_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.payment_concepts_id_seq TO authenticated;

-- 11. STORAGE: bucket público para documentos de preinscripción
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'preinscripcion-docs') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('preinscripcion-docs', 'preinscripcion-docs', true, 2097152,
            ARRAY['image/png','image/jpeg','image/webp','application/pdf']);
  END IF;
END $$;

DROP POLICY IF EXISTS "preinscripcion_docs_public_read" ON storage.objects;
CREATE POLICY "preinscripcion_docs_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'preinscripcion-docs');
DROP POLICY IF EXISTS "preinscripcion_docs_public_insert" ON storage.objects;
CREATE POLICY "preinscripcion_docs_public_insert" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'preinscripcion-docs');
DROP POLICY IF EXISTS "preinscripcion_docs_staff_delete" ON storage.objects;
CREATE POLICY "preinscripcion_docs_staff_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'preinscripcion-docs'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')));

-- ══════════════════════════════════════════════════════════════
