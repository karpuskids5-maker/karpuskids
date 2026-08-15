-- ============================================================
-- FLUJO DE REINSCRIPCIÓN AUTOMÁTICA (Karpus Kids)
-- ---------------------------------------------
-- 1. Concepto de pago "Reinscripción" (payment_concepts)
-- 2. enrollments.payment_id: enlace solicitud <-> pago
-- 3. generate_reenrollment_requests(_internal): genera solicitudes
--    + pago pendiente por cada estudiante activo del año anterior
-- 4. apply_reenrollment_approval / review_reenrollment
-- 5. Trigger: al aprobar el pago "Reinscripción" -> reinscripción aprobada
-- 6. Trigger: al activar un año escolar -> genera solicitudes
-- ============================================================

-- ------------------------------------------------------------
-- 1. CATÁLOGO: ampliar CHECK y sembrar el concepto
-- ------------------------------------------------------------
ALTER TABLE public.payment_concepts DROP CONSTRAINT IF EXISTS payment_concepts_type_check;
ALTER TABLE public.payment_concepts
  ADD CONSTRAINT payment_concepts_type_check
  CHECK (type IN ('inscripcion','mensualidad','prolongado','materiales','kit','servicio','reinscripcion','otro'));

ALTER TABLE public.student_charges DROP CONSTRAINT IF EXISTS student_charges_type_check;
ALTER TABLE public.student_charges
  ADD CONSTRAINT student_charges_type_check
  CHECK (type IN ('inscripcion','mensualidad','prolongado','materiales','kit','servicio','reinscripcion','otro'));

-- El ON CONFLICT (name) requiere unicidad en el nombre del concepto
CREATE UNIQUE INDEX IF NOT EXISTS payment_concepts_name_key ON public.payment_concepts(name);

INSERT INTO public.payment_concepts (name, type, default_amount, sort_order)
VALUES ('Reinscripción', 'reinscripcion', 2000, 1)
ON CONFLICT (name) DO UPDATE SET type = 'reinscripcion', is_active = true;

