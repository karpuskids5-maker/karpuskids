-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · SQL OPERATIVO 08/10 — POSTS RLS · PAGOS 2026 · REINSCRIPCIÓN · TAREAS
-- ═══════════════════════════════════════════════════════════════════════════
-- Continuación del esquema maestro (karpus_schema_completo.sql).
-- Contenido: PARTE B · SECCIÓN 27 posts/comentarios/likes RLS corregido · 28 pagos RLS y permisos 2026 · 29 reinscripción automática · 30 tareas vinculadas a áreas
-- Origen: líneas 4217–4753 del archivo original.
--
-- ⚠ EJECUTAR EN ORDEN: 01 → 10 (Supabase Dashboard → SQL Editor)
--   Cada archivo continúa el esquema del anterior; no saltarse ninguno
--   en una base nueva. En la base existente son idempotentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- SECCION 27 · POSTS/COMENTARIOS/LIKES - RLS CORREGIDO
-- Origen : migraciones/fix_posts_rls.sql
-- RPC con SECURITY DEFINER que bypasea RLS para padres; muestra posts
-- generales (classroom_id IS NULL) o del aula del padre/maestra.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_posts_for_parent(p_classroom_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',           p.id,
      'content',      p.content,
      'media_url',    p.media_url,
      'media_type',   p.media_type,
      'image_url',    p.image_url,
      'created_at',   p.created_at,
      'classroom_id', p.classroom_id,
      'teacher_id',   p.teacher_id,
      'teacher', jsonb_build_object(
        'name',       COALESCE(pr.name, p.teacher_name, 'Maestra'),
        'avatar_url', COALESCE(pr.avatar_url, p.teacher_avatar),
        'role',       pr.role
      ),
      'likes',    COALESCE((
        SELECT jsonb_agg(jsonb_build_object('user_id', l.user_id, 'id', l.id))
        FROM public.likes l WHERE l.post_id = p.id
      ), '[]'::jsonb),
      'comments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', c.id, 'content', c.content,
          'user_name', c.user_name, 'user_id', c.user_id,
          'created_at', c.created_at
        ) ORDER BY c.created_at ASC)
        FROM public.comments c WHERE c.post_id = p.id
      ), '[]'::jsonb)
    )
    ORDER BY p.created_at DESC
  )
  INTO v_result
  FROM public.posts p
  LEFT JOIN public.profiles pr ON pr.id = p.teacher_id
  WHERE
    p.classroom_id IS NULL
    OR (p_classroom_id IS NOT NULL AND p.classroom_id = p_classroom_id);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_posts_for_parent(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_posts_for_parent(bigint) TO anon;

DROP POLICY IF EXISTS "posts_select" ON public.posts;
CREATE POLICY "posts_select" ON public.posts FOR SELECT USING (
  auth.uid() IS NOT NULL
  AND (
    get_my_role() IN ('directora', 'asistente', 'admin', 'maestra')
    OR classroom_id IS NULL
    OR is_teacher_of_classroom(classroom_id)
    OR is_parent_of_classroom(classroom_id)
  )
);

DROP POLICY IF EXISTS "comments_select" ON public.comments;
CREATE POLICY "comments_select" ON public.comments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.posts p WHERE p.id = comments.post_id
    AND (
      auth.uid() IS NOT NULL AND (
        get_my_role() IN ('directora', 'asistente', 'admin', 'maestra')
        OR p.classroom_id IS NULL
        OR is_teacher_of_classroom(p.classroom_id)
        OR is_parent_of_classroom(p.classroom_id)
      )
    )
  )
);

DROP POLICY IF EXISTS "comments_insert" ON public.comments;
CREATE POLICY "comments_insert" ON public.comments FOR INSERT WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.posts p WHERE p.id = comments.post_id
    AND (
      get_my_role() IN ('directora', 'asistente', 'maestra', 'admin')
      OR p.classroom_id IS NULL
      OR is_parent_of_classroom(p.classroom_id)
    )
  )
);

DROP POLICY IF EXISTS "likes_select" ON public.likes;
CREATE POLICY "likes_select" ON public.likes FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.posts p WHERE p.id = likes.post_id
    AND (
      auth.uid() IS NOT NULL AND (
        get_my_role() IN ('directora', 'asistente', 'admin', 'maestra')
        OR p.classroom_id IS NULL
        OR is_teacher_of_classroom(p.classroom_id)
        OR is_parent_of_classroom(p.classroom_id)
      )
    )
  )
);

-- ═════════════════════════════════════════════════════════════════════════════
-- SECCION 28 · PAGOS - RLS Y PERMISOS 2026
-- Origen : migraciones/FIX_PAYMENTS_RLS_2026.sql
-- Directora/asistente/admin ven y gestionan TODOS los pagos; los padres
-- solo ven y cargan comprobantes de sus propios estudiantes.
-- ═════════════════════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO service_role;