-- ------------------------------------------------------------
-- 2. ENROLLMENTS: enlace al pago de reinscripción
-- ------------------------------------------------------------
ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS payment_id bigint REFERENCES public.payments(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 3. GENERADOR (interno, sin chequeo de rol — lo llaman triggers)
--    Idempotente: no duplica solicitudes ni pagos por año.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_reenrollment_requests_internal(p_school_year_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year             record;
  v_student          record;
  v_cls              record;
  v_concept_amount   numeric(10,2);
  v_amount           numeric(10,2);
  v_amount_net       numeric(10,2);
  v_due              date;
  v_enrollment_id    bigint;
  v_payment_id       bigint;
  v_count            int := 0;
  v_actor            uuid;
BEGIN
  SELECT * INTO v_year FROM public.school_years WHERE id = p_school_year_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','Año escolar no encontrado');
  END IF;

  BEGIN v_actor := auth.uid(); EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;

  SELECT default_amount INTO v_concept_amount
  FROM public.payment_concepts
  WHERE type = 'reinscripcion' AND is_active
  ORDER BY sort_order LIMIT 1;

  v_due := COALESCE(v_year.reenrollment_end, v_year.enrollment_end, v_year.end_date);

  FOR v_student IN
    SELECT s.*
    FROM public.students s
    WHERE s.deleted_at IS NULL
      AND s.is_active = true
      AND s.school_year_id IS DISTINCT FROM p_school_year_id
      AND NOT EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.student_id = s.id
          AND e.school_year_id = p_school_year_id
          AND e.status <> 'rejected'
      )
      AND (
        (s.school_year_id IS NOT NULL AND s.school_year_id < p_school_year_id)
        OR EXISTS (
          SELECT 1 FROM public.enrollments e2
          WHERE e2.student_id = s.id
            AND e2.school_year_id < p_school_year_id
            AND e2.status = 'approved'
        )
      )
  LOOP
    -- Aula destino: preferir un aula del mismo nivel con cupo; si no, mantener la actual.
    SELECT c.id INTO v_cls
    FROM public.classrooms c
    JOIN public.classrooms cur ON cur.id = v_student.classroom_id
    WHERE c.level = cur.level
      AND c.capacity > (
        SELECT COUNT(*) FROM public.students s2
        WHERE s2.classroom_id = c.id AND s2.is_active AND s2.deleted_at IS NULL
      )
    ORDER BY c.id LIMIT 1;

    IF v_cls.id IS NULL THEN
      v_cls.id := v_student.classroom_id;
    END IF;

    v_amount := COALESCE(NULLIF(v_concept_amount, 0), COALESCE(v_student.inscription_fee, 0));
    v_amount_net := round(v_amount * (1 - GREATEST(0, LEAST(COALESCE(v_student.discount_pct,0),100))/100), 2);

    INSERT INTO public.enrollments
      (student_id, school_year_id, type, classroom_id, parent_id, student_name, status)
    VALUES
      (v_student.id, p_school_year_id, 'reenrollment', v_cls.id, v_student.parent_id, v_student.name, 'pending')
    RETURNING id INTO v_enrollment_id;

    -- Pago pendiente "Reinscripción" (sin mes para no chocar con mensualidades)
    IF v_amount_net > 0 THEN
      INSERT INTO public.payments
        (student_id, amount, concept, status, due_date, notes)
      VALUES
        (v_student.id, v_amount_net, 'Reinscripción', 'pending', v_due,
         'Reinscripción ' || v_year.name || ' — solicitud #' || v_enrollment_id)
      RETURNING id INTO v_payment_id;

      UPDATE public.enrollments SET payment_id = v_payment_id WHERE id = v_enrollment_id;

      INSERT INTO public.student_charges
        (student_id, concept, type, amount, discount_pct, amount_net, due_date, status, created_by)
      VALUES
        (v_student.id, 'Reinscripción', 'reinscripcion', v_amount, COALESCE(v_student.discount_pct,0),
         v_amount_net, v_due, 'pending', v_actor);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'generated', v_count, 'school_year_id', p_school_year_id, 'school_year_name', v_year.name);
END;
$$;

-- ------------------------------------------------------------
-- 4. RPC PÚBLICO (staff) — generar solicitudes manualmente
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_reenrollment_requests(p_school_year_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error','Solo directora/asistente/admin pueden generar reinscripciones');
  END IF;
  RETURN public.generate_reenrollment_requests_internal(p_school_year_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_reenrollment_requests(bigint) TO authenticated;

-- ------------------------------------------------------------
-- 4b. APROBACIÓN — helper compartido (trigger + RPC)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_reenrollment_approval(p_enrollment_id bigint, p_approved_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_enr      record;
  v_cls      public.classrooms%ROWTYPE;
  v_teacher  text;
BEGIN
  SELECT * INTO v_enr FROM public.enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Reinscripción no encontrada'); END IF;
  IF v_enr.status = 'approved' THEN RETURN jsonb_build_object('success',true,'already','approved'); END IF;
  IF v_enr.status = 'rejected' THEN RETURN jsonb_build_object('error','La reinscripción está rechazada'); END IF;

  SELECT * INTO v_cls FROM public.classrooms WHERE id = v_enr.classroom_id;
  SELECT name INTO v_teacher FROM public.profiles WHERE id = v_cls.teacher_id;

  UPDATE public.enrollments
    SET status = 'approved', enrolled_at = now(), approved_by = p_approved_by
  WHERE id = p_enrollment_id;

  UPDATE public.students
    SET school_year_id = v_enr.school_year_id,
        classroom_id   = COALESCE(v_enr.classroom_id, classroom_id),
        enrollment_type = 'reenrollment',
        is_active      = true
  WHERE id = v_enr.student_id;

  INSERT INTO public.student_history
    (student_id, school_year_id, academic_period_id, classroom_id, classroom_name, teacher_name, grade_level, status)
  VALUES
    (v_enr.student_id, v_enr.school_year_id, NULL, v_cls.id, v_cls.name, v_teacher, v_cls.level, 'active')
  ON CONFLICT (student_id, school_year_id) DO UPDATE SET
    classroom_id   = EXCLUDED.classroom_id,
    classroom_name = EXCLUDED.classroom_name,
    teacher_name   = EXCLUDED.teacher_name,
    grade_level    = EXCLUDED.grade_level,
    status         = 'active';

  IF v_enr.payment_id IS NOT NULL THEN
    UPDATE public.payments
      SET status = 'paid', paid_date = now(), validated_by = p_approved_by,
          notes = COALESCE(notes,'') || ' | Reinscripción aprobada'
    WHERE id = v_enr.payment_id AND status <> 'paid';
  END IF;

  INSERT INTO public.audit_logs (user_id, action, payload)
  VALUES (p_approved_by, 'reenrollment.approved',
    jsonb_build_object('enrollment_id', p_enrollment_id, 'student_id', v_enr.student_id,
      'school_year_id', v_enr.school_year_id, 'payment_id', v_enr.payment_id));

  RETURN jsonb_build_object('success', true, 'enrollment_id', p_enrollment_id);
END;
$$;

-- ------------------------------------------------------------
-- 4c. RPC PÚBLICO — revisar una solicitud de reinscripción
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_reenrollment(p_enrollment_id bigint, p_status text, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_enr  record;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error','Solo directora/asistente/admin pueden revisar reinscripciones');
  END IF;
  IF p_status NOT IN ('approved','rejected') THEN
    RETURN jsonb_build_object('error','Estado inválido');
  END IF;

  SELECT * INTO v_enr FROM public.enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Reinscripción no encontrada'); END IF;

  IF p_status = 'approved' THEN
    RETURN public.apply_reenrollment_approval(p_enrollment_id, auth.uid());
  END IF;

  UPDATE public.enrollments
    SET status = 'rejected', notes = COALESCE(p_notes, notes)
  WHERE id = p_enrollment_id;

  IF v_enr.payment_id IS NOT NULL THEN
    UPDATE public.payments
      SET status = 'rejected', notes = COALESCE(notes,'') || ' | Reinscripción rechazada'
    WHERE id = v_enr.payment_id AND status <> 'paid';
  END IF;

  INSERT INTO public.audit_logs (user_id, action, payload)
  VALUES (auth.uid(), 'reenrollment.rejected',
    jsonb_build_object('enrollment_id', p_enrollment_id, 'student_id', v_enr.student_id,
      'school_year_id', v_enr.school_year_id, 'notes', p_notes));

  RETURN jsonb_build_object('success', true, 'enrollment_id', p_enrollment_id, 'status', 'rejected');
END;
$$;
GRANT EXECUTE ON FUNCTION public.review_reenrollment(bigint, text, text) TO authenticated;

-- ------------------------------------------------------------
-- 5. TRIGGER: pago "Reinscripción" aprobado -> reinscripción aprobada
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reenrollment_on_payment_approved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_enr record;
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.concept = 'Reinscripción' THEN
    SELECT * INTO v_enr
    FROM public.enrollments
    WHERE payment_id = NEW.id AND status = 'pending'
    LIMIT 1;
    IF FOUND THEN
      PERFORM public.apply_reenrollment_approval(v_enr.id, COALESCE(NEW.validated_by, NEW.recorded_by));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_reenrollment_payment ON public.payments;
CREATE TRIGGER trg_reenrollment_payment
  AFTER UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_reenrollment_on_payment_approved();

-- ------------------------------------------------------------
-- 6. TRIGGER: al activar/crear un año escolar -> generar solicitudes
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reenrollment_on_year_activate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('enrollment','reenrollment','active') THEN
      PERFORM public.generate_reenrollment_requests_internal(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_reenrollment_year ON public.school_years;
CREATE TRIGGER trg_reenrollment_year
  AFTER INSERT OR UPDATE OF status ON public.school_years
  FOR EACH ROW EXECUTE FUNCTION public.fn_reenrollment_on_year_activate();