DROP POLICY IF EXISTS "payments_staff" ON public.payments;
DROP POLICY IF EXISTS "payments_staff_all" ON public.payments;
DROP POLICY IF EXISTS "payments_parent_select" ON public.payments;
DROP POLICY IF EXISTS "payments_parent_insert" ON public.payments;
DROP POLICY IF EXISTS "payments_parent_update" ON public.payments;
DROP POLICY IF EXISTS "payments_staff_can_see_all" ON public.payments;
DROP POLICY IF EXISTS "payments_staff_can_insert" ON public.payments;
DROP POLICY IF EXISTS "payments_staff_can_update" ON public.payments;
DROP POLICY IF EXISTS "payments_staff_can_delete" ON public.payments;
DROP POLICY IF EXISTS "payments_parent_see_own" ON public.payments;
DROP POLICY IF EXISTS "payments_parent_can_submit" ON public.payments;
DROP POLICY IF EXISTS "payments_parent_can_update_own" ON public.payments;

CREATE POLICY "payments_staff_can_see_all" ON public.payments
  FOR SELECT
  USING (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '')
    IN ('directora', 'asistente', 'admin')
  );

CREATE POLICY "payments_staff_can_insert" ON public.payments
  FOR INSERT
  WITH CHECK (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '')
    IN ('directora', 'asistente', 'admin')
  );

CREATE POLICY "payments_staff_can_update" ON public.payments
  FOR UPDATE
  USING (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '')
    IN ('directora', 'asistente', 'admin')
  )
  WITH CHECK (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '')
    IN ('directora', 'asistente', 'admin')
  );

CREATE POLICY "payments_staff_can_delete" ON public.payments
  FOR DELETE
  USING (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '')
    IN ('directora', 'asistente', 'admin')
  );

CREATE POLICY "payments_parent_see_own" ON public.payments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students
      WHERE students.id = payments.student_id
      AND students.parent_id = auth.uid()
      AND students.deleted_at IS NULL
    )
  );

CREATE POLICY "payments_parent_can_submit" ON public.payments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.students
      WHERE students.id = payments.student_id
      AND students.parent_id = auth.uid()
      AND students.deleted_at IS NULL
    )
  );

CREATE POLICY "payments_parent_can_update_own" ON public.payments
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.students
      WHERE students.id = payments.student_id
      AND students.parent_id = auth.uid()
      AND students.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.students
      WHERE students.id = payments.student_id
      AND students.parent_id = auth.uid()
      AND students.deleted_at IS NULL
    )
  );

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS last_reminder_sent TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS validated_by UUID REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_student_id ON public.payments(student_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_month_paid ON public.payments(month_paid)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments(created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_due_date ON public.payments(due_date)
  WHERE deleted_at IS NULL AND status IN ('pending', 'overdue');

-- ═════════════════════════════════════════════════════════════════════════════
-- SECCION 29 · REINSCRIPCION AUTOMATICA
-- Origen : migraciones/add_reenrollment_flow.sql
-- 1. Concepto de pago "Reinscripcion"
-- 2. enrollments.payment_id: enlace solicitud <-> pago
-- 3. Generador de solicitudes + pago pendiente por estudiante activo
-- 4. Aprobacion/rechazo (RPC + helpers)
-- 5. Trigger: pago "Reinscripcion" aprobado -> reinscripcion aprobada
-- 6. Trigger: al activar/crear un ano escolar -> generar solicitudes
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.payment_concepts DROP CONSTRAINT IF EXISTS payment_concepts_type_check;
ALTER TABLE public.payment_concepts
  ADD CONSTRAINT payment_concepts_type_check
  CHECK (type IN ('inscripcion','mensualidad','prolongado','materiales','kit','servicio','reinscripcion','otro'));

ALTER TABLE public.student_charges DROP CONSTRAINT IF EXISTS student_charges_type_check;
ALTER TABLE public.student_charges
  ADD CONSTRAINT student_charges_type_check
  CHECK (type IN ('inscripcion','mensualidad','prolongado','materiales','kit','servicio','reinscripcion','otro'));

-- Índice único opcional: si los datos existentes tienen duplicados, no debe
-- romper la ejecución del script.
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS payment_concepts_name_key ON public.payment_concepts(name);
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

-- Seed de 'Reinscripción' sin depender de ON CONFLICT.
UPDATE public.payment_concepts
SET type = 'reinscripcion', is_active = true
WHERE name = 'Reinscripción';

INSERT INTO public.payment_concepts (name, type, default_amount, sort_order)
SELECT 'Reinscripción', 'reinscripcion', 2000, 1
WHERE NOT EXISTS (SELECT 1 FROM public.payment_concepts WHERE name = 'Reinscripción');

ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS payment_id bigint REFERENCES public.payments(id) ON DELETE SET NULL;

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

-- ═════════════════════════════════════════════════════════════════════════════
-- SECCION 30 · TAREAS VINCULADAS A AREAS (config_id)
-- Origen : migraciones/add_tasks_config_link.sql
-- Agrega config_id a tasks (bigint, igual que period_config.id) para que la
-- maestra asocie una tarea didactica al area/periodo activo. Limpia una
-- version previa mal tipada (uuid) si llego a aplicarse.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks'
      AND column_name = 'config_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.tasks DROP COLUMN config_id;
  END IF;
END $$;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS config_id bigint REFERENCES public.period_config(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_config_id ON public.tasks (config_id);

-- ═════════════════════════════════════════════════════════════════════════════
